<!--
    Feedback.svelte — Editorial feedback AI panel (green theme).

    Provides high-level editorial feedback on the writer's document.
    Uses the "feedback" mode stream which includes one tool:
      - createComment: flags a specific passage with editorial notes.

    These tool calls are routed through chatFactory.handleToolCall to
    the annotation system, which attaches comments/revisions directly
    to the CodeMirror editor.

    Features a context lens that shows what context will be used and
    offers selection/document-aware feedback actions.

    State machine (driven by `chat.status`):
      ready     — user can submit or click quick action.
      submitted — waiting for first token.
      streaming — tokens arriving, "Analyzing..." indicator shown.
      error     — implicit (chat.error set).

    Dependencies: chatFactory, utils (renderMarkdown), stores, posthog.
-->
<script lang="ts">
import ToolActivity from "./ToolActivity.svelte";
import { isToolUIPart } from "ai";
import {
    beginAiTask,
    createAiChat,
    endAiTask,
    runMultiPersonaStreams,
    useAiChatEffects,
} from "$lib/ai/chatFactory";
import { streamFeedback } from "$lib/ai/clientStreams";
import { personasEnabledFor, setPersonasForMode } from "$lib/ai/settings.svelte";
import { renderMarkdown } from "$lib/ai/utils";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { getEnabledPersonas } from "$lib/readers/settings.svelte";
import { appSettings } from "$lib/settings.svelte";
import { currentDocumentId, currentTabId, currentDraftId } from "$lib/stores";
import type { SidebarPanelProps } from "$lib/sidebar/panels";
/*
 * Feedback.svelte
 *
 * Editorial feedback AI panel (green theme).
 *
 * Renders:
 *   A context lens with action cards, scrollable message list with
 *   user/assistant bubbles, streaming indicator, and a bottom input
 *   form for follow-up requests.
 *
 * Props: none.
 * Events: none dispatched.
 *
 * Stores read:
 *   - $selectedText — scopes context-aware prompts to the active
 *     selection when present.
 *   - $documentContent — gates the quick-action button (disabled
 *     when empty) and displayed as character count.
 *
 * Stores written:
 *   - aiProcessing.active (via setAiProcessing) — true while
 *     streaming so the sidebar glow activates.
 *
 * AI streaming layer:
 *   Uses createAiChat({ mode: "feedback" }) which provides the
 *   createComment tool. Tool calls
 *   are routed through chatFactory.handleToolCall to the annotation
 *   system, attaching comments/revisions to the CodeMirror editor.
 *
 * State machine (chat.status):
 *   ready -> submitted -> streaming -> ready
 *                                   \-> error (chat.error set)
 */
import { documentContent, selectedText } from "$lib/stores";
import { UsersIcon } from "lucide-svelte";
import ContextLens from "./ContextLens.svelte";
import ConversationHistory from "./ConversationHistory.svelte";
import ConversationMessageActions from "./ConversationMessageActions.svelte";
import CustomQuickActions from "./CustomQuickActions.svelte";
import PersonaInfoModal from "./PersonaInfoModal.svelte";
import type { ContextAction } from "./context";
import { feedbackActions } from "./feedbackActions";

// Built-in request adapters retain their existing lifecycle and validated operations.
let { active: _active, session: _session }: SidebarPanelProps = $props();

let input = $state("");
let personaInFlight = $state(false);
let contributedBusy = $state(false);

const { chat, sendMessage, conversations } = createAiChat({ mode: "feedback" });
let isBusy = $derived(
    chat.status === "submitted" ||
        chat.status === "streaming" ||
        (conversations ? !conversations.canSend : false),
);
let hasConversationActivity = $derived(
    chat.messages.length > 0 || chat.status !== "ready" || personaInFlight || !!chat.error,
);
let showStarterSuggestions = $derived(!hasConversationActivity);

$effect(() => appEventBus.on("college-action", (event) => {
    if (event.target.documentId !== $currentDocumentId || event.target.tabId !== $currentTabId || event.target.draftId !== $currentDraftId) return;
    if (event.action === "plan" || chat.status !== "ready" || personaInFlight || !$documentContent.trim()) return;
    const prompt = event.action === "prompt-fit"
        ? "Check this draft against each prompt and constraint in this tab's writing brief. Distinguish official requirements from advice and unknown details. Create comments only where useful; do not rewrite."
        : "Find claims in this draft that need concrete examples or reflection in light of this tab's writing brief. Ask about the writer's real contribution and meaning; never invent experiences. Create comments only where useful.";
    void sendFeedback(prompt, "college");
}));

// Wire up processing indicator + global stop listener.
useAiChatEffects(chat, "feedback");

// Also reset persona state on global stop.
$effect(() => {
    const unsub = appEventBus.on("stop-ai", () => {
        personaInFlight = false;
    });
    return unsub;
});

/**
 * Central send helper: routes through persona streams only when the
 * user has opted personas IN for this mode (personas multiply token
 * cost — see issue #259). Otherwise, and as a fallback when no personas
 * are actually enabled, uses the single-stream chat.
 */
