import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { editor, encodeHandoff, HANDOFF_PARAM, isValidPreset } from "@screenxshot/editor";
import { bytesToObjectUrl } from "./bytesToObjectUrl";
import { needsNativeClipboard, needsNativeSave } from "./clipboardFallback";
import { joinSavePath } from "./savePath";
import type { AfterCapture, ExportFormat, Settings } from "./settings/types";

interface AutoCapturePayload {
  mode: AfterCapture;
  style: unknown;
}

/** Filename extension for the configured export format (files only). */
function formatExtension(format: ExportFormat): string {
  switch (format) {
    case "png":
      return "png";
    case "jpeg":
      return "jpg";
    default: {
      const _never: never = format;
      return _never;
    }
  }
}

// The single place the desktop app talks to Tauri for capture delivery. Keeps
// @screenxshot/editor platform-agnostic: the editor only ever sees a normal
// image URL via its existing fromSrc().

// Monotonic token so that when several captures load in quick succession, only
// the most recent decode is allowed to swap the canvas. Without this, two
// in-flight Image loads can resolve out of order and an OLDER capture can win,
// showing a random previously-taken screenshot.
let editorLoadGen = 0;

/**
 * Load raw PNG bytes into the shared editor, decoding the image HERE and handing
 * the already-decoded element straight to the engine.
 *
 * Previously this handed a blob URL to `editor.fromSrc()`, which kicks off its
 * OWN async decode with no completion callback; the URL was then revoked on the
 * next frame. If that revoke won the race, the editor's decode failed silently
 * and the PREVIOUS capture stayed on screen (the staleness bug). Decoding once
 * here and calling `editor.loadImage()` with the loaded element removes the
 * second async decode entirely: the URL is only revoked after the editor has
 * consumed the pixels, and a generation token drops any out-of-order load.
 */
export function loadBytesIntoEditor(bytes: ArrayBuffer | Uint8Array): void {
  const gen = ++editorLoadGen;
  const url = bytesToObjectUrl(bytes);
  const img = new Image();
  const release = () => URL.revokeObjectURL(url);
  img.onload = () => {
    // A newer capture started loading while this one decoded — drop it so the
    // stale image can't overwrite the fresher one.
    if (gen !== editorLoadGen) {
      release();
      return;
    }
    editor.loadImage(img);
    release();
  };
  img.onerror = release;
  img.src = url;
}

async function loadLatestCapture(): Promise<void> {
  const bytes = await invoke<ArrayBuffer>("take_capture");
  loadBytesIntoEditor(bytes);
}

/** Native save-as fallback: prompt for a path and write PNG bytes via Rust. */
export async function nativeSavePng(bytes: Uint8Array): Promise<void> {
  if (!needsNativeSave({ anchorDownloadSupported: anchorDownloadSupported() })) {
    return; // web anchor-download path handles it
  }
  // The `bytes` are PNG; Rust re-encodes to the configured format on write.
  const settings = await invoke<Settings>("get_settings").catch(() => null);
  const format: ExportFormat = settings?.export_format ?? "png";
  const ext = formatExtension(format);
  const filename = `screenxshot-${Date.now()}.${ext}`;

  // If the user set a default save folder, write straight there — no dialog.
  if (settings?.save_dir) {
    const path = joinSavePath(settings.save_dir, filename);
    await invoke("save_capture_as", { path, bytes: Array.from(bytes) });
    return;
  }

  const path = await save({
    defaultPath: filename,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });
  if (path) {
    await invoke("save_capture_as", { path, bytes: Array.from(bytes) });
  }
}

/** Native clipboard fallback used when the webview blocks navigator.clipboard. */
export async function nativeCopyPng(bytes: Uint8Array): Promise<void> {
  if (!needsNativeClipboard(navigator)) {
    return; // web clipboard path handles it
  }
  await writeImage(bytes);
}

