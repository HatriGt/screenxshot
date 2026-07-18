import { useEffect, useRef, useState } from "react";
import { editor } from "../editor/instance.js";
import { BUILTIN_PRESETS, isValidPreset } from "../editor/presets.js";
import "./gallery.css";

// Build the small demo image once (shared across every thumbnail render).
let demoSrcPromise = null;
function getDemoSrc() {
  if (!demoSrcPromise) {
    demoSrcPromise = new Promise((resolve) => {
      const c = editor.makeDemo();
      resolve(c.toDataURL("image/png"));
    });
  }
  return demoSrcPromise;
}

/** One preset cell: renders a live thumbnail via exportStyledBlob, lazily & once. */
function Cell({ preset, onApply }) {
  const [url, setUrl] = useState(null);
  const urlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const src = await getDemoSrc();
        const blob = await editor.exportStyledBlob(src, preset.style);
        if (cancelled || !blob) return;
        const objUrl = URL.createObjectURL(blob);
        urlRef.current = objUrl;
        setUrl(objUrl);
      } catch {
        /* leave the loading placeholder in place */
      }
    })();
    return () => {
      cancelled = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [preset]);

  return (
    <button type="button" className="gal-cell" onClick={() => onApply(preset)}>
      {url ? (
        <img className="gal-thumb" src={url} alt={preset.name} />
      ) : (
        <span className="gal-thumb is-loading">…</span>
      )}
      <span className="gal-name">{preset.name}</span>
    </button>
  );
}

/**
 * Preset gallery popover. Click a thumbnail to apply its look. Export/import use
 * platform handlers when provided (desktop wires Tauri file I/O); otherwise they
 * fall back to browser download + file-input so the web app works too.
 */
export default function Gallery({ open, onClose, onExport, onImport }) {
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  if (!open) return null;

  function apply(preset) {
    editor.applyPreset(preset.style);
    onClose();
  }

  async function handleExport() {
    setErr(null);
    const preset = editor.exportPreset();
    try {
      if (onExport) {
        await onExport(preset);
      } else {
        const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `screenxshot-preset-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e) {
      setErr("Export failed");
    }
  }

  async function handleImport() {
    setErr(null);
    try {
      if (onImport) {
        const preset = await onImport();
        if (preset) editor.applyPreset(preset);
      } else {
        fileRef.current?.click();
      }
    } catch (e) {
      setErr("Import failed");
    }
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        editor.applyPreset(JSON.parse(String(r.result)));
      } catch {
        setErr("Invalid preset file");
      }
    };
    r.onerror = () => setErr("Import failed");
    r.readAsText(f);
  }

  return (
    <div className="gal-pop" role="dialog" aria-label="Preset gallery">
      <div className="gal-head">
        <h4>Presets</h4>
        <div className="gal-actions">
          <button type="button" onClick={() => void handleImport()}>Import</button>
          <button type="button" onClick={() => void handleExport()}>Export</button>
        </div>
      </div>
      <div className="gal-grid">
        {BUILTIN_PRESETS.filter(isValidPreset).map((p) => (
          <Cell key={p.id} preset={p} onApply={apply} />
        ))}
      </div>
      {err && <div className="gal-err">{err}</div>}
      <input type="file" accept="application/json,.json" hidden ref={fileRef} onChange={onFile} />
    </div>
  );
}
