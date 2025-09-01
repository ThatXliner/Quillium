<script lang="ts">
    import { documentContent, selectedText } from "$lib/stores";
    import { renderMarkdown } from "$lib/utils";
    import { DefaultChatTransport } from "ai";
    import { Chat } from "@ai-sdk/svelte";

    let input = $state("");
    let chat = new Chat({
        transport: new DefaultChatTransport({
            api: "/api/chat",
            body: {
                documentContent: $documentContent,
                selectedText: $selectedText,
            },
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
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
        {#each chat.messages as message (message.id)}
            {#each message.parts as part, partIndex (partIndex)}
                {#if part.type === "text"}
                    {@const rendered = renderMarkdown(
                        message.parts
                            .filter((x) => x.type === "text")
                            .map((x) => x.text)
                            .join("\n"),
                    )}
                    <div
                        class="flex {message.role === 'user'
                            ? 'justify-end'
                            : 'justify-start'}"
                    >
                        <div
                            class="max-w-[80%] p-3 rounded-lg {message.role ===
                            'user'
                                ? 'bg-blue-500 text-white ml-4'
                                : 'bg-gray-100 text-gray-900 mr-4'}"
                        >
                            <div class="text-xs opacity-70 mb-1 capitalize">
                                {message.role}
                            </div>
                            <div class="whitespace-pre-wrap">
                                {#await rendered then html}
                                    {@html html}
                                {/await}
                            </div>
                        </div>
                    </div>
                {/if}
            {/each}
        {/each}

        {#if chat.status === "streaming"}
            <div class="flex justify-start">
                <div
                    class="bg-gray-100 text-gray-900 mr-4 max-w-[80%] p-3 rounded-lg"
                >
                    <div class="text-xs opacity-70 mb-1">Assistant</div>
                    <div class="flex items-center space-x-2">
                        <div class="animate-pulse">Thinking...</div>
                    </div>
                </div>
            </div>
        {/if}
    </div>

    <!-- Input form -->
    <div class="border-t border-gray-200 p-4">
        <form onsubmit={handleSubmit} class="flex flex-col flex-wrap space-y-2">
            <input
                bind:value={input}
                name="message"
                placeholder="Ask about your document..."
                disabled={chat.status !== "ready"}
                class="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={chat.status !== "ready"}
                class="w-full py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
                Send
            </button>
        </form>

        {#if $selectedText}
            <div class="mt-2 text-xs text-gray-500">
                Selected: "{$selectedText.slice(0, 50)}{$selectedText.length >
                50
                    ? "..."
                    : ""}"
            </div>
        {/if}
    </div>
</div>
