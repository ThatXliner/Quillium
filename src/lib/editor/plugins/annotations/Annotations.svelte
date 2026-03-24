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
import { activeAnnotation, annotations, editorView, selectedText } from "$lib/stores";
import { annotationEventBus } from "./eventBus";
import Revision from "./Revision.svelte";
import PreComment from "./PreComment.svelte";
import Suggestion from "./Suggestion.svelte";
import type { Action } from "svelte/action";
import { tick } from "svelte";
import Kbd from "$lib/ui/Kbd.svelte";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";
const opt = isMac ? "⌥" : "Alt";

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

let scrollContainer: HTMLDivElement | undefined;

// Sort annotations by document position for stable rendering
const sortedAnnotations = $derived(
    resolvedAnnotations
        ? Object.values(resolvedAnnotations).sort(
              (a, b) => a.selection.main.from - b.selection.main.from,
          )
        : [],
);

const hasSelection = $derived($selectedText.length > 0);
const isSingleWordSelection = $derived(
    hasSelection && !/\s/.test($selectedText) && $selectedText.length <= 60,
);
const hasComments = $derived(sortedAnnotations.some((a) => isAnnotationOfType(a, "comment")));
const hasRevisions = $derived(sortedAnnotations.some((a) => isAnnotationOfType(a, "revision")));

// selectionY is computed via $effect instead of $derived because
// coordsAtPos can trigger a CodeMirror measure cycle that fires
// the updateListener → store write, which is forbidden inside $derived.
let selectionY = $state<number | null>(null);
$effect(() => {
    void $selectedText; // re-run when selection changes
    if (!resolvedView || !hasSelection) {
        selectionY = null;
        return;
    }
    const sel = resolvedView.state.selection.main;
    try {
        const from = resolvedView.coordsAtPos(sel.from);
        const to = resolvedView.coordsAtPos(sel.to);
        if (!from || !to) {
            selectionY = null;
            return;
        }
        selectionY = (from.top + to.bottom) / 2;
    } catch {
        selectionY = null;
    }
});
const pendingComment = $derived(
    sortedAnnotations.find(
        (annotation) => isAnnotationOfType(annotation, "comment") && annotation.thread.length === 0,
    ),
);

// Compute positioned annotations on demand (NOT in $derived —
// coordsAtPos can trigger a CodeMirror measure cycle that fires
// the updateListener, which writes to Svelte stores. Writing to
// $state inside $derived throws state_unsafe_mutation.)
function getPositionedAnnotations() {
    if (!sortedAnnotations.length || !resolvedView || !isFloating) return [];
    return sortedAnnotations.map((annotation) => ({
        annotation,
        viewportY: getAnnotationViewportY(annotation),
    }));
}

const annotationElements: { [id: number]: HTMLDivElement | undefined } = {};
let annotationElementsVersion = $state(0);

const annotationElement: Action<HTMLDivElement, number> = (node, id) => {
    let currentId = id;
    if (currentId !== undefined) {
        annotationElements[currentId] = node;
        annotationElementsVersion++;
    }
    return {
        update(nextId) {
            if (currentId !== undefined && annotationElements[currentId] === node) {
                delete annotationElements[currentId];
            }
            currentId = nextId;
            if (currentId !== undefined) {
                annotationElements[currentId] = node;
            }
            annotationElementsVersion++;
        },
        destroy() {
            if (currentId !== undefined && annotationElements[currentId] === node) {
                delete annotationElements[currentId];
                annotationElementsVersion++;
            }
        },
    };
};
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
    void annotationElementsVersion; // re-observe when elements register
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
 * a top position aligned to its annotation's viewport Y.
 *
 * Google Docs-style: the active card anchors at its natural text
 * Y first. Cards above it are pushed upward to avoid overlap;
 * cards below it are pushed downward. This ensures the selected
 * card always sits next to its highlighted text rather than being
 * displaced by earlier cards.
 */
