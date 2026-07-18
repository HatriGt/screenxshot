// Pure timing helper for the toast auto-dismiss countdown. DOM-free/testable:
// the toast pauses on hover and resumes with the leftover time (not the full
// duration) so the JS timeout stays in sync with the CSS bar (M4).

/**
 * Milliseconds left after a pause, given the total duration, when the current
 * run started, and the pause instant. Clamped to [0, total]. A non-positive
 * `total` (Never mode) always yields 0.
 */
export function remainingAfterPause(
  total: number,
  startedAt: number,
  now: number,
): number {
  if (total <= 0) return 0;
  const left = total - (now - startedAt);
  if (left < 0) return 0;
  if (left > total) return total;
  return left;
}
