import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { editor } from "@screenxshot/editor";
import { bytesToObjectUrl } from "./bytesToObjectUrl";
import { needsNativeClipboard, needsNativeSave } from "./clipboardFallback";

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
  const path = await save({
    defaultPath: `screenxshot-${Date.now()}.png`,
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
  const { writeImage } = await import("@tauri-apps/plugin-clipboard-manager");
  await writeImage(bytes);
}

function anchorDownloadSupported(): boolean {
  return "download" in document.createElement("a");
}

/** Initialize desktop capture delivery. Returns an unlisten function. */
export async function initDesktopBridge(): Promise<() => void> {
  const unlisten = await listen("capture:ready", () => {
    loadLatestCapture().catch((err) => console.error("capture load failed", err));
  });
  return unlisten;
}
