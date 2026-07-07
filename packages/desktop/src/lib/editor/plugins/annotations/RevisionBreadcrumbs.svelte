<!--
    RevisionBreadcrumbs.svelte — Breadcrumb trail of the revision modal.

    One entry per modal-stack level, each with a version dropdown; the current
    (deepest) level also supports double-click label renaming and per-version
    deletion. Owns the dropdown-open and label-editing UI state; version
    switches/deletes go back through the modal's callbacks so the FSM stays
    the single owner of editor rebuilds.
-->
<script lang="ts">
import { modalStack } from "$lib/stores";
import type { ModalEntry } from "$lib/stores";
import { Check, ChevronDown, ChevronRight, X } from "lucide-svelte";
import { scale } from "svelte/transition";
import type { Annotation } from ".";
import { previewVersionText } from "./nestedEditor";

const {
    crumbs,
    crumbRevisions,
    selectedVersions,
    onselect,
    ondeleteversion,
    getlabel,
    oncommitlabel,
}: {
    crumbs: ModalEntry[];
    crumbRevisions: (Annotation<"revision"> | undefined)[];
    selectedVersions: number[];
    /** Switch to version `vi` at crumb level `ci`. */
    onselect: (ci: number, vi: number, crumb: ModalEntry, isCurrent: boolean) => void;
    /** Delete version `vi` of the current (deepest) revision. */
    ondeleteversion: (vi: number) => void;
    /** Initial value for label editing (the active version's current label). */
    getlabel: () => string;
    /** Commit a new label for the active version ("" clears it). */
    oncommitlabel: (label: string) => void;
} = $props();

// Which crumb dropdown is open (-1 = none)
let openDropdown = $state(-1);

// Label editing state for the current crumb's version dropdown
let editingVersionLabel = $state(false);
let labelInputValue = $state("");
let labelInputEl = $state<HTMLInputElement | undefined>(undefined);

function startLabelEdit() {
    labelInputValue = getlabel();
    editingVersionLabel = true;
}

// Focus the label input once it appears in the DOM after editingVersionLabel becomes true.
$effect(() => {
    if (editingVersionLabel && labelInputEl) {
        labelInputEl.focus();
    }
});

function commitLabelEdit() {
    oncommitlabel(labelInputValue.trim());
    editingVersionLabel = false;
}

function cancelLabelEdit() {
    editingVersionLabel = false;
}

function selectVersion(ci: number, vi: number, crumb: ModalEntry, isCurrent: boolean) {
    openDropdown = -1;
    onselect(ci, vi, crumb, isCurrent);
}

function deleteVersion(vi: number) {
    openDropdown = -1;
    ondeleteversion(vi);
}

// Close the version dropdown when clicking outside of it.
$effect(() => {
    if (openDropdown === -1) return;
    const handler = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest(".version-trigger, .version-popover")) {
            openDropdown = -1;
        }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
});
</script>

