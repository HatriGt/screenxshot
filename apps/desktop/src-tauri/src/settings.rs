use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::window::Color;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SETTINGS_LABEL: &str = "settings";
pub const STORE_FILE: &str = "settings.json";
pub const STORE_KEY: &str = "settings";

/// What happens immediately after a region is captured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AfterCapture {
    /// Open the capture in the editor window (classic flow).
    OpenEditor,
    /// Copy the raw screenshot to the clipboard, show a toast.
    CopyRaw,
    /// Apply the saved default style (backdrop/padding), copy it, show a toast.
    CopyStyled,
}

impl Default for AfterCapture {
    fn default() -> Self {
        AfterCapture::OpenEditor
    }
}

/// Which corner of the primary monitor the capture toast appears in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToastPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Default for ToastPosition {
    fn default() -> Self {
        ToastPosition::BottomRight
    }
}

/// File format used for saving captures to disk. Clipboard always stays PNG for
/// broad app compatibility; this only affects FILE saves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExportFormat {
    Png,
    Jpeg,
}

impl Default for ExportFormat {
    fn default() -> Self {
        ExportFormat::Png
    }
}

impl ExportFormat {
    /// Filename extension (no dot) for this format.
    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Png => "png",
            ExportFormat::Jpeg => "jpg",
        }
    }
}

/// Auto-save toast dismiss timeout: 0 means "Never" (stay until clicked).
fn default_toast_dismiss_ms() -> u32 {
    5000
}

/// User preferences, persisted to `settings.json` via `tauri-plugin-store`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    /// Global capture shortcut, e.g. "Cmd+Shift+2".
    pub hotkey: String,
    /// Launch the app when the user logs in.
    pub launch_on_startup: bool,
    /// Default directory for "Save" (empty = ask every time).
    pub save_dir: String,
    /// When true, closing the main window hides it to the tray; otherwise quits.
    pub tray_closes_to_tray: bool,
    /// What to do right after a capture.
    #[serde(default)]
    pub after_capture: AfterCapture,
    /// Opaque JSON snapshot of the editor's default style (backdrop, padding,
    /// radius, shadow, frame). Produced by the editor via "Save current style as
    /// default"; consumed by the editor when auto-styling a capture. Empty = the
    /// editor's built-in defaults are used.
    #[serde(default)]
    pub default_style: serde_json::Value,
    /// Corner the capture toast appears in.
    #[serde(default)]
    pub toast_position: ToastPosition,
    /// Auto-dismiss timeout for the toast, in milliseconds. 0 = never
    /// auto-dismiss (the toast stays until clicked/dismissed).
    #[serde(default = "default_toast_dismiss_ms")]
    pub toast_dismiss_ms: u32,
    /// Countdown before a capture is grabbed, in seconds. 0 = off.
    #[serde(default)]
    pub self_timer_secs: u32,
    /// File format for saving captures to disk (clipboard stays PNG).
    #[serde(default)]
    pub export_format: ExportFormat,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey().to_string(),
            launch_on_startup: false,
            save_dir: String::new(),
            tray_closes_to_tray: true,
            after_capture: AfterCapture::default(),
            default_style: serde_json::Value::Null,
            toast_position: ToastPosition::default(),
            toast_dismiss_ms: default_toast_dismiss_ms(),
            self_timer_secs: 0,
            export_format: ExportFormat::default(),
        }
    }
}

/// Platform-appropriate default capture shortcut.
pub fn default_hotkey() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Cmd+Shift+2"
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Ctrl+Shift+2"
    }
}

/// A hotkey is valid only if it has at least one modifier and one key, so it
/// can't clash with a bare keypress or be empty.
pub fn is_valid_hotkey(combo: &str) -> bool {
    let parts: Vec<&str> = combo.split('+').map(|p| p.trim()).collect();
    if parts.len() < 2 || parts.iter().any(|p| p.is_empty()) {
        return false;
    }
    const MODS: [&str; 6] = ["Cmd", "Ctrl", "Control", "Alt", "Option", "Shift"];
    let has_mod = parts.iter().any(|p| MODS.contains(p));
    let has_key = parts.iter().any(|p| !MODS.contains(p));
    has_mod && has_key
}

