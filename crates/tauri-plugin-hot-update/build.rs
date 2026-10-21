const COMMANDS: &[&str] = &[
    "check",
    "download",
    "notify_app_ready",
    "current_bundle",
    "reset",
    "apply",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
