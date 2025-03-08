<script lang="ts">
import Comment from "./Comment.svelte";

import {
	removeAnnotation as removeCommentEffect,
	updateAnnotation,
	type Annotation,
	type Comment as CommentType,
	type Thread,
} from "$lib/editor/plugins/annotations";
import {
	activeComment,
	canCreateNewComment,
	comments,
	editorView,
} from "$lib/stores";
import { tick } from "svelte";
import { isEqual } from "lodash-es";
let commentText = $state("");
let textarea = $state<HTMLTextAreaElement | undefined>();
function addComment() {
	const newComment: Annotation<CommentType> = {
		selection: $comments[$comments.length - 1].selection,
		value: {
			thread: [
				{ message: commentText, author: "User", time: Date.now() },
			],
			type: "comment",
		},
	};

	$editorView.dispatch(
		$editorView.state.update({
			effects: [updateAnnotation.of(newComment)],
		}),
	);
	commentText = "";
	canCreateNewComment.set(true);
}
function cancelComment() {
	removeComment($comments.length - 1);
	canCreateNewComment.set(true);
	commentText = "";
}
function removeComment(index: number) {
	$editorView.dispatch(
		$editorView.state.update({
			effects: [removeCommentEffect.of($comments[index])],
		}),
	);
}
canCreateNewComment.subscribe((value) => {
	console.log(value);
	if (!value) {
		tick().then(() => {
			textarea?.focus();
		});
	}
});
</script>

<!-- Probably not a good way to make it "sticky".. should probably rethink the entire layout lol -->
<div
  class="w-[300px] p-2 pl-5 rounded bg-white h-screen overflow-y-scroll sticky top-0 space-y-4 flex flex-col"
>
  {#each $comments as c, i}
    {@const isActive = isEqual($activeComment, c)}
    {#if !(!$canCreateNewComment && i === $comments.length - 1)}
      <Comment
        comment={c}
        {isActive}
        removeComment={removeComment.bind(null, i)}
        updateThread={(thread: Thread) => {
          $editorView.dispatch(
            $editorView.state.update({
              effects: [updateAnnotation.of({ value: { type: "comment", thread }, selection: c.selection })],
            })
          );
        }}
      ></Comment>
    {/if}
  {:else}
    <div class="flex items-center justify-center h-full my-auto text-gray-500">
      No comments
    </div>
  {/each}

  {#if !$canCreateNewComment}
    <div class="flex flex-col gap-2 mt-3">
      <textarea
        tabindex="0"
        bind:this={textarea}
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
