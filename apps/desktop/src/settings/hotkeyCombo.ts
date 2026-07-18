// Pure helpers for turning a keydown event into a Tauri accelerator string
// (e.g. "Cmd+Shift+2") and validating it. Kept DOM-free for unit testing.

export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_KEYS = new Set([
  "Meta",
  "Control",
  "Alt",
  "Shift",
  "CapsLock",
]);

/** True while the pressed key is only a modifier (combo not complete yet). */
export function isModifierOnly(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

/** Normalize a main key into a Tauri-friendly token. */
function mainKeyToken(e: KeyLike): string | null {
  if (isModifierOnly(e.key)) return null;
  // Prefer the physical code for letters/digits so layout/shift doesn't matter.
  if (/^Key([A-Z])$/.test(e.code)) return e.code.slice(3);
  if (/^Digit(\d)$/.test(e.code)) return e.code.slice(5);
  if (e.key === " ") return "Space";
  if (e.key.length === 1) return e.key.toUpperCase();
  // Named keys (Enter, Escape, F1, arrows…) pass through capitalized.
  return e.key;
}

/**
 * Build an accelerator string from a keydown-like event, or null if only
 * modifiers are held. macOS uses "Cmd"; others use "Ctrl" for the meta slot.
 */
export function comboFromEvent(e: KeyLike, isMac: boolean): string | null {
  const main = mainKeyToken(e);
  if (main === null) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push(isMac ? "Cmd" : "Super");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push(isMac ? "Option" : "Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(main);
  return parts.join("+");
}

/** A combo is valid only with at least one modifier plus one non-modifier key. */
export function isValidCombo(combo: string): boolean {
  const parts = combo.split("+").map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => p === "")) return false;
  const mods = new Set(["Cmd", "Super", "Ctrl", "Control", "Alt", "Option", "Shift"]);
  const hasMod = parts.some((p) => mods.has(p));
  const hasKey = parts.some((p) => !mods.has(p));
  return hasMod && hasKey;
}
