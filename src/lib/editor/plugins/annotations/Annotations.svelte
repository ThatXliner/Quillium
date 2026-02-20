<script lang="ts">
    import type { EditorView } from "@codemirror/view";
    import Comment from "./Comment.svelte";
    import {
        isAnnotationOfType,
        removeAnnotation,
        updateThread,
        type Annotations as AnnotationMap,
        type GenericAnnotation,
        type Thread,
    } from "$lib/editor/plugins/annotations";
    import { activeAnnotation, annotations, editorView } from "$lib/stores";
    import Revision from "./Revision.svelte";
    import { canCreateNewComment } from "./utils";
    import PreComment from "./PreComment.svelte";
    import Suggestion from "./Suggestion.svelte";
    import { tick } from "svelte";

    const {
        view = undefined,
        annotationsData = undefined,
        activeAnnotationData = undefined,
        layout = "floating",
    }: {
        view?: EditorView;
        annotationsData?: AnnotationMap;
        activeAnnotationData?: GenericAnnotation;
        layout?: "floating" | "inline";
    } = $props();

    const resolvedView = $derived(view ?? $editorView);
    const resolvedAnnotations = $derived(annotationsData ?? $annotations);
    const resolvedActiveAnnotation = $derived(activeAnnotationData ?? $activeAnnotation);
    const isFloating = $derived(layout === "floating");

    function remove(index: number) {
        if (!resolvedAnnotations || !resolvedView) return;
        resolvedView.dispatch(
            resolvedView.state.update({
                effects: [removeAnnotation.of(resolvedAnnotations[index])],
            }),
        );
    }

    function dispatchUpdateThread(annotationId: number, newThread: Thread) {
        if (!resolvedView) return;
        resolvedView.dispatch(
            resolvedView.state.update({
                effects: [
                    updateThread.of({
                        annotationId,
                        newThread,
                    }),
                ],
            }),
        );
    }

    function isInteractiveTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false;
        return !!target.closest(
            "button, input, textarea, select, a[href], [contenteditable='true']",
        );
    }

    function getAnnotationViewportY(annotation: GenericAnnotation): number {
        if (!resolvedView) return 0;
        try {
            const coords = resolvedView.coordsAtPos(annotation.selection.main.from);
            if (!coords) return 0;
            return coords.top - 10;
        } catch {
            return 0;
        }
    }

    function getAnnotationLeft(): number {
        if (!resolvedView) return 0;
        const rect = resolvedView.scrollDOM.getBoundingClientRect();
        return rect.left + rect.width / 2 + 408 + 16;
    }

    const sortedAnnotations = $derived(
        resolvedAnnotations
            ? Object.values(resolvedAnnotations).sort(
                  (a, b) => a.selection.main.from - b.selection.main.from,
              )
            : [],
    );

    const positionedAnnotations = $derived(() => {
        if (!sortedAnnotations.length || !resolvedView || !isFloating) return [];
        return sortedAnnotations.map((annotation) => ({
            annotation,
            viewportY: getAnnotationViewportY(annotation),
        }));
    });

    let annotationElements: { [id: number]: HTMLDivElement } = {};

    $effect(() => {
        if (!isFloating) return;
        if (resolvedActiveAnnotation !== undefined || sortedAnnotations.length) {
            tick().then(updateAnnotationPositions);
        }
    });

    let updateTimeout: number;
    function debouncedUpdatePositions() {
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updateAnnotationPositions, 16);
    }

    function updateAnnotationPositions() {
        if (!resolvedView || !isFloating) return;

        const positions = positionedAnnotations();
        const MIN_SPACING = 8;
        const TOP_CLAMP = 64;
        const leftPx = getAnnotationLeft();

        const sortedByPos = [...positions].sort(
            (a, b) => a.viewportY - b.viewportY,
        );

        const adjustedY: { [id: number]: number } = {};
        let lastBottom = TOP_CLAMP;

        sortedByPos.forEach(({ annotation, viewportY }) => {
            const el = annotationElements[annotation.id];
            const height = el ? el.offsetHeight || 80 : 80;
            const y = Math.max(viewportY, lastBottom, TOP_CLAMP);
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

    $effect(() => {
        if (!isFloating || !resolvedView) return;
        const update = () => debouncedUpdatePositions();
        resolvedView.scrollDOM.addEventListener("scroll", update);
        window.addEventListener("resize", update);
        return () => {
            clearTimeout(updateTimeout);
            resolvedView.scrollDOM.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
        };
    });
</script>

{#if sortedAnnotations && resolvedAnnotations !== undefined && resolvedView}
    <div class:annotation-inline-list={!isFloating}>
        {#each sortedAnnotations as c}
            {@const i = c.id}
            {@const isActive = resolvedActiveAnnotation?.id === c.id}
            {@const isPendingComment =
                !canCreateNewComment(resolvedAnnotations) &&
                i === Math.max(...sortedAnnotations.map((x) => x.id))}
            <div
                bind:this={annotationElements[i]}
                class="annotation-card"
                class:annotation-card-inline={!isFloating}
                class:is-active={isActive}
                style={isFloating ? `z-index: ${isActive ? 100 : 50};` : ""}
                onclick={(e) => {
                    if (isInteractiveTarget(e.target)) return;
                    if (!isActive && resolvedView) {
                        resolvedView.dispatch({
                            selection: { anchor: c.selection.main.from },
                            scrollIntoView: true,
                        });
                        resolvedView.focus();
                    }
                }}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                    if (isInteractiveTarget(e.target)) return;
                    if ((e.key === "Enter" || e.key === " ") && resolvedView) {
                        resolvedView.dispatch({
                            selection: { anchor: c.selection.main.from },
                            scrollIntoView: true,
                        });
                        resolvedView.focus();
                    }
                }}
            >
                {#if isAnnotationOfType(c, "comment") && !isPendingComment}
                    <Comment
                        comment={c}
                        view={resolvedView}
                        {isActive}
                        removeComment={remove.bind(null, i)}
                        updateThread={dispatchUpdateThread.bind(null, i)}
                    />
                {/if}
                {#if isAnnotationOfType(c, "revision")}
                    <Revision
                        revision={c}
                        view={resolvedView}
                        {isActive}
                        remove={remove.bind(null, i)}
                        updateThread={dispatchUpdateThread.bind(null, i)}
                    />
                {/if}
                {#if isAnnotationOfType(c, "suggestion")}
                    <Suggestion
                        suggestion={c}
                        view={resolvedView}
                        {isActive}
                        remove={remove.bind(null, i)}
                        updateThread={dispatchUpdateThread.bind(null, i)}
                    />
                {/if}
            </div>
        {/each}

        {#if !canCreateNewComment(resolvedAnnotations)}
            <div class="annotation-card" class:annotation-card-inline={!isFloating}>
                <PreComment
                    view={resolvedView}
                    annotationsData={resolvedAnnotations}
                    activeAnnotationData={resolvedActiveAnnotation}
                />
            </div>
        {/if}
    </div>
{/if}

<style>
    .annotation-inline-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .annotation-card {
        position: fixed;
        top: 64px;
        left: 0;
        width: 240px;
        max-height: calc(100vh - 88px);
        overflow-y: auto;
        overscroll-behavior: contain;
        transition: top 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        pointer-events: auto;
    }

    .annotation-card-inline {
        position: relative;
        top: auto;
        left: auto;
        width: 100%;
        transition: none;
    }
</style>
