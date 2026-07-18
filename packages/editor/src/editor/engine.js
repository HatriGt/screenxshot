// Canvas engine ported from prism.html. The drawing math (buildBase, drawFrame,
// drawOp, paint, hit-testing, crop, undo/redo, pixelate, demo) is preserved
// verbatim. Settings are read from the TanStack store; derived runtime flags
// (hasImage/canUndo/canRedo/copyLabel) are written back to it so React can react.
import { COLORS, WALLS, GRADS, SOLIDS, SIZE, TSIZE } from "./data.js";
import { editorStore, set } from "./store.js";

const wallSrc = (w) => "data:image/svg+xml," + encodeURIComponent(w.svg);

export class Editor {
  constructor() {
    this.state = editorStore.state; // live reference; kept in sync via subscribe
    this.imgCanvas = null;
    this.iw = 0;
    this.ih = 0;
    this.ops = [];
    this.draft = null;
    this.drawing = false;
    this.undoStack = [];
    this.redoStack = [];
    this.cropDraft = null;
    this.cropStart = null;
    this.selectedIndex = -1;
    this.moving = false;
    this.moveStart = null;
    this.moveSnap = false;
    this.G = {};
    this.WALLIMG = {};
    this.mounted = false;

    this.anno = document.createElement("canvas");
    this.actx = this.anno.getContext("2d");
    this.tmp = document.createElement("canvas");
    this.tctx = this.tmp.getContext("2d");
    this.base = document.createElement("canvas");
    this.bctx = this.base.getContext("2d");

    // keep this.state pointing at the latest store snapshot
    this._unsub = editorStore.subscribe(() => {
      this.state = editorStore.state;
    });

    WALLS.forEach((w) => {
      const im = new Image();
      im.onload = () => {
        this.WALLIMG[w.id] = im;
        if (
          this.state.bg.kind === "wall" &&
          this.state.bg.id === w.id &&
          this.imgCanvas
        ) {
          this.buildBase();
          this.paint();
        }
      };
      im.src = wallSrc(w);
    });
  }

  mount(refs) {
    if (this.mounted) return;
    this.mounted = true;
    this.canvas = refs.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.stage = refs.stage;
    this.drop = refs.drop;
    this.empty = refs.empty;
    this.selbar = refs.selbar;
    this.cropbar = refs.cropbar;
    this.fileInput = refs.fileInput;

    this._bind();
    this.syncFlags();
    // demo template on load (after fonts if possible)
    const loadDemo = () => {
      try {
        this.loadImage(this.makeDemo());
      } catch (e) {}
    };
    if (document.fonts && document.fonts.ready)
      document.fonts.ready.then(loadDemo);
    else loadDemo();
  }

  unmount() {
    this._unbind && this._unbind();
    this._unsub && this._unsub();
    this.mounted = false;
  }

