<script lang="ts">
    import type { EditorView } from "@codemirror/view";
    import { GitBranchIcon, SendHorizonalIcon, SparklesIcon, Trash2 } from "lucide-svelte";
    import {
        applySuggestion,
        branchSuggestion,
        type Annotation,
        type Thread as ThreadType,
    } from ".";
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

    let newMessage = $state("");
    function save() {
        // TODO: proper thread
        updateThread([
            ...thread,
            { message: newMessage, author: "User", time: Date.now() },
        ]);
        newMessage = "";
    }
</script>

<div
    class="backdrop-blur-md border overflow-hidden transition-all duration-200
        {isActive
            ? 'bg-gray-200/80 border-white/50 shadow-xl rounded-[14px]'
            : 'bg-gray-300/70 border-white/30 shadow-lg rounded-[12px] opacity-90 hover:opacity-100'}"
>
    <div class="p-3 space-y-2">
        <div class="text-xs font-semibold text-black/50 uppercase tracking-wider">Suggestions</div>
        <div class="space-y-1">
            {#each suggestion.replacements as replacement, index}
                <button
                    class="w-full text-left px-3 py-2 rounded-lg bg-white/40 inset-shadow-sm inset-shadow-white border border-white/30 hover:bg-white/60 transition-colors text-xs text-black/80"
                    onclick={() => {
                        view.dispatch(
                            applySuggestion(
                                view.state,
                                suggestion.id,
                                index,
                            ),
                        );
                    }}
                >
                    {replacement}
                </button>
            {/each}
        </div>
    </div>

    <div class="w-full h-px bg-black/10"></div>

    <div class="p-3">
        <Thread {thread} {updateThread} />
    </div>

    <div class="flex items-center justify-between px-2 pb-2">
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
            <span>Branch instead</span>
        </button>
        <button
            aria-label="Delete suggestion"
            class="p-1.5 rounded-lg text-black/30 hover:text-red-500/70 hover:bg-white/40 transition-colors"
            onclick={() => remove()}
        >
            <Trash2 size={13} />
        </button>
    </div>
</div>
