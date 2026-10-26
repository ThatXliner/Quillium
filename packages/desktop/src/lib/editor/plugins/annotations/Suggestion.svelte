<script lang="ts">
import posthog from "$lib/posthog";
import { modalStack } from "$lib/stores";
import type { EditorView } from "@codemirror/view";
import { SuggestionCard, type SuggestionDiffOperation } from "@quillium/share";
import {
    type Annotation,
    type Thread as ThreadType,
    applySuggestion,
    branchSuggestion,
    wordDiff,
} from ".";
import Thread from "./Thread.svelte";

const {
    suggestion,
    isActive,
    view,
    remove,
    updateThread,
}: {
    suggestion: Annotation<"suggestion">;
    isActive: boolean;
    view: EditorView;
    remove: () => void;
    updateThread: (thread: ThreadType) => void;
} = $props();

const thread = $derived(suggestion.thread);
const overallComment = $derived(
    thread.length > 0 && thread[0].author === "AI" ? thread[0].message : undefined,
);
const hasReplies = $derived((thread[0]?.author === "AI" ? thread.slice(1) : thread).length > 0);
const replyThread = $derived(thread[0]?.author === "AI" ? thread.slice(1) : thread);

function updateReplyThread(nextReplies: ThreadType): void {
    updateThread(thread[0]?.author === "AI" ? [thread[0], ...nextReplies] : nextReplies);
}

function getDiffOperations(replacementIndex: number): SuggestionDiffOperation[] {
    const { from, to } = suggestion.selection.main;
    const replacement = suggestion.replacements[replacementIndex];
    if (!replacement) return [];
    return wordDiff(view.state.sliceDoc(from, to), replacement.text);
}

function openSuggestion() {
    posthog.capture("suggestion_diff_modal_opened", {
        replacement_count: suggestion.replacements.length,
    });
    modalStack.push({
        type: "diff",
        suggestionId: suggestion.id,
        parentView: view,
        label: "AI Suggestion",
    });
}

function deleteSuggestion() {
    posthog.capture("annotation_deleted", {
        type: "suggestion",
        replacement_count: suggestion.replacements.length,
    });
    remove();
}

function branch() {
    posthog.capture("suggestion_branched", {
        replacement_count: suggestion.replacements.length,
    });
    view.dispatch(branchSuggestion(view.state, suggestion.id));
}

function apply(index: number) {
    posthog.capture("suggestion_applied", {
        replacement_index: index,
        replacement_count: suggestion.replacements.length,
    });
    view.dispatch(applySuggestion(view.state, suggestion.id, index));
}

function trackDiff(index: number) {
    posthog.capture("suggestion_diff_viewed", {
        replacement_index: index,
        replacement_count: suggestion.replacements.length,
    });
}
</script>

{#snippet threadContent()}
    <Thread
        thread={replyThread}
        updateThread={updateReplyThread}
        annotationId={suggestion.id}
    />
{/snippet}

<SuggestionCard
    annotationId={suggestion.id}
    active={isActive}
    replacements={suggestion.replacements}
    {overallComment}
    onOpen={openSuggestion}
    onDelete={deleteSuggestion}
    onBranch={branch}
    onApply={apply}
    onDiffViewed={trackDiff}
    {getDiffOperations}
    thread={hasReplies ? threadContent : undefined}
/>
