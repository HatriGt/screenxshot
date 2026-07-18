# BetterShot gap analysis + prioritized roadmap

_2026-07-18 · research + roadmap doc. No source code was changed to produce this._

## 1. What BetterShot is, and why it's a useful benchmark

[BetterShot](https://github.com/KartikLabhshetwar/better-shot) is a native
Swift 6 / SwiftUI CleanShot X alternative for macOS. It is local-first — no
cloud, telemetry, or subscriptions — and free/open-source. Its feature surface
is broad: multi-mode capture (region/fullscreen/window/recording/OCR/color
picker), a full beautify pipeline (backdrops, padding, radius, shadow, crop,
aspect ratios, alignment grid), a rich annotation toolset (10+ tools incl.
numbered badges, blur, spotlight), and a deep workflow layer (click-to-edit
floating preview, drag-to-app, pinned windows, capture history, self-timer,
auto-apply defaults, configurable overlay).

**Why it's a good benchmark, and the key caveat:** BetterShot is native Swift
and macOS-only, built directly on Apple frameworks (ScreenCaptureKit, Vision,
CoreImage, AVFoundation, AppKit, Carbon). We are **Tauri v2 (Rust + shared web
editor), cross-platform (macOS + Windows)**. So we **borrow UX/product ideas,
not code** — every feature must be re-evaluated for cross-platform Tauri
feasibility. BetterShot gets to lean on macOS-only APIs we can't assume on
Windows. Our edge is a single shared editor codebase (web + desktop) and a
lighter footprint; our cost is that OS-native features (recording, OCR, color
sampling) require per-platform Rust work rather than one Apple API call.

**Grounding:** every "screenxshot today" claim below is from reading our source:
`apps/desktop/src-tauri/src/{commands,overlay,toast,settings,lib}.rs`,
`apps/desktop/src/{main.tsx,desktopBridge.ts,Titlebar.tsx,overlay/overlay.ts,toast/toast.ts,settings/settings.tsx,settings/types.ts}`,
`packages/editor/src/editor/engine.js`, and the goals/plan docs.

---

## 2. Feature-by-feature comparison

Legend for **Gap**: ✅ have it · 🟡 partial · ❌ missing.

### Capture

| Capability | BetterShot | screenxshot today | Gap | Feasible in Tauri? notes |
|---|---|---|---|---|
| Region select (drag) | ⌘⇧4, native `screencapture` | Yes — per-monitor transparent overlay (`overlay.rs`, `overlay.ts`), `xcap` crop (`capture_region_image_by_index`) | ✅ | Already shipped, multi-monitor aware. |
| Fullscreen capture | ⌘⇧3 | Yes — `capture_fullscreen` (overlay "Whole screen" button) | ✅ | Done. |
| Window capture | ⌘⇧5 | Yes — `capture_window` picks frontmost non-own window via `xcap::Window::all` | ✅ | Done; z-order heuristic, skips own chrome. |
| Customizable capture shortcut | All shortcuts customizable | One global hotkey, live-rebindable (`set_hotkey`, `HotkeyRecorder`) | 🟡 | We have 1 combo total; BetterShot has per-mode combos. Adding more = more `global_shortcut` registrations. |
| Self-timer (3/5/10s) | Yes | No | ❌ | Trivial: delay before `show_overlay`/grab. Quick win. |
| Screen recording (MP4) | ScreenCaptureKit | No | ❌ | Big bet — see §4. |
| OCR / text scan | ⌘⇧O, Vision | No | ❌ | Big bet — see §4. |
| Color picker / hex | ⌘⇧C, AppKit | No | ❌ | Big bet — see §4. |
| Multi-monitor | Yes | Yes — one overlay per monitor, index-routed | ✅ | Solid. |

### Beautify

| Capability | BetterShot | screenxshot today | Gap | Feasible in Tauri? notes |
|---|---|---|---|---|
| Solid backdrops | 12 presets | Yes — `SOLIDS` (`drawBackdrop`, `engine.js`) | ✅ | Shared editor. |
| Gradient backdrops | 16 presets | Yes — `GRADS` linear gradients | ✅ | Done. |
| Wallpaper backdrops | Bundled macOS wallpapers | Yes — `WALLS` (bundled SVG walls) | ✅ | Ours are SVG, not macOS system walls. |
| Custom image/color backdrop | Custom image | Custom color (`bg.kind==="custom"`); no custom image | 🟡 | Custom image upload as backdrop is a small editor addition. |
| Padding | Live | Yes — `state.padding` in `buildBase` | ✅ | Done. |
| Corner radius | Live | Yes — `state.srad` | ✅ | Done. |
| Shadow | Live | Yes — `state.shadow` | ✅ | Done. |
| Window frame / chrome | (via padding/radius) | Yes — macOS-style titlebar w/ traffic lights + `screenxshot.com` watermark (`drawFrame`) | ✅ | We're ahead here. |
| Crop w/ handles + dark mask | Handles, rule-of-thirds | Crop w/ dark mask (`applyCrop`, `paint` evenodd mask); no handles / no rule-of-thirds | 🟡 | Handles + thirds guides are editor-only work. |
| Aspect ratio presets | Auto,1:1,4:3,3:2,16:9,9:16 | No | ❌ | Editor-only; medium. Constrains crop/canvas. |
| 9-point alignment grid | Yes, smart radius | No | ❌ | Editor-only; positions image within padded canvas. |
| Configurable defaults + live preview | Settings tab | Partial — `snapshotStyle`/`default_style` saved for auto-copy, but no live-preview settings panel | 🟡 | We persist a default style; no dedicated preview UI. |
| Export PNG | Yes | Yes — `save`/`copy`/`exportCurrentBlob` (PNG only) | ✅ | Done. |
| Export JPEG | Yes | No (PNG-only) | 🟡 | One-line `toBlob("image/jpeg")` + format setting. |

### Annotate

| Capability | BetterShot | screenxshot today | Gap | Feasible? |
|---|---|---|---|---|
| Rectangle | R | Yes — `box` (rounded rect) | ✅ | Done. |
| Filled rectangle | F | No (stroke only) | 🟡 | Add fill variant of `box`. |
| Ellipse / circle | O | Yes — `circle` | ✅ | Done. |
| Line | L | No (only arrow) | 🟡 | Trivial: arrow without the head. |
| Arrow | A (curved) | Yes — straight `arrow` | 🟡 | We have straight; curved is a small addition. |
| Freehand / pen | D | Yes — `pen` (+ `marker` highlighter, `eraser`) | ✅ | We're ahead: pen+marker+eraser. |
| Text | T (font/size/bold/italic/underline/align) | Yes — `text`, bold-weight only, single color/size | 🟡 | Rich text styling is missing; base text works. |
| Numbered badges | N | No | ❌ | Editor-only; small–medium (auto-increment counter op). |
| Blur | B (CoreImage) | Yes — `pixelate` (mosaic, not gaussian) | 🟡 | We pixelate; gaussian blur is a different filter. |
| Spotlight | G | No | ❌ | Editor-only; dim-everything-but-region. Medium. |
| Undo/redo | ⌘Z/⇧⌘Z | Yes — `undo`/`redo`, 60-deep stack | ✅ | Done. |
| Move/select ops | V select | Yes — `cursor` hit-test + drag (`hitTest`, `shiftOp`) | ✅ | Done. |

### Workflow

| Capability | BetterShot | screenxshot today | Gap | Feasible? |
|---|---|---|---|---|
| Click-to-edit floating preview | Yes | 🟡 — bottom-right toast w/ preview thumbnail + "Edit" tap → editor (`toast.rs`, `toast.ts`, `toast_edit`) | 🟡 | We have the toast; BetterShot's is a richer persistent preview. |
| Configurable overlay (position + auto-dismiss) | Yes | Toast fixed bottom-right, fixed 5s (`DURATION_MS`, `corner_position`) | 🟡 | Make position + timeout settings-driven. Quick win. |
| Auto-apply defaults on capture | Yes | Yes — `AfterCapture::CopyStyled` applies `default_style` (`dispatch_capture`, `handleAutoCapture`) | ✅ | Already shipped; genuine strength. |
| Drag-to-app | Figma/Slack/etc | No | ❌ | Tauri drag-out is possible but fiddly; medium. |
| Pin screenshot as always-on-top | Yes | No | ❌ | New always-on-top borderless window showing the image. Small–medium. |
| Capture history (gallery) | Screenshots + recordings tabs | No | ❌ | We auto-save to a folder but keep no index/gallery. Medium. |
| Recent menu in tray | Yes | Tray has Capture/Open/Settings/Quit only (`build_tray`) | ❌ | Add a recents submenu once history exists. |
| Toast notifications | OCR/color/gallery | 🟡 — capture-ready toast only | 🟡 | Framework exists; add per-action variants. |
| In-app updates | Yes | Plugin wired (`tauri_plugin_updater`) but no endpoint/UI | 🟡 | Deferred in plan; needs signing + server. |

### Settings

| Capability | BetterShot | screenxshot today | Gap | Feasible? |
|---|---|---|---|---|
| Save location | Yes | Yes — `save_dir` picker (`settings.tsx`, `pickFolder`) | ✅ | Done. |
| Clipboard behavior | Yes | Yes — after-capture: open-editor / copy-raw / copy-styled | ✅ | Done. |
| Appearance / theme | Yes | No (single dark theme) | ❌ | Low priority. |
| Default effects w/ live preview | Yes | 🟡 — default style saved, shown as on/off, no preview | 🟡 | See Beautify row. |
| Export format setting | Yes | No (PNG hardcoded) | 🟡 | Small. |
| Self-timer setting | Yes | No | ❌ | Quick win. |
| Shortcut customization | Per-mode | Single combo, rebindable | 🟡 | Have the mechanism. |
| Overlay position/dismiss | Yes | No | ❌ | Quick win. |
| Launch on startup | (implied) | Yes — `launch_on_startup` via `tauri_plugin_autostart` | ✅ | We're ahead here. |
| Recording / Videos / History tabs | Yes | No | ❌ | Depend on those features existing first. |

### Recording & Advanced

| Capability | BetterShot | screenxshot today | Gap | Feasible? |
|---|---|---|---|---|
| Screen recording → MP4 | ScreenCaptureKit | No | ❌ | Big bet §4 (L). |
| Floating recording status bar | Yes | No | ❌ | Depends on recording. |
| Video editor (trim/crop/pad/etc) | Yes | No | ❌ | Very large; out of near-term scope. |
| OCR text extraction | Vision | No | ❌ | Big bet §4 (M–L). |
| Color picker + hex | AppKit | No | ❌ | Big bet §4 (S–M). |
| Pin / always-on-top windows | Yes | No | ❌ | §3 quick-ish win. |
| Local-first / no cloud | Yes | Yes — fully client-side, nothing uploaded (GOALS principle) | ✅ | Shared value prop. |

---

## 3. Quick wins (low effort · high value on our current architecture)

1. **Configurable overlay/toast (position + auto-dismiss timing).** Today the
   toast is hardcoded bottom-right (`toast.rs::corner_position`) and 5s
   (`toast.ts::DURATION_MS`). Add `toast_position` + `toast_dismiss_ms` to
   `Settings` (settings.rs), pass them through `show_toast`, read in `toast.ts`.
   Pure plumbing over code we already own.

2. **Self-timer (3/5/10s).** Add `capture_delay_secs` to `Settings`; in the
   global-shortcut handler / overlay "capture" paths (`lib.rs` handler,
   `overlay.ts` `captureScreen`/`captureWindow`), `sleep` before grabbing.
   Surface as a segmented control in `settings.tsx` next to "After capture".

3. **Export format PNG/JPEG.** Add `export_format` to `Settings`; branch
   `toBlob("image/png"|"image/jpeg")` in `engine.js` (`save`, `exportCurrentBlob`,
   `exportStyledBlob`, `copy`). One editor change + one setting.

4. **Pin screenshot as always-on-top.** We already build borderless
   always-on-top windows for overlay/toast (`WebviewWindowBuilder … always_on_top(true)`).
   Add a `pin_capture` command that opens a small always-on-top window showing
   the buffered PNG (reuse `CaptureBuffer` + `toast_preview`-style byte serving).

5. **Line + filled-rectangle + curved-arrow tools.** All are small deltas to
   existing ops in `engine.js` (`arrow` without head = line; `box` with `fill()`;
   quadratic curve for arrow). Adds 3 checklist parity items cheaply.

6. **Richer toast variants (copied / saved / styled).** The toast phase enum
   (`ToastPhase`) + `toast:phase` event already exist; add message variants so
   copy-raw/copy-styled/save each show tailored text. Framework is done.

7. **Custom-image backdrop.** Editor already supports `bg.kind` solid/grad/wall/custom-color;
   add a `custom-image` kind that draws an uploaded image via existing `coverDraw`.

---

## 4. Bigger bets (cross-platform Tauri feasibility)

### Screen recording → MP4 — **Effort: L**
- macOS: ScreenCaptureKit (via a Rust binding / `objc2` FFI) or shell out to the
  `screencapture`/AVFoundation stack. Windows: Windows.Graphics.Capture + Media
  Foundation, or the `windows` crate. Cross-platform crates (`scap`) exist but
  are young; encoding to MP4 typically needs `ffmpeg`-sidecar or platform codecs.
- Big surface: floating status bar window, pause/resume/discard, hide-from-recording,
  then an entire video editor. This is the single largest gap and should be phased
  well after the image loop is polished.

### OCR / text scan — **Effort: M–L**
- macOS: Vision (best quality) via FFI. Windows: Windows.Media.Ocr. A
  cross-platform option is bundling Tesseract (`leptess`/`tesseract` crate) — one
  code path, larger binary, lower accuracy than native. Wire result → clipboard +
  a toast variant (framework already there).

### Color picker + hex — **Effort: S–M**
- Loupe overlay that samples the pixel under the cursor. We already capture full
  monitors (`capture_full_monitor_image`); a magnifier overlay can read pixels
  from a cached frame, or use `xcap` per-frame. Windows/macOS both supported by
  `xcap`. Smallest of the three bets; good "advanced capture" showcase.

### Extra global shortcuts per capture mode — **Effort: S**
- Register additional combos via `tauri_plugin_global_shortcut` (we already
  rebind one in `set_hotkey`). Mostly settings-UI + storage work.

---

## 5. Premium candidates vs must-stay-free

Our strategy is free-first, premium-later, with a single entitlement checkpoint
already planned (`pro: true` seam, per the desktop plan). BetterShot is a **free
OSS tool**, so anything it does for free that is table-stakes for a screenshot
utility must stay free for us to be competitive.

**Must stay free (parity with a free OSS competitor):**
- All core capture modes (region/fullscreen/window), the editor + annotation
  tools we already ship, basic backdrops/padding/radius/shadow, copy/save PNG,
  auto-apply defaults, self-timer, configurable overlay. Gating these would make
  us strictly worse than a free alternative.

**Natural premium material (high-effort or "pro workflow" value):**
- **Screen recording + video editor** — highest build cost, clearest pro value.
- **OCR text scan** — bundled engine cost; classic paid-tier feature.
- **Capture history / gallery with search + recents menu** — power-user retention.
- **Cloud/link share** (not in our local-first identity today; if ever added, premium-only).
- **Advanced beautify** (large gradient/wallpaper packs, batch export, extra formats/quality).
- **Extra per-mode custom shortcuts / automation.**

**Judgment call:** color picker, pin-to-screen, and drag-to-app are cheap and
help word-of-mouth — keep them **free** as differentiators rather than paywalling
low-cost delight.

---

## 6. Prioritized, phased recommendation

We just finished the capture flow + toast + settings, so momentum favors
**deepening the image loop** before opening the recording front.

### Phase 1 — polish the loop we own (quick wins)
- Configurable overlay/toast position + dismiss timing.
- Self-timer (3/5/10s).
- Export format PNG/JPEG.
- Line / filled-rect / curved-arrow tools + custom-image backdrop.
- Richer toast variants.
- _Verify:_ each is a setting or editor op wired end-to-end; capture→edit loop unchanged.

### Phase 2 — workflow depth (BetterShot's real edge)
- Pin screenshot as always-on-top window.
- Capture history/gallery + tray "recents" submenu (built on existing auto-save).
- Aspect-ratio presets + crop handles/rule-of-thirds in the editor.
- Numbered badges + spotlight + gaussian blur annotation tools.
- _Verify:_ history persists across launches; pinned windows survive recapture.

### Phase 3 — the bigger bets (native, cross-platform)
- Color picker + hex (smallest native bet; ship first here).
- OCR text scan (native where possible, Tesseract fallback).
- Screen recording → MP4 + floating status bar (largest; video editor later).
- In-app updates end-to-end (needs signing + release server; already plugin-wired).
- _Verify:_ each works on both macOS and Windows or is clearly gated per-OS.

---

## Summary: biggest gaps + top 3 next features

**Biggest gaps vs BetterShot:** (1) no screen recording/video, (2) no advanced
capture (OCR, color picker), (3) thin workflow layer — no pin-to-screen, capture
history, drag-to-app, or configurable overlay, and (4) editor parity holes
(aspect ratios, alignment grid, numbered badges, spotlight, gaussian blur, JPEG
export). We are actually **ahead** on a few things: a polished macOS-style window
frame, pen+marker+eraser, launch-on-startup, and an already-shipped
auto-apply-default-style capture path.

**Top 3 recommended next features:**
1. **Configurable overlay + self-timer + export format** — a cheap Phase-1 bundle
   that closes several settings/capture gaps using code we already own.
2. **Pin-to-screen + capture history/recents** — the highest-value workflow gap;
   builds on our existing always-on-top windows and auto-save.
3. **Color picker + hex** — the lowest-cost of the "advanced capture" bets and a
   strong differentiator to keep free.
