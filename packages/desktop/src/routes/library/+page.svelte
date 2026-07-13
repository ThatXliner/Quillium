<!--
    /library — Document gallery page.
-->
<script lang="ts">
import {
    createDocument,
    deleteDocument,
    getDocumentMeta,
    getTrashRetention,
    isDocOpenElsewhere,
    isSearchStatusPreparing,
    listDocuments,
    listTrashedDocuments,
    openInNewWindow,
    pollSearchStatus,
    restoreDocument,
    searchDocuments,
    setTrashRetention,
    trashDocument,
    updateDocumentMeta,
} from "$lib/db";
import {
    getNewDocumentUndoHistoryAnalytics,
    getUndoHistoryPolicyAnalytics,
} from "$lib/db/historyPolicy";
import type { DocumentMeta, SearchHit } from "$lib/db/types";
import ContinuePill from "$lib/library/ContinuePill.svelte";
import DocumentGrid from "$lib/library/DocumentGrid.svelte";
import EmptyState from "$lib/library/EmptyState.svelte";
import LibraryTopBar from "$lib/library/LibraryTopBar.svelte";
import PreviewPanel from "$lib/library/PreviewPanel.svelte";
import { parseTags } from "$lib/library/tags";
import { goToEditor } from "$lib/navigation";
import posthog from "$lib/posthog";
import { getPersistUndoHistoryForNewDocuments } from "$lib/settings.svelte";
import { currentDocumentId, currentDocumentTitle } from "$lib/stores";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { onDestroy, onMount } from "svelte";
import { Toaster, toast } from "svelte-sonner";

let searchInputEl = $state<HTMLInputElement | null>(null);
let previewPanel = $state<ReturnType<typeof PreviewPanel> | null>(null);

let documents = $state<DocumentMeta[]>([]);
let trashedDocuments = $state<DocumentMeta[]>([]);
let selectedIds = $state<Set<string>>(new Set());
let lastClickedId = $state<string | null>(null);
let viewMode = $state<"grid" | "list">("grid");
let query = $state("");
let loading = $state(true);
let tab = $state<"library" | "trash">("library");
let trashRetention = $state<number | null>(null);

const trashMode = $derived(tab === "trash");

const activeDocuments = $derived(trashMode ? trashedDocuments : documents);

// ── Content search (FTS5 + semantic, see src-tauri/src/db/search.rs) ──
// The instant substring filter below stays for snappiness; once the query
// is non-trivial, a debounced backend search adds matches on full document
// *content* (beyond the 200-char preview) plus semantic matches.
let serverHits = $state<SearchHit[] | null>(null);
// Query the displayed hits belong to, so a query change can drop stale
// snippets/highlights instead of rendering them against the new text.
let serverHitsQuery = $state<string | null>(null);
let searchSeq = 0;
const contentSearchActive = $derived(!trashMode && query.trim().length >= 2);

$effect(() => {
    const q = query.trim();
    if (!contentSearchActive) {
        // Bump the sequence too, so an in-flight request that resolves after
        // the box is cleared can't write its results back.
        searchSeq++;
        serverHits = null;
        serverHitsQuery = null;
        return;
    }
    // New query → discard the prior query's hits up front; keeping them would
    // briefly rank/highlight documents for terms the user already replaced.
    if (q !== serverHitsQuery) {
        serverHits = null;
        serverHitsQuery = null;
    }
    const seq = ++searchSeq;
    const timer = setTimeout(async () => {
        try {
            const hits = await searchDocuments(q);
            if (seq === searchSeq) {
                serverHits = hits;
                serverHitsQuery = q;
            }
        } catch (e) {
            console.error("[library] content search failed:", e);
        }
    }, 200);
    return () => clearTimeout(timer);
});

const hitById = $derived(
    new Map((contentSearchActive ? (serverHits ?? []) : []).map((h) => [h.id, h])),
);

const clientFiltered = $derived(
    query.trim()
        ? activeDocuments.filter(
              (d) =>
                  d.title.toLowerCase().includes(query.toLowerCase()) ||
                  d.previewText.toLowerCase().includes(query.toLowerCase()) ||
                  parseTags(d.tags).some((tag) => tag.toLowerCase().includes(query.toLowerCase())),
          )
        : activeDocuments,
);

// Backend hits first (already ranked best-first), then any remaining
// client-side substring matches. Metadata comes from the live `documents`
// list so renames/trashes reflect instantly even while hits are stale.
const filtered = $derived.by(() => {
    if (!contentSearchActive || serverHits === null) return clientFiltered;
    const liveById = new Map(documents.map((d) => [d.id, d]));
    const ranked = serverHits
        .map((h) => liveById.get(h.id))
        .filter((d): d is DocumentMeta => d !== undefined);
    const seen = new Set(ranked.map((d) => d.id));
    return [...ranked, ...clientFiltered.filter((d) => !seen.has(d.id))];
});

