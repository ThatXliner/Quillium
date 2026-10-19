<!-- Chat.svelte — One conversation for discussion, feedback, and revision requests. -->
<script lang="ts">
import { tick } from "svelte";
import { readable } from "svelte/store";
import { isToolUIPart } from "ai";
import { ArrowDown, ArrowUp, Square, Maximize2 } from "lucide-svelte";
import { beginAiTask, createAiChat, endAiTask, runMultiPersonaStreams, useAiChatEffects } from "./chatFactory";
import { streamFeedback, streamRevise } from "./clientStreams";
import { aiErrorMessage } from "./errorMessage";
import { aiSettings } from "./settings.svelte";
import { renderMarkdown } from "./utils";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import type { SidebarPanelProps } from "$lib/sidebar/panels";
import { currentDocumentId, currentDraftId, currentTabId, documentContent, selectedText, settingsOpen, editorView } from "$lib/stores";
import { getEnabledPersonas } from "$lib/readers/settings.svelte";
import ToolActivity from "./ToolActivity.svelte";
import ContextLens from "./ContextLens.svelte";
import DiscussionModal from "./DiscussionModal.svelte";
import ConversationHistory from "./ConversationHistory.svelte";
import ConversationMessageActions from "./ConversationMessageActions.svelte";
import type { ContextAction } from "./context";
import type { EditorialTurn } from "./editorialPolicy";
import { editorialContextView } from "./editorialTarget";
import { feedbackActions } from "./feedbackActions";

let { active, session }: SidebarPanelProps = $props();
let input = $state("");
let reviewing = $state(false);
let reviewOpener = $state<HTMLElement>();
let scrollArea = $state<HTMLDivElement>();
let followLatest = $state(true);
let useReaders = $state(false);
let personaInFlight = $state(false);
let contributedBusy = $state(false);
let requestError = $state("");
let actionsOpen = $state(false);
const { chat, sendMessage, conversations, toolApplications = readable({}) } = createAiChat({ mode: "chat" });
const streaming = $derived(chat.status === "submitted" || chat.status === "streaming");
const isBusy = $derived(streaming || personaInFlight || contributedBusy || (conversations ? !conversations.canSend : false));
const empty = $derived(chat.messages.length === 0);
const nestedContext = $derived.by(() => {
    void $documentContent;
    void $currentDraftId;
    const focused = $editorialContextView;
    return focused?.branchPath.length && focused.rootView === $editorView &&
        focused.view.state === focused.state && focused.isCurrent() ? focused : null;
});
const hasSelection = $derived(nestedContext ? !nestedContext.state.selection.main.empty : !!$selectedText);
const targetLabel = $derived(nestedContext ? "Focused revision version" : "Current draft");
useAiChatEffects(chat, "chat");

function trackScroll() {
    if (scrollArea) followLatest = scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight < 64;
}
async function showLatest() {
    followLatest = true;
    await tick();
    if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
}
$effect(() => {
    chat.messages.length;
    chat.status;
    if (followLatest) void tick().then(() => {
        if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
    });
});

