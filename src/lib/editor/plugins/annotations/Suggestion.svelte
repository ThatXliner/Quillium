<script lang="ts">
/**
 * Suggestion.svelte — Displays an AI-generated suggestion card
 * with one or more replacement options, inline diff preview,
 * and actions to apply or branch into a revision.
 *
 * Props:
 *   - suggestion: Annotation<"suggestion"> — the annotation data
 *   - isActive: boolean — whether this card is currently selected
 *   - view: EditorView — the parent CodeMirror editor
 *   - remove: () => void — callback to delete this annotation
 *   - updateThread: (thread: ThreadType) => void — callback to
 *     replace the thread array
 *
 * Events emitted: none (delegates via callbacks and CodeMirror
 *   dispatch for applySuggestion / branchSuggestion effects)
 * Stores:
 *   - modalStack (write): pushes a DiffModal entry for full-view
 *
 * Parent: Annotations.svelte
 * Children: Thread.svelte (for user replies below the suggestion)
 *
 * Local state:
 *   - selectedIndex: which replacement option is highlighted
 *   - diffExpanded: whether the inline diff panel is visible
 */
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
import { modalStack } from "$lib/stores";
import posthog from "$lib/posthog";

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

// Auto-select the only replacement when there is exactly one
let selectedIndex = $state<number | null>(suggestion.replacements.length === 1 ? 0 : null);

let diffExpanded = $state(false);
let flashing = $state(false);
let cardEl = $state<HTMLDivElement | undefined>(undefined);

