<script lang="ts">
import { ChevronDown, ChevronUp } from "lucide-svelte";
import { scale, slide } from "svelte/transition";
import type { ContextLayer } from "./useRevisionContext.svelte";

const {
    contextLayers,
    onLoadMoreBefore,
    onLoadMoreAfter,
}: {
    contextLayers: ContextLayer[];
    onLoadMoreBefore: (prevScrollHeight: number, el: HTMLDivElement) => void;
    onLoadMoreAfter: () => void;
} = $props();

let contextCollapsed = $state(false);

let contextScrollEl = $state<HTMLDivElement | undefined>(undefined);
let contextRevisionEl = $state<HTMLSpanElement | undefined>(undefined);
let revisionDirection = $state<"above" | "below" | null>(null);
let contextAtTop = $state(true);
let contextAtBottom = $state(false);

const docContext = $derived(contextLayers[0] ?? null);

function scrollRevisionIntoCenter(behavior: ScrollBehavior = "smooth") {
    if (!contextScrollEl || !contextRevisionEl) return;
    const container = contextScrollEl;
    const containerRect = container.getBoundingClientRect();
    const revisionRect = contextRevisionEl.getBoundingClientRect();
    const currentTop = container.scrollTop;
    const targetTop =
        currentTop +
        (revisionRect.top - containerRect.top) -
        (container.clientHeight / 2 - revisionRect.height / 2);
    container.scrollTo({ top: targetTop, behavior });
}

// Center revision whenever context is shown/updated
$effect(() => {
    if (contextCollapsed || !contextRevisionEl || !contextScrollEl) return;
    requestAnimationFrame(() => scrollRevisionIntoCenter("auto"));
    const timeoutId = window.setTimeout(() => {
        scrollRevisionIntoCenter("auto");
    }, 220);
    return () => window.clearTimeout(timeoutId);
});

// IntersectionObserver: track whether revision span is visible
$effect(() => {
    if (!contextRevisionEl || !contextScrollEl) return;
    const observer = new IntersectionObserver(
        ([entry]) => {
            if (entry.isIntersecting) {
                revisionDirection = null;
            } else {
                const rect = entry.boundingClientRect;
                const rootRect = entry.rootBounds;
                if (rootRect) {
                    revisionDirection = rect.top < rootRect.top ? "above" : "below";
                }
            }
        },
        { root: contextScrollEl, threshold: 0.1 },
    );
    observer.observe(contextRevisionEl);
    return () => observer.disconnect();
});

// Auto-load more on scroll; track edge state for fade mask
$effect(() => {
    const el = contextScrollEl;
    if (!el) return;
    function updateEdges() {
        if (!el) return;
        contextAtTop = el.scrollTop <= 0;
        contextAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 0;
    }
    updateEdges();
    function handleScroll() {
        if (!el) return;
        updateEdges();
        const THRESHOLD = 40;
        if (el.scrollTop < THRESHOLD && docContext?.hasMoreBefore) {
            onLoadMoreBefore(el.scrollHeight, el);
        }
        if (
            el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD &&
            docContext?.hasMoreAfter
        ) {
            onLoadMoreAfter();
        }
    }
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
});
</script>

