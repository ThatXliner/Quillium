<script lang="ts">
import { Link2, Maximize2, Trash2 } from "lucide-svelte";
import { type Snippet, tick } from "svelte";
import type { RevisionVersionView } from "./types";

let {
    revisionId,
    active,
    versions,
    linkTargetable = false,
    editingVersionIndex = null,
    editingLabel = "",
    onEditingLabelInput,
    onCommitRename,
    onCancelRename,
    onRenameVersion,
    onSelectVersion,
    onOpen,
    onDelete,
    versionControls,
    versionMenu,
    afterVersions,
    actions,
    editor,
    thread,
}: {
    revisionId: string | number;
    active: boolean;
    versions: RevisionVersionView[];
    linkTargetable?: boolean;
    editingVersionIndex?: number | null;
    editingLabel?: string;
    onEditingLabelInput?: (value: string) => void;
    onCommitRename?: () => void;
    onCancelRename?: () => void;
    onRenameVersion?: (version: RevisionVersionView) => void;
    onSelectVersion?: (version: RevisionVersionView) => void;
    onOpen?: () => void;
    onDelete?: () => void;
    versionControls?: Snippet<[RevisionVersionView]>;
    versionMenu?: Snippet<[RevisionVersionView]>;
    afterVersions?: Snippet;
    actions?: Snippet;
    editor?: Snippet;
    thread?: Snippet;
} = $props();

let labelInput = $state<HTMLInputElement>();
$effect(() => {
    if (editingVersionIndex === null) return;
    void tick().then(() => labelInput?.focus());
});
</script>

<!-- The non-clipping root is intentional: desktop link menus escape the pill/card.
     A clipped ::before layer carries the glass blur without a square WebKit halo. -->
<div
    data-annotation-card="revision"
    data-annotation-card-view="revision"
    data-annotation-id={revisionId}
    data-active={active}
    data-tutorial-role="revision-card"
    data-revision-id={revisionId}
    class="revision-glass relative border rounded-[14px] transition-all duration-200
        {active
            ? 'border-purple-200/60 shadow-xl revision-glass-active'
            : 'border-purple-200/40 shadow-lg opacity-90 hover:opacity-100'}"
>
    <div class="flex items-center justify-between px-3 pt-3 pb-2">
        <h3 class="text-[10px] font-semibold text-purple-600/70 uppercase tracking-wider">
            Revision
        </h3>
        {#if onOpen || onDelete}
            <div class="flex items-center gap-0.5">
                {#if onOpen}
                    <button
                        data-tutorial-action="expand-revision-modal"
                        data-revision-id={revisionId}
                        class="p-1 rounded-md text-purple-400/50 hover:text-purple-600/70 hover:bg-white/40 transition-colors"
                        onclick={onOpen}
                        title="Expand editor"
                        aria-label="Expand revision editor"
                    ><Maximize2 size={14} /></button>
                {/if}
                {#if onDelete}
                    <button
                        class="p-1 rounded-md text-purple-400/50 hover:text-red-500/60 hover:bg-white/40 transition-colors"
                        onclick={onDelete}
                        title="Delete entire revision"
                    ><Trash2 size={16} /></button>
                {/if}
            </div>
        {/if}
    </div>

    <div class="px-3 pb-2 flex flex-wrap items-center gap-1">
        {#each versions as version (version.id)}
            <div class="relative inline-flex">
                <div
                    class="inline-flex items-center rounded-md overflow-hidden
                        {version.active
                            ? 'bg-purple-500/80 ring-1 ring-purple-400/40'
                            : 'bg-white/60 ring-1 ring-purple-200/40'}
                        {linkTargetable ? 'ring-2 ring-dashed ring-blue-500/50' : ''}"
                    data-version-group-id={version.group?.id}
                    title={version.group
                        ? `Linked — group "${version.group.label}" (${version.group.memberCount} versions)`
                        : undefined}
                >
                    {#if version.group}
                        <span
                            class="ml-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                            style:background-color={version.group.color}
                        ></span>
                    {/if}
                    {#if editingVersionIndex === version.index}
                        <input
                            bind:this={labelInput}
                            value={editingLabel}
                            class="px-2 py-1 text-[11px] font-medium w-[100px] bg-transparent text-white outline-none placeholder-white/50"
                            placeholder="Version name…"
                            oninput={(event) => onEditingLabelInput?.(event.currentTarget.value)}
                            onblur={onCommitRename}
                            onkeydown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    onCommitRename?.();
                                } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    onCancelRename?.();
                                }
                            }}
                        />
                    {:else}
                        <button
                            aria-label={version.group
                                ? `${version.label ?? (version.text.slice(0, 28) || "(empty)")}, linked in ${version.group.label} with ${version.group.memberCount - 1} other version${version.group.memberCount === 2 ? "" : "s"}`
                                : undefined}
                            class="max-w-[120px] {version.group ? 'pl-1' : 'pl-2'} pr-2 py-1 text-[11px] font-medium truncate transition-colors
                                {version.active ? 'text-white' : 'text-black/65 hover:text-black/85'}"
                            disabled={version.active && !linkTargetable}
                            title={linkTargetable
                                ? "Link this version to the anchored one"
                                : version.active && onRenameVersion
                                  ? "Double-click to rename"
                                  : version.text || "(empty)"}
                            onclick={() => onSelectVersion?.(version)}
                            ondblclick={() => {
                                if (version.active && !linkTargetable) onRenameVersion?.(version);
                            }}
                        >
                            {version.label ?? (version.text.slice(0, 28) || "(empty)")}
                        </button>
                    {/if}
                    {#if versionControls}
                        {@render versionControls(version)}
                    {:else if version.group}
                        <span
                            class="px-1 py-1 {version.active ? 'text-white/70' : 'text-blue-600/80'}"
                            aria-label={`Linked to ${version.group.memberCount - 1} other version${version.group.memberCount === 2 ? "" : "s"} in ${version.group.label}`}
                        ><Link2 size={10} /></span>
                    {/if}
                </div>
                {#if versionMenu}
                    {@render versionMenu(version)}
                {/if}
            </div>
        {/each}
    </div>

    {#if afterVersions}{@render afterVersions()}{/if}
    {#if actions}{@render actions()}{/if}
    {#if editor}{@render editor()}{/if}
    {#if thread}
        <div data-annotation-thread class="border-t border-black/[0.07] px-3 py-2.5">
            {@render thread()}
        </div>
    {/if}
</div>

<style>
    .revision-glass { isolation: isolate; }
    .revision-glass::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: 14px;
        overflow: hidden;
        background: rgba(250, 245, 255, 0.6);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        pointer-events: none;
    }
    .revision-glass-active::before { background: rgba(250, 245, 255, 0.9); }
</style>
