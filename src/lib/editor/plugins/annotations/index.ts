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

// TODO: since we've refactored, now we can hone in on the issues
// but first let's make it based on the id

import { SearchCursor } from "@codemirror/search";
import {
	EditorSelection,
	Prec,
	RangeSet,
	RangeSetBuilder,
	type SelectionRange,
	type StateCommand,
	Transaction,
	Text,
	EditorState,
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
	WidgetType,
} from "@codemirror/view";

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
	allowRevisionDocEdit,
	removeAnnotation,
	setActiveRevisionVersion,
	invertedAnnotationFieldEffects,
	suggestionPreviewField,
} from "./annotationField";
import {
	publishAnnotationUiEvent,
	type NestedEditorCommand,
} from "$lib/stores";
import { appSettings } from "$lib/settings.svelte";

export * from "./annotationField";
// Detects whether the annotation map changed between the
// previous and current editor state. Used by ViewPlugins to
// decide whether to rebuild decorations. Checks both deep
// equality of the annotation map and the presence of
// add/remove effects (which may not yet be reflected in the
// field value during the same update cycle).
export const annotationsChanged = (update: ViewUpdate) =>
	!isEqual(
		update.startState.field(annotationField),
		update.state.field(annotationField),
	) ||
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

function deleteAdjacentRevision(
	direction: "backward" | "forward",
): StateCommand {
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
				annotations: [
					allowRevisionDocEdit.of(true),
					Transaction.addToHistory.of(true),
				],
			}),
		);
		return true;
	};
}

