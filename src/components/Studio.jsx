import { useEffect, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import { editorStore } from "../editor/store.js";
import { editor } from "../editor/instance.js";
import Dock from "./Dock.jsx";
import Panel from "./Panel.jsx";

export default function Studio() {
  const { hasImage, copyLabel } = useStore(editorStore);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const dropRef = useRef(null);
  const emptyRef = useRef(null);
  const selbarRef = useRef(null);
  const cropbarRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    editor.mount({
      canvas: canvasRef.current,
      stage: stageRef.current,
      drop: dropRef.current,
      empty: emptyRef.current,
      selbar: selbarRef.current,
      cropbar: cropbarRef.current,
      fileInput: fileRef.current,
    });
    return () => editor.unmount();
  }, []);

  const show = hasImage ? " show" : "";

  return (
    <div className="studio-area">
      <div className="sideshapes" aria-hidden="true">
        <span className="blob b1"></span>
        <span className="blob b2"></span>
        <span className="ring r1"></span>
        <span className="tri t1"></span>
        <span className="blob b3"></span>
        <span className="blob b4"></span>
        <span className="ring r2"></span>
        <span className="tri t2"></span>
      </div>
      <div className="shell">
        <div className="window reveal" id="studio">
          <div className="winbar">
            <span className="dots">
              <i style={{ background: "#ff5f56" }}></i>
              <i style={{ background: "#ffbd2e" }}></i>
              <i style={{ background: "#27c93f" }}></i>
            </span>
            <span className="title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 018 0v3" />
              </svg>
              screenxshot.com
            </span>
            <div className={"stagebtns" + show} id="stagebtns">
              <button className="pill pill-white pill-sm" id="copy" onClick={() => editor.copy()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                <span>{copyLabel}</span>
              </button>
              <button className="pill pill-dark pill-sm" id="save" onClick={() => editor.save()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
                  <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                </svg>
                Save PNG
              </button>
            </div>
          </div>

          <div className="studio">
            <div className="stage" id="stage" ref={stageRef}>
              <Dock />

              <div className={"replace" + show} id="replaceWrap">
                <button id="replace" data-tip="Replace screenshot" title="Replace screenshot" onClick={() => editor.pick()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3 12a9 9 0 019-9 9 9 0 016.7 3M21 12a9 9 0 01-9 9 9 9 0 01-6.7-3" />
                    <path d="M18 3v4h-4M6 21v-4h4" />
                  </svg>
                </button>
                <button id="clear" data-tip="Clear all edits" title="Clear all edits" onClick={() => editor.clearEdits()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" />
                  </svg>
                </button>
              </div>

              <div className="stagebtns-spacer"></div>

              <canvas id="canvas" style={{ display: "none" }} ref={canvasRef}></canvas>
              <div className="empty" id="empty" ref={emptyRef}>
                <div
                  className="drop"
                  id="drop"
                  tabIndex={0}
                  role="button"
                  aria-label="Add a screenshot"
                  ref={dropRef}
                  onClick={() => editor.pick()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      editor.pick();
                    }
                  }}
                >
                  <div className="ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <path d="M3 15l5-4 4 3 3-4 6 5" />
                      <circle cx="9" cy="8.5" r="1.6" />
                    </svg>
                  </div>
                  <h3>Paste your screenshot</h3>
                  <div className="keys">
                    <kbd>⌘ V</kbd>
                    <kbd>Ctrl V</kbd>
                  </div>
                  <p>…or drag an image in, or click to browse.</p>
                </div>
              </div>
            </div>

            <Panel />
          </div>
        </div>
      </div>

      {/* floating overlays (position:fixed) */}
      <div id="cropbar" ref={cropbarRef}>
        <button className="ap" id="cropApply" onClick={() => editor.applyCrop()}>
          Apply crop
        </button>
        <button className="cx" id="cropCancel" onClick={() => editor.cancelCrop()}>
          Cancel
        </button>
      </div>
      <div id="selbar" ref={selbarRef}>
        <button id="selDelete" onClick={() => editor.deleteSelected()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" />
          </svg>
          Delete
        </button>
      </div>
      <input type="file" id="file" accept="image/*" hidden ref={fileRef} />
    </div>
  );
}
