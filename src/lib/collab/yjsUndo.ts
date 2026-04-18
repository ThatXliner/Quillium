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
