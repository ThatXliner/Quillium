import { canCreateNewComment } from "$lib/stores";
import { invertedEffects } from "@codemirror/commands";
import {
	EditorSelection,
	type EditorState,
	RangeSetBuilder,
	type SelectionRange,
	type StateCommand,
	StateEffect,
	StateField,
	type Transaction,
} from "@codemirror/state";
// All this plugin does is
// Highlight text and store which selections (including sub-selections)
// were highlighted. Users of this plugin can provide
// update handlers via Facets.
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	type KeyBinding,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
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

function cleanRangesOf(selection: EditorSelection) {
	const newRanges = selection.ranges.filter(
		(range) => range.from !== range.to,
	);
	return newRanges.length > 0
		? EditorSelection.create(newRanges, selection.mainIndex)
		: null;
}
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
						!(
							c.selection.eq(e.value.selection) &&
							e.value.text === c.text
						),
				);
			} else if (e.is(updateComment)) {
				comments = comments.map((c) =>
					c.selection.eq(e.value.selection)
						? { ...c, text: e.value.text }
						: c,
				);
			}
		}
		// Map our old comments to the new state
		// ranges, as we don't want our comments/highlighted portion
		// to be static markers of a row and column but instead change with te
		comments = comments
			.map((x) => ({
				selection: cleanRangesOf(x.selection.map(tr.changes, 0)),
				text: x.text,
			}))
			.filter((x) => x.selection !== null) as Comment[];

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
	update.startState
		.field(commentField)
		.every((val, idx) => val === update.state.field(commentField)[idx]) ||
	update.transactions.some((tr) =>
		tr.effects.some(
			(e) =>
				e.is(addComment) || e.is(updateComment) || e.is(removeComment),
		),
	); // || update.state.
// .map((x) => ({
// 	selection: cleanRangesOf(x.selection.map(tr.changes)),
// 	text: x.text,
// }))
// .filter((x) => x.selection.ranges.length > 0);
function positionIntersects(position: number, selection: SelectionRange) {
	return selection.from <= position && position <= selection.to;
}
export function getActiveComment(state: EditorState) {
	const cursor = state.selection.main;
	const cursorPos = cursor.head;
	const comments = state.field(commentField);
	const rangesWhereCursorIsInside: {
		range: SelectionRange;
		associatedComment: Comment;
	}[] = [];
	for (const comment of comments) {
		if (comment.text === "") return comment;
		for (const range of comment.selection.ranges)
			if (
				positionIntersects(cursorPos, range) &&
				// Having this extra condition makes it feel like Google docs
				// Basically what this is doing that if the cursor is a selection,
				// we only want to show the comment if the entire selection is within
				// a single comment
				(!cursor.empty
					? positionIntersects(cursor.anchor, range)
					: true)
			) {
				rangesWhereCursorIsInside.push({
					range,
					associatedComment: comment,
				});
			}
	}
	return rangesWhereCursorIsInside.sort(
		(a, b) => a.range.to - a.range.from - (b.range.to - b.range.from),
	)?.[0]?.associatedComment;
}
const commentDecorations = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.getDecorations(view);
		}

		update(update: ViewUpdate) {
			// update.selectionSet also means "if cursor changed"
			if (
				update.selectionSet ||
				update.docChanged ||
				commentsChanged(update)
			) {
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

			const activeRanges: readonly SelectionRange[] =
				getActiveComment(view.state)?.selection?.ranges ?? [];
			// If you don't add comments in order, the plugin will crash
			commentRanges.sort((a, b) => a.from - b.from);

			// TODO: care about multiple selections
			const toHighlight = [
				...commentRanges.map((x) => ({
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
						class: active ? "cm-highlight-active" : "cm-highlight",
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
	// TODO: multi selection support
	if (state.selection.main.empty) return false;
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
	invertedEffects.of((transaction: Transaction) => {
		for (const effect of transaction.effects) {
			if (effect.is(addComment)) {
				return [removeComment.of(effect.value)];
			}
			if (effect.is(removeComment)) {
				return [addComment.of(effect.value)];
			}
			return [
				updateComment.of({
					...effect.value,
					// biome-ignore lint/style/noNonNullAssertion: Guaranteed to exist
					text: transaction.startState
						.field(commentField)
						.find((c) => c.selection.eq(effect.value.selection))!
						.text,
				}),
			];
		}
		return [];
	}),
	// EditorState.transactionExtender.of((transaction: Transaction) => { })
	// EditorView.domEventHandlers({
	// 	contextmenu: (event: MouseEvent, view: EditorView) => {
	// 		event.preventDefault();
	// 		addCommentCommand(view);
	// 	},
	// }),
];
