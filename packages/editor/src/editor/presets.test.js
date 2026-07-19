import { test } from "node:test";
import assert from "node:assert/strict";
import { cheatsheetRows, KEY, serializePreset, mergePreset } from "./engine.js";
import { BUILTIN_PRESETS, isValidPreset } from "./presets.js";

// The canonical preset ENVELOPE exportPreset() produces (see engine.js). Built
// here without a DOM Editor instance so the round-trip stays a pure unit test.
function makeExportedPreset(state) {
  return { v: 1, id: "custom-" + Date.now(), name: "Custom preset", style: serializePreset(state) };
}

const roundTripState = {
  color: "#ef4444",
  size: "m",
  frame: "light",
  padding: 0.24,
  srad: 0.015,
  shadow: 0.075,
  bg: { kind: "wall", id: "bloom" },
  tool: "cursor",
};

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

test("exportPreset envelope round-trips: serialize -> isValidPreset -> applyPreset applies same style", () => {
  const exported = makeExportedPreset(roundTripState);

  // Survives JSON (as when written/read from a .json file) and stays valid.
  const wire = JSON.parse(JSON.stringify(exported));
  assert.ok(isValidPreset(wire), "exported preset must pass isValidPreset after JSON round-trip");

  // applyPreset reads the envelope's `.style`; merging it over a base reproduces
  // exactly the serialized style keys.
  const base = serializePreset(roundTripState);
  const applied = mergePreset(base, wire.style);
  assert.deepEqual(applied, serializePreset(roundTripState));
});

test("applyPreset envelope and bare-style forms resolve to the same style", () => {
  // Mirrors applyPreset's arg handling: envelope uses `.style`, bare uses itself.
  const style = serializePreset(roundTripState);
  const envelope = { v: 1, id: "custom-1", name: "Custom preset", style };
  const fromEnvelope = envelope && envelope.style ? envelope.style : envelope;
  const fromBare = style && style.style ? style.style : style;
  assert.deepEqual(fromEnvelope, fromBare);
});
