import { test, expect } from "vitest";
import { needsNativeClipboard, needsNativeSave } from "./clipboardFallback";

test("uses web clipboard when navigator.clipboard.write exists", () => {
  expect(needsNativeClipboard({ clipboard: { write: () => {} } })).toBe(false);
});

test("falls back to native clipboard when write is missing", () => {
  expect(needsNativeClipboard({})).toBe(true);
  expect(needsNativeClipboard({ clipboard: {} })).toBe(true);
});

test("uses web save when anchor download is supported", () => {
  expect(needsNativeSave({ anchorDownloadSupported: true })).toBe(false);
});

test("falls back to native save when anchor download is unsupported", () => {
  expect(needsNativeSave({ anchorDownloadSupported: false })).toBe(true);
});
