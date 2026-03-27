<!--
    PreviewPanel.svelte — Right half of the library page. Full-height,
    shows document title, stats, preview text, and "Open" CTA.
-->
<script lang="ts">
import type { DocumentMeta } from "$lib/db/types";
import { FileText, ExternalLink, Trash2, RotateCcw, Pencil, CheckSquare } from "lucide-svelte";
import Kbd from "$lib/ui/Kbd.svelte";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

interface Props {
    doc: DocumentMeta | null;
    selectedCount: number;
    trashMode: boolean;
    onOpen: () => void;
    onTrash: () => void;
    onRestore: () => void;
    onDeletePermanent: () => void;
    onRenameTitle: (id: string, newTitle: string) => void;
}

const {
    doc,
    selectedCount,
    trashMode,
    onOpen,
    onTrash,
    onRestore,
    onDeletePermanent,
    onRenameTitle,
}: Props = $props();

const multiSelect = $derived(selectedCount > 1);

let confirmingDelete = $derived.by(() => {
    void doc;
    return false;
});
let titleEditing = $derived.by(() => {
    void doc;
    return false;
});
let titleDraft = $state("");
let titleInputEl = $state<HTMLInputElement | undefined>();

export function startEditing() {
    if (!doc || trashMode) return;
    titleDraft = doc.title;
    titleEditing = true;
    setTimeout(() => titleInputEl?.select(), 0);
}

function commitTitle() {
    if (!doc || !titleEditing) return;
    titleEditing = false;
    const newTitle = titleDraft.trim() || "Untitled";
    if (newTitle !== doc.title) onRenameTitle(doc.id, newTitle);
}

function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function handleDeletePermanent() {
    if (confirmingDelete) {
        confirmingDelete = false;
        onDeletePermanent();
    } else {
        confirmingDelete = true;
    }
}
</script>

<div class="h-full flex flex-col bg-white/50 border-l border-black/8">
    {#if multiSelect}
        <!-- Multi-select summary -->
        <div class="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div class="w-14 h-14 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center">
                <CheckSquare size={24} class="text-blue-500" />
            </div>
            <div>
                <p class="text-lg font-semibold text-black/70">{selectedCount} documents selected</p>
                <p class="text-sm text-black/40 mt-1">
                    {#if trashMode}
                        Restore or permanently delete all selected documents.
                    {:else}
                        Use <kbd class="px-1.5 py-0.5 rounded bg-black/5 text-xs font-mono">{modKey}+⌫</kbd> or the button below to trash them.
                    {/if}
                </p>
            </div>
        </div>
        <div class="flex-shrink-0 px-8 pb-8 pt-4 border-t border-black/5 flex flex-col gap-2">
            {#if trashMode}
                <button
                    onclick={onRestore}
                    class="group w-full flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors"
                >
                    <RotateCcw size={16} />
                    Restore {selectedCount} documents
                    <Kbd variant="fullWhite" keys="Z" />
                </button>
                <button
                    onclick={onDeletePermanent}
                    class="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full text-sm font-medium text-red-400 hover:bg-red-50 transition-colors"
                >
                    <Trash2 size={16} />
                    Delete {selectedCount} permanently
                </button>
            {:else}
                <button
                    onclick={onTrash}
                    class="group w-full flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-medium shadow-sm transition-colors"
                >
                    <Trash2 size={16} />
                    Move {selectedCount} to trash
                    <Kbd variant="fullWhite" keys={[modKey, "⌫"]} />
                </button>
            {/if}
        </div>
    {:else if doc}
        <div class="flex-shrink-0 px-8 pt-8 pb-5 border-b border-black/5">
            {#if titleEditing}
                <input
                    bind:this={titleInputEl}
                    bind:value={titleDraft}
                    onblur={commitTitle}
                    onkeydown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
                        if (e.key === "Escape") { titleEditing = false; }
                    }}
                    class="text-xl font-semibold text-black/80 leading-snug bg-transparent border-b-2 border-blue-400/60 outline-none w-full"
                    aria-label="Document title"
                />
            {:else}
                <div class="flex items-start gap-2">
                    <h2 class="text-xl font-semibold text-black/80 leading-snug break-words">{doc.title}</h2>
                    {#if !trashMode}
                        <button
                            onclick={startEditing}
                            title="Rename (R)"
                            class="mt-1 shrink-0 flex items-center gap-1.5 text-black/25 hover:text-black/55 transition-colors"
                        >
                            <Pencil size={14} />
                            <Kbd keys="R" />
                        </button>
                    {/if}
                </div>
            {/if}
            <p class="text-xs text-black/40 mt-1.5">Last edited {formatDate(doc.updatedAt)}</p>
        </div>

        <div class="flex-1 overflow-y-auto px-8 py-6">
            <!-- Stats row -->
            <div class="flex gap-4 mb-6">
                <div class="flex-1 rounded-xl bg-gray-50 border border-gray-100 p-4 text-center">
                    <p class="text-2xl font-semibold text-black/70">{doc.wordCount.toLocaleString()}</p>
                    <p class="text-xs text-black/40 mt-1">words</p>
                </div>
                <div class="flex-1 rounded-xl bg-gray-50 border border-gray-100 p-4 text-center">
                    <p class="text-2xl font-semibold text-black/70">
                        {new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                    <p class="text-xs text-black/40 mt-1">created</p>
                </div>
            </div>

            <!-- Preview text -->
            <div class="rounded-xl bg-gray-50 border border-gray-100 p-5">
                <p class="text-sm text-black/60 leading-relaxed whitespace-pre-wrap">
                    {doc.previewText || "No preview available."}
                </p>
            </div>
        </div>

        <div class="flex-shrink-0 px-8 pb-8 pt-4 border-t border-black/5 flex flex-col gap-2">
            {#if trashMode}
                <button
                    onclick={onRestore}
                    class="group w-full flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors"
                >
                    <RotateCcw size={16} />
                    Restore document
                    <Kbd variant="fullWhite" keys="Z" />
                </button>
                <button
                    onclick={handleDeletePermanent}
                    class="group w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-full text-sm font-medium transition-colors
                        {confirmingDelete
                            ? 'bg-red-500 hover:bg-red-600 text-white shadow-sm'
                            : 'text-red-400 hover:bg-red-50'}"
                >
                    <Trash2 size={16} />
                    {confirmingDelete ? "Confirm permanent delete" : "Delete permanently"}
                </button>
            {:else}
                <button
                    onclick={onOpen}
                    class="group w-full flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors"
                >
                    <ExternalLink size={16} />
                    Open document
                    <Kbd variant="fullWhite" keys="↵" />
                </button>
                <button
                    onclick={onTrash}
                    class="group w-full flex items-center justify-center gap-2 py-2 px-4 rounded-full text-xs font-medium text-red-400 hover:bg-red-50 transition-colors"
                >
                    <Trash2 size={13} />
                    Move to trash
                    <Kbd variant="red" keys={[modKey, "⌫"]} />
                </button>
            {/if}
        </div>
    {:else}
        <div class="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                <FileText size={22} class="text-black/30" />
            </div>
            <p class="text-sm text-black/40">Select a document to preview it here.</p>
        </div>
    {/if}
</div>
