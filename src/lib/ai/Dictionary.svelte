<!--
    Dictionary.svelte — Dictionary and thesaurus panel (teal theme).

    Two lookup modes:
      1. Word lookup — uses the Free Dictionary API (no key, no cost) to
         fetch definitions, synonyms, antonyms, and examples.
      2. Free-form describe — describe a concept and AI finds the word.
         Only this mode uses the AI, since it's genuinely generative.

    The selected text from the editor is auto-populated into the input
    when present, letting writers instantly look up any highlighted word.

    Dependencies: chatFactory (AI describe mode only), stores (selectedText),
    posthog.
-->
<script lang="ts">
import { selectedText } from "$lib/stores";
import { createAiChat, setAiProcessing } from "$lib/ai/chatFactory";
import { renderMarkdown } from "$lib/ai/utils";
import posthog from "$lib/posthog";

// ── Types ──────────────────────────────────────────────────────────────

interface Phonetic {
    text?: string;
    audio?: string;
}

interface Definition {
    definition: string;
    example?: string;
    synonyms: string[];
    antonyms: string[];
}

interface Meaning {
    partOfSpeech: string;
    definitions: Definition[];
    synonyms: string[];
    antonyms: string[];
}

interface DictEntry {
    word: string;
    phonetic?: string;
    phonetics: Phonetic[];
    meanings: Meaning[];
}

// ── State ──────────────────────────────────────────────────────────────

let input = $state("");
let mode = $state<"lookup" | "describe">("lookup");

// Lookup mode state
let lookupResult = $state<DictEntry[] | null>(null);
let lookupError = $state<string | null>(null);
let lookupLoading = $state(false);

// Describe mode state (AI)
const { chat, clearChat: clearAiChat } = createAiChat({ mode: "dictionary" });

$effect(() => {
    setAiProcessing(
        lookupLoading ||
        chat.status === "submitted" ||
        chat.status === "streaming",
    );
});

// Auto-fill from editor selection
$effect(() => {
    if ($selectedText && mode === "lookup") {
        const trimmed = $selectedText.trim();
        if (trimmed.length > 0 && trimmed.length <= 60 && !trimmed.includes("\n")) {
            input = trimmed;
        }
    }
});

// ── Lookup (Free Dictionary API) ───────────────────────────────────────

async function lookupWord(word: string) {
    lookupLoading = true;
    lookupError = null;
    lookupResult = null;
    try {
        const res = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        );
        if (res.status === 404) {
            lookupError = `No results found for "${word}". Try a different spelling.`;
            return;
        }
        if (!res.ok) {
            lookupError = "Dictionary service unavailable. Try again later.";
            return;
        }
        lookupResult = (await res.json()) as DictEntry[];
    } catch {
        lookupError = "Could not reach the dictionary. Check your connection.";
    } finally {
        lookupLoading = false;
    }
}

// Collect all unique synonyms/antonyms across meanings
function collectSynonyms(entries: DictEntry[]): string[] {
    const all = new Set<string>();
    for (const entry of entries) {
        for (const meaning of entry.meanings) {
            for (const s of meaning.synonyms) all.add(s);
            for (const def of meaning.definitions) {
                for (const s of def.synonyms) all.add(s);
            }
        }
    }
    return [...all].slice(0, 12);
}

function collectAntonyms(entries: DictEntry[]): string[] {
    const all = new Set<string>();
    for (const entry of entries) {
        for (const meaning of entry.meanings) {
            for (const a of meaning.antonyms) all.add(a);
            for (const def of meaning.definitions) {
                for (const a of def.antonyms) all.add(a);
            }
        }
    }
    return [...all].slice(0, 8);
}

function getPhonetic(entry: DictEntry): string {
    if (entry.phonetic) return entry.phonetic;
    return entry.phonetics.find((p) => p.text)?.text ?? "";
}

// ── Handlers ───────────────────────────────────────────────────────────

function clearAll() {
    lookupResult = null;
    lookupError = null;
    clearAiChat();
    input = "";
}

const isLoading = $derived(lookupLoading || chat.status === "submitted" || chat.status === "streaming");
const hasResults = $derived(
    lookupResult !== null || lookupError !== null || chat.messages.length > 0,
);

async function handleSubmit(event: Event) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    posthog.capture("dictionary_lookup", {
        mode,
        input_length: trimmed.length,
        has_selection: !!$selectedText,
    });

    if (mode === "lookup") {
        await lookupWord(trimmed);
        input = "";
    } else {
        chat.sendMessage({ text: `I'm looking for a word that means: ${trimmed}` });
        input = "";
    }
}

function lookupChip(word: string) {
    input = word;
    lookupWord(word);
    posthog.capture("dictionary_chip_lookup", { word });
}
</script>

