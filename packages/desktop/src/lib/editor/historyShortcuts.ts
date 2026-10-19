/**
 * historyShortcuts.ts — Route undo/redo from writing controls to the root editor.
 * Button clicks move focus outside CodeMirror; removed buttons leave it on body.
 * Use the installed keymap so live collaboration retains its undo authority.
 */
import { dev } from "$app/environment";
import { EditorState } from "@codemirror/state";
import { type EditorView, ViewPlugin, runScopeHandlers } from "@codemirror/view";

export function historyKeyDirection(event: KeyboardEvent): "undo" | "redo" | undefined {
    if (event.defaultPrevented || event.isComposing || event.altKey) return;
    const key = event.key.toLowerCase();
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const mod = mac ? event.metaKey : event.ctrlKey;
    if (key === "z" && (mod || (dev && (event.metaKey || event.ctrlKey))))
        return event.shiftKey ? "redo" : "undo";
    if (key === "y" && !event.shiftKey && mod) return "redo";
}

export function historyTarget(
    target: EventTarget | null,
    view: EditorView | null,
): "editor" | "control" | undefined {
    const ownerDocument = view?.dom.ownerDocument ?? document;
    if (target === ownerDocument.defaultView) return "control";
    if (!(target instanceof Element)) return;
    if (target.closest("input, textarea, select")) return;
    const editor = target.closest(".cm-editor");
    if (!editor && target.closest('[contenteditable]:not([contenteditable="false"])')) return;
    const dialog = target.closest('dialog, [role="dialog"]');
    if (dialog && !dialog.hasAttribute("data-editor-history")) return;
    const shell = view?.dom.closest(".editor-shell");
    const inSurface = view
        ? view.dom.contains(target) || !!shell?.contains(target)
        : !!target.closest(".editor-shell");
    if (!inSurface && !dialog && target !== ownerDocument.body) return;
    return editor ? "editor" : "control";
}

export const editorHistoryShortcuts = ViewPlugin.define((view: EditorView) => {
    const ownerWindow = view.dom.ownerDocument.defaultView;
    function onKeydown(event: KeyboardEvent): void {
        if (!historyKeyDirection(event) || view.state.facet(EditorState.readOnly)) return;
        if (historyTarget(event.target, view) !== "control") return;
        if (runScopeHandlers(view, event, "editor")) event.preventDefault();
    }
    ownerWindow?.addEventListener("keydown", onKeydown);
    return { destroy: () => ownerWindow?.removeEventListener("keydown", onKeydown) };
});
