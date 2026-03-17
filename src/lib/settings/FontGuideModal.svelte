<!--
    FontGuideModal.svelte — Explains Quillium's curated font list.

    Props:
      - onclose: () => void
-->
<script lang="ts">
import { X } from "lucide-svelte";
import { FEEDBACK_FORM_URL } from "$lib/constants";
import { FONTS } from "./fonts";

const { onclose }: { onclose: () => void } = $props();

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);

$effect(() => {
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
});

function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) onclose();
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        e.preventDefault();
        onclose();
    }
}

const SAMPLE = "The quick brown fox jumps over the lazy dog.";
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="font-guide-modal"
    onclick={handleBackdropClick}
>
    <div class="font-guide-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.06] shrink-0">
            <h2 class="text-[13px] font-semibold text-black/60">Font Guide</h2>
            <button
                onclick={onclose}
                aria-label="Close font guide"
                class="p-1 rounded-md text-black/25 hover:text-black/55 hover:bg-black/5 transition-colors"
            >
                <X size={15} />
            </button>
        </div>

        <!-- Body -->
        <div class="overflow-y-auto px-5 py-4 flex flex-col gap-0 flex-1">

            <!-- Philosophy note -->
            <div class="mb-4 px-3.5 py-3 rounded-xl bg-black/[0.03] border border-black/[0.05]">
                <p class="text-[12px] text-black/55 leading-relaxed">
                    A curated list so you can focus on writing, not font hunting. If something's missing,
                    <a
                        href={FEEDBACK_FORM_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="font-medium text-black/65 underline underline-offset-2 hover:text-black/80 transition-colors"
                    >let us know</a>.
                </p>
            </div>

            <!-- Font entries -->
            {#each FONTS as font}
                <div class="font-entry {font.docFeatured ? 'font-entry-pick' : ''}">
                    <div class="flex items-baseline gap-2 mb-1">
                        <span
                            class="font-name"
                            style="font-family: {font.cssFamily};"
                        >{font.name}</span>
                        <span class="category-badge">{font.category}</span>
                        {#if font.docFeatured}
                            <span class="pick-badge">Our Pick</span>
                        {/if}
                    </div>
                    <p
                        class="font-sample"
                        style="font-family: {font.cssFamily};"
                    >{SAMPLE}</p>
                    <p class="font-desc">{font.desc}</p>
                </div>
            {/each}

        </div>
    </div>
</dialog>

<style>
    .font-guide-modal {
        border: none;
        padding: 0;
        background: transparent;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .font-guide-modal::backdrop {
        background: rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(4px);
    }

    .font-guide-inner {
        position: relative;
        width: 720px;
        height: 78vh;
        max-height: 86vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.2);
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    /* Font entry */
    .font-entry {
        padding: 0.75rem 0.125rem;
        border-bottom: 1px solid rgba(0, 0, 0, 0.04);
    }

    .font-entry:last-child {
        border-bottom: none;
    }

    .font-name {
        font-size: 16px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.78);
        line-height: 1.2;
    }

    .category-badge {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.28);
    }

    .pick-badge {
        font-size: 10px;
        font-weight: 600;
        color: rgba(146, 98, 0, 0.85);
        background: rgba(251, 191, 36, 0.18);
        border: 1px solid rgba(251, 191, 36, 0.4);
        padding: 1px 6px;
        border-radius: 999px;
    }

    .font-sample {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.4);
        line-height: 1.5;
        margin-bottom: 0.25rem;
    }

    .font-desc {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.48);
        line-height: 1.65;
    }
</style>
