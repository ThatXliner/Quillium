<!--
    VersionHistory.svelte — Document-wide version history ("git reflog").

    Orchestrates a single, linear, chronological timeline for the WHOLE document:
    every draft's content snapshots interleaved with structural events (tab/draft
    CRUD, iterate/branch, locks). Selecting a coordinate previews the document's
    structure AND content as it was then; "Restore to here" non-destructively
    rewinds the whole document to that point (later coordinates remain).

    Decomposed into: TimelinePanel (the stream), PreviewPane (structure map +
    content), and the storage-management panel kept inline below.
-->
<script lang="ts">
import {
    createNamedSnapshot,
    getSnapshotRetention,
    getSnapshotStorageSize,
    labelSnapshot,
    listDocEvents,
    listDocumentSnapshots,
    listDocumentStructure,
    listDocuments,
    loadSnapshotState,
    pruneSnapshotsKeepLastN,
    pruneSnapshotsOlderThan,
    resolveActiveDraftId,
    restoreToCoordinate,
    setSnapshotRetention,
} from "$lib/db";
import type { DocEventRecord, DocumentSnapshotMeta, DraftMeta, TabMeta } from "$lib/db/types";
import { savedFields } from "$lib/editor/extensions";
import { goToEditor } from "$lib/navigation";
import posthog from "$lib/posthog";
import {
    currentDocumentId,
    currentDraftId,
    editorView,
    lastPersistedEventId,
    lastSavedAt,
} from "$lib/stores";
import Kbd from "$lib/ui/Kbd.svelte";
import { ArrowLeft, BookmarkPlus, ChevronRight, Clock, RotateCcw } from "lucide-svelte";
import { onMount } from "svelte";
import { get } from "svelte/store";
import PreviewPane from "./history/PreviewPane.svelte";
import TimelinePanel from "./history/TimelinePanel.svelte";
import { docTextFromStateJson } from "./history/diff";
import {
    type TimelineItem,
    buildTimelineItems,
    coordinateForItem,
    describeDocEvent,
    formatTime,
    formatTimeShort,
    groupByDate,
    reconstructStructureAsOf,
    resolveTabContentAt,
    resolveTimelineTarget,
} from "./history/timeline";

// ── State ───────────────────────────────────────────────────────
let snapshots = $state<DocumentSnapshotMeta[]>([]);
let docEvents = $state<DocEventRecord[]>([]);
// Full tab/draft roster incl. soft-deleted — the universe the preview map
// rewinds over (so since-deleted nodes still render where they were alive).
let allTabs = $state<TabMeta[]>([]);
let allDrafts = $state<DraftMeta[]>([]);
let loading = $state(true);
let selectedItem = $state<TimelineItem | null>(null);
let confirmingRestore = $state(false);

// Preview content (real read-only editor + track-changes) for the viewed tab.
let viewedTabId = $state<string | null>(null);
let previewLoading = $state(false);
let previewCurrentJson = $state<string | null>(null);
let previewPreviousText = $state("");
let previewHasContent = $state(false);
// Monotonic token so a slow content load can't overwrite a newer selection.
let previewToken = 0;

let checkpointLabel = $state("");
let savingCheckpoint = $state(false);
let checkpointAlerting = $state(false);

// ── Storage management ──────────────────────────────────────────
const STORAGE_WARN_BYTES = 1_073_741_824; // 1 GB
let storageBytes = $state<number | null>(null);
let snapshotRetention = $state<number | null | undefined>(undefined);
let showStoragePanel = $state(false);
let pruneKeepN = $state(50);
let pruneOlderThanDays = $state(90);
let pruning = $state(false);
let pruneResult = $state<number | null>(null);
let confirmingPruneKeepN = $state(false);
let confirmingPruneOlderThan = $state(false);

// ── Derived timeline ────────────────────────────────────────────
const timelineItems = $derived(buildTimelineItems(snapshots, docEvents));
const groups = $derived(groupByDate(timelineItems, Date.now()));

// Structure rewound to the selected coordinate's timestamp, over the full
// roster (incl. since-deleted nodes), with labels/existence replayed to T.
const previewStructure = $derived.by(() => {
    if (!selectedItem) return { tabs: [], drafts: [] };
    return reconstructStructureAsOf(allTabs, allDrafts, docEvents, coordinateForItem(selectedItem));
});

// What the selected coordinate concerns (for the map highlight + default tab).
const selectedTarget = $derived.by(() => {
    if (!selectedItem) return { tabId: null as string | null, draftId: null as string | null };
    return resolveTimelineTarget(selectedItem, allDrafts);
});

