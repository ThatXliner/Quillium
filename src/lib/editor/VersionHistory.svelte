<script lang="ts">
import {
    createNamedSnapshot,
    getSnapshotRetention,
    getSnapshotStorageSize,
    labelSnapshot,
    listDocEvents,
    listDocuments,
    listSnapshots,
    loadSnapshotState,
    pruneSnapshotsKeepLastN,
    pruneSnapshotsOlderThan,
    resolveActiveDraftId,
    restoreDraft,
    restoreTab,
    restoreToSnapshot,
    setSnapshotRetention,
} from "$lib/db";
import type { DocEventRecord, SnapshotMeta } from "$lib/db/types";
import { getExtensions, savedFields } from "$lib/editor/extensions";
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
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ArrowLeft, BookmarkPlus, ChevronRight, Clock, Pencil, RotateCcw } from "lucide-svelte";
import { onDestroy, onMount } from "svelte";
import { get } from "svelte/store";

// ── State ───────────────────────────────────────────────────────
let snapshots = $state<SnapshotMeta[]>([]);
let loading = $state(true);
let selectedSnapshot = $state<SnapshotMeta | null>(null);
let previewLoading = $state(false);
let confirmingRestoreId = $state<number | null>(null);
let editingLabelId = $state<number | null>(null);
let editingLabelText = $state("");
let checkpointLabel = $state("");
let savingCheckpoint = $state(false);
let checkpointAlerting = $state(false);

// ── Storage management ──────────────────────────────────────────
const STORAGE_WARN_BYTES = 1_073_741_824; // 1 GB
let storageBytes = $state<number | null>(null);
// null = not yet loaded, undefined = disabled
let snapshotRetention = $state<number | null | undefined>(undefined);
let showStoragePanel = $state(false);
let pruneKeepN = $state(50);
let pruneOlderThanDays = $state(90);
let pruning = $state(false);
let pruneResult = $state<number | null>(null);
let confirmingPruneKeepN = $state(false);
let confirmingPruneOlderThan = $state(false);

// Loaded state JSON for the selected snapshot — set async, consumed by $effect
let previewStateJson = $state<string | null>(null);
let previewEl = $state<HTMLDivElement | undefined>();
let previewView: EditorView | undefined;

// Mount/remount the CodeMirror preview whenever the target element or
// the loaded state JSON changes. This avoids any tick() timing dependency —
// Svelte will re-run this effect as soon as previewEl is bound.
$effect(() => {
    if (!previewEl || previewLoading) return;

    previewView?.destroy();

    const extensions = [
        ...getExtensions({ persist: false, history: false }),
        EditorState.readOnly.of(true),
    ];

    let state: EditorState;
    const json = previewStateJson;
    if (json && json !== "{}") {
        try {
            state = EditorState.fromJSON(JSON.parse(json), { extensions }, savedFields);
        } catch {
            state = EditorState.create({ extensions });
        }
    } else {
        state = EditorState.create({ extensions });
    }

    previewView = new EditorView({ state, parent: previewEl });

    return () => {
        previewView?.destroy();
    };
});

// ── Lifecycle ───────────────────────────────────────────────────

/** Ensure currentDraftId is set — needed when navigating directly to /history. */
async function bootstrapDraftId() {
    if (get(currentDraftId)) return;
    const docs = await listDocuments();
    if (docs.length === 0) return; // No document yet — show empty state.
    if (!get(currentDocumentId)) currentDocumentId.set(docs[0].id);
    const active = await resolveActiveDraftId(docs[0].id);
    if (active) currentDraftId.set(active);
}

onMount(async () => {
    await bootstrapDraftId();
    await Promise.all([loadSnapshots(), loadRetention(), loadDocEventsList()]);
    if (snapshots.length > 0) {
        await selectSnapshot(snapshots[0]);
    }
});

// ── Document activity (structural audit log, #160) ──────────────
let docEvents = $state<DocEventRecord[]>([]);

async function loadDocEventsList() {
    const docId = get(currentDocumentId);
    if (!docId) return;
    docEvents = await listDocEvents(docId);
}

type DocEventInfo = { text: string; restore: { kind: "tab" | "draft"; id: string } | null };

