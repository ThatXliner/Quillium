/**
 * index.ts — Annotation plugin entry point, commands, and
 * decorations
 *
 * This file wires together the annotation subsystem into a
 * single CodeMirror extension bundle. It is the public API
 * surface for the annotation system.
 *
 * Role in the annotation subsystem:
 *   - Re-exports everything from annotationField.ts and
 *     models.ts so consumers only need to import from here.
 *   - Defines the keymap (annotationKeymap) for creating
 *     comments, revisions, and suggestions via keyboard
 *     shortcuts.
 *   - Implements ViewPlugins for:
 *       * annotationDecorations — renders highlight marks
 *         for comments, revisions, and suggestions (active
 *         vs inactive styling).
 *       * revisionAtomicRanges — makes revision ranges
 *         behave as atomic units for cursor movement.
 *       * collapsedRevisionResolver — auto-switches or
 *         removes revisions whose text is fully deleted.
 *   - Provides public factory functions (createComment,
 *     createSuggestion, createRevision) used by the AI
 *     sidebar to programmatically add annotations.
 *   - Contains inline diff utilities (tokenize, diffTokens)
 *     and the SuggestionDiffWidget for rendering suggestion
 *     previews.
 *
 * Key dependencies:
 *   - @codemirror/state for StateCommand, Transaction,
 *     EditorSelection, RangeSetBuilder, etc.
 *   - @codemirror/view for Decoration, ViewPlugin,
 *     WidgetType, keymap.
 *   - @codemirror/search for SearchCursor (text-based
 *     annotation targeting).
 *   - ./annotationField for the StateField and effects.
 *   - ./models for type definitions and factory helpers.
 *   - ./utils for cursor query helpers.
 *   - $lib/stores for nested-editor communication stores.
 *
 * Interactions:
 *   - Editor.svelte imports annotations() to install the
 *     full extension bundle.
 *   - AISidebar.svelte calls createComment/createSuggestion/
 *     createRevision to add AI-generated annotations.
 *   - Svelte annotation components read annotationField
 *     (via stores) to render the annotation panel.
 */

import { SearchCursor } from "@codemirror/search";
import {
    EditorSelection,
    Prec,
    RangeSet,
    RangeSetBuilder,
    type SelectionRange,
    type StateCommand,
    Transaction,
    type Text,
    type EditorState,
} from "@codemirror/state";
// All this plugin does is
// Highlight text and store which selections (including sub-selections)
// were highlighted. Users of this plugin can provide
// update handlers via Facets.
import {
    Decoration,
    type DecorationSet,
    EditorView,
    keymap,
    type KeyBinding,
    ViewPlugin,
    type ViewUpdate,
} from "@codemirror/view";
import { tokenize, diffTokens, SuggestionDiffWidget } from "./diff";
export type { DiffOp } from "./diff";
export { tokenize, diffTokens } from "./diff";

import { filter, flatMap, isEqual } from "lodash-es";
import {
    type AnnotationType,
    type VersionState,
    createNewAnnotation,
    isAnnotationOfType,
} from "./models";
import { canCreateNewComment, getActiveAnnotation } from "./utils";
import {
    annotationField,
    addAnnotation,
    revisionInternalEdit,
    removeAnnotation,
    invertedAnnotationFieldEffects,
    suggestionPreviewField,
    _revisionCleanup,
    setActiveRevisionVersion,
} from "./annotationField";
import type { NestedEditorCommand } from "$lib/stores";
import { annotationEventBus } from "./eventBus";
import { appSettings } from "$lib/settings.svelte";
import { nestedEditorEdit } from "./annotationField";

export * from "./annotationField";
// Detects whether the annotation map changed between the
// previous and current editor state. Used by ViewPlugins to
// decide whether to rebuild decorations. Checks both deep
// equality of the annotation map and the presence of
// add/remove effects (which may not yet be reflected in the
// field value during the same update cycle).
export const annotationsChanged = (update: ViewUpdate) =>
    !isEqual(update.startState.field(annotationField), update.state.field(annotationField)) ||
    update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(addAnnotation) || e.is(removeAnnotation)),
    );

