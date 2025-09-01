<script lang="ts">
    import { documentContent, selectedText } from "$lib/stores";
    import { renderMarkdown } from "$lib/utils";
    import type { Message } from "ai";

    let input = "";
    let messages: Message[] = [];
    let isLoading = false;

    async function handleSubmit(event: Event) {
        event.preventDefault();
        const formData = new FormData(event.target as HTMLFormElement);
        const userMessage = formData.get("message") as string;

        if (!userMessage.trim() || isLoading) return;

        // Add user message to chat
        const userChatMessage: Message = {
            id: crypto.randomUUID(),
            role: "user",
            content: userMessage,
        };
        messages = [...messages, userChatMessage];

        // Create contextual prompt for API
        let contextualPrompt = userMessage;
        const doc = $documentContent;
        const selection = $selectedText;

        if (doc) {
            contextualPrompt += `\n\nCurrent document:\n\`\`\`\n${doc}\n\`\`\`\n`;
        }

        if (selection) {
            contextualPrompt += `\n\nCurrently selected text:\n\`\`\`\n${selection}\n\`\`\`\n`;
        }

        // Clear input
        input = "";
        isLoading = true;

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [
                        ...messages.slice(0, -1), // Previous messages without context
                        { ...userChatMessage, content: contextualPrompt },
                    ],
                }),
            });

            if (!response.ok) throw new Error("Failed to get AI response");

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response body");

            const assistantMessage: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "",
            };
            messages = [...messages, assistantMessage];

            const decoder = new TextDecoder();
            let done = false;

            while (!done) {
                const { value, done: streamDone } = await reader.read();
                done = streamDone;

                if (value) {
                    const chunk = decoder.decode(value);
                    const lines = chunk
                        .split("\n")
                        .filter((line) => line.trim() !== "");

                    for (const line of lines) {
                        if (line.startsWith("0:")) {
                            try {
                                const content = JSON.parse(line.slice(2));
                                assistantMessage.content += content;
                                messages = [
                                    ...messages.slice(0, -1),
                                    assistantMessage,
                                ];
                            } catch (e) {
                                // Skip parsing errors
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error:", error);
            const errorMessage: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                content: "Sorry, I encountered an error. Please try again.",
            };
            messages = [...messages, errorMessage];
        } finally {
            isLoading = false;
        }
    }
</script>

<div class="flex flex-col h-full">
    <!-- Chat messages -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
        {#each messages as message (message.id)}
            {@const rendered = renderMarkdown(message.content)}
            <div
                class="flex {message.role === 'user'
                    ? 'justify-end'
                    : 'justify-start'}"
            >
                <div
                    class="max-w-[80%] p-3 rounded-lg {message.role === 'user'
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
        {/each}

        {#if isLoading}
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
        <form
            onsubmit={handleSubmit}
            class="flex space-x-2 flex-wrap space-y-2"
        >
            <input
                bind:value={input}
                name="message"
                placeholder="Ask about your document..."
                disabled={isLoading}
                class="flex-1 w-fit p-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={isLoading}
                class="px-4 w-full py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
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
