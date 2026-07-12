<script lang="ts">
import { aiSettings } from "$lib/ai/settings.svelte";
import { getCurrentUserName } from "$lib/auth";
import posthog from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import { annotations as annotationsStore, modalAnnotationStores, modalStack } from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import type { EditorView } from "@codemirror/view";
import {
    type AnnotationContextViewLayer,
    AnnotationModalFrame,
    AnnotationModalHeader,
    ContextViewport,
} from "@quillium/share";
/**
 * CommentModal.svelte — Full-screen modal that shows a comment
 * thread expanded, making long discussions easy to read and reply to.
 *
 * Props:
 *   - commentId: number — ID of the comment annotation
 *   - parentView: EditorView — the CodeMirror editor that owns
 *     the comment (used to read state and dispatch updates)
 *   - stackIndex: number — this modal's position in the global
 *     modalStack (used for breadcrumb rendering)
 *
 * Events emitted: none
 * Stores:
 *   - modalStack (read/write): breadcrumb trail + pop on close
 *   - annotations (read): reactive mirror of annotationField
 *
 * Parent: rendered by the modal layer in +page.svelte
 * Children: Thread.svelte
 */
import { ChevronRight, MessageSquare, SparklesIcon, Trash2 } from "lucide-svelte";
import { type Annotation, type Thread as ThreadType, isAnnotationOfType } from ".";
import Thread from "./Thread.svelte";
import { annotationField, removeAnnotation, updateThread } from "./annotationField";
import { buildCommentAiPrompt, streamCommentAiResponse } from "./commentAi";
import { clearDraft, getDraft, setDraft } from "./drafts.svelte";

const {
    commentId,
    parentView,
    stackIndex,
}: { commentId: number; parentView: EditorView; stackIndex: number } = $props();

const crumbs = $derived($modalStack.slice(0, stackIndex + 1));
const isTop = $derived(stackIndex === $modalStack.length - 1);

let dialogEl = $state<HTMLDialogElement>();

// Read comment from the correct annotation source:
// - stackIndex 0 → main editor's global annotations store
// - stackIndex N → parent modal's nested annotation store (index N-1)
const comment = $derived.by((): Annotation<"comment"> | undefined => {
    const annotation =
        (stackIndex === 0 ? $annotationsStore : $modalAnnotationStores[stackIndex - 1])?.[
            commentId
        ] ?? parentView.state.field(annotationField)[commentId];
    return annotation && isAnnotationOfType(annotation, "comment") ? annotation : undefined;
});

const selectedText = $derived(
    comment
        ? parentView.state.sliceDoc(comment.selection.main.from, comment.selection.main.to)
        : "",
);

// ── Context panel ────────────────────────────────────────────
const CHUNK = 300;
const INITIAL_CHUNK = 1500;
let contextBefore = $state(INITIAL_CHUNK);
let contextAfter = $state(INITIAL_CHUNK);

const docContext = $derived.by((): AnnotationContextViewLayer | null => {
    if (!comment) return null;
    const doc = parentView.state.doc;
    const from = comment.selection.main.from;
    const to = comment.selection.main.to;
    const beforeStart = Math.max(0, from - contextBefore);
    const afterEnd = Math.min(doc.length, to + contextAfter);
    return {
        before: doc.sliceString(beforeStart, from),
        revision: doc.sliceString(from, to),
        after: doc.sliceString(to, afterEnd),
        hasMoreBefore: beforeStart > 0,
        hasMoreAfter: afterEnd < doc.length,
    };
});
const contextLayers = $derived(docContext ? [docContext] : []);

// ── Reply box state ──────────────────────────────────────────
// Reply draft lives in the shared drafts store (keyed by annotation id) so
// it hands off to/from the inline composers when the layout switches
// between floating cards and this modal (#247).
const newMessage = $derived(getDraft(commentId));
let textareaEl = $state<HTMLTextAreaElement | undefined>();
let isFocused = $state(false);
const currentUserName = $derived(getCurrentUserName());
const sendActive = $derived(!!newMessage.trim());

function send() {
    if (!newMessage.trim() || !comment) return;
    handleUpdateThread([
        ...comment.thread,
        { message: newMessage.trim(), author: currentUserName, time: Date.now() },
    ]);
    clearDraft(commentId);
}

function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
}

// ── Dialog open/close ────────────────────────────────────────
function close() {
    modalStack.pop();
}

$effect(() => {
    if (!dialogEl) return;
    if (isTop && !dialogEl.open) {
        dialogEl.showModal();
    } else if (!isTop && dialogEl.open) {
        dialogEl.close();
    }
});

// ── Thread mutations ─────────────────────────────────────────
function handleUpdateThread(newThread: ThreadType) {
    if (!comment) return;
    parentView.dispatch({
        effects: updateThread.of({ annotationId: commentId, newThread }),
    });
}

/** Delete the comment (parity with the inline card's trash icon). */
function deleteComment() {
    if (!comment) return;
    posthog.capture("annotation_deleted", { type: "comment", from_modal: true });
    parentView.dispatch({ effects: removeAnnotation.of(comment) });
    close();
}

async function aiSuggestion() {
    if (!comment) return;
    const currentThread = comment.thread;
    posthog.capture("comment_ai_suggestion_requested", {
        thread_length: currentThread.length,
        has_selection: !!selectedText,
        from_modal: true,
    });
    const prompt = buildCommentAiPrompt(currentThread, selectedText);
    try {
        const aiResponse = await streamCommentAiResponse(prompt, aiSettings);
        // Empty response means the stream was stopped before any text arrived.
        if (!aiResponse.trim()) return;
        if (!parentView.state.field(annotationField)[commentId]) return;
        handleUpdateThread([
            ...currentThread,
            { message: aiResponse, author: "AI", time: Date.now() },
        ]);
    } catch {
        if (!parentView.state.field(annotationField)[commentId]) return;
        handleUpdateThread([
            ...currentThread,
            {
                message: "Sorry, I encountered an error generating a suggestion.",
                author: "AI",
                time: Date.now(),
            },
        ]);
    }
}
</script>

