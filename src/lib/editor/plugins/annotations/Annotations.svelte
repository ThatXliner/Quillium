<script lang="ts">
    import type { EditorView } from "@codemirror/view";
    import Comment from "./Comment.svelte";
    import {
        annotationField,
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
        if (!resolvedView) return;
        const annotation = resolvedView.state.field(annotationField)[index];
        if (!annotation) return;
        resolvedView.dispatch(
            resolvedView.state.update({
                effects: [removeAnnotation.of(annotation)],
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

    let scrollContainer = $state<HTMLDivElement | undefined>();

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

    let annotationElements: { [id: number]: HTMLDivElement } = $state({});
    let resizeObserver: ResizeObserver | undefined;

    $effect(() => {
        if (!isFloating) return;
        if (resolvedActiveAnnotation !== undefined || sortedAnnotations.length) {
            tick().then(updateAnnotationPositions);
        }
    });

    // Re-run positioning whenever any card changes height (e.g. nested editor toggle).
    // Re-observes whenever the annotation list changes.
    $effect(() => {
        if (!isFloating) return;
        void sortedAnnotations; // track additions/removals
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver(() => debouncedUpdatePositions());
        tick().then(() => {
            for (const el of Object.values(annotationElements)) {
                if (el) resizeObserver!.observe(el);
            }
        });
        return () => resizeObserver?.disconnect();
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

        // Update inner container height so it's tall enough to contain all cards
        if (scrollContainer) {
            const inner = scrollContainer.firstElementChild as HTMLElement | null;
            if (inner) inner.style.height = `${lastBottom + 24}px`;
            // Position the scroll container at the right x coordinate
            scrollContainer.style.left = `${leftPx}px`;
        }

        positions.forEach(({ annotation }) => {
            const el = annotationElements[annotation.id];
            if (el) {
                el.style.top = `${adjustedY[annotation.id] ?? TOP_CLAMP}px`;
                el.style.left = "0px";
            }
        });

        // Scroll the container so the active card is visible
        if (scrollContainer && resolvedActiveAnnotation) {
            const activeEl = annotationElements[resolvedActiveAnnotation.id];
            const activeTop = adjustedY[resolvedActiveAnnotation.id];
            if (activeEl && activeTop !== undefined) {
                const cardHeight = activeEl.offsetHeight;
                const containerHeight = scrollContainer.clientHeight;
                const currentScroll = scrollContainer.scrollTop;
                const cardBottom = activeTop + cardHeight;
                if (activeTop < currentScroll) {
                    scrollContainer.scrollTo({ top: activeTop - 16, behavior: "smooth" });
                } else if (cardBottom > currentScroll + containerHeight) {
                    scrollContainer.scrollTo({ top: cardBottom - containerHeight + 16, behavior: "smooth" });
                }
            }
        }
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
    {#if isFloating}
        <div class="annotation-scroll-container" bind:this={scrollContainer}>
            <div class="annotation-scroll-inner">
                {#each sortedAnnotations as c}
                    {@const i = c.id}
                    {@const isActive = resolvedActiveAnnotation?.id === c.id}
                    {@const isPendingComment =
                        !canCreateNewComment(resolvedAnnotations) &&
                        i === Math.max(...sortedAnnotations.map((x) => x.id))}
                    <div
                        bind:this={annotationElements[i]}
                        class="annotation-card"
                        class:is-active={isActive}
                        style="z-index: {isActive ? 100 : 50};"
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
                    <div class="annotation-card">
                        <PreComment
                            view={resolvedView}
                            annotationsData={resolvedAnnotations}
                            activeAnnotationData={resolvedActiveAnnotation}
                        />
                    </div>
                {/if}
            </div>
        </div>
    {:else}
        <div class="annotation-inline-list">
            {#each sortedAnnotations as c}
                {@const i = c.id}
                {@const isActive = resolvedActiveAnnotation?.id === c.id}
                {@const isPendingComment =
                    !canCreateNewComment(resolvedAnnotations) &&
                    i === Math.max(...sortedAnnotations.map((x) => x.id))}
                <div
                    bind:this={annotationElements[i]}
                    class="annotation-card-inline"
                    class:is-active={isActive}
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
                <div class="annotation-card-inline">
                    <PreComment
                        view={resolvedView}
                        annotationsData={resolvedAnnotations}
                        activeAnnotationData={resolvedActiveAnnotation}
                    />
                </div>
            {/if}
        </div>
    {/if}
{/if}

<style>
    .annotation-scroll-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 256px;
        height: 100vh;
        overflow-y: auto;
        overflow-x: visible;
        overscroll-behavior: contain;
        pointer-events: none;
        z-index: 50;
        /* hide scrollbar visually but keep it functional */
        scrollbar-width: none;
    }

    .annotation-scroll-container::-webkit-scrollbar {
        display: none;
    }

    .annotation-scroll-inner {
        position: relative;
        width: 240px;
        pointer-events: none;
    }

    .annotation-card {
        position: absolute;
        top: 64px;
        left: 0;
        width: 240px;
        pointer-events: auto;
        transition: top 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .annotation-inline-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .annotation-card-inline {
        position: relative;
        width: 100%;
    }
</style>
