<script lang="ts">
/**
 * ThreadMessage.svelte — Shared presentational thread message (avatar, author,
 * timestamp, body). Used by both the desktop editor and the web preview.
 *
 * Decoupled from the app: personas are passed in (not read from a store), and
 * inline editing only renders when `onUpdateThread` is provided — so the
 * read-only web preview passes nothing and gets a pure display.
 */
import type { Thread, ThreadMessage } from "../core/models";
import { type Persona, avatarColor, initials, lightTint, mediumTint } from "./avatar";

let {
    message,
    thread,
    index,
    personas = [],
    truncate = false,
    onUpdateThread,
}: {
    message: ThreadMessage;
    thread: Thread;
    index: number;
    personas?: Persona[];
    truncate?: boolean;
    /** When provided, an inline "Edit" affordance is shown (editor only). */
    onUpdateThread?: (thread: Thread) => void;
} = $props();

const persona = $derived(personas.find((p) => p.name === message.author));

let editing = $state(false);
let editMessage = $state(message.message);

function saveEdit() {
    if (!onUpdateThread) return;
    const newThread = [...thread];
    newThread[index] = { ...thread[index], message: editMessage };
    onUpdateThread(newThread);
    editing = false;
}

function formatTime(ts: number) {
    return new Intl.DateTimeFormat("default", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(ts));
}
</script>

<div class="flex gap-2.5">
    {#if persona}
        <div
            class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm"
            style="background: {lightTint(persona.color)}; border: 1.5px solid {mediumTint(persona.color)};"
        >
            {persona.emoji}
        </div>
    {:else}
        <div
            class="shrink-0 w-7 h-7 rounded-full shadow-sm flex items-center justify-center text-white text-xs font-semibold"
            style="background: {avatarColor(message.author)};"
            title={message.author}
        >
            {initials(message.author)}
        </div>
    {/if}
    <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-1.5">
            <span class="text-xs font-semibold text-black/80">{message.author}</span>
            <span class="text-[10px] text-black/40">{formatTime(message.time)}</span>
        </div>

        {#if editing && onUpdateThread}
            <textarea
                bind:value={editMessage}
                class="mt-1 w-full text-xs rounded-lg bg-white/40 border border-white/30 p-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400/50 text-black/70"
                rows="3"
                onkeydown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && editMessage) {
                        saveEdit();
                    }
                }}
            ></textarea>
            <div class="flex gap-2 mt-1">
                <button
                    onclick={saveEdit}
                    disabled={!editMessage}
                    class="text-xs font-medium text-blue-600/80 hover:text-blue-700 disabled:opacity-50"
                >Save</button>
                <button
                    onclick={() => { editing = false; editMessage = message.message; }}
                    class="text-xs text-black/40 hover:text-black/60"
                >Cancel</button>
            </div>
        {:else}
            <p class="text-xs text-black/70 mt-0.5 leading-relaxed {truncate ? 'truncate' : 'whitespace-pre-wrap'}">{message.message}</p>
            {#if !truncate && onUpdateThread}
                <button
                    onclick={() => (editing = true)}
                    class="text-[10px] text-black/30 hover:text-black/50 mt-0.5"
                >Edit</button>
            {/if}
        {/if}
    </div>
</div>
