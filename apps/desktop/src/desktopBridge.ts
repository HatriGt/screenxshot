import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { editor } from "@screenxshot/editor";
import { bytesToObjectUrl } from "./bytesToObjectUrl";
import { needsNativeClipboard, needsNativeSave } from "./clipboardFallback";
import { joinSavePath } from "./savePath";
import type { AfterCapture, Settings } from "./settings/types";

interface AutoCapturePayload {
  mode: AfterCapture;
  style: unknown;
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
  const filename = `screenxshot-${Date.now()}.png`;

  // If the user set a default save folder, write straight there — no dialog.
  const settings = await invoke<Settings>("get_settings").catch(() => null);
  if (settings?.save_dir) {
    const path = joinSavePath(settings.save_dir, filename);
    await invoke("save_png", { path, bytes: Array.from(bytes) });
    return;
  }

  const path = await save({
    defaultPath: filename,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (path) {
    await invoke("save_png", { path, bytes: Array.from(bytes) });
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
    await invoke("auto_save_capture", { bytes: Array.from(bytes) });
    return;
  }
  const path = await save({
    defaultPath: `screenxshot-${Date.now()}.png`,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (path) await invoke("save_png", { path, bytes: Array.from(bytes) });
}

/** Persist the current editor look as the default style for auto-copy mode. */
export async function saveCurrentStyleAsDefault(): Promise<void> {
  const settings = await invoke<Settings>("get_settings");
  const next: Settings = { ...settings, default_style: editor.snapshotStyle() };
  await invoke("set_settings", { settings: next });
}
