<!--
    Revise.svelte — Text revision AI panel (purple theme).

    Provides targeted rewriting and revision suggestions. Uses the
    "revise" mode stream which includes two tools:
      - createSuggestion: proposes one or more rewritten versions of a
        passage, each with an optional rationale.
      - createComment: adds an explanatory note about the revision.

    These tool calls are routed through chatFactory.handleToolCall to
    the annotation system, which attaches inline suggestions/comments
    to the CodeMirror editor.

    Features:
      - "Revise" quick-action button (selection-aware).
      - Quick-prompt grid for common revision tasks (conciseness, flow,
        grammar, etc.).

    State machine (driven by `chat.status`):
      ready     — user can submit or click a quick action.
      submitted — waiting for first token.
      streaming — tokens arriving, "Revising..." indicator shown.
      error     — implicit (chat.error set).

    Dependencies: chatFactory, utils (renderMarkdown), stores, posthog.
-->
<script lang="ts">
/*
 * Revise.svelte
 *
 * Text revision AI panel (purple theme).
 *
 * Renders:
 *   A "Revise" quick-action button, a grid of quick-prompt chips
 *   for common revision tasks, scrollable message list with
 *   user/assistant bubbles, streaming indicator, and a bottom
 *   input form with selection-context chip.
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
 *   Uses createAiChat({ mode: "revise" }) which provides two
 *   tool definitions: createSuggestion (proposes rewritten
 *   versions with optional rationale) and createComment (adds
 *   explanatory notes). Tool calls are routed through
 *   chatFactory.handleToolCall to the annotation system.
 *
 * State machine (chat.status):
 *   ready -> submitted -> streaming -> ready
 *                                   \-> error (chat.error set)
 */
import { selectedText, documentContent } from "$lib/stores";
import { renderMarkdown } from "$lib/ai/utils";
import { createAiChat, setAiProcessing, runMultiPersonaStreams } from "$lib/ai/chatFactory";
import { appSettings } from "$lib/settings.svelte";
import posthog from "$lib/posthog";
import { getEnabledPersonas } from "$lib/readers/settings.svelte";
import { streamRevise } from "$lib/ai/clientStreams";

let input = $state("");
let personaInFlight = $state(false);

const { chat, clearChat } = createAiChat({ mode: "revise" });

// Sync streaming state to the global AI processing indicator.
// States: ready -> submitted -> streaming -> ready (or error).
$effect(() => {
    setAiProcessing(chat.status === "submitted" || chat.status === "streaming");
});

// Listen for global stop event to abort this chat's stream.
$effect(() => {
    function handleStop() {
        if (chat.status === "submitted" || chat.status === "streaming") {
            chat.stop();
        }
        personaInFlight = false;
    }
    window.addEventListener("quillium:stop-ai", handleStop);
    return () => window.removeEventListener("quillium:stop-ai", handleStop);
});

/**
 * Central send helper: routes through persona streams when personas
 * are enabled, otherwise falls back to the single-stream chat.
 */
async function sendRevise(text: string, trigger: string) {
    const personas = getEnabledPersonas();
    if (personas.length === 0) {
        posthog.capture("ai_revise_requested", {
            has_selection: !!$selectedText,
            trigger,
        });
        chat.sendMessage({ text });
        return;
    }

    posthog.capture("ai_revise_requested", {
        has_selection: !!$selectedText,
        trigger: "persona",
        persona_count: personas.length,
    });

    personaInFlight = true;
    setAiProcessing(true);
    try {
        await runMultiPersonaStreams({
            personas,
            streamFn: streamRevise,
            messages: [{ id: "1", role: "user", parts: [{ type: "text", text }] }],
            mode: "revise",
        });
    } finally {
        personaInFlight = false;
        setAiProcessing(false);
    }
}

function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!input.trim() || chat.status !== "ready") return;
    const text = input;
    input = "";
    sendRevise(text, "manual");
}

function revise() {
    const context = $selectedText
        ? `Please revise and rewrite this selected text to improve flow and conciseness: "${$selectedText}"`
        : "Please revise my document to improve flow and conciseness.";
    input = context;
    sendRevise(context, "quick_action");
}

const defaultQuickPrompts = [
    { label: "Make this more concise", prompt: "Make this more concise" },
    { label: "Improve the flow and transitions", prompt: "Improve the flow and transitions" },
    { label: "Make this more engaging", prompt: "Make this more engaging" },
    { label: "Fix grammar and style issues", prompt: "Fix grammar and style issues" },
    { label: "Simplify complex sentences", prompt: "Simplify complex sentences" },
];

let allRevisePrompts = $derived([
    ...defaultQuickPrompts,
    ...appSettings.customQuickActions
        .filter((a) => a.panel === "revise")
        .map((a) => ({ label: a.label, prompt: a.prompt })),
]);

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
    input = message;
    sendRevise(message, "quick_prompt");
}
</script>

<div class="flex-1 flex flex-col min-h-0">
    <!-- Quick actions -->
    <div class="p-3 border-b border-black/10">
        <button
            onclick={revise}
            disabled={chat.status !== "ready" || personaInFlight || !$documentContent}
            class="w-full p-2.5 bg-white hover:bg-purple-50 rounded-lg border border-purple-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow"
        >
            <div class="text-sm font-medium text-purple-800">
                {$selectedText ? "Revise selection" : "Revise document"}
            </div>
            <div class="text-xs text-purple-600 mt-0.5">
                {$documentContent
                    ? `Document: ${$documentContent.length.toLocaleString()} characters`
                    : "Add content to revise"}
            </div>
        </button>

        <!-- Quick prompts -->
        <div class="mt-2 grid grid-cols-2 gap-1.5">
            {#each allRevisePrompts as { label, prompt }}
                <button
                    onclick={() => useQuickPrompt(prompt)}
                    disabled={chat.status !== "ready" || personaInFlight || !$documentContent}
                    class="px-2 py-1.5 text-xs bg-white hover:bg-purple-50 rounded border border-purple-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                    {label}
                </button>
            {/each}
        </div>
    </div>

    <!-- Clear chat row -->
    {#if chat.messages.length > 0}
        <div class="flex justify-end px-3 pt-2 shrink-0">
            <button
                onclick={clearChat}
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

        {#if chat.messages.length === 0 && !personaInFlight}
            <div
                class="flex-1 flex items-center justify-center text-gray-400 text-sm"
            >
                Click "Revise" or choose a quick action to start
            </div>
        {/if}
    </div>

    <!-- Input -->
    <div class="border-t border-black/10 p-3 bg-white/30">
        {#if $selectedText}
            <div
                class="mb-2 text-xs bg-yellow-50 px-2 py-1.5 rounded border border-yellow-200"
            >
                <span class="text-yellow-700">
                    Context: "{$selectedText.slice(
                        0,
                        60,
                    )}{$selectedText.length > 60 ? "..." : ""}"
                </span>
            </div>
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
