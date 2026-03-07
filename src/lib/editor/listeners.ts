/**
 * listeners.ts — CodeMirror update listeners for persistence and
 * change reactions.
 *
 * Role: Provides the `listeners()` factory that returns an array of
 * CodeMirror extensions responsible for reacting to editor state
 * changes. Currently the only built-in listener is the auto-save
 * listener that serialises the editor state to the Tauri backend.
 *
 * Key dependencies:
 *   - ./extensions (savedFields) — determines which StateFields are
 *     included in the serialised JSON snapshot
 *   - Tauri invoke("save") — writes the serialised state to disk
 *   - ./plugins/annotations (annotationsChanged) — detects whether
 *     an update includes annotation mutations
 *
 * Interactions:
 *   - extensions.ts includes `listeners(options)` in the extension
 *     stack so these listeners are active for every EditorView.
 *   - The save listener fires after every transaction and only
 *     writes to disk when the document or annotations actually
 *     changed, keeping I/O to a minimum.
 */
import { savedFields } from "./extensions";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { annotationsChanged } from "./plugins/annotations";
export interface ListenerOptions {
  updateListener?: (update: ViewUpdate) => void;
  persist?: boolean;
  // onCommentChanged?: (comments: Comment[]) => void;
}

/**
 * Serialises the current editor state (including history and
 * annotations) and sends it to the Tauri backend for persistence.
 */
function persistStateToDisk(update: ViewUpdate) {
  const state = JSON.stringify(update.state.toJSON(savedFields));
  invoke("save", { state })
    .then((success) => {
      console.log("saved", success);
    })
    .catch((error) => {
      console.error("save failed", error);
    });
}

// ── Auto-save listener ────────────────────────────────────────────
// Uses EditorView.updateListener (post-transaction, read-only).
// Chosen over transactionFilter/transactionExtender because we only
// need to *react* to changes, not modify them.
//
// State: none of its own — it reads the latest EditorState from
// the ViewUpdate on every firing.
// Triggers: any CodeMirror transaction (keystrokes, programmatic
// dispatches, undo/redo).
// Guard: only persists when the document text or annotation state
// actually changed, avoiding redundant disk writes on pure
// selection or scroll updates.
// Downstream: Tauri invoke("save") writes to the filesystem.
//
// Future consideration: debounce to reduce write frequency.
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
    console.log(update.transactions, update.changes);
    if (update.docChanged || annotationsChanged(update)) {
      persistStateToDisk(update);
    }
  });
export const listeners = (options?: ListenerOptions) => [
  ...(options?.persist === false ? [] : [save]),
  // ...(options?.onCommentChanged
  // 	? [onCommentChanged(options.onCommentChanged)]
  // 	: []),
  ...(options?.updateListener
    ? [EditorView.updateListener.of(options.updateListener)]
    : []),
];
