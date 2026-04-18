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
    type DecorationSet,
    Decoration,
    EditorView,
    ViewPlugin,
    WidgetType,
    type ViewUpdate,
} from "@codemirror/view";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

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
    ) {
        super();
    }

    eq(other: RemoteCursorWidget): boolean {
        return this.name === other.name && this.color === other.color;
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
export function createAwarenessExtension(
    awareness: Awareness,
    ytext: Y.Text,
    localName: string,
    localColor: string,
): Extension {
    const localColorLight = localColor + "33"; // Transparency for selection

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

    const plugin = ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            private changeHandler: () => void;
            private lastCursorHead = -1;
            private lastCursorAnchor = -1;
            private destroyed = false;
            private updating = false;

            constructor(private view: EditorView) {
                this.decorations = this.buildDecorations();

                this.changeHandler = () => {
                    if (this.destroyed) return;
                    this.decorations = this.buildDecorations();
                    // Dispatch synchronously when possible for real-time feel.
                    // We only defer when awareness fires during our own CM update
                    // (from setLocalStateField in update()), since dispatching
                    // while an update is in progress throws.
                    if (this.updating) {
                        queueMicrotask(() => {
                            if (!this.destroyed) this.view.dispatch({});
                        });
                    } else {
                        this.view.dispatch({});
                    }
                };

                awareness.on("change", this.changeHandler);

                // Set initial cursor position. Constructor runs during CM's
                // init update, so guard against re-entrant dispatch.
                this.updating = true;
                try {
                    const head = view.state.selection.main.head;
                    const anchor = view.state.selection.main.anchor;
                    awareness.setLocalStateField("cursor", {
                        anchorPos: encodePos(anchor),
                        headPos: encodePos(head),
                    });
                    this.lastCursorHead = head;
                    this.lastCursorAnchor = anchor;
                } finally {
                    this.updating = false;
                }
            }

            update(update: ViewUpdate) {
                this.updating = true;
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
                            awareness.setLocalStateField("cursor", {
                                anchorPos: encodePos(anchor),
                                headPos: encodePos(head),
                            });
                        }
                    }

                    // Rebuild decorations if doc changed (remote cursor positions
                    // need re-resolution against the new doc state).
                    if (update.docChanged) {
                        this.decorations = this.buildDecorations();
                    }
                } finally {
                    this.updating = false;
                }
            }

            private buildDecorations(): DecorationSet {
                const states = awareness.getStates();
                const localClientId = awareness.clientID;
                const docLength = this.view.state.doc.length;
                const meta = awareness.meta;

                // Dedupe by user name — stale clientIDs from recent page reloads
                // linger for ~30s before awareness GC removes them, so a single
                // user can appear as multiple active clients. Keep the most
                // recently updated entry per user.
                const byName = new Map<
                    string,
                    { pos: number; name: string; color: string; ts: number }
                >();

                states.forEach((state: AwarenessState, clientId: number) => {
                    if (clientId === localClientId) return;

                    const cursor = state.cursor;
                    const user = state.user;
                    if (!cursor || !user) return;

                    // Resolve RelativePosition against current Y.Doc state.
                    // If the referenced item is gone (text deleted), skip.
                    const resolved = decodePos(cursor.headPos);
                    if (resolved === null) return;

                    const pos = Math.max(0, Math.min(resolved, docLength));
                    const ts = meta.get(clientId)?.lastUpdated ?? 0;
                    const existing = byName.get(user.name);
                    if (!existing || ts > existing.ts) {
                        byName.set(user.name, { pos, name: user.name, color: user.color, ts });
                    }
                });

                const cursors = Array.from(byName.values());

                if (cursors.length === 0) return Decoration.none;

                // CRITICAL: Sort by position for RangeSetBuilder (panics on out-of-order insertion)
                cursors.sort((a, b) => a.pos - b.pos);

                const builder = new RangeSetBuilder<Decoration>();
                for (const c of cursors) {
                    builder.add(
                        c.pos,
                        c.pos,
                        Decoration.widget({
                            widget: new RemoteCursorWidget(c.name, c.color),
                            side: 1,
                        }),
                    );
                }

                return builder.finish();
            }

            destroy() {
                this.destroyed = true;
                awareness.off("change", this.changeHandler);
                // Clear local cursor state on disconnect (prevents ghost cursors).
                // destroyed=true above prevents any queued dispatch from firing.
                this.updating = true;
                awareness.setLocalStateField("cursor", null);
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );

    return [plugin, awarenessTheme];
}