// Semantic index status — only used to explain why "search by meaning"
// results may be missing while the model downloads/indexes on first run.
let semanticStatus = $state("ready");
let cancelStatusPoll: (() => void) | undefined;
const semanticPreparing = $derived(isSearchStatusPreparing(semanticStatus));

/** When exactly one document is selected, show its preview. */
const selectedDoc = $derived(
    selectedIds.size === 1 ? (filtered.find((d) => selectedIds.has(d.id)) ?? null) : null,
);
const selectedCount = $derived(selectedIds.size);
const hasContinue = $derived($currentDocumentId !== null);

function handleSelect(id: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    if (e.shiftKey && lastClickedId) {
        // Range select: select everything between lastClickedId and id
        const ids = filtered.map((d) => d.id);
        const a = ids.indexOf(lastClickedId);
        const b = ids.indexOf(id);
        if (a !== -1 && b !== -1) {
            const [start, end] = a < b ? [a, b] : [b, a];
            const rangeIds = ids.slice(start, end + 1);
            selectedIds = new Set([...selectedIds, ...rangeIds]);
        }
    } else if (e.metaKey || e.ctrlKey) {
        // Toggle select
        const next = new Set(selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        selectedIds = next;
        lastClickedId = id;
    } else {
        // Plain click — single select
        selectedIds = new Set([id]);
        lastClickedId = id;
    }
}

async function load() {
    loading = true;
    [documents, trashedDocuments, trashRetention] = await Promise.all([
        listDocuments(),
        listTrashedDocuments(),
        getTrashRetention(),
    ]);
    if (selectedIds.size === 0 && documents.length > 0) {
        selectedIds = new Set([documents[0].id]);
        lastClickedId = documents[0].id;
    }
    loading = false;
}

async function handleTrashRetentionChange(days: number | null) {
    trashRetention = days;
    await setTrashRetention(days);
}

async function handleNew() {
    const persistHistory = getPersistUndoHistoryForNewDocuments();
    const id = await createDocument("Untitled", persistHistory);
    posthog.capture("document_created", getNewDocumentUndoHistoryAnalytics(persistHistory));
    $currentDocumentId = id;
    $currentDocumentTitle = "Untitled";
    goToEditor();
}

async function handleOpen(id: string) {
    // Don't open a document in-window if it's already open in another window;
    // focus that window instead.
    const elsewhere = await isDocOpenElsewhere(id, getCurrentWebviewWindow().label);
    if (elsewhere) {
        toast.info("This document is already open in another window.");
        return;
    }
    const doc = documents.find((d) => d.id === id);
    posthog.capture("document_opened", doc ? getUndoHistoryPolicyAnalytics(doc) : undefined);
    $currentDocumentId = id;
    if (doc) $currentDocumentTitle = doc.title;
    goToEditor();
}

function handleOpenInNewWindow(id: string) {
    const doc = documents.find((candidate) => candidate.id === id);
    posthog.capture(
        "document_opened_new_window",
        doc ? getUndoHistoryPolicyAnalytics(doc) : undefined,
    );
    openInNewWindow(id);
}

async function handleRenameTitle(id: string, newTitle: string) {
    const meta = await getDocumentMeta(id);
    if (!meta) return;
    await updateDocumentMeta(id, newTitle, meta.wordCount, meta.previewText, meta.tags);
    posthog.capture("document_renamed");
    documents = await listDocuments();
    // Keep the store in sync if this is the currently open document
    if ($currentDocumentId === id) $currentDocumentTitle = newTitle;
}

async function handleUpdateTags(id: string, tags: string) {
    const meta = await getDocumentMeta(id);
    if (!meta) return;
    await updateDocumentMeta(id, meta.title, meta.wordCount, meta.previewText, tags);
    posthog.capture("document_tags_updated", { count: parseTags(tags).length });
    documents = await listDocuments();
}

function handleTagClick(tag: string) {
    query = tag;
}

async function handleTrash(id: string) {
    await trashDocument(id);
    posthog.capture("document_trashed", { count: 1 });
    if ($currentDocumentId === id) {
        $currentDocumentId = null;
        $currentDocumentTitle = "Untitled";
    }
    const next = new Set(selectedIds);
    next.delete(id);
    selectedIds = next;
    [documents, trashedDocuments] = await Promise.all([listDocuments(), listTrashedDocuments()]);
    if (selectedIds.size === 0 && documents.length > 0) {
        selectedIds = new Set([documents[0].id]);
        lastClickedId = documents[0].id;
    }
}

async function handleTrashSelected() {
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => trashDocument(id)));
    posthog.capture("document_trashed", { count: ids.length });
    if ($currentDocumentId && ids.includes($currentDocumentId)) {
        $currentDocumentId = null;
        $currentDocumentTitle = "Untitled";
    }
    selectedIds = new Set();
    lastClickedId = null;
    [documents, trashedDocuments] = await Promise.all([listDocuments(), listTrashedDocuments()]);
    if (documents.length > 0) {
        selectedIds = new Set([documents[0].id]);
        lastClickedId = documents[0].id;
    }
}

