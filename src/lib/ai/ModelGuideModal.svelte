<!--
    ModelGuideModal.svelte — Recommends which AI model to pick.

    A lightweight reference modal (styled like FontGuideModal) that helps
    writers choose a provider/model based on what they're optimizing for
    (quality, speed, cost, privacy). Opened from the info icon next to the
    Provider header in AISettings.svelte.

    Props:
      - onclose: () => void
-->
<script lang="ts">
import { X } from "lucide-svelte";

const { onclose }: { onclose: () => void } = $props();

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);

$effect(() => {
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
});

type Recommendation = {
    provider: string;
    tag: string;
    desc: string;
};

const RECOMMENDATIONS: Recommendation[] = [
    {
        provider: "Anthropic (Claude Opus)",
        tag: "Best for knowledge work",
        desc: "The latest Opus model is, hands down, the best model for serious knowledge work. The only downside is that it's expensive.",
    },
    {
        provider: "DeepSeek",
        tag: "Best value",
        desc: "By far the cheapest model that's still genuinely competent. We suspect it's distilled from Anthropic's models, so it carries similar mannerisms to Claude at a fraction of the cost.",
    },
    {
        provider: "Google (Gemini)",
        tag: "Free tier",
        desc: "Gemini has a free tier. If you know how to grab a Gemini API key, you can drop it in here and start writing without paying anything.",
    },
    {
        provider: "OpenAI",
        tag: "Most flexible",
        desc: "Mainly here because so many local LLMs and other services expose an OpenAI-compatible API—point Quillium at those through the custom endpoint. You can also use plain OpenAI API key.",
    },
];
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") { e.preventDefault(); onclose(); } }} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="model-guide-modal"
    onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}
>
    <div class="model-guide-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.06] shrink-0">
            <h2 class="text-[13px] font-semibold text-black/60">Which model should I use?</h2>
            <button
                onclick={onclose}
                aria-label="Close model guide"
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/25 hover:text-black/55 hover:bg-black/5 transition-colors"
            >
                <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
                <X size={15} />
            </button>
        </div>

        <!-- Body -->
        <div class="overflow-y-auto px-5 py-4 flex flex-col gap-0 flex-1">
            <!-- Intro note -->
            <div class="mb-4 px-3.5 py-3 rounded-xl bg-black/[0.03] border border-black/[0.05]">
                <p class="text-[12px] text-black/55 leading-relaxed">
                    Every provider sends your writing to a different company. Pick based on what you
                    care about most—quality, speed, cost, or privacy. You'll need an API key from
                    that provider.
                </p>
            </div>

            {#each RECOMMENDATIONS as rec}
                <div class="model-entry">
                    <div class="flex items-baseline gap-2 mb-1">
                        <span class="model-name">{rec.provider}</span>
                        <span class="best-badge">{rec.tag}</span>
                    </div>
                    <p class="model-desc">{rec.desc}</p>
                </div>
            {/each}
        </div>
    </div>
</dialog>

<style>
    .model-guide-modal {
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

    .model-guide-modal::backdrop {
        background: rgba(0, 0, 0, 0.25);
        backdrop-filter: blur(4px);
    }

    .model-guide-inner {
        position: relative;
        width: 560px;
        height: auto;
        max-height: 78vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.2);
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .model-entry {
        padding: 0.75rem 0.125rem;
        border-bottom: 1px solid rgba(0, 0, 0, 0.04);
    }

    .model-entry:last-child {
        border-bottom: none;
    }

    .model-name {
        font-size: 15px;
        font-weight: 500;
        color: rgba(0, 0, 0, 0.78);
        line-height: 1.2;
    }

    .best-badge {
        font-size: 10px;
        font-weight: 600;
        color: rgba(37, 99, 235, 0.85);
        background: rgba(59, 130, 246, 0.12);
        border: 1px solid rgba(59, 130, 246, 0.3);
        padding: 1px 6px;
        border-radius: 999px;
    }

    .model-desc {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.48);
        line-height: 1.65;
    }
</style>
