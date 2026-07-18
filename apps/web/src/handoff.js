// Web side of the desktop -> web "Continue on web" hand-off.
//
// PRIVACY: the desktop app only ever puts the editor STYLE + annotation OPS in
// the URL fragment (`#handoff=...`) — never the image bytes, and fragments are
// never sent to the server. So on arrival we have the look + edits but NOT the
// screenshot. We therefore:
//   1. apply the style immediately (so the stage/backdrop matches),
//   2. clear to the empty drop-zone so the user re-adds their image, and
//   3. replay the ops on top the moment that image loads — identical result.
import { editor, readHandoffFromHash } from "@screenxshot/editor";

const STYLE_KEYS = ["color", "size", "frame", "padding", "srad", "shadow"];

/** Apply a snapshotStyle() blob onto the live editor via its public setters. */
function applyStyle(style) {
  if (!style || typeof style !== "object") return;
  for (const key of STYLE_KEYS) {
    if (style[key] != null) editor.applySetting(key, style[key]);
  }
  if (style.bg != null) editor.setBg(style.bg);
}

/**
 * Read `#handoff=` on load and rehydrate the editor. No-op when the fragment is
 * absent or malformed (normal web visitors are unaffected).
 *
 * The editor mounts a demo image on load; we clear it to the drop zone so the
 * privacy-preserved "bring your own image" flow is obvious, then replay the ops
 * once the user's image is loaded.
 */
export function initHandoff() {
  const payload = readHandoffFromHash(window.location.hash);
  if (!payload) return;

  // The editor mounts imperatively in a React effect (and its demo image loads
  // after document.fonts.ready). Wait until it's mounted before rehydrating.
  if (!editor.mounted) {
    requestAnimationFrame(() => rehydrate(payload));
    return;
  }
  rehydrate(payload);
}

function rehydrate(payload) {
  if (!editor.mounted) {
    requestAnimationFrame(() => rehydrate(payload));
    return;
  }

  // Drop the encoded state from the address bar so a refresh/share is clean.
  history.replaceState(null, "", window.location.pathname + window.location.search);

  applyStyle(payload.style);

  // Show the empty drop zone (the image never travels — the user re-adds it).
  editor.clearAll();

  // Replay ops on the FIRST image the user provides, then restore normal load.
  // We patch fromSrc (used by paste/drop/file-pick) rather than loadImage so the
  // engine's internally-generated demo canvas can never trigger the one-shot.
  const ops = payload.ops ?? [];
  if (ops.length === 0) return;
  const originalFromSrc = editor.fromSrc.bind(editor);
  editor.fromSrc = function patchedFromSrc(src) {
    editor.fromSrc = originalFromSrc; // one-shot: restore before loading
    const im = new Image();
    im.onload = () => {
      editor.loadImage(im); // resets ops to []
      editor.ops = JSON.parse(JSON.stringify(ops));
      editor.paint();
    };
    im.src = src;
  };
}
