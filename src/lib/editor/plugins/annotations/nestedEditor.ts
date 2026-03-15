/**
 * nestedEditor.ts — Shared utilities for nested CodeMirror editors
 * inside revision cards (inline) and modals.
 *
 * Architecture: the nested editor is a stateless viewport onto the
 * parent document's revision range [rev.from, rev.to]. The parent
 * document is the single source of truth; the nested editor owns no
 * history and no persistent state of its own.
 *
 * Data flow:
 *
 *   User types in nested editor:
 *     → dispatchTransactions intercepts, translates to parent coords
 *     → plain dispatch to parentView (no special annotation needed)
 *     → parent history records the change (normal undo granularity)
 *     → deferred microtask: nested view receives _sliceBridgeDispatch
 *       to replace its doc with the updated parent slice
 *
 *   External change to parent at revision range (undo, redo, main-doc typing):
 *     → nestedEditorListenerPlugin (in parent's extension stack via annotations())
 *       invokes the registered parentDocListener for each nested editor
 *     → deferred microtask: nested view receives _sliceBridgeDispatch
 *
 *   Version switch:
 *     → nested editor destroyed via destroySliceEditor(), recreated for new VersionState
 *     → only case where nested editor is fully rebuilt
 *
 * Undo: Mod-z in nested editor delegates to undo(parentView) via
 * makeParentUndoKeymap. Parent undoes the doc change. The parentDocListener
 * detects the change and syncs the nested view.
 *
 * Sub-annotations: the nested updateListener flushes the nested annotationField
 * to the parent VersionState whenever it changes, using addToHistory:false.
 * destroySliceEditor does a final explicit flush to cover any race between
 * the last user action and the destroy call.
 */

import { Annotation, EditorSelection, EditorState, Prec, Transaction } from "@codemirror/state";
import { undo, redo } from "@codemirror/commands";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getExtensions } from "$lib/editor/extensions";
import {
    annotationField,
    addAnnotation,
    removeAnnotation,
    updateRevisionVersionState,
    setActiveRevisionVersion,
    revisionInternalEdit,
} from "./annotationField";
import { isEqual } from "lodash-es";
import { publishAnnotationUiEvent } from "$lib/stores";
import { versionText, type VersionState, isAnnotationOfType } from "./models";
import type { Annotation as AnnotationType } from "./models";

const VERSION_PREVIEW_MAX = 34;

/**
 * Internal annotation that marks a transaction dispatched back to the
 * nested editor by the sync machinery. dispatchTransactions checks for
 * this and applies the transaction locally without forwarding to the parent.
 */
const _sliceBridgeDispatch = Annotation.define<true>();

// ── Parent-doc listener registry ─────────────────────────────────────────────
//
// A module-level WeakMap from EditorView → Set<callback>. The
// nestedEditorListenerPlugin (added to the parent via annotations()) invokes
// all registered callbacks on every doc-changing parent transaction. This lets
// nested editors observe parent changes without modifying the parent's
// extension stack post-construction.

type ParentDocListener = (update: ViewUpdate) => void;
const _nestedSyncCallbacks = new WeakMap<EditorView, Set<ParentDocListener>>();

/**
 * ViewPlugin for the parent editor's extension stack (added via annotations()).
 * Invokes all nested-editor sync callbacks on every doc-changing update.
 */
export const nestedEditorListenerPlugin = ViewPlugin.fromClass(
    class {
        update(update: ViewUpdate) {
            if (!update.docChanged) return;
            const callbacks = _nestedSyncCallbacks.get(update.view);
            if (callbacks) {
                for (const cb of callbacks) cb(update);
            }
        }
    },
);

// ── Sub-annotation flush ──────────────────────────────────────────────────────

/**
 * Flush the nested editor's annotationField state back into the
 * parent's VersionState for the given revision/version slot.
 * Uses addToHistory:false so it creates no undo entry.
 */
