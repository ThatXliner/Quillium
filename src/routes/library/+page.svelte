<!--
    /library — Document gallery page.
-->
<script lang="ts">
import { onMount } from "svelte";
import {
    listDocuments,
    listTrashedDocuments,
    createDocument,
    initDb,
    trashDocument,
    restoreDocument,
    deleteDocument,
    getTrashRetention,
    setTrashRetention,
} from "$lib/db";
import type { DocumentMeta } from "$lib/db/types";
import { currentDocumentId, currentDocumentTitle } from "$lib/stores";
import { goToEditor } from "$lib/navigation";
import LibraryTopBar from "$lib/library/LibraryTopBar.svelte";
import DocumentGrid from "$lib/library/DocumentGrid.svelte";
import PreviewPanel from "$lib/library/PreviewPanel.svelte";
import ContinuePill from "$lib/library/ContinuePill.svelte";
import EmptyState from "$lib/library/EmptyState.svelte";

let documents = $state<DocumentMeta[]>([]);
let trashedDocuments = $state<DocumentMeta[]>([]);
let selectedId = $state<string | null>(null);
let viewMode = $state<"grid" | "list">("grid");
let query = $state("");
let loading = $state(true);
let tab = $state<"library" | "trash">("library");
let trashRetention = $state<number | null>(null);

const trashMode = $derived(tab === "trash");

const activeDocuments = $derived(trashMode ? trashedDocuments : documents);

const filtered = $derived(
    query.trim()
        ? activeDocuments.filter(
              (d) =>
                  d.title.toLowerCase().includes(query.toLowerCase()) ||
                  d.previewText.toLowerCase().includes(query.toLowerCase()),
          )
        : activeDocuments,
);

const selectedDoc = $derived(filtered.find((d) => d.id === selectedId) ?? null);
const hasContinue = $derived($currentDocumentId !== null);

async function load() {
    loading = true;
    await initDb();
    [documents, trashedDocuments, trashRetention] = await Promise.all([
        listDocuments(),
        listTrashedDocuments(),
        getTrashRetention(),
    ]);
    if (!selectedId && documents.length > 0) {
        selectedId = documents[0].id;
    }
    loading = false;
}

async function handleTrashRetentionChange(days: number | null) {
    trashRetention = days;
    await setTrashRetention(days);
}

async function handleNew() {
    const id = await createDocument();
    $currentDocumentId = id;
    $currentDocumentTitle = "Untitled";
    goToEditor();
}

function handleOpen(id: string) {
    $currentDocumentId = id;
    const doc = documents.find((d) => d.id === id);
    if (doc) $currentDocumentTitle = doc.title;
    goToEditor();
}

async function handleTrash(id: string) {
    await trashDocument(id);
    if (selectedId === id) {
        const remaining = documents.filter((d) => d.id !== id);
        selectedId = remaining.length > 0 ? remaining[0].id : null;
    }
    [documents, trashedDocuments] = await Promise.all([listDocuments(), listTrashedDocuments()]);
}

async function handleRestore(id: string) {
    await restoreDocument(id);
    if (selectedId === id) {
        const remaining = trashedDocuments.filter((d) => d.id !== id);
        selectedId = remaining.length > 0 ? remaining[0].id : null;
    }
    [documents, trashedDocuments] = await Promise.all([listDocuments(), listTrashedDocuments()]);
}

async function handleDeletePermanent(id: string) {
    await deleteDocument(id);
    if (selectedId === id) {
        const remaining = trashedDocuments.filter((d) => d.id !== id);
        selectedId = remaining.length > 0 ? remaining[0].id : null;
    }
    trashedDocuments = await listTrashedDocuments();
}

function handleTabChange(newTab: "library" | "trash") {
    tab = newTab;
    query = "";
    selectedId = null;
    const list = newTab === "trash" ? trashedDocuments : documents;
    if (list.length > 0) selectedId = list[0].id;
}

onMount(load);
</script>

<!-- Full-screen 50/50 split -->
<div class="h-screen flex" style="background: linear-gradient(135deg, #f0f0f0 0%, #e8e8e8 100%)">

    <!-- Left half: header + document grid -->
    <div class="w-1/2 flex flex-col min-h-0">
        <header class="flex-shrink-0 px-8 pt-8 pb-4">
            <div class="mb-5">
                <h1 class="text-2xl font-semibold text-black/75">Your Library</h1>
                <p class="text-sm text-black/40 mt-0.5">
                    {#if trashMode}
                        {trashedDocuments.length} {trashedDocuments.length === 1 ? "document" : "documents"} in trash
                    {:else}
                        {documents.length} {documents.length === 1 ? "document" : "documents"}
                    {/if}
                </p>
            </div>
            <LibraryTopBar
                {viewMode}
                onViewModeChange={(m) => (viewMode = m)}
                {query}
                onQueryChange={(q) => (query = q)}
                onNew={handleNew}
                {tab}
                onTabChange={handleTabChange}
                {trashRetention}
                onTrashRetentionChange={handleTrashRetentionChange}
            />
        </header>

        <div class="flex-1 overflow-y-auto px-8 pb-8">
            {#if loading}
                <div class="flex items-center justify-center h-40">
                    <div class="w-6 h-6 rounded-full border-2 border-blue-400 border-t-transparent animate-spin"></div>
                </div>
            {:else if filtered.length === 0 && activeDocuments.length === 0 && !trashMode}
                <EmptyState onNew={handleNew} />
            {:else if filtered.length === 0 && activeDocuments.length === 0 && trashMode}
                <div class="flex flex-col items-center justify-center h-40 gap-2">
                    <p class="text-sm text-black/40">Trash is empty.</p>
                </div>
            {:else if filtered.length === 0}
                <div class="flex flex-col items-center justify-center h-40">
                    <p class="text-sm text-black/40">No documents match your search.</p>
                </div>
            {:else}
                <DocumentGrid
                    documents={filtered}
                    {selectedId}
                    {viewMode}
                    {trashMode}
                    onSelect={(id) => (selectedId = id)}
                    onOpen={handleOpen}
                    onTrash={handleTrash}
                    onRestore={handleRestore}
                    onDeletePermanent={handleDeletePermanent}
                />
            {/if}
        </div>
    </div>

    <!-- Right half: preview panel, full height, no rounding/border -->
    <div class="w-1/2 h-full">
        <PreviewPanel
            doc={selectedDoc}
            {trashMode}
            onOpen={() => selectedId && handleOpen(selectedId)}
            onTrash={() => selectedId && handleTrash(selectedId)}
            onRestore={() => selectedId && handleRestore(selectedId)}
            onDeletePermanent={() => selectedId && handleDeletePermanent(selectedId)}
        />
    </div>

</div>

<ContinuePill visible={hasContinue} />