function updateAnnotationPositions() {
    if (!resolvedView || !isFloating) return;

    const positions = getPositionedAnnotations();
    const MIN_SPACING = 8;
    const TOP_CLAMP = 64;
    const leftPx = getAnnotationLeft();

    const sortedByPos = [...positions].sort((a, b) => a.viewportY - b.viewportY);
    const adjustedY: { [id: number]: number } = {};

    // Find the active card index in the sorted list
    const activeIdx = resolvedActiveAnnotation
        ? sortedByPos.findIndex((p) => p.annotation.id === resolvedActiveAnnotation?.id)
        : -1;

    if (activeIdx === -1) {
        // No active card: simple top-to-bottom pass (original behaviour)
        let lastBottom = TOP_CLAMP;
        for (const { annotation, viewportY } of sortedByPos) {
            const el = annotationElements[annotation.id];
            const height = el ? el.offsetHeight || 80 : 80;
            const y = Math.max(viewportY, lastBottom, TOP_CLAMP);
            adjustedY[annotation.id] = y;
            lastBottom = y + height + MIN_SPACING;
        }
    } else {
        // Active card anchors at its natural text Y
        const activeItem = sortedByPos[activeIdx];
        const activeEl = annotationElements[activeItem.annotation.id];
        const activeHeight = activeEl ? activeEl.offsetHeight || 80 : 80;
        const activeY = activeItem.viewportY;
        adjustedY[activeItem.annotation.id] = activeY;

        // Walk cards ABOVE the active card upward (reverse order).
        // Prefer natural Y; push up past the top edge if needed —
        // the scroll container will hide them until the user scrolls.
        {
            let ceiling = activeY - MIN_SPACING;
            for (let i = activeIdx - 1; i >= 0; i--) {
                const { annotation, viewportY } = sortedByPos[i];
                const el = annotationElements[annotation.id];
                const height = el ? el.offsetHeight || 80 : 80;
                const y = Math.min(viewportY, ceiling - height);
                adjustedY[annotation.id] = y;
                ceiling = y - MIN_SPACING;
            }
        }

        // Walk cards BELOW the active card downward.
        // Prefer natural Y; push down past the bottom if needed.
        let lastBottom = activeY + activeHeight + MIN_SPACING;
        for (let i = activeIdx + 1; i < sortedByPos.length; i++) {
            const { annotation, viewportY } = sortedByPos[i];
            const el = annotationElements[annotation.id];
            const height = el ? el.offsetHeight || 80 : 80;
            const y = Math.max(viewportY, lastBottom);
            adjustedY[annotation.id] = y;
            lastBottom = y + height + MIN_SPACING;
        }
    }

    // Shift all positions so the minimum Y is 0, adding an overhead
    // buffer so cards pushed above the active card are reachable by
    // scrolling. The scroll container is then scrolled by exactly
    // `overhead` so the active card (or the topmost card when nothing
    // is active) lands at its correct viewport position.
    const minY = Math.min(...Object.values(adjustedY));
    const overhead = minY < 0 ? -minY : 0;
    for (const id of Object.keys(adjustedY) as unknown as number[]) {
        adjustedY[id] += overhead;
    }

    // Compute total inner height
    let maxBottom = 0;
    for (const { annotation } of sortedByPos) {
        const el = annotationElements[annotation.id];
        const height = el ? el.offsetHeight || 80 : 80;
        maxBottom = Math.max(maxBottom, (adjustedY[annotation.id] ?? 0) + height + MIN_SPACING);
    }

    updateScrollContainerSize(maxBottom, leftPx);
    applyCardPositions(positions, adjustedY);

    // Scroll so the active card sits at its natural viewport Y.
    // When nothing is active, restore scroll to 0 (top of column).
    if (scrollContainer) {
        const targetScroll = overhead;
        if (Math.abs(scrollContainer.scrollTop - targetScroll) > 1) {
            scrollContainer.scrollTo({ top: targetScroll, behavior: "smooth" });
        }
    }
}

/**
 * Resize the inner scroll container so it can hold all cards,
 * and position it at the correct horizontal offset. The
 * container width fills from leftPx to the viewport edge
 * (minus a small right margin) so cards are not cramped.
 */
function updateScrollContainerSize(lastBottom: number, leftPx: number) {
    if (!scrollContainer) return;
    const inner = scrollContainer.firstElementChild as HTMLElement | null;
    if (inner) inner.style.height = `${lastBottom + 24}px`;
    scrollContainer.style.left = `${leftPx}px`;
    const availableWidth = Math.max(0, window.innerWidth - leftPx - 24);
    scrollContainer.style.width = `${availableWidth}px`;
}

