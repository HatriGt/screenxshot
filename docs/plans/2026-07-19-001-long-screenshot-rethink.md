# Long-screenshot (scrolling) capture — UX rethink & recommendation

_2026-07-19 · research + written deliverable. **No capture source was modified** —
a concurrent worker is fixing capture regressions. This doc only proposes. Every
current-state claim is grounded in code read on 2026-07-19._

**TL;DR recommendation:** Ship **Approach 2 (continuous capture while the user
scrolls)** as the next iteration. It removes the click-per-frame drudgery, reuses
our existing `stitch.rs` core untouched, needs **no new crate and no synthetic
input**, and works identically on macOS + Windows. Treat full **auto-scroll
(Approach 1) as an opt-in Phase 3 enhancement**, not the baseline — synthetic
scroll is genuinely unreliable cross-platform (permissions, wrong-target,
sticky-header breakage) and should never be the only path.

---

## 1. What exists today (grounded)

Manual multi-shot MVP on `feat/desktop-next`:

- **Enter mode:** overlay toolbar `#scroll` button toggles `longMode`
  (`src/overlay/overlay.ts` 306–315). Next region drag routes to `scroll_start`
  instead of `finish_capture` (`overlay.ts` 123–128).
- **Session state:** `ScrollSession(Mutex<Option<ScrollState>>)` holds the fixed
  `rect`, `monitor_index`, and `Vec<RgbaImage> frames` (`src-tauri/src/scroll.rs`
  33–44).
- **Per-frame loop:** `scroll_start` grabs frame 1 (`commands.rs` 101–124); user
  scrolls manually and clicks **"Capture next"** → `scroll_capture_frame` hides
  the control, grabs the same rect, pushes the frame (`commands.rs` 128–161).
- **Chrome-out:** every grab is preceded by `hide_control` / `hide_capture_chrome`
  + a `wait_for_compositor(Region)` settle (60ms mac / 20ms win) so our own
  windows never land in a frame (`commands.rs` 143–147, 475–493).
- **Finish:** `scroll_finish` → `stitch::stitch_all` → normal `dispatch_capture`
  (`commands.rs` 166–183).
- **Control window:** borderless/transparent/always-on-top, reused, bottom-right
  (`scroll.rs` 55–96); UI is "Capture next / Done / Cancel" + a live count
  (`scroll.html`, `src/scroll/scroll.ts`).

**Stitch core (reusable as-is):** `detect_overlap` slides a 16-row band, scores
mean row-diff + match fraction, picks the largest confident overlap;
`stitch_pair` drops the duplicate band; `stitch_all` folds a stack
(`src-tauri/src/stitch.rs`, 6 passing unit tests). This is the crown jewel — **any
approach below reuses it unchanged.**

**The problem:** one click per frame is clunky and error-prone (user forgets to
scroll, over-scrolls past a full viewport → gap the overlap detector can't
bridge, or under-scrolls → wasted frames).

---

## 2. Approach comparison

| # | Approach | Feasible mac | Feasible win | Quality | Effort | New deps | UX |
|---|---|---|---|---|---|---|---|
| 1 | **Auto-scroll** (app scrolls target, grabs until bottom) | Partial | Partial | Med | **L** | `enigo` (+ perms) | "Magic" when it works; silent-wrong when it doesn't |
| 2 | **Continuous while user scrolls** (auto-grab on interval/scroll, live stitch, Stop) | **Yes** | **Yes** | High | **M** | none | Natural, forgiving, few clicks |
| 3 | **Improved manual** (still discrete, better guidance/preview) | Yes | Yes | High | **S** | none | Better but still per-step |
| 4 | **Hybrid** (2 as default + 1 as opt-in) | Yes | Yes | High | M→L | `enigo` later | Best long-term |

### Approach 1 — Auto-scroll (CleanShot-style "magic")

**How:** synthesize wheel events over the target, grab each settle, detect bottom
when consecutive frames stop changing (reuse `detect_overlap`: overlap ≈ full
frame height ⇒ nothing new scrolled in ⇒ bottom).

**Synthetic scroll feasibility (verified):** the `enigo` crate (Linux/X11, macOS,
Windows) exposes `Mouse::scroll(length, Axis::Vertical)` cross-platform; positive
= down on all platforms. `smooth_scroll` (pixel-precise) is **macOS-only**, behind
the `platform_specific` feature — so smooth pixel scrolling is *not* portable;
Windows/Linux get coarse line-based wheel clicks whose line count depends on OS
settings. `enigo` self-describes as "early alpha, API will change."