async function handleRestore(id: string) {
    await restoreDocument(id);
    posthog.capture("document_restored", { count: 1 });
    const next = new Set(selectedIds);
    next.delete(id);
    selectedIds = next;
    [documents, trashedDocuments] = await Promise.all([listDocuments(), listTrashedDocuments()]);
    if (selectedIds.size === 0 && trashedDocuments.length > 0) {
        selectedIds = new Set([trashedDocuments[0].id]);
        lastClickedId = trashedDocuments[0].id;
    }
}

async function handleRestoreSelected() {
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => restoreDocument(id)));
    posthog.capture("document_restored", { count: ids.length });
    selectedIds = new Set();
    lastClickedId = null;
    [documents, trashedDocuments] = await Promise.all([listDocuments(), listTrashedDocuments()]);
    if (trashedDocuments.length > 0) {
        selectedIds = new Set([trashedDocuments[0].id]);
        lastClickedId = trashedDocuments[0].id;
    }
}

async function handleDeletePermanent(id: string) {
    await deleteDocument(id);
    posthog.capture("document_deleted_permanently", { count: 1 });
    if ($currentDocumentId === id) {
        $currentDocumentId = null;
        $currentDocumentTitle = "Untitled";
    }
    const next = new Set(selectedIds);
    next.delete(id);
    selectedIds = next;
    trashedDocuments = await listTrashedDocuments();
    if (selectedIds.size === 0 && trashedDocuments.length > 0) {
        selectedIds = new Set([trashedDocuments[0].id]);
        lastClickedId = trashedDocuments[0].id;
    }
}

async function handleDeletePermanentSelected() {
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => deleteDocument(id)));
    posthog.capture("document_deleted_permanently", { count: ids.length });
    if ($currentDocumentId && ids.includes($currentDocumentId)) {
        $currentDocumentId = null;
        $currentDocumentTitle = "Untitled";
    }
    selectedIds = new Set();
    lastClickedId = null;
    trashedDocuments = await listTrashedDocuments();
    if (trashedDocuments.length > 0) {
        selectedIds = new Set([trashedDocuments[0].id]);
        lastClickedId = trashedDocuments[0].id;
    }
}

function handleTabChange(newTab: "library" | "trash") {
    tab = newTab;
    query = "";
    selectedIds = new Set();
    lastClickedId = null;
    const list = newTab === "trash" ? trashedDocuments : documents;
    if (list.length > 0) {
        selectedIds = new Set([list[0].id]);
        lastClickedId = list[0].id;
    }
}

function handleKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const inInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";

    // Cmd/Ctrl+Shift+O — open the selected document in a new window
    if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o" &&
        selectedIds.size === 1 &&
        !trashMode
    ) {
        e.preventDefault();
        handleOpenInNewWindow([...selectedIds][0]);
        return;
    }

    // Esc — clear multi-select (or back to editor if single/no selection)
    if (e.key === "Escape" && !inInput) {
        if (selectedIds.size > 1) {
            // Collapse to just the last-clicked item
            selectedIds = lastClickedId ? new Set([lastClickedId]) : new Set();
            return;
        }
        if (hasContinue) {
            goToEditor();
            return;
        }
        return;
    }

    // Cmd/Ctrl+A — select all visible documents
    if ((e.metaKey || e.ctrlKey) && e.key === "a" && !inInput) {
        e.preventDefault();
        selectedIds = new Set(filtered.map((d) => d.id));
        return;
    }

    // N — new document (not in input, not trash tab)
    if (e.key === "n" && !inInput && !e.metaKey && !e.ctrlKey && tab === "library") {
        e.preventDefault();
        handleNew();
        return;
    }

    // / — focus search
    if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchInputEl?.focus();
        return;
    }

    // Escape inside search — blur
    if (e.key === "Escape" && inInput) {
        (target as HTMLElement).blur();
        return;
    }

    // ↑ / ↓ — navigate document list (always single-step, replaces selection)
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !inInput) {
        e.preventDefault();
        if (filtered.length === 0) return;
        // Find the cursor position based on lastClickedId
        const cursorId = lastClickedId ?? [...selectedIds][0] ?? null;
        const idx = cursorId ? filtered.findIndex((d) => d.id === cursorId) : -1;
        let nextIdx: number;
        if (e.key === "ArrowUp") {
            nextIdx = idx <= 0 ? 0 : idx - 1;
        } else {
            nextIdx = idx >= filtered.length - 1 ? filtered.length - 1 : idx + 1;
        }
        const nextId = filtered[nextIdx].id;
        selectedIds = new Set([nextId]);
        lastClickedId = nextId;
        return;
    }

    // Enter — open selected document (only if single selection)
    if (e.key === "Enter" && !inInput && selectedIds.size === 1 && !trashMode) {
        e.preventDefault();
        handleOpen([...selectedIds][0]);
        return;
    }

    // Cmd/Ctrl+Backspace — trash selected document(s)
    if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "Backspace" &&
        !inInput &&
        selectedIds.size > 0 &&
        !trashMode
    ) {
        e.preventDefault();
        if (selectedIds.size === 1) {
            handleTrash([...selectedIds][0]);
        } else {
            handleTrashSelected();
        }
        return;
    }

    // Z — restore selected document(s) from trash
    if (
        e.key === "z" &&
        !inInput &&
        !e.metaKey &&
        !e.ctrlKey &&
        trashMode &&
        selectedIds.size > 0
    ) {
        e.preventDefault();
        if (selectedIds.size === 1) {
            handleRestore([...selectedIds][0]);
        } else {
            handleRestoreSelected();
        }
        return;
    }

    // R — rename selected document (only single selection)
    if (e.key === "r" && !inInput && selectedIds.size === 1 && !trashMode) {
        e.preventDefault();
        previewPanel?.startEditing();
        return;
    }

    // G — grid view, L — list view
    if (e.key === "g" && !inInput) {
        viewMode = "grid";
        return;
    }
    if (e.key === "l" && !inInput) {
        viewMode = "list";
        return;
    }
}

