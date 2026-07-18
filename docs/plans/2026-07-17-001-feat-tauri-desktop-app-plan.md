---
title: "feat: ScreenXShot desktop app (Tauri v2, macOS + Windows)"
date: 2026-07-17
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_type: feat
depth: deep
---

# feat: ScreenXShot desktop app (Tauri v2, macOS + Windows)

## Summary

Ship a native desktop build of ScreenXShot using **Tauri v2** (Rust backend +
the existing React/Vite editor UI, unchanged). The app lives tray-resident; a
global hotkey opens a transparent region-select overlay; the selected region is
captured natively (`xcap`), kept in memory, and handed to the existing
`editor.fromSrc()` — the user annotates with the current toolset and copies or
saves. The app ships **100% free**, but is architected with a single
entitlement checkpoint (`pro: true` today) so a paywall can be added later
without rework.

**Product Contract preservation:** Product Contract unchanged (this is the
first plan for the desktop app; scope defined via scoping synthesis).

---

## Problem Frame

The web app (`screenxshot.com`) requires the user to already have a screenshot
on the clipboard or a file, then manually paste/drop it. There is no
capture step. Power users of tools like CleanShot X / Shottr expect a global
hotkey → drag-region → instant editor loop. That native capture loop cannot
exist in a browser tab.

**Goal:** deliver that capture→edit loop as a native desktop app while reusing
the existing editor verbatim (one editor codebase), staying fast and light, and
never uploading the user's screenshot.

**Constraints (from `GOALS.md` and `AGENT.md`):**
- Fully client-side / local — the screenshot never leaves the device.
- One editor codebase shared between web and desktop.
- Fast capture→edit loop (tray-resident, in-memory bitmap, pre-warmed overlay).
- Chosen stack is Tauri (not Electron, not egui) — reuse the web UI.

---

## Scope Boundaries

### In scope
- Monorepo restructure: `apps/web`, `apps/desktop`, `packages/editor`.
- Tauri v2 shell loading the existing editor UI for macOS + Windows.
- Global hotkey (default ⇧⌘2 / Ctrl+Shift+2) → region-select overlay.
- Native screen capture (`xcap`) of the selected region, kept in memory.
- Bitmap handed to editor via IPC (raw bytes) → `editor.fromSrc()`.
- Tray icon with show/hide + quit; app resident in tray.
- Native clipboard copy path for desktop (`tauri-plugin-clipboard-manager`).
- Entitlement seam: one `useEntitlements()` checkpoint returning `pro: true`.
- Bundle config for `.dmg` / `.msi` + updater config wiring (keys, endpoint
  placeholders) — **without** executing signing/notarization.

### Deferred to Follow-Up Work
- Actual payment/licensing provider integration (Lemon Squeezy / Paddle /
  Stripe) — only the seam is built now.
- Code-signing + notarization execution (Apple Developer + Windows cert).
- Auto-update server (endpoint + signed release hosting).
- Extra premium features (OCR, scrolling capture, video/GIF, cloud share).

### Outside this product's identity
- Uploading screenshots to any server.
- Rewriting the canvas drawing math in Rust.
- Mobile (iOS/Android). Linux is best-effort notes only, not a shipped target.

---

## Key Technical Decisions

### KTD-1: Monorepo with a shared `packages/editor`
The editor engine (`engine.js`, `store.js`, `data.js`, `instance.js`), styles,
and React components move to `packages/editor`. Both `apps/web` and
`apps/desktop` import from it. This enforces the "one editor codebase"
principle structurally rather than by convention.
- **Trade-off:** upfront churn to import paths + two Vite configs + Vercel root
  dir change, in exchange for guaranteed parity and no code duplication.
- **Alternative rejected:** same-repo `src-tauri/` next to current `src/` —
  simpler now, but the desktop app would import via `../src` relative paths,
  blurring the boundary and making a future third consumer harder.

