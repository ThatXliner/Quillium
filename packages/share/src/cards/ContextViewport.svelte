<script lang="ts">
/**
 * ContextViewport.svelte — Shared, capability-driven annotation context viewport.
 *
 * The viewport owns collapse state, centering, edge masks, jump controls, and
 * incremental loading. Hosts only provide context layers and optional loaders.
 */
import { ChevronDown, ChevronUp } from "lucide-svelte";
import { tick } from "svelte";
import { scale, slide } from "svelte/transition";
import type { AnnotationContextViewLayer } from "./types";

let {
    layers,
    variant = "revision",
    heading = "Context",
    targetLabel,
    centerKey,
    fill = false,
    onLoadMoreBefore,
    onLoadMoreAfter,
}: {
    layers: readonly AnnotationContextViewLayer[];
    variant?: "revision" | "comment";
    heading?: string;
    targetLabel?: string;
    centerKey?: unknown;
    fill?: boolean;
    onLoadMoreBefore?: () => void;
    onLoadMoreAfter?: () => void;
} = $props();

let collapsed = $state(false);
let scrollElement = $state<HTMLDivElement>();
let targetElement = $state<HTMLSpanElement>();
let targetDirection = $state<"above" | "below" | null>(null);
let atTop = $state(true);
let atBottom = $state(false);
let loadingBefore = $state(false);
let loadingAfter = $state(false);
let userInteracted = $state(false);
let autoFillPromise: Promise<void> | null = null;

const resolvedTargetLabel = $derived(targetLabel ?? variant);
const outerLayer = $derived(layers[0]);
const contentKey = $derived(
    layers
        .map(
            (layer) =>
                `${layer.before.length}:${layer.revision.length}:${layer.after.length}:${Number(layer.hasMoreBefore)}:${Number(layer.hasMoreAfter)}`,
        )
        .join("|"),
);

function nextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function updateEdges(): void {
    if (!scrollElement) return;
    atTop = scrollElement.scrollTop <= 1;
    atBottom =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= 1;
}

function hasOverflow(): boolean {
    return !!scrollElement && scrollElement.scrollHeight > scrollElement.clientHeight + 1;
}

async function fillUntilScrollable(): Promise<void> {
    if (!scrollElement || collapsed || hasOverflow()) return;

    // A short context slice can exactly fit the viewport while more document
    // text exists. Without proactive filling there is no scroll range, so a
    // native wheel gesture cannot emit the scroll event that used to load more.
    for (let iteration = 0; iteration < 24 && scrollElement && !hasOverflow(); iteration += 1) {
        const layer = layers[0];
        const canLoadBefore = !!layer?.hasMoreBefore && !!onLoadMoreBefore;
        const canLoadAfter = !!layer?.hasMoreAfter && !!onLoadMoreAfter;
        if (!canLoadBefore && !canLoadAfter) break;

        const previousSignature = `${layer.before.length}:${layer.after.length}:${Number(layer.hasMoreBefore)}:${Number(layer.hasMoreAfter)}`;
        if (canLoadBefore) {
            loadingBefore = true;
            onLoadMoreBefore?.();
        }
        if (canLoadAfter) {
            loadingAfter = true;
            onLoadMoreAfter?.();
        }

        await tick();
        await nextFrame();
        loadingBefore = false;
        loadingAfter = false;

        const nextLayer = layers[0];
        const nextSignature = nextLayer
            ? `${nextLayer.before.length}:${nextLayer.after.length}:${Number(nextLayer.hasMoreBefore)}:${Number(nextLayer.hasMoreAfter)}`
            : "missing";
        if (nextSignature === previousSignature) break;
    }
    updateEdges();
}

function ensureScrollable(): Promise<void> {
    if (autoFillPromise) return autoFillPromise;
    autoFillPromise = fillUntilScrollable().finally(() => {
        autoFillPromise = null;
    });
    return autoFillPromise;
}

function scrollTargetIntoCenter(behavior: ScrollBehavior = "smooth"): void {
    if (!scrollElement || !targetElement) return;
    const containerRect = scrollElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const targetTop =
        scrollElement.scrollTop +
        (targetRect.top - containerRect.top) -
        (scrollElement.clientHeight / 2 - targetRect.height / 2);
    scrollElement.scrollTo({ top: targetTop, behavior });
    requestAnimationFrame(updateEdges);
}

async function loadBefore(): Promise<void> {
    if (
        !scrollElement ||
        !outerLayer?.hasMoreBefore ||
        !onLoadMoreBefore ||
        loadingBefore ||
        loadingAfter
    ) {
        return;
    }
    loadingBefore = true;
    const previousHeight = scrollElement.scrollHeight;
    onLoadMoreBefore();
    await tick();
    await nextFrame();
    if (scrollElement) {
        scrollElement.scrollTop += scrollElement.scrollHeight - previousHeight;
        updateEdges();
    }
    loadingBefore = false;
}

