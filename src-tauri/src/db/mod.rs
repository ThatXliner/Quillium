pub mod documents;
pub mod events;
pub mod load;
pub mod schema;
pub mod tabs;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub word_count: i64,
    pub preview_text: String,
    pub tags: String,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabMeta {
    pub id: String,
    pub document_id: String,
    pub tab_type: String,
    pub label: String,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftMeta {
    pub id: String,
    pub document_id: String,
    pub label: String,
    pub created_at: i64,
    pub is_active: bool,
    /// Tab this draft belongs to. Nullable only for rows created before
    /// the tabs migration ran (backfill assigns them on next startup).
    pub tab_id: Option<String>,
    /// Parent in the draft tree; None for root drafts.
    pub parent_draft_id: Option<String>,
    /// Soft lock — set when the draft has been branched from. The editor
    /// shows a lock banner but the DB does not reject writes.
    pub locked: bool,
}

/// One entry in the document-level structural audit log (#160):
/// tab CRUD, draft branching, locks, checkpoints. Payload is JSON.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocEventRecord {
    pub id: i64,
    pub document_id: String,
    pub event_type: String,
    pub payload: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendEventResult {
    pub event_id: i64,
    pub needs_snapshot: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub id: i64,
    pub event_type: String,
    pub payload: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub snapshot_state_json: Option<String>,
    pub snapshot_event_id: i64,
    pub events_since: Vec<EventRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub id: i64,
    pub draft_id: String,
    pub up_to_event_id: i64,
    pub created_at: i64,
    pub label: Option<String>,
}
