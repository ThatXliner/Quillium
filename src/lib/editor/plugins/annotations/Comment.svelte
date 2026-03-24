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
import { Trash2, Expand } from "lucide-svelte";
import { aiSettings } from "$lib/ai/settings.svelte";
import { buildCommentAiPrompt, streamCommentAiResponse } from "./commentAi";
import posthog from "$lib/posthog";
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { Annotation, Thread as ThreadType } from ".";
import Thread from "./Thread.svelte";
import { modalStack } from "$lib/stores";

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

async function aiSuggestion() {
    posthog.capture("comment_ai_suggestion_requested", {
        thread_length: thread.length,
        has_selection: !!selectedText,
    });
    const prompt = buildCommentAiPrompt(thread, selectedText);
    try {
        const aiResponse = await streamCommentAiResponse(prompt, selectedText, aiSettings);
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
        <div class="flex items-center gap-0.5">
            <button
                class="p-1 rounded-md text-blue-400/50 hover:text-blue-600/70 hover:bg-white/40 transition-colors"
                onclick={() => {
                    posthog.capture("comment_modal_opened", {
                        thread_length: thread.length,
                    });
                    modalStack.push({
                        type: "comment",
                        commentId: comment.id,
                        parentView: view,
                        label: selectedText.slice(0, 40) || "Comment",
                    });
                }}
                title="Expand thread"
                aria-label="Expand comment thread"
            >
                <Expand size={14} />
            </button>
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
                aria-label="Delete comment"
            >
                <Trash2 size={16} />
            </button>
        </div>
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
            {view}
            annotationId={comment.id}
            previewOnly={!isActive}
            onAiSuggest={isActive ? aiSuggestion : undefined}
            accentClass="text-blue-600/80 hover:text-blue-700"
        />
    </div>
</div>
