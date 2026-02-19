<script lang="ts">
    /*
     * FLOATING ANNOTATIONS - GOOGLE DOCS STYLE
     *
     * Comments are fixed-positioned to the right of the 816px document card,
     * vertically aligned with their text selection. They scroll with the page
     * naturally because positions are recalculated on every scroll event.
     */

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

    /**
     * Returns the viewport Y coordinate for this annotation's text selection.
     * coordsAtPos() already returns viewport-relative coordinates.
     */
    function getAnnotationViewportY(annotation: GenericAnnotation): number {
        if (!$editorView) return 0;
        try {
            const coords = $editorView.coordsAtPos(
                annotation.selection.main.from,
            );
            if (!coords) return 0;
            return coords.top - 10;
        } catch {
            return 0;
        }
    }

    /**
     * Returns the fixed left offset for annotation cards.
     * Annotations sit 16px to the right of the 816px document card,
     * which is centered in the editor pane.
     */
    function getAnnotationLeft(): number {
        if (!$editorView) return 0;
        const rect = $editorView.scrollDOM.getBoundingClientRect();
        // Center of scroll container + half doc width + gap
        return rect.left + rect.width / 2 + 408 + 16;
    }

    const sortedAnnotations = $derived(
        $annotations
            ? Object.values($annotations).sort(
                  (a, b) => a.selection.main.from - b.selection.main.from,
              )
            : [],
    );

    const positionedAnnotations = $derived(() => {
        if (!sortedAnnotations.length || !$editorView) return [];
        return sortedAnnotations.map((annotation) => ({
            annotation,
            viewportY: getAnnotationViewportY(annotation),
        }));
    });

    let annotationElements: { [id: number]: HTMLDivElement } = {};

    $effect(() => {
        if ($activeAnnotation !== undefined || sortedAnnotations.length) {
            tick().then(updateAnnotationPositions);
        }
    });

    let updateTimeout: number;
    function debouncedUpdatePositions() {
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updateAnnotationPositions, 16);
    }

    function updateAnnotationPositions() {
        if (!$editorView) return;

        const positions = positionedAnnotations();
        const MIN_SPACING = 8;
        const TOP_CLAMP = 64; // don't go above status bar
        const leftPx = getAnnotationLeft();

        const sortedByPos = [...positions].sort(
            (a, b) => a.viewportY - b.viewportY,
        );

        const adjustedY: { [id: number]: number } = {};
        let lastBottom = TOP_CLAMP;

        sortedByPos.forEach(({ annotation, viewportY }) => {
            const el = annotationElements[annotation.id];
            const height = el ? el.offsetHeight || 80 : 80;

            let y: number;
            if ($activeAnnotation?.id === annotation.id) {
                y = Math.max(viewportY, lastBottom, TOP_CLAMP);
            } else {
                y = Math.max(lastBottom, TOP_CLAMP);
            }

            adjustedY[annotation.id] = y;
            lastBottom = y + height + MIN_SPACING;
        });

        positions.forEach(({ annotation }) => {
            const el = annotationElements[annotation.id];
            if (el) {
                el.style.top = `${adjustedY[annotation.id] ?? TOP_CLAMP}px`;
                el.style.left = `${leftPx}px`;
            }
        });
    }

    onMount(() => {
        const update = () => debouncedUpdatePositions();
        $editorView?.scrollDOM.addEventListener("scroll", update);
        window.addEventListener("resize", update);
        return () => {
            clearTimeout(updateTimeout);
            $editorView?.scrollDOM.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
        };
    });
</script>

{#if sortedAnnotations && $annotations !== undefined}
    {#each sortedAnnotations as c}
        {@const i = c.id}
        {@const isActive = $activeAnnotation?.id === c.id}
        {@const isPendingComment =
            !canCreateNewComment($annotations) &&
            i === Math.max(...sortedAnnotations.map((x) => x.id))}
        <div
            bind:this={annotationElements[i]}
            class="annotation-card"
            class:is-active={isActive}
            style="z-index: {isActive ? 100 : 50};"
            onclick={() => { if (!isActive) $activeAnnotation = c; }}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") $activeAnnotation = c; }}
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
    {/each}

    {#if !canCreateNewComment($annotations)}
        <div class="annotation-card" style="z-index: 50;">
            <PreComment />
        </div>
    {/if}
{/if}

<style>
    .annotation-card {
        position: fixed;
        top: 64px; /* initial — overwritten by JS */
        left: 0;   /* initial — overwritten by JS */
        width: 240px;
        transition: top 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        pointer-events: auto;
    }
</style>
