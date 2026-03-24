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
import { ChevronRight, ChevronDown, ChevronUp, MessageSquare, SparklesIcon, X } from "lucide-svelte";
import { slide } from "svelte/transition";
import type { EditorView } from "@codemirror/view";
import { modalStack, annotations as annotationsStore, modalAnnotationStores } from "$lib/stores";
import { updateThread } from "./annotationField";
import type { Annotation, Thread as ThreadType } from ".";
import Thread from "./Thread.svelte";
import Kbd from "$lib/ui/Kbd.svelte";
import { aiSettings } from "$lib/ai/settings.svelte";
import { buildCommentAiPrompt, streamCommentAiResponse } from "./commentAi";
import posthog from "$lib/posthog";

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
const comment = $derived(
    (stackIndex === 0
        ? $annotationsStore
        : $modalAnnotationStores[stackIndex - 1]
    )?.[commentId] as Annotation<"comment"> | undefined,
);

const selectedText = $derived(
    comment
        ? parentView.state.sliceDoc(
              comment.selection.main.from,
              comment.selection.main.to,
          )
        : "",
);

// ── Context panel ────────────────────────────────────────────
const CHUNK = 300;
let contextBefore = $state(CHUNK);
let contextAfter = $state(CHUNK);
let contextCollapsed = $state(false);
let contextScrollEl = $state<HTMLDivElement | undefined>(undefined);
let contextCommentEl = $state<HTMLSpanElement | undefined>(undefined);
let commentDirection = $state<"above" | "below" | null>(null);
let contextAtTop = $state(true);
let contextAtBottom = $state(false);

type DocContext = {
    before: string;
    comment: string;
    after: string;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
};

const docContext = $derived.by((): DocContext | null => {
    if (!comment) return null;
    const doc = parentView.state.doc;
    const from = comment.selection.main.from;
    const to = comment.selection.main.to;
    const beforeStart = Math.max(0, from - contextBefore);
    const afterEnd = Math.min(doc.length, to + contextAfter);
    return {
        before: doc.sliceString(beforeStart, from),
        comment: doc.sliceString(from, to),
        after: doc.sliceString(to, afterEnd),
        hasMoreBefore: beforeStart > 0,
        hasMoreAfter: afterEnd < doc.length,
    };
});

function scrollCommentIntoCenter(behavior: ScrollBehavior = "smooth") {
    if (!contextScrollEl || !contextCommentEl) return;
    const container = contextScrollEl;
    const containerRect = container.getBoundingClientRect();
    const commentRect = contextCommentEl.getBoundingClientRect();
    const currentTop = container.scrollTop;
    const targetTop =
        currentTop +
        (commentRect.top - containerRect.top) -
        (container.clientHeight / 2 - commentRect.height / 2);
    container.scrollTo({ top: targetTop, behavior });
}

$effect(() => {
    if (contextCollapsed || !contextCommentEl || !contextScrollEl) return;
    requestAnimationFrame(() => scrollCommentIntoCenter("auto"));
    const id = window.setTimeout(() => scrollCommentIntoCenter("auto"), 220);
    return () => window.clearTimeout(id);
});

$effect(() => {
    if (!contextCommentEl || !contextScrollEl) return;
    const observer = new IntersectionObserver(
        ([entry]) => {
            if (entry.isIntersecting) {
                commentDirection = null;
            } else {
                const rect = entry.boundingClientRect;
                const rootRect = entry.rootBounds;
                if (rootRect) {
                    commentDirection = rect.top < rootRect.top ? "above" : "below";
                }
            }
        },
        { root: contextScrollEl, threshold: 0.1 },
    );
    observer.observe(contextCommentEl);
    return () => observer.disconnect();
});

$effect(() => {
    const el = contextScrollEl;
    if (!el) return;
    function updateEdges() {
        if (!el) return;
        contextAtTop = el.scrollTop <= 0;
        contextAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 0;
    }
    updateEdges();
    function handleScroll() {
        if (!el) return;
        updateEdges();
        const THRESHOLD = 40;
        if (el.scrollTop < THRESHOLD && docContext?.hasMoreBefore) {
            const prevHeight = el.scrollHeight;
            contextBefore += CHUNK;
            requestAnimationFrame(() => {
                el.scrollTop += el.scrollHeight - prevHeight;
            });
        }
        if (
            el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD &&
            docContext?.hasMoreAfter
        ) {
            contextAfter += CHUNK;
        }
    }
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
});

// ── Reply box state ──────────────────────────────────────────
let newMessage = $state("");
let textareaEl = $state<HTMLTextAreaElement | undefined>();
let isFocused = $state(false);
const sendActive = $derived(!!newMessage.trim());

