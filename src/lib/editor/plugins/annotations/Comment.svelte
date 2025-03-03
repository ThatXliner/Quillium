<script lang="ts">
import { SparklesIcon, Trash2 } from "lucide-svelte";

const {
	thread,
	isActive,
	removeComment,
	updateComment,
}: {
	thread: string[];
	isActive: boolean;
	removeComment: () => void;
	updateComment: (thread: string[]) => void;
} = $props();

let commentText = $state(thread[0]);
let isEditing = $state(false);
function save() {
	// TODO: proper thread
	updateComment([commentText]);
	isEditing = false;
}
</script>

<div
  class="bg-gray-50 rounded-lg p-3 my-2 shadow-sm ring-2 {isActive
    ? 'ring-blue-500 ring-4'
    : 'ring-gray-500'}"
>
  <div class="text-sm text-gray-700"></div>
  {#if isEditing}
    <textarea
      bind:value={commentText}
      class="w-full resize-none p-2 rounded border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
      onkeydown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          save();
        }
      }}
    >
    </textarea>
    <div class="mt-2 flex justify-end gap-2">
      <button
        class="text-sm text-gray-600 hover:text-gray-800"
        onclick={() => {
          save();
        }}
      >
        Save
      </button>
    </div>
  {:else}
    <p class="whitespace-pre-wrap">{commentText}</p>
    <div class="mt-2 text-xs text-gray-500 flex items-center">
      <span>Insert metadata here</span>
    </div>
    <div class="flex justify-end gap-2">
      <button
        class="text-gray-400 hover:text-gray-600 transition-colors"
        onclick={() => {
          isEditing = true;
        }}
      >
        Edit
      </button>
      <button
        class="text-gray-400 hover:text-gray-600 transition-colors"
        onclick={() => {
          isEditing = true;
        }}
      >
        <SparklesIcon/>
      </button>
      <button
        class="text-gray-400 hover:text-gray-600 transition-colors"
        onclick={() => removeComment()}
      >
        <Trash2 size={16} />
      </button>
    </div>
  {/if}
</div>
