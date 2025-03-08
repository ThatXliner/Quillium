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
let editing: boolean = $state(false);
let editMessage: string = $state(message.message);
function startEditing() {
	editing = true;
}

function saveEdit() {
	const newThread = [...thread];
	newThread[index] = {
		...thread[index],
		message: editMessage,
	};
	updateThread(newThread);
	editing = false;
}
</script>

<div class="bg-white shadow rounded-lg p-4">
  <div class="flex justify-between items-start">
    <div class="font-medium text-gray-900">{message.author}</div>
    <div class="text-sm text-gray-500">
      {new Intl.DateTimeFormat("default", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(message.time))}
    </div>
  </div>

  {#if editing}
    <div class="mt-2">
      <textarea
        bind:value={editMessage}
        class="w-full p-2 border rounded"
        rows="3"
        onkeydown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && editMessage) {
            saveEdit();
            // @ts-ignore
            e.target.blur();
          }
        }}
      ></textarea>
      <div class="mt-2 space-x-2">
        <button
          onclick={saveEdit}
          disabled={!editMessage}
          class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onclick={() => {
            editing = false;
            editMessage = message.message;
          }}
          class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
        >
          Cancel
        </button>
      </div>
    </div>
  {:else}
    <p class="mt-2 whitespace-pre-wrap">{message.message}</p>
    <button
      onclick={() => startEditing()}
      class="mt-2 text-sm text-blue-500 hover:text-blue-700"
    >
      Edit
    </button>
  {/if}
</div>
