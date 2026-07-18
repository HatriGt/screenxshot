import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeNumber, serializePreset, mergePreset } from "./engine.js";

test("badgeNumber derives a badge's number from its order among badge ops", () => {
  const ops = [
    { type: "badge" },
    { type: "arrow" },
    { type: "badge" },
    { type: "badge" },
  ];
  assert.equal(badgeNumber(ops, 0), 1);
  assert.equal(badgeNumber(ops, 2), 2);
  assert.equal(badgeNumber(ops, 3), 3);
});

test("badgeNumber returns 0 for a non-badge op", () => {
  const ops = [{ type: "badge" }, { type: "arrow" }];
  assert.equal(badgeNumber(ops, 1), 0);
});

test("deleting a badge auto-renumbers the ones after it", () => {
  const ops = [{ type: "badge" }, { type: "badge" }, { type: "badge" }, { type: "badge" }];
  ops.splice(1, 1); // delete badge 2
  assert.equal(badgeNumber(ops, 0), 1);
  assert.equal(badgeNumber(ops, 1), 2); // was 3
  assert.equal(badgeNumber(ops, 2), 3); // was 4
});

test("reordering badges renumbers by draw order", () => {
  const ops = [{ type: "badge", id: "a" }, { type: "badge", id: "b" }, { type: "badge", id: "c" }];
  const [b] = ops.splice(1, 1);
  ops.push(b); // move b to the end
  assert.equal(ops[ops.length - 1].id, "b");
  assert.equal(badgeNumber(ops, ops.length - 1), 3);
});

const styleState = {
  color: "#ef4444",
  size: "m",
  frame: "light",
  padding: 0.24,
  srad: 0.015,
  shadow: 0.075,
  bg: { kind: "wall", id: "bloom" },
  tool: "cursor", // extra state that must NOT be serialized
};

test("serializePreset captures only the style keys", () => {
  const p = serializePreset(styleState);
  assert.deepEqual(Object.keys(p).sort(), ["bg", "color", "frame", "padding", "shadow", "size", "srad"]);
  assert.equal(p.tool, undefined);
});

test("serializePreset is a deep copy (bg is decoupled)", () => {
  const p = serializePreset(styleState);
  p.bg.id = "sky";
  assert.equal(styleState.bg.id, "bloom");
});

test("mergePreset applies preset keys over a base, keeping base for absent keys", () => {
  const base = serializePreset(styleState);
  const merged = mergePreset(base, { padding: 0.4, bg: { kind: "solid", i: 0 } });
  assert.equal(merged.padding, 0.4);
  assert.deepEqual(merged.bg, { kind: "solid", i: 0 });
  assert.equal(merged.color, "#ef4444"); // untouched
});

test("preset round-trip is stable: merge(base, serialize(base)) === base", () => {
  const base = serializePreset(styleState);
  assert.deepEqual(mergePreset(base, serializePreset(styleState)), base);
});
