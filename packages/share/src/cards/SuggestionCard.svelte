<script lang="ts">
import { ChevronDownIcon, GitBranchIcon, Maximize2, SparklesIcon, Trash2 } from "lucide-svelte";
import { type Snippet, untrack } from "svelte";
import type { SuggestionDiffOperation, SuggestionReplacementView } from "./types";

let {
    annotationId,
    active,
    scrollOnActivate = true,
    replacements,
    overallComment,
    onOpen,
    onDelete,
    onBranch,
    onApply,
    onDiffViewed,
    onReplacementSelect,
    getDiffOperations,
    thread,
}: {
    annotationId?: string | number;
    active: boolean;
    scrollOnActivate?: boolean;
    replacements: SuggestionReplacementView[];
    overallComment?: string;
    onOpen?: () => void;
    onDelete?: () => void;
    onBranch?: () => void;
    onApply?: (index: number) => void;
    onDiffViewed?: (index: number) => void;
    onReplacementSelect?: (index: number) => void;
    getDiffOperations?: (index: number) => SuggestionDiffOperation[];
    thread?: Snippet;
} = $props();

let selectedIndex = $state<number | null>(untrack(() => (replacements.length === 1 ? 0 : null)));
let diffExpanded = $state(false);
let flashing = $state(false);
let cardEl = $state<HTMLDivElement>();

$effect(() => {
    if (active) {
        flashing = true;
        if (scrollOnActivate) cardEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
});
</script>

<div
    bind:this={cardEl}
    data-annotation-card="suggestion"
    data-annotation-card-view="suggestion"
    data-annotation-id={annotationId}
    data-active={active}
    class="transition-all duration-200
        {active ? 'shadow-xl rounded-[14px]' : 'shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}"
    onanimationend={() => (flashing = false)}
>
    <div
        class="border overflow-hidden
            {active
                ? 'bg-green-50/90 border-green-200/60 rounded-[14px]'
                : 'bg-green-50/60 border-green-200/40 rounded-[12px]'}
            {flashing ? 'suggestion-flash' : ''}"
        style="backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);"
    >
        <div class="flex items-center justify-between px-3 pt-2.5 pb-0">
            <div class="flex items-center gap-1.5">
                <SparklesIcon size={11} class="text-green-500/70" />
                <h3 class="text-[10px] font-semibold text-green-600/70 uppercase tracking-wider">
                    AI Suggestion
                </h3>
            </div>
            {#if onOpen || onDelete}
                <div class="flex items-center gap-0.5">
                    {#if onOpen}
                        <button
                            class="p-1 rounded-md text-green-400/50 hover:text-green-600/70 hover:bg-white/40 transition-colors"
                            onclick={onOpen}
                            title="Expand diff"
                            aria-label="Expand suggestion diff"
                        ><Maximize2 size={14} /></button>
                    {/if}
                    {#if onDelete}
                        <button
                            class="p-1 rounded-md text-green-400/50 hover:text-red-500/60 hover:bg-white/40 transition-colors"
                            onclick={onDelete}
                            title="Delete suggestion"
                        ><Trash2 size={16} /></button>
                    {/if}
                </div>
            {/if}
        </div>

        {#if overallComment}
            <div class="px-3 pt-2 pb-0">
                <p class="text-[11px] text-black/55 leading-relaxed">{overallComment}</p>
            </div>
        {/if}

        <div class="p-3 space-y-2">
            {#each replacements as replacement, index}
                {@const selected = selectedIndex === index}
                <button
                    class="w-full text-left rounded-lg border transition-colors overflow-hidden
                        {selected
                            ? 'bg-green-100/80 border-green-400/50 ring-1 ring-green-400/40'
                            : 'bg-white/50 border-green-100/60 hover:bg-white/70 hover:border-green-200/60'}"
                    onclick={() => {
                        selectedIndex = replacements.length > 1 && selected ? null : index;
                        diffExpanded = false;
                        onReplacementSelect?.(index);
                    }}
                >
                    <div class="px-3 py-2 text-xs text-black/80 leading-relaxed">
                        {replacement.text}
                    </div>
                    {#if replacement.rationale}
                        <div class="px-3 pb-2 text-[10px] text-green-700/60 leading-snug border-t border-green-100/50 pt-1.5">
                            {replacement.rationale}
                        </div>
                    {/if}
                </button>
            {/each}
        </div>

        {#if selectedIndex !== null && getDiffOperations}
            <div class="px-3 pb-2">
                <button
                    class="flex items-center gap-1 text-[10px] text-green-700/60 hover:text-green-700/80 transition-colors"
                    onclick={() => {
                        diffExpanded = !diffExpanded;
                        if (diffExpanded && selectedIndex !== null) onDiffViewed?.(selectedIndex);
                    }}
                >
                    <ChevronDownIcon
                        size={12}
                        class="transition-transform duration-200 {diffExpanded ? 'rotate-180' : ''}"
                    />
                    <span>View changes</span>
                </button>
                {#if diffExpanded}
                    <div class="mt-1.5 max-h-28 overflow-y-auto rounded-lg bg-white/60 border border-green-100/60 px-2.5 py-2 text-xs leading-relaxed font-mono">
                        {#each getDiffOperations(selectedIndex) as operation}
                            {#if operation.type === "equal"}
                                <span>{operation.text}</span>
                            {:else if operation.type === "delete"}
                                <span class="bg-red-100/80 text-red-700 line-through rounded-sm px-0.5">{operation.text}</span>
                            {:else}
                                <span class="bg-green-100/80 text-green-700 rounded-sm px-0.5">{operation.text}</span>
                            {/if}
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}

        {#if (onApply || onBranch) && (active || selectedIndex !== null)}
            <div class="flex items-center gap-1.5 px-3 pb-3">
                {#if onBranch}
                    <button
                        aria-label="Branch instead"
                        title="Convert to revision with original and suggestion as versions"
                        class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600/70 bg-white/40 hover:bg-white/60 rounded-md ring-1 ring-green-200/50 transition-colors"
                        onclick={onBranch}
                    ><GitBranchIcon size={11} /><span>Branch</span></button>
                {/if}
                {#if onApply}
                    <button
                        disabled={selectedIndex === null}
                        class="flex-1 px-2 py-1 text-[11px] font-medium rounded-md ring-1 transition-colors
                            {selectedIndex !== null
                                ? 'bg-green-500/80 text-white ring-green-400/40 hover:bg-green-600/80'
                                : 'bg-white/30 text-black/25 ring-green-100/30 cursor-not-allowed'}"
                        onclick={() => selectedIndex !== null && onApply?.(selectedIndex)}
                    >Apply</button>
                {/if}
            </div>
        {/if}

        {#if thread}
            <div class="border-t border-green-100/60 px-3 py-2.5">
                {@render thread()}
            </div>
        {/if}
    </div>
</div>

<style>
    @keyframes suggestion-flash {
        0% { background-color: rgba(187, 247, 208, 0.9); }
        70% { background-color: rgba(187, 247, 208, 0.9); }
        100% { background-color: rgba(240, 253, 244, 0.9); }
    }
    .suggestion-flash { animation: suggestion-flash 0.6s ease-out both; }
</style>
