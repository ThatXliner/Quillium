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
      ondraftdelete  — (draftId) delete any unlocked draft (soft, undoable);
                       the editor prompts orphan vs cascade if it has children
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

// Gutter geometry. Each indent column is COL_W wide; the rail sits at its
// horizontal centre. The dot lives DOT_X from the row's left edge (one column
// in past the deepest gutter rail), so the elbow's horizontal stub reaches it.
// Rails are 1px borders on absolutely-positioned divs (no SVG) to match the
// panel's existing Tailwind/border styling.
const COL_W = 16;
const DOT_X = COL_W;

/** True when an ancestor run-spine passes vertically through column `c`. */
function hasSpine(row: (typeof rows)[number], c: number): boolean {
    return row.spines.includes(c);
}

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
            class="group relative flex items-stretch gap-1 rounded-md pr-1 transition-colors
                {isActive ? 'bg-white shadow-sm' : 'hover:bg-white/50'}"
        >
            <!-- Draft-tree rails, drawn over the row's left gutter and dot
                 column. The dot sits at x = depth*COL_W + DOT_X; ancestor
                 spines and the branch elbow live in the columns left of it.
                 Shape carries the iterate-vs-branch meaning (straight spine vs
                 elbow); colour (grey vs amber) is the second channel so the
                 distinction survives without colour (BRANDING rule #4). -->
            <div class="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
                {#each Array(row.depth) as _, c (c)}
                    {@const railX = c * COL_W + DOT_X}
                    {#if row.branchConnector !== null && c === row.depth - 1}
                        <!-- Branch elbow into the parent column: vertical from
                             the top to mid-row, then a horizontal stub toward
                             the dot. A tee keeps the vertical going below; a
                             corner stops it. -->
                        <div
                            class="absolute top-0 w-px border-l border-amber-400/70
                                {row.branchConnector === 'corner' ? 'h-1/2' : 'h-full'}"
                            style="left: {railX}px"
                            data-rail="branch-{row.branchConnector}"
                        ></div>
                        <div
                            class="absolute top-1/2 h-px border-t border-amber-400/70"
                            style="left: {railX}px; width: {row.depth * COL_W + DOT_X - railX}px"
                        ></div>
                    {:else if hasSpine(row, c)}
                        <!-- Ancestor run-spine passing straight through. -->
                        <div
                            class="absolute top-0 h-full w-px border-l border-black/15"
                            style="left: {railX}px"
                            data-rail="spine"
                        ></div>
                    {/if}
                {/each}
                <!-- Run-spine through the dot: a segment above when this row is
                     a non-root iteration (joins the draft above), and below
                     when its run continues (joins the next iteration). -->
                {#if !isRunHead(row.draft) && row.branchConnector === null}
                    <div
                        class="absolute top-0 h-1/2 w-px border-l border-black/15"
                        style="left: {row.depth * COL_W + DOT_X}px"
                    ></div>
                {/if}
                {#if row.continuesRun}
                    <div
                        class="absolute bottom-0 h-1/2 w-px border-l border-black/15"
                        style="left: {row.depth * COL_W + DOT_X}px"
                        data-rail="run-continues"
                    ></div>
                {/if}
            </div>
            <button
                onclick={() => { if (!isActive) ondraftselect(row.draft.id); }}
                ondblclick={() => startRename(row.draft)}
                class="z-10 flex-1 min-w-0 flex items-center gap-2 py-1.5 pr-2.5 text-left
                    {isActive ? 'text-black/80 font-medium cursor-default' : 'text-black/50 hover:text-black/70'}"
                style="padding-left: {row.depth * COL_W + DOT_X - 3}px"
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
