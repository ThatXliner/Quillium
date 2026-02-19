<script lang="ts">
    import { documentContent, selectedText } from "$lib/stores";
    import { renderMarkdown } from "$lib/ai/utils";
    import { DefaultChatTransport } from "ai";
    import { Chat } from "@ai-sdk/svelte";
    import { aiSettings } from "$lib/ai/settings.svelte";

    let input = $state("");
    let chat = new Chat({
        transport: new DefaultChatTransport({
            api: "/api/chat",
            body: () => ({
                documentContent: $documentContent,
                selectedText: $selectedText,
                provider: aiSettings.provider,
                model: aiSettings.model,
                apiKey: aiSettings.apiKey,
            }),
        }),
    });

    async function handleSubmit(event: Event) {
        event.preventDefault();
        const formData = new FormData(event.target as HTMLFormElement);
        const userMessage = formData.get("message") as string;
        if (!userMessage.trim() || chat.status !== "ready") return;
        await chat.sendMessage({ text: userMessage });
        input = "";
    }
</script>

<div class="flex flex-col h-full">
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

        {#if chat.messages.length === 0}
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
