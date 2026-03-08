<!--
    LibraryTopBar.svelte — Search bar, view toggle, and "+ New" button
    for the document library.
-->
<script lang="ts">
import { LayoutGrid, List, Plus, Search } from "lucide-svelte";

interface Props {
    viewMode: "grid" | "list";
    onViewModeChange: (mode: "grid" | "list") => void;
    query: string;
    onQueryChange: (q: string) => void;
    onNew: () => void;
}

const { viewMode, onViewModeChange, query, onQueryChange, onNew }: Props = $props();
</script>

<div class="flex items-center gap-3">
    <!-- Search -->
    <div class="relative flex-1 max-w-sm">
        <Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-black/40 pointer-events-none" />
        <input
            type="search"
            placeholder="Search documents…"
            value={query}
            oninput={(e) => onQueryChange((e.target as HTMLInputElement).value)}
            class="w-full pl-9 pr-4 py-2 rounded-full bg-white/70 border border-white/50 shadow-sm text-sm text-black/80 placeholder:text-black/40 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:bg-white transition-colors"
        />
    </div>

    <!-- View toggle -->
    <div class="flex items-center rounded-full bg-white/70 border border-white/50 shadow-sm p-1 gap-1">
        <button
            onclick={() => onViewModeChange("grid")}
            title="Grid view"
            class="w-8 h-8 rounded-full flex items-center justify-center transition-colors
                {viewMode === 'grid' ? 'bg-blue-500 text-white shadow-sm' : 'text-black/50 hover:text-black/70 hover:bg-white/50'}"
        >
            <LayoutGrid size={16} />
        </button>
        <button
            onclick={() => onViewModeChange("list")}
            title="List view"
            class="w-8 h-8 rounded-full flex items-center justify-center transition-colors
                {viewMode === 'list' ? 'bg-blue-500 text-white shadow-sm' : 'text-black/50 hover:text-black/70 hover:bg-white/50'}"
        >
            <List size={16} />
        </button>
    </div>

    <!-- New document -->
    <button
        onclick={onNew}
        class="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors"
    >
        <Plus size={16} />
        New
    </button>
</div>
