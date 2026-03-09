<!--
    Chat.svelte — Free-form conversational AI panel (blue theme).

    Provides a simple chat interface where the writer can ask questions
    about their document. Uses the "chat" mode stream which has no tool
    definitions — the LLM responds with plain text only.

    State machine (driven by `chat.status` from @ai-sdk/svelte Chat):
      ready     — user can type and submit.
      submitted — message sent, waiting for first token.
      streaming — tokens arriving, "Thinking..." indicator shown.
      error     — request failed, error message displayed.

    The `$effect` block syncs `chat.status` to `aiProcessing.active`
    so the sidebar glow activates during requests.

    Dependencies: chatFactory (createAiChat), utils (renderMarkdown),
    stores (selectedText, documentContent), posthog.
-->
<script lang="ts">
/*
 * Chat.svelte
 *
 * Free-form conversational AI panel (blue theme).
 *
 * Renders:
 *   A scrollable message list with user/assistant bubbles, a
 *   streaming indicator, error display, and a bottom input form
 *   with selection-context chip.
 *
 * Props: none.
 * Events: none dispatched.
 *
 * Stores read:
 *   - $selectedText — shown as a context chip above the input;
 *     included in the chat's system prompt by chatFactory.
 *   - $documentContent — used by chatFactory for document context.
 *
 * Stores written:
 *   - aiProcessing.active (via setAiProcessing) — set true while
 *     streaming so the sidebar glow activates.
 *
 * AI streaming layer:
 *   Uses createAiChat({ mode: "chat" }) which returns a chat
 *   object from @ai-sdk/svelte. No tool definitions — the LLM
 *   responds with plain text only. Messages render markdown via
 *   renderMarkdown (async, returns sanitized HTML).
 *
 * State machine (chat.status):
 *   ready -> submitted -> streaming -> ready
 *                                   \-> error
 */
import { selectedText, documentContent } from "$lib/stores";
import { renderMarkdown } from "$lib/ai/utils";
import { createAiChat, setAiProcessing } from "$lib/ai/chatFactory";
import { appSettings, persistSettings } from "$lib/settings.svelte";
import { Plus, Trash2 } from "lucide-svelte";
import posthog from "posthog-js";

let input = $state("");
const { chat, clearChat } = createAiChat({ mode: "chat" });

let customChatPrompts = $derived(appSettings.customQuickActions.filter((a) => a.panel === "chat"));

// Chip management
let showAddChip = $state(false);
let newChipLabel = $state("");
let newChipPrompt = $state("");

function addChip() {
    if (!newChipLabel.trim() || !newChipPrompt.trim()) return;
    appSettings.customQuickActions = [
        ...appSettings.customQuickActions,
        { label: newChipLabel.trim(), prompt: newChipPrompt.trim(), panel: "chat" },
    ];
    persistSettings();
    newChipLabel = "";
    newChipPrompt = "";
    showAddChip = false;
}

function removeChip(label: string, prompt: string) {
    appSettings.customQuickActions = appSettings.customQuickActions.filter(
        (a) => !(a.panel === "chat" && a.label === label && a.prompt === prompt),
    );
    persistSettings();
}

function useQuickPrompt(prompt: string) {
    posthog.capture("ai_chat_quick_prompt_used", {
        has_selection: !!$selectedText,
    });
    chat.sendMessage({ text: prompt });
}

// Sync streaming state to the global AI processing indicator
// so the sidebar glow activates during chat requests.
// States: ready -> submitted -> streaming -> ready (or error).
$effect(() => {
    setAiProcessing(chat.status === "submitted" || chat.status === "streaming");
});

/**
 * Extract the user's message from the form, validate it, send it
 * to the AI chat, and clear the input. Captures a posthog event
 * with selection context and message length.
 */
async function handleSubmit(event: Event) {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const userMessage = formData.get("message") as string;
    if (!userMessage.trim() || chat.status !== "ready") return;
    posthog.capture("ai_chat_message_sent", {
        has_selection: !!$selectedText,
        message_length: userMessage.length,
    });
    await chat.sendMessage({ text: userMessage });
    input = "";
}
</script>

