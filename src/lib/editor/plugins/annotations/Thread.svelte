<script lang="ts">
    /**
     * Thread.svelte — Renders a vertical list of ThreadMessage cards.
     *
     * Props:
     *   - thread: Thread — array of ThreadMessage objects to display
     *   - updateThread: (thread: Thread) => void — callback to replace
     *     the entire thread array (used by child ThreadMessage on edit)
     *
     * Events emitted: none (delegates mutation via updateThread callback)
     * Stores: none
     *
     * Parent: Comment.svelte, Revision.svelte, Suggestion.svelte
     * Children: ThreadMessage.svelte (one per message)
     */
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
