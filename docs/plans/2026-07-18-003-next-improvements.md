# ScreenXShot — next improvements: polish backlog + new feature ideas

_2026-07-18 · research + written deliverable. No source code was changed except
to create this doc. Every current-state claim is grounded in code read on
2026-07-18; where wiring is uncertain it says "verify" rather than asserting._

Builds on (does NOT repeat):
`2026-07-18-001-bettershot-gap-analysis.md`,
`2026-07-18-002-bettershot-do-it-better.md`,
`2026-07-17-001/002` desktop plans, and `GOALS.md`. Those proposed the *what*;
this doc is about (A) unfinished/rough edges in what already shipped, and
(B) genuinely new ideas beyond those docs.

---

## 1. Polish & quality backlog (existing features)

Severity: High/Med/Low · Effort: S/M/L.

| # | Area | Specific issue (file:line) | Suggested fix | Sev | Eff |
|---|---|---|---|---|---|
| P1 | Editor toolbar | **New tools are keyboard-only.** `Dock.jsx` `TOOLS[]` (lines 6–29) has buttons only for cursor/pen/marker/arrow/box/circle/text/eraser/crop/pixelate. The shipped ops **badge, line (`l`), frect/filled-rect (`f`), carrow/curved-arrow (`d`), blur/gaussian (`b`)** exist in `engine.js` (`KEY` map line 670, `drawOp` 376–431) but have **no dock button** — undiscoverable unless you know the key. | Add 5 buttons to `TOOLS[]` with tips (e.g. `Badge · N`, `Line · L`, `Filled box · F`, `Curved arrow · D`, `Blur · B`). Pure UI, one file. | High | S |
| P2 | Style presets | **Preset export/import is unwired.** `engine.js` exposes `exportPreset()` (1033), `applyPreset()` (1041), `serializePreset`/`mergePreset` (25–36) with passing tests, but grep shows **zero UI callers** in `apps/`. It's a finished engine primitive with no surface. | Add "Export preset / Import preset" to desktop editor FABs (`main.tsx`) and/or a Settings row; write/read a `.json` via `plugin-dialog` + `plugin-fs` (already deps). | High | S–M |
| P3 | Continue-on-web | **Silent failure.** `continueOnWeb()` (`desktopBridge.ts` 181–188) only `console.error`s on `openUrl` failure — no toast/flash. User clicks, nothing visible happens. | Surface a flash/toast on error (reuse `editor.flash` or a FAB state). | Med | S |
| P4 | Batch beautify | **Errors are counted but not itemized.** `batchBeautify` (`desktopBridge.ts` 250–271) increments `failed` and logs to console; UI only shows `"N failed"` (`main.tsx` 40–46). User can't tell *which* files failed or why. | Collect failed filenames; show them (tooltip/expandable) or offer a retry. | Med | M |
| P5 | Editor copy | **Copy error is generic.** `engine.js copy()` (1002–1012) catches *all* clipboard errors and flashes `"Use Save"` — masks permission-denied vs transient. Desktop has a native clipboard fallback (`nativeCopyPng`) but the editor's own `copy()` doesn't call it. | On desktop, route `copy()` failure through `nativeCopyPng`; keep the web "Use Save" flash only when no fallback exists. | Med | M |
| P6 | Pin window | **Pin has no annotation toolbar affordance beyond the shared dock, and no "copy styled".** `pin.tsx` shows Copy/Save/Close only; `editor.copy()` (49) copies raw composition. Fine, but there's no way to apply the default style on the pin. Also: pin reuses one window — a second `toast_pin`/`pin_capture` while a pin is open silently reloads it (`show_pin` 14–27), which may surprise the user mid-annotation. | Add a "Copy styled" pin button; consider confirming/replacing when a pin is already open with unsaved edits (verify current UX). | Low | M |
| P7 | Self-timer | **No countdown on the hotkey→region default path until pointer-up; fullscreen/window count down inside the overlay (good), but the hotkey alone just shows the overlay.** `runSelfTimer` (`overlay.ts` 137–146) fires on `pointerup`/screen/window — correct. But there's **no visible timer when After-capture is Copy-Raw/Copy-Styled and the user expects instant grab**; also verify the countdown digit is legible on multi-monitor (only the focused overlay shows it). | Verify countdown visibility per-monitor; consider a small persistent "timer armed" hint in the overlay bar. | Low | S |
| P8 | Accessibility | **Segmented controls use `role=radio`+`aria-checked` but the container `role=radiogroup` lacks roving tabindex / arrow-key nav.** `SegRow` (`settings.tsx` 74–87) and the After-capture group (188–203). Buttons are individually tabbable; arrow-key movement between radios (expected for radiogroups) isn't implemented. | Add arrow-key handling + `tabIndex` roving, or switch to native `<input type=radio>`. Resolves the pre-existing aria warnings. | Med | M |
| P9 | Window race | **`dispatch_capture` show/hide ordering.** In `OpenEditor` (`commands.rs` 92–102) the main window `show()`+`set_focus()` run before `emit("capture:ready")`; the editor pulls bytes on the event. On macOS the activation-policy dance (`Accessory`↔`Regular`, `overlay.rs` 62–66/135–140) plus `hide()` being async to the compositor (documented 234–258) is timing-sensitive. No bug observed in reading, but it's the fragile area. | Add an integration smoke test for capture→editor visibility; verify focus lands reliably after rapid repeat captures. | Med | M |
| P10 | Updater | **Updater plugin wired but not functional.** `lib.rs` 88–90 registers `tauri_plugin_updater`; `tauri.conf.json` 46–51 has `endpoints` + `pubkey: "REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY"` (placeholder). No in-app "check for updates" UI. So updates can't actually happen yet. | Either finish (real endpoint + signing key + a Settings "Check for updates" button) or clearly mark deferred. See §2 F6. | Med | M–L |
| P11 | Toast a11y | **Toast body is clickable but keyboard focus/roles unverified.** `toast.ts` 155–161 adds Enter/Space handlers to `body`, but verify `body` and each `[data-action]` button are focusable and labelled (they live in a borderless webview that isn't focused by default — `focused(false)` in `toast.rs` 80). | Verify tab order / focus grab in the toast webview; add `aria-label`s to action buttons. | Low | S |
| P12 | Empty/error states | **No "no capture available" user feedback.** `take_capture`/`toast_preview` return `AppError::Capture("no capture available")` (`commands.rs` 348/491); the pin/editor callers `console.error` only. If the buffer is empty (e.g. pin invoked with nothing captured yet via tray "Pin last capture", `lib.rs` 236), the window opens blank. | Show an empty state in pin/editor when the buffer is empty; disable tray "Pin last capture" until a capture exists (verify). | Med | S–M |
| P13 | Window capture | **Frontmost-window heuristic is title/name-string based.** `capture_front_window_image` (`commands.rs` 567–586) skips own windows by matching `"screenxshot"`/`"Select region"`/`"Screenshot captured"` and requires non-empty title. Untitled or localized windows may be mis-picked; Windows z-order via `xcap` is unverified. | Verify on Windows; consider an explicit window-picker overlay (see §2 F5) instead of a heuristic. | Med | M |

> Note: several items above (P9, P11, P13, and Windows paths generally) are marked
> to **verify on Windows** — the codebase has `cfg!(target_os)` branches but the
> non-macOS paths (compositor settle 120/20ms, tray, always-on-top, window
> z-order) are the least-exercised and highest-risk for cross-platform bugs.

---

## 2. New feature ideas (beyond prior docs)

Grounded in our three real edges: **shared editor engine**, **cross-platform**,
**privacy-first**. Each: what · why-us · impl sketch · effort · free/premium.
Ideas already covered in prior docs (pin, handoff, presets, batch, color picker,
recording, OCR) are **not** re-proposed here except where noted "already
proposed — check".

| # | Feature | What / why us | Impl sketch (real files) | Eff | Tier |
|---|---|---|---|---|---|
| F1 | **Template/preset gallery UI** | The preset *primitives* exist (`exportPreset`/`applyPreset`, P2) but there's no gallery to pick a look in one click. Turn them into a visible strip of thumbnails. Uniquely ours: presets are portable JSON rendered identically headlessly via `exportStyledBlob`. Prior docs proposed *shareable presets* (002 §3.3) — the **gallery UI** is the missing surface. | Bundle a few `.json` presets; render each as a live `exportStyledBlob` thumbnail on a demo image; click → `applyPreset`. Lives in editor (web+desktop). | M | Free (basic) / Premium (packs) |
| F2 | **Quick-annotate-to-clipboard hotkey** | A second global shortcut that captures a region and drops **straight into the pin** (or copies raw) with zero editor window — fastest possible loop. New vs docs (which only proposed *more per-mode shortcuts* generically). | Register a 2nd combo in `build_global_shortcut` (`lib.rs` 154–164); route to `show_overlay` with a mode flag → on finish call `toast_pin`/copy. Needs a settings field. | S–M | Free |
| F3 | **Capture history / recents browser** | Auto-save already writes timestamped files (`auto_save_bytes` `commands.rs` 154–169) but keeps **no index or gallery**. A small history panel + tray "Recents" submenu (tray currently has no recents, `lib.rs` 198–213). *Already proposed in 001 §Workflow* — flag as **check/build**, still unbuilt. | Maintain a small JSON index in the store on each save; a history window lists thumbnails → re-open in editor/pin. Tray submenu of last N. | M | Free / Premium (search) |
| F4 | **Scrolling / long-screenshot capture** | Capture a scrollable region taller than the viewport by stitching frames. High-value, genuinely new (not in prior docs). Honest caveat: cross-platform scroll-and-stitch is fiddly (no single API like macOS). | Rust: repeated `xcap` grabs + programmatic scroll or user-paced "capture next" steps; stitch via `image` crate (already a dep). Start with **manual multi-shot stitch** (F4b) as the cheap MVP. | L | Premium |
| F5 | **Window-specific capture picker** | Replace the frontmost-window heuristic (P13) with a picker: highlight each window as you hover, click to grab. More reliable + nicer UX, cross-platform. | Enumerate `xcap::Window::all` (already used); draw hover outlines in the overlay webview; click routes to a new `capture_window_by_id`. | M | Free |
| F6 | **In-app update flow** | Finish what's half-wired (P10): a Settings "Check for updates" button using the already-registered updater plugin. New *surface*, not new plumbing. | Real endpoint + signing key in `tauri.conf.json`; a button calling the updater API; a small "update available" toast (framework exists). | M–L | Free |
| F7 | **Editor onboarding / shortcut cheatsheet overlay** | The editor has rich keyboard tools (`KEY` map, `engine.js` 670) that are undiscoverable (see P1). A `?`-triggered cheatsheet overlay listing tools + shortcuts. New. Cross-surface (web+desktop) for free. | A small React overlay in the editor package listing `KEY` entries; bind `?`. Pure UI. | S | Free |
| F8 | **Custom-image backdrop** | Editor supports solid/grad/wall/custom-color `bg.kind`; add `custom-image` drawn via existing `coverDraw`. Proposed in 001 §Beautify quick-wins — flag as **check**, still unbuilt (verify). | Add `bg.kind==="custom-image"`; file-pick → object URL → `coverDraw` in `drawBackdrop`. | S | Free |
| F9 | **Delayed / scheduled capture** | Beyond the self-timer: capture at a set clock time or after N minutes (demos, "capture this dialog in 30s"). New. | A scheduled `show_overlay`/grab via a Rust timer task; small settings/quick-action. Builds on existing capture commands. | S–M | Free |
| F10 | **Drag-out from pin/main to other apps** | Drag the composed image directly into Slack/Figma/Finder. *Drag-to-app was proposed in 001 §Workflow* — flag as **check**, unbuilt; Tauri drag-out is fiddly but possible. | Tauri file-drag start from the pin/editor with a temp PNG; verify per-OS. | M | Free |

**Deliberately NOT re-proposed** (covered/deferred in prior docs, unchanged
verdict): full screen recording → MP4 + video editor (002 §2.1, defer/Premium
anchor), native-quality OCR (002 §2.2, defer), bundled macOS system wallpapers
(002 §2.3, don't copy).

---

## 3. Prioritized recommendation — do next

Ranked by impact × feasibility.

**Top 3 polish fixes**
1. **P1 — Add dock buttons for badge/line/frect/carrow/blur.** Five shipped
   tools are keyboard-only and invisible; one-file UI fix unlocks work already
   built. Highest ROI in the whole doc.
2. **P2 — Wire preset export/import to UI.** A finished, tested engine primitive
   with zero surface; small effort turns dead code into a shipped feature.
3. **P3 — Surface Continue-on-web failures.** Cheap; removes a silent-failure
   footgun on our killer differentiator.

**Top 3 new features**
1. **F1 — Template/preset gallery UI.** Builds directly on P2's newly-wired
   primitives; one-click "looks" showcase our shared-engine edge on web+desktop.
2. **F7 — Editor shortcut cheatsheet overlay.** Small, cross-surface, and
   directly fixes the discoverability root cause behind P1.
3. **F3 — Capture history / recents.** Highest-value workflow gap still unbuilt;
   builds on existing auto-save + tray.

**Single highest-ROI item to start: P1 (dock buttons for the 5 new tools).**
It's a one-file change that makes already-shipped, already-tested functionality
usable and visible — the best effort-to-value ratio available. P2 and F1 form the
natural follow-on chain (wire presets → build the gallery), and F7 closes the
discoverability theme that P1 exposes.