async function loadAfter(): Promise<void> {
    if (!outerLayer?.hasMoreAfter || !onLoadMoreAfter || loadingAfter || loadingBefore) return;
    loadingAfter = true;
    onLoadMoreAfter();
    await tick();
    await nextFrame();
    updateEdges();
    loadingAfter = false;
}

function handleScroll(): void {
    if (!scrollElement) return;
    updateEdges();
    const threshold = 40;
    const distanceFromTop = scrollElement.scrollTop;
    const distanceFromBottom =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
    const canLoadBefore =
        distanceFromTop < threshold && !!outerLayer?.hasMoreBefore && !!onLoadMoreBefore;
    const canLoadAfter =
        distanceFromBottom < threshold && !!outerLayer?.hasMoreAfter && !!onLoadMoreAfter;

    // A short overflow can put both edges inside the threshold. Loading both
    // directions concurrently makes prepend preservation include the appended
    // height and visibly jumps the viewport. Load only the nearest edge.
    if (canLoadBefore && canLoadAfter) {
        if (distanceFromTop <= distanceFromBottom) void loadBefore();
        else void loadAfter();
        return;
    }
    if (canLoadBefore) {
        void loadBefore();
        return;
    }
    if (canLoadAfter) void loadAfter();
}

function markUserInteraction(): void {
    userInteracted = true;
}

function trackUserInteraction(node: HTMLElement): { destroy: () => void } {
    const events = ["wheel", "pointerdown", "touchstart", "keydown"] as const;
    for (const event of events) node.addEventListener(event, markUserInteraction);
    return {
        destroy: () => {
            for (const event of events) node.removeEventListener(event, markUserInteraction);
        },
    };
}

$effect(() => {
    void contentKey;
    void collapsed;
    if (collapsed || !scrollElement) return;
    const frame = requestAnimationFrame(() => {
        updateEdges();
        void ensureScrollable();
    });
    return () => cancelAnimationFrame(frame);
});

$effect(() => {
    void centerKey;
    void collapsed;
    if (collapsed || !targetElement || !scrollElement) return;
    userInteracted = false;
    let cancelled = false;
    const frame = requestAnimationFrame(async () => {
        await ensureScrollable();
        if (!cancelled && !userInteracted) scrollTargetIntoCenter("auto");
    });
    return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
    };
});

$effect(() => {
    const element = scrollElement;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
        updateEdges();
        if (!collapsed) void ensureScrollable();
    });
    observer.observe(element);
    return () => observer.disconnect();
});

$effect(() => {
    if (!targetElement || !scrollElement || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
        ([entry]) => {
            if (entry.isIntersecting) {
                targetDirection = null;
                return;
            }
            const rootBounds = entry.rootBounds;
            if (rootBounds) {
                targetDirection = entry.boundingClientRect.top < rootBounds.top ? "above" : "below";
            }
        },
        { root: scrollElement, threshold: 0.1 },
    );
    observer.observe(targetElement);
    return () => observer.disconnect();
});
</script>

