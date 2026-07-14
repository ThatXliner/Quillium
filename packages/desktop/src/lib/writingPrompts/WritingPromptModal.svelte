<!--
    WritingPromptModal.svelte — Offline inspiration prompt picker.

    Offers a random prompt from the built-in library, optional category filtering,
    and insertion at the main editor selection. Prompt insertion is a normal
    CodeMirror transaction, so persistence, collaboration, and undo all work.
-->
<script lang="ts">
import { capture } from "$lib/posthog";
import { editorView } from "$lib/stores";
import { Transaction } from "@codemirror/state";
import { Dices, Lightbulb, Plus, X } from "lucide-svelte";
import {
    PROMPT_CATEGORIES,
    type PromptCategory,
    type WritingPrompt,
    chooseWritingPrompt,
    formatPromptInsertion,
} from "./prompts";

const { onclose }: { onclose: () => void } = $props();

let dialogEl = $state<HTMLDialogElement | undefined>();
let category = $state<PromptCategory | null>(null);
let prompt = $state<WritingPrompt>(chooseWritingPrompt(null));

$effect(() => {
    if (dialogEl && !dialogEl.open) dialogEl.showModal();
});

function chooseAnother(nextCategory: PromptCategory | null = category): void {
    category = nextCategory;
    prompt = chooseWritingPrompt(category, prompt.id);
    capture("writing_prompt_shuffled", { category: category ?? "all" });
}

function insertPrompt(): void {
    const view = $editorView;
    if (!view) return;

    const selection = view.state.selection.main;
    const insertion = formatPromptInsertion(
        view.state.doc.toString(),
        selection.from,
        selection.to,
        prompt.text,
    );
    view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: insertion.text },
        selection: { anchor: selection.from + insertion.cursorOffset },
        annotations: Transaction.addToHistory.of(true),
        scrollIntoView: true,
    });
    capture("writing_prompt_inserted", { category: prompt.category, promptId: prompt.id });
    onclose();
    requestAnimationFrame(() => view.focus());
}

function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialogEl) onclose();
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="prompt-modal"
    aria-labelledby="writing-prompt-title"
    onclick={handleBackdropClick}
    oncancel={(event) => {
        event.preventDefault();
        onclose();
    }}
>
    <div class="prompt-modal-inner">
        <div class="flex items-center justify-between border-b border-black/[0.06] px-5 py-3.5">
            <div class="flex items-center gap-2">
                <Lightbulb size={15} class="text-amber-500/70" />
                <h2 id="writing-prompt-title" class="text-[13px] font-semibold text-black/60">
                    Writing Prompt
                </h2>
            </div>
            <button
                onclick={onclose}
                aria-label="Close writing prompts"
                class="flex items-center gap-1 rounded-md px-1 py-1 text-black/25 transition-colors hover:bg-black/5 hover:text-black/55"
            >
                <span class="font-mono text-[9px] leading-none text-black/20">esc</span>
                <X size={15} />
            </button>
        </div>

        <div class="flex flex-wrap gap-1.5 px-5 pt-4" aria-label="Prompt category">
            <button
                onclick={() => chooseAnother(null)}
                class:active-category={category === null}
                class="category-pill"
            >
                All
            </button>
            {#each PROMPT_CATEGORIES as item}
                <button
                    onclick={() => chooseAnother(item)}
                    class:active-category={category === item}
                    class="category-pill"
                >
                    {item}
                </button>
            {/each}
        </div>

        <div class="px-5 py-4">
            <div class="prompt-card">
                <span class="text-[10px] font-semibold uppercase tracking-[0.12em] text-black/30">
                    {prompt.category}
                </span>
                <p class="mt-2 text-[17px] leading-relaxed text-black/70">{prompt.text}</p>
            </div>
        </div>

        <div class="flex items-center justify-between border-t border-black/[0.06] px-5 py-3.5">
            <button
                onclick={() => chooseAnother()}
                class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-black/45 transition-colors hover:bg-black/[0.04] hover:text-black/65"
            >
                <Dices size={14} />
                Another prompt
            </button>
            <button
                onclick={insertPrompt}
                disabled={!$editorView}
                class="flex items-center gap-1.5 rounded-lg bg-black/75 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-40"
            >
                <Plus size={14} />
                Insert into draft
            </button>
        </div>
    </div>
</dialog>

<style>
    .prompt-modal {
        width: min(92vw, 560px);
        max-width: none;
        max-height: none;
        margin: auto;
        padding: 0;
        overflow: visible;
        border: none;
        border-radius: 18px;
        background: transparent;
        color: inherit;
    }

    .prompt-modal::backdrop {
        background: rgb(0 0 0 / 0.2);
        backdrop-filter: blur(3px);
    }

    .prompt-modal-inner {
        overflow: hidden;
        border: 1px solid rgb(255 255 255 / 0.6);
        border-radius: 18px;
        background: rgb(250 249 247 / 0.96);
        box-shadow: 0 24px 70px rgb(0 0 0 / 0.2);
    }

    .category-pill {
        border-radius: 999px;
        background: rgb(0 0 0 / 0.035);
        padding: 0.35rem 0.7rem;
        font-size: 0.6875rem;
        color: rgb(0 0 0 / 0.42);
        transition: background-color 120ms ease, color 120ms ease;
    }

    .category-pill:hover {
        background: rgb(0 0 0 / 0.07);
        color: rgb(0 0 0 / 0.62);
    }

    .category-pill.active-category {
        background: rgb(0 0 0 / 0.72);
        color: white;
    }

    .prompt-card {
        min-height: 150px;
        border: 1px solid rgb(0 0 0 / 0.06);
        border-radius: 14px;
        background:
            linear-gradient(135deg, rgb(255 255 255 / 0.7), rgb(255 249 235 / 0.55)),
            rgb(255 255 255 / 0.5);
        padding: 1.25rem;
        box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.8);
    }
</style>
