<!--
    RevisionBreadcrumbs.svelte — Shared revision breadcrumb presentation.

    Hosts provide neutral crumb/version view models and capability callbacks.
    This component owns dropdown, outside-click, Escape, rename-input, selected
    marker, and transition behavior without depending on desktop modal state.
-->
<script lang="ts">
import { Check, ChevronDown, ChevronRight, X } from "lucide-svelte";
import { scale } from "svelte/transition";
import type { RevisionBreadcrumbCrumbView, RevisionBreadcrumbVersionView } from "./types";

let {
    crumbs,
    onNavigate,
    onSelectVersion,
    onRenameCurrent = undefined,
    onDeleteCurrentVersion = undefined,
}: {
    crumbs: readonly RevisionBreadcrumbCrumbView[];
    onNavigate: (crumbId: string) => void;
    onSelectVersion: (crumbId: string, versionId: string) => void;
    onRenameCurrent?: (crumbId: string, versionId: string, label: string) => void;
    onDeleteCurrentVersion?: (crumbId: string, versionId: string) => void;
} = $props();

let rootElement = $state<HTMLElement>();
let openDropdownId = $state<string | null>(null);
let editingCrumbId = $state<string | null>(null);
let editingVersionId = $state<string | null>(null);
let labelInputValue = $state("");
let labelInputElement = $state<HTMLInputElement>();

function toggleDropdown(crumbId: string): void {
    openDropdownId = openDropdownId === crumbId ? null : crumbId;
}

function startLabelEdit(
    crumb: RevisionBreadcrumbCrumbView,
    version: RevisionBreadcrumbVersionView,
): void {
    if (!crumb.current || !onRenameCurrent) return;
    openDropdownId = null;
    editingCrumbId = crumb.id;
    editingVersionId = version.id;
    labelInputValue = version.editableLabel ?? "";
}

$effect(() => {
    if (editingCrumbId && labelInputElement) labelInputElement.focus();
});

function finishLabelEdit(commit: boolean): void {
    if (commit && editingCrumbId && editingVersionId) {
        onRenameCurrent?.(editingCrumbId, editingVersionId, labelInputValue.trim());
    }
    editingCrumbId = null;
    editingVersionId = null;
}

function selectVersion(crumbId: string, versionId: string): void {
    openDropdownId = null;
    onSelectVersion(crumbId, versionId);
}

function deleteVersion(crumbId: string, versionId: string): void {
    openDropdownId = null;
    onDeleteCurrentVersion?.(crumbId, versionId);
}

function handleBreadcrumbKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || openDropdownId === null) return;
    event.preventDefault();
    event.stopPropagation();
    openDropdownId = null;
}

