use std::fs;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn save(app_handle: tauri::AppHandle, state: String) -> bool {
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
    let dir = app_handle.path().app_local_data_dir().unwrap();
    {
        // Sec issue because we're cheking perms before creating the dir?
        if !dir.exists() {
            fs::create_dir(&dir).unwrap();
        }
    }
    fs::write(dir.join("state.json"), state).is_ok()
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save, load])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
