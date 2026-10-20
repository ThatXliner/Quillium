<!-- Chat.svelte — One conversation for discussion, feedback, and revision requests. -->
<script lang="ts">
import { tick } from "svelte";
import { readable } from "svelte/store";
import { type UIMessage, isToolUIPart } from "ai";
import { ArrowDown, ArrowUp, Square, Maximize2, MessageCircle, MessageSquareText, PenLine, Users } from "lucide-svelte";
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
import ChatPopover from "./ChatPopover.svelte";
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
let readersOpen = $state(false);
let taskNotice = $state("");
type ComposerTask = "conversation" | "global-review" | "local-rewrite";
let selectedTask = $state<ComposerTask>("conversation");
const tasks = [
    { task: "conversation", label: "Discuss", icon: MessageCircle, description: "Talk through your writing", color: "text-blue-700", selected: "bg-blue-50 text-blue-800", send: "bg-blue-600 hover:bg-blue-700", placeholder: "Ask about your writing…" },
    { task: "global-review", label: "Feedback", icon: MessageSquareText, description: "Add comments to your writing", color: "text-green-700", selected: "bg-green-50 text-green-800", send: "bg-green-700 hover:bg-green-800", placeholder: "What would you like feedback on?" },
    { task: "local-rewrite", label: "Revise", icon: PenLine, description: "Suggest wording you can accept or undo", color: "text-purple-700", selected: "bg-purple-50 text-purple-800", send: "bg-purple-700 hover:bg-purple-800", placeholder: "What would you like to revise?" },
] satisfies { task: ComposerTask; label: string; icon: typeof MessageCircle; description: string; color: string; selected: string; send: string; placeholder: string }[];
const currentTask = $derived(tasks.find(task => task.task === selectedTask) ?? tasks[0]);
const enabledReaders = $derived(getEnabledPersonas());
const { chat, sendMessage, conversations, toolApplications = readable({}) } = createAiChat({ mode: "chat", historyScope: "document" });
const streaming = $derived(chat.status === "submitted" || chat.status === "streaming");
const isBusy = $derived(streaming || personaInFlight || contributedBusy || (conversations ? !conversations.canSend : false));
const empty = $derived(chat.messages.length === 0);
$effect(() => {
    conversations?.current?.id;
    selectedTask = "conversation";
    taskNotice = "";
});
const nestedContext = $derived.by(() => {
    void $documentContent;
    void $currentDraftId;
    const focused = $editorialContextView;
    return focused?.branchPath.length && focused.rootView === $editorView &&
        focused.view.state === focused.state && focused.isCurrent() ? focused : null;
});
const hasSelection = $derived(nestedContext ? !nestedContext.state.selection.main.empty : !!$selectedText);

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

