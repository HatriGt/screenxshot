mod capture;
mod commands;
mod error;
mod hotkey;
mod overlay;

pub use error::AppError;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::CaptureBuffer::default())
        .plugin(build_global_shortcut())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            register_capture_shortcut(app.handle())?;
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep the app resident: closing the main window hides it instead
            // of quitting, so the next capture is instant. Tray "Quit" exits.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_region,
            commands::show_overlay,
            commands::cancel_overlay,
            commands::finish_capture,
            commands::take_capture,
            commands::save_png,
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

fn register_capture_shortcut(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // Registration can fail if the combo is already taken; treat as non-fatal.
    if let Err(e) = app.global_shortcut().register(hotkey::default_shortcut()) {
        eprintln!(
            "warning: could not register capture shortcut {}: {e}",
            hotkey::default_shortcut()
        );
    }
    Ok(())
}

fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let capture_item = MenuItem::with_id(app, "capture", "Capture region", true, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show", "Open ScreenXShot", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&capture_item, &show_item, &quit_item])?;

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
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
