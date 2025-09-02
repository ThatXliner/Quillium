<script lang="ts">
    import { selectedText, documentContent, editorView } from "$lib/stores";
    import {
        createComment,
        createSuggestion,
    } from "$lib/editor/plugins/annotations";
    import { Chat } from "@ai-sdk/svelte";
    import { DefaultChatTransport } from "ai";
    import { renderMarkdown } from "$lib/ai/utils";

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
    <!-- Quick actions -->
    <div
        class="p-3 sm:p-4 border-b border-gray-200 bg-gradient-to-b from-purple-50 to-white"
    >
        <button
            onclick={reviseText}
            disabled={chat.status !== "ready" || !$documentContent}
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
            {#each quickPrompts as prompt}
                <button
                    onclick={() => useQuickPrompt(prompt)}
                    disabled={chat.status !== "ready" || !$documentContent}
                    class="px-2 py-1.5 text-xs bg-white hover:bg-purple-50 rounded border border-purple-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                    {prompt}
                </button>
            {/each}
        </div>
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
                                ? 'bg-purple-500 text-white'
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
                            <span class="text-sm">Revising...</span>
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        {#if chat.messages.length === 0}
            <div
                class="flex-1 flex items-center justify-center text-gray-400 text-sm"
            >
                Click "Revise" or choose a quick action to start
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
                placeholder="Describe how to revise..."
                disabled={chat.status !== "ready"}
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={chat.status !== "ready" || !input.trim()}
                class="w-full py-2 bg-purple-500 text-white text-sm font-medium rounded-md hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                Revise
            </button>
        </form>
    </div>
</div>
