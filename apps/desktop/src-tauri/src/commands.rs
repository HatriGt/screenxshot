use crate::capture::{clamp_rect, CaptureRect};
use crate::error::AppError;
use crate::lock_recover;
use crate::overlay;
use crate::settings::{ExportFormat, Settings};
use image::codecs::jpeg::JpegEncoder;
use image::{ImageFormat, RgbaImage};
use std::io::Cursor;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};
use xcap::Monitor;

/// Holds the most recent capture's PNG bytes until the editor pulls them.
#[derive(Default)]
pub struct CaptureBuffer(pub Mutex<Option<Vec<u8>>>);

/// Show the region-select overlay (invoked by the hotkey or a UI trigger).
#[tauri::command]
pub fn show_overlay(app: AppHandle) -> Result<(), AppError> {
    overlay::show_overlay(&app)
}

/// The main webview has mounted React + painted its first frame, so the window
/// (created hidden to avoid a cold-start black flash while the JS bundle loads)
/// can now be revealed. Idempotent: a no-op if the window is already visible or
/// was already shown by a capture path / the setup fallback timeout.
///
/// Also marks the startup reveal as done (`MainRevealed`), which disarms the
/// setup fallback timer so it can never later surface the main window over a
/// capture overlay. In normal launches this fires within a couple frames, long
/// before the 4s fallback.
#[tauri::command]
pub fn main_ready(app: AppHandle) -> Result<(), AppError> {
    // Disarm the startup fallback timer: the frontend has painted, so the
    // one-time reveal is (or is about to be) handled here.
    if let Some(state) = app.try_state::<crate::MainRevealed>() {
        state.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    if let Some(main) = app.get_webview_window("main") {
        if !main.is_visible().unwrap_or(false) {
            main.show().map_err(|e| AppError::Overlay(e.to_string()))?;
            main.set_focus()
                .map_err(|e| AppError::Overlay(e.to_string()))?;
        }
    }
    Ok(())
}

/// Open (or focus) the Settings window.
#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), AppError> {
    crate::settings::open_settings_window(&app)
}

/// Cancel selection: close the overlay, no capture. Leaves the app in the
/// background — Esc must dismiss the overlay without surfacing the editor.
#[tauri::command]
pub fn cancel_overlay(app: AppHandle) -> Result<(), AppError> {
    overlay::dismiss_overlay(&app)
}

/// Finish selection: capture the chosen region, close the overlay, reveal the
/// main window, and notify it that a capture is ready to pull.
///
/// `monitor_index` is the overlay's monitor index (its window covered exactly
/// one monitor); the rect is in that monitor's local physical pixels.
#[tauri::command]
pub async fn finish_capture(
    app: AppHandle,
    rect: CaptureRect,
    monitor_index: Option<usize>,
    buffer: State<'_, CaptureBuffer>,
) -> Result<(), AppError> {
    // A region grab only reads the user-drawn sub-rect, never the whole screen,
    // so the bottom-right toast is not in-frame for it. Show the toast INSTANTLY
    // in the preview-less "Capturing…" state before the (short) settle + grab,
    // then flip it to the final "Ready" state once bytes exist. This is only
    // safe here — fullscreen/window grabs would capture the toast, so those
    // paths keep the toast hidden until after the grab (see dispatch_capture).
    if matches!(
        crate::settings::load(&app).after_capture,
        crate::settings::AfterCapture::CopyRaw | crate::settings::AfterCapture::CopyStyled
    ) {
        let _ = crate::toast::show_toast(&app, crate::toast::ToastPhase::Capturing);
    }
    // Hide our own chrome BEFORE capturing so the dim overlay doesn't tint the
    // grabbed region. The crop is a sub-region of the monitor, so a short settle
    // is enough — no need for the long full-screen settle used by the
    // fullscreen/window paths.
    //
    // The just-shown "Capturing…" toast sits bottom-right; a region drawn over
    // that corner WOULD bake it into the crop. It has already flashed in (the
    // user got instant feedback), so hide it for the ~60ms grab and re-show it
    // populated (Ready) afterwards — correct capture, still instant-feeling.
    let target = overlay_monitor_pos(&app, monitor_index);
    hide_capture_chrome(&app)?;
    let img = tauri::async_runtime::spawn_blocking(move || {
        wait_for_compositor(CompositorSettle::Region);
        capture_region_image_by_pos(rect, target)
    })
    .await
    .map_err(|e| AppError::Capture(format!("capture task failed: {e}")))??;

    dispatch_capture(&app, &buffer, img)
}

/// Begin a scrolling / long-screenshot session on the region the user drew in
/// the overlay (Long-screenshot mode). Records the region in managed state,
/// grabs the first frame, and reveals the floating "Capture next / Done"
/// control. New command — additive to the existing region/fullscreen/window
/// capture paths.
#[tauri::command]
pub async fn scroll_start(
    app: AppHandle,
    rect: CaptureRect,
    monitor_index: Option<usize>,
    session: State<'_, crate::scroll::ScrollSession>,
) -> Result<(), AppError> {
    // Hide our chrome (overlay/toast) before the first grab, like the region
    // path, so the dim overlay doesn't tint the frame.
    let target = overlay_monitor_pos(&app, monitor_index);
    hide_capture_chrome(&app)?;
    let img = tauri::async_runtime::spawn_blocking(move || {
        wait_for_compositor(CompositorSettle::Region);
        capture_region_image_by_pos(rect, target)
    })
    .await
    .map_err(|e| AppError::Capture(format!("capture task failed: {e}")))??;

    *lock_recover(&session.0) = Some(crate::scroll::ScrollState {
        rect,
        target,
        frames: vec![img],
    });
    crate::scroll::show_control(&app, 1, target)
}

