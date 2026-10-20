<!-- Chat.svelte — One assistant with explicit document-tool permissions. -->
<script lang="ts">
import { tick, untrack } from "svelte";
import { readable } from "svelte/store";
import { type UIMessage, generateId, isToolUIPart } from "ai";
import { ArrowDown, ArrowUp, Square, Maximize2, MessageSquareText, PenLine, Users, Wrench, Check, SlidersHorizontal } from "lucide-svelte";
import { beginAiTask, createAiChat, endAiTask, runMultiPersonaStreams, useAiChatEffects } from "./chatFactory";
import { streamChat } from "./clientStreams";
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
import { type EditorialAction, type EditorialPreferences, type EditorialTurn, responseLengthSchema } from "./editorialPolicy";
import { type AssistantOptions, defaultAssistantOptions, loadAssistantOptions, saveAssistantOptions } from "./assistantOptions";
import { editorialPreferences, getEffectiveEditorialPreferences, persistEditorialPreferences } from "./settings.svelte";
import { collegeState, getActiveCollegeSetup, updateActiveCollegeSetup } from "$lib/college/state.svelte";
import HelpModal from "$lib/ui/HelpModal.svelte";
import InfoButton from "$lib/ui/InfoButton.svelte";
import { RESPONSE_HELP_TABS } from "./helpContent";
import { editorialContextView } from "./editorialTarget";
import { feedbackActions } from "./feedbackActions";

let { active, session }: SidebarPanelProps = $props();
let input = $state("");
let reviewing = $state(false);
let reviewOpener = $state<HTMLElement>();
let scrollArea = $state<HTMLDivElement>();
let followLatest = $state(true);
let options = $state<AssistantOptions>(defaultAssistantOptions());
let personaInFlight = $state(false);
let contributedBusy = $state(false);
let requestError = $state("");
let actionsOpen = $state(false);
let toolsOpen = $state(false);
let preferencesOpen = $state(false);
let helpTab = $state<string | null>(null);
let preferenceError = $state("");
const id = $props.id();
const toolOptions = [
    { action: "comment", label: "Add comments", detail: "Attach observations and questions to passages." },
    { action: "suggestion", label: "Suggest edits", detail: "Offer small wording changes you can apply or dismiss." },
    { action: "revision", label: "Create revision versions", detail: "Keep alternate wording beside the original." },
] satisfies { action: EditorialAction; label: string; detail: string }[];
const preferences = $derived(getEffectiveEditorialPreferences());
const stanceLabel = $derived(preferences.stance === "author-first" ? "Author-first" : preferences.stance === "collaborative" ? "Collaborative" : "Exploratory");
const lengthLabel = $derived(options.responseLength === "brief" ? "Brief" : options.responseLength === "detailed" ? "Detailed" : "Balanced");
const enabledReaders = $derived(getEnabledPersonas());
const { chat, sendMessage, conversations, toolApplications = readable({}) } = createAiChat({ mode: "chat", historyScope: "document" });
const streaming = $derived(chat.status === "submitted" || chat.status === "streaming");
const isBusy = $derived(streaming || personaInFlight || contributedBusy || (conversations ? !conversations.canSend : false));
const preferencesDisabled = $derived(isBusy || (collegeState.hostEnabled && (collegeState.saving || ["loading", "error", "unsupported"].includes(collegeState.status))));
const empty = $derived(chat.messages.length === 0);
let loadedScope: string | undefined;
let creatingScope: string | undefined;
const pendingScope = $derived(`pending:${$currentDocumentId}:${$currentDraftId}`);
const optionScope = $derived(conversations?.current?.id ?? pendingScope);
$effect(() => {
    const scope = optionScope;
    const pending = pendingScope;
    const source = conversations?.current?.sourceConversationId ?? undefined;
    untrack(() => {
        if (scope === loadedScope) return;
        // The first send creates the row lazily; keep the choices made in its empty composer.
        if (creatingScope === pending && loadedScope === pending && scope !== pending) saveAssistantOptions(scope, options);
        else {
            options = loadAssistantOptions(scope, source);
            if (source) saveAssistantOptions(scope, options);
        }
        creatingScope = undefined;
        loadedScope = scope;
    });
});
function changeOptions(next: AssistantOptions): void {
    options = next;
    saveAssistantOptions(optionScope, next);
}
function toggleTool(action: EditorialAction, checked: boolean): void {
    changeOptions({ ...options, requestedActions: toolOptions.filter(tool => tool.action === action ? checked : options.requestedActions.includes(tool.action)).map(tool => tool.action) });
}
async function changePreference<K extends keyof EditorialPreferences>(key: K, value: EditorialPreferences[K]): Promise<void> {
    preferenceError = "";
    const next = { ...getEffectiveEditorialPreferences(), [key]: value };
    try {
        if (getActiveCollegeSetup()) await updateActiveCollegeSetup({ preferences: next });
        else { Object.assign(editorialPreferences, next); persistEditorialPreferences(); }
    } catch (error) {
        preferenceError = error instanceof Error ? error.message : "Could not save response preferences.";
    }
}
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

