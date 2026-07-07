/**
 * panelResize.svelte.ts — Drag-resize controller for the AI sidebar panel.
 *
 * Owns the custom width/height overrides (null = use the tab's default size)
 * and the resize semantics (per-handle axes, min/max + viewport caps). The
 * drag gesture itself is the `pointerDrag` action from $lib/ui/pointerDrag:
 * each handle element gets `use:pointerDrag={controller.dragOptions(handle)}`,
 * and the action's own destroy covers unmount-mid-drag cleanup.
 *
 * The caller supplies the effective size at drag start (custom override or
 * tab default) via `getEffectiveSize`.
 */

import type { PointerDragOptions } from "$lib/ui/pointerDrag";

export type ResizeHandle = "right" | "bottom" | "corner";

export type PanelResizeOptions = {
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    /** Effective panel size right now (custom override or tab default). */
    getEffectiveSize: () => { width: number; height: number };
};

export class PanelResizeController {
    customWidth = $state<number | null>(null);
    customHeight = $state<number | null>(null);
    /** True during a drag — the panel disables CSS transitions while set. */
    isResizing = $state(false);

    #justResized = false;

    readonly #options: PanelResizeOptions;

    constructor(options: PanelResizeOptions) {
        this.#options = options;
    }

    // On narrow viewports the fixed max width/height overflow the screen, so
    // clamp to a viewport-relative cap. On desktop these caps are far larger
    // than the configured maxima, so behavior is unchanged there.
    #widthCap(): number {
        const { minWidth, maxWidth } = this.#options;
        if (typeof window === "undefined") return maxWidth;
        return Math.min(maxWidth, Math.max(minWidth, window.innerWidth - 32));
    }
    #heightCap(): number {
        const { minHeight, maxHeight } = this.#options;
        if (typeof window === "undefined") return maxHeight;
        return Math.min(maxHeight, Math.max(minHeight, window.innerHeight - 64));
    }

    /** Options for `use:pointerDrag` on the given resize handle. */
    dragOptions(handle: ResizeHandle): PointerDragOptions {
        // Captured on each drag start; onMove computes from these anchors.
        let startWidth = 0;
        let startHeight = 0;
        return {
            cursor:
                handle === "right"
                    ? "ew-resize"
                    : handle === "bottom"
                      ? "ns-resize"
                      : "nwse-resize",
            onStart: () => {
                ({ width: startWidth, height: startHeight } = this.#options.getEffectiveSize());
                this.isResizing = true;
            },
            onMove: (dx, dy) => {
                if (handle === "right" || handle === "corner") {
                    this.customWidth = Math.min(
                        this.#widthCap(),
                        Math.max(this.#options.minWidth, startWidth + dx),
                    );
                }
                if (handle === "bottom" || handle === "corner") {
                    this.customHeight = Math.min(
                        this.#heightCap(),
                        Math.max(this.#options.minHeight, startHeight + dy),
                    );
                }
            },
            onEnd: () => {
                this.isResizing = false;
                this.#justResized = true;
            },
        };
    }

    /**
     * True exactly once after a drag ends. The window click that ends a drag
     * would otherwise be treated as a click-outside and collapse the panel.
     */
    consumeJustResized(): boolean {
        if (!this.#justResized) return false;
        this.#justResized = false;
        return true;
    }

    reset() {
        this.customWidth = null;
        this.customHeight = null;
    }
}
