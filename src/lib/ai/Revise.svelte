<!--
    Revise.svelte — Text revision AI panel (purple theme).

    Provides targeted rewriting and revision suggestions. Uses the
    "revise" mode stream which includes two tools:
      - createSuggestion: proposes one or more rewritten versions of a
        passage, each with an optional rationale.
      - createComment: adds an explanatory note about the revision.

    These tool calls are routed through chatFactory.handleToolCall to
    the annotation system, which attaches inline suggestions/comments
    to the CodeMirror editor.

    Features:
      - "Revise" quick-action button (selection-aware).
      - Quick-prompt grid for common revision tasks (conciseness, flow,
        grammar, etc.).

    State machine (driven by `chat.status`):
      ready     — user can submit or click a quick action.
      submitted — waiting for first token.
      streaming — tokens arriving, "Revising..." indicator shown.
      error     — implicit (chat.error set).

    Dependencies: chatFactory, utils (renderMarkdown), stores, posthog.
-->
<script lang="ts">
/*
 * Revise.svelte
 *
 * Text revision AI panel (purple theme).
 *
 * Renders:
 *   A "Revise" quick-action button, a grid of quick-prompt chips
 *   for common revision tasks, scrollable message list with
 *   user/assistant bubbles, streaming indicator, and a bottom
 *   input form with selection-context chip.
 *
 * Props: none.
 * Events: none dispatched.
 *
 * Stores read:
 *   - $selectedText — toggles quick-action label and scopes
 *     quick prompts to "this selected text" vs "my document".
 *   - $documentContent — gates action buttons (disabled when empty)
 *     and displayed as character count.
 *
 * Stores written:
 *   - aiProcessing.active (via setAiProcessing) — true while
 *     streaming so the sidebar glow activates.
 *
 * AI streaming layer:
 *   Uses createAiChat({ mode: "revise" }) which provides two
 *   tool definitions: createSuggestion (proposes rewritten
 *   versions with optional rationale) and createComment (adds
 *   explanatory notes). Tool calls are routed through
 *   chatFactory.handleToolCall to the annotation system.
 *
 * State machine (chat.status):
 *   ready -> submitted -> streaming -> ready
 *                                   \-> error (chat.error set)
 */
import { selectedText, documentContent } from "$lib/stores";
import { renderMarkdown } from "$lib/ai/utils";
import { createAiChat, setAiProcessing } from "$lib/ai/chatFactory";
import { appSettings, persistSettings } from "$lib/settings.svelte";
import { Plus, Trash2 } from "lucide-svelte";
import posthog from "posthog-js";

let input = $state("");

const { chat, clearChat } = createAiChat({ mode: "revise" });

// Sync streaming state to the global AI processing indicator.
// States: ready -> submitted -> streaming -> ready (or error).
$effect(() => {
    setAiProcessing(chat.status === "submitted" || chat.status === "streaming");
});

function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!input.trim() || chat.status !== "ready") return;

    posthog.capture("ai_revise_requested", {
        has_selection: !!$selectedText,
        trigger: "manual",
    });
    chat.sendMessage({ text: input });
    input = "";
}

/**
 * Build a selection-aware revision prompt and send it as a chat
 * message. If text is selected, targets the selection; otherwise
 * targets the whole document.
 */
function reviseText() {
    const context = $selectedText
        ? `Please revise and rewrite this selected text to improve flow and conciseness: "${$selectedText}"`
        : "Please revise my document to improve flow and conciseness.";

    posthog.capture("ai_revise_requested", {
        has_selection: !!$selectedText,
        trigger: "quick_action",
    });
    input = context;
    chat.sendMessage({ text: context });
}

const defaultQuickPrompts = [
    { label: "Make this more concise", prompt: "Make this more concise" },
    { label: "Improve the flow and transitions", prompt: "Improve the flow and transitions" },
    { label: "Make this more engaging", prompt: "Make this more engaging" },
    { label: "Fix grammar and style issues", prompt: "Fix grammar and style issues" },
    { label: "Simplify complex sentences", prompt: "Simplify complex sentences" },
];

let customRevisePrompts = $derived(
    appSettings.customQuickActions.filter((a) => a.panel === "revise"),
);


// Chip management
let showAddChip = $state(false);
let newChipLabel = $state("");
let newChipPrompt = $state("");

