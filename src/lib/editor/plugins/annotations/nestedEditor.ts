/**
 * nestedEditor.ts — Shared utilities for the modal CodeMirror editor
 * inside RevisionModal.svelte.
 *
 * The inline revision card uses a plain <textarea> for quick text
 * edits (see Revision.svelte and ARCHITECTURE.md §Nested Editors).
 * This file only contains what the full-screen modal needs:
 *   - createVersionState  — bootstrap a CodeMirror EditorState from a VersionState blob
 *   - syncVersionToParent — serialise modal state back to the parent annotation field
 *   - previewVersionText  — short label string for version pills / breadcrumbs
 */

import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
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
import { publishAnnotationUiEvent } from "$lib/stores";

const VERSION_PREVIEW_MAX = 34;

/**
 * Returns a configured EditorState for a version, restoring from
 * a serialised blob when available or creating a fresh state from
 * the doc text. The provided updateListener is installed so the
 * caller can react to every editor transaction.
 *
 * Used by RevisionModal.svelte. The modal has its own history and
 * undo stack; undo/redo keys are NOT delegated to the parent.
 * Version navigation shortcuts (Ctrl-[ / Ctrl-]) and Mod-Enter
 * (new version) are wired to the parent view so the modal and
 * parent stay in sync on structural changes.
 */
export function createVersionState(
    version: VersionState,
    updateListener: (update: ViewUpdate) => void,
    parentView: EditorView,
): EditorState {
    const extensions = [
        ...getExtensions({ persist: false, history: true, updateListener }),
        makeParentAddVersionKeymap(parentView),
        makeParentRevisionNavKeymap(parentView),
    ];
    return "annotationField" in version
        ? EditorState.fromJSON(version, { extensions }, nestedSavedFields)
        : EditorState.create({ doc: versionText(version), extensions });
}

/**
 * Returns a high-priority keymap that intercepts Mod+Enter in the modal
 * editor and fires the annotation-add-version event for the active revision
 * in the parent, creating a new version without inserting a newline.
 */
export function makeParentAddVersionKeymap(parentView: EditorView) {
    return Prec.highest(keymap.of([
        {
            key: "Mod-Enter",
            run() {
                const annotation = getActiveAnnotation(parentView.state, "revision");
                if (!annotation) return false;
                publishAnnotationUiEvent({
                    type: "annotation-add-version",
                    annotationId: annotation.id,
                });
                return true;
            },
            preventDefault: true,
        },
    ]));
}

export function makeParentRevisionNavKeymap(
    parentView: EditorView,
    getNestedView?: () => EditorView | undefined,
) {
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
        if (getNestedView) {
            requestAnimationFrame(() => getNestedView()?.focus());
        }
        return true;
    };
    return keymap.of([
        {
            key: "Ctrl-[",
            run() { return runNav("prev"); },
            preventDefault: true,
        },
        {
            key: "Ctrl-]",
            run() { return runNav("next"); },
            preventDefault: true,
        },
    ]);
}

/**
 * Serialises the modal editor's current state and dispatches
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

/**
 * Returns a high-priority keymap that intercepts Mod-z/y in the inline
 * nested editor, flushes its state to the parent, then delegates undo/redo
 * to the parent EditorView. No second undo stack.
 */
export function makeParentUndoKeymap(
    parentView: EditorView,
    getNestedView: () => EditorView | undefined,
    revisionId: number,
    versionIndex: number,
) {
    return Prec.highest(keymap.of([
        {
            key: "Mod-z",
            run() {
                const nv = getNestedView();
                if (nv) syncVersionToParent(nv, parentView, revisionId, versionIndex);
                undo(parentView);
                return true;
            },
            preventDefault: true,
        },
        {
            key: "Mod-y",
            mac: "Mod-Shift-z",
            run() {
                redo(parentView);
                return true;
            },
            preventDefault: true,
        },
    ]));
}

/**
 * Returns a high-priority keymap that intercepts Mod-Alt-m/k in the inline
 * nested editor and fires a revision-open-nested-editor event, which
 * Revision.svelte catches to open the full-screen modal with the pending
 * annotation command forwarded to the right position.
 *
 * This is needed because the inline editor's annotationField has no
 * Annotations.svelte panel watching it, so nested annotation creation must
 * be redirected to the modal where the full UI is available.
 */
export function makeInlineNestedAnnotationKeymap(revisionId: number) {
    const fire = (type: "comment" | "revision", view: EditorView) => {
        const sel = view.state.selection.main;
        publishAnnotationUiEvent({
            type: "revision-open-nested-editor",
            command: {
                revisionId,
                type,
                selectionFrom: sel.from,
                selectionTo: sel.to,
            },
        });
        return true;
    };
    return Prec.highest(keymap.of([
        {
            key: "Mod-Alt-m",
            run(view) { return fire("comment", view); },
            preventDefault: true,
        },
        {
            key: "Mod-Alt-k",
            run(view) { return fire("revision", view); },
            preventDefault: true,
        },
    ]));
}

/**
 * Returns a configured EditorState for use in the inline revision card editor.
 * history: false — undo/redo are delegated to the parent via makeParentUndoKeymap.
 * annotationField is included via getExtensions so nested annotations work inline.
 * Mod-Alt-k/m open the parent's full-screen modal with the pending command.
 */
export function createInlineVersionState(
    version: VersionState,
    updateListener: (update: ViewUpdate) => void,
    parentView: EditorView,
    revisionId: number,
    versionIndex: number,
    nestedViewRef: { current: EditorView | undefined },
): EditorState {
    const extensions = [
        ...getExtensions({ persist: false, history: false, updateListener }),
        makeParentUndoKeymap(parentView, () => nestedViewRef.current, revisionId, versionIndex),
        makeInlineNestedAnnotationKeymap(revisionId),
        makeParentAddVersionKeymap(parentView),
        makeParentRevisionNavKeymap(parentView, () => nestedViewRef.current),
    ];
    return "annotationField" in version
        ? EditorState.fromJSON(version, { extensions }, nestedSavedFields)
        : EditorState.create({ doc: versionText(version), extensions });
}
