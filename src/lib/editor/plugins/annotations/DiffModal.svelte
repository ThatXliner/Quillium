<script lang="ts">
    import { SparklesIcon, X } from "lucide-svelte";
    import { tick } from "svelte";
    import type { EditorView } from "@codemirror/view";
    import { modalStack, type DiffOp } from "$lib/stores";
    import { annotationField, type Annotation } from ".";

    const { ops, suggestionId, parentView }: { ops: DiffOp[]; suggestionId: number; parentView: EditorView } = $props();

    let dialogEl = $state<HTMLDialogElement>();

    const suggestion = $derived(
        parentView.state.field(annotationField)[suggestionId] as Annotation<"suggestion"> | undefined,
    );

    function close() {
        modalStack.pop();
    }

    $effect(() => {
        tick().then(() => {
            if (dialogEl && !dialogEl.open) dialogEl.showModal();
        });
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="diff-modal"
    onclick={(e) => { if (e.target === dialogEl) close(); }}
>
    <div class="diff-modal-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-green-100/80 shrink-0">
            <div class="flex items-center gap-2">
                <SparklesIcon size={13} class="text-green-500/70" />
                <span class="text-xs font-semibold text-green-700/70 uppercase tracking-wider">AI Suggestion</span>
            </div>
            <button
                class="p-1 rounded-md text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors"
                onclick={close}
            >
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
                            <div class="rounded-lg border bg-white/60 border-green-100/60 overflow-hidden">
                                <div class="px-3 py-2 text-xs text-black/80 leading-relaxed">{replacement.text}</div>
                                {#if replacement.rationale}
                                    <div class="px-3 pb-2 text-[10px] text-green-700/60 leading-snug border-t border-green-100/50 pt-1.5">
                                        {replacement.rationale}
                                    </div>
                                {/if}
                            </div>
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
