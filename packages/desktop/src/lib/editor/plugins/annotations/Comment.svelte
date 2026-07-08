<script lang="ts">
/**
 * Comment.svelte — Adapter around the shared @quillium/share CommentCard.
 *
 * The presentation (card chrome, quoted text, thread, reply footer) now lives
 * in the shared package so the editor and the web preview render the SAME
 * component. This adapter owns the editor-only wiring — draft store, AI,
 * PostHog, modal stack, cursor jump — and passes it down as callbacks.
 *
 * Props:
 *   - comment: Annotation<"comment"> — the annotation data
 *   - isActive: boolean — whether this comment is currently selected
 *   - view: EditorView — the parent CodeMirror editor
 *   - removeComment: () => void — delete this annotation
 *   - updateThread: (thread) => void — replace the thread array
 *
 * PoC note: the Kbd keycap pills and the annotation-focus-reply auto-focus that
 * the old inline Thread had are not yet threaded through the shared component.
 */
import { getCurrentUserName } from "$lib/auth";
import { aiSettings } from "$lib/ai/settings.svelte";
import posthog from "$lib/posthog";
import { readersSettings } from "$lib/readers/settings.svelte";
import { appSettings } from "$lib/settings.svelte";
import { modalStack } from "$lib/stores";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { CommentCard } from "@quillium/share";
import type { Annotation } from ".";
import { annotationField } from ".";
import { buildCommentAiPrompt, streamCommentAiResponse } from "./commentAi";
import { clearDraft, getDraft, setDraft } from "./drafts.svelte";

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
    updateThread: (thread: Annotation<"comment">["thread"]) => void;
} = $props();

const thread = $derived(comment.thread);
const selectedText = $derived(
    view.state.sliceDoc(comment.selection.main.from, comment.selection.main.to),
);

async function aiSuggestion() {
    posthog.capture("comment_ai_suggestion_requested", {
        thread_length: thread.length,
        has_selection: !!selectedText,
    });
    const annotationId = comment.id;
    const prompt = buildCommentAiPrompt(thread, selectedText);
    try {
        const aiResponse = await streamCommentAiResponse(prompt, aiSettings);
        if (!aiResponse.trim()) return;
        if (!view.state.field(annotationField)[annotationId]) return;
        updateThread([...thread, { message: aiResponse, author: "AI", time: Date.now() }]);
    } catch {
        if (!view.state.field(annotationField)[annotationId]) return;
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

function send() {
    const text = getDraft(comment.id).trim();
    if (!text) return;
    updateThread([...thread, { message: text, author: getCurrentUserName(), time: Date.now() }]);
    clearDraft(comment.id);
}

function jumpToComment() {
    view.dispatch({
        selection: EditorSelection.cursor(comment.selection.main.from),
        scrollIntoView: true,
    });
}

function expand() {
    posthog.capture("comment_modal_opened", { thread_length: thread.length });
    modalStack.push({
        type: "comment",
        commentId: comment.id,
        parentView: view,
        label: selectedText.slice(0, 40) || "Comment",
    });
}

function deleteComment() {
    posthog.capture("annotation_deleted", { type: "comment", thread_length: thread.length });
    removeComment();
}
</script>

<CommentCard
    {selectedText}
    {thread}
    {isActive}
    personas={readersSettings.personas}
    onDelete={deleteComment}
    onExpand={expand}
    onJumpTo={jumpToComment}
    onUpdateThread={updateThread}
    replyValue={getDraft(comment.id)}
    onReplyInput={(v) => setDraft(comment.id, v)}
    onSend={send}
    onEscape={() => view.focus()}
    onAiSuggest={isActive && appSettings.aiEnabled ? aiSuggestion : undefined}
/>
