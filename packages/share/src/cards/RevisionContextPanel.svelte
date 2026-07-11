<script lang="ts">
/**
 * RevisionContextPanel.svelte — Shared revision-modal context viewport.
 *
 * Extracted from the desktop modal. Hosts provide context layers and optional
 * lazy-load callbacks; this component owns collapse state, edge fading,
 * revision centering, visibility tracking, and the jump affordance.
 */
import { ChevronDown, ChevronUp } from "lucide-svelte";
import { scale, slide } from "svelte/transition";
import type { RevisionContextViewLayer } from "./types";

let {
    layers,
    centerKey,
    onLoadMoreBefore,
    onLoadMoreAfter,
}: {
    layers: readonly RevisionContextViewLayer[];
    centerKey?: unknown;
    onLoadMoreBefore?: () => void;
    onLoadMoreAfter?: () => void;
} = $props();

let collapsed = $state(false);
let scrollElement = $state<HTMLDivElement>();
let revisionElement = $state<HTMLSpanElement>();
let revisionDirection = $state<"above" | "below" | null>(null);
let atTop = $state(true);
let atBottom = $state(false);
let loadingBefore = $state(false);
let loadingAfter = $state(false);

const outerLayer = $derived(layers[0]);

function updateEdges(): void {
    if (!scrollElement) return;
    atTop = scrollElement.scrollTop <= 1;
    atBottom =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= 1;
}

function scrollRevisionIntoCenter(behavior: ScrollBehavior = "smooth"): void {
    if (!scrollElement || !revisionElement) return;
    const containerRect = scrollElement.getBoundingClientRect();
    const revisionRect = revisionElement.getBoundingClientRect();
    const targetTop =
        scrollElement.scrollTop +
        (revisionRect.top - containerRect.top) -
        (scrollElement.clientHeight / 2 - revisionRect.height / 2);
    scrollElement.scrollTo({ top: targetTop, behavior });
    requestAnimationFrame(updateEdges);
}

function handleScroll(): void {
    if (!scrollElement) return;
    updateEdges();
    const threshold = 40;

    if (
        scrollElement.scrollTop < threshold &&
        outerLayer?.hasMoreBefore &&
        onLoadMoreBefore &&
        !loadingBefore
    ) {
        loadingBefore = true;
        const previousHeight = scrollElement.scrollHeight;
        onLoadMoreBefore();
        requestAnimationFrame(() => {
            if (scrollElement) {
                scrollElement.scrollTop += scrollElement.scrollHeight - previousHeight;
                updateEdges();
            }
            loadingBefore = false;
        });
    }

    if (
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <
            threshold &&
        outerLayer?.hasMoreAfter &&
        onLoadMoreAfter &&
        !loadingAfter
    ) {
        loadingAfter = true;
        onLoadMoreAfter();
        requestAnimationFrame(() => {
            updateEdges();
            loadingAfter = false;
        });
    }
}

$effect(() => {
    if (!scrollElement) return;
    updateEdges();
});

$effect(() => {
    void centerKey;
    void collapsed;
    if (collapsed || !revisionElement || !scrollElement) return;
    requestAnimationFrame(() => scrollRevisionIntoCenter("auto"));
    const timeoutId = window.setTimeout(() => scrollRevisionIntoCenter("auto"), 220);
    return () => window.clearTimeout(timeoutId);
});

$effect(() => {
    if (!revisionElement || !scrollElement || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
        ([entry]) => {
            if (entry.isIntersecting) {
                revisionDirection = null;
                return;
            }
            const rootBounds = entry.rootBounds;
            if (rootBounds) {
                revisionDirection =
                    entry.boundingClientRect.top < rootBounds.top ? "above" : "below";
            }
        },
        { root: scrollElement, threshold: 0.1 },
    );
    observer.observe(revisionElement);
    return () => observer.disconnect();
});
</script>

