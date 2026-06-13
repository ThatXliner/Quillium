/**
 * db/index.ts — Database access layer (invoke wrappers).
 *
 * All SQLite operations run in Rust via Tauri commands.
 * This module provides typed TypeScript wrappers around
 * `invoke()` calls so the rest of the app never imports
 * @tauri-apps/plugin-sql directly.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
    AppendEventResult,
    DocEventRecord,
    DocumentMeta,
    DraftMeta,
    LoadResult,
    SearchHit,
    SnapshotMeta,
    TabMeta,
} from "./types";

// ── Reset ─────────────────────────────────────────────────────────

/**
 * Wipes all user data (documents, drafts, events, snapshots) and
 * re-initialises the schema. Only used by the dev debug panel.
 */
export async function resetDb(): Promise<void> {
    return invoke<void>("cmd_reset_db");
}

// ── Documents ─────────────────────────────────────────────────────

export async function listDocuments(): Promise<DocumentMeta[]> {
    return invoke<DocumentMeta[]>("cmd_list_documents");
}

export async function getDocumentMeta(id: string): Promise<DocumentMeta | null> {
    return invoke<DocumentMeta | null>("cmd_get_document", { id });
}

export async function createDocument(title = "Untitled"): Promise<string> {
    return invoke<string>("cmd_create_document", { title });
}

/**
 * `bodyText` is the full plain document text, used to keep the search index
 * current. Omit it for metadata-only updates (rename, tags) — the previously
 * indexed body is preserved.
 */
export async function updateDocumentMeta(
    id: string,
    title: string,
    wordCount: number,
    previewText: string,
    tags: string,
    bodyText?: string,
): Promise<void> {
    return invoke<void>("cmd_update_document_meta", {
        id,
        title,
        wordCount,
        previewText,
        tags,
        bodyText,
    });
}

/**
 * Hybrid search across all non-trashed documents: FTS5 keyword matching
 * fused with on-device semantic (embedding) matching. Results are ranked
 * best-first and include a match snippet.
 */
export async function searchDocuments(query: string): Promise<SearchHit[]> {
    return invoke<SearchHit[]>("cmd_search_documents", { query });
}

/**
 * Semantic index status: "disabled" | "starting" | "loading-model" |
 * "indexing" | "ready" | "unavailable" | "error: …". Keyword search works
 * regardless.
 */
export async function getSearchStatus(): Promise<string> {
    return invoke<string>("cmd_search_status");
}

/** Whether the semantic index is still coming up (model download / initial indexing). */
export function isSearchStatusPreparing(status: string): boolean {
    return status === "starting" || status === "loading-model" || status === "indexing";
}

/**
 * Polls the semantic index status until it settles (any non-preparing
 * status), reporting each reading via `onStatus`. If the status command
 * fails, reports `null` once and stops. Returns a cancel function — call it
 * on component teardown.
 */
export function pollSearchStatus(
    onStatus: (status: string | null) => void,
    intervalMs = 2000,
): () => void {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
        let status: string;
        try {
            status = await getSearchStatus();
        } catch {
            if (!cancelled) onStatus(null);
            return;
        }
        if (cancelled) return;
        onStatus(status);
        if (isSearchStatusPreparing(status)) {
            timer = setTimeout(poll, intervalMs);
        }
    };
    poll();
    return () => {
        cancelled = true;
        clearTimeout(timer);
    };
}

/** Whether the user opted in to semantic search (Settings toggle). */
export async function getSemanticSearchEnabled(): Promise<boolean> {
    return invoke<boolean>("cmd_get_semantic_search_enabled");
}

/**
 * Persists the semantic-search opt-in and starts/stops the index worker.
 * First enable downloads the embedding model (~30 MB) in the background.
 */
export async function setSemanticSearchEnabled(enabled: boolean): Promise<void> {
    return invoke<void>("cmd_set_semantic_search_enabled", { enabled });
}

/** Drops the model from memory and deletes its on-disk cache (~30 MB). Also persists the opt-out. */
export async function uninstallSemanticModel(): Promise<void> {
    return invoke<void>("cmd_uninstall_semantic_model");
}

export async function deleteDocument(id: string): Promise<void> {
    return invoke<void>("cmd_delete_document", { id });
}

export async function trashDocument(id: string): Promise<void> {
    return invoke<void>("cmd_trash_document", { id });
}

export async function restoreDocument(id: string): Promise<void> {
    return invoke<void>("cmd_restore_document", { id });
}

export async function listTrashedDocuments(): Promise<DocumentMeta[]> {
    return invoke<DocumentMeta[]>("cmd_list_trashed_documents");
}

