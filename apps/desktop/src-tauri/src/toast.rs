use crate::error::AppError;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
};

pub const TOAST_LABEL: &str = "toast";

const TOAST_W: f64 = 360.0;
const TOAST_H: f64 = 128.0;
const MARGIN: f64 = 20.0;

/// Lifecycle phase the toast should render. `Capturing` is the instant,
/// preview-less "Saving…" state shown the moment a capture is triggered;
/// `Ready` is the final state with the preview thumbnail + real countdown.
#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ToastPhase {
    Capturing,
    Ready,
}

/// Show (or reuse) the capture-confirmation toast in the bottom-right corner of
/// the primary monitor. The toast webview drives its own countdown and click
/// handling, calling back into Rust via `toast_edit` / `toast_dismiss`.
///
/// `phase` selects the instant "Capturing…" state vs. the final "Ready" state;
/// the same window is reused across phases so the toast never re-animates in.
pub fn show_toast(app: &AppHandle, phase: ToastPhase) -> Result<(), AppError> {
    let (x, y) = corner_position(app)?;

    // The window is normally pre-created (hidden) at startup so the first show
    // is instant. If it isn't (pre-create failed), build it lazily now.
    let win = match app.get_webview_window(TOAST_LABEL) {
        Some(win) => win,
        None => build_toast_window(app)?,
    };

    win.set_position(LogicalPosition::new(x, y))
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    win.show().map_err(|e| AppError::Overlay(e.to_string()))?;
    win.set_focus().ok();
    app.emit_to(TOAST_LABEL, "toast:phase", phase)
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

/// Build the toast window (hidden). Shared by `show_toast` (lazy build) and
/// `precreate_toast` (startup warm-up) so the first capture shows it instantly.
fn build_toast_window(app: &AppHandle) -> Result<tauri::WebviewWindow, AppError> {
    let (x, y) = corner_position(app)?;
    // Boot with the `capturing` phase so the pre-created webview's initial
    // render matches the region path's first show without waiting on an event.
    WebviewWindowBuilder::new(app, TOAST_LABEL, WebviewUrl::App("toast.html#capturing".into()))
        .inner_size(TOAST_W, TOAST_H)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| AppError::Overlay(e.to_string()))
}

/// Pre-create the toast window (hidden) at startup so the first capture reveals
/// it instantly instead of paying the webview build + JS load cost inline.
/// Best-effort: a failure is rebuilt lazily by `show_toast`.
pub fn precreate_toast(app: &AppHandle) {
    if app.get_webview_window(TOAST_LABEL).is_some() {
        return;
    }
    let _ = build_toast_window(app);
}

/// Hide the toast window (kept alive for reuse).
pub fn hide_toast(app: &AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window(TOAST_LABEL) {
        win.hide().map_err(|e| AppError::Overlay(e.to_string()))?;
    }
    Ok(())
}

/// Bottom-right logical position for the toast on the primary monitor.
fn corner_position(app: &AppHandle) -> Result<(f64, f64), AppError> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| AppError::Overlay(format!("primary monitor: {e}")))?
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        })
        .ok_or_else(|| AppError::Overlay("no monitor".into()))?;

    let scale = monitor.scale_factor();
    let pos = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);
    let x = pos.x + size.width - TOAST_W - MARGIN;
    let y = pos.y + size.height - TOAST_H - MARGIN;
    let _ = LogicalSize::new(TOAST_W, TOAST_H);
    Ok((x, y))
}
