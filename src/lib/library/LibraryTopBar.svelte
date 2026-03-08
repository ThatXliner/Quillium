<!--
    LibraryTopBar.svelte — Single unified control strip: search,
    view toggle, and "+ New" merged into one pill.
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

<div class="flex items-center rounded-full bg-white/80 border border-white/60 shadow-sm overflow-hidden h-11">
    <!-- Search -->
    <div class="relative flex-1 flex items-center">
        <Search size={15} class="absolute left-4 text-black/35 pointer-events-none flex-shrink-0" />
        <input
            type="search"
            placeholder="Search documents…"
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
</div>
