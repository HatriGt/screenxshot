// CANONICAL PRESET SHAPE (single source of truth — desktop importPresetFromFile
// and exportPresetToFile MUST align to this envelope):
//
//   { v?: number, id: string, name: string, style: { <bare style keys> } }
//
// where `style` holds the PRESET_KEYS subset (color, size, frame, padding, srad,
// shadow, bg) — exactly serializePreset()/snapshotStyle() output.
//
// Contract:
//   - editor.exportPreset()  -> returns this envelope (v:1 + generated id/name).
//   - isValidPreset(preset)  -> true iff envelope has string id+name and a
//                               non-empty style object. Validate imports with it.
//   - editor.applyPreset(p)  -> reads p.style (envelope) OR treats p as the bare
//                               style for backward compat. Desktop should pass
//                               the parsed ENVELOPE straight through.
//
// Built-in style presets for the one-click gallery. Each is a portable preset
// in the exact shape produced by exportPreset() (envelope with `style` holding
// the PRESET_KEYS subset), so applyPreset() and exportStyledBlob() consume them.
export const BUILTIN_PRESETS = [
  {
    id: "clean-white",
    name: "Clean white",
    style: { frame: "none", padding: 0.16, srad: 0.02, shadow: 0.06, bg: { kind: "solid", i: 0 } },
  },
  {
    id: "gradient-pop",
    name: "Gradient pop",
    style: { frame: "none", padding: 0.26, srad: 0.02, shadow: 0.1, bg: { kind: "grad", i: 4 } },
  },
  {
    id: "dark-mac",
    name: "Dark Mac",
    style: { frame: "dark", padding: 0.24, srad: 0.015, shadow: 0.11, bg: { kind: "solid", i: 4 } },
  },
  {
    id: "minimal-shadow",
    name: "Minimal shadow",
    style: { frame: "none", padding: 0.2, srad: 0.018, shadow: 0.14, bg: { kind: "solid", i: 1 } },
  },
  {
    id: "aurora-glow",
    name: "Aurora glow",
    style: { frame: "light", padding: 0.28, srad: 0.015, shadow: 0.09, bg: { kind: "wall", id: "aurora" } },
  },
  {
    id: "sunset-warm",
    name: "Sunset warm",
    style: { frame: "light", padding: 0.26, srad: 0.015, shadow: 0.09, bg: { kind: "wall", id: "sunset" } },
  },
];

// The subset of preset style keys the gallery understands (mirror of PRESET_KEYS,
// minus `color`/`size` which are annotation defaults, not backdrop look).
const STYLE_KEYS = ["color", "size", "frame", "padding", "srad", "shadow", "bg"];

/** True when `preset` is a usable gallery entry: has an id, name, and a style object. */
export function isValidPreset(preset) {
  if (!preset || typeof preset !== "object") return false;
  if (typeof preset.id !== "string" || typeof preset.name !== "string") return false;
  if (!preset.style || typeof preset.style !== "object") return false;
  return STYLE_KEYS.some((k) => preset.style[k] != null);
}
