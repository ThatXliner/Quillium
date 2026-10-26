<script lang="ts">
import { abortError, linkAbortSignals, raceWithAbort } from "$lib/abort";
import { createAiChat, useAiChatEffects } from "$lib/ai/chatFactory";
import { generateDictionaryEntry } from "$lib/ai/clientStreams";
import {
    aiSettings,
    beginAiTask,
    endAiTask,
    ensureApiKeyLoaded,
    getAiAbortSignal,
    hasApiKey,
} from "$lib/ai/settings.svelte";
import { renderMarkdown } from "$lib/ai/utils";
import { appEventBus } from "$lib/events/appEventBus";
import { capture } from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import { editorView, selectedText } from "$lib/stores";
import { Transaction } from "@codemirror/state";
import { ExternalLinkIcon, XIcon } from "lucide-svelte";
import { onDestroy } from "svelte";
import { get } from "svelte/store";
import {
    type DictionaryEntry,
    dictionaryErrorMessage,
    dictionaryUnavailableMessage,
    normalizeDictionaryData,
} from "./dictionaryUtils";

// ── State ──────────────────────────────────────────────────────

type LookupState =
    | { status: "loading" }
    | { status: "found"; entry: DictionaryEntry }
    | { status: "empty" }
    | { status: "unavailable"; message: string }
    | { status: "error"; message: string };

let visible = $state(false);
let word = $state("");
let selFrom = $state(0);
let selTo = $state(0);
let centerX = $state(0);
let centerY = $state(0);
let posX = $state(0);
let posY = $state(0);

let popoverEl = $state<HTMLDivElement | undefined>();

const MAIN_LOOKUP_ID = 0;
let lookup = $state<LookupState>({ status: "loading" });

type StackedLookup = {
    id: number;
    word: string;
    posX: number;
    posY: number;
    lookup: LookupState;
};

let stackedLookups = $state<StackedLookup[]>([]);
let nextStackedLookupId = 1;

const lookupControllers = new Map<number, AbortController>();

// Describe mode (AI)
let describeInput = $state("");
const { chat, clearChat } = createAiChat({ mode: "dictionary" });

// Wire up processing indicator + global stop listener.
useAiChatEffects(chat, "dictionary");

function canUseAi(): boolean {
    return appSettings.aiEnabled && hasApiKey();
}

// ── React to bus events ────────────────────────────────────────

$effect(() => {
    return appEventBus.on("dictionary-open", (event) => {
        cancelAll();
        word = event.word;
        anchorWord = event.word;
        selFrom = event.selectionFrom;
        selTo = event.selectionTo;
        centerX = event.x;
        centerY = event.y;
        visible = true;
        stackedLookups = [];
        describeInput = "";
        clearChat();
        lookupMainWord();
    });
});

onDestroy(cancelAll);

// The word the editor selection was on when the popover opened.
// Updated only on fresh triggers, not chip lookups, so the auto-dismiss
// doesn't fire when the user clicks an antonym/synonym chip.
let anchorWord = $state("");

// Close when the editor selection moves away from the original word.
$effect(() => {
    if (visible && ($selectedText ?? "").trim() !== anchorWord) {
        dismiss();
    }
});

// ── Position clamping ──────────────────────────────────────────

$effect(() => {
    if (!visible || !popoverEl) return;
    // Read centerX/centerY (reactive triggers) but compute posX/posY
    // idempotently so the effect doesn't re-trigger itself.
    const cx = centerX;
    const cy = centerY;
    requestAnimationFrame(() => {
        if (!popoverEl) return;
        const w = popoverEl.clientWidth;
        const h = popoverEl.clientHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        posX = Math.min(Math.max(cx - w / 2, 8), vw - w - 8);
        posY = Math.min(cy, vh - h - 8);
    });
});

// ── Dismiss ────────────────────────────────────────────────────

function cancelAll() {
    for (const controller of lookupControllers.values()) controller.abort();
    lookupControllers.clear();
    if (chat.status === "submitted" || chat.status === "streaming") chat.stop();
}

function dismiss() {
    visible = false;
    cancelAll();
    stackedLookups = [];
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && visible) dismiss();
}

