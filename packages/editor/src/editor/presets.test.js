import { test } from "node:test";
import assert from "node:assert/strict";
import { cheatsheetRows, KEY } from "./engine.js";
import { BUILTIN_PRESETS, isValidPreset } from "./presets.js";

test("cheatsheetRows has one row per KEY entry, in order", () => {
  const rows = cheatsheetRows();
  assert.equal(rows.length, Object.keys(KEY).length);
  assert.deepEqual(
    rows.map((r) => r.tool),
    Object.values(KEY),
  );
});

test("cheatsheetRows keys are uppercased and every row has a label", () => {
  for (const r of cheatsheetRows()) {
    assert.equal(r.key, r.key.toUpperCase());
    assert.ok(r.label && typeof r.label === "string");
    assert.notEqual(r.label, r.tool.toUpperCase()); // has a friendly label, not raw id
  }
});

test("all built-in presets are valid", () => {
  assert.ok(BUILTIN_PRESETS.length >= 4);
  for (const p of BUILTIN_PRESETS) assert.ok(isValidPreset(p), `${p.id} should be valid`);
});

test("built-in preset ids are unique", () => {
  const ids = BUILTIN_PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("isValidPreset rejects malformed input", () => {
  assert.equal(isValidPreset(null), false);
  assert.equal(isValidPreset({}), false);
  assert.equal(isValidPreset({ id: "x", name: "X" }), false); // no style
  assert.equal(isValidPreset({ id: "x", name: "X", style: {} }), false); // empty style
  assert.equal(isValidPreset({ id: "x", name: "X", style: { padding: 0.2 } }), true);
});
