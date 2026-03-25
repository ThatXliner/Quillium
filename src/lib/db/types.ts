/**
 * types.ts — Shared TypeScript types for the database layer.
 *
 * These types mirror the Rust structs in src-tauri/src/db/mod.rs.
 * Rust uses `#[serde(rename_all = "camelCase")]` so all fields
 * arrive over IPC already in camelCase.
 */

export type DocumentMeta = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    wordCount: number;
    previewText: string;
    /** JSON-encoded string array, e.g. '["fiction","novel"]' */
    tags: string;
    deletedAt: number | null;
    /** Set when this document is a draft branch of another document. */
    parentDocumentId: string | null;
    /** The snapshot in the parent document that this branch forked from. */
    branchedFromSnapshotId: number | null;
};

export type ForkResult = {
    docId: string;
    draftId: string;
};

export type DraftMeta = {
    id: string;
    documentId: string;
    label: string;
    createdAt: number;
    isActive: boolean;
};

export type AppendEventResult = {
    eventId: number;
    needsSnapshot: boolean;
};

export type EventRecord = {
    id: number;
    eventType: string;
    payload: string;
    createdAt: number;
};

export type LoadResult = {
    snapshotStateJson: string | null;
    snapshotEventId: number;
    eventsSince: EventRecord[];
};

export type SnapshotMeta = {
    id: number;
    draftId: string;
    upToEventId: number;
    createdAt: number;
    label: string | null;
};
