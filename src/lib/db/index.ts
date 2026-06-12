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
    DocumentMeta,
    DraftMeta,
    LoadResult,
    SearchHit,
    SnapshotMeta,
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
