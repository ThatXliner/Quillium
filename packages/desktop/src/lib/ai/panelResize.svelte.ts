/**
 * panelResize.svelte.ts — Drag-resize controller for the AI sidebar panel.
 *
 * Owns the custom width/height overrides (null = use the tab's default size)
 * and the pointer-drag lifecycle. Pointer events (instead of mouse events) so
 * dragging the resize handles works with touch on tablets as well as a mouse
 * on desktop; the pointer is captured on the handle element so move/up events
 * keep flowing even when the finger/cursor leaves the handle.
 *
 * The caller supplies the effective size at drag start (custom override or
 * tab default) via `getEffectiveSize`, and must call `destroy()` on unmount
 * to drop any in-flight window listeners.
 */

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

    // Plain fields — only used inside handlers, never rendered.
    #startX = 0;
    #startY = 0;
    #startWidth = 0;
    #startHeight = 0;
    #activeHandle: ResizeHandle | null = null;
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

    start = (e: PointerEvent, handle: ResizeHandle) => {
        e.preventDefault();
        e.stopPropagation();
        this.#activeHandle = handle;
        this.#startX = e.clientX;
        this.#startY = e.clientY;
        const { width, height } = this.#options.getEffectiveSize();
        this.#startWidth = width;
        this.#startHeight = height;
        this.isResizing = true;
        (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
        window.addEventListener("pointermove", this.#onMove);
        window.addEventListener("pointerup", this.#onEnd);
        window.addEventListener("pointercancel", this.#onEnd);
        document.body.style.userSelect = "none";
        document.body.style.cursor =
            handle === "right" ? "ew-resize" : handle === "bottom" ? "ns-resize" : "nwse-resize";
    };

    #onMove = (e: PointerEvent) => {
        if (!this.#activeHandle) return;
        const dx = e.clientX - this.#startX;
        const dy = e.clientY - this.#startY;
        if (this.#activeHandle === "right" || this.#activeHandle === "corner") {
            this.customWidth = Math.min(
                this.#widthCap(),
                Math.max(this.#options.minWidth, this.#startWidth + dx),
            );
        }
        if (this.#activeHandle === "bottom" || this.#activeHandle === "corner") {
            this.customHeight = Math.min(
                this.#heightCap(),
                Math.max(this.#options.minHeight, this.#startHeight + dy),
            );
        }
    };

    #onEnd = () => {
        this.isResizing = false;
        this.#activeHandle = null;
        this.#justResized = true;
        this.#removeListeners();
    };

    #removeListeners() {
        window.removeEventListener("pointermove", this.#onMove);
        window.removeEventListener("pointerup", this.#onEnd);
        window.removeEventListener("pointercancel", this.#onEnd);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
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

    /** Remove any in-flight window listeners; call on component unmount. */
    destroy() {
        this.#removeListeners();
    }
}
