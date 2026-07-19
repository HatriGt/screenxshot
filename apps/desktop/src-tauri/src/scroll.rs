//! Scrolling / long-screenshot capture session + its floating control window.
//!
//! Flow (manual multi-shot stitch — works identically on macOS + Windows):
//! 1. The user picks a region in the overlay in "Long screenshot" mode, which
//!    calls `scroll_start` (see commands.rs). That records the region in the
//!    managed [`ScrollSession`], grabs the first frame, and shows the small
//!    always-on-top control window built here.
//! 2. The user scrolls the underlying content and clicks "Capture next"; each
//!    click calls `scroll_capture_frame`, which hides our chrome, grabs the
//!    same region again, and pushes the frame.
//! 3. "Done" calls `scroll_finish`, which stitches the frames (see
//!    `crate::stitch`) and delivers the tall image through the normal capture
//!    dispatch (editor/pin/toast).
//!
//! The control window mirrors the toast/pin builders: borderless, transparent,
//! always-on-top, skip-taskbar, reused across sessions. It is hidden before
//! every grab (via `hide_capture_chrome`) so it never lands in a frame.

use crate::capture::CaptureRect;
use crate::error::AppError;
use image::RgbaImage;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SCROLL_LABEL: &str = "scroll";

const SCROLL_W: f64 = 300.0;
const SCROLL_H: f64 = 96.0;
const MARGIN: f64 = 20.0;

/// In-progress long-screenshot capture. Held in Tauri managed state. `None`
/// (empty rect/frames) means no session is active.
#[derive(Default)]
pub struct ScrollSession(pub Mutex<Option<ScrollState>>);

/// The mutable state of one long-screenshot session.
pub struct ScrollState {
    /// Region to grab for every frame (monitor-local physical pixels).
    pub rect: CaptureRect,
    /// Physical top-left of the monitor the region was drawn on, used to match
    /// the same `xcap::Monitor` for every frame (see M3). `None` = primary.
    pub target: Option<crate::commands::MonitorPos>,
    /// Captured frames, top-to-bottom in capture order.
    pub frames: Vec<RgbaImage>,
}

/// Event payload sent to the control window so it can show the running frame
/// count ("2 captured").
#[derive(Clone, Copy, serde::Serialize)]
struct ScrollProgress {
    frames: usize,
}

/// Show (or reuse) the floating "Capture next / Done" control in the
/// bottom-right of the session's target monitor, and push the current frame
/// count.
pub fn show_control(
    app: &AppHandle,
    frames: usize,
    target: Option<crate::commands::MonitorPos>,
) -> Result<(), AppError> {
    let (x, y) = corner_position(app, target)?;
    let win = match app.get_webview_window(SCROLL_LABEL) {
        Some(win) => win,
        None => build_control_window(app, target)?,
    };
    win.set_position(LogicalPosition::new(x, y))
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    win.show().map_err(|e| AppError::Overlay(e.to_string()))?;
    win.set_focus().ok();
    // Emit the current count. A freshly-built control window's webview may not
    // have registered its `scroll:progress` listener yet, so the first push can
    // be missed (M4). The webview re-requests the count via `scroll_ready` on
    // mount; this emit covers the reused-window case.
    app.emit_to(SCROLL_LABEL, "scroll:progress", ScrollProgress { frames })
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

/// Re-emit the active session's current frame count to the control window.
/// Called by the `scroll_ready` command once the control webview has mounted
/// and its `scroll:progress` listener is live, so the first count is never lost
/// to a listen/emit race on a freshly-built window (M4).
pub fn emit_current_count(app: &AppHandle, session: &ScrollSession) -> Result<(), AppError> {
    let frames = crate::lock_recover(&session.0)
        .as_ref()
        .map(|s| s.frames.len())
        .unwrap_or(0);
    app.emit_to(SCROLL_LABEL, "scroll:progress", ScrollProgress { frames })
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

/// Build the control window (hidden). Mirrors the toast/pin builders.
fn build_control_window(
    app: &AppHandle,
    target: Option<crate::commands::MonitorPos>,
) -> Result<tauri::WebviewWindow, AppError> {
    let (x, y) = corner_position(app, target)?;
    WebviewWindowBuilder::new(app, SCROLL_LABEL, WebviewUrl::App("scroll.html".into()))
        .title("Long screenshot")
        .inner_size(SCROLL_W, SCROLL_H)
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

/// Pre-create the control window (hidden) at startup so the first long
/// screenshot shows it instantly. Best-effort: rebuilt lazily by `show_control`.
pub fn precreate_control(app: &AppHandle) {
    if app.get_webview_window(SCROLL_LABEL).is_some() {
        return;
    }
    let _ = build_control_window(app, None);
}

/// Hide the control window (kept alive for reuse).
pub fn hide_control(app: &AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window(SCROLL_LABEL) {
        win.hide().map_err(|e| AppError::Overlay(e.to_string()))?;
    }
    Ok(())
}

/// Bottom-right logical position for the control on the session's target
/// monitor (the one the region was drawn on). Falls back to the primary monitor
/// when there is no target or none matches (M5).
fn corner_position(
    app: &AppHandle,
    target: Option<crate::commands::MonitorPos>,
) -> Result<(f64, f64), AppError> {
    let monitor = target
        .and_then(|t| monitor_at(app, t))
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| {
            app.available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        })
        .ok_or_else(|| AppError::Overlay("no monitor".into()))?;
    let scale = monitor.scale_factor();
    let pos = monitor.position().to_logical::<f64>(scale);
    let x = pos.x + monitor.size().to_logical::<f64>(scale).width - SCROLL_W - MARGIN;
    let y = pos.y + monitor.size().to_logical::<f64>(scale).height - SCROLL_H - MARGIN;
    Ok((x, y))
}

/// The Tauri monitor whose physical top-left matches `target`. `target` is
/// sourced from Tauri's `available_monitors()` positions (see
/// `overlay_monitor_pos`), so an exact match is reliable.
fn monitor_at(app: &AppHandle, target: crate::commands::MonitorPos) -> Option<tauri::Monitor> {
    app.available_monitors().ok()?.into_iter().find(|m| {
        let p = m.position();
        p.x == target.x && p.y == target.y
    })
}
