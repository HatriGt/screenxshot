import { test, expect } from "vitest";
import { remainingAfterPause } from "./remaining";

test("returns the leftover time after some elapsed", () => {
  // 5000ms run started at t=1000; paused at t=3000 → 3000ms left.
  expect(remainingAfterPause(5000, 1000, 3000)).toBe(3000);
});

test("clamps to zero once elapsed exceeds the duration", () => {
  expect(remainingAfterPause(5000, 1000, 7000)).toBe(0);
});

test("clamps to total when now precedes the start (clock skew)", () => {
  expect(remainingAfterPause(5000, 3000, 1000)).toBe(5000);
});

test("full duration when paused at the exact start", () => {
  expect(remainingAfterPause(5000, 1000, 1000)).toBe(5000);
});

test("Never mode (non-positive total) always yields zero", () => {
  expect(remainingAfterPause(0, 1000, 2000)).toBe(0);
  expect(remainingAfterPause(-1, 1000, 2000)).toBe(0);
});
