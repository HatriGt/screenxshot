import { useEffect, useState } from "react";
import { comboFromEvent, isValidCombo } from "./hotkeyCombo";

const IS_MAC =
  typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

interface Props {
  value: string;
  onChange: (combo: string) => void;
}

/** Click-to-record control that captures the next key combination. */
export function HotkeyRecorder({ value, onChange }: Props) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While recording, listen at the window (capture phase) so we reliably grab
  // the combo before the browser acts on Space/Enter/etc. inside the button.
  useEffect(() => {
    if (!recording) return;

    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const combo = comboFromEvent(e, IS_MAC);
      if (!combo) return; // modifier-only, keep waiting
      if (!isValidCombo(combo)) {
        setError("Use at least one modifier plus a key.");
        return;
      }
      setError(null);
      setRecording(false);
      onChange(combo);
    }

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  return (
    <div className="set-hotkey">
      <button
        type="button"
        className={"set-hotkey__field" + (recording ? " is-recording" : "")}
        onClick={() => {
          setRecording((r) => !r);
          setError(null);
        }}
      >
        {recording ? "Press keys…" : value}
      </button>
      {error && <p className="set-hotkey__error">{error}</p>}
    </div>
  );
}
