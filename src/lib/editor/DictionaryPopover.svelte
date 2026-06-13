<!--
    DictionaryPopover.svelte — Floating dictionary/thesaurus popover.

    Triggered by Cmd-d (⌘D) when a single word is selected in the editor.
    Shows definition, synonyms/antonyms from the Free Dictionary API, and
    a "describe → find word" AI mode. Clicking a synonym replaces the word
    in the editor; "Open in Chat" sends the word to the Chat AI panel.

    Always mounted, hidden when `visible = false`.
-->
<script lang="ts">
import { get } from "svelte/store";
import { editorView, selectedText } from "$lib/stores";
import { createAiChat, useAiChatEffects } from "$lib/ai/chatFactory";
import { renderMarkdown } from "$lib/ai/utils";
import { hasApiKey } from "$lib/ai/settings.svelte";
import { Transaction } from "@codemirror/state";
import { ExternalLinkIcon, XIcon } from "lucide-svelte";
import { capture } from "$lib/posthog";
import { appSettings } from "$lib/settings.svelte";
import { appEventBus } from "$lib/events/appEventBus";
import { getPhonetic, collectSynonyms, collectAntonyms, type DictEntry } from "./dictionaryUtils";

// ── State ──────────────────────────────────────────────────────

let visible = $state(false);
let word = $state("");
let selFrom = $state(0);
let selTo = $state(0);
let centerX = $state(0);
let centerY = $state(0);
let posX = $state(0);
let posY = $state(0);

let popoverEl = $state<HTMLDivElement | undefined>();

// Lookup state
let lookupResult = $state<DictEntry[] | null>(null);
let lookupError = $state<string | null>(null);
let lookupLoading = $state(false);

type StackedLookup = {
    id: number;
    word: string;
    posX: number;
    posY: number;
    lookupResult: DictEntry[] | null;
    lookupError: string | null;
    lookupLoading: boolean;
    controller: AbortController | null;
};

let stackedLookups = $state<StackedLookup[]>([]);
let nextStackedLookupId = 1;

// Describe mode (AI)
let describeInput = $state("");
const { chat, clearChat } = createAiChat({ mode: "dictionary" });

// Wire up processing indicator + global stop listener.
useAiChatEffects(chat);

// ── React to bus events ────────────────────────────────────────

$effect(() => {
    return appEventBus.on("dictionary-open", (event) => {
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
        lookupResult = null;
        lookupError = null;
        lookupWord(event.word);
    });
});

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

function dismiss() {
    visible = false;
    for (const lookup of stackedLookups) {
        lookup.controller?.abort();
    }
    stackedLookups = [];
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && visible) dismiss();
}

// ── Dictionary API ─────────────────────────────────────────────

let lookupController: AbortController | null = null;

async function lookupWord(w: string) {
    // Cancel any in-flight request so stale results can't overwrite fresh ones.
    lookupController?.abort();
    const controller = new AbortController();
    lookupController = controller;

    lookupLoading = true;
    lookupError = null;
    lookupResult = null;
    try {
        const res = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`,
            { signal: controller.signal },
        );
        // Stale response — a newer request has taken over.
        if (lookupController !== controller) return;
        if (res.status === 404) {
            lookupError = `No results for "${w}".`;
            return;
        }
        if (!res.ok) {
            lookupError = "Dictionary unavailable.";
            return;
        }
        lookupResult = (await res.json()) as DictEntry[];
    } catch (err) {
        if ((err as Error).name !== "AbortError") {
            lookupError = "Could not reach dictionary.";
        }
    } finally {
        // Only clear loading if this is still the active request.
        if (lookupController === controller) {
            lookupLoading = false;
        }
    }
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

async function lookupStackedWord(lookup: StackedLookup) {
    lookup.controller?.abort();
    const controller = new AbortController();
    lookup.controller = controller;
    lookup.lookupLoading = true;
    lookup.lookupError = null;
    lookup.lookupResult = null;

    try {
        const res = await fetch(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lookup.word)}`,
            { signal: controller.signal },
        );
        if (lookup.controller !== controller) return;
        if (res.status === 404) {
            lookup.lookupError = `No results for "${lookup.word}".`;
            return;
        }
        if (!res.ok) {
            lookup.lookupError = "Dictionary unavailable.";
            return;
        }
        lookup.lookupResult = (await res.json()) as DictEntry[];
    } catch (err) {
        if ((err as Error).name !== "AbortError") {
            lookup.lookupError = "Could not reach dictionary.";
        }
    } finally {
        if (lookup.controller === controller) {
            lookup.lookupLoading = false;
        }
    }
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
    const lookup: StackedLookup = {
        id: nextStackedLookupId++,
        word: w,
        posX,
        posY,
        lookupResult: null,
        lookupError: null,
        lookupLoading: false,
        controller: null,
    };
    stackedLookups = [...stackedLookups, lookup];
    lookupStackedWord(lookup);
    capture("dictionary_chip_lookup", { word: w });
}

