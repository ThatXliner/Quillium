/**
 * pointerDrag.ts — Shared pointer-drag gesture primitive.
 *
 * One implementation of the drag plumbing that panel-resize handles need:
 * pointer capture on the handle, window-level move/up/cancel listeners (so
 * the gesture survives the pointer leaving the handle), body-level
 * user-select/cursor overrides for the duration, and guaranteed teardown.
 *
 * Pointer events (instead of mouse events) so drags work with touch on
 * tablets as well as a mouse on desktop.
 *
 * Used by PanelResizeController (AI sidebar) and the annotation panel's
 * width handle. NOT used by DocumentTabs' reorder drag: that gesture
 * deliberately avoids pointer capture (capture was the source of "stuck
 * dragging" there) and needs raw pointer coordinates for its FLIP math.
 */

export type PointerDragHandle = {
    /**
     * Tear down listeners and body style overrides WITHOUT firing onEnd.
     * For component unmount while a drag is in flight; a normal
     * pointerup/pointercancel fires onEnd and then tears down itself.
     */
    cancel: () => void;
};

export type PointerDragOptions = {
    /** Cursor to force on <body> for the duration of the drag. */
    cursor: string;
    /** Called on every pointermove with the delta from the drag origin. */
    onMove: (dx: number, dy: number, event: PointerEvent) => void;
    /** Called once on pointerup/pointercancel, before teardown. */
    onEnd?: () => void;
};

/**
 * Start a drag gesture from a pointerdown event on a handle element.
 * Prevents default and stops propagation of the initiating event.
 */
export function startPointerDrag(
    e: PointerEvent,
    { cursor, onMove, onEnd }: PointerDragOptions,
): PointerDragHandle {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    // Capture on the handle so move/up events keep flowing even when the
    // finger/cursor leaves the handle element.
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);

    const handleMove = (ev: PointerEvent) => {
        onMove(ev.clientX - startX, ev.clientY - startY, ev);
    };
    const teardown = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
    };
    const handleUp = () => {
        onEnd?.();
        teardown();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = cursor;

    return { cancel: teardown };
}
