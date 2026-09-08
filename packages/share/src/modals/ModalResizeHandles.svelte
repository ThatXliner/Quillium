<script lang="ts">
/**
 * ModalResizeHandles.svelte — Sidebar-style resize handles for a centered modal surface.
 * Place directly inside the surface, not its full-screen backdrop. Sizes last until unmount.
 */
import { onMount } from "svelte";
import { type PointerDragOptions, pointerDrag } from "./pointerDrag";

let { minWidth = 320 }: { minWidth?: number } = $props();

const handles = ["right", "bottom", "corner"] as const;
type Handle = "right" | "bottom" | "corner";
let anchor: HTMLDivElement;
let surface: HTMLElement;
let resizing = $state(false);
let originalWidth = "";
let originalHeight = "";
let defaultMaxWidth = "";
let defaultMaxHeight = "";
let originalTransition = "";

onMount(() => {
    const parent = anchor.parentElement;
    if (!parent) return;
    surface = parent;
    originalWidth = surface.style.width;
    originalHeight = surface.style.height;
    const originalPosition = surface.style.position;
    const originalMaxWidth = surface.style.maxWidth;
    const originalMaxHeight = surface.style.maxHeight;
    const computed = getComputedStyle(surface);
    defaultMaxWidth = `min(${computed.maxWidth === "none" ? "100vw" : computed.maxWidth}, calc(100vw - 32px))`;
    defaultMaxHeight = `min(${computed.maxHeight === "none" ? "100dvh" : computed.maxHeight}, calc(100dvh - 32px))`;
    originalTransition = surface.style.transition;
    if (computed.position === "static") surface.style.position = "relative";
    surface.style.maxWidth = defaultMaxWidth;
    surface.style.maxHeight = defaultMaxHeight;
    return () => {
        surface.style.width = originalWidth;
        surface.style.height = originalHeight;
        surface.style.position = originalPosition;
        surface.style.transition = originalTransition;
        surface.style.maxWidth = originalMaxWidth;
        surface.style.maxHeight = originalMaxHeight;
    };
});

function resize(handle: Handle, width: number, height: number): void {
    if (handle !== "bottom") {
        surface.style.maxWidth = "calc(100vw - 32px)";
        surface.style.width = `${Math.min(window.innerWidth - 32, Math.max(minWidth, width))}px`;
    }
    if (handle !== "right") {
        surface.style.maxHeight = "calc(100dvh - 32px)";
        surface.style.height = `${Math.min(window.innerHeight - 32, Math.max(280, height))}px`;
    }
}

function dragOptions(handle: Handle): PointerDragOptions {
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
    surface.style.maxWidth = defaultMaxWidth;
    surface.style.maxHeight = defaultMaxHeight;
    surface.style.width = originalWidth;
    surface.style.height = originalHeight;
}

function onKeydown(event: KeyboardEvent, handle: Handle): void {
    if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        reset();
        return;
    }
    const dx = event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0;
    const dy = event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0;
    if ((!dx || handle === "bottom") && (!dy || handle === "right")) return;
    event.preventDefault();
    event.stopPropagation();
    const { width, height } = surface.getBoundingClientRect();
    resize(handle, width + dx, height + dy);
}
</script>

<div bind:this={anchor} class="modal-resize-handles" class:resizing>
    {#each handles as handle}
        <button
            type="button"
            class="handle {handle}"
            aria-label={handle === "right" ? "Resize modal width" : handle === "bottom" ? "Resize modal height" : "Resize modal"}
            title="Drag or use arrow keys to resize. Double-click or press Home to reset."
            use:pointerDrag={dragOptions(handle)}
            onkeydown={(event) => onKeydown(event, handle)}
            onclick={(event) => event.stopPropagation()}
            ondblclick={reset}
        ></button>
    {/each}
</div>

<style>
    .modal-resize-handles {
        position: absolute;
        inset: 0;
        z-index: 20;
        pointer-events: none;
        border-radius: inherit;
    }
    .handle {
        position: absolute;
        border: 0;
        padding: 0;
        background: transparent;
        touch-action: none;
        pointer-events: auto;
    }
    .right { top: 16px; bottom: 20px; right: 0; width: 10px; cursor: ew-resize; }
    .bottom { left: 16px; right: 20px; bottom: 0; height: 10px; cursor: ns-resize; }
    .corner { right: 0; bottom: 0; width: 20px; height: 20px; cursor: nwse-resize; }
    .handle::after {
        content: "";
        position: absolute;
        border-radius: 2px;
        background: var(--text, #000);
        opacity: 0;
        transition: opacity 200ms ease;
    }
    .right::after { top: 25%; bottom: 25%; right: 3px; width: 2px; }
    .bottom::after { left: 25%; right: 25%; bottom: 3px; height: 2px; }
    .corner::after {
        right: 5px;
        bottom: 5px;
        width: 6px;
        height: 6px;
        border-right: 2px solid var(--text, #000);
        border-bottom: 2px solid var(--text, #000);
        background: transparent;
        opacity: 0.2;
    }
    .handle:hover::after, .handle:focus-visible::after, .resizing .handle::after { opacity: 0.4; }
    .handle:focus-visible { outline: 2px solid var(--primary, #3b82f6); outline-offset: -2px; }
    @media (prefers-reduced-motion: reduce) {
        .handle::after { transition: none; }
    }
</style>
