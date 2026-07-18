import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { editor, encodeHandoff, HANDOFF_PARAM } from "@screenxshot/editor";
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

async function loadLatestCapture(): Promise<void> {
  const bytes = await invoke<ArrayBuffer>("take_capture");
  const url = bytesToObjectUrl(bytes);
  // editor.fromSrc() is fire-and-forget; revoke once the image has loaded by
  // probing a detached Image with the same src (the blob URL is cached).
  editor.fromSrc(url);
  const probe = new Image();
  probe.onload = () => URL.revokeObjectURL(url);
  probe.onerror = () => URL.revokeObjectURL(url);
  probe.src = url;
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
  const url = bytesToObjectUrl(raw);
  try {
    const blob = await editor.exportStyledBlob(url, payload.style);
    const bytes = await blobToBytes(blob);

    // Clipboard write must complete even though the main window is hidden.
    // Surface failures instead of swallowing them.
    try {
      await writeImage(bytes);
    } catch (err) {
      console.error("auto clipboard failed", err);
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
  return () => {
    unReady();
    unAuto();
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
export async function continueOnWeb(): Promise<void> {
  const url = buildContinueOnWebUrl();
  try {
    await openUrl(url);
  } catch (err) {
    console.error("continue on web failed", err);
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
  const picked = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  const files = Array.isArray(picked) ? picked : picked ? [picked] : [];
  if (files.length === 0)
    return { ok: 0, failed: 0, cancelled: true, usedPlainStyle: false };

  const outDir = await open({ directory: true, multiple: false });
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

/** Persist the current editor look as the default style for auto-copy mode. */
export async function saveCurrentStyleAsDefault(): Promise<void> {
  const settings = await invoke<Settings>("get_settings");
  const next: Settings = { ...settings, default_style: editor.snapshotStyle() };
  await invoke("set_settings", { settings: next });
}
