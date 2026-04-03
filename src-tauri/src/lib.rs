pub mod db;
mod keychain;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

use db::{
    documents::{
        create_document, create_draft, delete_document, get_document, get_trash_retention,
        list_documents, list_drafts, list_trashed_documents, purge_expired_trash, restore_document,
        set_trash_retention, trash_document, update_document_meta,
    },
    events::{append_event, create_snapshot, create_named_snapshot, list_snapshots, label_snapshot, restore_to_snapshot, load_snapshot_state, get_snapshot_storage_size, prune_snapshots_keep_last_n, prune_snapshots_older_than, get_snapshot_retention, set_snapshot_retention},
    load::load_document_state,
    schema::open_db,
    AppendEventResult, DocumentMeta, DraftMeta, LoadResult, SnapshotMeta,
};
use keychain::{delete_api_key, get_api_key, set_api_key};

pub struct DbState(pub Mutex<rusqlite::Connection>);

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

// ── Multi-window commands ─────────────────────────────────────────

#[tauri::command]
fn cmd_open_in_new_window(
    app: tauri::AppHandle,
    open_windows: tauri::State<OpenWindows>,
    doc_id: String,
) -> Result<(), String> {
    let stale_label = {
        let mut map = open_windows.0.lock().map_err(|e| e.to_string())?;

        // If the document is already open in another window, focus it.
        if let Some(label) = map.get(&doc_id) {
            if let Some(win) = app.get_webview_window(label) {
                win.set_focus().map_err(|e| e.to_string())?;
                return Ok(());
            }
            // Window no longer exists — clean up stale entry.
            let stale = label.clone();
            map.remove(&doc_id);
            Some(stale)
        } else {
            None
        }
    };
    let _ = stale_label; // already removed above

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

    // Clean up when the window is closed.
    let arc_clone = open_windows.0.clone();
    let doc_id_clone = doc_id.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Ok(mut m) = arc_clone.lock() {
                m.remove(&doc_id_clone);
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

// ── App entry point ───────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            app.manage(OpenWindows(std::sync::Arc::new(Mutex::new(std::collections::HashMap::new()))));

            // ── App menu ──────────────────────────────────────────────
            let app_menu = SubmenuBuilder::new(app, "Quillium")
                .about(None)
                .separator()
                .item(
                    &MenuItemBuilder::with_id("settings", "Settings…")
                        .accelerator("CmdOrCtrl+,")
                        .build(app)?,
                )
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(
                    &MenuItemBuilder::with_id("library", "Library")
                        .accelerator("CmdOrCtrl+O")
                        .build(app)?,
                )
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
                .separator()
                .fullscreen()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .close_window()
                .build()?;

            let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])?;
            app.set_menu(menu)?;

            // Handle custom menu events by emitting them to the frontend.
            app.on_menu_event(move |app_handle, event| {
                let id = event.id().as_ref();
                match id {
                    "settings" | "history" | "library" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.emit(&format!("menu:{id}"), ());
                        }
                    }
                    _ => {}
                }
            });

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
            cmd_list_snapshots,
            cmd_load_snapshot_state,
            cmd_label_snapshot,
            cmd_restore_to_snapshot,
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
