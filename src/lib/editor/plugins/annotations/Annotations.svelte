<script lang="ts">
    // TODO: input/create annotations in relative order
    import Comment from "./Comment.svelte";

    import {
        isAnnotationOfType,
        removeAnnotation,
        updateThread,
        type Thread,
        type GenericAnnotation,
    } from "$lib/editor/plugins/annotations";
    import { activeAnnotation, annotations, editorView } from "$lib/stores";

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
    // Calculate visual position of annotations based on their text position
    function getAnnotationVisualPosition(
        annotation: GenericAnnotation,
    ): number {
        if (!$editorView) return 0;

        try {
            const coords = $editorView.coordsAtPos(
                annotation.selection.main.from,
            );
            if (!coords) return 0;

            // Get the viewport position relative to the panel
            const panelRect = annotationPanelElement?.getBoundingClientRect();
            const editorRect = $editorView.dom.getBoundingClientRect();

            if (!panelRect || !editorRect) return 0;

            // Calculate position relative to the annotation panel's top
            const relativePosition = coords.top - panelRect.top;

            // Add some offset to align better with the text line
            return Math.max(0, relativePosition - 10);
        } catch {
            return 0;
        }
    }

    const sortedAnnotations = $derived(
        $annotations
            ? Object.values($annotations).sort(
                  (a, b) => a.selection.main.from - b.selection.main.from,
              )
            : [],
    );

    // Create positioned annotations with calculated visual positions
    const positionedAnnotations = $derived(() => {
        if (!sortedAnnotations.length || !$editorView) return [];

        return sortedAnnotations.map((annotation, index) => ({
            annotation,
            visualPosition: getAnnotationVisualPosition(annotation),
            index,
        }));
    });

    let annotationPanelElement: HTMLDivElement;
    let annotationElements: { [id: number]: HTMLDivElement } = {};

    // Update positions when annotations or active annotation changes
    $effect(() => {
        if ($activeAnnotation || sortedAnnotations.length) {
            tick().then(updateAnnotationPositions);
        }
    });

    // Debounce position updates for better performance
    let updateTimeout: number;
    function debouncedUpdatePositions() {
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updateAnnotationPositions, 16); // ~60fps
    }

    function updateAnnotationPositions() {
        if (!annotationPanelElement || !$editorView) return;

        const positions = positionedAnnotations();
        const ANNOTATION_HEIGHT = 120; // Approximate height of an annotation
        const MIN_SPACING = 8; // Minimum spacing between annotations

        // Calculate non-overlapping positions
        const adjustedPositions: { [id: number]: number } = {};

        // Sort by visual position for proper stacking
        const sortedByPosition = [...positions].sort(
            (a, b) => a.visualPosition - b.visualPosition,
        );

        let lastBottomPosition = 0;

        sortedByPosition.forEach(({ annotation, visualPosition }) => {
            let adjustedPosition = Math.max(visualPosition, lastBottomPosition);

            // Give priority to active annotation - keep it close to its original position
            if ($activeAnnotation?.id === annotation.id) {
                adjustedPosition = Math.max(
                    visualPosition,
                    lastBottomPosition - ANNOTATION_HEIGHT / 2,
                );
            }

            adjustedPositions[annotation.id] = Math.max(0, adjustedPosition);
            lastBottomPosition =
                adjustedPosition + ANNOTATION_HEIGHT + MIN_SPACING;
        });

        // Apply positions with smooth transitions
        positions.forEach(({ annotation }) => {
            const element = annotationElements[annotation.id];
            if (element) {
                const position = adjustedPositions[annotation.id] || 0;
                element.style.transform = `translateY(${position}px)`;
            }
        });
    }

    onMount(() => {
        // Update positions on scroll and resize with debouncing
        const updateOnScroll = () => debouncedUpdatePositions();

        if ($editorView?.scrollDOM) {
            $editorView.scrollDOM.addEventListener("scroll", updateOnScroll);
        }

        window.addEventListener("resize", updateOnScroll);

        return () => {
            clearTimeout(updateTimeout);
            if ($editorView?.scrollDOM) {
                $editorView.scrollDOM.removeEventListener(
                    "scroll",
                    updateOnScroll,
                );
            }
            window.removeEventListener("resize", updateOnScroll);
        };
    });
</script>

<!-- Probably not a good way to make it "sticky".. should probably rethink the entire layout lol -->
<div
    bind:this={annotationPanelElement}
    class="p-2 pl-5 rounded bg-white min-h-screen h-full sticky top-0 flex flex-col"
    style="scroll-behavior: smooth;"
>
    <!-- Honestly, the !== undefined is just for the type checker -->
    {#if sortedAnnotations && $annotations !== undefined}
        {@const a = Object.values(sortedAnnotations)}
        {#each a as c}
            {@const i = c.id}
            {@const isActive = $activeAnnotation?.id === c.id}
            <!-- TODO: i need to make annotations a proper class... -->
            {@const isPendingComment =
                !canCreateNewComment($annotations) &&
                i === Math.max(...a.map((x) => x.id))}
            <div
                bind:this={annotationElements[i]}
                class="annotation-item absolute w-full transition-transform duration-300 ease-out"
                class:active={isActive}
                style="z-index: {isActive ? 10 : 1};"
            >
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
            </div>
        {:else}
            <div
                class="flex items-center justify-center h-full my-auto text-gray-500"
            >
                No annotations
            </div>
        {/each}

        {#if !canCreateNewComment($annotations)}
            <div class="absolute bottom-4 w-full pr-7">
                <PreComment />
            </div>
        {/if}
    {/if}
</div>
