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
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { getExtensions, savedFields } from "$lib/editor/extensions";
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
 */
export function createVersionState(
    version: VersionState,
    updateListener: (update: ViewUpdate) => void,
): EditorState {
    const extensions = getExtensions({ persist: false, updateListener });
    return "annotationField" in version
        ? EditorState.fromJSON(version, { extensions }, savedFields)
        : EditorState.create({ doc: versionText(version), extensions });
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
    const blob = nestedEditor.state.toJSON(savedFields) as VersionState;
    const rev = parentView.state.field(annotationField)[revisionId] as
        | Annotation<"revision">
        | undefined;
    if (!rev) return;
    // Preserve the existing label so syncing the editor content doesn't wipe it.
    const existingLabel = rev.versions[versionId]?.label;
    const blobWithLabel: VersionState = existingLabel !== undefined
        ? { ...blob, label: existingLabel }
        : blob;
    parentView.dispatch(updateRevisionVersionState(parentView.state, revisionId, versionId, blobWithLabel));
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
