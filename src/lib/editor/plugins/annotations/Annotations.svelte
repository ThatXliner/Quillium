<script lang="ts">
// TODO: input/create annotations in relative order
import Comment from "./Comment.svelte";

import {
	removeAnnotation,
	updateAnnotation,
	type Annotation,
	type Comment as CommentType,
	type Revision as RevisionType,
	type Thread,
} from "$lib/editor/plugins/annotations";
import {
	activeComment,
	canCreateNewComment,
	annotations,
	editorView,
} from "$lib/stores";
import { tick } from "svelte";
import { isEqual } from "lodash-es";
import Revision from "./Revision.svelte";
let commentText = $state("");
let textarea = $state<HTMLTextAreaElement | undefined>();
function addComment() {
	const newComment: Annotation<CommentType> = {
		selection: $annotations[$annotations.length - 1].selection,
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
	remove($annotations.length - 1);
	canCreateNewComment.set(true);
	commentText = "";
}
function remove(index: number) {
	$editorView.dispatch(
		$editorView.state.update({
			effects: [removeAnnotation.of($annotations[index])],
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
$inspect($annotations);
</script>

<!-- Probably not a good way to make it "sticky".. should probably rethink the entire layout lol -->
<div
  class="w-[300px] p-2 pl-5 rounded bg-white h-screen overflow-y-scroll sticky top-0 space-y-4 flex flex-col"
>
  {#each $annotations as c, i}
    {@const isActive = isEqual($activeComment, c)}
    {#if c.value.type === "comment" && !(!$canCreateNewComment && i === $annotations.length - 1)}
      <Comment
        comment={c as Annotation<CommentType>}
        {isActive}
        removeComment={remove.bind(null, i)}
        updateThread={(thread: Thread) => {
          $editorView.dispatch(
            $editorView.state.update({
              effects: [updateAnnotation.of({ value: { type: "comment", thread }, selection: c.selection })],
            })
          );
        }}
      ></Comment>
    {/if}
    {#if c.value.type === "revision"}
      <Revision
        revision={c as Annotation<RevisionType>}
        isActive={true}
        remove={remove.bind(null, i)}
        updateThread={(thread: Thread) => {
          $editorView.dispatch(
            $editorView.state.update({
              effects: [updateAnnotation.of({ value: { type: "comment", thread }, selection: c.selection })],
            })
          );
        }}
      ></Revision>
    {/if}
  {:else}
    <div class="flex items-center justify-center h-full my-auto text-gray-500">
      No annotations
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
