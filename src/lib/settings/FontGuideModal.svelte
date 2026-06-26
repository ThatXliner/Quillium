<!--
    FontGuideModal.svelte — Explains Quillium's curated font list.

    Props:
      - onclose: () => void
-->
<script lang="ts">
import { FEEDBACK_FORM_URL } from "$lib/constants";
import { X } from "lucide-svelte";
import { FONTS } from "./fonts";

const { onclose, tab = "doc" }: { onclose: () => void; tab?: "doc" | "ui" } = $props();

let activeTab = $state<"doc" | "ui">(tab);
let activeCategory = $state("all");

let trackEl = $state<HTMLElement | undefined>(undefined);
let pillStyle = $state("");
let categoryTrackEl = $state<HTMLElement | undefined>(undefined);
let categoryPillStyle = $state("");

$effect(() => {
    if (!trackEl) return;
    const buttons = trackEl.querySelectorAll<HTMLButtonElement>(".tab-btn");
    const idx = activeTab === "doc" ? 0 : 1;
    const btn = buttons[idx];
    if (!btn) return;
    pillStyle = `--pill-width: ${btn.offsetWidth}px; --pill-x: ${btn.offsetLeft - 3}px;`;
});

$effect(() => {
    if (!categoryTrackEl) return;
    const buttons = categoryTrackEl.querySelectorAll<HTMLButtonElement>(".category-tab-btn");
    const idx = categoryOptions(currentFonts()).findIndex(
        (category) => category.value === activeCategory,
    );
    const btn = idx >= 0 ? buttons[idx] : undefined;
    if (!btn) return;
    categoryPillStyle = `--category-pill-width: ${btn.offsetWidth}px; --category-pill-x: ${btn.offsetLeft - 3}px;`;
});

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

const SAMPLE =
    Math.random() < 0.2
        ? "Sphinx of black quartz, judge my vow."
        : "The quick brown fox jumps over the lazy dog.";

const CATEGORY_ORDER = [
    "Serif",
    "Sans-Serif",
    "Typewriter",
    "Handwriting",
    "Misc",
    "Accessibility",
];
const FILTER_GROUPS = [
    { value: "all", label: "All", matches: (_category: string) => true },
    { value: "serif", label: "Serif", matches: (category: string) => category === "Serif" },
    { value: "sans", label: "Sans", matches: (category: string) => category === "Sans-Serif" },
    {
        value: "misc",
        label: "Misc",
        matches: (category: string) =>
            ["Typewriter", "Handwriting", "Misc", "Accessibility"].includes(category),
    },
] as const;

function sortedFonts(fonts: typeof FONTS, pickKey: "docFeatured" | "uiFeatured") {
    return [...fonts].sort((a, b) => {
        if (a[pickKey] !== b[pickKey]) return a[pickKey] ? -1 : 1;
        const ai = CATEGORY_ORDER.indexOf(a.category);
        const bi = CATEGORY_ORDER.indexOf(b.category);
        if (ai !== bi) return ai - bi;
        return a.name.localeCompare(b.name);
    });
}

const docFonts = sortedFonts(
    FONTS.filter((f) => f.docFont),
    "docFeatured",
);
const uiFonts = sortedFonts(
    FONTS.filter((f) => f.uiFont),
    "uiFeatured",
);

function categoryOptions(fonts: typeof FONTS) {
    return FILTER_GROUPS.filter(
        (group) => group.value === "all" || fonts.some((font) => group.matches(font.category)),
    );
}

function filteredFonts(fonts: typeof FONTS) {
    const filter = FILTER_GROUPS.find((group) => group.value === activeCategory);
    if (!filter || filter.value === "all") return fonts;
    return fonts.filter((font) => filter.matches(font.category));
}

function currentFonts() {
    return activeTab === "doc" ? docFonts : uiFonts;
}

