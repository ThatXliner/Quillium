<!-- Revise.svelte — Separate revise panel using the current editorial pipeline. -->
<script lang="ts">
import { readable } from "svelte/store";
import ToolActivity from "./ToolActivity.svelte";
import { isToolUIPart } from "ai";
import {
    beginAiTask,
    createAiChat,
    endAiTask,
    runMultiPersonaStreams,
    useAiChatEffects,
} from "$lib/ai/chatFactory";
import { streamRevise } from "$lib/ai/clientStreams";
import { personasEnabledFor, setPersonasForMode } from "$lib/ai/settings.svelte";
import { aiErrorMessage } from "./errorMessage";
import { aiSettings } from "./settings.svelte";
import { renderMarkdown } from "$lib/ai/utils";
import posthog from "$lib/posthog";
import { getEnabledPersonas } from "$lib/readers/settings.svelte";
import { appSettings } from "$lib/settings.svelte";
import type { SidebarPanelProps } from "$lib/sidebar/panels";
import { currentDraftId, documentContent, selectedText } from "$lib/stores";
import { UsersIcon } from "lucide-svelte";
import ContextLens from "./ContextLens.svelte";
import DiscussionModal from "./DiscussionModal.svelte";
import ConversationHistory from "./ConversationHistory.svelte";
import ConversationMessageActions from "./ConversationMessageActions.svelte";
import CustomQuickActions from "./CustomQuickActions.svelte";
import PersonaInfoModal from "./PersonaInfoModal.svelte";
import type { ContextAction } from "./context";

// Built-in request adapters retain their existing lifecycle and validated operations.
let { active: _active, session: _session }: SidebarPanelProps = $props();

let input = $state("");
let requestError = $state("");
let personaInFlight = $state(false);

let reviewing = $state(false);
let reviewOpener = $state<HTMLElement>();
const { chat, sendMessage, conversations, toolApplications = readable({}) } = createAiChat({ mode: "revise" });
let isBusy = $derived(
    personaInFlight ||
        chat.status === "submitted" ||
        chat.status === "streaming" ||
        (conversations ? !conversations.canSend : false),
);
let hasConversationActivity = $derived(
    chat.messages.length > 0 || chat.status !== "ready" || personaInFlight || !!chat.error,
);
let showStarterSuggestions = $derived(!hasConversationActivity);

// Wire up processing indicator + global stop listener.
useAiChatEffects(chat, "revise");

async function sendRevise(text: string, trigger: string, turn: NonNullable<ContextAction["turn"]> = { task: "local-rewrite" }) {
    if (isBusy || !text.trim()) return;
    requestError = "";
    const personas = personasEnabledFor("revise") ? getEnabledPersonas() : [];
    posthog.capture("ai_revise_requested", {
        has_selection: !!$selectedText,
        trigger,
        persona_count: personas.length,
    });
    try {
        if (personas.length === 0 || turn.task === "exact-compression") {
            await sendMessage(text, turn);
            if (conversations?.error && !input) input = text;
            return;
        }
        personaInFlight = true;
        const task = beginAiTask("revise-personas");
        try {
            const review = async () => {
                await runMultiPersonaStreams({
                    personas,
                    streamFn: streamRevise,
                    messages: chat.messages,
                    mode: "revise",
                    turn,
                });
                return "Reader review ended. Any notes are attached to your writing.";
            };
            if (conversations) await conversations.runAction(text, turn, review);
            else await review();
        } finally {
            personaInFlight = false;
            endAiTask(task);
        }
    } catch (error) {
        requestError = aiErrorMessage(error instanceof Error ? error : new Error(String(error)), aiSettings.provider);
        if (!input) input = text;
    }
}

function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!input.trim() || isBusy) return;
    const text = input;
    input = "";
    sendRevise(text, "manual");
}

function togglePersonaMode() {
    const next = !personasEnabledFor("revise");
    setPersonasForMode("revise", next);
    posthog.capture("persona_mode_toggled", { mode: "revise", enabled: next });
}

let customRevisePrompts = $derived(
    appSettings.customQuickActions
        .filter((a) => a.panel === "revise")
        .map((a) => ({ label: a.label, prompt: a.prompt })),
);

function useQuickPrompt(prompt: string) {
    const target = $selectedText ? "this selected text" : "my document";
    const message = `${prompt} in ${target}`;
    posthog.capture("ai_revise_quick_prompt_used", {
        prompt,
        has_selection: !!$selectedText,
    });
    input = "";
    sendRevise(message, "quick_prompt");
}

function useContextAction(action: ContextAction) {
    posthog.capture("ai_context_action_used", {
        mode: "revise",
        action: action.id,
        has_selection: !!$selectedText,
    });
    input = "";
    sendRevise(action.prompt, `context_${action.id}`, action.turn);
}
</script>

