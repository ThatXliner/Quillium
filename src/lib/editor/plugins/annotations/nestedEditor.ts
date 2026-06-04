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

import { dev } from "$app/environment";
import { createAwarenessExtension } from "$lib/collab/awareness";
import { collabSession } from "$lib/collab/store";
import { getExtensions, nestedSavedFields } from "$lib/editor/extensions";
import { redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, Prec, Transaction } from "@codemirror/state";
import { type EditorView, type ViewUpdate, keymap } from "@codemirror/view";
import { get } from "svelte/store";
import {
    _nestedEditRevision,
    annotationField,
    nestedEditorEdit,
    setActiveRevisionVersion,
    updateRevisionVersionState,
} from "./annotationField";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import { type VersionState, isAnnotationOfType, versionText } from "./models";

const VERSION_PREVIEW_MAX = 34;

/**
 * Creates a nested EditorState for a revision version.
 * No local history — undo/redo delegates to the parent via makeParentUndoKeymap.
 *
 * @param historyView — the ancestor view that owns the undo history.
 *   For a level-1 nested editor this is the same as parentView (the main
 *   editor). For deeper levels (level 2+) it must be the root view that
 *   actually has history enabled, since intermediate parents have
 *   history: false.
 */
export function createNestedEditorState(
    version: VersionState,
    updateListener: (update: ViewUpdate) => void,
    parentView: EditorView,
    revisionId: number,
    historyView?: EditorView,
): EditorState {
    // Phase 10: Collab subtree bindings removed. Nested editors always use
    // local-only mode. Phase 11 will rebuild unified sync.
    const session = get(collabSession);
    const nestedAwareness =
        session === null
            ? []
            : [
                  createAwarenessExtension(
                      session.awareness,
                      session.ytext,
                      session.displayName,
                      session.cursorColor,
                      {
                          broadcastInitialCursor: false,
                          clearCursorOnDestroy: false,
                          toSharedPosition(position) {
                              const annotation =
                                  parentView.state.field(annotationField)[revisionId];
                              if (!annotation || !isAnnotationOfType(annotation, "revision")) {
                                  return null;
                              }
                              const range = annotation.selection.main;
                              return range.from + position;
                          },
                          fromSharedPosition(position) {
                              const annotation =
                                  parentView.state.field(annotationField)[revisionId];
                              if (!annotation || !isAnnotationOfType(annotation, "revision")) {
                                  return null;
                              }
                              const range = annotation.selection.main;
                              if (position < range.from || position > range.to) return null;
                              return position - range.from;
                          },
                      },
                  ),
              ];
    const extensions = [
        ...getExtensions({ persist: false, history: false, updateListener }),
        ...nestedAwareness,
        makeParentUndoKeymap(historyView ?? parentView, revisionId),
        makeParentRevisionNavKeymap(parentView, revisionId),
    ];

    if (hasSerializedNestedState(version)) {
        try {
            const docLen = version.doc.length;
            const raw = version as {
                selection?: unknown;
                annotationField?: unknown;
            };

            // EditorState.fromJSON unconditionally calls EditorSelection.fromJSON,
            // so malformed/out-of-range selections throw. Older/partial nested
            // blobs may omit selection entirely; that is fine and should quietly
            // hydrate with a cursor at 0.
            const normalizedSelection = normalizeSerializedSelection(raw.selection, docLen);

            // The annotationField blob contains nested annotation positions
            // relative to the doc at save time. If the doc was subsequently
            // updated by Phase 3 (shorter/longer), those positions may be out of
            // range and cause the decoration layer to crash at render time. Drop
            // annotationField from the blob in that case — nested annotations are
            // a nice-to-have and the doc content is still restored correctly.
            const salvaged = salvageNestedAnnotations(raw.annotationField, docLen);

            if (normalizedSelection.shouldWarn) {
                console.warn(
                    `[nestedEditor] serialized selection is out of range or malformed (docLen=${docLen}, sel=${JSON.stringify(raw.selection)}); resetting to cursor at 0`,
                );
            }
            if (salvaged.droppedCount > 0) {
                console.warn(
                    `[nestedEditor] dropped ${salvaged.droppedCount} out-of-range nested annotation(s)` +
                        ` (docLen=${docLen}); ${salvaged.keptCount} annotation(s) preserved`,
                );
            }
            const blob = {
                ...version,
                selection: normalizedSelection.selection,
                annotationField: salvaged.result,
            };
            return EditorState.fromJSON(blob, { extensions }, nestedSavedFields);
        } catch (error) {
            console.warn(
                "[nestedEditor] failed to restore serialized state, falling back to doc text",
                error,
            );
        }
    }
    return EditorState.create({ doc: versionText(version), extensions });
}

