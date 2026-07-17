# ScreenXShot — Project Goals

## What ScreenXShot is
A privacy-first, client-side **screenshot beautifier and annotator**. Drop in a
screenshot → set it on a beautiful backdrop, wrap it in a clean macOS-style
window frame, mark it up → copy or save as PNG. Nothing is uploaded; everything
runs locally.

- **Product name:** ScreenXShot
- **Repo / codename:** screenxshot
- **Live web app:** https://screenxshot.com (custom domain)

---

## Current state (done)
- [x] Migrated from a single `prism.html` to a **React + Vite + TanStack**
      (Router + Store) app, with 100% UI and functionality parity.
- [x] Canvas engine, wallpapers/gradients/solids data, and CSS ported faithfully.
- [x] Deployed on **Vercel** (Vite preset) from `main`.
- [x] **SEO ready:** meta tags, Open Graph + Twitter cards, JSON-LD, favicon,
      `robots.txt`, `sitemap.xml`, generated `og.png`, `<noscript>` fallback.

## Next up (web)
- [x] Bought custom domain `screenxshot.com` (connect it in Vercel + DNS).
- [x] Updated canonical URL, OG tags, sitemap, robots, titlebar to screenxshot.com.
- [ ] After domain switch: update canonical URL, OG tags, and sitemap to the
      new domain.
- [ ] Submit the site to **Google Search Console** + request indexing.

---

## The big goal: a native desktop app (macOS + Windows)

### Vision
A menu-bar/tray utility that lives in the background. Press a **global
shortcut** → a **region-select overlay** appears → drag to choose the area →
it's captured → the **ScreenXShot editor opens with that screenshot loaded and the
toolbox ready** to annotate → copy or save. Fast, instant-feeling, like
CleanShot X / Shottr.

### Target flow
```
Global hotkey (e.g. ⇧⌘2)
   → transparent fullscreen region-select overlay (drag a rectangle)
   → native screen capture of that region (kept in memory)
   → ScreenXShot window is revealed (already resident in tray) with the image loaded
   → user annotates with existing tools → Copy / Save PNG
```

### Chosen stack: **Tauri** (Rust backend + our existing web UI)
Decision rationale (from our discussion):
- **Tauri *is* Rust** — its backend is native Rust, so we get native speed for
  the parts that matter for free.
- **Reuses our existing editor UI verbatim** → 100% visual parity, ~0 rewrite.
  The captured bitmap is handed to the current `editor.fromSrc()`.
- Far lighter than Electron (~3–10 MB bundle, ~80–150 MB RAM).
- **egui was considered and rejected** for now: it would mean rewriting the
  editor in Rust to reach only ~92% visual parity, plus a permanent
  two-codebase maintenance tax, for RAM savings (~50–80 MB) users won't feel.
  Revisit egui only if a tiny binary / minimal RAM becomes a hard requirement.

### Where speed actually comes from (not the hotkey language)
- Keep the app **resident in the tray** so opening = revealing a window, not a
  cold launch.
- **Native capture** (`xcap` crate), bitmap kept in memory — no disk round-trip.
- **Pre-warmed native overlay** window for region selection.
- The hotkey keypress dispatch is OS-level and identical across toolkits — not a
  bottleneck.

### Native pieces to build / crates
- Global shortcut → `global-hotkey`
- Screen capture → `xcap`
- Region-select overlay → transparent fullscreen Tauri window (drag rectangle)
- Copy image to clipboard → `arboard` (or reuse web clipboard where possible)
- Tray icon + show/hide → `tray-icon` / Tauri APIs
- Frontend editor → **existing React/Vite app, unchanged**

### Desktop milestones
- [ ] Scaffold Tauri shell that loads the existing web build.
- [ ] Register global hotkey; show/hide the main window from the tray.
- [ ] Region-select overlay window (drag to choose area).
- [ ] Native capture → pass bitmap to `editor.fromSrc()`.
- [ ] App resident in tray for instant open.
- [ ] Package installers (.dmg / .msi); code-sign + notarize (macOS Developer
      account, Windows cert) — required to avoid OS warnings.
- [ ] Auto-update.

### Known costs / caveats
- macOS **Screen Recording permission** prompt is unavoidable.
- **Code signing** needed on both platforms (Apple $99/yr; Windows cert) or
  users see Gatekeeper / SmartScreen warnings.

---

## Guiding principles
- Stay **fully client-side / local** — never upload the user's screenshot.
- **One editor codebase** shared between web and desktop (via Tauri).
- Keep it **fast and light**; make the capture→edit loop feel instant.