**Real risks (why it's not the baseline):**
- **macOS permissions:** synthetic events need Accessibility (AX) permission —
  a second scary system prompt beyond Screen Recording. If denied, auto-scroll
  silently no-ops.
- **Wrong target:** `enigo.scroll` sends to whatever is under the cursor / focused;
  we don't own the target window. We'd have to move the cursor into the rect and
  hope the right scroll container (not a parent/nested one) receives it. Nested
  scroll areas, hover-only scrollbars, and focus-follows-mouse quirks all misfire.
- **Coarse/variable step (Win/Linux):** line-based clicks scroll an OS-configured
  number of lines → unpredictable step; over-scroll past a viewport = gap the
  stitcher can't recover. Needs adaptive step tuning per grab.
- **Bottom detection is heuristic:** "frames stopped changing" also triggers on
  spinners, blank areas, sticky footers, or a stalled load → false stop or
  infinite loop; needs a max-frame safety cap + no-progress counter.
- **Momentum/inertia (macOS):** kinetic scrolling keeps moving after the event;
  grabbing mid-glide smears frames. Must wait for settle, slowing it down.

Verdict: **high effort, medium reliability, worst failure mode (silent wrong
result).** Great as an *optional* accelerator, unacceptable as the only path.

### Approach 2 — Continuous capture while the user scrolls  ✅ recommended

**How:** user scrolls naturally with their own trackpad/wheel; the app grabs the
fixed rect on a cadence, live-stitches into a growing tall preview, user clicks
**Stop**. No synthetic input, no new permission, no target ownership.

- **Feasible both OS:** identical to today's grab path — just triggered by a timer
  instead of a button. Nothing new about capture.
- **Quality:** high. User controls scroll speed; our overlap detector dedupes.
  Live preview lets them see and fix gaps in real time (scroll back up a touch).
- **Effort M:** a capture loop + incremental stitch + a preview surface. The core
  stitching is already built and tested.
- **Fewer clicks:** Start → scroll → Stop. Two clicks total vs N.

### Approach 3 — Improved manual

Keep discrete frames but (a) auto-capture on detected scroll instead of a click,
(b) show the live stitched preview, (c) better hints. This is essentially a subset
of Approach 2 without the timer cadence — most of the work overlaps, so if we're
building the preview + incremental stitch anyway, Approach 2 subsumes it.

### Approach 4 — Hybrid

Ship 2 as default; add 1 later as an explicit "Auto-scroll (beta)" toggle inside
the same session UI, guarded by an AX-permission check on macOS and a max-frame
cap everywhere. Best end state; sequenced below.

---

## 3. Recommended design — Approach 2 in detail

### UX flow (step-by-step)

1. Overlay: user clicks **Long screenshot** (`#scroll`, already exists), drags the
   scroll region. Same entry as today.
2. `scroll_start` grabs frame 1 and shows the control — but the control now reads
   **"Recording… scroll down · Stop"** (relabel `scroll.html`), plus a small live
   thumbnail of the growing tall image.
3. User scrolls the underlying content naturally. The app auto-grabs the rect on a
   cadence and calls the existing stitch incrementally; the thumbnail grows.
4. A subtle **"reached bottom"** hint appears when the last few grabs added no new
   rows (overlap ≈ full frame). User clicks **Stop** (or we auto-stop after N
   no-progress grabs).
5. `scroll_finish` delivers the already-stitched tall image via the normal
   `dispatch_capture` (editor / pin / toast). Unchanged.

### Technical sketch (real files)

- **Session (`scroll.rs`):** keep `ScrollState` but store an incrementally
  stitched `acc: RgbaImage` instead of a raw `Vec` (or keep both — memory vs
  simplicity). Add a `last_progress` counter (grabs since new rows were added) for
  bottom detection.
- **Capture cadence:** two viable triggers, pick one:
  - **Timer (simplest):** a repeating `tauri::async_runtime` task every ~250–400ms
    while the session is "recording", each tick runs the existing
    `hide_control → wait_for_compositor(Region) → capture_region_image_by_index`
    path (`commands.rs` 128–161) and folds the frame via `stitch::stitch_pair`.
  - **Scroll-driven (nicer, more work):** listen for scroll/mouse-wheel and grab
    shortly after movement stops. Cross-platform wheel *listening* is also fiddly;
    the timer is the pragmatic v1. Dedup makes redundant identical grabs cheap
    (overlap == full height ⇒ zero rows appended).
- **Incremental stitch:** reuse `stitch::stitch_pair(&acc, &next)` per grab
  (`stitch.rs` 117) — **no algorithm change**. `detect_overlap` already returns
  the overlap; if it equals `next.height()`, nothing new arrived.
- **Live preview:** emit a downscaled JPEG/PNG of `acc` (or just its height) to the
  control webview via `emit_to(SCROLL_LABEL, …)` — mirrors the existing
  `scroll:progress` event (`scroll.rs` 46–66). Keep it small (throttle, downscale)
  to avoid IPC churn.
- **Control UI (`scroll.html` / `src/scroll/scroll.ts`):** replace "Capture next"
  with an auto-recording indicator + Stop/Cancel; render the thumbnail + a
  "reached bottom?" hint. `Done` → `scroll_finish`, `Cancel` → `scroll_cancel`
  (both already exist).

### Keeping our chrome out of frames

Already solved and reused verbatim: hide the control (`hide_control`) and other
chrome (`hide_capture_chrome`) before each grab, then
`wait_for_compositor(Region)` (`commands.rs` 143–147, 475–493). The control sits
bottom-right on the **primary** monitor (`scroll.rs` 107–123); if the scroll
region overlaps that corner on the same monitor, the pre-grab hide still clears
it. **Caveat:** timer-driven grabs hide/show the control every tick → visible
flicker. Mitigation: move the control **off the captured monitor** or make it
briefly transparent instead of `hide()/show()` per tick (the grab only reads the
user's sub-rect, so a control that's outside that rect need not be hidden at all —
worth exploiting to kill the flicker).

### Detecting "reached the bottom"

`detect_overlap(acc_tail, next) == next.height()` ⇒ the new frame is fully
contained ⇒ no scroll progress. Count consecutive no-progress grabs; after ~3,
show the "bottom" hint and optionally auto-stop. Always enforce a **max-frame /
max-height safety cap** to bound runaway sessions. This heuristic is shared by
Approach 1's stop condition.

### macOS vs Windows differences & risks

- **Compositor settle:** already branched (mac 60ms / win 20ms region;
  `commands.rs` 484–491). Timer period must exceed settle + grab time.
- **DPI / Retina:** rect is stored in **monitor-local physical pixels**
  (`ScrollState.rect`), and frames from the same rect share width, so
  `stitch.rs`'s equal-width invariant holds. Mixing monitors of different scale
  mid-session would break width equality — the session is pinned to one
  `monitor_index`, so this is already safe. Just ensure the preview downscale is
  DPI-aware.
- **No synthetic input needed** ⇒ **no AX permission** ⇒ the biggest cross-platform
  risk of Approach 1 is entirely avoided here.

---

## 4. Edge cases (all approaches)

- **Horizontal scrolling:** `stitch.rs` is vertical-only. Horizontal long-shots
  would need a transposed detector/stitcher. Out of scope for v1 — **vertical
  only**; grey out / document the limitation.
- **Fixed/sticky headers & footers:** these stay pinned while content scrolls, so
  naive vertical stitch **duplicates the header band on every frame** and the
  overlap detector sees a always-matching top band → wrong overlap. CleanShot
  detects and freezes sticky regions. We *could*: (a) detect a stable top/bottom
  band that's identical across many frames (constant rows) and exclude it from the
  overlap search + paint it once at the end; (b) let the user mark header/footer
  height. **Phase-later**; v1 should at least *warn* when a large constant top band
  is detected.
- **Variable scroll speed / over-scroll:** if the user scrolls more than a frame
  height between grabs, overlap → 0 and content is lost with no dedupe. The live
  preview lets them notice a seam and scroll back; a faster timer cadence reduces
  the window. Auto-scroll (Approach 1) must cap its step below one viewport.
- **DPI/Retina:** covered above — physical-pixel rect + single-monitor pin keeps
  widths equal; the only care point is preview downscaling.
- **Momentum scrolling (macOS):** grabbing during inertial glide smears rows;
  prefer grabbing on a short quiet period after movement, or accept the timer's
  dedupe to discard smeared near-duplicates.

---

## 5. Recommendation & phased path

**Single best next step:** implement **Approach 2 (continuous capture while the
user scrolls, timer-driven, live-stitched)**. It's the biggest UX win over today's
click-per-frame flow, reuses `stitch.rs` untouched, adds **no crate and no OS
permission**, and behaves the same on macOS + Windows. Auto-scroll's "magic" isn't
worth its silent-failure risk as a baseline.

**Phase 1 (ship first — reliable win over manual):** timer-driven auto-grab +
incremental `stitch_pair` + Stop/Cancel, relabel the control, add a no-progress
"reached bottom" hint + max-frame cap. Kill the per-tick flicker by keeping the
control off the captured rect/monitor instead of hide/show each grab. _Effort: M.
Files: `scroll.rs` (loop/state), `commands.rs` (record/stop commands reusing the
existing grab path), `scroll.html` + `src/scroll/scroll.ts` (UI)._

**Phase 2 (polish):** live tall-image thumbnail preview in the control; auto-stop
on N no-progress grabs; sticky-header **warning** when a large constant top band is
detected.

**Phase 3 (opt-in "magic"):** add **Approach 1 auto-scroll** behind an explicit
"Auto-scroll (beta)" toggle in the same session UI, using `enigo` for
`Mouse::scroll`. Gate it on an macOS AX-permission check with a clear prompt, cap
the step below one viewport, enforce the max-frame safety cap, and **always keep
Approach 2 available as the fallback** when auto-scroll misfires. Be honest in-UI
that it's best-effort.

**Later / if needed:** sticky-header freeze (not just warn), horizontal long-shots.


---

## 3. Recommended design — continuous capture (Approach 2)

### 3.1 UX flow (step-by-step)

1. Overlay → toggle **Long screenshot**, drag the scroll region (unchanged:
   `overlay.ts` longMode → `scroll_start`).
2. `scroll_start` grabs frame 1 and shows the floating control — now reading
   **"Recording… scroll the page · Stop when done"** with a live thumbnail of the
   growing tall image and a running height/frame count.
3. The user scrolls naturally. A capture loop grabs the fixed rect on a cadence
   and **incrementally stitches** each new frame onto the accumulator; the control's
   preview updates live. Frames that add nothing (full overlap) are dropped.
4. If the user scrolls too fast and a gap appears (no confident overlap), the
   control flashes a subtle **"scroll back up a bit"** hint instead of silently
   producing a broken image.
5. User clicks **Stop** (formerly "Done") → deliver the already-stitched image via
   the normal `dispatch_capture`. **Cancel** discards.

### 3.2 Technical sketch (real files)

- **Session state (`scroll.rs` `ScrollState`):** keep `rect` + `monitor_index`;
  replace `frames: Vec<RgbaImage>` with a single `acc: RgbaImage` (the live
  accumulator) plus a small `tail: RgbaImage` = the last frame (needed so
  `detect_overlap(&tail, &next)` can decide what to append). Incremental stitching
  means we never hold the whole frame stack in memory — better for tall pages.
- **Capture cadence:** a lightweight loop. Simplest portable option: the **frontend
  drives it** — `src/scroll/scroll.ts` calls a new `scroll_tick` command on a
  `setInterval` (~150–250ms) while recording; each tick does today's grab
  (`hide_control` → settle → `capture_region_image_by_index`) then
  `stitch::stitch_pair(&acc, &next)` and returns the new height (or a base64/`Response`
  preview). This reuses the exact chrome-out + settle path already proven in
  `scroll_capture_frame` and keeps the timer in JS (no new Rust async/thread work).
  A Rust-side timer is possible but adds thread/state complexity for no UX gain.
- **Stitch reuse:** `stitch_pair` / `detect_overlap` used **verbatim**. The only new
  logic is "if `detect_overlap == 0` and frames clearly differ ⇒ gap ⇒ warn"; if
  `overlap == next.height` ⇒ no new content ⇒ drop the tick (also the basis for
  auto-bottom detection in Phase 3).
- **Control window / preview:** reuse the existing `scroll` webview
  (`scroll.html`, `scroll.rs` builders) — just change copy + add an `<img>` preview
  that renders the latest accumulator (push via the existing `scroll:progress`
  event, extended with a preview data URL or a `toast_preview`-style `Response`
  pull). No new window type.
- **Chrome-out (unchanged, already correct):** every tick hides the control
  (`hide_control`) and honors `wait_for_compositor(Region)` before grabbing, so our
  own chrome is never in-frame — this is the same guarantee the manual path
  already relies on (`commands.rs` 143–147). The bottom-right control never overlaps
  a top-anchored scroll region in practice, and it's hidden per-grab regardless.
- **`xcap` grabs:** identical monitor-crop path (`capture_region_image_by_index`,
  `commands.rs` 762–788). No change to capture backend.
- **No new crate.** `enigo` is **not** needed for Approach 2.

### 3.3 Reaching the bottom

User-driven: they simply stop scrolling and click **Stop**. We also
auto-suggest stop when N consecutive ticks yield `overlap == frame_height` (nothing
new) — surface a "looks like the end — Stop?" hint but don't force it (avoids the
false-positive infinite-loop failure that plagues pure auto-scroll).