function findRevisionAtBoundary(
    state: EditorState,
    position: number,
    direction: "backward" | "forward",
) {
    const annotations = Object.values(state.field(annotationField));
    return annotations.find((annotation) => {
        if (!isAnnotationOfType(annotation, "revision")) return false;
        const { from, to } = annotation.selection.main;
        if (from === to) return false;
        return direction === "backward" ? to === position : from === position;
    });
}

function deleteAdjacentRevision(direction: "backward" | "forward"): StateCommand {
    return ({ state, dispatch }) => {
        const cursor = state.selection.main;
        if (!cursor.empty) return false;
        const target = findRevisionAtBoundary(state, cursor.from, direction);
        if (!target) return false;

        dispatch(
            state.update({
                changes: state.changes({
                    from: target.selection.main.from,
                    to: target.selection.main.to,
                    insert: "",
                }),
                effects: [removeAnnotation.of(target)],
                annotations: [revisionInternalEdit.of(true), Transaction.addToHistory.of(true)],
            }),
        );
        return true;
    };
}

// Returns the active revision annotation if the cursor is at one of its
// content boundaries (first or last character position), null otherwise.
function getRevisionAtContentBoundary(state: EditorState, direction: "backward" | "forward") {
    const cursor = state.selection.main;
    if (!cursor.empty) return null;
    for (const annotation of Object.values(state.field(annotationField))) {
        if (!isAnnotationOfType(annotation, "revision")) continue;
        const { from, to } = annotation.selection.main;
        if (from === to) continue;
        // Cursor is inside this revision range
        if (cursor.from < from || cursor.from > to) continue;
        if (direction === "backward" && cursor.from === from) return annotation;
        if (direction === "forward" && cursor.from === to) return annotation;
    }
    return null;
}

function nudgeBoundary(direction: "backward" | "forward"): StateCommand {
    return ({ state }) => {
        const target = getRevisionAtContentBoundary(state, direction);
        if (!target) return false;
        // Fire the nudge — the Revision card will show the hint.
        annotationEventBus.emit({
            type: "revision-boundary-nudge",
            revisionId: target.id,
        });
        return false; // don't consume — let normal backspace/delete run
    };
}

// Returns the revision whose range contains the cursor, if any.
function getActiveRevisionRange(state: EditorState): SelectionRange | null {
    const cursor = state.selection.main;
    for (const annotation of Object.values(state.field(annotationField))) {
        if (!isAnnotationOfType(annotation, "revision")) continue;
        const { from, to } = annotation.selection.main;
        if (from === to) continue;
        if (cursor.from >= from && cursor.to <= to) return annotation.selection.main;
    }
    return null;
}

// Returns the revision annotation whose range contains the cursor, if any.
function getActiveRevisionAnnotation(state: EditorState) {
    const cursor = state.selection.main;
    for (const annotation of Object.values(state.field(annotationField))) {
        if (!isAnnotationOfType(annotation, "revision")) continue;
        const { from, to } = annotation.selection.main;
        if (from === to) continue;
        if (cursor.from >= from && cursor.to <= to) return annotation;
    }
    return null;
}

// Intercepts comment/revision creation commands when the cursor is inside
// an active revision — maps the selection to revision-relative offsets and
// signals the nested editor to open and run the equivalent command there.
function redirectToNestedEditor(type: NestedEditorCommand["type"]): StateCommand {
    return (view) => {
        if (!appSettings.atomicRevisions) return false;
        // When inline nested editors are enabled, annotation creation
        // should happen directly in the main editor — no modal redirect.
        // The modal path is only for commands inside a nested editor
        // (handled by makeParentUndoKeymap in nestedEditor.ts).
        if (appSettings.showNestedEditor) return false;
        const activeRevision = getActiveRevisionAnnotation(view.state);
        if (!activeRevision) return false; // fall through to original keymap
        const revFrom = activeRevision.selection.main.from;
        const sel = view.state.selection.main;
        annotationEventBus.emit({
            type: "revision-request-modal",
            command: {
                revisionId: activeRevision.id,
                type,
                selectionFrom: sel.from - revFrom,
                selectionTo: sel.to - revFrom,
            },
        });
        return true;
    };
}