<nav class="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
    {#each crumbs as crumb, ci}
        {@const isCurrent = ci === crumbs.length - 1}
        {@const crumbRevision = crumbRevisions[ci]}
        {@const selectedVi = selectedVersions[ci] ?? 0}

        {#if ci > 0}
            <ChevronRight size={10} class="text-purple-300/60 shrink-0" />
        {/if}

        <div class="flex items-center gap-1.5">
            <!-- "Revision" label — clickable back if not current -->
            {#if isCurrent}
                <span
                    class="text-[10px] font-semibold text-purple-700/70 uppercase tracking-wider shrink-0"
                    >Revision</span
                >
            {:else}
                <button
                    class="text-[10px] text-purple-400/60 hover:text-purple-600/80 transition-colors uppercase tracking-wider shrink-0"
                    onclick={() => modalStack.popTo(ci)}>Revision</button
                >
            {/if}

            <!-- Version dropdown -->
            {#if crumbRevision && crumbRevision.versions.length > 0}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    class="relative"
                    onkeydown={(e) => {
                        if (e.key === "Escape") openDropdown = -1;
                    }}
                >
                    <!-- Trigger -->
                    {#if isCurrent && editingVersionLabel}
                        <input
                            bind:this={labelInputEl}
                            bind:value={labelInputValue}
                            class="pl-2 pr-1.5 py-0.5 rounded-md text-[10px] font-medium w-[120px]
                                bg-purple-100/70 text-purple-700/80 ring-1 ring-purple-300/60 outline-none
                                placeholder-purple-400/50"
                            placeholder="Version name…"
                            onblur={commitLabelEdit}
                            onkeydown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); commitLabelEdit(); }
                                else if (e.key === "Escape") { e.preventDefault(); cancelLabelEdit(); }
                            }}
                        />
                    {:else}
                        <button
                            class="version-trigger flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-md text-[10px] font-medium
                                transition-all duration-150
                                {isCurrent
                                ? 'bg-purple-100/70 text-purple-700/80 hover:bg-purple-100 ring-1 ring-purple-200/60'
                                : 'bg-black/5 text-black/45 hover:bg-black/8 ring-1 ring-black/10'}
                                {openDropdown === ci
                                ? 'ring-2 ' + (isCurrent ? 'ring-purple-300/60' : 'ring-black/20')
                                : ''}"
                            onclick={(e) => {
                                e.stopPropagation();
                                openDropdown = openDropdown === ci ? -1 : ci;
                            }}
                            ondblclick={(e) => {
                                if (isCurrent) { e.stopPropagation(); startLabelEdit(); }
                            }}
                            title={isCurrent ? "Double-click to rename" : undefined}
                        >
                            <span
                                >{crumbRevision.versions[selectedVi]?.label ??
                                    previewVersionText(crumbRevision.versions[selectedVi])}</span
                            >
                            <ChevronDown
                                size={9}
                                class="transition-transform duration-200 {openDropdown === ci
                                    ? 'rotate-180'
                                    : ''}
                                    {isCurrent ? 'text-purple-400/70' : 'text-black/30'}"
                            />
                        </button>
                    {/if}

                    <!-- Popover -->
                    {#if openDropdown === ci}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <div
                            class="version-popover"
                            transition:scale={{
                                start: 0.92,
                                duration: 150,
                                opacity: 0,
                            }}
                            style="transform-origin: top left;"
                        >
                            {#each crumbRevision.versions as version, vi}
                                {@const isSelected = vi === selectedVi}
                                <div
                                    class="version-option {isSelected
                                        ? 'version-option-active'
                                        : ''}"
                                >
                                    <button
                                        class="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                                        onclick={() => selectVersion(ci, vi, crumb, isCurrent)}
                                    >
                                        <span class="flex-1 truncate"
                                            >{version.label ?? previewVersionText(version)}</span
                                        >
                                        {#if isSelected}
                                            <Check size={10} class="text-purple-500/70 shrink-0" />
                                        {/if}
                                    </button>
                                    {#if isCurrent}
                                        <button
                                            class="shrink-0 p-0.5 rounded text-black/25 hover:text-red-500/70 transition-colors"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                deleteVersion(vi);
                                            }}
                                            title={`Delete version ${vi + 1}`}
                                            aria-label={`Delete version ${vi + 1}`}
                                        >
                                            <X size={9} />
                                        </button>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/each}
</nav>

<style>
    .version-popover {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 160px;
        max-width: 240px;
        background: white;
        border: 1px solid rgba(147, 112, 219, 0.15);
        border-radius: 10px;
        box-shadow:
            0 8px 24px -4px rgba(0, 0, 0, 0.12),
            0 2px 8px -2px rgba(0, 0, 0, 0.08);
        padding: 4px;
        z-index: 10;
        overflow: hidden;
    }

    .version-option {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 5px 8px;
        border-radius: 6px;
        font-size: 11px;
        color: rgba(0, 0, 0, 0.6);
        transition:
            background 0.1s,
            color 0.1s;
        cursor: pointer;
    }

    .version-option:hover {
        background: rgba(147, 112, 219, 0.08);
        color: rgba(109, 40, 217, 0.85);
    }

    .version-option-active {
        background: rgba(147, 112, 219, 0.1);
        color: rgba(109, 40, 217, 0.9);
        font-weight: 500;
    }
</style>
