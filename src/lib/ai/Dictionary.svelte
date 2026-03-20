<!--
    Dictionary.svelte — Dictionary and thesaurus AI panel (teal theme).

    Two lookup modes:
      1. Word lookup — select a word in the editor, click "Look up" or
         type the word to look up its definition and synonyms.
      2. Free-form describe — describe a concept and AI finds the word.

    The selected text from the editor is auto-populated into the input
    when present, letting writers instantly look up any highlighted word.

    Dependencies: chatFactory (createAiChat), utils (renderMarkdown),
    stores (selectedText), posthog.
-->
<script lang="ts">
import { selectedText } from "$lib/stores";
import { renderMarkdown } from "$lib/ai/utils";
import { createAiChat, setAiProcessing } from "$lib/ai/chatFactory";
import posthog from "$lib/posthog";

let input = $state("");
let mode = $state<"lookup" | "describe">("lookup");
const { chat, clearChat } = createAiChat({ mode: "dictionary" });

// When the user selects text in the editor, pre-fill the input
// so they can look it up with one click.
$effect(() => {
    if ($selectedText && mode === "lookup") {
        // Only auto-fill single words or short phrases (not whole sentences)
        const trimmed = $selectedText.trim();
        if (trimmed.length > 0 && trimmed.length <= 60 && !trimmed.includes("\n")) {
            input = trimmed;
        }
    }
});

$effect(() => {
    setAiProcessing(chat.status === "submitted" || chat.status === "streaming");
});

function handleSubmit(event: Event) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || chat.status !== "ready") return;

    const prompt =
        mode === "lookup"
            ? `Look up: ${trimmed}`
            : `I'm looking for a word that means: ${trimmed}`;

    posthog.capture("dictionary_lookup", {
        mode,
        input_length: trimmed.length,
        has_selection: !!$selectedText,
    });

    chat.sendMessage({ text: prompt });
    input = "";
}

const quickLookups = [
    "synonyms for this word",
    "antonyms for this word",
    "more formal alternatives",
    "more vivid alternatives",
];

function useQuickPrompt(prompt: string) {
    const word = $selectedText?.trim() || "";
    const text = word ? `${prompt} for "${word}"` : prompt;
    posthog.capture("dictionary_quick_lookup", { prompt });
    chat.sendMessage({ text });
}
</script>

<div class="flex flex-col h-full">
    <!-- Clear row -->
    {#if chat.messages.length > 0}
        <div class="flex justify-end px-3 pt-2 shrink-0">
            <button
                onclick={clearChat}
                title="Clear results"
                class="text-[10px] text-black/30 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50"
            >Clear</button>
        </div>
    {/if}

    <!-- Results -->
    <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        {#each chat.messages as message (message.id)}
            {#each message.parts as part, partIndex (partIndex)}
                {#if part.type === "text"}
                    {@const renderPromise = renderMarkdown(part.text)}
                    <div
                        class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}"
                    >
                        <div
                            class="relative max-w-[85%] sm:max-w-[75%] lg:max-w-[70%]"
                        >
                            <div
                                class="px-3 py-2 rounded-lg {message.role === 'user'
                                    ? 'bg-teal-500 text-white'
                                    : 'bg-gray-100 text-gray-800'}"
                            >
                                <div
                                    class="prose prose-sm max-w-none {message.role === 'user'
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
                            <span class="text-sm">Looking up...</span>
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        {#if chat.error}
            <div class="flex justify-start">
                <div class="max-w-[85%] sm:max-w-[75%] lg:max-w-[70%]">
                    <div
                        class="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm border border-red-200"
                    >
                        {chat.error.message ?? "An error occurred. Please try again."}
                    </div>
                </div>
            </div>
        {/if}

        {#if chat.messages.length === 0 && !chat.error}
            <div class="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
                <p class="text-sm text-center px-4">
                    {#if $selectedText && $selectedText.trim().length <= 60 && !$selectedText.includes("\n")}
                        Ready to look up <span class="text-teal-600 font-medium">"{$selectedText.trim()}"</span>
                    {:else}
                        Select a word in your document, or type a word or description below
                    {/if}
                </p>
                {#if $selectedText}
                    <div class="flex flex-wrap justify-center gap-1.5 px-3">
                        {#each quickLookups as prompt}
                            <button
                                onclick={() => useQuickPrompt(prompt)}
                                disabled={chat.status !== "ready"}
                                class="px-2 py-1 text-xs bg-white hover:bg-teal-50 rounded border border-teal-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-teal-700"
                            >
                                {prompt}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    </div>

    <!-- Input -->
    <div class="border-t border-black/10 p-3 bg-white/30 shrink-0">
        <!-- Mode toggle -->
        <div class="flex mb-2 rounded-md overflow-hidden border border-black/10 text-xs">
            <button
                onclick={() => (mode = "lookup")}
                class="flex-1 py-1 transition-colors
                    {mode === 'lookup'
                        ? 'bg-teal-500 text-white font-medium'
                        : 'bg-white/60 text-black/50 hover:bg-white/80'}"
            >
                Look up word
            </button>
            <button
                onclick={() => (mode = "describe")}
                class="flex-1 py-1 transition-colors
                    {mode === 'describe'
                        ? 'bg-teal-500 text-white font-medium'
                        : 'bg-white/60 text-black/50 hover:bg-white/80'}"
            >
                Describe &rarr; find word
            </button>
        </div>

        {#if $selectedText && mode === "lookup"}
            <div class="mb-2 text-xs bg-yellow-50 px-2 py-1.5 rounded border border-yellow-200">
                <span class="text-yellow-700">
                    Selected: "{$selectedText.slice(0, 50)}{$selectedText.length > 50 ? "..." : ""}"
                </span>
            </div>
        {/if}

        <form onsubmit={handleSubmit} class="flex flex-col gap-2">
            <input
                bind:value={input}
                name="query"
                placeholder={mode === "lookup"
                    ? "Enter a word to look up..."
                    : "Describe the concept, feeling, or idea..."}
                disabled={chat.status !== "ready"}
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={chat.status !== "ready" || !input.trim()}
                class="w-full py-2 bg-teal-500 text-white text-sm font-medium rounded-md hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                {mode === "lookup" ? "Look up" : "Find word"}
            </button>
        </form>
    </div>
</div>
