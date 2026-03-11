/**
 * nestedEditor.ts — Shared utilities for nested CodeMirror editors
 * inside revision cards and modals.
 *
 * Both Revision.svelte (inline nested editor) and RevisionModal.svelte
 * (full-screen modal editor) bootstrap a secondary CodeMirror instance
 * that edits a single VersionState. This module extracts the shared
 * patterns so each component only contains its own lifecycle logic.
 */

import { EditorState } from "@codemirror/state";
import { keymap, type EditorView, type ViewUpdate } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { getExtensions, nestedSavedFields } from "$lib/editor/extensions";
import { updateRevisionVersionState } from "./annotationField";
import { versionText, type VersionState } from "./models";
import type { Annotation } from "./models";
import { annotationField } from "./annotationField";

const VERSION_PREVIEW_MAX = 34;

/**
 * Returns a configured EditorState for a version, restoring from
 * a serialised blob when available or creating a fresh state from
 * the doc text. The provided updateListener is installed so the
 * caller can react to every editor transaction.
 *
 * Nested editors have no history of their own — undo/redo is
 * delegated to the parent via makeParentUndoKeymap(). The parent
 * records every _updateRevisionVersionState blob change, so its
 * undo stack is the single source of truth for version edits.
 */
export function createVersionState(
    version: VersionState,
    updateListener: (update: ViewUpdate) => void,
    parentUndoKeymap: ReturnType<typeof makeParentUndoKeymap>,
): EditorState {
    const extensions = [
        ...getExtensions({ persist: false, history: false, updateListener }),
        parentUndoKeymap,
    ];
    return "annotationField" in version
        ? EditorState.fromJSON(version, { extensions }, nestedSavedFields)
        : EditorState.create({ doc: versionText(version), extensions });
}

/**
 * Returns a high-priority keymap that intercepts Ctrl+Z / Ctrl+Y
 * (and Mac equivalents) in the nested editor and dispatches them
 * to the parent editor instead, keeping a single undo tree.
 */
export function makeParentUndoKeymap(parentView: EditorView) {
    return keymap.of([
        {
            key: "Mod-z",
            run() {
                return undo(parentView);
            },
            preventDefault: true,
        },
        {
            key: "Mod-y",
            mac: "Mod-Shift-z",
            run() {
                return redo(parentView);
            },
            preventDefault: true,
        },
    ]);
}

/**
 * Serialises the nested editor's current state and dispatches
 * an updateRevisionVersionState effect to the parent editor,
 * keeping the annotation's version slot in sync.
 */
export function syncVersionToParent(
    nestedEditor: EditorView,
    parentView: EditorView,
    revisionId: number,
    versionId: number,
): void {
    const blob = nestedEditor.state.toJSON(nestedSavedFields) as VersionState;
    const rev = parentView.state.field(annotationField)[revisionId] as
        | Annotation<"revision">
        | undefined;
    if (!rev) return;
    parentView.dispatch(updateRevisionVersionState(parentView.state, revisionId, versionId, blob));
}

/**
 * Returns a short preview string for a version's text content,
 * suitable for labels in version pills or breadcrumb dropdowns.
 */
export function previewVersionText(version: VersionState, maxLen = VERSION_PREVIEW_MAX): string {
    const flattened = versionText(version).replace(/\s+/g, " ").trim();
    if (!flattened) return "(empty)";
    return flattened.length > maxLen ? `${flattened.slice(0, maxLen)}…` : flattened;
}
