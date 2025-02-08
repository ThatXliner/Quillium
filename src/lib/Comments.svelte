<script lang="ts">
  import { canCreateNewComment, comments, editorView } from "./stores";
  import {
    addComment as addCommentEffect,
    removeComment as removeCommentEffect,
    updateComment,
  } from "$lib/plugins/comments";
  import { Trash2 } from "lucide-svelte";
  let commentText = "";

  function addComment() {
    const state = $editorView.state;
    const newComment = { selection: state.selection, text: commentText };

    $editorView.dispatch(
      state.update({
        effects: [updateComment.of(newComment)],
      })
    );
    commentText = "";
    canCreateNewComment.set(true);
  }
  function removeComment(index: number) {
    $editorView.dispatch(
      $editorView.state.update({
        effects: [removeCommentEffect.of($comments[index])],
      })
    );
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
        <div class="flex justify-end">
          <button
            class="text-gray-400 hover:text-gray-600 transition-colors"
            onclick={() => removeComment(i)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    {/if}
  {/each}

  {#if !$canCreateNewComment}
    <div class="flex flex-col gap-2 mt-3">
      <textarea
        bind:value={commentText}
        placeholder="Add a comment..."
        class="resize-none p-3 h-[80px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      ></textarea>
      <button
        disabled={!commentText}
        onclick={addComment}
        class="self-end px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:hover:bg-blue-500 text-sm font-medium"
      >
        Comment
      </button>
    </div>
  {/if}
</div>
