<script lang="ts">
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
import { ChevronRight, MessageSquare, X } from "lucide-svelte";
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { modalStack, annotations as annotationsStore } from "$lib/stores";
import { updateThread } from "./annotationField";
import type { Annotation, Thread as ThreadType } from ".";
import Thread from "./Thread.svelte";
import { streamChat } from "$lib/ai/clientStreams";
import { aiSettings } from "$lib/ai/settings.svelte";
import posthog from "$lib/posthog";

const {
    commentId,
    parentView,
    stackIndex,
}: { commentId: number; parentView: EditorView; stackIndex: number } = $props();

// Breadcrumb trail sliced up to and including this modal level
const crumbs = $derived($modalStack.slice(0, stackIndex + 1));

const isTop = $derived(stackIndex === $modalStack.length - 1);

let dialogEl = $state<HTMLDialogElement>();

// Read comment reactively from the global annotations store so
// thread updates made here reflect immediately.
const comment = $derived(
    $annotationsStore?.[commentId] as Annotation<"comment"> | undefined,
);

const selectedText = $derived(
    comment
        ? parentView.state.sliceDoc(
              comment.selection.main.from,
              comment.selection.main.to,
          )
        : "",
);

function close() {
    modalStack.pop();
}

// Open/close the <dialog> based on isTop
$effect(() => {
    if (!dialogEl) return;
    if (isTop && !dialogEl.open) {
        dialogEl.showModal();
    } else if (!isTop && dialogEl.open) {
        dialogEl.close();
    }
});

function handleUpdateThread(newThread: ThreadType) {
    if (!comment) return;
    parentView.dispatch({
        effects: updateThread.of({ annotationId: commentId, newThread }),
    });
}

async function aiSuggestion() {
    if (!comment) return;
    const currentThread = comment.thread;
    posthog.capture("comment_ai_suggestion_requested", {
        thread_length: currentThread.length,
        has_selection: !!selectedText,
        from_modal: true,
    });

    let prompt = "Provide suggestions based on the following";
    if (currentThread.length === 1) {
        prompt += " comment:\n";
    } else {
        prompt += " conversation thread:\n";
    }
    prompt += "```\n";
    if (currentThread.length === 1) {
        prompt += currentThread[0].message;
    } else {
        prompt += currentThread.map((m) => `${m.author}: ${m.message}`).join("\n");
    }
    prompt += "\n```\n";
    prompt += "For context, here is the selected text the comment is referring to:\n";
    prompt += "```\n";
    prompt += selectedText;
    prompt += "```\n";
    prompt += "Be concise.";

    try {
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

        handleUpdateThread([
            ...currentThread,
            { message: aiResponse, author: "AI", time: Date.now() },
        ]);
    } catch {
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

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<dialog
    bind:this={dialogEl}
    class="comment-modal"
    onclick={(e) => { if (e.target === dialogEl) close(); }}
    oncancel={(e) => { e.preventDefault(); close(); }}
>
    <div class="comment-modal-inner">
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-blue-100/80 shrink-0">
            <div class="flex items-center gap-2 min-w-0">
                <MessageSquare size={13} class="text-blue-500/70 shrink-0" />
                <nav class="flex items-center gap-1 min-w-0">
                    {#each crumbs as crumb, ci}
                        {#if ci < crumbs.length - 1}
                            <button
                                class="text-[10px] text-blue-500/60 hover:text-blue-700/80 transition-colors truncate max-w-[120px] shrink-0"
                                onclick={() => modalStack.popTo(ci)}
                            >{crumb.label}</button>
                            <ChevronRight size={10} class="text-blue-300/60 shrink-0" />
                        {:else}
                            <span class="text-[10px] font-semibold text-blue-700/70 uppercase tracking-wider truncate">{crumb.label}</span>
                        {/if}
                    {/each}
                </nav>
            </div>
            <button
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors"
                onclick={close}
            >
                <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
                <X size={16} />
            </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto px-6 py-5">
            {#if comment}
                <!-- Quoted text -->
                {#if selectedText}
                    <button
                        class="w-full text-left text-sm text-black/50 border-l-2 border-yellow-400/80
                            pl-3 mb-5 italic hover:text-black/70 hover:border-yellow-500/80
                            transition-colors leading-relaxed"
                        onclick={() => {
                            close();
                            parentView.dispatch({
                                selection: EditorSelection.cursor(comment.selection.main.from),
                                scrollIntoView: true,
                            });
                        }}
                        title="Jump to this comment in the document"
                    >
                        {selectedText}
                    </button>
                {/if}

                <Thread
                    thread={comment.thread}
                    updateThread={handleUpdateThread}
                    annotationId={commentId}
                    view={parentView}
                    previewOnly={false}
                    onAiSuggest={aiSuggestion}
                    accentClass="text-blue-600/80 hover:text-blue-700"
                    sendPillClass="bg-blue-500 text-white hover:bg-blue-600"
                    focusRingClass="focus-within:ring-blue-300/50"
                />
            {:else}
                <p class="text-sm text-black/40 text-center mt-8">Comment not found.</p>
            {/if}
        </div>
    </div>
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

    .comment-modal-inner {
        display: flex;
        flex-direction: column;
        width: 560px;
        max-height: 72vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        overflow: hidden;
    }
</style>
