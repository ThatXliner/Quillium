<script lang="ts">
/**
 * Comment.svelte — Displays a single comment annotation card with
 * its message thread and AI suggestion action.
 *
 * Props:
 *   - comment: Annotation<"comment"> — the annotation data
 *   - isActive: boolean — whether this comment is currently selected
 *   - view: EditorView — the parent CodeMirror editor
 *   - removeComment: () => void — callback to delete this annotation
 *   - updateThread: (thread: ThreadType) => void — callback to
 *     replace the thread array (appends reply or AI response)
 *
 * Events emitted: none (delegates via callbacks)
 * Stores: none (reads aiSettings for AI provider config)
 *
 * Parent: Annotations.svelte
 * Children: Thread.svelte (handles message list, reply input, AI suggest)
 *
 * Behaviour: when collapsed (!isActive), Thread renders only the first
 * message. When active, the full thread, reply input, and "Suggest"
 * button are visible.
 */
import { Trash2 } from "lucide-svelte";
import { streamChat } from "$lib/ai/clientStreams";
import { aiSettings } from "$lib/ai/settings.svelte";
import posthog from "posthog-js";
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
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

// Derive thread and selected text from the annotation data
const thread = $derived(comment.thread);

const selectedText = $derived(
    view.state.sliceDoc(comment.selection.main.from, comment.selection.main.to),
);

/**
 * Build an AI prompt from the thread + selected text, stream
 * the response, and append it as an "AI" message in the thread.
 */
async function aiSuggestion() {
    posthog.capture("comment_ai_suggestion_requested", {
        thread_length: thread.length,
        has_selection: !!selectedText,
    });
    const prompt = buildAiPrompt();

    try {
        const aiResponse = await streamAiResponse(prompt);
        updateThread([...thread, { message: aiResponse, author: "AI", time: Date.now() }]);
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

/**
 * Construct the prompt string sent to the AI, including the
 * thread messages and the document text the comment refers to.
 */
function buildAiPrompt(): string {
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
        prompt += thread.map((message) => `${message.author}: ${message.message}`).join("\n");
    }
    prompt += "\n```\n";
    prompt += "For context, here is the selected text the comment is referring to:\n";
    prompt += "```\n";
    prompt += selectedText;
    prompt += "```\n";
    prompt += "Be concise.";
    return prompt;
}

/**
 * Open a streaming chat connection and collect the full AI
 * text-delta response into a single string.
 */
async function streamAiResponse(prompt: string): Promise<string> {
    const stream = streamChat({
        messages: [
            {
                id: "1",
                role: "user",
                parts: [{ type: "text", text: prompt }],
            },
        ],
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

    return aiResponse;
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
            onclick={() => {
                posthog.capture("annotation_deleted", {
                    type: "comment",
                    thread_length: thread.length,
                });
                removeComment();
            }}
            title="Delete comment"
        >
            <Trash2 size={16} />
        </button>
    </div>

    <!-- Quoted text chip — clicking jumps cursor into the annotation range -->
    {#if selectedText}
        <div class="px-3 pt-3 pb-0">
            <button
                class="w-full text-left text-xs text-black/50 border-l-2 border-yellow-400/80 pl-2 truncate italic hover:text-black/70 hover:border-yellow-500/80 transition-colors cursor-pointer"
                onclick={() => {
                    view.dispatch({
                        selection: EditorSelection.cursor(comment.selection.main.from),
                        scrollIntoView: true,
                    });
                }}
                title="Jump to this comment in the document"
            >
                {selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}
            </button>
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
