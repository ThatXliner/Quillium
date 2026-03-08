<script lang="ts">
/**
 * Thread.svelte — Renders a message list, reply textarea, and optional
 * AI suggest button for a comment/revision/suggestion thread.
 *
 * Props:
 *   - thread: Thread — array of messages to display
 *   - updateThread: (thread: Thread) => void — callback to replace
 *     the entire thread array (used on reply send or AI response)
 *   - previewOnly?: boolean — when true, shows only the first message
 *     and hides the reply input (collapsed card state)
 *   - onAiSuggest?: () => void — when provided, renders the AI
 *     suggest button in the reply footer
 *   - accentClass?: string — Tailwind classes for the Send button color
 *
 * Events emitted: none (delegates mutation via updateThread callback)
 * Stores: none
 *
 * Parent: Comment.svelte, Revision.svelte, Suggestion.svelte
 * Children: ThreadMessage.svelte (one per message)
 */
import { SparklesIcon } from "lucide-svelte";
import { slide } from "svelte/transition";
import { cubicOut } from "svelte/easing";
import ThreadMessage from "./ThreadMessage.svelte";
import type { Thread as ThreadType } from ".";

let {
    thread,
    updateThread,
    // When true shows only the first message (collapsed comment card preview)
    previewOnly = false,
    // When provided, renders the AI suggest button in the reply footer
    onAiSuggest = undefined,
    // Accent colour class for the Send button; defaults to blue
    accentClass = "text-blue-600/80 hover:text-blue-700",
    // Focus ring colour class applied to the reply box wrapper
    focusRingClass = "focus-within:ring-blue-300/50",
}: {
    thread: ThreadType;
    updateThread: (thread: ThreadType) => void;
    previewOnly?: boolean;
    onAiSuggest?: (() => void) | undefined;
    accentClass?: string;
    focusRingClass?: string;
} = $props();

let newMessage = $state("");

function send() {
    if (!newMessage.trim()) return;
    updateThread([...thread, { message: newMessage.trim(), author: "User", time: Date.now() }]);
    newMessage = "";
}
</script>

<!-- Messages -->
{#if thread.length > 0}
    <div class="space-y-3 {previewOnly ? '' : 'mb-0'}">
        {#each thread as message, i}
            {#if i === 0}
                <ThreadMessage
                    {message}
                    index={i}
                    {updateThread}
                    {thread}
                    truncate={previewOnly && i === 0}
                />
            {:else if !previewOnly}
                <div transition:slide={{ duration: 180, easing: cubicOut }}>
                    <ThreadMessage
                        {message}
                        index={i}
                        {updateThread}
                        {thread}
                        truncate={false}
                    />
                </div>
            {/if}
        {/each}

        {#if previewOnly && thread.length > 1}
            <p transition:slide={{ duration: 180, easing: cubicOut }} class="text-[10px] text-black/40 pl-9">
                {thread.length - 1} more repl{thread.length === 2 ? "y" : "ies"}
            </p>
        {/if}
    </div>
{/if}

<!-- Reply input — hidden in previewOnly mode -->
{#if !previewOnly}
    <div transition:slide={{ duration: 200, easing: cubicOut }}
        class="mt-3 rounded-[10px] bg-white/60 inset-shadow-sm inset-shadow-white overflow-hidden
        ring-1 ring-black/5 focus-within:ring-2 {focusRingClass} transition-shadow">
        <textarea
            bind:value={newMessage}
            placeholder="Reply…"
            rows="2"
            class="w-full text-xs bg-transparent px-3 pt-2.5 pb-1 resize-none focus:outline-none
                text-black/70 placeholder:text-black/30"
            onkeydown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    send();
                }
            }}
        ></textarea>
        <div class="flex items-center justify-between px-2 pb-1.5">
            <div class="flex items-center gap-1">
                {#if onAiSuggest}
                    <button
                        aria-label="Get AI suggestion"
                        title="Get AI suggestion"
                        class="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
                            text-black/35 hover:text-black/60 hover:bg-white/50 transition-colors"
                        onclick={onAiSuggest}
                    >
                        <SparklesIcon size={11} />
                        <span>Suggest</span>
                    </button>
                {/if}
            </div>
            <div class="flex items-center gap-2">
                {#if newMessage.trim()}
                    <button
                        onclick={send}
                        class="text-xs font-medium transition-colors {accentClass}"
                    >Send</button>
                {:else}
                    <span class="text-[10px] text-black/25">⌘↵ to send</span>
                {/if}
            </div>
        </div>
    </div>
{/if}