function addChip() {
    if (!newChipLabel.trim() || !newChipPrompt.trim()) return;
    appSettings.customQuickActions = [
        ...appSettings.customQuickActions,
        { label: newChipLabel.trim(), prompt: newChipPrompt.trim(), panel: "revise" },
    ];
    persistSettings();
    newChipLabel = "";
    newChipPrompt = "";
    showAddChip = false;
}

function removeCustomChip(label: string, prompt: string) {
    appSettings.customQuickActions = appSettings.customQuickActions.filter(
        (a) => !(a.panel === "revise" && a.label === label && a.prompt === prompt),
    );
    persistSettings();
}

/**
 * Compose a revision message from a quick-prompt chip, scoped to
 * the current selection or the full document, then send it.
 */
function useQuickPrompt(prompt: string) {
    const target = $selectedText ? "this selected text" : "my document";
    const message = `${prompt} in ${target}`;
    posthog.capture("ai_revise_quick_prompt_used", {
        prompt,
        has_selection: !!$selectedText,
    });
    input = message;
    chat.sendMessage({ text: message });
}
</script>

<div class="flex-1 flex flex-col min-h-0">
    <!-- Quick actions -->
    <div class="p-3 border-b border-black/10">
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
            {#each defaultQuickPrompts as { label, prompt }}
                <button
                    onclick={() => useQuickPrompt(prompt)}
                    disabled={chat.status !== "ready" || !$documentContent}
                    class="px-2 py-1.5 text-xs bg-white hover:bg-purple-50 rounded border border-purple-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                    {label}
                </button>
            {/each}
            {#each customRevisePrompts as { label, prompt }}
                <div class="group relative">
                    <button
                        onclick={() => useQuickPrompt(prompt)}
                        disabled={chat.status !== "ready" || !$documentContent}
                        class="w-full px-2 py-1.5 text-xs bg-white hover:bg-purple-50 rounded border border-purple-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left pr-5"
                    >
                        {label}
                    </button>
                    <button
                        onclick={() => removeCustomChip(label, prompt)}
                        aria-label="Remove chip"
                        class="absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-black/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <Trash2 size={9} />
                    </button>
                </div>
            {/each}
        </div>

        {#if showAddChip}
            <div class="mt-2 flex flex-col gap-1">
                <input
                    bind:value={newChipLabel}
                    placeholder="Label"
                    class="w-full px-2 py-1 text-xs border border-black/10 rounded focus:outline-none focus:ring-1 focus:ring-purple-400/50 placeholder:text-black/25"
                />
                <textarea
                    bind:value={newChipPrompt}
                    placeholder="Prompt sent to AI…"
                    rows="2"
                    class="w-full px-2 py-1 text-xs border border-black/10 rounded focus:outline-none focus:ring-1 focus:ring-purple-400/50 resize-none placeholder:text-black/25"
                ></textarea>
                <div class="flex gap-1.5">
                    <button
                        onclick={addChip}
                        disabled={!newChipLabel.trim() || !newChipPrompt.trim()}
                        class="flex-1 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >Save</button>
                    <button
                        onclick={() => { showAddChip = false; newChipLabel = ""; newChipPrompt = ""; }}
                        class="px-2 py-1 text-xs text-black/40 hover:text-black/60 transition-colors"
                    >Cancel</button>
                </div>
            </div>
        {:else}
            <button
                onclick={() => { showAddChip = true; }}
                class="mt-2 flex items-center gap-1 text-[10px] text-black/30 hover:text-purple-600 transition-colors"
            >
                <Plus size={10} />
                Add chip
            </button>
        {/if}
    </div>

    <!-- Clear chat row -->
    {#if chat.messages.length > 0}
        <div class="flex justify-end px-3 pt-2 shrink-0">
            <button
                onclick={clearChat}
                title="Start a fresh conversation (clears all messages)"
                class="text-[10px] text-black/30 hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50"
            >New chat</button>
        </div>
    {/if}

    <!-- Chat messages -->
    <div class="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
        {#each chat.messages as message, messageIndex (messageIndex)}
            {#each message.parts as part, partIndex (partIndex)}
                {#if part.type === "text"}
                    {@const renderPromise = renderMarkdown(part.text)}
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
    <div class="border-t border-black/10 p-3 bg-white/30">
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
