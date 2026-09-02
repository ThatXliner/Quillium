/**
 * commentShortcut.ts — Layout-independent comment chord matching.
 *
 * Match the physical comment chord instead of the layout-dependent event key.
 * Shift changes `event.key` casing, but `event.code` remains stable.
 */
export function isCommentShortcut(event: KeyboardEvent): boolean {
    return (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.code === "KeyM" &&
        !event.isComposing
    );
}
