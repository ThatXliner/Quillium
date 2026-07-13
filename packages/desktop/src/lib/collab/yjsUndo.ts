import { EditorSelection, type Extension, Prec } from "@codemirror/state";
/**
 * yjsUndo.ts -- Per-user undo via Yjs UndoManager.
 *
 * Per D-74: Client-side UndoManager scoped to local changes only.
 * Per D-50: Matches existing per-user undo behavior from OT implementation.
 *
 * Key insight: UndoManager tracks changes by origin. Local changes use
 * 'local' origin (set in yjsBinding.ts), remote changes have different origins.
 *
 * Key dependencies:
 *   - yjs for Y.UndoManager
 *   - @codemirror/view for keymap integration
 *
 * Interactions:
 *   - yjsBinding.ts applies local changes with origin='local'
 *   - This module creates UndoManager that only tracks 'local' origin
 *   - Keymap intercepts Mod-z/Mod-Shift-z for undo/redo
 *   - Phase 02: paired ViewPlugin restores CM selection on undo/redo via stackItem.meta.
 */
import { type EditorView, type KeyBinding, ViewPlugin, keymap } from "@codemirror/view";
import * as Y from "yjs";

type ArrayElement<T> = T extends Array<infer Element> ? Element : never;
type UndoScopeType = ArrayElement<ConstructorParameters<typeof Y.UndoManager>[0]>;

/**
 * Create UndoManager extension for per-user undo.
 *
 * Per D-74: Only tracks local changes via trackedOrigins.
 * Per D-50: Maintains per-user undo behavior from OT implementation.
 * Per D-83: Single unified undo stack for text + annotations when ymap provided.
 *
 * @param ytext - Y.Text shared type (same instance as yjsBinding)
 * @param ymap - Optional Y.Map for annotation sync (D-83 unified undo)
 * @param extraTypes - Other shared types, such as document-level version groups
 * @returns Object containing the CodeMirror extension and UndoManager instance
 */
export function createYjsUndoExtension<T = unknown>(
    ytext: Y.Text,
    ymap?: Y.Map<T>,
    extraTypes: UndoScopeType[] = [],
): {
    extension: Extension;
    undoManager: Y.UndoManager;
} {
    // Per D-83: Track both text and annotations in unified stack when ymap provided
    const trackedTypes: UndoScopeType[] = [ytext, ...(ymap ? [ymap] : []), ...extraTypes];

    const undoManager = new Y.UndoManager(trackedTypes, {
        trackedOrigins: new Set(["local"]), // Only undo local changes (per D-74)
        captureTimeout: 500, // Merge rapid typing into single undo step
    });

    const selectionRestorePlugin = ViewPlugin.fromClass(
        class {
            private added: (event: { stackItem: { meta: Map<unknown, unknown> } }) => void;
            private popped: (event: { stackItem: { meta: Map<unknown, unknown> } }) => void;

            constructor(view: EditorView) {
                this.added = (event) => {
                    event.stackItem.meta.set("selection", view.state.selection);
                };
                this.popped = (event) => {
                    const sel = event.stackItem.meta.get("selection") as
                        | EditorSelection
                        | undefined;
                    if (!sel) return;
                    const docLen = view.state.doc.length;
                    const safe = EditorSelection.create(
                        sel.ranges.map((r) =>
                            EditorSelection.range(
                                Math.min(r.anchor, docLen),
                                Math.min(r.head, docLen),
                            ),
                        ),
                    );
                    view.dispatch({ selection: safe });
                };
                undoManager.on("stack-item-added", this.added);
                undoManager.on("stack-item-popped", this.popped);
            }

            destroy() {
                undoManager.off("stack-item-added", this.added);
                undoManager.off("stack-item-popped", this.popped);
            }
        },
    );

    const undoKeymap: KeyBinding[] = [
        {
            key: "Mod-z",
            // Always claim Mod-z in collab mode, even when the Yjs undo stack is
            // empty — otherwise CodeMirror's historyKeymap runs next and can
            // revert to the joiner's pre-connect local doc or to earlier
            // replayed-event history entries that no longer match the live doc.
            run: () => {
                if (undoManager.canUndo()) undoManager.undo();
                return true;
            },
        },
        {
            key: "Mod-Shift-z",
            run: () => {
                if (undoManager.canRedo()) undoManager.redo();
                return true;
            },
        },
        {
            // Windows/Linux alternative for redo
            key: "Mod-y",
            run: () => {
                if (undoManager.canRedo()) undoManager.redo();
                return true;
            },
        },
    ];

    return {
        // Prec.highest so Yjs undo wins over CodeMirror's historyKeymap Mod-z —
        // otherwise CM history (which may contain pre-collab events) could run
        // first and replay stale text or semantic effects into the live document.
        extension: [Prec.highest(keymap.of(undoKeymap)), selectionRestorePlugin],
        undoManager,
    };
}

/**
 * Register a subtree Y.Text with an existing UndoManager's tracked scope (D-97).
 * Idempotent — Yjs's addToScope is a no-op if the type is already tracked.
 * Registration is not retroactive: an already-populated type starts with no
 * undo item. Bootstrap writes must happen before registration or use an
 * untracked origin such as `"init"`; `"local"` after registration is a user edit.
 * Caller is responsible for calling this at nested-editor mount time; Plan 8.5c-01
 * (NestedEditorController) owns those call-sites.
 *
 * @param undoManager - The UndoManager returned by createYjsUndoExtension
 * @param subtreeYtext - The subtree Y.Text that should participate in undo
 * @param extraTypes - Optional additional types (e.g. a subtree Y.Map of child annotations)
 */
export function addSubtreeToUndoScope(
    undoManager: Y.UndoManager,
    subtreeYtext: Y.Text,
    extraTypes?: UndoScopeType[],
): void {
    const toAdd: UndoScopeType[] = [subtreeYtext, ...(extraTypes ?? [])];
    undoManager.addToScope(toAdd);
}

/**
 * Break the current UndoManager capture window so subsequent local edits
 * produce a fresh stack item. Used at modal open/close boundaries, before
 * version-creation transactions, and whenever the UX treats two rapid edits
 * as semantically distinct. Mitigates yjs#642 by ensuring capture boundaries
 * never span a structural (add/remove version) change plus a character edit.
 */
export function breakUndoCapture(undoManager: Y.UndoManager): void {
    undoManager.stopCapturing();
}
