//! oauth.rs — Native loopback callback for OpenAI OAuth.
//!
//! OpenAI's desktop OAuth client accepts a fixed localhost callback. The listener
//! lives in Rust so the flow works from Tauri's webview without a browser extension
//! or a custom URL protocol.

use serde::Serialize;
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};
use tauri_plugin_opener::OpenerExt;

const CALLBACK_ADDRESS: &str = "127.0.0.1:1455";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCallback {
    code: String,
    state: String,
}

#[tauri::command]
pub async fn await_openai_oauth_callback(
    app: tauri::AppHandle,
    authorization_url: String,
) -> Result<OAuthCallback, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind(CALLBACK_ADDRESS)
            .map_err(|error| format!("Could not start the OAuth callback listener: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;

        app.opener()
            .open_url(authorization_url, None::<String>)
            .map_err(|error| format!("Could not open the sign-in page: {error}"))?;

        let started = Instant::now();
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let mut buffer = [0_u8; 8192];
                    let count = stream.read(&mut buffer).map_err(|error| error.to_string())?;
                    let request = String::from_utf8_lossy(&buffer[..count]);
                    let target = request
                        .lines()
                        .next()
                        .and_then(|line| line.split_whitespace().nth(1))
                        .ok_or_else(|| "The OAuth callback request was invalid.".to_string())?;
                    let callback = url::Url::parse(&format!("http://localhost{target}"))
                        .map_err(|error| format!("The OAuth callback URL was invalid: {error}"))?;
                    let params = callback.query_pairs().collect::<std::collections::HashMap<_, _>>();

                    let error = params.get("error").map(|value| value.to_string());
                    let code = params.get("code").map(|value| value.to_string());
                    let state = params.get("state").map(|value| value.to_string());
                    let success = error.is_none() && code.is_some() && state.is_some();
                    let body = if success {
                        "<h1>Signed in to Quillium</h1><p>You can close this window and return to the app.</p>"
                    } else {
                        "<h1>Sign-in failed</h1><p>Return to Quillium and try again.</p>"
                    };
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body,
                    );
                    let _ = stream.write_all(response.as_bytes());

                    if let Some(error) = error {
                        return Err(format!("OpenAI sign-in failed: {error}"));
                    }
                    return Ok(OAuthCallback {
                        code: code.ok_or_else(|| "The OAuth callback did not include a code.".to_string())?,
                        state: state.ok_or_else(|| "The OAuth callback did not include state.".to_string())?,
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if started.elapsed() >= LOGIN_TIMEOUT {
                        return Err("OpenAI sign-in timed out.".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
