<script lang="ts">
    import ThreadMessage from "./ThreadMessage.svelte";

    import type { Thread } from ".";

    let {
        thread,
        updateThread,
    }: {
        thread: Thread;
        updateThread: (thread: Thread) => void;
    } = $props();
</script>

<div class="space-y-4">
    {#each thread as message, i}
        <ThreadMessage {message} index={i} {updateThread} {thread} />
    {/each}
</div>