<div class="flex-1 flex flex-col min-h-0">
    <div class="min-h-0 flex-1 overflow-y-auto" data-conversation-body>
    <!-- Personas opt-in: off by default because personas fan out one
         AI stream per enabled persona (N× token cost — issue #259). -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-black/10 shrink-0">
        <span class="flex items-center gap-1.5 text-[11px] text-black/50">
            <UsersIcon class="w-3.5 h-3.5" />
            Reader personas
            <PersonaInfoModal />
        </span>
        <button
            type="button"
            role="switch"
            aria-checked={personasEnabledFor("revise")}
            onclick={togglePersonaMode}
            title={personasEnabledFor("revise")
                ? "Personas on — each enabled reader responds in parallel (uses more tokens)"
                : "Personas off — a single plain revision response"}
            class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors {personasEnabledFor("revise")
                ? 'bg-purple-500'
                : 'bg-black/15'}"
        >
            <span
                class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform {personasEnabledFor("revise")
                    ? 'translate-x-3.5'
                    : 'translate-x-0.5'}"
            ></span>
        </button>
    </div>

    {#if showStarterSuggestions}
        <ContextLens
            mode="revise"
            disabled={isBusy || personaInFlight || !$documentContent}
            onAction={useContextAction}
        />
    {/if}

    {#if showStarterSuggestions && customRevisePrompts.length > 0}
        <div class="px-3 pb-3 border-b border-black/10">
            <CustomQuickActions
                prompts={customRevisePrompts}
                disabled={isBusy || personaInFlight || !$documentContent}
                panel="revise"
                theme="purple"
                onPrompt={useQuickPrompt}
            />
        </div>
    {/if}

    {#if conversations}
        <ConversationHistory {conversations} description="Past discussions in Revise." onopen={() => { reviewOpener = document.querySelector<HTMLElement>('[data-panel-id="revise"] [data-history-trigger]') ?? undefined; reviewing = true; }} disabled={personaInFlight} />
    {/if}

    <!-- Chat messages -->
    {#if !reviewing}{@render transcript()}{/if}
    </div>
    {#if reviewing}
        <DiscussionModal returnFocus={reviewOpener} error={conversations?.error} title={conversations?.current?.title || "Discussion"} draft={conversations?.current?.draftLabel} onclose={() => reviewing = false}>
            <div class="min-h-0 flex-1 overflow-y-auto">
            {@render transcript()}
            </div>
            {@render composer()}
        </DiscussionModal>
    {:else}{@render composer()}{/if}
</div>
{#snippet transcript()}
    {#if conversations?.current?.archived}
        <p class="px-4 py-2 text-xs text-black/60">Archived. Restore this discussion from History to continue.</p>
    {:else if conversations?.current && conversations.current.draftId !== $currentDraftId}
        <p class="px-4 py-2 text-xs text-black/60">Open the source draft to continue this discussion.</p>
    {/if}
    {#if conversations?.current?.sourceConversationId}
        <button class="px-4 py-2 text-left text-xs text-black/60 underline" disabled={isBusy} onclick={() => conversations?.open(conversations.current!.sourceConversationId!)}>Open origin conversation</button>
    {/if}
    <div class="p-3 sm:p-4 space-y-3">
        {#each chat.messages as message, messageIndex (messageIndex)}
            <div class="space-y-0.5" data-conversation-message={message.id}>
            {#each message.parts as part, partIndex (partIndex)}
                {#if part.type === "text"}
                    {@const renderPromise = renderMarkdown(part.text)}
                    <div
                        class="flex {message.role === 'user'
                            ? 'justify-end'
                            : 'justify-start'}"
                    >
                        <div
                            class="relative max-w-[85%] sm:max-w-[75%] lg:max-w-[70%] px-3 py-2 rounded-lg {message.role ===
                            'user'
                                ? 'bg-purple-500 text-white'
                                : 'bg-gray-100 text-gray-800'}"
                        >
                            <div
                                class="text-sm whitespace-pre-wrap break-words"
                            >
                                {#await renderPromise then rendered}
                                    {@html rendered}
                                {/await}
                            </div>
                        </div>
                    </div>
                {:else if isToolUIPart(part)}
                    <ToolActivity {part} outcomes={$toolApplications} metadata={message.metadata} active={chat.status === "streaming" && message.id === chat.messages.at(-1)?.id} />
                {/if}
            {/each}
            {#if conversations}
                <ConversationMessageActions {message} {conversations} disabled={chat.status === "submitted" || chat.status === "streaming" || conversations.loading || personaInFlight} />
            {/if}
            </div>
        {/each}

        {#if chat.status === "streaming" || chat.status === "submitted" || personaInFlight}
            <div class="flex justify-start">
                <div class="max-w-[85%] sm:max-w-[75%] lg:max-w-[70%]">
                    <div class="bg-gray-100 text-gray-800 px-3 py-2 rounded-lg">
                        <div class="flex items-center space-x-2">
                            <span class="inline-block animate-pulse">●</span>
                            <span class="text-sm">{personaInFlight ? "Personas revising..." : "Revising..."}</span>
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        {#if showStarterSuggestions && !personaInFlight}
            <div
                class="flex-1 flex items-center justify-center text-gray-400 text-sm"
            >
                Choose a revision action to start
            </div>
        {/if}
    </div>
{/snippet}

{#snippet composer()}
    {#if requestError || chat.error}
        <p role="alert" class="px-3 py-2 text-xs text-red-800">{requestError || aiErrorMessage(chat.error!, aiSettings.provider)}</p>
    {/if}
    <!-- Input -->
    <div class="shrink-0 border-t border-black/10 p-3 bg-white/30">
        {#if !showStarterSuggestions}
            <CustomQuickActions
                prompts={customRevisePrompts}
                disabled={isBusy || personaInFlight || !$documentContent}
                compact
                panel="revise"
                theme="purple"
                onPrompt={useQuickPrompt}
            />
        {/if}

        <form onsubmit={handleSubmit} class="flex flex-col gap-2">
            <input
                bind:value={input}
                name="message"
                placeholder="Describe how to revise..."
                disabled={isBusy || personaInFlight}
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={isBusy || personaInFlight || !input.trim()}
                class="w-full py-2 bg-purple-500 text-white text-sm font-medium rounded-md hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Revise
            </button>
        </form>
    </div>
{/snippet}