// -------------------------------------------------------
// revisionAtomicRanges ViewPlugin
//
// Makes each revision's text range behave as a single
// atomic unit for cursor navigation. The cursor jumps over
// the entire revision range rather than stepping through
// individual characters. Ranges are rebuilt whenever the
// document or annotations change.
//
// Provides: EditorView.atomicRanges
// -------------------------------------------------------
function buildAtomicRanges(state: EditorState): DecorationSet {
    if (!appSettings.atomicRevisions) return Decoration.none;
    const builder = new RangeSetBuilder<Decoration>();
    const revisions = Object.values(state.field(annotationField))
        .filter((annotation) => isAnnotationOfType(annotation, "revision"))
        .sort((a, b) => a.selection.main.from - b.selection.main.from);
    for (const revision of revisions) {
        const { from, to } = revision.selection.main;
        if (from === to) continue;
        builder.add(from, to, Decoration.mark({}));
    }
    return builder.finish();
}

const revisionAtomicRanges = EditorView.atomicRanges.of((view) => buildAtomicRanges(view.state));

// -------------------------------------------------------
// collapsedRevisionResolver ViewPlugin
//
// State monitored: annotationField revisions where
//   selection.main.from === selection.main.to (collapsed).
// Trigger: any doc-changing transaction NOT annotated with
//   revisionInternalEdit (which marks intentional version
//   switches).
// Downstream effects:
//   - Collects ALL collapsed revisions in one pass and
//     dispatches all removeAnnotation effects in a single
//     microtask-deferred transaction tagged addToHistory.of(false)
//     + _revisionCleanup.of(true), so:
//     * No new undo history entry is created.
//     * invertedAnnotationFieldEffects skips the cleanup
//       transaction entirely (no spurious addAnnotation
//       effects pollute the deletion's undo entry).
//   - Undo restoration is handled by invertedAnnotationFieldEffects
//     via the _restoreAnnotation effects stored at deletion time.
// -------------------------------------------------------
const collapsedRevisionResolver = ViewPlugin.fromClass(
    class {
        update(update: ViewUpdate) {
            if (!appSettings.atomicRevisions) return;
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(revisionInternalEdit))) return;
            // Don't remove revisions whose text was cleared by the nested editor —
            // empty content is a valid state when the nested editor is active.
            if (update.transactions.some((tr) => tr.annotation(nestedEditorEdit) !== undefined))
                return;
            const annotations = update.state.field(annotationField);
            const collapsed = Object.values(annotations).filter(
                (a) => isAnnotationOfType(a, "revision") && a.selection.main.empty,
            );
            if (collapsed.length === 0) return;
            // Remove all collapsed revisions in one transaction without creating a
            // history entry. invertedAnnotationFieldEffects already stored a
            // _restoreAnnotation effect for each collapsed revision at deletion
            // time, so a single Cmd+Z fully restores text and annotations.
            //
            // queueMicrotask: dispatching inside update() is illegal in
            // CodeMirror — the update cycle must finish before the view
            // accepts a new dispatch. A microtask defers to the next
            // microtask checkpoint (before the next task/paint) so the
            // cleanup still feels synchronous to the user but doesn't
            // violate CodeMirror's invariant.
            queueMicrotask(() => {
                // Guard: the state may have advanced since this update fired
                // (e.g. the user pressed Cmd+Z before the microtask ran).
                // If so, the collapsed revision was already cleaned up or
                // restored by the undo, and dispatching now would double-remove.
                if (update.view.state !== update.state) return;
                update.view.dispatch({
                    effects: collapsed.map((a) => removeAnnotation.of(a)),
                    annotations: [
                        // addToHistory:false — without this the cleanup would
                        // create its own undo entry (H2) between the deletion
                        // (H1) and the original addAnnotation (H0). The user
                        // would need two Cmd+Z presses to undo a single
                        // deletion, and the intermediate state would show the
                        // revision missing but its text present.
                        Transaction.addToHistory.of(false),
                        // _revisionCleanup — tells invertedAnnotationFieldEffects
                        // to skip this transaction entirely. Without this guard,
                        // invertedEffects would see the removeAnnotation effects
                        // here and generate addAnnotation(collapsed) effects that
                        // get merged into H1's undo entry — so Cmd+Z would
                        // re-insert an orphaned zero-width revision on top of the
                        // _restoreAnnotation that already does the right thing.
                        _revisionCleanup.of(true),
                    ],
                });
            });
        }
    },
);

