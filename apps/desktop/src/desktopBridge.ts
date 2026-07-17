import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { editor } from "@screenxshot/editor";
import { bytesToObjectUrl } from "./bytesToObjectUrl";

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

/** Initialize desktop capture delivery. Returns an unlisten function. */
export async function initDesktopBridge(): Promise<() => void> {
  const unlisten = await listen("capture:ready", () => {
    loadLatestCapture().catch((err) => console.error("capture load failed", err));
  });
  return unlisten;
}
