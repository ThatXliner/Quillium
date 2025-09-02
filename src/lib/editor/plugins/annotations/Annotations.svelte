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
    import { onMount, tick } from "svelte";

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

    let containerEl = $state<HTMLDivElement>();
    let annotationPositions = $state<Map<number, number>>(new Map());
    let editorScrollTop = $state(0);

    // Calculate annotation positions based on their location in the editor
    function updateAnnotationPositions() {
        if (!$editorView || !$annotations || !containerEl) return;

        const newPositions = new Map<number, number>();
        const scrollTop = $editorView.scrollDOM.scrollTop;
        editorScrollTop = scrollTop;

        for (const annotation of Object.values($annotations)) {
            const coords = $editorView.coordsAtPos(annotation.selection.main.from);
            if (coords) {
                // Calculate relative position from the top of the viewport
                const relativeTop = coords.top - $editorView.scrollDOM.getBoundingClientRect().top + scrollTop;
                newPositions.set(annotation.id, relativeTop);
            }
        }

        annotationPositions = newPositions;
    }

    // Update positions when annotations change
    $effect(() => {
        if ($annotations && $editorView) {
            updateAnnotationPositions();
        }
    });

    // Set up scroll listener
    onMount(() => {
        if (!$editorView) return;

        const handleScroll = () => {
            updateAnnotationPositions();
        };

        $editorView.scrollDOM.addEventListener('scroll', handleScroll);
        
        // Initial position calculation
        updateAnnotationPositions();

        return () => {
            $editorView?.scrollDOM.removeEventListener('scroll', handleScroll);
        };
    });
</script>

<div
    bind:this={containerEl}
    class="relative h-screen overflow-y-auto bg-white rounded-lg"
    style="scroll-behavior: smooth;"
>
    <div class="relative p-4" style="min-height: 100vh;">
        {#if $annotations && Object.keys($annotations).length > 0}
            {@const a = Object.values($annotations)}
            {@const sortedAnnotations = a.sort((a, b) => 
                a.selection.main.from - b.selection.main.from
            )}
            {#each sortedAnnotations as c (c.id)}
                {@const i = c.id}
                {@const isActive = $activeComment?.id === c.id}
                {@const isPendingComment = !(
                    !canCreateNewComment($annotations) && i === a.length - 1
                )}
                {@const position = annotationPositions.get(c.id) || 0}
                
                <div
                    class="absolute left-0 right-0 transition-all duration-300 ease-out"
                    style="top: {position}px; transform: translateY({isActive ? -4 : 0}px);"
                >
                    {#if isAnnotationOfType(c, "comment") && isPendingComment}
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
                </div>
            {/each}

            {#if !canCreateNewComment($annotations)}
                <div class="mt-8">
                    <PreComment />
                </div>
            {/if}
        {:else}
            <div
                class="flex items-center justify-center h-full text-gray-500"
            >
                No annotations
            </div>
        {/if}
    </div>
</div>
