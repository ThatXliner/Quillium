// Prevent the modal-level shortcut handling (`Ctrl-[`, `Ctrl-]`, `Mod+Enter`) from
// running when a nested CodeMirror editor already handled the keys.
export function shouldHandleRevisionModalKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return false;
    const target = event.target;
    if (target instanceof Element && target.closest(".cm-editor")) return false;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return false;

    return true;
}
