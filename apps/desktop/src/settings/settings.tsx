import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { HotkeyRecorder } from "./HotkeyRecorder";
import type {
  AfterCapture,
  ExportFormat,
  Settings,
  ToastPosition,
} from "./types";
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

interface SegRowProps<T extends string | number> {
  label: string;
  hint?: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}

/** A labelled row with a segmented (radio-group) control. */
function SegRow<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: SegRowProps<T>) {
  return (
    <div className="item item--col">
      <div className="item__row">
        <span className="item__label">{label}</span>
        <div className="seg" role="radiogroup" aria-label={label}>
          {options.map((o) => (
            <button
              key={String(o.id)}
              type="button"
              role="radio"
              aria-checked={value === o.id}
              className={"seg__opt" + (value === o.id ? " is-active" : "")}
              onClick={() => onChange(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {hint && <p className="item__hint">{hint}</p>}
    </div>
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

const TOAST_POSITION_OPTIONS: { id: ToastPosition; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];

// 0 = "Never" (no auto-dismiss; the toast stays until clicked/dismissed).
const TOAST_DISMISS_OPTIONS: { id: number; label: string }[] = [
  { id: 3000, label: "3s" },
  { id: 5000, label: "5s" },
  { id: 8000, label: "8s" },
  { id: 0, label: "Never" },
];

const SELF_TIMER_OPTIONS: { id: number; label: string }[] = [
  { id: 0, label: "Off" },
  { id: 3, label: "3s" },
  { id: 5, label: "5s" },
  { id: 10, label: "10s" },
];

const EXPORT_FORMAT_OPTIONS: { id: ExportFormat; label: string }[] = [
  { id: "png", label: "PNG" },
  { id: "jpeg", label: "JPEG" },
];

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

          <SegRow
            label="Self-timer"
            hint="Count down before grabbing so you can set up the shot."
            value={s.self_timer_secs}
            options={SELF_TIMER_OPTIONS}
            onChange={(self_timer_secs) => patch({ self_timer_secs })}
          />

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

        <p className="grp__label">Overlay</p>
        <div className="grp">
          <SegRow
            label="Toast position"
            value={s.toast_position}
            options={TOAST_POSITION_OPTIONS}
            onChange={(toast_position) => patch({ toast_position })}
          />
          <SegRow
            label="Auto-dismiss"
            hint={
              s.toast_dismiss_ms === 0
                ? "Toast stays until you click or dismiss it."
                : "How long the capture toast lingers before closing."
            }
            value={s.toast_dismiss_ms}
            options={TOAST_DISMISS_OPTIONS}
            onChange={(toast_dismiss_ms) => patch({ toast_dismiss_ms })}
          />
        </div>

        <p className="grp__label">General</p>
        <div className="grp">
          <SegRow
            label="Export format"
            hint="Applies to saved files. Clipboard copies always stay PNG."
            value={s.export_format}
            options={EXPORT_FORMAT_OPTIONS}
            onChange={(export_format) => patch({ export_format })}
          />
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
