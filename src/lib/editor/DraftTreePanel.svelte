<!--
    DraftTreePanel.svelte — Draft panel for the active tab (#160).

    Iterations of a draft render FLAT (a run); branches render INDENTED.
    Each row: click to switch, double-click to rename, hover actions to
    iterate / branch / lock / delete.

    Props:
      drafts         — flat DraftMeta list for the active tab
      activeDraftId  — id of the draft currently in the editor
      ondraftselect  — (draftId) switch the editor to this draft
      ondraftiterate — (draftId) make the next version in this draft's run
      ondraftbranch  — (draftId) start a different take off this draft
      ondraftrename  — (draftId, label) after inline rename
      ondraftdelete  — (draftId) delete a leaf draft (soft, undoable)
      ontogglelock   — (draftId, locked) set the soft lock manually
-->
<script lang="ts">
import type { DraftMeta } from "$lib/db/types";
import { ChevronsDownIcon, GitBranchIcon, LockIcon, LockOpenIcon, Trash2Icon } from "lucide-svelte";
import { isDeletableDraft, isRunHead, layoutDraftRows } from "./draftTree";

const {
    drafts,
    activeDraftId,
    ondraftselect,
    ondraftiterate,
    ondraftbranch,
    ondraftrename,
    ondraftdelete,
    ontogglelock,
}: {
    drafts: DraftMeta[];
    activeDraftId: string | null;
    ondraftselect: (draftId: string) => void;
    ondraftiterate: (draftId: string) => void;
    ondraftbranch: (draftId: string) => void;
    ondraftrename: (draftId: string, label: string) => void;
    ondraftdelete: (draftId: string) => void;
    ontogglelock: (draftId: string, locked: boolean) => void;
} = $props();

const rows = $derived(layoutDraftRows(drafts));

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
    class="w-52 rounded-lg bg-white/45 backdrop-blur-sm shadow-md py-2 px-1.5 select-none"
    aria-label="Draft tree"
>
    <div class="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-black/35">
        <GitBranchIcon size={12} />
        <span>Drafts</span>
    </div>

    {#each rows as row (row.draft.id)}
        {@const isActive = row.draft.id === activeDraftId}
        {@const isRenaming = renamingDraftId === row.draft.id}
        <div
            class="group relative flex items-center gap-1 rounded-md pr-1 transition-colors
                {isActive ? 'bg-white shadow-sm' : 'hover:bg-white/50'}"
            style="margin-left: {row.depth * 14}px"
        >
            <button
                onclick={() => { if (!isActive) ondraftselect(row.draft.id); }}
                ondblclick={() => startRename(row.draft)}
                class="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left
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
                        class="w-full bg-transparent border-none outline-none text-sm text-black/80"
                        aria-label="Rename draft"
                    />
                {:else}
                    <span class="text-sm truncate">{row.draft.label}</span>
                {/if}
                {#if row.draft.locked}
                    <LockIcon size={12} class="shrink-0 text-black/30" />
                {/if}
            </button>

            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <!-- Iterate: next version, only offered on a run's live tip
                     (iterating a superseded draft would fork the chain). -->
                {#if row.isRunTip}
                    <button
                        onclick={() => ondraftiterate(row.draft.id)}
                        title="New version (continue from this draft)"
                        aria-label="Iterate {row.draft.label}"
                        class="p-1 rounded text-black/30 hover:text-black/60 hover:bg-black/5"
                    >
                        <ChevronsDownIcon size={13} />
                    </button>
                {/if}
                <!-- Branch: a different take. Not on a run head (main / branch
                     root) — a top-level take is a new tab. -->
                {#if !isRunHead(row.draft)}
                    <button
                        onclick={() => ondraftbranch(row.draft.id)}
                        title="Branch a different take from this draft"
                        aria-label="Branch from {row.draft.label}"
                        class="p-1 rounded text-black/30 hover:text-black/60 hover:bg-black/5"
                    >
                        <GitBranchIcon size={13} />
                    </button>
                {/if}
                {#if row.draft.locked}
                    <button
                        onclick={() => ontogglelock(row.draft.id, false)}
                        title="Unlock for editing"
                        aria-label="Unlock {row.draft.label}"
                        class="p-1 rounded text-black/30 hover:text-amber-600 hover:bg-black/5"
                    >
                        <LockOpenIcon size={13} />
                    </button>
                {:else}
                    <button
                        onclick={() => ontogglelock(row.draft.id, true)}
                        title="Lock against edits"
                        aria-label="Lock {row.draft.label}"
                        class="p-1 rounded text-black/30 hover:text-amber-600 hover:bg-black/5"
                    >
                        <LockIcon size={13} />
                    </button>
                {/if}
                {#if isDeletableDraft(row.draft.id, drafts)}
                    <button
                        onclick={() => ondraftdelete(row.draft.id)}
                        title="Delete draft (undoable)"
                        aria-label="Delete {row.draft.label}"
                        class="p-1 rounded text-black/30 hover:text-red-500 hover:bg-black/5"
                    >
                        <Trash2Icon size={13} />
                    </button>
                {/if}
            </div>
        </div>
    {/each}
</div>
