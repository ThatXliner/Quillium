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
import { selectedText, documentContent } from "$lib/stores";
import { renderMarkdown } from "$lib/ai/utils";
import { createAiChat, setAiProcessing } from "$lib/ai/chatFactory";
import posthog from "posthog-js";

let input = $state("");
const { chat, clearChat } = createAiChat({ mode: "chat" });

// Sync streaming state to the global AI processing indicator
// so the sidebar glow activates during chat requests.
// States: ready -> submitted -> streaming -> ready (or error).
$effect(() => {
	setAiProcessing(chat.status === "submitted" || chat.status === "streaming");
});

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
    <!-- Chat messages -->
    <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 relative">
        {#if chat.messages.length > 0}
            <button
                onclick={clearChat}
                title="Clear chat"
                class="absolute top-2 right-2 text-[10px] text-black/25 hover:text-black/50 transition-colors"
            >Clear</button>
        {/if}
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
