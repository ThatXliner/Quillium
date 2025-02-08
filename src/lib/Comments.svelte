<script lang="ts">
  import { canCreateNewComment, comments, editorView } from "./stores";
  import { addComment as addCommentEffect } from "$lib/plugins/comments";

  let commentText = "";

  function addComment() {
    const state = $editorView.state;
    const newComment = { selection: state.selection, text: commentText };

    $editorView.dispatch(
      state.update({
        effects: [addCommentEffect.of(newComment)],
      })
    );
    commentText = "";
    canCreateNewComment.set(true);
  }
</script>

<div class="w-[300px] m-2 p-2 rounded bg-white">
  {#each $comments as c, i}
    {#if !(!$canCreateNewComment && i === $comments.length - 1)}
      <div
        class="bg-gray-50 rounded-lg p-3 my-2 shadow-sm border border-gray-200"
      >
        <div class="text-sm text-gray-700"></div>
        <p class="whitespace-pre-wrap">{c.text}</p>
        <div class="mt-2 text-xs text-gray-500 flex items-center">
          <span>Just now</span>
          <!-- Add more metadata here if needed -->
        </div>
      </div>
    {/if}
  {/each}

  {#if !$canCreateNewComment}
    <div class="flex flex-col">
      <textarea
        bind:value={commentText}
        placeholder="Add a comment..."
        class="resize-none p-1 h-[40px] mb-1"
      ></textarea>
      <button
        disabled={!commentText}
        on:click={addComment}
        class="self-end disabled:opacity-50"
      >
        Comment
      </button>
    </div>
  {/if}
</div>
