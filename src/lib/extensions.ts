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

interface GetExtensionOptions {
	onSaved?: (state: EditorState) => void;
}
export const getExtensions = (options?: GetExtensionOptions) => [
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
	// rectangularSelection(),
	// highlightSelectionMatches(),
	keymap.of([
		...closeBracketsKeymap,
		...defaultKeymap,
		// ...searchKeymap,
		...historyKeymap,
		// ...foldKeymap,
		...completionKeymap,
		...lintKeymap,
	]),
	EditorView.lineWrapping,
	EditorView.contentAttributes.of({
		spellcheck: "true",
		autocorrect: "on",
		autocapitalize: "on",
	}),
	// There are 3 different approaches to
	// reacting to state changes or transactions. This is what Claude says
	// > Here's how these approaches differ:
	// > 1. `EditorView.updateListener`:
	// >    - Runs after the transaction is applied
	// >    - Best for reactive updates like UI changes
	// >    - Cannot modify the transaction
	// >    - Simpler to implement
	// >    - Good for most use cases where you just need to respond to changes
	// > 2. `EditorState.transactionFilter`:
	// >    - Runs before the transaction is applied
	// >    - Can modify or cancel the transaction
	// >    - Access to both previous and new state
	// >    - Good for validation or preventing certain history changes
	// >    - More complex but more powerful
	// > 3. `EditorState.transactionExtender`:
	// >    - Runs after filters but before the transaction is applied
	// >    - Can add effects but cannot modify the transaction
	// >    - Good for adding metadata or triggering side effects
	// >    - Middle ground between filter and listener
	//
	// > For most cases where you just want to track history changes, `EditorView.updateListener` is probably the simplest and most straightforward approach. Use `transactionFilter` if you need to:
	// > - Prevent certain undo/redo operations
	// > - Modify the history state before it changes
	// > - Need access to both the previous and new state
	//
	// Therefore, I use the simplest approach
	EditorView.updateListener.of((update: ViewUpdate) => {
		if (update.docChanged) {
			const history = update.state.field(historyField);
			const state = JSON.stringify(update.state.toJSON({ historyField }));
			invoke("save", { state }).then((success) => {
				console.log("saved", success);
			});
		}
	}),
];
