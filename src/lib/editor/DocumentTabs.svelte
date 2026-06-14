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

const {
    tabs,
    activeTabId,
    ontabselect,
    ontabcreate,
    ontabrename,
    ontabdelete,
}: {
    tabs: TabMeta[];
    activeTabId: string | null;
    ontabselect: (tabId: string) => void;
    ontabcreate: () => void;
    ontabrename: (tabId: string, label: string) => void;
    ontabdelete: (tabId: string) => void;
} = $props();

let renamingTabId = $state<string | null>(null);
let renameValue = $state("");
let renameInputEl = $state<HTMLInputElement | undefined>();

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
    {#each tabs as tab (tab.id)}
        {@const isActive = tab.id === activeTabId}
        {@const isRenaming = renamingTabId === tab.id}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            role="tab"
            aria-selected={isActive}
            tabindex={isActive ? 0 : -1}
            onclick={() => { if (!isActive) ontabselect(tab.id); }}
            ondblclick={() => startRename(tab)}
            class="
                group relative flex items-center gap-1.5 px-3 text-sm cursor-pointer
                rounded-t-lg transition-colors duration-100
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
                <span class="max-w-[8rem] truncate">{tab.label}</span>
            {/if}

            {#if tabs.length > 1}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <span
                    role="button"
                    tabindex="-1"
                    aria-label="Close tab"
                    onclick={(e) => { e.stopPropagation(); ontabdelete(tab.id); }}
                    class="
                        ml-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px]
                        opacity-0 group-hover:opacity-100 transition-opacity
                        hover:bg-black/10 text-black/50
                    "
                >×</span>
            {/if}
        </div>
    {/each}

    <button
        onclick={ontabcreate}
        aria-label="New tab"
        title="New tab"
        class="mb-1 ml-1 p-1 rounded text-black/30 hover:text-black/60 hover:bg-white/40 transition-colors"
    >
        <PlusIcon size={14} />
    </button>
</div>