### KTD-2: Native capture in Rust (`xcap`), overlay = transparent Tauri window
Region selection is a dedicated transparent, fullscreen, always-on-top Tauri
window that reports the selected rectangle back to Rust. Rust captures the
region via `xcap` and holds the RGBA bitmap in memory.
- **Trade-off:** we own the overlay UX (drag rectangle, dimming, escape) and
  per-monitor DPI math, versus getting it "for free" — but no capture plugin
  gives us the in-memory, no-disk loop `GOALS.md` requires.

### KTD-3: Bitmap crosses IPC as raw bytes, not a temp file
Rust encodes the captured region to PNG in memory and returns it via a command
using `tauri::ipc::Response` (raw body, no JSON base64 bloat). The frontend
wraps it into a Blob/object URL and calls `editor.fromSrc()`.
- **Trade-off:** slightly more frontend glue than an asset-protocol temp file,
  but zero disk round-trip and nothing to clean up — matches the "instant" goal.

### KTD-4: Entitlement seam returns `pro: true` (no paywall yet)
A single module (`packages/editor` or `apps/desktop`) exposes
`getEntitlements(): { tier: 'free' | 'pro' }`, hardwired to `pro`. All future
gated features route through it. No network, no license file today.
- **Trade-off:** one tiny indirection now to avoid scattered `if (paid)` later.
  Consistent with "build free first, bolt on the wall later."

### KTD-5: Thin `main.rs`, all logic in `lib.rs`
Per Tauri v2 mobile-compatibility rule, `src-tauri/src/main.rs` only calls
`app_lib::run()`; commands, state, tray, and builder live in `lib.rs`.

### KTD-6: Rust error handling via `thiserror` + `Result<T, AppError>`
All commands return `Result<T, AppError>` where `AppError` implements
`serde::Serialize`. No `unwrap()`/`expect()` outside tests (rust-best-practices).
Owned types (`String`, `Vec<u8>`) across the IPC boundary, never `&str`.

---

## High-Level Technical Design

### Architecture (layered, dependency direction inward)

```
apps/desktop (Tauri shell)
        │  loads frontendDist =
        ▼
packages/editor  ◄────────────  apps/web (Vite web build)
 (React UI + canvas engine + store + styles + entitlements)
        ▲
        │ IPC (invoke / events / raw Response)
        │
src-tauri (Rust)
 ├─ lib.rs          builder, state, generate_handler!, tray, setup
 ├─ hotkey.rs       global-shortcut register → emit "capture:begin"
 ├─ overlay.rs      create/destroy transparent region-select window
 ├─ capture.rs      xcap region grab → PNG bytes (in memory)
 ├─ commands.rs     #[tauri::command] surface
 └─ error.rs        AppError (thiserror + Serialize)
```

Dependency rule: the Rust capture/overlay/hotkey modules never depend on the
editor UI. The editor UI never depends on Tauri APIs directly — a thin
`apps/desktop` adapter (`desktopBridge.ts`) is the only place that calls
`@tauri-apps/api`. On web, that adapter is absent and the editor behaves as it
does today. This keeps `packages/editor` platform-agnostic.

### Capture → edit sequence

```
User presses ⇧⌘2
  → global-shortcut handler (Rust) emits "capture:begin"
  → overlay.rs shows transparent fullscreen window(s), pre-warmed
  → user drags rectangle; overlay JS sends {x,y,w,h,monitor} via invoke
  → commands::capture_region(rect) → capture.rs (xcap grab region)
  → returns PNG bytes as tauri::ipc::Response (raw)
  → overlay closes; main window .show() + .set_focus()
  → main window listens "capture:ready", or receives bytes from the
    invoke result, builds a Blob URL, calls editor.fromSrc(url)
  → editor loads image; toolbox ready → user annotates → copy/save
```

### Tray + window lifecycle state

```
[Hidden/Resident] --hotkey/tray click--> [Overlay active]
[Overlay active] --drag+release--> [Capturing] --> [Editor visible]
[Editor visible] --close (X)--> [Hidden/Resident]  (do NOT quit)
[Any] --tray Quit--> [Exit]
```
Closing the main window hides it (stays in tray) rather than quitting, so the
next capture is instant. `Quit` from the tray menu is the only exit.

