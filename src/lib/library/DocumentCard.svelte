<!--
    DocumentCard.svelte — A single document card in grid or list view.
-->
<script lang="ts">
import type { DocumentMeta } from "$lib/db/types";
import { Trash2, RotateCcw, X } from "lucide-svelte";

interface Props {
    doc: DocumentMeta;
    selected: boolean;
    viewMode: "grid" | "list";
    trashMode: boolean;
    onSelect: () => void;
    onOpen: () => void;
    onTrash: () => void;
    onRestore: () => void;
    onDeletePermanent: () => void;
}

const { doc, selected, viewMode, trashMode, onSelect, onOpen, onTrash, onRestore, onDeletePermanent }: Props =
    $props();

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
    <div
        class="group relative text-left rounded-xl p-4 flex flex-col gap-2 border transition-all duration-200 w-full min-w-0 overflow-hidden cursor-pointer
            {selected
                ? 'bg-blue-50 border-blue-300 shadow-md ring-2 ring-blue-400/30'
                : trashMode
                  ? 'bg-white/60 border-white/60 shadow-sm hover:shadow-md hover:border-red-200/60'
                  : 'bg-white/80 border-white/60 shadow-sm hover:shadow-md hover:border-blue-200/60'}"
        onclick={onSelect}
        ondblclick={trashMode ? undefined : onOpen}
        onkeydown={(e) => {
            if (e.key === "Enter") {
                trashMode ? onSelect() : onOpen();
            } else if (e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                trashMode ? onSelect() : onOpen();
            }
        }}
        role="button"
        tabindex="0"
    >
        <!-- Document preview area -->
        <div class="w-full h-28 rounded-lg bg-gray-50/80 border border-gray-100 overflow-hidden p-3 flex-shrink-0">
            <p class="text-xs text-black/50 leading-relaxed line-clamp-5">
                {doc.previewText || "Empty document"}
            </p>
        </div>

        <div class="flex flex-col gap-0.5 w-full overflow-hidden">
            <p class="text-sm font-medium text-black/80 truncate w-full">{doc.title}</p>
            <div class="flex items-center gap-2 text-[11px] text-black/40">
                <span>{doc.wordCount.toLocaleString()} words</span>
                <span>·</span>
                <span>{formatDate(doc.updatedAt)}</span>
            </div>
        </div>

        <!-- Action buttons overlay -->
        {#if trashMode}
            <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onclick={(e) => { e.stopPropagation(); onRestore(); }}
                    title="Restore"
                    class="w-7 h-7 rounded-full bg-white/90 border border-blue-200 text-blue-500 hover:bg-blue-50 flex items-center justify-center shadow-sm"
                >
                    <RotateCcw size={12} />
                </button>
                <button
                    onclick={(e) => { e.stopPropagation(); onDeletePermanent(); }}
                    title="Delete permanently"
                    class="w-7 h-7 rounded-full bg-white/90 border border-red-200 text-red-400 hover:bg-red-50 flex items-center justify-center shadow-sm"
                >
                    <X size={12} />
                </button>
            </div>
        {:else}
            <button
                onclick={(e) => { e.stopPropagation(); onTrash(); }}
                title="Move to trash"
                class="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 border border-gray-200 text-black/40 hover:text-red-400 hover:border-red-200 flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
            >
                <Trash2 size={12} />
            </button>
        {/if}
    </div>
{:else}
    <div
        class="group relative text-left w-full rounded-xl px-4 py-3 flex items-center gap-4 border transition-all duration-200 cursor-pointer
            {selected
                ? 'bg-blue-50 border-blue-300 shadow-sm ring-2 ring-blue-400/30'
                : trashMode
                  ? 'bg-white/60 border-white/60 shadow-sm hover:shadow-md hover:border-red-200/60'
                  : 'bg-white/80 border-white/60 shadow-sm hover:shadow-md hover:border-blue-200/60'}"
        onclick={trashMode ? onSelect : onSelect}
        ondblclick={trashMode ? undefined : onOpen}
        onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                trashMode ? onSelect() : onOpen();
            }
        }}
        role="button"
        tabindex="0"
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
        <div class="flex-shrink-0 flex items-center gap-2">
            <div class="text-right">
                <p class="text-xs text-black/40">{formatDate(doc.updatedAt)}</p>
                <p class="text-xs text-black/30">{doc.wordCount.toLocaleString()} words</p>
            </div>

            <!-- List-mode action buttons -->
            {#if trashMode}
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onclick={(e) => { e.stopPropagation(); onRestore(); }}
                        title="Restore"
                        class="w-7 h-7 rounded-full bg-white border border-blue-200 text-blue-500 hover:bg-blue-50 flex items-center justify-center shadow-sm"
                    >
                        <RotateCcw size={12} />
                    </button>
                    <button
                        onclick={(e) => { e.stopPropagation(); onDeletePermanent(); }}
                        title="Delete permanently"
                        class="w-7 h-7 rounded-full bg-white border border-red-200 text-red-400 hover:bg-red-50 flex items-center justify-center shadow-sm"
                    >
                        <X size={12} />
                    </button>
                </div>
            {:else}
                <button
                    onclick={(e) => { e.stopPropagation(); onTrash(); }}
                    title="Move to trash"
                    class="w-7 h-7 rounded-full bg-white border border-gray-200 text-black/30 hover:text-red-400 hover:border-red-200 flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <Trash2 size={12} />
                </button>
            {/if}
        </div>
    </div>
{/if}
