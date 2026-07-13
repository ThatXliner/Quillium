<!--
    DocumentCard.svelte — A single document card in grid or list view.
-->
<script lang="ts">
import type { DocumentMeta, SearchHit } from "$lib/db/types";
import { AppWindow, Copy, RotateCcw, Sparkles, Trash2, X } from "lucide-svelte";
import { onDestroy } from "svelte";
import { type SnippetSegment, snippetSegments } from "./snippet";
import { parseTags } from "./tags";

interface Props {
    doc: DocumentMeta;
    selected: boolean;
    viewMode: "grid" | "list";
    trashMode: boolean;
    /** Search hit for this doc (when a content search is active): shows the matched snippet. */
    hit?: SearchHit | null;
    onSelect: (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
    onOpen: () => void;
    onTrash: () => void;
    onRestore: () => void;
    onDeletePermanent: () => void;
    onOpenInNewWindow: () => void;
    onDuplicate: () => void;
    onTagClick?: (tag: string) => void;
}

const {
    doc,
    selected,
    viewMode,
    trashMode,
    hit = null,
    onSelect,
    onOpen,
    onTrash,
    onRestore,
    onDeletePermanent,
    onOpenInNewWindow,
    onDuplicate,
    onTagClick,
}: Props = $props();

let confirmingDelete = $state(false);
let confirmTimeout: ReturnType<typeof setTimeout> | undefined;
const tags = $derived(parseTags(doc.tags));
const snippetSegs = $derived(hit?.snippet ? snippetSegments(hit.snippet) : null);
const semanticMatch = $derived(hit?.matchType === "semantic");

onDestroy(() => clearTimeout(confirmTimeout));

function handleDeletePermanent(e: MouseEvent) {
    e.stopPropagation();
    if (confirmingDelete) {
        clearTimeout(confirmTimeout);
        confirmingDelete = false;
        onDeletePermanent();
    } else {
        confirmingDelete = true;
        confirmTimeout = setTimeout(() => {
            confirmingDelete = false;
        }, 3000);
    }
}

function formatDate(ms: number): string {
    const d = new Date(ms);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: diffDays > 365 ? "numeric" : undefined,
    });
}
</script>