$effect(() => {
    const visibleFonts = currentFonts();
    if (!categoryOptions(visibleFonts).some((category) => category.value === activeCategory))
        activeCategory = "all";
});
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
            <div class="flex items-baseline gap-4">
                <h2 class="text-[13px] font-semibold text-black/60">Font Guide</h2>
                <div class="tab-track" bind:this={trackEl} style={pillStyle}>
                    <div class="tab-pill"></div>
                    <button
                        onclick={() => activeTab = "doc"}
                        class="tab-btn outline-none {activeTab === 'doc' ? 'tab-btn-active' : ''}"
                    >Document</button>
                    <button
                        onclick={() => activeTab = "ui"}
                        class="tab-btn outline-none {activeTab === 'ui' ? 'tab-btn-active' : ''}"
                    >UI</button>
                </div>
            </div>
            <button
                onclick={onclose}
                aria-label="Close font guide"
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/25 hover:text-black/55 hover:bg-black/5 transition-colors"
            >
                <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
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

            <div class="category-filter-row">
                <div class="category-track" bind:this={categoryTrackEl} style={categoryPillStyle}>
                    <div class="category-pill"></div>
                    {#each categoryOptions(currentFonts()) as category}
                    <button
                        class="category-tab-btn outline-none {activeCategory === category.value ? 'category-tab-btn-active' : ''}"
                        onclick={() => activeCategory = category.value}
                    >
                        {category.label}
                    </button>
                    {/each}
                </div>
            </div>

            <!-- Font entries -->
            {#each filteredFonts(currentFonts()) as font}
                {@const isPick = activeTab === "doc" ? font.docFeatured : font.uiFeatured}
                <div class="font-entry {isPick ? 'font-entry-pick' : ''}">
                    <div class="flex items-baseline gap-2 mb-1">
                        <span
                            class="font-name"
                            style="font-family: {font.cssFamily};"
                        >{font.name}</span>
                        <span class="category-badge">{font.category}</span>
                        {#if isPick}
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

    /* Tabs */
    .tab-track {
        position: relative;
        display: flex;
        gap: 2px;
        background: rgba(180, 180, 180, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: 999px;
        padding: 3px;
        backdrop-filter: blur(8px);
        /* overflow:hidden clips the backdrop-blur to the rounded corners — WebKit won't otherwise */
        overflow: hidden;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.08);
    }

    .tab-pill {
        position: absolute;
        top: 3px;
        left: 3px;
        height: calc(100% - 6px);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(8px);
        /* overflow:hidden clips the backdrop-blur to the rounded corners — WebKit won't otherwise */
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.9);
        transition: transform 0.25s cubic-bezier(0.34, 1.2, 0.64, 1), width 0.25s cubic-bezier(0.34, 1.2, 0.64, 1);
        /* width/transform set dynamically via JS — fallback width */
        width: var(--pill-width, 72px);
        transform: translateX(var(--pill-x, 0px));
    }

    .tab-btn {
        position: relative;
        font-size: 11px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.4);
        padding: 2px 10px;
        border-radius: 999px;
        transition: color 0.2s;
        cursor: pointer;
        z-index: 1;
    }

    .tab-btn:hover {
        color: rgba(0, 0, 0, 0.55);
    }

    .tab-btn-active {
        color: rgba(0, 0, 0, 0.7);
    }

    /* Font entry */
    .category-filter-row {
        display: flex;
        flex-wrap: wrap;
        margin: 0 0 0.9rem;
    }

    .category-track {
        position: relative;
        display: inline-flex;
        gap: 2px;
        background: rgba(180, 180, 180, 0.18);
        border: 1px solid rgba(255, 255, 255, 0.5);
        border-radius: 999px;
        padding: 3px;
        backdrop-filter: blur(8px);
        /* overflow:hidden clips the backdrop-blur to the rounded corners — WebKit won't otherwise */
        overflow: hidden;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.06);
    }

    .category-pill {
        position: absolute;
        top: 3px;
        left: 3px;
        height: calc(100% - 6px);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(8px);
        /* overflow:hidden clips the backdrop-blur to the rounded corners — WebKit won't otherwise */
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.9);
        transition: transform 0.25s cubic-bezier(0.34, 1.2, 0.64, 1), width 0.25s cubic-bezier(0.34, 1.2, 0.64, 1);
        width: var(--category-pill-width, 44px);
        transform: translateX(var(--category-pill-x, 0px));
    }

    .category-tab-btn {
        position: relative;
        font-size: 11px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.38);
        padding: 2px 10px;
        border-radius: 999px;
        transition: color 0.2s;
        cursor: pointer;
        z-index: 1;
    }

    .category-tab-btn:hover {
        color: rgba(0, 0, 0, 0.55);
    }

    .category-tab-btn-active {
        color: rgba(0, 0, 0, 0.7);
    }

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
