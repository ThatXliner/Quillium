<!--
    DocumentCard.svelte — A single document card in grid or list view.
-->
<script lang="ts">
import type { DocumentMeta } from "$lib/db/types";

interface Props {
    doc: DocumentMeta;
    selected: boolean;
    viewMode: "grid" | "list";
    onSelect: () => void;
    onOpen: () => void;
}

const { doc, selected, viewMode, onSelect, onOpen }: Props = $props();

function formatDate(ms: number): string {
    const d = new Date(ms);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: diffDays > 365 ? "numeric" : undefined });
}
</script>

{#if viewMode === "grid"}
    <button
        onclick={onSelect}
        ondblclick={onOpen}
        class="group text-left rounded-xl p-4 flex flex-col gap-2 border transition-all duration-200 cursor-pointer
            {selected
                ? 'bg-blue-50 border-blue-300 shadow-md ring-2 ring-blue-400/30'
                : 'bg-white/80 border-white/60 shadow-sm hover:shadow-md hover:border-blue-200/60'}"
    >
        <!-- Document preview area -->
        <div class="w-full h-28 rounded-lg bg-gray-50/80 border border-gray-100 overflow-hidden p-3 flex-shrink-0">
            <p class="text-xs text-black/50 leading-relaxed line-clamp-5">
                {doc.previewText || "Empty document"}
            </p>
        </div>

        <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-sm font-medium text-black/80 truncate">{doc.title}</span>
            <div class="flex items-center gap-2 text-[11px] text-black/40">
                <span>{doc.wordCount.toLocaleString()} words</span>
                <span>·</span>
                <span>{formatDate(doc.updatedAt)}</span>
            </div>
        </div>
    </button>
{:else}
    <button
        onclick={onSelect}
        ondblclick={onOpen}
        class="group text-left w-full rounded-xl px-4 py-3 flex items-center gap-4 border transition-all duration-200 cursor-pointer
            {selected
                ? 'bg-blue-50 border-blue-300 shadow-sm ring-2 ring-blue-400/30'
                : 'bg-white/80 border-white/60 shadow-sm hover:shadow-md hover:border-blue-200/60'}"
    >
        <!-- Mini preview -->
        <div class="w-10 h-12 rounded bg-gray-50 border border-gray-100 flex-shrink-0 flex items-start justify-start p-1.5 overflow-hidden">
            <div class="w-full space-y-0.5">
                <div class="h-0.5 bg-gray-300 rounded w-full"></div>
                <div class="h-0.5 bg-gray-200 rounded w-4/5"></div>
                <div class="h-0.5 bg-gray-200 rounded w-3/5"></div>
            </div>
        </div>
        <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-black/80 truncate">{doc.title}</p>
            <p class="text-xs text-black/40 mt-0.5 truncate">{doc.previewText || "Empty document"}</p>
        </div>
        <div class="flex-shrink-0 text-right">
            <p class="text-xs text-black/40">{formatDate(doc.updatedAt)}</p>
            <p class="text-xs text-black/30">{doc.wordCount.toLocaleString()} words</p>
        </div>
    </button>
{/if}