$effect(() => {
    if (isActive) {
        flashing = true;
        cardEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
});

/**
 * Compute token-level diff operations between the original
 * document text and the chosen replacement text.
 */
function getDiffOps(replacementIndex: number) {
    const { from, to } = suggestion.selection.main;
    const original = view.state.sliceDoc(from, to);
    const replacement = suggestion.replacements[replacementIndex];
    if (!replacement) return [];
    return diffTokens(tokenize(original), tokenize(replacement.text));
}
</script>

<div
  bind:this={cardEl}
  class="border overflow-hidden transition-all duration-200
        {isActive
    ? 'bg-[color:var(--chip-green-strong)] border-[color:var(--chip-green-border)] shadow-xl rounded-[14px]'
    : 'bg-[color:var(--chip-green)] border-[color:var(--chip-green-border)] shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}
        {flashing ? 'suggestion-flash' : ''}"
  style="backdrop-filter: blur(12px);"
  onanimationend={() => { flashing = false; }}
>
  <!-- Header -->
  <div class="flex items-center justify-between px-3 pt-2.5 pb-0">
    <div class="flex items-center gap-1.5">
      <SparklesIcon size={11} class="text-[color:var(--accent-green-text)]" />
      <h3
        class="text-[10px] font-semibold text-[color:var(--accent-green-text)] uppercase tracking-wider"
      >
        AI Suggestion
      </h3>
    </div>
    <div class="flex items-center gap-0.5">
      <button
        class="p-1 rounded-md text-[color:var(--accent-green-text)] hover:text-[color:var(--accent-green-text)] hover:bg-[color:var(--surface-2)] transition-colors"
        onclick={() => {
          posthog.capture("suggestion_diff_modal_opened", {
            replacement_count: suggestion.replacements.length,
          });
          modalStack.push({
            type: "diff",
            suggestionId: suggestion.id,
            parentView: view,
            label: "AI Suggestion",
          });
        }}
        title="Expand diff"
        aria-label="Expand suggestion diff"
      >
        <Maximize2 size={14} />
      </button>
      <button
        class="p-1 rounded-md text-[color:var(--accent-green-text)] hover:text-[color:var(--accent-red-text)] hover:bg-[color:var(--surface-2)] transition-colors"
        onclick={() => {
          posthog.capture("annotation_deleted", {
            type: "suggestion",
            replacement_count: suggestion.replacements.length,
          });
          remove();
        }}
        title="Delete suggestion"
      >
        <Trash2 size={16} />
      </button>
    </div>
  </div>

  <!-- Overall comment (thread[0] from AI) -->
  {#if thread.length > 0 && thread[0].author === "AI"}
    <div class="px-3 pt-2 pb-0">
      <p class="text-[11px] text-[color:var(--text-soft)] leading-relaxed">
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
          ? 'bg-[color:var(--chip-green-strong)] border-[color:var(--chip-green-border)] ring-1 ring-[color:var(--chip-green-border)]'
          : 'bg-[color:var(--surface)] border-[color:var(--chip-green-border)] hover:bg-[color:var(--surface-2)] hover:border-[color:var(--chip-green-border)]'}"
        onclick={() => {
          // Allow deselecting only when there are multiple options
          selectedIndex = suggestion.replacements.length > 1 && selectedIndex === index ? null : index;
          diffExpanded = false;
        }}
      >
        <div class="px-3 py-2 text-xs text-[color:var(--text)] leading-relaxed">
          {replacement.text}
        </div>
        {#if replacement.rationale}
          <div
            class="px-3 pb-2 text-[10px] text-[color:var(--accent-green-text)] leading-snug border-t border-[color:var(--chip-green-border)] pt-1.5"
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
      <button
        class="flex items-center gap-1 text-[10px] text-[color:var(--accent-green-text)] hover:text-[color:var(--accent-green-text)] transition-colors"
        onclick={() => {
          diffExpanded = !diffExpanded;
          if (!diffExpanded) return;
          posthog.capture("suggestion_diff_viewed", {
            replacement_index: selectedIndex,
            replacement_count: suggestion.replacements.length,
          });
        }}
      >
        <ChevronDownIcon
          size={12}
          class="transition-transform duration-200 {diffExpanded
            ? 'rotate-180'
            : ''}"
        />
        <span>View changes</span>
      </button>
      {#if diffExpanded}
        <div
          class="mt-1.5 max-h-28 overflow-y-auto rounded-lg bg-[color:var(--surface)] border border-[color:var(--chip-green-border)] px-2.5 py-2 text-xs leading-relaxed font-mono"
        >
          {#each getDiffOps(selectedIndex) as op}
            {#if op.type === "equal"}
              <span>{op.text}</span>
            {:else if op.type === "delete"}
              <span
                class="bg-[color:var(--diff-del-bg)] text-[color:var(--diff-del-text)] line-through rounded-sm px-0.5"
                >{op.text}</span
              >
            {:else}
              <span class="bg-[color:var(--diff-ins-bg)] text-[color:var(--diff-ins-text)] rounded-sm px-0.5"
                >{op.text}</span
              >
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Apply / Branch row — shown when active or when a replacement is selected -->
  {#if isActive || selectedIndex !== null}
    <div class="flex items-center gap-1.5 px-3 pb-3">
      <button
        aria-label="Branch instead"
        title="Convert to revision with original and suggestion as versions"
        class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[color:var(--accent-purple-text)]
                    bg-[color:var(--surface)] hover:bg-[color:var(--surface-2)] rounded-md ring-1 ring-[color:var(--chip-green-border)] transition-colors"
        onclick={() => {
          posthog.capture("suggestion_branched", {
            replacement_count: suggestion.replacements.length,
          });
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
          : 'bg-[color:var(--surface)] text-[color:var(--text-ghost)] ring-[color:var(--chip-green-border)] cursor-not-allowed'}"
        onclick={() => {
          if (selectedIndex === null) return;
          posthog.capture("suggestion_applied", {
            replacement_index: selectedIndex,
            replacement_count: suggestion.replacements.length,
          });
          view.dispatch(
            applySuggestion(view.state, suggestion.id, selectedIndex),
          );
        }}
      >
        Apply
      </button>
    </div>
  {/if}

  <!-- User thread replies (skip first message if it's the AI's overall comment) -->
  {#if (thread[0]?.author === "AI" ? thread.slice(1) : thread).length > 0}
    <div class="border-t border-[color:var(--chip-green-border)] px-3 py-2.5">
      <Thread {thread} {updateThread} annotationId={suggestion.id} />
    </div>
  {/if}
</div>

<style>
    @keyframes suggestion-flash {
        0%   { background-color: var(--chip-green-strong); }
        70%  { background-color: var(--chip-green-strong); }
        100% { background-color: var(--chip-green); }
    }
    .suggestion-flash {
        animation: suggestion-flash 0.6s ease-out both;
    }
</style>