async function send(text: string, requestedTurn?: EditorialTurn): Promise<boolean> {
    if (!text.trim() || isBusy) return false;
    requestError = "";
    creatingScope = conversations?.current ? undefined : optionScope;
    const turn: EditorialTurn = {
        task: "assistant",
        ...requestedTurn,
        // A contextual shortcut may narrow the recipe, but can never grant a disabled tool.
        requestedActions: [...options.requestedActions],
        responseLength: options.responseLength,
    };
    const event = turn?.task === "global-review" ? "ai_feedback_requested"
        : turn?.task === "local-rewrite" || turn?.task === "exact-compression" ? "ai_revise_requested"
        : "ai_chat_message_sent";
    posthog.capture(event, { has_selection: hasSelection, message_length: text.length, trigger: "unified_chat" });
    actionsOpen = false;
    toolsOpen = false;
    preferencesOpen = false;
    // A writing action may run while the writer is still composing a different message.
    const submittedInput = text.trim() === input.trim() ? input : "";
    if (submittedInput) input = "";
    void showLatest();
    const personas = options.readers ? [...getEnabledPersonas()] : [];
    let primarySucceeded = false;
    const readerMessages: UIMessage[] = [...chat.messages, { id: generateId(), role: "user", parts: [{ type: "text", text }] }];
    try {
        if (personas.length) {
            personaInFlight = true;
            const task = beginAiTask("chat-personas");
            try {
                const outcomes = await Promise.allSettled([
                    sendMessage(text, turn),
                    runMultiPersonaStreams({ personas, streamFn: streamChat, messages: readerMessages, mode: "chat", turn }),
                ]);
                primarySucceeded = outcomes[0].status === "fulfilled" && !conversations?.error && chat.status !== "error";
                const failure = outcomes.find(outcome => outcome.status === "rejected");
                if (failure?.status === "rejected") throw failure.reason;
            } finally {
                personaInFlight = false;
                endAiTask(task);
            }
        } else {
            await sendMessage(text, turn);
        }
        if (conversations?.error && !input) input = submittedInput;
        return !conversations?.error;
    } catch (error) {
        requestError = aiErrorMessage(error instanceof Error ? error : new Error(String(error)), aiSettings.provider);
        if (!primarySucceeded && !input) input = submittedInput;
        return false;
    }
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
    await send(input);
}
</script>

