import { test, expect, vi, beforeEach, afterEach } from "vitest";

// Controllable fake Image: capture instances so the test can fire onload in any
// order, mirroring real out-of-order blob decodes across rapid captures.
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  static instances: FakeImage[] = [];
  constructor() {
    FakeImage.instances.push(this);
  }
  set src(v: string) {
    this._src = v;
  }
  get src(): string {
    return this._src;
  }
}

const loadImage = vi.fn();

vi.mock("@screenxshot/editor", () => ({
  editor: {
    loadImage: (im: unknown) => loadImage(im),
  },
  encodeHandoff: () => "",
  HANDOFF_PARAM: "handoff",
  isValidPreset: () => true,
}));

let loadBytesIntoEditor: (bytes: ArrayBuffer | Uint8Array) => void;
const revoked: string[] = [];
let urlSeq = 0;

beforeEach(async () => {
  FakeImage.instances = [];
  loadImage.mockClear();
  revoked.length = 0;
  urlSeq = 0;
  vi.stubGlobal("Image", FakeImage);
  // Keep URL a real constructor (tauri plugins use `new URL`), only override the
  // object-URL statics (which don't exist in the node test env).
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () =>
    `blob:mock-${urlSeq++}`;
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = (
    u: string,
  ) => {
    revoked.push(u);
  };
  ({ loadBytesIntoEditor } = await import("./desktopBridge"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

test("loads the decoded image into the editor and revokes its URL", () => {
  loadBytesIntoEditor(new Uint8Array([1, 2, 3]));
  const img = FakeImage.instances[0];
  img.onload?.();
  expect(loadImage).toHaveBeenCalledTimes(1);
  expect(loadImage).toHaveBeenCalledWith(img);
  expect(revoked).toEqual([img.src]);
});

test("only the newest capture wins when two loads resolve out of order", () => {
  // Two captures fire back-to-back (older, then newer).
  loadBytesIntoEditor(new Uint8Array([0])); // older
  loadBytesIntoEditor(new Uint8Array([1])); // newer
  const [older, newer] = FakeImage.instances;

  // The NEWER image decodes first…
  newer.onload?.();
  // …then the OLDER one finishes late. It must NOT overwrite the newer image.
  older.onload?.();

  expect(loadImage).toHaveBeenCalledTimes(1);
  expect(loadImage).toHaveBeenCalledWith(newer);
  // Both URLs are still released so nothing leaks.
  expect(revoked).toContain(older.src);
  expect(revoked).toContain(newer.src);
});

test("a decode error just releases the URL without touching the editor", () => {
  loadBytesIntoEditor(new Uint8Array([9]));
  const img = FakeImage.instances[0];
  img.onerror?.();
  expect(loadImage).not.toHaveBeenCalled();
  expect(revoked).toEqual([img.src]);
});
