<!--
    /library — Document gallery page.
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

<!-- Full-screen 50/50 split -->
<div class="h-screen flex" style="background: linear-gradient(135deg, #f0f0f0 0%, #e8e8e8 100%)">

    <!-- Left half: header + document grid -->
    <div class="w-1/2 flex flex-col min-h-0">
        <header class="flex-shrink-0 px-8 pt-8 pb-4">
            <div class="mb-5">
                <h1 class="text-2xl font-semibold text-black/75">Your Library</h1>
                <p class="text-sm text-black/40 mt-0.5">
                    {documents.length} {documents.length === 1 ? "document" : "documents"}
                </p>
            </div>
            <LibraryTopBar
                {viewMode}
                onViewModeChange={(m) => (viewMode = m)}
                {query}
                onQueryChange={(q) => (query = q)}
                onNew={handleNew}
            />
        </header>

        <div class="flex-1 overflow-y-auto px-8 pb-8">
            {#if loading}
                <div class="flex items-center justify-center h-40">
                    <div class="w-6 h-6 rounded-full border-2 border-blue-400 border-t-transparent animate-spin"></div>
                </div>
            {:else if filtered.length === 0 && documents.length === 0}
                <EmptyState onNew={handleNew} />
            {:else if filtered.length === 0}
                <div class="flex flex-col items-center justify-center h-40">
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
    </div>

    <!-- Right half: preview panel, full height, no rounding/border -->
    <div class="w-1/2 h-full">
        <PreviewPanel
            doc={selectedDoc}
            onOpen={() => selectedId && handleOpen(selectedId)}
        />
    </div>

</div>

<ContinuePill visible={hasContinue} />