function flushSubAnnotations(
    nestedEditor: EditorView,
    parentView: EditorView,
    revisionId: number,
): void {
    const rev = parentView.state.field(annotationField)[revisionId] as
        | AnnotationType<"revision">
        | undefined;
    if (!rev) return;
    const versionId = rev.currentlySelected;
    const blob = nestedEditor.state.toJSON({ annotationField }) as VersionState;
    const existingLabel = rev.versions[versionId]?.label;
    const blobWithLabel: VersionState =
        existingLabel !== undefined ? { ...blob, label: existingLabel } : blob;
    parentView.dispatch(
        updateRevisionVersionState(parentView.state, revisionId, versionId, blobWithLabel, {
            addToHistory: false,
        }),
    );
}

// ── Slice editor ──────────────────────────────────────────────────────────────

// WeakMap to store each nested view's parent-listener unregister function,
// so destroySliceEditor can clean it up.
const _unregisterMap = new WeakMap<EditorView, () => void>();

/**
 * Creates a slice editor — a nested EditorView that is a stateless viewport
 * onto parentView's revision range. All doc changes are forwarded to parentView;
 * the nested view is kept in sync with the parent slice via deferred microtasks.
 *
 * The caller owns the returned EditorView and must call destroySliceEditor()
 * when done (not editor.destroy() directly).
 */
export function createSliceEditor(
    revisionId: number,
    parentView: EditorView,
    version: VersionState,
    parent: HTMLElement,
    updateListener: (update: ViewUpdate) => void,
): EditorView {
    // ── Sync helper ───────────────────────────────────────────────────────────
    //
    // Schedules a deferred dispatch to replace the nested view's doc with the
    // current parent slice. Must always be deferred (microtask) because:
    //   - dispatchTransactions cannot call nestedView.dispatch() synchronously
    //     (would re-enter dispatchTransactions)
    //   - ViewPlugin.update() cannot dispatch synchronously
    //
    // targetCursor: desired cursor in nested coordinates; null = keep existing
    // cursor, clamped to new doc length.
    let syncPending = false;
    function scheduleSyncFromParent(targetCursor: number | null = null) {
        if (syncPending) return;
        syncPending = true;
        Promise.resolve().then(() => {
            syncPending = false;
            const rev = parentView.state.field(annotationField)[revisionId] as
                | AnnotationType<"revision">
                | undefined;
            if (!rev) return;
            const parentSlice = parentView.state.doc.sliceString(
                rev.selection.main.from,
                rev.selection.main.to,
            );
            if (parentSlice === nestedView.state.doc.toString()) return;
            const rawCursor = targetCursor ?? nestedView.state.selection.main.head;
            const cursor = Math.min(rawCursor, parentSlice.length);
            nestedView.dispatch({
                changes: { from: 0, to: nestedView.state.doc.length, insert: parentSlice },
                selection: EditorSelection.cursor(cursor),
                annotations: [_sliceBridgeDispatch.of(true)],
            });
        });
    }

    // ── Parent-doc listener ───────────────────────────────────────────────────
    //
    // Called by nestedEditorListenerPlugin whenever the parent doc changes.
    const parentDocListener: ParentDocListener = () => {
        scheduleSyncFromParent(null);
    };
    if (!_nestedSyncCallbacks.has(parentView)) {
        _nestedSyncCallbacks.set(parentView, new Set());
    }
    _nestedSyncCallbacks.get(parentView)!.add(parentDocListener);
    const unregister = () => _nestedSyncCallbacks.get(parentView)?.delete(parentDocListener);

    // ── Extensions ───────────────────────────────────────────────────────────
    const nestedUpdateListener = (update: ViewUpdate) => {
        updateListener(update);
        // Flush sub-annotations when nested state changed, skip bridge dispatches
        const nestedAnnotationsChanged =
            !isEqual(
                update.startState.field(annotationField),
                update.state.field(annotationField),
            ) ||
            update.transactions.some((tr) =>
                tr.effects.some((e) => e.is(addAnnotation) || e.is(removeAnnotation)),
            );
        if (update.docChanged || nestedAnnotationsChanged) {
            if (!update.transactions.some((tr) => tr.annotation(_sliceBridgeDispatch))) {
                flushSubAnnotations(update.view, parentView, revisionId);
            }
        }
    };

    const extensions = [
        ...getExtensions({ persist: false, history: false, updateListener: nestedUpdateListener }),
        makeParentUndoKeymap(parentView, revisionId),
        makeParentRevisionNavKeymap(parentView, revisionId),
    ];

    // Restore nested annotationField from VersionState blob if present
    const initialState =
        "annotationField" in version
            ? EditorState.fromJSON(version, { extensions }, { annotationField })
            : EditorState.create({ doc: versionText(version), extensions });

    const nestedView = new EditorView({
        state: initialState,
        parent,
        dispatchTransactions(trs) {
            // Bridge dispatches: apply locally only (came from sync machinery)
            if (trs.some((tr) => tr.annotation(_sliceBridgeDispatch))) {
                nestedView.update(trs);
                return;
            }

            const anyDocChanged = trs.some((tr) => tr.docChanged);

            if (anyDocChanged) {
                const rev = parentView.state.field(annotationField)[revisionId] as
                    | AnnotationType<"revision">
                    | undefined;
                if (rev) {
                    const offset = rev.selection.main.from;
                    const parentChanges: { from: number; to: number; insert: string }[] = [];
                    let finalNestedHead = nestedView.state.selection.main.head;
                    for (const tr of trs) {
                        if (!tr.docChanged) continue;
                        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                            parentChanges.push({
                                from: offset + fromA,
                                to: offset + toA,
                                insert: inserted.toString(),
                            });
                        });
                        finalNestedHead = tr.state.selection.main.head;
                    }
                    if (parentChanges.length > 0) {
                        // Pre-schedule the sync with the intended cursor position.
                        // The parentDocListener's scheduleSyncFromParent(null) call
                        // (fired by nestedEditorListenerPlugin after the dispatch
                        // below) will be a no-op because syncPending is already true.
                        scheduleSyncFromParent(finalNestedHead);
                        parentView.dispatch({
                            changes: parentChanges,
                            annotations: [Transaction.addToHistory.of(true)],
                        });
                        return;
                    }
                }
            }

            // Non-doc transactions (selection, effects): apply locally only
            nestedView.update(trs);
        },
    });

    _unregisterMap.set(nestedView, unregister);
    return nestedView;
}