<!-- Shared between grid and list views: matched-snippet text with
     highlights, and the "matched by meaning" badge (position varies). -->
{#snippet snippetText(segs: SnippetSegment[])}
    {#each segs as seg}
        {#if seg.highlighted}<mark class="rounded-[2px] bg-amber-200/80 px-px text-black/70">{seg.text}</mark>{:else}{seg.text}{/if}
    {/each}
{/snippet}

{#snippet similarBadge(positionClass: string)}
    <span
        title="Matched by meaning, not keywords"
        class="{positionClass} items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-700"
    >
        <Sparkles size={9} /> similar
    </span>
{/snippet}

{#if viewMode === "grid"}
    <!-- Having "on select" animations/transitions feel instant generally feels better -->
    <div
        class="ph-mask-text group relative text-left rounded-xl p-4 flex flex-col gap-2 border w-full min-w-0 overflow-hidden cursor-pointer
            {selected
                ? 'bg-blue-50 border-blue-300 shadow-md ring-2 ring-blue-400/30'
                : trashMode
                  ? 'bg-white/60 border-white/60 shadow-sm hover:shadow-md hover:border-red-200/60'
                  : 'bg-white/80 border-white/60 shadow-sm hover:shadow-md hover:border-blue-200/60'}"
        onclick={(e) => onSelect(e)}
        ondblclick={trashMode ? undefined : onOpen}
        onkeydown={(e) => {
            if (e.key === "Enter") {
                trashMode ? onSelect(e) : onOpen();
            } else if (e.key === " " || e.key === "Spacebar") {
                e.preventDefault();
                trashMode ? onSelect(e) : onOpen();
            }
        }}
        role="button"
        tabindex="0"
    >
        <!-- Document preview area (matched snippet when searching) -->
        <div class="relative w-full h-28 rounded-lg bg-gray-50/80 border border-gray-100 overflow-hidden p-3 flex-shrink-0">
            {#if snippetSegs}
                <p class="text-xs text-black/50 leading-relaxed line-clamp-5">
                    {@render snippetText(snippetSegs)}
                </p>
                {#if semanticMatch}
                    {@render similarBadge("absolute bottom-1.5 right-1.5 flex")}
                {/if}
            {:else}
                <p class="text-xs text-black/50 leading-relaxed line-clamp-5">
                    {doc.previewText || "Empty document"}
                </p>
            {/if}
        </div>

        <div class="flex flex-col gap-0.5 w-full overflow-hidden">
            <p class="text-sm font-medium text-black/80 truncate w-full">{doc.title}</p>
            <div class="flex items-center gap-2 text-[11px] text-black/40">
                <span>{doc.wordCount.toLocaleString()} words</span>
                <span>·</span>
                <span>{formatDate(doc.updatedAt)}</span>
            </div>
            {#if tags.length > 0}
                <div class="mt-1 flex flex-wrap gap-1">
                    {#each tags.slice(0, 3) as tag}
                        <button
                            type="button"
                            onclick={(e) => {
                                e.stopPropagation();
                                onTagClick?.(tag);
                            }}
                            class="max-w-full truncate rounded-full bg-black/[0.045] px-2 py-0.5 text-[10px] text-black/45 transition-colors hover:bg-blue-500/10 hover:text-blue-700"
                        >
                            {tag}
                        </button>
                    {/each}
                </div>
            {/if}
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
                    onclick={handleDeletePermanent}
                    title={confirmingDelete ? "Click again to confirm" : "Delete permanently"}
                    class="rounded-full bg-white/90 border flex items-center justify-center shadow-sm transition-all
                        {confirmingDelete
                            ? 'px-2 h-7 border-red-400 bg-red-50 text-red-600 text-[10px] font-medium'
                            : 'w-7 h-7 border-red-200 text-red-400 hover:bg-red-50'}"
                >
                    {#if confirmingDelete}
                        Delete?
                    {:else}
                        <X size={12} />
                    {/if}
                </button>
            </div>
        {:else}
            <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onclick={(e) => { e.stopPropagation(); onDuplicate(); }}
                    title="Duplicate"
                    class="w-7 h-7 rounded-full bg-white/90 border border-gray-200 text-black/40 hover:text-blue-500 hover:border-blue-200 flex items-center justify-center shadow-sm"
                >
                    <Copy size={12} />
                </button>
                <button
                    onclick={(e) => { e.stopPropagation(); onOpenInNewWindow(); }}
                    title="Open in new window"
                    class="w-7 h-7 rounded-full bg-white/90 border border-gray-200 text-black/40 hover:text-blue-500 hover:border-blue-200 flex items-center justify-center shadow-sm"
                >
                    <AppWindow size={12} />
                </button>
                <button
                    onclick={(e) => { e.stopPropagation(); onTrash(); }}
                    title="Move to trash"
                    class="w-7 h-7 rounded-full bg-white/90 border border-gray-200 text-black/40 hover:text-red-400 hover:border-red-200 flex items-center justify-center shadow-sm"
                >
                    <Trash2 size={12} />
                </button>
            </div>
        {/if}
    </div>
{:else}
    <!-- Having "on select" animations/transitions feel instant generally feels better -->
    <div
        class="ph-mask-text group relative text-left w-full rounded-xl px-4 py-3 flex items-center gap-4 border cursor-pointer
            {selected
                ? 'bg-blue-50 border-blue-300 shadow-sm ring-2 ring-blue-400/30'
                : trashMode
                  ? 'bg-white/60 border-white/60 shadow-sm hover:shadow-md hover:border-red-200/60'
                  : 'bg-white/80 border-white/60 shadow-sm hover:shadow-md hover:border-blue-200/60'}"
        onclick={(e) => onSelect(e)}
        ondblclick={trashMode ? undefined : onOpen}
        onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                trashMode ? onSelect(e) : onOpen();
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
            <p class="text-sm font-medium text-black/80 truncate flex items-center gap-1.5">
                {doc.title}
                {#if semanticMatch}
                    {@render similarBadge("inline-flex flex-shrink-0")}
                {/if}
            </p>
            {#if snippetSegs}
                <p class="text-xs text-black/40 mt-0.5 truncate">
                    {@render snippetText(snippetSegs)}
                </p>
            {:else}
                <p class="text-xs text-black/40 mt-0.5 truncate">{doc.previewText || "Empty document"}</p>
            {/if}
            {#if tags.length > 0}
                <div class="mt-1.5 flex flex-wrap gap-1">
                    {#each tags.slice(0, 4) as tag}
                        <button
                            type="button"
                            onclick={(e) => {
                                e.stopPropagation();
                                onTagClick?.(tag);
                            }}
                            class="max-w-[120px] truncate rounded-full bg-black/[0.045] px-2 py-0.5 text-[10px] text-black/45 transition-colors hover:bg-blue-500/10 hover:text-blue-700"
                        >
                            {tag}
                        </button>
                    {/each}
                </div>
            {/if}
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
                        onclick={handleDeletePermanent}
                        title={confirmingDelete ? "Click again to confirm" : "Delete permanently"}
                        class="rounded-full bg-white border flex items-center justify-center shadow-sm transition-all
                            {confirmingDelete
                                ? 'px-2 h-7 border-red-400 bg-red-50 text-red-600 text-[10px] font-medium'
                                : 'w-7 h-7 border-red-200 text-red-400 hover:bg-red-50'}"
                    >
                        {#if confirmingDelete}
                            Delete?
                        {:else}
                            <X size={12} />
                        {/if}
                    </button>
                </div>
            {:else}
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onclick={(e) => { e.stopPropagation(); onDuplicate(); }}
                        title="Duplicate"
                        class="w-7 h-7 rounded-full bg-white border border-gray-200 text-black/30 hover:text-blue-500 hover:border-blue-200 flex items-center justify-center shadow-sm"
                    >
                        <Copy size={12} />
                    </button>
                    <button
                        onclick={(e) => { e.stopPropagation(); onOpenInNewWindow(); }}
                        title="Open in new window"
                        class="w-7 h-7 rounded-full bg-white border border-gray-200 text-black/30 hover:text-blue-500 hover:border-blue-200 flex items-center justify-center shadow-sm"
                    >
                        <AppWindow size={12} />
                    </button>
                    <button
                        onclick={(e) => { e.stopPropagation(); onTrash(); }}
                        title="Move to trash"
                        class="w-7 h-7 rounded-full bg-white border border-gray-200 text-black/30 hover:text-red-400 hover:border-red-200 flex items-center justify-center shadow-sm"
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            {/if}
        </div>
    </div>
{/if}
