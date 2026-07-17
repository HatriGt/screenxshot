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