/// Grab one more frame of the session's region and append it. The user scrolls
/// the underlying content between calls; overlap is de-duplicated at finish.
#[tauri::command]
pub async fn scroll_capture_frame(
    app: AppHandle,
    session: State<'_, crate::scroll::ScrollSession>,
) -> Result<(), AppError> {
    // Read the region + monitor while NOT holding the lock across the await.
    let (rect, target) = {
        let guard = lock_recover(&session.0);
        let state = guard
            .as_ref()
            .ok_or_else(|| AppError::Capture("no scroll session".into()))?;
        (state.rect, state.target)
    };

    // Hide the control (and other chrome) so it isn't baked into the frame.
    crate::scroll::hide_control(&app)?;
    let img = tauri::async_runtime::spawn_blocking(move || {
        wait_for_compositor(CompositorSettle::Region);
        capture_region_image_by_pos(rect, target)
    })
    .await
    .map_err(|e| AppError::Capture(format!("capture task failed: {e}")))??;

    let frames = {
        let mut guard = lock_recover(&session.0);
        let state = guard
            .as_mut()
            .ok_or_else(|| AppError::Capture("no scroll session".into()))?;
        state.frames.push(img);
        state.frames.len()
    };
    // Re-show the control with the updated count.
    crate::scroll::show_control(&app, frames, target)
}

/// Called by the control webview once it has mounted and registered its
/// `scroll:progress` listener. Re-emits the active session's current frame count
/// so the first count is never lost to a listen/emit race on a freshly-built
/// control window (M4). Mirrors the `main_ready` handshake.
#[tauri::command]
pub fn scroll_ready(
    app: AppHandle,
    session: State<'_, crate::scroll::ScrollSession>,
) -> Result<(), AppError> {
    crate::scroll::emit_current_count(&app, &session)
}

/// Finish the session: stitch every frame into one tall image (de-duplicating
/// overlap) and deliver it through the normal after-capture dispatch. Clears
/// the session and hides the control.
#[tauri::command]
pub fn scroll_finish(
    app: AppHandle,
    session: State<'_, crate::scroll::ScrollSession>,
    buffer: State<'_, CaptureBuffer>,
) -> Result<(), AppError> {
    // Stitch from a CLONE of the frames first; only clear the session once the
    // whole finish (stitch + dispatch) succeeds. If stitching or dispatch fails,
    // the session (and its captured frames) stays intact so the user can retry
    // "Done" instead of silently losing every frame.
    let stitched = {
        let guard = lock_recover(&session.0);
        let state = guard
            .as_ref()
            .ok_or_else(|| AppError::Capture("no scroll session".into()))?;
        crate::stitch::stitch_all(&state.frames)
            .ok_or_else(|| AppError::Capture("no frames captured".into()))?
    };
    crate::scroll::hide_control(&app)?;
    dispatch_capture(&app, &buffer, stitched)?;
    // Success: now it's safe to drop the session.
    *lock_recover(&session.0) = None;
    Ok(())
}

/// Cancel the session without stitching: drop frames and hide the control.
#[tauri::command]
pub fn scroll_cancel(
    app: AppHandle,
    session: State<'_, crate::scroll::ScrollSession>,
) -> Result<(), AppError> {
    *lock_recover(&session.0) = None;
    crate::scroll::hide_control(&app)
}

/// Route freshly-captured PNG bytes through the configured after-capture mode.
///
/// `OpenEditor` shows the main window and signals the editor to load the buffer.
/// `CopyRaw` / `CopyStyled` keep the editor hidden and hand off to the main
/// webview's JS pipeline (clipboard + auto-save + toast).
fn dispatch_capture(
    app: &AppHandle,
    buffer: &State<'_, CaptureBuffer>,
    img: RgbaImage,
) -> Result<(), AppError> {
    let settings = crate::settings::load(app);
    match settings.after_capture {
        crate::settings::AfterCapture::OpenEditor => {
            // Editor needs the PNG buffered before it pulls; encode up front.
            *lock_recover(&buffer.0) = Some(encode_png(img)?);
            if let Some(main) = app.get_webview_window("main") {
                main.show().map_err(|e| AppError::Overlay(e.to_string()))?;
                main.set_focus()
                    .map_err(|e| AppError::Overlay(e.to_string()))?;
            }
            // A capture surfaced the main window; mark the startup reveal done
            // so the fallback timer stays disarmed.
            if let Some(state) = app.try_state::<crate::MainRevealed>() {
                state.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
            app.emit("capture:ready", ())
                .map_err(|e| AppError::Overlay(e.to_string()))?;
        }
        crate::settings::AfterCapture::CopyRaw => {
            // Buffer the PNG FIRST so the toast's preview peek always finds
            // bytes, then flip the toast to its final "Ready" state (this reuses
            // the "Capturing…" toast the region path already showed, or shows a
            // fresh one for fullscreen/window now that the grab is done and the
            // toast can no longer land in-frame). Copy + save follow.
            let bytes = encode_png(img)?;
            *lock_recover(&buffer.0) = Some(bytes.clone());
            let _ = crate::toast::show_toast(app, crate::toast::ToastPhase::Ready);
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.hide();
            }
            copy_image_to_clipboard(app, &bytes);
            let _ = auto_save_bytes(app, &bytes);
        }
        crate::settings::AfterCapture::CopyStyled => {
            // Styled bytes can only be produced by the JS editor, so the
            // clipboard + save stay in JS. Buffer the raw PNG first (so the
            // toast preview peek succeeds), flip the toast to "Ready", then hand
            // the styling work to the webview.
            *lock_recover(&buffer.0) = Some(encode_png(img)?);
            let _ = crate::toast::show_toast(app, crate::toast::ToastPhase::Ready);
            let payload = AutoCapturePayload {
                mode: settings.after_capture,
                style: settings.default_style.clone(),
            };
            if let Some(main) = app.get_webview_window("main") {
                main.emit("capture:auto", payload)
                    .map_err(|e| AppError::Overlay(e.to_string()))?;
                let _ = main.hide();
            }
        }
    }
    Ok(())
}

