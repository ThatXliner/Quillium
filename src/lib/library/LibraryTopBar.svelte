<!--
    LibraryTopBar.svelte — Single unified control strip: search,
    view toggle, and "+ New" merged into one pill.
-->
<script lang="ts">
import { LayoutGrid, List, Plus, Search, Trash2, Timer } from "lucide-svelte";
import Kbd from "$lib/ui/Kbd.svelte";

interface Props {
    viewMode: "grid" | "list";
    onViewModeChange: (mode: "grid" | "list") => void;
    query: string;
    onQueryChange: (q: string) => void;
    onNew: () => void;
    tab: "library" | "trash";
    onTabChange: (tab: "library" | "trash") => void;
    trashRetention: number | null;
    onTrashRetentionChange: (days: number | null) => void;
    searchInputEl?: HTMLInputElement | null;
}

let {
    viewMode,
    onViewModeChange,
    query,
    onQueryChange,
    onNew,
    tab,
    onTabChange,
    trashRetention,
    onTrashRetentionChange,
    searchInputEl = $bindable(),
}: Props = $props();

const retentionOptions: { label: string; value: number | null }[] = [
    { label: "Never", value: null },
    { label: "7 days", value: 7 },
    { label: "30 days", value: 30 },
    { label: "60 days", value: 60 },
    { label: "90 days", value: 90 },
];

const retentionLabel = $derived(
    retentionOptions.find((o) => o.value === trashRetention)?.label ?? "Never",
);
</script>

<!-- Tab row -->
<div class="flex items-center gap-1 mb-3">
    <button
        onclick={() => onTabChange("library")}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
            {tab === 'library'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'text-black/50 hover:text-black/70 hover:bg-black/5'}"
    >
        Library
    </button>
    <button
        onclick={() => onTabChange("trash")}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
            {tab === 'trash'
                ? 'bg-black/15 text-black/70 shadow-sm'
                : 'text-black/50 hover:text-black/70 hover:bg-black/5'}"
    >
        <Trash2 size={12} />
        Trash
    </button>

    {#if tab === "trash"}
        <div class="ml-auto flex items-center gap-1.5">
            <Timer size={12} class="text-black/35" />
            <span class="text-xs text-black/40">Auto-empty:</span>
            <div class="relative">
                <select
                    value={trashRetention ?? "never"}
                    onchange={(e) => {
                        const raw = (e.target as HTMLSelectElement).value;
                        onTrashRetentionChange(raw === "never" ? null : Number(raw));
                    }}
                    class="appearance-none text-xs font-medium text-black/60 bg-black/5
                           hover:bg-black/10 rounded-full px-2.5 py-1 pr-5 cursor-pointer
                           border-0 focus:outline-none focus:ring-1 focus:ring-blue-400
                           transition-colors"
                >
                    {#each retentionOptions as opt}
                        <option value={opt.value ?? "never"}>{opt.label}</option>
                    {/each}
                </select>
                <!-- chevron -->
                <svg
                    class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-black/35"
                    width="10" height="10" viewBox="0 0 10 10" fill="none"
                >
                    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="round" stroke-linejoin="round" />
                </svg>
            </div>
        </div>
    {/if}
</div>

<div class="flex items-center rounded-full bg-white/80 border border-white/60 shadow-sm overflow-hidden h-11">
    <!-- Search -->
    <div class="relative flex-1 flex items-center">
        <Search size={15} class="absolute left-4 text-black/35 pointer-events-none flex-shrink-0" />
        <input
            bind:this={searchInputEl}
            type="search"
            placeholder={tab === "trash" ? "Search trash…" : "Search documents…"}
            value={query}
            oninput={(e) => onQueryChange((e.target as HTMLInputElement).value)}
            class="w-full h-full pl-10 pr-10 bg-transparent text-sm text-black/80 placeholder:text-black/35 focus:outline-none"
        />
        <span class="absolute right-3 pointer-events-none"><Kbd keys="/" /></span>
    </div>

    <!-- Divider -->
    <div class="w-px h-5 bg-black/10 flex-shrink-0"></div>

    <!-- View toggle -->
    <div class="flex items-center px-1.5 gap-0.5">
        <button
            onclick={() => onViewModeChange("grid")}
            title="Grid view (G)"
            class="group w-8 h-8 rounded-full flex items-center justify-center transition-colors
                {viewMode === 'grid' ? 'bg-blue-500 text-white' : 'text-black/40 hover:text-black/70 hover:bg-black/5'}"
        >
            <LayoutGrid size={15} />
        </button>
        <button
            onclick={() => onViewModeChange("list")}
            title="List view (L)"
            class="group w-8 h-8 rounded-full flex items-center justify-center transition-colors
                {viewMode === 'list' ? 'bg-blue-500 text-white' : 'text-black/40 hover:text-black/70 hover:bg-black/5'}"
        >
            <List size={15} />
        </button>
    </div>

    {#if tab === "library"}
        <!-- Divider -->
        <div class="w-px h-5 bg-black/10 flex-shrink-0"></div>

        <!-- New document -->
        <button
            onclick={onNew}
            class="group flex items-center gap-2 px-4 h-full text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
        >
            <Plus size={15} />
            New
            <Kbd keys="N" />
        </button>
    {/if}
</div>
