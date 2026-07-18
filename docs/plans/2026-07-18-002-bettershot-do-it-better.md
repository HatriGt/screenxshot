# BetterShot, but done better — differentiation playbook

_2026-07-18 · research + product deliverable. No source code was changed to
produce this. Builds ON `2026-07-18-001-bettershot-gap-analysis.md` — read that
first for the plain parity table; this doc is only about where we can be
genuinely **better**._

## Framing: our four structural advantages

Every "better" claim below cashes out to one (or more) of these real edges — not
wishful thinking:

1. **Cross-platform by construction.** BetterShot is native Swift, macOS-only
   ([README](https://github.com/KartikLabhshetwar/better-shot)). We're Tauri v2
   (`apps/desktop/src-tauri`), so the *same* feature ships on Windows too. On
   Windows, BetterShot simply doesn't exist — anything we ship there is
   category-defining for our users, not catch-up.
2. **One shared editor engine, web + desktop.** `packages/editor/src/editor/engine.js`
   powers both `apps/web` (React/JSX) and the desktop webview
   (`apps/desktop/src/desktopBridge.ts` → `editor.fromSrc()`). BetterShot's
   beautify pipeline is locked inside a native app. Ours is portable, already
   headless-renderable (`exportStyledBlob`), and identical across surfaces.
3. **Privacy-first, provably local.** GOALS.md principle: nothing is uploaded.
   Tauri's capability/permission model lets us *prove* it (no net-enabled
   capabilities). BetterShot is also local, but "no network capability declared
   in the bundle" is a stronger, auditable claim than "trust us."
4. **Automation already wired.** We shipped `AfterCapture::CopyStyled` +
   `default_style` (`settings.rs`, `dispatch_capture` in `commands.rs`): a
   capture can be auto-beautified and copied with zero clicks. BetterShot has
   auto-apply too, but ours is engine-backed and reusable headlessly.

Honesty rule applied throughout: where we **can't** actually beat native, the
feature is in §2 (deliberately not copying) rather than dressed up as a win.

---

## 1. Better versions of things BetterShot has

### 1.1 Pin-to-screen — *live, editable* pin (maps to: pin screenshot / always-on-top)
- **How BetterShot does it:** pins a captured image as a static always-on-top
  window you can drag around and dismiss.
- **How WE do it better:** make the pin a *live editor surface*, not a dead
  bitmap. We already build borderless always-on-top windows for overlay/toast
  (`WebviewWindowBuilder … always_on_top(true)` in `overlay.rs`/`toast.rs`) and
  we already serve buffered PNG bytes to a webview (`toast_preview` +
  `bytesToObjectUrl`). So a pinned window can host the same `@screenxshot/editor`
  — annotate/blur/arrow *on the pin itself*, then re-copy. BetterShot's pin is
  view-only; ours is a floating mini-editor. Cross-platform for free (Tauri
  always-on-top works on both).
- **Implementation sketch:** new `pin_capture` command opens a small
  `always_on_top` `WebviewWindow` loading a trimmed editor route; feed it the
  `CaptureBuffer` bytes like the toast does. macOS: set window level above
  normal + `visible_on_all_workspaces`. Windows: `always_on_top(true)` suffices.
  **Effort: M.**
- **Free vs Premium:** **Free.** Cheap delight + word-of-mouth; the interactive
  twist is the differentiator, not a paywall.

### 1.2 Configurable overlay/toast — *cross-surface + interactive* (maps to: configurable overlay, toast notifications)
- **How BetterShot does it:** toast/overlay position and auto-dismiss are
  settings; toasts show OCR/color/gallery results.
- **How WE do it better:** we *just added* `toast_position` + `toast_dismiss_ms`
  to `Settings` (settings.rs) — so we're already at parity on config. The "better"
  is the toast being a real interactive webview (`toast.ts`, `toast_edit`) that
  can preview + one-tap-edit, and (with the shared editor) offer inline quick
  actions (Copy / Copy styled / Pin / Edit) as toast buttons rather than a
  passive notification. `toast_dismiss_ms = 0` already supports "stay until
  clicked."
- **Implementation sketch:** add action buttons to `toast.ts`, wired to existing
  commands (`toast_edit`, a new `toast_copy_styled`). Position/dismiss plumbing
  already exists. **Effort: S.**
- **Free vs Premium:** **Free.** Table-stakes vs a free competitor.

### 1.3 Numbered badges — *auto-sequencing, re-orderable* (maps to: numbered badges)
- **How BetterShot does it:** press `N`, drop an incrementing numbered badge.
- **How WE do it better:** same UX, but our badges are engine ops in
  `engine.js`'s `ops[]` array, so they get undo/redo (60-deep stack), hit-test
  move (`hitTest`/`shiftOp`), and — the differentiator — **auto-renumber on
  delete/reorder**. Delete badge 2 and 3→4 collapse to 2→3 automatically because
  numbering is derived from op order at render time, not baked in. BetterShot's
  are typically fixed labels.
- **Implementation sketch:** add a `badge` op type to `drawOp` (circle + index
  text); compute the displayed number from the badge's position among `badge`
  ops in `renderAnno`. Add `n` to the `KEY` map. Editor-only, shared web+desktop.
  **Effort: S–M.**
- **Free vs Premium:** **Free.** Core annotation parity.

### 1.4 Beautify defaults — *live-preview panel powered by the real engine* (maps to: configurable defaults w/ live preview)
- **How BetterShot does it:** a settings tab with live preview of default
  backdrop/padding/radius/shadow.
- **How WE do it better:** we persist `default_style` and can already render it
  *headlessly and identically* via `exportStyledBlob` (an offscreen `Editor`
  clone). So our "live preview" isn't a re-implementation — it's the exact same
  pixels the capture will get, guaranteed, on both web and desktop settings. We
  can even show the preview on the **web** settings too (same engine), which
  BetterShot structurally cannot.
- **Implementation sketch:** in `settings/settings.tsx`, mount a small editor
  canvas that runs the real engine on a demo image (`makeDemo`) and writes to
  `default_style` via `saveCurrentStyleAsDefault`. **Effort: M.**
- **Free vs Premium:** **Free** (the panel). Large gradient/wallpaper packs → Premium.

### 1.5 Line / filled-rect / curved-arrow / gaussian-blur — parity with a twist (maps to: annotate toolset)
- **How BetterShot does it:** discrete native tools (L, F, curved A, CoreImage blur).
- **How WE do it better:** these are tiny deltas to existing `engine.js` ops
  (`arrow` minus head = line; `box` + `fill()`; quadratic curve; a true gaussian
  vs our current `pixelate` mosaic). The genuine edge: because they're shared
  ops, they instantly work on **web + desktop + the live pin (§1.1)** with one
  implementation. Honest caveat: this is mostly parity, not a leap — bundle it
  cheaply, don't over-market it.
- **Implementation sketch:** extend `drawOp`/`_bind` op creation; add keys to
  `KEY`. Gaussian: offscreen canvas `filter = "blur(px)"`. **Effort: S each.**
- **Free vs Premium:** **Free.**

---

## 2. Things BetterShot has that we should deliberately NOT copy (yet)

### 2.1 Full screen recording → MP4 + video editor — **don't copy now**
- BetterShot leans on **ScreenCaptureKit + AVFoundation** — one Apple API. We'd
  need per-platform native work: macOS ScreenCaptureKit via `objc2` FFI, Windows
  Windows.Graphics.Capture + Media Foundation, plus MP4 encoding (ffmpeg-sidecar
  or platform codecs). Cross-platform crates (`scap`) are young. This is the one
  place native is *genuinely better* than us, and copying it badly (laggy,
  huge binary, OS-specific bugs) would undercut our "fast and light" identity.
- **Verdict:** defer until the image loop is fully polished; if we ever ship it,
  it's the clearest **Premium** anchor. Don't chase parity to look complete.

### 2.2 On-device OCR at native quality — **don't copy the native path**
- BetterShot uses **Vision** (excellent, free on macOS). Our cross-platform
  options are native Vision (mac) + Windows.Media.Ocr (win) = two code paths, or
  bundled Tesseract = one path but larger binary and lower accuracy. Matching
  Vision's quality on Windows is not realistic short-term.
- **Verdict:** don't ship a worse-than-Vision OCR just for the checkbox. If we do
  it later, do it *once, cross-platform* (Tesseract) and be honest it's "good
  enough" — or make it a **Premium** cloud-optional toggle (opt-in, breaking
  local-first only with explicit consent). Not near-term.