/// Write PNG bytes to the system clipboard as an image (Copy Raw path). Logs on
/// failure rather than aborting — the toast + auto-save should still proceed.
fn copy_image_to_clipboard(app: &AppHandle, png: &[u8]) {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    match tauri::image::Image::from_bytes(png) {
        Ok(img) => {
            if let Err(e) = app.clipboard().write_image(&img) {
                eprintln!("auto clipboard failed: {e}");
            }
        }
        Err(e) => eprintln!("decode capture for clipboard failed: {e}"),
    }
}

/// Save PNG bytes to the configured folder (best-effort; no-op if unset).
fn auto_save_bytes(app: &AppHandle, bytes: &[u8]) -> Result<(), AppError> {
    let settings = crate::settings::load(app);
    if settings.save_dir.trim().is_empty() {
        return Ok(());
    }
    let out = encode_for_export(bytes, settings.export_format)?;
    let name = format!(
        "ScreenXShot-{}.{}",
        timestamp(),
        settings.export_format.extension()
    );
    let path = std::path::Path::new(&settings.save_dir).join(name);
    write_file(&path, &out)?;
    // Index the save for the history panel + tray Recents (best-effort).
    if let Err(e) = crate::history::record_save(app, &path.to_string_lossy(), Some(bytes)) {
        eprintln!("history record failed: {e}");
    }
    Ok(())
}

/// Capture an entire monitor (the one the overlay was shown on) and route it
/// through the after-capture dispatch. Invoked by the overlay's "Whole screen"
/// toolbar button.
#[tauri::command]
pub async fn capture_fullscreen(
    app: AppHandle,
    monitor_index: Option<usize>,
    buffer: State<'_, CaptureBuffer>,
) -> Result<(), AppError> {
    // Hide our own chrome BEFORE capturing so it doesn't appear in the frame.
    // Fullscreen grabs the whole monitor, so the toast MUST be hidden too.
    let target = overlay_monitor_pos(&app, monitor_index);
    hide_capture_chrome(&app)?;
    let img = tauri::async_runtime::spawn_blocking(move || {
        wait_for_compositor(CompositorSettle::FullScreen);
        capture_full_monitor_image(target)
    })
    .await
    .map_err(|e| AppError::Capture(format!("capture task failed: {e}")))??;
    dispatch_capture(&app, &buffer, img)
}

/// Capture the frontmost application window (skipping our own overlay) and route
/// it through the after-capture dispatch. Invoked by the overlay's "Window"
/// toolbar button.
#[tauri::command]
pub async fn capture_window(
    app: AppHandle,
    buffer: State<'_, CaptureBuffer>,
) -> Result<(), AppError> {
    // Hide our own chrome BEFORE capturing so it doesn't appear in the frame.
    // A window grab can include the toast, so hide it too.
    hide_capture_chrome(&app)?;
    let img = tauri::async_runtime::spawn_blocking(|| {
        wait_for_compositor(CompositorSettle::FullScreen);
        capture_front_window_image()
    })
    .await
    .map_err(|e| AppError::Capture(format!("capture task failed: {e}")))??;
    dispatch_capture(&app, &buffer, img)
}

/// One on-screen window enumerated for the window-capture picker.
///
/// Bounds are in GLOBAL physical pixels (xcap's coordinate space): `x`/`y` are
/// the window's top-left in the virtual-desktop origin, matching monitor
/// positions from `xcap::Monitor`. The frontend translates these into each
/// per-monitor overlay's local CSS coords for hit-testing + highlighting.
///
/// `z` is xcap's z-order (higher = more toward the front); the picker sorts by
/// it so overlap resolves front-wins.
#[derive(Clone, serde::Serialize)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub z: i32,
}

/// Whether an enumerated window belongs to our own app, so the picker never
/// offers our overlay/toast/pin/main/settings chrome (or the scroll control, if
/// a sibling feature adds one) as a capture target.
///
/// Robustness: primarily matches by PID (our own process owns all our windows),
/// which is locale-independent and title-independent — the old title-string
/// heuristic (P13) mis-picked untitled/localized windows. App-name/title
/// matching is kept only as a defensive fallback for platforms/edge cases where
/// xcap can't resolve a reliable pid.
fn is_own_window(w: &xcap::Window) -> bool {
    let own_pid = std::process::id();
    if w.pid().map(|pid| pid == own_pid).unwrap_or(false) {
        return true;
    }
    let app_name = w.app_name().unwrap_or_default();
    let title = w.title().unwrap_or_default();
    app_name.to_ascii_lowercase().contains("screenxshot")
        || title.eq_ignore_ascii_case("Select region")
        || title.eq_ignore_ascii_case("Screenshot captured")
}

