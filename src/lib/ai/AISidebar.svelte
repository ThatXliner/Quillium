<script lang="ts">
    import Chat from "./Chat.svelte";
    import Feedback from "./Feedback.svelte";
    import Revise from "./Revise.svelte";
    import { selectedText, documentContent } from "$lib/stores";

    type Action = null | "chat" | "feedback" | "revise";
    let action = $state<Action>(null);

    function startChat() {
        action = "chat";
    }

    function provideFeedback() {
        action = "feedback";
    }

    function reword() {
        action = "revise";
    }

    function goBack() {
        action = null;
    }
</script>

<div
    class="h-screen overflow-y-scroll sticky top-0 flex flex-col border-r border-gray-200 bg-white"
>
    {#if action === null}
        <!-- Main menu -->
        <div class="p-4 border-b border-gray-200">
            <h2 class="text-lg font-semibold text-gray-900 mb-4">
                AI Assistant
            </h2>

            <div class="space-y-3">
                <button
                    onclick={startChat}
                    class="w-full p-3 text-left bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                >
                    <div class="font-medium text-blue-900">Chat with AI</div>
                    <div class="text-sm text-blue-600">
                        Ask questions about your document
                    </div>
                </button>

                <button
                    onclick={provideFeedback}
                    class="w-full p-3 text-left bg-green-50 hover:bg-green-100 rounded-lg border border-green-200 transition-colors"
                >
                    <div class="font-medium text-green-900">Get Feedback</div>
                    <div class="text-sm text-green-600">
                        Receive suggestions for improvement
                    </div>
                </button>

                <button
                    onclick={reword}
                    class="w-full p-3 text-left bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors"
                >
                    <div class="font-medium text-purple-900">
                        Revise & Rewrite
                    </div>
                    <div class="text-sm text-purple-600">
                        Improve flow and conciseness
                    </div>
                </button>
            </div>
        </div>

        <!-- Context info -->
        <div class="p-4">
            <div class="text-xs text-gray-500 space-y-2">
                <div>
                    Document: {$documentContent
                        ? `${$documentContent.length} characters`
                        : "No content"}
                </div>
                {#if $selectedText}
                    <div
                        class="bg-yellow-50 p-2 rounded border border-yellow-200"
                    >
                        <div class="font-medium text-yellow-800">Selected:</div>
                        <div class="text-yellow-700">
                            "{$selectedText.slice(
                                0,
                                100,
                            )}{$selectedText.length > 100 ? "..." : ""}"
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    {:else if action === "chat"}
        <!-- Chat interface -->
        <div class="flex items-center p-4 border-b border-gray-200">
            <button
                onclick={goBack}
                class="mr-3 text-gray-500 hover:text-gray-700"
            >
                ← Back
            </button>
            <h2 class="text-lg font-semibold text-gray-900">AI Chat</h2>
        </div>
        <div class="flex-1 flex flex-col min-h-0">
            <Chat />
        </div>
    {:else if action === "feedback"}
        <!-- Feedback interface -->
        <div class="flex items-center p-4 border-b border-gray-200">
            <button
                onclick={goBack}
                class="mr-3 text-gray-500 hover:text-gray-700"
            >
                ← Back
            </button>
            <h2 class="text-lg font-semibold text-gray-900">Feedback</h2>
        </div>
        <div class="flex-1 flex flex-col min-h-0">
            <Feedback />
        </div>
    {:else if action === "revise"}
        <!-- Revise interface -->
        <div class="flex items-center p-4 border-b border-gray-200">
            <button
                onclick={goBack}
                class="mr-3 text-gray-500 hover:text-gray-700"
            >
                ← Back
            </button>
            <h2 class="text-lg font-semibold text-gray-900">Revise</h2>
        </div>
        <div class="flex-1 flex flex-col min-h-0">
            <Revise />
        </div>
    {/if}
</div>
