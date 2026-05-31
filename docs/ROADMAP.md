# Path to Beta 2.0

Where we're going. This is the planning document; `PROGRESS.md` is the
log of what's actually landed.

The release cadence has been: small patch bumps (`1.6.X`) driven by playtest
feedback, no minor bumps for a long stretch. To reach 2.0 in a coherent
shape rather than drifting there, the next minor bumps each carry a
distinct *theme* — a slice of the codebase that gets meaningful
attention before moving on. Patches within a minor still happen as
feedback arrives, but the minor's theme constrains what scope creeps
in.

Versioning convention going forward: `1.M.P` where `M` is the
themed minor and `P` is a patch on that minor. Major bump to 2.0
when every theme below has landed AND the product is feature-frozen.

---

## Where we are: Beta 1.8.0 shipped — Roundabouts (feature drop)

**Status**: 1.7.0 ("Performance & memory") shipped. **1.8.0 shipped
Roundabouts** as a feature drop (one-way CCW ring + detailed island, both
2×2 and 3×3) — features take a minor bump (cf. 1.5 trucks, 1.6 warehouses),
so roundabouts took 1.8 since 1.7 was the perf pass. The themed tracks
below (Save robustness, Late-game depth, etc.) shift to the next free
minors (1.9+) as they land. The 1.6.x playtest-polish track stays open in
parallel for anything urgent the player notices.

Tactical, playtest-driven fixes. Whatever the user notices, we ship in
a small PR. No structural changes; this track is meant to stay close
to the player. Recent landings: lit-window correctness, half-edge road
rendering, supply-chain multi-stop trucks, full state persistence
(time-of-day, vehicles, council), tutorial polish, service-radius
preview UI, the wiki.

The 1.6.x track stays open in parallel with 1.7+ — anything urgent
from real players keeps landing here without waiting for a themed
minor.

**Exit criteria for moving on**: feedback queue drains to "nice-to-have"
tier. No known reproducible bugs that lose the player progress, hide
critical state, or jam the sim.

---

## Beta 1.7.x — "Performance & memory"

**Theme**: the codebase has tripled in size since alpha. Renderer.ts is
~8,500 lines; BuildingVariants.ts is ~5,200 lines; Game.ts is ~4,000.
Bundle is ~1 MB raw / ~270 KB gzipped, which is fine, but the per-frame
cost on a 2021 mid-range Android has been creeping. Time for the audit
the spec called for at the alpha mark.

### 1.7.0 scope — ✅ SHIPPED (Beta 1.7.0)
- ✅ **Split `Renderer.ts`** — 9,198 → 2,121 lines. All standalone `build*`
  functions moved to `src/engine/renderer/builders.ts`; the `Renderer`
  class stays as the public facade. (Further subdivision of builders.ts
  into terrain/roads/lighting/debug deferred to 1.7.1 — see below.)
- ✅ **Split `BuildingVariants.ts`** — 5,264-line monolith → 39-line barrel
  re-exporting `buildingVariants/{types,core,skyscrapers,construction,
  monuments}.ts`.
- ✅ **Mesh-disposal audit** — fixed the real leak: `disposeGroup` now
  recurses (was direct-Mesh-only), so road-ornament + bridge Groups no
  longer leak on rebuild. Verified flat live-geometry count.
- ✅ **InstancedMesh gaps** — audited; no change needed (256 building tiles
  add 0 draws / 0 geometries — merged meshes + InstancedMesh already
  satisfy the rule). Documented.
- ✅ **Per-frame cost profiling** — `?dev=1` overlay (`src/ui/DevOverlay.ts`)
  with fps / sim ms / render ms + live GPU counts.

### 1.7.x patches
- ⏳ **1.7.1 — subdivide `renderer/builders.ts`** into focused concern
  modules (terrain / roads / buildings / lighting / debug) with a shared
  `geom` helper module. Deferred from 1.7.0 because the leaf helpers
  (THEME / mergeGeoms / box / cyl / cone / pushQuad / lerpColor) and the
  `cityBuildingParts` dispatcher are densely shared across concerns —
  needs a careful shared-toolkit extraction. The 1.7.0 class↔builders
  split is the foundation this builds on.
- ✅ **Bundle-size cuts** — `manualChunks` splits Three into its own 120 KB
  vendor chunk; main app entry chunk now **155 KB gzipped** (target was
  <240). DONE in 1.7.0.
- ✅ **Lazy-loading** for non-launch surfaces — StatsPanel +
  AchievementsPanel dynamic-imported on first open (the wiki is already a
  separate static page). DONE in 1.7.0.
- ✅ **Texture audit** — sky CanvasTexture repaint gated to ~1-2 Hz (was
  60 Hz); all other textures already create-once-cached. DONE in 1.7.0.
