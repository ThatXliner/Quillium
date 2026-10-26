<script lang="ts">
/**
 * SuggestionModalContent.svelte — Shared suggestion-diff presentation and selection state.
 *
 * Mutation controls and an interactive thread are optional host capabilities.
 */
import type { Snippet } from "svelte";
import ThreadList from "../cards/ThreadList.svelte";
import type { SuggestionReplacementView, ThreadMessageView } from "../cards/types";
import { wordDiff } from "../diff";

let {
    selectionKey,
    originalText,
    replacements,
    messages = [],
    onSelectionChange,
    threadContent,
    actions,
}: {
    selectionKey?: string | number;
    originalText: string;
    replacements: SuggestionReplacementView[];
    messages?: ThreadMessageView[];
    onSelectionChange?: (index: number) => void;
    threadContent?: Snippet;
    actions?: Snippet<[number]>;
} = $props();

let selectedIndex = $state(0);
let previousSelectionKey = $state<string | number | undefined>();
let selectionKeyInitialized = $state(false);
const selectedReplacement = $derived(replacements[selectedIndex] ?? replacements[0]);
const operations = $derived(
    selectedReplacement ? wordDiff(originalText, selectedReplacement.text) : [],
);
const overallComment = $derived(messages[0]?.author === "AI" ? messages[0] : null);
const replies = $derived(overallComment ? messages.slice(1) : messages);

$effect(() => {
    if (!selectionKeyInitialized) {
        previousSelectionKey = selectionKey;
        selectionKeyInitialized = true;
        return;
    }
    if (selectionKey === previousSelectionKey) return;
    previousSelectionKey = selectionKey;
    selectedIndex = 0;
    onSelectionChange?.(0);
});

$effect(() => {
    if (selectedIndex < replacements.length) return;
    selectedIndex = Math.max(0, replacements.length - 1);
    onSelectionChange?.(selectedIndex);
});

function selectReplacement(index: number): void {
    selectedIndex = index;
    onSelectionChange?.(index);
}
</script>

<div class="suggestion-modal-content" data-suggestion-modal-content>
    <div class="diff-pane" data-suggestion-modal-diff>
        {#each operations as operation}
            {#if operation.type === "equal"}
                <span data-suggestion-diff="equal">{operation.text}</span>
            {:else if operation.type === "delete"}
                <span data-suggestion-diff="delete" class="diff-delete">{operation.text}</span>
            {:else}
                <span data-suggestion-diff="insert" class="diff-insert">{operation.text}</span>
            {/if}
        {/each}
    </div>

    <aside class="suggestion-sidebar">
        {#if overallComment}
            <div class="ai-comment">
                <p>{overallComment.message}</p>
            </div>
        {/if}

        <div class="replacement-stack">
            {#each replacements as replacement, index (`modal-suggestion-${index}`)}
                <button
                    class="replacement-card"
                    class:is-active={index === selectedIndex}
                    type="button"
                    aria-pressed={index === selectedIndex}
                    onclick={() => selectReplacement(index)}
                >
                    <p>{replacement.text}</p>
                    {#if replacement.rationale}
                        <p class="replacement-rationale">{replacement.rationale}</p>
                    {/if}
                </button>
            {/each}
        </div>

        {#if threadContent}
            <div class="suggestion-thread">
                {@render threadContent()}
            </div>
        {:else if replies.length > 0}
            <div class="suggestion-thread" data-suggestion-modal-thread>
                <ThreadList thread={replies} />
            </div>
        {/if}

        {#if actions}
            <div class="suggestion-actions">
                {@render actions(selectedIndex)}
            </div>
        {/if}
    </aside>
</div>

<style>
    .suggestion-modal-content {
        display: flex;
        min-height: 0;
        flex: 1;
        overflow: hidden;
    }

    .diff-pane {
        min-width: 0;
        flex: 1;
        overflow-y: auto;
        border-right: 1px solid var(--border, rgba(0, 0, 0, 0.06));
        padding: 1.25rem 1.5rem;
        color: var(--text, rgba(0, 0, 0, 0.82));
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.875rem;
        line-height: 1.65;
    }

    .diff-delete,
    .diff-insert {
        border-radius: 0.125rem;
        padding: 0 0.125rem;
    }

    .diff-delete {
        background: rgba(254, 226, 226, 0.8);
        color: rgb(185, 28, 28);
        text-decoration: line-through;
    }

    .diff-insert {
        background: rgba(220, 252, 231, 0.9);
        color: rgb(21, 128, 61);
    }

    .suggestion-sidebar {
        display: flex;
        width: 16rem;
        min-height: 0;
        flex-shrink: 0;
        flex-direction: column;
        overflow: hidden;
        border-left: 1px solid rgba(187, 247, 208, 0.6);
    }

    .ai-comment {
        flex-shrink: 0;
        border-bottom: 1px solid rgba(187, 247, 208, 0.6);
        padding: 1rem 1rem 0.75rem;
    }

    .ai-comment p,
    .replacement-card p {
        margin: 0;
    }

    .ai-comment p {
        color: var(--text-soft, rgba(0, 0, 0, 0.55));
        font-size: 11px;
        line-height: 1.5;
    }

    .replacement-stack {
        display: grid;
        flex: 1;
        gap: 0.5rem;
        overflow-y: auto;
        padding: 0.75rem;
    }

    .replacement-card {
        width: 100%;
        border: 1px solid rgba(34, 197, 94, 0.16);
        border-radius: 0.65rem;
        background: var(--surface-2, rgba(255, 255, 255, 0.6));
        padding: 0.75rem;
        text-align: left;
        transition:
            border-color 0.15s ease,
            background-color 0.15s ease,
            box-shadow 0.15s ease;
    }

    .replacement-card:hover {
        border-color: rgba(34, 197, 94, 0.28);
        background: rgba(255, 255, 255, 0.8);
    }

    .replacement-card.is-active {
        border-color: var(--tint-green-border, rgba(74, 222, 128, 0.5));
        background: var(--tint-green-active, rgba(220, 252, 231, 0.8));
        box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.4);
    }

    .replacement-card p {
        color: var(--text, rgba(0, 0, 0, 0.8));
        font-size: 0.82rem;
        line-height: 1.55;
    }

    .replacement-card.is-active p {
        color: var(--text-strong, rgba(0, 0, 0, 0.88));
    }

    .replacement-rationale {
        margin-top: 0.5rem !important;
        padding-top: 0.375rem;
        border-top: 1px solid rgba(187, 247, 208, 0.5);
        color: rgba(21, 128, 61, 0.72) !important;
        font-size: 10px !important;
        line-height: 1.35 !important;
    }

    .suggestion-thread {
        max-height: 10rem;
        flex-shrink: 0;
        overflow-y: auto;
        border-top: 1px solid rgba(187, 247, 208, 0.6);
        padding: 0.625rem 0.75rem;
    }

    .suggestion-actions {
        flex-shrink: 0;
        border-top: 1px solid rgba(187, 247, 208, 0.6);
        padding: 0.75rem;
    }

    @media (max-width: 860px) {
        .suggestion-modal-content {
            display: block;
            overflow-y: auto;
        }

        .diff-pane {
            min-height: 18rem;
        }

        .suggestion-sidebar {
            width: auto;
            min-height: 18rem;
            border-width: 1px 0;
        }
    }
</style>