function followResponse(node: HTMLElement) {
    const observer = new ResizeObserver(() => {
        if (followLatest && scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
    });
    observer.observe(node);
    return { destroy() { observer.disconnect(); } };
}

async function send(text: string, turn?: EditorialTurn) {
    if (!text.trim() || isBusy) return;
    requestError = "";
    const event = turn?.task === "global-review" ? "ai_feedback_requested"
        : turn?.task === "local-rewrite" || turn?.task === "exact-compression" ? "ai_revise_requested"
        : "ai_chat_message_sent";
    posthog.capture(event, { has_selection: hasSelection, message_length: text.length, trigger: "unified_chat" });
    actionsOpen = false;
    // A writing action may run while the writer is still composing a different message.
    const submittedInput = text.trim() === input.trim() ? input : "";
    if (submittedInput) input = "";
    void showLatest();
    const mode = turn?.task === "global-review" ? "feedback" : turn?.task === "local-rewrite" ? "revise" : null;
    const personas = useReaders && mode ? getEnabledPersonas() : [];
    try {
        if (mode && personas.length && conversations && turn) {
            personaInFlight = true;
            const task = beginAiTask("chat-personas");
            try {
                const review = async () => {
                    await runMultiPersonaStreams({
                        personas,
                        streamFn: mode === "feedback" ? streamFeedback : streamRevise,
                        messages: chat.messages,
                        mode,
                        turn,
                    });
                    return "Reader review ended. Any notes are attached to your writing. You can discuss them here.";
                };
                await conversations.runAction(text, turn, review);
            } finally {
                personaInFlight = false;
                endAiTask(task);
            }
        } else {
            await sendMessage(text, turn);
            if (conversations?.error && !input) input = submittedInput;
        }
    } catch (error) {
        requestError = aiErrorMessage(error instanceof Error ? error : new Error(String(error)), aiSettings.provider);
        if (!input) input = submittedInput;
    }
}
function sendAction(task: "global-review" | "local-rewrite") {
    const target = hasSelection ? "the selected passage" : nestedContext ? "this revision version" : "this draft";
    void send(input.trim() || (task === "global-review"
        ? `Give feedback on ${target}. Add comments for useful observations; do not rewrite.`
        : `Suggest revisions to ${target}, preserving my intent and voice. Keep the original available.`), { task });
}
function useContextAction(action: ContextAction) {
    void send(action.prompt, action.turn);
}
$effect(() => appEventBus.on("ai-open-chat", (event) => { input = event.message; }));
$effect(() => appEventBus.on("college-action", (event) => {
    if (event.target.documentId !== $currentDocumentId || event.target.tabId !== $currentTabId || event.target.draftId !== $currentDraftId || isBusy) return;
    const prompt = event.action === "plan"
        ? "Help me plan an answer to this tab's writing brief. Consider each prompt and constraint. Ask about my real experiences and intentions; do not invent experiences or write the essay for me."
        : event.action === "prompt-fit"
          ? "Check this draft against each prompt and constraint in this tab's writing brief. Distinguish official requirements from advice and unknown details. Create comments only where useful; do not rewrite."
          : "Find claims in this draft that need concrete examples or reflection in light of this tab's writing brief. Ask about my real contribution and meaning; never invent experiences. Create comments only where useful.";
    void send(prompt, { task: event.action === "plan" ? "conversation" : "global-review" });
}));
function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    void send(input);
}
</script>