/**
 * Apply computed top/left positions to each card DOM element.
 */
function applyCardPositions(
    positions: { annotation: GenericAnnotation; viewportY: number }[],
    adjustedY: { [id: number]: number },
) {
    for (const { annotation } of positions) {
        const el = annotationElements[annotation.id];
        if (el) {
            el.style.top = `${adjustedY[annotation.id] ?? 0}px`;
            el.style.left = "0px";
        }
    }
}

// Track which pending card is currently showing the alert animation
let alertingPendingId: number | undefined = $state();

// React to pending-comment events: scroll the pending card into view,
// then play a shake + red-outline-fade animation on it. The alert only
// fires when canCreateNewComment() is false, so the pending comment card
// already exists in the DOM — no timing workaround needed.
$effect(() => {
    return annotationEventBus.on("pending-comment-alert", () => {
        if (!isFloating || !pendingComment) return;

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

        // Trigger shake animation via CSS. The animation-name reset
        // (removing then re-adding the class) ensures it replays on
        // repeated alerts. The animationend event cleans up — no
        // setTimeout needed.
        alertingPendingId = pendingComment.id;
        el.classList.remove("pending-shake");
        void el.offsetWidth; // force reflow to restart animation
        el.classList.add("pending-shake");
    });
});

// Annotation keyboard shortcuts:
//   ⌘/          — focus reply textarea (comment / suggestion / revision)
//   ⌘E          — enter revision editor (inline or modal)
$effect(() => {
    function onKeydown(e: KeyboardEvent) {
        if (!(e.metaKey || e.ctrlKey)) return;
        const active = resolvedActiveAnnotation;
        if (!active) return;

        if (e.key === "/" && !e.shiftKey) {
            if (
                active._type === "comment" ||
                active._type === "suggestion" ||
                active._type === "revision"
            ) {
                e.preventDefault();
                annotationEventBus.emit({
                    type: "annotation-focus-reply",
                    annotationId: active.id,
                });
            }
        } else if ((e.key === "e" || e.key === "E") && !e.shiftKey) {
            if (active._type === "revision") {
                e.preventDefault();
                annotationEventBus.emit({
                    type: "annotation-enter-editor",
                    annotationId: active.id,
                });
            }
        }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
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
    {#if isFloating && hasSelection && selectionY !== null && (!hasComments || !hasRevisions || isSingleWordSelection)}
        {@const leftPx = getAnnotationLeft()}
        <div
            class="fixed z-40 flex flex-col gap-2 pointer-events-none -translate-y-1/2"
            style="left: {leftPx}px; top: {selectionY}px"
        >
            {#if !hasComments}
                <div class="flex items-center gap-2 text-black/40">
                    <Kbd variant="large" keys={[mod, opt, "M"]} />
                    <span class="text-sm font-medium text-black/35">comment</span>
                </div>
            {/if}
            {#if !hasRevisions}
                <div class="flex items-center gap-2 text-black/40">
                    <Kbd variant="large" keys={[mod, opt, "K"]} />
                    <span class="text-sm font-medium text-black/35">revision</span>
                </div>
            {/if}
            {#if isSingleWordSelection}
                <div class="flex items-center gap-2 text-black/40">
                    <Kbd variant="large" keys={[mod, "B"]} />
                    <span class="text-sm font-medium text-black/35">dictionary</span>
                </div>
            {/if}
        </div>
    {/if}
    {#if isFloating}
        <div class="annotation-scroll-container" bind:this={scrollContainer}>
            <div class="annotation-scroll-inner">
                {#each sortedAnnotations as c}
                    {@const i = c.id}
                    {@const isActive = resolvedActiveAnnotation?.id === c.id}
                    {@const isPendingComment = pendingComment?.id === c.id}
                    <div
                        use:annotationElement={i}
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
                            <div
                                class="alert-ring rounded-[14px]"
                                onanimationend={() => { alertingPendingId = undefined; }}
                            ></div>
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
                    use:annotationElement={i}
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
        width: 256px; /* overridden dynamically in updateScrollContainerSize */
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
        width: 100%;
        pointer-events: none;
    }

    .annotation-card {
        position: absolute;
        top: 64px;
        left: 0;
        width: 100%;
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
