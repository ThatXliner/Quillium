<script lang="ts">
/**
 * ModalResizeHandles.svelte — Sidebar-style resize handles for a centered modal surface.
 * Place directly inside the surface, not its full-screen backdrop. Sizes last until unmount.
 */
import { onMount } from "svelte";
import ResizeHandles, { type ResizeHandle } from "../resize/ResizeHandles.svelte";
import type { PointerDragOptions } from "../resize/pointerDrag";

let {
    minWidth = 320,
    minHeight = 280,
    contentSelector,
}: {
    minWidth?: number;
    minHeight?: number;
    /** For two-layer glass shells, reserve the reset footer inside the painted layer. */
    contentSelector?: string;
} = $props();

let anchor = $state<HTMLDivElement>();
let surface: HTMLElement;
let contentSurface: HTMLElement;
let resizing = $state(false);
let isCustomSize = $state(false);
let originalWidth = "";
let originalHeight = "";
let defaultMaxWidth = "";
let defaultMaxHeight = "";
let originalTransition = "";
let originalPaddingBottom = "";
let paddingBottom = 0;

onMount(() => {
    const parent = anchor?.parentElement;
    if (!parent) return;
    surface = parent;
    contentSurface =
        (contentSelector && surface.querySelector<HTMLElement>(contentSelector)) || surface;
    originalWidth = surface.style.width;
    originalHeight = surface.style.height;
    const originalPosition = surface.style.position;
    const originalMaxWidth = surface.style.maxWidth;
    const originalMaxHeight = surface.style.maxHeight;
    const computed = getComputedStyle(surface);
    defaultMaxWidth = `min(${computed.maxWidth === "none" ? "100vw" : computed.maxWidth}, calc(100vw - 32px))`;
    defaultMaxHeight = `min(${computed.maxHeight === "none" ? "100dvh" : computed.maxHeight}, calc(100dvh - 32px))`;
    originalTransition = surface.style.transition;
    originalPaddingBottom = contentSurface.style.paddingBottom;
    paddingBottom = Number.parseFloat(getComputedStyle(contentSurface).paddingBottom) || 0;
    if (computed.position === "static") surface.style.position = "relative";
    surface.style.maxWidth = defaultMaxWidth;
    surface.style.maxHeight = defaultMaxHeight;
    return () => {
        surface.style.width = originalWidth;
        surface.style.height = originalHeight;
        surface.style.position = originalPosition;
        surface.style.transition = originalTransition;
        contentSurface.style.paddingBottom = originalPaddingBottom;
        surface.style.maxWidth = originalMaxWidth;
        surface.style.maxHeight = originalMaxHeight;
    };
});

function resize(handle: ResizeHandle, width: number, height: number): void {
    if (!isCustomSize) {
        // Reserve a footer for Restore without covering content or changing the outer height.
        surface.style.height = `${surface.getBoundingClientRect().height}px`;
        contentSurface.style.paddingBottom = `${paddingBottom + 36}px`;
        isCustomSize = true;
    }
    if (handle !== "bottom") {
        surface.style.maxWidth = "calc(100vw - 32px)";
        surface.style.width = `${Math.min(window.innerWidth - 32, Math.max(minWidth, width))}px`;
    }
    if (handle !== "right") {
        surface.style.maxHeight = "calc(100dvh - 32px)";
        surface.style.height = `${Math.min(window.innerHeight - 32, Math.max(minHeight, height))}px`;
    }
}

function dragOptions(handle: ResizeHandle): PointerDragOptions {
    let width = 0;
    let height = 0;
    return {
        cursor:
            handle === "right" ? "ew-resize" : handle === "bottom" ? "ns-resize" : "nwse-resize",
        onStart: () => {
            ({ width, height } = surface.getBoundingClientRect());
            surface.style.transition = "none";
            resizing = true;
        },
        // The opposite edge moves too because the modal stays centered.
        onMove: (dx, dy) => resize(handle, width + dx * 2, height + dy * 2),
        onEnd: () => {
            surface.style.transition = originalTransition;
            resizing = false;
        },
    };
}

function reset(): void {
    isCustomSize = false;
    contentSurface.style.paddingBottom = originalPaddingBottom;
    surface.style.maxWidth = defaultMaxWidth;
    surface.style.maxHeight = defaultMaxHeight;
    surface.style.width = originalWidth;
    surface.style.height = originalHeight;
}

function resizeBy(handle: ResizeHandle, dx: number, dy: number): void {
    const { width, height } = surface.getBoundingClientRect();
    resize(handle, width + dx, height + dy);
}
</script>

<ResizeHandles
    bind:element={anchor}
    label="modal"
    {dragOptions}
    {resizing}
    showReset={isCustomSize}
    onResizeBy={resizeBy}
    onReset={reset}
/>
