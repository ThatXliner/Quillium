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
    MigrationResult,
} from "./types";

// ── Initialisation ────────────────────────────────────────────────

/**
 * Runs the one-time migration from the legacy state.json file.
 * Schema initialisation happens in Rust setup() before any
 * commands are invoked, so this only needs to handle migration.
 */
export async function initDb(): Promise<MigrationResult> {
    return invoke<MigrationResult>("cmd_migrate_from_state_json");
}

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

export async function updateDocumentMeta(
    id: string,
    title: string,
    wordCount: number,
    previewText: string,
    tags: string,
): Promise<void> {
    return invoke<void>("cmd_update_document_meta", {
        id,
        title,
        wordCount,
        previewText,
        tags,
    });
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