  // ---- rendering ------------------------------------------------------------
  coverDraw(c, im, W, H) {
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight),
      dw = im.naturalWidth * s,
      dh = im.naturalHeight * s;
    c.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  drawBackdrop(c, W, H) {
    const bg = this.state.bg;
    if (bg.kind === "solid") {
      c.fillStyle = SOLIDS[bg.i];
      c.fillRect(0, 0, W, H);
      return;
    }
    if (bg.kind === "custom") {
      c.fillStyle = bg.v;
      c.fillRect(0, 0, W, H);
      return;
    }
    if (bg.kind === "grad") {
      const g = GRADS[bg.i],
        rad = (g.a * Math.PI) / 180,
        x = Math.cos(rad),
        y = Math.sin(rad);
      const gr = c.createLinearGradient(
        W / 2 - (x * W) / 2,
        H / 2 - (y * H) / 2,
        W / 2 + (x * W) / 2,
        H / 2 + (y * H) / 2
      );
      g.s.forEach((col, i) => gr.addColorStop(i / (g.s.length - 1), col));
      c.fillStyle = gr;
      c.fillRect(0, 0, W, H);
      return;
    }
    const w = WALLS.find((k) => k.id === bg.id) || WALLS[0],
      im = this.WALLIMG[bg.id];
    if (im && im.complete && im.naturalWidth) this.coverDraw(c, im, W, H);
    else {
      const gr = c.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, w.base[0]);
      gr.addColorStop(1, w.base[1]);
      c.fillStyle = gr;
      c.fillRect(0, 0, W, H);
    }
  }
  rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  buildBase() {
    if (!this.imgCanvas) return;
    const { iw, ih } = this;
    const frameOn = this.state.frame !== "none";
    const barH = frameOn
      ? Math.round(Math.min(Math.max(iw * 0.05, 34), 86))
      : 0;
    const bw = iw,
      bh = ih + barH,
      u = Math.min(bw, bh);
    const pad = Math.round(this.state.padding * u),
      sr = Math.round(this.state.srad * u),
      fr = Math.round(0.05 * u);
    const W = bw + pad * 2,
      H = bh + pad * 2,
      ox = pad,
      oy = pad + barH;
    Object.assign(this.G, { W, H, ox, oy, sr, fr, barH, u });
    this.base.width = W;
    this.base.height = H;
    this.bctx.clearRect(0, 0, W, H);
    this.drawBackdrop(this.bctx, W, H);
    if (this.state.shadow > 0) {
      this.bctx.save();
      this.bctx.shadowColor = "rgba(8,10,20,.44)";
      this.bctx.shadowBlur = this.state.shadow * u;
      this.bctx.shadowOffsetY = this.state.shadow * u * 0.42;
      this.bctx.fillStyle = "#000";
      this.rr(this.bctx, pad, pad, bw, bh, frameOn ? fr : sr);
      this.bctx.fill();
      this.bctx.restore();
    }
    this.bctx.save();
    this.rr(this.bctx, pad, pad, bw, bh, frameOn ? fr : sr);
    this.bctx.clip();
    if (frameOn) this.drawFrame(this.bctx, pad, pad, bw, barH);
    this.bctx.save();
    this.rr(this.bctx, ox, oy, iw, ih, frameOn ? 0 : sr);
    this.bctx.clip();
    this.bctx.drawImage(this.imgCanvas, ox, oy);
    this.bctx.restore();
    this.bctx.restore();
    this.canvas.width = W;
    this.canvas.height = H;
    this.anno.width = iw;
    this.anno.height = ih;
  }
  drawLock(c, cx, cy, s, col) {
    c.save();
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = Math.max(1, s * 0.13);
    const bw = s * 0.74,
      bh = s * 0.56,
      bx = cx - bw / 2,
      by = cy - bh * 0.18;
    c.beginPath();
    c.arc(cx, by, bw * 0.34, Math.PI, 2 * Math.PI);
    c.stroke();
    this.rr(c, bx, by, bw, bh, bh * 0.24);
    c.fill();
    c.restore();
  }
  drawFrame(c, x, y, w, barH) {
    const dk = this.state.frame === "dark";
    c.fillStyle = dk ? "#3a3b42" : "#f4f5f6";
    c.fillRect(x, y, w, barH);
    const sheen = c.createLinearGradient(0, y, 0, y + barH);
    sheen.addColorStop(0, dk ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.75)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = sheen;
    c.fillRect(x, y, w, barH * 0.62);
    const hl = Math.max(1, barH * 0.02);
    c.fillStyle = dk ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.09)";
    c.fillRect(x, y + barH - hl, w, hl);
    const cy = y + barH / 2,
      r = Math.min(Math.max(barH * 0.15, 5.5), 9),
      gap = r * 3.2,
      lx = x + Math.max(18, barH * 0.62);
    ["#ff5f56", "#ffbd2e", "#27c93f"].forEach((col, i) => {
      const cx = lx + i * gap;
      c.beginPath();
      c.arc(cx, cy, r, 0, 7);
      c.fillStyle = col;
      c.fill();
      const hg = c.createRadialGradient(cx - r * 0.3, cy - r * 0.45, 0, cx, cy, r);
      hg.addColorStop(0, "rgba(255,255,255,.6)");
      hg.addColorStop(0.55, "rgba(255,255,255,0)");
      c.fillStyle = hg;
      c.beginPath();
      c.arc(cx, cy, r, 0, 7);
      c.fill();
    });
    const ph = Math.min(barH * 0.62, barH - Math.max(8, barH * 0.24)),
      pxc = x + w / 2,
      pw = Math.min(w * 0.5, w * 0.66),
      pl = pxc - pw / 2,
      py = cy - ph / 2,
      minL = lx + gap * 2 + r * 2.4;
    if (pw > 60 && pl > minL) {
      c.fillStyle = dk ? "#25262c" : "#ffffff";
      this.rr(c, pl, py, pw, ph, ph / 2);
      c.fill();
      c.lineWidth = 1;
      c.strokeStyle = dk ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.07)";
      c.stroke();
      c.font = `${Math.round(ph * 0.44)}px "Manrope",-apple-system,sans-serif`;
      const label = "screenxshot.com",
        tw = c.measureText(label).width,
        ls = ph * 0.46,
        g2 = ls * 0.5,
        gw = ls + g2 + tw,
        gx = pxc - gw / 2;
      this.drawLock(c, gx + ls / 2, cy, ls, dk ? "#8b93a1" : "#9aa3af");
      c.fillStyle = dk ? "#aeb4be" : "#6b7280";
      c.textBaseline = "middle";
      c.textAlign = "left";
      c.fillText(label, gx + ls + g2, cy + ph * 0.02);
      c.textBaseline = "alphabetic";
      c.textAlign = "left";
    }
  }
  strokeW() {
    return Math.max(2.5, SIZE[this.state.size] * (this.G.u || Math.min(this.iw, this.ih)));
  }
  path(c, pts) {
    c.beginPath();
    if (pts.length === 1) {
      c.arc(pts[0].x, pts[0].y, Math.max(c.lineWidth / 2, 1), 0, 7);
      c.closePath();
      return;
    }
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  }
  arrow(c, o) {
    const dx = o.x2 - o.x1,
      dy = o.y2 - o.y1,
      ang = Math.atan2(dy, dx),
      head = Math.max(o.w * 4.2, 14);
    c.beginPath();
    c.moveTo(o.x1, o.y1);
    c.lineTo(o.x2 - Math.cos(ang) * head * 0.85, o.y2 - Math.sin(ang) * head * 0.85);
    c.stroke();
    c.beginPath();
    c.moveTo(o.x2, o.y2);
    c.lineTo(o.x2 - head * Math.cos(ang - 0.42), o.y2 - head * Math.sin(ang - 0.42));
    c.lineTo(o.x2 - head * Math.cos(ang + 0.42), o.y2 - head * Math.sin(ang + 0.42));
    c.closePath();
    c.fill();
  }
  drawOp(c, o) {
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = o.color;
    c.fillStyle = o.color;
    c.lineWidth = o.w;
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
    if (o.type === "pen") {
      this.path(c, o.points);
      c.stroke();
    } else if (o.type === "marker") {
      c.globalAlpha = 0.38;
      c.lineWidth = o.w * 3.4;
      this.path(c, o.points);
      c.stroke();
      c.globalAlpha = 1;
    } else if (o.type === "erase") {
      c.globalCompositeOperation = "destination-out";
      c.lineWidth = o.w * 3.2;
      this.path(c, o.points);
      c.stroke();
      c.globalCompositeOperation = "source-over";
    } else if (o.type === "arrow") this.arrow(c, o);
    else if (o.type === "box") {
      this.rr(c, o.x, o.y, o.w2, o.h2, Math.min(o.w * 1.6, o.w2 / 2, o.h2 / 2));
      c.stroke();
    } else if (o.type === "circle") {
      c.beginPath();
      c.ellipse(o.x + o.w2 / 2, o.y + o.h2 / 2, Math.max(o.w2 / 2, 1), Math.max(o.h2 / 2, 1), 0, 0, 7);
      c.stroke();
    } else if (o.type === "pixelate") {
      const bx = Math.max(0, Math.round(o.x)),
        by = Math.max(0, Math.round(o.y)),
        bw = Math.max(1, Math.round(Math.min(o.w2, this.iw - bx))),
        bh = Math.max(1, Math.round(Math.min(o.h2, this.ih - by)));
      if (bw > 0 && bh > 0) {
        const bs = Math.max(6, Math.round(Math.min(bw, bh) / 9)),
          tw = Math.max(1, Math.round(bw / bs)),
          th = Math.max(1, Math.round(bh / bs));
        this.tmp.width = tw;
        this.tmp.height = th;
        this.tctx.imageSmoothingEnabled = true;
        this.tctx.clearRect(0, 0, tw, th);
        this.tctx.drawImage(this.imgCanvas, bx, by, bw, bh, 0, 0, tw, th);
        c.imageSmoothingEnabled = false;
        c.drawImage(this.tmp, 0, 0, tw, th, bx, by, bw, bh);
        c.imageSmoothingEnabled = true;
      }
    } else if (o.type === "text") {
      c.textBaseline = "top";
      c.font = `700 ${o.px}px "Manrope",-apple-system,sans-serif`;
      o.text.split("\n").forEach((ln, i) => c.fillText(ln, o.x, o.y + i * o.px * 1.25));
    }
  }
  renderAnno() {
    this.actx.clearRect(0, 0, this.iw, this.ih);
    for (const o of this.ops) this.drawOp(this.actx, o);
    if (this.draft) this.drawOp(this.actx, this.draft);
  }
  paint() {
    if (!this.imgCanvas) return;
    const { G, ctx, iw, ih } = this;
    this.renderAnno();
    ctx.clearRect(0, 0, G.W, G.H);
    ctx.drawImage(this.base, 0, 0);
    ctx.save();
    this.rr(ctx, G.ox, G.oy, iw, ih, this.state.frame !== "none" ? 0 : G.sr);
    ctx.clip();
    ctx.drawImage(this.anno, G.ox, G.oy);
    ctx.restore();
    if (this.cropDraft) {
      const r = this.cropDraft;
      ctx.save();
      ctx.fillStyle = "rgba(8,10,20,.5)";
      ctx.beginPath();
      ctx.rect(G.ox, G.oy, iw, ih);
      ctx.rect(G.ox + r.x + r.w, G.oy + r.y, -r.w, r.h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(2, iw * 0.004);
      ctx.strokeRect(G.ox + r.x, G.oy + r.y, r.w, r.h);
      ctx.restore();
      this.positionCropBar(r);
    }
    if (this.selectedIndex >= 0 && this.ops[this.selectedIndex] && !this.cropDraft) {
      const b = this.opBBox(this.ops[this.selectedIndex]);
      ctx.save();
      ctx.strokeStyle = "#375dfb";
      ctx.setLineDash([7, 5]);
      ctx.lineWidth = Math.max(1.5, iw * 0.0028);
      ctx.strokeRect(G.ox + b.x, G.oy + b.y, b.w, b.h);
      ctx.restore();
    }
    this.syncFlags();
  }
  toImg(e) {
    const rect = this.canvas.getBoundingClientRect(),
      s = this.canvas.width / rect.width;
    return {
      x: Math.max(0, Math.min(this.iw, (e.clientX - rect.left) * s - this.G.ox)),
      y: Math.max(0, Math.min(this.ih, (e.clientY - rect.top) * s - this.G.oy)),
    };
  }
  opBBox(o) {
    if (o.type === "pen" || o.type === "marker" || o.type === "erase") {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      o.points.forEach((p) => {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      });
      const pd = o.w * (o.type === "marker" ? 2 : 1) + 4;
      return { x: x0 - pd, y: y0 - pd, w: x1 - x0 + pd * 2, h: y1 - y0 + pd * 2 };
    }
    if (o.type === "arrow") {
      const x0 = Math.min(o.x1, o.x2),
        y0 = Math.min(o.y1, o.y2),
        pd = o.w * 3 + 6;
      return { x: x0 - pd, y: y0 - pd, w: Math.abs(o.x2 - o.x1) + pd * 2, h: Math.abs(o.y2 - o.y1) + pd * 2 };
    }
    if (o.type === "box" || o.type === "circle" || o.type === "pixelate") {
      const pd = (o.w || 2) + 3;
      return { x: o.x - pd, y: o.y - pd, w: o.w2 + pd * 2, h: o.h2 + pd * 2 };
    }
    if (o.type === "text") {
      this.actx.font = `700 ${o.px}px "Manrope",-apple-system,sans-serif`;
      const lines = o.text.split("\n");
      let mw = 0;
      lines.forEach((l) => (mw = Math.max(mw, this.actx.measureText(l).width)));
      return { x: o.x - 4, y: o.y - 4, w: mw + 8, h: lines.length * o.px * 1.25 + 8 };
    }
    return { x: o.x || 0, y: o.y || 0, w: o.w2 || 10, h: o.h2 || 10 };
  }
  hitTest(p) {
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const b = this.opBBox(this.ops[i]);
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
    }
    return -1;
  }

  // ---- pointer + keyboard wiring -------------------------------------------
  _bind() {
    const canvas = this.canvas;
    const onDown = (e) => {
      if (!this.imgCanvas) return;
      const t = this.state.tool,
        p = this.toImg(e);
      if (t === "cursor") {
        const hit = this.hitTest(p);
        if (hit >= 0) {
          this.selectedIndex = hit;
          this.moving = true;
          this.moveStart = p;
          this.moveSnap = false;
          canvas.setPointerCapture(e.pointerId);
          this.paint();
          this.showSelbar();
        } else {
          this.selectedIndex = -1;
          this.hideSelbar();
          this.paint();
        }
        return;
      }
      e.preventDefault();
      this.selectedIndex = -1;
      this.hideSelbar();
      if (t === "text") {
        this.placeText(p);
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      const w = this.strokeW();
      if (t === "crop") {
        this.cropStart = p;
        this.cropDraft = { x: p.x, y: p.y, w: 0, h: 0 };
      } else if (t === "pen" || t === "marker" || t === "eraser")
        this.draft = { type: t === "eraser" ? "erase" : t, color: this.state.color, w, points: [p] };
      else if (t === "arrow")
        this.draft = { type: "arrow", color: this.state.color, w, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      else if (t === "box" || t === "circle" || t === "pixelate")
        this.draft = { type: t, color: this.state.color, w, x0: p.x, y0: p.y, x: p.x, y: p.y, w2: 0, h2: 0 };
      this.paint();
    };
    const onMove = (e) => {
      if (this.moving) {
        const p = this.toImg(e),
          dx = p.x - this.moveStart.x,
          dy = p.y - this.moveStart.y;
        if (!this.moveSnap && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
          this.pushUndo();
          this.moveSnap = true;
          this.hideSelbar();
        }
        if (this.moveSnap && this.ops[this.selectedIndex]) {
          this.shiftOp(this.ops[this.selectedIndex], dx, dy);
          this.moveStart = p;
          this.paint();
        }
        return;
      }
      if (!this.drawing) return;
      const p = this.toImg(e),
        t = this.state.tool;
      if (t === "crop")
        this.cropDraft = {
          x: Math.min(this.cropStart.x, p.x),
          y: Math.min(this.cropStart.y, p.y),
          w: Math.abs(p.x - this.cropStart.x),
          h: Math.abs(p.y - this.cropStart.y),
        };
      else if (this.draft && (this.draft.type === "pen" || this.draft.type === "marker" || this.draft.type === "erase"))
        this.draft.points.push(p);
      else if (this.draft && this.draft.type === "arrow") {
        this.draft.x2 = p.x;
        this.draft.y2 = p.y;
      } else if (this.draft && (this.draft.type === "box" || this.draft.type === "circle" || this.draft.type === "pixelate")) {
        this.draft.x = Math.min(this.draft.x0, p.x);
        this.draft.y = Math.min(this.draft.y0, p.y);
        this.draft.w2 = Math.abs(p.x - this.draft.x0);
        this.draft.h2 = Math.abs(p.y - this.draft.y0);
      }
      this.paint();
    };
    const endDraw = () => {
      if (this.moving) {
        this.moving = false;
        this.paint();
        this.showSelbar();
        return;
      }
      if (!this.drawing) return;
      this.drawing = false;
      const t = this.state.tool;
      if (t === "crop") {
        if (this.cropDraft && this.cropDraft.w > 8 && this.cropDraft.h > 8) this.showCropBar();
        else {
          this.cropDraft = null;
          this.hideCropBar();
          this.paint();
        }
        return;
      }
      let ok = false;
      if (this.draft) {
        if (this.draft.type === "pen" || this.draft.type === "marker" || this.draft.type === "erase")
          ok = this.draft.points.length > 0;
        else if (this.draft.type === "arrow") ok = Math.hypot(this.draft.x2 - this.draft.x1, this.draft.y2 - this.draft.y1) > 4;
        else ok = this.draft.w2 > 3 && this.draft.h2 > 3;
      }
      if (ok) {
        this.pushUndo();
        this.ops.push(this.draft);
      }
      this.draft = null;
      this.paint();
    };
    const onPaste = (e) => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          if (this.loadFile(it.getAsFile())) {
            e.preventDefault();
            document.getElementById("studio").scrollIntoView({ behavior: "smooth", block: "center" });
          }
          return;
        }
      }
    };
    const KEY = { v: "cursor", p: "pen", h: "marker", a: "arrow", r: "box", o: "circle", t: "text", e: "eraser", c: "crop", x: "pixelate" };
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta) {
        const k = e.key.toLowerCase();
        if (k === "s") {
          e.preventDefault();
          this.save();
        } else if (k === "z") {
          e.preventDefault();
          e.shiftKey ? this.redo() : this.undo();
        } else if (k === "y") {
          e.preventDefault();
          this.redo();
        } else if (k === "c" && this.imgCanvas && !getSelection().toString()) {
          e.preventDefault();
          this.copy();
        }
        return;
      }
      if (document.activeElement && (document.activeElement.classList.contains("textin") || document.activeElement.tagName === "INPUT")) return;
      const k = e.key.toLowerCase();
      if (KEY[k] && this.imgCanvas) this.setTool(KEY[k]);
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (this.selectedIndex >= 0) this.deleteSelected();
        else if (this.ops.length) {
          this.pushUndo();
          this.ops.pop();
          this.paint();
        }
      } else if (e.key === "Escape") {
        if (this.cropDraft) this.cancelCrop();
        else if (this.selectedIndex >= 0) {
          this.selectedIndex = -1;
          this.hideSelbar();
          this.paint();
        }
      }
    };
    const onResize = () => {
      if (this.cropDraft) this.positionCropBar(this.cropDraft);
      if (this.selectedIndex >= 0 && !this.moving) this.showSelbar();
    };
    const dragOver = (e) => {
      e.preventDefault();
      this.drop.classList.add("hot");
    };
    const dragLeave = (e) => {
      if (!this.stage.contains(e.relatedTarget)) this.drop.classList.remove("hot");
    };
    const onDrop = (e) => {
      e.preventDefault();
      this.drop.classList.remove("hot");
      const f = e.dataTransfer.files[0];
      if (f) this.loadFile(f);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", endDraw);
    canvas.addEventListener("pointercancel", endDraw);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    ["dragenter", "dragover"].forEach((ev) => this.stage.addEventListener(ev, dragOver));
    this.stage.addEventListener("dragleave", dragLeave);
    this.stage.addEventListener("drop", onDrop);
    this.fileInput.addEventListener("change", this._onFileChange = (e) => {
      this.loadFile(e.target.files[0]);
      this.fileInput.value = "";
      document.getElementById("studio").scrollIntoView({ behavior: "smooth", block: "center" });
    });

    this._unbind = () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", endDraw);
      canvas.removeEventListener("pointercancel", endDraw);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      ["dragenter", "dragover"].forEach((ev) => this.stage.removeEventListener(ev, dragOver));
      this.stage.removeEventListener("dragleave", dragLeave);
      this.stage.removeEventListener("drop", onDrop);
      this.fileInput.removeEventListener("change", this._onFileChange);
    };
  }

  // ---- selection / crop / text overlays ------------------------------------
  showSelbar() {
    if (this.selectedIndex < 0 || !this.ops[this.selectedIndex]) {
      this.hideSelbar();
      return;
    }
    const b = this.opBBox(this.ops[this.selectedIndex]),
      rect = this.canvas.getBoundingClientRect(),
      disp = rect.width / this.canvas.width;
    this.selbar.style.display = "flex";
    const bw = this.selbar.offsetWidth || 90;
    this.selbar.style.left = Math.max(8, rect.left + (this.G.ox + b.x + b.w) * disp - bw) + "px";
    this.selbar.style.top = Math.max(8, rect.top + (this.G.oy + b.y) * disp - 44) + "px";
  }
  hideSelbar() {
    this.selbar.style.display = "none";
  }
  deleteSelected() {
    if (this.selectedIndex < 0) return;
    this.pushUndo();
    this.ops.splice(this.selectedIndex, 1);
    this.selectedIndex = -1;
    this.hideSelbar();
    this.paint();
  }
  placeText(p) {
    const rect = this.canvas.getBoundingClientRect(),
      disp = rect.width / this.canvas.width;
    const px = Math.round(TSIZE[this.state.size] * (this.G.u || Math.min(this.iw, this.ih)));
    const el = document.createElement("input");
    el.className = "textin";
    el.type = "text";
    el.style.left = rect.left + (this.G.ox + p.x) * disp + "px";
    el.style.top = rect.top + (this.G.oy + p.y) * disp + "px";
    el.style.fontSize = px * disp + "px";
    el.style.color = this.state.color;
    document.body.appendChild(el);
    setTimeout(() => el.focus(), 0);
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const v = el.value.trim();
      el.remove();
      if (v) {
        this.pushUndo();
        this.ops.push({ type: "text", color: this.state.color, px, x: p.x, y: p.y, text: v });
        this.paint();
      }
    };
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit();
      } else if (ev.key === "Escape") {
        done = true;
        el.remove();
      }
    });
    el.addEventListener("blur", commit);
  }
  showCropBar() {
    this.cropbar.style.display = "flex";
    this.positionCropBar(this.cropDraft);
    this.paint();
  }
  hideCropBar() {
    this.cropbar.style.display = "none";
  }
  positionCropBar(r) {
    const rect = this.canvas.getBoundingClientRect(),
      disp = rect.width / this.canvas.width;
    this.cropbar.style.left = rect.left + (this.G.ox + r.x + r.w / 2) * disp - 72 + "px";
    this.cropbar.style.top = rect.top + (this.G.oy + r.y + r.h) * disp + 10 + "px";
  }
  cancelCrop() {
    this.cropDraft = null;
    this.hideCropBar();
    this.paint();
  }
  applyCrop() {
    const r = this.cropDraft;
    if (!r) return;
    this.pushUndo();
    const nx = Math.round(r.x),
      ny = Math.round(r.y),
      nw = Math.round(r.w),
      nh = Math.round(r.h);
    const nc = document.createElement("canvas");
    nc.width = nw;
    nc.height = nh;
    nc.getContext("2d").drawImage(this.imgCanvas, -nx, -ny);
    this.ops.forEach((o) => this.shiftOp(o, -nx, -ny));
    this.imgCanvas = nc;
    this.iw = nw;
    this.ih = nh;
    this.cropDraft = null;
    this.selectedIndex = -1;
    this.hideSelbar();
    this.hideCropBar();
    this.buildBase();
    this.paint();
  }
  shiftOp(o, dx, dy) {
    if (o.points) o.points.forEach((p) => { p.x += dx; p.y += dy; });
    if (o.x != null) o.x += dx;
    if (o.y != null) o.y += dy;
    if (o.x1 != null) { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    if (o.x0 != null) { o.x0 += dx; o.y0 += dy; }
  }

  // ---- undo/redo + flags ----------------------------------------------------
  snap() {
    return { imgCanvas: this.imgCanvas, iw: this.iw, ih: this.ih, ops: JSON.parse(JSON.stringify(this.ops)) };
  }
  pushUndo() {
    this.undoStack.push(this.snap());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  restore(s) {
    this.imgCanvas = s.imgCanvas;
    this.iw = s.iw;
    this.ih = s.ih;
    this.ops = s.ops;
    this.selectedIndex = -1;
    this.hideSelbar();
    this.buildBase();
    this.paint();
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snap());
    this.restore(this.undoStack.pop());
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snap());
    this.restore(this.redoStack.pop());
  }
  syncFlags() {
    set({
      hasImage: !!this.imgCanvas,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    });
  }

  // ---- image lifecycle ------------------------------------------------------
  loadImage(im) {
    let w = im.naturalWidth || im.width,
      h = im.naturalHeight || im.height;
    const cap = 2200,
      m = Math.max(w, h);
    if (m > cap) {
      w = Math.round((w * cap) / m);
      h = Math.round((h * cap) / m);
    }
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(im, 0, 0, w, h);
    this.imgCanvas = c;
    this.iw = w;
    this.ih = h;
    this.ops = [];
    this.undoStack = [];
    this.redoStack = [];
    this.draft = null;
    this.cropDraft = null;
    this.selectedIndex = -1;
    this.hideSelbar();
    this.hideCropBar();
    this.empty.style.display = "none";
    this.canvas.style.display = "block";
    this.buildBase();
    this.paint();
    this.setTool(this.state.tool);
  }
  fromSrc(src) {
    const im = new Image();
    im.onload = () => this.loadImage(im);
    im.src = src;
  }
  loadFile(f) {
    if (!f || !f.type.startsWith("image/")) return false;
    const r = new FileReader();
    r.onload = (e) => this.fromSrc(e.target.result);
    r.readAsDataURL(f);
    return true;
  }
  clearAll() {
    this.imgCanvas = null;
    this.iw = this.ih = 0;
    this.ops = [];
    this.undoStack = [];
    this.redoStack = [];
    this.draft = null;
    this.cropDraft = null;
    this.selectedIndex = -1;
    this.hideSelbar();
    this.hideCropBar();
    this.canvas.style.display = "none";
    this.empty.style.display = "block";
    this.syncFlags();
  }
  clearEdits() {
    if (!this.imgCanvas || !this.ops.length) return;
    this.pushUndo();
    this.ops = [];
    this.draft = null;
    this.selectedIndex = -1;
    this.hideSelbar();
    this.paint();
  }
  pick() {
    this.fileInput.click();
  }

  // ---- export ---------------------------------------------------------------
  save() {
    if (!this.imgCanvas) return;
    this.paint();
    this.canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "screenxshot-" + Date.now() + ".png";
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  }
  /** Export the current visible composition as a PNG Blob (null if empty). */
  async exportCurrentBlob() {
    if (!this.imgCanvas) return null;
    this.paint();
    return await new Promise((r) => this.canvas.toBlob(r, "image/png"));
  }
  async copy() {
    if (!this.imgCanvas) return;
    this.paint();
    try {
      const b = await new Promise((r) => this.canvas.toBlob(r, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
      this.flash("Copied");
    } catch (e) {
      this.flash("Use Save");
    }
  }
  flash(msg) {
    set({ copyLabel: msg });
    setTimeout(() => set({ copyLabel: "Copy" }), 1200);
  }

  /** Snapshot the current backdrop/frame style (for "save as default"). */
  snapshotStyle() {
    const s = this.state;
    return {
      color: s.color,
      size: s.size,
      frame: s.frame,
      padding: s.padding,
      srad: s.srad,
      shadow: s.shadow,
      bg: s.bg,
    };
  }

  /**
   * Headlessly render `src` with the given style applied and return a PNG Blob.
   * Reuses the full beautify pipeline on a throwaway offscreen engine so the
   * visible editor is never disturbed. `style` may be null → built-in defaults.
   */
  async exportStyledBlob(src, style) {
    const off = new Editor();
    // Detach from the shared store so the visible editor is never disturbed:
    // give this instance a private, frozen-in-time state clone.
    if (off._unsub) off._unsub();
    off.state = { ...editorStore.state };
    if (style && typeof style === "object") {
      Object.assign(off.state, {
        color: style.color ?? off.state.color,
        size: style.size ?? off.state.size,
        frame: style.frame ?? off.state.frame,
        padding: style.padding ?? off.state.padding,
        srad: style.srad ?? off.state.srad,
        shadow: style.shadow ?? off.state.shadow,
        bg: style.bg ?? off.state.bg,
      });
    }
    off.canvas = document.createElement("canvas");
    off.ctx = off.canvas.getContext("2d");
    off.empty = document.createElement("div");
    off.mounted = true;
    // Inert the store-writing hooks so this offscreen render never touches the
    // shared editorStore (which drives the visible UI).
    off.syncFlags = () => {};
    off.setTool = () => {};
    off.hideSelbar = () => {};
    off.hideCropBar = () => {};
    // Wait for any wall backdrop image this style needs before painting.
    if (off.state.bg?.kind === "wall") {
      await Editor._ensureWall(off, off.state.bg.id);
    }
    await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        off.loadImage(im);
        resolve();
      };
      im.onerror = reject;
      im.src = src;
    });
    off.buildBase();
    off.paint();
    return await new Promise((r) => off.canvas.toBlob(r, "image/png"));
  }

  /** Ensure the wall image with `id` is decoded into `inst.WALLIMG`. */
  static _ensureWall(inst, id) {
    if (inst.WALLIMG[id]) return Promise.resolve();
    const wall = WALLS.find((w) => w.id === id);
    if (!wall) return Promise.resolve();
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        inst.WALLIMG[id] = im;
        resolve();
      };
      im.onerror = () => resolve();
      im.src = wallSrc(wall);
    });
  }

  // ---- tool + settings actions (called from React) --------------------------
  setTool(t) {
    if (this.cropDraft) this.cancelCrop();
    this.selectedIndex = -1;
    this.hideSelbar();
    set({ tool: t });
    if (this.canvas) {
      this.canvas.classList.toggle("draw", ["pen", "marker", "arrow", "box", "circle", "eraser", "crop", "pixelate"].includes(t));
      this.canvas.classList.toggle("textc", t === "text");
    }
  }
  setColor(c) {
    set({ color: c });
  }
  setSize(v) {
    set({ size: v });
  }
  setBg(bg) {
    set({ bg });
    this.buildBase();
    this.paint();
  }
  applySetting(key, val) {
    set({ [key]: val });
    this.buildBase();
    this.paint();
  }

  // ---- demo template --------------------------------------------------------
  makeDemo() {
    const w = 1240,
      h = 780,
      c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, w, h);
    x.fillStyle = "#f5f7fb";
    x.fillRect(0, 0, 252, h);
    x.fillStyle = "#e7ebf3";
    x.fillRect(251, 0, 1, h);
    x.fillStyle = "#12141a";
    this.rr(x, 26, 26, 30, 30, 9);
    x.fill();
    x.fillStyle = "#fff";
    x.beginPath();
    x.arc(41, 41, 4.5, 0, 7);
    x.fill();
    x.fillStyle = "#12141a";
    x.font = '700 18px Manrope,sans-serif';
    x.textBaseline = "middle";
    x.fillText("ScreenXShot", 70, 42);
    ["Overview", "Reports", "Customers", "Revenue", "Settings"].forEach((t, i) => {
      const y = 112 + i * 46;
      if (i === 0) {
        x.fillStyle = "#e9edff";
        this.rr(x, 16, y - 18, 220, 36, 9);
        x.fill();
      }
      x.fillStyle = i === 0 ? "#2544d6" : "#5b626e";
      x.font = '600 14px Manrope';
      x.fillText(t, 32, y);
    });
    x.textBaseline = "alphabetic";
    x.fillStyle = "#12141a";
    x.font = '800 27px Manrope';
    x.fillText("Overview", 292, 60);
    x.fillStyle = "#8b93a2";
    x.font = '500 14px Manrope';
    x.fillText("Last 30 days", 292, 88);
    x.fillStyle = "#12141a";
    x.font = '800 56px Manrope';
    x.fillText("$48,920", 292, 172);
    x.fillStyle = "#16a34a";
    x.font = '600 15px Manrope';
    x.fillText("+ 12.4% vs last month", 292, 202);
    const bx = 292,
      by = 600,
      bw = 900,
      bh = 330,
      vals = [0.4, 0.62, 0.5, 0.78, 0.55, 0.9, 0.68, 0.95, 0.6, 0.82, 0.72, 1],
      gap = 14,
      barW = (bw - gap * (vals.length - 1)) / vals.length;
    vals.forEach((v, i) => {
      const bhh = v * bh,
        gx = bx + i * (barW + gap),
        g = x.createLinearGradient(0, by - bhh, 0, by);
      g.addColorStop(0, "#4b6bff");
      g.addColorStop(1, "#9db2ff");
      x.fillStyle = g;
      this.rr(x, gx, by - bhh, barW, bhh, 6);
      x.fill();
    });
    x.strokeStyle = "#e7ebf3";
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(bx, by + 0.5);
    x.lineTo(bx + bw, by + 0.5);
    x.stroke();
    return c;
  }
}
