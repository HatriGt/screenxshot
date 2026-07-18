import { test, expect } from "vitest";
import { comboFromEvent, isValidCombo, isModifierOnly, type KeyLike } from "./hotkeyCombo";

function ev(partial: Partial<KeyLike>): KeyLike {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

test("comboFromEvent builds a Cmd+Shift+digit combo on mac", () => {
  const combo = comboFromEvent(
    ev({ key: "2", code: "Digit2", metaKey: true, shiftKey: true }),
    true,
  );
  expect(combo).toBe("Cmd+Shift+2");
});

test("comboFromEvent uses Ctrl/Alt naming off mac", () => {
  const combo = comboFromEvent(
    ev({ key: "p", code: "KeyP", ctrlKey: true, altKey: true }),
    false,
  );
  expect(combo).toBe("Ctrl+Alt+P");
});

test("comboFromEvent returns null while only modifiers are held", () => {
  expect(comboFromEvent(ev({ key: "Shift", metaKey: true }), true)).toBeNull();
});

test("comboFromEvent maps space and named keys", () => {
  expect(comboFromEvent(ev({ key: " ", code: "Space", ctrlKey: true }), false)).toBe(
    "Ctrl+Space",
  );
  expect(comboFromEvent(ev({ key: "Enter", code: "Enter", metaKey: true }), true)).toBe(
    "Cmd+Enter",
  );
});

test("isModifierOnly detects modifier keys", () => {
  expect(isModifierOnly("Shift")).toBe(true);
  expect(isModifierOnly("a")).toBe(false);
});

test("isValidCombo requires a modifier and a key", () => {
  expect(isValidCombo("Cmd+Shift+2")).toBe(true);
  expect(isValidCombo("A")).toBe(false);
  expect(isValidCombo("Cmd+Shift")).toBe(false);
  expect(isValidCombo("")).toBe(false);
});
