<!--
    StatsInfoModal.svelte — Explains individual writing statistics.

    Layered on top of StatsModal as a sub-dialog, matching the
    FontGuideModal pattern from settings.

    Props:
      - topic: string — which stat to explain
      - onclose: () => void
-->
<script lang="ts">
import { X } from "lucide-svelte";

const { topic, onclose }: { topic: string; onclose: () => void } = $props();

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);

$effect(() => {
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
});

function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) onclose();
}

type ScaleEntry = { label: string; range: string };

type InfoEntry = {
    title: string;
    description: string;
    details: string;
    example?: string;
    scale?: ScaleEntry[];
};

const info: Record<string, InfoEntry> = {
    avgSentenceLength: {
        title: "Average Sentence Length",
        description: "How many words you're averaging per sentence.",
        details:
            "Short sentences hit harder. Long ones give you room to develop ideas but can lose people. Under 15 words tends to feel punchy, over 25 starts getting dense. Most professional writing lands around 15-20. What actually kills readability is monotonous rhythm, not length itself. Mix it up.",
        example:
            "Journalism sits around 15. Academic writing, closer to 25. Fiction is all over the place.",
    },
    vocabularyDiversity: {
        title: "Vocabulary Diversity",
        description: "What fraction of your words are unique (sometimes called type-token ratio).",
        details:
            'Higher means you\'re reaching for different words more often. Lower means repetition, which can be intentional (rhetoric, emphasis) or just a habit. This number drops naturally in longer pieces because common words like "the" and "is" keep piling up.',
        scale: [
            { label: "Very unique", range: "80%+" },
            { label: "Unique", range: "60–79%" },
            { label: "Moderate", range: "45–59%" },
            { label: "Repetitive", range: "30–44%" },
            { label: "Very repetitive", range: "< 30%" },
        ],
        example:
            "500 words with 300 unique ones = 60%. Technical writing that repeats the same terms often will have a lower percentage here, and that's expected.",
    },
    readingLevel: {
        title: "Reading Level",
        description:
            "A rough grade-level estimate based on sentence length and word complexity (Flesch-Kincaid).",
        details:
            "Grade 8 means an 8th grader could follow it. Lower isn't worse, it just means more people can read it without effort. Popular fiction usually lands around grade 6-8. Newspapers, 8-10. Academic papers, 12 and up. The right level depends on who you're writing for.",
        example: "Hemingway scores around grade 4. Legal filings can hit 14+.",
    },
    characterizer: {
        title: "Writing Characterizer",
        description:
            "AI scores your writing across 7 style dimensions, picks out tones, and writes a short summary.",
        details:
            'Each dimension gets a 1-10 score based on your full text. These are observations, not judgments. Scoring low on Formality is fine if you\'re going for casual. The tone tags ("Confident", "Analytical", etc.) try to capture the overall feel. Results can shift between runs since the AI isn\'t deterministic.',
    },
};

const entry: InfoEntry = $derived(
    info[topic] ?? {
        title: topic,
        description: "No additional information available.",
        details: "",
    },
);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="info-modal"
    onclick={handleBackdropClick}
    oncancel={(e) => { e.preventDefault(); onclose(); }}
>
    <div class="info-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-[color:var(--border)] shrink-0">
            <h2 class="text-[13px] font-semibold text-[color:var(--text-soft)]">{entry.title}</h2>
            <button
                onclick={onclose}
                aria-label="Close info"
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)] transition-colors"
            >
                <span class="text-[9px] font-mono text-[color:var(--text-ghost)] leading-none">esc</span>
                <X size={15} />
            </button>
        </div>

        <!-- Body -->
        <div class="px-5 py-4 flex flex-col gap-3">
            <p class="text-sm text-[color:var(--text)] leading-relaxed font-medium">{entry.description}</p>
            {#if entry.details}
                <p class="text-[13px] text-[color:var(--text-soft)] leading-relaxed">{entry.details}</p>
            {/if}
            {#if entry.scale}
                <div class="rounded-xl bg-[color:var(--surface-2)] border border-[color:var(--border)] overflow-hidden">
                    {#each entry.scale as item, i}
                        <div class="flex items-center justify-between px-3.5 py-2 {i > 0 ? 'border-t border-[color:var(--border)]' : ''}">
                            <span class="text-[12px] font-medium text-[color:var(--text-soft)]">{item.label}</span>
                            <span class="text-[11px] text-[color:var(--text-faint)] tabular-nums">{item.range}</span>
                        </div>
                    {/each}
                </div>
            {/if}
            {#if entry.example}
                <div class="px-3.5 py-3 rounded-xl bg-[color:var(--surface-2)] border border-[color:var(--border)]">
                    <p class="text-[12px] text-[color:var(--text-faint)] leading-relaxed">{entry.example}</p>
                </div>
            {/if}
        </div>
    </div>
</dialog>

<style>
    .info-modal {
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
        z-index: 100;
    }

    .info-modal::backdrop {
        background: rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(2px);
    }

    .info-inner {
        position: relative;
        max-width: 26rem;
        width: 85vw;
        background: var(--surface);
        border-radius: 0.875rem;
        box-shadow: 0 25px 50px -12px rgba(var(--shadow-color), 0.2);
        overflow: hidden;
    }
</style>