let unlisten: UnlistenFn | undefined;

onMount(async () => {
    posthog.capture("library_viewed");
    load();
    cancelStatusPoll = pollSearchStatus((status) => {
        semanticStatus = status ?? "unavailable";
    }, 4000);
    // File → Open in New Window menu item targets the focused window; when that's
    // the library, open whichever single document is currently selected.
    unlisten = await listen("menu:open-in-new-window", () => {
        if (selectedIds.size === 1 && !trashMode) {
            handleOpenInNewWindow([...selectedIds][0]);
        }
    });
});

onDestroy(() => {
    unlisten?.();
    cancelStatusPoll?.();
});
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Full-screen 50/50 split -->
<div class="h-screen flex" style="background: linear-gradient(135deg, #f0f0f0 0%, #e8e8e8 100%)">

    <!-- Left half: header + document grid -->
    <div class="w-1/2 flex flex-col min-h-0">
        <header class="flex-shrink-0 px-8 pt-8 pb-4">
            <div class="mb-5">
                <h1 class="text-2xl font-semibold text-black/75">Your Library</h1>
                <p class="text-sm text-black/40 mt-0.5">
                    {#if selectedCount > 1}
                        {selectedCount} selected
                    {:else if trashMode}
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
                bind:searchInputEl
            />
            {#if contentSearchActive && semanticPreparing}
                <p class="mt-2 text-xs text-black/35">
                    Searching titles and full text — search by meaning is still preparing…
                </p>
            {/if}
        </header>

        <div class="flex-1 overflow-y-auto px-8 pb-8 pt-1">
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
                    {selectedIds}
                    {viewMode}
                    {trashMode}
                    hits={hitById}
                    onSelect={handleSelect}
                    onOpen={handleOpen}
                    onTrash={handleTrash}
                    onRestore={handleRestore}
                    onDeletePermanent={handleDeletePermanent}
                    onOpenInNewWindow={handleOpenInNewWindow}
                    onTagClick={handleTagClick}
                />
            {/if}
        </div>
    </div>

    <!-- Right half: preview panel, full height, no rounding/border -->
    <div class="w-1/2 h-full">
        <PreviewPanel
            bind:this={previewPanel}
            doc={selectedDoc}
            {selectedCount}
            {trashMode}
            onOpen={() => selectedIds.size === 1 && handleOpen([...selectedIds][0])}
            onOpenInNewWindow={() => selectedIds.size === 1 && handleOpenInNewWindow([...selectedIds][0])}
            onTrash={() => {
                if (selectedIds.size === 1) handleTrash([...selectedIds][0]);
                else if (selectedIds.size > 1) handleTrashSelected();
            }}
            onRestore={() => {
                if (selectedIds.size === 1) handleRestore([...selectedIds][0]);
                else if (selectedIds.size > 1) handleRestoreSelected();
            }}
            onDeletePermanent={() => {
                if (selectedIds.size === 1) handleDeletePermanent([...selectedIds][0]);
                else if (selectedIds.size > 1) handleDeletePermanentSelected();
            }}
            onRenameTitle={handleRenameTitle}
            onUpdateTags={handleUpdateTags}
        />
    </div>

</div>

<ContinuePill visible={hasContinue} />
<Toaster position="bottom-center" />
