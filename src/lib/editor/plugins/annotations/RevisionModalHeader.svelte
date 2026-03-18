<script lang="ts">
import { ChevronRight, ChevronDown, Check, X, PlusIcon } from "lucide-svelte";
import { scale } from "svelte/transition";
import { annotationField, type Annotation } from ".";
import { modalStack, type ModalEntry } from "$lib/stores";
import { previewVersionText } from "./nestedEditor";
import Kbd from "$lib/ui/Kbd.svelte";

const {
    crumbs,
    revision,
    stackIndex,
    modKey,
    onSelectVersion,
    onAddVersion,
    onClose,
    onCommitLabel,
}: {
    crumbs: ModalEntry[];
    revision: Annotation<"revision"> | undefined;
    stackIndex: number;
    modKey: string;
    onSelectVersion: (ci: number, vi: number, crumb: ModalEntry, isCurrent: boolean) => void;
    onAddVersion: () => void;
    onClose: () => void;
    /** Called with the new label value (trimmed, undefined if empty) */
    onCommitLabel: (label: string | undefined) => void;
} = $props();

// All state is internal — no bindable props needed
let openDropdown = $state(-1);
let editingVersionLabel = $state(false);
let labelInputValue = $state("");
let labelInputEl = $state<HTMLInputElement | undefined>(undefined);

// Track selected version index per crumb level reactively
const selectedVersions = $derived(
    crumbs.map((crumb) => {
        if (crumb.type !== "revision") return 0;
        const rev = crumb.parentView.state.field(annotationField)[crumb.revisionId] as
            | Annotation<"revision">
            | undefined;
        return rev?.activeVersionIndex ?? 0;
    }),
);

// Focus the label input once it appears
$effect(() => {
    if (editingVersionLabel && labelInputEl) {
        labelInputEl.focus();
    }
});

// Close dropdown when clicking outside
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

function startLabelEdit() {
    if (!revision) return;
    labelInputValue = revision.versions[revision.activeVersionIndex]?.label ?? "";
    editingVersionLabel = true;
}

function commitLabelEdit() {
    const trimmed = labelInputValue.trim();
    onCommitLabel(trimmed || undefined);
    editingVersionLabel = false;
}

function cancelLabelEdit() {
    editingVersionLabel = false;
}
</script>

<div
  class="flex items-center justify-between px-5 py-3 border-b border-purple-100/80 shrink-0 gap-3 min-w-0"
>
  <!-- Breadcrumb trail -->
  <nav class="flex items-center gap-1.5 min-w-0 flex-1 flex-wrap">
    {#each crumbs as crumb, ci}
      {@const isCurrent = ci === crumbs.length - 1}
      {@const crumbRevision =
        crumb.type === "revision"
          ? (crumb.parentView.state.field(annotationField)[
              crumb.revisionId
            ] as Annotation<"revision"> | undefined)
          : undefined}
      {@const selectedVi = selectedVersions[ci] ?? 0}

      {#if ci > 0}
        <ChevronRight size={10} class="text-purple-300/60 shrink-0" />
      {/if}

      <div class="flex items-center gap-1.5">
        <!-- "Revision" label -->
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
                  ? 'ring-2 ' +
                    (isCurrent ? 'ring-purple-300/60' : 'ring-black/20')
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
                    previewVersionText(
                      crumbRevision.versions[selectedVi],
                    )}</span
                >
                <ChevronDown
                  size={9}
                  class="transition-transform duration-200 {openDropdown === ci
                    ? 'rotate-180'
                    : ''}
                                        {isCurrent
                    ? 'text-purple-400/70'
                    : 'text-black/30'}"
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
                  <button
                    class="version-option {isSelected
                      ? 'version-option-active'
                      : ''}"
                    onclick={() => onSelectVersion(ci, vi, crumb, isCurrent)}
                  >
                    <span class="flex-1 text-left truncate"
                      >{version.label ?? previewVersionText(version)}</span
                    >
                    {#if isSelected}
                      <Check size={10} class="text-purple-500/70 shrink-0" />
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </nav>

  {#if stackIndex > 0}
    <span class="text-[10px] text-purple-400/60 italic shrink-0">
      Click outside or press <Kbd keys={["Esc"]} /> to go back to parent
    </span>
  {/if}

  <!-- Right actions -->
  <div class="flex items-center gap-2 shrink-0">
    {#if revision && revision.versions.length > 1}
      <div class="flex items-center gap-0.5 opacity-40">
        <Kbd keys={["Ctrl", "["]} />
        <Kbd keys={["Ctrl", "]"]} />
      </div>
    {/if}
    <button
      class="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-purple-600/80
          bg-purple-50/80 hover:bg-purple-100/60 rounded-md ring-1 ring-purple-200/50 transition-colors"
      onclick={onAddVersion}
      title="New version ({modKey}↵)"
    >
      <PlusIcon size={10} />
      <span>New version</span>
      <Kbd keys={[modKey, "↵"]} />
    </button>
    <button
      class="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-md text-black/30 hover:text-black/60 hover:bg-black/5 transition-colors"
      onclick={onClose}
    >
      <span class="text-[9px] font-mono text-black/20 leading-none">esc</span>
      <X size={16} />
    </button>
  </div>
</div>

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