function describeDocEvent(ev: DocEventRecord): DocEventInfo {
    let p: Record<string, unknown> = {};
    try {
        p = JSON.parse(ev.payload) as Record<string, unknown>;
    } catch {
        // Malformed payload — fall through to the raw event type.
    }
    const label = typeof p.label === "string" ? p.label : "";
    const prev = typeof p.previousLabel === "string" ? p.previousLabel : "";
    const tabId = typeof p.tabId === "string" ? p.tabId : null;
    const draftId = typeof p.draftId === "string" ? p.draftId : null;
    switch (ev.eventType) {
        case "tab_created":
            return { text: `Created tab “${label}”`, restore: null };
        case "tab_renamed":
            return { text: `Renamed tab “${prev}” to “${label}”`, restore: null };
        case "tab_deleted":
            return {
                text: `Deleted tab “${label}”`,
                restore: tabId ? { kind: "tab", id: tabId } : null,
            };
        case "tab_restored":
            return { text: `Restored tab “${label}”`, restore: null };
        case "draft_forked":
            return { text: `Branched draft “${label}”`, restore: null };
        case "draft_created":
            return { text: `Created draft “${label}”`, restore: null };
        case "draft_renamed":
            return { text: `Renamed draft “${prev}” to “${label}”`, restore: null };
        case "draft_deleted":
            return {
                text: `Deleted draft “${label}”`,
                restore: draftId ? { kind: "draft", id: draftId } : null,
            };
        case "draft_restored":
            return { text: `Restored draft “${label}”`, restore: null };
        case "draft_locked":
            return { text: `Locked draft “${label}”`, restore: null };
        case "draft_unlocked":
            return { text: `Unlocked draft “${label}”`, restore: null };
        case "checkpoint_created": {
            const draftLabel = typeof p.draftLabel === "string" ? p.draftLabel : "";
            return {
                text: `Saved checkpoint “${label}” on draft “${draftLabel}”`,
                restore: null,
            };
        }
        default:
            return { text: ev.eventType, restore: null };
    }
}

// Which tabs/drafts are deleted right now: for each target, the newest
// delete/restore event wins (docEvents arrive newest-first).
const deletionState = $derived.by(() => {
    const state = new Map<string, boolean>();
    for (const ev of docEvents) {
        const deleted =
            ev.eventType === "tab_deleted" || ev.eventType === "draft_deleted"
                ? true
                : ev.eventType === "tab_restored" || ev.eventType === "draft_restored"
                  ? false
                  : null;
        if (deleted === null) continue;
        let p: Record<string, unknown> = {};
        try {
            p = JSON.parse(ev.payload) as Record<string, unknown>;
        } catch {
            continue;
        }
        const id = ev.eventType.startsWith("tab_") ? p.tabId : p.draftId;
        if (typeof id !== "string") continue;
        const key = `${ev.eventType.startsWith("tab_") ? "tab" : "draft"}:${id}`;
        if (!state.has(key)) state.set(key, deleted);
    }
    return state;
});

async function handleStructuralRestore(restore: { kind: "tab" | "draft"; id: string }) {
    try {
        if (restore.kind === "tab") {
            await restoreTab(restore.id);
        } else {
            await restoreDraft(restore.id);
        }
        posthog.capture(restore.kind === "tab" ? "tab_restored" : "draft_restored", {
            source: "version_history",
        });
    } catch (e) {
        console.error("[VersionHistory] restore failed:", e);
        return;
    }
    await loadDocEventsList();
}

onDestroy(() => {
    previewView?.destroy();
});

// ── Data ────────────────────────────────────────────────────────
async function refreshStorageSize() {
    const draftId = get(currentDraftId);
    if (!draftId) return;
    storageBytes = await getSnapshotStorageSize(draftId);
}

