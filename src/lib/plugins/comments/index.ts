// All this plugin does is
// Highlight text and store which selections (including sub-selections)
// were highlighted. Users of this plugin can provide
// update handlers via Facets.
import {
	type EditorView,
	keymap,
	type ViewUpdate,
	type Command,
	type KeyBinding,
	type DecorationSet,
	Decoration,
	ViewPlugin,
} from "@codemirror/view";
import {
	StateField,
	StateEffect,
	type Transaction,
	EditorSelection,
	Facet,
	type StateCommand,
	EditorState,
	RangeSetBuilder,
	type SelectionRange,
} from "@codemirror/state";
import { canCreateNewComment } from "$lib/stores";
import { get } from "svelte/store";

export interface Comment {
	selection: EditorSelection;
	text: string;
}
type RawComment = {
	selection: EditorSelection["toJSON"];
	text: string;
};
// TODO: def use IDs...
// XXX: No idea if this is the best way to do it
// Since I have my viewed contained elsewhere,
// a view plugin is not it.
// const commentUpdateHandler = Facet.define<(comments: Comment[]) => void>();
// Effect to CRUD comments, without the R
export const addComment = StateEffect.define<Comment>();
export const updateComment = StateEffect.define<Comment>();
//  TODO: maybe use IDs to optimize
export const removeComment = StateEffect.define<Comment>();
// StateField to track comment data
export const commentField = StateField.define<Comment[]>({
	create(): Comment[] {
		return [];
	},
	update(oldComments: Comment[], tr: Transaction): Comment[] {
		let comments = oldComments;
		for (const e of tr.effects) {
			if (e.is(addComment)) {
				// XXX: Not sure if this is the right attribute to use
				comments = [...comments, e.value];
			} else if (e.is(removeComment)) {
				comments = comments.filter(
					(c) =>
						!(c.selection.eq(e.value.selection) && e.value.text === c.text),
				);
			} else if (e.is(updateComment)) {
				comments = comments.map((c) =>
					c.selection.eq(e.value.selection) ? { ...c, text: e.value.text } : c,
				);
			}
		}
		// Map our old comments to the new state
		// ranges, as we don't want our comments/highlighted portion
		// to be static markers of a row and column but instead change with te
		comments = comments.map((x) => ({
			selection: x.selection.map(tr.changes),
			text: x.text,
		}));
		return comments;
	},
	toJSON(value: Comment[]) {
		return value.map((c) => ({
			selection: c.selection.toJSON(),
			text: c.text,
		}));
	},
	fromJSON(value: unknown) {
		return (value as RawComment[]).map((x) => ({
			selection: EditorSelection.fromJSON(x.selection),
			text: x.text,
		})) as Comment[];
	},
});
// export function getActiveComment(state: EditorState) {
// 	return state.selection.main. state.field(commentField);
// }

export const commentsChanged = (update: ViewUpdate) =>
	update.transactions.some((tr) =>
		tr.effects.some(
			(e) => e.is(addComment) || e.is(updateComment) || e.is(removeComment),
		),
	);
function positionIntersects(position: number, selection: SelectionRange) {
	return selection.from <= position && position <= selection.to;
}
const commentDecorations = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.getDecorations(view);
		}

		update(update: ViewUpdate) {
			// update.selectionSet also means "if cursor changed"
			if (update.selectionSet || update.docChanged || commentsChanged(update)) {
				this.decorations = this.getDecorations(update.view);
			}
		}

		getDecorations(view: EditorView): DecorationSet {
			// TODO: optimize algorithm to be linear time complexity
			// using some sort of greedy algorithm
			const builder = new RangeSetBuilder<Decoration>();
			const cursor = view.state.selection.main;
			const cursorPos = cursor.head;
			const commentRanges = view.state
				.field(commentField)
				// We can assume a single selection
				// because we are not implementing multi-selection support
				// for now
				.flatMap((comment) => comment.selection.main);

			const smallestRangeFirst = commentRanges
				// Smallest range first
				.toSorted((a, b) => a.to - a.from - (b.to - b.from));

			const highlightedRanges: SelectionRange[] = [];
			for (const range of smallestRangeFirst)
				if (
					positionIntersects(cursorPos, range) &&
					// Having this extra condition makes it feel like Google docs
					// Basically what this is doing that if the cursor is a selection,
					// we only want to show the comment if the entire selection is within
					// a single comment
					(!cursor.empty ? positionIntersects(cursor.anchor, range) : true)
				) {
					highlightedRanges.push(range);
					// Eventually we want to support multi-cursor
					// and multi-selection comments
					break;
				}
			commentRanges.sort((a, b) => a.from - b.from);

			let prevEnd = -1;
			// TODO: care about multiple selections
			for (const range of commentRanges) {
				if (highlightedRanges.includes(range)) {
					builder.add(
						range.from,
						range.to,
						Decoration.mark({ class: "cm-highlight-active" }),
					);
				} else {
					const from =
						range.from > prevEnd && prevEnd !== -1 ? prevEnd : range.from;
					const intersectingHighlightedRange = highlightedRanges.find(
						(highlighted) => positionIntersects(range.to, highlighted),
					);
					const to = intersectingHighlightedRange
						? intersectingHighlightedRange.from
						: range.to;

					builder.add(from, to, Decoration.mark({ class: "cm-highlight" }));
				}
				prevEnd = Math.max(prevEnd, range.to);
			}

			return builder.finish();
		}
	},
	{
		decorations: (v) => v.decorations,
	},
);
export const createCommentCommand: StateCommand = ({ state, dispatch }) => {
	if (!get(canCreateNewComment)) {
		return false;
	}
	dispatch(
		state.update({
			effects: [addComment.of({ selection: state.selection, text: "" })],
		}),
	);
	return true;
};
// TODO: a faucet for storing config
export const commentKeymap: KeyBinding[] = [
	{
		key: "Mod-Alt-m",
		run: createCommentCommand,
	},
];
// Extension
export const comments = () => [
	commentField,
	commentDecorations,
	// EditorView.domEventHandlers({
	// 	contextmenu: (event: MouseEvent, view: EditorView) => {
	// 		event.preventDefault();
	// 		addCommentCommand(view);
	// 	},
	// }),
];
