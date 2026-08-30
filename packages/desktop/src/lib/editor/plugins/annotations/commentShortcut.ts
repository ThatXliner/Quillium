/**
 * commentShortcut.ts — Physical-key fallback for the macOS comment shortcut.
 *
 * Option-letter combinations can change KeyboardEvent.key into a layout character
 * such as "µ". KeyboardEvent.code remains "KeyM", so this check gives the established
 * Command-Option-M shortcut a layout-independent fallback after CodeMirror's keymap.
 */

export function isPhysicalMacCommentShortcut(event: KeyboardEvent): boolean {
    return (
        event.code === "KeyM" &&
        event.metaKey &&
        event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.isComposing
    );
}
