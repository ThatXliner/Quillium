<script lang="ts">
    import { SendHorizonalIcon, SparklesIcon, Trash2 } from "lucide-svelte";
    import {
        applySuggestion,
        type Annotation,
        type Thread as ThreadType,
    } from ".";
    import Thread from "./Thread.svelte";
    import { editorView } from "$lib/stores";

    const {
        suggestion,
        isActive,
        remove,
        updateThread,
    }: {
        suggestion: Annotation<"suggestion">;
        isActive: boolean;
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
    class="group relative bg-white rounded-lg p-3 my-2 transition-all duration-300 ease-out {isActive
        ? 'shadow-xl ring-2 ring-green-500 scale-[1.02]'
        : 'shadow-md hover:shadow-lg ring-1 ring-gray-200 hover:ring-gray-300'}"
    role="button"
    tabindex="0"
    onclick={() => {
        // Focus the annotation in the editor
        if ($editorView && suggestion.selection) {
            $editorView.dispatch({
                selection: suggestion.selection,
                scrollIntoView: true,
            });
        }
    }}
    onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if ($editorView && suggestion.selection) {
                $editorView.dispatch({
                    selection: suggestion.selection,
                    scrollIntoView: true,
                });
            }
        }
    }}
>
    <!-- Connection line indicator -->
    <div class="absolute -left-4 top-1/2 -translate-y-1/2 w-3 h-0.5 bg-gradient-to-r {isActive 
        ? 'from-green-500 to-transparent opacity-100' 
        : 'from-gray-300 to-transparent opacity-0 group-hover:opacity-100'} transition-opacity duration-200"></div>
    
    <!-- Annotation type badge -->
    <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
            Suggestion
        </span>
        <span class="text-xs text-gray-400">
            Line {Math.max(1, $editorView?.state.doc.lineAt(suggestion.selection.main.from).number || 1)}
        </span>
    </div>
    <div class="mb-3">
        <div class="text-xs text-gray-500 mb-2 font-medium">Suggestions:</div>
        <div class="space-y-1">
            {#each suggestion.replacements as replacement, index}
                <button
                    class="w-full text-left p-2 rounded bg-white border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors text-sm"
                    onclick={() => {
                        $editorView.dispatch(
                            applySuggestion(
                                $editorView.state,
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
    <Thread {thread} {updateThread} />

    <div class="flex justify-end gap-2">
        <!-- <button
            class="text-gray-400 hover:text-gray-600 transition-colors"
            onclick={() => aiSuggestion()}
        >
            <SparklesIcon size={16} />
        </button> -->
        <button
            class="text-gray-400 hover:text-gray-600 transition-colors"
            onclick={() => remove()}
        >
            <Trash2 size={16} />
        </button>
    </div>
</div>
