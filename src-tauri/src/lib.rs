use std::fs;

use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

const KEYCHAIN_SERVICE: &str = "com.bryanhu.quillium";

#[tauri::command]
fn set_api_key(provider: String, key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &provider).map_err(|e| e.to_string())?;
    entry.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_api_key(provider: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn delete_api_key(provider: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &provider).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn save(app: tauri::AppHandle, state: String) -> bool {
    app.emit("saving", ()).unwrap();
    // How the saving algorithm should work
    // (don't implement it yet as it doesnt really matter)
    // on a change, initiate a save
    // if there is already a save action in progress, mark it as cancelled
    // and/by queueing a new save
    //
    // in the save code, when atomic saving the file (writing to file first and then moving it)
    // and there's a cancellation, delete the temporary file and abort
    // and then use the newest queued action.
    // however, if there hasn't been a save in the past ___ seconds,
    // ignore the change in queue size and write to disk first, and then skip to the latest
    //
    // start autosave action when typing debounce (when we implement multiple documents lol)
    // but save cache on every single time history gets updated
    let dir = app.path().app_local_data_dir().unwrap();
    {
        // Sec issue because we're cheking perms before creating the dir?
        if !dir.exists() {
            fs::create_dir(&dir).unwrap();
        }
    }
    let output = fs::write(dir.join("state.json"), state).is_ok();
    app.emit("saved", ()).unwrap();
    output
}
#[tauri::command]
fn scrap(app: tauri::AppHandle) -> bool {
    app.emit("saving", ()).unwrap();
    let dir = app.path().app_local_data_dir().unwrap();
    let scrap_dir = dir.join("scrapped");
    {
        // Sec issue because we're cheking perms before creating the dir?
        if !scrap_dir.exists() {
            fs::create_dir_all(&scrap_dir).unwrap();
        }
    }
    let current_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let output = fs::rename(
        dir.join("state.json"),
        scrap_dir.join(format!("{}.json", current_time)),
    )
    .is_ok();
    app.emit("saved", ()).unwrap();
    output
}
#[tauri::command]
fn load(app_handle: tauri::AppHandle) -> Option<String> {
    fs::read_to_string(
        app_handle
            .path()
            .app_local_data_dir()
            .unwrap()
            .join("state.json"),
    )
    .ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save,
            load,
            scrap,
            set_api_key,
            get_api_key,
            delete_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