// -------------------------------------------------------
// boundaryInsertNudge ViewPlugin
//
// Emits a boundary-nudge UI event when the user inserts text
// immediately adjacent to a revision boundary from outside:
//   - inserting at position === revision.from (would push into the start)
//   - inserting at position === revision.to   (appends just after the end)
// Complements nudgeBoundary which only covers Backspace/Delete.
// -------------------------------------------------------
const boundaryInsertNudge = ViewPlugin.fromClass(
    class {
        update(update: ViewUpdate) {
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(revisionInternalEdit))) return;
            if (update.transactions.some((tr) => tr.annotation(nestedEditorEdit) !== undefined))
                return;
            const annotations = update.startState.field(annotationField);
            for (const tr of update.transactions) {
                if (!tr.docChanged) continue;
                tr.changes.iterChanges((fromA, _toA, _fromB, _toB, inserted) => {
                    if (inserted.length === 0) return; // deletion, not insertion
                    for (const annotation of Object.values(annotations)) {
                        if (!isAnnotationOfType(annotation, "revision")) continue;
                        const { from, to } = annotation.selection.main;
                        if (from === to) continue;
                        if (fromA === from || fromA === to) {
                            annotationEventBus.emit({
                                type: "revision-boundary-nudge",
                                revisionId: annotation.id,
                            });
                            return;
                        }
                    }
                });
            }
        }
    },
);

