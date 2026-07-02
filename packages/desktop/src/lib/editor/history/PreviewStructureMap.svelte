<!--
    PreviewStructureMap.svelte — Read-only document structure as-of a coordinate.

    Renders the tab strip (clickable — click a tab to view its content at this
    point) and the drafts of the currently-viewed tab (reusing the pure
    `layoutDraftRows` so iteration runs stay flat and branches indent). The
    coordinate's own target tab/draft is emphasised. Purely presentational
    otherwise (no hover actions, no drag).

    Props:
      tabs           — tabs live at the coordinate (already rewound)
      drafts         — drafts live at the coordinate (already rewound)
      viewedTabId    — the tab whose content is shown (controlled by the parent)
      highlightDraftId — the coordinate's target draft, emphasised
      ontabselect    — (tabId) view this tab's content at the coordinate
-->
<script lang="ts">
import type { DraftMeta, TabMeta } from "$lib/db/types";
import { FileTextIcon, GitBranchIcon, LockIcon } from "lucide-svelte";
import { layoutDraftRows } from "../draftTree";

const {
    tabs,
    drafts,
    viewedTabId = null,
    highlightDraftId = null,
    ontabselect,
}: {
    tabs: TabMeta[];
    drafts: DraftMeta[];
    viewedTabId?: string | null;
    highlightDraftId?: string | null;
    ontabselect: (tabId: string) => void;
} = $props();

const shownDrafts = $derived(drafts.filter((d) => d.tabId === viewedTabId));
const rows = $derived(layoutDraftRows(shownDrafts));
</script>

<div class="flex flex-col gap-3 text-sm">
    <!-- Tab strip (clickable) -->
    <div class="flex flex-wrap gap-1.5">
        {#each tabs as tab (tab.id)}
            <button
                onclick={() => ontabselect(tab.id)}
                class="px-2.5 py-1 rounded-md text-xs font-medium border transition-colors
                       {tab.id === viewedTabId
                           ? 'bg-blue-50 border-blue-300 text-blue-700'
                           : 'bg-black/[0.03] border-black/[0.08] text-black/55 hover:bg-black/[0.06]'}"
            >
                {tab.label}
            </button>
        {/each}
        {#if tabs.length === 0}
            <span class="text-xs text-black/35">No tabs at this point</span>
        {/if}
    </div>

    <!-- Draft tree for the viewed tab -->
    <div class="rounded-lg border border-black/[0.08] bg-white/60 p-2">
        {#if rows.length === 0}
            <p class="text-xs text-black/35 px-1 py-2">No drafts</p>
        {:else}
            {#each rows as row (row.draft.id)}
                {@const isTarget = row.draft.id === highlightDraftId}
                <div
                    class="flex items-center gap-1.5 py-1 px-1 rounded-md
                           {isTarget ? 'bg-blue-50 ring-1 ring-blue-300' : ''}"
                    style="margin-left: {row.depth * 16}px"
                >
                    {#if row.branchConnector}
                        <GitBranchIcon size={11} class="text-amber-500/70 flex-shrink-0" />
                    {:else}
                        <FileTextIcon size={11} class="text-black/30 flex-shrink-0" />
                    {/if}
                    <span
                        class="text-xs truncate
                               {isTarget ? 'text-blue-700 font-medium' : 'text-black/60'}"
                    >
                        {row.draft.label}
                    </span>
                    <!-- No "tip" badge here: this map is a read-only historical
                         preview, so "which draft is the editable tip" is not
                         meaningful. Lock state IS historical state, so keep it. -->
                    {#if row.draft.locked}
                        <LockIcon size={9} class="text-amber-500/60 flex-shrink-0" />
                    {/if}
                </div>
            {/each}
        {/if}
    </div>
</div>