### 2.3 Bundled macOS system wallpapers — **don't copy**
- BetterShot ships Apple's system wallpapers as backdrops. We legally/practically
  can't redistribute macOS wallpapers cross-platform, and our SVG walls (`WALLS`)
  render identically on Windows. Copying would be a licensing headache for zero
  cross-platform benefit.
- **Verdict:** keep our own SVG/gradient packs; lean into "same look on every
  OS" as the story instead.

### 2.4 Carbon/AppKit-specific overlay tricks — **don't copy the mechanism**
- Some BetterShot polish (global event taps, `NSPanel` levels) is Carbon/AppKit.
  We approximate with Tauri windows; chasing pixel-identical macOS behaviors
  would fork our cross-platform code. Match the *outcome*, not the mechanism.

---

## 3. Net-new differentiators BetterShot doesn't have (our strengths)

### 3.1 Desktop → web handoff ("Continue on web") — **our killer edge**
- **What it is:** capture on desktop, click "Continue editing on screenxshot.com"
  and the *exact same* editor state opens in the browser — same engine, same
  ops, same backdrop — with **zero upload of the image** (state travels, or the
  image stays local and only the style/ops serialize).
- **Why only we can:** the identical `@screenxshot/editor` runs on both surfaces.
  `snapshotStyle()` already serializes style; `ops[]` is plain JSON. BetterShot
  has no web product to hand off to. This turns our shared-engine architecture
  into a user-visible superpower and a growth loop into the web app.