/// Load settings from the store, falling back to defaults on any error/missing.
pub fn load(app: &AppHandle) -> Settings {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store(STORE_FILE) else {
        return Settings::default();
    };
    store
        .get(STORE_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// Persist settings to the store.
pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), AppError> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Overlay(format!("open store: {e}")))?;
    let value =
        serde_json::to_value(settings).map_err(|e| AppError::Overlay(format!("serialize: {e}")))?;
    store.set(STORE_KEY, value);
    store
        .save()
        .map_err(|e| AppError::Overlay(format!("save store: {e}")))?;
    Ok(())
}

/// Open (or focus) the Settings window.
pub fn open_settings_window(app: &AppHandle) -> Result<(), AppError> {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        win.show().map_err(|e| AppError::Overlay(e.to_string()))?;
        win.set_focus()
            .map_err(|e| AppError::Overlay(e.to_string()))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("settings.html".into()))
        .title("ScreenXShot Settings")
        .inner_size(560.0, 620.0)
        .min_inner_size(560.0, 620.0)
        .resizable(false)
        // Paint the window our dark bg from the first frame so there's no white
        // flash — visible from the start avoids the show-timing race that made
        // it open only on the 2nd click.
        .background_color(Color(20, 22, 29, 255))
        .build()
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_have_platform_hotkey_and_tray_close() {
        let s = Settings::default();
        assert!(s.hotkey.contains("Shift+2"));
        assert!(s.tray_closes_to_tray);
        assert!(!s.launch_on_startup);
        assert!(s.save_dir.is_empty());
        assert_eq!(s.after_capture, AfterCapture::OpenEditor);
        assert!(s.default_style.is_null());
        assert_eq!(s.toast_position, ToastPosition::BottomRight);
        assert_eq!(s.toast_dismiss_ms, 5000);
        assert_eq!(s.self_timer_secs, 0);
        assert_eq!(s.export_format, ExportFormat::Png);
    }

    #[test]
    fn export_format_extension_maps_to_png_or_jpg() {
        assert_eq!(ExportFormat::Png.extension(), "png");
        assert_eq!(ExportFormat::Jpeg.extension(), "jpg");
    }

    #[test]
    fn toast_position_serializes_kebab_case() {
        let json = serde_json::to_string(&ToastPosition::BottomLeft).unwrap();
        assert_eq!(json, "\"bottom-left\"");
    }

    #[test]
    fn after_capture_serializes_kebab_case() {
        let json = serde_json::to_string(&AfterCapture::CopyStyled).unwrap();
        assert_eq!(json, "\"copy-styled\"");
    }

    #[test]
    fn settings_load_defaults_when_new_fields_missing() {
        // Older stored settings won't have after_capture/default_style.
        let legacy = serde_json::json!({
            "hotkey": "Cmd+Shift+2",
            "launch_on_startup": false,
            "save_dir": "",
            "tray_closes_to_tray": true
        });
        let s: Settings = serde_json::from_value(legacy).unwrap();
        assert_eq!(s.after_capture, AfterCapture::OpenEditor);
        assert!(s.default_style.is_null());
        // New Phase-1 fields fall back to their defaults.
        assert_eq!(s.toast_position, ToastPosition::BottomRight);
        assert_eq!(s.toast_dismiss_ms, 5000);
        assert_eq!(s.self_timer_secs, 0);
        assert_eq!(s.export_format, ExportFormat::Png);
    }

    #[test]
    fn settings_roundtrip_through_json() {
        let s = Settings {
            hotkey: "Ctrl+Alt+P".into(),
            launch_on_startup: true,
            save_dir: "/tmp/shots".into(),
            tray_closes_to_tray: false,
            after_capture: AfterCapture::CopyStyled,
            default_style: serde_json::json!({ "bg": { "kind": "wall", "id": "bloom" } }),
            toast_position: ToastPosition::TopLeft,
            toast_dismiss_ms: 0,
            self_timer_secs: 3,
            export_format: ExportFormat::Jpeg,
        };
        let json = serde_json::to_value(&s).unwrap();
        let back: Settings = serde_json::from_value(json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn valid_hotkeys_need_modifier_and_key() {
        assert!(is_valid_hotkey("Cmd+Shift+2"));
        assert!(is_valid_hotkey("Ctrl+Alt+P"));
        assert!(!is_valid_hotkey("A")); // no modifier
        assert!(!is_valid_hotkey("Cmd+Shift")); // no non-modifier key
        assert!(!is_valid_hotkey("")); // empty
        assert!(!is_valid_hotkey("Cmd+")); // trailing empty part
    }
}
