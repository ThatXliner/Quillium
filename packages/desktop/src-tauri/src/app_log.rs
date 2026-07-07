use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::json;
use tauri::Manager;

const LOG_FILE_NAME: &str = "quillium.log";
const ROTATED_LOG_FILE_NAME: &str = "quillium.old.log";
const MAX_LOG_BYTES: u64 = 2_000_000;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static PANIC_HOOK_INSTALLED: OnceLock<()> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

fn path_from_app(app: &tauri::App) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(LOG_FILE_NAME))
}

fn path_from_handle(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = LOG_PATH.get() {
        return Ok(path.clone());
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join(LOG_FILE_NAME))
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn rotate_if_needed(path: &Path) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() <= MAX_LOG_BYTES {
        return;
    }
    let rotated = path.with_file_name(ROTATED_LOG_FILE_NAME);
    let _ = fs::remove_file(&rotated);
    let _ = fs::rename(path, rotated);
}

fn write_record(
    path: &Path,
    level: &str,
    target: &str,
    message: &str,
    details: Option<&str>,
) -> Result<(), String> {
    let _guard = LOG_LOCK.lock().map_err(|err| err.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    rotate_if_needed(path);

    let mut record = json!({
        "tsMs": now_ms(),
        "level": level,
        "target": target,
        "message": message,
    });
    if let Some(details) = details {
        record["details"] = serde_json::from_str(details).unwrap_or_else(|_| json!(details));
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| err.to_string())?;
    writeln!(file, "{record}").map_err(|err| err.to_string())
}

fn log_panic(info: &std::panic::PanicHookInfo<'_>) {
    let payload = if let Some(message) = info.payload().downcast_ref::<&str>() {
        *message
    } else if let Some(message) = info.payload().downcast_ref::<String>() {
        message.as_str()
    } else {
        "unknown panic payload"
    };
    let location = info
        .location()
        .map(|location| {
            format!(
                "{}:{}:{}",
                location.file(),
                location.line(),
                location.column()
            )
        })
        .unwrap_or_else(|| "unknown location".to_string());
    let details = format!("{payload} at {location}");
    if let Some(path) = LOG_PATH.get() {
        let _ = write_record(path, "error", "rust-panic", "panic", Some(&details));
    }
}

pub fn init(app: &tauri::App) -> Result<(), String> {
    let path = path_from_app(app)?;
    let _ = LOG_PATH.set(path.clone());

    if PANIC_HOOK_INSTALLED.set(()).is_ok() {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            log_panic(info);
            default_hook(info);
        }));
    }

    write_record(&path, "info", "rust", "app log initialized", None)
}

pub fn log_event(
    app: &tauri::AppHandle,
    level: &str,
    target: &str,
    message: &str,
    details: Option<&str>,
) -> Result<(), String> {
    let path = path_from_handle(app)?;
    write_record(&path, level, target, message, details)
}

pub fn read(app: &tauri::AppHandle) -> Result<String, String> {
    let path = path_from_handle(app)?;
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(err.to_string()),
    }
}

pub fn clear(app: &tauri::AppHandle) -> Result<(), String> {
    let path = path_from_handle(app)?;
    fs::write(path, "").map_err(|err| err.to_string())
}

pub fn path(app: &tauri::AppHandle) -> Result<String, String> {
    path_from_handle(app).map(|path| path.display().to_string())
}
