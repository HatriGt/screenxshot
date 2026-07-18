import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const DEFAULT_DURATION_MS = 5000;

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

const toast = document.getElementById("toast") as HTMLButtonElement;
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

toast.addEventListener("click", edit);
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
