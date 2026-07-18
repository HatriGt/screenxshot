import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Floating control for the long-screenshot session. Each button routes to a
// Rust scroll command; the frame count is pushed from Rust via `scroll:progress`.

/** Payload of the `scroll:progress` event emitted by Rust. */
interface ProgressEvent {
  frames: number;
}

const count = document.getElementById("scrollcount") as HTMLElement;
const next = document.getElementById("scrollnext") as HTMLButtonElement;
const done = document.getElementById("scrolldone") as HTMLButtonElement;
const cancel = document.getElementById("scrollcancel") as HTMLButtonElement;

/** True while a capture/finish invoke is in flight, to debounce double-clicks. */
let busy = false;

function setBusy(value: boolean): void {
  busy = value;
  next.disabled = value;
  done.disabled = value;
}

function renderCount(frames: number): void {
  count.textContent = `${frames} captured`;
}

next.addEventListener("click", () => {
  if (busy) return;
  setBusy(true);
  void invoke("scroll_capture_frame")
    .catch((err) => console.error("scroll capture frame failed", err))
    .finally(() => setBusy(false));
});

done.addEventListener("click", () => {
  if (busy) return;
  setBusy(true);
  void invoke("scroll_finish").catch((err) => {
    console.error("scroll finish failed", err);
    setBusy(false);
  });
});

cancel.addEventListener("click", () => {
  void invoke("scroll_cancel").catch((err) => console.error("scroll cancel failed", err));
});

void listen<ProgressEvent>("scroll:progress", (e) => {
  renderCount(e.payload.frames);
  // A fresh progress push means the prior grab finished; re-enable controls.
  setBusy(false);
});
