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
} from "@codemirror/view";
import {
	StateField,
	StateEffect,
	type Transaction,
	type EditorSelection,
	Facet,
	type StateCommand,
} from "@codemirror/state";

export interface Comment {
	selection: EditorSelection;
	text?: string;
}

// XXX: No idea if this is the best way to do it
// Since I have my viewed contained elsewhere,
// a view plugin is not it.
// const commentUpdateHandler = Facet.define<(comments: Comment[]) => void>();
// Effect to CRUD comments, without the R
export const addComment = StateEffect.define<Comment>();
export const updateComment = StateEffect.define<Comment>();
//  TODO: maybe use IDs to optimize
export const removeComment = StateEffect.define<Comment>();
// // StateField to track comments
const commentField = StateField.define<Comment[]>({
	create(): Comment[] {
		return [];
	},
	update(state: Comment[], tr: Transaction): Comment[] {
		let comments = state;
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
		return comments;
	},
	toJSON(value: Comment[]) {
		return value;
	},
	fromJSON(value: unknown) {
		return value as Comment[];
	},
});
// const createCommentCommand: Command = (view) => {
// 	view.dispatch({selection:view.state.selection})
// 	dispatch({state.selection})
// 	return true;
// };
// Command to add a comment
// function addCommentCommand(state: EditorView): boolean {
// 	let { from, to } = view.state.selection.main;
// 	let text = prompt("Enter comment:");
// 	if (text) {
// 		view.dispatch({
// 			effects: addComment.of({ from, to, text }),
// 		});
// 	}
// 	return true;
// }
// TODO: a faucet for storing config
// export const commentKeymap: KeyBinding[] = [
// 	{
// 		key: "Mod-Alt-m",
// 		run: createCommentCommand,
// 	},
// ];
// Extension
export const comments = () => [
	commentField,
	// EditorView.domEventHandlers({
	// 	contextmenu: (event: MouseEvent, view: EditorView) => {
	// 		event.preventDefault();
	// 		addCommentCommand(view);
	// 	},
	// }),
];
