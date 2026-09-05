pub mod ai;
pub mod documents;
pub mod events;
pub mod load;
pub mod migrations;
pub mod schema;
pub mod search;
pub mod tabs;

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Structural validation stays distinct from SQLite failures until commands
/// serialize either error with `to_string()`, preserving the frontend contract.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("{0}")]
    Validation(String),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
}

pub type DbResult<T> = Result<T, DbError>;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

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
    pub persist_history: bool,
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
    /// Previous *iteration* of this draft (the flat chain). None for a run
    /// head (`main` or a branch root). A draft sets at most one of
    /// `parent_draft_id` / `branched_from`.
    pub parent_draft_id: Option<String>,
    /// The draft this one was *branched* off (a different take, rendered
    /// indented). None for iterations and for `main`.
    pub branched_from: Option<String>,
    /// Soft lock. Superseded iterations (every draft in a run except the
    /// newest) lock automatically; any draft can also be locked manually.
    /// The editor shows a lock banner but the DB does not reject writes.
    pub locked: bool,
}

/// The document's full tab/draft roster INCLUDING soft-deleted rows, for the
/// version-history preview map (which must render structure as-of any past
/// point, including since-deleted tabs/drafts). Unlike `list_tabs` /
/// `list_tab_drafts`, this does not filter on `deleted_at`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentStructure {
    pub tabs: Vec<TabMeta>,
    pub drafts: Vec<DraftMeta>,
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

/// A snapshot listed across a whole document (not one draft), tagged with the
/// owning draft's label and tab so the document-wide version-history timeline
/// can show "which draft this content belongs to". `draft_label` and `tab_id`
/// come from a join against `drafts` (including soft-deleted ones, so history
/// of since-deleted drafts still appears).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSnapshotMeta {
    pub id: i64,
    pub draft_id: String,
    pub draft_label: String,
    pub tab_id: Option<String>,
    pub up_to_event_id: i64,
    pub created_at: i64,
    pub label: Option<String>,
}