async function send(text: string, turn?: EditorialTurn): Promise<boolean> {
    if (!text.trim() || isBusy) return false;
    requestError = "";
    const event = turn?.task === "global-review" ? "ai_feedback_requested"
        : turn?.task === "local-rewrite" || turn?.task === "exact-compression" ? "ai_revise_requested"
        : "ai_chat_message_sent";
    posthog.capture(event, { has_selection: hasSelection, message_length: text.length, trigger: "unified_chat" });
    actionsOpen = false;
    readersOpen = false;
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
            if (conversations?.error) {
                if (!input) input = submittedInput;
                return false;
            }
        }
        if (conversations?.error && !input) input = submittedInput;
        return !conversations?.error;
    } catch (error) {
        requestError = aiErrorMessage(error instanceof Error ? error : new Error(String(error)), aiSettings.provider);
        if (!input) input = submittedInput;
        return false;
    }
}
function defaultPrompt(task: ComposerTask): string {
    const target = hasSelection ? "the selected passage" : nestedContext ? "this revision version" : "this draft";
    return task === "global-review"
        ? `Give feedback on ${target}. Add comments for useful observations; do not rewrite.`
        : `Suggest revisions to ${target}, preserving my intent and voice. Keep the original available.`;
}
function messageTaskLabel(message: UIMessage): string {
    const metadata = message.metadata;
    if (message.role !== "user" || !metadata || typeof metadata !== "object" || !("editorialTurn" in metadata)) return "";
    const turn = metadata.editorialTurn;
    if (!turn || typeof turn !== "object" || !("task" in turn)) return "";
    if (turn.task === "global-review") return "Feedback";
    if (turn.task === "local-rewrite" || turn.task === "exact-compression") return "Revisions";
    return "";
}
function growTextarea(node: HTMLTextAreaElement, _value: string) {
    let width = 0;
    function resize() {
        node.style.height = "auto";
        node.style.height = `${Math.min(160, Math.max(44, node.scrollHeight))}px`;
    }
    const observer = new ResizeObserver(([entry]) => {
        if (entry.contentRect.width !== width) { width = entry.contentRect.width; resize(); }
    });
    observer.observe(node);
    resize();
    return { update: resize, destroy() { observer.disconnect(); } };
}
function useContextAction(action: ContextAction) {
    void send(action.prompt, action.turn);
}
$effect(() => appEventBus.on("ai-open-chat", (event) => { input = event.message; selectedTask = "conversation"; taskNotice = ""; }));
$effect(() => appEventBus.on("college-action", (event) => {
    if (event.target.documentId !== $currentDocumentId || event.target.tabId !== $currentTabId || event.target.draftId !== $currentDraftId || isBusy) return;
    const prompt = event.action === "plan"
        ? "Help me plan an answer to this tab's writing brief. Consider each prompt and constraint. Ask about my real experiences and intentions; do not invent experiences or write the essay for me."
        : event.action === "prompt-fit"
          ? "Check this draft against each prompt and constraint in this tab's writing brief. Distinguish official requirements from advice and unknown details. Create comments only where useful; do not rewrite."
          : "Find claims in this draft that need concrete examples or reflection in light of this tab's writing brief. Ask about my real contribution and meaning; never invent experiences. Create comments only where useful.";
    void send(prompt, { task: event.action === "plan" ? "conversation" : "global-review" });
}));
async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (isBusy || (!input.trim() && (selectedTask === "conversation" || !$documentContent))) return;
    taskNotice = "";
    const task = selectedTask;
    const text = input.trim() || defaultPrompt(task);
    selectedTask = "conversation";
    if (!await send(text, { task }) && selectedTask === "conversation") selectedTask = task;
    else if (task !== "conversation") taskNotice = "Next message set to Discuss.";
}
</script>

