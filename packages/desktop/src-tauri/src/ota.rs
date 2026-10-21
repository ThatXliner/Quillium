//! ota.rs owns native update trust, startup confirmation, and save-before-restart.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri_plugin_hot_update::{Config, HotUpdateExt, ReleaseContract, UpdateConfig, UpdateOutcome};

#[derive(Default)]
enum Phase {
    #[default]
    Startup,
    Idle,
    Saving(Attempt),
    Prepared(Attempt),
    Relaunching,
}

struct Attempt {
    id: String,
    owner: String,
    windows: BTreeMap<String, bool>,
    failure: Option<&'static str>,
}

#[derive(Default)]
struct Coordinator {
    phase: Phase,
}

impl Coordinator {
    fn ready(&mut self, caller: &str) -> Result<(), String> {
        if caller != "main" {
            return Err("Only the initial main window can confirm startup".into());
        }
        if matches!(self.phase, Phase::Startup) {
            self.phase = Phase::Idle;
        }
        Ok(())
    }

    fn allow_open(&self) -> Result<(), String> {
        match self.phase {
            Phase::Idle => Ok(()),
            Phase::Startup => Err("Wait for the initial window to finish loading".into()),
            _ => Err("An update restart is in progress".into()),
        }
    }

    fn begin(
        &mut self,
        id: String,
        owner: String,
        windows: BTreeSet<String>,
    ) -> Result<(), String> {
        self.allow_open()?;
        if windows.is_empty() {
            return Err("No windows can confirm saved changes".into());
        }
        if !windows.contains(&owner) {
            return Err("The requesting window is no longer open".into());
        }
        self.phase = Phase::Saving(Attempt {
            id,
            owner,
            windows: windows.into_iter().map(|label| (label, false)).collect(),
            failure: None,
        });
        Ok(())
    }

    fn acknowledge(&mut self, caller: &str, id: &str, failed: bool) {
        let Phase::Saving(attempt) = &mut self.phase else {
            return;
        };
        if attempt.id != id {
            return;
        }
        let Some(saved) = attempt.windows.get_mut(caller) else {
            return;
        };
        if *saved {
            return;
        }
        if failed {
            attempt.failure = Some("A window could not save its changes");
        } else {
            *saved = true;
        }
    }

    fn window_destroyed(&mut self, caller: &str) -> Option<String> {
        if let Phase::Prepared(attempt) = &self.phase {
            if attempt.owner == caller {
                let id = attempt.id.clone();
                self.phase = Phase::Idle;
                return Some(id);
            }
        }
        if let Phase::Saving(attempt) | Phase::Prepared(attempt) = &mut self.phase {
            if attempt.windows.contains_key(caller) {
                attempt.failure = Some("A window closed before the restart completed");
            }
        }
        None
    }

    fn prepare(&mut self, id: &str, live: BTreeSet<String>) -> Result<(), String> {
        if !self.poll(id)? {
            return Err("A window has not confirmed its save".into());
        }
        let Phase::Saving(attempt) = &self.phase else {
            return Err("Restart attempt is no longer active".into());
        };
        if live != attempt.windows.keys().cloned().collect() {
            return Err("The window roster changed during the restart".into());
        }
        if let Phase::Saving(attempt) = std::mem::take(&mut self.phase) {
            self.phase = Phase::Prepared(attempt);
        }
        Ok(())
    }

    fn relaunch(&mut self, owner: &str, id: &str, live: BTreeSet<String>) -> Result<(), String> {
        let Phase::Prepared(attempt) = &self.phase else {
            return Err("Update preparation is no longer active".into());
        };
        if attempt.owner != owner || attempt.id != id {
            return Err("Update preparation belongs to another window or attempt".into());
        }
        if attempt.failure.is_some() || live != attempt.windows.keys().cloned().collect() {
            return Err("A window closed before the restart completed".into());
        }
        self.phase = Phase::Relaunching;
        Ok(())
    }

    fn cancel_owned(&mut self, owner: &str, id: &str) -> Result<bool, String> {
        let (Phase::Saving(attempt) | Phase::Prepared(attempt)) = &self.phase else {
            return Ok(false);
        };
        if attempt.owner != owner || attempt.id != id {
            return Err("Update preparation belongs to another window or attempt".into());
        }
        Ok(self.cancel(id))
    }

