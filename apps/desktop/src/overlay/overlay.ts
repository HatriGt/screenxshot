import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  normalizeRect,
  isMeaningfulSelection,
  toPhysicalRect,
  monitorIndexFromLabel,
  type SelectionRect,
} from "./rect";
import { countdownSequence } from "./countdown";
import {
  windowAtPoint,
  toLocalRect,
  type WindowInfo,
  type GlobalPoint,
} from "./windowPick";
import type { Settings } from "../settings/types";

const dim = document.getElementById("dim") as HTMLElement;
const selEl = document.getElementById("selection") as HTMLElement;
const bar = document.getElementById("bar") as HTMLElement;
const hint = document.getElementById("hint") as HTMLElement;
const countdownEl = document.getElementById("countdown") as HTMLElement;
const winhiEl = document.getElementById("winhi") as HTMLElement;
const winhiLabelEl = document.getElementById("winhi-label") as HTMLElement;

let start: { x: number; y: number } | null = null;
let finished = false;
// True from the moment a capture is committed (self-timer countdown may be
// running, chrome may be blanked) until the deterministic re-arm for the NEXT
// capture. Guards `overlay:arm` from resetting chrome / clearing the countdown
// mid-flight, which would otherwise bake restored chrome or a half-cleared digit
// into the grab (M2).
let capturing = false;
// Long-screenshot mode: the next region drag starts a scrolling capture session
// (scroll_start) instead of a one-shot grab (finish_capture). Toggled by the
// overlay's "Long screenshot" toolbar button.
let longMode = false;
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
  clearCountdown();
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
  capturing = false;
  longMode = false;
  document.getElementById("scroll")?.classList.remove("is-active");
  exitPicking();
  resetSelection();
}

// Grab focus so the very first click isn't swallowed by the OS.
void win.setFocus().catch(() => {});

// Rust shows + focuses the overlay on every capture; re-arm on focus gain — but
// ONLY when the overlay is idle. A focus event can arrive mid-interaction (the
// main window being shown/focused around a capture bounces focus back to the
// overlay); re-arming then would call resetSelection() and wipe the in-progress
// drag (`start`), so pointerup would see no selection and never fire the grab.
// The deterministic `overlay:arm` event below is the reliable re-arm; this
// focus path only covers the very first click after a fresh reveal.
void win.onFocusChanged(({ payload: focused }) => {
  if (focused && start === null && !finished && !picking) arm();
});

// Deterministic re-arm: Rust emits this whenever it reveals a reused overlay.
// Ignore it while a capture/countdown is mid-flight (M2) — re-arming then would
// call resetSelection()/clearCountdown() and bake restored chrome or a
// half-cleared countdown digit into the grab. The in-flight path clears
// `capturing` once its invoke completes, so the NEXT capture's reveal re-arms.
void win.listen("overlay:arm", () => {
  if (capturing) return;
  arm();
});

window.addEventListener("pointerdown", (e) => {
  if (finished || picking) return;
  // Clicks on the toolbar must not begin an area selection.
  if (bar.contains(e.target as Node)) return;
  start = { x: e.clientX, y: e.clientY };
});

window.addEventListener("pointermove", (e) => {
  if (picking) {
    onPickMove(e);
    return;
  }
  if (!start) return;
  drawSelection(normalizeRect(start, { x: e.clientX, y: e.clientY }));
});

window.addEventListener("click", (e) => {
  if (!picking) return;
  // Clicks on the toolbar (e.g. Cancel) keep their own handlers.
  if (bar.contains(e.target as Node)) return;
  void onPickClick();
});

