import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Studio, editor, editorStore } from "@screenxshot/editor";
import { useStore } from "@tanstack/react-store";
import "@screenxshot/editor/styles.css";
import "../desktop.css";
import "./pin.css";
import { bytesToObjectUrl } from "../bytesToObjectUrl";

// Live editable pin: a small always-on-top window hosting the shared editor on
// the latest capture. Bytes are served the same way the toast preview / main
// editor get them (take_capture -> bytesToObjectUrl -> editor.fromSrc), so the
// engine only ever sees a normal image URL.
async function loadPinnedCapture(): Promise<void> {
  const bytes = await invoke<ArrayBuffer>("take_capture");
  const url = bytesToObjectUrl(bytes);
  editor.fromSrc(url);
  const probe = new Image();
  probe.onload = () => URL.revokeObjectURL(url);
  probe.onerror = () => URL.revokeObjectURL(url);
  probe.src = url;
}

function PinApp() {
  const hasImage = useStore(editorStore, (s) => s.hasImage);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Load immediately on first mount (the window may already be shown), and
    // reload whenever Rust signals a fresh pin.
    void loadPinnedCapture().catch((err) => console.error("pin load failed", err));
    const un = listen("pin:load", () => {
      void loadPinnedCapture().catch((err) =>
        console.error("pin reload failed", err),
      );
    });
    return () => {
      void un.then((fn) => fn());
    };
  }, []);

  async function onCopy() {
    // editor.copy() renders the current composition (image + annotations) and
    // writes it to the clipboard.
    await editor.copy();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="ds-shell pin-shell">
      <div className="pin-bar" data-tauri-drag-region>
        <span className="pin-bar__grip" data-tauri-drag-region aria-hidden />
        <span className="pin-bar__title" data-tauri-drag-region>
          Pinned
        </span>
        <div className="pin-bar__actions">
          {hasImage && (
            <button
              type="button"
              className={"pin-btn" + (copied ? " is-ok" : "")}
              onClick={() => void onCopy()}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          <button
            type="button"
            className="pin-btn pin-btn--close"
            aria-label="Dismiss pin"
            onClick={() => void invoke("pin_dismiss")}
          >
            <svg viewBox="0 0 12 12" aria-hidden>
              <path
                d="M3 3l6 6M9 3l-6 6"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="ds-body">
        <Studio />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<PinApp />);
