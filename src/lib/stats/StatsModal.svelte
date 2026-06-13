<!--
    StatsModal.svelte — Writing statistics dialog modal.

    Displays computed writing stats (words, characters, sentences, reading time,
    etc.) and an optional AI-powered writing style characterizer.

    Props:
      - onclose: () => void — called when the modal is dismissed.
-->
<script lang="ts">
import { X, BarChart3, HelpCircle } from "lucide-svelte";
import { computeStats } from "$lib/stats/compute";
import { documentContent } from "$lib/stores";
import { appSettings } from "$lib/settings.svelte";
import {
    aiSettings,
    ensureApiKeyLoaded,
    beginAiTask,
    endAiTask,
    getAiAbortSignal,
} from "$lib/ai/settings.svelte";
import { generateCharacterization, type CharacterizerResult } from "$lib/ai/clientStreams";
import StatsInfoModal from "$lib/stats/StatsInfoModal.svelte";

const { onclose }: { onclose: () => void } = $props();

let dialogEl = $state<HTMLDialogElement | undefined>(undefined);

let text = $derived($documentContent);
let stats = $derived(computeStats(text));
let diversity = $derived(formatDiversity(stats.vocabularyDiversity));

// AI characterizer state
let analyzing = $state(false);
let result = $state<CharacterizerResult | null>(null);
let error = $state<string | null>(null);

// Info modal state
let infoTopic = $state<string | null>(null);

const dimensionLabels: Record<string, [string, string]> = {
    Formality: ["CASUAL", "FORMAL"],
    Clarity: ["DENSE", "CLEAR"],
    Conciseness: ["VERBOSE", "CONCISE"],
    Vocabulary: ["SIMPLE", "SOPHISTICATED"],
    Tone: ["DETACHED", "ENGAGING"],
    Pacing: ["SLOW", "BRISK"],
    Descriptiveness: ["SPARSE", "VIVID"],
};

const dimensionOrder = [
    "Formality",
    "Clarity",
    "Conciseness",
    "Vocabulary",
    "Tone",
    "Pacing",
    "Descriptiveness",
];

$effect(() => {
    if (dialogEl && !dialogEl.open) {
        dialogEl.showModal();
    }
});

function handleBackdropClick(e: MouseEvent) {
    if (e.target === dialogEl) onclose();
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        e.preventDefault();
        if (infoTopic) {
            infoTopic = null;
        } else {
            onclose();
        }
    }
}

async function analyze() {
    analyzing = true;
    error = null;
    const task = beginAiTask("style-analysis");
    const abortSignal = getAiAbortSignal();
    try {
        await ensureApiKeyLoaded();
        result = await generateCharacterization({
            provider: aiSettings.provider,
            model: aiSettings.model,
            apiKey: aiSettings.apiKey,
            baseURL: aiSettings.baseURL,
            documentContent: text,
            abortSignal,
        });
    } catch (e: any) {
        if (!abortSignal.aborted) error = e?.message ?? "Analysis failed";
    } finally {
        analyzing = false;
        endAiTask(task);
    }
}

function formatReadingTime(minutes: number): string {
    if (minutes < 1) return "< 1 min";
    return `${minutes} min`;
}

function formatDiversity(pct: number): { label: string; detail: string } {
    if (pct >= 80) return { label: "Very unique", detail: `${pct}%` };
    if (pct >= 60) return { label: "Unique", detail: `${pct}%` };
    if (pct >= 45) return { label: "Moderate", detail: `${pct}%` };
    if (pct >= 30) return { label: "Repetitive", detail: `${pct}%` };
    return { label: "Very repetitive", detail: `${pct}%` };
}

function formatGradeLevel(grade: number): string {
    if (grade <= 0) return "—";
    if (grade <= 1) return "1st grade";
    if (grade <= 2) return "2nd grade";
    if (grade <= 3) return "3rd grade";
    if (grade >= 13) return "College";
    return `${grade}th grade`;
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if infoTopic}
    <StatsInfoModal topic={infoTopic} onclose={() => (infoTopic = null)} />
{/if}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="stats-modal"
    onclick={handleBackdropClick}
    oncancel={(event) => {
        event.preventDefault();
        onclose();
    }}