// Returns the active revision annotation if the cursor is at one of its
// content boundaries (first or last character position), null otherwise.
function getRevisionAtContentBoundary(
	state: EditorState,
	direction: "backward" | "forward",
) {
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
		publishAnnotationUiEvent({
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
		if (cursor.from >= from && cursor.to <= to)
			return annotation.selection.main;
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
function redirectToNestedEditor(
	type: NestedEditorCommand["type"],
): StateCommand {
	return (view) => {
		if (!appSettings.atomicRevisions) return false;
		const activeRevision = getActiveRevisionAnnotation(view.state);
		if (!activeRevision) return false; // fall through to original keymap
		const revFrom = activeRevision.selection.main.from;
		const sel = view.state.selection.main;
		publishAnnotationUiEvent({
			type: "revision-open-nested-editor",
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
	const revisions = Object.values(state.field(annotationField)).filter(
		(annotation) => isAnnotationOfType(annotation, "revision"),
	);
	for (const revision of revisions) {
		const { from, to } = revision.selection.main;
		if (from === to) continue;
		builder.add(from, to, Decoration.mark({}));
	}
	return builder.finish();
}

const revisionAtomicRanges = EditorView.atomicRanges.of(
	(view) => buildAtomicRanges(view.state),
);

// -------------------------------------------------------
// collapsedRevisionResolver ViewPlugin
//
// State monitored: annotationField revisions where
//   selection.main.from === selection.main.to (collapsed).
// Trigger: any doc-changing transaction NOT annotated with
//   allowRevisionDocEdit (which marks intentional version
//   switches).
// Downstream effects:
//   - If the revision has >1 version: dispatches
//     setActiveRevisionVersion to switch to an adjacent
//     version, restoring the revision's text.
//   - If only 1 version: dispatches removeAnnotation to
//     clean up the empty revision.
//   - Handles one collapsed revision per update cycle to
//     avoid stale-state issues from cascading dispatches.
// -------------------------------------------------------
const collapsedRevisionResolver = ViewPlugin.fromClass(
	class {
		update(update: ViewUpdate) {
			if (!appSettings.atomicRevisions) return;
			if (!update.docChanged) return;
			if (
				update.transactions.some((tr) =>
					tr.annotation(allowRevisionDocEdit),
				)
			)
				return;
			const annotations = update.state.field(annotationField);
			for (const annotation of Object.values(annotations)) {
				if (!isAnnotationOfType(annotation, "revision")) continue;
				const { from, to } = annotation.selection.main;
				if (from !== to) continue;
				// Revision range collapsed — all text was deleted
				if (annotation.versions.length <= 1) {
					// Only one version, nothing to fall back to — remove it
					queueMicrotask(() => {
						update.view.dispatch({
							effects: [removeAnnotation.of(annotation)],
						});
					});
				} else {
					// Switch to the next available version
					const nextVersion =
						annotation.currentlySelected > 0
							? annotation.currentlySelected - 1
							: 1;
					queueMicrotask(() => {
						update.view.dispatch(
							setActiveRevisionVersion(
								update.state,
								annotation.id,
								nextVersion,
							),
						);
					});
				}
				return; // handle one at a time to avoid stale state
			}
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
			if (update.transactions.some((tr) => tr.annotation(allowRevisionDocEdit))) return;
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
							publishAnnotationUiEvent({
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
// Inline diff helpers
//
// Used by SuggestionDiffWidget to render a word-level
// inline diff between the original text and a suggested
// replacement. tokenize() splits text into word/whitespace
// tokens, and diffTokens() computes an LCS-based diff
// producing equal/delete/insert operations.
// -------------------------------------------------------
export function tokenize(text: string): string[] {
	return text.match(/\S+|\s+/g) ?? [];
}

export type DiffOp = { type: "equal" | "delete" | "insert"; text: string };

export function diffTokens(aTokens: string[], bTokens: string[]): DiffOp[] {
	const m = aTokens.length;
	const n = bTokens.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () =>
		new Array(n + 1).fill(0),
	);
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			if (aTokens[i] === bTokens[j]) {
				dp[i][j] = dp[i + 1][j + 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
			}
		}
	}
	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	while (i < m || j < n) {
		if (i < m && j < n && aTokens[i] === bTokens[j]) {
			ops.push({ type: "equal", text: aTokens[i] });
			i++;
			j++;
		} else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
			ops.push({ type: "insert", text: bTokens[j] });
			j++;
		} else {
			ops.push({ type: "delete", text: aTokens[i] });
			i++;
		}
	}
	// Merge adjacent same-type ops
	const merged: DiffOp[] = [];
	for (const op of ops) {
		const last = merged[merged.length - 1];
		if (last && last.type === op.type) last.text += op.text;
		else merged.push({ ...op });
	}
	return merged;
}

class SuggestionDiffWidget extends WidgetType {
	constructor(
		readonly original: string,
		readonly replacement: string,
	) {
		super();
	}
	eq(other: SuggestionDiffWidget) {
		return (
			this.original === other.original &&
			this.replacement === other.replacement
		);
	}
	toDOM() {
		const ops = diffTokens(
			tokenize(this.original),
			tokenize(this.replacement),
		);
		const span = document.createElement("span");
		span.className = "cm-suggestion-diff";
		for (const op of ops) {
			if (op.type === "equal") {
				span.appendChild(document.createTextNode(op.text));
			} else if (op.type === "delete") {
				const del = document.createElement("span");
				del.className = "cm-suggestion-diff-del";
				del.textContent = op.text;
				span.appendChild(del);
			} else {
				const ins = document.createElement("span");
				ins.className = "cm-suggestion-diff-ins";
				ins.textContent = op.text;
				span.appendChild(ins);
			}
		}
		return span;
	}
	ignoreEvent() {
		return true;
	}
}

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
			if (
				update.selectionSet ||
				update.docChanged ||
				annotationsChanged(update)
			) {
				this.decorations = RangeSet.join([
					this.getDecorations(update.view, "comment", "cm-comment"),
					this.getDecorations(update.view, "revision", "cm-revision"),
					this.getDecorations(
						update.view,
						"suggestion",
						"cm-suggestion",
					),
				]);
			}
		}

		getDecorations(
			view: EditorView,
			type: AnnotationType,
			classPrefix: string,
		): DecorationSet {
			// TODO: optimize algorithm to be linear time complexity
			// using some sort of greedy algorithm
			const builder = new RangeSetBuilder<Decoration>();
			const annotationRanges = flatMap(
				filter(
					Object.values(view.state.field(annotationField)),
					(annotation) => isAnnotationOfType(annotation, type),
				),
				// We can assume a single selection
				// because we are not implementing multi-selection support
				// for now
				(annotation) => annotation.selection.main,
			);
			// TODO: use multiple
			const activeRanges: readonly SelectionRange[] =
				getActiveAnnotation(view.state, type)?.selection?.ranges ?? [];
			// If you don't add annotations in order, the plugin will crash
			annotationRanges.sort((a, b) => a.from - b.from);

			// TODO: care about multiple selections
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
			const annotation =
				view.state.field(annotationField)[preview.annotationId];
			if (!annotation || !isAnnotationOfType(annotation, "suggestion"))
				return Decoration.none;
			const replacement =
				annotation.replacements[preview.replacementIndex];
			if (replacement === undefined) return Decoration.none;
			const { from, to } = annotation.selection.main;
			const original = view.state.sliceDoc(from, to);
			const builder = new RangeSetBuilder<Decoration>();
			builder.add(
				from,
				to,
				Decoration.replace({
					widget: new SuggestionDiffWidget(
						original,
						replacement.text,
					),
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
			throw new Error(
				"Must specify at least either targetText or editorSelection",
			);
		}
		const query = new SearchCursor(document, targetText);
		const selections = [...query].map(({ from: anchor, to: head }) =>
			EditorSelection.range(anchor, head),
		);
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

	let selection = getSelection({
		editorSelection,
		targetText,
		document: state.doc,
	});
	view.dispatch(
		state.update({
			effects: [
				addAnnotation.of({
					...createNewAnnotation(
						state.field(annotationField),
						selection,
						"comment",
					),
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
	// TODO: replace this with the simpler
	// view because this was originally being
	// mocked as a command
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
	let selection = getSelection({
		editorSelection,
		targetText,
		document: state.doc,
	});
	dispatch(
		state.update({
			effects: [
				addAnnotation.of({
					...createNewAnnotation(
						state.field(annotationField),
						selection,
						"suggestion",
					),
					replacements: normalizedReplacements,
					thread: comment
						? [{ message: comment, author, time: Date.now() }]
						: [],
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
					...createNewAnnotation(
						state.field(annotationField),
						selection,
						"revision",
					),
					currentlySelected: 0,
					versions: [
						originalVersion,
						...versions.map(
							({ label, text }) =>
								({ doc: text, label }) as VersionState,
						),
					],
					thread: [
						{ message: threadMessage, author, time: Date.now() },
					],
				}),
			],
			annotations: Transaction.addToHistory.of(true),
		}),
	);
}

const createCommentCommand: StateCommand = ({ state, dispatch }) => {
	// locks it so that we can't have multiple pending states
	if (!canCreateNewComment(state.field(annotationField))) {
		publishAnnotationUiEvent({
			type: "pending-comment-alert",
		});
		return true;
	}
	// TODO: multi selection support
	if (state.selection.main.empty) return false;

	dispatch(
		state.update({
			effects: [
				addAnnotation.of(
					createNewAnnotation(
						state.field(annotationField),
						state.selection,
						"comment",
					),
				),
			],
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
					currentlySelected: 0,
					versions: [
						{
							doc: state.sliceDoc(sel.from, sel.to),
						} as VersionState,
					],
				}),
			],
		}),
	);
	// When the setting is on and there is an actual selection, signal
	// the nested editor to select all text on mount.
	if (appSettings.selectTextInNestedEditor && !sel.empty) {
		publishAnnotationUiEvent({
			type: "pending-nested-editor-selection",
			annotationId: newAnnotation.id,
			from: 0,
			to: sel.to - sel.from,
		});
	}
	return true;
};
const dev_dontuseinprod_createSuggestion: StateCommand = ({
	state,
	dispatch,
}) => {
	createSuggestion({
		editorSelection: state.selection,
		state,
		dispatch,
		replacements: ["ur mother"],
	});
	return true;
};
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
	{
		key: "Mod-b",
		run: dev_dontuseinprod_createSuggestion,
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
				publishAnnotationUiEvent({
					type: "revision-focus-request",
					revisionId: annotation.id,
					relativePos: pos - from,
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
