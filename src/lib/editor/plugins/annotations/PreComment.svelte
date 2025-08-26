<script lang="ts">
    import { activeComment, annotations, editorView } from "$lib/stores";
    import { tick } from "svelte";
    import { updateThread, removeAnnotation } from "./annotationField";
    import { canCreateNewComment } from "./utils";

    let commentText = $state("");
    let textarea = $state<HTMLTextAreaElement | undefined>();
    annotations.subscribe((a) => {
        if (!a) return;
        const value = canCreateNewComment(a);
        if (!value) {
            tick().then(() => {
                textarea?.focus();
            });
        }
    });
    function addComment() {
        if (!$activeComment) return;
        $editorView.dispatch(
            $editorView.state.update({
                effects: [
                    updateThread.of({
                        annotationId: $activeComment.id,
                        newThread: [
                            ...$activeComment.thread,
                            {
                                message: commentText,
                                author: "User",
                                time: Date.now(),
                            },
                        ],
                    }),
                ],
            }),
        );
        commentText = "";
    }
    function cancelComment() {
        if (!$activeComment) return;
        $editorView.dispatch(
            $editorView.state.update({
                effects: [removeAnnotation.of($activeComment)],
            }),
        );
        commentText = "";
    }
</script>

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