async function sendFeedback(text: string, trigger: string, turn?: ContextAction["turn"]) {
    if (contributedBusy || (conversations && !conversations.canSend)) return;
    const personas = personasEnabledFor("feedback") ? getEnabledPersonas() : [];
    if (personas.length === 0) {
        posthog.capture("ai_feedback_requested", {
            has_selection: !!$selectedText,
            trigger,
        });
        sendMessage(text, turn);
        return;
    }

    posthog.capture("ai_feedback_requested", {
        has_selection: !!$selectedText,
        trigger: "persona",
        persona_count: personas.length,
    });

    personaInFlight = true;
    const task = beginAiTask("feedback-personas");
    try {
        await runMultiPersonaStreams({
            personas,
            streamFn: streamFeedback,
            messages: [{ id: "1", role: "user", parts: [{ type: "text", text }] }],
            mode: "feedback",
            turn,
        });
    } finally {
        personaInFlight = false;
        endAiTask(task);
    }
}

function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!input.trim() || isBusy) return;
    const text = input;
    input = "";
    sendFeedback(text, "manual");
}

function togglePersonaMode() {
    const next = !personasEnabledFor("feedback");
    setPersonasForMode("feedback", next);
    posthog.capture("persona_mode_toggled", { mode: "feedback", enabled: next });
}

let customFeedbackPrompts = $derived(
    appSettings.customQuickActions
        .filter((a) => a.panel === "feedback")
        .map((a) => ({ label: a.label, prompt: a.prompt })),
);

function useQuickPrompt(prompt: string) {
    const target = $selectedText ? "this selected text" : "my document";
    const message = `${prompt} In ${target}.`;
    posthog.capture("ai_feedback_quick_prompt_used", {
        prompt,
        has_selection: !!$selectedText,
    });
    input = "";
    sendFeedback(message, "quick_prompt");
}

function useContextAction(action: ContextAction) {
    posthog.capture("ai_context_action_used", {
        mode: "feedback",
        action: action.id,
        has_selection: !!$selectedText,
    });
    input = "";
    sendFeedback(action.prompt, `context_${action.id}`, action.turn);
}
</script>

<div class="flex-1 flex flex-col min-h-0">
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
            aria-checked={personasEnabledFor("feedback")}
            onclick={togglePersonaMode}
            title={personasEnabledFor("feedback")
                ? "Personas on — each enabled reader responds in parallel (uses more tokens)"
                : "Personas off — a single plain feedback response"}
            class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors {personasEnabledFor("feedback")
                ? 'bg-green-500'
                : 'bg-black/15'}"
        >
            <span
                class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform {personasEnabledFor("feedback")
                    ? 'translate-x-3.5'
                    : 'translate-x-0.5'}"
            ></span>
        </button>
    </div>

    {#if _active && _session}
        {#each feedbackActions as action (action.id)}
            {#if action.applies(_session)}
                <action.component session={_session} disabled={isBusy || personaInFlight || contributedBusy} onBusyChange={(busy) => (contributedBusy = busy)} />
            {/if}
        {/each}
    {/if}

    {#if showStarterSuggestions}
        <ContextLens
            mode="feedback"
            disabled={isBusy || personaInFlight || contributedBusy || !$documentContent}
            onAction={useContextAction}
        />
    {/if}

    {#if showStarterSuggestions && customFeedbackPrompts.length > 0}
        <div class="px-3 pb-3 border-b border-black/10">
            <CustomQuickActions
                prompts={customFeedbackPrompts}
                disabled={isBusy || personaInFlight || contributedBusy || !$documentContent}
                panel="feedback"
                theme="green"
                onPrompt={useQuickPrompt}
            />
        </div>
    {/if}

    {#if conversations}
        <ConversationHistory {conversations} mode="feedback" disabled={personaInFlight || contributedBusy} />
    {/if}

    <!-- Chat messages -->
    <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        {#each chat.messages as message, messageIndex (messageIndex)}
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
                                ? 'bg-green-500 text-white'
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
                    <ToolActivity {part} active={chat.status === "streaming" && message.id === chat.messages.at(-1)?.id} />
                {/if}
            {/each}
            {#if conversations}
                <ConversationMessageActions {message} {conversations} disabled={chat.status === "submitted" || chat.status === "streaming" || conversations.loading || personaInFlight} />
            {/if}
        {/each}

        {#if chat.status === "streaming" || chat.status === "submitted" || personaInFlight}
            <div class="flex justify-start">
                <div class="max-w-[85%] sm:max-w-[75%] lg:max-w-[70%]">
                    <div class="bg-gray-100 text-gray-800 px-3 py-2 rounded-lg">
                        <div class="flex items-center space-x-2">
                            <span class="inline-block animate-pulse">●</span>
                            <span class="text-sm">{personaInFlight ? "Personas analyzing..." : "Analyzing..."}</span>
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        {#if showStarterSuggestions && !personaInFlight}
            <div
                class="flex-1 flex items-center justify-center text-gray-400 text-sm"
            >
                Choose a feedback action to start
            </div>
        {/if}
    </div>

    <!-- Input -->
    <div class="border-t border-black/10 p-3 bg-white/30">
        {#if !showStarterSuggestions}
            <CustomQuickActions
                prompts={customFeedbackPrompts}
                disabled={isBusy || personaInFlight || contributedBusy || !$documentContent}
                compact
                panel="feedback"
                theme="green"
                onPrompt={useQuickPrompt}
            />
        {/if}

        <form onsubmit={handleSubmit} class="flex flex-col gap-2">
            <input
                bind:value={input}
                name="message"
                placeholder="Ask for specific feedback..."
                disabled={isBusy || personaInFlight || contributedBusy}
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={isBusy || personaInFlight || contributedBusy || !input.trim()}
                class="w-full py-2 bg-green-500 text-white text-sm font-medium rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Send
            </button>
        </form>
    </div>
</div>