function closeStackedLookup(id: number) {
    const lookup = stackedLookups.find((item) => item.id === id);
    lookup?.controller?.abort();
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
        const entry = lookupResult?.[0];
        const def = entry?.meanings?.[0]?.definitions?.[0]?.definition ?? "";
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
    if (!trimmed || chat.status !== "ready") return;
    capture("dictionary_describe_lookup", { input_length: trimmed.length });
    chat.sendMessage({ text: `I'm looking for a word that means: ${trimmed}` });
    describeInput = "";
}
</script>

<svelte:window onkeydown={handleKeydown} />

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
<div
    bind:this={popoverEl}
    class="dictionary-popover fixed z-[100] w-80 max-h-[480px] flex flex-col
        backdrop-blur-md bg-[color:var(--surface)] border border-[color:var(--border)] shadow-xl rounded-2xl
        overflow-hidden transition-all duration-150
        {visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}"
    style="left: {posX}px; top: {posY}px;"
>
    <!-- Header -->
    <div class="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
        <div class="flex items-baseline gap-2 min-w-0">
            <span class="font-semibold text-[color:var(--text-strong)] truncate">{word}</span>
            {#if lookupResult}
                {@const phonetic = getPhonetic(lookupResult[0])}
                {#if phonetic}
                    <span class="text-xs text-[color:var(--text-faint)] font-mono shrink-0">{phonetic}</span>
                {/if}
            {/if}
        </div>
        <div class="flex items-center gap-1 shrink-0">
            {#if appSettings.aiEnabled}
                <button
                    onclick={openInChat}
                    disabled={!hasApiKey()}
                    title={hasApiKey() ? "Open in Chat" : "Needs API key"}
                    class="p-1 rounded-full text-[color:var(--text-ghost)] hover:text-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-[color:var(--text-ghost)] disabled:hover:bg-transparent"
                >
                    <ExternalLinkIcon size={13} />
                </button>
            {/if}
            <button
                onclick={dismiss}
                class="p-1 rounded-full text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)] transition-colors"
            >
                <XIcon size={13} />
            </button>
        </div>
    </div>

    <div class="w-full h-px bg-[color:var(--border)] shrink-0"></div>

    <!-- Scrollable body -->
    <div class="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
        {#if lookupLoading}
            <div class="flex items-center gap-2 text-[color:var(--text-faint)] text-sm py-2">
                <span class="animate-pulse">●</span>
                <span>Looking up...</span>
            </div>
        {:else if lookupError}
            <p class="text-sm text-[color:var(--text-faint)]">{lookupError}</p>
        {:else if lookupResult}
            {@const entry = lookupResult[0]}
            {@const synonyms = collectSynonyms(lookupResult)}
            {@const antonyms = collectAntonyms(lookupResult)}

            <!-- Definitions -->
            {#each entry.meanings.slice(0, 2) as meaning}
                <div class="space-y-1">
                    <p class="text-[10px] font-semibold uppercase tracking-wider text-teal-600">
                        {meaning.partOfSpeech}
                    </p>
                    {#each meaning.definitions.slice(0, 2) as def, i}
                        <p class="text-xs text-[color:var(--text)] leading-snug">
                            <span class="text-[color:var(--text-faint)] mr-1">{i + 1}.</span>{def.definition}
                        </p>
                        {#if def.example}
                            <p class="text-[11px] text-[color:var(--text-faint)] italic pl-3">"{def.example}"</p>
                        {/if}
                    {/each}
                </div>
            {/each}

            <!-- Synonyms -->
            {#if synonyms.length > 0}
                <div>
                    <p class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-faint)] mb-1.5">
                        Synonyms <span class="font-normal normal-case tracking-normal text-[color:var(--text-ghost)]">· click to explore</span>
                    </p>
                    <div class="flex flex-wrap gap-1 w-full">
                        {#each synonyms as syn}
                            <button
                                onclick={(e) => openStackedLookup(syn, e)}
                                class="px-2 py-0.5 text-xs bg-teal-50 text-teal-700 rounded-full border border-teal-100 hover:bg-teal-500 hover:text-white hover:border-teal-500 transition-colors"
                            >{syn}</button>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Antonyms -->
            {#if antonyms.length > 0}
                <div>
                    <p class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-faint)] mb-1.5">Antonyms</p>
                    <div class="flex flex-wrap gap-1 w-full">
                        {#each antonyms as ant}
                            <button
                                onclick={(e) => openStackedLookup(ant, e)}
                                class="px-2 py-0.5 text-xs bg-[color:var(--surface-2)] text-[color:var(--text-soft)] rounded-full border border-[color:var(--border)] hover:bg-[color:var(--surface-3)] transition-colors"
                            >{ant}</button>
                        {/each}
                    </div>
                </div>
            {/if}
        {/if}

        <!-- Describe → find word (AI) -->
        {#if appSettings.aiEnabled}
            <div class="border-t border-[color:var(--border)] pt-2">
                <p class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-faint)] mb-1.5">
                    Describe → find word
                    {#if !hasApiKey()}
                        <span class="font-normal normal-case tracking-normal text-amber-500">· needs API key</span>
                    {/if}
                </p>

                {#each chat.messages as message (message.id)}
                    {#each message.parts as part, i (i)}
                        {#if part.type === "text"}
                            {@const renderPromise = renderMarkdown(part.text)}
                            <div class="mt-2 {message.role === 'user' ? 'text-right' : ''}">
                                <div class="inline-block text-xs px-2 py-1.5 rounded-lg {message.role === 'user' ? 'bg-teal-500 text-white' : 'bg-[color:var(--surface-2)] text-[color:var(--text)]'}">
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
                    <div class="mt-2 flex items-center gap-1.5 text-xs text-[color:var(--text-faint)]">
                        <span class="animate-pulse">●</span> Finding words...
                    </div>
                {/if}

                <form onsubmit={handleDescribeSubmit} class="mt-2 flex w-full gap-1">
                    <input
                        bind:value={describeInput}
                        placeholder="Describe the idea..."
                        disabled={!hasApiKey() || chat.status !== "ready"}
                        class="min-w-0 flex-1 px-2 py-1 text-xs bg-[color:var(--surface-2)] text-[color:var(--text)] placeholder:text-[color:var(--text-ghost)] border border-[color:var(--border)] rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:opacity-50"
                        autocomplete="off"
                    />
                    <button
                        type="submit"
                        disabled={!hasApiKey() || !describeInput.trim() || chat.status !== "ready"}
                        class="px-2 py-1 text-xs bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 transition-colors"
                    >Find</button>
                </form>
            </div>
        {/if}
    </div>
</div>

{#each stackedLookups as stacked, stackIndex (stacked.id)}
    <div
        class="dictionary-popover fixed z-[101] w-80 max-h-[420px] flex flex-col
            backdrop-blur-md bg-[color:var(--surface)] border border-[color:var(--border)] shadow-2xl rounded-2xl
            overflow-hidden transition-all duration-150"
        style="left: {stacked.posX}px; top: {stacked.posY + stackIndex * 10}px;"
    >
        <div class="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
            <div class="flex items-baseline gap-2 min-w-0">
                <span class="font-semibold text-[color:var(--text-strong)] truncate">{stacked.word}</span>
                {#if stacked.lookupResult}
                    {@const phonetic = getPhonetic(stacked.lookupResult[0])}
                    {#if phonetic}
                        <span class="text-xs text-[color:var(--text-faint)] font-mono shrink-0">{phonetic}</span>
                    {/if}
                {/if}
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
                    class="p-1 rounded-full text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)] transition-colors"
                    aria-label="Close lookup"
                >
                    <XIcon size={13} />
                </button>
            </div>
        </div>

        <div class="w-full h-px bg-[color:var(--border)] shrink-0"></div>

        <div class="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
            {#if stacked.lookupLoading}
                <div class="flex items-center gap-2 text-[color:var(--text-faint)] text-sm py-2">
                    <span class="animate-pulse">●</span>
                    <span>Looking up...</span>
                </div>
            {:else if stacked.lookupError}
                <p class="text-sm text-[color:var(--text-faint)]">{stacked.lookupError}</p>
            {:else if stacked.lookupResult}
                {@const entry = stacked.lookupResult[0]}
                {@const synonyms = collectSynonyms(stacked.lookupResult)}
                {@const antonyms = collectAntonyms(stacked.lookupResult)}

                {#each entry.meanings.slice(0, 2) as meaning}
                    <div class="space-y-1">
                        <p class="text-[10px] font-semibold uppercase tracking-wider text-teal-600">
                            {meaning.partOfSpeech}
                        </p>
                        {#each meaning.definitions.slice(0, 2) as def, i}
                            <p class="text-xs text-[color:var(--text)] leading-snug">
                                <span class="text-[color:var(--text-faint)] mr-1">{i + 1}.</span>{def.definition}
                            </p>
                            {#if def.example}
                                <p class="text-[11px] text-[color:var(--text-faint)] italic pl-3">"{def.example}"</p>
                            {/if}
                        {/each}
                    </div>
                {/each}

                {#if synonyms.length > 0}
                    <div>
                        <p class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-faint)] mb-1.5">Synonyms</p>
                        <div class="flex flex-wrap gap-1 w-full">
                            {#each synonyms as syn}
                                <button
                                    onclick={(e) => openStackedLookup(syn, e)}
                                    class="px-2 py-0.5 text-xs bg-teal-50 text-teal-700 rounded-full border border-teal-100 hover:bg-teal-500 hover:text-white hover:border-teal-500 transition-colors"
                                >{syn}</button>
                            {/each}
                        </div>
                    </div>
                {/if}

                {#if antonyms.length > 0}
                    <div>
                        <p class="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-faint)] mb-1.5">Antonyms</p>
                        <div class="flex flex-wrap gap-1 w-full">
                            {#each antonyms as ant}
                                <button
                                    onclick={(e) => openStackedLookup(ant, e)}
                                    class="px-2 py-0.5 text-xs bg-[color:var(--surface-2)] text-[color:var(--text-soft)] rounded-full border border-[color:var(--border)] hover:bg-[color:var(--surface-3)] transition-colors"
                                >{ant}</button>
                            {/each}
                        </div>
                    </div>
                {/if}
            {/if}
        </div>
    </div>
{/each}