<div class="flex flex-col h-full">
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
        {#each chat.messages as message (message.id)}
            {#each message.parts as part, partIndex (partIndex)}
                {#if part.type === "text"}
                    {@const renderPromise = renderMarkdown(part.text)}
                    <div
                        class="flex {message.role === 'user'
                            ? 'justify-end'
                            : 'justify-start'}"
                    >
                        <div
                            class="relative max-w-[85%] sm:max-w-[75%] lg:max-w-[70%] {message.role ===
                            'user'
                                ? 'order-1'
                                : 'order-2'}"
                        >
                            <div
                                class="px-3 py-2 rounded-lg {message.role ===
                                'user'
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-gray-100 text-gray-800'}"
                            >
                                <div
                                    class="prose prose-sm max-w-none {message.role ===
                                    'user'
                                        ? 'prose-invert'
                                        : ''} [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                                >
                                    {#await renderPromise then rendered}
                                        {@html rendered}
                                    {/await}
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}
            {/each}
        {/each}

        {#if chat.status === "streaming"}
            <div class="flex justify-start">
                <div class="max-w-[85%] sm:max-w-[75%] lg:max-w-[70%]">
                    <div class="bg-gray-100 text-gray-800 px-3 py-2 rounded-lg">
                        <div class="flex items-center space-x-2">
                            <span class="inline-block animate-pulse">●</span>
                            <span class="text-sm">Thinking...</span>
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        {#if chat.error}
            <div class="flex justify-start">
                <div class="max-w-[85%] sm:max-w-[75%] lg:max-w-[70%]">
                    <div class="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm border border-red-200">
                        {chat.error.message ?? "An error occurred. Please try again."}
                    </div>
                </div>
            </div>
        {/if}

        {#if chat.messages.length === 0 && !chat.error}
            <div
                class="flex-1 flex items-center justify-center text-gray-400 text-sm"
            >
                Start a conversation about your document
            </div>
        {/if}
    </div>

    <!-- Input form -->
    <div class="border-t border-black/10 p-3 bg-white/30">
        {#if customChatPrompts.length > 0 || showAddChip}
            <div class="mb-2 flex flex-wrap gap-1.5">
                {#each customChatPrompts as { label, prompt }}
                    <div class="group relative flex items-center">
                        <button
                            onclick={() => useQuickPrompt(prompt)}
                            disabled={chat.status !== "ready" || !$documentContent}
                            class="px-2 py-1 text-xs bg-white hover:bg-blue-50 rounded border border-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed pr-5"
                        >
                            {label}
                        </button>
                        <button
                            onclick={() => removeChip(label, prompt)}
                            aria-label="Remove chip"
                            class="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-black/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <Trash2 size={9} />
                        </button>
                    </div>
                {/each}
            </div>
        {/if}
        {#if showAddChip}
            <div class="mb-2 flex flex-col gap-1">
                <input
                    bind:value={newChipLabel}
                    placeholder="Label"
                    class="w-full px-2 py-1 text-xs border border-black/10 rounded focus:outline-none focus:ring-1 focus:ring-blue-400/50 placeholder:text-black/25"
                />
                <textarea
                    bind:value={newChipPrompt}
                    placeholder="Prompt sent to AI…"
                    rows="2"
                    class="w-full px-2 py-1 text-xs border border-black/10 rounded focus:outline-none focus:ring-1 focus:ring-blue-400/50 resize-none placeholder:text-black/25"
                ></textarea>
                <div class="flex gap-1.5">
                    <button
                        onclick={addChip}
                        disabled={!newChipLabel.trim() || !newChipPrompt.trim()}
                        class="flex-1 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >Save</button>
                    <button
                        onclick={() => { showAddChip = false; newChipLabel = ""; newChipPrompt = ""; }}
                        class="px-2 py-1 text-xs text-black/40 hover:text-black/60 transition-colors"
                    >Cancel</button>
                </div>
            </div>
        {:else}
            <button
                onclick={() => { showAddChip = true; }}
                class="mb-2 flex items-center gap-1 text-[10px] text-black/30 hover:text-blue-500 transition-colors"
            >
                <Plus size={10} />
                Add chip
            </button>
        {/if}
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
                placeholder={$selectedText
                    ? "Ask about selection..."
                    : "Ask about your document..."}
                disabled={chat.status !== "ready"}
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={chat.status !== "ready" || !input.trim()}
                class="w-full py-2 bg-blue-500 text-white text-sm font-medium rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Send
            </button>
        </form>
    </div>
</div>
