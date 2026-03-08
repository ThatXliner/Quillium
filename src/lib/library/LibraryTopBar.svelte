<!--
    LibraryTopBar.svelte — Single unified control strip: search,
    view toggle, and "+ New" merged into one pill.
-->
<script lang="ts">
import { LayoutGrid, List, Plus, Search, Trash2 } from "lucide-svelte";

interface Props {
    viewMode: "grid" | "list";
    onViewModeChange: (mode: "grid" | "list") => void;
    query: string;
    onQueryChange: (q: string) => void;
    onNew: () => void;
    tab: "library" | "trash";
    onTabChange: (tab: "library" | "trash") => void;
}

const { viewMode, onViewModeChange, query, onQueryChange, onNew, tab, onTabChange }: Props =
    $props();
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
</div>

<div class="flex items-center rounded-full bg-white/80 border border-white/60 shadow-sm overflow-hidden h-11">
    <!-- Search -->
    <div class="relative flex-1 flex items-center">
        <Search size={15} class="absolute left-4 text-black/35 pointer-events-none flex-shrink-0" />
        <input
            type="search"
            placeholder={tab === "trash" ? "Search trash…" : "Search documents…"}
            value={query}
            oninput={(e) => onQueryChange((e.target as HTMLInputElement).value)}
            class="w-full h-full pl-10 pr-4 bg-transparent text-sm text-black/80 placeholder:text-black/35 focus:outline-none"
        />
    </div>

    <!-- Divider -->
    <div class="w-px h-5 bg-black/10 flex-shrink-0"></div>

    <!-- View toggle -->
    <div class="flex items-center px-1.5 gap-0.5">
        <button
            onclick={() => onViewModeChange("grid")}
            title="Grid view"
            class="w-8 h-8 rounded-full flex items-center justify-center transition-colors
                {viewMode === 'grid' ? 'bg-blue-500 text-white' : 'text-black/40 hover:text-black/70 hover:bg-black/5'}"
        >
            <LayoutGrid size={15} />
        </button>
        <button
            onclick={() => onViewModeChange("list")}
            title="List view"
            class="w-8 h-8 rounded-full flex items-center justify-center transition-colors
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
            class="flex items-center gap-1.5 px-4 h-full text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
        >
            <Plus size={15} />
            New
        </button>
    {/if}
</div>