    fn poll(&mut self, id: &str) -> Result<bool, String> {
        let Phase::Saving(attempt) = &self.phase else {
            return Err("Restart attempt is no longer active".into());
        };
        if attempt.id != id {
            return Err("Restart attempt changed".into());
        }
        if let Some(reason) = attempt.failure {
            return Err(reason.into());
        }
        Ok(attempt.windows.values().all(|saved| *saved))
    }

    fn cancel(&mut self, id: &str) -> bool {
        if matches!(&self.phase, Phase::Saving(attempt) | Phase::Prepared(attempt) if attempt.id == id)
        {
            self.phase = Phase::Idle;
            true
        } else {
            false
        }
    }
}

pub(crate) struct OtaState {
    coordinator: Mutex<Coordinator>,
    changed: tokio::sync::Notify,
    #[cfg(desktop)]
    update: Option<UpdateConfig>,
    blocked_reason: Option<String>,
}

impl OtaState {
    #[cfg(desktop)]
    pub(crate) fn configured(application_id: &str, native_version: &str) -> (Self, Config) {
        let key = option_env!("QUILLIUM_OTA_PUBLIC_KEY")
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let manifest_url = option_env!("QUILLIUM_OTA_MANIFEST_URL")
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|url| url.replace("{nativeVersion}", native_version));
        let native_revision = option_env!("QUILLIUM_OTA_NATIVE_REVISION").unwrap_or_default();
        let blocked_reason = if cfg!(feature = "mas") || cfg!(quillium_mas) {
            Some("Frontend updates are unavailable in the Mac App Store build".to_string())
        } else if key.is_none() || manifest_url.is_none() || native_revision.is_empty() {
            Some("Frontend updates are not configured in this native build".to_string())
        } else {
            None
        };
        let mut config = Config {
            enabled: blocked_reason.is_none(),
            manifest_url,
            pubkeys: key.into_iter().map(str::to_string).collect(),
            contract: Some(ReleaseContract {
                application_id: application_id.into(),
                channel: "stable".into(),
                state_format: "quillium-persisted-v1".into(),
                native_revision: native_revision.into(),
            }),
        };
        let (update, blocked_reason) = match config.validate() {
            Ok(update) => (update, blocked_reason),
            Err(error) => {
                config.enabled = false;
                (
                    None,
                    Some(format!("Frontend update configuration is invalid: {error}")),
                )
            }
        };
        (
            Self {
                coordinator: Mutex::new(Coordinator::default()),
                changed: tokio::sync::Notify::new(),
                update,
                blocked_reason,
            },
            config,
        )
    }

    #[cfg(mobile)]
    pub(crate) fn mobile() -> Self {
        Self {
            coordinator: Mutex::new(Coordinator::default()),
            changed: tokio::sync::Notify::new(),
            blocked_reason: Some("Frontend updates are unavailable on mobile".into()),
        }
    }

    pub(crate) fn with_window_open_gate(
        &self,
        create: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let guard = self.coordinator.lock().map_err(|e| e.to_string())?;
        guard.allow_open()?;
        create()
    }

    async fn wait_for_saves(&self, id: &str, deadline: Duration) -> Result<(), String> {
        tokio::time::timeout(deadline, async {
            loop {
                let changed = self.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                let finished = self
                    .coordinator
                    .lock()
                    .map_err(|e| e.to_string())?
                    .poll(id)?;
                if finished {
                    return Ok(());
                }
                changed.await;
            }
        })
        .await
        .map_err(|_| "A window did not confirm its save within 15 seconds".to_string())?
    }

    pub(crate) fn window_destroyed(&self, app: &tauri::AppHandle, label: &str) {
        let canceled = self
            .coordinator
            .lock()
            .ok()
            .and_then(|mut coordinator| coordinator.window_destroyed(label));
        self.changed.notify_one();
        if let Some(attempt_id) = canceled {
            let _ = app.emit("update:cancel", Prepare { attempt_id });
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    enabled: bool,
    native_version: String,
    frontend_version: String,
    source: &'static str,
    staged_version: Option<String>,
    blocked_reason: Option<String>,
}

#[tauri::command]
pub(crate) fn cmd_ota_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, OtaState>,
) -> Result<Status, String> {
    let native_version = app.package_info().version.to_string();
    let mut status = Status {
        enabled: false,
        frontend_version: native_version.clone(),
        native_version,
        source: "embedded",
        staged_version: None,
        blocked_reason: state.blocked_reason.clone(),
    };
    #[cfg(desktop)]
    if state.update.is_some() {
        let plugin = app.hot_update();
        match plugin.current_bundle() {
            Ok(current) => {
                status.frontend_version = current.version.to_string();
                status.source = match current.source {
                    tauri_plugin_hot_update::BundleSource::Embedded => "embedded",
                    tauri_plugin_hot_update::BundleSource::Ota => "ota",
                };
                status.staged_version = plugin
                    .staged_version()
                    .map_err(|e| e.to_string())?
                    .map(|version| version.to_string());
                status.enabled = !plugin.state_disabled().map_err(|e| e.to_string())?;
                if !status.enabled {
                    status.blocked_reason = Some(
                        "Frontend update state needs repair; the embedded frontend is active"
                            .into(),
                    );
                }
            }
            Err(error) => status.blocked_reason = Some(error.to_string()),
        }
    }
    Ok(status)
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum Acquisition {
    Available { version: String },
    Staged { version: String },
    Current,
    Disabled,
    Refused { reason: String },
}

#[cfg(desktop)]
fn acquisition(outcome: UpdateOutcome) -> Acquisition {
    match outcome {
        UpdateOutcome::Available { manifest } => Acquisition::Available {
            version: manifest.version.to_string(),
        },
        UpdateOutcome::Staged { version, .. } | UpdateOutcome::AlreadyStaged { version, .. } => {
            Acquisition::Staged {
                version: version.to_string(),
            }
        }
        UpdateOutcome::UpToDate { .. } => Acquisition::Current,
        refusal => Acquisition::Refused {
            reason: format!("{refusal:?}"),
        },
    }
}

#[tauri::command]
pub(crate) async fn cmd_ota_check(
    app: tauri::AppHandle,
    state: tauri::State<'_, OtaState>,
) -> Result<Acquisition, String> {
    #[cfg(desktop)]
    if let Some(config) = &state.update {
        if app.hot_update().state_disabled().unwrap_or(true) {
            return Ok(Acquisition::Disabled);
        }
        return app
            .hot_update()
            .check(config)
            .await
            .map(acquisition)
            .map_err(|e| e.to_string());
    }
    Ok(Acquisition::Disabled)
}

#[tauri::command]
pub(crate) async fn cmd_ota_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, OtaState>,
) -> Result<Acquisition, String> {
    #[cfg(desktop)]
    if let Some(config) = &state.update {
        if app.hot_update().state_disabled().unwrap_or(true) {
            return Ok(Acquisition::Disabled);
        }
        return app
            .hot_update()
            .check_and_download(config, |_, _| {})
            .await
            .map(acquisition)
            .map_err(|e| e.to_string());
    }
    Ok(Acquisition::Disabled)
}