type SerializedSelection = {
    ranges: Array<{ anchor: number; head: number }>;
    main: number;
};

function cursorAtStart(): SerializedSelection {
    return { ranges: [{ anchor: 0, head: 0 }], main: 0 };
}

export function normalizeSerializedSelection(
    selection: unknown,
    docLen: number,
): { selection: SerializedSelection; shouldWarn: boolean } {
    if (selection == null) {
        return { selection: cursorAtStart(), shouldWarn: false };
    }
    if (typeof selection !== "object") {
        return { selection: cursorAtStart(), shouldWarn: true };
    }

    const sel = selection as { ranges?: unknown; main?: unknown };
    if (!Array.isArray(sel.ranges) || sel.ranges.length === 0) {
        return { selection: cursorAtStart(), shouldWarn: true };
    }

    const ranges = sel.ranges;
    const rangesValid = ranges.every((range) => {
        if (typeof range !== "object" || range == null) return false;
        const { anchor, head } = range as { anchor?: unknown; head?: unknown };
        return isValidDocPosition(anchor, docLen) && isValidDocPosition(head, docLen);
    });
    const main = sel.main === undefined ? 0 : sel.main;
    const mainValid =
        typeof main === "number" && Number.isInteger(main) && main >= 0 && main < ranges.length;

    if (!rangesValid || !mainValid) {
        return { selection: cursorAtStart(), shouldWarn: true };
    }

    return {
        selection: {
            ranges: ranges as SerializedSelection["ranges"],
            main,
        },
        shouldWarn: false,
    };
}

function isValidDocPosition(position: unknown, docLen: number): position is number {
    return (
        typeof position === "number" &&
        Number.isInteger(position) &&
        position >= 0 &&
        position <= docLen
    );
}

export function mergeNestedVersionState(
    existing: VersionState,
    nestedState: Record<string, unknown>,
): VersionState {
    const blob: Record<string, unknown> = {
        ...existing,
        annotationField: nestedState.annotationField,
    };
    if (nestedState.selection !== undefined) {
        blob.selection = nestedState.selection;
    }
    return blob as VersionState;
}

/**
 * Filters a serialized annotationField blob, keeping annotations whose
 * selections are within [0, docLen] and dropping those with out-of-range
 * positions. Returns the filtered blob (or undefined if all were dropped).
 */
function salvageNestedAnnotations(
    annotationField: unknown,
    docLen: number,
): { result: unknown; droppedCount: number; keptCount: number } {
    if (annotationField == null || typeof annotationField !== "object")
        return { result: annotationField, droppedCount: 0, keptCount: 0 };

    const entries = Object.entries(annotationField as Record<string, unknown>);
    const kept: Record<string, unknown> = {};
    let droppedCount = 0;

    for (const [key, ann] of entries) {
        // Drop entries that aren't valid annotation objects (must have
        // a selection with ranges array to be a persisted annotation).
        if (ann == null || typeof ann !== "object") {
            droppedCount++;
            continue;
        }
        const sel = (ann as { selection?: { ranges?: { anchor: number; head: number }[] } })
            .selection;
        if (!sel?.ranges) {
            droppedCount++;
            continue;
        }
        // Drop annotations with out-of-range or negative positions.
        if (
            sel.ranges.every(
                (r) => r.anchor >= 0 && r.anchor <= docLen && r.head >= 0 && r.head <= docLen,
            )
        ) {
            kept[key] = ann;
        } else {
            droppedCount++;
        }
    }

    const keptCount = Object.keys(kept).length;
    return {
        result: keptCount > 0 ? kept : undefined,
        droppedCount,
        keptCount,
    };
}