{#if layers.length > 0}
    <section
        class="context-panel context-{variant} {fill ? 'context-fill' : ''}"
        data-context-viewport={variant}
    >
        <button
            class="panel-toggle"
            type="button"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${heading}`}
            onclick={() => (collapsed = !collapsed)}
        >
            <span>{heading}</span>
            {#if collapsed}
                <ChevronDown size={10} />
            {:else}
                <ChevronUp size={10} />
            {/if}
        </button>
        {#if !collapsed}
            <div transition:slide={{ duration: 180 }} class="context-viewport">
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <div
                    bind:this={scrollElement}
                    use:trackUserInteraction
                    class="context-scroll"
                    data-context-scroll={variant}
                    data-revision-context-scroll={variant === "revision" ? "" : undefined}
                    data-comment-context-scroll={variant === "comment" ? "" : undefined}
                    data-has-more-before={outerLayer?.hasMoreBefore ?? false}
                    data-has-more-after={outerLayer?.hasMoreAfter ?? false}
                    data-loading-before={loadingBefore}
                    data-loading-after={loadingAfter}
                    role="region"
                    aria-label={`${heading} for ${resolvedTargetLabel}`}
                    tabindex="0"
                    style:mask-image={`linear-gradient(to bottom, ${atTop ? "black" : "transparent"} 0%, black 22%, black 78%, ${atBottom ? "black" : "transparent"} 100%)`}
                    style:-webkit-mask-image={`linear-gradient(to bottom, ${atTop ? "black" : "transparent"} 0%, black 22%, black 78%, ${atBottom ? "black" : "transparent"} 100%)`}
                    onscroll={handleScroll}
                >
                    {#snippet renderLayer(depth: number)}
                        {@const layer = layers[depth]}
                        {@const isDeepest = depth === layers.length - 1}
                        <span class="context-text context-depth-{depth}">
                            {#if layer.before}<span class="context-surrounding">{layer.before}</span>{/if}<!--
                            -->{#if isDeepest}<span
                                    bind:this={targetElement}
                                    class="context-target context-depth-target-{Math.min(depth, 3)}"
                                    data-context-target-depth={depth}
                                    >{layer.revision || "(empty)"}</span
                                >{:else}<span
                                    class="context-target context-depth-target-{Math.min(depth, 3)}"
                                    >{@render renderLayer(depth + 1)}</span
                                >{/if}<!--
                            -->{#if layer.after}<span class="context-surrounding">{layer.after}</span>{/if}
                        </span>
                    {/snippet}
                    {@render renderLayer(0)}
                </div>
                {#if targetDirection}
                    <button
                        class="context-jump-btn {targetDirection === 'above'
                            ? 'context-jump-top'
                            : 'context-jump-bottom'}"
                        type="button"
                        onclick={() => scrollTargetIntoCenter()}
                        title={`Jump to ${resolvedTargetLabel}`}
                        aria-label={`Jump to ${resolvedTargetLabel}`}
                        transition:scale={{ start: 0.8, duration: 120, opacity: 0 }}
                    >
                        <span class="context-jump-btn-inner">
                            {#if targetDirection === "above"}
                                <ChevronUp size={14} />
                            {:else}
                                <ChevronDown size={14} />
                            {/if}
                        </span>
                    </button>
                {/if}
            </div>
        {/if}
    </section>
{/if}

<style>
    .context-panel {
        flex-shrink: 0;
        min-height: 0;
        border-bottom: 1px solid rgba(243, 232, 255, 0.6);
    }

    .context-panel.context-comment {
        border-color: rgba(219, 234, 254, 0.6);
    }

    .context-panel.context-fill {
        display: flex;
        flex: 1;
        flex-direction: column;
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

    .context-comment .panel-toggle {
        color: rgba(37, 99, 235, 0.6);
    }

    .panel-toggle:hover {
        background: rgba(250, 245, 255, 0.6);
    }

    .context-comment .panel-toggle:hover {
        background: rgba(239, 246, 255, 0.6);
    }

    .context-viewport {
        position: relative;
        min-height: 0;
    }

    .context-fill .context-viewport {
        flex: 1;
    }

    .context-scroll {
        height: 200px;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 10px 14px;
        background: rgba(245, 240, 255, 0.45);
        scrollbar-color: rgba(147, 112, 219, 0.28) transparent;
        scrollbar-width: thin;
        touch-action: pan-y;
        backdrop-filter: blur(12px) saturate(1.3);
        -webkit-backdrop-filter: blur(12px) saturate(1.3);
    }

    .context-fill .context-scroll {
        height: 100%;
    }

    .context-comment .context-scroll {
        background: rgba(239, 246, 255, 0.45);
        scrollbar-color: rgba(59, 130, 246, 0.25) transparent;
    }

    .context-scroll::-webkit-scrollbar {
        width: 5px;
    }

    .context-scroll::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(147, 112, 219, 0.24);
    }

    .context-comment .context-scroll::-webkit-scrollbar-thumb {
        background: rgba(59, 130, 246, 0.22);
    }

    .context-text {
        color: rgba(80, 40, 120, 0.35);
        font-family: var(--doc-font-family, system-ui, sans-serif);
        font-size: 11px;
        line-height: 1.7;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .context-comment .context-text {
        color: rgba(30, 64, 120, 0.35);
    }

    .context-depth-0 {
        display: block;
    }

    .context-target {
        display: inline;
        border-radius: 4px;
        padding: 1px 3px;
    }

    .context-depth-target-0 {
        color: rgba(88, 28, 135, 0.55);
        background: rgba(147, 112, 219, 0.1);
        box-shadow: inset 0 0 0 1px rgba(147, 112, 219, 0.18);
    }

    .context-comment .context-depth-target-0 {
        color: rgba(120, 80, 10, 0.75);
        background: rgba(253, 224, 71, 0.25);
        box-shadow: inset 0 0 0 1px rgba(253, 224, 71, 0.45);
    }

    .context-depth-target-1 {
        color: rgba(88, 28, 135, 0.7);
        background: rgba(126, 87, 194, 0.16);
        box-shadow: inset 0 0 0 1px rgba(126, 87, 194, 0.25);
    }

    .context-depth-target-2 {
        color: rgba(88, 28, 135, 0.82);
        background: rgba(109, 40, 217, 0.2);
        box-shadow: inset 0 0 0 1px rgba(109, 40, 217, 0.3);
    }

    .context-depth-target-3 {
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

    .context-comment .context-jump-btn-inner {
        border-color: rgba(147, 197, 253, 0.5);
        background: rgba(239, 246, 255, 0.85);
        color: rgba(37, 99, 235, 0.8);
    }

    .context-jump-btn:hover .context-jump-btn-inner {
        color: rgb(109, 40, 217);
        background: rgba(237, 233, 254, 0.95);
    }

    .context-comment .context-jump-btn:hover .context-jump-btn-inner {
        color: rgb(37, 99, 235);
        background: rgba(219, 234, 254, 0.95);
    }

    .context-jump-top {
        top: 4px;
    }

    .context-jump-bottom {
        bottom: 4px;
    }
</style>
