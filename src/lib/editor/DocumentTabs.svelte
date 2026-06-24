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

// ── Drag-to-reorder ───────────────────────────────────────────────
// During a drag we render `dragOrder` (a working copy of the tab ids) so
// the strip reorders live under the pointer; on drop we hand the final
// order to the parent, which persists it. A click suppression flag stops
// the drag's terminating click from also selecting/switching tabs.
let draggingId = $state<string | null>(null);
let dragOrder = $state<string[] | null>(null);
let suppressClick = false;

// The list to render: the live drag preview while dragging, else the
// real tab order. Mapped back to TabMeta so the template is unchanged.
const displayTabs = $derived(
    dragOrder
        ? dragOrder
              .map((id) => tabs.find((t) => t.id === id))
              .filter((t): t is TabMeta => t !== undefined)
        : tabs,
);

function onDragStart(e: DragEvent, tab: TabMeta) {
    // Don't start a reorder while renaming a tab inline.
    if (renamingTabId) {
        e.preventDefault();
        return;
    }
    draggingId = tab.id;
    dragOrder = tabs.map((t) => t.id);
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        // Firefox requires data to be set for a drag to begin.
        e.dataTransfer.setData("text/plain", tab.id);
    }
}

function onDragOverTab(e: DragEvent, overId: string) {
    if (!draggingId || !dragOrder || overId === draggingId) return;
    e.preventDefault(); // allow drop
    if (!Number.isFinite(e.clientX)) return;
    const from = dragOrder.indexOf(draggingId);
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    // Insert before the hovered tab if the pointer is on its left half.
    const before = e.clientX < rect.left + rect.width / 2;
    const overIdx = dragOrder.indexOf(overId);
    let to = before ? overIdx : overIdx + 1;
    if (to > from) to -= 1; // account for removing the dragged item first
    if (to === from) return;
    const next = dragOrder.filter((id) => id !== draggingId);
    next.splice(to, 0, draggingId);
    dragOrder = next;
}

function onDragEnd() {
    if (dragOrder && draggingId) {
        const original = tabs.map((t) => t.id);
        const changed = dragOrder.some((id, i) => id !== original[i]);
        if (changed) {
            suppressClick = true;
            ontabreorder(dragOrder);
        }
    }
    draggingId = null;
    dragOrder = null;
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
    role="tablist"
    aria-label="Document tabs"
>
    <!--
        Inner strip: tabs flex-shrink to fit, then scroll horizontally once
        they hit their minimum width. Mask fades the scrollable edges; the
        scrollbar is hidden (scrub by drag/wheel). min-w-0 lets it shrink
        below content size so the + button stays pinned and never scrolls.
    -->
    <div
        bind:this={stripEl}
        class="strip flex-1 min-w-0 flex items-end gap-0.5 overflow-x-auto scroll-smooth pt-2 -mt-2"
        style={maskStyle}
    >
        {#each displayTabs as tab (tab.id)}
            {@const isActive = tab.id === activeTabId}
            {@const isRenaming = renamingTabId === tab.id}
            {@const isDragging = draggingId === tab.id}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
                bind:this={tabEls[tab.id]}
                animate:flip={{ duration: 150 }}
                role="tab"
                aria-selected={isActive}
                tabindex={isActive ? 0 : -1}
                draggable={!isRenaming}
                ondragstart={(e) => onDragStart(e, tab)}
                ondragover={(e) => onDragOverTab(e, tab.id)}
                ondragend={onDragEnd}
                ondrop={(e) => e.preventDefault()}
                onclick={() => {
                    if (suppressClick) { suppressClick = false; return; }
                    if (!isActive) ontabselect(tab.id);
                }}
                ondblclick={() => startRename(tab)}
                class="
                    group relative flex items-center gap-1.5 px-3 text-sm cursor-pointer
                    min-w-[7.5rem] shrink rounded-t-lg transition-colors duration-100
                    {isDragging ? 'opacity-40' : ''}
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
</style>