---

## Output Structure

```
screenxshot/
├── apps/
│   ├── web/                    # current web app moves here
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   ├── package.json
│   │   └── src/                # main.jsx, router.jsx, routes/, components/, hooks/
│   └── desktop/
│       ├── index.html          # Tauri entry (loads editor mount)
│       ├── vite.config.ts
│       ├── package.json
│       ├── src/                # desktop-only React entry + desktopBridge.ts + overlay UI
│       │   ├── main.tsx
│       │   ├── desktopBridge.ts
│       │   └── overlay/        # region-select overlay UI (separate window)
│       └── src-tauri/
│           ├── src/
│           │   ├── main.rs
│           │   ├── lib.rs
│           │   ├── commands.rs
│           │   ├── capture.rs
│           │   ├── overlay.rs
│           │   ├── hotkey.rs
│           │   └── error.rs
│           ├── capabilities/default.json
│           ├── icons/
│           ├── tauri.conf.json
│           ├── Cargo.toml
│           └── build.rs
├── packages/
│   └── editor/                 # shared: engine.js, store.js, data.js,
│       │                       #         instance.js, styles.css, components/,
│       │                       #         hooks/, entitlements.ts
│       ├── package.json
│       └── src/
├── package.json                # workspaces root
└── docs/plans/
```

The per-unit **Files** lists remain authoritative; this tree shows shape.

---

## Implementation Units

### U1. Monorepo restructure — extract `packages/editor`, move web to `apps/web`

**Goal:** Convert the flat repo into an npm-workspaces monorepo with a shared
editor package, with the web app building and deploying identically.

**Dependencies:** none (must be first).

**Files:**
- `package.json` (root) — add `"workspaces": ["apps/*", "packages/*"]`, `"private": true`.
- `packages/editor/package.json` — name `@screenxshot/editor`, `"type": "module"`, exports map for `engine`, `store`, `data`, `instance`, `styles.css`, `components/*`, `entitlements`.
- Move `src/editor/*`, `src/styles.css`, `src/components/*`, `src/hooks/*` → `packages/editor/src/`.
- Move `index.html`, `vite.config.js`, `src/main.jsx`, `src/router.jsx`, `src/routes/*` → `apps/web/`.
- `apps/web/package.json` — depends on `@screenxshot/editor`, keeps `dev`/`build`/`preview` scripts.
- Update all imports in web app + editor package to package-relative paths.
- `.gitignore` — add `src-tauri/target`, `apps/desktop/dist`.

**Approach:** Mechanical move. Keep the editor engine as `.js` (do not rewrite
to TS in this unit — parity risk). `packages/editor` is consumed as source by
Vite (no separate build step); rely on Vite to transpile JSX from the package.
Configure `apps/web/vite.config.js` `resolve`/`optimizeDeps` if needed so the
workspace package's JSX is processed.

**Patterns to follow:** existing `src/editor/instance.js` singleton pattern and
`store.js` export shape stay identical — only their location changes.

**Execution note:** This is a mechanical refactor; prefer smoke verification
(web app builds + runs + visually matches) over new unit tests.

**Test scenarios:**
- Covers parity: `apps/web` `npm run build` produces a working `dist/` and
  `npm run dev` serves the editor with the demo template, drag/drop, all tools,
  copy, and save — visually identical to pre-move.
- Import resolution: no unresolved `@screenxshot/editor` specifiers at build.
- Test expectation: no new unit tests — pure structural move verified by build + manual parity.

**Verification:** `apps/web` builds and runs identically to current `main`;
Vercel root directory updated to `apps/web` (note in Operational section).

---

### U2. Scaffold Tauri v2 desktop shell loading the editor

**Goal:** A `apps/desktop` Tauri app that opens a window rendering the existing
editor UI (no capture yet), in dev and as a build.

**Dependencies:** U1.

