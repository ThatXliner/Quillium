<!--
    DocumentTabs.svelte — Browser-style tab bar for document tabs (#160).

    Props:
      tabs        — ordered list of TabMeta
      activeTabId — id of the currently active tab
      ontabselect — called with (tabId) when user clicks an inactive tab
      ontabcreate — called when user clicks +
      ontabrename — called with (tabId, newLabel) after inline rename
      ontabdelete — called with (tabId) when user clicks ×

    Notes:
      - × is hidden when tabs.length === 1 (can't close last tab)
      - Double-click on label enters rename mode
      - Rename commits on Enter or blur, cancels on Escape
      - Sits flush above the document card; the active tab blends into it
-->
<script lang="ts">
import type { TabMeta } from "$lib/db/types";
import { FileTextIcon, PlusIcon } from "lucide-svelte";
import { tick } from "svelte";
import { type DndEvent, SOURCES, TRIGGERS, dndzone } from "svelte-dnd-action";
import { flip } from "svelte/animate";

const {
    tabs,
    activeTabId,
    ontabselect,
    ontabcreate,
    ontabrename,
    ontabdelete,
    ontabreorder,
}: {
    tabs: TabMeta[];
    activeTabId: string | null;
    ontabselect: (tabId: string) => void;
    ontabcreate: () => void;
    ontabrename: (tabId: string, label: string) => void;
    ontabdelete: (tabId: string) => void;
    /** Called with the full tab-id list in its new order after a drag. */
    ontabreorder: (orderedIds: string[]) => void;
} = $props();

let renamingTabId = $state<string | null>(null);
let renameValue = $state("");
let renameInputEl = $state<HTMLInputElement | undefined>();

// Once tabs have shrunk to their minimum and still don't fit, the strip
// scrolls horizontally. We track overflow + scroll position to fade the
// edges with a gradient mask, mirroring the AI sidebar's icon wheel.
let stripEl = $state<HTMLDivElement | undefined>();
let tabEls = $state<Record<string, HTMLDivElement>>({});
let stripOverflows = $state(false);
let canScrollLeft = $state(false);
let canScrollRight = $state(false);

// When the active tab changes (e.g. a freshly created tab appended off-screen),
// bring it into view. Scroll the strip itself rather than scrollIntoView() so
// the surrounding page never jumps.
$effect(() => {
    const id = activeTabId;
    if (!id) return;
    tick().then(() => {
        const el = tabEls[id];
        if (!stripEl || !el) return;
        const stripRect = stripEl.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        let delta = 0;
        if (elRect.right > stripRect.right) {
            delta = elRect.right - stripRect.right + 12;
        } else if (elRect.left < stripRect.left) {
            delta = elRect.left - stripRect.left - 12;
        }
        if (delta !== 0) stripEl.scrollBy?.({ left: delta, behavior: "smooth" });
    });
});

function updateScrollState() {
    if (!stripEl) return;
    const el = stripEl;
    stripOverflows = el.scrollWidth > el.clientWidth + 1;
    canScrollLeft = el.scrollLeft > 2;
    canScrollRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
}

// Track overflow/scroll state on the tab strip.
$effect(() => {
    if (!stripEl) return;
    // Re-run when the tab list changes so a new/removed tab updates the mask.
    tabs.length;
    const el = stripEl;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    // ResizeObserver is absent in some test/SSR environments; the scroll
    // listener still keeps the mask correct without it.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScrollState) : null;
    ro?.observe(el);
    return () => {
        el.removeEventListener("scroll", updateScrollState);
        ro?.disconnect();
    };
});

const maskStyle = $derived(
    stripOverflows
        ? `mask-image: linear-gradient(to right, ${canScrollLeft ? "transparent 0%, black 4%" : "black 0%"}, ${canScrollRight ? "black 96%, transparent 100%" : "black 100%"}); -webkit-mask-image: linear-gradient(to right, ${canScrollLeft ? "transparent 0%, black 4%" : "black 0%"}, ${canScrollRight ? "black 96%, transparent 100%" : "black 100%"});`
        : "",
);

// ── Drag-to-reorder (svelte-dnd-action) ───────────────────────────
// The library owns the drag visuals (its own preview + placeholder — no
// native HTML5 ghost) and reorders a working copy live. `dndItems` is that
// copy: it mirrors `tabs` at rest and is reordered during a drag. On drop
// we hand the final order to the parent, which persists it. Dragging is
// disabled while a tab is being renamed inline.
const FLIP_MS = 150;
let dndItems = $state<TabMeta[]>([]);
let isDragging = $state(false);
// A drag terminating on the same tab still fires a click; suppress that one
// so a drag-release doesn't also switch tabs.
let suppressClick = false;

// Keep the at-rest list in sync with the source of truth when not dragging.
$effect(() => {
    if (!isDragging) dndItems = tabs;
});

// Confine the dragged tab to the strip. svelte-dnd-action moves the floating
// clone (#dnd-action-dragged-el, position: fixed) with `transform:
// translate3d(dx, dy, 0)` on every pointer move. We rewrite that transform
// each frame to (a) zero dy so it can't drift up/down out of the row, and
// (b) clamp dx so the tab stays within the strip's left/right edges — it can
// never be flung over the sidebar or document. transformDraggedElement()
// only fires on index changes, so a rAF loop is the reliable continuous hook.
$effect(() => {
    if (!isDragging || !stripEl) return;
    const strip = stripEl.getBoundingClientRect();
    let raf = 0;
    const pin = () => {
        const el = document.getElementById("dnd-action-dragged-el");
        if (el) {
            const rect = el.getBoundingClientRect();
            const originLeft = Number.parseFloat(el.style.left) || 0;
            const m = el.style.transform.match(/translate3d\(([-\d.]+)px/);
            let dx = m ? Number.parseFloat(m[1]) : 0;
            // Keep [originLeft+dx, originLeft+dx+width] inside the strip.
            const minDx = strip.left - originLeft;
            const maxDx = strip.right - rect.width - originLeft;
            dx = Math.max(minDx, Math.min(maxDx, dx));
            el.style.transform = `translate3d(${dx}px, 0px, 0)`;
            // Tabs are bottom-aligned (items-end); anchor the clone's bottom
            // to the strip's bottom so it rides in the row, not above it.
            el.style.top = `${strip.bottom - rect.height}px`;
        }
        raf = requestAnimationFrame(pin);
    };
    raf = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(raf);
});

const dragDisabled = $derived(renamingTabId !== null);

function handleConsider(e: CustomEvent<DndEvent<TabMeta>>) {
    const { items, info } = e.detail;
    dndItems = items;
    if (info.trigger === TRIGGERS.DRAG_STARTED) isDragging = true;
}

function handleFinalize(e: CustomEvent<DndEvent<TabMeta>>) {
    const { items, info } = e.detail;
    dndItems = items;
    isDragging = false;
    // A pointer-driven reorder ends with a click on the dropped tab.
    if (info.source === SOURCES.POINTER) suppressClick = true;
    const order = items.map((t) => t.id);
    const changed = order.some((id, i) => id !== tabs[i]?.id);
    if (changed) ontabreorder(order);
}

function startRename(tab: TabMeta) {
    renamingTabId = tab.id;
    renameValue = tab.label;
    setTimeout(() => renameInputEl?.select(), 0);
}

function commitRename(tabId: string) {
    const trimmed = renameValue.trim() || "Tab";
    renamingTabId = null;
    ontabrename(tabId, trimmed);
}

function cancelRename() {
    renamingTabId = null;
}
</script>

<div
    class="mx-auto w-full max-w-[816px] flex items-end gap-0.5 select-none mt-8 max-[840px]:mx-3 max-[840px]:w-auto"
>
    <!--
        Inner strip: the actual tablist (holds only the tabs; the + button
        sits outside it). Tabs flex-shrink to fit, then scroll horizontally
        once they hit their minimum width. Mask fades the scrollable edges;
        the scrollbar is hidden (scrub by drag/wheel). min-w-0 lets it shrink
        below content size so the + button stays pinned and never scrolls.
    -->
    <div
        bind:this={stripEl}
        class="strip flex-1 min-w-0 flex items-end gap-0.5 overflow-x-auto scroll-smooth pt-2 -mt-2"
        style={maskStyle}
        role="tablist"
        aria-label="Document tabs"
        use:dndzone={{
            items: dndItems,
            flipDurationMs: FLIP_MS,
            dragDisabled,
            dropTargetStyle: {},
            morphDisabled: true,
            // Keep our own tablist/tab ARIA roles instead of the lib's
            // list/listitem ones (this is a tab strip, not a generic list).
            autoAriaDisabled: true,
        }}
        onconsider={handleConsider}
        onfinalize={handleFinalize}
    >
        {#each dndItems as tab (tab.id)}
            {@const isActive = tab.id === activeTabId}
            {@const isRenaming = renamingTabId === tab.id}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
                bind:this={tabEls[tab.id]}
                animate:flip={{ duration: FLIP_MS }}
                role="tab"
                aria-selected={isActive}
                tabindex={isActive ? 0 : -1}
                onclick={() => {
                    if (suppressClick) { suppressClick = false; return; }
                    if (!isActive) ontabselect(tab.id);
                }}
                ondblclick={() => startRename(tab)}
                class="
                    group relative flex items-center gap-1.5 px-3 text-sm cursor-pointer
                    min-w-[7.5rem] shrink rounded-t-lg transition-colors duration-100
                    {isActive
                        ? 'py-1.5 bg-white text-black/90 font-semibold shadow-[0_-2px_6px_rgba(0,0,0,0.06)] z-10 cursor-default'
                        : 'py-1 bg-white/45 backdrop-blur-sm text-black/50 hover:text-black/70 hover:bg-white/60 z-[1]'}
                "
            >
                <FileTextIcon size={12} class="shrink-0 {isActive ? 'text-black/50' : 'text-black/30'}" />
                {#if isRenaming}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <input
                        bind:this={renameInputEl}
                        bind:value={renameValue}
                        onclick={(e) => e.stopPropagation()}
                        onblur={() => commitRename(tab.id)}
                        onkeydown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitRename(tab.id); }
                            if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                        }}
                        class="bg-transparent border-none outline-none w-24 text-sm text-black/90 text-center"
                        aria-label="Rename tab"
                    />
                {:else}
                    <span class="flex-1 min-w-0 max-w-[8rem] truncate">{tab.label}</span>
                {/if}

                {#if tabs.length > 1}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <span
                        role="button"
                        tabindex="-1"
                        aria-label="Close tab"
                        onclick={(e) => { e.stopPropagation(); ontabdelete(tab.id); }}
                        class="
                            ml-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0
                            opacity-0 group-hover:opacity-100 transition-opacity
                            hover:bg-black/10 text-black/50
                        "
                    >×</span>
                {/if}
            </div>
        {/each}
    </div>

    <button
        onclick={ontabcreate}
        aria-label="New tab"
        title="New tab"
        class="shrink-0 mb-1 ml-1 p-1 rounded text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors"
    >
        <PlusIcon size={14} />
    </button>
</div>

<style>
    /* Hide the scrollbar; the mask gradient + drag/wheel handle scrubbing. */
    .strip {
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    .strip::-webkit-scrollbar {
        display: none;
    }

    /* Browser-tab drag feel: one solid tab slides within the row while
       siblings shuffle around it (like Chrome / VS Code), rather than a card
       lifting out with a hollow gap left behind.

       svelte-dnd-action always uses two elements — a floating clone
       (#dnd-action-dragged-el, mounted on <body>) and an in-list placeholder
       marking the drop slot. We render the clone as the solid moving tab (the
       rAF loop locks it into the row's height + horizontal bounds), and make
       the placeholder an invisible same-size gap the clone slides over, so
       only one solid tab is ever visible. */
    :global(#dnd-action-dragged-el) {
        outline: none;
        background: #fff;
        border-radius: 0.5rem 0.5rem 0 0;
        /* Subtle lift — it's sliding in the row, not hovering far above it. */
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
        backdrop-filter: none;
        opacity: 1;
        color: rgba(0, 0, 0, 0.85);
    }
    :global(#dnd-action-dragged-el svg),
    :global(#dnd-action-dragged-el span) {
        color: inherit;
    }
    /* × is hover-only; keep it hidden on the moving clone. */
    :global(#dnd-action-dragged-el [aria-label="Close tab"]) {
        opacity: 0;
    }

    /* The drop-slot placeholder: an empty gap (same width, no visuals) that
       the solid clone slides over — never a second visible tab. */
    :global(.strip [data-is-dnd-shadow-item-internal]) {
        background: transparent !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
    }
    :global(.strip [data-is-dnd-shadow-item-internal] *) {
        visibility: hidden !important;
    }
</style>