// A short note shown above the content when the coordinate is a structural
// change (the content shown is the viewed tab's state at that same moment).
const bannerText = $derived(
    selectedItem?.kind === "activity"
        ? `${describeDocEvent(selectedItem.event).text} — showing document content at this point`
        : null,
);

// ── Lifecycle ───────────────────────────────────────────────────

/** Ensure currentDraftId is set — needed when navigating directly to /history. */
async function bootstrapDraftId() {
    if (get(currentDraftId)) return;
    const docs = await listDocuments();
    if (docs.length === 0) return;
    if (!get(currentDocumentId)) currentDocumentId.set(docs[0].id);
    const active = await resolveActiveDraftId(docs[0].id);
    if (active) currentDraftId.set(active);
}

onMount(async () => {
    await bootstrapDraftId();
    await Promise.all([loadTimeline(), loadRetention(), refreshStorageSize()]);
    if (timelineItems.length > 0) await selectItem(timelineItems[0]);
    loading = false;
});

// ── Data ────────────────────────────────────────────────────────
async function loadTimeline() {
    const docId = get(currentDocumentId);
    if (!docId) return;
    const [snaps, events, structure] = await Promise.all([
        listDocumentSnapshots(docId),
        listDocEvents(docId),
        listDocumentStructure(docId),
    ]);
    snapshots = snaps;
    docEvents = events;
    allTabs = structure.tabs;
    allDrafts = structure.drafts;
}

async function refreshStorageSize() {
    const draftId = get(currentDraftId);
    if (!draftId) return;
    storageBytes = await getSnapshotStorageSize(draftId);
}

async function loadRetention() {
    snapshotRetention = await getSnapshotRetention();
}

async function handleRetentionChange(e: Event) {
    const raw = (e.target as HTMLSelectElement).value;
    const days = raw === "never" ? null : Number(raw);
    await setSnapshotRetention(days);
    snapshotRetention = days;
}

async function selectItem(item: TimelineItem) {
    selectedItem = item;
    confirmingRestore = false;
    // Default the viewed tab to the coordinate's target tab, else the first tab
    // live at this point. The user can switch tabs in the structure map after.
    // The structure is computed once here and threaded into loadContent so the
    // O(events) replay runs once per selection, not twice.
    const structure = reconstructStructureAsOf(
        allTabs,
        allDrafts,
        docEvents,
        coordinateForItem(item),
    );
    const target = resolveTimelineTarget(item, allDrafts).tabId;
    viewedTabId =
        (target && structure.tabs.some((t) => t.id === target) ? target : null) ??
        structure.tabs[0]?.id ??
        null;
    await loadContent(structure);
}

/** Switch which tab's content the preview shows (same coordinate). */
async function viewTab(tabId: string) {
    if (tabId === viewedTabId) return;
    viewedTabId = tabId;
    await loadContent();
}

/**
 * Loads the viewed tab's content at the selected coordinate and diffs it
 * against the same draft's previous version → track-changes segments. Guarded
 * by `previewToken` so a slow load can't clobber a newer selection. The caller
 * may pass an already-computed structure for the current coordinate to avoid a
 * redundant replay.
 */
async function loadContent(structure?: { tabs: TabMeta[]; drafts: DraftMeta[] }) {
    const item = selectedItem;
    const tabId = viewedTabId;
    if (!item || !tabId) {
        previewCurrentJson = null;
        previewPreviousText = "";
        previewHasContent = false;
        return;
    }
    const token = ++previewToken;
    previewLoading = true;
    try {
        const resolved =
            structure ??
            reconstructStructureAsOf(allTabs, allDrafts, docEvents, coordinateForItem(item));
        const ref = resolveTabContentAt(snapshots, resolved.drafts, tabId, coordinateForItem(item));
        if (!ref.current) {
            if (token === previewToken) {
                previewCurrentJson = null;
                previewPreviousText = "";
                previewHasContent = false;
            }
            return;
        }
        const [currentJson, previousJson] = await Promise.all([
            loadSnapshotState(ref.current.id),
            ref.previous ? loadSnapshotState(ref.previous.id) : Promise.resolve(null),
        ]);
        if (token !== previewToken) return; // a newer selection superseded us
        previewCurrentJson = currentJson;
        previewPreviousText = docTextFromStateJson(previousJson);
        previewHasContent = true;
    } finally {
        if (token === previewToken) previewLoading = false;
    }
}

