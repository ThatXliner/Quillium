//! macos_comment_shortcut.rs — Routes Command-Option-M before AppKit menu dispatch.
//!
//! AppKit may consume this system-reserved chord before WKWebView receives a DOM
//! keydown. A local event monitor keeps the shortcut scoped to the active Quillium
//! process and forwards it to the focused webview's existing comment command.

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
use std::{ptr, ptr::NonNull};
use tauri::{Emitter, Manager};

const MAC_KEYCODE_M: u16 = 46;

fn is_comment_shortcut(key_code: u16, modifiers: NSEventModifierFlags) -> bool {
    let relevant_modifiers = modifiers
        & (NSEventModifierFlags::Command
            | NSEventModifierFlags::Option
            | NSEventModifierFlags::Control
            | NSEventModifierFlags::Shift);
    key_code == MAC_KEYCODE_M
        && relevant_modifiers == (NSEventModifierFlags::Command | NSEventModifierFlags::Option)
}

pub fn install(app: &tauri::App) -> Result<(), String> {
    let app_handle = app.handle().clone();
    let monitor_block = RcBlock::new(move |event_pointer: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit provides a valid NSEvent pointer for the duration of this callback.
        let event = unsafe { event_pointer.as_ref() };
        if !is_comment_shortcut(event.keyCode(), event.modifierFlags()) {
            return event_pointer.as_ptr();
        }

        let focused_window = app_handle
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false));
        let target_label = focused_window
            .as_ref()
            .map(|window| window.label().to_owned());
        let repeated = event.isARepeat();
        let emitted = !repeated
            && focused_window
                .as_ref()
                .is_some_and(|window| window.emit("native:comment-shortcut", ()).is_ok());
        let details = serde_json::json!({
            "keyCode": event.keyCode(),
            "modifierFlags": event.modifierFlags().bits(),
            "repeat": repeated,
            "targetWindow": target_label,
            "emitted": emitted,
        })
        .to_string();
        let _ = crate::app_log::log_event(
            &app_handle,
            if emitted { "info" } else { "warn" },
            "native-shortcut",
            if emitted {
                "comment shortcut intercepted before native menu dispatch"
            } else {
                "comment shortcut intercepted without a focused webview"
            },
            Some(&details),
        );

        if emitted || repeated {
            // Returning null prevents AppKit menu handling and a duplicate WKWebView keydown.
            ptr::null_mut()
        } else {
            event_pointer.as_ptr()
        }
    });

    // SAFETY: The block returns either the original event pointer or null, as required by
    // addLocalMonitorForEventsMatchingMask. The leaked monitor token intentionally lives for
    // the process lifetime; Quillium installs exactly one monitor during app setup.
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &monitor_block)
    }
    .ok_or_else(|| "failed to install native comment shortcut monitor".to_owned())?;
    std::mem::forget(monitor);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_command_option_m_with_ignored_device_flags() {
        assert!(is_comment_shortcut(
            MAC_KEYCODE_M,
            NSEventModifierFlags::Command
                | NSEventModifierFlags::Option
                | NSEventModifierFlags::CapsLock,
        ));
    }

    #[test]
    fn rejects_other_keys_and_extra_command_modifiers() {
        assert!(!is_comment_shortcut(
            MAC_KEYCODE_M - 1,
            NSEventModifierFlags::Command | NSEventModifierFlags::Option,
        ));
        assert!(!is_comment_shortcut(
            MAC_KEYCODE_M,
            NSEventModifierFlags::Command
                | NSEventModifierFlags::Option
                | NSEventModifierFlags::Shift,
        ));
        assert!(!is_comment_shortcut(
            MAC_KEYCODE_M,
            NSEventModifierFlags::Control | NSEventModifierFlags::Option,
        ));
    }
}
