import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HotkeyRecorder } from "./HotkeyRecorder";
import type { AfterCapture, Settings } from "./types";
import "./settings.css";

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}

function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label className={"sw" + (checked ? " sw--on" : "")}>
      <input
        type="checkbox"
        className="sw__input"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="sw__knob" />
    </label>
  );
}

const AFTER_CAPTURE_OPTIONS: { id: AfterCapture; label: string }[] = [
  { id: "open-editor", label: "Open editor" },
  { id: "copy-styled", label: "Copy styled" },
  { id: "copy-raw", label: "Copy raw" },
];

const AFTER_CAPTURE_DESC: Record<AfterCapture, string> = {
  "open-editor": "Bring the capture into the editor to annotate and beautify.",
  "copy-styled": "Apply your saved look, copy it, and show a quick toast.",
  "copy-raw": "Copy the plain screenshot straight to the clipboard.",
};

function SettingsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void invoke<Settings>("get_settings").then(setSettings);
  }, []);

  if (!settings) return <div className="loading" />;

  function patch(next: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...next } : s));
    setSaved(false);
  }

  async function persist(next: Settings) {
    await invoke("set_hotkey", { hotkey: next.hotkey });
    await invoke("set_settings", { settings: next });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  async function pickFolder() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") patch({ save_dir: dir });
  }

  const s = settings;
  const hasDefaultStyle =
    s.default_style != null && typeof s.default_style === "object";
  const autoNeedsFolder = s.after_capture !== "open-editor" && !s.save_dir;
  const folderName = s.save_dir
    ? s.save_dir.split(/[\\/]/).filter(Boolean).pop()
    : null;

  return (
    <div className="win">
      <header className="win__bar" data-tauri-drag-region>
        <h1 className="win__title">Settings</h1>
      </header>

      <main className="win__body">
        <p className="grp__label">Capture</p>
        <div className="grp">
          <div className="item">
            <span className="item__label">Shortcut</span>
            <HotkeyRecorder
              value={s.hotkey}
              onChange={(hotkey) => patch({ hotkey })}
            />
          </div>

          <div className="item item--col">
            <div className="item__row">
              <span className="item__label">After capture</span>
              <div className="seg" role="radiogroup" aria-label="After capture">
                {AFTER_CAPTURE_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={s.after_capture === o.id}
                    className={
                      "seg__opt" + (s.after_capture === o.id ? " is-active" : "")
                    }
                    onClick={() => patch({ after_capture: o.id })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="item__hint">{AFTER_CAPTURE_DESC[s.after_capture]}</p>
          </div>

          <div className="item">
            <div className="item__text">
              <span className="item__label">Default style</span>
              <span className="item__sub">
                {hasDefaultStyle
                  ? "Applied to “Copy styled” captures."
                  : "Set it from the editor — dial a look, press “Set default”."}
              </span>
            </div>
            <div className="item__control">
              <span className={"dot" + (hasDefaultStyle ? " dot--on" : "")} />
              <span className="item__state">
                {hasDefaultStyle ? "Saved" : "None"}
              </span>
              {hasDefaultStyle && (
                <button
                  type="button"
                  className="link"
                  onClick={() => patch({ default_style: null })}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="grp__label">Saving</p>
        <div className="grp">
          <div className="item">
            <div className="item__text">
              <span className="item__label">Save folder</span>
              <span className="item__sub" title={s.save_dir || undefined}>
                {folderName ?? "Ask for a location each time"}
              </span>
            </div>
            <div className="item__control">
              <button type="button" className="btn" onClick={() => void pickFolder()}>
                {s.save_dir ? "Change" : "Choose…"}
              </button>
              {s.save_dir && (
                <button
                  type="button"
                  className="link"
                  onClick={() => patch({ save_dir: "" })}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {autoNeedsFolder && (
            <div className="item item--note">
              Pick a folder so auto-copied captures are saved to disk too.
            </div>
          )}
        </div>

        <p className="grp__label">General</p>
        <div className="grp">
          <div className="item">
            <div className="item__text">
              <span className="item__label">Launch on startup</span>
              <span className="item__sub">Start ScreenXShot when you log in.</span>
            </div>
            <Toggle
              label="Launch on startup"
              checked={s.launch_on_startup}
              onChange={(v) => patch({ launch_on_startup: v })}
            />
          </div>
          <div className="item">
            <div className="item__text">
              <span className="item__label">Keep running in tray</span>
              <span className="item__sub">
                Closing the window stays ready for instant capture.
              </span>
            </div>
            <Toggle
              label="Keep running in tray"
              checked={s.tray_closes_to_tray}
              onChange={(v) => patch({ tray_closes_to_tray: v })}
            />
          </div>
        </div>
      </main>

      <footer className="win__foot">
        <span className={"foot__saved" + (saved ? " is-shown" : "")}>
          Changes saved
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => void getCurrentWindow().close()}
        >
          Close
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void persist(s)}
        >
          Save
        </button>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(<SettingsApp />);