**Files:**
- `apps/desktop/package.json` — `@tauri-apps/api` ^2, `@tauri-apps/cli` ^2, `@screenxshot/editor`, Vite + React.
- `apps/desktop/vite.config.ts`, `apps/desktop/index.html`, `apps/desktop/src/main.tsx` — mount the editor `Studio` component only (no landing page).
- `apps/desktop/src-tauri/Cargo.toml` — `[lib] name = "app_lib"`, `crate-type = ["staticlib","cdylib","rlib"]`; deps `tauri` v2, `serde`, `serde_json`, `thiserror`.
- `apps/desktop/src-tauri/src/main.rs` — thin passthrough to `app_lib::run()`.
- `apps/desktop/src-tauri/src/lib.rs` — `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`, builder with `generate_handler![]`.
- `apps/desktop/src-tauri/src/error.rs` — `AppError` (thiserror) + `Serialize`.
- `apps/desktop/src-tauri/tauri.conf.json` — `build.devUrl` = desktop Vite port, `frontendDist` = `../dist`, `beforeDevCommand`/`beforeBuildCommand`.
- `apps/desktop/src-tauri/capabilities/default.json` — `core:default`, `core:window:default`, `core:event:default`.
- `apps/desktop/src-tauri/build.rs`, `icons/`.

**Approach:** Use `create-tauri-app` layout but wire the frontend to the shared
editor. The desktop entry renders `Studio` (the editor) without the marketing
Header/Hero/Footer. Confirm the demo template still loads inside the webview.

**Visual parity requirement:** the editor itself must look pixel-identical to
the web app — it imports the same `packages/editor` `styles.css`, components,
and canvas engine (no forked CSS, no restyle). Reuse the existing
`.studio-area` / `.window` / `.studio` markup and classes so the mac-window
frame (traffic-light dots, address pill), Dock, Panel, backdrops, and canvas
render exactly as on the web. The **only** intended visual difference is the
absence of the marketing page chrome (Header, Hero, Caps, Footer, scroll-reveal,
parallax). When `Studio` is the whole window rather than a section in
`HomePage.jsx`, adjust only the surrounding wrapper (page padding, centering,
`.sideshapes` background) so the editor sits correctly — never the editor's own
styles.

**Patterns to follow:** tauri-v2 skill Quick Start (thin `main.rs`, logic in
`lib.rs`, commands in `generate_handler!`, `AppError` Serialize pattern).

**Execution note:** Config/scaffolding heavy; verify via `npx tauri info` and a
runtime smoke launch rather than unit tests.

**Test scenarios:**
- Launch smoke: `npm run tauri dev` opens a window showing the editor with no
  white screen; DevTools console has no unresolved-module errors.
- Visual parity: the editor (mac-window frame, dots, address pill, Dock, Panel,
  default backdrop, demo template) renders identically to the web app's `Studio`
  section side-by-side; the only difference is the missing marketing chrome.
- Build smoke: `npm run tauri build` produces a bundle for the host platform.
- Test expectation: no Rust unit tests yet (no domain logic); `error.rs`
  `AppError` covered when first command lands in U3.

**Verification:** desktop window renders the editor and the demo template
visually identical to the web app's Studio (only page chrome differs); paste and
file-open still work inside the webview.

---

### U3. Native screen capture in Rust (`xcap`) with in-memory PNG

**Goal:** A Rust command that captures a given screen rectangle and returns PNG
bytes without touching disk.

**Dependencies:** U2.

**Files:**
- `apps/desktop/src-tauri/Cargo.toml` — add `xcap`, `image` (PNG encode).
- `apps/desktop/src-tauri/src/capture.rs` — `capture_region(rect, monitor) -> Result<Vec<u8>, AppError>` returning PNG bytes; monitor/DPI-aware.
- `apps/desktop/src-tauri/src/commands.rs` — `#[tauri::command] async fn capture_region(...) -> Result<tauri::ipc::Response, AppError>` (raw body).
- `apps/desktop/src-tauri/src/error.rs` — add `Capture(String)`, `Encode(String)` variants.
- Register `capture_region` in `generate_handler!` in `lib.rs`.

