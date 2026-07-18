import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "@tanstack/react-store";
import { invoke } from "@tauri-apps/api/core";
import { Studio, editorStore } from "@screenxshot/editor";
import "@screenxshot/editor/styles.css";
import "./desktop.css";
import {
  initDesktopBridge,
  saveCurrentStyleAsDefault,
  saveCurrentToFolder,
} from "./desktopBridge";
import { Titlebar } from "./Titlebar";

// Desktop shell: a slim native titlebar (the window is frameless) above the
// shared editor, which fills the whole window. The editor's Copy/Save controls
// are repositioned by desktop.css into a floating action bar over the stage;
// Capture + Save-to-folder are added here as floating actions.
function App() {
  const hasImage = useStore(editorStore, (s) => s.hasImage);
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [savedToFolder, setSavedToFolder] = useState(false);

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
        <Studio />

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

// Wire native capture delivery (hotkey/overlay -> editor).
void initDesktopBridge();
