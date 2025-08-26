<script lang="ts">
    // TODO: input/create annotations in relative order
    import Comment from "./Comment.svelte";

    import {
        isAnnotationOfType,
        removeAnnotation,
        updateThread,
        type Thread,
    } from "$lib/editor/plugins/annotations";
    import { activeComment, annotations, editorView } from "$lib/stores";

    import Revision from "./Revision.svelte";
    import { canCreateNewComment } from "./utils";
    import PreComment from "./PreComment.svelte";

    function remove(index: number) {
        if (!$annotations) return;
        $editorView.dispatch(
            $editorView.state.update({
                effects: [removeAnnotation.of($annotations[index])],
            }),
        );
    }

    function dispatchUpdateThread(annotationId: number, newThread: Thread) {
        $editorView.dispatch(
            $editorView.state.update({
                effects: [
                    updateThread.of({
                        annotationId,
                        newThread,
                    }),
                ],
            }),
        );
    }
</script>

<!-- Probably not a good way to make it "sticky".. should probably rethink the entire layout lol -->
<div
    class="w-[300px] p-2 pl-5 rounded bg-white h-screen overflow-y-scroll sticky top-0 space-y-4 flex flex-col"
>
    {#if $annotations}
        {#each $annotations as c, i}
            {@const isActive = $activeComment?.id === c.id}
            {@const isPendingComment = !(
                !canCreateNewComment($annotations) &&
                i === $annotations.length - 1
            )}
            {#if isAnnotationOfType(c, "comment") && isPendingComment}
                <Comment
                    comment={c}
                    {isActive}
                    removeComment={remove.bind(null, i)}
                    updateThread={dispatchUpdateThread.bind(null, i)}
                ></Comment>
            {/if}
            {#if isAnnotationOfType(c, "revision")}
                <Revision
                    revision={c}
                    isActive={true}
                    remove={remove.bind(null, i)}
                    updateThread={dispatchUpdateThread.bind(null, i)}
                ></Revision>
            {/if}
        {:else}
            <div
                class="flex items-center justify-center h-full my-auto text-gray-500"
            >
                No annotations
            </div>
        {/each}

        {#if !canCreateNewComment($annotations)}
            <PreComment />
        {/if}
    {/if}
</div>
