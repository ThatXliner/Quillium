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
 *     → Phase 3 skips this revision (nestedEditorEdit suppresses it)
 *     → parent→nested ViewPlugin skips re-notifying nested editor
 *
 *   external change to parent at revision range (undo, non-atomic typing)
 *     → parent→nested ViewPlugin detects it (no nestedEditorEdit tag)
 *     → translates delta back to nested coordinates
 *     → dispatches directly to nested editor (no destroy/recreate)
 *
 *   version switch
 *     → nested editor destroyed, recreated from new VersionState blob
 *     → only case where nested editor is fully rebuilt
 *
 * Undo: Mod-z in nested editor delegates to undo(parentView) via
 * makeParentUndoKeymap. Parent undoes the doc change. Parent→nested
 * ViewPlugin patches the nested editor with the inverted delta.
 *
 * Modal close / version switch: one final updateRevisionVersionState
 * dispatch serializes the nested annotationField blob into the parent.
 * This is the only time updateRevisionVersionState is called.
 */

import { EditorState, Transaction } from "@codemirror/state";
import { undo, redo } from "@codemirror/commands";
import { keymap, type EditorView, type ViewUpdate } from "@codemirror/view";
import { getExtensions, nestedSavedFields } from "$lib/editor/extensions";
import {
    annotationField,
    bridgeDispatch,
    nestedEditorEdit,
    updateRevisionVersionState,
} from "./annotationField";
import { versionText, type VersionState } from "./models";
import type { Annotation } from "./models";

const VERSION_PREVIEW_MAX = 34;

/**
 * Creates a nested EditorState for a revision version.
 * No local history — undo/redo delegates to the parent via makeParentUndoKeymap.
 * Restores nested annotationField from the VersionState blob if present.
 */
export function createNestedEditorState(
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
 * Intercepts Mod-z / Mod-y in the nested editor and delegates
 * to the parent's undo/redo. The parent history is the single
 * undo timeline for all nested edits.
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
 * Intercepts Ctrl-[ / Ctrl-] in the nested editor and routes
 * them to the parent for version navigation.
 */
export function makeParentRevisionNavKeymap(parentView: EditorView) {
    return keymap.of([
        {
            key: "Ctrl-[",
            run() {
                // Dispatch a user event so the parent keymap handles it.
                // We just let the event bubble to the dialog/parent keydown handler.
                return false;
            },
        },
        {
            key: "Ctrl-]",
            run() {
                return false;
            },
        },
    ]);
}

/**
 * Translates a doc-changing transaction from the nested editor into
 * an equivalent change on the parent document at the revision's range,
 * then dispatches it to the parent tagged with nestedEditorEdit.
 *
 * The nested editor's own document is NOT updated here — the nested
 * editor retains its own state. The parent→nested ViewPlugin will
 * apply the inverse when needed (e.g. on undo).
 *
 * Returns true if a dispatch was made.
 */
export function translateAndDispatch(
    update: ViewUpdate,
    parentView: EditorView,
    revisionId: number,
): boolean {
    if (!update.docChanged) return false;
    // If the change was pushed down by the parent→nested bridge, don't
    // forward it back up — that would double-apply it and create a duplicate
    // history entry.
    if (update.transactions.some((tr) => tr.annotation(bridgeDispatch))) return false;

    const rev = parentView.state.field(annotationField)[revisionId] as
        | Annotation<"revision">
        | undefined;
    if (!rev) return false;

    const offset = rev.selection.main.from;

    // Collect all changes from all transactions in this update,
    // translated to parent coordinates.
    const parentChanges: { from: number; to: number; insert: string }[] = [];
    for (const tr of update.transactions) {
        if (!tr.docChanged) continue;
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            parentChanges.push({
                from: offset + fromA,
                to: offset + toA,
                insert: inserted.toString(),
            });
        });
    }

    if (parentChanges.length === 0) return false;

    parentView.dispatch({
        changes: parentChanges,
        annotations: [
            nestedEditorEdit.of(revisionId),
            Transaction.addToHistory.of(true),
        ],
    });
    return true;
}

/**
 * Serialises the nested editor's annotationField state (nested annotations
 * only — no historyField) and writes it back to the parent annotation's
 * version slot. Called once on modal close or version switch to persist
 * nested annotation structure. Uses addToHistory:false since this is
 * bookkeeping, not a user action.
 */
export function flushAnnotationsToParent(
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
    const existingLabel = rev.versions[versionId]?.label;
    const blobWithLabel: VersionState = existingLabel !== undefined
        ? { ...blob, label: existingLabel }
        : blob;
    parentView.dispatch(
        updateRevisionVersionState(parentView.state, revisionId, versionId, blobWithLabel, {
            addToHistory: false,
        }),
    );
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
