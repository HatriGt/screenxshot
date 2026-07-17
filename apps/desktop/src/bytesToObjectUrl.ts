// Pure helper: turn raw PNG bytes (from the Tauri capture command) into a Blob
// object URL the editor can load via editor.fromSrc(). Kept separate from the
// Tauri wiring so it is unit-testable without a webview.

export function bytesToObjectUrl(
  bytes: ArrayBuffer | Uint8Array,
  type = "image/png",
): string {
  const blob = new Blob([bytes], { type });
  return URL.createObjectURL(blob);
}
