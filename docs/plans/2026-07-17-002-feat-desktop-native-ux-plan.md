---
title: "feat: Desktop native UX — overlay fixes, native chrome, settings menu"
date: 2026-07-17
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_type: feat
depth: standard
origin: docs/plans/2026-07-17-001-feat-tauri-desktop-app-plan.md
---

# feat: Desktop native UX — overlay fixes, native chrome, settings menu

## Summary

The desktop app (shipped in plan 001) is functional but glitchy and doesn't
feel native. This plan fixes the **region-select overlay glitches**, replaces
the **double title bar** (OS titlebar + fake in-app mac frame) with a single
**custom frameless titlebar**, and adds a **Settings/Preferences window** with a
**rebindable capture hotkey**, launch-on-startup, default save folder, and tray
behavior. Editor look is preserved; we add native chrome around it (per user:
"keep the editor look, add proper native chrome").

**Product Contract preservation:** extends plan 001; editor engine unchanged.

---

## Problem Frame

Observed after installing the built app:

- **Overlay is glitchy** (user's primary complaint). Root causes in code:
  1. Double-dim flash — `#dim` (35%) and `#selection` box-shadow (35%) both
     render; first pointermove swaps them, causing a flicker
     (`apps/desktop/src/overlay/overlay.css`, `overlay.ts:23`).
  2. `fullscreen(true)` on a transparent window triggers a macOS Space
     transition and can break transparency
     (`apps/desktop/src-tauri/src/overlay.rs:25`).
  3. Overlay is recreated (`close()` + rebuild) every capture → slow/flicker
     (`overlay.rs:39`, `finish_capture`).
  4. Single primary-monitor overlay → multi-display selection broken.
  5. Overlay may not own focus/pointer immediately → first click swallowed.
- **Double frame** — the OS titlebar plus the editor's fake mac-window bar
  (`.winbar` in `packages/editor` `Studio`) look stacked and wrong.
- **No settings** — hotkey is hardcoded (`hotkey.rs:default_shortcut`); nothing
  is persisted; there is no preferences UI.

**Goal:** a smooth capture overlay, a single native-feeling window, and a
settings menu (hotkey rebinding + core prefs), without changing the editor's
visual identity or forking the editor engine.

---

## Scope Boundaries

### In scope
- Rewrite overlay: borderless monitor-covering window (not `fullscreen`),
  pre-warmed + hidden/shown (not recreated), per-monitor coverage, single dim
  layer, guaranteed focus, robust cancel/escape/blur.
- Custom frameless main window with a small custom titlebar (drag region +
  min/close + Settings + Capture buttons); remove the redundant fake frame on
  desktop only (web keeps it).
- Settings window (separate Tauri window) + persisted preferences via
  `tauri-plugin-store`:
  - Rebindable capture hotkey (record + validate + save + re-register).
  - Launch on startup (autostart plugin).
  - Default save folder.
  - Tray behavior: close-hides vs quits.
- Wire preferences into hotkey registration, save path (U7 flow), and close
  behavior.

### Deferred to Follow-Up Work
- Windows-specific titlebar polish (snap layouts) — verify later on Windows.
- Theme switching, capture defaults, in-app update UI (plan 001 U9 deferred).
- Per-monitor DPI edge cases beyond primary + secondary basic support.

### Outside this product's identity
- Changing the editor's drawing tools or visual design system.
- Uploading anything.

---

## Key Technical Decisions

### KTD-1: Overlay = borderless window sized to each monitor, pre-warmed
Replace `fullscreen(true)` with a decorationless, transparent, always-on-top
window positioned/sized to a monitor's bounds. Create it hidden at startup and
`show()` on demand (pre-warm) instead of rebuilding. For multi-monitor, create
one overlay per monitor.
- **Trade-off:** we manage position/size + per-monitor windows ourselves, but we
  avoid the macOS fullscreen-transparency glitch and get instant, flicker-free
  open.

### KTD-2: Single dim via one element; selection is a "hole"
Use one full-screen dim layer and render the selection as a cleared rectangle
(the selection's `box-shadow: 0 0 0 100vmax` dim), and **remove the separate
`#dim` element** so there's never a double-dim swap. Dim is present from the
first frame.
- **Trade-off:** none meaningful; simpler and flicker-free.

### KTD-3: Custom frameless titlebar; hide the fake frame on desktop
Main window becomes `decorations: false`; a small React titlebar (in
`apps/desktop`, not the editor package) provides drag + window controls +
Settings/Capture. The editor's fake `.winbar` is hidden on desktop via a
desktop-only class/flag passed to `Studio` — **without editing editor styles**
(use a wrapper class + CSS override in `apps/desktop`).
- **Trade-off:** a bit of platform-conditional CSS in the desktop app, but keeps
  `packages/editor` untouched (invariant) and removes the double frame.

### KTD-4: Preferences persisted with `tauri-plugin-store`
A single `settings.json` store holds `hotkey`, `launchOnStartup`, `saveDir`,
`trayClosesToTray`. Rust reads it at startup (hotkey registration, close
behavior); the Settings window reads/writes it via the store plugin.
- **Trade-off:** adds the store + autostart plugins; standard and minimal.

### KTD-5: Hotkey rebinding re-registers live
Changing the hotkey unregisters the old shortcut and registers the new one
immediately (no restart), with validation + conflict feedback.

### KTD-6: No editor engine changes
All work lives in `apps/desktop` + `src-tauri`. The editor package stays
byte-identical (one-editor-codebase invariant from plan 001).

---

## Work Units

Each unit is independently shippable and verified before moving on (TDD where
pure logic exists). Order minimizes glitches first (user's priority), then
chrome, then settings.

### W1: Fix overlay glitches (borderless, single-dim, pre-warmed)
**Files:** `src-tauri/src/overlay.rs`, `apps/desktop/src/overlay/overlay.ts`,
`.../overlay.css`, `apps/desktop/overlay.html`, `src-tauri/src/commands.rs`,
`src-tauri/src/lib.rs`.
- Rust: build overlay per-monitor with explicit `position`+`size` from
  `monitor.position()/size()`, `decorations(false)`, `transparent(true)`,
  `always_on_top(true)`, `visible(false)` at creation; add `show_overlays()` /
  `hide_overlays()` that iterate monitors and reuse windows (no rebuild).
- Remove `fullscreen(true)`.
- CSS: delete `#dim` element usage; keep single selection box-shadow dim, shown
  from frame 1 (no display swap in `overlay.ts`).
- TS: on show, `focus()` the overlay; Escape/blur → cancel; map pointer coords
  → physical px using that monitor's scale factor; pass correct `monitorId` to
  `finish_capture`.
- **Verify:** manual — hotkey opens overlay instantly with no flash, dim is
  steady, drag on primary AND secondary monitor captures the right region,
  Escape cancels cleanly, repeated captures don't flicker. Existing `rect.test.ts`
  still passes; add a test for physical-coord mapping with a scale factor.

### W2: Custom frameless titlebar + remove double frame
**Files:** `src-tauri/tauri.conf.json` (main window `decorations:false`),
`apps/desktop/src/Titlebar.tsx` (new), `apps/desktop/src/main.tsx`,
`apps/desktop/src/desktop.css`, capabilities.
- Titlebar: `data-tauri-drag-region` drag area, app name, and buttons:
  Capture, Settings, minimize, close. Wire close to tray/quit per prefs (W5).
- Hide editor fake `.winbar` on desktop via a wrapper class in `desktop.css`
  (no edits to `packages/editor`).
- Add window capabilities: `allow-minimize`, `allow-start-dragging`.
- **Verify:** one titlebar only; window drags from the custom bar; min/close
  work; editor content unchanged visually below the bar.

### W3: Preferences store + Rust readers
**Files:** `src-tauri/Cargo.toml` (+`tauri-plugin-store`, `tauri-plugin-autostart`),
`src-tauri/src/settings.rs` (new), `src-tauri/src/lib.rs`, capabilities,
`apps/desktop/package.json` (+`@tauri-apps/plugin-store`, `-autostart`).
- Define `Settings { hotkey, launch_on_startup, save_dir, tray_closes_to_tray }`
  with defaults; load/save helpers; unit-test default + (de)serialization.
- Register store + autostart plugins.
- **Verify:** `settings.rs` unit tests pass; store file created on first run.

### W4: Settings window (rebindable hotkey + prefs UI)
**Files:** `apps/desktop/settings.html` (new), `apps/desktop/src/settings/*`
(new: `settings.tsx`, `HotkeyRecorder.tsx`, `settings.css`),
`vite.config.ts` (add `settings` input), `src-tauri/src/lib.rs`
(open-settings command/tray item), capabilities.
- UI matches editor visual language (reuse tokens/colors, no inline CSS).
- Hotkey recorder: capture keydown combo, validate (must have modifier + key),
  show conflict/error, Save → persist + invoke `set_hotkey`.
- Toggles/fields for startup, save folder (native dialog picker), tray behavior.
- **Verify:** unit-test hotkey combo formatting/validation; manual — change
  hotkey, close settings, new hotkey fires; toggles persist across restart.

### W5: Wire prefs into behavior
**Files:** `src-tauri/src/hotkey.rs`, `src-tauri/src/lib.rs`,
`src-tauri/src/commands.rs`, `apps/desktop/src/desktopBridge.ts`.
- Startup hotkey = stored value (fallback to platform default).
- `set_hotkey` command: unregister old, register new, persist.
- Close behavior honors `tray_closes_to_tray`.
- Save flow (U7) defaults to `save_dir` when set.
- Autostart reflects `launch_on_startup` on change.
- **Verify:** manual matrix — restart uses saved hotkey; rebinding live; close
  hides vs quits per pref; saved file lands in chosen folder.

---

## Definition of Done
- Overlay: instant, no flash/flicker, steady dim, works on multiple monitors,
  Escape/blur cancels, repeat captures smooth.
- Exactly one (custom) titlebar; window drag + min/close work; editor visuals
  unchanged; no edits to `packages/editor`.
- Settings window: hotkey rebinding persists and re-registers live; startup,
  save folder, tray behavior persist across restarts.
- All existing tests pass; new pure-logic tests (coord mapping, settings
  serialize, hotkey validation) added and green.
- No new inline CSS; exhaustive switches where unions are introduced.

## Risks
- macOS transparent-window quirks: mitigate by dropping `fullscreen`, using
  positioned borderless windows, pre-warm hidden.
- Multi-monitor coord mapping errors: covered by per-monitor scale-factor test +
  manual secondary-display check.
- Autostart/store plugin capability wiring: validate permissions early (W3).
