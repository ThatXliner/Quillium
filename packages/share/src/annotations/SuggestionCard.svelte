<script lang="ts">
/**
 * SuggestionCard.svelte — Shared presentational AI-suggestion card (replacement
 * options, inline word-diff, apply/branch actions, reply thread). Used by the
 * desktop editor (via Suggestion.svelte adapter) and the web preview.
 *
 * Editing actions (delete, expand-to-diff-modal, apply, branch, reply) render
 * only when their callback is provided, so the read-only web preview gets a
 * pure display with the diff still viewable.
 */
import { ChevronDownIcon, GitBranchIcon, Maximize2, SparklesIcon, Trash2 } from "lucide-svelte";
import type { Thread as ThreadType } from "../core/models";
import { type Persona } from "./avatar";
import Thread from "./Thread.svelte";
import { wordDiff } from "./diff";

let {
    replacements,
    originalText,
    thread,
    isActive = false,
    personas = [],
    onDelete,
    onExpand,
    onApply,
    onBranch,
    onUpdateThread,
    replyValue = "",
    onReplyInput,
    onSend,
    onEscape,
}: {
    replacements: { text: string; rationale?: string }[];
    originalText: string;
    thread: ThreadType;
    isActive?: boolean;
    personas?: Persona[];
    onDelete?: () => void;
    onExpand?: () => void;
    onApply?: (replacementIndex: number) => void;
    onBranch?: () => void;
    onUpdateThread?: (thread: ThreadType) => void;
    replyValue?: string;
    onReplyInput?: (value: string) => void;
    onSend?: () => void;
    onEscape?: () => void;
} = $props();

// Auto-select the only replacement when there is exactly one.
let selectedIndex = $state<number | null>(replacements.length === 1 ? 0 : null);
let diffExpanded = $state(false);
let flashing = $state(false);
let cardEl = $state<HTMLDivElement | undefined>(undefined);

