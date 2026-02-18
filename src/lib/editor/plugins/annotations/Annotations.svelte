<script lang="ts">
    /*
     * ANNOTATIONS PANEL - GOOGLE DOCS STYLE POSITIONING SYSTEM
     *
     * This component creates a dynamic annotations panel that positions comments, revisions,
     * and suggestions next to their corresponding text in the editor, similar to Google Docs.
     *
     * === ARCHITECTURE OVERVIEW ===
     *
     * 1. COORDINATE CALCULATION
     *    - Uses CodeMirror's coordsAtPos() to get pixel coordinates of text selections
     *    - Converts editor coordinates to annotation panel coordinates
     *    - Accounts for scroll position and viewport changes
     *
     * 2. POSITIONING ALGORITHM
     *    - Sorts annotations by their text position in the document
     *    - Calculates visual positions based on where their text appears on screen
     *    - Prevents overlaps through intelligent stacking logic
     *    - Gives priority to active annotations to keep them near their text
     *
     * 3. OVERLAP PREVENTION STRATEGY
     *    - When no annotation is active: strict sequential stacking (zero overlap)
     *    - When annotation is active: active one can position near text, others stack
     *    - Uses real DOM measurements (offsetHeight) for accurate spacing
     *    - Maintains minimum spacing between annotations
     *
     * 4. REACTIVITY & PERFORMANCE
     *    - Svelte reactive statements automatically recalculate positions
     *    - Debounced updates during scroll/resize for smooth performance
     *    - CSS transforms for hardware-accelerated animations
     *    - Position changes trigger at 60fps maximum
     *
     * 5. STATE MANAGEMENT
     *    - Tracks annotation elements in annotationElements object
     *    - Listens to editor state changes (scroll, content, selection)
     *    - Syncs with global stores (annotations, activeAnnotation, editorView)
     *
     * === STEP-BY-STEP POSITIONING FLOW ===
     *
     * 1. getAnnotationVisualPosition() calculates where each annotation should appear
     * 2. positionedAnnotations() reactive statement creates position data for all annotations
     * 3. updateAnnotationPositions() prevents overlaps and applies CSS transforms
     * 4. debouncedUpdatePositions() throttles updates during rapid events
     * 5. Event listeners trigger updates on scroll, resize, and content changes
     *
     * The result is a smooth, responsive annotation panel that maintains perfect alignment
     * with text while ensuring all annotations remain readable through intelligent stacking.
     */

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

    /**
     * ANNOTATION REMOVAL HANDLER
     * Dispatches a CodeMirror state update to remove an annotation from the editor.
     * This triggers the removal from both the editor state and the UI.
     *
     * @param index - The ID of the annotation to remove
     */
    function remove(index: number) {
        if (!$annotations) return;
        $editorView.dispatch(
            $editorView.state.update({
                effects: [removeAnnotation.of($annotations[index])],
            }),
        );
    }

    /**
     * THREAD UPDATE HANDLER
     * Updates the conversation thread for a specific annotation (adding replies, etc.).
     * Dispatches a CodeMirror state update to persist the thread changes.
     *
     * @param annotationId - The ID of the annotation to update
     * @param newThread - The updated thread data with new messages
     */
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
    /**
     * VISUAL POSITION CALCULATOR
     * Core function that determines where an annotation should appear in the panel
     * based on where its corresponding text is positioned in the editor viewport.
     *
     * ALGORITHM:
     * 1. Get pixel coordinates of the annotation's text selection using CodeMirror
     * 2. Calculate position relative to the annotation panel's viewport
     * 3. Apply offset adjustments for better visual alignment with text lines
     *
     * @param annotation - The annotation to calculate position for
     * @returns Y coordinate (pixels from top of panel) where annotation should appear
     */
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

    /**
     * SORTED ANNOTATIONS REACTIVE STATEMENT
     * Automatically sorts all annotations by their text position in the document.
     * This ensures annotations appear in the same order as their text, regardless
     * of creation order or ID numbers.
     */
    const sortedAnnotations = $derived(
        $annotations
            ? Object.values($annotations).sort(
                  (a, b) => a.selection.main.from - b.selection.main.from,
              )
            : [],
    );

    /**
     * POSITIONED ANNOTATIONS REACTIVE STATEMENT
     * Combines annotation data with their calculated visual positions.
     * This reactive statement automatically recalculates whenever:
     * - Annotations change (added/removed/modified)
     * - Editor view changes (scroll, resize, content changes)
     * - Active annotation changes
     *
     * @returns Array of objects containing annotation + its calculated position
     */
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

    /**
     * POSITION UPDATE REACTIVE EFFECT
     * Automatically triggers position updates when annotations or active annotation changes.
     * Uses Svelte's $effect to watch for state changes and update positions accordingly.
     * The tick() ensures DOM updates are complete before calculating positions.
     */
    $effect(() => {
        if ($activeAnnotation || sortedAnnotations.length) {
            tick().then(updateAnnotationPositions);
        }
    });

    /**
     * DEBOUNCED POSITION UPDATES
     * Throttles position update calls to prevent excessive calculations during
     * rapid events like scrolling or resizing. Limits updates to 60fps maximum.
     *
     * WHY DEBOUNCING IS NEEDED:
     * - Scroll events can fire hundreds of times per second
     * - Each position calculation involves DOM measurements and coordinate math
     * - Without debouncing, the UI would lag during scroll
     */
    let updateTimeout: number;
    function debouncedUpdatePositions() {
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updateAnnotationPositions, 16); // ~60fps
    }

    /**
     * MAIN POSITIONING ALGORITHM
     * The heart of the annotation positioning system. Prevents overlaps and applies
     * CSS transforms to position annotations correctly.
     *
     * STEP-BY-STEP PROCESS:
     * 1. Get all positioned annotations with their ideal visual positions
     * 2. Sort by visual position to determine stacking order
     * 3. Calculate adjusted positions to prevent overlaps:
     *    - If no active annotation: strict sequential stacking (zero overlap)
     *    - If active annotation exists: give it positioning priority, stack others
     * 4. Measure actual DOM element heights for accurate spacing
     * 5. Apply CSS transforms to move annotations to calculated positions
     *
     * OVERLAP PREVENTION LOGIC:
     * - Uses lastBottomPosition to track where the next annotation can start
     * - Active annotations can deviate from strict stacking to stay near their text
     * - Non-active annotations always stack sequentially for maximum readability
     */
    function updateAnnotationPositions() {
        if (!annotationPanelElement || !$editorView) return;

        const positions = positionedAnnotations();
        const MIN_SPACING = 0; // Spacing between annotations
        const PANEL_PADDING = 16; // Account for panel padding

        // Calculate non-overlapping positions
        const adjustedPositions: { [id: number]: number } = {};

        // Sort by visual position for proper stacking
        const sortedByPosition = [...positions].sort(
            (a, b) => a.visualPosition - b.visualPosition,
        );

        let lastBottomPosition = PANEL_PADDING;

        sortedByPosition.forEach(({ annotation, visualPosition }) => {
            const element = annotationElements[annotation.id];
            let annotationHeight = 120; // Default fallback

            // Get actual height if element exists
            if (element) {
                annotationHeight = element.offsetHeight || 120;
            }

            let adjustedPosition;

            if ($activeAnnotation) {
                // When there's an active annotation, allow some flexibility for active one
                if ($activeAnnotation.id === annotation.id) {
                    // Active annotation gets priority - try to stay close to original position
                    adjustedPosition = Math.max(
                        visualPosition,
                        lastBottomPosition,
                        PANEL_PADDING,
                    );
                } else {
                    // Non-active annotations must not overlap - strict stacking
                    adjustedPosition = lastBottomPosition;
                }
            } else {
                // When no active annotation, ensure zero overlap for readability - strict stacking
                adjustedPosition = lastBottomPosition;
            }

            adjustedPositions[annotation.id] = Math.max(
                adjustedPosition,
                PANEL_PADDING,
            );
            lastBottomPosition =
                adjustedPosition + annotationHeight + MIN_SPACING;
        });

        // Apply positions with smooth transitions
        positions.forEach(({ annotation }) => {
            const element = annotationElements[annotation.id];
            if (element) {
                const position =
                    adjustedPositions[annotation.id] || PANEL_PADDING;
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

<div
    bind:this={annotationPanelElement}
    class="p-4 bg-white h-full flex flex-col overflow-hidden"
>
    {#if sortedAnnotations && $annotations !== undefined}
        {@const a = Object.values(sortedAnnotations)}
        {#each a as c}
            {@const i = c.id}
            {@const isActive = $activeAnnotation?.id === c.id}
            {@const isPendingComment =
                !canCreateNewComment($annotations) &&
                i === Math.max(...a.map((x) => x.id))}
            <div
                bind:this={annotationElements[i]}
                class="annotation-item absolute w-[calc(100%-2rem)] transition-transform duration-300 ease-out"
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
            <div class="flex flex-col items-center justify-center h-full py-12 gap-2 text-center">
                <div class="text-gray-300 text-2xl select-none">✎</div>
                <div class="text-sm text-gray-400">No annotations yet</div>
            </div>
        {/each}

        {#if !canCreateNewComment($annotations)}
            {@const bottomPosition = sortedAnnotations.length * 152 + 32}
            <div
                class="absolute w-[calc(100%-2rem)]"
                style="top: {bottomPosition}px;"
            >
                <PreComment />
            </div>
        {/if}
    {/if}
</div>
