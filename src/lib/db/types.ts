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
};

export type TabMeta = {
    id: string;
    documentId: string;
    /** "draft" for prose tabs; future types (e.g. "canvas") share the bar. */
    tabType: string;
    label: string;
    position: number;
    createdAt: number;
};

export type SearchMatchType = "keyword" | "semantic" | "both";

export type SearchHit = DocumentMeta & {
    /**
     * Matched context. Keyword matches are wrapped in U+E000/U+E001
     * sentinels (see $lib/library/snippet.ts); semantic matches return the
     * best-matching chunk with no markers.
     */
    snippet: string;
    matchType: SearchMatchType;
    /** Reciprocal Rank Fusion score — only comparable within one response. */
    score: number;
};

export type DraftMeta = {
    id: string;
    documentId: string;
    label: string;
    createdAt: number;
    isActive: boolean;
    /** Tab this draft belongs to; null only for pre-migration rows. */
    tabId: string | null;
    /**
     * Previous iteration of this draft (the flat run). null for a run head
     * (main or a branch root). At most one of parentDraftId / branchedFrom
     * is set.
     */
    parentDraftId: string | null;
    /** The draft this one was branched off (a different take); null otherwise. */
    branchedFrom: string | null;
    /**
     * Soft lock. Superseded iterations (all but the newest in a run) lock
     * automatically; any draft can also be locked manually.
     */
    locked: boolean;
};

/**
 * One link rewrite from an orphan delete: a child that was re-attached and
 * the links it held before. Returned by `orphanAndDeleteDraft` so Undo can
 * restore the original links via `reparentDraft`.
 */
export type ReparentEntry = {
    draftId: string;
    oldParentDraftId: string | null;
    oldBranchedFrom: string | null;
};

/**
 * One entry in the document-level structural audit log (#160):
 * tab CRUD, draft branching, locks, checkpoints. Payload is JSON.
 */
export type DocEventRecord = {
    id: number;
    documentId: string;
    eventType: string;
    payload: string;
    createdAt: number;
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
