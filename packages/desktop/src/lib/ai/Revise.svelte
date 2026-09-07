<!--
    Revise.svelte — Text revision AI panel (purple theme).

    Provides targeted rewriting and revision suggestions. Uses the
    "revise" mode stream which includes three tools:
      - createSuggestion: proposes one or more rewritten versions of a
        passage, each with an optional rationale.
      - createComment: adds an explanatory note about the revision.
      - createRevision: creates reversible passage alternatives.

    These tool calls are routed through chatFactory.handleToolCall to
    the annotation system, which attaches inline suggestions/comments
    to the CodeMirror editor.

    Features:
      - Context lens with selection/document-aware revision actions.
      - User-defined custom quick actions from settings.

    State machine (driven by `chat.status`):
      ready     — user can submit or click a quick action.
      submitted — waiting for first token.
      streaming — tokens arriving, "Revising..." indicator shown.
      error     — implicit (chat.error set).

    Dependencies: chatFactory, utils (renderMarkdown), stores, posthog.
-->
<script lang="ts">
import {
    beginAiTask,
    createAiChat,
    endAiTask,
    runMultiPersonaStreams,
    useAiChatEffects,
} from "$lib/ai/chatFactory";
import { streamRevise } from "$lib/ai/clientStreams";
import { personaModes, setPersonasForMode } from "$lib/ai/settings.svelte";
import { renderMarkdown } from "$lib/ai/utils";
import { appEventBus } from "$lib/events/appEventBus";
import posthog from "$lib/posthog";
import { getEnabledPersonas } from "$lib/readers/settings.svelte";
import { appSettings } from "$lib/settings.svelte";
import type { SidebarPanelProps } from "$lib/sidebar/panels";
/*
 * Revise.svelte
 *
 * Text revision AI panel (purple theme).
 *
 * Renders:
 *   A context lens with action cards, user-defined custom actions,
 *   scrollable message list with user/assistant bubbles, streaming
 *   indicator, and a bottom input form for revision requests.
 *
 * Props: none.
 * Events: none dispatched.
 *
 * Stores read:
 *   - $selectedText — toggles quick-action label and scopes
 *     quick prompts to "this selected text" vs "my document".
 *   - $documentContent — gates action buttons (disabled when empty)
 *     and displayed as character count.
 *
 * Stores written:
 *   - aiProcessing.active (via setAiProcessing) — true while
 *     streaming so the sidebar glow activates.
 *
 * AI streaming layer:
 *   Uses createAiChat({ mode: "revise" }) with comment, suggestion,
 *   and revision tools. Tool calls are routed through
 *   chatFactory.handleToolCall to the annotation system.
 *
 * State machine (chat.status):
 *   ready -> submitted -> streaming -> ready
 *                                   \-> error (chat.error set)
 */
import { documentContent, selectedText } from "$lib/stores";
import { UsersIcon } from "lucide-svelte";
import ContextLens from "./ContextLens.svelte";
import CustomQuickActions from "./CustomQuickActions.svelte";
import PersonaInfoModal from "./PersonaInfoModal.svelte";
import type { ContextAction } from "./context";

// Built-in request adapters retain their existing lifecycle and validated operations.
let { active: _active, session: _session }: SidebarPanelProps = $props();

let input = $state("");
let personaInFlight = $state(false);

const { chat, clearChat, sendMessage } = createAiChat({ mode: "revise" });
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
useAiChatEffects(chat, "revise");

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
async function sendRevise(text: string, trigger: string, turn?: ContextAction["turn"]) {
    const personas = personaModes.revise ? getEnabledPersonas() : [];
    if (personas.length === 0 || turn?.task === "exact-compression") {
        posthog.capture("ai_revise_requested", {
            has_selection: !!$selectedText,
            trigger,
        });
        sendMessage(text, turn);
        return;
    }

    posthog.capture("ai_revise_requested", {
        has_selection: !!$selectedText,
        trigger: "persona",
        persona_count: personas.length,
    });

    personaInFlight = true;
    const task = beginAiTask("revise-personas");
    try {
        await runMultiPersonaStreams({
            personas,
            streamFn: streamRevise,
            messages: [{ id: "1", role: "user", parts: [{ type: "text", text }] }],
            mode: "revise",
            turn,
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
    sendRevise(text, "manual");
}

function togglePersonaMode() {
    const next = !personaModes.revise;
    setPersonasForMode("revise", next);
    posthog.capture("persona_mode_toggled", { mode: "revise", enabled: next });
}

let customRevisePrompts = $derived(
    appSettings.customQuickActions
        .filter((a) => a.panel === "revise")
        .map((a) => ({ label: a.label, prompt: a.prompt })),
);

/**
 * Compose a revision message from a quick-prompt chip, scoped to
 * the current selection or the full document, then send it.
 */
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
            aria-checked={personaModes.revise}
            onclick={togglePersonaMode}
            title={personaModes.revise
                ? "Personas on — each enabled reader responds in parallel (uses more tokens)"
                : "Personas off — a single plain revision response"}
            class="relative inline-flex h-4 w-7 items-center rounded-full transition-colors {personaModes.revise
                ? 'bg-purple-500'
                : 'bg-black/15'}"
        >
            <span
                class="inline-block h-3 w-3 transform rounded-full bg-white transition-transform {personaModes.revise
                    ? 'translate-x-3.5'
                    : 'translate-x-0.5'}"
            ></span>
        </button>
    </div>

    {#if showStarterSuggestions}
        <ContextLens
            mode="revise"
            disabled={chat.status !== "ready" || personaInFlight || !$documentContent}
            onAction={useContextAction}
        />
    {/if}

    {#if showStarterSuggestions && customRevisePrompts.length > 0}
        <div class="px-3 pb-3 border-b border-black/10">
            <CustomQuickActions
                prompts={customRevisePrompts}
                disabled={chat.status !== "ready" || personaInFlight || !$documentContent}
                panel="revise"
                theme="purple"
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
                class="text-[10px] text-black/30 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50"
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
                {/if}
            {/each}
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

    <!-- Input -->
    <div class="border-t border-black/10 p-3 bg-white/30">
        {#if !showStarterSuggestions}
            <CustomQuickActions
                prompts={customRevisePrompts}
                disabled={chat.status !== "ready" || personaInFlight || !$documentContent}
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
                disabled={chat.status !== "ready" || personaInFlight}
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={chat.status !== "ready" || personaInFlight || !input.trim()}
                class="w-full py-2 bg-purple-500 text-white text-sm font-medium rounded-md hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Revise
            </button>
        </form>
    </div>
</div>
