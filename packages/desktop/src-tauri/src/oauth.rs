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

const SUCCESS_PAGE: &str = r##"<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>ChatGPT connected · Quillium</title>
    <style>
        :root { color-scheme: light; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; color: #20201e; background: #f5f4f1; }
        main { width: min(360px, 100%); text-align: center; }
        .mark { width: 48px; height: 48px; margin: 0 auto 22px; display: grid; place-items: center; border-radius: 14px; color: white; background: #222220; }
        h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -.02em; }
        p { margin: 10px 0 0; color: #77736b; font-size: 14px; line-height: 1.55; }
        @media (prefers-color-scheme: dark) {
            :root { color-scheme: dark; }
            body { color: #f3f1ec; background: #1d1d1b; }
            .mark { color: #242422; background: #f3f1ec; }
            p { color: #aaa69e; }
        }
    </style>
</head>
<body>
    <main>
        <div class="mark" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 200 200" fill="none">
                <g transform="translate(113, 96) rotate(19) scale(1.18) translate(-100, -100)">
                    <path d="M140,28 C128,42 110,55 90,68 C74,80 62,96 56,116 C52,132 52,150 56,168 L60,174 C60,152 64,134 72,118 C82,100 96,88 112,76 C126,65 136,50 140,36Z"
                          fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
                    <path d="M138,32 C118,62 94,98 72,135 C62,150 58,166 58,174"
                          fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                    <circle cx="58" cy="174" r="3.2" fill="#3b82f6"/>
                    <circle cx="55" cy="179.5" r="3.2" fill="#a855f7"/>
                    <circle cx="61" cy="179.5" r="3.2" fill="#22c55e"/>
                    <circle cx="58" cy="185" r="3.2" fill="#fcbc05"/>
                </g>
            </svg>
        </div>
        <h1>Connected</h1>
        <p>You can close this tab and return to Quillium.</p>
    </main>
</body>
</html>"##;

const ERROR_PAGE: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in incomplete · Quillium</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px;background:#f5f4f1;color:#252522;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(360px,100%);text-align:center}.icon{width:48px;height:48px;margin:0 auto 22px;display:grid;place-items:center;border-radius:14px;color:#a23b32;background:#f1dedb;font-size:24px}h1{margin:0;font-size:24px;font-weight:650;letter-spacing:-.02em}p{margin:10px 0 0;color:#77736b;font-size:14px;line-height:1.55}@media(prefers-color-scheme:dark){body{background:#1d1d1b;color:#f3f1ec}.icon{color:#ffaaa2;background:#492b28}p{color:#aaa69e}}</style></head>
<body><main><div class="icon">×</div><h1>Couldn’t connect</h1><p>Return to Quillium and try again.</p></main></body></html>"#;

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
                    let body = if success { SUCCESS_PAGE } else { ERROR_PAGE };
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{}",
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
