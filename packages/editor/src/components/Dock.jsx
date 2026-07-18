import { useStore } from "@tanstack/react-store";
import { editorStore } from "../editor/store.js";
import { editor } from "../editor/instance.js";
import { COLORS } from "../editor/data.js";

const TOOLS = [
  { t: "cursor", tip: "Select · V", svg: <path d="M5 3l6 16 2-6 6-2L5 3z" /> },
  { t: "pen", tip: "Pen · P", lc: true, svg: <path d="M15 5l4 4L8 20l-4 1 1-4L15 5z" /> },
  { t: "marker", tip: "Highlight · H", lc: true, svg: <path d="M4 20h6M13 4l7 7-8 8H8v-4l5-11z" /> },
  { t: "arrow", tip: "Arrow · A", lc: true, svg: <path d="M5 19L19 5M9 5h10v10" /> },
  { t: "carrow", tip: "Curved arrow · D", lc: true, svg: <path d="M4 17c6-10 11-11 15-11M13 4l6 2-2 6" /> },
  { t: "line", tip: "Line · L", lc: true, svg: <path d="M5 19L19 5" /> },
  { t: "box", tip: "Box · R", svg: <rect x="4" y="5" width="16" height="14" rx="2" /> },
  { t: "frect", tip: "Filled box · F", svg: <rect x="4" y="5" width="16" height="14" rx="2" fill="currentColor" stroke="none" /> },
  { t: "circle", tip: "Ellipse · O", svg: <ellipse cx="12" cy="12" rx="9" ry="7" /> },
  { t: "badge", tip: "Badge · N", svg: <><circle cx="12" cy="12" r="9" /><path d="M11 9l-2 1.5M11 9v6" /></> },
  { t: "text", tip: "Text · T", cap: true, svg: <path d="M5 6h14M12 6v13M9 19h6" /> },
  { t: "eraser", tip: "Eraser · E", lj: true, svg: <><path d="M4 15l7-7 6 6-4 4H8l-4-3z" /><path d="M9 20h11" /></> },
  { t: "crop", tip: "Crop · C", cap: true, svg: <><path d="M6 2v14a2 2 0 002 2h14" /><path d="M2 6h14a2 2 0 012 2v14" /></> },
  {
    t: "pixelate",
    tip: "Pixelate · X",
    sw: 1.7,
    svg: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" />
        <rect x="13.5" y="3.5" width="7" height="7" />
        <rect x="3.5" y="13.5" width="7" height="7" />
        <rect x="13.5" y="13.5" width="7" height="7" />
      </>
    ),
  },
  { t: "blur", tip: "Blur · B", cap: true, svg: <><circle cx="12" cy="12" r="8.5" strokeDasharray="2.4 3" /><circle cx="12" cy="12" r="3.5" /></> },
];

export default function Dock({ onCheatsheet, onGallery }) {
  const { tool, color, size, hasImage, canUndo, canRedo } = useStore(editorStore);
  return (
    <div className={"dock" + (hasImage ? " show" : "")} id="dock">
      {TOOLS.map((x) => (
        <button
          key={x.t}
          className={"tool" + (tool === x.t ? " on" : "")}
          data-tool={x.t}
          data-tip={x.tip}
          onClick={() => editor.setTool(x.t)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={x.sw || 1.8}
            strokeLinecap={x.lc || x.cap ? "round" : undefined}
            strokeLinejoin={x.lc || x.lj ? "round" : undefined}
          >
            {x.svg}
          </svg>
        </button>
      ))}
      <div className="dsep"></div>
      <div className="dcolors" id="dcolors">
        {COLORS.map((c) => (
          <div
            key={c}
            className={"c" + (c === color ? " on" : "")}
            style={{ background: c, ...(c === "#ffffff" ? { boxShadow: "inset 0 0 0 1px #c9cdd6" } : {}) }}
            data-c={c}
            onClick={() => editor.setColor(c)}
          />
        ))}
      </div>
      <div className="dsep"></div>
      <div className="dsize" id="dsize">
        {[
          ["s", 6],
          ["m", 10],
          ["l", 14],
        ].map(([v, px]) => (
          <button key={v} data-v={v} data-tip={v === "s" ? "Small" : undefined} className={size === v ? "on" : ""} onClick={() => editor.setSize(v)}>
            <span className="d" style={{ width: px + "px", height: px + "px" }}></span>
          </button>
        ))}
      </div>
      <div className="dsep"></div>
      <button
        className="tool"
        id="undo"
        data-tip="Undo · ⌘Z"
        style={{ opacity: canUndo ? 1 : 0.3, pointerEvents: canUndo ? "auto" : "none" }}
        onClick={() => editor.undo()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M9 14L4 9l5-5" />
          <path d="M4 9h11a5 5 0 010 10h-5" />
        </svg>
      </button>
      <button
        className="tool"
        id="redo"
        data-tip="Redo · ⌘⇧Z"
        style={{ opacity: canRedo ? 1 : 0.3, pointerEvents: canRedo ? "auto" : "none" }}
        onClick={() => editor.redo()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M15 14l5-5-5-5" />
          <path d="M20 9H9a5 5 0 000 10h5" />
        </svg>
      </button>
      <div className="dsep"></div>
      <button className="tool" data-tip="Presets" onClick={onGallery}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <rect x="3" y="4" width="7" height="7" rx="1.5" />
          <rect x="14" y="4" width="7" height="7" rx="1.5" />
          <rect x="3" y="15" width="7" height="5" rx="1.5" />
          <rect x="14" y="15" width="7" height="5" rx="1.5" />
        </svg>
      </button>
      <button className="tool cheat-btn" data-tip="Shortcuts · ?" onClick={onCheatsheet}>
        ?
      </button>
    </div>
  );
}
