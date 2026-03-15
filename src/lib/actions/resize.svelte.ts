/**
 * resize.ts — Reusable resize action for panel components.
 *
 * Provides `createResizer` which returns a `startResize` function and
 * reactive `isResizing` state. Handles mousemove/mouseup cleanup and
 * cursor overrides automatically.
 *
 * Usage:
 *   const { startResize, isResizing } = createResizer({
 *       direction: "right",          // which edge grows when dragging
 *       getSize: () => currentWidth,
 *       setSize: (w) => { width = w; },
 *       min: 240,
 *       max: 600,
 *   });
 *
 *   <div onmousedown={(e) => startResize(e)} />
 */

export type ResizeDirection = "right" | "left" | "bottom";

export interface ResizerOptions {
    /** Which edge is being dragged (determines axis and sign of delta). */
    direction: ResizeDirection;
    /** Returns the current size (width or height) before the drag starts. */
    getSize: () => number;
    /** Called with the new clamped size on every mousemove. */
    setSize: (size: number) => void;
    min: number;
    max: number;
    /** Override the CSS cursor during drag. Defaults to direction-based cursor. */
    cursor?: string;
    /** Called when drag ends (optional, for persistence). */
    onEnd?: (size: number) => void;
}

const CURSOR_MAP: Record<ResizeDirection, string> = {
    right: "ew-resize",
    left: "ew-resize",
    bottom: "ns-resize",
};

export function createResizer(options: ResizerOptions) {
    let isResizing = $state(false);

    // Plain vars — not reactive, only read inside handlers
    let startCoord = 0;
    let startSize = 0;

    function onMove(e: MouseEvent) {
        const coord = options.direction === "bottom" ? e.clientY : e.clientX;
        const delta = coord - startCoord;
        // "left" handle: dragging left (negative delta) grows the panel
        const signed = options.direction === "left" ? -delta : delta;
        const next = Math.min(options.max, Math.max(options.min, startSize + signed));
        options.setSize(next);
    }

    function onEnd() {
        isResizing = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        options.onEnd?.(options.getSize());
    }

    function startResize(e: MouseEvent, cursorOverride?: string) {
        e.preventDefault();
        e.stopPropagation();
        startCoord = options.direction === "bottom" ? e.clientY : e.clientX;
        startSize = options.getSize();
        isResizing = true;
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onEnd);
        document.body.style.userSelect = "none";
        document.body.style.cursor = cursorOverride ?? options.cursor ?? CURSOR_MAP[options.direction];
    }

    function cleanup() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
    }

    return {
        startResize,
        cleanup,
        get isResizing() {
            return isResizing;
        },
    };
}
