import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { remainingAfterPause } from "./remaining";

const DEFAULT_DURATION_MS = 5000;

/** Actions offered by the toast's inline buttons. */
type ToastAction = "copy" | "copy-styled" | "pin" | "edit";

type Phase = "capturing" | "ready";

/** Payload of the `toast:phase` event emitted by Rust. `dismissMs` of 0 means
 * "Never" — no countdown bar, no auto-timeout (stays until clicked/dismissed). */
interface PhaseEvent {
  phase: Phase;
  // serde serializes the Rust field `dismiss_ms` as snake_case.
  dismiss_ms: number;
}

// Configured auto-dismiss timeout in ms; 0 = Never. Updated on each phase event.
let dismissMs = DEFAULT_DURATION_MS;

const toast = document.getElementById("toast") as HTMLElement;
const body = document.getElementById("toastbody") as HTMLElement;
const actions = document.getElementById("toastactions") as HTMLElement;
const bar = document.getElementById("toastbar") as HTMLElement;
const title = document.getElementById("toasttitle") as HTMLElement;
const hint = document.getElementById("toasthint") as HTMLElement;
const preview = document.getElementById("toastpreview") as HTMLImageElement;

let timer: number | undefined;
let done = false;
let previewUrl: string | undefined;
// Auto-dismiss timing (M4): the time the current run began and how many ms are
// left. On hover we pause and bank the remainder; on leave we resume with it so
// the JS timeout tracks the CSS bar instead of restarting at full duration.
let runStartedAt = 0;
let remainingMs = 0;
// Bumped on every setPhase(); an in-flight loadPreview() bails if it changed so a
// slow prior fetch can't re-show a superseded capture's thumbnail (H1).
let phaseGen = 0;

function clearTimer(): void {
  if (timer !== undefined) {
    window.clearTimeout(timer);
    timer = undefined;
  }
}

function revokePreview(): void {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
  }
}

/** Timed out: image is already on the clipboard + auto-saved. Just dismiss. */
function timeout(): void {
  if (done) return;
  done = true;
  clearTimer();
  void invoke("toast_dismiss").catch((err) => console.error("toast dismiss failed", err));
}

/** Tapped: open the buffered capture in the editor. */
function edit(): void {
  if (done) return;
  done = true;
  clearTimer();
  void invoke("toast_edit").catch((err) => console.error("toast edit failed", err));
}

/** Copy the raw buffered PNG straight to the clipboard from the toast. */
async function copyRaw(): Promise<void> {
  const bytes = await invoke<ArrayBuffer>("toast_preview");
  await writeImage(new Uint8Array(bytes));
}

/** Surface an action failure to the user via the toast hint (M5/M6). */
function showError(message: string): void {
  hint.textContent = message;
}

/** Run an inline toast action. Copy/Copy-styled keep the toast up (quick
 * actions); Pin/Edit hand off to another window and end the toast's lifecycle
 * (Rust hides it). */
function runAction(action: ToastAction): void {
  switch (action) {
    case "copy":
      // Once the toast is consumed (pin/edit/timeout) or superseded by a new
      // capture, a late click would copy the wrong image — no-op instead (M5).
      if (done) return;
      void copyRaw().catch((err) => {
        console.error("toast copy failed", err);
        showError("Copy failed");
      });
      return;
    case "copy-styled":
      if (done) return;
      void invoke("toast_copy_styled").catch((err) => {
        console.error("toast copy styled failed", err);
        showError("Copy failed");
      });
      return;
    case "pin":
      if (done) return;
      done = true;
      clearTimer();
      void invoke("toast_pin").catch((err) => console.error("toast pin failed", err));
      return;
    case "edit":
      edit();
      return;
    default: {
      const _never: never = action;
      return _never;
    }
  }
}

function startCountdown(): void {
  done = false;
  clearTimer();
  // "Never" (dismissMs === 0): the image was already copied + saved in Rust;
  // we simply keep the toast up with no bar and no auto-timeout. The user
  // clicks to edit or dismisses it manually.
  if (dismissMs <= 0) {
    bar.classList.remove("run");
    toast.classList.add("no-timeout");
    return;
  }
  toast.classList.remove("no-timeout");
  bar.style.setProperty("--toast-dur", `${dismissMs}ms`);
  // Restart the CSS animation cleanly.
  bar.classList.remove("run");
  void bar.offsetWidth; // reflow
  bar.classList.add("run");
  runStartedAt = Date.now();
  remainingMs = dismissMs;
  timer = window.setTimeout(timeout, dismissMs);
}

/** Pull the buffered PNG bytes and show them as the preview thumbnail. */
async function loadPreview(): Promise<void> {
  const gen = phaseGen;
  try {
    const bytes = await invoke<ArrayBuffer>("toast_preview");
    // A newer phase superseded this load while awaiting; drop the stale bytes so
    // we neither re-show the previous capture nor leak a fresh URL (H1).
    if (gen !== phaseGen) return;
    revokePreview();
    previewUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    preview.src = previewUrl;
    toast.classList.add("has-preview");
  } catch (err) {
    // No preview is a soft failure — the toast still works without a thumbnail.
    console.error("toast preview load failed", err);
  }
}

function setPhase(phase: Phase): void {
  // Invalidate any in-flight loadPreview() from a prior phase (H1).
  phaseGen++;
  toast.classList.toggle("is-capturing", phase === "capturing");
  toast.classList.toggle("is-ready", phase === "ready");
  if (phase === "capturing") {
    clearTimer();
    done = false;
    bar.classList.remove("run");
    title.textContent = "Capturing…";
    hint.textContent = "Saving screenshot";
    toast.classList.remove("has-preview");
    preview.removeAttribute("src");
    revokePreview();
  } else {
    title.textContent = "Screenshot captured";
    hint.textContent = "Copied to clipboard";
    void loadPreview();
    startCountdown();
  }
}

// The main body opens the editor; the action row has its own buttons.
body.addEventListener("click", edit);
body.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    edit();
  }
});
actions.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!btn) return;
  runAction(btn.dataset.action as ToastAction);
});
// Pause the countdown while hovering so the user has time to decide.
toast.addEventListener("mouseenter", () => {
  if (toast.classList.contains("is-capturing")) return;
  if (dismissMs <= 0) return;
  // Bank the time left so resume continues from here rather than restarting.
  remainingMs = remainingAfterPause(dismissMs, runStartedAt, Date.now());
  clearTimer();
  bar.style.animationPlayState = "paused";
});
toast.addEventListener("mouseleave", () => {
  if (done || toast.classList.contains("is-capturing")) return;
  // Never mode has no timeout to resume.
  if (dismissMs <= 0) return;
  bar.style.animationPlayState = "running";
  clearTimer();
  // Resume from the banked remainder, keeping the JS timeout in sync with the
  // CSS bar (which the browser also resumes from its paused position).
  runStartedAt = Date.now() - (dismissMs - remainingMs);
  timer = window.setTimeout(timeout, remainingMs);
});

void listen<PhaseEvent>("toast:phase", (e) => {
  dismissMs = e.payload.dismiss_ms;
  setPhase(e.payload.phase);
});

// The auto-copy flow (main window) failed to write the clipboard; correct the
// optimistic "Copied to clipboard" hint (M6).
void listen("toast:copy-failed", () => {
  if (toast.classList.contains("is-capturing")) return;
  showError("Copy failed");
});

// Initial phase comes from the URL hash the Rust builder set on first show.
// The real dismiss_ms arrives with the first toast:phase event.
const initial: Phase = window.location.hash === "#capturing" ? "capturing" : "ready";
setPhase(initial);
