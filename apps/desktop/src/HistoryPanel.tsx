import { useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  clearHistory,
  getHistory,
  openHistoryInEditor,
  type HistoryEntry,
} from "./desktopBridge";
import { bytesToObjectUrl } from "./bytesToObjectUrl";
import { invoke } from "@tauri-apps/api/core";

interface HistoryPanelProps {
  /** Close the panel. */
  onClose: () => void;
}

/** Base filename of a save path (label). */
function baseOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Human-readable local time from Unix seconds. */
function formatTime(unixSecs: number): string {
  return new Date(unixSecs * 1000).toLocaleString();
}

/** A single recents row with a lazily-loaded thumbnail. */
function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const rowRef = useRef<HTMLLIElement | null>(null);
  // Only load the (full-res) bytes once the row is near the viewport, so opening
  // Recents with many rows doesn't read every image at once and spike memory
  // (M8). A downscaled-thumbnail Rust command would be the ideal fix.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) {
          setVisible(true);
          observer.disconnect(); // load once, then stop observing
        }
      },
      { rootMargin: "200px" }, // pre-load a little before it scrolls in
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (entry.missing || !visible) return;
    let url: string | null = null;
    let cancelled = false;
    void invoke<ArrayBuffer>("read_image_file", { path: entry.path })
      .then((bytes) => {
        if (cancelled) return;
        url = bytesToObjectUrl(bytes);
        setThumb(url);
      })
      .catch((err) => console.error("history thumb failed", err));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entry.path, entry.missing, visible]);

  async function onOpen() {
    if (entry.missing) return;
    await openHistoryInEditor(entry.path);
  }

  async function onReveal() {
    // Reveal the saved file in the OS file manager (Finder / Explorer).
    // Best-effort: log and continue if the platform blocks it.
    try {
      await revealItemInDir(entry.path);
    } catch (err) {
      console.error("reveal in folder failed", err);
    }
  }

  return (
    <li
      ref={rowRef}
      className={"ds-hist-row" + (entry.missing ? " is-missing" : "")}
    >
      <button
        type="button"
        className="ds-hist-thumb"
        onClick={() => void onOpen()}
        disabled={entry.missing}
        title={entry.missing ? "File no longer on disk" : "Open in editor"}
      >
        {thumb ? (
          <img src={thumb} alt="" />
        ) : (
          <span className="ds-hist-thumb__ph" aria-hidden />
        )}
      </button>
      <div className="ds-hist-meta">
        <span className="ds-hist-name">{baseOf(entry.path)}</span>
        <span className="ds-hist-time">
          {formatTime(entry.timestamp)}
          {entry.width && entry.height ? ` · ${entry.width}×${entry.height}` : ""}
          {entry.missing ? " · missing" : ""}
        </span>
      </div>
      <div className="ds-hist-actions">
        <button
          type="button"
          className="ds-hist-act"
          onClick={() => void onOpen()}
          disabled={entry.missing}
        >
          Open
        </button>
        <button
          type="button"
          className="ds-hist-act"
          onClick={() => void onReveal()}
          disabled={entry.missing}
        >
          Reveal
        </button>
      </div>
    </li>
  );
}

/** Recents browser: lists saved captures with thumbnails; click opens in editor. */
export function HistoryPanel({ onClose }: HistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  async function refresh() {
    setEntries(await getHistory());
  }

  useEffect(() => {
    void refresh().catch((err) => console.error("history load failed", err));
  }, []);

  async function onClear() {
    await clearHistory();
    await refresh();
  }

  return (
    <div className="ds-hist" role="dialog" aria-label="Capture history">
      <div className="ds-hist-head">
        <span className="ds-hist-title">Recents</span>
        <div className="ds-hist-head-actions">
          {entries && entries.length > 0 && (
            <button type="button" className="ds-hist-act" onClick={() => void onClear()}>
              Clear
            </button>
          )}
          <button
            type="button"
            className="ds-hist-act"
            aria-label="Close history"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
      {entries === null ? (
        <p className="ds-hist-empty">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="ds-hist-empty">
          No captures yet. Saved captures appear here.
        </p>
      ) : (
        <ul className="ds-hist-list">
          {entries.map((entry) => (
            <HistoryRow key={entry.path} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}
