use crate::error::AppError;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
};

/// Label prefix for overlay windows. One overlay is created per monitor, labeled
/// `overlay-0`, `overlay-1`, ... in monitor-enumeration order.
pub const OVERLAY_LABEL_PREFIX: &str = "overlay-";

/// Build the overlay window label for a given monitor index.
pub fn overlay_label(index: usize) -> String {
    format!("{OVERLAY_LABEL_PREFIX}{index}")
}

/// Whether a window label belongs to an overlay window.
pub fn is_overlay_label(label: &str) -> bool {
    label.starts_with(OVERLAY_LABEL_PREFIX)
}

/// Show a region-select overlay covering every monitor.
///
/// Each overlay is a borderless, transparent, always-on-top window positioned
/// and sized to exactly cover one monitor. Windows are created once (hidden) and
/// reused on subsequent captures — we never rebuild them, which is what caused
/// the flicker/lag. We deliberately avoid `fullscreen(true)`: on macOS that
/// triggers a Space transition and can break transparency.
pub fn show_overlay(app: &AppHandle) -> Result<(), AppError> {
    let monitors = app
        .available_monitors()
        .map_err(|e| AppError::Overlay(format!("enumerate monitors: {e}")))?;
    if monitors.is_empty() {
        return Err(AppError::Overlay("no monitors found".into()));
    }

    for (index, monitor) in monitors.iter().enumerate() {
        let label = overlay_label(index);
        let scale = monitor.scale_factor();
        let pos = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);

        let win = match app.get_webview_window(&label) {
            Some(win) => win,
            // Not pre-created (or a monitor was hot-plugged): build it now.
            None => build_overlay_window(app, &label, pos, size)?,
        };

        // Reposition (monitors can change) then reveal + focus.
        win.set_position(LogicalPosition::new(pos.x, pos.y))
            .map_err(|e| AppError::Overlay(e.to_string()))?;
        win.set_size(LogicalSize::new(size.width, size.height))
            .map_err(|e| AppError::Overlay(e.to_string()))?;
        win.show().map_err(|e| AppError::Overlay(e.to_string()))?;
        win.set_focus()
            .map_err(|e| AppError::Overlay(e.to_string()))?;
        // Re-arm the overlay's frontend (resets its `finished` flag).
        win.emit("overlay:arm", ())
            .map_err(|e| AppError::Overlay(e.to_string()))?;
    }

    // On macOS the app must be active for a borderless window to receive key
    // events (so Escape works). Activate it explicitly.
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        let _ = app.set_activation_policy(ActivationPolicy::Regular);
    }

    Ok(())
}

/// Build a single overlay window covering one monitor. Created hidden; the
/// caller reveals it. Shared by `show_overlay` (lazy build) and
/// `precreate_overlays` (startup warm-up) so the first hotkey press is instant.
fn build_overlay_window(
    app: &AppHandle,
    label: &str,
    pos: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<tauri::WebviewWindow, AppError> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("overlay.html".into()))
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        // Register the first click even when the overlay isn't the key
        // window yet — essential on macOS or the initial drag is eaten.
        .accept_first_mouse(true)
        // Cover fullscreen Spaces too, not just the active desktop.
        .visible_on_all_workspaces(true)
        .position(pos.x, pos.y)
        .inner_size(size.width, size.height)
        .visible(false)
        .build()
        .map_err(|e| AppError::Overlay(e.to_string()))
}

/// Pre-create the overlay windows (hidden) at startup so the first hotkey press
/// shows them instantly instead of paying the webview build cost inline. Runs
/// best-effort: any monitor that fails is rebuilt lazily by `show_overlay`.
pub fn precreate_overlays(app: &AppHandle) {
    let Ok(monitors) = app.available_monitors() else {
        return;
    };
    for (index, monitor) in monitors.iter().enumerate() {
        let label = overlay_label(index);
        if app.get_webview_window(&label).is_some() {
            continue;
        }
        let scale = monitor.scale_factor();
        let pos = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        let _ = build_overlay_window(app, &label, pos, size);
    }
}

/// Whether any overlay window is currently visible (a capture selection is in
/// progress). Used by the startup fallback timer so it never reveals the main
/// window over an active overlay.
pub fn any_overlay_visible(app: &AppHandle) -> bool {
    app.webview_windows().iter().any(|(label, win)| {
        is_overlay_label(label) && win.is_visible().unwrap_or(false)
    })
}

/// Hide every overlay window (kept alive for the next capture — no rebuild).
pub fn hide_overlay(app: &AppHandle) -> Result<(), AppError> {
    for (label, win) in app.webview_windows() {
        if is_overlay_label(&label) {
            win.hide().map_err(|e| AppError::Overlay(e.to_string()))?;
        }
    }
    Ok(())
}

/// Dismiss the overlay on user cancel (Esc / Cancel). Hides the overlays and,
/// on macOS, drops the app back to `Accessory` so the OS doesn't promote the
/// next app window (the editor) to the front when `Regular` loses its key
/// window. `show_overlay` re-arms `Regular` on the next capture.
pub fn dismiss_overlay(app: &AppHandle) -> Result<(), AppError> {
    hide_overlay(app)?;
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        let _ = app.set_activation_policy(ActivationPolicy::Accessory);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_label_is_indexed() {
        assert_eq!(overlay_label(0), "overlay-0");
        assert_eq!(overlay_label(3), "overlay-3");
    }

    #[test]
    fn is_overlay_label_matches_only_overlays() {
        assert!(is_overlay_label("overlay-0"));
        assert!(is_overlay_label("overlay-12"));
        assert!(!is_overlay_label("main"));
        assert!(!is_overlay_label("settings"));
    }
}
