/**
 * nestedEditor.ts — Shared utilities for nested CodeMirror editors
 * inside revision cards (inline) and modals.
 *
 * Architecture: the nested editor is a direct viewport onto the parent
 * document's revision range [rev.from, rev.to]. Edits in the nested
 * editor are translated to parent coordinates and dispatched to the
 * parent EditorView. The parent document is the single source of truth.
 *
 * Data flow:
 *   nested editor types
 *     → translateAndDispatch() maps change to [rev.from+delta] in parent
 *     → parent dispatch tagged nestedEditorEdit.of(revisionId)
 *     → parent history records the change (normal undo granularity)
 *     → Phase 3 syncs versions[selected].doc (needed for version switching)
 *     → selection rebuilt to cover new range (fix for initially-empty versions)
 *
 *   external change to parent at revision range (undo, non-atomic typing)
 *     → Phase 3 updates versions[selected].doc from parent slice
 *     → Svelte reactivity propagates updated activeVersion.doc to Revision.svelte
 *     → $effect in Revision.svelte patches the nested editor content
 *
 *   version switch
 *     → nested editor destroyed, recreated from new VersionState blob
 *     → only case where nested editor is fully rebuilt
 *
 * Undo: Mod-z in nested editor delegates to undo(parentView) via
 * makeParentUndoKeymap. Parent undoes the doc change. Phase 3 updates
 * versions[selected].doc. Svelte $effect patches the nested editor.
 */

import { EditorState, Prec, Transaction } from "@codemirror/state";
import { undo, redo } from "@codemirror/commands";
import { keymap, type EditorView, type ViewUpdate } from "@codemirror/view";
import { getExtensions, nestedSavedFields } from "$lib/editor/extensions";
import {
    annotationField,
    nestedEditorEdit,
    _nestedEditRevision,
    setActiveRevisionVersion,
} from "./annotationField";
import { publishAnnotationUiEvent } from "$lib/stores";
import { versionText, type VersionState, isAnnotationOfType } from "./models";

const VERSION_PREVIEW_MAX = 34;

/**
 * Creates a nested EditorState for a revision version.
 * No local history — undo/redo delegates to the parent via makeParentUndoKeymap.
 */
export function createNestedEditorState(
    version: VersionState,
    updateListener: (update: ViewUpdate) => void,
    parentView: EditorView,
    revisionId: number,
): EditorState {
    const extensions = [
        ...getExtensions({ persist: false, history: false, updateListener }),
        makeParentUndoKeymap(parentView, revisionId),
        makeParentRevisionNavKeymap(parentView, revisionId),
    ];
    if (hasSerializedNestedState(version)) {
        try {
            return EditorState.fromJSON(version, { extensions }, nestedSavedFields);
        } catch (error) {
            console.warn("[nestedEditor] failed to restore serialized state, falling back to doc text", error);
        }
    }
    return EditorState.create({ doc: versionText(version), extensions });
}

function hasSerializedNestedState(version: VersionState): version is Parameters<typeof EditorState.fromJSON>[0] {
    if (typeof version !== "object" || version === null) return false;
    if (typeof (version as { doc?: unknown }).doc !== "string") return false;
    const serialized =
        (version as { annotationField?: unknown }).annotationField !== undefined ||
        (version as { selection?: unknown }).selection !== undefined;
    return serialized;
}

/**
 * Intercepts Mod-z / Mod-y / Mod-Enter in the nested editor and
 * delegates to the parent. Mod-z/y delegate undo/redo to the parent
 * history. Mod-Enter fires "annotation-add-version" so the Revision
 * card creates a new version (same as the annotationKeymap binding in
 * the parent, which can't fire from inside the nested editor because
 * getActiveRevisionAnnotation would not find a revision in the nested
 * annotationField).
 */
export function makeParentUndoKeymap(parentView: EditorView, revisionId: number) {
    return Prec.highest(keymap.of([
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
        {
            key: "Mod-Enter",
            run() {
                publishAnnotationUiEvent({
                    type: "annotation-add-version",
                    annotationId: revisionId,
                });
                return true;
            },
            preventDefault: true,
        },
    ]));
}

/**
 * Intercepts Ctrl-[ / Ctrl-] in the nested editor and routes
 * them to the parent for version navigation.
 *
 * We dispatch directly to parentView rather than returning false and
 * relying on bubbling, because shouldHandleRevisionModalKeydown blocks
 * events originating from .cm-editor — so bubbling won't reach the
 * modal-level handler.
 */
export function makeParentRevisionNavKeymap(parentView: EditorView, revisionId: number) {
    function navigate(direction: "prev" | "next") {
        const state = parentView.state;
        const annotation = state.field(annotationField)[revisionId];
        if (!annotation || !isAnnotationOfType(annotation, "revision")) return false;
        const count = annotation.versions.length;
        if (count <= 1) return true; // consume: user intent was "navigate", no-op is correct
        const current = annotation.currentlySelected;
        const next =
            direction === "next"
                ? (current + 1) % count
                : (current - 1 + count) % count;
        parentView.dispatch(setActiveRevisionVersion(state, annotation.id, next));
        return true;
    }

    return keymap.of([
        {
            key: "Ctrl-[",
            run() {
                return navigate("prev");
            },
            preventDefault: true,
        },
        {
            key: "Ctrl-]",
            run() {
                return navigate("next");
            },
            preventDefault: true,
        },
    ]);
}

/**
 * Translates a doc-changing transaction from the nested editor into
 * an equivalent change on the parent document at the revision's range,
 * then dispatches it to the parent tagged with nestedEditorEdit.
 *
 * Returns true if a dispatch was made.
 */
export function translateAndDispatch(
    update: ViewUpdate,
    parentView: EditorView,
    revisionId: number,
): boolean {
    if (!update.docChanged) return false;

    const rev = parentView.state.field(annotationField)[revisionId] as
        | import("./models").Annotation<"revision">
        | undefined;
    if (!rev) return false;

    const offset = rev.selection.main.from;

    // Collect all changes from all transactions in this update,
    // translated to parent coordinates using update.changes (the
    // composed change set). iterChanges on the composed ChangeSet
    // gives positions relative to the pre-update doc, so adding
    // offset is correct regardless of how many transactions are batched.
    const parentChanges: { from: number; to: number; insert: string }[] = [];
    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        parentChanges.push({
            from: offset + fromA,
            to: offset + toA,
            insert: inserted.toString(),
        });
    });

    if (parentChanges.length === 0) return false;

    parentView.dispatch({
        changes: parentChanges,
        effects: [_nestedEditRevision.of(revisionId)],
        annotations: [
            nestedEditorEdit.of(revisionId),
            Transaction.addToHistory.of(true),
        ],
    });
    return true;
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