// -------------------------------------------------------
// annotationDecorations ViewPlugin
//
// Builds DecorationSets for all three annotation types
// (comment, revision, suggestion) and joins them into a
// single decoration layer. Each annotation's range gets a
// CSS class mark (e.g. cm-comment, cm-revision), and the
// "active" annotation (the one under the cursor) gets an
// additional -active variant class for highlighted styling.
//
// Rebuilt on: cursor movement (selectionSet), doc changes,
// or annotation map changes.
//
// Also contains getPreviewDecoration() for rendering
// inline suggestion diffs via SuggestionDiffWidget, though
// this is not currently wired into the decoration provider.
// -------------------------------------------------------
const annotationDecorations = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = RangeSet.join([
                this.getDecorations(view, "comment", "cm-comment"),
                this.getDecorations(view, "revision", "cm-revision"),
                this.getDecorations(view, "suggestion", "cm-suggestion"),
            ]);
        }

        update(update: ViewUpdate) {
            // update.selectionSet also means "if cursor changed"
            if (update.selectionSet || update.docChanged || annotationsChanged(update)) {
                this.decorations = RangeSet.join([
                    this.getDecorations(update.view, "comment", "cm-comment"),
                    this.getDecorations(update.view, "revision", "cm-revision"),
                    this.getDecorations(update.view, "suggestion", "cm-suggestion"),
                ]);
            }
        }

        getDecorations(view: EditorView, type: AnnotationType, classPrefix: string): DecorationSet {
            // See issue #38: this is O(n*m); could be optimized to O(n log n)
            // with a greedy sweep-line / interval-merge approach.
            const builder = new RangeSetBuilder<Decoration>();
            const annotationRanges = flatMap(
                filter(Object.values(view.state.field(annotationField)), (annotation) =>
                    isAnnotationOfType(annotation, type),
                ),
                // Currently only .main is used; multi-range support tracked in #38.
                (annotation) => annotation.selection.main,
            );
            // Only .main is used for active ranges; multi-range support tracked in #38.
            const activeRanges: readonly SelectionRange[] =
                getActiveAnnotation(view.state, type)?.selection?.ranges ?? [];
            // If you don't add annotations in order, the plugin will crash
            annotationRanges.sort((a, b) => a.from - b.from);

            const toHighlight = [
                ...annotationRanges.map((x) => ({
                    active: false,
                    x,
                })),
                ...activeRanges.map((x) => ({
                    active: true,
                    x,
                })),
            ].sort((a, b) => a.x.from - b.x.from);
            for (const {
                x: { from, to },
                active,
            } of toHighlight) {
                builder.add(
                    from,
                    to,
                    Decoration.mark({
                        class: active ? `${classPrefix}-active` : classPrefix,
                        inclusive: true,
                        // inclusive: type === "revision",
                    }),
                );
            }
            return builder.finish();
        }

        getPreviewDecoration(view: EditorView): DecorationSet {
            const preview = view.state.field(suggestionPreviewField);
            if (!preview) return Decoration.none;
            const annotation = view.state.field(annotationField)[preview.annotationId];
            if (!annotation || !isAnnotationOfType(annotation, "suggestion"))
                return Decoration.none;
            const replacement = annotation.replacements[preview.replacementIndex];
            if (replacement === undefined) return Decoration.none;
            const { from, to } = annotation.selection.main;
            const original = view.state.sliceDoc(from, to);
            const builder = new RangeSetBuilder<Decoration>();
            builder.add(
                from,
                to,
                Decoration.replace({
                    widget: new SuggestionDiffWidget(original, replacement.text),
                    inclusive: true,
                }),
            );
            return builder.finish();
        }
    },
    {
        decorations: (v) => v.decorations,
    },
);
// Resolves an annotation target to an EditorSelection.
// Accepts either an explicit EditorSelection or a targetText
// string (searched via SearchCursor). Exactly one must be
// provided. Used by createComment, createSuggestion, and
// createRevision to support both cursor-based and text-based
// annotation creation (e.g. from AI suggestions).
function getSelection({
    editorSelection,
    targetText,
    document,
}: {
    editorSelection?: EditorSelection;
    targetText?: string;
    document: Text;
}) {
    let selection = editorSelection;
    if (editorSelection && targetText) {
        throw new Error("Cannot specify both targetText and editorSelection");
    }
    if (!selection) {
        if (!targetText) {
            throw new Error("Must specify at least either targetText or editorSelection");
        }
        const query = new SearchCursor(document, targetText);
        const selections = [...query].map(({ from: anchor, to: head }) =>
            EditorSelection.range(anchor, head),
        );
        if (selections.length === 0) {
            throw new Error(`Target text not found in document: "${targetText.slice(0, 60)}…"`);
        }
        selection = EditorSelection.create(selections);
    }
    return selection;
}
export function createComment({
    targetText,
    editorSelection,
    comment,
    author = "AI",
    view,
}: {
    targetText?: string;
    editorSelection?: EditorSelection;
    comment: string;
    author?: string;
    view: EditorView;
}) {
    const state = view.state;

    const selection = getSelection({
        editorSelection,
        targetText,
        document: state.doc,
    });
    view.dispatch(
        state.update({
            effects: [
                addAnnotation.of({
                    ...createNewAnnotation(state.field(annotationField), selection, "comment"),
                    thread: [{ message: comment, author, time: Date.now() }],
                }),
            ],
            annotations: Transaction.addToHistory.of(true),
        }),
    );
}
export function createSuggestion({
    targetText,
    editorSelection,
    replacements,
    comment,
    author = "AI",
    dispatch,
    state,
}: {
    state: EditorState;
    dispatch: (transaction: Transaction) => void;
    replacements: Array<{ text: string; rationale?: string } | string>;
    targetText?: string;
    editorSelection?: EditorSelection;
    author?: string;
    comment?: string;
}) {
    // Normalize string shorthand to full shape
    const normalizedReplacements = replacements.map((r) =>
        typeof r === "string" ? { text: r } : r,
    );
    const selection = getSelection({
        editorSelection,
        targetText,
        document: state.doc,
    });
    dispatch(
        state.update({
            effects: [
                addAnnotation.of({
                    ...createNewAnnotation(state.field(annotationField), selection, "suggestion"),
                    replacements: normalizedReplacements,
                    thread: comment ? [{ message: comment, author, time: Date.now() }] : [],
                }),
            ],
            annotations: Transaction.addToHistory.of(true),
        }),
    );
}

