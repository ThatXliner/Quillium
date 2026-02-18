<script lang="ts">
    import type { Thread, ThreadMessage } from ".";

    let {
        message,
        thread,
        index,
        updateThread,
    }: {
        message: ThreadMessage;
        updateThread: (thread: Thread) => void;
        thread: Thread;
        index: number;
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
    <div class="shrink-0 w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-semibold">
        {initials(message.author)}
    </div>
    <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-1.5">
            <span class="text-xs font-semibold text-gray-800">{message.author}</span>
            <span class="text-[10px] text-gray-400">{formatTime(message.time)}</span>
        </div>

        {#if editing}
            <textarea
                bind:value={editMessage}
                class="mt-1 w-full text-xs rounded border border-gray-200 p-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
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
                    class="text-xs font-medium text-blue-500 hover:text-blue-700 disabled:opacity-50"
                >Save</button>
                <button
                    onclick={() => { editing = false; editMessage = message.message; }}
                    class="text-xs text-gray-400 hover:text-gray-600"
                >Cancel</button>
            </div>
        {:else}
            <p class="text-xs text-gray-700 mt-0.5 leading-relaxed whitespace-pre-wrap">{message.message}</p>
            <button
                onclick={() => (editing = true)}
                class="text-[10px] text-gray-400 hover:text-gray-600 mt-0.5"
            >Edit</button>
        {/if}
    </div>
</div>
