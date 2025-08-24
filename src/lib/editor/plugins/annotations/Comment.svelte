<script lang="ts">
    import { SendHorizonalIcon, SparklesIcon, Trash2 } from "lucide-svelte";
    import type { Annotation, Thread } from ".";
    import CommentThread from "./CommentThread.svelte";
    import { generateText } from "ai";
    import { openai } from "$lib/ai";
    import { editorView } from "$lib/stores";

    const {
        comment,
        isActive,
        removeComment,
        updateThread,
    }: {
        comment: Annotation<"comment">;
        isActive: boolean;
        removeComment: () => void;
        updateThread: (thread: Thread) => void;
    } = $props();
    const thread = $derived(comment.thread);

    let newMessage = $state("");
    function save() {
        // TODO: proper thread
        updateThread([
            ...thread,
            { message: newMessage, author: "User", time: Date.now() },
        ]);
        newMessage = "";
    }
    async function aiSuggestion() {
        // TODO: make this into a mustache template
        // TODO: implement AI suggestion
        let prompt = "Provide suggestions based on the following";
        if (thread.length === 1) {
            prompt += " comment:\n";
        } else {
            prompt += " conversation thread:\n";
        }
        prompt += "```\n";
        if (thread.length === 1) {
            prompt += thread[0].message;
        } else {
            prompt += thread
                .map((message) => `${message.author}: ${message.message}`)
                .join("\n");
        }
        prompt += "\n```\n";
        prompt +=
            "For context, here is the selected text the previous comment is referring to:\n";
        prompt += "```\n";
        const selectionText = $editorView.state.sliceDoc(
            comment.selection.main.from,
            comment.selection.main.to,
        );
        prompt += selectionText;
        prompt += "```\n";
        prompt += "And here is the paragraph the selection is in:\n";
        prompt += "```\n";
        const selectionFrom = comment.selection.main.from;
        const selectionTo = comment.selection.main.to;
        const doc = $editorView.state.doc.toString();
        const paragraphMatch = doc.match(
            new RegExp(
                `[^\n]*${doc.slice(selectionFrom, selectionTo)}[^\n]*`,
                "m",
            ),
        );
        prompt += paragraphMatch ? paragraphMatch[0] : "";
        prompt += "```\n";
        prompt += "Be concise.";
        const response = await generateText({
            model: openai("gpt-5"),
            prompt,
        });

        updateThread([
            ...thread,
            { message: response.text, author: "AI", time: Date.now() },
        ]);
    }
</script>

<div
    class="bg-gray-50 rounded-lg p-3 my-2 shadow-sm ring-2 {isActive
        ? 'ring-blue-500 ring-4'
        : 'ring-gray-500'}"
>
    <div class="text-sm text-gray-700"></div>

    <CommentThread {thread} {updateThread} />
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
        <button
            class="text-gray-400 hover:text-gray-600 transition-colors"
            onclick={() => aiSuggestion()}
        >
            <SparklesIcon size={16} />
        </button>
        <button
            class="text-gray-400 hover:text-gray-600 transition-colors"
            onclick={() => removeComment()}
        >
            <Trash2 size={16} />
        </button>
    </div>
</div>
