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
 */
import { keymap, type KeyBinding } from "@codemirror/view";
import * as Y from "yjs";
import type { Extension } from "@codemirror/state";

/**
 * Create UndoManager extension for per-user undo.
 *
 * Per D-74: Only tracks local changes via trackedOrigins.
 * Per D-50: Maintains per-user undo behavior from OT implementation.
 * Per D-83: Single unified undo stack for text + annotations when ymap provided.
 *
 * @param ytext - Y.Text shared type (same instance as yjsBinding)
 * @param ymap - Optional Y.Map for annotation sync (D-83 unified undo)
 * @returns Object containing the CodeMirror extension and UndoManager instance
 */
export function createYjsUndoExtension<T = unknown>(
    ytext: Y.Text,
    ymap?: Y.Map<T>,
): {
    extension: Extension;
    undoManager: Y.UndoManager;
} {
    // Per D-83: Track both text and annotations in unified stack when ymap provided
    const trackedTypes: (Y.Text | Y.Map<T>)[] = ymap ? [ytext, ymap] : [ytext];

    const undoManager = new Y.UndoManager(trackedTypes, {
        trackedOrigins: new Set(["local"]), // Only undo local changes (per D-74)
        captureTimeout: 500, // Merge rapid typing into single undo step
    });

    const undoKeymap: KeyBinding[] = [
        {
            key: "Mod-z",
            run: () => {
                if (undoManager.canUndo()) {
                    undoManager.undo();
                    return true;
                }
                return false;
            },
        },
        {
            key: "Mod-Shift-z",
            run: () => {
                if (undoManager.canRedo()) {
                    undoManager.redo();
                    return true;
                }
                return false;
            },
        },
        {
            // Windows/Linux alternative for redo
            key: "Mod-y",
            run: () => {
                if (undoManager.canRedo()) {
                    undoManager.redo();
                    return true;
                }
                return false;
            },
        },
    ];

    return {
        extension: keymap.of(undoKeymap),
        undoManager,
    };
}

/**
 * Register a subtree Y.Text with an existing UndoManager's tracked scope (D-97).
 * Idempotent — Yjs's addToScope is a no-op if the type is already tracked.
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
    extraTypes?: Y.AbstractType<unknown>[],
): void {
    // Cast required because Y.Text's internal event handler type is more specific
    // than AbstractType<unknown>, but addToScope accepts any AbstractType.
    const toAdd = [subtreeYtext as Y.AbstractType<unknown>, ...(extraTypes ?? [])];
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
