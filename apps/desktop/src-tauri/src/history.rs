use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Store key (in the existing `settings.json` store) holding the capture-history
/// index. A small, capped list of the most recent saved captures so the tray
/// "Recents" submenu and the in-app history panel can browse them.
const HISTORY_KEY: &str = "history";

/// Maximum number of history entries retained; older entries are pruned.
const HISTORY_CAP: usize = 50;

/// One saved-capture record. `timestamp` is Unix seconds (UTC) at save time.
/// `width`/`height` are the capture's pixel dimensions when known.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub path: String,
    pub timestamp: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// True when the file no longer exists on disk (deleted after save). The
    /// index keeps the record so the UI can show/prune it gracefully.
    #[serde(default)]
    pub missing: bool,
}

/// Read the raw history list from the store (most-recent first). Returns an
/// empty list on any error/missing key so callers never fail on a fresh store.
fn read(app: &AppHandle) -> Vec<HistoryEntry> {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store(crate::settings::STORE_FILE) else {
        return Vec::new();
    };
    store
        .get(HISTORY_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// Persist the history list to the store (best-effort; errors bubble up).
fn write(app: &AppHandle, entries: &[HistoryEntry]) -> Result<(), AppError> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store(crate::settings::STORE_FILE)
        .map_err(|e| AppError::Overlay(format!("open store: {e}")))?;
    let value = serde_json::to_value(entries)
        .map_err(|e| AppError::Overlay(format!("serialize history: {e}")))?;
    store.set(HISTORY_KEY, value);
    store
        .save()
        .map_err(|e| AppError::Overlay(format!("save store: {e}")))?;
    Ok(())
}

/// Current Unix time in seconds (0 on clock error — matches the filename
/// timestamp's tolerance for a bad clock).
fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Record a freshly-saved capture at `path`. `png_bytes` is the original PNG
/// (used to read dimensions); pass `None` to skip dimension probing. Newest
/// entries go to the front; the list is capped to `HISTORY_CAP`. Best-effort:
/// callers log-and-continue rather than failing the save on a history error.
pub fn record_save(app: &AppHandle, path: &str, png_bytes: Option<&[u8]>) -> Result<(), AppError> {
    let (width, height) = match png_bytes {
        Some(bytes) => probe_dimensions(bytes),
        None => (None, None),
    };
    let entry = HistoryEntry {
        path: path.to_string(),
        timestamp: now_secs(),
        width,
        height,
        missing: false,
    };
    let mut entries = read(app);
    // Drop any prior record for the same path so re-saves don't duplicate.
    entries.retain(|e| e.path != entry.path);
    entries.insert(0, entry);
    entries.truncate(HISTORY_CAP);
    write(app, &entries)?;
    // Keep the tray "Recents" submenu in sync with the newest save.
    crate::refresh_tray_recents(app);
    Ok(())
}

/// Best-effort image dimensions from PNG bytes; `(None, None)` on any error.
fn probe_dimensions(png_bytes: &[u8]) -> (Option<u32>, Option<u32>) {
    match image::load_from_memory_with_format(png_bytes, image::ImageFormat::Png) {
        Ok(img) => (Some(img.width()), Some(img.height())),
        Err(_) => (None, None),
    }
}

/// Return the history list, flagging entries whose file has been deleted on disk
/// (so the UI can gray them out) without pruning them here.
#[tauri::command]
pub fn get_history(app: AppHandle) -> Vec<HistoryEntry> {
    let mut entries = read(&app);
    for e in &mut entries {
        e.missing = !std::path::Path::new(&e.path).exists();
    }
    entries
}

/// Clear the entire capture history index.
#[tauri::command]
pub fn clear_history(app: AppHandle) -> Result<(), AppError> {
    write(&app, &[])
}

/// Last `n` entries (most-recent first) for the tray "Recents" submenu.
pub fn recent(app: &AppHandle, n: usize) -> Vec<HistoryEntry> {
    let mut entries = read(app);
    entries.truncate(n);
    entries
}
