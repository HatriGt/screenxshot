import { useStore } from "@tanstack/react-store";
import { editorStore, set } from "../editor/store.js";
import { editor } from "../editor/instance.js";
import { WALLS, GRADS, SOLIDS } from "../editor/data.js";

const wallSrc = (w) => "data:image/svg+xml," + encodeURIComponent(w.svg);

const FRAME = [["none", "None"], ["light", "Light"], ["dark", "Dark"]];
const PADDING = [[0.03, "S"], [0.09, "M"], [0.16, "L"], [0.24, "XL"]];
const SRAD = [[0, "None"], [0.015, "S"], [0.03, "M"], [0.06, "L"]];
const SHADOW = [[0, "None"], [0.035, "Soft"], [0.075, "Med"], [0.14, "Lift"]];

function Seg({ id, options, value, keyName }) {
  return (
    <div className="seg" id={id}>
      {options.map(([v, label]) => (
        <button key={label} data-v={v} className={value === v ? "on" : ""} onClick={() => editor.applySetting(keyName, v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export default function Panel() {
  const { tab, cat, bg, frame, padding, srad, shadow } = useStore(editorStore);
  return (
    <aside className="panel">
      <div className="tabs" id="tabs">
        <button className={"tab" + (tab === "bg" ? " on" : "")} data-tab="bg" onClick={() => set({ tab: "bg" })}>
          Background
        </button>
        <button className={"tab" + (tab === "frame" ? " on" : "")} data-tab="frame" onClick={() => set({ tab: "frame" })}>
          Frame &amp; style
        </button>
      </div>

      <div id="pane-bg" style={{ display: tab === "bg" ? "flex" : "none" }}>
        <div className="catseg" id="cat">
          {[["wall", "Wallpapers"], ["grad", "Gradients"], ["solid", "Solids"]].map(([c, label]) => (
            <button key={c} data-c={c} className={cat === c ? "on" : ""} onClick={() => set({ cat: c })}>
              {label}
            </button>
          ))}
        </div>

        <div className="walls" id="walls" style={{ display: cat === "wall" ? "grid" : "none" }}>
          {WALLS.map((w) => (
            <div
              key={w.id}
              className={"wall" + (w.light ? " light" : "") + (bg.kind === "wall" && bg.id === w.id ? " on" : "")}
              style={{ backgroundImage: `url("${wallSrc(w)}")` }}
              data-id={w.id}
              onClick={() => editor.setBg({ kind: "wall", id: w.id })}
            >
              <span>{w.name}</span>
            </div>
          ))}
        </div>

        <div className="swatches" id="grads" style={{ display: cat === "grad" ? "grid" : "none" }}>
          {GRADS.map((g, i) => (
            <div
              key={i}
              className={"sw" + (bg.kind === "grad" && bg.i === i ? " on" : "")}
              style={{ background: `linear-gradient(${g.a}deg,${g.s.join(",")})` }}
              data-kind="grad"
              data-i={i}
              onClick={() => editor.setBg({ kind: "grad", i })}
            />
          ))}
        </div>

        <div className="swatches" id="solids" style={{ display: cat === "solid" ? "grid" : "none" }}>
          {SOLIDS.map((c, i) => (
            <div
              key={i}
              className={"sw" + (bg.kind === "solid" && bg.i === i ? " on" : "")}
              style={{ background: c, ...(c === "#ffffff" ? { boxShadow: "inset 0 0 0 1px #c9cdd6" } : {}) }}
              data-kind="solid"
              data-i={i}
              onClick={() => editor.setBg({ kind: "solid", i })}
            />
          ))}
          <label className={"sw custom" + (bg.kind === "custom" ? " on" : "")}>
            <input type="color" defaultValue="#5b7cfa" onInput={(e) => editor.setBg({ kind: "custom", v: e.target.value })} />
          </label>
        </div>
      </div>

      <div id="pane-frame" style={{ display: tab === "frame" ? "block" : "none" }}>
        <p className="lbl">Browser frame</p>
        <Seg id="frame" options={FRAME} value={frame} keyName="frame" />
        <p className="lbl">Padding</p>
        <Seg id="padding" options={PADDING} value={padding} keyName="padding" />
        <p className="lbl">Corner rounding</p>
        <Seg id="srad" options={SRAD} value={srad} keyName="srad" />
        <p className="lbl">Shadow</p>
        <Seg id="shadow" options={SHADOW} value={shadow} keyName="shadow" />
      </div>
    </aside>
  );
}
