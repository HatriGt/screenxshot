import { test, expect, vi, beforeEach } from "vitest";
import { bytesToObjectUrl } from "./bytesToObjectUrl";

beforeEach(() => {
  vi.restoreAllMocks();
});

test("wraps bytes in an image/png Blob and returns an object URL", () => {
  const captured: Blob[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: (b: Blob) => {
      captured.push(b);
      return "blob:mock-url";
    },
  });

  const url = bytesToObjectUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

  expect(url).toBe("blob:mock-url");
  expect(captured).toHaveLength(1);
  expect(captured[0].type).toBe("image/png");
  expect(captured[0].size).toBe(4);
});

test("accepts an ArrayBuffer payload", () => {
  vi.stubGlobal("URL", { createObjectURL: () => "blob:ab" });
  const buf = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  expect(bytesToObjectUrl(buf)).toBe("blob:ab");
});