/**
 * Destroys a slice editor: flushes sub-annotations, removes the
 * parent-doc listener, then destroys the view.
 */
export function destroySliceEditor(
    nestedEditor: EditorView,
    parentView: EditorView,
    revisionId: number,
): void {
    _unregisterMap.get(nestedEditor)?.();
    _unregisterMap.delete(nestedEditor);
    flushSubAnnotations(nestedEditor, parentView, revisionId);
    nestedEditor.destroy();
}

// ── Keymaps ───────────────────────────────────────────────────────────────────

/**
 * Intercepts Mod-z / Mod-y / Mod-Enter in the nested editor and
 * delegates to the parent. Mod-z/y delegate undo/redo to the parent
 * history. Mod-Enter fires "annotation-add-version" so the Revision
 * card creates a new version.
 */
export function makeParentUndoKeymap(parentView: EditorView, revisionId: number) {
    return Prec.highest(
        keymap.of([
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
        ]),
    );
}

/**
 * Intercepts Ctrl-[ / Ctrl-] in the nested editor and routes
 * them to the parent for version navigation.
 */
export function makeParentRevisionNavKeymap(parentView: EditorView, revisionId: number) {
    function navigate(direction: "prev" | "next") {
        const state = parentView.state;
        const annotation = state.field(annotationField)[revisionId];
        if (!annotation || !isAnnotationOfType(annotation, "revision")) return false;
        const count = annotation.versions.length;
        if (count <= 1) return false;
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
 * Returns a short preview string for a version's text content,
 * suitable for labels in version pills or breadcrumb dropdowns.
 */
export function previewVersionText(version: VersionState, maxLen = VERSION_PREVIEW_MAX): string {
    const flattened = versionText(version).replace(/\s+/g, " ").trim();
    if (!flattened) return "(empty)";
    return flattened.length > maxLen ? `${flattened.slice(0, maxLen)}…` : flattened;
}
