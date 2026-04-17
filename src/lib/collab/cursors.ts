/**
 * cursors.ts -- Remote cursor StateField, ViewPlugin, WidgetType, and emit plugin for live cursor display (D-60).
 *
 * Implements Google Docs-style cursor display for remote users:
 * - StateField stores cursor positions keyed by clientID
 * - Positions are mapped through document changes automatically
 * - ViewPlugin renders colored caret + name label via Decoration.widget
 * - Emit plugin sends local cursor position to relay at throttled rate
 *
 * Key dependencies:
 *   - @codemirror/view for WidgetType, Decoration, ViewPlugin
 *   - @codemirror/state for StateField, StateEffect
 *   - socket.io-client for Socket type
 *
 * Interactions:
 *   - collabPlugin.ts installs this extension when collab is enabled
 *   - socket.ts dispatches setRemoteCursor/removeRemoteCursor effects on events
 */
import {
    type DecorationSet,
    Decoration,
    EditorView,
    ViewPlugin,
    WidgetType,
    type ViewUpdate,
} from "@codemirror/view";
import { type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { Socket } from "socket.io-client";

// ── Types ────────────────────────────────────────────────────────────────────

export type RemoteCursor = {
    clientID: string;
    pos: number;
    name: string;
    color: string;
};

// ── Color Palette ────────────────────────────────────────────────────────────

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

// ── StateEffects ─────────────────────────────────────────────────────────────

export const setRemoteCursor = StateEffect.define<RemoteCursor>();
export const removeRemoteCursor = StateEffect.define<string>(); // clientID

// ── StateField ───────────────────────────────────────────────────────────────

export const remoteCursorsField = StateField.define<Map<string, RemoteCursor>>({
    create() {
        return new Map();
    },
    update(cursors, tr) {
        let next = cursors;

        // Apply effects
        for (const effect of tr.effects) {
            if (effect.is(setRemoteCursor)) {
                next = new Map(next);
                next.set(effect.value.clientID, effect.value);
            } else if (effect.is(removeRemoteCursor)) {
                next = new Map(next);
                next.delete(effect.value);
            }
        }

        // Map positions through doc changes -- side: 1 keeps cursor after inserted text
        if (tr.docChanged && next.size > 0) {
            next = new Map(
                [...next.entries()].map(([id, cursor]) => [
                    id,
                    { ...cursor, pos: tr.changes.mapPos(cursor.pos, 1) },
                ]),
            );
        }

        return next;
    },
});

// ── RemoteCursorWidget ───────────────────────────────────────────────────────

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

        // Label above the caret (Google Docs style)
        const label = document.createElement("span");
        label.className = "cm-remote-cursor-label";
        // CRITICAL: Use textContent, not innerHTML, to prevent XSS from malicious cursor names
        label.textContent = this.name;

        // The colored caret line
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

// ── buildCursorDecorations ───────────────────────────────────────────────────

function buildCursorDecorations(view: EditorView): DecorationSet {
    const cursors = view.state.field(remoteCursorsField);
    if (cursors.size === 0) return Decoration.none;

    // CRITICAL: Sort cursors by pos before building -- RangeSetBuilder panics on out-of-order insertion
    const sortedCursors = [...cursors.values()].sort((a, b) => a.pos - b.pos);

    const builder = new RangeSetBuilder<Decoration>();
    const docLength = view.state.doc.length;

    for (const cursor of sortedCursors) {
        // CRITICAL: Clamp pos to doc.length -- remote edits can push pos past end
        const pos = Math.min(cursor.pos, docLength);
        builder.add(
            pos,
            pos,
            Decoration.widget({
                widget: new RemoteCursorWidget(cursor.name, cursor.color),
                side: 1,
            }),
        );
    }

    return builder.finish();
}

// ── remoteCursorsPlugin ViewPlugin ───────────────────────────────────────────

export const remoteCursorsPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildCursorDecorations(view);
        }

        update(update: ViewUpdate) {
            // Rebuild decorations when cursors field changes or doc changes
            // (positions may have been remapped)
            const cursorFieldChanged =
                update.state.field(remoteCursorsField) !==
                update.startState.field(remoteCursorsField);
            if (cursorFieldChanged || update.docChanged) {
                this.decorations = buildCursorDecorations(update.view);
            }
        }
    },
    {
        decorations: (v) => v.decorations,
    },
);

// ── remoteCursorTheme ────────────────────────────────────────────────────────

export const remoteCursorTheme = EditorView.baseTheme({
    ".cm-remote-cursor": {
        display: "inline-block",
        position: "relative",
    },
    ".cm-remote-cursor-caret": {
        display: "inline-block",
        width: "2px",
        height: "1.1em",
        backgroundColor: "var(--cursor-color)",
        verticalAlign: "text-bottom",
    },
    ".cm-remote-cursor-label": {
        position: "absolute",
        bottom: "100%",
        left: "0",
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

// ── createCursorEmitPlugin ───────────────────────────────────────────────────

/**
 * Creates a ViewPlugin that emits local cursor position to the relay.
 * Throttled to at most once per 100ms to avoid flooding.
 */
export function createCursorEmitPlugin(socket: Socket, name: string, color: string) {
    return ViewPlugin.fromClass(
        class {
            private lastEmittedPos = -1;
            private lastEmitTime = 0;

            update(update: ViewUpdate) {
                // Only emit when selection changed or doc changed
                if (!update.selectionSet && !update.docChanged) return;

                const pos = update.state.selection.main.head;

                // Throttle: only emit if pos changed AND 100ms has passed
                const now = Date.now();
                if (pos === this.lastEmittedPos) return;
                if (now - this.lastEmitTime < 100) return;

                this.lastEmittedPos = pos;
                this.lastEmitTime = now;

                socket.emit("cursorUpdate", { pos, name, color });
            }

            // Socket lifecycle is managed by collabPlugin -- do NOT destroy socket here
        },
    );
}

// ── createRemoteCursorsExtension ─────────────────────────────────────────────

/**
 * Main entry point: creates the full remote cursors extension stack.
 *
 * @param socket - Socket.io connection for emitting local cursor updates
 * @param name - Local user's display name
 * @param color - Local user's cursor color
 */
export function createRemoteCursorsExtension(
    socket: Socket,
    name: string,
    color: string,
): Extension[] {
    return [
        remoteCursorsField,
        remoteCursorsPlugin,
        remoteCursorTheme,
        createCursorEmitPlugin(socket, name, color),
    ];
}
