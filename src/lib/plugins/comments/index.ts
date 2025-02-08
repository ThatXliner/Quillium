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
} from "@codemirror/view";
import {
	StateField,
	StateEffect,
	type Transaction,
	type EditorSelection,
	Facet,
	type StateCommand,
	EditorState,
} from "@codemirror/state";
import { canCreateNewComment } from "$lib/stores";
import { get } from "svelte/store";

export interface Comment {
	selection: EditorSelection;
	text: string;
}
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
				console.log("updated");
				comments = comments.map((c) =>
					c.selection.eq(e.value.selection) ? { ...c, text: e.value.text } : c,
				);
			}
		}
		return comments;
	},
	toJSON(value: Comment[]) {
		return value;
	},
	fromJSON(value: unknown) {
		return value as Comment[];
	},
});
const commentMark = Decoration.mark({ class: "cm-comment" });
const commentDecorations = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(oldDecorations, tr) {
		// Map our old decorations to the new state
		// ranges, as we don't want our comments/highlighted portion
		// to be static markers of a row and column but instead change with text
		let decorations = oldDecorations.map(tr.changes);
		// state = state.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(addComment)) {
				decorations = decorations.update({
					add: e.value.selection.ranges.map((range) =>
						// Create a decoration for each range of selections
						// (multiple selections are possible)
						commentMark.range(range.from, range.to),
					),
				});
			}
			// There is no check for e.is(removeComment) because
			// Using the keybinding will always create a comment

			// There is no check for e.is(updateComment) because
			// this StateField only handles the visual representations
			// of comments within the document, not the contents of
			// the comments themselves
		}
		return decorations;
	},
	provide: (f) => EditorView.decorations.from(f),
});
// export function redecorateComments(view: EditorView) {
// 	const state = view.state;
// 	const comments = state.field(commentField);
// 	// biome-ignore lint/complexity/noForEach: I like forEach
// 	comments.forEach((comment) => {
// 		state.field(commentDecorations).update({
// 			add: comment.selection.ranges.map((range) =>
// 				// Create a decoration for each range of selections
// 				// (multiple selections are possible)
// 				commentMark.range(range.from, range.to),
// 			),
// 		});
// 	});
// }
export const createCommentCommand: StateCommand = ({ state, dispatch }) => {
	if (!get(canCreateNewComment)) {
		return false;
	}
	dispatch(
		state.update({
			effects: [addComment.of({ selection: state.selection, text: "" })],
		}),
	);
	// Can only create one comment at a time
	canCreateNewComment.set(false);
	// canCreateNewComment will be set back to true when the text
	// input is finished
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
