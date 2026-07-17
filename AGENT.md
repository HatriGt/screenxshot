# AGENT.md

Guidance for AI agents (and humans) working in the **screenxshot** repository.

## What this project is

**ScreenXShot** (formerly codenamed "Prism") is a **screenshot beautifier and
annotator** that runs entirely in the browser. You drop in a raw screenshot and
it turns it into a polished, shareable image — set on a beautiful backdrop,
wrapped in a clean macOS-style window frame, marked up with annotations, then
copied to the clipboard or saved as a PNG.

The guiding principle is **privacy-first, zero-install**:
> *"No account, no upload, no server. Your screenshot never leaves this browser tab."*

It is comparable to tools like CleanShot X, Shots, or Ray.so's screenshot mode.

- **Product name:** ScreenXShot (the fake in-app window reads `screenxshot.app`)
- **Repo / codename:** screenxshot
- **Status:** Early stage — everything lives in a single HTML file.

## Tech stack

Migrated from a single `prism.html` file to a **React + Vite + TanStack** app,
preserving the original look and functionality 100%.

- **Vite** — dev server and build (`npm run dev` / `npm run build`).
- **React 18** — UI components.
- **TanStack Router** — routing (single `/` route today; file/code-based tree
  ready for more pages).
- **TanStack Store** (`@tanstack/react-store`) — reactive editor settings +
  derived UI flags that drive the dock/panel active states.
- Fonts: Google Fonts (Manrope + JetBrains Mono) via `<link>` in `index.html`.

## Repository layout

```
.
├── index.html              # Vite entry, font links, #root mount
├── vite.config.js
├── package.json
├── src/
│   ├── main.jsx            # React root + RouterProvider
│   ├── router.jsx          # TanStack Router setup
│   ├── styles.css          # Full stylesheet (ported verbatim from prism.html)
│   ├── routes/HomePage.jsx # Landing page: Header/Hero/Studio/Caps/Footer
│   ├── components/         # Header, Hero, Studio, Dock, Panel, Caps, Footer
│   ├── hooks/              # useReveal (scroll-reveal), useParallax (hero)
│   └── editor/
│       ├── data.js         # WALLS / GRADS / SOLIDS / COLORS / SIZE / TSIZE (verbatim)
│       ├── store.js        # TanStack Store: settings + derived flags
│       ├── engine.js       # Canvas engine (drawing math ported verbatim)
│       └── instance.js     # Shared Editor singleton
└── README.md
```

The original `prism.html` was removed after parity verification; it remains in
git history as the reference implementation.

## Architecture

The app is a landing page whose hero section is followed by a fully functional
editor embedded in a fake "mac window".

- **`src/styles.css`** — CSS custom properties (`--paper`, `--accent`, shadows,
  fonts), all layout, the dock/panel/window chrome, and animations
  (`.reveal` scroll-reveal, parallax `.player` layers). Ported unchanged.
- **`src/editor/engine.js`** — the `Editor` class (canvas `<canvas>` API). React
  components call its methods; it reads settings from the TanStack store and
  writes back derived flags (`hasImage`/`canUndo`/`canRedo`/`copyLabel`).
- **React components** own only the DOM chrome and reflect store state; the
  drawing math is not re-implemented in React.

### Editor engine key pieces (in `src/editor/engine.js`)

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

```bash
npm install
npm run dev       # dev server (http://localhost:5173)
npm run build     # production build → dist/
npm run preview   # preview the production build
```

## Conventions

- Keep the app fully client-side. **Never** add code that uploads the user's
  screenshot anywhere.
- The visual design system is driven by the CSS custom properties in
  `:root` (`src/styles.css`) — reuse them rather than hard-coding colors.
- The canvas drawing math in `engine.js` is a faithful port — change it only
  with a matching parity check (drive the editor and compare exported PNGs).
- Editor settings flow through the TanStack store (`src/editor/store.js`);
  add new settings there and read them in the engine.