---

## 4. Edge cases

- **Horizontal vs vertical:** `stitch.rs` is vertical-only (row bands). Horizontal
  long-shots would need a column-band twin of `detect_overlap`. **Out of scope for
  now** — vertical covers ~all real long-screenshot use (web pages, chats). Note it
  as a future `Axis` param, not a Phase-1/2 ask.
- **Fixed/sticky headers & footers** (the big one): a pinned header repeats
  identically every frame → naive stitching bakes it in N times, and worse, a
  sticky footer corrupts the overlap band (bottom rows never change → detector
  finds false overlap). **How CleanShot handles it:** detects the static top/bottom
  bands (rows identical across many frames) and crops them out of interior frames,
  keeping the header only on the first frame and the footer only on the last.
  **Our path:** add a `detect_static_bands` pass (compare row bands across the first
  few frames; rows stable across all = sticky) and exclude those bands from both
  the overlap search and the appended content. This is a **Phase 2** stitch upgrade,
  isolated to `stitch.rs`, unit-testable without a display (same style as existing
  tests). Until then, document the limitation ("scroll content without pinned bars,
  or the bar repeats").
- **Variable scroll speed:** inherent strength of Approach 2 — overlap detection
  is offset-agnostic, so slow or fast scrolling both stitch, as long as each step
  keeps *some* overlap (< one viewport). The gap warning (3.1 step 4) guards the
  too-fast case. This is exactly why continuous+overlap beats fixed-step
  auto-scroll.
- **DPI / retina:** frames are grabbed in the same monitor's physical pixels every
  tick (fixed `rect` + `monitor_index`), so all frames share width/scale and stitch
  cleanly — the existing invariant `stitch.rs` already assumes (equal width).
  Cross-monitor drag mid-session isn't supported (region is monitor-local); fine.

---

## 5. macOS vs Windows differences & risks

| Concern | macOS | Windows |
|---|---|---|
| Region grab + crop (`xcap`) | Works (current path) | Works; least-exercised — verify |
| Compositor settle before grab | 60ms (Region) | 20ms (Region) — verify no tearing under fast scroll |
| Continuous capture (Approach 2) | No extra permission beyond Screen Recording | No extra permission | 
| Synthetic scroll (Approach 1 only) | Needs **Accessibility** perm; kinetic/inertia smear; `smooth_scroll` available | Line-based wheel, OS-configured step; coarse/variable; no smooth API |
| Sticky-band detection | Pure pixel logic — identical both OS | identical |

Biggest cross-platform risk sits entirely in **Approach 1**; Approach 2 carries no
new OS-specific surface beyond the already-shipped region grab.

---

## 6. Recommendation & phased path

**Single best next step: build Approach 2 (continuous capture).** It directly kills
the click-per-frame clunkiness, reuses the tested `stitch.rs` core with zero
changes, adds **no crate and no new OS permission**, and is equally feasible on
macOS and Windows. Auto-scroll's "magic" isn't worth its silent-failure risk as a
baseline.

**Phase 1 — ship first (reliable win over today):** convert the manual loop to
**auto-capture on a timer while recording**, driven from `scroll.ts` calling a new
`scroll_tick`, with incremental `stitch_pair` and a **live preview + running
height** in the existing control window. Rename "Capture next/Done" → "Stop", keep
Cancel. _Deliverable: two-click long-shots, live preview, no new deps._ This is the
concrete Phase-1 change.

**Phase 2 — robustness:** add `detect_static_bands` to `stitch.rs` for sticky
headers/footers (unit-tested), plus the too-fast **gap warning** and the
end-of-content **"Stop?" hint**. Pure logic + copy; no new deps.

**Phase 3 — optional auto-scroll (beta):** add an "Auto-scroll" toggle in the same
session UI using `enigo` behind a feature flag, gated by a macOS Accessibility-
permission check and a universal max-frame safety cap. Ship as clearly-labeled beta;
never the default. Honest note: expect wrong-target and coarse-step issues on
Windows/Linux; keep manual scrolling as the always-available fallback.

**Explicitly deferred:** horizontal long-shots (needs a column-axis stitch twin).

