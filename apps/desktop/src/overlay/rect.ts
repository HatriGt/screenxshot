// Pure geometry helper for the region-select overlay. Kept separate from the
// DOM/Tauri wiring so it can be unit-tested without a display.

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Normalize a drag from `start` to `end` into a top-left-origin rectangle with
 * positive dimensions, regardless of drag direction. Coordinates are rounded to
 * whole physical pixels.
 */
export function normalizeRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): SelectionRect {
  const x = Math.round(Math.min(start.x, end.x));
  const y = Math.round(Math.min(start.y, end.y));
  const width = Math.round(Math.abs(end.x - start.x));
  const height = Math.round(Math.abs(end.y - start.y));
  return { x, y, width, height };
}

/** A selection is meaningful only when it has real area (avoids click-cancels). */
export function isMeaningfulSelection(rect: SelectionRect, min = 4): boolean {
  return rect.width >= min && rect.height >= min;
}

/**
 * Convert a CSS-pixel rect (relative to the overlay window, which covers exactly
 * one monitor) into monitor-local physical pixels for native capture. Because
 * each overlay covers a single monitor at that monitor's origin, the mapping is
 * a simple scale by the device pixel ratio.
 */
export function toPhysicalRect(rect: SelectionRect, scaleFactor: number): SelectionRect {
  return {
    x: Math.round(rect.x * scaleFactor),
    y: Math.round(rect.y * scaleFactor),
    width: Math.round(rect.width * scaleFactor),
    height: Math.round(rect.height * scaleFactor),
  };
}

/** Parse the monitor index out of an overlay window label (`overlay-2` -> 2). */
export function monitorIndexFromLabel(label: string): number | null {
  const m = /^overlay-(\d+)$/.exec(label);
  return m ? Number(m[1]) : null;
}
