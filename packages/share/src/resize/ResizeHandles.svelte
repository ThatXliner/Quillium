<script module lang="ts">
export type ResizeHandle = "right" | "bottom" | "corner";
</script>

<script lang="ts">
/** ResizeHandles.svelte — Shared edge/corner controls; hosts own sizing and anchoring. */
import { Minimize2 } from "lucide-svelte";
import { type PointerDragOptions, pointerDrag } from "./pointerDrag";

let {
    element = $bindable(),
    label,
    dragOptions,
    onResizeBy,
    onReset,
    resizing = false,
    showReset = false,
}: {
    element?: HTMLDivElement;
    label: string;
    dragOptions: (handle: ResizeHandle) => PointerDragOptions;
    onResizeBy: (handle: ResizeHandle, dx: number, dy: number) => void;
    onReset: () => void;
    resizing?: boolean;
    showReset?: boolean;
} = $props();

const handles = ["right", "bottom", "corner"] as const;

function onKeydown(event: KeyboardEvent, handle: ResizeHandle): void {
    if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        onReset();
        return;
    }
    const dx = event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0;
    const dy = event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0;
    if ((!dx || handle === "bottom") && (!dy || handle === "right")) return;
    event.preventDefault();
    event.stopPropagation();
    onResizeBy(handle, dx, dy);
}
</script>

<div bind:this={element} class="resize-handles" class:resizing>
    {#each handles as handle}
        <button
            type="button"
            class="handle {handle}"
            aria-label={`Resize ${label}${handle === "right" ? " width" : handle === "bottom" ? " height" : ""}`}
            title="Drag or use arrow keys to resize. Double-click or press Home to reset."
            use:pointerDrag={dragOptions(handle)}
            onkeydown={(event) => onKeydown(event, handle)}
            ondblclick={onReset}
        ></button>
    {/each}
    {#if showReset}
        <button
            type="button"
            class="restore-size"
            aria-label="Restore original size"
            title="Restore original size"
            onclick={onReset}
        ><Minimize2 size={12} /><span>Restore original size</span></button>
    {/if}
</div>

<style>
    .resize-handles {
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
    }
    .handle:hover::after, .handle:focus-visible::after, .resizing .handle::after { opacity: 0.4; }
    .restore-size {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 4px;
        height: 22px;
        padding: 0 8px;
        font-size: 11px;
        white-space: nowrap;
        border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
        border-radius: 999px;
        background: var(--surface, white);
        color: var(--text-soft, rgba(0, 0, 0, 0.5));
        pointer-events: auto;
        cursor: pointer;
    }
    .restore-size:hover { color: var(--text, rgba(0, 0, 0, 0.8)); }
    .handle:focus-visible, .restore-size:focus-visible { outline: 2px solid var(--primary, #3b82f6); outline-offset: -2px; }
    @media (prefers-reduced-motion: reduce) {
        .handle::after { transition: none; }
    }
</style>
