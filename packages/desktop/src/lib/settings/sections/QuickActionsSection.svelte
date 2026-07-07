<!--
    QuickActionsSection.svelte — Settings (advanced, AI-dependent): custom
    quick-action chips per AI panel.

    `selectedPanel` is bindable because the modal's scroll-to-setting deep link
    ("quick-actions:feedback") selects a panel from outside.
-->
<script lang="ts">
import type { AppSettings } from "$lib/settings.svelte";
import { Plus, Trash2 } from "lucide-svelte";

let {
    draft,
    selectedPanel = $bindable(),
}: {
    draft: AppSettings;
    selectedPanel: "revise" | "feedback" | "chat";
} = $props();

let newActionLabel = $state("");
let newActionPrompt = $state("");
let panelActions = $derived(
    (draft.customQuickActions ?? []).filter((a) => a.panel === selectedPanel),
);

function addQuickAction() {
    if (!newActionLabel.trim() || !newActionPrompt.trim()) return;
    draft.customQuickActions = [
        ...(draft.customQuickActions ?? []),
        { label: newActionLabel.trim(), prompt: newActionPrompt.trim(), panel: selectedPanel },
    ];
    newActionLabel = "";
    newActionPrompt = "";
}

function removeQuickAction(index: number) {
    const allActions = draft.customQuickActions ?? [];
    // index is relative to panelActions; find absolute index
    const panelItems = allActions
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a.panel === selectedPanel);
    const absIndex = panelItems[index]?.i;
    if (absIndex === undefined) return;
    draft.customQuickActions = allActions.filter((_, i) => i !== absIndex);
}
</script>

<div class="section-divider"></div>
<div class="section-label" data-setting-id="quick-actions">Quick Actions</div>

<!-- Panel selector -->
<div class="setting-row">
    <div class="setting-meta">
        <div class="setting-title">Panel</div>
        <div class="setting-desc">Add chips to a specific AI panel</div>
    </div>
    <div class="flex rounded-lg overflow-hidden border border-black/[0.09] shrink-0">
        {#each (["revise", "feedback", "chat"] as const) as panel}
            <button
                onclick={() => {
                    selectedPanel = panel;
                }}
                class="px-3 py-1.5 text-[11px] font-medium capitalize transition-colors
                    {selectedPanel === panel
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-black/50 hover:bg-black/[0.04]'}"
            >{panel}</button>
        {/each}
    </div>
</div>

<!-- Existing chips for selected panel -->
{#if panelActions.length > 0}
    <div class="flex flex-col gap-1 mb-2">
        {#each panelActions as action, i}
            <div class="flex items-start gap-2 px-2 py-2 rounded-lg bg-black/[0.02] border border-black/[0.05]">
                <div class="flex-1 min-w-0">
                    <div class="text-[12px] font-medium text-black/70 truncate">{action.label}</div>
                    <div class="text-[11px] text-black/38 mt-0.5 line-clamp-2 leading-snug">{action.prompt}</div>
                </div>
                <button
                    onclick={() => removeQuickAction(i)}
                    aria-label="Remove quick action"
                    class="shrink-0 mt-0.5 p-1 rounded text-black/25 hover:text-red-400 hover:bg-red-50 transition-colors"
                >
                    <Trash2 size={12} />
                </button>
            </div>
        {/each}
    </div>
{:else}
    <div class="text-[11px] text-black/30 px-0.5 mb-2">No custom chips for this panel yet.</div>
{/if}

<!-- Add new chip form -->
<div class="flex flex-col gap-1.5 px-0.5">
    <input
        bind:value={newActionLabel}
        placeholder="Label (shown on chip)"
        class="w-full px-2.5 py-1.5 text-[12px] border border-black/[0.1] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-black/25"
    />
    <textarea
        bind:value={newActionPrompt}
        placeholder="Full prompt sent to AI…"
        rows="2"
        class="w-full px-2.5 py-1.5 text-[12px] border border-black/[0.1] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 resize-none placeholder:text-black/25"
    ></textarea>
    <button
        onclick={addQuickAction}
        disabled={!newActionLabel.trim() || !newActionPrompt.trim()}
        class="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[12px] font-medium
            bg-blue-500/80 text-white rounded-lg hover:bg-blue-600/80 transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed"
    >
        <Plus size={12} />
        Add chip
    </button>
</div>
