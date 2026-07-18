//! Pure vertical stitching core for the scrolling / long-screenshot feature.
//!
//! Manual multi-shot capture produces a stack of frames of the SAME width that
//! overlap vertically (the user scrolls a little between shots). This module
//! contains the OS-agnostic correctness piece: detect the vertical overlap
//! between two consecutive frames and merge them without duplicating the
//! overlapping band. Everything here is a pure function over `RgbaImage`
//! buffers so it can be unit-tested without a display or capture backend.

use image::RgbaImage;

/// How many rows of the incoming frame's top band we compare when searching for
/// the overlap. A small band is enough to disambiguate scroll offsets and keeps
/// the search cheap even for tall frames.
const MATCH_BAND: u32 = 16;

/// Mean per-channel absolute difference (0..=255) under which two rows are
/// considered "the same" content. Small tolerance absorbs sub-pixel scroll
/// resampling and JPEG-like noise without matching genuinely different rows.
const ROW_MATCH_TOLERANCE: f64 = 8.0;

/// Fraction of the candidate band that must match for an offset to be accepted
/// as a real overlap. Requiring most rows to line up rejects coincidental
/// low-diff offsets in flat/blank regions.
const MIN_MATCH_FRACTION: f64 = 0.6;

/// Mean absolute difference between two equal-length RGBA rows, averaged over
/// all channels and pixels (0.0 == identical). Rows MUST be the same length.
fn row_diff(a: &[u8], b: &[u8]) -> f64 {
    debug_assert_eq!(a.len(), b.len());
    if a.is_empty() {
        return 0.0;
    }
    let mut sum: u64 = 0;
    for (pa, pb) in a.iter().zip(b.iter()) {
        sum += (*pa as i32 - *pb as i32).unsigned_abs() as u64;
    }
    sum as f64 / a.len() as f64
}

/// Extract row `y` of `img` as a raw RGBA byte slice.
fn row(img: &RgbaImage, y: u32) -> &[u8] {
    let w = img.width() as usize;
    let start = y as usize * w * 4;
    &img.as_raw()[start..start + w * 4]
}

/// Find how many rows at the TOP of `next` already appear at the BOTTOM of
/// `acc`, i.e. the vertical overlap between two consecutive scrolled frames.
///
/// Returns the overlap height in rows (0..=usable). `0` means no confident
/// overlap was found and the frames should simply be concatenated. Only defined
/// for equal-width images; a width mismatch yields `0` (caller concatenates).
///
/// Strategy: slide a small band from the top of `next` over the bottom region
/// of `acc`. For each candidate overlap `k` (rows of `next` that coincide with
/// the last `k` rows of `acc`), score the mean row-diff across the band and the
/// fraction of rows that match within tolerance. Pick the `k` with the best
/// (lowest-diff, sufficiently-matching) alignment.
pub fn detect_overlap(acc: &RgbaImage, next: &RgbaImage) -> u32 {
    if acc.width() != next.width() || acc.width() == 0 {
        return 0;
    }
    let acc_h = acc.height();
    let next_h = next.height();
    if acc_h == 0 || next_h == 0 {
        return 0;
    }

    // The overlap can't exceed either frame's height.
    let max_overlap = acc_h.min(next_h);
    if max_overlap == 0 {
        return 0;
    }

    // Require at least a full band of rows as evidence, so a coincidental
    // one-row match can't be mistaken for an overlap. Overlaps smaller than the
    // band are treated as "no overlap" (frames concatenated) — a reasonable,
    // conservative search window.
    let band = MATCH_BAND.min(max_overlap);
    let mut best_k: u32 = 0;
    let mut best_score = f64::MAX;

    // Try every candidate overlap `k` (band..=max_overlap): the last `k` rows of
    // `acc` should equal the first `k` rows of `next`. We compare the top `band`
    // rows of that region (band <= k, so alignment is always valid).
    for k in band..=max_overlap {
        let acc_start = acc_h - k;
        let mut diff_sum = 0.0;
        let mut matched = 0u32;
        for i in 0..band {
            let a = row(acc, acc_start + i);
            let b = row(next, i);
            let d = row_diff(a, b);
            diff_sum += d;
            if d <= ROW_MATCH_TOLERANCE {
                matched += 1;
            }
        }
        let mean = diff_sum / band as f64;
        let frac = matched as f64 / band as f64;
        // Prefer the LARGEST overlap that matches well: iterating k ascending and
        // using `<=` lets a larger equally-good k overwrite a smaller one.
        if frac >= MIN_MATCH_FRACTION && mean <= best_score {
            best_score = mean;
            best_k = k;
        }
    }

    best_k
}