async function loadSnapshots() {
    loading = true;
    const draftId = get(currentDraftId);
    if (!draftId) {
        loading = false;
        return;
    }
    try {
        snapshots = await listSnapshots(draftId);
        await refreshStorageSize();
        // Reconcile selection: if selected snapshot no longer exists, pick the most recent.
        if (selectedSnapshot !== null) {
            const stillExists = snapshots.find((s) => s.id === selectedSnapshot!.id);
            if (!stillExists) {
                selectedSnapshot = snapshots.length > 0 ? snapshots[0] : null;
                if (selectedSnapshot) await selectSnapshot(selectedSnapshot);
            }
        }
    } finally {
        loading = false;
    }
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

async function selectSnapshot(snapshot: SnapshotMeta) {
    selectedSnapshot = snapshot;
    confirmingRestoreId = null;
    previewLoading = true;
    previewStateJson = null;

    try {
        const stateJson = await loadSnapshotState(snapshot.id);
        if (stateJson != null) {
            previewStateJson = stateJson;
        }
    } finally {
        previewLoading = false;
    }
    // $effect re-runs automatically once previewEl is in the DOM and
    // previewStateJson/previewLoading have settled — no tick() needed.
}

async function handleRestore() {
    if (!selectedSnapshot) return;
    if (confirmingRestoreId !== selectedSnapshot.id) {
        confirmingRestoreId = selectedSnapshot.id;
        return;
    }
    const draftId = get(currentDraftId);
    if (!draftId) return;
    try {
        await restoreToSnapshot(draftId, selectedSnapshot.id);
    } catch (e) {
        confirmingRestoreId = null;
        console.error("Restore failed:", e);
        posthog.captureException(e instanceof Error ? e : new Error(String(e)));
        return;
    }
    goToEditor();
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
        await loadSnapshots();
    } finally {
        savingCheckpoint = false;
    }
}