/// Enumerate capturable on-screen windows for the picker (topmost first).
///
/// Skips our own windows, minimized windows, and zero-size/off-screen windows.
/// Sorted by z-order descending so the frontend's hit-test resolves overlap as
/// front-wins by taking the first match.
#[tauri::command]
pub fn list_windows() -> Result<Vec<WindowInfo>, AppError> {
    let windows =
        xcap::Window::all().map_err(|e| AppError::Capture(format!("enumerate windows: {e}")))?;
    let mut out: Vec<WindowInfo> = windows
        .into_iter()
        .filter_map(|w| {
            if is_own_window(&w) || w.is_minimized().unwrap_or(false) {
                return None;
            }
            let width = w.width().unwrap_or(0);
            let height = w.height().unwrap_or(0);
            // Skip zero-size / undetectable-geometry windows (menus, dummies).
            if width == 0 || height == 0 {
                return None;
            }
            Some(WindowInfo {
                id: w.id().ok()?,
                title: w.title().unwrap_or_default(),
                app_name: w.app_name().unwrap_or_default(),
                x: w.x().unwrap_or(0),
                y: w.y().unwrap_or(0),
                width,
                height,
                z: w.z().unwrap_or(0),
            })
        })
        .collect();
    // Topmost first: hit-testing takes the first rect that contains the cursor.
    out.sort_by(|a, b| b.z.cmp(&a.z));
    Ok(out)
}

/// Capture a specific window (chosen in the picker) by its xcap id and route it
/// through the after-capture dispatch — same path as every other capture.
///
/// The window may have moved/closed between enumerate and grab; if the id no
/// longer resolves, this errors gracefully so the caller can re-enumerate or
/// flash a cancel (rather than grabbing the wrong window).
#[tauri::command]
pub async fn capture_window_by_id(
    app: AppHandle,
    id: u32,
    buffer: State<'_, CaptureBuffer>,
) -> Result<(), AppError> {
    hide_capture_chrome(&app)?;
    let img = tauri::async_runtime::spawn_blocking(move || {
        wait_for_compositor(CompositorSettle::FullScreen);
        capture_window_image_by_id(id)
    })
    .await
    .map_err(|e| AppError::Capture(format!("capture task failed: {e}")))??;
    dispatch_capture(&app, &buffer, img)
}

/// Blocking capture of the window whose xcap id matches `id`. Errors if the
/// window is gone (closed/moved out of enumeration) between pick and grab.
fn capture_window_image_by_id(id: u32) -> Result<RgbaImage, AppError> {
    let windows =
        xcap::Window::all().map_err(|e| AppError::Capture(format!("enumerate windows: {e}")))?;
    let target = windows
        .into_iter()
        .find(|w| w.id().map(|wid| wid == id).unwrap_or(false))
        .ok_or_else(|| AppError::Capture("window no longer available".into()))?;
    target
        .capture_image()
        .map_err(|e| AppError::Capture(format!("capture window: {e}")))
}

/// Hide the overlay(s), the editor, and the toast before a full-screen/window
/// capture so none of our own windows land in the screenshot.
fn hide_capture_chrome(app: &AppHandle) -> Result<(), AppError> {
    overlay::hide_overlay(app)?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    let _ = crate::toast::hide_toast(app);
    Ok(())
}

/// Which capture path is waiting on the compositor. Fullscreen/window grabs the
/// whole screen and genuinely needs the always-on-top overlay fully cleared;
/// the region grab only reads a sub-rect the user drew, so it needs just enough
/// settle for the dim layer to lift.
enum CompositorSettle {
    Region,
    FullScreen,
}

/// Give the compositor time to actually remove the just-hidden windows from the
/// screen before we grab pixels. On macOS `hide()` (NSWindow `orderOut:`) is
/// async to the screen buffer — the window is only removed after the main
/// run-loop flushes and the window server recomposites. A full-screen,
/// always-on-top, all-workspaces overlay is slow to clear, so 150ms proved too
/// short and the dim layer leaked into the grab; use 300ms there. The region
/// path only crops a sub-rect and can settle far faster. Runs on the blocking
/// capture thread.
fn wait_for_compositor(kind: CompositorSettle) {
    let settle_ms = match kind {
        CompositorSettle::FullScreen => {
            if cfg!(target_os = "macos") {
                300
            } else {
                120
            }
        }
        CompositorSettle::Region => {
            if cfg!(target_os = "macos") {
                60
            } else {
                20
            }
        }
    };
    std::thread::sleep(std::time::Duration::from_millis(settle_ms));
}

#[derive(Clone, serde::Serialize)]
struct AutoCapturePayload {
    mode: crate::settings::AfterCapture,
    style: serde_json::Value,
}

/// Write bytes to `path`, first creating the parent directory if it's missing
/// (e.g. the user deleted the save folder between captures). Surfaces the real
/// I/O error so callers can report a failed save instead of claiming success
/// (L1).
fn write_file(path: &std::path::Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Encode(format!("create {}: {e}", parent.display())))?;
    }
    std::fs::write(path, bytes).map_err(|e| AppError::Encode(format!("write {}: {e}", path.display())))
}

/// Write PNG bytes to an absolute path chosen by the user (native save-as
/// fallback when the webview blocks the anchor-download path).
#[tauri::command]
pub fn save_png(path: String, bytes: Vec<u8>) -> Result<(), AppError> {
    write_file(std::path::Path::new(&path), &bytes)
}

