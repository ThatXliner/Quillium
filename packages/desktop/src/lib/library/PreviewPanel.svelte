<!--
    PreviewPanel.svelte — Right half of the library page. Full-height,
    shows document title, stats, preview text, and "Open" CTA.
-->
<script lang="ts">
import type { DocumentMeta } from "$lib/db/types";
import { type ExportFormat, exportDocumentById } from "$lib/export";
import DocumentPreview from "./DocumentPreview.svelte";
import {
    FileText,
    ExternalLink,
    AppWindow,
    Trash2,
    RotateCcw,
    Pencil,
    CheckSquare,
    Download,
    Tag,
    X,
} from "lucide-svelte";
import Kbd from "$lib/ui/Kbd.svelte";
import { normalizeTag, parseTags, serializeTags } from "./tags";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modKey = isMac ? "⌘" : "Ctrl";

interface Props {
    doc: DocumentMeta | null;
    selectedCount: number;
    trashMode: boolean;
    onOpen: () => void;
    onOpenInNewWindow: () => void;
    onTrash: () => void;
    onRestore: () => void;
    onDeletePermanent: () => void;
    onRenameTitle: (id: string, newTitle: string) => void;
    onUpdateTags: (id: string, tags: string) => void;
}

const {
    doc,
    selectedCount,
    trashMode,
    onOpen,
    onOpenInNewWindow,
    onTrash,
    onRestore,
    onDeletePermanent,
    onRenameTitle,
    onUpdateTags,
}: Props = $props();

const multiSelect = $derived(selectedCount > 1);

let exportOpen = $state(false);
let exportWrapperEl = $state<HTMLDivElement>();
$effect(() => {
    void doc;
    exportOpen = false;
});
let exporting = $state(false);
let exportMenuEl = $state<HTMLDivElement>();
let hoveredExportIdx = $state(-1);
let exportPillStyle = $state("opacity: 0;");

$effect(() => {
    if (!exportMenuEl || hoveredExportIdx < 0) {
        exportPillStyle = "opacity: 0;";
        return;
    }
    const buttons = exportMenuEl.querySelectorAll<HTMLButtonElement>(".export-item");
    const btn = buttons[hoveredExportIdx];
    if (!btn) {
        exportPillStyle = "opacity: 0;";
        return;
    }
    exportPillStyle = `opacity: 1; top: ${btn.offsetTop}px; height: ${btn.offsetHeight}px;`;
});

function handleWindowClick(e: MouseEvent) {
    if (exportOpen && exportWrapperEl && !exportWrapperEl.contains(e.target as Node)) {
        exportOpen = false;
        hoveredExportIdx = -1;
    }
}

async function doExport(format: ExportFormat) {
    if (!doc || exporting) return;
    exporting = true;
    try {
        await exportDocumentById(doc.id, doc.title, format);
    } finally {
        exporting = false;
        exportOpen = false;
    }
}

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
let tagInput = $state("");
const tags = $derived(doc ? parseTags(doc.tags) : []);

$effect(() => {
    void doc;
    tagInput = "";
});

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

function commitTagInput() {
    if (!doc) return;
    const next = normalizeTag(tagInput.replace(/,$/, ""));
    if (!next) return;
    tagInput = "";
    onUpdateTags(doc.id, serializeTags([...tags, next]));
}

