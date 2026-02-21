<script lang="ts">
    import { Trash2 } from "lucide-svelte";
    import { streamChat } from "$lib/ai/clientStreams";
    import { aiSettings } from "$lib/ai/settings.svelte";
    import type { EditorView } from "@codemirror/view";
    import type { Annotation, Thread as ThreadType } from ".";
    import Thread from "./Thread.svelte";

    const {
        comment,
        isActive,
        view,
        removeComment,
        updateThread,
    }: {
        comment: Annotation<"comment">;
        isActive: boolean;
        view: EditorView;
        removeComment: () => void;
        updateThread: (thread: ThreadType) => void;
    } = $props();

    const thread = $derived(comment.thread);

    const selectedText = $derived(
        view.state.sliceDoc(comment.selection.main.from, comment.selection.main.to),
    );

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
        prompt += selectedText;
        prompt += "```\n";
        prompt += "Be concise.";

        try {
            const stream = streamChat({
                messages: [{ id: "1", role: "user", parts: [{ type: "text", text: prompt }] }],
                documentContent: "",
                selectedText,
                provider: aiSettings.provider,
                model: aiSettings.model,
                apiKey: aiSettings.apiKey,
            });

            const reader = stream.getReader();
            let aiResponse = "";

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value?.type === "text-delta") {
                    aiResponse += value.delta;
                }
            }

            updateThread([
                ...thread,
                { message: aiResponse, author: "AI", time: Date.now() },
            ]);
        } catch {
            updateThread([
                ...thread,
                {
                    message: "Sorry, I encountered an error generating a suggestion.",
                    author: "AI",
                    time: Date.now(),
                },
            ]);
        }
    }
</script>

<div
    class="border shadow-lg overflow-hidden transition-all duration-200
        {isActive
            ? 'bg-blue-50/90 border-blue-200/60 shadow-xl rounded-[14px]'
            : 'bg-blue-50/60 border-blue-200/40 rounded-[12px] opacity-90 hover:opacity-100'}"
    style="backdrop-filter: blur(12px);"
>
    <!-- Header -->
    <div class="flex items-center justify-between px-3 pt-3 pb-0">
        <h3 class="text-[10px] font-semibold text-blue-600/70 uppercase tracking-wider">Comment</h3>
        <button
            class="p-1 rounded-md text-blue-400/50 hover:text-red-500/60 hover:bg-white/40 transition-colors"
            onclick={() => removeComment()}
            title="Delete comment"
        >
            <Trash2 size={16} />
        </button>
    </div>

    <!-- Quoted text chip -->
    {#if selectedText}
        <div class="px-3 pt-3 pb-0">
            <div class="text-xs text-black/50 border-l-2 border-yellow-400/80 pl-2 truncate italic">
                {selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}
            </div>
        </div>
    {/if}

    <!-- Thread -->
    <div class="px-3 pt-3 pb-3">
        <Thread
            {thread}
            {updateThread}
            previewOnly={!isActive}
            onAiSuggest={isActive ? aiSuggestion : undefined}
            accentClass="text-blue-600/80 hover:text-blue-700"
        />
    </div>
</div>