export function createRevision({
    targetText,
    editorSelection,
    versions,
    threadMessage,
    author = "AI",
    view,
}: {
    targetText?: string;
    editorSelection?: EditorSelection;
    versions: Array<{ label: string; text: string }>;
    threadMessage: string;
    author?: string;
    view: EditorView;
}) {
    const state = view.state;
    const selection = getSelection({
        editorSelection,
        targetText,
        document: state.doc,
    });
    const originalText = state.sliceDoc(selection.main.from, selection.main.to);
    const originalVersion = {
        doc: originalText,
        label: "Original",
    } as VersionState;
    view.dispatch(
        state.update({
            effects: [
                addAnnotation.of({
                    ...createNewAnnotation(state.field(annotationField), selection, "revision"),
                    activeVersionIndex: 0,
                    versions: [
                        originalVersion,
                        ...versions.map(
                            ({ label, text }) => ({ doc: text, label }) as VersionState,
                        ),
                    ],
                    thread: [{ message: threadMessage, author, time: Date.now() }],
                }),
            ],
            annotations: Transaction.addToHistory.of(true),
        }),
    );
}

const createCommentCommand: StateCommand = ({ state, dispatch }) => {
    // locks it so that we can't have multiple pending states
    if (!canCreateNewComment(state.field(annotationField))) {
        annotationEventBus.emit({
            type: "pending-comment-alert",
        });
        return true;
    }
    // Multi-selection support tracked in issue #38; currently only main range is used.
    if (state.selection.main.empty) return false;

    dispatch(
        state.update({
            effects: [
                addAnnotation.of(
                    createNewAnnotation(state.field(annotationField), state.selection, "comment"),
                ),
            ],
            annotations: Transaction.addToHistory.of(true),
        }),
    );
    return true;
};
// QUESTION: Should we have some sort of global annotation mutex
const createRevisionCommand: StateCommand = ({ state, dispatch }) => {
    const sel = state.selection.main;
    const newAnnotation = createNewAnnotation(
        state.field(annotationField),
        state.selection,
        "revision",
    );
    dispatch(
        state.update({
            effects: [
                addAnnotation.of({
                    ...newAnnotation,
                    activeVersionIndex: 0,
                    versions: [
                        {
                            doc: state.sliceDoc(sel.from, sel.to),
                        } as VersionState,
                    ],
                }),
            ],
            annotations: Transaction.addToHistory.of(true),
        }),
    );
    // When the setting is on and there is an actual selection, signal
    // the nested editor to select all text on mount.
    if (appSettings.selectTextInNestedEditor && !sel.empty) {
        annotationEventBus.emit({
            type: "pending-nested-editor-selection",
            annotationId: newAnnotation.id,
            from: 0,
            to: sel.to - sel.from,
        });
    }
    return true;
};
function addRevisionVersionCommand(): StateCommand {
    return ({ state }) => {
        const annotation = getActiveRevisionAnnotation(state);
        if (!annotation) return false;
        annotationEventBus.emit({ type: "annotation-add-version", annotationId: annotation.id });
        return true;
    };
}

