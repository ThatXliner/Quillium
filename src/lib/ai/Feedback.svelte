<!--
    Feedback.svelte — Editorial feedback AI panel (green theme).

    Provides high-level editorial feedback on the writer's document.
    Uses the "feedback" mode stream which includes two tools:
      - createComment: flags a specific passage with editorial notes.
      - createRevision: proposes 2-3 alternative versions of a passage.

    These tool calls are routed through chatFactory.handleToolCall to
    the annotation system, which attaches comments/revisions directly
    to the CodeMirror editor.

    Features a "Get feedback" quick-action button that auto-generates
    a prompt based on whether text is selected or not.

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
 *   A "Get feedback" quick-action button, scrollable message list
 *   with user/assistant bubbles, streaming indicator, and a bottom
 *   input form with selection-context chip.
 *
 * Props: none.
 * Events: none dispatched.
 *
 * Stores read:
 *   - $selectedText — toggles quick-action label between
 *     "Get feedback on selection" / "Get general feedback"; shown
 *     as a context chip above the input.
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
import { createAiChat, setAiProcessing } from "$lib/ai/chatFactory";
import posthog from "posthog-js";

let input = $state("");

const { chat, clearChat } = createAiChat({ mode: "feedback" });

// Sync streaming state to the global AI processing indicator.
// States: ready -> submitted -> streaming -> ready (or error).
$effect(() => {
    setAiProcessing(chat.status === "submitted" || chat.status === "streaming");
});

function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!input.trim() || chat.status !== "ready") return;

    posthog.capture("ai_feedback_requested", {
        has_selection: !!$selectedText,
        trigger: "manual",
    });
    chat.sendMessage({ text: input });
    input = "";
}

/**
 * Build a selection-aware feedback prompt and send it as a chat
 * message. If text is selected, asks for feedback on the selection;
 * otherwise requests general document feedback.
 */
function askForFeedback() {
    const context = $selectedText
        ? `Please provide feedback on this selected text: "${$selectedText}"`
        : "Please provide feedback on my document.";

    posthog.capture("ai_feedback_requested", {
        has_selection: !!$selectedText,
        trigger: "quick_action",
    });
    input = context;
    chat.sendMessage({ text: context });
}
</script>

<div class="flex-1 flex flex-col min-h-0">
    <!-- Quick actions -->
    <div class="p-3 border-b border-black/10">
        <button
            onclick={askForFeedback}
            disabled={chat.status !== "ready" || !$documentContent}
            class="w-full p-2.5 bg-white hover:bg-green-50 rounded-lg border border-green-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow"
        >
            <div class="text-sm font-medium text-green-800">
                {$selectedText
                    ? "Get feedback on selection"
                    : "Get general feedback"}
            </div>
            <div class="text-xs text-green-600 mt-0.5">
                {$documentContent
                    ? `Document: ${$documentContent.length.toLocaleString()} characters`
                    : "Add content to get feedback"}
            </div>
        </button>
    </div>

    <!-- Chat messages -->
    <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 relative">
        {#if chat.messages.length > 0}
            <button
                onclick={clearChat}
                title="Start a fresh conversation (clears all messages)"
                class="absolute top-2 right-2 text-[10px] text-black/25 hover:text-red-400 transition-colors"
            >New chat</button>
        {/if}
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
                {/if}
            {/each}
        {/each}

        {#if chat.status === "streaming" || chat.status === "submitted"}
            <div class="flex justify-start">
                <div class="max-w-[85%] sm:max-w-[75%] lg:max-w-[70%]">
                    <div class="bg-gray-100 text-gray-800 px-3 py-2 rounded-lg">
                        <div class="flex items-center space-x-2">
                            <span class="inline-block animate-pulse">●</span>
                            <span class="text-sm">Analyzing...</span>
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        {#if chat.messages.length === 0}
            <div
                class="flex-1 flex items-center justify-center text-gray-400 text-sm"
            >
                Click "Get feedback" to start
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
                placeholder="Ask for specific feedback..."
                disabled={chat.status !== "ready"}
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={chat.status !== "ready" || !input.trim()}
                class="w-full py-2 bg-green-500 text-white text-sm font-medium rounded-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Send
            </button>
        </form>
    </div>
</div>