#[tauri::command]
pub(crate) fn cmd_ota_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OtaState>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the initial main window can confirm startup".into());
    }
    #[cfg(desktop)]
    if state.update.is_some() {
        match app.hot_update().current_bundle() {
            Ok(current) if current.source == tauri_plugin_hot_update::BundleSource::Ota => {
                app.hot_update()
                    .notify_app_ready()
                    .map_err(|e| e.to_string())?;
            }
            Ok(_) | Err(tauri_plugin_hot_update::Error::NotActive) => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    state
        .coordinator
        .lock()
        .map_err(|e| e.to_string())?
        .ready(window.label())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Prepare {
    attempt_id: String,
}

#[tauri::command]
pub(crate) fn cmd_update_save_result(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OtaState>,
    attempt_id: String,
    error: Option<String>,
) -> Result<(), String> {
    state
        .coordinator
        .lock()
        .map_err(|e| e.to_string())?
        .acknowledge(window.label(), &attempt_id, error.is_some());
    state.changed.notify_one();
    Ok(())
}

#[cfg(desktop)]
async fn prepare_update(
    app: &tauri::AppHandle,
    state: &OtaState,
    owner: &str,
) -> Result<String, String> {
    let attempt_id = uuid::Uuid::new_v4().to_string();
    let windows = {
        let mut coordinator = state.coordinator.lock().map_err(|e| e.to_string())?;
        let windows = app.webview_windows();
        coordinator.begin(
            attempt_id.clone(),
            owner.into(),
            windows.keys().cloned().collect(),
        )?;
        windows
    };
    let payload = Prepare {
        attempt_id: attempt_id.clone(),
    };
    let result = async {
        for window in windows.values() {
            window
                .emit("update:prepare", payload.clone())
                .map_err(|e| e.to_string())?;
        }
        state
            .wait_for_saves(&attempt_id, Duration::from_secs(15))
            .await?;
        let mut coordinator = state.coordinator.lock().map_err(|e| e.to_string())?;
        coordinator.prepare(&attempt_id, app.webview_windows().keys().cloned().collect())
    }
    .await;
    if let Err(error) = result {
        state
            .coordinator
            .lock()
            .map_err(|e| e.to_string())?
            .cancel(&attempt_id);
        let _ = app.emit("update:cancel", payload);
        return Err(error);
    }
    Ok(attempt_id)
}

#[tauri::command]
pub(crate) async fn cmd_update_prepare(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OtaState>,
) -> Result<String, String> {
    #[cfg(mobile)]
    return Err("Update preparation is unavailable on mobile".into());
    #[cfg(desktop)]
    prepare_update(&app, &state, window.label()).await
}

#[tauri::command]
pub(crate) fn cmd_update_cancel(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OtaState>,
    attempt_id: String,
) -> Result<(), String> {
    let canceled = state
        .coordinator
        .lock()
        .map_err(|e| e.to_string())?
        .cancel_owned(window.label(), &attempt_id)?;
    if canceled {
        app.emit("update:cancel", Prepare { attempt_id })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn cmd_update_restart(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, OtaState>,
) -> Result<(), String> {
    #[cfg(mobile)]
    return Err("Update restart is unavailable on mobile".into());
    #[cfg(desktop)]
    {
        tauri::process::current_binary(&app.env()).map_err(|error| {
            format!("The application cannot restart from this location: {error}")
        })?;
        let attempt_id = prepare_update(&app, &state, window.label()).await?;
        let result = {
            let mut coordinator = state.coordinator.lock().map_err(|e| e.to_string())?;
            coordinator.relaunch(
                window.label(),
                &attempt_id,
                app.webview_windows().keys().cloned().collect(),
            )
        };
        if let Err(error) = result {
            state
                .coordinator
                .lock()
                .map_err(|e| e.to_string())?
                .cancel(&attempt_id);
            let _ = app.emit("update:cancel", Prepare { attempt_id });
            return Err(error);
        }
        app.restart();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(feature = "mas", quillium_mas))]
    #[test]
    fn mas_build_configuration_disables_frontend_updates() {
        let (state, config) = OtaState::configured("fixture.app", "9.0.0");
        assert!(!config.enabled);
        assert!(state.update.is_none());
        assert!(state.blocked_reason.unwrap().contains("Mac App Store"));
    }

    fn coordinator() -> Coordinator {
        let mut coordinator = Coordinator::default();
        assert!(coordinator.allow_open().is_err());
        assert!(coordinator.ready("editor-forged").is_err());
        coordinator.ready("main").unwrap();
        coordinator
            .begin(
                "attempt".into(),
                "main".into(),
                BTreeSet::from(["main".into(), "editor-one".into()]),
            )
            .unwrap();
        coordinator
    }

    #[test]
    fn restart_requires_each_captured_window_and_rejects_forged_and_stale_acks() {
        let mut coordinator = coordinator();
        coordinator.acknowledge("not-a-participant", "attempt", false);
        coordinator.acknowledge("main", "stale", false);
        assert!(!coordinator.poll("attempt").unwrap());
        coordinator.acknowledge("main", "attempt", false);
        coordinator.acknowledge("main", "attempt", false);
        assert!(!coordinator.poll("attempt").unwrap());
        coordinator.acknowledge("editor-one", "attempt", false);
        assert!(coordinator.poll("attempt").unwrap());
    }

    #[test]
    fn one_failed_window_vetoes_restart_even_after_other_window_saved() {
        let mut coordinator = coordinator();
        coordinator.acknowledge("main", "attempt", false);
        coordinator.acknowledge("editor-one", "attempt", true);
        assert!(coordinator.poll("attempt").is_err());
        coordinator.acknowledge("editor-one", "attempt", false);
        assert!(coordinator.poll("attempt").is_err());
    }

    #[test]
    fn duplicate_saved_ack_cannot_turn_success_into_failure() {
        let mut coordinator = coordinator();
        coordinator.acknowledge("main", "attempt", false);
        coordinator.acknowledge("main", "attempt", true);
        coordinator.acknowledge("editor-one", "attempt", false);
        assert!(coordinator.poll("attempt").unwrap());
    }

    #[test]
    fn disappearing_window_cancels_even_after_its_save() {
        let mut coordinator = coordinator();
        coordinator.acknowledge("editor-one", "attempt", false);
        coordinator.window_destroyed("editor-one");
        assert!(coordinator.poll("attempt").is_err());
    }

    fn prepared_coordinator() -> Coordinator {
        let mut coordinator = coordinator();
        coordinator.acknowledge("main", "attempt", false);
        coordinator.acknowledge("editor-one", "attempt", false);
        coordinator
            .prepare(
                "attempt",
                BTreeSet::from(["main".into(), "editor-one".into()]),
            )
            .unwrap();
        coordinator
    }

    #[test]
    fn prepared_install_keeps_window_gate_closed_until_its_owner_cancels() {
        let mut coordinator = prepared_coordinator();
        assert!(coordinator.allow_open().is_err());
        assert!(coordinator.cancel_owned("editor-one", "attempt").is_err());
        assert!(coordinator.cancel_owned("main", "stale").is_err());
        assert!(coordinator.allow_open().is_err());
        assert!(coordinator.cancel_owned("main", "attempt").unwrap());
        assert!(coordinator.allow_open().is_ok());
        assert!(!coordinator.cancel_owned("main", "attempt").unwrap());
    }

    #[test]
    fn preparation_cannot_finish_before_every_window_saved() {
        let mut coordinator = coordinator();
        assert!(coordinator
            .prepare(
                "attempt",
                BTreeSet::from(["main".into(), "editor-one".into()])
            )
            .is_err());
        assert!(coordinator.allow_open().is_err());
    }

    #[test]
    fn owner_disappearance_cancels_prepared_install_and_returns_its_unfreeze_token() {
        let mut coordinator = prepared_coordinator();
        assert_eq!(coordinator.window_destroyed("main"), Some("attempt".into()));
        assert!(coordinator.allow_open().is_ok());
    }

    #[test]
    fn relaunch_rechecks_prepared_identity_and_window_roster() {
        let mut coordinator = prepared_coordinator();
        let live = BTreeSet::from(["main".into(), "editor-one".into()]);
        assert!(coordinator
            .relaunch("editor-one", "attempt", live.clone())
            .is_err());
        assert!(coordinator.relaunch("main", "stale", live.clone()).is_err());
        assert!(coordinator
            .relaunch("main", "attempt", BTreeSet::from(["main".into()]))
            .is_err());
        coordinator.relaunch("main", "attempt", live).unwrap();
        assert!(matches!(coordinator.phase, Phase::Relaunching));
        assert!(coordinator.allow_open().is_err());
    }

    #[tokio::test]
    async fn missing_ack_times_out_and_cancellation_reopens_the_gate() {
        let state = OtaState {
            coordinator: Mutex::new(coordinator()),
            changed: tokio::sync::Notify::new(),
            #[cfg(desktop)]
            update: None,
            blocked_reason: None,
        };
        state
            .coordinator
            .lock()
            .unwrap()
            .acknowledge("main", "attempt", false);
        assert!(state
            .wait_for_saves("attempt", Duration::from_millis(2))
            .await
            .is_err());
        let mut coordinator = state.coordinator.lock().unwrap();
        assert!(coordinator.allow_open().is_err());
        coordinator.cancel("attempt");
        assert!(coordinator.allow_open().is_ok());
    }

    #[test]
    fn gate_stays_closed_until_matching_attempt_is_canceled() {
        let mut coordinator = coordinator();
        assert!(coordinator.allow_open().is_err());
        coordinator.cancel("stale");
        assert!(coordinator.allow_open().is_err());
        assert!(!coordinator.poll("attempt").unwrap());
        coordinator.cancel("attempt");
        assert!(coordinator.allow_open().is_ok());
        coordinator.acknowledge("main", "attempt", false);
        assert!(coordinator.poll("attempt").is_err());
    }
}
