<script lang="ts">
    import { selectedText, documentContent, editorView } from "$lib/stores";
    import {
        createComment,
        createSuggestion,
    } from "$lib/editor/plugins/annotations";
    import { Chat } from "@ai-sdk/svelte";
    import { DefaultChatTransport } from "ai";

    let input = $state("");

    function handleToolCall(toolCall: any) {
        if (!$editorView) return;
        console.log(toolCall);
        if (toolCall.toolName === "createComment") {
            createComment({
                targetText: toolCall.args.targetText,
                comment: toolCall.args.comment,
                view: $editorView,
            });
        } else if (toolCall.toolName === "createSuggestion") {
            createSuggestion({
                targetText: toolCall.args.targetText,
                replacements: toolCall.args.replacements,
                comment: toolCall.args.comment,
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
    <!-- Context info -->
    <div class="p-4 border-b border-gray-200 bg-gray-50">
        <div class="text-sm text-gray-600 space-y-2">
            <div>
                Document: {$documentContent
                    ? `${$documentContent.length} characters`
                    : "No content"}
            </div>
            {#if $selectedText}
                <div class="bg-yellow-50 p-2 rounded border border-yellow-200">
                    <div class="font-medium text-yellow-800">
                        Selected text:
                    </div>
                    <div class="text-yellow-700 text-xs">
                        "{$selectedText.slice(0, 100)}{$selectedText.length >
                        100
                            ? "..."
                            : ""}"
                    </div>
                </div>
            {/if}
        </div>

        <!-- Quick actions -->
        <div class="mt-3 space-y-2">
            <button
                onclick={askForFeedback}
                disabled={chat.status !== "ready" || !$documentContent}
                class="w-full p-2 text-left bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <div class="text-sm font-medium text-blue-900">
                    {$selectedText
                        ? "Get feedback on selection"
                        : "Get general feedback"}
                </div>
            </button>
        </div>
    </div>

    <!-- Chat messages -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
        {#each chat.messages as message, messageIndex (messageIndex)}
            <div
                class="flex {message.role === 'user'
                    ? 'justify-end'
                    : 'justify-start'}"
            >
                <div
                    class="max-w-xs lg:max-w-md px-3 py-2 rounded-lg {message.role ===
                    'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 text-gray-800'}"
                >
                    <div class="text-sm whitespace-pre-wrap">
                        {#each message.parts as part, partIndex (partIndex)}
                            {#if part.type === "text"}
                                {part.text}
                            {/if}
                        {/each}
                    </div>
                </div>
            </div>
        {/each}

        {#if chat.status === "streaming"}
            <div class="flex justify-start">
                <div class="bg-gray-200 text-gray-800 px-3 py-2 rounded-lg">
                    <div class="text-sm">Analyzing...</div>
                </div>
            </div>
        {/if}
    </div>

    <!-- Input -->
    <form onsubmit={handleSubmit} class="p-4 border-t border-gray-200">
        <div class="flex space-x-2">
            <input
                bind:value={input}
                name="message"
                placeholder="Ask a specific question about your writing..."
                disabled={chat.status !== "ready"}
                class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={chat.status !== "ready" || !input.trim()}
                class="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                Send
            </button>
        </div>
    </form>
</div>