$effect(() => {
    if (isActive) {
        flashing = true;
        cardEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
});

function getDiffOps(replacementIndex: number) {
    const replacement = replacements[replacementIndex];
    if (!replacement) return [];
    return wordDiff(originalText, replacement.text);
}

const showActions = $derived((!!onApply || !!onBranch) && (isActive || selectedIndex !== null));
const replyThreadCount = $derived((thread[0]?.author === "AI" ? thread.slice(1) : thread).length);
</script>

<div
  bind:this={cardEl}
  class="transition-all duration-200
        {isActive ? 'shadow-xl rounded-[14px]' : 'shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}"
  onanimationend={() => { flashing = false; }}
>
  <div
    class="border overflow-hidden
        {isActive
    ? 'bg-green-50/90 border-green-200/60 rounded-[14px]'
    : 'bg-green-50/60 border-green-200/40 rounded-[12px]'}
        {flashing ? 'suggestion-flash' : ''}"
    style="backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);"
  >
  <!-- Header -->
  <div class="flex items-center justify-between px-3 pt-2.5 pb-0">
    <div class="flex items-center gap-1.5">
      <SparklesIcon size={11} class="text-green-500/70" />
      <h3 class="text-[10px] font-semibold text-green-600/70 uppercase tracking-wider">AI Suggestion</h3>
    </div>
    <div class="flex items-center gap-0.5">
      {#if onExpand}
        <button
          class="p-1 rounded-md text-green-400/50 hover:text-green-600/70 hover:bg-white/40 transition-colors"
          onclick={onExpand}
          title="Expand diff"
          aria-label="Expand suggestion diff"
        >
          <Maximize2 size={14} />
        </button>
      {/if}
      {#if onDelete}
        <button
          class="p-1 rounded-md text-green-400/50 hover:text-red-500/60 hover:bg-white/40 transition-colors"
          onclick={onDelete}
          title="Delete suggestion"
        >
          <Trash2 size={16} />
        </button>
      {/if}
    </div>
  </div>

  <!-- Overall comment (thread[0] from AI) -->
  {#if thread.length > 0 && thread[0].author === "AI"}
    <div class="px-3 pt-2 pb-0">
      <p class="text-[11px] text-black/55 leading-relaxed">{thread[0].message}</p>
    </div>
  {/if}

  <!-- Replacements -->
  <div class="p-3 space-y-2">
    {#each replacements as replacement, index}
      {@const isSelected = selectedIndex === index}
      <button
        class="w-full text-left rounded-lg border transition-colors overflow-hidden
                    {isSelected
          ? 'bg-green-100/80 border-green-400/50 ring-1 ring-green-400/40'
          : 'bg-white/50 border-green-100/60 hover:bg-white/70 hover:border-green-200/60'}"
        onclick={() => {
          selectedIndex = replacements.length > 1 && selectedIndex === index ? null : index;
          diffExpanded = false;
        }}
      >
        <div class="px-3 py-2 text-xs text-black/80 leading-relaxed">{replacement.text}</div>
        {#if replacement.rationale}
          <div class="px-3 pb-2 text-[10px] text-green-700/60 leading-snug border-t border-green-100/50 pt-1.5">
            {replacement.rationale}
          </div>
        {/if}
      </button>
    {/each}
  </div>

  <!-- View changes toggle -->
  {#if selectedIndex !== null}
    <div class="px-3 pb-2">
      <button
        class="flex items-center gap-1 text-[10px] text-green-700/60 hover:text-green-700/80 transition-colors"
        onclick={() => { diffExpanded = !diffExpanded; }}
      >
        <ChevronDownIcon size={12} class="transition-transform duration-200 {diffExpanded ? 'rotate-180' : ''}" />
        <span>View changes</span>
      </button>
      {#if diffExpanded}
        <div class="mt-1.5 max-h-28 overflow-y-auto rounded-lg bg-white/60 border border-green-100/60 px-2.5 py-2 text-xs leading-relaxed font-mono">
          {#each getDiffOps(selectedIndex) as op}
            {#if op.type === "equal"}
              <span>{op.text}</span>
            {:else if op.type === "delete"}
              <span class="bg-red-100/80 text-red-700 line-through rounded-sm px-0.5">{op.text}</span>
            {:else}
              <span class="bg-green-100/80 text-green-700 rounded-sm px-0.5">{op.text}</span>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Apply / Branch row -->
  {#if showActions}
    <div class="flex items-center gap-1.5 px-3 pb-3">
      {#if onBranch}
        <button
          aria-label="Branch instead"
          title="Convert to revision with original and suggestion as versions"
          class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600/70
                    bg-white/40 hover:bg-white/60 rounded-md ring-1 ring-green-200/50 transition-colors"
          onclick={onBranch}
        >
          <GitBranchIcon size={11} />
          <span>Branch</span>
        </button>
      {/if}
      {#if onApply}
        <button
          disabled={selectedIndex === null}
          class="flex-1 px-2 py-1 text-[11px] font-medium rounded-md ring-1 transition-colors
                    {selectedIndex !== null
            ? 'bg-green-500/80 text-white ring-green-400/40 hover:bg-green-600/80'
            : 'bg-white/30 text-black/25 ring-green-100/30 cursor-not-allowed'}"
          onclick={() => { if (selectedIndex !== null) onApply?.(selectedIndex); }}
        >
          Apply
        </button>
      {/if}
    </div>
  {/if}

  <!-- User thread replies (skip first message if it's the AI's overall comment) -->
  {#if replyThreadCount > 0 || onSend}
    <div class="border-t border-green-100/60 px-3 py-2.5">
      <Thread
        {thread}
        {personas}
        {onUpdateThread}
        {replyValue}
        {onReplyInput}
        {onSend}
        {onEscape}
        accentClass="text-green-600/80 hover:text-green-700"
        sendPillClass="bg-green-500 text-white hover:bg-green-600"
        focusRingClass="focus-within:ring-green-300/50"
      />
    </div>
  {/if}
  </div>
</div>

<style>
    @keyframes suggestion-flash {
        0%   { background-color: rgba(187, 247, 208, 0.9); }
        70%  { background-color: rgba(187, 247, 208, 0.9); }
        100% { background-color: rgba(240, 253, 244, 0.9); }
    }
    .suggestion-flash {
        animation: suggestion-flash 0.6s ease-out both;
    }
</style>