/**
 * After the timeline reloads (e.g. a prune dropped snapshots, a label changed,
 * or a checkpoint was saved), make sure the selection still points at a real,
 * fresh item: rebind it to the just-loaded object if its id survives, otherwise
 * re-select the newest item, or clear the preview when the timeline is empty.
 * Rebinding matters because `loadTimeline` replaces the snapshot/event arrays
 * with new object identities — keeping the stale `selectedItem` reference would
 * leave the preview/restore acting on pre-reload data.
 */
async function reconcileSelection() {
    const fresh = selectedItem ? timelineItems.find((it) => it.id === selectedItem?.id) : undefined;
    if (fresh) {
        selectedItem = fresh;
        return;
    }
    if (timelineItems.length > 0) {
        await selectItem(timelineItems[0]);
    } else {
        selectedItem = null;
        await loadContent();
    }
}

async function handleRestore() {
    if (!selectedItem) return;
    if (!confirmingRestore) {
        confirmingRestore = true;
        return;
    }
    const docId = get(currentDocumentId);
    if (!docId) return;
    const snapshotId = selectedItem.kind === "snapshot" ? selectedItem.snapshot.id : null;
    const coordinate = coordinateForItem(selectedItem);
    try {
        await restoreToCoordinate(docId, coordinate.createdAt, coordinate.docEventId, snapshotId);
        posthog.capture("version_restored", {
            kind: selectedItem.kind,
            source: "version_history",
        });
    } catch (e) {
        confirmingRestore = false;
        console.error("[VersionHistory] restore failed:", e);
        posthog.captureException(e instanceof Error ? e : new Error(String(e)));
        return;
    }
    goToEditor();
}

async function commitLabel(snapshotId: number, label: string) {
    await labelSnapshot(snapshotId, label);
    await loadTimeline();
    // Rebind selectedItem to the freshly-loaded object (which already carries
    // the new label) so it never points at a stale pre-reload snapshot.
    await reconcileSelection();
}

async function saveCheckpoint() {
    const draftId = get(currentDraftId);
    const view = get(editorView);
    const eventId = get(lastPersistedEventId);
    if (!draftId || !view || eventId < 0 || !checkpointLabel.trim()) return;
    savingCheckpoint = true;
    try {
        const stateJson = JSON.stringify(view.state.toJSON(savedFields));
        await createNamedSnapshot(draftId, stateJson, eventId, checkpointLabel.trim());
        checkpointLabel = "";
        await loadTimeline();
        await reconcileSelection();
        await refreshStorageSize();
    } finally {
        savingCheckpoint = false;
    }
}

// ── Storage pruning ─────────────────────────────────────────────
async function handlePruneKeepN() {
    if (!confirmingPruneKeepN) {
        confirmingPruneKeepN = true;
        confirmingPruneOlderThan = false;
        return;
    }
    const draftId = get(currentDraftId);
    if (!draftId) return;
    pruning = true;
    pruneResult = null;
    try {
        pruneResult = await pruneSnapshotsKeepLastN(draftId, pruneKeepN);
        confirmingPruneKeepN = false;
        await loadTimeline();
        await reconcileSelection();
        await refreshStorageSize();
    } finally {
        pruning = false;
    }
}