<div class="flex flex-col h-full">
    <!-- Clear row -->
    {#if hasResults}
        <div class="flex justify-end px-3 pt-2 shrink-0">
            <button
                onclick={clearAll}
                title="Clear results"
                class="text-[10px] text-black/30 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50"
            >Clear</button>
        </div>
    {/if}

    <!-- Results -->
    <div class="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">

        <!-- Lookup mode results -->
        {#if mode === "lookup"}
            {#if lookupLoading}
                <div class="flex justify-start">
                    <div class="bg-gray-100 text-gray-800 px-3 py-2 rounded-lg">
                        <div class="flex items-center space-x-2">
                            <span class="inline-block animate-pulse">●</span>
                            <span class="text-sm">Looking up...</span>
                        </div>
                    </div>
                </div>
            {:else if lookupError}
                <div class="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm border border-red-200">
                    {lookupError}
                </div>
            {:else if lookupResult}
                {@const entry = lookupResult[0]}
                {@const phonetic = getPhonetic(entry)}
                {@const synonyms = collectSynonyms(lookupResult)}
                {@const antonyms = collectAntonyms(lookupResult)}

                <div class="space-y-3">
                    <!-- Word + phonetic -->
                    <div>
                        <h2 class="text-base font-semibold text-gray-900">{entry.word}</h2>
                        {#if phonetic}
                            <p class="text-xs text-gray-400 font-mono">{phonetic}</p>
                        {/if}
                    </div>

                    <!-- Meanings -->
                    {#each entry.meanings.slice(0, 3) as meaning}
                        <div class="space-y-1">
                            <p class="text-[10px] font-semibold uppercase tracking-wider text-teal-600">
                                {meaning.partOfSpeech}
                            </p>
                            {#each meaning.definitions.slice(0, 2) as def, i}
                                <p class="text-sm text-gray-700 leading-snug">
                                    <span class="text-gray-400 text-xs mr-1">{i + 1}.</span>{def.definition}
                                </p>
                                {#if def.example}
                                    <p class="text-xs text-gray-400 italic pl-3">"{def.example}"</p>
                                {/if}
                            {/each}
                        </div>
                    {/each}

                    <!-- Synonyms -->
                    {#if synonyms.length > 0}
                        <div>
                            <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Synonyms</p>
                            <div class="flex flex-wrap gap-1">
                                {#each synonyms as syn}
                                    <button
                                        onclick={() => lookupChip(syn)}
                                        class="px-2 py-0.5 text-xs bg-teal-50 text-teal-700 rounded-full border border-teal-100 hover:bg-teal-100 transition-colors"
                                    >{syn}</button>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    <!-- Antonyms -->
                    {#if antonyms.length > 0}
                        <div>
                            <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Antonyms</p>
                            <div class="flex flex-wrap gap-1">
                                {#each antonyms as ant}
                                    <button
                                        onclick={() => lookupChip(ant)}
                                        class="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full border border-gray-200 hover:bg-gray-200 transition-colors"
                                    >{ant}</button>
                                {/each}
                            </div>
                        </div>
                    {/if}
                </div>
            {:else}
                <!-- Empty state -->
                <div class="flex flex-col items-center justify-center h-full gap-3 text-gray-400 pt-4">
                    <p class="text-sm text-center px-4">
                        {#if $selectedText && $selectedText.trim().length <= 60 && !$selectedText.includes("\n")}
                            Ready to look up <span class="text-teal-600 font-medium">"{$selectedText.trim()}"</span>
                        {:else}
                            Select a word in your document, or type below
                        {/if}
                    </p>
                </div>
            {/if}

        <!-- Describe mode results (AI) -->
        {:else}
            {#each chat.messages as message (message.id)}
                {#each message.parts as part, partIndex (partIndex)}
                    {#if part.type === "text"}
                        {@const renderPromise = renderMarkdown(part.text)}
                        <div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
                            <div class="max-w-[85%]">
                                <div class="px-3 py-2 rounded-lg {message.role === 'user' ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-800'}">
                                    <div class="prose prose-sm max-w-none {message.role === 'user' ? 'prose-invert' : ''} [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
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

            {#if chat.status === "streaming" || chat.status === "submitted"}
                <div class="flex justify-start">
                    <div class="bg-gray-100 text-gray-800 px-3 py-2 rounded-lg">
                        <div class="flex items-center space-x-2">
                            <span class="inline-block animate-pulse">●</span>
                            <span class="text-sm">Finding words...</span>
                        </div>
                    </div>
                </div>
            {/if}

            {#if chat.error}
                <div class="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm border border-red-200">
                    {chat.error.message ?? "An error occurred. Please try again."}
                </div>
            {/if}

            {#if chat.messages.length === 0 && !chat.error}
                <div class="flex items-center justify-center h-full pt-4">
                    <p class="text-sm text-center text-gray-400 px-4">
                        Describe the concept, feeling, or idea — AI will suggest the right word
                    </p>
                </div>
            {/if}
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
                disabled={isLoading}
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
                autocomplete="off"
            />
            <button
                type="submit"
                disabled={isLoading || !input.trim()}
                class="w-full py-2 bg-teal-500 text-white text-sm font-medium rounded-md hover:bg-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                {mode === "lookup" ? "Look up" : "Find word"}
            </button>
        </form>
        {#if mode === "lookup"}
            <p class="text-[10px] text-black/30 text-center mt-1.5">Powered by Free Dictionary API</p>
        {:else}
            <p class="text-[10px] text-black/30 text-center mt-1.5">Uses AI — costs tokens</p>
        {/if}
    </div>
</div>
