mod capture;
mod commands;
mod error;
mod history;
mod overlay;
mod pin;
mod scroll;
mod settings;
mod stitch;
mod toast;

pub use error::AppError;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalPosition, Manager, WindowEvent,
};

/// Holds the tray icon so its menu (esp. the "Recents" submenu) can be rebuilt
/// after new captures are saved.
#[derive(Default)]
pub struct TrayHandle(pub Mutex<Option<TrayIcon>>);

/// Bring the main window to the front, centered on the primary monitor.
///
/// Shared by the tray icon click, the tray "Open ScreenXShot" item, and the
/// native app menu. On macOS the app may be in `Accessory` activation policy
/// (resident/hidden mode); we restore `Regular` first so the window can take
/// focus. Errors are logged, never panicked on.
fn show_main_window(app: &AppHandle) -> Result<(), AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Overlay("main window not found".into()))?;

    // Resident/hidden mode drops to Accessory; Regular lets the window focus.
    #[cfg(target_os = "macos")]
    {
        use tauri::ActivationPolicy;
        let _ = app.set_activation_policy(ActivationPolicy::Regular);
    }

    // Center on the primary monitor using the window's current outer size.
    match app.primary_monitor() {
        Ok(Some(monitor)) => {
            let scale = monitor.scale_factor();
            let mon_pos = monitor.position().to_logical::<f64>(scale);
            let mon_size = monitor.size().to_logical::<f64>(scale);
            match window.outer_size() {
                Ok(win_size) => {
                    let win = win_size.to_logical::<f64>(scale);
                    let x = mon_pos.x + (mon_size.width - win.width) / 2.0;
                    let y = mon_pos.y + (mon_size.height - win.height) / 2.0;
                    if let Err(e) = window.set_position(LogicalPosition::new(x, y)) {
                        eprintln!("warning: could not center main window: {e}");
                    }
                }
                Err(e) => eprintln!("warning: could not read main window size: {e}"),
            }
        }
        Ok(None) => eprintln!("warning: no primary monitor found; skipping centering"),
        Err(e) => eprintln!("warning: could not query primary monitor: {e}"),
    }

    let _ = window.unminimize();
    window
        .show()
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    window
        .set_focus()
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(commands::CaptureBuffer::default())
        .manage(scroll::ScrollSession::default())
        .manage(TrayHandle::default())
        .plugin(build_global_shortcut())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            register_capture_shortcut(app.handle());
            build_app_menu(app.handle())?;
            build_tray(app.handle())?;
            // Warm up the overlay windows (hidden) so the first hotkey press
            // shows them instantly rather than building webviews inline.
            overlay::precreate_overlays(app.handle());
            // Same warm-up for the toast so its first show is instant instead
            // of paying the webview build + JS load cost inline on capture.
            toast::precreate_toast(app.handle());
            // Warm up the pin window (hidden) so the first pin is instant.
            pin::precreate_pin(app.handle());
            // Warm up the long-screenshot control window (hidden).
            scroll::precreate_control(app.handle());
            // The main window is created hidden (see tauri.conf.json) so the
            // cold-start black flash — window shown before the heavy editor JS
            // bundle paints — is gone; the frontend calls `main_ready` once it
            // has mounted + painted. Guard against a missing ready signal (JS
            // error / early panic) so the app can never get stuck invisible:
            // show it regardless after a short grace period. `main_ready`'s
            // visibility check keeps this idempotent with the ready path.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(4000));
                    if let Some(main) = handle.get_webview_window("main") {
                        if !main.is_visible().unwrap_or(false) {
                            let _ = main.show();
                        }
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep the app resident when the user prefers close-to-tray; closing
            // the main window then hides it so the next capture is instant.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let closes_to_tray = settings::load(window.app_handle()).tray_closes_to_tray;
                    if closes_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "show-main" {
                if let Err(e) = show_main_window(app) {
                    eprintln!("warning: show main window failed: {e}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_region,
            commands::show_overlay,
            commands::main_ready,
            commands::open_settings,
            commands::cancel_overlay,
            commands::finish_capture,
            commands::capture_fullscreen,
            commands::capture_window,
            commands::list_windows,
            commands::capture_window_by_id,
            commands::scroll_start,
            commands::scroll_capture_frame,
            commands::scroll_finish,
            commands::scroll_cancel,
            commands::take_capture,
            commands::save_png,
            commands::save_capture_as,
            commands::get_settings,
            commands::set_settings,
            commands::set_hotkey,
            commands::auto_save_capture,
            commands::show_capture_toast,
            commands::toast_preview,
            commands::toast_edit,
            commands::toast_dismiss,
            commands::toast_copy_styled,
            commands::toast_pin,
            commands::pin_capture,
            commands::pin_dismiss,
            commands::read_image_file,
            commands::save_text_file,
            commands::batch_save,
            history::get_history,
            history::clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_global_shortcut() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_global_shortcut::{Builder as GsBuilder, ShortcutState};

    GsBuilder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = overlay::show_overlay(app);
            }
        })
        .build()
}

/// Register the capture shortcut from saved settings (or the platform default).
/// Non-fatal: a taken combo just logs a warning.
fn register_capture_shortcut(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let combo = settings::load(app).hotkey;
    if let Err(e) = app.global_shortcut().register(combo.as_str()) {
        eprintln!("warning: could not register capture shortcut {combo}: {e}");
    }
}

