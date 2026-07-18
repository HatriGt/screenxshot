// Decides whether the desktop app should use the native clipboard/save path
// instead of the editor's default web APIs. The web path stays primary; native
// is a fallback only when the webview blocks or lacks the web API.

export function needsNativeClipboard(nav: {
  clipboard?: { write?: unknown };
}): boolean {
  return typeof nav.clipboard?.write !== "function";
}

export function needsNativeSave(opts: {
  anchorDownloadSupported: boolean;
}): boolean {
  return !opts.anchorDownloadSupported;
}
