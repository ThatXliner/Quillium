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
    class="bg-gray-50 rounded-lg p-3 my-2 shadow-sm ring-2 {isActive
        ? 'ring-blue-500 ring-4'
        : 'ring-gray-500'}"
>
    <div class="text-sm text-gray-700"></div>
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
