<!--
    /library — Document gallery page.

    Shows all saved documents in a card grid or list with a
    right-side preview panel. Supports search, view toggle,
    new document creation, and a "Continue editing" pill for
    returning to the currently open document.
-->
<script lang="ts">
import { onMount } from "svelte";
import { listDocuments, createDocument, initDb } from "$lib/db";
import type { DocumentMeta } from "$lib/db/types";
import { currentDocumentId, currentDocumentTitle } from "$lib/stores";
import { goToEditor } from "$lib/navigation";
import LibraryTopBar from "$lib/library/LibraryTopBar.svelte";
import DocumentGrid from "$lib/library/DocumentGrid.svelte";
import PreviewPanel from "$lib/library/PreviewPanel.svelte";
import ContinuePill from "$lib/library/ContinuePill.svelte";
import EmptyState from "$lib/library/EmptyState.svelte";

let documents = $state<DocumentMeta[]>([]);
let selectedId = $state<string | null>(null);
let viewMode = $state<"grid" | "list">("grid");
let query = $state("");
let loading = $state(true);

const filtered = $derived(
    query.trim()
        ? documents.filter(
              (d) =>
                  d.title.toLowerCase().includes(query.toLowerCase()) ||
                  d.previewText.toLowerCase().includes(query.toLowerCase()),
          )
        : documents,
);

const selectedDoc = $derived(filtered.find((d) => d.id === selectedId) ?? null);

const hasContinue = $derived($currentDocumentId !== null);

async function load() {
    loading = true;
    await initDb();
    documents = await listDocuments();
    // Auto-select first doc if nothing selected
    if (!selectedId && documents.length > 0) {
        selectedId = documents[0].id;
    }
    loading = false;
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

onMount(load);
</script>

<div class="min-h-screen bg-gray-100" style="background: linear-gradient(135deg, #f0f0f0 0%, #e8e8e8 100%)">
    <!-- Top app bar -->
    <header class="sticky top-0 z-10 px-8 pt-8 pb-4">
        <div class="flex items-center justify-between mb-5">
            <div>
                <h1 class="text-2xl font-semibold text-black/75">Your Library</h1>
                <p class="text-sm text-black/40 mt-0.5">
                    {documents.length} {documents.length === 1 ? "document" : "documents"}
                </p>
            </div>
        </div>
        <LibraryTopBar
            {viewMode}
            onViewModeChange={(m) => (viewMode = m)}
            {query}
            onQueryChange={(q) => (query = q)}
            onNew={handleNew}
        />
    </header>

    <!-- Main content -->
    <div class="flex gap-5 px-8 pb-8" style="height: calc(100vh - 168px);">
        <!-- Document list / grid -->
        <div class="flex-1 overflow-y-auto">
            {#if loading}
                <div class="flex items-center justify-center h-40">
                    <div class="w-6 h-6 rounded-full border-2 border-blue-400 border-t-transparent animate-spin"></div>
                </div>
            {:else if filtered.length === 0 && documents.length === 0}
                <EmptyState onNew={handleNew} />
            {:else if filtered.length === 0}
                <div class="flex flex-col items-center justify-center h-40 gap-2">
                    <p class="text-sm text-black/40">No documents match your search.</p>
                </div>
            {:else}
                <DocumentGrid
                    documents={filtered}
                    {selectedId}
                    {viewMode}
                    onSelect={(id) => (selectedId = id)}
                    onOpen={handleOpen}
                />
            {/if}
        </div>

        <!-- Preview panel -->
        <div class="w-72 flex-shrink-0">
            <PreviewPanel
                doc={selectedDoc}
                onOpen={() => selectedId && handleOpen(selectedId)}
            />
        </div>
    </div>

    <ContinuePill visible={hasContinue} />
</div>
