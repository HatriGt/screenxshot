import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { normalizeRect, isMeaningfulSelection, type SelectionRect } from "./rect";

const dim = document.getElementById("dim") as HTMLElement;
const selEl = document.getElementById("selection") as HTMLElement;

let start: { x: number; y: number } | null = null;
const dpr = window.devicePixelRatio || 1;

/** Convert a CSS-pixel rect to physical pixels for the native capture. */
function toPhysical(rect: SelectionRect): SelectionRect {
  return {
    x: Math.round(rect.x * dpr),
    y: Math.round(rect.y * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
  };
}

function drawSelection(rect: SelectionRect) {
  selEl.hidden = false;
  dim.style.display = "none"; // the selection's box-shadow provides the dim
  selEl.style.left = `${rect.x}px`;
  selEl.style.top = `${rect.y}px`;
  selEl.style.width = `${rect.width}px`;
  selEl.style.height = `${rect.height}px`;
}

async function cancel() {
  await invoke("cancel_overlay").catch(() => {});
}

window.addEventListener("pointerdown", (e) => {
  start = { x: e.clientX, y: e.clientY };
});

window.addEventListener("pointermove", (e) => {
  if (!start) return;
  drawSelection(normalizeRect(start, { x: e.clientX, y: e.clientY }));
});

window.addEventListener("pointerup", async (e) => {
  if (!start) return;
  const cssRect = normalizeRect(start, { x: e.clientX, y: e.clientY });
  start = null;
  if (!isMeaningfulSelection(cssRect)) {
    await cancel();
    return;
  }
  const label = getCurrentWebviewWindow().label;
  // Monitor id is derived by Rust from the overlay window's label mapping.
  await invoke("finish_capture", { rect: toPhysical(cssRect), overlayLabel: label });
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cancel();
});
