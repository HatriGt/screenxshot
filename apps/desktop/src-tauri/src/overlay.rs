use crate::error::AppError;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OVERLAY_LABEL: &str = "overlay";

/// Show the transparent, fullscreen, always-on-top region-select overlay on the
/// primary monitor. Reuses an existing overlay window if one is already open.
pub fn show_overlay(app: &AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
        win.show().map_err(|e| AppError::Overlay(e.to_string()))?;
        win.set_focus()
            .map_err(|e| AppError::Overlay(e.to_string()))?;
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("overlay.html".into()),
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .fullscreen(true)
    .resizable(false)
    .shadow(false)
    .build()
    .map_err(|e| AppError::Overlay(e.to_string()))?;

    win.set_focus()
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

/// Close the overlay window if present.
pub fn hide_overlay(app: &AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
        win.close().map_err(|e| AppError::Overlay(e.to_string()))?;
    }
    Ok(())
}