/// Save capture bytes (always supplied as PNG) to an explicit path, re-encoding
/// to the user's configured `export_format` first. Used by the native save-as
/// dialog fallback so a chosen `.jpg` path actually contains JPEG bytes.
#[tauri::command]
pub fn save_capture_as(app: AppHandle, path: String, bytes: Vec<u8>) -> Result<(), AppError> {
    let format = crate::settings::load(&app).export_format;
    let out = encode_for_export(&bytes, format)?;
    write_file(std::path::Path::new(&path), &out)
}

/// Save auto-captured PNG bytes to the user's chosen folder with a timestamped
/// filename. Returns the written path. Errors if no `save_dir` is configured.
#[tauri::command]
pub fn auto_save_capture(app: AppHandle, bytes: Vec<u8>) -> Result<String, AppError> {
    let settings = crate::settings::load(&app);
    if settings.save_dir.trim().is_empty() {
        return Err(AppError::Encode("no save folder configured".into()));
    }
    let out = encode_for_export(&bytes, settings.export_format)?;
    let name = format!(
        "ScreenXShot-{}.{}",
        timestamp(),
        settings.export_format.extension()
    );
    let path = std::path::Path::new(&settings.save_dir).join(name);
    write_file(&path, &out)?;
    let path_str = path.to_string_lossy().into_owned();
    // Index the save for the history panel + tray Recents (best-effort).
    if let Err(e) = crate::history::record_save(&app, &path_str, Some(&bytes)) {
        eprintln!("history record failed: {e}");
    }
    Ok(path_str)
}

/// Read an image file's raw bytes for the batch-beautify pipeline. The webview
/// turns these into an object URL and feeds them to the shared editor's
/// `exportStyledBlob`. Returns the bytes via `Response` (no base64/JSON bloat).
#[tauri::command]
pub fn read_image_file(path: String) -> Result<Response, AppError> {
    let bytes =
        std::fs::read(&path).map_err(|e| AppError::Encode(format!("read {path}: {e}")))?;
    Ok(Response::new(bytes))
}

/// Write UTF-8 text to an explicit path verbatim (no image re-encoding). Used to
/// save a style preset as a `.json` file. Kept minimal and separate from the
/// image-writing commands, which force an `export_format` re-encode.
#[tauri::command]
pub fn save_text_file(path: String, text: String) -> Result<(), AppError> {
    write_file(std::path::Path::new(&path), text.as_bytes())
}

/// Save styled PNG bytes into `dir` for the batch-beautify pipeline, re-encoding
/// to the user's configured `export_format` and appending the right extension to
/// `stem`. Returns the written path.
#[tauri::command]
pub fn batch_save(
    app: AppHandle,
    dir: String,
    stem: String,
    bytes: Vec<u8>,
) -> Result<String, AppError> {
    let format = crate::settings::load(&app).export_format;
    let out = encode_for_export(&bytes, format)?;
    let name = format!("{stem}.{}", format.extension());
    let path = std::path::Path::new(&dir).join(name);
    write_file(&path, &out)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Show the corner capture-confirmation toast.
#[tauri::command]
pub fn show_capture_toast(app: AppHandle) -> Result<(), AppError> {
    crate::toast::show_toast(&app, crate::toast::ToastPhase::Ready)
}

/// Peek the buffered capture's PNG bytes for the toast's preview thumbnail.
///
/// Non-consuming (clones) so the editor can still pull the same buffer later via
/// `take_capture`. Returns the raw PNG via `Response` (no base64/JSON bloat).
#[tauri::command]
pub fn toast_preview(buffer: State<'_, CaptureBuffer>) -> Result<Response, AppError> {
    let bytes = lock_recover(&buffer.0)
        .clone()
        .ok_or_else(|| AppError::Capture("no capture available".into()))?;
    Ok(Response::new(bytes))
}

/// Toast tapped: hide it and open the buffered capture in the editor.
#[tauri::command]
pub fn toast_edit(app: AppHandle) -> Result<(), AppError> {
    crate::toast::hide_toast(&app)?;
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| AppError::Overlay(e.to_string()))?;
        main.set_focus()
            .map_err(|e| AppError::Overlay(e.to_string()))?;
    }
    app.emit("capture:ready", ())
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

/// Toast timed out or dismissed: just hide it (image already copied + saved).
#[tauri::command]
pub fn toast_dismiss(app: AppHandle) -> Result<(), AppError> {
    crate::toast::hide_toast(&app)
}

/// Toast "Copy styled" action: hand the buffered raw capture to the main
/// webview's styling pipeline (only JS can render styled bytes). Reuses the
/// same `capture:auto` path as Copy-Styled auto-capture, keeping the editor
/// hidden. The toast stays up (it's a quick action, not a dismiss).
#[tauri::command]
pub fn toast_copy_styled(app: AppHandle) -> Result<(), AppError> {
    let settings = crate::settings::load(&app);
    let payload = AutoCapturePayload {
        mode: crate::settings::AfterCapture::CopyStyled,
        style: settings.default_style,
    };
    if let Some(main) = app.get_webview_window("main") {
        main.emit("capture:auto", payload)
            .map_err(|e| AppError::Overlay(e.to_string()))?;
    }
    Ok(())
}

/// Toast "Pin" action: open the live editable pin on the buffered capture and
/// dismiss the toast.
#[tauri::command]
pub fn toast_pin(app: AppHandle) -> Result<(), AppError> {
    crate::toast::hide_toast(&app)?;
    crate::pin::show_pin(&app)
}