{#if layers.length > 0}
    <div class="context-panel" data-revision-context-panel>
        <button class="panel-toggle" type="button" onclick={() => (collapsed = !collapsed)}>
            <span>Context</span>
            {#if collapsed}
                <ChevronDown size={10} class="text-purple-400/50" />
            {:else}
                <ChevronUp size={10} class="text-purple-400/50" />
            {/if}
        </button>
        {#if !collapsed}
            <div transition:slide={{ duration: 180 }} class="context-viewport">
                <div
                    bind:this={scrollElement}
                    class="context-scroll"
                    data-revision-context-scroll
                    data-has-more-before={outerLayer?.hasMoreBefore ?? false}
                    data-has-more-after={outerLayer?.hasMoreAfter ?? false}
                    data-loading-before={loadingBefore}
                    data-loading-after={loadingAfter}
                    style:mask-image={`linear-gradient(to bottom, ${atTop ? "black" : "transparent"} 0%, black 22%, black 78%, ${atBottom ? "black" : "transparent"} 100%)`}
                    style:-webkit-mask-image={`linear-gradient(to bottom, ${atTop ? "black" : "transparent"} 0%, black 22%, black 78%, ${atBottom ? "black" : "transparent"} 100%)`}
                    onscroll={handleScroll}
                >
                    {#snippet renderLayer(depth: number)}
                        {@const layer = layers[depth]}
                        {@const isDeepest = depth === layers.length - 1}
                        <span class="context-text context-depth-{depth}">
                            {#if layer.before}<span class="context-surrounding">{layer.before}</span>{/if}<!--
                            -->{#if depth === 0}<span bind:this={revisionElement} class="context-nest context-nest-0">{#if isDeepest}{layer.revision || "(empty)"}{:else}{@render renderLayer(1)}{/if}</span>{:else}<span class="context-nest context-nest-{Math.min(depth, 3)}">{#if isDeepest}{layer.revision || "(empty)"}{:else}{@render renderLayer(depth + 1)}{/if}</span>{/if}<!--
                            -->{#if layer.after}<span class="context-surrounding">{layer.after}</span>{/if}
                        </span>
                    {/snippet}
                    {@render renderLayer(0)}
                </div>
                {#if revisionDirection}
                    <button
                        class="context-jump-btn {revisionDirection === 'above'
                            ? 'context-jump-top'
                            : 'context-jump-bottom'}"
                        type="button"
                        onclick={() => scrollRevisionIntoCenter()}
                        title="Jump to revision"
                        aria-label="Jump to revision"
                        transition:scale={{ start: 0.8, duration: 120, opacity: 0 }}
                    >
                        <span class="context-jump-btn-inner">
                            {#if revisionDirection === "above"}
                                <ChevronUp size={14} />
                            {:else}
                                <ChevronDown size={14} />
                            {/if}
                        </span>
                    </button>
                {/if}
            </div>
        {/if}
    </div>
{/if}

<style>
    .context-panel {
        flex-shrink: 0;
        border-bottom: 1px solid rgba(243, 232, 255, 0.6);
    }

    .panel-toggle {
        display: flex;
        width: 100%;
        flex-shrink: 0;
        align-items: center;
        justify-content: space-between;
        padding: 0.625rem 1rem;
        color: rgba(147, 51, 234, 0.6);
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        transition: background-color 0.15s ease;
    }

    .panel-toggle:hover {
        background: rgba(250, 245, 255, 0.6);
    }

    .context-viewport {
        position: relative;
    }

    .context-scroll {
        height: 200px;
        overflow-y: auto;
        padding: 10px 14px;
        background: rgba(245, 240, 255, 0.45);
        scrollbar-width: none;
        -ms-overflow-style: none;
        backdrop-filter: blur(12px) saturate(1.3);
        -webkit-backdrop-filter: blur(12px) saturate(1.3);
    }

    .context-scroll::-webkit-scrollbar {
        display: none;
    }

    .context-text {
        color: rgba(80, 40, 120, 0.35);
        font-family: var(--doc-font-family, system-ui, sans-serif);
        font-size: 11px;
        line-height: 1.7;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .context-depth-0 {
        display: block;
    }

    .context-nest {
        display: inline;
        border-radius: 4px;
        padding: 1px 3px;
    }

    .context-nest-0 {
        color: rgba(88, 28, 135, 0.55);
        background: rgba(147, 112, 219, 0.1);
        box-shadow: inset 0 0 0 1px rgba(147, 112, 219, 0.18);
    }

    .context-nest-1 {
        color: rgba(88, 28, 135, 0.7);
        background: rgba(126, 87, 194, 0.16);
        box-shadow: inset 0 0 0 1px rgba(126, 87, 194, 0.25);
    }

    .context-nest-2 {
        color: rgba(88, 28, 135, 0.82);
        background: rgba(109, 40, 217, 0.2);
        box-shadow: inset 0 0 0 1px rgba(109, 40, 217, 0.3);
    }

    .context-nest-3 {
        color: rgba(88, 28, 135, 0.92);
        background: rgba(88, 28, 135, 0.24);
        box-shadow: inset 0 0 0 1px rgba(88, 28, 135, 0.35);
        font-weight: 500;
    }

    .context-jump-btn {
        position: absolute;
        left: 50%;
        z-index: 2;
        border-radius: 99px;
        box-shadow: 0 2px 8px rgba(109, 40, 217, 0.12);
        cursor: pointer;
        transform: translateX(-50%);
    }

    .context-jump-btn-inner {
        display: flex;
        align-items: center;
        gap: 3px;
        overflow: hidden;
        padding: 3px 5px;
        border: 1px solid rgba(167, 139, 250, 0.35);
        border-radius: 99px;
        background: rgba(245, 240, 255, 0.85);
        color: rgba(109, 40, 217, 0.8);
        font-size: 10px;
        font-weight: 500;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        transition:
            background 0.15s,
            color 0.15s;
    }

    .context-jump-btn:hover .context-jump-btn-inner {
        color: rgb(109, 40, 217);
        background: rgba(237, 233, 254, 0.95);
    }

    .context-jump-top {
        top: 14px;
    }

    .context-jump-bottom {
        bottom: 14px;
    }
</style>
