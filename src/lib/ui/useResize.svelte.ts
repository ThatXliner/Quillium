/**
 * useResize.ts — Reusable resize logic for panels and modals.
 *
 * Provides a Svelte-friendly resize controller that handles mouse drag,
 * cursor changes, and clamping. Used by AISidebar, Annotations panel,
 * and RevisionModal.
 */

export type ResizeHandle = "left" | "right" | "top" | "bottom" | "corner";

export type ResizeConfig = {
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    /** Called on each resize move with new dimensions */
    onResize: (width: number | null, height: number | null) => void;
    /** Called when resize ends */
    onResizeEnd?: () => void;
};

export type ResizeState = {
    isResizing: boolean;
    startResize: (e: MouseEvent, handle: ResizeHandle, currentWidth: number, currentHeight: number) => void;
    cleanup: () => void;
};

/**
 * Creates a resize controller.
 *
 * Usage:
 * ```ts
 * const resize = createResizeController({
 *     minWidth: 200,
 *     maxWidth: 600,
 *     onResize: (w, h) => { width = w; height = h; },
 *     onResizeEnd: () => persistSettings(),
 * });
 * ```
 */
export function createResizeController(config: ResizeConfig): ResizeState {
    let isResizing = $state(false);
    let activeHandle: ResizeHandle | null = null;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;

    function getCursor(handle: ResizeHandle): string {
        switch (handle) {
            case "left":
            case "right":
                return "ew-resize";
            case "top":
            case "bottom":
                return "ns-resize";
            case "corner":
                return "nwse-resize";
        }
    }

    function onMove(e: MouseEvent) {
        if (!activeHandle) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newWidth: number | null = null;
        let newHeight: number | null = null;

        if (activeHandle === "right" || activeHandle === "corner") {
            const raw = startWidth + dx;
            newWidth = Math.min(
                config.maxWidth ?? Infinity,
                Math.max(config.minWidth ?? 0, raw),
            );
        } else if (activeHandle === "left") {
            const raw = startWidth - dx;
            newWidth = Math.min(
                config.maxWidth ?? Infinity,
                Math.max(config.minWidth ?? 0, raw),
            );
        }

        if (activeHandle === "bottom" || activeHandle === "corner") {
            const raw = startHeight + dy;
            newHeight = Math.min(
                config.maxHeight ?? Infinity,
                Math.max(config.minHeight ?? 0, raw),
            );
        } else if (activeHandle === "top") {
            const raw = startHeight - dy;
            newHeight = Math.min(
                config.maxHeight ?? Infinity,
                Math.max(config.minHeight ?? 0, raw),
            );
        }

        config.onResize(newWidth, newHeight);
    }

    function onEnd() {
        isResizing = false;
        activeHandle = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        config.onResizeEnd?.();
    }

    function startResize(
        e: MouseEvent,
        handle: ResizeHandle,
        currentWidth: number,
        currentHeight: number,
    ) {
        e.preventDefault();
        e.stopPropagation();
        activeHandle = handle;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = currentWidth;
        startHeight = currentHeight;
        isResizing = true;
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onEnd);
        document.body.style.userSelect = "none";
        document.body.style.cursor = getCursor(handle);
    }

    function cleanup() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);
    }

    return {
        get isResizing() {
            return isResizing;
        },
        startResize,
        cleanup,
    };
}