/// Open the live editable pin window on the buffered capture. The pin's webview
/// pulls the same `CaptureBuffer` bytes the editor/toast use (via
/// `take_capture`) and hosts the shared editor for on-pin annotation + re-copy.
#[tauri::command]
pub fn pin_capture(app: AppHandle) -> Result<(), AppError> {
    crate::pin::show_pin(&app)
}

/// Dismiss (hide) the pin window.
#[tauri::command]
pub fn pin_dismiss(app: AppHandle) -> Result<(), AppError> {
    crate::pin::hide_pin(&app)
}

/// Timestamp `days-HHMMSS-mmm` for filenames, no external time crate. The
/// millisecond suffix keeps two saves in the same second from colliding and
/// overwriting each other on disk (L4).
fn timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    // Enough for a unique, sortable name; avoids pulling in chrono.
    let days = secs / 86_400;
    let tod = secs % 86_400;
    let (h, m, s) = (tod / 3600, (tod % 3600) / 60, tod % 60);
    format!("{days}-{h:02}{m:02}{s:02}-{millis:03}")
}

/// Read the current user settings.
#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    crate::settings::load(&app)
}

/// Persist user settings and apply side effects (autostart). Hotkey changes go
/// through `set_hotkey` so old/new registration is handled atomically.
#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<(), AppError> {
    apply_autostart(&app, settings.launch_on_startup)?;
    crate::settings::save(&app, &settings)
}

/// Rebind the capture hotkey live: validate, unregister the old combo, register
/// the new one, then persist.
#[tauri::command]
pub fn set_hotkey(app: AppHandle, hotkey: String) -> Result<(), AppError> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    if !crate::settings::is_valid_hotkey(&hotkey) {
        return Err(AppError::Overlay(format!("invalid hotkey: {hotkey}")));
    }

    let mut current = crate::settings::load(&app);
    let old = current.hotkey.clone();

    if old != hotkey {
        let _ = app.global_shortcut().unregister(old.as_str());
        if let Err(e) = app.global_shortcut().register(hotkey.as_str()) {
            // Registration of the new combo failed (e.g. it conflicts with
            // another app). Restore the prior binding so the user isn't left
            // with NO working capture hotkey for the session (L7).
            let _ = app.global_shortcut().register(old.as_str());
            return Err(AppError::Overlay(format!("register {hotkey}: {e}")));
        }
    }

    current.hotkey = hotkey;
    crate::settings::save(&app, &current)
}

#[cfg(desktop)]
fn apply_autostart(app: &AppHandle, enable: bool) -> Result<(), AppError> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    let res = if enable { mgr.enable() } else { mgr.disable() };
    res.map_err(|e| AppError::Overlay(format!("autostart: {e}")))
}

#[cfg(not(desktop))]
fn apply_autostart(_app: &AppHandle, _enable: bool) -> Result<(), AppError> {
    Ok(())
}

/// Read the buffered capture as raw PNG bytes (called by the editor).
///
/// Peeks (clones) rather than consuming: the same capture may be pulled more
/// than once — e.g. Copy Styled reads the raw buffer to render styled bytes, and
/// the user can still tap the toast's "Edit" afterwards to load the same raw
/// capture. Each new capture overwrites the buffer, so stale data is impossible.
#[tauri::command]
pub fn take_capture(buffer: State<'_, CaptureBuffer>) -> Result<Response, AppError> {
    let bytes = lock_recover(&buffer.0)
        .clone()
        .ok_or_else(|| AppError::Capture("no capture available".into()))?;
    Ok(Response::new(bytes))
}

/// Capture a screen region and return PNG bytes (in memory, no disk).
///
/// `rect` is in physical pixels relative to the target monitor's origin.
/// `monitor_id` selects the monitor by its xcap id; when `None`, the primary
/// monitor is used. Returns raw PNG bytes via `Response` to avoid base64/JSON
/// bloat across IPC.
#[tauri::command]
pub async fn capture_region(
    rect: CaptureRect,
    monitor_id: Option<u32>,
) -> Result<Response, AppError> {
    let bytes = tauri::async_runtime::spawn_blocking(move || capture_region_png(rect, monitor_id))
        .await
        .map_err(|e| AppError::Capture(format!("capture task failed: {e}")))??;
    Ok(Response::new(bytes))
}

/// Physical top-left of a monitor, used as a stable key to match a Tauri
/// overlay monitor to the corresponding `xcap::Monitor` (their enumeration
/// orders are NOT guaranteed to agree — see M3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MonitorPos {
    pub x: i32,
    pub y: i32,
}

/// Resolve the overlay's monitor index to the target monitor's physical
/// position via Tauri's monitor list, so capture can match the SAME monitor in
/// xcap by position rather than by a (possibly mismatched) enumeration index.
/// Returns `None` when the index is absent or can't be resolved, in which case
/// callers fall back to primary-or-first.
fn overlay_monitor_pos(app: &AppHandle, monitor_index: Option<usize>) -> Option<MonitorPos> {
    let index = monitor_index?;
    let monitors = app.available_monitors().ok()?;
    let m = monitors.get(index)?;
    let p = m.position();
    Some(MonitorPos { x: p.x, y: p.y })
}

/// Index of the monitor whose position matches `target`, given each monitor's
/// (optional) position in enumeration order. Pure so M3's matching logic is
/// unit-testable without a display/capture backend. `None` = no match.
fn match_monitor_index(positions: &[Option<MonitorPos>], target: MonitorPos) -> Option<usize> {
    positions.iter().position(|p| *p == Some(target))
}

