<script lang="ts">
    import type { Thread, ThreadMessage } from ".";

    let {
        message,
        thread,
        index,
        updateThread,
        truncate = false,
    }: {
        message: ThreadMessage;
        updateThread: (thread: Thread) => void;
        thread: Thread;
        index: number;
        truncate?: boolean;
    } = $props();

    let editing = $state(false);
    let editMessage = $state(message.message);

    function saveEdit() {
        const newThread = [...thread];
        newThread[index] = { ...thread[index], message: editMessage };
        updateThread(newThread);
        editing = false;
    }

    function initials(author: string) {
        return author
            .split(" ")
            .map((w) => w[0])
            .join("")
            .toUpperCase()
            .slice(0, 2);
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
    <div class="shrink-0 w-7 h-7 rounded-full bg-white/50 inset-shadow-sm inset-shadow-white shadow-sm flex items-center justify-center text-black/70 text-xs font-semibold">
        {initials(message.author)}
    </div>
    <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-1.5">
            <span class="text-xs font-semibold text-black/80">{message.author}</span>
            <span class="text-[10px] text-black/40">{formatTime(message.time)}</span>
        </div>

        {#if editing}
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
            {#if !truncate}
                <button
                    onclick={() => (editing = true)}
                    class="text-[10px] text-black/30 hover:text-black/50 mt-0.5"
                >Edit</button>
            {/if}
        {/if}
    </div>
</div>
