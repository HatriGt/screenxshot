use crate::error::AppError;
use serde::Deserialize;

/// A capture rectangle in physical pixels, relative to a monitor's origin.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub struct CaptureRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Clamp a requested rectangle to the bounds of a monitor of the given size,
/// returning the intersected rectangle. Returns `AppError::Capture` when the
/// requested rectangle has zero area or does not intersect the monitor at all.
///
/// Coordinates are monitor-local physical pixels: a valid rect satisfies
/// `0 <= x`, `0 <= y`, `x + width <= monitor_w`, `y + height <= monitor_h`
/// after clamping.
pub fn clamp_rect(
    rect: CaptureRect,
    monitor_w: u32,
    monitor_h: u32,
) -> Result<CaptureRect, AppError> {
    if rect.width == 0 || rect.height == 0 {
        return Err(AppError::Capture("zero-area selection".into()));
    }

    // Left/top edges clamped to the monitor origin.
    let x0 = rect.x.max(0);
    let y0 = rect.y.max(0);

    // Right/bottom edges clamped to the monitor extent. Use i64 to avoid
    // overflow when x + width is large.
    let req_right = rect.x as i64 + rect.width as i64;
    let req_bottom = rect.y as i64 + rect.height as i64;
    let x1 = req_right.min(monitor_w as i64);
    let y1 = req_bottom.min(monitor_h as i64);

    let w = x1 - x0 as i64;
    let h = y1 - y0 as i64;

    if w <= 0 || h <= 0 {
        return Err(AppError::Capture(
            "selection does not intersect the monitor".into(),
        ));
    }

    Ok(CaptureRect {
        x: x0,
        y: y0,
        width: w as u32,
        height: h as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> CaptureRect {
        CaptureRect { x, y, width, height }
    }

    #[test]
    fn clamp_rect_returns_rect_unchanged_when_fully_inside() {
        let r = rect(100, 50, 400, 300);
        assert_eq!(clamp_rect(r, 1920, 1080).unwrap(), r);
    }

    #[test]
    fn clamp_rect_clamps_right_and_bottom_overflow_to_monitor() {
        let r = rect(1800, 1000, 400, 300);
        let clamped = clamp_rect(r, 1920, 1080).unwrap();
        assert_eq!(clamped, rect(1800, 1000, 120, 80));
    }

    #[test]
    fn clamp_rect_clamps_negative_origin_to_zero() {
        let r = rect(-50, -20, 200, 150);
        let clamped = clamp_rect(r, 1920, 1080).unwrap();
        assert_eq!(clamped, rect(0, 0, 150, 130));
    }

    #[test]
    fn clamp_rect_rejects_zero_area() {
        assert!(clamp_rect(rect(10, 10, 0, 100), 1920, 1080).is_err());
        assert!(clamp_rect(rect(10, 10, 100, 0), 1920, 1080).is_err());
    }

    #[test]
    fn clamp_rect_rejects_rect_entirely_off_screen() {
        let r = rect(5000, 5000, 100, 100);
        assert!(clamp_rect(r, 1920, 1080).is_err());
    }
}
