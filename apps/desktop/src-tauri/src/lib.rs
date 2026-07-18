mod capture;
mod commands;
mod error;
mod overlay;
mod settings;
mod toast;

pub use error::AppError;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalPosition, Manager, WindowEvent,
};

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
        .plugin(build_global_shortcut())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build());

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
            commands::open_settings,
            commands::cancel_overlay,
            commands::finish_capture,
            commands::capture_fullscreen,
            commands::capture_window,
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

fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let capture_item = MenuItem::with_id(app, "capture", "Capture region", true, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show", "Open ScreenXShot", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &capture_item, &settings_item, &quit_item])?;

    TrayIconBuilder::new()
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
            "show" => {
                if let Err(e) = show_main_window(app) {
                    eprintln!("warning: show main window failed: {e}");
                }
            }
            "settings" => {
                let _ = settings::open_settings_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