/// Find the `xcap::Monitor` whose top-left matches `target` (M3: match by
/// position, not enumeration index). Falls back to primary-or-first when no
/// position is given or none matches.
fn pick_monitor(monitors: Vec<Monitor>, target: Option<MonitorPos>) -> Result<Monitor, AppError> {
    if let Some(t) = target {
        let positions: Vec<Option<MonitorPos>> =
            monitors.iter().map(xcap_monitor_pos).collect();
        if let Some(i) = match_monitor_index(&positions, t) {
            return Ok(monitors.into_iter().nth(i).expect("index just found"));
        }
    }
    primary_or_first(monitors)
}

/// The `xcap::Monitor`'s physical top-left, or `None` if it can't be read.
fn xcap_monitor_pos(m: &Monitor) -> Option<MonitorPos> {
    match (m.x(), m.y()) {
        (Ok(x), Ok(y)) => Some(MonitorPos { x, y }),
        _ => None,
    }
}

/// Blocking capture selecting the monitor by physical position (matching the
/// overlay's monitor — see M3). Falls back to primary-or-first when `target` is
/// `None` or unmatched.
fn capture_region_image_by_pos(
    rect: CaptureRect,
    target: Option<MonitorPos>,
) -> Result<RgbaImage, AppError> {
    let monitors =
        Monitor::all().map_err(|e| AppError::Capture(format!("enumerate monitors: {e}")))?;
    if monitors.is_empty() {
        return Err(AppError::Capture("no monitors found".into()));
    }

    let monitor = pick_monitor(monitors, target)?;

    let full = monitor
        .capture_image()
        .map_err(|e| AppError::Capture(format!("capture image: {e}")))?;
    let clamped = clamp_rect(rect, full.width(), full.height())?;
    Ok(crop_rgba(&full, clamped))
}

/// Blocking full-monitor capture by physical position (matches the overlay's
/// monitor — see M3). Falls back to primary-or-first when unmatched.
fn capture_full_monitor_image(target: Option<MonitorPos>) -> Result<RgbaImage, AppError> {
    let monitors =
        Monitor::all().map_err(|e| AppError::Capture(format!("enumerate monitors: {e}")))?;
    if monitors.is_empty() {
        return Err(AppError::Capture("no monitors found".into()));
    }
    let monitor = pick_monitor(monitors, target)?;
    monitor
        .capture_image()
        .map_err(|e| AppError::Capture(format!("capture image: {e}")))
}

/// Blocking capture of the frontmost real application window, skipping our own
/// overlay/toast windows and minimized windows. Picks the topmost by z-order
/// (xcap returns windows front-to-back).
fn capture_front_window_image() -> Result<RgbaImage, AppError> {
    let windows =
        xcap::Window::all().map_err(|e| AppError::Capture(format!("enumerate windows: {e}")))?;
    let target = windows
        .into_iter()
        .find(|w| {
            let minimized = w.is_minimized().unwrap_or(false);
            let title = w.title().unwrap_or_default();
            !minimized && !is_own_window(w) && !title.is_empty()
        })
        .ok_or_else(|| AppError::Capture("no capturable window found".into()))?;
    target
        .capture_image()
        .map_err(|e| AppError::Capture(format!("capture window: {e}")))
}

/// Blocking capture: grab the monitor, crop to the clamped rect, encode PNG.
fn capture_region_png(rect: CaptureRect, monitor_id: Option<u32>) -> Result<Vec<u8>, AppError> {
    let monitors =
        Monitor::all().map_err(|e| AppError::Capture(format!("enumerate monitors: {e}")))?;
    if monitors.is_empty() {
        return Err(AppError::Capture("no monitors found".into()));
    }

    let monitor = match monitor_id {
        Some(id) => monitors
            .into_iter()
            .find(|m| m.id().map(|mid| mid == id).unwrap_or(false))
            .ok_or_else(|| AppError::Capture(format!("monitor {id} not found")))?,
        None => primary_or_first(monitors)?,
    };

    let full = monitor
        .capture_image()
        .map_err(|e| AppError::Capture(format!("capture image: {e}")))?;

    let clamped = clamp_rect(rect, full.width(), full.height())?;
    let cropped = crop_rgba(&full, clamped);
    encode_png(cropped)
}

/// Pick the primary monitor, falling back to the first enumerated monitor when
/// none is flagged primary (some systems/headless setups flag none). `monitors`
/// is assumed non-empty (callers check first).
fn primary_or_first(monitors: Vec<Monitor>) -> Result<Monitor, AppError> {
    let mut fallback: Option<Monitor> = None;
    for m in monitors.into_iter() {
        if m.is_primary().unwrap_or(false) {
            return Ok(m);
        }
        if fallback.is_none() {
            fallback = Some(m);
        }
    }
    fallback.ok_or_else(|| AppError::Capture("no monitors found".into()))
}

/// Crop an RGBA image to the given rect (assumed already clamped to bounds).
fn crop_rgba(src: &RgbaImage, rect: CaptureRect) -> RgbaImage {
    let mut out = RgbaImage::new(rect.width, rect.height);
    for row in 0..rect.height {
        for col in 0..rect.width {
            let px = src.get_pixel(rect.x as u32 + col, rect.y as u32 + row);
            out.put_pixel(col, row, *px);
        }
    }
    out
}

fn encode_png(img: RgbaImage) -> Result<Vec<u8>, AppError> {
    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, ImageFormat::Png)
        .map_err(|e| AppError::Encode(e.to_string()))?;
    Ok(buf.into_inner())
}