function hasSerializedNestedState(
    version: VersionState,
): version is Parameters<typeof EditorState.fromJSON>[0] {
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
    function openNestedAnnotation(type: "comment" | "revision") {
        return (view: EditorView) => {
            const sel = view.state.selection.main;
            if (sel.empty) return false;
            annotationEventBus.emit({
                type: "nested-annotation-create",
                sourceView: parentView,
                command: {
                    revisionId,
                    type,
                    selectionFrom: sel.from,
                    selectionTo: sel.to,
                },
            });
            return true;
        };
    }

    return Prec.highest(
        keymap.of([
            {
                key: "Mod-z",
                run() {
                    return undo(parentView);
                },
                preventDefault: true,
            },
            ...(dev
                ? [
                      {
                          key: "Ctrl-z",
                          run() {
                              return undo(parentView);
                          },
                          preventDefault: true,
                      },
                      {
                          key: "Meta-z",
                          run() {
                              return undo(parentView);
                          },
                          preventDefault: true,
                      },
                  ]
                : []),
            {
                key: "Mod-y",
                mac: "Mod-Shift-z",
                run() {
                    return redo(parentView);
                },
                preventDefault: true,
            },
            ...(dev
                ? [
                      {
                          key: "Ctrl-y",
                          run() {
                              return redo(parentView);
                          },
                          preventDefault: true,
                      },
                      {
                          key: "Ctrl-Shift-z",
                          run() {
                              return redo(parentView);
                          },
                          preventDefault: true,
                      },
                      {
                          key: "Meta-y",
                          run() {
                              return redo(parentView);
                          },
                          preventDefault: true,
                      },
                      {
                          key: "Meta-Shift-z",
                          run() {
                              return redo(parentView);
                          },
                          preventDefault: true,
                      },
                  ]
                : []),
            {
                key: "Mod-Enter",
                run() {
                    annotationEventBus.emit({
                        type: "annotation-add-version",
                        annotationId: revisionId,
                    });
                    return true;
                },
                preventDefault: true,
            },
            ...(dev
                ? [
                      {
                          key: "Ctrl-Enter",
                          run() {
                              annotationEventBus.emit({
                                  type: "annotation-add-version",
                                  annotationId: revisionId,
                              });
                              return true;
                          },
                          preventDefault: true,
                      },
                      {
                          key: "Meta-Enter",
                          run() {
                              annotationEventBus.emit({
                                  type: "annotation-add-version",
                                  annotationId: revisionId,
                              });
                              return true;
                          },
                          preventDefault: true,
                      },
                  ]
                : []),
            {
                key: "Mod-Alt-m",
                run: openNestedAnnotation("comment"),
                preventDefault: true,
            },
            ...(dev
                ? [
                      {
                          key: "Ctrl-Alt-m",
                          run: openNestedAnnotation("comment"),
                          preventDefault: true,
                      },
                      {
                          key: "Meta-Alt-m",
                          run: openNestedAnnotation("comment"),
                          preventDefault: true,
                      },
                  ]
                : []),
            {
                key: "Mod-Alt-k",
                run: openNestedAnnotation("revision"),
                preventDefault: true,
            },
            ...(dev
                ? [
                      {
                          key: "Ctrl-Alt-k",
                          run: openNestedAnnotation("revision"),
                          preventDefault: true,
                      },
                      {
                          key: "Meta-Alt-k",
                          run: openNestedAnnotation("revision"),
                          preventDefault: true,
                      },
                  ]
                : []),
        ]),
    );
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
    function flushNestedState(view: EditorView): void {
        const annotation = parentView.state.field(annotationField)[revisionId];
        if (!annotation || !isAnnotationOfType(annotation, "revision")) return;
        const versionIndex = annotation.activeVersionIndex;
        const existing = annotation.versions[versionIndex];
        if (!existing) return;
        const nestedState = view.state.toJSON(nestedSavedFields) as Record<string, unknown>;
        parentView.dispatch(
            updateRevisionVersionState(
                parentView.state,
                revisionId,
                versionIndex,
                mergeNestedVersionState(existing, nestedState),
                { addToHistory: false },
            ),
        );
    }

    function navigate(direction: "prev" | "next") {
        let state = parentView.state;
        const annotation = state.field(annotationField)[revisionId];
        if (!annotation || !isAnnotationOfType(annotation, "revision")) return false;
        const count = annotation.versions.length;
        if (count <= 1) return true; // consume: user intent was "navigate", no-op is correct
        const current = annotation.activeVersionIndex;
        const next = direction === "next" ? (current + 1) % count : (current - 1 + count) % count;
        state = parentView.state;
        parentView.dispatch(setActiveRevisionVersion(state, annotation.id, next));
        return true;
    }

    return keymap.of([
        {
            key: "Ctrl-[",
            run(view) {
                flushNestedState(view);
                return navigate("prev");
            },
            preventDefault: true,
        },
        {
            key: "Ctrl-]",
            run(view) {
                flushNestedState(view);
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

    // Set the parent selection inside the revision so CodeMirror's history
    // stores a cursor position within the revision range. On undo, this
    // ensures the cursor is restored inside the revision, which triggers
    // reactivation of the inline nested editor. The nested editor has focus
    // during these dispatches, so the parent cursor move is invisible.
    parentView.dispatch({
        changes: parentChanges,
        selection: EditorSelection.cursor(offset),
        effects: [_nestedEditRevision.of(revisionId)],
        annotations: [nestedEditorEdit.of(revisionId), Transaction.addToHistory.of(true)],
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