$effect(() => {
    if (openDropdownId === null) return;
    const handleDocumentClick = (event: MouseEvent): void => {
        const target = event.target;
        const interactiveAncestor =
            target instanceof Element ? target.closest(".version-trigger, .version-popover") : null;
        if (!interactiveAncestor || !rootElement?.contains(interactiveAncestor)) {
            openDropdownId = null;
        }
    };
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
    bind:this={rootElement}
    class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
    aria-label="Revision path"
    data-revision-breadcrumbs
    onkeydown={handleBreadcrumbKeydown}
>
    {#each crumbs as crumb, crumbIndex (crumb.id)}
        {@const selectedVersion =
            crumb.versions.find((version) => version.id === crumb.selectedVersionId) ??
            crumb.versions[0]}

        {#if crumbIndex > 0}
            <ChevronRight size={10} class="shrink-0 text-purple-300/60" />
        {/if}

        <div class="flex items-center gap-1.5" data-breadcrumb-id={crumb.id}>
            {#if crumb.current}
                <span
                    class="shrink-0 text-[10px] font-semibold tracking-wider text-purple-700/70 uppercase"
                    aria-current="page"
                >
                    {crumb.label}
                </span>
            {:else}
                <button
                    class="shrink-0 text-[10px] tracking-wider text-purple-400/60 uppercase transition-colors hover:text-purple-600/80"
                    type="button"
                    onclick={() => onNavigate(crumb.id)}
                >
                    {crumb.label}
                </button>
            {/if}

            {#if selectedVersion}
                <div class="relative">
                    {#if crumb.current && editingCrumbId === crumb.id}
                        <input
                            bind:this={labelInputElement}
                            bind:value={labelInputValue}
                            class="w-[120px] rounded-md bg-purple-100/70 py-0.5 pr-1.5 pl-2 text-[10px] font-medium text-purple-700/80 ring-1 ring-purple-300/60 outline-none placeholder-purple-400/50"
                            aria-label="Rename current version"
                            placeholder="Version name…"
                            onblur={() => finishLabelEdit(true)}
                            onkeydown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    finishLabelEdit(true);
                                } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    finishLabelEdit(false);
                                }
                            }}
                        />
                    {:else}
                        <button
                            class="version-trigger flex items-center gap-1 rounded-md py-0.5 pr-1.5 pl-2 text-[10px] font-medium transition-all duration-150"
                            class:version-trigger-current={crumb.current}
                            class:version-trigger-ancestor={!crumb.current}
                            class:version-trigger-open={openDropdownId === crumb.id}
                            type="button"
                            aria-label={`${crumb.label} version: ${selectedVersion.label}`}
                            aria-expanded={openDropdownId === crumb.id}
                            onclick={(event) => {
                                event.stopPropagation();
                                toggleDropdown(crumb.id);
                            }}
                            ondblclick={(event) => {
                                if (!crumb.current || !onRenameCurrent) return;
                                event.stopPropagation();
                                startLabelEdit(crumb, selectedVersion);
                            }}
                            title={crumb.current && onRenameCurrent
                                ? "Double-click to rename"
                                : undefined}
                        >
                            <span>{selectedVersion.label}</span>
                            <ChevronDown
                                size={9}
                                color={crumb.current
                                    ? "rgba(192, 132, 252, 0.7)"
                                    : "var(--text-faint, rgba(0, 0, 0, 0.3))"}
                                class="transition-transform duration-200 {openDropdownId === crumb.id
                                    ? 'rotate-180'
                                    : ''}"
                            />
                        </button>
                    {/if}

                    {#if openDropdownId === crumb.id}
                        <div
                            class="version-popover"
                            transition:scale={{ start: 0.92, duration: 150, opacity: 0 }}
                            style="transform-origin: top left;"
                        >
                            {#each crumb.versions as version, versionIndex (version.id)}
                                {@const isSelected = version.id === selectedVersion.id}
                                <div
                                    class="version-option"
                                    class:version-option-active={isSelected}
                                    data-version-id={version.id}
                                    data-selected={isSelected}
                                >
                                    <button
                                        class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                        type="button"
                                        onclick={() => selectVersion(crumb.id, version.id)}
                                    >
                                        <span class="flex-1 truncate">{version.label}</span>
                                        {#if isSelected}
                                            <Check size={10} class="shrink-0 text-purple-500/70" />
                                        {/if}
                                    </button>
                                    {#if crumb.current && onDeleteCurrentVersion}
                                        <button
                                            class="shrink-0 rounded p-0.5 text-black/25 transition-colors hover:text-red-500/70"
                                            type="button"
                                            onclick={(event) => {
                                                event.stopPropagation();
                                                deleteVersion(crumb.id, version.id);
                                            }}
                                            title={`Delete version ${versionIndex + 1}`}
                                            aria-label={`Delete version ${versionIndex + 1}`}
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
    .version-trigger {
        border: 0;
        box-shadow: 0 0 0 1px transparent;
    }

    .version-trigger-current {
        background: rgba(243, 232, 255, 0.7);
        color: rgba(109, 40, 217, 0.8);
        box-shadow: 0 0 0 1px rgba(233, 213, 255, 0.6);
    }

    .version-trigger-current:hover {
        background: rgba(243, 232, 255, 1);
    }

    .version-trigger-ancestor {
        background: var(--surface-2, rgba(0, 0, 0, 0.05));
        color: var(--text-faint, rgba(0, 0, 0, 0.45));
        box-shadow: 0 0 0 1px var(--border, rgba(0, 0, 0, 0.1));
    }

    .version-trigger-ancestor:hover {
        background: var(--surface, rgba(0, 0, 0, 0.08));
        color: var(--text-soft, rgba(0, 0, 0, 0.65));
    }

    .version-trigger-open {
        box-shadow: 0 0 0 2px rgba(192, 132, 252, 0.45);
    }

    .version-trigger-open.version-trigger-ancestor {
        box-shadow: 0 0 0 2px var(--border-strong, rgba(0, 0, 0, 0.2));
    }

    .version-popover {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        z-index: 10;
        min-width: 160px;
        max-width: 240px;
        overflow: hidden;
        border: 1px solid rgba(147, 112, 219, 0.15);
        border-radius: 10px;
        background: var(--surface, white);
        padding: 4px;
        box-shadow:
            0 8px 24px -4px rgba(0, 0, 0, 0.12),
            0 2px 8px -2px rgba(0, 0, 0, 0.08);
    }

    .version-option {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 6px;
        border-radius: 6px;
        padding: 5px 8px;
        color: var(--text-soft, rgba(0, 0, 0, 0.6));
        font-size: 11px;
        cursor: pointer;
        transition:
            background 0.1s,
            color 0.1s;
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
