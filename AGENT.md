# AGENT.md

Guidance for AI agents (and humans) working in the **screenxshot** repository.

## What this project is

**screenxshot** (product name **"Prism"**) is a **screenshot beautifier and
annotator** that runs entirely in the browser. You drop in a raw screenshot and
it turns it into a polished, shareable image — set on a beautiful backdrop,
wrapped in a clean macOS-style window frame, marked up with annotations, then
copied to the clipboard or saved as a PNG.

The guiding principle is **privacy-first, zero-install**:
> *"No account, no upload, no server. Your screenshot never leaves this browser tab."*

It is comparable to tools like CleanShot X, Shots, or Ray.so's screenshot mode.

- **Product name:** Prism (the fake in-app window reads `prism.studio`)
- **Repo / codename:** screenxshot
- **Status:** Early stage — everything lives in a single HTML file.

## Repository layout

```
.
├── prism.html   # The ENTIRE application (HTML + CSS + vanilla JS, ~754 lines)
└── README.md    # One-line placeholder
```

There is **no build step, no package manager, and no dependencies** other than
Google Fonts (Manrope + JetBrains Mono) loaded via `<link>`. Open `prism.html`
in a browser and it works.

## Architecture (all inside `prism.html`)

The app is a self-contained landing page whose hero section doubles as a fully
functional editor embedded in a fake "mac window".

- **`<style>` block** — CSS custom properties (`--paper`, `--accent`, shadows,
  fonts), all layout, the dock/panel/window chrome, and animations
  (`.reveal` scroll-reveal, parallax `.player` layers).
- **`<script>` block** — two IIFEs:
  1. Header scroll state + `IntersectionObserver` scroll-reveal + hero parallax.
  2. The editor engine (`"use strict"`), built on the HTML `<canvas>` API.

### Editor engine key pieces

- **State:** a single `state` object (`tool`, `color`, `size`, `frame`,
  `padding`, `srad` (corner radius), `shadow`, `bg`) plus `ops` (annotation
  operations), `undoStack` / `redoStack`.
- **Canvas layers:** an offscreen `base` canvas (backdrop + frame + image), an
  offscreen `anno` canvas (annotations), a `tmp` canvas (pixelate downscale),
  composited into the visible `canvas` in `paint()`.
- **Backgrounds:** 13 wallpapers generated as **inline data-URI SVGs**
  (`WALLS`), gradients (`GRADS`), solids (`SOLIDS`), and a custom color picker.
- **Frame:** `drawFrame()` renders the macOS traffic-light dots, sheen, and a
  `prism.studio` address pill with a lock glyph.
- **Annotation tools:** cursor/select, pen, marker (highlight), arrow, box,
  ellipse, text, eraser, crop, pixelate — each an entry in `ops` drawn by
  `drawOp()`. Objects can be selected, moved, and deleted.
- **Input:** `pointerdown/move/up` on the canvas; paste (`⌘V`/`Ctrl+V`),
  drag-and-drop, and file upload bring an image in.
- **Export:** `save()` → `canvas.toBlob()` download; `copy()` →
  `navigator.clipboard.write()`.
- **Keyboard:** tool shortcuts (V/P/H/A/R/O/T/E/C/X), `⌘S` save, `⌘Z` /
  `⌘⇧Z` undo/redo.

## Feature checklist (for parity during any migration)

- [ ] Paste / drag-drop / click-to-upload image input
- [ ] 13 SVG wallpapers + gradients + solids + custom color
- [ ] Frame: None / Light / Dark macOS window chrome (dots + `prism.studio` bar)
- [ ] Padding S/M/L/XL, corner radius None/S/M/L, shadow None/Soft/Med/Lift
- [ ] Tools: cursor, pen, marker, arrow, box, ellipse, text, eraser, crop, pixelate
- [ ] Color palette + 3 stroke sizes
- [ ] Select / move / delete existing annotations
- [ ] Undo / redo
- [ ] Copy to clipboard + Save PNG
- [ ] Keyboard shortcuts
- [ ] Hero parallax, scroll-reveal, sticky header
- [ ] `prefers-reduced-motion` + `:focus-visible` accessibility
- [ ] Everything client-side — no network calls with user image data

## How to run

Just open `prism.html` in a modern browser, or serve the folder statically:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000/prism.html
```

## Conventions

- Vanilla JS, no framework. Terse, single-file style — match the surrounding
  density and naming if editing `prism.html`.
- Keep the app fully client-side. **Never** add code that uploads the user's
  screenshot anywhere.
- The visual design system is driven by the CSS custom properties in
  `:root` — reuse them rather than hard-coding colors.