async function handlePruneOlderThan() {
    if (!confirmingPruneOlderThan) {
        confirmingPruneOlderThan = true;
        confirmingPruneKeepN = false;
        return;
    }
    const draftId = get(currentDraftId);
    if (!draftId) return;
    pruning = true;
    pruneResult = null;
    try {
        pruneResult = await pruneSnapshotsOlderThan(draftId, pruneOlderThanDays);
        confirmingPruneOlderThan = false;
        await loadTimeline();
        await reconcileSelection();
        await refreshStorageSize();
    } finally {
        pruning = false;
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

// Use the most recent snapshot's createdAt as a fallback when lastSavedAt is
// null (direct nav to /history before any save in this session).
const displayLastSavedAt = $derived(
    $lastSavedAt ?? (snapshots.length > 0 ? snapshots[0].createdAt : null),
);

const selectedTitle = $derived.by(() => {
    if (!selectedItem) return null;
    if (selectedItem.kind === "snapshot") {
        return selectedItem.snapshot.label ?? formatTime(selectedItem.snapshot.createdAt);
    }
    return describeDocEvent(selectedItem.event).text;
});

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        if (checkpointLabel.trim()) {
            checkpointAlerting = true;
            setTimeout(() => {
                checkpointAlerting = false;
            }, 450);
            return;
        }
        goToEditor();
    }
}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="h-screen w-full flex flex-col bg-[#f5f5f0]">
    <!-- Top bar -->
    <div class="flex items-center gap-4 px-5 py-3 bg-white border-b border-black/[0.08] shadow-sm flex-shrink-0">
        <button
            onclick={goToEditor}
            class="flex items-center gap-2 text-sm text-black/60 hover:text-black/90
                   transition-colors px-2 py-1 rounded-md hover:bg-black/5"
        >
            <ArrowLeft size={16} />
            Back
            <Kbd keys={["Esc"]} />
        </button>
        <div class="w-px h-5 bg-black/15"></div>
        <div class="flex-1 flex items-center gap-2">
            <Clock size={15} class="text-black/40" />
            <span class="text-sm font-medium text-black/70">Version History</span>
            {#if selectedTitle}
                <ChevronRight size={14} class="text-black/30" />
                <span class="text-sm text-black/50 truncate max-w-xs">{selectedTitle}</span>
            {/if}
        </div>
        <!-- Save named checkpoint -->
        <div class="flex items-center gap-2">
            {#if displayLastSavedAt}
                <span class="text-xs text-black/35">
                    Last saved {formatTimeShort(displayLastSavedAt)}
                </span>
            {/if}
            <div class="checkpoint-shake-wrapper {checkpointAlerting ? 'checkpoint-shaking' : ''} flex items-center gap-2">
                <input
                    type="text"
                    bind:value={checkpointLabel}
                    placeholder="Name this version…"
                    onkeydown={(e) => e.key === "Enter" && saveCheckpoint()}
                    class="text-sm px-3 py-1.5 rounded-lg border bg-white
                           placeholder:text-black/30 focus:outline-none focus:ring-2
                           focus:ring-blue-400/40 w-48 transition-colors
                           {checkpointAlerting
                               ? 'border-red-400 ring-2 ring-red-300/50'
                               : 'border-black/[0.12]'}"
                />
                <button
                    onclick={saveCheckpoint}
                    disabled={savingCheckpoint || !checkpointLabel.trim() || !$editorView || $lastPersistedEventId < 0}
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                           bg-blue-500 text-white hover:bg-blue-600 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <BookmarkPlus size={13} />
                    Save
                </button>
            </div>
        </div>
        {#if selectedItem}
            <div class="w-px h-5 bg-black/15"></div>
            <button
                onclick={handleRestore}
                class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
                       transition-colors
                       {confirmingRestore
                           ? 'bg-red-500 text-white hover:bg-red-600'
                           : 'bg-black/[0.06] text-black/70 hover:bg-black/[0.10]'}"
            >
                <RotateCcw size={13} />
                {confirmingRestore ? "Confirm restore?" : "Restore to here"}
            </button>
        {/if}
    </div>

    <!-- Body -->
    <div class="flex flex-1 overflow-hidden">
        <!-- Preview (structure map + content) -->
        <div class="flex-1 overflow-y-auto py-10 px-8 flex justify-center">
            <PreviewPane
                tabs={previewStructure.tabs}
                drafts={previewStructure.drafts}
                {viewedTabId}
                highlightDraftId={selectedTarget.draftId}
                currentStateJson={previewCurrentJson}
                previousText={previewPreviousText}
                loading={previewLoading}
                hasContent={previewHasContent}
                {bannerText}
                empty={!selectedItem}
                ontabselect={viewTab}
            />
        </div>

        <!-- Timeline panel -->
        <div id="versions-panel" class="w-72 bg-white border-l border-black/[0.08] flex flex-col overflow-hidden
                    shadow-[-4px_0_12px_-4px_rgba(0,0,0,0.06)]">
            <div class="px-4 pt-3 pb-2 border-b border-black/[0.06] space-y-1.5">
                <div class="flex items-center justify-between">
                    <h2 class="text-sm font-semibold text-black/70">History</h2>
                    {#if storageBytes !== null}
                        <button
                            title="Manage storage"
                            onclick={() => { showStoragePanel = !showStoragePanel; }}
                            class="text-xs px-1.5 py-0.5 rounded transition-colors
                                   {storageBytes >= STORAGE_WARN_BYTES
                                       ? 'text-amber-600 font-medium hover:bg-amber-50'
                                       : 'text-black/35 hover:text-black/60 hover:bg-black/[0.05]'}"
                        >
                            {formatBytes(storageBytes)}
                        </button>
                    {/if}
                </div>

                {#if storageBytes !== null && storageBytes >= STORAGE_WARN_BYTES}
                    <p class="text-xs text-amber-600 leading-snug">
                        Storage is large. Consider pruning old versions.
                    </p>
                {/if}

                {#if showStoragePanel}
                    <div class="border border-black/[0.08] rounded-lg p-3 space-y-2.5 bg-black/[0.015]">
                        <p class="text-xs font-semibold text-black/60">Manage storage</p>

                        <!-- Auto-retention -->
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-xs text-black/45 shrink-0">Auto-prune</span>
                            <select
                                value={snapshotRetention ?? "never"}
                                onchange={handleRetentionChange}
                                class="text-xs text-black/60 bg-black/4 hover:bg-black/[0.07]
                                       rounded-full px-2.5 pr-0 py-1 border-0 cursor-pointer appearance-none
                                       focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors"
                            >
                                <option value="never">Never</option>
                                <option value="30">30 days</option>
                                <option value="60">60 days</option>
                                <option value="90">90 days</option>
                                <option value="180">180 days</option>
                                <option value="365">1 year</option>
                            </select>
                        </div>

                        <!-- Keep last N -->
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-1.5">
                                <span class="text-xs text-black/45 shrink-0">Keep last</span>
                                <input
                                    type="number"
                                    min="0"
                                    bind:value={pruneKeepN}
                                    class="w-14 text-xs px-2 py-0.5 rounded border border-black/[0.12]
                                           bg-white focus:outline-none focus:ring-1 focus:ring-blue-400/50"
                                />
                            </div>
                            <button
                                onclick={handlePruneKeepN}
                                disabled={pruning}
                                class="text-xs px-2.5 py-1 rounded-full transition-colors shrink-0
                                       disabled:opacity-40
                                       {confirmingPruneKeepN
                                           ? 'bg-red-500 text-white hover:bg-red-600'
                                           : 'bg-black/[0.06] text-black/60 hover:bg-black/[0.1]'}"
                            >
                                {confirmingPruneKeepN ? "Confirm?" : "Prune"}
                            </button>
                        </div>

                        <!-- Older than N days -->
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-1.5">
                                <span class="text-xs text-black/45 shrink-0">Older than</span>
                                <input
                                    type="number"
                                    min="1"
                                    bind:value={pruneOlderThanDays}
                                    class="w-14 text-xs px-2 py-0.5 rounded border border-black/[0.12]
                                           bg-white focus:outline-none focus:ring-1 focus:ring-blue-400/50"
                                />
                                <span class="text-xs text-black/35">days</span>
                            </div>
                            <button
                                onclick={handlePruneOlderThan}
                                disabled={pruning}
                                class="text-xs px-2.5 py-1 rounded-full transition-colors shrink-0
                                       disabled:opacity-40
                                       {confirmingPruneOlderThan
                                           ? 'bg-red-500 text-white hover:bg-red-600'
                                           : 'bg-black/[0.06] text-black/60 hover:bg-black/[0.1]'}"
                            >
                                {confirmingPruneOlderThan ? "Confirm?" : "Prune"}
                            </button>
                        </div>

                        {#if pruneResult !== null}
                            <p class="text-[11px] text-green-700">
                                Deleted {pruneResult} snapshot{pruneResult === 1 ? "" : "s"}.
                            </p>
                        {/if}
                    </div>
                {/if}
            </div>

            <div class="flex-1 overflow-y-auto">
                {#if loading}
                    <div class="flex items-center justify-center py-16 text-black/30 text-sm">
                        Loading…
                    </div>
                {:else if timelineItems.length === 0}
                    <div class="flex flex-col items-center justify-center py-16 gap-2 px-6 text-center">
                        <Clock size={28} class="text-black/15" />
                        <p class="text-sm text-black/45">No history yet.</p>
                        <p class="text-xs text-black/30 leading-relaxed">
                            Versions are saved automatically every 50 edits or 2 minutes.
                        </p>
                    </div>
                {:else}
                    <TimelinePanel
                        {groups}
                        selectedId={selectedItem?.id ?? null}
                        onselect={selectItem}
                        onlabel={commitLabel}
                    />
                {/if}
            </div>
        </div>
    </div>
</div>

<style>
    @keyframes checkpoint-shake {
        0%   { transform: translateX(0); }
        10%  { transform: translateX(-5px); }
        25%  { transform: translateX(5px); }
        40%  { transform: translateX(-4px); }
        55%  { transform: translateX(4px); }
        70%  { transform: translateX(-2px); }
        85%  { transform: translateX(2px); }
        100% { transform: translateX(0); }
    }

    .checkpoint-shake-wrapper {
        display: flex;
        align-items: center;
    }

    .checkpoint-shaking {
        animation: checkpoint-shake 0.45s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
    }
</style>
