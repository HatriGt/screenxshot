mod capture;
mod commands;
mod error;
mod overlay;

pub use error::AppError;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::CaptureBuffer::default())
        .invoke_handler(tauri::generate_handler![
            commands::capture_region,
            commands::show_overlay,
            commands::cancel_overlay,
            commands::finish_capture,
            commands::take_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
