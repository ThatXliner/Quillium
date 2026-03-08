pub mod db;
mod keychain;

use std::sync::Mutex;
use tauri::Manager;

use db::{
    documents::{
        create_document, create_draft, delete_document, get_document, list_documents, list_drafts,
        update_document_meta,
    },
    events::{append_event, create_snapshot},
    load::load_document_state,
    migration::migrate_from_state_json,
    schema::open_db,
    AppendEventResult, DocumentMeta, DraftMeta, LoadResult, MigrationResult,
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
fn cmd_list_drafts(
    state: tauri::State<DbState>,
    doc_id: String,
) -> Result<Vec<DraftMeta>, String> {
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
    up_to_event_seq: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    create_snapshot(&conn, &draft_id, &state_json, up_to_event_seq).map_err(|e| e.to_string())
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
fn cmd_migrate_from_state_json(
    app_handle: tauri::AppHandle,
    state: tauri::State<DbState>,
) -> Result<MigrationResult, String> {
    let state_json_path = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("state.json");
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    migrate_from_state_json(&conn, &state_json_path).map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = app
                .path()
                .app_local_data_dir()
                .expect("failed to resolve app local data dir");
            std::fs::create_dir_all(&db_path).expect("failed to create app data dir");
            let db_file = db_path.join("quillium.db");
            let conn = open_db(&db_file).expect("failed to open database");
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scrap,
            cmd_list_documents,
            cmd_get_document,
            cmd_create_document,
            cmd_update_document_meta,
            cmd_delete_document,
            cmd_list_drafts,
            cmd_create_draft,
            cmd_append_event,
            cmd_create_snapshot,
            cmd_load_document_state,
            cmd_migrate_from_state_json,
            set_api_key,
            get_api_key,
            delete_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
