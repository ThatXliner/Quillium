import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
/**
 * awareness.ts -- Awareness-based cursor sync via y-protocols.
 *
 * Per D-72: Replaces custom cursors.ts with Yjs awareness protocol.
 * Per D-60: Maintains Google Docs-style cursor display with name labels.
 *
 * Awareness state schema:
 * - user: { name: string, color: string, colorLight: string }
 * - cursor: { anchor: number, head: number } | null
 *
 * Key dependencies:
 *   - y-protocols/awareness for Awareness type and protocol
 *   - @codemirror/view for ViewPlugin, WidgetType, Decoration
 *   - @codemirror/state for Extension, RangeSetBuilder
 *
 * Interactions:
 *   - yjsProvider.ts creates Awareness instance and passes it here
 *   - This module updates awareness on local cursor changes
 *   - This module renders remote cursors from awareness state
 */
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import { get } from "svelte/store";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { collabPresenceUsers, followedClientId } from "./store";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AwarenessUserState {
    name: string;
    color: string;
    colorLight: string;
}

/**
 * Cursor state stored in awareness. Uses Yjs RelativePositions (encoded as
 * Uint8Array and then serialized as a plain number[] since awareness values
 * are JSON-encoded over the wire) so that cursors track correctly through
 * concurrent edits from other collaborators.
 */
export interface AwarenessCursorState {
    anchorPos: number[];
    headPos: number[];
}

export interface AwarenessState {
    user?: AwarenessUserState;
    cursor?: AwarenessCursorState | null;
}

export interface AwarenessPositionMapper {
    /** Convert this editor's position to the shared document position. */
    toSharedPosition?: (position: number, state: EditorView["state"]) => number | null;
    /** Convert a shared document position to this editor's local position. */
    fromSharedPosition?: (position: number, state: EditorView["state"]) => number | null;
}

export interface AwarenessExtensionOptions extends AwarenessPositionMapper {
    /** Nested editors should not clear the shared cursor when they unmount. */
    clearCursorOnDestroy?: boolean;
    /** Main editor broadcasts immediately; nested editors wait until focused. */
    broadcastInitialCursor?: boolean;
}

// ── Color Palette (preserved from cursors.ts for D-60) ──────────────────────

const CURSOR_COLORS = [
    "#4A90E2",
    "#E87040",
    "#50B86C",
    "#9B59B6",
    "#E74C3C",
    "#16A085",
    "#F39C12",
    "#8E44AD",
];

/**
 * Deterministic color assignment for a clientID using djb2 hash.
 * Same clientID always returns the same color.
 */