<div class="unified-chat flex min-h-0 flex-1 flex-col">
    {#if conversations}
        <ConversationHistory {conversations} compact onnew={() => { selectedTask = "conversation"; taskNotice = ""; }} disabled={personaInFlight || contributedBusy} onopen={() => { followLatest = true; selectedTask = "conversation"; }}>
            {#snippet controls()}
                <button class="shrink-0 rounded-full p-1.5 text-black/60 hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-blue-500" aria-label="Expand discussion" title="Expand discussion" onclick={(event) => { reviewOpener = event.currentTarget; reviewing = true; }}><Maximize2 size={14} /></button>
            {/snippet}
        </ConversationHistory>
    {/if}
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
            <div class="px-4 pt-8 pb-3">
                <p class="text-sm text-black/65">Ask a question, or pick a starting point.</p>
                <ContextLens startersOnly disabled={isBusy || !$documentContent} onAction={useContextAction} />
            </div>
        {/if}
        <div use:followResponse class="space-y-5 p-4" role="log" aria-label="Discussion messages">
            {#each chat.messages as message (message.id)}
                {@const taskLabel = messageTaskLabel(message)}
                <div class="min-w-0 space-y-1" data-conversation-message={message.id}>
                    {#if taskLabel}<p class="flex items-center justify-end gap-1 text-[11px] font-medium {taskLabel === 'Feedback' ? 'text-green-800' : 'text-purple-800'}" data-turn-task>{#if taskLabel === 'Feedback'}<MessageSquareText size={12} />{:else}<PenLine size={12} />{/if}{taskLabel}</p>{/if}
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
            {#if (chat.error || requestError) && !conversations?.error}<p role="alert" class="rounded-lg bg-red-50 p-3 text-sm text-red-800">{requestError || aiErrorMessage(chat.error!, aiSettings.provider)}</p>{/if}
        </div>
    </div>
    {#if !followLatest && !empty}<button class="mx-auto my-1 flex items-center gap-1 rounded-full bg-white/80 px-3 py-1 text-xs text-black/70 shadow-sm" onclick={showLatest}><ArrowDown size={12} />Latest response</button>{/if}
{/snippet}

{#snippet composer()}
    <div class="shrink-0 px-3 pt-2 pb-3" data-chat-composer>
        <form onsubmit={handleSubmit} class="rounded-xl border border-black/15 bg-white/80 p-2.5 focus-within:ring-2 focus-within:ring-blue-500/40">
            <div class="mb-2 flex gap-1 border-b border-black/10 pb-2" role="group" aria-label="Writing task">
                {#each tasks as task (task.task)}
                    <button type="button" aria-pressed={selectedTask === task.task} title={task.description} disabled={isBusy || (task.task !== "conversation" && !$documentContent)} onclick={() => selectedTask = task.task}
                        class="task-choice flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-1 py-1.5 text-xs font-medium disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-500 {selectedTask === task.task ? task.selected : `${task.color} hover:bg-black/5`}">
                        <span class="task-icon shrink-0"><task.icon size={14} /></span><span class="truncate">{task.label}</span>
                    </button>
                {/each}
            </div>
            <textarea bind:value={input} use:growTextarea={input} name="message" aria-label="Message" rows="1" placeholder={currentTask.placeholder} title="Enter to send · Shift+Enter for a new line"
                class="block max-h-40 min-h-11 w-full resize-none border-0 bg-transparent px-1 py-1.5 text-sm leading-relaxed text-black/90 outline-none"
                onkeydown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}></textarea>
            <div class="flex flex-wrap items-center gap-x-1 gap-y-0.5 pt-1">
                <ContextLens compact {active} bind:actionsOpen disabled={isBusy || !$documentContent} onAction={useContextAction}>
                    <div class="mt-2 border-t border-black/10 pt-2">
                        <div class="flex items-center justify-between gap-2 px-2 py-1"><span class="font-medium">Your custom actions</span><button type="button" class="rounded px-1 py-1 text-blue-700 hover:bg-black/5" onclick={() => { actionsOpen = false; settingsOpen.set("quick-actions:chat"); }}>Edit in settings</button></div>
                        {#each appSettings.customQuickActions as action}
                            <button type="button" class="block w-full rounded-lg px-2 py-2 text-left hover:bg-black/5 disabled:opacity-40" disabled={isBusy} onclick={() => send(action.prompt, { task: action.panel === "feedback" ? "global-review" : action.panel === "revise" ? "local-rewrite" : "conversation" })}>{action.label}</button>
                        {/each}
                    </div>
                </ContextLens>
                <div class="ml-auto flex items-center gap-1">
                    <ChatPopover label="Reader personas" {active} align="end" bind:open={readersOpen}>
                        {#snippet trigger()}<Users size={14} class="shrink-0" /><span>{useReaders ? "Readers on" : "Readers"}</span>{/snippet}
                        <label class="flex items-start gap-2 rounded-lg py-2"><input type="checkbox" bind:checked={useReaders} disabled={isBusy || (!useReaders && !enabledReaders.length)} class="mt-0.5" /><span>Ask enabled readers too<span class="mt-1 block leading-relaxed text-black/65">For feedback and revisions · {enabledReaders.length} separate AI {enabledReaders.length === 1 ? "request" : "requests"}.</span></span></label>
                        <p class="mt-2 leading-relaxed text-black/65">{enabledReaders.length ? enabledReaders.map(reader => reader.name).join(" · ") : "Enable readers in the Readers panel."}</p>
                    </ChatPopover>
                    {#if streaming || personaInFlight}
                        <button type="button" aria-label="Stop response" title="Stop response" class="rounded-full bg-black/80 p-2 text-white focus-visible:outline-2 focus-visible:outline-blue-500" onclick={() => { void chat.stop(); appEventBus.emit({ type: "stop-ai" }); }}><Square size={14} /></button>
                    {:else}
                        <button type="submit" aria-label="Send" title={`Send · ${currentTask.label}`} disabled={isBusy || (!input.trim() && (selectedTask === "conversation" || !$documentContent))} class="rounded-full p-2 text-white disabled:bg-black/10 disabled:text-black/40 focus-visible:outline-2 focus-visible:outline-blue-500 {currentTask.send}"><ArrowUp size={16} /></button>
                    {/if}
                </div>
            </div>
        </form>
        <p class="sr-only" role="status">{taskNotice}</p>
        {#if active && session}
            {#each feedbackActions as action (action.id)}
                {#if action.applies(session)}<action.component {session} disabled={isBusy} onBusyChange={(busy) => contributedBusy = busy} />{/if}
            {/each}
        {/if}
    </div>
{/snippet}

<style>
.unified-chat { container-type: inline-size; }
@container (max-width: 300px) {
    .task-icon { display: none; }
    .task-choice { gap: 0; padding-inline: 0; }
}
</style>
