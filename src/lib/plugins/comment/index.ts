import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { Tooltip, showTooltip } from "@codemirror/view";

// Effect to add/remove comments
const addComment = StateEffect.define();
const removeComment = StateEffect.define();

// StateField to track comments
const commentField = StateField.define({
	create() {
		return [];
	},
	update(comments, tr) {
		for (let e of tr.effects) {
			if (e.is(addComment)) {
				comments = [...comments, e.value];
			} else if (e.is(removeComment)) {
				comments = comments.filter((c) => c.from !== e.value.from);
			}
		}
		return comments;
	},
	provide: (f) =>
		showTooltip.from(f, (state) =>
			state.field(f).map((comment) => ({
				pos: comment.from,
				above: true,
				create: () => {
					let dom = document.createElement("div");
					dom.textContent = comment.text;
					dom.className = "comment-tooltip";
					return { dom };
				},
			})),
		),
});

// Decoration to highlight commented text
const commentDeco = (from, to) =>
	Decoration.mark({
		class: "comment-highlight",
	});

const commentDecorations = StateField.define({
	create() {
		return Decoration.none;
	},
	update(value, tr) {
		value = value.map(tr.changes);
		for (let e of tr.effects) {
			if (e.is(addComment)) {
				value = value.update({ add: [commentDeco(e.value.from, e.value.to)] });
			}
		}
		return value;
	},
	provide: (f) => EditorView.decorations.from(f),
});

// Command to add a comment
function addCommentCommand(view) {
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
		contextmenu: (event, view) => {
			event.preventDefault();
			addCommentCommand(view);
		},
	}),
];
