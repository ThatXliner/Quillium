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
    // XXX: see Feedback.svelte
    const chat = new Chat({
        transport: new DefaultChatTransport({
            api: "/api/revise",
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

    function reviseText() {
        const context = $selectedText
            ? `Please revise and rewrite this selected text to improve flow and conciseness: "${$selectedText}"`
            : "Please revise my document to improve flow and conciseness.";

        input = context;
        chat.sendMessage({ text: context });
    }

    const quickPrompts = [
        "Make this more concise",
        "Improve the flow and transitions",
        "Make this more engaging",
        "Fix grammar and style issues",
        "Simplify complex sentences",
    ];

    function useQuickPrompt(prompt: string) {
        const target = $selectedText ? "this selected text" : "my document";
        const message = `${prompt} in ${target}`;
        input = message;
        chat.sendMessage({ text: message });
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
                onclick={reviseText}
                disabled={chat.status !== "ready" || !$documentContent}
                class="w-full p-2 text-left bg-purple-50 hover:bg-purple-100 rounded border border-purple-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <div class="text-sm font-medium text-purple-900">
                    {$selectedText ? "Revise selection" : "Revise document"}
                </div>
            </button>

            <!-- Quick prompts -->
            <div class="grid grid-cols-1 gap-1">
                {#each quickPrompts as prompt}
                    <button
                        onclick={() => useQuickPrompt(prompt)}
                        disabled={chat.status !== "ready" || !$documentContent}
                        class="p-1.5 text-xs text-left bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {prompt}
                    </button>
                {/each}
            </div>
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
                        ? 'bg-purple-500 text-white'
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
                    <div class="text-sm">Revising...</div>
                </div>
            </div>
        {/if}
    </div>

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
                class="w-full py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
                Revise
            </button>
            {#if $selectedText}
                <div
                    class="text-xs bg-yellow-50 p-2 rounded border border-yellow-200"
                >
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
        </form>
        <!-- {#if $selectedText}
            <div class="mt-2 text-xs text-gray-500">
                Selected: "{$selectedText.slice(0, 50)}{$selectedText.length >
                50
                    ? "..."
                    : ""}"
            </div>
        {/if} -->
    </div>
</div>