async function commitLabelEdit(snapshot: SnapshotMeta) {
    if (editingLabelText.trim()) {
        await labelSnapshot(snapshot.id, editingLabelText.trim());
        await loadSnapshots();
        if (selectedSnapshot?.id === snapshot.id) {
            selectedSnapshot = { ...selectedSnapshot, label: editingLabelText.trim() };
        }
    }
    editingLabelId = null;
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
        const deleted = await pruneSnapshotsKeepLastN(draftId, pruneKeepN);
        pruneResult = deleted;
        confirmingPruneKeepN = false;
        await loadSnapshots();
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
        const deleted = await pruneSnapshotsOlderThan(draftId, pruneOlderThanDays);
        pruneResult = deleted;
        confirmingPruneOlderThan = false;
        await loadSnapshots();
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

// ── Unified timeline grouping ───────────────────────────────────
type TimelineItem =
    | { id: string; kind: "snapshot"; createdAt: number; snapshot: SnapshotMeta }
    | { id: string; kind: "activity"; createdAt: number; event: DocEventRecord };

type TimelineGroup = { heading: string; items: TimelineItem[] };

function groupByDate(items: TimelineItem[]): TimelineGroup[] {
    const groups: TimelineGroup[] = [];
    let lastHeading = "";
    for (const item of items) {
        const heading = headingForDate(item.createdAt);
        if (heading !== lastHeading) {
            groups.push({ heading, items: [] });
            lastHeading = heading;
        }
        groups[groups.length - 1].items.push(item);
    }
    return groups;
}

function headingForDate(ms: number): string {
    const d = new Date(ms);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear())
        return "This month";
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatTime(ms: number): string {
    const d = new Date(ms);
    return (
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        ", " +
        d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    );
}

function formatTimeShort(ms: number): string {
    return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const timelineItems = $derived.by(() => {
    const items: TimelineItem[] = [
        ...snapshots.map((snapshot) => ({
            id: `snapshot:${snapshot.id}`,
            kind: "snapshot" as const,
            createdAt: snapshot.createdAt,
            snapshot,
        })),
        ...docEvents.map((event) => ({
            id: `activity:${event.id}`,
            kind: "activity" as const,
            createdAt: event.createdAt,
            event,
        })),
    ];
    return items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
});

const groups = $derived(groupByDate(timelineItems));

// Use the most recent snapshot's createdAt as a fallback when lastSavedAt
// is null (direct nav to /history before any save in this session).
const displayLastSavedAt = $derived(
    $lastSavedAt ?? (snapshots.length > 0 ? snapshots[0].createdAt : null),
);

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

<div class="h-screen w-full flex flex-col bg-[color:var(--bg)]">
    <!-- Top bar -->
    <div class="flex items-center gap-4 px-5 py-3 bg-[color:var(--surface)] border-b border-[color:var(--border)] shadow-sm flex-shrink-0">
        <button
            onclick={goToEditor}
            class="flex items-center gap-2 text-sm text-[color:var(--text-soft)] hover:text-[color:var(--text-strong)]
                   transition-colors px-2 py-1 rounded-md hover:bg-[color:var(--surface-2)]"
        >
            <ArrowLeft size={16} />
            Back
            <Kbd keys={["Esc"]} />
        </button>
        <div class="w-px h-5 bg-[color:var(--border-strong)]"></div>
        <div class="flex-1 flex items-center gap-2">
            <Clock size={15} class="text-[color:var(--text-faint)]" />
            <span class="text-sm font-medium text-[color:var(--text)]">Version History</span>
            {#if selectedSnapshot}
                <ChevronRight size={14} class="text-[color:var(--text-ghost)]" />
                <span class="text-sm text-[color:var(--text-soft)]">
                    {selectedSnapshot.label ?? formatTime(selectedSnapshot.createdAt)}
                </span>
            {/if}
        </div>
        <!-- Save named checkpoint -->
        <div class="flex items-center gap-2">
            {#if displayLastSavedAt}
                <span class="text-xs text-[color:var(--text-faint)]">
                    Last saved {formatTimeShort(displayLastSavedAt)}
                </span>
            {/if}
            <div class="checkpoint-shake-wrapper {checkpointAlerting ? 'checkpoint-shaking' : ''} flex items-center gap-2">
                <input
                    type="text"
                    bind:value={checkpointLabel}
                    placeholder="Name this version…"
                    onkeydown={(e) => e.key === "Enter" && saveCheckpoint()}
                    class="text-sm px-3 py-1.5 rounded-lg border bg-[color:var(--surface)] text-[color:var(--text)]
                           placeholder:text-[color:var(--text-ghost)] focus:outline-none focus:ring-2
                           focus:ring-blue-400/40 w-48 transition-colors
                           {checkpointAlerting
                               ? 'border-red-400 ring-2 ring-red-300/50'
                               : 'border-[color:var(--border)]'}"
                />
                <button
                    onclick={saveCheckpoint}
                    disabled={savingCheckpoint || !checkpointLabel.trim() || !$editorView || $lastPersistedEventId < 0}
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                           bg-[color:var(--chip-blue)] text-[color:var(--accent-blue-text)] hover:bg-[color:var(--chip-blue-strong)] transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <BookmarkPlus size={13} />
                    Save
                </button>
            </div>
        </div>
        {#if selectedSnapshot}
            <div class="w-px h-5 bg-[color:var(--border-strong)]"></div>
            <button
                onclick={handleRestore}
                class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
                       transition-colors
                       {confirmingRestoreId === selectedSnapshot.id
                           ? 'bg-red-500 text-white hover:bg-red-600'
                           : 'bg-[color:var(--surface-2)] text-[color:var(--text)] hover:bg-[color:var(--surface-3)]'}"
            >
                <RotateCcw size={13} />
                {confirmingRestoreId === selectedSnapshot.id ? "Confirm restore?" : "Restore this version"}
            </button>
        {/if}
    </div>

    <!-- Body -->
    <div class="flex flex-1 overflow-hidden">

        <!-- Document preview -->
        <div class="flex-1 overflow-y-auto py-10 px-8 flex justify-center">
            {#if previewLoading}
                <div class="flex items-center justify-center w-full text-[color:var(--text-ghost)] text-sm">
                    Loading…
                </div>
            {:else if !selectedSnapshot}
                <div class="flex flex-col items-center justify-center w-full gap-3 text-center">
                    <Clock size={36} class="text-[color:var(--text-ghost)]" />
                    <p class="text-sm text-[color:var(--text-faint)]">Select a version to preview it</p>
                </div>
            {:else}
                <div
                    class="version-preview w-[816px] min-h-full bg-[color:var(--surface)] rounded-lg shadow-xl
                           py-3 px-1 pointer-events-none select-none"
                    bind:this={previewEl}
                ></div>
            {/if}
        </div>

        <!-- Timeline panel -->
        <div id="versions-panel" class="w-72 bg-[color:var(--surface)] border-l border-[color:var(--border)] flex flex-col overflow-hidden
                    shadow-[-4px_0_12px_-4px_rgba(var(--shadow-color),0.06)]">
            <div class="px-4 pt-3 pb-2 border-b border-[color:var(--border)] space-y-1.5">
                <div class="flex items-center justify-between">
                    <h2 class="text-sm font-semibold text-[color:var(--text)]">History</h2>
                    {#if storageBytes !== null}
                        <button
                            title="Manage storage"
                            onclick={() => { showStoragePanel = !showStoragePanel; }}
                            class="text-xs px-1.5 py-0.5 rounded transition-colors
                                   {storageBytes >= STORAGE_WARN_BYTES
                                       ? 'text-amber-600 font-medium hover:bg-amber-50'
                                       : 'text-[color:var(--text-faint)] hover:text-[color:var(--text-soft)] hover:bg-[color:var(--surface-2)]'}"
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
                    <div class="border border-[color:var(--border)] rounded-lg p-3 space-y-2.5 bg-[color:var(--surface-2)]">
                        <p class="text-xs font-semibold text-[color:var(--text-soft)]">Manage storage</p>

                        <!-- Auto-retention -->
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-xs text-[color:var(--text-faint)] shrink-0">Auto-prune</span>
                            <select
                                value={snapshotRetention ?? "never"}
                                onchange={handleRetentionChange}
                                class="text-xs text-[color:var(--text-soft)] bg-[color:var(--surface-3)] hover:bg-[color:var(--surface-3)]
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
                                <span class="text-xs text-[color:var(--text-faint)] shrink-0">Keep last</span>
                                <input
                                    type="number"
                                    min="0"
                                    bind:value={pruneKeepN}
                                    class="w-14 text-xs px-2 py-0.5 rounded border border-[color:var(--border)]
                                           bg-[color:var(--surface)] text-[color:var(--text)] focus:outline-none focus:ring-1 focus:ring-blue-400/50"
                                />
                            </div>
                            <button
                                onclick={handlePruneKeepN}
                                disabled={pruning}
                                class="text-xs px-2.5 py-1 rounded-full transition-colors shrink-0
                                       disabled:opacity-40
                                       {confirmingPruneKeepN
                                           ? 'bg-red-500 text-white hover:bg-red-600'
                                           : 'bg-[color:var(--surface-2)] text-[color:var(--text-soft)] hover:bg-[color:var(--surface-3)]'}"
                            >
                                {confirmingPruneKeepN ? "Confirm?" : "Prune"}
                            </button>
                        </div>

                        <!-- Older than N days -->
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-1.5">
                                <span class="text-xs text-[color:var(--text-faint)] shrink-0">Older than</span>
                                <input
                                    type="number"
                                    min="1"
                                    bind:value={pruneOlderThanDays}
                                    class="w-14 text-xs px-2 py-0.5 rounded border border-[color:var(--border)]
                                           bg-[color:var(--surface)] text-[color:var(--text)] focus:outline-none focus:ring-1 focus:ring-blue-400/50"
                                />
                                <span class="text-xs text-[color:var(--text-faint)]">days</span>
                            </div>
                            <button
                                onclick={handlePruneOlderThan}
                                disabled={pruning}
                                class="text-xs px-2.5 py-1 rounded-full transition-colors shrink-0
                                       disabled:opacity-40
                                       {confirmingPruneOlderThan
                                           ? 'bg-red-500 text-white hover:bg-red-600'
                                           : 'bg-[color:var(--surface-2)] text-[color:var(--text-soft)] hover:bg-[color:var(--surface-3)]'}"
                            >
                                {confirmingPruneOlderThan ? "Confirm?" : "Prune"}
                            </button>
                        </div>

                        {#if pruneResult !== null}
                            <p class="text-[11px] text-[color:var(--accent-green-text)]">
                                Deleted {pruneResult} snapshot{pruneResult === 1 ? "" : "s"}.
                            </p>
                        {/if}
                    </div>
                {/if}
            </div>

            <div class="flex-1 overflow-y-auto">
                {#if loading}
                    <div class="flex items-center justify-center py-16 text-[color:var(--text-ghost)] text-sm">
                        Loading…
                    </div>
                {:else if timelineItems.length === 0}
                    <div class="flex flex-col items-center justify-center py-16 gap-2 px-6 text-center">
                        <Clock size={28} class="text-[color:var(--text-ghost)]" />
                        <p class="text-sm text-[color:var(--text-faint)]">No history yet.</p>
                        <p class="text-xs text-[color:var(--text-ghost)] leading-relaxed">
                            Versions are saved automatically every 50 edits or 2 minutes.
                        </p>
                    </div>
                {:else}
                    <div role="list" aria-label="History timeline">
                    {#each groups as group}
                        <div class="px-4 pt-4 pb-1">
                            <span class="text-[11px] font-semibold text-[color:var(--text-faint)] uppercase tracking-wide">
                                {group.heading}
                            </span>
                        </div>
                        {#each group.items as item (item.id)}
                            {#if item.kind === "snapshot"}
                                {@const snapshot = item.snapshot}
                                {@const isSelected = selectedSnapshot?.id === snapshot.id}
                                <div
                                    role="option"
                                    tabindex="0"
                                    aria-selected={isSelected}
                                    onclick={() => selectSnapshot(snapshot)}
                                    onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSnapshot(snapshot); } }}
                                    class="w-full text-left px-4 py-2.5 flex items-start gap-3
                                           cursor-pointer transition-colors
                                           {isSelected
                                               ? 'bg-[color:var(--surface-3)] border-r-2 border-blue-500'
                                               : 'hover:bg-[color:var(--surface-2)] border-r-2 border-transparent'}"
                                >
                                    <div class="mt-1.5 w-2 h-2 rounded-full flex-shrink-0
                                                {snapshot.label ? 'bg-blue-500' : 'bg-[color:var(--text-ghost)]'}">
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        {#if editingLabelId === snapshot.id}
                                            <input
                                                type="text"
                                                bind:value={editingLabelText}
                                                autofocus
                                                onclick={(e) => e.stopPropagation()}
                                                onblur={() => commitLabelEdit(snapshot)}
                                                onkeydown={(e) => {
                                                    e.stopPropagation();
                                                    if (e.key === "Enter") commitLabelEdit(snapshot);
                                                    if (e.key === "Escape") editingLabelId = null;
                                                }}
                                                class="text-sm font-medium text-blue-600 bg-blue-50
                                                       border border-blue-300 rounded px-1.5 py-0.5
                                                       focus:outline-none w-full"
                                            />
                                        {:else if snapshot.label}
                                            <div class="flex items-center gap-1">
                                                <span class="text-sm font-medium text-blue-600 truncate">
                                                    {snapshot.label}
                                                </span>
                                                <button
                                                    aria-label="Edit label"
                                                    onclick={(e) => {
                                                        e.stopPropagation();
                                                        editingLabelId = snapshot.id;
                                                        editingLabelText = snapshot.label ?? "";
                                                    }}
                                                    class="text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)]
                                                           transition-colors flex-shrink-0"
                                                >
                                                    <Pencil size={10} />
                                                </button>
                                            </div>
                                        {:else}
                                            <div class="flex items-center gap-1">
                                                <span class="text-xs text-[color:var(--text-soft)]">
                                                    {formatTimeShort(snapshot.createdAt)}
                                                </span>
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation();
                                                        editingLabelId = snapshot.id;
                                                        editingLabelText = "";
                                                    }}
                                                    title="Add label"
                                                    aria-label="Add label"
                                                    class="text-[color:var(--text-ghost)] hover:text-[color:var(--text-soft)]
                                                           transition-colors flex-shrink-0"
                                                >
                                                    <Pencil size={10} />
                                                </button>
                                            </div>
                                        {/if}
                                        {#if snapshot.label}
                                            <p class="text-[11px] text-[color:var(--text-faint)] mt-0.5">Named checkpoint</p>
                                        {:else}
                                            <p class="text-[11px] text-[color:var(--text-faint)] mt-0.5">Auto-saved</p>
                                        {/if}
                                    </div>
                                </div>
                            {:else}
                                {@const ev = item.event}
                                {@const info = describeDocEvent(ev)}
                                {@const restore = info.restore}
                                <div class="w-full text-left px-4 py-2.5 flex items-start gap-3 border-r-2 border-transparent">
                                    <div class="mt-1.5 w-2 h-2 rounded-full bg-[color:var(--text-ghost)] flex-shrink-0"></div>
                                    <div class="flex-1 min-w-0">
                                        <p class="text-xs text-[color:var(--text-soft)] leading-snug">{info.text}</p>
                                        <p class="text-[10px] text-[color:var(--text-ghost)] mt-0.5">{formatTime(ev.createdAt)}</p>
                                    </div>
                                    {#if restore && deletionState.get(`${restore.kind}:${restore.id}`)}
                                        <button
                                            onclick={() => handleStructuralRestore(restore)}
                                            class="shrink-0 flex items-center gap-1 text-[11px] font-medium
                                                   text-blue-600 hover:text-blue-700 transition-colors"
                                        >
                                            <RotateCcw size={10} />
                                            Restore
                                        </button>
                                    {/if}
                                </div>
                            {/if}
                        {/each}
                    {/each}
                    </div>
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

    :global(.version-preview .cm-editor) {
        pointer-events: none;
    }
    :global(.version-preview .cm-cursor) {
        display: none !important;
    }
</style>
