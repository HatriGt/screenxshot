import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";

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

/** Run an inline toast action. Copy/Copy-styled keep the toast up (quick
 * actions); Pin/Edit hand off to another window and end the toast's lifecycle
 * (Rust hides it). */
function runAction(action: ToastAction): void {
  switch (action) {
    case "copy":
      void copyRaw().catch((err) => console.error("toast copy failed", err));
      return;
    case "copy-styled":
      void invoke("toast_copy_styled").catch((err) =>
        console.error("toast copy styled failed", err),
      );
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
  timer = window.setTimeout(timeout, dismissMs);
}

/** Pull the buffered PNG bytes and show them as the preview thumbnail. */
async function loadPreview(): Promise<void> {
  try {
    const bytes = await invoke<ArrayBuffer>("toast_preview");
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
  clearTimer();
  bar.style.animationPlayState = "paused";
});
toast.addEventListener("mouseleave", () => {
  if (done || toast.classList.contains("is-capturing")) return;
  // Never mode has no timeout to resume.
  if (dismissMs <= 0) return;
  bar.style.animationPlayState = "running";
  clearTimer();
  timer = window.setTimeout(timeout, dismissMs);
});

void listen<PhaseEvent>("toast:phase", (e) => {
  dismissMs = e.payload.dismiss_ms;
  setPhase(e.payload.phase);
});

// Initial phase comes from the URL hash the Rust builder set on first show.
// The real dismiss_ms arrives with the first toast:phase event.
const initial: Phase = window.location.hash === "#capturing" ? "capturing" : "ready";
setPhase(initial);
