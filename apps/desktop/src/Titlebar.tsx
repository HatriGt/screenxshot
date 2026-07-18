import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import logoUrl from "./assets/logo.svg";

const appWindow = getCurrentWindow();

/**
 * Slim custom titlebar for the frameless main window. Owns the drag region and
 * window controls (the OS titlebar is disabled via `decorations: false`), plus
 * quick actions for Capture and Settings. The editor's own `.winbar` remains as
 * the editing toolbar below this.
 */
export function Titlebar() {
  return (
    <div className="ds-titlebar" data-tauri-drag-region>
      <div className="ds-titlebar__brand" data-tauri-drag-region>
        <img src={logoUrl} alt="" className="ds-titlebar__logo" aria-hidden />
        <span>ScreenXShot</span>
      </div>

      <div className="ds-titlebar__actions">
        <button
          type="button"
          className="ds-titlebar__btn"
          onClick={() => void invoke("open_settings")}
          aria-label="Settings"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
        <span className="ds-titlebar__sep" aria-hidden />
        <button
          type="button"
          className="ds-titlebar__ctl"
          aria-label="Minimize"
          onClick={() => void appWindow.minimize()}
        >
          <svg viewBox="0 0 12 12" aria-hidden>
            <rect x="2" y="5.5" width="8" height="1" rx="0.5" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="ds-titlebar__ctl ds-titlebar__ctl--close"
          aria-label="Close"
          onClick={() => void appWindow.close()}
        >
          <svg viewBox="0 0 12 12" aria-hidden>
            <path
              d="M3 3l6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
