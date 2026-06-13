<script lang="ts">
/**
 * PreComment.svelte — Inline "new comment" composer shown when
 * the user has created a comment annotation but hasn't typed a
 * message yet (thread is empty).
 *
 * Props:
 *   - view: EditorView — the CodeMirror editor instance
 *   - annotationsData: Annotations — current annotation map
 *   - activeAnnotationData?: GenericAnnotation | null — the annotation
 *     that is currently selected (should be the pending comment)
 *
 * Events emitted: none (dispatches CodeMirror effects directly)
 * Stores: none (receives data via props from Annotations.svelte)
 *
 * Parent: Annotations.svelte
 * Children: none
 *
 * Behaviour: auto-focuses the textarea when a pending comment
 * exists, and dispatches updateThread or removeAnnotation effects
 * on submit / cancel.
 */
import type { EditorView } from "@codemirror/view";
import { getCurrentUserName } from "$lib/auth";
import { avatarColor, initials } from "$lib/auth/avatarUtils";
import { tick } from "svelte";
import { updateThread, removeAnnotation } from "./annotationField";
import { clearDraft, getDraft, setDraft } from "./drafts.svelte";
import { canCreateNewComment } from "./utils";
import { isAnnotationOfType, type Annotations, type GenericAnnotation } from "./models";
import posthog from "$lib/posthog";

const {
    view,
    annotationsData,
    pendingAnnotation,
    activeAnnotationData,
}: {
    view: EditorView;
    annotationsData: Annotations;
    pendingAnnotation?: GenericAnnotation;
    activeAnnotationData?: GenericAnnotation | null;
} = $props();

let textarea = $state<HTMLTextAreaElement | undefined>();
let focusedPendingId = $state<number | undefined>(undefined);
const currentUserName = $derived(getCurrentUserName());

function resolvePendingComment() {
    if (
        pendingAnnotation &&
        isAnnotationOfType(pendingAnnotation, "comment") &&
        pendingAnnotation.thread.length === 0
    ) {
        return pendingAnnotation;
    }
    if (
        activeAnnotationData &&
        isAnnotationOfType(activeAnnotationData, "comment") &&
        activeAnnotationData.thread.length === 0
    ) {
        return activeAnnotationData;
    }
    return undefined;
}

const pendingComment = $derived(resolvePendingComment());

// Draft text lives in the shared drafts store (keyed by annotation id) so
// it survives this component unmounting — e.g. when a window resize swaps
// the floating card layout for the comment modal (#247).
const commentText = $derived(pendingComment ? getDraft(pendingComment.id) : "");

// Auto-focus the textarea when a pending (unsaved) comment exists
$effect(() => {
    if (
        !canCreateNewComment(annotationsData) &&
        pendingComment &&
        pendingComment.id !== focusedPendingId
    ) {
        const targetId = pendingComment.id;
        tick().then(() => {
            if (resolvePendingComment()?.id === targetId) {
                focusedPendingId = targetId;
                textarea?.focus();
            }
        });
    }
});

// Derive the highlighted text range the pending comment refers to
const selectedText = $derived(
    pendingComment
        ? view.state.sliceDoc(pendingComment.selection.main.from, pendingComment.selection.main.to)
        : "",
);

/**
 * Commit the new comment: append the user's message to the
 * annotation's thread via a CodeMirror updateThread effect.
 * After saving, restore the editor selection to cover the
 * commented text (Google Docs behaviour).
 */
function addComment() {
    if (!pendingComment || !isAnnotationOfType(pendingComment, "comment")) return;
    posthog.capture("comment_created", {
        has_selection: !!selectedText,
        comment_length: commentText.length,
    });
    const { from, to } = pendingComment.selection.main;
    view.dispatch(
        view.state.update({
            effects: [
                updateThread.of({
                    annotationId: pendingComment.id,
                    newThread: [
                        ...pendingComment.thread,
                        {
                            message: commentText,
                            author: currentUserName,
                            time: Date.now(),
                        },
                    ],
                }),
            ],
            // Select the commented text so the active annotation is immediately
            // shown and the card bubbles up next to the highlighted text.
            selection: { anchor: from, head: to },
        }),
    );
    clearDraft(pendingComment.id);
}

/**
 * Discard the pending comment by removing its annotation from
 * the CodeMirror state entirely.
 */
function cancelComment() {
    if (!pendingComment || !isAnnotationOfType(pendingComment, "comment")) return;
    view.dispatch(
        view.state.update({
            effects: [removeAnnotation.of(pendingComment)],
        }),
    );
    clearDraft(pendingComment.id);
}
</script>

<div class="backdrop-blur-md bg-[color:var(--surface-2)] border border-[color:var(--border)] shadow-xl rounded-[14px] overflow-hidden">
    {#if selectedText}
        <div class="px-3 pt-3">
            <div class="text-xs text-[color:var(--text-soft)] border-l-2 border-yellow-400/80 pl-2 truncate italic">
                {selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}
            </div>
        </div>
    {/if}

    <div class="flex gap-2.5 px-3 py-3">
        <div
            class="shrink-0 w-7 h-7 rounded-full shadow-sm flex items-center justify-center text-white text-xs font-semibold"
            style="background: {avatarColor(currentUserName)};"
            title={currentUserName}
        >
            {initials(currentUserName)}
        </div>
        <textarea
            tabindex="0"
            bind:this={textarea}
            bind:value={
                () => commentText,
                (v) => pendingComment && setDraft(pendingComment.id, v)
            }
            onkeydown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && commentText) {
                    addComment();
                    // @ts-ignore
                    e.target.blur();
                }
            }}
            placeholder="Add a comment…"
            class="flex-1 text-xs text-[color:var(--text)] placeholder:text-[color:var(--text-ghost)] bg-transparent resize-none focus:outline-none leading-relaxed"
            rows="2"
        ></textarea>
    </div>

    <div class="flex items-center justify-end gap-2 px-3 pb-2.5 border-t border-[color:var(--border)] pt-2">
        <button
            onclick={cancelComment}
            class="text-xs text-[color:var(--text-faint)] hover:text-[color:var(--text-soft)] transition-colors"
        >
            Cancel
        </button>
        <button
            disabled={!commentText}
            onclick={addComment}
            class="px-3 py-1 bg-blue-500/80 text-white text-xs font-medium rounded-full hover:bg-blue-600/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
            Comment
        </button>
    </div>
</div>