function anchorDownloadSupported(): boolean {
  return "download" in document.createElement("a");
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Copy-Styled auto-capture flow: the editor stays hidden. Rust already showed
 * the toast and buffered the raw PNG. Pull it, render the styled bytes here
 * (only JS can), copy them to the clipboard, then auto-save (best-effort).
 *
 * Copy-Raw is handled entirely in Rust and never emits `capture:auto`.
 */
async function handleAutoCapture(payload: AutoCapturePayload): Promise<void> {
  const raw = await invoke<ArrayBuffer>("take_capture");
  const rawBytes = new Uint8Array(raw);
  const url = bytesToObjectUrl(raw);
  try {
    // Render the styled bytes; on failure (bad/corrupt src) fall back to the
    // RAW PNG so the user still gets SOMETHING on the clipboard rather than an
    // empty clipboard behind a "Copied" toast (M7).
    let bytes: Uint8Array;
    try {
      const blob = await editor.exportStyledBlob(url, payload.style);
      bytes = await blobToBytes(blob);
    } catch (err) {
      console.error("auto styled render failed, falling back to raw", err);
      bytes = rawBytes;
    }

    // Clipboard write must complete even though the main window is hidden.
    // Surface failures instead of swallowing them.
    try {
      await writeImage(bytes);
    } catch (err) {
      console.error("auto clipboard failed", err);
      // The toast (a separate window) is showing "Copied to clipboard" — correct
      // it so the hint reflects reality (M6). Broadcast; the toast listens.
      await emit("toast:copy-failed").catch((e) =>
        console.error("toast copy-failed emit failed", e),
      );
    }
    // Best-effort auto-save; ignored silently when no folder is configured.
    await invoke("auto_save_capture", { bytes: Array.from(bytes) }).catch((err) =>
      console.error("auto save failed", err),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Initialize desktop capture delivery. Returns an unlisten function. */
export async function initDesktopBridge(): Promise<() => void> {
  const unReady = await listen("capture:ready", () => {
    loadLatestCapture().catch((err) => console.error("capture load failed", err));
  });
  const unAuto = await listen<AutoCapturePayload>("capture:auto", (e) => {
    handleAutoCapture(e.payload).catch((err) =>
      console.error("auto capture failed", err),
    );
  });
  // Tray "Recents" click: open the chosen saved capture in the editor.
  const unHistory = await listen<string>("history:open", (e) => {
    openHistoryInEditor(e.payload).catch((err) =>
      console.error("history open failed", err),
    );
  });
  return () => {
    unReady();
    unAuto();
    unHistory();
  };
}

/** Save the current editor image to the chosen folder (or prompt if unset). */
export async function saveCurrentToFolder(): Promise<void> {
  const blob = await editor.exportCurrentBlob();
  if (!blob) return;
  const bytes = await blobToBytes(blob);
  const settings = await invoke<Settings>("get_settings").catch(() => null);
  if (settings?.save_dir) {
    // Rust picks the format-appropriate extension + re-encodes as needed.
    await invoke("auto_save_capture", { bytes: Array.from(bytes) });
    return;
  }
  const format: ExportFormat = settings?.export_format ?? "png";
  const ext = formatExtension(format);
  const path = await save({
    defaultPath: `screenxshot-${Date.now()}.${ext}`,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }],
  });
  if (path) await invoke("save_capture_as", { path, bytes: Array.from(bytes) });
}

// Web host for "Continue on web" hand-off links. Single easy-to-change constant.
const WEB_BASE = "https://screenxshot.com";

/**
 * Build the "Continue on web" URL for the current editor state.
 *
 * PRIVACY: only style + annotation ops are serialized — never the image bytes.
 * The payload rides in a URL *fragment* (`#handoff=...`) which browsers never
 * send to the server, so the screenshot never leaves the device. The web side
 * re-prompts for the image and then replays the same style + ops on top.
 */
export function buildContinueOnWebUrl(): string {
  const encoded = encodeHandoff({
    style: editor.snapshotStyle(),
    // The engine keeps ops as a plain JSON array; snapshot a deep copy so the
    // encoded payload can't be mutated by later edits.
    ops: JSON.parse(JSON.stringify(editor.ops ?? [])),
  });
  return `${WEB_BASE}/#${HANDOFF_PARAM}=${encoded}`;
}

/**
 * Open the current editor state in the browser via a privacy-preserving
 * hand-off URL (fragment-encoded style + ops, no image bytes).
 */
// Browsers/OSes cap how long a URL an external open can carry; past this the
// hand-off can be silently truncated or rejected. Warn before opening (L13).
const MAX_HANDOFF_URL_LEN = 32000;

export async function continueOnWeb(): Promise<void> {
  const url = buildContinueOnWebUrl();
  if (url.length > MAX_HANDOFF_URL_LEN) {
    console.error("continue on web: handoff payload too large", url.length);
    editor.flash("Too many edits to open on web");
    return;
  }
  try {
    await openUrl(url);
    editor.flash("Opened in browser");
  } catch (err) {
    console.error("continue on web failed", err);
    // Surface the failure to the user instead of silently swallowing it — the
    // click otherwise does nothing visible on failure.
    editor.flash("Couldn't open browser");
  }
}

/** Progress reported during a batch-beautify run. */
export interface BatchProgress {
  done: number;
  total: number;
  ok: number;
  failed: number;
}

/** Outcome of a completed batch-beautify run. */
export interface BatchResult {
  ok: number;
  failed: number;
  cancelled: boolean;
  /** True when no `default_style` was set, so the plain look was applied. */
  usedPlainStyle: boolean;
}

/** Strip a path down to its filename stem (no directory, no extension). */
function pathStem(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "image";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Batch beautify: pick multiple images, apply the persisted `default_style`
 * headlessly to each via the shared editor's `exportStyledBlob`, and save each
 * output into a chosen folder honoring `export_format`. Robust: per-file errors
 * are counted, not fatal. Returns counts, or `cancelled` if the user backed out
 * of either dialog.
 */
export async function batchBeautify(
  onProgress?: (p: BatchProgress) => void,
): Promise<BatchResult> {
  // Step 1 of 2 — choose the screenshots to beautify.
  const picked = await open({
    title: "Batch beautify — Step 1 of 2: choose screenshots",
    multiple: true,
    directory: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  const files = Array.isArray(picked) ? picked : picked ? [picked] : [];
  if (files.length === 0)
    return { ok: 0, failed: 0, cancelled: true, usedPlainStyle: false };

  // Step 2 of 2 — choose where the beautified copies are saved.
  const outDir = await open({
    title: "Batch beautify — Step 2 of 2: choose output folder",
    directory: true,
    multiple: false,
  });
  if (typeof outDir !== "string")
    return { ok: 0, failed: 0, cancelled: true, usedPlainStyle: false };

  const settings = await invoke<Settings>("get_settings").catch(() => null);
  const style = settings?.default_style ?? null;
  const usedPlainStyle = style == null;

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const path = files[i];
    let url: string | undefined;
    try {
      const bytes = await invoke<ArrayBuffer>("read_image_file", { path });
      url = bytesToObjectUrl(bytes);
      const blob = await editor.exportStyledBlob(url, style);
      const out = await blobToBytes(blob);
      await invoke("batch_save", {
        dir: outDir,
        stem: `${pathStem(path)}-beautified`,
        bytes: Array.from(out),
      });
      ok++;
    } catch (err) {
      console.error("batch beautify failed for", path, err);
      failed++;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
    onProgress?.({ done: i + 1, total: files.length, ok, failed });
  }

  return { ok, failed, cancelled: false, usedPlainStyle };
}

/**
 * Export a style preset to a `.json` file the user chooses. Writes the JSON
 * verbatim via the `save_text_file` Rust command (the image-save commands force
 * an export-format re-encode, so they can't be reused for text).
 */
export async function exportPresetToFile(preset: unknown): Promise<void> {
  const path = await save({
    defaultPath: `screenxshot-preset-${Date.now()}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return;
  await invoke("save_text_file", { path, text: JSON.stringify(preset, null, 2) });
}

/**
 * Pick a `.json` preset file and parse it. Reuses `read_image_file` (a plain
 * `fs::read`) to get the raw bytes, then decodes UTF-8 + JSON. Returns the
 * parsed preset, or null if the user cancelled.
 */
export async function importPresetFromFile(): Promise<unknown | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (typeof picked !== "string") return null; // user cancelled
  const bytes = await invoke<ArrayBuffer>("read_image_file", { path: picked });
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Malformed JSON — surface via the caller's "Import failed" message (M7).
    throw new Error("Selected file is not valid JSON", { cause: err });
  }
  if (!isValidPreset(parsed)) {
    throw new Error("Selected file is not a valid preset");
  }
  return parsed;
}

/** One saved-capture record from the Rust history index. */
export interface HistoryEntry {
  path: string;
  /** Unix seconds (UTC) at save time. */
  timestamp: number;
  width?: number;
  height?: number;
  /** True when the file no longer exists on disk. */
  missing: boolean;
}

/** Read the capture-history index (most-recent first). */
export async function getHistory(): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("get_history");
}

/** Clear the entire capture-history index. */
export async function clearHistory(): Promise<void> {
  await invoke("clear_history");
}

/**
 * Load a saved capture from disk into the editor. Reuses the same
 * bytes -> object URL -> editor.fromSrc path as fresh captures.
 */
export async function openHistoryInEditor(path: string): Promise<void> {
  const bytes = await invoke<ArrayBuffer>("read_image_file", { path });
  loadBytesIntoEditor(bytes);
}

/** Persist the current editor look as the default style for auto-copy mode. */
export async function saveCurrentStyleAsDefault(): Promise<void> {
  const settings = await invoke<Settings>("get_settings");
  const next: Settings = { ...settings, default_style: editor.snapshotStyle() };
  await invoke("set_settings", { settings: next });
}
