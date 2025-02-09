<script lang="ts">
  import {
    activeComment,
    canCreateNewComment,
    comments,
    editorView,
  } from "./stores";
  import {
    getActiveComment,
    removeComment as removeCommentEffect,
    updateComment,
    type Comment,
  } from "$lib/plugins/comments";
  import { Trash2 } from "lucide-svelte";
  let commentText = "";

  function addComment() {
    const newComment = {
      selection: $comments[$comments.length - 1].selection,
      text: commentText,
    };

    $editorView.dispatch(
      $editorView.state.update({
        effects: [updateComment.of(newComment)],
      })
    );
    commentText = "";
    canCreateNewComment.set(true);
  }
  function cancelComment() {
    removeComment($comments.length - 1);
    canCreateNewComment.set(true);
  }
  function removeComment(index: number) {
    $editorView.dispatch(
      $editorView.state.update({
        effects: [removeCommentEffect.of($comments[index])],
      })
    );
  }
  function _compareComments(a: Comment | null, b: Comment) {
    return a?.selection?.eq?.(b.selection) && a?.text === b.text;
  }
</script>

<!-- Probably not a good way to make it "sticky".. should probably rethink the entire layout lol -->
<div
  class="w-[300px] p-2 rounded bg-white h-screen overflow-y-scroll sticky top-0"
>
  {#each $comments as c, i}
    {@const isActive = _compareComments($activeComment, c)}
    {#if !(!$canCreateNewComment && i === $comments.length - 1)}
      <div
        class="bg-gray-50 rounded-lg p-3 my-2 shadow-sm ring-2 {isActive
          ? 'ring-blue-500 ring-4'
          : 'ring-gray-500'}"
      >
        <div class="text-sm text-gray-700"></div>
        <p class="whitespace-pre-wrap">{c.text}</p>
        <div class="mt-2 text-xs text-gray-500 flex items-center">
          <span>Insert metadata here</span>
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
        onkeydown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && commentText) {
            addComment();
            // @ts-ignore
            e.target.blur();
          }
        }}
        placeholder="Add a comment..."
        class="resize-none p-3 h-[80px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      ></textarea>
      <div class="flex space-x-3">
        <button
          disabled={!commentText}
          onclick={addComment}
          class="self-end px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:hover:bg-blue-500 text-sm font-medium"
        >
          Comment
        </button>
        <button
          onclick={() => cancelComment()}
          class="self-end px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium mr-2"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}
</div>
