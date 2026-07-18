// Pure geometry for the window-capture picker. Kept DOM/Tauri-free so the
// hit-testing + overlap resolution can be unit-tested without a display.
//
// Bounds arrive from the Rust `list_windows` command in GLOBAL physical pixels
// (xcap's virtual-desktop space). Hit-testing happens in that same global
// space; translating a global rect into a per-monitor overlay's local CSS
// coords for drawing the highlight is a separate concern (see `toLocalRect`).

/** One enumerated window as returned by the Rust `list_windows` command. */
export interface WindowInfo {
  id: number;
  title: string;
  app_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** xcap z-order: higher = closer to the front. */
  z: number;
}

/** A point in global physical-pixel (virtual-desktop) space. */
export interface GlobalPoint {
  x: number;
  y: number;
}

/** A rectangle in local CSS pixels, ready to position the highlight box. */
export interface LocalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether a global point lies inside a window's bounds (right/bottom exclusive). */
function contains(w: WindowInfo, p: GlobalPoint): boolean {
  return (
    p.x >= w.x && p.x < w.x + w.width && p.y >= w.y && p.y < w.y + w.height
  );
}

/**
 * Resolve which window is under the cursor, front-wins on overlap.
 *
 * Considers every window containing the point and returns the one with the
 * highest z (topmost). Does NOT assume the input is pre-sorted. Returns null
 * when the cursor is over no enumerated window (e.g. bare desktop).
 */
export function windowAtPoint(
  windows: WindowInfo[],
  point: GlobalPoint,
): WindowInfo | null {
  let best: WindowInfo | null = null;
  for (const w of windows) {
    if (!contains(w, point)) continue;
    if (best === null || w.z > best.z) best = w;
  }
  return best;
}

/**
 * Translate a window's GLOBAL physical-pixel bounds into a single monitor
 * overlay's LOCAL CSS-pixel rect for drawing the highlight.
 *
 * `monitorOrigin` is the monitor's global physical top-left; `scaleFactor` is
 * that monitor's device-pixel ratio. The overlay webview is sized in CSS px at
 * that monitor's origin, so: local_css = (global_physical - origin) / scale.
 *
 * The returned rect may extend beyond the overlay's own bounds (a window can
 * straddle monitors); CSS clipping via `overflow:hidden` keeps the drawn
 * portion correct on each monitor. Multi-monitor limitation: windows spanning
 * displays with DIFFERENT scale factors are only pixel-perfect on their home
 * monitor — acceptable for a hover highlight.
 */
export function toLocalRect(
  w: WindowInfo,
  monitorOrigin: GlobalPoint,
  scaleFactor: number,
): LocalRect {
  return {
    x: (w.x - monitorOrigin.x) / scaleFactor,
    y: (w.y - monitorOrigin.y) / scaleFactor,
    width: w.width / scaleFactor,
    height: w.height / scaleFactor,
  };
}
