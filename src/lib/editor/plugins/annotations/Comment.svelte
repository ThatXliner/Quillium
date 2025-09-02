<script lang="ts">
    import { SendHorizonalIcon, SparklesIcon, Trash2 } from "lucide-svelte";
    import type { Annotation, Thread as ThreadType } from ".";
    import Thread from "./Thread.svelte";
    import { editorView } from "$lib/stores";
    import { highlightAnnotation } from "./highlightEffect";

    const {
        comment,
        isActive,
        removeComment,
        updateThread,
    }: {
        comment: Annotation<"comment">;
        isActive: boolean;
        removeComment: () => void;
        updateThread: (thread: ThreadType) => void;
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
            "For context, here is the selected text the comment is referring to:\n";
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

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [{ role: "user", content: prompt }],
                }),
            });

            if (!response.ok) throw new Error("Failed to get AI response");

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response body");

            const decoder = new TextDecoder();
            let done = false;
            let aiResponse = "";

            while (!done) {
                const { value, done: streamDone } = await reader.read();
                done = streamDone;

                if (value) {
                    const chunk = decoder.decode(value);
                    const lines = chunk
                        .split("\n")
                        .filter((line) => line.trim() !== "");

                    for (const line of lines) {
                        if (line.startsWith("0:")) {
                            try {
                                const content = JSON.parse(line.slice(2));
                                aiResponse += content;
                            } catch (e) {
                                // Skip parsing errors
                            }
                        }
                    }
                }
            }

            updateThread([
                ...thread,
                { message: aiResponse, author: "AI", time: Date.now() },
            ]);
        } catch (error) {
            console.error("Error getting AI suggestion:", error);
            updateThread([
                ...thread,
                {
                    message:
                        "Sorry, I encountered an error generating a suggestion.",
                    author: "AI",
                    time: Date.now(),
                },
            ]);
        }
    }
</script>

<div
    class="group relative bg-white rounded-lg p-3 my-2 transition-all duration-300 ease-out {isActive
        ? 'shadow-xl ring-2 ring-blue-500 scale-[1.02]'
        : 'shadow-md hover:shadow-lg ring-1 ring-gray-200 hover:ring-gray-300'}"
    role="button"
    tabindex="0"
    onclick={() => {
        // Focus the annotation in the editor
        if ($editorView && comment.selection) {
            $editorView.dispatch({
                selection: comment.selection,
                scrollIntoView: true,
            });
        }
    }}
    onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if ($editorView && comment.selection) {
                $editorView.dispatch({
                    selection: comment.selection,
                    scrollIntoView: true,
                });
            }
        }
    }}
    onmouseenter={() => {
        // Highlight the annotation in the editor
        if ($editorView) {
            $editorView.dispatch({
                effects: highlightAnnotation.of(comment),
            });
        }
    }}
    onmouseleave={() => {
        // Remove highlight
        if ($editorView) {
            $editorView.dispatch({
                effects: highlightAnnotation.of(null),
            });
        }
    }}
>
    <!-- Connection line indicator -->
    <div class="absolute -left-4 top-1/2 -translate-y-1/2 w-3 h-0.5 bg-gradient-to-r {isActive 
        ? 'from-blue-500 to-transparent opacity-100' 
        : 'from-gray-300 to-transparent opacity-0 group-hover:opacity-100'} transition-opacity duration-200"></div>
    <!-- Annotation type badge -->
    <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
            Comment
        </span>
        <span class="text-xs text-gray-400">
            Line {Math.max(1, $editorView?.state.doc.lineAt(comment.selection.main.from).number || 1)}
        </span>
    </div>

    <Thread {thread} {updateThread} />
    <div class="relative my-3 transition-all duration-200 {isActive ? 'opacity-100' : 'opacity-90'}">
        <textarea
            bind:value={newMessage}
            class="w-full resize-none border p-2 rounded-md border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent h-fit transition-all duration-200"
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
    <div class="flex justify-end gap-2 transition-opacity duration-200 {isActive ? 'opacity-100' : 'opacity-60 hover:opacity-100'}">
        <button
            class="text-gray-400 hover:text-purple-600 transition-all duration-200 hover:scale-110"
            onclick={() => aiSuggestion()}
            title="Get AI suggestion"
        >
            <SparklesIcon size={16} />
        </button>
        <button
            class="text-gray-400 hover:text-red-600 transition-all duration-200 hover:scale-110"
            onclick={() => removeComment()}
            title="Delete comment"
        >
            <Trash2 size={16} />
        </button>
    </div>
</div>
