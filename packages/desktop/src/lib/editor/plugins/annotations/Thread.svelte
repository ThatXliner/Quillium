<script lang="ts">
import { getCurrentUserName } from "$lib/auth";
import { getCommentSubmission } from "$lib/collab/commentSubmission.svelte";
import { roleContext } from "$lib/collab/roleContext";
import { annotationEventBus } from "$lib/events/annotationEventBus";
import Kbd from "$lib/ui/Kbd.svelte";
import type { EditorView } from "@codemirror/view";
import { ThreadList, type ThreadMessageView } from "@quillium/share";
/**
 * Thread.svelte — Renders a message list, reply textarea, and optional
 * AI suggest button for a comment/revision/suggestion thread.
 *
 * Props:
 *   - thread: Thread — array of messages to display
 *   - updateThread: (thread: Thread) => void — callback to replace
 *     the entire thread array (used on reply send or AI response)
 *   - previewOnly?: boolean — when true, shows only the first message
 *     and hides the reply input (collapsed card state)
 *   - onAiSuggest?: () => void — when provided, renders the AI
 *     suggest button in the reply footer
 *   - accentClass?: string — Tailwind classes for the Send button color
 *
 * Events emitted: none (delegates mutation via updateThread callback)
 * Stores: none
 *
 * Parent: Comment.svelte, Revision.svelte, Suggestion.svelte
 * Children: ThreadMessage.svelte (one per message)
 */
import { SparklesIcon } from "lucide-svelte";
import { tick } from "svelte";
import { cubicOut } from "svelte/easing";
import { slide } from "svelte/transition";
import type { Thread as ThreadType } from ".";
import ThreadMessage from "./ThreadMessage.svelte";
import { annotationField } from "./annotationField";
import {
    type CommentEditorPosition,
    captureCommentEditorPosition,
    restoreCommentEditorPosition,
} from "./commentFocus";
import { clearDraft, getCommentDraftScope, getDraft, setDraft } from "./drafts.svelte";

let {
    thread,
    updateThread,
    annotationId,
    view,
    // When true shows only the first message (collapsed comment card preview)
    previewOnly = false,
    // When provided, renders the AI suggest button in the reply footer
    onAiSuggest = undefined,
    aiSuggestDisabled = false,
    onDisabledAiSuggest = undefined,
    // Accent colour class for the Send button; defaults to blue
    accentClass = "text-blue-600/80 hover:text-blue-700",
    // Pill bg/text classes for the send pill (active state)
    sendPillClass = "bg-blue-500 text-white hover:bg-blue-600",
    // Focus ring colour class applied to the reply box wrapper
    focusRingClass = "focus-within:ring-blue-300/50",
    // When true, hides the reply input so the caller can render it
    // separately (e.g. anchored to the bottom of a modal column)
    hideReply = false,
    commentThread = false,
    originPosition = undefined,
    onRestoreOrigin = undefined,
}: {
    thread: ThreadType;
    updateThread: (thread: ThreadType) => void;
    annotationId: number;
    view: EditorView;
    previewOnly?: boolean;
    onAiSuggest?: (() => void) | undefined;
    aiSuggestDisabled?: boolean;
    onDisabledAiSuggest?: (() => void) | undefined;
    accentClass?: string;
    sendPillClass?: string;
    focusRingClass?: string;
    hideReply?: boolean;
    commentThread?: boolean;
    originPosition?: CommentEditorPosition;
    onRestoreOrigin?: () => void;
} = $props();

const newMessage = $derived(getDraft(view, annotationId));
let textareaEl = $state<HTMLTextAreaElement | undefined>();
let sendButton = $state<HTMLButtonElement | undefined>();
let isFocused = $state(false);
let originSelection = $state<ReturnType<typeof captureCommentEditorPosition> | undefined>();
const currentUserName = $derived(getCurrentUserName());
const hasText = $derived(!!newMessage.trim());
const submission = $derived(getCommentSubmission(view, annotationId));

const composerAccess = $derived.by(() => {
    getCommentDraftScope(view);
    const role = view.state.facet(roleContext)?.role;
    return {
        canEdit: role ? role === "editor" : !view.state.readOnly,
        canComment: role ? role !== "viewer" : !view.state.readOnly,
    };
});
const submissionError = $derived.by(() => {
    const error = submission?.error;
    if (!error) return "";
    if (/not found|Invalid comment (scope|thread)|selection.*available/.test(error))
        return "This text or comment has changed. Copy your draft, close this comment, and select the text again.";
    if (/access|permission|session.*ended|connection ended/i.test(error))
        return "This Live Room can't accept your comment right now. Copy this draft, then reopen your invitation.";
    return "Your comment wasn't confirmed. Your draft is still here. Check your connection and try again.";
});
const sendActive = $derived(hasText && !submission?.pending);
function blurToEditor() {
    textareaEl?.blur();
    const position = originPosition ?? originSelection;
    if (!position) return;
    restoreCommentEditorPosition(view, position);
    onRestoreOrigin?.();
}

