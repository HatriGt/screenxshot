import { test, expect } from "vitest";
import { windowAtPoint, toLocalRect, type WindowInfo } from "./windowPick";

function win(
  id: number,
  x: number,
  y: number,
  width: number,
  height: number,
  z: number,
): WindowInfo {
  return { id, title: `w${id}`, app_name: "App", x, y, width, height, z };
}

test("windowAtPoint returns the only window containing the point", () => {
  const a = win(1, 0, 0, 100, 100, 0);
  expect(windowAtPoint([a], { x: 50, y: 50 })?.id).toBe(1);
});

test("windowAtPoint returns null when the point is over no window", () => {
  const a = win(1, 0, 0, 100, 100, 0);
  expect(windowAtPoint([a], { x: 500, y: 500 })).toBeNull();
});

test("windowAtPoint resolves overlap front-wins by z (higher z wins)", () => {
  const back = win(1, 0, 0, 200, 200, 1);
  const front = win(2, 50, 50, 200, 200, 5);
  // Point in the overlap region -> the higher-z (front) window wins.
  expect(windowAtPoint([back, front], { x: 100, y: 100 })?.id).toBe(2);
});

test("windowAtPoint is independent of input ordering", () => {
  const back = win(1, 0, 0, 200, 200, 1);
  const front = win(2, 50, 50, 200, 200, 5);
  // Same result regardless of array order (no reliance on pre-sorting).
  expect(windowAtPoint([front, back], { x: 100, y: 100 })?.id).toBe(2);
});

test("windowAtPoint picks the back window outside the front window's bounds", () => {
  const back = win(1, 0, 0, 200, 200, 1);
  const front = win(2, 150, 150, 200, 200, 5);
  // (100,100) is only inside the back window.
  expect(windowAtPoint([back, front], { x: 100, y: 100 })?.id).toBe(1);
});

test("windowAtPoint treats right/bottom edges as exclusive", () => {
  const a = win(1, 0, 0, 100, 100, 0);
  expect(windowAtPoint([a], { x: 100, y: 50 })).toBeNull();
  expect(windowAtPoint([a], { x: 99, y: 99 })?.id).toBe(1);
});

test("toLocalRect subtracts monitor origin and divides by scale", () => {
  const w = win(1, 1000, 500, 800, 600, 0);
  expect(toLocalRect(w, { x: 1000, y: 0 }, 2)).toEqual({
    x: 0,
    y: 250,
    width: 400,
    height: 300,
  });
});

test("toLocalRect is identity minus origin at scale 1", () => {
  const w = win(1, 300, 200, 100, 100, 0);
  expect(toLocalRect(w, { x: 100, y: 100 }, 1)).toEqual({
    x: 200,
    y: 100,
    width: 100,
    height: 100,
  });
});
