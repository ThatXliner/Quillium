<script lang="ts">
import { avatarColor, initials } from "./avatar";
import type { ThreadMessagePersonaView, ThreadMessageView } from "./types";

let {
    message,
    truncate = false,
    persona,
    onEdit,
}: {
    message: ThreadMessageView;
    truncate?: boolean;
    persona?: ThreadMessagePersonaView;
    onEdit?: (message: string) => void;
} = $props();

let editing = $state(false);
let editMessage = $state("");

$effect.pre(() => {
    if (!editing) editMessage = message.message;
});

function saveEdit(): void {
    if (!editMessage || !onEdit) return;
    onEdit(editMessage);
    editing = false;
}

function cancelEdit(): void {
    editing = false;
    editMessage = message.message;
}

function formatTime(timestamp: number): string {
    return new Intl.DateTimeFormat("default", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(new Date(timestamp));
}
</script>

<div class="flex gap-2.5">
    {#if persona}
        <div
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm"
            style:background={persona.background}
            style:border={`1.5px solid ${persona.border}`}
        >
            {persona.emoji}
        </div>
    {:else}
        <div
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm"
            style:background={avatarColor(message.author)}
            title={message.author}
        >
            {initials(message.author)}
        </div>
    {/if}
    <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-1.5">
            <span class="text-xs font-semibold text-black/80">{message.author}</span>
            <span class="text-[10px] text-black/40">{formatTime(message.time)}</span>
        </div>

        {#if editing}
            <textarea
                bind:value={editMessage}
                class="mt-1 w-full resize-none rounded-lg border border-white/30 bg-white/40 p-1.5 text-xs text-black/70 focus:outline-none focus:ring-1 focus:ring-blue-400/50"
                rows="3"
                onkeydown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && editMessage) {
                        saveEdit();
                    }
                }}
            ></textarea>
            <div class="mt-1 flex gap-2">
                <button
                    onclick={saveEdit}
                    disabled={!editMessage}
                    class="text-xs font-medium text-blue-600/80 hover:text-blue-700 disabled:opacity-50"
                >Save</button>
                <button
                    onclick={cancelEdit}
                    class="text-xs text-black/40 hover:text-black/60"
                >Cancel</button>
            </div>
        {:else}
            <p
                class="mt-0.5 text-xs leading-relaxed text-black/70 {truncate
                    ? 'truncate'
                    : 'whitespace-pre-wrap'}"
            >
                {message.message}
            </p>
            {#if onEdit && !truncate}
                <button
                    onclick={() => (editing = true)}
                    class="mt-0.5 text-[10px] text-black/30 hover:text-black/50"
                >Edit</button>
            {/if}
        {/if}
    </div>
</div>