async function fetchLookup(w: string, signal: AbortSignal): Promise<LookupState> {
    const unavailable = dictionaryUnavailableMessage(appSettings.aiEnabled, hasApiKey());
    if (unavailable) return { status: "unavailable", message: unavailable };

    const task = beginAiTask("dictionary-lookup");
    const cancelled = () => abortError("Dictionary lookup cancelled.", "AbortError");
    const requestSettings = {
        provider: aiSettings.provider,
        model: aiSettings.model,
        baseURL: aiSettings.baseURL,
    };
    try {
        // Race both steps: a pending keychain prompt or a transport that ignores
        // the signal must not hold a dismissed or stopped card open.
        await raceWithAbort(ensureApiKeyLoaded(), signal, cancelled);
        const unavailable = dictionaryUnavailableMessage(appSettings.aiEnabled, hasApiKey());
        if (unavailable) return { status: "unavailable", message: unavailable };
        if (
            aiSettings.provider !== requestSettings.provider ||
            aiSettings.model !== requestSettings.model ||
            aiSettings.baseURL !== requestSettings.baseURL
        ) {
            return { status: "error", message: "AI settings changed. Try again." };
        }
        signal.throwIfAborted();
        const request = generateDictionaryEntry({
            word: w,
            ...requestSettings,
            apiKey: aiSettings.apiKey,
            abortSignal: signal,
        });
        const data = await raceWithAbort(request, signal, cancelled);
        signal.throwIfAborted();
        const entry = normalizeDictionaryData(w, data);
        return entry ? { status: "found", entry } : { status: "empty" };
    } catch (error) {
        if (signal.aborted) return { status: "error", message: "Lookup stopped." };
        return { status: "error", message: dictionaryErrorMessage(error, requestSettings.provider) };
    } finally {
        endAiTask(task);
    }
}

async function runLookup(id: number, w: string, apply: (state: LookupState) => void) {
    lookupControllers.get(id)?.abort();
    const controller = new AbortController();
    lookupControllers.set(id, controller);
    apply({ status: "loading" });

    const linked = linkAbortSignals([getAiAbortSignal(), controller.signal]);
    try {
        const state = await fetchLookup(w, linked.signal);
        if (lookupControllers.get(id) !== controller) return;
        lookupControllers.delete(id);
        apply(state);
    } finally {
        linked.cleanup();
    }
}

function lookupMainWord() {
    void runLookup(MAIN_LOOKUP_ID, word, (state) => {
        lookup = state;
    });
}

function lookupStackedWord(id: number, w: string) {
    void runLookup(id, w, (state) => {
        const card = stackedLookups.find((item) => item.id === id);
        if (card) card.lookup = state;
    });
}

function openAiSettings() {
    appEventBus.emit({ type: "ai-open-settings" });
    dismiss();
}

// ── Actions ────────────────────────────────────────────────────

function replaceWith(synonym: string) {
    const view = get(editorView);
    if (!view) return;
    view.dispatch({
        changes: { from: selFrom, to: selTo, insert: synonym },
        selection: { anchor: selFrom + synonym.length },
        annotations: Transaction.addToHistory.of(true),
    });
    capture("dictionary_synonym_replaced", { synonym });
    dismiss();
}

function openStackedLookup(w: string, event: MouseEvent) {
    const target = event.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const popoverWidth = 320;
    const xFromRight = rect ? rect.right + 8 : centerX + 24;
    const xFromLeft = rect ? rect.left - popoverWidth - 8 : centerX - popoverWidth - 24;
    const posX =
        xFromRight + popoverWidth <= window.innerWidth - 8 ? xFromRight : Math.max(8, xFromLeft);
    const posY = Math.min(Math.max(rect?.top ?? centerY, 8), window.innerHeight - 360);
    const id = nextStackedLookupId++;
    stackedLookups = [
        ...stackedLookups,
        { id, word: w, posX, posY, lookup: { status: "loading" } },
    ];
    lookupStackedWord(id, w);
    capture("dictionary_chip_lookup", { word: w });
}

function closeStackedLookup(id: number) {
    lookupControllers.get(id)?.abort();
    lookupControllers.delete(id);
    stackedLookups = stackedLookups.filter((item) => item.id !== id);
}

function openInChat() {
    let msg: string;
    if (chat.messages.length > 0) {
        // Carry over the describe→find word conversation
        const history = chat.messages
            .map((m) => {
                const text = m.parts.find((p) => p.type === "text")?.text ?? "";
                return m.role === "user" ? `User: ${text}` : `Assistant: ${text}`;
            })
            .join("\n");
        msg = `I was looking for a word. Here's the conversation so far:\n${history}\n\nCan you help me continue?`;
    } else {
        const def =
            lookup.status === "found"
                ? (lookup.entry.meanings[0]?.definitions[0]?.definition ?? "")
                : "";
        msg = def
            ? `Tell me more about the word "${word}": ${def}`
            : `Tell me more about the word "${word}"`;
    }
    appEventBus.emit({ type: "ai-open-chat", message: msg });
    capture("dictionary_open_in_chat", {
        word,
        has_describe_history: chat.messages.length > 0,
    });
    dismiss();
}

