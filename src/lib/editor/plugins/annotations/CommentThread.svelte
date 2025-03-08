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

let editingIndex: number | null = $state(null);
let editMessage = $state("");

function startEditing(index: number) {
	editingIndex = index;
	editMessage = thread[index].message;
}

function saveEdit() {
	if (editingIndex !== null) {
		const newThread = [...thread];
		newThread[editingIndex] = {
			...thread[editingIndex],
			message: editMessage,
		};
		updateThread(newThread);
		editingIndex = null;
	}
}
</script>

<div class="space-y-4">
		{#each thread as message, i}
				<CommentThreadMessage message={message} index={i} updateThread={updateThread} thread={thread}/>
		{/each}
</div>