<div class="border-b border-purple-100/60 shrink-0">
  <button
    class="w-full flex items-center justify-between px-4 py-2.5 hover:bg-purple-50/60 transition-colors"
    onclick={() => contextCollapsed = !contextCollapsed}
  >
    <span class="text-[9px] font-semibold text-purple-600/60 uppercase tracking-wider">Context</span>
    {#if contextCollapsed}
      <ChevronDown size={10} class="text-purple-400/50" />
    {:else}
      <ChevronUp size={10} class="text-purple-400/50" />
    {/if}
  </button>
  {#if !contextCollapsed}
    <div transition:slide={{ duration: 180 }} class="relative">
      <div
        bind:this={contextScrollEl}
        class="context-scroll"
        style="mask-image: linear-gradient(to bottom, {contextAtTop ? 'black' : 'transparent'} 0%, black 22%, black 78%, {contextAtBottom ? 'black' : 'transparent'} 100%); -webkit-mask-image: linear-gradient(to bottom, {contextAtTop ? 'black' : 'transparent'} 0%, black 22%, black 78%, {contextAtBottom ? 'black' : 'transparent'} 100%);"
      >
        {#snippet renderLayer(depth: number)}
          {@const layer = contextLayers[depth]}
          {@const isDeepest = depth === contextLayers.length - 1}
          <span class="context-text context-depth-{depth}">
            {#if layer.before}<span class="context-surrounding">{layer.before}</span>{/if}<!--
            -->{#if depth === 0}<span bind:this={contextRevisionEl} class="context-nest context-nest-0">{#if isDeepest}{layer.revision || "(empty)"}{:else}{@render renderLayer(1)}{/if}</span>{:else}<span class="context-nest context-nest-{Math.min(depth, 3)}">{#if isDeepest}{layer.revision || "(empty)"}{:else}{@render renderLayer(depth + 1)}{/if}</span>{/if}<!--
            -->{#if layer.after}<span class="context-surrounding">{layer.after}</span>{/if}
          </span>
        {/snippet}
        {@render renderLayer(0)}
      </div>
      {#if revisionDirection}
        <button
          class="context-jump-btn {revisionDirection === 'above' ? 'context-jump-top' : 'context-jump-bottom'}"
          onclick={() => scrollRevisionIntoCenter()}
          title="Jump to revision"
          transition:scale={{ start: 0.8, duration: 120, opacity: 0 }}
        >
          {#if revisionDirection === "above"}
            <ChevronUp size={14} />
          {:else}
            <ChevronDown size={14} />
          {/if}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .context-scroll {
    height: 200px;
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding: 10px 14px;
    background: rgba(245, 240, 255, 0.45);
    backdrop-filter: blur(12px) saturate(1.3);
    -webkit-backdrop-filter: blur(12px) saturate(1.3);
  }

  .context-scroll::-webkit-scrollbar {
    display: none;
  }

  .context-text {
    font-size: 11px;
    line-height: 1.7;
    color: rgba(80, 40, 120, 0.35);
    font-family: var(--doc-font-family, system-ui, sans-serif);
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
    background: rgba(147, 112, 219, 0.10);
    color: rgba(88, 28, 135, 0.55);
    box-shadow: inset 0 0 0 1px rgba(147, 112, 219, 0.18);
  }

  .context-nest-1 {
    background: rgba(126, 87, 194, 0.16);
    color: rgba(88, 28, 135, 0.70);
    box-shadow: inset 0 0 0 1px rgba(126, 87, 194, 0.25);
  }

  .context-nest-2 {
    background: rgba(109, 40, 217, 0.20);
    color: rgba(88, 28, 135, 0.82);
    box-shadow: inset 0 0 0 1px rgba(109, 40, 217, 0.30);
  }

  .context-nest-3 {
    background: rgba(88, 28, 135, 0.24);
    color: rgba(88, 28, 135, 0.92);
    font-weight: 500;
    box-shadow: inset 0 0 0 1px rgba(88, 28, 135, 0.35);
  }

  .context-jump-btn {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 3px 5px;
    font-size: 10px;
    font-weight: 500;
    color: rgba(109, 40, 217, 0.8);
    background: rgba(245, 240, 255, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(167, 139, 250, 0.35);
    border-radius: 99px;
    box-shadow: 0 2px 8px rgba(109, 40, 217, 0.12);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    z-index: 2;
  }

  .context-jump-btn:hover {
    background: rgba(237, 233, 254, 0.95);
    color: rgba(109, 40, 217, 1);
  }

  .context-jump-top {
    top: 14px;
  }

  .context-jump-bottom {
    bottom: 14px;
  }
</style>