function send() {
    if (!newMessage.trim() || !comment) return;
    handleUpdateThread([
        ...comment.thread,
        { message: newMessage.trim(), author: "User", time: Date.now() },
    ]);
    newMessage = "";
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
        const aiResponse = await streamCommentAiResponse(prompt, selectedText, aiSettings);
        handleUpdateThread([
            ...currentThread,
            { message: aiResponse, author: "AI", time: Date.now() },
        ]);
    } catch {
        handleUpdateThread([
            ...currentThread,
            { message: "Sorry, I encountered an error generating a suggestion.", author: "AI", time: Date.now() },
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
        <div class="flex items-center justify-between px-5 py-3 border-b border-blue-100/80 shrink-0 gap-3 min-w-0">
            <div class="flex items-center gap-2 min-w-0 flex-1">
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
                            <span class="text-[10px] font-semibold text-blue-700/70 uppercase tracking-wider shrink-0">Comment</span>
                        {/if}
                    {/each}
                </nav>
            </div>
            <button
                class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors shrink-0"
                onclick={close}
            >
                <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
                <X size={16} />
            </button>
        </div>

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
                                bind:value={newMessage}
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

            <!-- Right sidebar: context (1/3 of modal) -->
            {#if docContext}
                <div class="w-1/3 shrink-0 border-l border-blue-100/60 flex flex-col min-h-0 bg-blue-50/20">
                    <div class="flex-1 min-h-0 flex flex-col">
                        <button
                            class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-blue-50/60 transition-colors"
                            onclick={() => (contextCollapsed = !contextCollapsed)}
                        >
                            <span class="text-[9px] font-semibold text-blue-600/60 uppercase tracking-wider">Context</span>
                            {#if contextCollapsed}
                                <ChevronDown size={10} class="text-blue-400/50" />
                            {:else}
                                <ChevronUp size={10} class="text-blue-400/50" />
                            {/if}
                        </button>
                        {#if !contextCollapsed}
                            <div transition:slide={{ duration: 180 }} class="relative flex-1 min-h-0 flex flex-col">
                                <div
                                    bind:this={contextScrollEl}
                                    class="context-scroll"
                                    style="mask-image: linear-gradient(to bottom, {contextAtTop ? 'black' : 'transparent'} 0%, black 22%, black 78%, {contextAtBottom ? 'black' : 'transparent'} 100%); -webkit-mask-image: linear-gradient(to bottom, {contextAtTop ? 'black' : 'transparent'} 0%, black 22%, black 78%, {contextAtBottom ? 'black' : 'transparent'} 100%);"
                                >
                                    <span class="context-text">
                                        {#if docContext.before}<span class="context-surrounding">{docContext.before}</span>{/if}<!--
                                        --><span bind:this={contextCommentEl} class="context-comment">{docContext.comment || "(empty)"}</span><!--
                                        -->{#if docContext.after}<span class="context-surrounding">{docContext.after}</span>{/if}
                                    </span>
                                </div>
                                {#if commentDirection}
                                    <button
                                        class="context-jump-btn {commentDirection === 'above' ? 'context-jump-top' : 'context-jump-bottom'}"
                                        onclick={() => scrollCommentIntoCenter()}
                                        title="Jump to comment"
                                    >
                                        {#if commentDirection === "above"}
                                            <ChevronUp size={14} />
                                        {:else}
                                            <ChevronDown size={14} />
                                        {/if}
                                    </button>
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>
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
        width: 1060px;
        height: 72vh;
        background: white;
        border-radius: 1rem;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        overflow: hidden;
    }

    .context-scroll {
        height: 100%;
        overflow-y: auto;
        scrollbar-width: none;
        -ms-overflow-style: none;
        padding: 10px 14px;
        background: rgba(239, 246, 255, 0.45);
        backdrop-filter: blur(12px) saturate(1.3);
        -webkit-backdrop-filter: blur(12px) saturate(1.3);
    }

    .context-scroll::-webkit-scrollbar {
        display: none;
    }

    .context-text {
        display: block;
        font-size: 11px;
        line-height: 1.7;
        color: rgba(30, 64, 120, 0.35);
        font-family: var(--doc-font-family, system-ui, sans-serif);
        white-space: pre-wrap;
        word-break: break-word;
    }

    .context-surrounding {
        color: rgba(30, 64, 120, 0.35);
    }

    .context-comment {
        display: inline;
        border-radius: 4px;
        padding: 1px 3px;
        background: rgba(253, 224, 71, 0.25);
        color: rgba(120, 80, 10, 0.75);
        box-shadow: inset 0 0 0 1px rgba(253, 224, 71, 0.45);
    }

    .context-jump-btn {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 3px 5px;
        font-size: 10px;
        font-weight: 500;
        color: rgba(37, 99, 235, 0.8);
        background: rgba(239, 246, 255, 0.85);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border: 1px solid rgba(147, 197, 253, 0.5);
        border-radius: 99px;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.12);
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
        z-index: 2;
    }

    .context-jump-btn:hover {
        background: rgba(219, 234, 254, 0.95);
        color: rgba(37, 99, 235, 1);
    }

    .context-jump-top {
        top: 4px;
    }

    .context-jump-bottom {
        bottom: 4px;
    }
</style>