<div class="unified-chat flex min-h-0 flex-1 flex-col">
    {#if conversations}
        <ConversationHistory {conversations} compact disabled={personaInFlight || contributedBusy} onopen={() => { followLatest = true; }}>
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
            <textarea bind:value={input} use:growTextarea={input} name="message" aria-label="Message" rows="1" placeholder="Ask about your writing…" title="Enter to send · Shift+Enter for a new line"
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
                    <ChatPopover label="Available tools" {active} align="end" bind:open={toolsOpen}>
                        {#snippet trigger()}<Wrench size={14} class="shrink-0" /><span>Tools · {options.requestedActions.length}</span>{/snippet}
                        <p class="mb-2 leading-relaxed text-black/65">The assistant chooses which enabled tools your request needs.</p>
                        {#each toolOptions as tool (tool.action)}
                            <label class="flex cursor-pointer items-start gap-2 border-t border-black/10 py-3">
                                <input type="checkbox" checked={options.requestedActions.includes(tool.action)} disabled={isBusy} onchange={(event) => toggleTool(tool.action, event.currentTarget.checked)} class="mt-0.5" />
                                <span>{tool.label}<span class="mt-1 block leading-relaxed text-black/65">{tool.detail}</span></span>
                            </label>
                        {/each}
                        <p class="border-t border-black/10 pt-2 leading-relaxed text-black/65">Reading the current draft and its notes is always available. Every writing action can be undone.</p>
                    </ChatPopover>
                    <button type="button" aria-pressed={options.readers} disabled={isBusy || (!options.readers && !enabledReaders.length)}
                        title={enabledReaders.length ? `Ask enabled readers too · ${enabledReaders.length} additional AI requests with the same tools · ${enabledReaders.map(reader => reader.name).join(", ")}` : "Enable readers in the Readers panel"}
                        onclick={() => changeOptions({ ...options, readers: !options.readers })}
                        class="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-blue-500 {options.readers ? 'bg-blue-100 text-blue-800 ring-1 ring-inset ring-blue-300' : 'text-black/65 hover:bg-black/5'}">
                        <Users size={14} class="shrink-0" /><span>Readers</span>{#if options.readers}<Check size={12} class="shrink-0" />{/if}
                    </button>
                    {#if streaming || personaInFlight}
                        <button type="button" aria-label="Stop response" title="Stop response" class="rounded-full bg-black/80 p-2 text-white focus-visible:outline-2 focus-visible:outline-blue-500" onclick={() => { void chat.stop(); appEventBus.emit({ type: "stop-ai" }); }}><Square size={14} /></button>
                    {:else}
                        <button type="submit" aria-label="Send" title="Send" disabled={isBusy || !input.trim()} class="rounded-full p-2 text-white disabled:bg-black/10 disabled:text-black/40 focus-visible:outline-2 focus-visible:outline-blue-500 bg-blue-600 hover:bg-blue-700"><ArrowUp size={16} /></button>
                    {/if}
                </div>
            </div>
        </form>
        <div class="mt-1.5 flex items-center">
            <ChatPopover label="Response preferences" {active} bind:open={preferencesOpen}>
                {#snippet trigger()}<SlidersHorizontal size={14} class="shrink-0" /><span>{lengthLabel} · {stanceLabel}</span>{/snippet}
                <div class="space-y-3">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center"><label for={`${id}-length`}>Response length</label><InfoButton title="Response length" onclick={() => helpTab = "verbosity"} /></div>
                        <select id={`${id}-length`} value={options.responseLength} disabled={isBusy} onchange={(event) => { const parsed = responseLengthSchema.safeParse(event.currentTarget.value); if (parsed.success) changeOptions({ ...options, responseLength: parsed.data }); }} class="preference-select">
                            <option value="brief">Brief</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option>
                        </select>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center"><label for={`${id}-stance`}>Editorial stance</label><InfoButton title="Editorial stance" onclick={() => helpTab = "stance"} /></div>
                        <select id={`${id}-stance`} value={preferences.stance} disabled={preferencesDisabled} onchange={(event) => { const value = event.currentTarget.value; if (value === "author-first" || value === "collaborative" || value === "exploratory") void changePreference("stance", value); }} class="preference-select">
                            <option value="author-first">Author-first</option><option value="collaborative">Collaborative</option><option value="exploratory">Exploratory</option>
                        </select>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center"><label for={`${id}-density`}>Feedback amount</label><InfoButton title="Feedback amount" onclick={() => helpTab = "density"} /></div>
                        <select id={`${id}-density`} value={preferences.feedbackDensity} disabled={preferencesDisabled} onchange={(event) => { const value = event.currentTarget.value; if (value === "quiet" || value === "focused" || value === "thorough") void changePreference("feedbackDensity", value); }} class="preference-select">
                            <option value="quiet">Quiet</option><option value="focused">Focused</option><option value="thorough">Thorough</option>
                        </select>
                    </div>
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center"><label for={`${id}-voice`}>Voice latitude</label><InfoButton title="Voice latitude" onclick={() => helpTab = "voice"} /></div>
                        <select id={`${id}-voice`} value={preferences.voiceLatitude} disabled={preferencesDisabled} onchange={(event) => { const value = event.currentTarget.value; if (value === "preserve" || value === "adapt" || value === "transform") void changePreference("voiceLatitude", value); }} class="preference-select">
                            <option value="preserve">Preserve</option><option value="adapt">Adapt</option><option value="transform">Transform</option>
                        </select>
                    </div>
                </div>
                <p class="mt-3 border-t border-black/10 pt-2 leading-relaxed text-black/65">These shape the response. They don’t grant permission to change your writing.</p>
                {#if preferenceError}<p role="alert" class="mt-2 text-red-800">{preferenceError}</p>{/if}
            </ChatPopover>
        </div>
        {#if active && session}
            {#each feedbackActions as action (action.id)}
                {#if action.applies(session)}<action.component {session} disabled={isBusy} onBusyChange={(busy) => contributedBusy = busy} />{/if}
            {/each}
        {/if}
    </div>
{/snippet}

{#if helpTab}
    <HelpModal title="Response preferences guide" tabs={RESPONSE_HELP_TABS} initialTab={helpTab} footer="Preferences shape the response; enabled tools determine which document actions are allowed." onclose={() => helpTab = null} />
{/if}

<style>
.preference-select { max-width: 48%; border: 1px solid rgb(0 0 0 / .15); border-radius: .5rem; background: rgb(255 255 255 / .6); padding: .375rem .5rem; }
</style>
