pub mod db;
pub mod embeddings;
mod keychain;
mod pdf_export;

use std::sync::Mutex;
use tauri::Manager;

use db::{
    documents::{
        create_document, create_draft, delete_document, get_document, get_semantic_search_enabled,
        get_trash_retention, list_documents, list_drafts, list_trashed_documents,
        purge_expired_trash, restore_document, set_semantic_search_enabled, set_trash_retention,
        trash_document, update_document_meta,
    },
    events::{
        append_event, create_named_snapshot, create_snapshot, get_snapshot_retention,
        get_snapshot_storage_size, label_snapshot, list_document_snapshots, list_draft_events,
        list_snapshots, load_snapshot_state, prune_snapshots_keep_last_n,
        prune_snapshots_older_than, restore_to_snapshot, set_snapshot_retention,
    },
    load::load_document_state,
    schema::open_db,
    search::{search_documents, SearchHit},
    tabs::{
        branch_draft, cascade_delete_draft, create_tab, delete_draft, delete_tab, get_active_draft,
        get_active_tab, iterate_draft, list_doc_events, list_document_structure, list_tab_drafts,
        list_tabs, orphan_and_delete_draft, rename_draft, rename_tab, reorder_tabs, reparent_draft,
        restore_coordinate_nondestructive, restore_draft, restore_tab, set_active_draft,
        set_active_tab, set_draft_locked, ReparentEntry,
    },
    AppendEventResult, DocEventRecord, DocumentMeta, DocumentSnapshotMeta, DocumentStructure,
    DraftMeta, EventRecord, LoadResult, SnapshotMeta, TabMeta,
};
use keychain::{delete_api_key, get_api_key, set_api_key};
use pdf_export::{export_pdf_to_path, PdfExportPayload};

pub struct DbState(pub Mutex<rusqlite::Connection>);

/// Handle to the on-device semantic search index (see src/embeddings.rs).
pub struct SemanticState(pub std::sync::Arc<embeddings::SemanticIndex>);

pub struct OpenWindows(pub std::sync::Arc<Mutex<std::collections::HashMap<String, String>>>);

// ── Document commands ─────────────────────────────────────────────

#[tauri::command]
fn cmd_list_documents(state: tauri::State<DbState>) -> Result<Vec<DocumentMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_documents(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_document(
    state: tauri::State<DbState>,
    id: String,
) -> Result<Option<DocumentMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_document(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_create_document(state: tauri::State<DbState>, title: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_document(&conn, &title).map_err(|e| e.to_string())
}

/// `body_text` (the full plain text) is optional: rename/tag updates omit it
/// so the search index keeps the last indexed body. When present it also
/// queues the document for semantic (re-)indexing.
#[tauri::command]
fn cmd_update_document_meta(
    state: tauri::State<DbState>,
    semantic: tauri::State<SemanticState>,
    id: String,
    title: String,
    word_count: i64,
    preview_text: String,
    tags: String,
    body_text: Option<String>,
) -> Result<(), String> {
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        update_document_meta(
            &conn,
            &id,
            &title,
            word_count,
            &preview_text,
            &tags,
            body_text.as_deref(),
        )
        .map_err(|e| e.to_string())?;
    }
    if body_text.is_some() {
        semantic.0.request_index(&id);
    }
    Ok(())
}

// ── Search commands ───────────────────────────────────────────────

/// Hybrid full-text + semantic search across all (non-trashed) documents.
/// Async so query embedding (~tens of ms) stays off the main thread.
#[tauri::command]
async fn cmd_search_documents(
    state: tauri::State<'_, DbState>,
    semantic: tauri::State<'_, SemanticState>,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    // Embed off the async runtime: ONNX inference is synchronous CPU work
    // (tens of ms) and contends on the model mutex with the index worker, so
    // running it inline would block a Tokio worker thread. The DB lock + query
    // afterward are fast and stay on the async thread.
    let index = semantic.0.clone();
    let query_for_embed = query.clone();
    let query_embedding =
        tauri::async_runtime::spawn_blocking(move || index.embed_query(&query_for_embed))
            .await
            .map_err(|e| e.to_string())?;
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    search_documents(&conn, &query, query_embedding.as_deref()).map_err(|e| e.to_string())
}

/// Semantic index status: "disabled" | "starting" | "loading-model" |
/// "indexing" | "ready" | "unavailable" | "error: …". Keyword search works
/// regardless.
#[tauri::command]
fn cmd_search_status(semantic: tauri::State<SemanticState>) -> String {
    semantic.0.status()
}

/// Whether the user opted in to semantic search (Settings toggle).
#[tauri::command]
fn cmd_get_semantic_search_enabled(state: tauri::State<DbState>) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_semantic_search_enabled(&conn).map_err(|e| e.to_string())
}