/// Vertically append `next` below `acc`, dropping the detected overlapping band
/// so scrolled-through content isn't duplicated. Frames MUST share a width
/// (guaranteed by the capture session: every frame is the same region). A
/// width mismatch falls back to plain concatenation of the wider canvas.
pub fn stitch_pair(acc: &RgbaImage, next: &RgbaImage) -> RgbaImage {
    let overlap = detect_overlap(acc, next);
    let width = acc.width().max(next.width());
    // Rows of `next` to append after removing the overlapping top band.
    let add_h = next.height().saturating_sub(overlap);
    let out_h = acc.height() + add_h;
    let mut out = RgbaImage::new(width, out_h);

    // Copy the accumulated image verbatim.
    for y in 0..acc.height() {
        for x in 0..acc.width() {
            out.put_pixel(x, y, *acc.get_pixel(x, y));
        }
    }
    // Copy the non-overlapping tail of `next` directly below it.
    for y in 0..add_h {
        let src_y = y + overlap;
        for x in 0..next.width() {
            out.put_pixel(x, acc.height() + y, *next.get_pixel(x, src_y));
        }
    }
    out
}

/// Stitch a whole stack of frames top-to-bottom into one tall image. Returns
/// `None` for an empty stack. A single frame is returned unchanged (cloned).
pub fn stitch_all(frames: &[RgbaImage]) -> Option<RgbaImage> {
    let mut iter = frames.iter();
    let first = iter.next()?;
    let mut acc = first.clone();
    for next in iter {
        acc = stitch_pair(&acc, next);
    }
    Some(acc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    /// Build a frame whose row `y` is uniquely colored by `content_at(y)`, so
    /// overlap detection has unambiguous per-row signatures. `start` is the
    /// content index of the top row (simulating a scroll offset).
    fn frame(width: u32, height: u32, start: u32) -> RgbaImage {
        let mut img = RgbaImage::new(width, height);
        for y in 0..height {
            let content = start + y;
            // Hash the content index so consecutive rows differ SHARPLY (like real
            // screenshot content with text/edges), not a smooth gradient where a
            // mis-aligned offset would still score a low diff.
            let h = content.wrapping_mul(2_654_435_761);
            let r = (h & 0xFF) as u8;
            let g = ((h >> 8) & 0xFF) as u8;
            let b = ((h >> 16) & 0xFF) as u8;
            for x in 0..width {
                img.put_pixel(x, y, Rgba([r, g, b, 255]));
            }
        }
        img
    }

    #[test]
    fn detect_overlap_finds_known_scroll_offset() {
        // Frame A shows content rows 0..100; frame B shows 80..180 -> 20 overlap.
        let a = frame(50, 100, 0);
        let b = frame(50, 100, 80);
        assert_eq!(detect_overlap(&a, &b), 20);
    }

    #[test]
    fn detect_overlap_zero_when_no_shared_content() {
        // B starts exactly where A ends: no overlapping rows.
        let a = frame(50, 100, 0);
        let b = frame(50, 100, 100);
        assert_eq!(detect_overlap(&a, &b), 0);
    }

    #[test]
    fn stitch_pair_dedupes_overlap_and_has_correct_height() {
        // 20-row overlap: 100 + (100 - 20) = 180 tall.
        let a = frame(50, 100, 0);
        let b = frame(50, 100, 80);
        let out = stitch_pair(&a, &b);
        assert_eq!(out.width(), 50);
        assert_eq!(out.height(), 180);
        // Row 179 must be content index 179 (the last row of B).
        let last = frame(50, 1, 179);
        assert_eq!(out.get_pixel(0, 179), last.get_pixel(0, 0));
        // The seam row (100) must be content 100, continuing without a dupe.
        let seam = frame(50, 1, 100);
        assert_eq!(out.get_pixel(0, 100), seam.get_pixel(0, 0));
    }

    #[test]
    fn stitch_pair_concatenates_when_no_overlap() {
        let a = frame(50, 100, 0);
        let b = frame(50, 100, 100);
        let out = stitch_pair(&a, &b);
        assert_eq!(out.height(), 200);
        let seam = frame(50, 1, 100);
        assert_eq!(out.get_pixel(0, 100), seam.get_pixel(0, 0));
    }

    #[test]
    fn stitch_all_merges_three_overlapping_frames() {
        // 0..100, 80..180, 160..260 -> two 20-row overlaps -> 260 tall.
        let frames = vec![frame(50, 100, 0), frame(50, 100, 80), frame(50, 100, 160)];
        let out = stitch_all(&frames).unwrap();
        assert_eq!(out.height(), 260);
        let last = frame(50, 1, 259);
        assert_eq!(out.get_pixel(0, 259), last.get_pixel(0, 0));
    }

    #[test]
    fn stitch_all_single_frame_is_unchanged() {
        let a = frame(50, 100, 0);
        let out = stitch_all(std::slice::from_ref(&a)).unwrap();
        assert_eq!(out.dimensions(), (50, 100));
        assert_eq!(out.get_pixel(0, 50), a.get_pixel(0, 50));
    }

    #[test]
    fn stitch_all_empty_is_none() {
        assert!(stitch_all(&[]).is_none());
    }
}
