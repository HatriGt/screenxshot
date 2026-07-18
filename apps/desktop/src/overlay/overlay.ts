import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  normalizeRect,
  isMeaningfulSelection,
  toPhysicalRect,
  monitorIndexFromLabel,
  type SelectionRect,
} from "./rect";

const dim = document.getElementById("dim") as HTMLElement;
const selEl = document.getElementById("selection") as HTMLElement;
const bar = document.getElementById("bar") as HTMLElement;
const hint = document.getElementById("hint") as HTMLElement;

let start: { x: number; y: number } | null = null;
let finished = false;
const scaleFactor = window.devicePixelRatio || 1;
const win = getCurrentWebviewWindow();
const monitorIndex = monitorIndexFromLabel(win.label);

function drawSelection(rect: SelectionRect) {
  selEl.hidden = false;
  dim.classList.add("selecting"); // base dim off; selection shadow provides dim
  selEl.style.left = `${rect.x}px`;
  selEl.style.top = `${rect.y}px`;
  selEl.style.width = `${rect.width}px`;
  selEl.style.height = `${rect.height}px`;
}

function resetSelection() {
  start = null;
  selEl.hidden = true;
  dim.classList.remove("selecting");
  // Restore chrome that a prior whole-screen/window capture blanked (the window
  // is reused, so state persists between captures).
  dim.hidden = false;
  bar.hidden = false;
  hint.hidden = false;
}

async function cancel() {
  if (finished) return;
  finished = true;
  await invoke("cancel_overlay").catch((err) => console.error("cancel overlay failed", err));
}

// Re-arm the overlay. The window is reused (hidden/shown) across captures, so
// the module keeps running — without this, `finished` stays true after the first
// capture and every later capture ignores all input.
function arm() {
  finished = false;
  resetSelection();
}

// Grab focus so the very first click isn't swallowed by the OS.
void win.setFocus().catch(() => {});

// Rust shows + focuses the overlay on every capture; re-arm on each focus gain.
void win.onFocusChanged(({ payload: focused }) => {
  if (focused) arm();
});

// Deterministic re-arm: Rust emits this whenever it reveals a reused overlay.
void win.listen("overlay:arm", () => arm());

window.addEventListener("pointerdown", (e) => {
  if (finished) return;
  // Clicks on the toolbar must not begin an area selection.
  if (bar.contains(e.target as Node)) return;
  start = { x: e.clientX, y: e.clientY };
});

window.addEventListener("pointermove", (e) => {
  if (!start) return;
  drawSelection(normalizeRect(start, { x: e.clientX, y: e.clientY }));
});

window.addEventListener("pointerup", async (e) => {
  if (!start || finished) return;
  const cssRect = normalizeRect(start, { x: e.clientX, y: e.clientY });
  resetSelection();
  if (!isMeaningfulSelection(cssRect)) {
    await cancel();
    return;
  }
  finished = true;
  await invoke("finish_capture", {
    rect: toPhysicalRect(cssRect, scaleFactor),
    monitorIndex,
  }).catch((err) => console.error("finish capture failed", err));
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void cancel();
});

// Bottom toolbar: whole-screen / window capture + cancel. Area is the default
// drag behaviour; its button just reaffirms the active mode.
// Instantly clear the overlay chrome (dim + toolbar) before invoking Rust. The
// overlay covers the whole monitor, so for a whole-screen grab the dim's abrupt
// removal by Rust's window `hide()` — followed by the 150ms compositor settle —
// reads as a full-screen flash. Blanking the content here first un-dims in one
// clean frame (the window is then hidden underneath an already-empty surface),
// matching the flicker-free Window path.
function blankOverlay() {
  dim.hidden = true;
  bar.hidden = true;
  hint.hidden = true;
  selEl.hidden = true;
}

async function captureScreen() {
  if (finished) return;
  finished = true;
  blankOverlay();
  await invoke("capture_fullscreen", { monitorIndex }).catch((err) =>
    console.error("capture fullscreen failed", err),
  );
}

async function captureWindow() {
  if (finished) return;
  finished = true;
  blankOverlay();
  await invoke("capture_window").catch((err) => console.error("capture window failed", err));
}

document.getElementById("screen")?.addEventListener("click", (e) => {
  e.stopPropagation();
  void captureScreen();
});
document.getElementById("window")?.addEventListener("click", (e) => {
  e.stopPropagation();
  void captureWindow();
});
document.getElementById("area")?.addEventListener("click", (e) => {
  e.stopPropagation();
  // Already the default mode; nudge the user to drag.
  hint.classList.remove("hidden");
});
document.getElementById("cancel")?.addEventListener("click", (e) => {
  e.stopPropagation();
  void cancel();
});