/** Returns the trash auto-empty period in days, or null if disabled. */
export async function getTrashRetention(): Promise<number | null> {
    return invoke<number | null>("cmd_get_trash_retention");
}

/** Saves the trash auto-empty setting. Pass null to disable auto-empty. */
export async function setTrashRetention(days: number | null): Promise<void> {
    return invoke<void>("cmd_set_trash_retention", { days });
}

/**
 * Purges trashed documents older than the configured retention period.
 * Returns the number of permanently deleted documents.
 */
export async function purgeExpiredTrash(): Promise<number> {
    return invoke<number>("cmd_purge_expired_trash");
}

// ── Drafts ────────────────────────────────────────────────────────

export async function listDrafts(docId: string): Promise<DraftMeta[]> {
    return invoke<DraftMeta[]>("cmd_list_drafts", { docId });
}

export async function createDraft(docId: string, label: string): Promise<string> {
    return invoke<string>("cmd_create_draft", { docId, label });
}

// ── Tabs (#160: document tabs) ────────────────────────────────────

export async function listTabs(docId: string): Promise<TabMeta[]> {
    return invoke<TabMeta[]>("cmd_list_tabs", { docId });
}

/** Creates a tab plus its root "main" draft atomically. */
export async function createTab(docId: string, label: string): Promise<TabMeta> {
    return invoke<TabMeta>("cmd_create_tab", { docId, label });
}

export async function renameTab(tabId: string, label: string): Promise<void> {
    return invoke<void>("cmd_rename_tab", { tabId, label });
}

/** Soft-deletes a tab (restorable). Rejects on the document's last tab. */
export async function deleteTab(tabId: string): Promise<void> {
    return invoke<void>("cmd_delete_tab", { tabId });
}

/** Restores a soft-deleted tab with all its drafts intact. */
export async function restoreTab(tabId: string): Promise<void> {
    return invoke<void>("cmd_restore_tab", { tabId });
}

/** Document-level structural audit log, newest first. */
export async function listDocEvents(docId: string): Promise<DocEventRecord[]> {
    return invoke<DocEventRecord[]>("cmd_list_doc_events", { docId });
}

export async function getActiveTab(docId: string): Promise<string | null> {
    return invoke<string | null>("cmd_get_active_tab", { docId });
}

export async function setActiveTab(docId: string, tabId: string): Promise<void> {
    return invoke<void>("cmd_set_active_tab", { docId, tabId });
}

// ── Draft tree (#160: draft branching) ────────────────────────────

export async function listTabDrafts(tabId: string): Promise<DraftMeta[]> {
    return invoke<DraftMeta[]>("cmd_list_tab_drafts", { tabId });
}

/**
 * Iterate: the next version of `sourceDraftId` in its flat run, seeded with
 * `stateJson`. The run relocks so only the new tip is editable; superseded
 * iterations lock automatically.
 */
export async function iterateDraft(
    sourceDraftId: string,
    label: string,
    stateJson: string | null,
): Promise<DraftMeta> {
    return invoke<DraftMeta>("cmd_iterate_draft", { sourceDraftId, label, stateJson });
}

/**
 * Branch: a different take off `sourceDraftId`, seeded with `stateJson`,
 * starting its own run (rendered indented). Nothing locks. Rejected on a
 * run head (main / branch root) — a top-level take is a new tab.
 */
export async function branchDraft(
    sourceDraftId: string,
    label: string,
    stateJson: string | null,
): Promise<DraftMeta> {
    return invoke<DraftMeta>("cmd_branch_draft", { sourceDraftId, label, stateJson });
}

export async function renameDraft(draftId: string, label: string): Promise<void> {
    return invoke<void>("cmd_rename_draft", { draftId, label });
}

export async function setDraftLocked(draftId: string, locked: boolean): Promise<void> {
    return invoke<void>("cmd_set_draft_locked", { draftId, locked });
}

/** Soft-deletes a leaf draft (restorable). Rejects if it has iterations/branches or is the tab's last draft. */
export async function deleteDraft(draftId: string): Promise<void> {
    return invoke<void>("cmd_delete_draft", { draftId });
}

/** Restores a soft-deleted draft; its run relocks. */
export async function restoreDraft(draftId: string): Promise<void> {
    return invoke<void>("cmd_restore_draft", { draftId });
}

export async function getActiveDraft(tabId: string): Promise<string | null> {
    return invoke<string | null>("cmd_get_active_draft", { tabId });
}

/**
 * Resolves the draft a bare document open should show: the active tab's
 * active draft (mirrors the Rust-side resolution in load.rs). Falls back
 * to the legacy first-active-draft lookup for pre-migration documents.
 */