/// Build the native application menu (macOS system menu bar; on Windows it
/// attaches to the window). Contains an app-name submenu and a Window submenu
/// with "Show ScreenXShot" (Cmd+Shift+H) which brings the main window forward.
fn build_app_menu(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(
        app,
        "show-main",
        "Show ScreenXShot",
        true,
        Some("CmdOrCtrl+Shift+H"),
    )?;
    let quit_item = PredefinedMenuItem::quit(app, None)?;

    let app_submenu = Submenu::with_items(app, "ScreenXShot", true, &[&show_item, &quit_item])?;
    let window_submenu = Submenu::with_items(app, "Window", true, &[&show_item])?;
    let menu = Menu::with_items(app, &[&app_submenu, &window_submenu])?;

    app.set_menu(menu)?;
    Ok(())
}

/// Prefix for tray "Recents" menu-item ids; the suffix is the history index.
const RECENT_ID_PREFIX: &str = "recent-";
/// How many recent captures the tray "Recents" submenu lists.
const TRAY_RECENTS: usize = 5;

/// Build the tray "Recents" submenu from the capture history. Empty history
/// yields a single disabled placeholder so the submenu is never empty.
fn build_recents_submenu(app: &tauri::AppHandle) -> Result<Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    let recents = history::recent(app, TRAY_RECENTS);
    if recents.is_empty() {
        let empty = MenuItem::with_id(app, "recent-empty", "No recent captures", false, None::<&str>)?;
        return Ok(Submenu::with_items(app, "Recents", true, &[&empty])?);
    }
    let mut items: Vec<MenuItem<tauri::Wry>> = Vec::with_capacity(recents.len());
    for (i, entry) in recents.iter().enumerate() {
        let label = recent_label(entry);
        items.push(MenuItem::with_id(
            app,
            format!("{RECENT_ID_PREFIX}{i}"),
            label,
            true,
            None::<&str>,
        )?);
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
        items.iter().map(|m| m as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
    Ok(Submenu::with_items(app, "Recents", true, &refs)?)
}

/// Short label for a recents menu item: the file's base name.
fn recent_label(entry: &history::HistoryEntry) -> String {
    std::path::Path::new(&entry.path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| entry.path.clone())
}

/// Open the history entry at `index` in the editor: reveal the main window and
/// emit `history:open` with its path so the webview loads the file bytes.
fn open_recent(app: &tauri::AppHandle, index: usize) {
    use tauri::Emitter;
    let recents = history::recent(app, TRAY_RECENTS);
    let Some(entry) = recents.get(index) else {
        return;
    };
    if let Err(e) = show_main_window(app) {
        eprintln!("warning: show main window failed: {e}");
    }
    if let Err(e) = app.emit("history:open", entry.path.clone()) {
        eprintln!("warning: emit history:open failed: {e}");
    }
}

/// Build the full tray menu (including the dynamic Recents submenu).
fn build_tray_menu(app: &tauri::AppHandle) -> Result<Menu<tauri::Wry>, Box<dyn std::error::Error>> {
    let capture_item = MenuItem::with_id(app, "capture", "Capture region", true, None::<&str>)?;
    let pin_item = MenuItem::with_id(app, "pin", "Pin last capture", true, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show", "Open ScreenXShot", true, None::<&str>)?;
    let recents_submenu = build_recents_submenu(app)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    Ok(Menu::with_items(
        app,
        &[
            &show_item,
            &capture_item,
            &pin_item,
            &recents_submenu,
            &settings_item,
            &quit_item,
        ],
    )?)
}

/// Rebuild the tray menu so the Recents submenu reflects the latest history.
/// Best-effort: a missing tray or menu-build error is logged, never fatal.
pub fn refresh_tray_recents(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<TrayHandle>() else {
        return;
    };
    let guard = state.0.lock().unwrap();
    let Some(tray) = guard.as_ref() else {
        return;
    };
    match build_tray_menu(app) {
        Ok(menu) => {
            if let Err(e) = tray.set_menu(Some(menu)) {
                eprintln!("warning: refresh tray recents failed: {e}");
            }
        }
        Err(e) => eprintln!("warning: rebuild tray menu failed: {e}"),
    }
}

fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app)?;

    let tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("ScreenXShot")
        .menu(&menu)
        .on_tray_icon_event(|tray, event| {
            // Left/primary click on the tray icon brings the main window forward.
            if let TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                if let Err(e) = show_main_window(tray.app_handle()) {
                    eprintln!("warning: show main window failed: {e}");
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => {
                let _ = overlay::show_overlay(app);
            }
            "pin" => {
                if let Err(e) = pin::show_pin(app) {
                    eprintln!("warning: pin last capture failed: {e}");
                }
            }
            "show" => {
                if let Err(e) = show_main_window(app) {
                    eprintln!("warning: show main window failed: {e}");
                }
            }
            "settings" => {
                let _ = settings::open_settings_window(app);
            }
            "quit" => app.exit(0),
            id => {
                if let Some(idx) = id
                    .strip_prefix(RECENT_ID_PREFIX)
                    .and_then(|n| n.parse::<usize>().ok())
                {
                    open_recent(app, idx);
                }
            }
        })
        .build(app)?;
    if let Some(state) = app.try_state::<TrayHandle>() {
        *state.0.lock().unwrap() = Some(tray);
    }
    Ok(())
}
