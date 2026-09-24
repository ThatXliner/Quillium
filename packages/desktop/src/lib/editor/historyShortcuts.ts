/**
 * historyShortcuts.ts — Route undo/redo from writing controls to the root editor.
 * Button clicks move focus outside CodeMirror; removed buttons leave it on body.
 * Use the installed keymap so live collaboration retains its undo authority.
 */
import { EditorState } from "@codemirror/state";
import { type EditorView, ViewPlugin, runScopeHandlers } from "@codemirror/view";

export const editorHistoryShortcuts = ViewPlugin.define((view: EditorView) => {
    const ownerWindow = view.dom.ownerDocument.defaultView;
    function onKeydown(event: KeyboardEvent): void {
        if (event.defaultPrevented || event.isComposing || event.altKey) return;
        if (!(event.metaKey || event.ctrlKey) || !["z", "y"].includes(event.key.toLowerCase()))
            return;
        if (view.state.facet(EditorState.readOnly)) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        // Native text fields own their history, and CodeMirror already handled
        // events from its editors (including delegation from nested editors).
        if (
            target.closest(
                '.cm-editor, input, textarea, select, [contenteditable]:not([contenteditable="false"])',
            )
        )
            return;
        const dialog = target.closest("dialog, [role=dialog]");
        if (dialog && !dialog.hasAttribute("data-editor-history")) return;
        const shell = view.dom.closest(".editor-shell");
        if (
            target !== view.dom.ownerDocument.body &&
            !shell?.contains(target) &&
            !dialog?.hasAttribute("data-editor-history")
        )
            return;
        if (runScopeHandlers(view, event, "editor")) event.preventDefault();
    }
    ownerWindow?.addEventListener("keydown", onKeydown);
    return { destroy: () => ownerWindow?.removeEventListener("keydown", onKeydown) };
});
