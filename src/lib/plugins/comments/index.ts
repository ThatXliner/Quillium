// All this plugin does is
// Highlight text and store which selections (including sub-selections)
// were highlighted. Users of this plugin can provide
// update handlers via Facets.
import {
	EditorView,
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
		console.log("comments", comments);
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
// const commentMark = Decoration.mark({ class: "cm-comment" });
// const commentDecorations = StateField.define<DecorationSet>({
// 	create() {
// 		return Decoration.none;
// 	},
// 	update(oldDecorations, tr) {
// 		let decorations = oldDecorations.map(tr.changes);
// 		// state = state.map(tr.changes);
// 		for (const e of tr.effects) {
// 			if (e.is(addComment)) {
// 				decorations = decorations.update({
// 					add: e.value.selection.ranges.map((range) =>
// 						// Create a decoration for each range of selections
// 						// (multiple selections are possible)
// 						commentMark.range(range.from, range.to),
// 					),
// 				});
// 			}
// 			// There is no check for e.is(removeComment) because
// 			// Using the keybinding will always create a comment

// 			// There is no check for e.is(updateComment) because
// 			// this StateField only handles the visual representations
// 			// of comments within the document, not the contents of
// 			// the comments themselves
// 		}
// 		return decorations;
// 	},
// 	provide: (f) => EditorView.decorations.from(f),
// });
export const commentsChanged = (update: ViewUpdate) =>
	update.transactions.some((tr) =>
		tr.effects.some(
			(e) => e.is(addComment) || e.is(updateComment) || e.is(removeComment),
		),
	);
const commentDecorations = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.getDecorations(view);
		}

		update(update: ViewUpdate) {
			// update.selectionSet also means "if cursor changed"
			if (update.selectionSet || update.docChanged || commentsChanged(update)) {
				console.log("updating decorations");
				this.decorations = this.getDecorations(update.view);
			}
		}

		getDecorations(view: EditorView): DecorationSet {
			// TODO: optimize algorithm to be linear time complexity
			// using some sort of greedy algorithm
			const builder = new RangeSetBuilder<Decoration>();
			const cursorPos = view.state.selection.main.head;

			const ranges = view.state
				.field(commentField)
				// We can assume a single selection
				// because we are not implementing multi-selection support
				// for now
				.flatMap((comment) => comment.selection.main)
				// Smallest range first
				.toSorted((a, b) => a.to - a.from - (b.to - b.from));

			const highlightedRanges = [];
			for (const { from, to } of ranges)
				if (from <= cursorPos && cursorPos <= to) {
					highlightedRanges.push({ from, to });
					// Eventually we want to support multi-cursor
					// and multi-selection comments
					break;
				}
			highlightedRanges.sort((a, b) => a.from - b.from);
			// Ranges must be added sorted by their starting position
			// or else this plugin crashes
			for (const { from, to } of ranges.toSorted((a, b) => a.from - b.from)) {
				const isCursorInside = cursorPos >= from && cursorPos <= to;
				// const smallestRange = ranges.find(r => cursorPos >= r.from && cursorPos <= r.to);
				// if (smallestRange && isCursorInside) {
				// 	from = smallestRange.from;
				// 	to = smallestRange.to;
				// }
				builder.add(
					from,
					to,
					Decoration.mark({
						class: isCursorInside ? "cm-highlight-active" : "cm-highlight",
					}),
				);
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
