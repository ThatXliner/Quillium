import {
	autocompletion,
	closeBrackets,
	closeBracketsKeymap,
	completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { history, historyField, historyKeymap } from "@codemirror/commands";
import {
	bracketMatching,
	defaultHighlightStyle,
	syntaxHighlighting,
} from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
	EditorView,
	dropCursor,
	highlightSpecialChars,
	keymap,
} from "@codemirror/view";
import { annotationField } from "./plugins/annotations";
import { comments, commentKeymap } from "./plugins/annotations";
import { type ListenerOptions, listeners } from "./listeners";
export const savedFields = { historyField, annotationField };

export const getExtensions = (options?: ListenerOptions) => [
	highlightSpecialChars(),
	// Default is 500 milliseconds
	// but I find that too long
	history({ newGroupDelay: 250 }),
	// Will re-enable for multi-selection support
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
		indentWithTab,
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