window.addEventListener("pointerup", async (e) => {
  if (picking) return;
  if (!start || finished) return;
  const cssRect = normalizeRect(start, { x: e.clientX, y: e.clientY });
  if (!isMeaningfulSelection(cssRect)) {
    resetSelection();
    await cancel();
    return;
  }
  finished = true;
  capturing = true;
  // Blank the chrome (dim/toolbar/hint/selection) before the grab so the region
  // capture is flicker-free and never includes our own chrome — matching the
  // whole-screen/window paths, not resetSelection() which RESTORES chrome (M3).
  // runSelfTimer() re-shows just the countdown digit on top of the blanked
  // surface and clears it before the grab.
  blankOverlay();
  await runSelfTimer();
  const physRect = toPhysicalRect(cssRect, scaleFactor);
  // Long-screenshot mode routes the same region to a scrolling-capture session
  // (control window + manual multi-shot stitch) instead of a one-shot grab.
  if (longMode) {
    await invoke("scroll_start", { rect: physRect, monitorIndex }).catch((err) =>
      console.error("scroll start failed", err),
    );
    capturing = false;
    return;
  }
  await invoke("finish_capture", {
    rect: physRect,
    monitorIndex,
  }).catch((err) => console.error("finish capture failed", err));
  capturing = false;
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
  clearCountdown();
}

/** Show the countdown number centered on this monitor's overlay. */
function showCountdownNumber(n: number): void {
  countdownEl.hidden = false;
  countdownEl.textContent = String(n);
}

/** Clear the countdown chrome. MUST run before the grab — it is our own chrome
 * (like the dim/toolbar) and would otherwise be baked into the screenshot. */
function clearCountdown(): void {
  countdownEl.hidden = true;
  countdownEl.textContent = "";
}

/**
 * If a self-timer is configured, count down (3..2..1) in the overlay before
 * proceeding with the capture. Resolves once the countdown finishes and the
 * countdown chrome has been cleared. No-op (immediate) when the timer is off.
 */
async function runSelfTimer(): Promise<void> {
  const settings = await invoke<Settings>("get_settings").catch(() => null);
  const seq = countdownSequence(settings?.self_timer_secs ?? 0);
  if (seq.length === 0) return;
  for (const n of seq) {
    showCountdownNumber(n);
    await new Promise((r) => window.setTimeout(r, 1000));
  }
  clearCountdown();
}

async function captureScreen() {
  if (finished) return;
  finished = true;
  capturing = true;
  // Blank first so the countdown digit shows on an already-clean surface, then
  // runSelfTimer clears it before the grab.
  blankOverlay();
  await runSelfTimer();
  await invoke("capture_fullscreen", { monitorIndex }).catch((err) =>
    console.error("capture fullscreen failed", err),
  );
  capturing = false;
}

// ----- Window-picker mode -------------------------------------------------
// Entering "Window" mode no longer instantly grabs the frontmost window (the
// old title-string heuristic — see capture_window / P13). Instead the user
// hovers windows (highlighted live) and clicks the one to capture. Hit-testing
// is pure + unit-tested in windowPick.ts.

let picking = false;
let pickWindows: WindowInfo[] = [];
let hovered: WindowInfo | null = null;
// This overlay covers exactly one monitor; cache its global physical origin +
// scale so local cursor coords can be mapped into xcap's global-physical space.
let monitorOrigin: GlobalPoint = { x: 0, y: 0 };
let monitorScale = scaleFactor;

/** Map a local (CSS-pixel) overlay point to global physical pixels (xcap space). */
function toGlobalPhysical(clientX: number, clientY: number): GlobalPoint {
  return {
    x: monitorOrigin.x + clientX * monitorScale,
    y: monitorOrigin.y + clientY * monitorScale,
  };
}

function hideHighlight() {
  winhiEl.hidden = true;
  hovered = null;
}

function drawHighlight(w: WindowInfo) {
  const r = toLocalRect(w, monitorOrigin, monitorScale);
  winhiEl.hidden = false;
  winhiEl.style.left = `${r.x}px`;
  winhiEl.style.top = `${r.y}px`;
  winhiEl.style.width = `${r.width}px`;
  winhiEl.style.height = `${r.height}px`;
  winhiLabelEl.textContent = w.title || w.app_name || "Window";
}

/** Leave window-picker mode and restore the region-select chrome. */
function exitPicking() {
  picking = false;
  document.body.classList.remove("picking");
  hideHighlight();
  bar.hidden = false;
  hint.hidden = false;
}

/** Enter window-picker mode: enumerate windows + cache this monitor's geometry. */
async function enterPicking() {
  if (finished) return;
  const [windows, monitor] = await Promise.all([
    invoke<WindowInfo[]>("list_windows").catch((err) => {
      console.error("list windows failed", err);
      return [] as WindowInfo[];
    }),
    win.currentMonitor().catch(() => null),
  ]);
  if (monitor) {
    monitorOrigin = { x: monitor.position.x, y: monitor.position.y };
    monitorScale = monitor.scaleFactor;
  }
  pickWindows = windows;
  picking = true;
  document.body.classList.add("picking");
  // Keep the toolbar (so the user can cancel); drop the drag hint.
  hint.hidden = true;
}

function onPickMove(e: PointerEvent) {
  if (!picking) return;
  const hit = windowAtPoint(pickWindows, toGlobalPhysical(e.clientX, e.clientY));
  if (hit) {
    hovered = hit;
    drawHighlight(hit);
  } else {
    hideHighlight();
  }
}

async function onPickClick() {
  if (!picking || finished) return;
  // Clicked empty space / missed every window — nudge the user instead of
  // silently doing nothing (L11).
  if (!hovered) {
    hint.hidden = false;
    hint.textContent = "No window there — hover a window, then click · Esc to cancel";
    return;
  }
  finished = true;
  capturing = true;
  const id = hovered.id;
  exitPicking();
  blankOverlay();
  await runSelfTimer();
  await invoke("capture_window_by_id", { id }).catch((err) =>
    console.error("capture window by id failed", err),
  );
  capturing = false;
}

/** Toolbar "Window" button: enter the picker (was: instant frontmost grab). */
function captureWindow() {
  if (finished || picking) return;
  void enterPicking();
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
  // Leaving window-picker mode back to the default drag-to-select.
  if (picking) exitPicking();
  // Already the default mode; nudge the user to drag.
  hint.classList.remove("hidden");
  hint.hidden = false;
});
document.getElementById("scroll")?.addEventListener("click", (e) => {
  e.stopPropagation();
  // Arm Long-screenshot mode: the next area drag starts a scrolling session.
  longMode = !longMode;
  (e.currentTarget as HTMLElement).classList.toggle("is-active", longMode);
  hint.textContent = longMode
    ? "Drag to select the scrolling area · Esc to cancel"
    : "Drag to select an area · Esc to cancel";
  hint.hidden = false;
});
document.getElementById("cancel")?.addEventListener("click", (e) => {
  e.stopPropagation();
  void cancel();
});
