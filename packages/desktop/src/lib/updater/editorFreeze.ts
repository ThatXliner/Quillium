// editorFreeze.ts — Reject editor mutations while a restart save barrier runs.
import { EditorState, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { editorMutationAllowed } from "./restartState";

export const restartMutationFilter = EditorState.transactionFilter.of((transaction) => {
    return editorMutationAllowed() ? transaction : [];
});

/** dispatchTransactions also covers producers that explicitly disable transaction filters. */
export function dispatchUnlessRestarting(
    transactions: readonly Transaction[],
    view: EditorView,
): void {
    if (!editorMutationAllowed()) return;
    view.update(transactions);
}