/// Quality (0–100) used for JPEG file saves. Hardcoded — a dedicated setting
/// isn't worth the surface area; 90 is a good default for screenshots.
const JPEG_QUALITY: u8 = 90;

/// Composite an RGBA image over an opaque WHITE background, producing RGB.
/// Used before JPEG encoding so transparent pixels become white rather than
/// black (the default `to_rgb8()` behavior). Standard source-over alpha blend.
fn flatten_over_white(rgba: &RgbaImage) -> image::RgbImage {
    let mut out = image::RgbImage::new(rgba.width(), rgba.height());
    for (x, y, px) in rgba.enumerate_pixels() {
        let [r, g, b, a] = px.0;
        let a = a as u32;
        let blend = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        out.put_pixel(x, y, image::Rgb([blend(r), blend(g), blend(b)]));
    }
    out
}

/// Re-encode already-PNG capture bytes into the user's chosen FILE format.
///
/// Clipboard writes always stay PNG (see `copy_image_to_clipboard` / the JS
/// clipboard paths) for maximum app compatibility; only disk saves honor
/// `export_format`. PNG passes through untouched; JPEG decodes the PNG, drops
/// the alpha channel (JPEG has none), and encodes at `JPEG_QUALITY`.
fn encode_for_export(png_bytes: &[u8], format: ExportFormat) -> Result<Vec<u8>, AppError> {
    match format {
        ExportFormat::Png => Ok(png_bytes.to_vec()),
        ExportFormat::Jpeg => {
            // JPEG has no alpha. `to_rgb8()` alone drops the alpha channel,
            // compositing transparent pixels over BLACK. Flatten over WHITE
            // first so transparent areas render white, not black (L2).
            let rgba = image::load_from_memory_with_format(png_bytes, ImageFormat::Png)
                .map_err(|e| AppError::Encode(format!("decode png: {e}")))?
                .to_rgba8();
            let rgb = flatten_over_white(&rgba);
            let mut buf = Cursor::new(Vec::new());
            JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY)
                .encode_image(&rgb)
                .map_err(|e| AppError::Encode(format!("encode jpeg: {e}")))?;
            Ok(buf.into_inner())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn crop_rgba_extracts_expected_region() {
        let mut src = RgbaImage::new(4, 4);
        // Fill with a gradient so we can verify the crop picks the right pixels.
        for y in 0..4 {
            for x in 0..4 {
                src.put_pixel(x, y, Rgba([x as u8 * 10, y as u8 * 10, 0, 255]));
            }
        }
        let rect = CaptureRect { x: 1, y: 1, width: 2, height: 2 };
        let out = crop_rgba(&src, rect);
        assert_eq!(out.width(), 2);
        assert_eq!(out.height(), 2);
        assert_eq!(*out.get_pixel(0, 0), Rgba([10, 10, 0, 255]));
        assert_eq!(*out.get_pixel(1, 1), Rgba([20, 20, 0, 255]));
    }

    #[test]
    fn flatten_over_white_composites_transparency_to_white() {
        let mut src = RgbaImage::new(1, 3);
        // Fully transparent -> white.
        src.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
        // Opaque red -> unchanged.
        src.put_pixel(0, 1, Rgba([255, 0, 0, 255]));
        // Half-transparent black -> mid grey (128-ish), NOT black.
        src.put_pixel(0, 2, Rgba([0, 0, 0, 128]));
        let out = flatten_over_white(&src);
        assert_eq!(*out.get_pixel(0, 0), image::Rgb([255, 255, 255]));
        assert_eq!(*out.get_pixel(0, 1), image::Rgb([255, 0, 0]));
        let mid = out.get_pixel(0, 2).0[0];
        assert!(mid > 120 && mid < 135, "half-alpha black should be grey, got {mid}");
    }

    #[test]
    fn match_monitor_index_finds_by_position_not_order() {
        // xcap enumeration order differs from the overlay's; matching must key
        // on position so the correct monitor is picked regardless of index.
        let positions = vec![
            Some(MonitorPos { x: 1920, y: 0 }),
            Some(MonitorPos { x: 0, y: 0 }),
        ];
        // Overlay's monitor at (0,0) is xcap index 1 here, not 0.
        assert_eq!(
            match_monitor_index(&positions, MonitorPos { x: 0, y: 0 }),
            Some(1)
        );
        assert_eq!(
            match_monitor_index(&positions, MonitorPos { x: 1920, y: 0 }),
            Some(0)
        );
    }

    #[test]
    fn match_monitor_index_none_when_no_match() {
        let positions = vec![Some(MonitorPos { x: 0, y: 0 })];
        assert_eq!(
            match_monitor_index(&positions, MonitorPos { x: 100, y: 100 }),
            None
        );
        // An unreadable position never matches.
        let positions = vec![None];
        assert_eq!(
            match_monitor_index(&positions, MonitorPos { x: 0, y: 0 }),
            None
        );
    }

    #[test]
    fn timestamp_has_millisecond_suffix() {
        let ts = timestamp();
        // Shape: days-HHMMSS-mmm — three dash-separated groups, last is 3 digits.
        let parts: Vec<&str> = ts.split('-').collect();
        assert_eq!(parts.len(), 3, "timestamp {ts} should have a ms suffix");
        assert_eq!(parts[2].len(), 3);
        assert!(parts[2].chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn encode_png_produces_valid_png_signature() {
        let img = RgbaImage::new(3, 3);
        let bytes = encode_png(img).unwrap();
        // PNG magic number.
        assert_eq!(&bytes[0..8], &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    }
}
