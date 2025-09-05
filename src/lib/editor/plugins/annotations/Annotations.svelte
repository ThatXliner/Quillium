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
    import Suggestion from "./Suggestion.svelte";

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
    class="p-2 pl-5 rounded bg-white min-h-screen overflow-y-scroll sticky top-0 space-y-4 flex flex-col"
>
    {#if $annotations}
        {@const a = Object.values($annotations)}
        {#each a as c}
            {@const i = c.id}
            {@const isActive = $activeComment?.id === c.id}
            <!-- TODO: i need to make annotations a proper class... -->
            {@const isPendingComment =
                !canCreateNewComment($annotations) &&
                i === Math.max(...a.map((x) => x.id))}
            {#if isAnnotationOfType(c, "comment") && !isPendingComment}
                <Comment
                    comment={c}
                    {isActive}
                    removeComment={remove.bind(null, i)}
                    updateThread={dispatchUpdateThread.bind(null, i)}
                />
            {/if}
            <!-- TODO: replace isActive with activeAnnotation or something like that -->
            {#if isAnnotationOfType(c, "revision")}
                <Revision
                    revision={c}
                    {isActive}
                    remove={remove.bind(null, i)}
                    updateThread={dispatchUpdateThread.bind(null, i)}
                />
            {/if}
            {#if isAnnotationOfType(c, "suggestion")}
                <Suggestion
                    suggestion={c}
                    {isActive}
                    remove={remove.bind(null, i)}
                    updateThread={dispatchUpdateThread.bind(null, i)}
                />
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
