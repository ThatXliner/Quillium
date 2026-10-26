<script lang="ts">
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { Check, CircleAlert, FoldVertical, LoaderCircle, PenLine, Scissors } from "lucide-svelte";
import {
    type PassageReviewCategory,
    parsePassageReviewResult,
    passageReviewLegend,
} from "./passageReview";

let { part, active = false }: {
    part: ToolUIPart | DynamicToolUIPart;
    active?: boolean;
} = $props();

const tones: Record<PassageReviewCategory, { icon: typeof Check; chip: string; stripe: string; label: string }> = {
    keep: { icon: Check, chip: "border-green-300/70 bg-green-50 text-green-900", stripe: "border-l-green-600", label: "text-green-800" },
    condense: { icon: FoldVertical, chip: "border-yellow-300/80 bg-yellow-50 text-yellow-900", stripe: "border-l-yellow-500", label: "text-yellow-800" },
    cut: { icon: Scissors, chip: "border-rose-300/70 bg-rose-50 text-rose-900", stripe: "border-l-rose-500", label: "text-rose-800" },
    revise: { icon: PenLine, chip: "border-blue-300/70 bg-blue-50 text-blue-900", stripe: "border-l-blue-500", label: "text-blue-800" },
};

const result = $derived(part.state === "output-available" ? parsePassageReviewResult(part.output) : null);
const review = $derived(result?.status === "complete" ? result.review : null);
const legend = $derived(review ? passageReviewLegend(review) : []);
const streaming = $derived(active && (part.state === "input-streaming" || part.state === "input-available"));
</script>

{#if review && result?.status === "complete"}
    <section class="my-2 min-w-0 rounded-xl border border-black/10 bg-white/55 p-3 text-xs text-black/80" aria-label="Passage review" data-passage-review={part.toolCallId}>
        <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-xs font-semibold text-black/70">Passage review</h3>
            <span class="text-xs tabular-nums text-black/65">{review.passages.length} {review.passages.length === 1 ? "passage" : "passages"}</span>
        </div>
        <p class="mt-1 text-xs text-black/65">Based on the {result.scope} when requested. This review doesn't edit your draft.</p>
        {#if review.summary}<p class="mt-2 leading-relaxed text-black/80">{review.summary}</p>{/if}
        <ul class="mt-3 grid gap-1.5" aria-label="Legend">
            {#each legend as entry (entry.category.id)}
                {@const tone = tones[entry.category.id]}
                <li class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-legend-category={entry.category.id}>
                    <span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs {tone.chip}">
                        <tone.icon size={12} aria-hidden="true" />
                        <span class="font-medium">{entry.category.label}</span>
                        <span class="tabular-nums">{entry.count}<span class="sr-only"> {entry.count === 1 ? "passage" : "passages"}</span></span>
                    </span>
                    <span class="text-black/70">{entry.category.meaning}</span>
                </li>
            {/each}
        </ul>
        <ol class="mt-3 space-y-2">
            {#each review.passages as item, index (index)}
                {@const tone = tones[item.category]}
                {@const category = legend.find((entry) => entry.category.id === item.category)?.category}
                <li class="min-w-0 rounded-lg border-l-[3px] bg-white/75 py-2 pr-2 pl-2.5 {tone.stripe}" data-passage-category={item.category}>
                    <span class="inline-flex items-center gap-1 text-xs font-semibold {tone.label}">
                        <tone.icon size={12} aria-hidden="true" />{category?.label}
                    </span>
                    <blockquote class="mt-1 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere] text-black/85">“{item.passage}”</blockquote>
                    <details class="mt-1.5">
                        <summary aria-label={`Why ${category?.label} for passage ${index + 1}?`} class="w-fit cursor-pointer rounded text-xs font-medium text-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700">Why {category?.label}?</summary>
                        <p class="mt-1.5 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere] text-black/75">{item.reason}</p>
                    </details>
                </li>
            {/each}
        </ol>
    </section>
{:else if streaming}
    <p role="status" class="my-1 flex items-center gap-2 py-1.5 text-xs text-black/70" data-passage-review={part.toolCallId}>
        <LoaderCircle size={14} class="animate-spin motion-reduce:animate-none" aria-hidden="true" />Reviewing passages…
    </p>
{:else}
    <p role="status" class="my-1 flex items-center gap-2 py-1.5 text-xs text-black/70" data-passage-review={part.toolCallId}>
        <CircleAlert size={14} aria-hidden="true" />{result?.status === "invalid" && result.reason === "source-mismatch" ? "The review couldn't match the quoted passages in order. Try again." : part.state === "output-error" || part.state === "output-available" ? "Quillium couldn't read this passage review. Try again." : "Passage review interrupted"}
    </p>
{/if}
