<script lang="ts">
    import type { EditorView } from "@codemirror/view";
    import { GitBranchIcon, Trash2 } from "lucide-svelte";
    import {
        applySuggestion,
        branchSuggestion,
        previewSuggestion,
        type Annotation,
        type Thread as ThreadType,
    } from ".";
    import { EditorSelection } from "@codemirror/state";
    import Thread from "./Thread.svelte";

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

    const originalText = $derived(
        view.state.sliceDoc(
            suggestion.selection.main.from,
            suggestion.selection.main.to,
        ),
    );

    let selectedIndex = $state<number | null>(null);

    function selectReplacement(index: number) {
        const next = selectedIndex === index ? null : index;
        selectedIndex = next;
        // Move cursor to the suggestion range and preview the replacement
        view.dispatch({
            effects: [previewSuggestion.of(
                next === null
                    ? null
                    : { annotationId: suggestion.id, replacementIndex: next },
            )],
            selection: EditorSelection.single(suggestion.selection.main.from),
            scrollIntoView: true,
        });
        view.focus();
    }
</script>

<div
    class="backdrop-blur-md border overflow-hidden transition-all duration-200
        {isActive
            ? 'bg-gray-200/80 border-white/50 shadow-xl rounded-[14px]'
            : 'bg-gray-300/70 border-white/30 shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}"
>
    <!-- Header -->
    <div class="flex items-center justify-between px-3 pt-3 pb-0">
        <h3 class="text-[10px] font-semibold text-black/40 uppercase tracking-wider">Suggestion</h3>
        <button
            class="p-1 rounded-md text-black/25 hover:text-red-500/60 hover:bg-white/40 transition-colors"
            onclick={() => remove()}
            title="Delete suggestion"
        >
            <Trash2 size={14} />
        </button>
    </div>

    <!-- Original text chip -->
    {#if originalText}
        <div class="px-3 pt-2 pb-0">
            <div class="text-xs text-black/50 border-l-2 border-green-400/80 pl-2 truncate line-through decoration-green-600/60">
                {originalText.slice(0, 80)}{originalText.length > 80 ? "…" : ""}
            </div>
        </div>
    {/if}

    <!-- Replacements -->
    <div class="p-3 space-y-1.5">
        {#each suggestion.replacements as replacement, index}
            {@const isSelected = selectedIndex === index}
            <button
                class="w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors
                    {isSelected
                        ? 'bg-green-100/70 border-green-400/50 text-green-900 ring-1 ring-green-400/40'
                        : 'bg-white/40 border-white/30 text-black/80 hover:bg-white/60'}"
                onclick={() => selectReplacement(index)}
            >
                {replacement}
            </button>
        {/each}
    </div>

    <!-- Apply / Branch row -->
    {#if isActive}
        <div class="flex items-center justify-between px-2 pb-3 gap-1.5">
            <button
                aria-label="Branch instead"
                title="Convert to revision with original and suggestion as versions"
                class="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-purple-600/70
                    bg-white/30 hover:bg-white/50 rounded-md ring-1 ring-white/30 transition-colors"
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
                        : 'bg-white/30 text-black/30 ring-white/20 cursor-not-allowed'}"
                onclick={() => {
                    if (selectedIndex === null) return;
                    // Clear preview before applying (doc change clears it too, but be explicit)
                    view.dispatch(
                        applySuggestion(view.state, suggestion.id, selectedIndex),
                    );
                }}
            >
                Apply
            </button>
        </div>
    {/if}

    <!-- Thread -->
    {#if thread.length > 0}
        <div class="border-t border-black/[0.07] px-3 py-2.5">
            <Thread {thread} {updateThread} />
        </div>
    {/if}
</div>