- **Implementation sketch:** serialize `{ style, ops }` to a URL fragment or
  local hand-off file; web reads it and rehydrates via `fromSrc` + replaying
  ops. Keep image bytes local (drag the file, or re-open) to preserve privacy.
  **Effort: M** (serialization + web rehydrate route). **Free** — it's the moat.

### 3.2 Windows-first power features — **whole-OS greenfield**
- **What it is:** ship the polished capture→beautify→annotate loop, pin-to-screen,
  history, and auto-styled capture on **Windows**, where BetterShot is absent.
- **Why only we can:** we're already cross-platform (`cfg!(target_os)` branches
  in `commands.rs`, platform default hotkey in `settings.rs`). Every feature we
  ship is a Windows first-mover, not a copy.
- **Implementation sketch:** it's mostly *testing/polish* on Windows for features
  we build anyway — verify `xcap`, tray, always-on-top, autostart parity.
  **Effort: S–M per feature (incremental).** **Free** — reach is the point.

### 3.3 Shareable style presets / templates — **portable because our style is data**
- **What it is:** export a "look" (backdrop + padding + radius + shadow + frame)
  as a tiny shareable preset file/link; import to apply instantly. Teams get a
  consistent screenshot brand.
- **Why only we can (well):** `default_style` / `snapshotStyle()` is already a
  portable JSON blob consumed identically by web + desktop via `exportStyledBlob`.
  BetterShot's defaults are app-local settings, not portable artifacts.
- **Implementation sketch:** "Export preset" writes the `snapshotStyle()` JSON;
  "Import preset" feeds it to `applySetting`/`setBg`. A gallery of presets on the
  web. **Effort: S** (desktop), **M** (web gallery). **Free** basic; **Premium**
  brand/team preset packs + locking a preset org-wide.

### 3.4 Batch beautify — **headless engine makes this trivial for us**
- **What it is:** drop a folder of raw screenshots → get them all beautified with
  your default style, exported to a folder. Great for docs/marketing.
- **Why only we can (cheaply):** `exportStyledBlob(src, style)` already renders
  any image headlessly with a given style, disturbing nothing. Loop it over N
  files. BetterShot has no headless render primitive exposed for this.
- **Implementation sketch:** a "Batch" view: pick files (`tauri-plugin-dialog`),
  loop `exportStyledBlob` with `default_style`, write each via `save_capture_as`
  honoring `export_format`. **Effort: M.** **Premium** — classic pro/power-user
  workflow, and it directly showcases our engine advantage.

### 3.5 Auditable privacy guarantee — **turn "local" into a provable feature**
- **What it is:** a visible "Privacy" badge/panel stating (and *backing*) that the
  app declares no network capability — screenshots never leave the device.
- **Why only we can frame it this way:** Tauri's capability files make "no network
  permission granted" an inspectable fact, not a promise. BetterShot is local too,
  but we can *show* the guarantee. Any future cloud feature (§3.1 handoff,
  optional OCR) stays strictly opt-in behind an explicit toggle.
- **Implementation sketch:** Settings "Privacy" section listing granted
  capabilities; keep the default capability set net-free. **Effort: S.** **Free** —
  it's brand identity.

---

## Top 5 "do-it-better" bets (ranked by impact × feasibility)

1. **Live, editable pin-to-screen (§1.1)** — reuse our always-on-top windows +
   shared editor to make a floating *mini-editor*, not a dead bitmap; high delight,
   cross-platform, built on primitives we already own.
2. **Desktop → web handoff / "Continue on web" (§3.1)** — our unique moat: the
   same engine lets a capture continue in the browser with no upload, creating a
   growth loop BetterShot structurally cannot match.
3. **Shareable style presets (§3.3)** — our style is already portable JSON, so
   exportable/importable "looks" are cheap and uniquely ours across web+desktop.
4. **Batch beautify (§3.4)** — `exportStyledBlob` makes headless bulk styling
   nearly free to build and an obvious Premium anchor.
5. **Windows-first polished loop (§3.2)** — every feature shipped on Windows is a
   first-mover win in a whole OS where BetterShot doesn't exist.

### Start next: **#1 — Live, editable pin-to-screen.**
Rationale: highest impact-per-effort — it's a visible, demo-able "wow" that
reuses code we already have (always-on-top windows, `CaptureBuffer` byte-serving,
the shared editor), ships cross-platform on day one, and is the natural bridge
toward capture history and the web handoff.


