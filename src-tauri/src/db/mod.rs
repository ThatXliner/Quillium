pub mod documents;
pub mod events;
pub mod load;
pub mod schema;

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
    pub parent_document_id: Option<String>,
    pub branched_from_snapshot_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkResult {
    pub doc_id: String,
    pub draft_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftMeta {
    pub id: String,
    pub document_id: String,
    pub label: String,
    pub created_at: i64,
    pub is_active: bool,
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