{#snippet commentHeaderLeading()}
    <MessageSquare size={13} class="text-blue-500/70 shrink-0" />
    <nav class="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
        {#each crumbs as crumb, ci}
            {#if ci > 0}
                <ChevronRight size={10} class="text-blue-300/60 shrink-0" />
            {/if}
            {#if ci < crumbs.length - 1}
                <button
                    class="text-[10px] text-blue-500/60 hover:text-blue-700/80 transition-colors truncate max-w-[120px] shrink-0"
                    onclick={() => modalStack.popTo(ci)}
                >{crumb.label}</button>
            {:else}
                <span
                    class="text-[10px] font-semibold text-blue-700/70 uppercase tracking-wider shrink-0"
                    >Comment</span
                >
            {/if}
        {/each}
    </nav>
{/snippet}

{#snippet commentHeaderActions()}
    <button
        class="p-1 rounded-md text-blue-400/50 hover:text-red-500/60 hover:bg-blue-50/80 transition-colors"
        onclick={deleteComment}
        title="Delete comment"
        aria-label="Delete comment"
    >
        <Trash2 size={16} />
    </button>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="comment-modal"
    onclick={(e) => { if (e.target === dialogEl) close(); }}
    oncancel={(e) => { e.preventDefault(); close(); }}
>
    <AnnotationModalFrame variant="comment">
        <AnnotationModalHeader
            accent="comment"
            leading={commentHeaderLeading}
            actions={commentHeaderActions}
            onClose={close}
            closeLabel="Close comment"
        />

        <!-- Body -->
        <div class="flex flex-1 overflow-hidden">
            <!-- Thread (main): messages scroll, reply anchored at bottom -->
            <div class="flex-1 flex flex-col min-h-0">
                <!-- Scrollable messages -->
                <div class="flex-1 overflow-y-auto px-6 pt-5 pb-3">
                    {#if comment}
                        <Thread
                            thread={comment.thread}
                            updateThread={handleUpdateThread}
                            annotationId={commentId}
                            view={parentView}
                            previewOnly={false}
                            hideReply={true}
                            accentClass="text-blue-600/80 hover:text-blue-700"
                        />
                    {:else}
                        <p class="text-sm text-black/40 text-center mt-8">Comment not found.</p>
                    {/if}
                </div>

                <!-- Reply box anchored at bottom -->
                {#if comment}
                    <div class="px-6 pb-5 pt-2 shrink-0">
                        <div class="rounded-[10px] bg-white/60 inset-shadow-sm inset-shadow-white overflow-hidden
                            ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-blue-300/50 transition-shadow">
                            <textarea
                                bind:this={textareaEl}
                                bind:value={() => newMessage, (v) => setDraft(commentId, v)}
                                placeholder="Reply…"
                                rows="3"
                                class="w-full text-xs bg-transparent px-3 pt-2.5 pb-1 resize-none focus:outline-none
                                    text-black/70 placeholder:text-black/30 max-h-48 overflow-y-auto"
                                onfocus={() => (isFocused = true)}
                                onblur={() => (isFocused = false)}
                                oninput={(e) => autoResize(e.currentTarget)}
                                onkeydown={(e) => {
                                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                        e.preventDefault();
                                        send();
                                    } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        textareaEl?.blur();
                                    }
                                }}
                            ></textarea>
                            <div class="flex items-center justify-between px-2 pb-1.5">
                                <div class="flex items-center gap-1">
                                    {#if appSettings.aiEnabled}
                                    <button
                                        aria-label="Get AI suggestion"
                                        title="Get AI suggestion"
                                        class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                                            text-black/35 hover:text-black/60 hover:bg-white/50 transition-colors"
                                        onclick={aiSuggestion}
                                    >
                                        <SparklesIcon size={11} />
                                        <span>Suggest</span>
                                    </button>
                                    {/if}
                                </div>
                                <div class="flex items-center gap-1.5">
                                    <button
                                        onclick={sendActive ? send : undefined}
                                        class="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[10px] font-medium transition-all duration-150
                                            {sendActive ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm' : 'bg-black/5 text-black/30'}"
                                    >
                                        {isFocused ? "Send" : "Reply"}
                                        <span class="flex items-center gap-0.5">
                                            <Kbd keys={isFocused ? ["⌘", "↵"] : ["⌘", "/"]}
                                                variant={sendActive ? "fullWhite" : isFocused ? "whiteGhost" : "default"} />
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>

            <!-- Right sidebar: context + future sections (1/3 of modal) -->
            {#if docContext}
                <div class="w-1/3 shrink-0 border-l border-blue-100/60 flex flex-col min-h-0 bg-blue-50/20">
                    <ContextViewport
                        layers={contextLayers}
                        variant="comment"
                        targetLabel="comment"
                        centerKey={commentId}
                        fill
                        onLoadMoreBefore={() => (contextBefore += CHUNK)}
                        onLoadMoreAfter={() => (contextAfter += CHUNK)}
                    />
                </div>
            {/if}
        </div>
    </AnnotationModalFrame>
</dialog>

<style>
    .comment-modal {
        border: none;
        padding: 0;
        background: transparent;
        width: 100vw;
        height: 100vh;
        max-width: 100vw;
        max-height: 100vh;
    }

    .comment-modal[open] {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .comment-modal::backdrop {
        background: rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(4px);
    }

</style>
