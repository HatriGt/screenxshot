use crate::error::AppError;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const PIN_LABEL: &str = "pin";

const PIN_W: f64 = 520.0;
const PIN_H: f64 = 420.0;

/// Open (or reuse) the live editable pin window: a small borderless,
/// always-on-top webview that hosts the shared editor fed the buffered capture.
///
/// The window is reused across pins; each call reveals it and re-signals the
/// webview to (re)load the latest `CaptureBuffer` bytes via `pin:load`.
pub fn show_pin(app: &AppHandle) -> Result<(), AppError> {
    use tauri::Emitter;

    let win = match app.get_webview_window(PIN_LABEL) {
        Some(win) => win,
        None => build_pin_window(app)?,
    };

    win.show().map_err(|e| AppError::Overlay(e.to_string()))?;
    win.set_focus().ok();
    win.emit_to(PIN_LABEL, "pin:load", ())
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

/// Build the pin window (hidden). Borderless + always-on-top, mirroring the
/// overlay/toast builders. `always_on_top(true)` maps to the floating window
/// level (above normal windows) on both macOS and Windows; on macOS we also
/// span all workspaces so the pin floats over fullscreen Spaces like the
/// overlay does. The macOS-only call is guarded with `cfg(target_os)`.
fn build_pin_window(app: &AppHandle) -> Result<tauri::WebviewWindow, AppError> {
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, PIN_LABEL, WebviewUrl::App("pin.html".into()))
        .title("Pinned capture")
        .inner_size(PIN_W, PIN_H)
        .min_inner_size(280.0, 240.0)
        .max_inner_size(1100.0, 900.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        // Native OS shadow would double up with the CSS floating-card shadow and
        // fight the rounded, transparent corners — the card paints its own.
        .shadow(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder.visible_on_all_workspaces(true);
    }

    builder
        .visible(false)
        .build()
        .map_err(|e| AppError::Overlay(e.to_string()))
}

/// Pre-create the pin window (hidden) at startup so the first pin is instant.
/// Best-effort: a failure is rebuilt lazily by `show_pin`.
pub fn precreate_pin(app: &AppHandle) {
    if app.get_webview_window(PIN_LABEL).is_some() {
        return;
    }
    let _ = build_pin_window(app);
}

/// Hide the pin window (kept alive for reuse).
pub fn hide_pin(app: &AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window(PIN_LABEL) {
        win.hide().map_err(|e| AppError::Overlay(e.to_string()))?;
    }
    Ok(())
}
