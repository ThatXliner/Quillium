/**
 * pointerDrag.ts — Shared pointer-drag gesture for resize handles.
 *
 * `pointerDrag` is a Svelte action (`use:pointerDrag={options}`): it attaches
 * the pointerdown listener to the handle element and tears everything down on
 * unmount, including an in-flight drag (silent cancel — `onEnd` only fires
 * for a real pointerup/pointercancel).
 *
 * One implementation of the plumbing every drag handle needs: pointer capture
 * on the handle, window-level move/up/cancel listeners (so the gesture
 * survives the pointer leaving the handle), and body-level user-select/cursor
 * overrides for the duration. Pointer events (instead of mouse events) so
 * drags work with touch on tablets as well as a mouse on desktop.
 *
 * Used by PanelResizeController (AI sidebar) and the annotation panel's
 * width handle. NOT used by DocumentTabs' reorder drag: that gesture
 * deliberately avoids pointer capture (capture was the source of "stuck
 * dragging" there) and needs raw pointer coordinates for its FLIP math.
 */

import type { ActionReturn } from "svelte/action";

export type PointerDragOptions = {
    /** Cursor to force on <body> for the duration of the drag. */
    cursor: string;
    /** Called on pointerdown, before any onMove — capture drag-start values here. */
    onStart?: (event: PointerEvent) => void;
    /** Called on every pointermove with the delta from the drag origin. */
    onMove: (dx: number, dy: number, event: PointerEvent) => void;
    /** Called once on pointerup/pointercancel (not on unmount-cancel). */
    onEnd?: () => void;
};

type ActiveDrag = { cancel: () => void };

/** The gesture core; the `pointerDrag` action wires it to an element. */
function beginDrag(e: PointerEvent, options: () => PointerDragOptions): ActiveDrag {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    // Capture on the handle so move/up events keep flowing even when the
    // finger/cursor leaves the handle element.
    (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);

    const handleMove = (ev: PointerEvent) => {
        options().onMove(ev.clientX - startX, ev.clientY - startY, ev);
    };
    const teardown = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
    };
    const handleUp = () => {
        options().onEnd?.();
        teardown();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = options().cursor;

    return { cancel: teardown };
}

/**
 * Svelte action: `use:pointerDrag={{ cursor, onStart, onMove, onEnd }}`.
 * Reads the latest options at event time, so reactive option objects
 * (recreated on re-render) never leave stale closures behind.
 */
export function pointerDrag(
    node: HTMLElement,
    options: PointerDragOptions,
): ActionReturn<PointerDragOptions> {
    let current = options;
    let active: ActiveDrag | null = null;

    const onPointerDown = (e: PointerEvent) => {
        current.onStart?.(e);
        active = beginDrag(e, () => current);
    };
    node.addEventListener("pointerdown", onPointerDown);

    return {
        update(next) {
            current = next;
        },
        destroy() {
            node.removeEventListener("pointerdown", onPointerDown);
            // Unmount mid-drag: tear down silently (no onEnd).
            active?.cancel();
            active = null;
        },
    };
}
