<script lang="ts">
import { aiSettings, hasApiKey } from "$lib/ai/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import { currentDraftId, modalStack } from "$lib/stores";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { CommentCard } from "@quillium/share";
import { get } from "svelte/store";
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
import { annotationField, updateThread as updateThreadEffect } from ".";
import Thread from "./Thread.svelte";
import { buildCommentAiPrompt, streamCommentAiResponse } from "./commentAi";
import { type CommentEditorPosition, captureCommentEditorPosition } from "./commentFocus";
import { isAnnotationOfType } from "./models";

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
    const owningView = view;
    const requestDraftId = get(currentDraftId);
    const annotationId = comment.id;
    const requestHistoryId = owningView.state.field(annotationField)[annotationId]?._historyId;
    posthog.capture("comment_ai_suggestion_requested", {
        thread_length: thread.length,
        has_selection: !!selectedText,
    });
    const prompt = buildCommentAiPrompt(thread, selectedText);
    // The card may unmount while waiting; append to the original comment
    // using its latest thread, never the component's captured thread.
    const appendAiReply = (message: string): void => {
        if (get(currentDraftId) !== requestDraftId) return;
        const current = owningView.state.field(annotationField)[annotationId];
        if (
            !requestHistoryId ||
            !current ||
            current._historyId !== requestHistoryId ||
            !isAnnotationOfType(current, "comment")
        ) {
            return;
        }
        owningView.dispatch({
            effects: updateThreadEffect.of({
                annotationId,
                newThread: [...current.thread, { message, author: "AI", time: Date.now() }],
            }),
        });
    };
    try {
        const aiResponse = await streamCommentAiResponse(prompt, aiSettings);
        // Empty response means the stream was stopped before any text arrived.
        if (!aiResponse.trim()) return;
        appendAiReply(aiResponse);
    } catch {
        appendAiReply("Sorry, I encountered an error generating a suggestion.");
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
