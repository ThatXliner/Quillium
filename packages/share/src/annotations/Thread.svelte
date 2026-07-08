<script lang="ts">
/**
 * Thread.svelte — Shared presentational thread (message list + optional reply
 * footer + optional AI suggest). Used by the desktop editor and the web preview.
 *
 * Decoupled from the app:
 *   - Editing affordances render only when their callbacks are provided, so the
 *     read-only web preview passes none and gets a pure message list.
 *   - The reply textarea is CONTROLLED (`replyValue` + `onReplyInput`) so the
 *     desktop adapter can back it with its cross-layout draft store (#247).
 *   - `onUpdateThread` (message edits), `onSend` (reply), `onAiSuggest` are the
 *     seams the desktop adapter wires to stores/commands.
 *
 * PoC simplification: the desktop's Kbd keycap pills are rendered as a plain
 * text hint here. Injecting Kbd as a snippet is the productionization path.
 */
import { cubicOut } from "svelte/easing";
import { slide } from "svelte/transition";
import type { Thread as ThreadType } from "../core/models";
import { type Persona } from "./avatar";
import ThreadMessage from "./ThreadMessage.svelte";

let {
    thread,
    personas = [],
    previewOnly = false,
    hideReply = false,
    onUpdateThread,
    replyValue = "",
    onReplyInput,
    onSend,
    onEscape,
    onAiSuggest,
    accentClass = "text-blue-600/80 hover:text-blue-700",
    sendPillClass = "bg-blue-500 text-white hover:bg-blue-600",
    focusRingClass = "focus-within:ring-blue-300/50",
}: {
    thread: ThreadType;
    personas?: Persona[];
    previewOnly?: boolean;
    hideReply?: boolean;
    onUpdateThread?: (thread: ThreadType) => void;
    replyValue?: string;
    onReplyInput?: (value: string) => void;
    /** When provided, the reply footer renders (editor only). */
    onSend?: () => void;
    onEscape?: () => void;
    onAiSuggest?: () => void;
    accentClass?: string;
    sendPillClass?: string;
    focusRingClass?: string;
} = $props();

let isFocused = $state(false);
const hasText = $derived(!!replyValue.trim());
const showReply = $derived(!!onSend && !previewOnly && !hideReply);
</script>

<!-- Messages -->
{#if thread.length > 0}
    <div class="space-y-3 {previewOnly ? '' : 'mb-0'}">
        {#each thread as message, i}
            {#if i === 0}
                <ThreadMessage
                    {message}
                    index={i}
                    {thread}
                    {personas}
                    {onUpdateThread}
                    truncate={previewOnly && i === 0}
                />
            {:else if !previewOnly}
                <div transition:slide={{ duration: 180, easing: cubicOut }}>
                    <ThreadMessage {message} index={i} {thread} {personas} {onUpdateThread} truncate={false} />
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

<!-- Reply input — only when an onSend handler is wired (editor) -->
{#if showReply}
    <div transition:slide={{ duration: 200, easing: cubicOut }}
        class="mt-3 rounded-[10px] bg-white/60 inset-shadow-sm inset-shadow-white overflow-hidden
        ring-1 ring-black/5 focus-within:ring-2 {focusRingClass} transition-shadow">
        <textarea
            value={replyValue}
            oninput={(e) => onReplyInput?.((e.currentTarget as HTMLTextAreaElement).value)}
            placeholder="Reply…"
            rows="2"
            class="w-full text-xs bg-transparent px-3 pt-2.5 pb-1 resize-none focus:outline-none
                text-black/70 placeholder:text-black/30"
            onfocus={() => (isFocused = true)}
            onblur={() => (isFocused = false)}
            onkeydown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    onSend?.();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    onEscape?.();
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
                            text-black/35 hover:text-black/60 hover:bg-white/50 transition-colors {accentClass}"
                        onclick={onAiSuggest}
                    >
                        <span>✨ Suggest</span>
                    </button>
                {/if}
            </div>
            <div class="flex items-center gap-1.5">
                <button
                    onclick={hasText ? onSend : undefined}
                    class="flex items-center gap-1.5 px-3 h-[26px] rounded-full text-[10px] font-medium transition-all duration-150
                        {hasText ? `${sendPillClass} shadow-sm` : 'bg-black/5 text-black/30'}"
                >
                    {isFocused ? "Send" : "Reply"}
                    <span class="opacity-70">{isFocused ? "⌘↵" : "⌘/"}</span>
                </button>
            </div>
        </div>
    </div>
{/if}
