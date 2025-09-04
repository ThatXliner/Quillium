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
    let annotationPositions = $state<
        Map<number, { base: number; adjusted: number }>
    >(new Map());
    let editorScrollTop = $state(0);

    // Calculate annotation positions with collision detection
    function updateAnnotationPositions() {
        if (!$editorView || !$annotations || !containerEl) return;

        const a = Object.values($annotations);
        if (a.length === 0) return;

        const scrollTop = $editorView.scrollDOM.scrollTop;
        editorScrollTop = scrollTop;

        // First pass: get base positions from editor
        const basePositions = new Map<number, number>();
        for (const annotation of a) {
            const coords = $editorView.coordsAtPos(
                annotation.selection.main.from,
            );
            if (coords) {
                const relativeTop =
                    coords.top -
                    $editorView.scrollDOM.getBoundingClientRect().top +
                    scrollTop;
                basePositions.set(annotation.id, relativeTop);
            }
        }

        // Sort annotations by their base position
        const sortedAnnotations = [...a].sort((a, b) => {
            const posA = basePositions.get(a.id) || 0;
            const posB = basePositions.get(b.id) || 0;
            return posA - posB;
        });

        // Second pass: adjust positions to prevent overlap
        const adjustedPositions = new Map<
            number,
            { base: number; adjusted: number }
        >();
        const ANNOTATION_MIN_HEIGHT = 120; // Estimated minimum height of annotation
        const ANNOTATION_MARGIN = 16; // Margin between annotations
        const GROUP_THRESHOLD = 30; // Annotations within this distance are grouped

        let lastBottom = -Infinity;
        let groupStart = -1;
        let groupAnnotations: typeof sortedAnnotations = [];

        for (let i = 0; i < sortedAnnotations.length; i++) {
            const annotation = sortedAnnotations[i];
            const basePos = basePositions.get(annotation.id) || 0;
            const nextBasePos =
                i < sortedAnnotations.length - 1
                    ? basePositions.get(sortedAnnotations[i + 1].id) || 0
                    : Infinity;

            // Check if this is part of a group
            if (groupStart === -1) {
                groupStart = basePos;
                groupAnnotations = [annotation];
            } else {
                groupAnnotations.push(annotation);
            }

            // Check if we should end the group
            const shouldEndGroup =
                nextBasePos - basePos > GROUP_THRESHOLD ||
                i === sortedAnnotations.length - 1;

            if (shouldEndGroup) {
                // Position all annotations in the group
                let groupTop = Math.max(
                    groupStart,
                    lastBottom + ANNOTATION_MARGIN,
                );

                for (let j = 0; j < groupAnnotations.length; j++) {
                    const groupAnnotation = groupAnnotations[j];
                    const adjustedPos =
                        groupTop +
                        j * (ANNOTATION_MIN_HEIGHT + ANNOTATION_MARGIN);

                    adjustedPositions.set(groupAnnotation.id, {
                        base: basePositions.get(groupAnnotation.id) || 0,
                        adjusted: adjustedPos,
                    });

                    lastBottom = adjustedPos + ANNOTATION_MIN_HEIGHT;
                }

                // Reset group
                groupStart = -1;
                groupAnnotations = [];
            }
        }

        annotationPositions = adjustedPositions;
    }

    // Update positions when annotations change
    $effect(() => {
        if ($annotations && $editorView) {
            // Small delay to allow for smooth transitions
            requestAnimationFrame(() => {
                updateAnnotationPositions();
            });
        }
    });

    // Set up scroll listener with debouncing
    onMount(() => {
        if (!$editorView) return;

        let scrollTimeout: ReturnType<typeof setTimeout>;
        const handleScroll = () => {
            // Immediate update for responsiveness
            updateAnnotationPositions();

            // Debounced update for final positioning
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                updateAnnotationPositions();
            }, 100);
        };

        $editorView.scrollDOM.addEventListener("scroll", handleScroll);

        // Initial position calculation
        updateAnnotationPositions();

        return () => {
            $editorView?.scrollDOM.removeEventListener("scroll", handleScroll);
            clearTimeout(scrollTimeout);
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
            {@const sortedAnnotations = a.sort(
                (a, b) => a.selection.main.from - b.selection.main.from,
            )}
            {#each sortedAnnotations as c (c.id)}
                {@const i = c.id}
                {@const isActive = $activeComment?.id === c.id}
                {@const isPendingComment = !(
                    !canCreateNewComment($annotations) && i === a.length - 1
                )}
                {@const positionData = annotationPositions.get(c.id)}
                {@const position = positionData?.adjusted || 0}
                {@const basePosition = positionData?.base || 0}
                {@const isDisplaced = position !== basePosition}

                <div
                    class="absolute left-0 right-0 transition-all duration-500 ease-out"
                    style="top: {position}px; transform: translateY({isActive
                        ? -4
                        : 0}px); z-index: {isActive ? 10 : 1};"
                >
                    <!-- Visual connector line when annotation is displaced -->
                    {#if isDisplaced && !isActive}
                        <svg
                            class="absolute -left-8 pointer-events-none opacity-30"
                            style="top: -8px; width: 32px; height: {position -
                                basePosition +
                                16}px;"
                        >
                            <path
                                d="M 28 4 Q 16 4, 16 16 L 16 {position -
                                    basePosition}"
                                stroke="currentColor"
                                stroke-width="1"
                                fill="none"
                                stroke-dasharray="2,2"
                                class="text-gray-400"
                            />
                        </svg>
                    {/if}

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
            <div class="flex items-center justify-center h-full text-gray-500">
                No annotations
            </div>
        {/if}
    </div>
</div>
