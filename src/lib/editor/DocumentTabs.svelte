<!--
    DocumentTabs.svelte — Browser-style tab bar for document tabs (#160).

    Props:
      tabs        — ordered list of TabMeta
      activeTabId — id of the currently active tab
      ontabselect — called with (tabId) when user clicks an inactive tab
      ontabcreate — called when user clicks +
      ontabrename — called with (tabId, newLabel) after inline rename
      ontabdelete — called with (tabId) when user clicks ×
      ontabreorder — called with the full tab-id list in its new order after a drag

    Notes:
      - × is hidden when tabs.length === 1 (can't close last tab)
      - Double-click on label enters rename mode
      - Rename commits on Enter or blur, cancels on Escape
      - Sits flush above the document card; the active tab blends into it

    Drag-to-reorder is a custom pointer-events implementation (NOT a library):
    the dragged tab is the REAL in-row element translated on the X axis only —
    never a detached floating clone — so it reads as one solid tab sliding in
    the strip while siblings shuffle around it (the Chrome / VS Code model).
    See the "Drag-to-reorder" block below.
-->
<script lang="ts">
import type { TabMeta } from "$lib/db/types";
import { FileTextIcon, PlusIcon } from "lucide-svelte";
import { tick } from "svelte";
import { flip } from "svelte/animate";
import { computeReorder } from "./tabReorder";

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

// ── Drag-to-reorder ───────────────────────────────────────────────
// Browser-tab model: drag the REAL in-row tab on the X axis only (no floating
// clone), reordering a working copy `order` live as the dragged tab's centre
// crosses neighbours' midpoints. Siblings animate via animate:flip; the dragged
// tab tracks the pointer 1:1 (no transition) and is excluded from flip. The
// translate is clamped to the strip and the strip auto-scrolls near its edges,
// so the tab can never leave the row.
const FLIP_MS = 150;
const DRAG_THRESHOLD = 4; // px before a press becomes a drag (vs. a click)
const EDGE_ZONE = 36; // px from a strip edge that triggers auto-scroll
const EDGE_SPEED = 12; // px per frame of edge auto-scroll

// Working order during a drag; mirrors `tabs` at rest, reordered live on drag.
let order = $state<string[]>([]);
let draggingId = $state<string | null>(null);
let dragDx = $state(0); // current X translate of the dragged tab
// A drag that ends on the same tab still fires a click; eat that one so a
// drag-release doesn't also switch tabs.
let suppressClick = false;

// Drag bookkeeping (plain locals — not reactive).
let pointerId = -1;
let pressStartX = 0; // clientX at pointerdown
let armed = false; // pressed but not yet past the threshold
let grabbedEl: HTMLElement | null = null;
let homeLeft = 0; // dragged tab's left (strip content coords) at drag start
let edgeRaf = 0;
let lastClientX = 0;

// The list to render: the live drag order while dragging, else the real tabs.
const displayTabs = $derived(
    draggingId
        ? order.map((id) => tabs.find((t) => t.id === id)).filter((t): t is TabMeta => t != null)
        : tabs,
);

function onTabPointerDown(e: PointerEvent, tab: TabMeta) {
    // Left button only; ignore presses on the × or the rename input, and
    // never start a drag while renaming.
    if (e.button !== 0 || renamingTabId !== null) return;
    const target = e.target as HTMLElement;
    if (target.closest('[aria-label="Close tab"]') || target.closest("input")) return;
    if (!stripEl) return;

    pointerId = e.pointerId;
    pressStartX = e.clientX;
    lastClientX = e.clientX;
    armed = true;
    grabbedEl = tabEls[tab.id] ?? null;
    // Capture so move/up keep flowing even if the pointer leaves the tab.
    grabbedEl?.setPointerCapture?.(e.pointerId);
}

function beginDrag(tab: TabMeta) {
    if (!stripEl || !grabbedEl) return;
    draggingId = tab.id;
    order = tabs.map((t) => t.id);
    dragDx = 0;
    // Home position in strip content coordinates (independent of scroll).
    const stripRect = stripEl.getBoundingClientRect();
    homeLeft = grabbedEl.getBoundingClientRect().left - stripRect.left + stripEl.scrollLeft;
}

function onTabPointerMove(e: PointerEvent) {
    if (e.pointerId !== pointerId || (!armed && !draggingId)) return;
    lastClientX = e.clientX;

    if (armed && !draggingId) {
        if (Math.abs(e.clientX - pressStartX) < DRAG_THRESHOLD) return;
        armed = false;
        const tab = tabs.find((t) => t.id === (grabbedEl?.dataset.tabId ?? ""));
        if (tab) beginDrag(tab);
        if (!draggingId) return;
    }

    updateDrag();
    runEdgeAutoScroll();
}

// Recompute the dragged tab's translate + live order from the current pointer
// position. Split out so both pointermove and the edge-scroll loop can call it.
function updateDrag() {
    if (!stripEl || !draggingId || !grabbedEl) return;
    const stripRect = stripEl.getBoundingClientRect();
    const width = grabbedEl.getBoundingClientRect().width;

    // Desired left edge (strip content coords) = pointer + scroll - half width,
    // clamped so the tab stays fully inside the strip's scrollable content.
    const desiredLeft = lastClientX - stripRect.left + stripEl.scrollLeft - width / 2;
    const maxLeft = Math.max(0, stripEl.scrollWidth - width);
    const clampedLeft = Math.max(0, Math.min(maxLeft, desiredLeft));
    dragDx = clampedLeft - homeLeft;

    // Reorder when the dragged tab's centre crosses a neighbour's midpoint.
    const centerX = clampedLeft + width / 2;
    const rects: Record<string, { left: number; width: number }> = {};
    for (const id of order) {
        const el = tabEls[id];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        rects[id] = { left: r.left - stripRect.left + stripEl.scrollLeft, width: r.width };
    }
    const next = computeReorder(centerX, rects, order, draggingId);
    if (next.length === order.length && next.some((id, i) => id !== order[i])) {
        order = next;
        // The dragged tab's resting slot moved; keep dx relative to its new home
        // so it doesn't teleport. Recompute home from its new index next frame
        // (the DOM updates after this assignment), so defer via the flip pass:
        // simplest correct approach is to re-derive home on the next move from
        // the element's post-flip position. We approximate by re-reading home
        // immediately after Svelte applies the order on the next tick.
        tick().then(() => {
            if (!stripEl || !grabbedEl || !draggingId) return;
            const sr = stripEl.getBoundingClientRect();
            const cur = grabbedEl.getBoundingClientRect();
            // Current visual left (without transform) = element left - dragDx.
            const visualLeft = cur.left - sr.left + stripEl.scrollLeft - dragDx;
            homeLeft = visualLeft;
            dragDx = clampedLeft - homeLeft;
        });
    }
}

function runEdgeAutoScroll() {
    if (edgeRaf || !stripEl || !draggingId) return;
    const step = () => {
        if (!stripEl || !draggingId) {
            edgeRaf = 0;
            return;
        }
        const rect = stripEl.getBoundingClientRect();
        let dir = 0;
        if (lastClientX < rect.left + EDGE_ZONE && stripEl.scrollLeft > 0) dir = -1;
        else if (
            lastClientX > rect.right - EDGE_ZONE &&
            stripEl.scrollLeft + stripEl.clientWidth < stripEl.scrollWidth
        )
            dir = 1;
        if (dir !== 0) {
            stripEl.scrollLeft += dir * EDGE_SPEED;
            updateDrag();
            edgeRaf = requestAnimationFrame(step);
        } else {
            edgeRaf = 0;
        }
    };
    edgeRaf = requestAnimationFrame(step);
}

function endDrag() {
    if (edgeRaf) {
        cancelAnimationFrame(edgeRaf);
        edgeRaf = 0;
    }
    grabbedEl?.releasePointerCapture?.(pointerId);
    if (draggingId) {
        const changed = order.some((id, i) => id !== tabs[i]?.id);
        if (changed) {
            suppressClick = true;
            ontabreorder(order);
        }
    }
    draggingId = null;
    dragDx = 0;
    armed = false;
    grabbedEl = null;
    pointerId = -1;
}

function onTabPointerUp(e: PointerEvent) {
    if (e.pointerId !== pointerId) return;
    endDrag();
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

<!--
    While dragging, lift the whole strip above the sticky toolbar (z-50 in
    Editor.svelte). Inner tab z-index alone can't win — the strip sits in a
    lower stacking layer than the toolbar, so without this the toolbar paints
    over a tab dragged toward the top edge. `relative` makes z-index apply.
-->
<div
    class="mx-auto w-full max-w-[816px] flex items-end gap-0.5 select-none mt-8 max-[840px]:mx-3 max-[840px]:w-auto relative {draggingId ? 'z-[60]' : ''}"
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
    >
        {#each displayTabs as tab (tab.id)}
            {@const isActive = tab.id === activeTabId}
            {@const isRenaming = renamingTabId === tab.id}
            {@const isDragged = draggingId === tab.id}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
                bind:this={tabEls[tab.id]}
                data-tab-id={tab.id}
                animate:flip={{ duration: isDragged ? 0 : FLIP_MS }}
                role="tab"
                aria-selected={isActive}
                tabindex={isActive ? 0 : -1}
                onpointerdown={(e) => onTabPointerDown(e, tab)}
                onpointermove={onTabPointerMove}
                onpointerup={onTabPointerUp}
                onpointercancel={onTabPointerUp}
                onclick={() => {
                    if (suppressClick) { suppressClick = false; return; }
                    if (!isActive) ontabselect(tab.id);
                }}
                ondblclick={() => startRename(tab)}
                style={isDragged ? `transform: translateX(${dragDx}px); z-index: 30;` : ""}
                class="
                    group relative flex items-center gap-1.5 px-3 text-sm cursor-pointer
                    min-w-[7.5rem] shrink rounded-t-lg transition-colors duration-100
                    {isDragged
                        ? 'py-1.5 bg-white text-black/90 font-semibold !transition-none cursor-grabbing shadow-[0_-1px_8px_rgba(0,0,0,0.12)]'
                        : isActive
                          ? 'py-1.5 bg-white text-black/90 font-semibold shadow-[0_-2px_6px_rgba(0,0,0,0.06)] z-10 cursor-default'
                          : 'py-1 bg-white/45 backdrop-blur-sm text-black/50 hover:text-black/70 hover:bg-white/60 z-[1]'}
                "
            >
                <FileTextIcon size={12} class="shrink-0 {isActive || isDragged ? 'text-black/50' : 'text-black/30'}" />
                {#if isRenaming}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <input
                        bind:this={renameInputEl}
                        bind:value={renameValue}
                        onclick={(e) => e.stopPropagation()}
                        onpointerdown={(e) => e.stopPropagation()}
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
                        onpointerdown={(e) => e.stopPropagation()}
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
</style>
