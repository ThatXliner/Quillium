<script lang="ts">
import type { EditorView } from "@codemirror/view";
import { ChevronDownIcon, GitBranchIcon, Maximize2, SparklesIcon, Trash2 } from "lucide-svelte";
import {
    applySuggestion,
    branchSuggestion,
    diffTokens,
    tokenize,
    type Annotation,
    type Thread as ThreadType,
} from ".";
import Thread from "./Thread.svelte";
import { activeModal } from "$lib/stores";

const {
    suggestion,
    isActive,
    view,
    remove,
    updateThread,
}: {
    suggestion: Annotation<"suggestion">;
    isActive: boolean;
    view: EditorView;
    remove: () => void;
    updateThread: (thread: ThreadType) => void;
} = $props();

const thread = $derived(suggestion.thread);

let selectedIndex = $state<number | null>(
    suggestion.replacements.length === 1 ? 0 : null,
);

let diffExpanded = $state(false);

function getDiffOps(replacementIndex: number) {
    const { from, to } = suggestion.selection.main;
    const original = view.state.sliceDoc(from, to);
    const replacement = suggestion.replacements[replacementIndex];
    if (!replacement) return [];
    return diffTokens(tokenize(original), tokenize(replacement.text));
}
</script>

<div
  class="border overflow-hidden transition-all duration-200
        {isActive
    ? 'bg-green-50/90 border-green-200/60 shadow-xl rounded-[14px]'
    : 'bg-green-50/60 border-green-200/40 shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}"
  style="backdrop-filter: blur(12px);"
>
  <!-- Header -->
  <div class="flex items-center justify-between px-3 pt-2.5 pb-0">
    <div class="flex items-center gap-1.5">
      <SparklesIcon size={11} class="text-green-500/70" />
      <h3
        class="text-[10px] font-semibold text-green-600/70 uppercase tracking-wider"
      >
        AI Suggestion
      </h3>
    </div>
    <button
      class="p-1 rounded-md text-green-400/50 hover:text-red-500/60 hover:bg-white/40 transition-colors"
      onclick={() => remove()}
      title="Delete suggestion"
    >
      <Trash2 size={16} />
    </button>
  </div>

  <!-- Overall comment (thread[0] from AI) -->
  {#if thread.length > 0 && thread[0].author === "AI"}
    <div class="px-3 pt-2 pb-0">
      <p class="text-[11px] text-black/55 leading-relaxed">
        {thread[0].message}
      </p>
    </div>
  {/if}

  <!-- Replacements -->
  <div class="p-3 space-y-2">
    {#each suggestion.replacements as replacement, index}
      {@const isSelected = selectedIndex === index}
      <button
        class="w-full text-left rounded-lg border transition-colors overflow-hidden
                    {isSelected
          ? 'bg-green-100/80 border-green-400/50 ring-1 ring-green-400/40'
          : 'bg-white/50 border-green-100/60 hover:bg-white/70 hover:border-green-200/60'}"
        onclick={() => {
          selectedIndex = selectedIndex === index ? null : index;
          diffExpanded = false;
        }}
      >
        <div class="px-3 py-2 text-xs text-black/80 leading-relaxed">
          {replacement.text}
        </div>
        {#if replacement.rationale}
          <div
            class="px-3 pb-2 text-[10px] text-green-700/60 leading-snug border-t border-green-100/50 pt-1.5"
          >
            {replacement.rationale}
          </div>
        {/if}
      </button>
    {/each}
  </div>

  <!-- View changes toggle -->
  {#if selectedIndex !== null}
    <div class="px-3 pb-2">
      <div class="flex items-center justify-between">
        <button
          class="flex items-center gap-1 text-[10px] text-green-700/60 hover:text-green-700/80 transition-colors"
          onclick={() => { diffExpanded = !diffExpanded; }}
        >
          <ChevronDownIcon
            size={12}
            class="transition-transform duration-200 {diffExpanded ? 'rotate-180' : ''}"
          />
          <span>View changes</span>
        </button>
        {#if diffExpanded}
          <button
            class="flex items-center gap-1 text-[10px] text-green-700/40 hover:text-green-700/70 transition-colors"
            onclick={() => { if (selectedIndex !== null) activeModal.set({ type: "diff", ops: getDiffOps(selectedIndex) }); }}
            title="Expand to full view"
          >
            <Maximize2 size={10} />
          </button>
        {/if}
      </div>
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

  <!-- Apply / Branch row — only when active -->
  {#if isActive}
    <div class="flex items-center gap-1.5 px-3 pb-3">
      <button
        aria-label="Branch instead"
        title="Convert to revision with original and suggestion as versions"
        class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600/70
                    bg-white/40 hover:bg-white/60 rounded-md ring-1 ring-green-200/50 transition-colors"
        onclick={() => {
          view.dispatch(branchSuggestion(view.state, suggestion.id));
        }}
      >
        <GitBranchIcon size={11} />
        <span>Branch</span>
      </button>
      <button
        disabled={selectedIndex === null}
        class="flex-1 px-2 py-1 text-[11px] font-medium rounded-md ring-1 transition-colors
                    {selectedIndex !== null
          ? 'bg-green-500/80 text-white ring-green-400/40 hover:bg-green-600/80'
          : 'bg-white/30 text-black/25 ring-green-100/30 cursor-not-allowed'}"
        onclick={() => {
          if (selectedIndex === null) return;
          view.dispatch(
            applySuggestion(view.state, suggestion.id, selectedIndex)
          );
        }}
      >
        Apply
      </button>
    </div>
  {/if}

  <!-- User thread replies (skip first message if it's the AI's overall comment) -->
  {#if (thread[0]?.author === "AI" ? thread.slice(1) : thread).length > 0}
    <div class="border-t border-green-100/60 px-3 py-2.5">
      <Thread
        thread={thread[0]?.author === "AI" ? thread.slice(1) : thread}
        {updateThread}
      />
    </div>
  {/if}
</div>