**Approach:** Use `xcap::Monitor` to enumerate monitors, pick the one containing
the rect, capture, crop to the rect, encode PNG in memory via `image`. Return
`tauri::ipc::Response::new(bytes)` (KTD-3). Use owned types; map all errors into
`AppError` with `?` (no `unwrap`).

**Patterns to follow:** tauri-v2 IPC "Command with Raw Binary Data"; rust-best-
practices error handling (`thiserror`, `?`, no panics).

**Test scenarios:**
- Happy path: given a valid rect within a monitor, returns non-empty bytes whose
  header is a valid PNG signature; decoded dimensions equal the requested rect
  (allowing DPI scale factor).
- Edge: rect clamped to monitor bounds when it exceeds the screen; zero-area
  rect returns `AppError::Capture`, not a panic.
- Error path: no monitor found for the rect coordinates → `AppError::Capture`.
- Integration: invoking `capture_region` from the webview returns an
  `ArrayBuffer` the frontend can turn into a valid image.

**Verification:** a temporary dev button that invokes `capture_region` on the
full primary monitor loads the result into `editor.fromSrc()` and displays it.

---

### U4. Region-select overlay window

**Goal:** A transparent, fullscreen, always-on-top overlay to drag-select a
region, reporting the rectangle (+ monitor) back to Rust.

**Dependencies:** U2 (window mgmt), integrates with U3.

**Files:**
- `apps/desktop/src-tauri/src/overlay.rs` — `show_overlay(app)` builds a transparent, decorationless, fullscreen, always-on-top `WebviewWindow` labeled `overlay` (one per monitor); `hide_overlay(app)` closes them.
- `apps/desktop/src/overlay/overlay.html` + `overlay.tsx` + `overlay.css` — dim layer, drag-rectangle interaction, Escape to cancel; on release `invoke('finish_capture', {rect, monitor})`.
- `apps/desktop/src-tauri/src/commands.rs` — `show_overlay`, `finish_capture`, `cancel_overlay` commands.
- `apps/desktop/src-tauri/tauri.conf.json` — add `overlay` window def (transparent, visible:false, skipTaskbar, alwaysOnTop) or build dynamically in `overlay.rs`.
- `apps/desktop/src-tauri/capabilities/default.json` — window create/close/set-fullscreen perms; target `overlay` window.

**Approach:** Prefer building the overlay window dynamically in Rust so it can be
pre-warmed (created hidden at startup, shown on demand) for instant feel. Use
per-monitor windows to handle multi-display. `finish_capture` calls
`capture.rs::capture_region`, closes overlays, shows main window, and delivers
bytes to the editor (U5).

**Patterns to follow:** tauri-v2 advanced-runtime (window creation via
`WebviewWindowBuilder`), `get_webview_window("main")` for show/focus.

**Test scenarios:**
- Happy path: overlay appears on hotkey, drag draws a rectangle, release reports
  a rect matching the dragged area in physical pixels.
- Multi-monitor: dragging on a secondary display reports the correct monitor id
  and monitor-local coordinates.
- Cancel: Escape closes the overlay and returns to resident state with no
  capture and no error dialog.
- Edge: click without drag (zero/near-zero area) cancels rather than capturing.
- Test expectation: overlay UI interaction verified manually + a unit test on
  the rect-normalization helper (min/abs of start/end points).

**Verification:** hotkey (temporary trigger acceptable until U6) shows overlay;
selecting a region produces a captured image in the editor.

---

### U5. Deliver captured bitmap to the editor (desktop bridge)

**Goal:** Wire the captured PNG bytes into the existing `editor.fromSrc()` and
reveal the editor, keeping `packages/editor` platform-agnostic.

**Dependencies:** U3, U4.

**Files:**
- `apps/desktop/src/desktopBridge.ts` — the only module importing `@tauri-apps/api`; listens for `capture:ready` (or receives bytes from `finish_capture`), builds a `Blob`/object URL, calls `editor.fromSrc(url)`, revokes the URL after load.
- `apps/desktop/src/main.tsx` — initialize `desktopBridge` on mount.
- `packages/editor/src/instance.js` — unchanged; `fromSrc` reused as-is.