/// Persists the semantic-search opt-in and starts/stops the index worker.
/// Enabling for the first time downloads the embedding model (~30 MB) in
/// the background; disabling frees the model but keeps the on-disk index
/// so re-enabling is cheap.
#[tauri::command]
fn cmd_set_semantic_search_enabled(
    state: tauri::State<DbState>,
    semantic: tauri::State<SemanticState>,
    enabled: bool,
) -> Result<(), String> {
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        set_semantic_search_enabled(&conn, enabled).map_err(|e| e.to_string())?;
    }
    semantic.0.set_enabled(enabled);
    Ok(())
}

/// Drops the model from memory and deletes its on-disk cache (~30 MB).
/// Also persists the opt-out so the model isn't re-downloaded on restart.
#[tauri::command]
fn cmd_uninstall_semantic_model(
    state: tauri::State<DbState>,
    semantic: tauri::State<SemanticState>,
) -> Result<(), String> {
    {
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        set_semantic_search_enabled(&conn, false).map_err(|e| e.to_string())?;
    }
    semantic.0.uninstall_model();
    Ok(())
}

#[tauri::command]
fn cmd_delete_document(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_document(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_trash_document(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    trash_document(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_restore_document(state: tauri::State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    restore_document(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_trashed_documents(state: tauri::State<DbState>) -> Result<Vec<DocumentMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_trashed_documents(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_drafts(state: tauri::State<DbState>, doc_id: String) -> Result<Vec<DraftMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_drafts(&conn, &doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_create_draft(
    state: tauri::State<DbState>,
    doc_id: String,
    label: String,
) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_draft(&conn, &doc_id, &label).map_err(|e| e.to_string())
}

// ── Tab commands (#160: document tabs) ────────────────────────────

#[tauri::command]
fn cmd_list_tabs(state: tauri::State<DbState>, doc_id: String) -> Result<Vec<TabMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_tabs(&conn, &doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_create_tab(
    state: tauri::State<DbState>,
    doc_id: String,
    label: String,
) -> Result<TabMeta, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_tab(&conn, &doc_id, &label).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_rename_tab(
    state: tauri::State<DbState>,
    tab_id: String,
    label: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    rename_tab(&conn, &tab_id, &label).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_delete_tab(state: tauri::State<DbState>, tab_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_tab(&conn, &tab_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_restore_tab(state: tauri::State<DbState>, tab_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    restore_tab(&conn, &tab_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_reorder_tabs(
    state: tauri::State<DbState>,
    doc_id: String,
    tab_ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    reorder_tabs(&conn, &doc_id, &tab_ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_doc_events(
    state: tauri::State<DbState>,
    doc_id: String,
) -> Result<Vec<DocEventRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_doc_events(&conn, &doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_active_tab(
    state: tauri::State<DbState>,
    doc_id: String,
) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_active_tab(&conn, &doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_set_active_tab(
    state: tauri::State<DbState>,
    doc_id: String,
    tab_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_active_tab(&conn, &doc_id, &tab_id).map_err(|e| e.to_string())
}

// ── Draft tree commands (#160: draft branching) ───────────────────

#[tauri::command]
fn cmd_list_tab_drafts(
    state: tauri::State<DbState>,
    tab_id: String,
) -> Result<Vec<DraftMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_tab_drafts(&conn, &tab_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_iterate_draft(
    state: tauri::State<DbState>,
    source_draft_id: String,
    label: String,
    state_json: Option<String>,
) -> Result<DraftMeta, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    iterate_draft(&conn, &source_draft_id, &label, state_json.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_branch_draft(
    state: tauri::State<DbState>,
    source_draft_id: String,
    label: String,
    state_json: Option<String>,
) -> Result<DraftMeta, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    branch_draft(&conn, &source_draft_id, &label, state_json.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_rename_draft(
    state: tauri::State<DbState>,
    draft_id: String,
    label: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    rename_draft(&conn, &draft_id, &label).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_set_draft_locked(
    state: tauri::State<DbState>,
    draft_id: String,
    locked: bool,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_draft_locked(&conn, &draft_id, locked).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_delete_draft(state: tauri::State<DbState>, draft_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_draft(&conn, &draft_id).map_err(|e| e.to_string())
}

/// Deletes a draft but keeps its children, re-attaching them. Returns the
/// link rewrites so the frontend can reverse them on Undo.
#[tauri::command]
fn cmd_orphan_and_delete_draft(
    state: tauri::State<DbState>,
    draft_id: String,
) -> Result<Vec<ReparentEntry>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    orphan_and_delete_draft(&conn, &draft_id).map_err(|e| e.to_string())
}

/// Deletes a draft and its whole subtree. Returns the deleted ids (root
/// first) so the frontend can restore them all on Undo.
#[tauri::command]
fn cmd_cascade_delete_draft(
    state: tauri::State<DbState>,
    draft_id: String,
) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    cascade_delete_draft(&conn, &draft_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_restore_draft(state: tauri::State<DbState>, draft_id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    restore_draft(&conn, &draft_id).map_err(|e| e.to_string())
}

/// Re-attaches a draft to the given links. Used by Undo to reverse an orphan
/// delete's re-parent after the deleted parent is restored.
#[tauri::command]
fn cmd_reparent_draft(
    state: tauri::State<DbState>,
    draft_id: String,
    parent_draft_id: Option<String>,
    branched_from: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    reparent_draft(
        &conn,
        &draft_id,
        parent_draft_id.as_deref(),
        branched_from.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_active_draft(
    state: tauri::State<DbState>,
    tab_id: String,
) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_active_draft(&conn, &tab_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_set_active_draft(
    state: tauri::State<DbState>,
    tab_id: String,
    draft_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_active_draft(&conn, &tab_id, &draft_id).map_err(|e| e.to_string())
}

// ── Event/snapshot commands ───────────────────────────────────────

#[tauri::command]
fn cmd_append_event(
    state: tauri::State<DbState>,
    draft_id: String,
    payload_json: String,
) -> Result<AppendEventResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    append_event(&conn, &draft_id, &payload_json).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_create_snapshot(
    state: tauri::State<DbState>,
    draft_id: String,
    state_json: String,
    up_to_event_id: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_snapshot(&conn, &draft_id, &state_json, up_to_event_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_load_document_state(
    state: tauri::State<DbState>,
    doc_id: String,
    draft_id: Option<String>,
) -> Result<LoadResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    load_document_state(&conn, &doc_id, draft_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_draft_events(
    state: tauri::State<DbState>,
    draft_id: String,
) -> Result<Vec<EventRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_draft_events(&conn, &draft_id).map_err(|e| e.to_string())
}

// ── Version history commands ──────────────────────────────────────

#[tauri::command]
fn cmd_list_snapshots(
    state: tauri::State<DbState>,
    draft_id: String,
) -> Result<Vec<SnapshotMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_snapshots(&conn, &draft_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_load_snapshot_state(
    state: tauri::State<DbState>,
    snapshot_id: i64,
) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    load_snapshot_state(&conn, snapshot_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_label_snapshot(
    state: tauri::State<DbState>,
    snapshot_id: i64,
    label: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    label_snapshot(&conn, snapshot_id, &label).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_restore_to_snapshot(
    state: tauri::State<DbState>,
    draft_id: String,
    snapshot_id: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    restore_to_snapshot(&conn, &draft_id, snapshot_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_document_snapshots(
    state: tauri::State<DbState>,
    doc_id: String,
) -> Result<Vec<DocumentSnapshotMeta>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_document_snapshots(&conn, &doc_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_document_structure(
    state: tauri::State<DbState>,
    doc_id: String,
) -> Result<DocumentStructure, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_document_structure(&conn, &doc_id).map_err(|e| e.to_string())
}

/// Where the editor should land after a coordinate restore.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreLanding {
    tab_id: Option<String>,
    draft_id: Option<String>,
}

/// Non-destructively restores the whole document to a timeline coordinate (the
/// "git reflog" reset). `as_of_ms` plus optional `as_of_event_id` identify the
/// exact structural coordinate; when `snapshot_id` is given, the relevant
/// draft's content is restored too as a new iteration tip. Nothing is deleted;
/// later coordinates remain in the timeline.
#[tauri::command]
fn cmd_restore_to_coordinate(
    state: tauri::State<DbState>,
    doc_id: String,
    as_of_ms: i64,
    as_of_event_id: Option<i64>,
    snapshot_id: Option<i64>,
) -> Result<RestoreLanding, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let landing =
        restore_coordinate_nondestructive(&conn, &doc_id, as_of_ms, as_of_event_id, snapshot_id)
            .map_err(|e| e.to_string())?;
    match landing {
        Some(draft) => Ok(RestoreLanding {
            tab_id: draft.tab_id,
            draft_id: Some(draft.id),
        }),
        None => Ok(RestoreLanding {
            tab_id: None,
            draft_id: None,
        }),
    }
}

#[tauri::command]
fn cmd_create_named_snapshot(
    state: tauri::State<DbState>,
    draft_id: String,
    state_json: String,
    up_to_event_id: i64,
    label: String,
) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_named_snapshot(&conn, &draft_id, &state_json, up_to_event_id, &label)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_snapshot_retention(state: tauri::State<DbState>) -> Result<Option<i64>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_snapshot_retention(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_set_snapshot_retention(
    state: tauri::State<DbState>,
    days: Option<i64>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_snapshot_retention(&conn, days).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_get_snapshot_storage_size(
    state: tauri::State<DbState>,
    draft_id: String,
) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_snapshot_storage_size(&conn, &draft_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_prune_snapshots_keep_last_n(
    state: tauri::State<DbState>,
    draft_id: String,
    keep_n: i64,
) -> Result<u64, String> {
    if keep_n < 0 {
        return Err("keep_n must be >= 0".to_string());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    prune_snapshots_keep_last_n(&conn, &draft_id, keep_n).map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_prune_snapshots_older_than(
    state: tauri::State<DbState>,
    draft_id: String,
    older_than_days: i64,
) -> Result<u64, String> {
    if older_than_days < 1 {
        return Err("older_than_days must be >= 1".to_string());
    }
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    prune_snapshots_older_than(&conn, &draft_id, older_than_days).map_err(|e| e.to_string())
}

// ── Trash retention commands ──────────────────────────────────────

/// Returns the trash auto-empty setting in days, or null if "never".
#[tauri::command]
fn cmd_get_trash_retention(state: tauri::State<DbState>) -> Result<Option<i64>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_trash_retention(&conn).map_err(|e| e.to_string())
}

/// Persists the trash auto-empty setting. Pass null to disable.
#[tauri::command]
fn cmd_set_trash_retention(state: tauri::State<DbState>, days: Option<i64>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    set_trash_retention(&conn, days).map_err(|e| e.to_string())
}

/// Purges trashed documents that have been in the trash longer than
/// the configured retention period. Returns the number of deleted documents.
#[tauri::command]
fn cmd_purge_expired_trash(state: tauri::State<DbState>) -> Result<u64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    match get_trash_retention(&conn).map_err(|e| e.to_string())? {
        Some(days) => purge_expired_trash(&conn, days).map_err(|e| e.to_string()),
        None => Ok(0),
    }
}

// PDF rendering now builds on every target (printpdf with default features off).
// On mobile the caller must pass a writable, app-sandboxed path — there is no
// native file picker on iOS, so the share-sheet save flow is still TODO
// (https://github.com/ThatXliner/Quillium/issues/243); generation itself works.
#[tauri::command]
fn cmd_export_pdf(path: String, payload: PdfExportPayload) -> Result<(), String> {
    export_pdf_to_path(&path, &payload)
}

// ── Debug reset command ───────────────────────────────────────────

/// Wipes all user data from the database (documents, drafts, events,
/// snapshots) and re-initialises the schema. Used by the debug panel
/// to guarantee a clean slate before loading a scenario.
#[tauri::command]
fn cmd_reset_db(state: tauri::State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "DELETE FROM vec_chunks;
         DELETE FROM chunks;
         DELETE FROM snapshots;
         DELETE FROM events;
         DELETE FROM doc_events;
         DELETE FROM drafts;
         DELETE FROM tabs;
         DELETE FROM documents;
         DELETE FROM _meta;",
    )
    .map_err(|e| e.to_string())
}

// ── Multi-window commands ─────────────────────────────────────────

#[tauri::command]
fn cmd_open_in_new_window(
    app: tauri::AppHandle,
    open_windows: tauri::State<OpenWindows>,
    doc_id: String,
) -> Result<(), String> {
    {
        let mut map = open_windows.0.lock().map_err(|e| e.to_string())?;

        // If the document is already open in another window, focus it.
        if let Some(label) = map.get(&doc_id) {
            if let Some(win) = app.get_webview_window(label) {
                win.set_focus().map_err(|e| e.to_string())?;
                return Ok(());
            }
            // Window no longer exists — clean up stale entry.
            map.remove(&doc_id);
        }
    }

    let short_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let label = format!("editor-{short_id}");
    let url = format!("/?doc={doc_id}");

    let window = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title("Quillium")
        .inner_size(1373.0, 1170.0)
        .min_inner_size(900.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;

    {
        let mut map = open_windows.0.lock().map_err(|e| e.to_string())?;
        map.insert(doc_id.clone(), label.clone());
    }

    // Clean up when the window is closed. We match by window LABEL, not by the
    // doc_id the window opened with — the window may have navigated to a
    // different document (or to the library) before closing, so the doc_id
    // captured here can be stale. Removing by label drops whatever entry the
    // window currently owns. This is the authoritative cleanup: the frontend's
    // onMount-return deregister does NOT reliably run when an OS window is
    // closed (the webview is torn down, not gracefully unmounted).
    let arc_clone = open_windows.0.clone();
    let label_clone = label.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Ok(mut m) = arc_clone.lock() {
                m.retain(|_, v| v != &label_clone);
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn cmd_register_open_doc(
    open_windows: tauri::State<OpenWindows>,
    doc_id: String,
    window_label: String,
) -> Result<(), String> {
    let mut map = open_windows.0.lock().map_err(|e| e.to_string())?;
    map.insert(doc_id, window_label);
    Ok(())
}

#[tauri::command]
fn cmd_deregister_open_doc(
    open_windows: tauri::State<OpenWindows>,
    window_label: String,
) -> Result<(), String> {
    let mut map = open_windows.0.lock().map_err(|e| e.to_string())?;
    map.retain(|_, v| v != &window_label);
    Ok(())
}

#[tauri::command]
fn cmd_is_doc_open_elsewhere(
    open_windows: tauri::State<OpenWindows>,
    app: tauri::AppHandle,
    doc_id: String,
    window_label: String,
) -> Result<bool, String> {
    let map = open_windows.0.lock().map_err(|e| e.to_string())?;
    match map.get(&doc_id) {
        Some(label) if label != &window_label => {
            // Focus the window that has it open.
            if let Some(win) = app.get_webview_window(label) {
                let _ = win.set_focus();
            }
            Ok(true)
        }
        _ => Ok(false),
    }
}

// ── Legacy scrap command ──────────────────────────────────────────
// Kept for Save.svelte compatibility. In the new DB world, "scrapping"
// a draft means deleting the document. The UI reloads after this call.
#[tauri::command]
fn scrap(state: tauri::State<DbState>) -> bool {
    // Get the first (most-recently-updated) document and delete it.
    let conn = match state.0.lock() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let doc_id: Option<String> = conn
        .query_row(
            "SELECT id FROM documents ORDER BY updated_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();
    if let Some(id) = doc_id {
        let _ = conn.execute("DELETE FROM documents WHERE id = ?1", rusqlite::params![id]);
    }
    true
}

// ── Native app menu (desktop only) ────────────────────────────────

#[cfg(desktop)]
fn setup_app_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItemBuilder, SubmenuBuilder},
        Emitter,
    };

    let app_menu = SubmenuBuilder::new(app, "Quillium")
        .about(None)
        .separator()
        .item(
            &MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("licenses", "Open Source Licenses…").build(app)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let export_submenu = SubmenuBuilder::new(app, "Export")
        .item(&MenuItemBuilder::with_id("export-txt", "Plain Text (.txt)").build(app)?)
        .item(&MenuItemBuilder::with_id("export-txt-json", "Text + Annotations (.txt)").build(app)?)
        .item(&MenuItemBuilder::with_id("export-json", "JSON (.json)").build(app)?)
        .item(&MenuItemBuilder::with_id("export-md", "Markdown (.md)").build(app)?)
        .item(&MenuItemBuilder::with_id("export-pdf", "PDF (.pdf)").build(app)?)
        .item(
            &MenuItemBuilder::with_id("export-pdf-annotations", "PDF + Annotations (.pdf)")
                .build(app)?,
        )
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("library", "Library")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open-in-new-window", "Open in New Window")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?,
        )
        .item(&export_submenu)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("history", "Version History")
                .accelerator("CmdOrCtrl+Shift+H")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("authorship", "Authorship Report…")
                .accelerator("CmdOrCtrl+Shift+A")
                .build(app)?,
        )
        .separator()
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .close_window()
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("feedback", "Send Feedback…").build(app)?)
        .build()?;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )?;
    app.set_menu(menu)?;

    // Handle custom menu events by emitting them to the frontend.
    app.on_menu_event(move |app_handle, event| {
        let id = event.id().as_ref();
        match id {
            "settings"
            | "history"
            | "authorship"
            | "library"
            | "open-in-new-window"
            | "licenses"
            | "feedback"
            | "export-txt"
            | "export-txt-json"
            | "export-json"
            | "export-md"
            | "export-pdf"
            | "export-pdf-annotations" => {
                // Route to the focused window, falling back to main. This way
                // menu actions affect whichever window the user is looking at.
                let focused = app_handle
                    .webview_windows()
                    .into_values()
                    .find(|w| w.is_focused().unwrap_or(false));
                let target = focused.or_else(|| app_handle.get_webview_window("main"));
                if let Some(window) = target {
                    let _ = window.emit(&format!("menu:{id}"), ());
                }
            }
            _ => {}
        }
    });

    Ok(())
}

// ── App entry point ───────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    // Dev-only MCP automation bridge. Double-gated: the `mcp-bridge` feature keeps
    // the crate out of production builds entirely, and `debug_assertions` ensures it
    // can never activate in a release binary even if the feature were enabled.
    #[cfg(all(debug_assertions, feature = "mcp-bridge"))]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    // Self-update and relaunch only exist on desktop; mobile updates go through
    // the App Store / Play Store.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .setup(|app| {
            // Allow override for testing (e.g. running two instances with separate DBs)
            let db_path = match std::env::var("QUILLIUM_DATA_DIR") {
                Ok(dir) => std::path::PathBuf::from(dir),
                Err(_) => app
                    .path()
                    .app_local_data_dir()
                    .expect("failed to resolve app local data dir"),
            };
            std::fs::create_dir_all(&db_path).expect("failed to create app data dir");
            let db_file = db_path.join("quillium.db");
            let conn = open_db(&db_file).expect("failed to open database");
            // Auto-purge expired trash on startup.
            if let Ok(Some(days)) = get_trash_retention(&conn) {
                let _ = purge_expired_trash(&conn, days);
            }
            // Auto-prune old snapshots on startup per retention policy.
            if let Ok(Some(days)) = get_snapshot_retention(&conn) {
                // Prune across all drafts.
                if let Ok(mut stmt) = conn.prepare("SELECT DISTINCT draft_id FROM snapshots") {
                    if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                        let draft_ids: Vec<String> = rows.filter_map(|r| r.ok()).collect();
                        for draft_id in draft_ids {
                            let _ = prune_snapshots_older_than(&conn, &draft_id, days);
                        }
                    }
                }
            }
            app.manage(DbState(Mutex::new(conn)));
            app.manage(OpenWindows(std::sync::Arc::new(Mutex::new(
                std::collections::HashMap::new(),
            ))));

            // Semantic search index: background worker with its own DB
            // connection. Opt-in — the embedding model (~30 MB) is only
            // downloaded once the user enables "Search by meaning" in
            // Settings; until then the worker idles and search is FTS-only.
            let semantic_enabled = {
                let conn = app.state::<DbState>().inner().0.lock().unwrap();
                get_semantic_search_enabled(&conn).unwrap_or(false)
            };
            let semantic = embeddings::SemanticIndex::new();
            semantic.start(db_file.clone(), db_path.join("models"), semantic_enabled);
            app.manage(SemanticState(semantic));

            // Native app menu is desktop-only; mobile has no menu bar, so the
            // frontend exposes these actions through in-app UI instead.
            #[cfg(desktop)]
            setup_app_menu(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_reset_db,
            scrap,
            cmd_get_trash_retention,
            cmd_export_pdf,
            cmd_set_trash_retention,
            cmd_purge_expired_trash,
            cmd_list_documents,
            cmd_get_document,
            cmd_create_document,
            cmd_update_document_meta,
            cmd_search_documents,
            cmd_search_status,
            cmd_get_semantic_search_enabled,
            cmd_set_semantic_search_enabled,
            cmd_uninstall_semantic_model,
            cmd_delete_document,
            cmd_trash_document,
            cmd_restore_document,
            cmd_list_trashed_documents,
            cmd_list_drafts,
            cmd_create_draft,
            cmd_list_tabs,
            cmd_create_tab,
            cmd_rename_tab,
            cmd_delete_tab,
            cmd_get_active_tab,
            cmd_set_active_tab,
            cmd_list_tab_drafts,
            cmd_iterate_draft,
            cmd_branch_draft,
            cmd_rename_draft,
            cmd_set_draft_locked,
            cmd_delete_draft,
            cmd_orphan_and_delete_draft,
            cmd_cascade_delete_draft,
            cmd_restore_draft,
            cmd_reparent_draft,
            cmd_restore_tab,
            cmd_reorder_tabs,
            cmd_list_doc_events,
            cmd_get_active_draft,
            cmd_set_active_draft,
            cmd_append_event,
            cmd_create_snapshot,
            cmd_load_document_state,
            cmd_list_draft_events,
            cmd_list_snapshots,
            cmd_list_document_snapshots,
            cmd_list_document_structure,
            cmd_load_snapshot_state,
            cmd_label_snapshot,
            cmd_restore_to_snapshot,
            cmd_restore_to_coordinate,
            cmd_create_named_snapshot,
            cmd_get_snapshot_retention,
            cmd_set_snapshot_retention,
            cmd_get_snapshot_storage_size,
            cmd_prune_snapshots_keep_last_n,
            cmd_prune_snapshots_older_than,
            set_api_key,
            get_api_key,
            delete_api_key,
            cmd_open_in_new_window,
            cmd_register_open_doc,
            cmd_deregister_open_doc,
            cmd_is_doc_open_elsewhere,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
