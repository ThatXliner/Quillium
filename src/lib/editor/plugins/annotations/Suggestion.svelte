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
    class="bg-white rounded-lg p-3 my-2 shadow-sm transition-shadow {isActive
        ? 'ring-2 ring-blue-500'
        : 'ring-1 ring-gray-200'}"
>
    <div class="mb-3">
        <div class="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Suggestions</div>
        <div class="space-y-1">
            {#each suggestion.replacements as replacement, index}
                <button
                    class="w-full text-left px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 hover:bg-blue-50 hover:border-blue-300 transition-colors text-sm text-gray-800"
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

    <div class="flex justify-end gap-1 mt-2">
        <button
            aria-label="Delete suggestion"
            class="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            onclick={() => remove()}
        >
            <Trash2 size={14} />
        </button>
    </div>
</div>
