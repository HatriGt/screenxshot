use crate::capture::{clamp_rect, CaptureRect};
use crate::error::AppError;
use image::{ImageFormat, RgbaImage};
use std::io::Cursor;
use tauri::ipc::Response;
use xcap::Monitor;

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
        None => monitors
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .ok_or_else(|| AppError::Capture("no primary monitor".into()))?,
    };

    let full = monitor
        .capture_image()
        .map_err(|e| AppError::Capture(format!("capture image: {e}")))?;

    let clamped = clamp_rect(rect, full.width(), full.height())?;
    let cropped = crop_rgba(&full, clamped);
    encode_png(cropped)
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
    fn encode_png_produces_valid_png_signature() {
        let img = RgbaImage::new(3, 3);
        let bytes = encode_png(img).unwrap();
        // PNG magic number.
        assert_eq!(&bytes[0..8], &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    }
}