- Memory leak fixes as the debug counter surfaces them (ongoing — use the
  `?dev=1` geom counter).

**Exit criteria**: 60fps on a Pixel 7 / iPhone 13 with a fully-developed
Medium map (the spec's original target). No live-geometry growth over a
30-minute play session. — Desktop-verified at 60fps / render <0.5 ms with
a stable live-geometry count across a full session of rebuilds; on-device
confirmation pending (use `?dev=1` to read the numbers on the phone).

---

## Beta 1.8.x — "Save robustness"

**Theme**: schema is at v32 with v2 as the minimum-loadable. Save / load
works but has accumulated tech debt: 30+ migration default values
sprinkled through `applySave`, ad-hoc cloud / local conflict resolution,
no validation if a save is corrupt. As we approach 2.0 this becomes
the player's most-trusted contract — losing a save loses everything.

### 1.8.0 scope
- **Migration tooling**. Replace the inline `?? defaults` in `applySave`
  with a chain of explicit migration steps (v2→v3, v3→v4, ...). Each
  migration is a tiny function that mutates a `SaveData` blob; loading
  always runs migrations sequentially from the saved version up to
  current. Easier to reason about, easier to test, easier to add.
- **Validation**. Before applying a save, validate every field against
  its expected type / range. Surface a friendly modal on failure ("This
  save is from a newer version" / "This save looks corrupted, restore
  from cloud?") instead of silently throwing.
- **Cloud conflict resolution**. Currently the newer of local-vs-cloud
  just wins. Add a "Cloud is newer — overwrite local?" prompt when the
  cloud version diverges meaningfully.
- **Export/import audit**. The portable-code path (Settings → Backup &
  sync) goes through `PortableSave.ts`; make sure it round-trips every
  Beta 1.6.x field cleanly (cars, deliveryStops, council snapshot,
  time-of-day, etc).
- **Auto-recovery snapshots**. Keep the last 3 successful autosaves on
  disk per slot. If the active save fails to load, offer to roll back
  to the most-recent valid one.

### 1.8.x patches
- Migration coverage gaps as players surface them.
- Cloud-save UX (signed-in indicator, "last synced" timestamp).
- Multi-device conflict warnings.

**Exit criteria**: zero "lost my city" reports across a month of play.
Any save from v2 onwards loads, with explicit migration trace logged
to dev console.

---

## Beta 1.9.x — "Late-game depth"

**Theme**: the loop is satisfying through Town tier. After City (1k pop)
the player has all the tools and the game becomes "more of the same,
bigger." 2.0 needs late-game content that justifies the climb.

### 1.9.0 scope
- **Council depth**. Currently councillors are passive cost multipliers
  + ban gate. Add a "Council session" event every 6 months where
  councillors propose policies (rent control, transit subsidy,
  industrial zoning ban, etc); player accepts or vetoes; passed
  policies modify city stats for one term. Vetoes cost PC.
- **Multi-stage events**. Today events fire once and apply a modifier.
  Add chained events: a recession (1.9.0 scope) escalates into bond
  defaults, then mass layoffs, then a political crisis — each stage
  triggered by player response or inaction.
- **New monuments / landmarks**. At least one per milestone above City:
  Metropolis gets a Convention Center; Capital gets a National Stadium
  + Memorial Hall. Each has a unique footprint, real visual presence,
  and meaningful gameplay effect (Convention Center: temporary tourism
  spike; National Stadium: monthly entertainment revenue + Chamber +
  Working Families happiness).
- **Achievement expansion**. Currently 28 lifetime; bump to 60. Add
  challenge-style ones ("Reach 5k pop without bulldozing any zoned
  tile", "Run a city for 20 sim years with surplus every month").
- **End-game scenarios**. A "Scenario" tab in the slot picker offering
  pre-built challenges: "Bankrupt city, 3 months to surplus", "Polluted
  industrial sprawl, rezone to green", "Mountain valley, no flat land".
  Each scenario is its own save slot with starting conditions baked in.

### 1.9.x patches
- Event tuning based on playtest.
- Scenario authoring (cleanup of the scenario data format).

**Exit criteria**: a player at City tier has a meaningful reason to keep
climbing toward Capital. New monuments visibly change the skyline.

---

## Beta 1.10.x — "Onboarding & accessibility"

**Theme**: 2.0 is a launch. The first 60 seconds of a new player's
experience determines whether they stay. The tutorial is decent but
the rest of the onboarding surface needs the same care.

### 1.10.0 scope
- **Welcome flow**. Replace the existing "Want a tutorial?" modal with
  a 3-screen carousel: "Here's what this game is" (1 screen), "Here's
  the loop" (1 screen), "Want a walkthrough?" (1 screen with skip).
  Skippable by tapping anywhere.
- **Tutorial extensions**. Add optional steps 10-15 covering bus
  routes, the supply chain, council mechanics, civic actions. Each
  group of 2-3 steps is a separately-replayable "lesson" accessible
  from Settings.
- **Color-blind modes**. Most heatmaps + zone overlays use red/green/
  yellow which fails for deuteranopia + protanopia. Add a "Palette"
  setting offering deuteranopia / protanopia / tritanopia / mono
  variants for every player-visible color overlay (heatmap, zone
  paint, mood, crime).
- **Keyboard navigation**. Every modal and panel reachable by Tab/
  Shift-Tab; Esc closes; Enter confirms. Toolbar accessible via
  hotkeys (1-9 = first 9 visible tools).
- **Screen reader pass**. ARIA labels on every interactive element;
  live region for the status-message toast; alt text on faction
  leader avatars.
- **UI scale audit**. Three settings: Small / Default / Large. Make
  sure every panel and toolbar stays usable at all three on iPhone
  mini.

### 1.10.x patches
- A11y bugs as they surface.
- Tutorial step tuning.

**Exit criteria**: clean pass on WCAG AA for color contrast on the
default + color-blind palettes; all modals reachable by keyboard;
NVDA / VoiceOver smoke test passes.

---

## Beta 1.11.x — "QA & docs"

**Theme**: pre-launch buffer. Comprehensive bug sweep + final
documentation push.

### 1.11.0 scope
- **Known-issues triage**. Spend one focused session going through
  every TODO / FIXME / "acceptable for prototype" comment in the
  codebase. Fix the real ones; remove the stale ones.
- **Edge-case audit**. The fuzzy edges: zero-pop cities, 1-tile
  grids, completely water-covered maps, saves from every minor
  version, every device-orientation combo.
- **Wiki refresh**. Update every section to match the final 2.0
  behaviour. Add a "What's new in 2.0" section.
- **CLAUDE.md / SPEC.md / PROGRESS.md sync**. They drift; lock them
  back to truth before launch.

### 1.11.x patches
- Whatever survives the audit.

**Exit criteria**: zero priority-1 bugs in the issue tracker. Docs
match shipped behaviour.

---

## Beta 2.0 — "Launch"

**Theme**: feature freeze. Ship it.

### 2.0 scope
- **Feature freeze** from the moment 1.11 ships. No new buildings, no
  new systems. Only bug fixes and balance tuning until the version
  number flips.
- **Final balance pass**. One sweep over every numeric constant in
  `types.ts` — costs, rates, thresholds, payloads, drain rates.
  Calibrate against a playtest plan that exercises every milestone.
- **Final polish**.
  - Title screen / loading screen visual pass.
  - PWA install prompt timing (defer until first slot earns a milestone).
  - App icon refresh.
  - Sound + music pass (currently silent; 2.0 should at least have
    ambient + UI feedback sounds).
- **Marketing-ready surface**.
  - Updated `pitch.html` with shipped feature list.
  - Public changelog at `mqcity.app/changelog/` (subset of
    `PROGRESS.md` formatted for non-devs).
  - Social share image / OG meta tags on the home page.
- **One genuinely new "wow" feature** to justify the 2.0 stamp.
  Candidates (pick one, scope-bounded):
  - **Shared city link**: export a city as a portable code that
    others can import into a sandbox slot. Builds on the existing
    `PortableSave` machinery.
  - **Time-lapse export**: 30-second timelapse video of city growth
    over saved months (would need offscreen canvas rendering + a
    bundled mp4 encoder — bigger lift).
  - **Day-1 mod support**: themes + custom building palettes loaded
    from a JSON drop the user can supply. Pluggable variant
    registry — partially scaffolded already in `src/themes/`.

### 2.0 release-day checklist
- [ ] All 1.6.x → 1.11.x themes complete with no regression.
- [ ] PROGRESS.md final entry.
- [ ] Wiki section "What's new in 2.0".
- [ ] Tag `v2.0.0` on `main`.
- [ ] Deploy.
- [ ] Tweet / announce.

---

## Operating notes

- **Each themed minor is "first version that fits the theme,"** not
  "everything related to the theme." If 1.7.0 ships a smaller Renderer
  split than planned, that's fine — 1.7.x patches finish the job.
- **1.6.x stays open** parallel to higher minors. Playtest fires that
  don't fit a current theme land in 1.6 patches.
- **No minor jumps without a theme**. Every M version answers "what
  was 1.M about?" in one sentence.
- **2.0 ships when 1.11 is clean**, not on a date. If a real launch
  date pressure arrives, the theme-buffer (1.11) absorbs it; we don't
  cut from earlier themes.
- **Docs stay in sync with code in the same commit.** This is the
  CLAUDE.md rule; tighten it for the 1.7+ work where doc drift would
  bite worst.

---

*Authored Beta 1.6.36. Subject to revision as scope contacts reality.*