export async function resolveActiveDraftId(docId: string): Promise<string | null> {
    const tabList = await listTabs(docId);
    if (tabList.length > 0) {
        const persistedTab = await getActiveTab(docId);
        const tab = tabList.find((t) => t.id === persistedTab) ?? tabList[0];
        const drafts = await listTabDrafts(tab.id);
        if (drafts.length > 0) {
            const persistedDraft = await getActiveDraft(tab.id);
            return (drafts.find((d) => d.id === persistedDraft) ?? drafts[0]).id;
        }
    }
    const drafts = await listDrafts(docId);
    return (drafts.find((d) => d.isActive) ?? drafts[0])?.id ?? null;
}

export async function setActiveDraft(tabId: string, draftId: string): Promise<void> {
    return invoke<void>("cmd_set_active_draft", { tabId, draftId });
}

// ── Events & snapshots ────────────────────────────────────────────

export async function appendEvent(
    draftId: string,
    payloadJson: string,
): Promise<AppendEventResult> {
    return invoke<AppendEventResult>("cmd_append_event", { draftId, payloadJson });
}

export async function createSnapshot(
    draftId: string,
    stateJson: string,
    upToEventId: number,
): Promise<void> {
    return invoke<void>("cmd_create_snapshot", { draftId, stateJson, upToEventId });
}

export async function loadDocumentState(
    docId: string,
    draftId?: string | null,
): Promise<LoadResult> {
    return invoke<LoadResult>("cmd_load_document_state", {
        docId,
        draftId: draftId ?? null,
    });
}

// ── Version history ───────────────────────────────────────────────

export async function listSnapshots(draftId: string): Promise<SnapshotMeta[]> {
    return invoke<SnapshotMeta[]>("cmd_list_snapshots", { draftId });
}

/** Returns the state_json blob for a specific snapshot, or null if not found. */
export async function loadSnapshotState(snapshotId: number): Promise<string | null> {
    return invoke<string | null>("cmd_load_snapshot_state", { snapshotId });
}

export async function labelSnapshot(snapshotId: number, label: string): Promise<void> {
    return invoke<void>("cmd_label_snapshot", { snapshotId, label });
}

export async function restoreToSnapshot(draftId: string, snapshotId: number): Promise<void> {
    return invoke<void>("cmd_restore_to_snapshot", { draftId, snapshotId });
}

/** Returns the auto-prune retention in days, or null if disabled. */
export async function getSnapshotRetention(): Promise<number | null> {
    return invoke<number | null>("cmd_get_snapshot_retention");
}

/** Saves the snapshot auto-prune retention. Pass null to disable. */
export async function setSnapshotRetention(days: number | null): Promise<void> {
    return invoke<void>("cmd_set_snapshot_retention", { days });
}

/** Returns total bytes of state_json for all snapshots of a draft. */
export async function getSnapshotStorageSize(draftId: string): Promise<number> {
    return invoke<number>("cmd_get_snapshot_storage_size", { draftId });
}

/** Deletes unlabeled autosaves beyond the most recent keepN. Returns deleted count. */
export async function pruneSnapshotsKeepLastN(draftId: string, keepN: number): Promise<number> {
    return invoke<number>("cmd_prune_snapshots_keep_last_n", { draftId, keepN });
}

/** Deletes unlabeled autosaves older than olderThanDays days. Returns deleted count. */
export async function pruneSnapshotsOlderThan(
    draftId: string,
    olderThanDays: number,
): Promise<number> {
    return invoke<number>("cmd_prune_snapshots_older_than", { draftId, olderThanDays });
}

export async function createNamedSnapshot(
    draftId: string,
    stateJson: string,
    upToEventId: number,
    label: string,
): Promise<number> {
    return invoke<number>("cmd_create_named_snapshot", {
        draftId,
        stateJson,
        upToEventId,
        label,
    });
}

// ── Multi-window ─────────────────────────────────────────────────

export async function openInNewWindow(docId: string): Promise<void> {
    return invoke<void>("cmd_open_in_new_window", { docId });
}

export async function registerOpenDoc(docId: string, windowLabel: string): Promise<void> {
    return invoke<void>("cmd_register_open_doc", { docId, windowLabel });
}

export async function deregisterOpenDoc(windowLabel: string): Promise<void> {
    return invoke<void>("cmd_deregister_open_doc", { windowLabel });
}

export async function isDocOpenElsewhere(docId: string, windowLabel: string): Promise<boolean> {
    return invoke<boolean>("cmd_is_doc_open_elsewhere", { docId, windowLabel });
}
