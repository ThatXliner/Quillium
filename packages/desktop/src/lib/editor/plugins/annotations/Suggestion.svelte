<script lang="ts">
/**
 * Suggestion.svelte — Adapter around the shared @quillium/share SuggestionCard.
 *
 * Presentation (replacements, inline diff, apply/branch, reply thread) lives in
 * the shared package so the editor and the web preview render the SAME card.
 * This adapter owns the editor-only wiring — apply/branch dispatch, diff modal,
 * draft store, PostHog, personas — passed down as callbacks.
 */
import { getCurrentUserName } from "$lib/auth";
import posthog from "$lib/posthog";
import { readersSettings } from "$lib/readers/settings.svelte";
import { modalStack } from "$lib/stores";
import type { EditorView } from "@codemirror/view";
import { SuggestionCard } from "@quillium/share";
import { type Annotation, applySuggestion, branchSuggestion } from ".";
import { clearDraft, getDraft, setDraft } from "./drafts.svelte";

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
    updateThread: (thread: Annotation<"suggestion">["thread"]) => void;
} = $props();

const thread = $derived(suggestion.thread);
const originalText = $derived(
    view.state.sliceDoc(suggestion.selection.main.from, suggestion.selection.main.to),
);

function send() {
    const text = getDraft(suggestion.id).trim();
    if (!text) return;
    updateThread([...thread, { message: text, author: getCurrentUserName(), time: Date.now() }]);
    clearDraft(suggestion.id);
}

function apply(replacementIndex: number) {
    posthog.capture("suggestion_applied", {
        replacement_index: replacementIndex,
        replacement_count: suggestion.replacements.length,
    });
    view.dispatch(applySuggestion(view.state, suggestion.id, replacementIndex));
}

function branch() {
    posthog.capture("suggestion_branched", {
        replacement_count: suggestion.replacements.length,
    });
    view.dispatch(branchSuggestion(view.state, suggestion.id));
}

function expand() {
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
</script>

<SuggestionCard
    replacements={suggestion.replacements}
    {originalText}
    {thread}
    {isActive}
    personas={readersSettings.personas}
    onDelete={deleteSuggestion}
    onExpand={expand}
    onApply={apply}
    onBranch={branch}
    onUpdateThread={updateThread}
    replyValue={getDraft(suggestion.id)}
    onReplyInput={(v) => setDraft(suggestion.id, v)}
    onSend={send}
    onEscape={() => view.focus()}
/>
