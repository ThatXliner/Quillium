<script lang="ts">
    import { SendHorizonalIcon, SparklesIcon, Trash2 } from "lucide-svelte";
    import type { Annotation, Thread as ThreadType } from ".";
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

    <Thread {thread} {updateThread} />
    <div class="relative my-3">
        <textarea
            bind:value={newMessage}
            class="w-full resize-none border p-2 border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 h-fit"
            onkeydown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    save();
                }
            }}
            placeholder="Type a message..."
        >
        </textarea>
        <button
            disabled={!newMessage}
            class="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-white bg-blue-500 rounded-full hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onclick={() => {
                save();
            }}
        >
            <SendHorizonalIcon size={16} />
        </button>
    </div>
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
