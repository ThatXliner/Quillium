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
import {
    setActiveRevisionVersion,
    updateRevisionVersionState,
} from "./annotationField";
import { versionText, type VersionState } from "./models";
import type { Annotation } from "./models";
import { annotationField } from "./annotationField";
import { getActiveAnnotation } from "./utils";

const VERSION_PREVIEW_MAX = 34;

/**
 * Returns a configured EditorState for a version, restoring from
 * a serialised blob when available or creating a fresh state from
 * the doc text. The provided updateListener is installed so the
 * caller can react to every editor transaction.
 *
 * Nested editors have no history of their own — undo/redo is
 * delegated to the parent via makeParentUndoKeymap(), and version
 * navigation shortcuts (Ctrl-[ / Ctrl-]) are rerouted to the parent
 * so a single undo tree and active version index stay in sync.
 */
export function createVersionState(
    version: VersionState,
    updateListener: (update: ViewUpdate) => void,
    parentView: EditorView,
): EditorState {
    const extensions = [
        ...getExtensions({ persist: false, history: false, updateListener }),
        makeParentUndoKeymap(parentView),
        makeParentRevisionNavKeymap(parentView),
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

export function makeParentRevisionNavKeymap(parentView: EditorView) {
    const runNav = (direction: "prev" | "next") => {
        const annotation = getActiveAnnotation(parentView.state, "revision");
        if (!annotation) return false;
        const count = annotation.versions.length;
        if (count <= 1) return true;
        const current = annotation.currentlySelected;
        const next = direction === "next"
            ? (current + 1) % count
            : (current - 1 + count) % count;
        parentView.dispatch(setActiveRevisionVersion(parentView.state, annotation.id, next));
        return true;
    };
    return keymap.of([
        {
            key: "Ctrl-[",
            run() {
                return runNav("prev");
            },
            preventDefault: true,
        },
        {
            key: "Ctrl-]",
            run() {
                return runNav("next");
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
