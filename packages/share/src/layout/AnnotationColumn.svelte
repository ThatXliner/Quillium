<script lang="ts">
/**
 * AnnotationColumn.svelte — Shared floating-column DOM adapter.
 *
 * Hosts provide annotation IDs, CodeMirror-derived viewport anchors, column
 * geometry, and card content. This component owns measurement, collision
 * layout, scrolling overhead, and the motion contract shared by desktop and
 * read-only surfaces.
 */
import { type Snippet, onDestroy, tick } from "svelte";
import type { Action } from "svelte/action";
import {
    AnnotationColumnDomController,
    type AnnotationColumnGeometry,
} from "./annotationColumnDom";
import { ANNOTATION_CARD_TOP_TRANSITION, type AnnotationLayoutId } from "./annotationLayout";

let {
    ids,
    activeId = null,
    layoutVersion = 0,
    getViewportY,
    getColumnGeometry,
    scrollTargets = [],
    onActivate,
    card,
}: {
    ids: readonly AnnotationLayoutId[];
    activeId?: AnnotationLayoutId | null;
    /** Increment when host state can change anchors without changing IDs. */
    layoutVersion?: number;
    getViewportY: (id: AnnotationLayoutId) => number;
    getColumnGeometry: () => AnnotationColumnGeometry;
    scrollTargets?: readonly EventTarget[];
    onActivate?: (id: AnnotationLayoutId) => void;
    card: Snippet<[AnnotationLayoutId, boolean]>;
} = $props();

let container = $state<HTMLDivElement | undefined>(undefined);
let inner = $state<HTMLDivElement | undefined>(undefined);
let cardElementsVersion = $state(0);
const dom = new AnnotationColumnDomController<AnnotationLayoutId>(updateLayout);

const cardElement: Action<HTMLDivElement, AnnotationLayoutId> = (node, id) => {
    const mounted = dom.mountCard(node, id);
    cardElementsVersion++;
    return {
        update(nextId) {
            mounted.update(nextId);
            cardElementsVersion++;
        },
        destroy() {
            mounted.destroy();
            cardElementsVersion++;
        },
    };
};

function updateLayout() {
    if (!container || !inner) return;
    dom.apply({
        container,
        inner,
        items: ids.map((id) => ({ id, viewportY: getViewportY(id) })),
        activeId,
        geometry: getColumnGeometry(),
    });
}

function isInteractiveTarget(target: EventTarget | null): boolean {
    return (
        target instanceof HTMLElement &&
        !!target.closest("button, input, textarea, select, a[href], [contenteditable='true']")
    );
}

$effect(() => {
    void activeId;
    void layoutVersion;
    void ids;
    void cardElementsVersion;
    tick().then(dom.schedule);
});

$effect(() => {
    void ids;
    void cardElementsVersion;
    tick().then(() => dom.observeCards());
});

$effect(() => {
    dom.setEventTargets([window, ...scrollTargets]);
    window.addEventListener("resize", dom.schedule);
    return () => {
        dom.setEventTargets([]);
        window.removeEventListener("resize", dom.schedule);
    };
});

onDestroy(() => dom.destroy());
</script>

<div class="annotation-scroll-container" data-annotation-column bind:this={container}>
    <div class="annotation-scroll-inner" bind:this={inner}>
        {#each ids as id (id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div
                use:cardElement={id}
                class="annotation-card"
                class:is-active={id === activeId}
                data-annotation-id={id}
                data-active={id === activeId ? "true" : "false"}
                style:z-index={id === activeId ? 120 : 50}
                style:transition={ANNOTATION_CARD_TOP_TRANSITION}
                role="group"
                aria-label="Annotation card"
                onclick={(event) => {
                    if (!isInteractiveTarget(event.target)) onActivate?.(id);
                }}
            >
                <button
                    type="button"
                    class="focus-annotation"
                    aria-label="Focus annotation"
                    onclick={() => onActivate?.(id)}
                ></button>
                {@render card(id, id === activeId)}
            </div>
        {/each}
    </div>
</div>

<style>
    .annotation-scroll-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 280px;
        height: 100vh;
        overflow-x: visible;
        overflow-y: auto;
        overscroll-behavior: contain;
        pointer-events: none;
        scrollbar-width: none;
        z-index: 30;
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
    }

    .focus-annotation {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }
</style>
