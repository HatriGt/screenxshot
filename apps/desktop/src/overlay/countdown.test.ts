import { test, expect } from "vitest";
import { isSelfTimerEnabled, countdownSequence } from "./countdown";

test("self-timer is off for zero and negatives", () => {
  expect(isSelfTimerEnabled(0)).toBe(false);
  expect(isSelfTimerEnabled(-1)).toBe(false);
  expect(isSelfTimerEnabled(NaN)).toBe(false);
});

test("self-timer is on for positive seconds", () => {
  expect(isSelfTimerEnabled(3)).toBe(true);
  expect(isSelfTimerEnabled(10)).toBe(true);
});

test("countdown sequence descends from secs to 1", () => {
  expect(countdownSequence(3)).toEqual([3, 2, 1]);
  expect(countdownSequence(5)).toEqual([5, 4, 3, 2, 1]);
});

test("countdown sequence is empty when disabled", () => {
  expect(countdownSequence(0)).toEqual([]);
  expect(countdownSequence(-2)).toEqual([]);
});
