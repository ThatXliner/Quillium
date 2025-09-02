<script lang="ts">
    import { selectedText, documentContent, editorView } from "$lib/stores";
    import {
        createComment,
        createSuggestion,
    } from "$lib/editor/plugins/annotations";
    import { Chat } from "@ai-sdk/svelte";
    import { DefaultChatTransport } from "ai";

    let input = $state("");

    function handleToolCall({ toolCall }: any) {
        if (!$editorView) return;
        if (toolCall.toolName === "createComment") {
            createComment({
                targetText: toolCall.input.targetText,
                comment: toolCall.input.comment,
                view: $editorView,
            });
        } else if (toolCall.toolName === "createSuggestion") {
            createSuggestion({
                targetText: toolCall.input.targetText,
                replacements: toolCall.input.replacements,
                comment: toolCall.input.comment,
                state: $editorView.state,
                dispatch: $editorView.dispatch,
            });
        }
    }

    // TODO: well... should the system message update
    // upon the update of the documentContent or the selectedtext?
    // No, right?
    const chat = new Chat({
        transport: new DefaultChatTransport({
            api: "/api/feedback",
            body: {
                documentContent: $documentContent,
                selectedText: $selectedText,
            },
        }),
        onToolCall: handleToolCall,
    });

    function handleSubmit(event: SubmitEvent) {
        event.preventDefault();
        if (!input.trim() || chat.status !== "ready") return;

        chat.sendMessage({ text: input });
        input = "";
    }

    function askForFeedback() {
        const context = $selectedText
            ? `Please provide feedback on this selected text: "${$selectedText}"`
            : "Please provide feedback on my document.";

        input = context;
        chat.sendMessage({ text: context });
    }
</script>

<div class="flex-1 flex flex-col min-h-0">
    <!-- Quick actions -->
    <div
        class="p-3 sm:p-4 border-b border-gray-200 bg-gradient-to-b from-green-50 to-white"
    >
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
    <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        {#each chat.messages as message, messageIndex (messageIndex)}
            {#each message.parts as part, partIndex (partIndex)}
                {#if part.type === "text"}
                    {@const rendered = renderMarkdown(part.text)}
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
                                {@html rendered}
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
    <div class="border-t border-gray-200 p-3 sm:p-4 bg-white">
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
