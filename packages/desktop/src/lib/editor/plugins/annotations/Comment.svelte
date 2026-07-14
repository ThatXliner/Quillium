<script lang="ts">
import { aiSettings, hasApiKey } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import { modalStack } from "$lib/stores";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { CommentCard } from "@quillium/share";
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
import type { Annotation, Thread as ThreadType } from ".";
import { annotationField } from ".";
import Thread from "./Thread.svelte";
import { buildCommentAiPrompt, streamCommentAiResponse } from "./commentAi";
import { type CommentEditorPosition, captureCommentEditorPosition } from "./commentFocus";

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

let replyOrigin = $state<CommentEditorPosition | undefined>();

async function aiSuggestion() {
    posthog.capture("comment_ai_suggestion_requested", {
        thread_length: thread.length,
        has_selection: !!selectedText,
    });
    const annotationId = comment.id;
    const prompt = buildCommentAiPrompt(thread, selectedText);
    try {
        const aiResponse = await streamCommentAiResponse(prompt, aiSettings);
        // Empty response means the stream was stopped before any text arrived.
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

function openComment() {
    posthog.capture("comment_modal_opened", { thread_length: thread.length });
    modalStack.push({
        type: "comment",
        commentId: comment.id,
        parentView: view,
        label: selectedText.slice(0, 40) || "Comment",
        originSelection: captureCommentEditorPosition(view),
    });
}

function deleteComment() {
    posthog.capture("annotation_deleted", {
        type: "comment",
        thread_length: thread.length,
    });
    removeComment();
}

function selectCommentText() {
    replyOrigin = captureCommentEditorPosition(view);
    view.dispatch({
        selection: EditorSelection.cursor(comment.selection.main.from),
        scrollIntoView: true,
    });
}
</script>

{#snippet threadContent()}
        <Thread
            {thread}
            {updateThread}
            {view}
            annotationId={comment.id}
            previewOnly={!isActive}
            originPosition={replyOrigin}
            onRestoreOrigin={() => (replyOrigin = undefined)}
            onAiSuggest={isActive && appSettings.aiEnabled ? aiSuggestion : undefined}
            aiSuggestDisabled={!hasApiKey()}
            onDisabledAiSuggest={() => appEventBus.emit({ type: "ai-open-settings" })}
            accentClass="text-blue-600/80 hover:text-blue-700"
        />
{/snippet}

<CommentCard
    annotationId={comment.id}
    active={isActive}
    {selectedText}
    onSelectText={selectCommentText}
    onOpen={openComment}
    onDelete={deleteComment}
    thread={threadContent}
/>
