<!--
    DraftTreePanel.svelte — Draft tree sidebar for the active tab (#160).

    Renders the tab's drafts as an indented tree (parentDraftId links).
    Each row supports: click to switch, double-click to rename, hover
    actions to branch / toggle lock / delete (leaves only).

    Props:
      drafts         — flat DraftMeta list for the active tab
      activeDraftId  — id of the draft currently in the editor
      ondraftselect  — (draftId) switch the editor to this draft
      ondraftfork    — (draftId) branch a child off this draft
      ondraftrename  — (draftId, label) after inline rename
      ondraftdelete  — (draftId) delete a leaf draft
      ontogglelock   — (draftId, locked) set the soft lock
-->
<script lang="ts">
import type { DraftMeta } from "$lib/db/types";
import { GitBranchIcon, LockIcon, LockOpenIcon, Trash2Icon } from "lucide-svelte";
import { buildDraftTree, flattenDraftTree, isDeletableDraft } from "./draftTree";

const {
    drafts,
    activeDraftId,
    ondraftselect,
    ondraftfork,
    ondraftrename,
    ondraftdelete,
    ontogglelock,
}: {
    drafts: DraftMeta[];
    activeDraftId: string | null;
    ondraftselect: (draftId: string) => void;
    ondraftfork: (draftId: string) => void;
    ondraftrename: (draftId: string, label: string) => void;
    ondraftdelete: (draftId: string) => void;
    ontogglelock: (draftId: string, locked: boolean) => void;
} = $props();

const rows = $derived(flattenDraftTree(buildDraftTree(drafts)));

let renamingDraftId = $state<string | null>(null);
let renameValue = $state("");
let renameInputEl = $state<HTMLInputElement | undefined>();

function startRename(draft: DraftMeta) {
    renamingDraftId = draft.id;
    renameValue = draft.label;
    setTimeout(() => renameInputEl?.select(), 0);
}

function commitRename(draftId: string) {
    const trimmed = renameValue.trim() || "draft";
    renamingDraftId = null;
    ondraftrename(draftId, trimmed);
}
</script>

<div
    class="w-44 rounded-lg bg-white/45 backdrop-blur-sm shadow-md py-2 px-1.5 select-none"
    aria-label="Draft tree"
>
    <div class="flex items-center gap-1.5 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-black/35">
        <GitBranchIcon size={11} />
        <span>Drafts</span>
    </div>

    {#each rows as row (row.draft.id)}
        {@const isActive = row.draft.id === activeDraftId}
        {@const isRenaming = renamingDraftId === row.draft.id}
        <div
            class="group relative flex items-center gap-1 rounded-md pr-1 transition-colors
                {isActive ? 'bg-white shadow-sm' : 'hover:bg-white/50'}"
            style="margin-left: {row.depth * 10}px"
        >
            <button
                onclick={() => { if (!isActive) ondraftselect(row.draft.id); }}
                ondblclick={() => startRename(row.draft)}
                class="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 text-left
                    {isActive ? 'text-black/80 font-medium cursor-default' : 'text-black/50 hover:text-black/70'}"
                aria-current={isActive ? "true" : undefined}
            >
                <span class="w-1.5 h-1.5 rounded-full shrink-0 {isActive ? 'bg-amber-500' : 'bg-black/20'}"></span>
                {#if isRenaming}
                    <input
                        bind:this={renameInputEl}
                        bind:value={renameValue}
                        onblur={() => commitRename(row.draft.id)}
                        onkeydown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitRename(row.draft.id); }
                            if (e.key === "Escape") { e.preventDefault(); renamingDraftId = null; }
                        }}
                        onclick={(e) => e.stopPropagation()}
                        class="w-full bg-transparent border-none outline-none text-xs text-black/80"
                        aria-label="Rename draft"
                    />
                {:else}
                    <span class="text-xs truncate">{row.draft.label}</span>
                {/if}
                {#if row.draft.locked}
                    <LockIcon size={10} class="shrink-0 text-black/30" />
                {/if}
            </button>

            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                    onclick={() => ondraftfork(row.draft.id)}
                    title="Branch from this draft"
                    aria-label="Branch from {row.draft.label}"
                    class="p-0.5 rounded text-black/30 hover:text-black/60 hover:bg-black/5"
                >
                    <GitBranchIcon size={11} />
                </button>
                {#if row.draft.locked}
                    <button
                        onclick={() => ontogglelock(row.draft.id, false)}
                        title="Unlock for editing"
                        aria-label="Unlock {row.draft.label}"
                        class="p-0.5 rounded text-black/30 hover:text-amber-600 hover:bg-black/5"
                    >
                        <LockOpenIcon size={11} />
                    </button>
                {/if}
                {#if isDeletableDraft(row.draft.id, drafts)}
                    <button
                        onclick={() => ondraftdelete(row.draft.id)}
                        title="Delete draft"
                        aria-label="Delete {row.draft.label}"
                        class="p-0.5 rounded text-black/30 hover:text-red-500 hover:bg-black/5"
                    >
                        <Trash2Icon size={11} />
                    </button>
                {/if}
            </div>
        </div>
    {/each}
</div>
