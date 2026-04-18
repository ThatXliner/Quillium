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

// ── Types ────────────────────────────────────────────────────────────────────

export interface AwarenessUserState {
    name: string;
    color: string;
    colorLight: string;
}

export interface AwarenessCursorState {
    anchor: number;
    head: number;
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

// ── createAwarenessExtension ────────────────────────────────────────────────

/**
 * Create awareness extension for cursor sync.
 *
 * Per D-72: Replaces cursors.ts with awareness protocol.
 * Per D-60: Maintains Google Docs-style cursor display.
 *
 * @param awareness - Yjs Awareness instance (from WebsocketProvider)
 * @param localName - Local user's display name
 * @param localColor - Local user's cursor color
 */
export function createAwarenessExtension(
    awareness: Awareness,
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

    const plugin = ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            private changeHandler: () => void;
            private lastCursorHead = -1;
            private lastCursorAnchor = -1;

            constructor(private view: EditorView) {
                this.decorations = this.buildDecorations();

                this.changeHandler = () => {
                    this.decorations = this.buildDecorations();
                    // Request a view update to apply new decorations
                    this.view.requestMeasure();
                };

                awareness.on("change", this.changeHandler);

                // Set initial cursor position
                const head = view.state.selection.main.head;
                const anchor = view.state.selection.main.anchor;
                awareness.setLocalStateField("cursor", { anchor, head });
                this.lastCursorHead = head;
                this.lastCursorAnchor = anchor;
            }

            update(update: ViewUpdate) {
                // Update local cursor in awareness
                if (update.selectionSet || update.docChanged) {
                    const head = update.state.selection.main.head;
                    const anchor = update.state.selection.main.anchor;

                    if (head !== this.lastCursorHead || anchor !== this.lastCursorAnchor) {
                        this.lastCursorHead = head;
                        this.lastCursorAnchor = anchor;
                        awareness.setLocalStateField("cursor", { anchor, head });
                    }
                }

                // Rebuild decorations if doc changed (positions may need clamping)
                if (update.docChanged) {
                    this.decorations = this.buildDecorations();
                }
            }

            private buildDecorations(): DecorationSet {
                const states = awareness.getStates();
                const localClientId = awareness.clientID;
                const docLength = this.view.state.doc.length;

                const cursors: { pos: number; name: string; color: string }[] = [];

                states.forEach((state: AwarenessState, clientId: number) => {
                    // Skip local cursor (we don't show our own cursor as remote)
                    if (clientId === localClientId) return;

                    const cursor = state.cursor;
                    const user = state.user;

                    if (cursor && user) {
                        // CRITICAL: Clamp position to document length (remote edits can push pos past end)
                        const pos = Math.min(cursor.head, docLength);
                        cursors.push({
                            pos,
                            name: user.name,
                            color: user.color,
                        });
                    }
                });

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
                awareness.off("change", this.changeHandler);
                // Clear local cursor state on disconnect (prevents ghost cursors)
                awareness.setLocalStateField("cursor", null);
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );

    return [plugin, awarenessTheme];
}
