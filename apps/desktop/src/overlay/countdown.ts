// Pure self-timer helpers. DOM-free/testable: the overlay drives the visual
// countdown from these, then proceeds with the existing capture path.

/** Whether a self-timer value should trigger a countdown before the grab. */
export function isSelfTimerEnabled(secs: number): boolean {
  return Number.isFinite(secs) && secs > 0;
}

/**
 * The descending sequence of numbers to display for a self-timer of `secs`
 * seconds, e.g. 3 -> [3, 2, 1]. Non-positive or non-finite inputs yield [].
 */
export function countdownSequence(secs: number): number[] {
  if (!isSelfTimerEnabled(secs)) return [];
  const n = Math.floor(secs);
  const out: number[] = [];
  for (let i = n; i >= 1; i--) out.push(i);
  return out;
}
