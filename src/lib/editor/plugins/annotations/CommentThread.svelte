<script lang='ts'>
import CommentThreadMessage from "./CommentThreadMessage.svelte";

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
				<CommentThreadMessage message={message} index={i} updateThread={updateThread} thread={thread}/>
		{/each}
</div>