async function handleDescribeSubmit(e: Event) {
    e.preventDefault();
    const trimmed = describeInput.trim();
    if (!trimmed || !canUseAi() || chat.status !== "ready") return;
    capture("dictionary_describe_lookup", { input_length: trimmed.length });
    chat.sendMessage({ text: `I'm looking for a word that means: ${trimmed}` });
    describeInput = "";
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet lookupBody(state: LookupState, lookupWord: string, retry: () => void, exploreHint: boolean)}
    {#if state.status === "loading"}
        <div class="flex items-center gap-2 text-gray-400 text-sm py-2">
            <span class="animate-pulse">●</span>
            <span>Looking up...</span>
        </div>
    {:else if state.status === "unavailable"}
        <div class="space-y-1.5">
            <p class="text-sm text-gray-500">{state.message}</p>
            {#if appSettings.aiEnabled}
                <button
                    onclick={openAiSettings}
                    class="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                >Open AI Settings</button>
            {/if}
        </div>
    {:else if state.status === "empty"}
        <p class="text-sm text-gray-500">No definition found for "{lookupWord}".</p>
    {:else if state.status === "error"}
        <div class="space-y-1.5">
            <p class="text-sm text-gray-500">{state.message}</p>
            <button
                onclick={retry}
                class="text-xs font-medium text-teal-700 transition-colors hover:text-teal-800 hover:underline"
            >Try again</button>
        </div>
    {:else}
        {@const entry = state.entry}

            {#each entry.meanings as meaning}
            <div class="space-y-1">
                <p class="text-[10px] font-semibold uppercase tracking-wider text-teal-600">
                    {meaning.partOfSpeech}
                </p>
                {#each meaning.definitions as def, i}
                    <p class="text-xs text-gray-700 leading-snug">
                        <span class="text-gray-400 mr-1">{i + 1}.</span>{def.definition}
                    </p>
                    {#if def.example}
                        <p class="text-[11px] text-gray-400 italic pl-3">"{def.example}"</p>
                    {/if}
                {/each}
            </div>
        {/each}

            {#if entry.synonyms.length > 0}
            <div>
                <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Synonyms
                    {#if exploreHint}
                        <span class="font-normal normal-case tracking-normal text-gray-300">· click to explore</span>
                    {/if}
                </p>
                <div class="flex flex-wrap gap-1 w-full">
                    {#each entry.synonyms as syn}
                        <button
                            onclick={(e) => openStackedLookup(syn, e)}
                            class="px-2 py-0.5 text-xs bg-teal-50 text-teal-700 rounded-full border border-teal-100 hover:bg-teal-500 hover:text-white hover:border-teal-500 transition-colors"
                        >{syn}</button>
                    {/each}
                </div>
            </div>
        {/if}

            {#if entry.antonyms.length > 0}
            <div>
                <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Antonyms</p>
                <div class="flex flex-wrap gap-1 w-full">
                    {#each entry.antonyms as ant}
                        <button
                            onclick={(e) => openStackedLookup(ant, e)}
                            class="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full border border-gray-200 hover:bg-gray-200 transition-colors"
                        >{ant}</button>
                    {/each}
                </div>
            </div>
        {/if}

        <p class="text-[10px] text-gray-400">From your AI model</p>
    {/if}
{/snippet}

{#snippet phoneticFor(state: LookupState)}
    {#if state.status === "found" && state.entry.phonetic}
        <span class="text-xs text-gray-400 font-mono shrink-0">{state.entry.phonetic}</span>
    {/if}
{/snippet}

<!-- Backdrop: click outside to dismiss -->
{#if visible}
    <button
        type="button"
        aria-label="Close dictionary"
        class="dictionary-backdrop fixed inset-0 z-[99] cursor-default border-0 bg-transparent p-0"
        onclick={(e) => { e.stopPropagation(); dismiss(); }}
    ></button>
{/if}

<!-- Popover -->
<!-- Two layers: outer carries shadow + radius (no overflow → shadow stays rounded);
     inner carries backdrop-blur + radius + overflow-hidden + the flex/max-h layout so
     the blur is clipped to the corner. A single element with backdrop-filter + radius +
     overflow-hidden + box-shadow squares the shadow at the corners in WebKit. -->
<div
    bind:this={popoverEl}
    class="dictionary-popover fixed z-[100] w-80 shadow-xl rounded-2xl transition-all duration-150
        {visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}"
    style="left: {posX}px; top: {posY}px;"
>
  <div
      class="flex flex-col max-h-[480px] backdrop-blur-md bg-white/90 border border-white/40
          rounded-2xl overflow-hidden"
  >
    <!-- Header -->
    <div class="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
        <div class="flex items-baseline gap-2 min-w-0">
            <span class="font-semibold text-gray-900 truncate">{word}</span>
            {@render phoneticFor(lookup)}
        </div>
        <div class="flex items-center gap-1 shrink-0">
            {#if appSettings.aiEnabled}
                <button
                    onclick={openInChat}
                    disabled={!hasApiKey()}
                    title={hasApiKey() ? "Open in Chat" : "Needs API key"}
                    class="p-1 rounded-full text-black/30 hover:text-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-black/30 disabled:hover:bg-transparent"
                >
                    <ExternalLinkIcon size={13} />
                </button>
            {/if}
            <button
                onclick={dismiss}
                class="p-1 rounded-full text-black/30 hover:text-black/60 hover:bg-black/10 transition-colors"
            >
                <XIcon size={13} />
            </button>
        </div>
    </div>

    <div class="w-full h-px bg-black/8 shrink-0"></div>

    <!-- Scrollable body -->
    <div class="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
        {@render lookupBody(lookup, word, lookupMainWord, true)}

        <!-- Describe → find word (AI) -->
        {#if appSettings.aiEnabled}
            <div class="border-t border-black/8 pt-2">
                <p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                    Describe → find word
                    {#if !hasApiKey()}
                        <span class="font-normal normal-case tracking-normal text-amber-600">· needs an AI connection</span>
                    {/if}
                </p>

                {#each chat.messages as message (message.id)}
                    {#each message.parts as part, i (i)}
                        {#if part.type === "text"}
                            {@const renderPromise = renderMarkdown(part.text)}
                            <div class="mt-2 {message.role === 'user' ? 'text-right' : ''}">
                                <div class="inline-block text-xs px-2 py-1.5 rounded-lg {message.role === 'user' ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-700'}">
                                    <div class="prose prose-xs max-w-none {message.role === 'user' ? 'prose-invert' : ''} [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                                        {#await renderPromise then rendered}
                                            {@html rendered}
                                        {/await}
                                    </div>
                                </div>
                            </div>
                        {/if}
                    {/each}
                {/each}

                {#if chat.status === "streaming" || chat.status === "submitted"}
                    <div class="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                        <span class="animate-pulse">●</span> Finding words...
                    </div>
                {/if}

                <form onsubmit={handleDescribeSubmit} class="mt-2 flex w-full gap-1">
                    <input
                        bind:value={describeInput}
                        placeholder="Describe the idea..."
                        disabled={!canUseAi() || chat.status !== "ready"}
                        class="min-w-0 flex-1 px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:opacity-50"
                        autocomplete="off"
                    />
                    <button
                        type="submit"
                        disabled={!canUseAi() || !describeInput.trim() || chat.status !== "ready"}
                        class="px-2 py-1 text-xs bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 transition-colors"
                    >Find</button>
                </form>
            </div>
        {/if}
    </div>
  </div>
</div>

{#each stackedLookups as stacked, stackIndex (stacked.id)}
    <!-- Two-layer split (see main popover above): shadow+radius on outer, blur+clip on inner. -->
    <div
        class="dictionary-popover fixed z-[101] w-80 shadow-2xl rounded-2xl transition-all duration-150"
        style="left: {stacked.posX}px; top: {stacked.posY + stackIndex * 10}px;"
    >
      <div
          class="flex flex-col max-h-[420px] backdrop-blur-md bg-white/95 border border-white/50
              rounded-2xl overflow-hidden"
      >
        <div class="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
            <div class="flex items-baseline gap-2 min-w-0">
                <span class="font-semibold text-gray-900 truncate">{stacked.word}</span>
                {@render phoneticFor(stacked.lookup)}
            </div>
            <div class="flex items-center gap-1 shrink-0">
                <button
                    onclick={() => replaceWith(stacked.word)}
                    class="rounded-full bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-700 transition-colors hover:bg-teal-500 hover:text-white"
                >
                    Replace
                </button>
                <button
                    onclick={() => closeStackedLookup(stacked.id)}
                    class="p-1 rounded-full text-black/30 hover:text-black/60 hover:bg-black/10 transition-colors"
                    aria-label="Close lookup"
                >
                    <XIcon size={13} />
                </button>
            </div>
        </div>

        <div class="w-full h-px bg-black/8 shrink-0"></div>

        <div class="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
            {@render lookupBody(
                stacked.lookup,
                stacked.word,
                () => lookupStackedWord(stacked.id, stacked.word),
                false,
            )}
        </div>
      </div>
    </div>
{/each}
