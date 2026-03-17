pub mod db;
mod keychain;

use std::sync::Mutex;
use tauri::Manager;

use db::{
    documents::{
        create_document, create_draft, delete_document, get_document, get_trash_retention,
        list_documents, list_drafts, list_trashed_documents, purge_expired_trash, restore_document,
        set_trash_retention, trash_document, update_document_meta,
    },
    events::{append_event, create_snapshot},
    load::load_document_state,
    schema::open_db,
    AppendEventResult, DocumentMeta, DraftMeta, LoadResult,
};
use keychain::{delete_api_key, get_api_key, set_api_key};

pub struct DbState(pub Mutex<rusqlite::Connection>);

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

#[tauri::command]
fn cmd_update_document_meta(
    state: tauri::State<DbState>,
    id: String,
    title: String,
    word_count: i64,
    preview_text: String,
    tags: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    update_document_meta(&conn, &id, &title, word_count, &preview_text, &tags)
        .map_err(|e| e.to_string())
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

// ── Debug reset command ───────────────────────────────────────────

/// Wipes all user data from the database (documents, drafts, events,
/// snapshots) and re-initialises the schema. Used by the debug panel
/// to guarantee a clean slate before loading a scenario.
#[tauri::command]
fn cmd_reset_db(state: tauri::State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(
        "DELETE FROM snapshots;
         DELETE FROM events;
         DELETE FROM drafts;
         DELETE FROM documents;
         DELETE FROM _meta;",
    )
    .map_err(|e| e.to_string())
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

// ── App entry point ───────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = app
                .path()
                .app_local_data_dir()
                .expect("failed to resolve app local data dir");
            std::fs::create_dir_all(&db_path).expect("failed to create app data dir");
            let db_file = db_path.join("quillium.db");
            let conn = open_db(&db_file).expect("failed to open database");
            // Auto-purge expired trash on startup.
            if let Ok(Some(days)) = get_trash_retention(&conn) {
                let _ = purge_expired_trash(&conn, days);
            }
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_reset_db,
            scrap,
            cmd_get_trash_retention,
            cmd_set_trash_retention,
            cmd_purge_expired_trash,
            cmd_list_documents,
            cmd_get_document,
            cmd_create_document,
            cmd_update_document_meta,
            cmd_delete_document,
            cmd_trash_document,
            cmd_restore_document,
            cmd_list_trashed_documents,
            cmd_list_drafts,
            cmd_create_draft,
            cmd_append_event,
            cmd_create_snapshot,
            cmd_load_document_state,
            set_api_key,
            get_api_key,
            delete_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
