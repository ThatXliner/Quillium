<script lang="ts">
/**
 * AnnotationModalFrame.svelte — App-neutral modal surface shared by desktop and Web Preview.
 *
 * Hosts retain ownership of the outer overlay or native `<dialog>` lifecycle. This component owns
 * the resizable inner surface, including the default size for each annotation type.
 */
import type { Snippet } from "svelte";
import ModalResizeHandles from "./ModalResizeHandles.svelte";

let {
    variant,
    children,
    restoreSize = $bindable(),
}: {
    variant: "revision" | "comment" | "suggestion";
    children: Snippet;
    restoreSize?: () => void;
} = $props();

const modalWidth = $derived(
    variant === "revision" ? "1160px" : variant === "comment" ? "1060px" : "820px",
);
</script>

<div
    class="annotation-modal-frame annotation-modal-frame-{variant}"
    data-annotation-modal-frame={variant}
    data-annotation-modal-width={modalWidth}
    style:--annotation-modal-width={modalWidth}
>
    {@render children()}
    <ModalResizeHandles minWidth={640} bind:restoreSize />
</div>

<style>
    .annotation-modal-frame {
        display: flex;
        width: min(var(--annotation-modal-width), 100%);
        height: 72vh;
        min-height: 0;
        flex-direction: column;
        overflow: hidden;
        border-radius: 1rem;
        background: var(--surface, white);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        color: var(--text, inherit);
        transition:
            background-color 300ms ease,
            color 300ms ease;
    }

    @media (max-width: 860px) {
        .annotation-modal-frame {
            height: min(88vh, 780px);
        }
    }
</style>
