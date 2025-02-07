import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import {
	StateField,
	StateEffect,
	Transaction,
	EditorState,
	EditorSelection,
} from "@codemirror/state";
import { Tooltip, showTooltip } from "@codemirror/view";

interface Comment {
	selection: EditorSelection;
	// TODO; support conversation threads within comments
	text: string;
}

// Effect to add/remove comments
const addComment = StateEffect.define<Comment>();
// TODO: maybe use IDs to optimize
const removeComment = StateEffect.define<Comment>();
// StateField to track comments
const commentField = StateField.define<Comment[]>({
	create(): Comment[] {
		return [];
	},
	update(state: Comment[], tr: Transaction): Comment[] {
		let comments = state;
		for (const e of tr.effects) {
			if (e.is(addComment)) {
				comments = [...comments, e.value];
			} else if (e.is(removeComment)) {
				comments = comments.filter(
					(c) =>
						!(c.selection.eq(e.value.selection) && e.value.text === c.text),
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
	// provide: (field) =>
	// //EditorState.field(field)
	// showTooltip.from(f, (state) =>
	// 	state.map((comment) => ({
	// 		pos: comment.from,
	// 		above: true,
	// 		create: () => {
	// 			let dom = document.createElement("div");
	// 			dom.textContent = comment.text;
	// 			dom.className = "comment-tooltip";
	// 			return { dom };
	// 		},
	// 	})),
	// ),
});

// Decoration to highlight commented text
const commentDeco = () =>
	Decoration.mark({
		class: "comment-highlight",
	});

// const commentDecorations = StateField.define<Decoration.Set>({
// 	create(): Decoration.Set {
// 		return Decoration.none;
// 	},
// 	update(value: Decoration.Set, tr: Transaction): Decoration.Set {
// 		value = value.map(tr.changes);
// 		for (let e of tr.effects) {
// 			if (e.is(addComment)) {
// 				value = value.update({ add: [commentDeco(e.value.from, e.value.to)] });
// 			}
// 		}
// 		return value;
// 	},
// 	provide: (f) => EditorView.decorations.from(f),
// });

// Command to add a comment
function addCommentCommand(view: EditorView): boolean {
	let { from, to } = view.state.selection.main;
	let text = prompt("Enter comment:");
	if (text) {
		view.dispatch({
			effects: addComment.of({ from, to, text }),
		});
	}
	return true;
}

// Extension
export const commentPlugin = [
	commentField,
	commentDecorations,
	EditorView.domEventHandlers({
		contextmenu: (event: MouseEvent, view: EditorView) => {
			event.preventDefault();
			addCommentCommand(view);
		},
	}),
];