function removeTag(tag: string) {
    if (!doc) return;
    onUpdateTags(
        doc.id,
        serializeTags(tags.filter((existing) => existing.toLowerCase() !== tag.toLowerCase())),
    );
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

<svelte:window onclick={handleWindowClick} />

<div class="ph-mask-text h-full flex flex-col bg-white/50 border-l border-black/8">
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

            <!-- Full document preview -->
            <div class="rounded-xl bg-gray-50 border border-gray-100 overflow-hidden h-64">
                <DocumentPreview docId={doc.id} />
            </div>

            {#if !trashMode}
                <div class="mt-5">
                    <div class="mb-2 flex items-center gap-1.5 text-xs font-medium text-black/45">
                        <Tag size={13} />
                        Tags
                    </div>
                    <div class="flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-100 bg-gray-50 p-3">
                        {#each tags as tag}
                            <button
                                type="button"
                                onclick={() => removeTag(tag)}
                                class="group inline-flex max-w-full items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-xs text-black/55 ring-1 ring-black/5 transition-colors hover:bg-red-50 hover:text-red-600"
                                title="Remove tag"
                            >
                                <span class="truncate">{tag}</span>
                                <X size={11} class="opacity-45 group-hover:opacity-80" />
                            </button>
                        {/each}
                        <input
                            bind:value={tagInput}
                            onkeydown={(e) => {
                                if (e.key === "Enter" || e.key === ",") {
                                    e.preventDefault();
                                    commitTagInput();
                                }
                                if (e.key === "Backspace" && !tagInput && tags.length > 0) {
                                    removeTag(tags[tags.length - 1]);
                                }
                            }}
                            onblur={commitTagInput}
                            placeholder={tags.length === 0 ? "Add tag..." : "Add..."}
                            class="min-w-[6rem] flex-1 bg-transparent px-1 py-1 text-xs text-black/60 outline-none placeholder:text-black/25"
                        />
                    </div>
                </div>
            {/if}
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
                <div class="flex gap-2">
                    <button
                        onclick={onOpen}
                        class="group flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium shadow-sm transition-colors"
                    >
                        <ExternalLink size={16} />
                        Open
                        <Kbd variant="fullWhite" keys="↵" />
                    </button>
                    {#if !multiSelect}
                        <button
                            onclick={onOpenInNewWindow}
                            title="Open in new window"
                            class="flex items-center justify-center gap-2 py-3 px-4 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 text-sm font-medium shadow-sm transition-colors"
                        >
                            <AppWindow size={16} />
                            New Window
                            <Kbd variant="default" keys={[modKey, "⇧", "O"]} />
                        </button>
                    {/if}
                    <div class="relative" bind:this={exportWrapperEl}>
                        <button
                            onclick={() => (exportOpen = !exportOpen)}
                            class="h-full flex items-center justify-center gap-1.5 py-3 px-4 rounded-full text-sm font-medium shadow-sm transition-colors
                                {exportOpen ? 'bg-purple-500 text-white' : 'bg-purple-50 text-purple-500 hover:bg-purple-100'}"
                        >
                            <Download size={15} />
                            Export
                        </button>
                        {#if exportOpen}
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <div
                                bind:this={exportMenuEl}
                                class="absolute bottom-full mb-1 right-0 min-w-[11rem] rounded-xl bg-white border border-black/8 shadow-lg overflow-hidden py-1 px-1"
                                onmouseleave={() => (hoveredExportIdx = -1)}
                            >
                                <div
                                    class="absolute inset-x-1 rounded-lg bg-purple-50 pointer-events-none transition-[top,height,opacity] duration-200 ease-[cubic-bezier(0.34,1.2,0.64,1)]"
                                    style={exportPillStyle}
                                ></div>
                                {#each [
                                    { format: "txt" as ExportFormat, label: "Plain Text (.txt)" },
                                    { format: "txt+json" as ExportFormat, label: "Text + Annotations (.txt)" },
                                    { format: "json" as ExportFormat, label: "JSON (.json)" },
                                    { format: "md" as ExportFormat, label: "Markdown (.md)" },
                                    { format: "pdf" as ExportFormat, label: "PDF (.pdf)" },
                                    { format: "pdf+annotations" as ExportFormat, label: "PDF + Annotations (.pdf)" },
                                ] as item, i}
                                    <button
                                        onclick={() => doExport(item.format)}
                                        onmouseenter={() => (hoveredExportIdx = i)}
                                        disabled={exporting}
                                        class="export-item relative z-[1] w-full text-left px-3 py-2.5 text-sm text-black/70 transition-colors disabled:opacity-50"
                                    >{item.label}</button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>
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