>
    <div class="stats-modal-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-[color:var(--border)] shrink-0">
            <div class="flex items-center gap-2">
                <BarChart3 size={14} class="text-[color:var(--text-faint)]" />
                <h2 class="text-[13px] font-semibold text-[color:var(--text-soft)]">Writing Statistics</h2>
            </div>
            <button
                onclick={onclose}
                aria-label="Close statistics"
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)] transition-colors"
            >
                <span class="text-[9px] font-mono text-[color:var(--text-ghost)] leading-none">esc</span>
                <X size={15} />
            </button>
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5 max-h-[80vh]">
            <!-- Basic stats grid -->
            <div class="grid grid-cols-4 gap-2.5">
                <div class="stat-card">
                    <div class="stat-value">{stats.words.toLocaleString()}</div>
                    <div class="stat-label">Words</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">{stats.chars.toLocaleString()}</div>
                    <div class="stat-label">Characters</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">{stats.sentences.toLocaleString()}</div>
                    <div class="stat-label">Sentences</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">{formatReadingTime(stats.readingTimeMinutes)}</div>
                    <div class="stat-label">Reading Time</div>
                </div>
            </div>

            <div class="grid grid-cols-3 gap-2.5">
                <button class="stat-card stat-card-interactive" onclick={() => (infoTopic = "avgSentenceLength")}>
                    <div class="stat-value">{stats.avgSentenceLength}</div>
                    <div class="stat-label-row">
                        <span>Avg Sentence Length</span>
                        <HelpCircle size={14} class="text-[color:var(--text-ghost)]" />
                    </div>
                </button>
                <button class="stat-card stat-card-interactive" onclick={() => (infoTopic = "vocabularyDiversity")}>
                    <div class="stat-value">{diversity.label}</div>
                    <div class="stat-label-row">
                        <span>Vocabulary · {diversity.detail}</span>
                        <HelpCircle size={14} class="text-[color:var(--text-ghost)]" />
                    </div>
                </button>
                <button class="stat-card stat-card-interactive" onclick={() => (infoTopic = "readingLevel")}>
                    <div class="stat-value">{formatGradeLevel(stats.readabilityGrade)}</div>
                    <div class="stat-label-row">
                        <span>Reading Level</span>
                        <HelpCircle size={14} class="text-[color:var(--text-ghost)]" />
                    </div>
                </button>
            </div>

            {#if appSettings.aiEnabled}
                <!-- Divider -->
                <div class="border-t border-[color:var(--border)]"></div>

                {#if !result && !analyzing && !error}
                    <!-- Analyze button -->
                    <button
                        onclick={analyze}
                        class="self-center px-5 py-2 rounded-lg bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-3)] text-sm text-[color:var(--text-soft)] hover:text-[color:var(--text)] transition-colors"
                    >
                        Analyze Writing Style
                    </button>
                {:else if analyzing}
                    <!-- Loading state -->
                    <div class="text-center py-6">
                        <span class="text-sm text-[color:var(--text-faint)] animate-pulse">Analyzing...</span>
                    </div>
                {:else if error}
                    <!-- Error state -->
                    <div class="text-center py-4">
                        <p class="text-sm text-[color:var(--accent-red-text)]">{error}</p>
                        <button
                            onclick={analyze}
                            class="mt-2 text-xs text-[color:var(--text-faint)] hover:text-[color:var(--text-soft)] transition-colors"
                        >
                            Try again
                        </button>
                    </div>
                {:else if result}
                    <!-- Characterizer header -->
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-semibold text-[color:var(--text-faint)] uppercase tracking-wider">Writing Characterizer</span>
                        <button
                            onclick={() => (infoTopic = "characterizer")}
                            class="text-[color:var(--text-ghost)] hover:text-[color:var(--text-faint)] transition-colors"
                            aria-label="About writing characterizer"
                        >
                            <HelpCircle size={16} />
                        </button>
                    </div>

                    <!-- Dimension bars -->
                    <div class="flex flex-col gap-3">
                        {#each dimensionOrder as dim}
                            {@const entry = result.dimensions.find((d) => d.name === dim)}
                            {@const score = entry?.score ?? 0}
                            {@const labels = dimensionLabels[dim] ?? ["", ""]}
                            <div>
                                <div class="flex items-center justify-between mb-1">
                                    <span class="text-xs font-semibold text-[color:var(--text-soft)]">{dim}</span>
                                    <span class="text-xs text-[color:var(--text-faint)]">{score}/10</span>
                                </div>
                                <div class="bg-[color:var(--surface-3)] rounded-full h-1.5">
                                    <div
                                        class="bg-[color:var(--text-faint)] rounded-full h-1.5 transition-[width] duration-500 ease-out"
                                        style="width: {score * 10}%"
                                    ></div>
                                </div>
                                <div class="flex justify-between mt-0.5">
                                    <span class="text-[10px] text-[color:var(--text-ghost)] uppercase tracking-wide">{labels[0]}</span>
                                    <span class="text-[10px] text-[color:var(--text-ghost)] uppercase tracking-wide">{labels[1]}</span>
                                </div>
                            </div>
                        {/each}
                    </div>

                    <!-- Detected tones -->
                    {#if result.detectedTones.length > 0}
                        <div>
                            <div class="text-[11px] font-semibold text-[color:var(--text-faint)] uppercase tracking-wider mb-2">Detected Tones</div>
                            <div class="flex flex-wrap gap-1.5">
                                {#each result.detectedTones as tone}
                                    <span class="bg-[color:var(--surface-2)] border border-[color:var(--border)] rounded-full px-3 py-1 text-xs text-[color:var(--text-soft)]">
                                        {tone}
                                    </span>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    <!-- Style description -->
                    {#if result.styleDescription}
                        <div>
                            <div class="text-[11px] font-semibold text-[color:var(--text-faint)] uppercase tracking-wider mb-2">Style Description</div>
                            <p class="text-sm text-[color:var(--text-soft)] leading-relaxed">{result.styleDescription}</p>
                        </div>
                    {/if}
                {/if}
            {/if}
        </div>
    </div>
</dialog>

<style>
    .stats-modal {
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

    .stats-modal::backdrop {
        background: rgba(0, 0, 0, 0.3);
    }

    .stats-modal-inner {
        position: relative;
        max-width: 40rem;
        width: 90vw;
        background: var(--surface);
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(var(--shadow-color), 0.2);
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .stat-card {
        background: var(--surface-2);
        border-radius: 0.75rem;
        padding: 0.75rem;
        text-align: center;
    }

    .stat-card-interactive {
        cursor: pointer;
        transition: background-color 0.15s;
        border: none;
    }

    .stat-card-interactive:hover {
        background: var(--surface-3);
    }

    .stat-value {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--text);
        line-height: 1.3;
    }

    .stat-label {
        font-size: 0.6875rem;
        color: var(--text-faint);
        margin-top: 0.125rem;
    }

    .stat-label-row {
        font-size: 0.6875rem;
        color: var(--text-faint);
        margin-top: 0.125rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
    }
</style>