export function colorForClient(clientID: string): string {
    let hash = 0;
    for (let i = 0; i < clientID.length; i++) {
        hash = (hash << 5) - hash + clientID.charCodeAt(i);
        hash |= 0; // Convert to 32-bit integer
    }
    return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

// ── RemoteCursorWidget (preserved style from cursors.ts) ────────────────────

class RemoteCursorWidget extends WidgetType {
    constructor(
        readonly name: string,
        readonly color: string,
        /** Position is part of identity so CodeMirror rebuilds the widget DOM
         *  when the remote cursor moves. Without it, eq() returns true for
         *  every keystroke at the same doc (same name+color) and CM reuses
         *  the old DOM at the old position. */
        readonly pos: number,
    ) {
        super();
    }

    eq(other: RemoteCursorWidget): boolean {
        return this.name === other.name && this.color === other.color && this.pos === other.pos;
    }

    toDOM(): HTMLElement {
        const wrapper = document.createElement("span");
        wrapper.className = "cm-remote-cursor";
        wrapper.style.setProperty("--cursor-color", this.color);

        // CRITICAL: Use textContent, not innerHTML, to prevent XSS (T-07.5-02)
        const label = document.createElement("span");
        label.className = "cm-remote-cursor-label";
        label.textContent = this.name;

        const caret = document.createElement("span");
        caret.className = "cm-remote-cursor-caret";

        wrapper.appendChild(label);
        wrapper.appendChild(caret);

        return wrapper;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

// ── Theme (preserved from cursors.ts) ───────────────────────────────────────

const awarenessTheme = EditorView.baseTheme({
    // Zero-width wrapper: must not contribute to line metrics or consume space.
    // Previously used inline-block + a child with height:1.1em, which inflated
    // line height and left a visible gap around the cursor.
    ".cm-remote-cursor": {
        position: "relative",
        display: "inline",
        width: "0",
    },
    ".cm-remote-cursor-caret": {
        position: "absolute",
        top: "0",
        bottom: "0",
        left: "-1px",
        width: "2px",
        backgroundColor: "var(--cursor-color)",
        pointerEvents: "none",
    },
    ".cm-remote-cursor-label": {
        position: "absolute",
        bottom: "100%",
        left: "-1px",
        padding: "1px 4px",
        fontSize: "11px",
        lineHeight: "1.4",
        borderRadius: "3px",
        backgroundColor: "var(--cursor-color)",
        color: "white",
        whiteSpace: "nowrap",
        pointerEvents: "none",
        userSelect: "none",
    },
});

// ── createAwarenessExtension ────────────────────────────────────────────────

/**
 * Create awareness extension for cursor sync.
 *
 * Per D-72: Replaces cursors.ts with awareness protocol.
 * Per D-60: Maintains Google Docs-style cursor display.
 *
 * Cursors are anchored via Yjs RelativePosition so they track correctly
 * through concurrent edits. A remote cursor at position 50 stays attached
 * to its Y.Item even when local text is inserted before it.
 *
 * @param awareness - Yjs Awareness instance (from WebsocketProvider)
 * @param ytext - Y.Text shared type for RelativePosition anchoring
 * @param localName - Local user's display name
 * @param localColor - Local user's cursor color
 */
/** Effect carrying the awareness "version" — a bumped counter that forces
 *  the cursors field to rebuild decorations against current awareness state.
 *  Using a counter (not the decoration set itself) keeps the effect payload
 *  cheap and avoids rebuilding in the effect dispatcher. */
const awarenessTickEffect = StateEffect.define<number>();

export function createAwarenessExtension(
    awareness: Awareness,
    ytext: Y.Text,
    localName: string,
    localColor: string,
    options: AwarenessExtensionOptions = {},
): Extension {
    const localColorLight = `${localColor}33`; // Transparency for selection
    const toSharedPosition = options.toSharedPosition ?? ((position: number) => position);
    const fromSharedPosition = options.fromSharedPosition ?? ((position: number) => position);
    const clearCursorOnDestroy = options.clearCursorOnDestroy ?? true;
    const broadcastInitialCursor = options.broadcastInitialCursor ?? true;

    // Set initial user state
    awareness.setLocalStateField("user", {
        name: localName,
        color: localColor,
        colorLight: localColorLight,
    });

    // Encode an absolute CodeMirror position as a RelativePosition (as number[]
    // for JSON serialization over awareness protocol).
    function encodePos(absolute: number): number[] {
        const rel = Y.createRelativePositionFromTypeIndex(ytext, absolute);
        return Array.from(Y.encodeRelativePosition(rel));
    }

    // Decode a RelativePosition back to an absolute CodeMirror position.
    // Returns null if the referenced item has been deleted.
    function decodePos(encoded: number[] | undefined): number | null {
        if (!encoded || encoded.length === 0) return null;
        const ydoc = ytext.doc;
        if (!ydoc) return null;
        try {
            const rel = Y.decodeRelativePosition(new Uint8Array(encoded));
            const abs = Y.createAbsolutePositionFromRelativePosition(rel, ydoc);
            return abs?.index ?? null;
        } catch {
            return null;
        }
    }

    function getRemoteCursors(editorState: EditorView["state"]): Array<{
        clientId: number;
        pos: number;
        name: string;
        color: string;
        ts: number;
    }> {
        const states = awareness.getStates();
        const localClientId = awareness.clientID;
        const meta = awareness.meta;

        // Dedupe by user name — stale clientIDs from recent page reloads
        // linger for ~30s before awareness GC removes them, so a single
        // user can appear as multiple active clients. Keep the most
        // recently updated entry per user.
        const byName = new Map<
            string,
            {
                clientId: number;
                pos: number;
                name: string;
                color: string;
                ts: number;
            }
        >();

        states.forEach((remoteState: AwarenessState, clientId: number) => {
            if (clientId === localClientId) return;

            const cursor = remoteState.cursor;
            const user = remoteState.user;
            if (!cursor || !user) return;

            // Resolve RelativePosition against current Y.Doc state.
            // If the referenced item is gone (text deleted), skip.
            const resolved = decodePos(cursor.headPos);
            if (resolved === null) return;

            const mapped = fromSharedPosition(resolved, editorState);
            if (mapped === null) return;

            const pos = Math.max(0, Math.min(mapped, editorState.doc.length));
            const ts = meta.get(clientId)?.lastUpdated ?? 0;
            const existing = byName.get(user.name);
            if (!existing || ts > existing.ts) {
                byName.set(user.name, {
                    clientId,
                    pos,
                    name: user.name,
                    color: user.color,
                    ts,
                });
            }
        });

        return Array.from(byName.values());
    }

    function publishPresence(): void {
        const states = awareness.getStates();
        const localClientId = awareness.clientID;
        const meta = awareness.meta;
        const byName = new Map<
            string,
            {
                clientId: number;
                name: string;
                color: string;
                cursorPos: number | null;
                lastUpdated: number;
            }
        >();

        states.forEach((state: AwarenessState, clientId: number) => {
            if (clientId === localClientId) return;
            const user = state.user;
            if (!user) return;
            const cursorPos = decodePos(state.cursor?.headPos);
            const lastUpdated = meta.get(clientId)?.lastUpdated ?? 0;
            const existing = byName.get(user.name);
            if (!existing || lastUpdated > existing.lastUpdated) {
                byName.set(user.name, {
                    clientId,
                    name: user.name,
                    color: user.color,
                    cursorPos,
                    lastUpdated,
                });
            }
        });

        const users = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
        collabPresenceUsers.set(users);
        const followed = get(followedClientId);
        if (followed !== null && !users.some((user) => user.clientId === followed)) {
            followedClientId.set(null);
        }
    }

    function buildDecorations(state: EditorView["state"]): DecorationSet {
        const cursors = getRemoteCursors(state);

        if (cursors.length === 0) return Decoration.none;

        // CRITICAL: Sort by position for RangeSetBuilder (panics on out-of-order insertion)
        cursors.sort((a, b) => a.pos - b.pos);

        const builder = new RangeSetBuilder<Decoration>();
        for (const c of cursors) {
            builder.add(
                c.pos,
                c.pos,
                Decoration.widget({
                    widget: new RemoteCursorWidget(c.name, c.color, c.pos),
                    side: 1,
                }),
            );
        }

        return builder.finish();
    }

    /** StateField owning the remote-cursor decorations. Rebuilds whenever:
     *  - the document changes (text may shift decoded positions), or
     *  - an awarenessTickEffect fires (remote awareness state changed).
     *  Using a StateField (not a ViewPlugin mutation) guarantees the CM
     *  decoration facet sees a fresh RangeSet and repaints widgets. */
    const cursorsField = StateField.define<DecorationSet>({
        create(state) {
            return buildDecorations(state);
        },
        update(value, tr) {
            // Rebuild on any doc change OR explicit awareness tick.
            if (tr.docChanged || tr.effects.some((e) => e.is(awarenessTickEffect))) {
                return buildDecorations(tr.state);
            }
            return value;
        },
        provide: (f) => EditorView.decorations.from(f),
    });

    // ── ViewPlugin handles local cursor broadcast + awareness subscription ──
    const localCursorPlugin = ViewPlugin.fromClass(
        class {
            private changeHandler: () => void;
            private lastCursorHead = -1;
            private lastCursorAnchor = -1;
            private destroyed = false;
            private tick = 0;
            private stopFollowing: (() => void) | undefined;
            /** True while we're inside our own ViewPlugin.update() — setLocalStateField
             *  fires awareness "update" synchronously and would reenter dispatch. */
            private insideUpdate = false;

            constructor(private view: EditorView) {
                this.changeHandler = () => {
                    if (this.destroyed) return;
                    publishPresence();
                    this.tick++;
                    const tick = this.tick;
                    const doDispatch = () => {
                        if (this.destroyed) return;
                        this.view.dispatch({
                            effects: awarenessTickEffect.of(tick),
                        });
                        this.scrollToFollowedCursor();
                    };
                    // Dispatch sync when safe (typical case: WebSocket message handler).
                    // Defer when we're inside an active CM transaction (our own
                    // setLocalStateField echoing back to us).
                    if (this.insideUpdate) {
                        queueMicrotask(doDispatch);
                    } else {
                        doDispatch();
                    }
                };

                // Listen to "update" not "change": y-protocols only fires "change"
                // when state differs by equalityDeep. When the remote user types at
                // end-of-doc, their encoded RelativePosition ("after end") is byte-
                // identical each keystroke, so "change" never fires and their cursor
                // appears frozen. "update" fires on every clock bump.
                awareness.on("update", this.changeHandler);
                publishPresence();

                this.stopFollowing = followedClientId.subscribe(() => {
                    if (this.destroyed) return;
                    queueMicrotask(() => this.scrollToFollowedCursor());
                });

                // Set initial cursor position.
                if (broadcastInitialCursor) {
                    this.broadcastLocalCursor(
                        view.state.selection.main.anchor,
                        view.state.selection.main.head,
                    );
                }
            }

            update(update: ViewUpdate) {
                this.insideUpdate = true;
                try {
                    // Update local cursor in awareness whenever selection OR doc
                    // changes. Doc changes matter because remote edits shift our
                    // absolute position even when we haven't moved the cursor.
                    if (update.selectionSet || update.docChanged) {
                        const head = update.state.selection.main.head;
                        const anchor = update.state.selection.main.anchor;

                        if (
                            head !== this.lastCursorHead ||
                            anchor !== this.lastCursorAnchor ||
                            update.docChanged
                        ) {
                            this.lastCursorHead = head;
                            this.lastCursorAnchor = anchor;
                            this.broadcastLocalCursor(anchor, head);
                        }
                    }
                } finally {
                    this.insideUpdate = false;
                }
            }

            private broadcastLocalCursor(anchor: number, head: number): void {
                if (!broadcastInitialCursor && !this.view.hasFocus) return;
                const sharedAnchor = toSharedPosition(anchor, this.view.state);
                const sharedHead = toSharedPosition(head, this.view.state);
                if (sharedAnchor === null || sharedHead === null) return;

                this.insideUpdate = true;
                try {
                    awareness.setLocalStateField("cursor", {
                        anchorPos: encodePos(sharedAnchor),
                        headPos: encodePos(sharedHead),
                    });
                } finally {
                    this.insideUpdate = false;
                }
            }

            private scrollToFollowedCursor(): void {
                const targetClientId = get(followedClientId);
                if (targetClientId === null) return;

                const target = getRemoteCursors(this.view.state).find(
                    (cursor) => cursor.clientId === targetClientId,
                );
                if (!target) return;

                this.view.dispatch({
                    effects: EditorView.scrollIntoView(target.pos, { y: "center" }),
                });
            }

            destroy() {
                this.destroyed = true;
                awareness.off("update", this.changeHandler);
                this.stopFollowing?.();
                // Clear local cursor state on disconnect (prevents ghost cursors).
                if (clearCursorOnDestroy) {
                    this.insideUpdate = true;
                    awareness.setLocalStateField("cursor", null);
                }
            }
        },
    );

    return [cursorsField, localCursorPlugin, awarenessTheme];
}
