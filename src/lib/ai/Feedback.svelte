<!--
    Feedback.svelte — Editorial feedback AI panel (green theme).

    Provides high-level editorial feedback on the writer's document.
    Uses the "feedback" mode stream which includes two tools:
      - createComment: flags a specific passage with editorial notes.
      - createRevision: proposes 2-3 alternative versions of a passage.

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
 *   Uses createAiChat({ mode: "feedback" }) which provides two
 *   tool definitions: createComment and createRevision. Tool calls
 *   are routed through chatFactory.handleToolCall to the annotation
 *   system, attaching comments/revisions to the CodeMirror editor.
 *
 * State machine (chat.status):
 *   ready -> submitted -> streaming -> ready
 *                                   \-> error (chat.error set)
 */
import { selectedText, documentContent } from "$lib/stores";
import { renderMarkdown } from "$lib/ai/utils";
import {
    createAiChat,
    useAiChatEffects,
    beginAiTask,
    endAiTask,
    runMultiPersonaStreams,
} from "$lib/ai/chatFactory";
import { appSettings } from "$lib/settings.svelte";
import posthog from "$lib/posthog";
import { getEnabledPersonas } from "$lib/readers/settings.svelte";
import { streamFeedback } from "$lib/ai/clientStreams";
import { appEventBus } from "$lib/events/appEventBus";
import ContextLens from "./ContextLens.svelte";
import CustomQuickActions from "./CustomQuickActions.svelte";
import type { ContextAction } from "./context";

let input = $state("");
let personaInFlight = $state(false);

const { chat, clearChat } = createAiChat({ mode: "feedback" });
let hasConversationActivity = $derived(
    chat.messages.length > 0 || chat.status !== "ready" || personaInFlight || !!chat.error,
);
let showStarterSuggestions = $derived(!hasConversationActivity);
let showConversationControls = $derived(hasConversationActivity);

function clearConversation() {
    clearChat();
    personaInFlight = false;
}

// Wire up processing indicator + global stop listener.
useAiChatEffects(chat);

// Also reset persona state on global stop.
$effect(() => {
    const unsub = appEventBus.on("stop-ai", () => {
        personaInFlight = false;
    });
    return unsub;
});

/**
 * Central send helper: routes through persona streams when personas
 * are enabled, otherwise falls back to the single-stream chat.
 */
async function sendFeedback(text: string, trigger: string) {
    const personas = getEnabledPersonas();
    if (personas.length === 0) {
        posthog.capture("ai_feedback_requested", {
            has_selection: !!$selectedText,
            trigger,
        });
        chat.sendMessage({ text });
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
        });
    } finally {
        personaInFlight = false;
        endAiTask(task);
    }
}

function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!input.trim() || chat.status !== "ready") return;
    const text = input;
    input = "";
    sendFeedback(text, "manual");
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
    sendFeedback(action.prompt, `context_${action.id}`);
}
</script>

<div class="flex-1 flex flex-col min-h-0">
    {#if showStarterSuggestions}
        <ContextLens
            mode="feedback"
            disabled={chat.status !== "ready" || personaInFlight || !$documentContent}
            onAction={useContextAction}
        />
    {/if}

    {#if showStarterSuggestions && customFeedbackPrompts.length > 0}
        <div class="px-3 pb-3 border-b border-[color:var(--border)]">
            <CustomQuickActions
                prompts={customFeedbackPrompts}
                disabled={chat.status !== "ready" || personaInFlight || !$documentContent}
                panel="feedback"
                theme="green"
                onPrompt={useQuickPrompt}
            />
        </div>
    {/if}

    <!-- Clear chat row -->
    {#if showConversationControls}
        <div class="flex justify-end px-3 pt-2 shrink-0">
            <button
                onclick={clearConversation}
                title="Start a fresh conversation (clears all messages)"
                class="text-[10px] text-[color:var(--text-ghost)] hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10"
            >New chat</button>
        </div>
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
                                : 'bg-[color:var(--surface-2)] text-[color:var(--text)]'}"
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
                {/if}
            {/each}
        {/each}

        {#if chat.status === "streaming" || chat.status === "submitted" || personaInFlight}
            <div class="flex justify-start">
                <div class="max-w-[85%] sm:max-w-[75%] lg:max-w-[70%]">
                    <div class="bg-[color:var(--surface-2)] text-[color:var(--text)] px-3 py-2 rounded-lg">
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
                class="flex-1 flex items-center justify-center text-[color:var(--text-faint)] text-sm"
            >
                Choose a feedback action to start
            </div>
        {/if}
    </div>

    <!-- Input -->
    <div class="border-t border-[color:var(--border)] p-3 bg-[color:var(--surface)]">
        {#if !showStarterSuggestions}
            <CustomQuickActions
                prompts={customFeedbackPrompts}
                disabled={chat.status !== "ready" || personaInFlight || !$documentContent}
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
                disabled={chat.status !== "ready" || personaInFlight}
                class="w-full px-3 py-2 text-sm border border-[color:var(--border-strong)] rounded-md bg-[color:var(--surface-2)] text-[color:var(--text)] placeholder:text-[color:var(--text-ghost)] focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={chat.status !== "ready" || personaInFlight || !input.trim()}
                class="w-full py-2 bg-green-500 text-white text-sm font-medium rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Send
            </button>
        </form>
    </div>
</div>