**Approach:** Rust closes overlays and shows main window; frontend bridge turns
raw bytes into an image and loads it. No editor code changes (proves the "one
editor codebase" invariant). Object URLs are revoked after `onload`.

**Patterns to follow:** existing `editor.fromSrc(src)` (engine.js:838).

**Test scenarios:**
- Happy path: after a region capture, the editor shows the captured image and
  the toolbox is active; copy/save produce the annotated PNG.
- Integration: bytes → Blob → object URL → `fromSrc` → `loadImage` path renders
  with correct dimensions (respecting the 2200px cap in `loadImage`).
- Cleanup: object URL is revoked (no leak) after the image loads.
- Test expectation: bridge byte→URL helper unit-tested; end-to-end verified manually.

**Verification:** full capture→edit works without any change to
`packages/editor`; the loaded-image editing experience (frame, tools, backdrops,
copy/save) is visually identical to editing the same image in the web app.

---

### U6. Global hotkey + tray (resident app, instant open)

**Goal:** Register a global shortcut that triggers the capture flow, and a tray
icon to show/hide/quit; closing the main window hides instead of quitting.

**Dependencies:** U4, U5.

**Files:**
- `apps/desktop/src-tauri/Cargo.toml` — add `tauri-plugin-global-shortcut` v2.
- `apps/desktop/src-tauri/src/hotkey.rs` — register default (`⇧⌘2` mac / `Ctrl+Shift+2` win); handler triggers `overlay::show_overlay`.
- `apps/desktop/src-tauri/src/lib.rs` — `setup` hook: register plugin, build tray (`TrayIconBuilder` with show/quit menu), pre-warm overlay window; handle main-window close → hide.
- `apps/desktop/src-tauri/capabilities/default.json` — `global-shortcut:default` (+ register/unregister), window hide/show perms.
- `apps/desktop/src-tauri/tauri.conf.json` — tray icon asset.

**Approach:** Follow tauri-v2 tray pattern (`TrayIconBuilder`, `get_webview_window`).
Intercept the main window `CloseRequested` event to hide + prevent exit; only
tray `Quit` exits. Pre-warm the overlay at startup for instant feel.

**Patterns to follow:** advanced-runtime-reference tray section; capabilities
global-shortcut section.

**Test scenarios:**
- Happy path: pressing the hotkey from any app shows the overlay; completing a
  capture opens the editor focused.
- Resident: closing the editor window hides it (process stays); next hotkey is
  fast (overlay pre-warmed).
- Tray: tray click toggles main window; tray Quit exits the process.
- Edge: hotkey registration failure (already taken) surfaces a non-fatal
  notification, app still runs.
- Test expectation: hotkey/tray verified manually (OS-level); unit-test the
  default-shortcut string selection per-platform (`#[cfg(target_os)]`).

**Verification:** end-to-end target flow from `GOALS.md` works: hotkey → drag →
capture → editor → copy/save, with the app resident in the tray.

---

### U7. Native clipboard copy + save path for desktop

**Goal:** Ensure Copy and Save PNG work in the desktop webview (web clipboard
APIs can be restricted), using native plugins where needed.

**Dependencies:** U5.

**Files:**
- `apps/desktop/src-tauri/Cargo.toml` — add `tauri-plugin-clipboard-manager` v2 (and `tauri-plugin-dialog` v2 for save-as if the web download path is unavailable in the webview).
- `apps/desktop/src/desktopBridge.ts` — feature-detect; if `navigator.clipboard.write` fails, fall back to the clipboard plugin; wire a native save dialog for Save PNG when the anchor-download path is unavailable.
- `apps/desktop/src-tauri/src/commands.rs` — `copy_png(bytes)` / `save_png(bytes)` commands if needed.
- `apps/desktop/src-tauri/capabilities/default.json` — `clipboard-manager:allow-write`, `dialog:allow-save`.

**Approach:** Keep `packages/editor` copy/save (engine.js `copy()`/`save()`)
unchanged as the default; the desktop bridge only supplies fallbacks when the
webview blocks the web APIs. Detect at runtime, do not fork the editor.

**Patterns to follow:** engine.js `copy()` (line 891) and `save()` (879) remain
the primary path; capabilities clipboard/dialog sections.

**Test scenarios:**
- Happy path (web APIs available): Copy writes PNG to the OS clipboard; Save
  downloads/saves a PNG.
- Fallback path: when `navigator.clipboard.write` throws, the native clipboard
  plugin writes the same PNG bytes; verify paste into another app yields the image.
- Save-as: native dialog writes a valid PNG to the chosen path.
- Test expectation: fallback selection logic unit-tested; clipboard/dialog
  verified manually.

**Verification:** Copy and Save PNG both work in the packaged desktop app.

---

### U8. Entitlement seam (`pro: true`, no paywall)

**Goal:** Introduce a single entitlement checkpoint so future gating is a
one-line change, with zero behavior change today.

**Dependencies:** U1.

**Files:**
- `packages/editor/src/entitlements.ts` — `export type Tier = 'free' | 'pro'; export function getEntitlements(): { tier: Tier } { return { tier: 'pro' }; }` plus `isPro()` helper.
- `packages/editor/package.json` — add `entitlements` to exports.
- (No call sites gated yet — the seam exists for future features.)

**Approach:** Minimal, no network, no license file. Documented as the single
place to later read a real license. Keep it in `packages/editor` so both web and
desktop share one definition.

**Patterns to follow:** simplicity-first — one function, one type; no speculative
provider abstraction.

**Test scenarios:**
- `getEntitlements().tier === 'pro'` and `isPro() === true`.
- Type check: `Tier` union is exhaustive where consumed (future switch uses a
  `never` default per workspace rule).
- Test expectation: one trivial unit test asserting the default tier.

**Verification:** importable from both apps; no UI/behavior change.

---

### U9. Bundle + updater config (no signing execution)

**Goal:** Configure `.dmg`/`.msi` bundling and updater plumbing (keys/endpoint
placeholders) so a later signed release is a config-fill, not a rebuild.

**Dependencies:** U6.

**Files:**
- `apps/desktop/src-tauri/tauri.conf.json` — `bundle` (identifier `com.screenxshot.app`, targets, icons, category `Utility`); `plugins.updater` block with `endpoints` placeholder + `pubkey` placeholder + `dialog: true`.
- `apps/desktop/src-tauri/Cargo.toml` — add `tauri-plugin-updater` v2.
- `apps/desktop/src-tauri/capabilities/default.json` — `updater:default`.
- `docs/` note — signing/notarization + update-server steps as a checklist (deferred execution).

**Approach:** Wire config and the `check_for_updates` command shape, but do NOT
generate/commit signing keys or run notarization (deferred). Endpoints/pubkey
are documented placeholders; updater `active` may be `false` until a server exists.

**Patterns to follow:** updater-distribution-reference (config shape, key-gen
command, server JSON format) — referenced, not executed.

**Test scenarios:**
- Build produces `.dmg` (macOS) / `.msi` (Windows) locally (unsigned dev build).
- Config validates against the Tauri schema (no unknown keys).
- Test expectation: none — packaging/config; verified by a local unsigned build.

**Verification:** local unsigned installers build; updater config present and
schema-valid; signing steps documented as the remaining gated work.

---

## Risks & Dependencies

### Prerequisites (developer machine)
- Rust toolchain + `cargo`, Tauri v2 CLI (`npm i -D @tauri-apps/cli@^2`).
- Verify with `npx tauri info` (tauri-v2 setup checklist).
- macOS: Xcode CLT for building; Windows: MSVC build tools + WebView2.

### Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| macOS Screen Recording permission prompt | First capture blocked until granted | Detect empty/black capture, guide user to System Settings; unavoidable per `GOALS.md` |
| Monorepo move breaks Vercel build | Web deploy fails | Set Vercel root dir to `apps/web`; verify preview deploy before merge (U1) |
| Multi-monitor / HiDPI coordinate math | Wrong region captured | Per-monitor overlay windows + physical-pixel math; test on secondary display (U4) |
| `xcap` platform differences (Wayland) | Capture fails on some Linux | Linux is best-effort only; scope to macOS + Windows |
| Webview clipboard restrictions | Copy fails silently | Native clipboard fallback (U7) |
| Unsigned build warnings | Users see Gatekeeper/SmartScreen | Signing is deferred but required before public release (documented) |

### External contract surfaces (why this is a Deep plan)
- Vercel build config (root directory) — external consumer of repo layout.
- `tauri.conf.json` bundle identifier + updater endpoints — external release infra.
- Global shortcut registration — OS-level contract.

---

## Operational / Rollout Notes
- **Vercel:** after U1, change project root directory to `apps/web`; confirm a
  preview deploy renders and the domain still serves. This is the one change
  that can break production if missed.
- **Release gating (deferred):** before any public desktop release — generate
  updater keys (`cargo tauri signer generate`), set `TAURI_SIGNING_PRIVATE_KEY`
  in CI, Apple Developer signing + notarization, Windows code-sign cert, stand
  up an HTTPS update endpoint returning the documented JSON.
- **Premium (deferred):** flip `entitlements.ts` to read a real license and gate
  chosen native features; pick provider (Lemon Squeezy / Paddle / Stripe).

---

## Verification Contract
- `apps/web` builds and runs with full editor parity after the monorepo move.
- `npm run tauri dev` launches the editor with no white screen / console errors.
- `capture_region` returns valid in-memory PNG bytes for a given rect.
- Region overlay reports correct rects on primary and secondary monitors.
- End-to-end: hotkey → drag → capture → editor → Copy + Save PNG all succeed.
- App is tray-resident; closing the window hides it; tray Quit exits.
- `getEntitlements().tier === 'pro'`; no behavior change from the seam.
- Local unsigned `.dmg` / `.msi` build succeeds; updater config schema-valid.
- Rust: `cargo clippy --all-targets --all-features -- -D warnings` clean; no
  `unwrap()`/`expect()` outside tests; all commands in `generate_handler!`.

## Definition of Done
- All units U1–U9 complete and their verification met.
- `packages/editor` is unchanged in behavior and imported by both apps (no
  editor logic duplicated or forked).
- The editor renders visually identical to the web app's `Studio` in the desktop
  window; the only intended difference is the absent marketing page chrome.
- The `GOALS.md` target flow works on macOS and Windows (dev/unsigned builds).
- Signing, auto-update server, and payment integration remain explicitly
  deferred with a documented checklist.

---

## Open Questions (deferred to implementation)
- Exact `xcap` API surface for region vs full-monitor capture + crop (resolve
  when U3 lands against the installed crate version).
- Whether to pass capture bytes as the `finish_capture` invoke return value or
  via a `capture:ready` event (both viable; pick based on overlay/main window
  timing during U4/U5).
- Default hotkey final choice (⇧⌘2 may conflict with macOS screenshot binding) —
  confirm a non-conflicting default during U6.
- Whether the desktop entry reuses `Studio` directly or a trimmed editor-only
  wrapper (decide in U2 based on what `Studio` pulls in).

---

## Sources & Research
- `GOALS.md` — desktop vision, target flow, chosen stack, milestones, caveats.
- `AGENT.md` — architecture, editor engine pieces, parity checklist, principles.
- `packages/editor` source (was `src/editor/*`) — `fromSrc`, `loadImage`,
  `copy`, `save`, store shape.
- tauri-v2 skill + references (IPC raw binary, capabilities, tray, updater).
- rust-best-practices skill — error handling, owned types, clippy, no panics.
- software-architect skill — layered dependency direction, ADR-style KTDs,
  reversibility (monorepo + entitlement seam as low-cost reversible decisions).
