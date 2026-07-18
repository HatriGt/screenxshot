import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import { Studio, editorStore } from "@screenxshot/editor";
import "@screenxshot/editor/styles.css";
import "./desktop.css";
import {
  batchBeautify,
  continueOnWeb,
  exportPresetToFile,
  importPresetFromFile,
  initDesktopBridge,
  saveCurrentStyleAsDefault,
  saveCurrentToFolder,
} from "./desktopBridge";
import type { BatchProgress } from "./desktopBridge";
import { Titlebar } from "./Titlebar";
import { HistoryPanel } from "./HistoryPanel";

// Desktop shell: a slim native titlebar (the window is frameless) above the
// shared editor, which fills the whole window. The editor's Copy/Save controls
// are repositioned by desktop.css into a floating action bar over the stage;
// Capture + Save-to-folder are added here as floating actions.
function App() {
  const hasImage = useStore(editorStore, (s) => s.hasImage);
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [savedToFolder, setSavedToFolder] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  async function onBatch() {
    if (batchRunning) return;
    setBatchRunning(true);
    setBatchStatus(null);
    try {
      const result = await batchBeautify((p: BatchProgress) => {
        setBatchStatus(`Beautifying ${p.done}/${p.total}…`);
      });
      if (result.cancelled) {
        setBatchStatus(null);
      } else {
        setBatchStatus(
          `Done — ${result.ok} saved` +
            (result.failed > 0 ? `, ${result.failed} failed` : "") +
            (result.usedPlainStyle
              ? " · Set a default style in Settings for a custom look"
              : ""),
        );
        window.setTimeout(() => setBatchStatus(null), result.usedPlainStyle ? 6000 : 4000);
      }
    } catch (err) {
      console.error("batch beautify failed", err);
      setBatchStatus("Batch failed");
      window.setTimeout(() => setBatchStatus(null), 4000);
    } finally {
      setBatchRunning(false);
    }
  }

  async function onSetDefault() {
    await saveCurrentStyleAsDefault();
    setDefaultSaved(true);
    window.setTimeout(() => setDefaultSaved(false), 1600);
  }

  async function onSave() {
    await saveCurrentToFolder();
    setSavedToFolder(true);
    window.setTimeout(() => setSavedToFolder(false), 1600);
  }

  return (
    <div className="ds-shell">
      <Titlebar />
      <div className="ds-body">
        <Studio onExportPreset={exportPresetToFile} onImportPreset={importPresetFromFile} />

        {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}

        <div className="ds-fabs">
          {hasImage && (
            <button
              type="button"
              className={"ds-fab ds-fab--ghost" + (defaultSaved ? " is-ok" : "")}
              onClick={() => void onSetDefault()}
              title="Save the current look as the default style for auto-copy captures"
            >
              {defaultSaved ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
                  <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                </svg>
              )}
              <span>{defaultSaved ? "Default saved" : "Set default"}</span>
            </button>
          )}

          {hasImage && (
            <button
              type="button"
              className={"ds-fab ds-fab--ghost" + (savedToFolder ? " is-ok" : "")}
              onClick={() => void onSave()}
              title="Save to your chosen folder"
            >
              {savedToFolder ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M5 3h11l3 3v13a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
                  <path d="M8 3v5h7M8 21v-6h8v6" />
                </svg>
              )}
              <span>{savedToFolder ? "Saved" : "Save"}</span>
            </button>
          )}

          {hasImage && (
            <button
              type="button"
              className="ds-fab ds-fab--ghost"
              onClick={() => void continueOnWeb()}
              title="Continue editing this in your browser (style + edits only — the image stays on your device)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z" />
              </svg>
              <span>Continue on web</span>
            </button>
          )}

          <button
            type="button"
            className={"ds-fab ds-fab--ghost" + (historyOpen ? " is-ok" : "")}
            onClick={() => setHistoryOpen((v) => !v)}
            title="Browse recently saved captures"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M12 8v4l3 2" />
              <path d="M3.05 11a9 9 0 111.5 6" />
              <path d="M3 3v5h5" />
            </svg>
            <span>Recents</span>
          </button>

          <button
            type="button"
            className="ds-fab ds-fab--ghost"
            onClick={() => void onBatch()}
            disabled={batchRunning}
            title="Beautify a batch of images with your default style"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <span>{batchRunning ? "Working…" : "Batch"}</span>
          </button>

          {batchStatus && <span className="ds-batch-status">{batchStatus}</span>}

          <button
            type="button"
            className="ds-fab ds-fab--primary"
            onClick={() => void invoke("show_overlay")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2" />
              <circle cx="12" cy="12" r="3.2" />
            </svg>
            <span>Capture</span>
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);

// The main window is created hidden (tauri.conf.json) to avoid a cold-start
// black flash while this bundle loads. Reveal it once React has mounted and the
// browser has committed a first paint — two rAFs ensure we're past the initial
// layout/paint so the window appears already painted, not blank. A Rust-side
// fallback timeout shows it anyway if this never fires.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    void invoke("main_ready");
  });
});

// Wire native capture delivery (hotkey/overlay -> editor).
void initDesktopBridge();