<div class="flex min-h-0 flex-1 flex-col">
    {#if conversations}<ConversationHistory {conversations} disabled={personaInFlight || contributedBusy} onopen={() => { followLatest = true; }} />{/if}
    <div class="flex items-center justify-between gap-2 border-b border-black/5 px-4 py-2">
        <span class="truncate text-xs font-medium text-black/70">{conversations?.current?.title || "New discussion"}</span>
        <button class="shrink-0 rounded-full p-1.5 text-black/60 hover:bg-white/60" aria-label="Expand discussion" onclick={(event) => { reviewOpener = event.currentTarget; reviewing = true; }}><Maximize2 size={14} /></button>
    </div>
    {#if reviewing}
        <DiscussionModal returnFocus={reviewOpener} error={conversations?.error} title={conversations?.current?.title || "Discussion"} draft={conversations?.current?.draftLabel} onclose={() => reviewing = false}>
            {@render body()}
            {@render composer()}
        </DiscussionModal>
    {:else}
        {@render body()}
        {@render composer()}
    {/if}
</div>

{#snippet body()}
    <div bind:this={scrollArea} onscroll={trackScroll} class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-conversation-body>
        {#if conversations?.current?.archived}
            <p class="px-4 py-3 text-xs text-black/70">Archived. Restore this discussion from History to continue.</p>
        {:else if conversations?.current && conversations.current.draftId !== $currentDraftId}
            <p class="px-4 py-3 text-xs text-black/70">Open the source draft to continue this discussion.</p>
        {/if}
        {#if conversations?.current?.sourceConversationId}
            <button class="px-4 py-2 text-xs text-black/60 underline" disabled={isBusy} onclick={() => conversations?.open(conversations.current!.sourceConversationId!)}>Open origin conversation</button>
        {/if}
        {#if empty}
            <div class="px-4 pt-6 pb-3">
                <h2 class="text-sm font-semibold text-black/80">Think it through together</h2>
                <p class="mt-1 text-sm leading-relaxed text-black/60">Ask a question, get feedback, or explore another way to say it. Keep the discussion in one place.</p>
            </div>
        {/if}
        <div use:followResponse class="space-y-5 p-4" role="log" aria-label="Discussion messages">
            {#each chat.messages as message (message.id)}
                <div class="min-w-0 space-y-1" data-conversation-message={message.id}>
                    <p class="text-[11px] font-medium text-black/60 {message.role === 'user' ? 'text-right' : ''}">{message.role === "user" ? "You" : "Quillium"}</p>
                    {#each message.parts as part, partIndex (partIndex)}
                        {#if part.type === "text"}
                            <div class="break-words text-sm leading-relaxed {message.role === 'user' ? 'ml-6 rounded-xl bg-white/70 px-3 py-2 text-black/85' : 'text-black/85'}">
                                <div class="prose prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:overflow-x-auto">
                                    {#await renderMarkdown(part.text) then rendered}{@html rendered}{/await}
                                </div>
                            </div>
                        {:else if isToolUIPart(part)}
                            <ToolActivity {part} outcomes={$toolApplications} metadata={message.metadata} active={streaming && message.id === chat.messages.at(-1)?.id} />
                        {/if}
                    {/each}
                    {#if conversations}<ConversationMessageActions {message} {conversations} disabled={isBusy} />{/if}
                </div>
            {/each}
            {#if streaming || personaInFlight}<p role="status" class="text-xs text-black/60">{personaInFlight ? "Readers are reviewing your writing…" : chat.status === "submitted" ? "Thinking…" : "Responding…"}</p>{/if}
            {#if chat.error || requestError}<p role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-800">{requestError || aiErrorMessage(chat.error!, aiSettings.provider)}</p>{/if}
        </div>
    </div>
    {#if !followLatest && !empty}<button class="mx-auto my-1 flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-xs text-black/70 shadow-sm" onclick={showLatest}><ArrowDown size={12} />Latest response</button>{/if}
{/snippet}

{#snippet composer()}
    <div class="shrink-0 border-t border-black/10 bg-white/30 p-3">
        <details bind:open={actionsOpen} class="relative mb-2 text-xs text-black/70">
            <summary class="cursor-pointer rounded py-1">Writing actions</summary>
            {#if actionsOpen}<div class="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-48 overflow-y-auto rounded-xl border border-black/10 bg-gray-100 p-1 shadow-lg">
                <ContextLens disabled={isBusy || !$documentContent} onAction={useContextAction} />
                <div class="flex items-center justify-between px-2 py-2"><span class="font-medium">Your custom actions</span><button class="rounded px-2 py-1 text-blue-700 hover:bg-white" onclick={() => settingsOpen.set("quick-actions:chat")}>Edit in settings</button></div>
                {#each appSettings.customQuickActions as action}
                    <button class="m-1 rounded-lg border border-black/10 px-2 py-1.5 text-left hover:bg-white/70" disabled={isBusy} onclick={() => send(action.prompt, { task: action.panel === "feedback" ? "global-review" : action.panel === "revise" ? "local-rewrite" : "conversation" })}>{action.label}</button>
                {/each}
                <label class="flex items-start gap-2 p-2"><input type="checkbox" bind:checked={useReaders} disabled={isBusy} /><span>Use enabled reader personas for feedback and revisions<span class="block text-[11px] text-black/60">Each reader adds notes to the draft and uses a separate AI request.</span></span></label>
                {#if active && session}
                    {#each feedbackActions as action (action.id)}
                        {#if action.applies(session)}<action.component {session} disabled={isBusy} onBusyChange={(busy) => contributedBusy = busy} />{/if}
                    {/each}
                {/if}
            </div>{/if}
        </details>
        <form onsubmit={handleSubmit} class="rounded-xl border border-black/15 bg-white/80 p-2 focus-within:ring-2 focus-within:ring-blue-500/50">
            <p class="px-1 pb-1 text-[11px] text-black/60">{hasSelection ? `Selected passage · ${targetLabel.toLowerCase()}` : targetLabel}</p>
            <textarea bind:value={input} name="message" aria-label="Message" rows="3" placeholder="Ask about your writing…" class="max-h-40 min-h-16 w-full resize-y border-0 bg-transparent px-1 py-1 text-sm text-black/90 outline-none" onkeydown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}></textarea>
            <div class="flex flex-wrap items-center gap-1">
                <button type="button" disabled={isBusy || !$documentContent} class="rounded-lg px-2 py-1.5 text-xs text-green-800 hover:bg-green-50 disabled:opacity-40" title="Send your message as a request for anchored feedback" onclick={() => sendAction("global-review")}>Give feedback</button>
                <button type="button" disabled={isBusy || !$documentContent} class="rounded-lg px-2 py-1.5 text-xs text-purple-800 hover:bg-purple-50 disabled:opacity-40" title="Send your message as a request for reversible wording suggestions" onclick={() => sendAction("local-rewrite")}>Suggest revisions</button>
                {#if streaming || personaInFlight}
                    <button type="button" aria-label="Stop response" class="ml-auto rounded-full bg-black/80 p-2 text-white" onclick={() => { void chat.stop(); appEventBus.emit({ type: "stop-ai" }); }}><Square size={14} /></button>
                {:else}
                    <button type="submit" aria-label="Send" disabled={isBusy || !input.trim()} class="ml-auto rounded-full bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:opacity-40"><ArrowUp size={16} /></button>
                {/if}
            </div>
        </form>
        <p class="mt-1.5 px-1 text-[10px] text-black/60">Enter to send · Shift+Enter for a new line</p>
    </div>
{/snippet}
