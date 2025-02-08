<script lang="ts">
  import { onMount } from "svelte";
  import type { Comment } from "./plugins/comments";
  import { canCreateNewComment, comments, editorState } from "./stores";

  let commentText = "";

  function addComment() {
    $comments = [
      ...$comments,
      { selection: $editorState.selection, text: commentText },
    ];
    commentText = "";
    canCreateNewComment.set(false);
  }

  function enableCommentCreation() {
    canCreateNewComment.set(true);
  }
</script>

<div class="comment-container">
  {#each $comments as c, i}
    <div class="comment-item" contenteditable="true">
      {c.text}
    </div>
  {/each}

  {#if $canCreateNewComment}
    <div class="comment-editor">
      <textarea bind:value={commentText} placeholder="Add a comment..."
      ></textarea>
      <button disabled={!commentText} on:click={addComment}>Comment</button>
    </div>
  {:else}
    <button on:click={enableCommentCreation}>New Comment</button>
  {/if}
</div>

<style>
  .comment-container {
    font-family: Arial, sans-serif;
    width: 300px;
    border: 1px solid #ddd;
    margin: 8px 0;
    padding: 8px;
    border-radius: 4px;
    background: #fff;
  }
  .comment-item {
    border-bottom: 1px solid #eee;
    padding: 4px 0;
    margin: 4px 0;
  }
  .comment-item:last-child {
    border-bottom: none;
  }
  .comment-editor {
    display: flex;
    flex-direction: column;
  }
  .comment-editor textarea {
    resize: none;
    padding: 4px;
    height: 40px;
    margin-bottom: 4px;
  }
  .comment-editor button {
    align-self: flex-end;
  }
</style>
