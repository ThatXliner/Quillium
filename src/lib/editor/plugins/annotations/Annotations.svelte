<script lang="ts">
/**
 * Annotations.svelte — Container that renders all annotation
 * cards (comments, revisions, suggestions) in either a
 * "floating" layout (absolutely positioned beside the editor)
 * or an "inline" layout (stacked vertically inside a sidebar).
 *
 * Props:
 *   - view?: EditorView — CodeMirror instance (falls back to
 *     the global editorView store)
 *   - annotationsData?: AnnotationMap — annotation map (falls
 *     back to the global annotations store)
 *   - activeAnnotationData?: GenericAnnotation — currently
 *     selected annotation (falls back to activeAnnotation store)
 *   - layout?: "floating" | "inline" — positioning strategy
 *
 * Events emitted: none (dispatches CodeMirror effects directly)
 * Stores read: editorView, annotations, activeAnnotation
 *   (only when corresponding props are not provided)
 *
 * Parent: +page.svelte (floating), RevisionModal.svelte (inline)
 * Children: Comment, Revision, Suggestion, PreComment
 *
 * Floating layout uses viewport-relative positioning: each card
 * is absolutely placed at the Y coordinate of its annotation's
 * text range, with overlap avoidance that pushes cards downward.
 * A ResizeObserver recalculates positions when card heights
 * change (e.g. nested editor toggle).
 */
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
import { activeAnnotation, annotations, editorView, annotationUiEvent } from "$lib/stores";
import Revision from "./Revision.svelte";
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

// Resolve props vs global stores so child components get a
// single consistent data source regardless of context.
const resolvedView = $derived(view ?? $editorView);
const resolvedAnnotations = $derived(annotationsData ?? $annotations);
const resolvedActiveAnnotation = $derived(activeAnnotationData ?? $activeAnnotation);
const isFloating = $derived(layout === "floating");

/**
 * Remove an annotation by its ID from the CodeMirror state.
 */
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

/**
 * Replace the thread of a given annotation via the CodeMirror
 * updateThread effect.
 */
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

/**
 * Check whether a click/key event target is an interactive
 * element (button, input, etc.) so that the card-level click
 * handler can avoid stealing focus.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest("button, input, textarea, select, a[href], [contenteditable='true']");
}

/**
 * Map an annotation to its viewport Y coordinate by looking
 * up the screen position of the annotation's start offset.
 */
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

/**
 * Compute the left pixel offset for the floating annotation
 * column, positioned to the right of the editor document.
 */
function getAnnotationLeft(): number {
    if (!resolvedView) return 0;
    const rect = resolvedView.scrollDOM.getBoundingClientRect();
    return rect.left + rect.width / 2 + 408 + 16;
}

let scrollContainer = $state<HTMLDivElement | undefined>();

// Sort annotations by document position for stable rendering
const sortedAnnotations = $derived(
    resolvedAnnotations
        ? Object.values(resolvedAnnotations).sort(
              (a, b) => a.selection.main.from - b.selection.main.from,
          )
        : [],
);
const pendingComment = $derived(
    sortedAnnotations.find(
        (annotation) => isAnnotationOfType(annotation, "comment") && annotation.thread.length === 0,
    ),
);

// Pair each annotation with its viewport Y position
const positionedAnnotations = $derived(() => {
    if (!sortedAnnotations.length || !resolvedView || !isFloating) return [];
    return sortedAnnotations.map((annotation) => ({
        annotation,
        viewportY: getAnnotationViewportY(annotation),
    }));
});

let annotationElements: { [id: number]: HTMLDivElement } = $state({});
let resizeObserver: ResizeObserver | undefined;

// Reposition cards when the active annotation or list changes
$effect(() => {
    if (!isFloating) return;
    if (resolvedActiveAnnotation !== undefined || sortedAnnotations.length) {
        tick().then(updateAnnotationPositions);
    }
});

// Re-run positioning whenever any card changes height
// (e.g. nested editor toggle). Re-observes whenever the
// annotation list changes.
$effect(() => {
    if (!isFloating) return;
    void sortedAnnotations; // track additions/removals
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => debouncedUpdatePositions());
    tick().then(() => {
        for (const el of Object.values(annotationElements)) {
            if (el) resizeObserver?.observe(el);
        }
    });
    return () => resizeObserver?.disconnect();
});

let updateTimeout: ReturnType<typeof setTimeout>;
function debouncedUpdatePositions() {
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(updateAnnotationPositions, 16);
}

/**
 * Core layout algorithm for floating mode: assigns each card
 * a top position aligned to its annotation's viewport Y, with
 * downward nudging to prevent overlap. Also scrolls the
 * container to keep the active card visible.
 */
function updateAnnotationPositions() {
    if (!resolvedView || !isFloating) return;

    const positions = positionedAnnotations();
    const MIN_SPACING = 8;
    const TOP_CLAMP = 64;
    const leftPx = getAnnotationLeft();

    const sortedByPos = [...positions].sort((a, b) => a.viewportY - b.viewportY);

    // Walk cards top-to-bottom, pushing each below the previous
    const adjustedY: { [id: number]: number } = {};
    let lastBottom = TOP_CLAMP;

    for (const { annotation, viewportY } of sortedByPos) {
        const el = annotationElements[annotation.id];
        const height = el ? el.offsetHeight || 80 : 80;
        const y = Math.max(viewportY, lastBottom, TOP_CLAMP);
        adjustedY[annotation.id] = y;
        lastBottom = y + height + MIN_SPACING;
    }

    updateScrollContainerSize(lastBottom, leftPx);
    applyCardPositions(positions, adjustedY, TOP_CLAMP);
    scrollActiveCardIntoView(adjustedY);
}

