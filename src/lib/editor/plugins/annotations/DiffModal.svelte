<script lang="ts">
/**
 * DiffModal.svelte — Full-screen modal showing a token-level
 * diff between the original document text and a chosen AI
 * suggestion replacement.
 *
 * Props:
 *   - suggestionId: number — ID of the suggestion annotation
 *   - parentView: EditorView — the CodeMirror editor that
 *     owns the suggestion (used to read annotation state)
 *   - stackIndex: number — this modal's position in the
 *     global modalStack (used for breadcrumb rendering)
 *
 * Events emitted: none
 * Stores:
 *   - modalStack (read/write): breadcrumb trail + pop on close
 *
 * Parent: rendered by the modal layer in +page.svelte
 * Children: none
 *
 * Layout: left pane = diff view, right sidebar = replacement
 * list with optional rationale text.
 */
import { ChevronRight, SparklesIcon, X } from "lucide-svelte";
import type { EditorView } from "@codemirror/view";
import { modalStack } from "$lib/stores";
import { annotationField, diffTokens, tokenize, type Annotation } from ".";

const {
    suggestionId,
    parentView,
    stackIndex,
}: { suggestionId: number; parentView: EditorView; stackIndex: number } = $props();

// Breadcrumb trail sliced up to and including this modal level
const crumbs = $derived($modalStack.slice(0, stackIndex + 1));

const isTop = $derived(stackIndex === $modalStack.length - 1);

let dialogEl = $state<HTMLDialogElement>();

// NOTE: $derived on parentView.state.field(...) is NOT reactive to CodeMirror
// transactions — parentView is a plain prop, not $state, so Svelte cannot track
// mutations to view.state. This expression only runs once at component init.
// Reactivity for state changes would require either a manually-synced $state
// mirror (like modalAnnotations in RevisionModal) or reading from the global
// $annotations store. For DiffModal, the suggestion content is effectively
// static once the modal opens, so the lack of reactivity is acceptable.
const suggestion = $derived(
    parentView.state.field(annotationField)[suggestionId] as Annotation<"suggestion"> | undefined,
);

let selectedIndex = $state(0);

// Compute diff ops whenever the selected replacement changes
const ops = $derived.by(() => {
    if (!suggestion) return [];
    const replacement = suggestion.replacements[selectedIndex];
    if (!replacement) return [];
    const { from, to } = suggestion.selection.main;
    const original = parentView.state.sliceDoc(from, to);
    return diffTokens(tokenize(original), tokenize(replacement.text));
});

function close() {
    modalStack.pop();
}

// Open the <dialog> element as a modal once it is bound.
$effect(() => {
    if (!dialogEl) return;
    if (isTop && !dialogEl.open) {
        dialogEl.showModal();
    } else if (!isTop && dialogEl.open) {
        dialogEl.close();
    }
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="diff-modal"
    onclick={(e) => { if (e.target === dialogEl) close(); }}
    oncancel={(e) => { e.preventDefault(); close(); }}
>
    <div class="diff-modal-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-green-100/80 shrink-0">
            <div class="flex items-center gap-2 min-w-0">
                <SparklesIcon size={13} class="text-green-500/70 shrink-0" />
                <nav class="flex items-center gap-1 min-w-0">
                    {#each crumbs as crumb, ci}
                        {#if ci < crumbs.length - 1}
                            <button
                                class="text-[10px] text-green-500/60 hover:text-green-700/80 transition-colors truncate max-w-[120px] shrink-0"
                                onclick={() => modalStack.popTo(ci)}
                            >{crumb.label}</button>
                            <ChevronRight size={10} class="text-green-300/60 shrink-0" />
                        {:else}
                            <span class="text-[10px] font-semibold text-green-700/70 uppercase tracking-wider truncate">{crumb.label}</span>
                        {/if}
                    {/each}
                </nav>
            </div>
            <button
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors"
                onclick={close}
            >
                <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
                <X size={16} />
            </button>
        </div>

        <!-- Body: diff + sidebar -->
        <div class="flex flex-1 overflow-hidden">
            <!-- Diff -->
            <div class="flex-1 overflow-y-auto px-6 py-5 text-sm leading-relaxed font-mono border-r border-green-50">
                {#each ops as op}
                    {#if op.type === "equal"}
                        <span>{op.text}</span>
                    {:else if op.type === "delete"}
                        <span class="bg-red-100/80 text-red-700 line-through rounded-sm px-0.5">{op.text}</span>
                    {:else}
                        <span class="bg-green-100/80 text-green-700 rounded-sm px-0.5">{op.text}</span>
                    {/if}
                {/each}
            </div>

            <!-- Sidebar: replacements + thread -->
            {#if suggestion}
                <div class="w-64 shrink-0 flex flex-col overflow-hidden border-l border-green-100/60">
                    <!-- AI comment -->
                    {#if suggestion.thread[0]?.author === "AI"}
                        <div class="px-4 pt-4 pb-3 border-b border-green-100/60">
                            <p class="text-[11px] text-black/55 leading-relaxed">{suggestion.thread[0].message}</p>
                        </div>
                    {/if}

                    <!-- Replacements -->
                    <div class="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                        {#each suggestion.replacements as replacement, i}
                            <button
                                class="w-full text-left rounded-lg border overflow-hidden transition-colors
                                    {i === selectedIndex
                                        ? 'bg-green-100/80 border-green-400/50 ring-1 ring-green-400/40'
                                        : 'bg-white/60 border-green-100/60 hover:bg-white/80 hover:border-green-200/60'}"
                                onclick={() => { selectedIndex = i; }}
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
                </div>
            {/if}
        </div>
    </div>
</dialog>

<style>
    .diff-modal {
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

    .diff-modal::backdrop {
        background: rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(4px);
    }

    .diff-modal-inner {
        display: flex;
        flex-direction: column;
        width: 820px;
        height: 72vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        overflow: hidden;
    }
</style>
