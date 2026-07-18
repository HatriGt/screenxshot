mod capture;
mod commands;
mod error;
mod overlay;
mod settings;
mod toast;

pub use error::AppError;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

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

fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let capture_item = MenuItem::with_id(app, "capture", "Capture region", true, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show", "Open ScreenXShot", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&capture_item, &show_item, &settings_item, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("ScreenXShot")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture" => {
                let _ = overlay::show_overlay(app);
            }
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
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