/**
 * Resize the inner scroll container so it can hold all cards,
 * and position it at the correct horizontal offset.
 */
function updateScrollContainerSize(lastBottom: number, leftPx: number) {
    if (!scrollContainer) return;
    const inner = scrollContainer.firstElementChild as HTMLElement | null;
    if (inner) inner.style.height = `${lastBottom + 24}px`;
    scrollContainer.style.left = `${leftPx}px`;
}

/**
 * Apply computed top/left positions to each card DOM element.
 */
function applyCardPositions(
    positions: { annotation: GenericAnnotation; viewportY: number }[],
    adjustedY: { [id: number]: number },
    topClamp: number,
) {
    for (const { annotation } of positions) {
        const el = annotationElements[annotation.id];
        if (el) {
            el.style.top = `${adjustedY[annotation.id] ?? topClamp}px`;
            el.style.left = "0px";
        }
    }
}

/**
 * If an annotation is active, scroll the floating container
 * so that card is fully visible.
 */
function scrollActiveCardIntoView(adjustedY: { [id: number]: number }) {
    if (!scrollContainer || !resolvedActiveAnnotation) return;
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
            scrollContainer.scrollTo({
                top: cardBottom - containerHeight + 16,
                behavior: "smooth",
            });
        }
    }
}

// Track which pending card is currently showing the alert animation
let alertingPendingId = $state<number | undefined>(undefined);
let lastPendingAlertToken = 0;

// React to pending-comment events: scroll the pending card
// into view, then play a shake + red-outline-fade animation on it.
$effect(() => {
    if (!isFloating) return;
    const event = $annotationUiEvent;
    if (
        !event ||
        event.token === lastPendingAlertToken ||
        event.type !== "pending-comment-alert" ||
        !pendingComment
    )
        return;
    lastPendingAlertToken = event.token;

    const el = annotationElements[pendingComment.id];
    if (!el) return;

    // Scroll the editor to show the pending comment's highlighted text
    if (resolvedView) {
        resolvedView.dispatch({
            selection: { anchor: pendingComment.selection.main.from },
            scrollIntoView: true,
        });
    }

    // Scroll the pending card into view
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // Trigger shake + ring by setting alertingPendingId.
    alertingPendingId = pendingComment.id;
    el.classList.add("pending-shake");
    setTimeout(() => {
        el.classList.remove("pending-shake");
        alertingPendingId = undefined;
    }, 1400);
});

// Listen for editor scroll and window resize to reposition cards
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
                    {@const isPendingComment = pendingComment?.id === c.id}
                    <div
                        bind:this={annotationElements[i]}
                        class="annotation-card"
                        class:is-active={isActive}
                        style="z-index: {isActive ? 120 : isPendingComment ? 110 : 50};"
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
                        {#if isAnnotationOfType(c, "comment") && isPendingComment}
                            <PreComment
                                view={resolvedView}
                                annotationsData={resolvedAnnotations}
                                pendingAnnotation={c}
                                activeAnnotationData={resolvedActiveAnnotation}
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
                        {#if alertingPendingId === c.id}
                            <div class="alert-ring rounded-[14px]"></div>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>
    {:else}
        <div class="annotation-inline-list">
            {#each sortedAnnotations as c}
                {@const i = c.id}
                {@const isActive = resolvedActiveAnnotation?.id === c.id}
                {@const isPendingComment = pendingComment?.id === c.id}
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
                    {#if isAnnotationOfType(c, "comment") && isPendingComment}
                        <PreComment
                            view={resolvedView}
                            annotationsData={resolvedAnnotations}
                            pendingAnnotation={c}
                            activeAnnotationData={resolvedActiveAnnotation}
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

    @keyframes pending-shake {
        0%   { transform: translateX(0); }
        10%  { transform: translateX(-6px); }
        20%  { transform: translateX(6px); }
        30%  { transform: translateX(-5px); }
        40%  { transform: translateX(5px); }
        50%  { transform: translateX(-3px); }
        60%  { transform: translateX(3px); }
        70%  { transform: translateX(-1px); }
        80%  { transform: translateX(1px); }
        100% { transform: translateX(0); }
    }

    :global(.annotation-card.pending-shake) {
        animation: pending-shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
    }

    /* Overlay div sits on top of the card content as a sibling,
       so it's never clipped by overflow-hidden on the inner card. */
    .alert-ring {
        position: absolute;
        inset: 0;
        pointer-events: none;
        animation: pending-ring-fade 1.4s ease-out both;
        /* ring-rose-400 = #fb7185, 3px, matches blue's chroma */
        box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85);
    }

    @keyframes pending-ring-fade {
        0%   { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85); }
        70%  { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0.85); }
        100% { box-shadow: 0 0 0 3px rgba(251, 113, 133, 0); }
    }
</style>
