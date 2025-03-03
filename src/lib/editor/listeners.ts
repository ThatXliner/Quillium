import { savedFields } from "./extensions";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { annotationsChanged } from "./plugins/annotations";
export interface ListenerOptions {
	updateListener?: (update: ViewUpdate) => void;
	// onCommentChanged?: (comments: Comment[]) => void;
}

const save =
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
	// Therefore, I use the simplest approach. In the future,
	// I might want to debounce this
	EditorView.updateListener.of((update: ViewUpdate) => {
		if (update.docChanged || annotationsChanged(update)) {
			const state = JSON.stringify(update.state.toJSON(savedFields));
			invoke("save", { state }).then((success) => {
				console.log("saved", success);
			});
		}
	});
export const listeners = (options?: ListenerOptions) => [
	save,
	// ...(options?.onCommentChanged
	// 	? [onCommentChanged(options.onCommentChanged)]
	// 	: []),
	...(options?.updateListener
		? [EditorView.updateListener.of(options.updateListener)]
		: []),
];