function navigateRevisionVersion(direction: "prev" | "next"): StateCommand {
    return ({ state, dispatch }) => {
        const annotation = getActiveRevisionAnnotation(state);
        if (annotation) {
            const count = annotation.versions.length;
            if (count <= 1) return true;
            const current = annotation.activeVersionIndex;
            const next =
                direction === "next" ? (current + 1) % count : (current - 1 + count) % count;
            dispatch(setActiveRevisionVersion(state, annotation.id, next));
            return true;
        }
        // Cursor isn't inside a revision — find the nearest one and
        // nudge the user toward the inline/modal editor.
        const cursor = state.selection.main.from;
        let nearestId: number | null = null;
        let nearestDist = Number.POSITIVE_INFINITY;
        for (const ann of Object.values(state.field(annotationField))) {
            if (!isAnnotationOfType(ann, "revision")) continue;
            const { from, to } = ann.selection.main;
            if (from === to) continue;
            const dist = Math.min(Math.abs(cursor - from), Math.abs(cursor - to));
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestId = ann.id;
            }
        }
        if (nearestId !== null) {
            annotationEventBus.emit({
                type: "revision-boundary-nudge",
                revisionId: nearestId,
            });
            return true;
        }
        return false;
    };
}

// -------------------------------------------------------
// Annotation keymap
//
// Keybindings are ordered so that higher-priority handlers
// run first. For example, nudgeBoundary runs before
// deleteAdjacentRevision on Backspace/Delete, and
// redirectToNestedEditor runs before the create commands
// on Mod-Alt-m/k. If the first handler returns false, the
// next binding for the same key is tried.
// -------------------------------------------------------
export const annotationKeymap: KeyBinding[] = [
    {
        key: "Ctrl-[",
        run: navigateRevisionVersion("prev"),
    },
    {
        key: "Ctrl-]",
        run: navigateRevisionVersion("next"),
    },
    {
        key: "Backspace",
        run: nudgeBoundary("backward"),
    },
    {
        key: "Delete",
        run: nudgeBoundary("forward"),
    },
    {
        key: "Backspace",
        run: deleteAdjacentRevision("backward"),
    },
    {
        key: "Delete",
        run: deleteAdjacentRevision("forward"),
    },
    {
        key: "Mod-Alt-m",
        run: redirectToNestedEditor("comment"),
    },
    {
        key: "Mod-Alt-m",
        run: createCommentCommand,
    },
    {
        key: "Mod-Alt-k",
        run: redirectToNestedEditor("revision"),
    },
    {
        key: "Mod-Alt-k",
        run: createRevisionCommand,
    },
];

// -------------------------------------------------------
// Extension bundle
//
// Assembles all annotation-related extensions into a
// single array for Editor.svelte to install. Order matters:
//   1. Keymap at high precedence (overrides default keys).
//   2. annotationField StateField (core state).
//   3. suggestionPreviewField StateField (preview state).
//   4. annotationDecorations ViewPlugin (rendering).
//   5. collapsedRevisionResolver ViewPlugin (auto-cleanup).
//   6. invertedAnnotationFieldEffects (undo/redo support).
// -------------------------------------------------------
const revisionClickHandler = EditorView.domEventHandlers({
    mousedown(event, view) {
        if (!appSettings.atomicRevisions) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const annotations = view.state.field(annotationField);
        for (const annotation of Object.values(annotations)) {
            if (!isAnnotationOfType(annotation, "revision")) continue;
            const { from, to } = annotation.selection.main;
            if (pos >= from && pos <= to) {
                // Move cursor to clicked position so the annotation becomes active
                view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
                annotationEventBus.emit({
                    type: "revision-focus-request",
                    revisionId: annotation.id,
                    relativePos: pos - from,
                    sourceView: view,
                });
                return false;
            }
        }
        return false;
    },
});

export const annotations = () => [
    Prec.high(keymap.of(annotationKeymap)),
    annotationField,
    suggestionPreviewField,
    annotationDecorations,
    revisionAtomicRanges,
    revisionClickHandler,
    collapsedRevisionResolver,
    boundaryInsertNudge,
    invertedAnnotationFieldEffects,
];
export * from "./models";
