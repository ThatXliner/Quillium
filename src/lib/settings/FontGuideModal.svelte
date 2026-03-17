<!--
    FontGuideModal.svelte — Explains Quillium's curated font list.

    Props:
      - onclose: () => void
-->
<script lang="ts">
import { X } from "lucide-svelte";
import { FEEDBACK_FORM_URL } from "$lib/constants";

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

const FONTS = [
    {
        name: "Georgia",
        cssFamily: "Georgia, serif",
        category: "Serif",
        pick: true,
        desc: "Matthew Carter designed this for screens in 1993, and it still holds up. Warm, sturdy, never fussy. Our default for a reason.",
    },
    {
        name: "Courier Prime",
        cssFamily: '"Courier Prime", "Courier New", Courier, monospace',
        category: "Typewriter",
        pick: true,
        desc: "Courier, but fixed. Same tap-tap rhythm and even spacing — just better rendered. Switch to this mid-draft and your prose suddenly sounds different. That's the point.",
    },
    {
        name: "Raleway",
        cssFamily: '"Raleway", system-ui, sans-serif',
        category: "Sans-Serif",
        pick: true,
        desc: "Geometric and airy. If you want the page to breathe without feeling clinical, Raleway is the move. Good for essays and anything contemporary.",
    },
    {
        name: "Comic Sans MS",
        cssFamily: '"Comic Sans MS", "Comic Sans", cursive',
        category: "Misc",
        pick: true,
        desc: "Yes, on purpose. Reading your draft in a font you'd never publish in is like reading it aloud — it breaks the spell and you hear what's actually there. We include it for the same reason.",
    },
    {
        name: "EB Garamond",
        cssFamily: '"EB Garamond", Garamond, Georgia, serif',
        category: "Serif",
        pick: false,
        desc: "Renaissance-era elegance, faithfully revived. It makes long-form fiction feel like a proper book. Rewards a large screen.",
    },
    {
        name: "Lora",
        cssFamily: '"Lora", Georgia, serif',
        category: "Serif",
        pick: false,
        desc: "Calligraphic roots, warm at body size. Feels natural without being informal. Memoir, personal essays, anything that needs a human touch.",
    },
    {
        name: "Roboto Serif",
        cssFamily: '"Roboto Serif", Georgia, serif',
        category: "Serif",
        pick: false,
        desc: "Clean, modern, no personality to get in the way. A digital book feel without any ornament.",
    },
    {
        name: "Libre Baskerville",
        cssFamily: '"Libre Baskerville", Georgia, serif',
        category: "Serif",
        pick: false,
        desc: "High-contrast strokes, sharp serifs, authoritative presence. Classic transitional serif, optimized for the web. Good for writing that means business.",
    },
    {
        name: "Baskerville",
        cssFamily: '"Baskerville", "Baskerville Old Face", serif',
        category: "Serif",
        pick: false,
        desc: "The native system version of Baskerville — same character, but rendered by your OS. Looks slightly different depending on platform.",
    },
    {
        name: "Palatino",
        cssFamily: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
        category: "Serif",
        pick: false,
        desc: "Hermann Zapf's calligraphic humanist. Wide, open, handmade-feeling. Handles long stretches of text without wearing you out.",
    },
    {
        name: "Charter",
        cssFamily: '"Charter", "Bitstream Charter", "Sitka Text", serif',
        category: "Serif",
        pick: false,
        desc: "Built to survive being faxed. Sturdy, geometric, impossible to misread. iA Writer defaults to this — that's not a coincidence.",
    },
    {
        name: "New York",
        cssFamily: '"New York", ui-serif, Georgia, serif',
        category: "Serif",
        pick: false,
        desc: "Apple's serif, built for Retina. Adapts optically to size. If you're on macOS it'll look great; elsewhere it falls back to Georgia.",
    },
    {
        name: "IM Fell English",
        cssFamily: '"IM Fell English", Georgia, serif',
        category: "Serif",
        pick: false,
        desc: "Scanned from a 17th-century type specimen, imperfections included. Makes the page feel like a manuscript. Historical fiction's best friend.",
    },
    {
        name: "Times New Roman",
        cssFamily: '"Times New Roman", Times, serif',
        category: "Serif",
        pick: false,
        desc: "Here because some people think in it. The invisible furniture of decades of word processing. Not interesting, but reliable.",
    },
    {
        name: "System sans-serif",
        cssFamily: "system-ui, -apple-system, sans-serif",
        category: "Sans-Serif",
        pick: false,
        desc: "Whatever your OS uses for UI — SF Pro, Segoe UI, Roboto. Maximally familiar. Makes the editor feel like your native environment.",
    },
    {
        name: "Arial",
        cssFamily: "Arial, Helvetica, sans-serif",
        category: "Sans-Serif",
        pick: false,
        desc: "Not beautiful, but everywhere and readable at any size. The draft-in-a-pinch font.",
    },
    {
        name: "Calibri",
        cssFamily: '"Calibri", "Gill Sans", sans-serif',
        category: "Sans-Serif",
        pick: false,
        desc: "Slightly warmer than Arial, rounder letterforms. Microsoft's default for over a decade — you probably have muscle memory for it.",
    },
    {
        name: "Verdana",
        cssFamily: "Verdana, Geneva, sans-serif",
        category: "Sans-Serif",
        pick: false,
        desc: "Wide, widely-spaced, legible at tiny sizes. Matthew Carter designed it for the early web, before web typography was a real thing.",
    },
    {
        name: "Special Elite",
        cssFamily: '"Special Elite", "Courier New", monospace',
        category: "Typewriter",
        pick: false,
        desc: "Rougher and more distinctive than Courier — based on Royal Safari and Olympia SM machines. Reach for this when Courier Prime feels too clean.",
    },
    {
        name: "System monospace",
        cssFamily: "ui-monospace, monospace",
        category: "Typewriter",
        pick: false,
        desc: "SF Mono, Cascadia Code, Fira Code — whatever your OS provides. Brings a code-editor feel to the page. Some writers find the even rhythm clarifying.",
    },
    {
        name: "Caveat",
        cssFamily: '"Caveat", cursive',
        category: "Handwriting",
        pick: false,
        desc: "Casual, personal, slightly messy. Good for journaling or when you want the page to feel like a first draft in the best sense.",
    },
    {
        name: "Kalam",
        cssFamily: '"Kalam", cursive',
        category: "Handwriting",
        pick: false,
        desc: "Hand-printed rather than cursive — neat handwriting, not scrawl. More structured than Caveat without losing the personal feel.",
    },
    {
        name: "OpenDyslexic",
        cssFamily: '"OpenDyslexic", sans-serif',
        category: "Accessibility",
        pick: false,
        desc: "Weighted bottoms and distinct letterforms to reduce character confusion. Not a cure, results vary, but worth trying if standard fonts feel slippery.",
    },
];
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
                <div class="font-entry {font.pick ? 'font-entry-pick' : ''}">
                    <div class="flex items-baseline gap-2 mb-1">
                        <span
                            class="font-name"
                            style="font-family: {font.cssFamily};"
                        >{font.name}</span>
                        <span class="category-badge">{font.category}</span>
                        {#if font.pick}
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
