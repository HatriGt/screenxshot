import { test, expect } from "vitest";
import { normalizeRect, isMeaningfulSelection } from "./rect";

test("normalizeRect handles a top-left to bottom-right drag", () => {
  expect(normalizeRect({ x: 10, y: 20 }, { x: 110, y: 220 })).toEqual({
    x: 10,
    y: 20,
    width: 100,
    height: 200,
  });
});

test("normalizeRect handles a reversed (bottom-right to top-left) drag", () => {
  expect(normalizeRect({ x: 110, y: 220 }, { x: 10, y: 20 })).toEqual({
    x: 10,
    y: 20,
    width: 100,
    height: 200,
  });
});

test("normalizeRect rounds fractional device pixels", () => {
  expect(normalizeRect({ x: 10.4, y: 20.6 }, { x: 50.5, y: 60.2 })).toEqual({
    x: 10,
    y: 21,
    width: 40,
    height: 40,
  });
});

test("isMeaningfulSelection rejects a click (near-zero area)", () => {
  expect(isMeaningfulSelection({ x: 5, y: 5, width: 1, height: 1 })).toBe(false);
});

test("isMeaningfulSelection accepts a real drag", () => {
  expect(isMeaningfulSelection({ x: 5, y: 5, width: 200, height: 120 })).toBe(true);
});
