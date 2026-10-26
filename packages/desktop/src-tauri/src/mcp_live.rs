//! Authenticated loopback bridge from stdio MCP to the running editor.
//! Only the endpoint/token is stored on disk; prose and pending actions stay in memory.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct LiveBridge {
    active: Mutex<Option<String>>,
    pending: Mutex<HashMap<String, (String, mpsc::Sender<Value>)>>,
}

#[tauri::command]
pub fn cmd_mcp_editor_ready(
    window: tauri::WebviewWindow,
    state: tauri::State<LiveBridge>,
    ready: bool,
) {
    let mut active = state.active.lock().unwrap();
    if ready {
        if active.is_none() || window.is_focused().unwrap_or(false) {
            *active = Some(window.label().to_owned());
        }
    } else if active.as_deref() == Some(window.label()) {
        *active = None;
    }
}

#[tauri::command]
pub fn cmd_mcp_reply(
    window: tauri::WebviewWindow,
    state: tauri::State<LiveBridge>,
    id: String,
    result: Value,
) {
    let mut pending = state.pending.lock().unwrap();
    if pending
        .get(&id)
        .is_some_and(|(label, _)| label == window.label())
    {
        if let Some((_, sender)) = pending.remove(&id) {
            let _ = sender.send(result);
        }
    }
}

fn read_message(stream: &TcpStream) -> Result<Value, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(stream.take(2_000_001))
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    if line.len() > 2_000_000 || !line.ends_with('\n') {
        return Err("Invalid or oversized bridge message".into());
    }
    serde_json::from_str(&line).map_err(|e| e.to_string())
}

pub fn start(app: tauri::AppHandle, directory: &Path) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let token = uuid::Uuid::new_v4().to_string();
    let endpoint =
        json!({"port": listener.local_addr().map_err(|e| e.to_string())?.port(), "token": token});
    let path = directory.join("mcp-live.json");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    file.write_all(endpoint.to_string().as_bytes())
        .map_err(|e| e.to_string())?;
    app.manage(LiveBridge::default());
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let result = (|| -> Result<Value, String> {
                let request = read_message(&stream)?;
                if request["token"].as_str() != Some(&token) {
                    return Err("Unauthorized bridge request".into());
                }
                let state = app.state::<LiveBridge>();
                let label = state
                    .active
                    .lock()
                    .unwrap()
                    .clone()
                    .ok_or("Open a draft in Quillium first")?;
                let window = app
                    .get_webview_window(&label)
                    .ok_or("The editor window was closed")?;
                let id = uuid::Uuid::new_v4().to_string();
                let (sender, receiver) = mpsc::channel();
                state
                    .pending
                    .lock()
                    .unwrap()
                    .insert(id.clone(), (label, sender));
                let emitted = window.emit(
                    "mcp:request",
                    json!({"id": id, "name": request["name"], "arguments": request["arguments"], "expiresAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() + 7000}),
                );
                let result = match emitted {
                    Ok(()) => receiver.recv_timeout(Duration::from_secs(8)).map_err(|_| {
                        "Quillium's editor did not respond. Open a draft and retry.".to_string()
                    }),
                    Err(e) => Err(e.to_string()),
                };
                state.pending.lock().unwrap().remove(&id);
                result
            })()
            .unwrap_or_else(|error| json!({"error": error}));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
            let _ = writeln!(stream, "{result}");
        }
    });
    Ok(())
}

pub fn call(directory: &Path, name: &str, arguments: &Value) -> Result<Value, String> {
    let endpoint: Value = serde_json::from_slice(
        &std::fs::read(directory.join("mcp-live.json"))
            .map_err(|_| "Open the updated Quillium app and a draft first".to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let port = endpoint["port"]
        .as_u64()
        .filter(|p| *p > 0 && *p <= 65535)
        .ok_or("Invalid bridge endpoint")?;
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port as u16));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
        .map_err(|_| "Quillium is not running. Open it and retry.".to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|e| e.to_string())?;
    writeln!(
        stream,
        "{}",
        json!({"token": endpoint["token"], "name": name, "arguments": arguments})
    )
    .map_err(|e| e.to_string())?;
    read_message(&stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_rediscovers_endpoint_on_every_call_and_forwards_arguments() {
        let directory = tempfile::tempdir().unwrap();
        for generation in 1..=2 {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let token = uuid::Uuid::new_v4().to_string();
            std::fs::write(
                directory.path().join("mcp-live.json"),
                json!({"port": listener.local_addr().unwrap().port(), "token": token}).to_string(),
            )
            .unwrap();
            let worker = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let request = read_message(&stream).unwrap();
                assert_eq!(request["token"], token);
                assert_eq!(request["name"], "get_editor_context");
                assert_eq!(request["arguments"]["test"], generation);
                writeln!(
                    stream,
                    "{}",
                    json!({"text": format!("live edit {generation}")})
                )
                .unwrap();
            });
            assert_eq!(
                call(
                    directory.path(),
                    "get_editor_context",
                    &json!({"test": generation})
                )
                .unwrap()["text"],
                format!("live edit {generation}")
            );
            worker.join().unwrap();
        }
    }

    #[test]
    fn missing_endpoint_requires_the_app_instead_of_guessing() {
        let directory = tempfile::tempdir().unwrap();
        assert!(call(directory.path(), "get_editor_context", &json!({}))
            .unwrap_err()
            .contains("Open the updated Quillium"));
    }
}
