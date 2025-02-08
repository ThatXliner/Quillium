import { EditorState } from "@codemirror/state";
import {
	EditorView,
	keymap,
	highlightSpecialChars,
	drawSelection,
	dropCursor,
	rectangularSelection,
	type ViewUpdate,
} from "@codemirror/view";
import {
	defaultHighlightStyle,
	syntaxHighlighting,
	bracketMatching,
} from "@codemirror/language";
import { defaultKeymap } from "@codemirror/commands";
import { history, historyKeymap, historyField } from "./plugins/history";
import {
	autocompletion,
	completionKeymap,
	closeBrackets,
	closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { invoke } from "@tauri-apps/api/core";
import { search, searchKeymap } from "@codemirror/search";
import {
	addComment,
	commentField,
	commentKeymap,
	comments,
	removeComment,
	updateComment,
	type Comment,
} from "./plugins/comments";
import { listeners, type ListenerOptions } from "./plugins/listeners";
export const savedFields = { historyField, commentField };

export const getExtensions = (options?: ListenerOptions) => [
	highlightSpecialChars(),
	// Default is 500 milliseconds
	// but I find that too long
	history({ newGroupDelay: 250 }),
	// May re-enable if it's needed
	// for a better UX when I add decorations/annotations
	// drawSelection(),
	dropCursor(),
	EditorState.allowMultipleSelections.of(true),
	bracketMatching(),
	closeBrackets(),
	autocompletion(),
	search(),
	// rectangularSelection(),
	// highlightSelectionMatches(),
	keymap.of([
		...closeBracketsKeymap,
		...defaultKeymap,
		...searchKeymap,
		...historyKeymap,
		// ...foldKeymap,
		...completionKeymap,
		...lintKeymap,
		...commentKeymap,
	]),
	EditorView.lineWrapping,
	EditorView.contentAttributes.of({
		spellcheck: "true",
		autocorrect: "on",
		autocapitalize: "on",
	}),
	listeners(options),
	comments(),
	...(options?.updateListener
		? [EditorView.updateListener.of(options.updateListener)]
		: []),
];
