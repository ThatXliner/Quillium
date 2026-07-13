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

const SUCCESS_PAGE: &str = r#"<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>ChatGPT connected · Quillium</title>
    <style>
        :root { color-scheme: light; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px; color: #20201e; background: #f2f0eb; }
        .glow { position: fixed; inset: 0; pointer-events: none; background: radial-gradient(circle at 50% 38%, rgba(255,255,255,.95), transparent 42%); }
        main { position: relative; width: min(440px, 100%); padding: 42px 38px 34px; text-align: center; border: 1px solid rgba(32,32,30,.1); border-radius: 24px; background: rgba(255,255,255,.82); box-shadow: 0 24px 70px rgba(48,43,34,.12), 0 2px 8px rgba(48,43,34,.05); backdrop-filter: blur(16px); }
        .mark { width: 62px; height: 62px; margin: 0 auto 24px; display: grid; place-items: center; border-radius: 18px; color: white; background: #222220; box-shadow: 0 8px 22px rgba(25,25,23,.18); }
        .check { position: absolute; top: 31px; left: calc(50% + 20px); width: 23px; height: 23px; display: grid; place-items: center; border: 3px solid white; border-radius: 50%; color: white; background: #21a366; }
        .eyebrow { margin: 0 0 10px; color: #77736b; font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
        h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(29px, 6vw, 38px); font-weight: 500; letter-spacing: -.025em; }
        .copy { margin: 14px auto 26px; max-width: 320px; color: #6f6b64; font-size: 14px; line-height: 1.6; }
        .status { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 16px; border: 1px solid rgba(33,163,102,.2); border-radius: 12px; color: #18794e; background: rgba(33,163,102,.08); font-size: 13px; font-weight: 650; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: #21a366; box-shadow: 0 0 0 4px rgba(33,163,102,.12); }
        footer { margin-top: 26px; color: #9a968e; font-size: 10px; letter-spacing: .02em; }
        @media (prefers-color-scheme: dark) {
            :root { color-scheme: dark; }
            body { color: #f3f1ec; background: #191917; }
            .glow { background: radial-gradient(circle at 50% 38%, rgba(255,255,255,.08), transparent 43%); }
            main { border-color: rgba(255,255,255,.1); background: rgba(38,38,35,.88); box-shadow: 0 24px 70px rgba(0,0,0,.35); }
            .mark { color: #242422; background: #f3f1ec; }
            .check { border-color: #262623; }
            .eyebrow, .copy { color: #aaa69e; }
            .status { color: #76d6a6; }
            footer { color: #77736c; }
        }
    </style>
</head>
<body>
    <div class="glow"></div>
    <main>
        <div class="mark" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 34 34" fill="none"><path d="M8 6.5h10.1c5.7 0 9.9 4.1 9.9 10.2 0 5-2.8 8.7-7.1 9.9L25 31l-4.1.1-3.4-3.8H8V6.5Zm4.2 4v12.8h5.9c3.4 0 5.6-2.5 5.6-6.5s-2.3-6.3-5.9-6.3h-5.6Z" fill="currentColor"/></svg>
        </div>
        <div class="check" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="m2.2 6.1 2.3 2.3 5.3-5.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <p class="eyebrow">Authentication complete</p>
        <h1>ChatGPT is connected</h1>
        <p class="copy">Your account is ready to use in Quillium. You can safely close this tab and return to your writing.</p>
        <div class="status"><span class="dot"></span>Connected securely with OAuth 2.0</div>
        <footer>QUILLIUM · YOUR CREDENTIALS ARE STORED IN YOUR SYSTEM KEYCHAIN</footer>
    </main>
</body>
</html>"#;

const ERROR_PAGE: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in incomplete · Quillium</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px;background:#f2f0eb;color:#252522;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(420px,100%);padding:40px;text-align:center;border:1px solid #dedbd4;border-radius:24px;background:#fff;box-shadow:0 24px 70px rgba(48,43,34,.12)}.icon{width:54px;height:54px;margin:0 auto 22px;display:grid;place-items:center;border-radius:16px;color:#a23b32;background:#f8e9e6;font-size:28px}h1{margin:0;font:500 34px Georgia,serif}p{margin:14px 0 0;color:#736f67;font-size:14px;line-height:1.6}@media(prefers-color-scheme:dark){body{background:#191917;color:#f3f1ec}main{border-color:#3b3a36;background:#262623}.icon{color:#ffaaa2;background:#492b28}p{color:#aaa69e}}</style></head>
<body><main><div class="icon">×</div><h1>Sign-in wasn’t completed</h1><p>Return to Quillium and try connecting your ChatGPT account again.</p></main></body></html>"#;

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
