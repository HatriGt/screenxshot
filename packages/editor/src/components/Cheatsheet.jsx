import { useEffect } from "react";
import { cheatsheetRows } from "../editor/engine.js";
import "./cheatsheet.css";

const ROWS = cheatsheetRows();

// A `?`-triggered overlay listing every tool + its keyboard shortcut, derived
// from the engine's KEY map so it can never drift. Dismiss on `?`, Esc, or a
// click on the scrim. Shared across web + desktop.
export default function Cheatsheet({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="cheat-scrim" onClick={onClose}>
      <div className="cheat" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h4>Keyboard shortcuts</h4>
        <p className="cheat-sub">Press a key to switch tools instantly.</p>
        <div className="cheat-grid">
          {ROWS.map((r) => (
            <div className="cheat-row" key={r.tool}>
              <span>{r.label}</span>
              <kbd>{r.key}</kbd>
            </div>
          ))}
        </div>
        <div className="cheat-foot">
          <kbd>⌘Z</kbd> Undo · <kbd>⌘⇧Z</kbd> Redo · <kbd>⌘S</kbd> Save · <kbd>⌘C</kbd> Copy · <kbd>Esc</kbd> Close
        </div>
      </div>
    </div>
  );
}