function captureOrigin() {
    originSelection = originPosition ?? captureCommentEditorPosition(view);
}

$effect(() => {
    return annotationEventBus.on("annotation-focus-reply", (event) => {
        if (event.annotationId !== annotationId) return;
        captureOrigin();
        textareaEl?.focus();
    });
});

async function send(): Promise<void> {
    if (!composerAccess.canComment || (!composerAccess.canEdit && !commentThread) || !newMessage.trim() || submission?.pending) return;
    const submitted = newMessage;
    const submittedScope = getCommentDraftScope(view);
    if (submission) {
        const restoreFocus = document.activeElement === textareaEl || document.activeElement === sendButton;
        const accepted = await submission.send(submitted.trim());
        if (accepted) {
            if (
                getCommentDraftScope(view) === submittedScope &&
                getDraft(view, annotationId) === submitted
            ) clearDraft(view, annotationId);
        } else if (restoreFocus && getCommentDraftScope(view) === submittedScope) {
            await tick();
            if (textareaEl?.isConnected &&
                (document.activeElement === document.body || document.activeElement === sendButton || document.activeElement === textareaEl)) textareaEl.focus();
        }
        return;
    }
    const next = [...thread, { message: submitted.trim(), author: currentUserName, time: Date.now() }];
    updateThread(next);
    const accepted = view.state.field(annotationField, false)?.[annotationId]?.thread;
    if (getCommentDraftScope(view) === submittedScope && accepted?.length === next.length &&
        accepted.at(-1)?.message === submitted.trim()) clearDraft(view, annotationId);
}
</script>

{#snippet threadMessage(message: ThreadMessageView, index: number, truncate: boolean)}
    <ThreadMessage {message} {index} {thread} {updateThread} {truncate} />
{/snippet}

<!-- Messages -->
<ThreadList
    {thread}
    {previewOnly}
    messageRenderer={threadMessage}
/>

<!-- Reply input — hidden in previewOnly or hideReply mode -->
{#if !previewOnly && !hideReply && composerAccess.canComment && (composerAccess.canEdit || commentThread)}
    <div transition:slide={{ duration: 200, easing: cubicOut }}
        class="mt-3 rounded-[10px] bg-white/60 inset-shadow-sm inset-shadow-white overflow-hidden
        ring-1 ring-black/5 focus-within:ring-2 {focusRingClass} transition-shadow">
        <textarea
            bind:this={textareaEl}
            bind:value={() => newMessage, (v) => setDraft(view, annotationId, v)}
            placeholder="Reply…"
            rows="2"
            class="w-full text-xs bg-transparent px-3 pt-2.5 pb-1 resize-none focus:outline-none
                text-black/70 placeholder:text-black/30"
            onfocus={() => {
                captureOrigin();
                isFocused = true;
            }}
            onblur={() => (isFocused = false)}
            onkeydown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    send();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    blurToEditor();
                }
            }}
        ></textarea>
        {#if submissionError}<p role="alert" class="px-3 pb-1 text-xs text-red-700">{submissionError}</p>{/if}
        <div class="flex items-center justify-between px-2 pb-1.5">
            <div class="flex items-center gap-1">
                {#if onAiSuggest && composerAccess.canEdit}
                    <button
                        aria-label={aiSuggestDisabled
                            ? "Get AI suggestion — add an API key in AI settings"
                            : "Get AI suggestion"}
                        aria-disabled={aiSuggestDisabled}
                        title={aiSuggestDisabled
                            ? "Add an API key in AI settings to get a suggestion"
                            : "Get AI suggestion"}
                        class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                            transition-colors {aiSuggestDisabled
                                ? 'text-black/20 cursor-pointer'
                                : 'text-black/35 hover:text-black/60 hover:bg-white/50'}"
                        onclick={aiSuggestDisabled ? onDisabledAiSuggest : onAiSuggest}
                    >
                        <SparklesIcon size={11} />
                        <span>Suggest</span>
                    </button>
                {/if}
            </div>
            <div class="flex items-center gap-1.5">
                <button
                    bind:this={sendButton}
                    onclick={sendActive ? send : undefined}
                    disabled={!sendActive}
                    class="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[10px] font-medium transition-all duration-150
                        {sendActive ? `${sendPillClass} shadow-sm` : 'bg-black/5 text-black/30'}"
                >
                    {submission?.pending ? "Sending" : isFocused ? "Send" : "Reply"}
                    <span class="flex items-center gap-0.5">
                        <Kbd keys={isFocused ? ["⌘", "↵"] : ["⌘", "/"]}
                            variant={sendActive ? "fullWhite" : isFocused ? "whiteGhost" : "default"} />
                    </span>
                </button>
            </div>
        </div>
    </div>
{/if}
