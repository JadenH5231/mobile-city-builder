# Project context for Claude Code

You are working on a **premium mobile-first low-poly 3D city-builder prototype**. This file is the canonical context — read it first every session.

## What this project is

A browser-based city builder that plays like a premium Steam title (Cities: Skylines / classic SimCity) but is mobile-first. Single-purchase premium game model — **no monetization, no timers, no energy systems, no paywalls**. The prototype's job is to prove the core loop is fun.

The full product spec lives at [`docs/SPEC.md`](docs/SPEC.md). **Always read SPEC.md before starting non-trivial work** — it has the build order, performance budget, anti-goals, and project structure. Do not deviate from it without checking with the user.

Current progress lives at [`docs/PROGRESS.md`](docs/PROGRESS.md). Update it after completing each build step.

## Anti-goals (what this game is NOT)

- No microtransactions, IAPs, or premium currency
- No "wait 4 hours for your factory" timers
- No energy/stamina systems gating play
- No artificial complexity (e.g. elaborate power grids that exist purely to be a chore)
- No tap-to-build individual houses — use **zoning**, like Cities: Skylines

## Tech stack

- **Renderer:** Three.js (low-poly 3D, orthographic camera at fixed 3/4 angle).
  Original spec called for PixiJS v8 / 2D iso — pivoted in Step 4 because tile-based
  2D paint produced unavoidable zig-zag on diagonals; 3D meshes per road segment let
  us draw proper diagonal connectors. The simulation layer (Tile/Grid/Tool/save model)
  is renderer-agnostic and survived the pivot intact.
- **Language:** TypeScript, strict mode
- **Build:** Vite 5
- **Touch input:** Custom Pointer Events handler (covers mouse, pen, touch via the same code path)
- **Persistence:** Raw IndexedDB (no `idb` library — kept the dep list short). Wrapped in `src/persistence/SaveGame.ts`.
- **State:** Plain TS classes / lightweight ECS. **No React, no heavy frameworks.** UI overlay is vanilla DOM/CSS.

No backend. Fully client-side. Should work offline once loaded.

## Build order (do these in sequence, do not skip)

1. ✅ **Bootstrap:** Vite + TS, single tile rendered
2. ✅ **Grid:** Render a 64×64 grid with placeholder colors. Camera pan + pinch zoom
3. ✅ **Tile selection:** Tap to highlight, long-press for info panel
4. ✅ **Roads:** Drag-to-place with diagonal-first 8-connected path; rubber band on edges
5. ✅ **Zoning:** Drag-paint R/C/I zones on grass tiles adjacent to roads
6. ✅ **Building spawning:** Zoned tiles develop low-poly buildings over fixed-rate sim ticks
7. ✅ **Population & demand:** RCI demand drives growth; per-tier thresholds give a non-linear curve
8. ✅ **Vehicles:** Cars A*-route from R to C/I along the road graph; smooth render-rate movement
9. ✅ **Economy:** Treasury + tax sliders + monthly tick; tax rate also drives demand
10. ✅ **City buildings:** Power, water, parks, bus stops/depots; radius services unlock L3
11. ✅ **Traffic congestion:** Per-tile load, slowdowns, demand feedback, toggleable heatmap
12. ✅ **Bus system:** Stops suppress nearby car-spawns; depots run visible buses on auto-routes
13. ✅ **Save/load:** IndexedDB auto-save every 30 s, auto-restore on init, manual reset in budget panel
14. ✅ **Performance pass:** Heatmap throttled to 5 Hz; build at 528 KB raw / 135 KB gzipped

After each step, **stop** and tell the user what to test on their phone before moving on. Do not chain steps without confirmation.

## Performance budget (non-negotiable)

- 60fps on Pixel 7 / iPhone 13 with a fully developed Medium map
- 30fps minimum on a 2021 mid-range Android with a Small map
- Simulation tick decoupled from render tick — sim at ~10Hz, rendering at 60Hz
- Spatial hashing for proximity queries
- InstancedMesh for repeating geometry (trees, future cars/buildings); never one Mesh per entity at scale

## Code conventions

- TypeScript strict mode is on. **No `any` without a justifying comment.**
- One class per file (with rare exceptions like internal helpers).
- Each simulation system in its own module with a clean interface.
- Game state must be **serializable** — no circular references, no functions stored in state. Save games depend on this.
- Comments explain *why*, not *what*.
- Existing code uses Pointer Events (not Touch Events) and Three.js. Match the established style.
- Module layout: `engine/`, `world/`, `simulation/`, `ui/`, `persistence/`. Don't restructure.

## Project structure

```
src/
  main.ts             entry point + FPS counter
  styles.css          global CSS (HUD pills, toolbar, info panel)
  types.ts            shared constants + types (Dir, Tool, MAP_SIZES, ROAD_WIDTH…)
  engine/
    Game.ts           bootstraps Three.js, owns the loop, paint logic
    Camera.ts         3D ortho camera at fixed 3/4 angle (panBy, zoomAt, screenToWorld)
    Input.ts          pointer-events gesture handler (navigate / paint modes)
    Renderer.ts       Three.js scene: terrain, roads, sidewalks, paths, trees, selection
    BuildingVariants.ts spec catalogue + builder for 36 zoned variants + buildLuxuryParts (2-tile mansion)
  world/
    Grid.ts           tile container + road-edge graph + procedural generator
    Tile.ts           single-tile struct (terrain, road, path, elevation, bridge, luxury…)
    TerrainGenerator.ts noise-based lakes/rivers/forests/elevation
  simulation/
    Population.ts     aggregate residents + jobs (incl. mixed-use), derive RCI demand
    Development.ts    demand-driven density growth tick (10 Hz), service-gated L3
    RoadGraph.ts      car adjacency rebuilt on road changes
    PathGraph.ts      pedestrian adjacency: paths + non-highway road tiles
    Pathfinding.ts    A* over any PathfindGraph (RoadGraph or PathGraph)
    Vehicles.ts       car spawn + park-then-return + path-coverage suppression
    Pedestrians.ts    walker spawn + path-following on the pedestrian graph
    Economy.ts        treasury, tax rates (incl. mixed avg), monthly settlement
    Services.ts       radius sweep that flags hasPower / hasWater / hasPark
    Traffic.ts        per-tile EMA + city-wide stress for demand feedback
    Buses.ts          bus spawn + path-following + sidewalk pull-over dwell
    Ferries.ts        boat routes between paired docks (Alpha 2.19)
    TrafficLights.ts  adaptive 2-phase controller: queue-aware green allocation
    Milestones.ts     pop-threshold milestones + tool unlocks (Alpha 2.8)
    Events.ts         random events + crisis modal queue (Alpha 2.9)
    Stats.ts          240-month ring buffer (Alpha 2.11)
    GlobalMarket.ts   lumber + produce price oscillation + connection check
    Achievements.ts   28 lifetime achievements + counters (Alpha 2.15)
    Bonds.ts          municipal bond catalog + active loan tracker (Alpha 2.18)
    Crime.ts          per-tile crime score + commercial revenue penalty (Alpha 2.21)
    Districts.ts      district registry + per-zone surtax (Alpha 2.22)
  persistence/
    SaveGame.ts       IndexedDB multi-slot auto-save + restore (Alpha 2.20)
  simulation/
    Parking.ts        stall registry per parking_lot tile (Beta 1.3 Phase 2 — visible parking + Phase 3 difficulty hooks)
    Shoppers.ts       walking final-leg from a parked car to the destination tile (Beta 1.3.4 — Phase 2.1)
  themes/             theme packs (Beta 1.2 — cosmetic swap of every dominant visual surface)
    types.ts          ThemePack interface (palette, atmosphere, matcaps, tint, variants)
    registry.ts       getActiveTheme/setActiveTheme/onThemeChange + tint(hex) long-tail filter
    stock.ts          original launch look (identity tint)
    coastalPastel.ts  free Mediterranean pack
  ui/
    TileInfoPanel.ts  bottom-sheet info card with diagnostic chips
    BudgetPanel.ts    treasury + tax sliders + bonds + city name (Alpha 2.18+2.20)
    HappinessPanel.ts Community Sentiment + Civic Actions
    CouncilPanel.ts   election-results modal
    EventModal.ts     queued severity-tinted event modal (Alpha 2.9)
    StatsPanel.ts     canvas line graphs (Alpha 2.11)
    AchievementsPanel.ts grid of badges (Alpha 2.15)
    LeaderBioModal.ts one-time leader meet popup (Alpha 2.15)
    SlotPicker.ts     3-up save slot picker (Alpha 2.20)
    DistrictsPanel.ts district registry editor (Alpha 2.22)
    ThemePicker.ts    theme card grid in Settings (Beta 1.2)
    PhotoOpBanner.ts  opportunistic photo-op banner
    Toolbar.ts        scrollable bottom tool selector w/ grouped popovers
```

All directories above exist as of the alpha build.

## How to run

```sh
npm install
npm run dev          # binds to 0.0.0.0, exposes a Network URL for phone testing
npm run typecheck    # tsc --noEmit
npm run build        # type-check + production build → dist/
```

## Working style for this project

- **Read `docs/SPEC.md` and `docs/PROGRESS.md` at the start of any non-trivial task.**
- Keep commits scoped to a single build-order step where possible.
- After implementing a step, write a short "what to test on your phone" note for the user and **wait** for them to confirm before starting the next step.
- Update `docs/PROGRESS.md` to flip a step from ⬜ to ✅ when it's done.
- If the user asks for something that conflicts with the spec or anti-goals (e.g. "add a stamina bar"), surface the conflict and ask before doing it.
- Placeholder art is fine throughout. Polish comes after the simulation is fun.

## ⚡ Keystone feature: Happiness & Factions

The **Happiness system** (Alpha 1.2) is a load-bearing keystone, not a side
feature. The city has a fixed roster of factions, each with a named
Community Leader, a persona, and a happiness score in [-1, 1] derived
from current city state. Implementation lives in
`src/simulation/Happiness.ts`; the UI is the Community Sentiment panel
(open via the Population pill in the HUD).

**Why it's a keystone:** the future of the game will lean on this layer —
elections, policy levers, executive orders, public hearings, lobby groups,
"events" tied to individual leaders, mod-squad notifications when a
faction goes furious. Each one of those features should consume happiness
state, not bolt on its own parallel mood system.

**Rule for every new feature you add:** ask, *which factions does this
touch, and how should their `compute` functions update?* Bus-only lanes
make `transit` happier and `drivers` angrier; a power plant makes
`environmentalists` furious; a tax cut delights `taxpayers` but starves
`safer_streets`. The answer is rarely "none." When in doubt, add a small
delta to the relevant faction's `compute` and let testing tune it.

**Governance hooks** (`src/simulation/Council.ts`): Happiness drives the
**yearly** election cycle (every 12 sim months — was 3 months pre-1.5,
changed after a playtest pass). The 2nd-most-angry faction's leader runs
as the mayor's opponent (and is excluded from the council that term).
4 of the remaining 9 take seats, ranked by `vote = factionPop × turnout`
where turnout climbs with anger. Councillors do three things in office:

1. **Cost multiplier** on every buildable: `mult = 1 − sumStances × 0.25`
   clamped [0.20, 2.5]. If every councillor strongly opposes (all
   stances ≤ −0.4), the action is **banned** for the term.
2. **Zoning-change gate**: re-zoning an already-zoned tile to a different
   (zone, tier) needs ≥ 2 councillors with stance ≥ 0 for the new
   combination. Fresh zoning is always allowed.
3. **Population boost**: each councillor's faction gets +10% on its
   target share, normalised so total stays ≤ capacity.

When you add a new buildable, place it in `FACTION_STANCES` for every
faction. Skipping a row implicitly defaults to neutral (0) — fine for
neutral-everywhere items but the council mechanic only generates real
political pressure when the stance matrix has opinions in it.

**Stance-matrix coverage as of Alpha 2.6**: roads (local/avenue/highway),
R/C/I × low/med/high, MU × low/med/high (Alpha 2.0), `r_lux` for the
luxury low-density 2-tile pair (Alpha 2.5), power_plant, water_tower,
park, bus_stop, bus_depot, stop_sign — all rows filled with deliberate
values. Intentionally absent from the matrix: `walking_path` and
`traffic_light` — neither has a per-tile cost or zone-change semantic
for the council mechanic to gate, so adding rows would be dead weight.
Their faction reactions live directly in each faction's `compute()`
instead. If a future feature gives either a real cost or a
council-controllable property, add the row at that point.

**Toolbar-ban surface (Alpha 2.6)**: `Game.refreshToolbarBans()` walks
a `Tool → StanceKey` map after every election (and on init), calls
`council.costMultiplier(key)`, and pushes the set of banned Tools into
`Toolbar.setBannedTools()`. The toolbar marks each banned button with
`data-banned="true"` (CSS handles strikethrough + 🚫). Group buttons
get `"true" | "partial" | "false"` based on how many of their members
are banned. When you add a new buildable Tool that maps to a stance
key, append it to the `toolToKey` array in `Game.refreshToolbarBans`
or the toolbar visual won't reflect council bans on it.

**Council Beautification Budget (Alpha 4.0)**: the council elects a
`BeautificationTier` (`'none' | 'light' | 'standard' | 'grand' | 'opulent'`)
each term — sum-of-stances over `FACTION_STANCES[id].beautification`
maps to a tier per `BEAUTIFICATION_TIERS[tier].stanceThreshold`. **The
mayor cannot influence this lever**, even via Mayoral Override. The
elected tier feeds a monthly bill (`Council.beautificationMonthlyCost()`);
Economy.runMonth deducts it AFTER routine settlement and flips
`effectiveBeautificationTier` to `'none'` if the projected treasury
can't cover the bill. The renderer reads `effectiveBeautificationTier`
in `buildBeautificationMesh` and emits per-corner decoratives on
developed C/MU tiles (and L3-R/luxury at Grand+). The flair vanishes
city-wide the moment the tier flips to none — defunding is a visible
event. When you add a new faction-touching feature, ask if it should
also influence `beautification` (transit/safer-streets care; drivers
don't; chamber maxes it).

**Civic actions** layer player-driven influence on top of organic
happiness. Implemented in `Council.ts`:
- *Endorse* (5 PC): boosts a faction's vote share, makes them immune
  from being chosen as opponent, slight happiness penalty for everyone
  else.
- *Coalition* (10 PC): pick two factions; allies gain happiness, rivals
  per `FACTION_RIVALS` lose it.
- *Photo-op* (2 PC + $200, opportunistic): triggered after placing a
  building strongly favoured by a faction; boosts that faction's
  turnout, makes opponents of the building unhappy.
- *Mayoral Override* (40 PC): activates at next election for one term;
  bypasses cost mults, zoning approval, and bans entirely.

When adding a new lever or system, the question to ask is the same as
for happiness: *what civic actions could let the player target this?*
Don't bolt on parallel resource systems — Political Capital is meant
to be the universal "civic agency" currency.

**Tone for leader comments:** flamboyant local-community-Facebook —
heavy caps for emphasis, exclamation marks, hashtags where natural,
emoji where natural, the unmistakable cadence of someone Showing Up.
Each leader has a distinct voice; preserve that voice when adding new
buckets or comment variants.

The factions and their guiding principles (see Happiness.ts for full
state):
1. **NIMBY Coalition** (Karen Whitfield) — anti-density-near-them, anti-industry, pro-park
2. **YIMBYs United** (Marcus Chen) — pro-density, pro-transit, anti-sprawl
3. **Greenleaf Environmental Council** (Dr. Linda Greenfield) — anti-industry, anti-deforestation, pro-park
4. **Hometown Heritage Society** (Bud Hargrove) — pro-rural-feel, anti-skyscraper, anti-large-network
5. **Chamber of Commerce** (Chad Donaldson) — pro-business, pro-low-business-tax
6. **Transit Riders Union** (Priya Patel) — pro-bus, pro-density-with-transit, anti-stroad
7. **Drivers' Association** (Frank Mahoney) — pro-road, anti-bus-stop-near-R, pro-easy-driving
8. **Taxpayers' Alliance** (Eleanor Vance) — pro-surplus, anti-deficit, anti-high-tax
9. **Safer Streets Coalition** (Dr. Marcus Tate) — pro-stop-signs, anti-accidents, pro-services
10. **Working Families First** (Maria Rodriguez) — pro-jobs, anti-high-R-tax, pro-services

## Keep documentation in sync with code

**This is non-negotiable.** The user works across multiple machines via iCloud
sync. Stale docs on one machine versus another machine's code mean a future
Claude session opens this project with the wrong mental model and starts
"helping" by re-doing work that's already done.

When you change anything material — a build step gets done, the tech stack
shifts, a system gets rewritten, a tuning parameter changes meaning, a new
known-issue surfaces — update the corresponding doc in the **same response**:

- **`CLAUDE.md`** (this file): tech stack, project structure, build-order
  status, working style. Update whenever the *shape* of the project changes.
- **`docs/SPEC.md`**: canonical product spec — features, anti-goals,
  performance budget. Update whenever the *intent* changes (new feature,
  changed scope, pivoted stack).
- **`docs/PROGRESS.md`**: running log of what's actually been built and why.
  Update at the end of every build step, every tuning pass, every notable
  bug fix or post-alpha decision. This is the file the next session reads to
  know what's already done.
- **`README.md`**: phone-LAN setup, scripts, feature-status table.

A historical note for context: in May 2026 a partial iCloud sync left this
worktree without `src/simulation/` and `src/persistence/`, while
`docs/PROGRESS.md` claimed all 14 steps were done. The next Claude session
spent meaningful time figuring out what was real versus what was lost.
Whenever you add new code, also reflect it in these docs so the next pickup
on a different machine isn't a forensic exercise.

## What's already built

(Quick scan — `docs/PROGRESS.md` is the authoritative log.)

- **World & camera:** flat 3D vertex-coloured terrain, instanced cone-trees on forest tiles, orthographic 3/4 camera, selection highlight, pinch-zoom + pan.
- **Roads** in three tiers (local / avenue / highway, highway one-way), with proper 3D mesh segments for orthogonal AND diagonal strokes via an 8-connected diagonal-first rubber band. Bulldoze tool reverses it.
- **Zoning** in 4 kinds: R / C / I / Mixed-use, each with low/med/high tiers gated by player-set caps (and L3 still service-gated).
- **Buildings** that grow with demand on a 10 Hz dev tick; low-poly InstancedMesh with per-tile palette + scale.
- **Population & demand** with per-faction resident assignment driven by happiness; RCI bars + treasury reflect live state.
- **Cars** A* on the road graph with traffic-aware spawn routing, congestion-aware spillback + leader-gap, three-tier per-segment speed, queued stop-sign yielding, intersection collisions, return trips after a visit timer, and **path-coverage spawn suppression** that converts trips to walkers.
- **Walking paths + sidewalks + crosswalks + pedestrians** on a separate `PathGraph`. Pedestrians cap 500.
- **Buses** that auto-cycle every depot's stops, with **sidewalk pull-over dwell** so they don't block car traffic.
- **Adaptive traffic lights** as a richer alternative to stop signs.
- **Services** (power, water, parks) with radius coverage flags driving L3 unlock.
- **Economy** with treasury, R/C/I tax sliders, monthly settlement.
- **Happiness & Factions** keystone with 10 named-leader factions.
- **Yearly elections + 4-seat council** with cost multipliers, zoning gate, population boost.
- **Civic actions** (Endorse / Coalition / Photo-op / Mayoral Override) powered by Political Capital.
- **Save/load** to IndexedDB, schema v17, **3 save slots** (Alpha 2.20), auto-save every 30 s. Player can name each city.
- **HUD QOL:** pause + 2× / 3× sim speed, photo mode, skippable tutorial, multi-tile bulldoze toast, "Not enough money" placement toast, traffic heatmap, **crime heatmap** (Alpha 2.21), undo (20-deep).
- **Luxury low-density residential** — the `Lux` paint tool places a single grand home spanning a 2-tile pair. Premium tax rate (2.5×), heavy NIMBY draw, $800 up-front cost.
- **Forestry + farms** as export industries with their own oscillating global markets and connection-to-edge bonus (Alpha 2.7).
- **Population milestones** that gate the toolbar — Hamlet → Capital with celebration banners (Alpha 2.8).
- **Random events + crisis modal** (Alpha 2.9) — recessions, fires, lawsuits, referendums shift faction mood + market modifiers + demand.
- **Public services pack** (Alpha 2.10) — schools, hospitals, fire stations, police stations with coverage radii. Hospital adds productivity bonus on covered C/I jobs.
- **Stats panel** with 240-month canvas line graphs (Alpha 2.11).
- **Bridge mode** — overpasses on an upper road layer that cross at-grade roads without intersection (Alpha 2.12) + smooth ramp-down to ground level (Alpha 2.13).
- **Tile diagnostic chips + reasons** in the long-press info card (Alpha 2.13).
- **Day/night cycle** with sun arc + sky gradient repaint (Alpha 2.14).
- **Achievements** (28 lifetime) + **leader bio popups** (one-time meet) (Alpha 2.15).
- **Building patina** — buildings dim with age over a 15-year ramp (Alpha 2.16).
- **Tourism + landmarks** (museum / stadium / observatory) with monthly revenue scaled by city pop (Alpha 2.17).
- **Bonds + wealth surtax** (Alpha 2.18) — 3 bond tiers with default penalty + a surtax slider on L3 R/C + luxury R.
- **Ferries + subway entrances** (Alpha 2.19) — ferry docks pair across water with visible boats; subway entrances suppress car spawns within radius.
- **Crime simulation + purple heatmap** (Alpha 2.21) — per-tile crime score recomputed monthly, drives commercial revenue penalty + faction reactions.
- **Districts + per-zone surtax** (Alpha 2.22) — paint districts, name them, set color, and apply per-zone surtax sliders that stack on base R/C/I.
- **Skyscrapers** (Alpha 3.1.2) — 2×2 footprint, 4-stage construction over 12 sim months, 18 visual variants across R/C/MU. Translucent on zoom-in (Alpha 3.1.7) so the player can see ground-level activity behind a tower.
- **Lit night windows** (Alpha 3.1.6) — Medium+ R/C/MU buildings and finished skyscrapers light up during the night phase of the day/night cycle.
- **Grid expansion** (Alpha 3.2.3) — `+` buttons on each of the four map edges grow the world by one starter-region's worth of tiles for $1M each. Genuine reallocation: `Tile.x/y` and `Grid.width/height` are mutable; existing tiles shift in place; new strip gets fresh terrain via `TerrainGenerator`.
- **Buy land beyond city bounds** (Alpha 3.1.3) — tap-to-buy individual unowned tiles ($5K each) so the player can grow into wilderness gradually.
- **Humanoid pedestrians** (Alpha 3.2.2) — pedestrians render with body + head + hair instead of plain pawns; subtle walking animation in 3.2.4.
- **Settings cheats** (Alpha 3.2.4) — unlimited money + unlimited demand toggles in the More-menu for playtesting.
- **More-menu HUD popover** (Alpha 3.1.1) — secondary HUD pills (Photo, Heatmap, Achievements, Stats, Districts, Crime, Bonds) collapsed behind a single ⋯ More pill so the primary HUD stays focused on Pop / RCI / Treasury / Undo / Speed.

## Status: Beta 1.5.3 (Static toolbar block — icon-only in portrait)

Follow-up to 1.5.2 portrait toolbar work. User feedback: "I think the
Pan Bulldoze and Build/Architect spots take up too much space, they
are static so they can be smaller."

On a 390px portrait phone the mode toggle + Pan + Bulldoze were
eating ~200-250px of the toolbar's ~366px usable width because they
kept their full labels ("Build" / "Pan" / "Bulldoze"). The scrollable
build menu got the leftover ~130-150px, forcing horizontal scroll
even after the 1.5.2 tightening.

**Fix:** drop labels to icon-only at `max-width: 480px` AND
`orientation: portrait`. The static block shrinks from ~200-250px to
~120-140px, freeing ~80-100px for the build menu.

The mode toggle stays recognisable thanks to its existing colour
coding (yellow tint = Build, purple tint = Architect). Pan + Bulldoze
use the well-known hand-cursor / excavator icons.

Landscape / desktop are unaffected — labels stay because horizontal
real estate isn't constrained.

SW cache `mq-city-v13` → `mq-city-v14`. Save schema unchanged.

## Status: Beta 1.5.2 (Portrait toolbar — tighter, less HUD inflation)

New beta-user feedback: "Playing on my phone on portrait mode doesn't
give enough space for the building menu. The bottom menu UI is too
restrictive for vertical play."

**CSS-only fix** (no JS, no schema). Three new media query blocks in
`src/styles.css`:

1. `@media (max-width: 480px) and (orientation: portrait)` (toolbar):
   Drop the inline label expansion on the active group button. Pre-fix
   this expanded "Roads" / "C" / etc inline when the group's member
   was selected — inflating that pill pushed every other pill
   sideways and forced horizontal scroll just to reach what you'd
   selected. Replaced with a small yellow underline accent that
   marks the active group without consuming layout space.

2. `@media (max-width: 360px)` (iPhone SE / smaller Androids):
   Tightened outer toolbar padding (6px margin instead of 12),
   shrank group buttons (34px min-width, 6px padding, 11px font),
   compressed popover buttons to 60 × 38 (was 76 × 42) so multi-tier
   groups (R / C / I / MU with 4-5 density tiers each) fit in a
   single row instead of wrapping. Popover sheet width expanded to
   `100vw - 12px`.

3. `@media (max-width: 480px) and (orientation: portrait)` (HUD):
   Tighter HUD pill padding + smaller font + tighter gap so the HUD
   stays single-row at 390px+ widths. Pre-fix the HUD wrapped to
   2-3 rows and pushed the toolbar further from the bottom edge,
   crowding the play area.

**Net effect on a 390px iPhone in portrait:**
- HUD pill row: 2-3 rows → 1 row (frees ~30-40px of vertical play area)
- 13 toolbar entries fit without horizontal scroll
- Multi-tier popovers show all density tiers in a single row

When tuning the toolbar for portrait phones in the future, **the
principle from this release**: inline-label-expansion-on-active is
the layout-shift devil. Mark the active state with bottom-border /
background / outline instead — anything that doesn't consume
horizontal layout space. Otherwise selecting a tool will shove
neighbouring tools offscreen, requiring the player to scroll just to
reach the very thing they just selected.

SW cache `mq-city-v12` → `mq-city-v13`. Save schema unchanged.

## Status: Beta 1.5.1 (Shoppers walk PathGraph instead of cutting straight)

User feedback: "When people fan out from parking lots they still need
to walk towards and use normal pathing that's there for them rather
than fan out in any direction."

Pre-1.5.1 the `Shoppers` system used a straight-line lerp from stall
to destination — walkers visibly cut across grass / buildings / other
zones to reach the destination, which broke the illusion of a
plausible city. The reasoning in the original `Shoppers.ts` comment
was that "a straight-line walk is simpler and more legible," but a
city-builder is judged on visible plausibility and the straight-line
shortcut undermined it.

**The fix:** `Shoppers.spawnForParkedCar` now takes `grid`,
`pathGraph`, and `pathfinder` (passed through from `Vehicles.update`).
At spawn it:

1. Finds the nearest 4-adjacent walkable tile (sidewalk / path / park)
   to the parking-lot tile — the **entry** point onto the pedestrian
   network.
2. Finds the nearest 4-adjacent walkable tile to the destination —
   the **approach** point.
3. Runs A* on the PathGraph between them.
4. Builds a waypoint chain: `[stall pos, entry tile centre, ...path
   tile centres..., approach tile centre, destination pos]`.

The `Shopper` interface now stores `waypoints` + cumulative `lengths`
+ `totalLength`. The `resolve` function interpolates by distance
along the chain, so the walker moves at constant speed regardless of
per-segment length variation. Outbound walks the chain forward;
return walks it in reverse.

**Fallback:** if any prerequisite is missing (no walkable neighbour
near parking lot or destination, no PathGraph route found, or path
longer than `MAX_SHOPPER_PATH_TILES = 12`), the shopper falls back to
the old straight-line behaviour. This preserves the visual on early-
game cities that haven't built paths yet — players still see walkers
arrive, just without the routing finesse.

**Walking duration scales with path length** (no longer just stall→
dest distance). Long path-routed walks naturally take proportionally
longer (`legSec = max(MIN_LEG_SEC, totalLength / SHOPPER_WALK_TILES_
PER_SEC)`) so the shopper finishes their route before the car's
`parkedUntil` timer expires; if the visit is too short, the legs get
clamped to MIN_LEG_SEC and the middle "shopping" phase shrinks.

When adding a future "park-then-walk" mechanism (transit stations,
ferry terminals, etc.), the **principle from this release**: route
walkers along the existing pedestrian network rather than letting
them cut. The PathGraph is already built (sidewalks + walking-paths +
parks), the Pathfinding instance is already wired into Game; new
walk legs just plug into it. Straight-line lerps look like a
prototype.

## Status: Beta 1.5 (Transport trucks — freight that connects I → C)

User feedback: "Transport trucks. Transport trucks spawn from industry
and bring deliveries to commercial buildings before making a return
trip to industry. Transport trucks take up more space on the road and
slow up traffic a bit more than a car would."

**Implementation summary:**

New `CarKind = 'truck'` in `src/simulation/Vehicles.ts`. Trucks share
the existing per-frame segment-following + collision + stop-sign /
traffic-light logic with cars — they're cars, just with different
spawn semantics, slower speed, double traffic load, and a distinct
silhouette. Code reuse > parallel module.

**Spawn behaviour:**
- `spawnTruckTick` called each sim step from `Game.ts`; spawn rate
  scales with developed industrial tile count
  (`TRUCK_SPAWN_PER_INDUSTRY_PER_SEC = 0.010`). A typical mid-game
  industrial district produces ~0.4 truck spawn attempts per second,
  naturally throttled by the `MAX_TRUCKS = 30` cap (see `types.ts`).
- Each spawn picks a random developed industrial tile as **origin**
  and a random developed commercial tile as **destination**. Big_box
  destinations get the same 2× bias as resident-car commercial picks
  (big-box stores receive disproportionately more freight in real
  life).
- Trucks do NOT use parking lots — semi-trucks deliver curbside, not
  in 6-stall lots. The new 1.4.2 `findStallNearDest` flow is skipped
  for trucks.

**Behaviour vs cars:**
- Speed: `TRUCK_SPEED_MULT = 0.85` — trucks cruise 15% slower than
  cars on the same road tier (preserved on return trip).
- Traffic load: `TRUCK_LOAD_WEIGHT = 2` — trucks contribute 2 to per-
  tile `trafficLoad` (cars contribute 1), so a corridor of trucks
  visibly congests other traffic. `incrementLoad`/`decrementLoad`
  now take an optional weight parameter; all callsites use
  `carLoadWeight(car)`.
- Dwell time: `TRUCK_VISIT_LOW_SEC = 4`, `TRUCK_VISIT_HIGH_SEC = 10`
  (vs cars 8–22) — short delivery stop, then return trip queued via
  the existing `pendingReturns` mechanism. Trucks count against their
  own cap in `scheduleReturnTrips`.

**Visual design (release quality):**

Semi-truck / box-truck silhouette in `src/engine/Renderer.ts`:
- **Dark grey chassis** (full-length base frame, 0.22 wide × 0.04
  tall × 0.50 long)
- **Cab** at the front (0.22 × 0.10 × 0.16, +Z direction = forward)
- **Cargo box** at the rear (0.22 × 0.15 × 0.28, slightly taller than
  the cab — classic box-truck proportions)
- **Dark windshield** + side windows on the cab
- **Yellow headlights** on the cab front
- **Red taillights** on the cargo box rear

Total truck length 0.50 vs car 0.34 (~1.5× longer). The chassis colour
(dark grey) is baked into the vertex stream so per-instance colour
tints ONLY the cab + cargo box — the frame stays dark regardless of
fleet colour. 7-colour `TRUCK_PALETTE` (white, silver, blue, brown,
green, red, dark blue) so a city's truck fleet reads as mixed carriers.

Four sibling `InstancedMesh` objects per truck (body, glass,
headlights, taillights); cap at `MAX_TRUCKS = 30`. The `updateCars`
loop branches on `kind === 'truck'` and tracks `truckIdx` separately
from `carIdx` so cars and trucks render to disjoint instance buffers
in one pass.

When adding a future vehicle type that needs a distinctly bigger
silhouette (e.g., construction trucks, garbage trucks), the
**principle from this release**: bake the always-dark parts (chassis,
underframe) into the vertex colour stream so per-instance colour
multiplies them to "still dark" automatically, then keep the
tintable parts (body panels) vertex-coloured white so per-instance
colour tints them at full strength.

Bundle +4 KB raw / +1.7 KB gzipped — lean.

## Status: Beta 1.4.2 (Big-box demand bump + parking lots as transit hubs)

User feedback: "If I make a big parking lot it's a little too empty. Scale
up shopping trip demand for big box stores ever so slightly and make it
so that if a parking lot exists citizens will also use them to park and
walk to other different industrial or commercial buildings from the
parking lot that way they get used a bit more. If there's a big parking
lot there should be some space, but I shouldn't only see one or two
cars in a big parking lot."

**The diagnosis (Vehicles + Parking survey):**
- Big_box tiles had NO spawn weighting — they were one commercial tile
  among many. Big lots got the same fractional share of trips as a
  small zoned-C tile.
- `Parking.reserveStallNear` only checked 4-adjacent tiles, so a
  parking lot 2-3 tiles from a destination was decorative-only.
- Standalone parking lots (no big_box adjacent) couldn't be reserved
  at spawn time at all — the spawn picker looks at "stalls adjacent
  to my destination," and a standalone lot is adjacent to nothing.

**The fix — two surgical changes:**

1. **Big_box demand bump.** `pickRandomDevelopedTile` now takes an
   optional `bigBoxBias` weight (default 1) for the weighted-
   reservoir sample. Commercial picks use `bigBoxBias = 2`, so any
   big_box tile is twice as likely to be picked among commercial
   tiles. With a typical city this adds ~10-15 percentage points of
   shopping trips to big-box destinations — "slight" by the user's
   ask but enough to keep large lots populated.

2. **Parking-lot transit hubs.** New `Parking.findStallNearDest(destX,
   destY, maxRadius)` scans expanding Chebyshev rings (r=1, 2, 3…)
   and returns the first available stall. Used at spawn time with
   `maxRadius = 3` so any commercial / industrial destination within
   3 tiles of a parking lot can use it.
   - When a stall is reserved, the car routes to the **parking lot's**
     nearest road, not the destination's. So the car physically drives
     to the parking lot, parks, and the existing Shopper system walks
     the final leg (any distance — `spawnForParkedCar` already
     handles arbitrary walk legs).
   - Standalone parking lots in a commercial / industrial district
     now function as real transit hubs: cars park there and walkers
     fan out to the surrounding tiles.

**Why this fills lots without making everything chaotic:** A big lot
has 6 stalls × N tiles of capacity. With the 2× bias + 3-tile reach,
the lot now sees:
- Direct big_box arrivals (1.6-2× more frequent than before)
- Cars routing to nearby C / MU / I tiles within 3 tiles
- Both share the same stall pool — visible cars in the lot at any
  time should be ~5-10× pre-change on a busy retail block.

Cap stays at MAX_VEHICLES = 250, so total cars on map is unchanged —
the change re-allocates who parks where.

When extending Parking (or any future "park-then-walk" mechanism),
the **rule from this release**: parking-aware routing must reserve
BEFORE pathfind so the route actually goes to the parking lot. The
pre-1.4.2 "reserve after pathfind" model worked only when the lot
was visually adjacent to the destination's road; expanding to a
3-tile radius made the lot's distance from the destination's road
arbitrary, so the car needs to know "I'm driving to the lot, not the
store" before computing its route.

SW cache `mq-city-v9` → `mq-city-v10`. Save schema unchanged.

## Status: Beta 1.4.1 (Big-box fully modular — any cluster shape is cohesive)

User feedback after Beta 1.3.8 + 1.4 shipped: "the problem with big box
is when it's non-rectangular. Make FULLY modular. an L shape should
still make a visually appealing building for example."

The pre-1.4.1 system had two paths in `bigBoxClusterParts`:
- **Rectangular path:** one big wall slab spanning the cluster bbox.
  Worked for rectangles only.
- **Irregular fallback:** per-tile emission where each cluster tile
  got a full mini-store (wall + fascia + brand stripe + roof + entry).
  An L-shape rendered as 3 stamped mini-stores, exactly the visual
  that Beta 1.3.7 had set out to fix.

**The fix:** unify both paths into a single per-tile modular emission
that uses per-side exterior detection.

For each cluster tile, scan its 4 cardinal neighbours: a side is
"exterior" if the adjacent tile is NOT in the cluster. Per-side insets:
- `SIDE_INSET = 0.04` on N/E/W exterior — slim grass margin
- `BACK_INSET = 0.09` on N exterior — slightly deeper, for the
  loading-dock band
- `FRONT_INSET = 0.30` on S exterior — leaves room for the apron +
  entry vestibule + cart corrals
- **0 on interior sides** — adjacent cluster tiles' bodies abut at
  the tile boundary with no seam

Each cluster tile emits its own wall slab, roof slab, loading-dock
band (if N exterior), and fascia + brand stripe + corner pilasters
(if S exterior). The union of these per-tile slabs traces the
cluster's tile-shape outline.

**Inner-corner filler:** at world-grid corners where exactly 3 of 4
surrounding tiles are in cluster (the cluster wraps around a notch),
the two perpendicular exterior walls don't quite meet at the corner.
A small filler box (SIDE_INSET × BACK_INSET, in the missing-TR / TL
case) bridges the gap. South-notch configs (missing BL / BR) are not
filled — the resulting facade setback reads as two separate
storefronts meeting at a structural seam, which is exactly what
real architecture does for those shapes.

**Per-S-exterior-tile-RUN entries:** Multiple storefronts now possible.
Tiles with S=exterior are grouped into contiguous horizontal runs.
Each run gets one entry (length 1) or two entries spaced 1/3-in
from each end (length ≥ 2). The primary entry — the one that gets
brand-signature accents like the Target bullseye — lands on the
east-end of the longest run. An L-shape with two front arms gets
TWO storefronts, each properly anchored, with the primary entry on
the larger of the two.

**Per-tile archetype accents:** warehouse-discount yellow corner
blocks, electronics window strips, home-improvement garden display
all emit per S-exterior tile so every front face of any cluster
gets the archetype signature.

**Lamps + side service door + garden centre wing** all re-derived
from S-exterior runs / E-exterior tiles instead of the bbox. An L
gets lamps on each of its two front arms; the side service door
lands on the east-most E-exterior tile.

When extending big_box (or any future modular industry), the
**principle from this release**: emit geometry per tile, parameterised
by which cardinal sides are exterior. Group exterior tiles into
runs / faces for cluster-wide features (entries, lamps, signage).
Avoid bbox-based emission unless the shape is guaranteed rectangular
— the moment a player paints a non-rectangular cluster, the bbox
approach either overhangs into empty tiles or falls back to N
stamped mini-stores.

Bundle 1,015 KB raw / 270 KB gzipped. Save schema unchanged.

## Status: Beta 1.4 (Highway redesign — bidirectional divided multi-lane)

Substantial highway rework in response to direct user feedback: "Highways
are still just too confusing. They often times don't work." The
pre-1.4 system had one-way highways with per-tile direction stamping,
a dual-carriageway auto-paint, a 1-way variant tool, a direction-flip
tool, and animated chevron arrows. In practice this surface produced
a non-stop stream of "dead end" routing failures — direction mismatches
at junctions silently dropped edges from the road graph, and players
had no paint-time feedback about which way each tile would face.

**The redesign:** highways are now a single **bidirectional** road
tier that visibly reads as a divided multi-lane road. One tool, one
direction, no flipping. The visual style does the heavy lifting:
- **Double-yellow median** down the centre (the "this is two-way"
  cue every driver recognises)
- **White outer edge stripes** + **white inner lane lines** suggesting
  two lanes of travel on each side of the median
- **Asphalt ramp flares** at every highway↔non-highway adjacency —
  a slim trapezoidal merge lane between the wide highway and the
  narrow local/avenue. Reads as "this is where cars enter and leave
  the big road."

**Removed surface area:**
- `road_highway_oneway` (1-Way variant tool) — retired from the
  toolbar; Tool value preserved in the union for save back-compat.
- `highway_flip` (direction flip tool) — retired; dispatcher reduced
  to a one-line status toast for legacy state.
- `computeHighwayParallelPath` (dual-carriageway auto-paint helper)
  — deleted; no auto-paired parallel lane any more.
- `flipHighwayDirection` (flood-fill component reverser) — deleted.
- Highway chevron arrows — no longer rendered for newly-painted
  tiles. Legacy save data that still has a non-default `highwayDir`
  shows a single faded grey chevron as a visual hint, but the
  simulation treats the tile as bidirectional regardless.

**Simulation change:** `RoadGraph.rebuild` no longer enforces the
`highwayDir` one-way constraint. Every road edge becomes symmetric
in the adjacency list. Edge weight still depends on the destination
tile's tier (highways are 0.55, avenues 0.75, locals 1.0), so A*
continues to prefer highways for long trips — the "highways are fast"
behaviour everyone liked remains intact.

**Save schema:** unchanged. `Tile.highwayDir` is kept as a v25+ field
for backward compatibility but is inert at runtime. Old saves with
painted directions load and play normally; the directions just stop
mattering for routing.

When adding a future road tier or fancier highway feature, the
**principle from this release**: visual clarity beats simulation
realism. A double-yellow median + edge stripes + ramp flares makes
players say "of course that's a highway" without reading any tutorial.
The previous one-way-arrow system was simulation-accurate but
visually opaque, and that gap between what the player saw and what
the road graph enforced was the source of every "doesn't work" complaint.

## Status: Beta 1.3.8 (Big-box rotation fix + multi-tile cluster polish)

Follow-up on 1.3.6 (storefront rotation) and 1.3.7 (cohesive one-building
clusters). The user reported "still very weird and not working as it
should. particularly after 2x2 and beyond" — investigation found a
SIGN bug in the position-rotation formula in `bigBoxClusterParts`.

**The bug:** Three.js's `BufferGeometry.rotateY(yaw)` uses one rotation
convention (`new_x = x·cos + z·sin`, `new_z = -x·sin + z·cos`), but the
loose 2D rotation applied to each part's `(dx, dz)` offset used the
OPPOSITE 2D convention. So while the geometry rotated correctly to
face east, the offsets translated the parts in the wrong world
direction. For 1-tile clusters the misplacement was ≤0.20 units
(within the same tile, tolerated as "slightly off"); for 2x2+ the
misplacement scaled with offset distance (~0.71-1.0 units), so lamps
landed on the WEST edge of an east-facing cluster, entries on the
wrong wall, etc.

**Other 1.3.8 polish** layered on the rotation fix because they all
manifest most acutely at multi-tile sizes:
- **Body height scales with footprint** — was 0.30 flat; now grows by
  0.05 per tile-extent above 1, capped at +0.20. 2x2 buildings look
  proportionate instead of squashed.
- **Multiple entry doors on wide stores** — `widthTiles >= 2` gets
  TWO entry vestibules spaced 1/3 in from each side, like a real
  Walmart Supercenter. Bullseye / canopy / lumber-stack accents stay
  on the primary entry to keep silhouettes readable.
- **Vertical pilasters at tile seams + thicker corner pilasters** —
  break up the long blank facade. A 2- or 3-tile-wide store no longer
  reads as one featureless billboard.
- **Side service door** on multi-tile clusters — small dark slab on
  the east flank suggests a side-loading entrance.
- **Garden-centre wing rework for cohesive clusters** — the old code
  placed the wing at `primary.x + 1` which for a 2x2 was INSIDE the
  cohesive building. New path adds an outdoor plant display + lumber
  pallets + greenhouse-glass fascia accent at the east end of the
  store's apron.
- **HVAC scatter now mixes 4 unit types** — dark vent boxes, brushed-
  aluminum AC units, cylindrical exhaust stacks, wide flat ducts.
  Roof reads as industrial equipment instead of one repeated shape.
- **Lamp insets pulled inside the cluster** — was at edge ± 0.04
  (floating at the road/parking seam); now at edge - 0.08 inside the
  storefront. For widthTiles ≥ 3 an extra middle lamp lights the
  apron centre.

When extending big_box rendering, the rotation pivot is the cluster
centroid (computed in `computeBigBoxFrontYaw`), and ALL store parts
get post-rotated; only `parkingParts` (the absorbed parking_lot
tiles) stay axis-aligned (because cars use the un-rotated stall
positions handed out by `Parking.ts`).

No save schema bump — pure visual fix.

## Status: Beta 1.2 (Theme packs — Coastal Pastel is the free first pack)

First cosmetic-content release. Introduces a pluggable `ThemePack` system that drives every dominant visual surface from a single source of truth, plus a `tint(hex)` long-tail filter that perceptually unifies any unmigrated detail colour with the active theme. Ships TWO themes: **Stock** (the launch look — pixel-identical to pre-1.2) and **Coastal Pastel** (free Mediterranean-village pack — whitewashed walls, cobalt + terracotta roofs, turquoise water, warm hazy sky, olive flora).

**`src/themes/` is the new home for visual configuration**:
- `types.ts` — `ThemePack` interface: terrain palette, road palette, building-zone palettes (per zone × density), vehicle palette, flora, beautification, atmosphere (sky keyframes + sun + ambient + hemi + optional fog), matcaps, moodTint (HSL transform + blend), additive `extraVariants`, optional `exclusiveMonument`. Plus pricing + hero swatch + sku scaffolding for future paid packs.
- `stock.ts` — every previously-hardcoded constant captured verbatim. Identity moodTint (strength 0) so the renderer is byte-equivalent to pre-themes when stock is active.
- `coastalPastel.ts` — full free pack. Authored top-to-bottom: all asset palettes, full atmosphere (warm Mediterranean sky + gentle haze fog), 12 additive variant ids (variety only grows — never replaces stock), exclusive Lighthouse monument id.
- `registry.ts` — `getActiveTheme() / setActiveTheme(id) / onThemeChange(handler) / initThemes()`. The `tint(hex)` function is the secret sauce — applies the active theme's saturation × lightness × cream-blend to any colour at call time. Stock = identity; Coastal Pastel = subtle desaturate + lift + warm-cream wash that ties every unmigrated detail into the scene.

**Renderer.ts is the main consumer**: top-of-file constants removed; `THEME()` accessor returns the active pack. Build hooks for terrain, trees, roads, paths, sidewalks, stop signs, highway arrows, zone overlay, vehicle window/light materials, beautification streetscape, and lamp glow all read explicitly from the theme. **Every `colours.push(p.color)` call in `buildBuildingsMesh` and `buildCityBuildingsMesh` is wrapped in `tint()`** — that's the magic that makes service buildings / skyscrapers / monuments / Toronto landmarks all feel of-a-piece with the active theme without touching the 5K-line `BuildingVariants.ts`. Sky-gradient repaint takes per-theme keyframes; sun colours + intensities + hemisphere tones + clear color + fog all derive from `atmosphere`. **`Renderer.refreshTheme(grid, …)`** does a full re-derive + rebuild in one shot.

**Vehicles + Pedestrians**: civilian / tourist / pedestrian palettes now read `getActiveTheme().vehicles.*` at spawn time. Existing on-screen vehicles keep their assigned colour (deterministic per spawn); newly spawned ones use the active theme's palette.

**Settings → Theme is the FIRST group in Settings**. `ThemePicker.ts` renders a card grid from `listThemes()`: hero-swatch gradient + name + tagline + status pill (Active / Free / `$X.XX`). Tapping a card swaps the active theme and triggers `renderer.refreshTheme` for instant in-place repaint — no reload. Persists to `localStorage` under `mqcity-active-theme`. No save-schema bump — theme is a per-device preference (like UI scale), not city data.

**Authoring rules for the next theme pack**:
1. Drop a new file in `src/themes/yourPack.ts` exporting a `ThemePack`. Add it to the `REGISTRY` array in `registry.ts`.
2. Author the explicit palette fields top-to-bottom — that covers the 80% perceptually dominant surfaces.
3. Tune `moodTint` so the long-tail unmigrated colours read as part of the pack. Strong tints feel like a filter; subtle tints feel like the colours were authored that way. Coastal Pastel = `strength: 0.18, saturationMul: 0.82, lightnessMul: 1.05` toward `0xfff0d0` — that's a good starting envelope for "warm coastal." Tokyo Neon would invert it: `strength: 0.22, saturationMul: 1.25, lightnessMul: 0.92` toward magenta.
4. Author `extraVariants` for additive geometry variety (variety can ONLY grow, never decrease). The renderer's variant picker hook for extras is not yet wired (deferred to v1.2.1), but the array is the source of truth.
5. Optional `exclusiveMonument` for a pack-exclusive landmark.
6. Set `priceUsd: 'free'` for free packs; future paid packs set a USD price + `sku` for Stripe Edge Function entitlement gating.

**Known gaps to land in 1.2.x**:
- Matcap material pipeline: the `MatcapSet` field is in the schema but the renderer doesn't yet swap `MeshLambertMaterial` → `MeshMatcapMaterial` for marked surfaces. Themes don't break if matcaps go unconsumed — the rest of the look stands on its own.
- Additive `extraVariants` consumer in `BuildingVariants.ts` variant picker — themed variants are declared but stock variants render in their place for now. Stock variety is preserved (the user constraint); themed variety doesn't yet grow.
- Pack-exclusive monuments (Lighthouse) — registered but not yet placeable in the monument toolbar.

These are explicit non-shipping items; they don't reduce the perceived premium feel of the swap because the explicit palette + atmosphere + tint do the heavy lifting.

## Status: Beta 1.1.6 (Legal links into Settings; Ontario governing law)

Tiny follow-up on 1.1.5 — user feedback was that the canvas-footer chip was too easy to miss and cluttered the game UI. So:

- **Removed `#legal-footer`** (and its CSS). No more floating bottom-left chip.
- **New dedicated "Legal & support" group in Settings** with two prominent link rows (`.settings__legal-link`: Privacy Policy + Terms of Service, each opening in a new tab with a ↗ arrow). Below the links, a contact line points to `hello@mqcity.app`. Placed right after Account & data so a player scrolling settings hits it without effort.
- **Account & data group cleaned up** — no longer carries the redundant legal blurb; its only job is now the signed-in account display + Delete-my-account button.
- **Terms section 16 jurisdiction**: British Columbia → **Ontario**. User is based in Ontario.
- SW cache `mq-city-v2` → `mq-city-v3` so existing PWAs grab the new HTML.

**Rule for any new legal / compliance surface:** put it in the Settings panel, not as a floating canvas chip. Discoverability through a known menu > ubiquity through chrome.

## Status: Beta 1.1.5 (Legal pages + account deletion — public-launch unblocker)

Compliance polish so the live build is shareable under GDPR / CCPA / PIPEDA without exposure. Pure additive change — no gameplay touched, no save schema bump.

**Two new static pages in `public/`**:
- `privacy.html` — full Privacy Policy. Covers what's collected with/without an account, IndexedDB + localStorage + Supabase-auth-token storage (no tracking cookies), third-party processors (Supabase, GitHub Pages, Cloudflare), GDPR/CCPA/PIPEDA rights, 30-day deletion SLA, children's-data exemption. Dark theme matching `pitch.html`.
- `terms.html` — beta-stage Terms of Service. Acceptance, 13+ eligibility, beta-status disclaimer, prohibited conduct, user-content licence, free-during-beta pricing, AS-IS, US$50-or-paid-amount liability cap, Ontario/Canada governing law (set to Ontario in 1.1.6).

**Account deletion** (beta-stage GDPR Article 17 flow): the Delete button is an `<a class="settings__button settings__button--danger">` whose `href` is populated by `main.ts`'s `onAuthChange` listener to `mailto:hello@mqcity.app?subject=...&body=...` with the user's email + UUID prefilled. The developer processes the request manually within 30 days. Self-service edge-function deletion is on the roadmap.

**Service worker** caches `privacy.html` + `terms.html` in the install shell. Navigation handler tries cache match for the exact request before falling back to `index.html`, so `/privacy.html` and `/terms.html` load offline correctly instead of getting redirected to the SPA shell.

When adding a new processor (analytics, payments, etc.), update both `privacy.html` (the section 5 list of processors) and the auth modal's legal line if disclosure changes. Don't bolt on a new mood for cookies — there are no tracking cookies; if that changes we add a banner, not a footer link.

## Status: Alpha 4.10 (Play-as-you-learn tutorial — completes the production-readiness audit batch)

Sixth and final batch from the audit. Replaces the legacy 4-step "reading cards" Welcome modal with a live coach that watches the player's city while they play it.

**`src/engine/Tutorial.ts`** is a small state machine — `phase ∈ {prompt, active, skipped, completed}` + step index + 9-step curriculum, each step `{title, hint, check(game): boolean}`. On every render tick the active step's `check` predicate runs; satisfying it auto-advances. Steps are deliberately fuzzy ("any road exists", "population ≥ 20") so the player can build however they want.

**Two UI surfaces** in `index.html`: a centred `#tutorial-prompt` first-launch modal ("Try the guided tutorial?") and a persistent top-center `#tutorial-banner` pill that shows the current objective while phase is `active`. The banner has three actions: **Skip tutorial**, **Already did this** (manual advance), and a terminal **Got it** on the final step.

**Two new `Game` flags** — `happinessPanelOpenedOnce` and `budgetPanelOpenedOnce` — flip true the first time the player opens those panels, which lets the tutorial detect engagement with key UI without DOM polling. State persists in `localStorage` under `mq-tutorial-state`. Save schema unchanged.

Re-launch points: **Settings → "Show tutorial again"** and the **budget panel "Show tutorial again" link** both call `tutorial.restart()`. The old `#tutorial` DOM block + `TUTORIAL_SEEN_KEY` flag were removed in this release — there's no fallback to the old reading-card flow.

## Status: Alpha 4.4 (Vehicle window/light overlays + universal tree shadows)

Two visual polish passes on top of 4.3.1, both addressing items from the prior session's handoff list.

**Cars + buses gain sibling InstancedMeshes** for windows + headlights + taillights. The body mesh keeps its per-instance colour tint (so each car still picks from the VEHICLE_PALETTE), but windows / headlights / taillights now have their own fixed-colour materials so they don't get washed out by the body tint. Each frame, the body's per-instance matrix is mirrored to every sibling mesh — same position, same yaw, no extra per-frame math. Six new InstancedMesh objects total (cars: body + windows + headlights + taillights; buses: body + windows + headlights — buses don't have taillights because the in-game bus shape doesn't have a clear rear face).

**Tree shadow discs extended to every instanced tree.** Forest tiles already had them since Alpha 2.6. Now park-cluster trees (8 layouts × multiple trees per layout) and the Mayor's Mansion's two back-corner ornamental trees also emit a slim dark-green octagonal pad at the trunk's base. Park trees use a post-process helper inside `parkClusterParts` — at every `return out` site, a `finalize(out)` pass scans for parts with the trunk colour (`0x6b3f1f`) and prepends a sibling shadow disc at the same (dx, dz). Avoids inline duplication across all 8 cluster-size code paths.

When adding a new vehicle type with per-instance colour tint, the right pattern is: build the body geometry with white vertex colours (so per-instance color works), then create sibling InstancedMesh objects for any feature that should NOT get the tint (windows = fixed dark, lights = fixed bright colour). In the update loop, mirror the body's matrix to each sibling.

When adding new tree emissions (in a building variant, a park layout, etc.), use trunk colour `0x6b3f1f` (or `MM_TREE_TRUNK` from BuildingVariants) so the shadow auto-pass picks it up — OR emit a slim dark-green `CylinderGeometry(r, r*0.92, 0.005, 8)` disc directly at the same (dx, dz) for a self-contained build.

## Status: Alpha 4.3.1 (Luxury mansion walkway aims at the road)

Completes the curb-appeal pass. Every kind of building in the game now has a road-oriented walkway connecting its front face to the nearest road:
- Zoned tiles (R/C/I/MU) — commit `313b61e` + `252c770`
- Service buildings (school/hospital/fire/police/museum/bus_stop/bus_depot) — Alpha 4.3
- Luxury 2-tile mansions — Alpha 4.3.1

For luxury pairs the helper is `computeLuxuryRoadYaw(grid, ax, ay, bx, by)` — a pair-aware analogue of `computeRoadFacingYaw` that checks 4-adjacent tiles of BOTH pair tiles, preference order S → E → N → W, non-highway roads outrank highways. `buildLuxuryParts` accepts an optional `roadYaw?: number` and emits the walkway as a strip from the body edge to the pair tile-edge in the chosen direction; falls back to a centred T-shape when no road is adjacent (e.g. luxury home placed deep on a park lot before paving).

## Status: Alpha 4.3 (Service buildings rotate toward the road)

Finishes the curb-appeal pass started in commits `313b61e` (ground accents on every zoned tile) and `252c770` (zoned buildings face the road). The seven asymmetric-front service kinds — **school, hospital, fire_station, police_station, museum, bus_stop, bus_depot** — now also rotate so their front face (clock tower, red cross, bay doors, porch, colonnade, bench/canopy, garage door) points toward the nearest adjacent road tile. Each rotated service tile also gets a short paved walkway connecting its front to the road, matching the flagstone palette used for zoned-tile walkways.

Implementation: `SERVICE_BUILDING_ROTATES` set + `buildServiceWalkway()` helper, both in `src/engine/Renderer.ts`. The rotation hook in `buildCityBuildingsMesh` reuses the same `computeRoadFacingYaw()` helper from commit 252c770 (zoned-tile rotation), rotates each part's geometry AND its (dx, dz) offset around the tile centre so the whole composition turns as a rigid body.

Deliberately excluded from rotation:
- `park` — symmetric (lawn + path + benches all around)
- `power_plant` / `water_tower` — symmetric cylinders + boxes
- `stadium` — oval, no front face
- `observatory` — dome on a pad, symmetric
- `ferry_dock` / `subway_entrance` — orientation is driven by the water shoreline / sidewalk side they're placed against, not by the nearest road tile

When adding a new service building: if it has an asymmetric front face, add it to `SERVICE_BUILDING_ROTATES` and have `cityBuildingParts` emit its geometry with the front on the +Z side (yaw=0 = "facing south"). The rotation hook handles the rest.

**Trap to avoid:** `buildServiceWalkway` returns empty when no road is 4-adjacent. Don't draw a walkway leading to grass when a service tile is dropped mid-block.

## Status: Alpha 4.2.2 (Mansion glitch fix + Mayoral Override extends to Beautification)

Two targeted fixes on top of 4.2.1:

- **Mansion top "weird black box" gone.** Fixed two compounding issues: (1) `chimney.translate()` typo on the cap line caused the chimney to translate twice and the cap to stay at world origin (rendering as a stray dark box at corner of map); (2) replaced the funky cone-rotation pediment with a clean 4-piece classical composition (entablature base + 4-segment-cone tympanum + 2 angled roof slabs + gold escutcheon).
- **Mayoral Override now also lets the mayor set Beautification Budget.** Pre-4.2.2 the budget was strictly council-controlled. New `Council.setBeautificationTier(tier)` is gated on `isOverrideActive()`; BudgetPanel renders an editable 5-pill picker (None / Light / Standard / Grand / Opulent with monthly costs) when override is active, replacing the read-only state line. Tier change propagates immediately to `effectiveBeautificationTier` and the renderer refreshes the streetscape mesh on the next sim tick. Override is one-term-only — at the next election, council control resumes via `electBeautificationTier()`.

When extending Mayoral Override to a new lever, the right pattern is: (1) check `Council.isOverrideActive()` to allow the mayor's input, (2) immediately update both the elected/preferred field AND the effective field so the renderer / sim picks up the change without waiting for the next monthly tick, (3) preserve the natural behaviour at the next election (override expires, normal council/sim flow resumes).

## Status: Alpha 4.2.1 (Popover full-word headers + architectural night lights)

Two QoL polish passes on top of 4.2:

- **Popover full-word headers.** When the toolbar goes icon-only on portrait phones, players tapping a 1-2 letter pill (R / C / I / MU / Mon) now see the full word in the popover header ("Residential", "Commercial", "Industrial", "Mixed-Use", "Monuments"). New optional `ToolGroup.headerLabel` field — defaults to `label`. Only set it for groups whose pill label is cryptic.
- **Architectural decoratives glow at night.** Every plaza / fountain / statue / clock tower / triumphal arch / pergola / reflecting pool / topiary / flower bed / memorial garden / pier / Mayor's Mansion gains unique lit-overlay geometry via a new `addArchitecturalLights(t, addWin, pushLit)` helper inside `buildLitWindowsMesh`, AND a glow halo disc via `buildLampGlowMesh`. The halo radius scales with build importance: Mayor's Mansion 6 halos covering its 4×2 footprint, Triumphal Arch 2.0, Memorial Garden 1.8, Clock Tower 1.7, Fountain 1.6, etc. Without the halos the lit accents were tiny dots lost in the dark; with them, every monument reads as a beacon — the mid-zoom city visibly glows where the player has invested in architecture.

When adding a new architectural decorative, the right pattern is to extend BOTH `addArchitecturalLights` (per-piece lit overlays — windows, finials, glowing surfaces) AND the `buildLampGlowMesh` switch (radial halo size). The lit overlays add detail at close zoom; the halo makes it visible at mid zoom.

## Status: Alpha 4.2 (The Mayor's Mansion — showpiece build)

Single-instance 4×2 footprint architectural build that the user explicitly asked to be the **most detailed build in the game**. Sits in the Architect Mode `Mon` group as the apex prestige item. Save schema v21 (back-compat with v20+). Bundle 844 KB raw / 223 KB gzipped.

**The mansion itself is part — the lavish grounds are the rest.** Footprint is 4 wide × 2 deep. The mansion runs along the back row (4 tiles wide × 1 deep) as a 5-block composition (2 outer wings + 2 inner blocks + 1 grand 3-storey central block with copper-green dome, spire, gold ball finial, pedimented portico with 6 columns, ~30 individually-placed shutter-flanked windows, parapet balustrade, 4 chimneys, gold escutcheon, grand arched door). The front row is the formal estate grounds (central flagstone driveway, 2 reflecting pools with bronze statues, 2 parterre gardens with hedge cross + 4-quadrant flower dots + topiary cones + lawn infill, 3-step grand entrance, 2 wrought-iron lampposts, 2 ornamental urns, 2 ornamental trees in the back corners, low limestone perimeter wall with gold-finial corner posts and centre-front gate opening). ~140 BufferGeometry parts total.

**Anchor pattern** mirrors skyscrapers: lex-smallest tile of the 8 carries `building='mayor_mansion'`; the other seven are marked-only via `Tile.mayorMansion=true`. Bulldozing any of the 8 tiles tears down the entire showpiece (Game.applyBulldozeStroke walks left+up to find the anchor, then clears the full rectangle).

**Capital-tier milestone gate** ($500K up-front, $1.5K/mo upkeep). One-per-city — placement refuses with toast if a mansion already exists. All 8 tiles must be on owned grass land.

**Faction stances** strongly polarized so the placement is a real political event: Hometown Heritage +1.0 (their dream), NIMBYs +0.8 (property values), Chamber +0.8 (city prestige), YIMBYs -0.9 (non-housing footprint), Working Families -0.8 (could've been housing), Taxpayers -1.0 (apex vanity build).

When adding a new mega-build with a multi-tile footprint, the right pattern is the **anchor-tile model**: the lex-smallest tile carries `building` + the marker bit; all other tiles share the marker bit only; a single Renderer dispatch from the anchor emits the merged geometry across all tiles. See `buildMayorMansionParts` for the most elaborated example, `buildLuxuryParts` for the 2-tile pair version, `buildSkyscraperParts` for the 2×2 version.

## Status: Alpha 4.1 (Toolbar QoL rework for portrait phones)

The bottom toolbar was built when the game had ~12 tools; it grew to 30+ across two modes, and on a portrait phone the long horizontal scroll was the worst-feeling thing in the UX. Alpha 4.1 reworks it. No save schema bump, no new Tools — pure UX restructuring.

The headline:
- **21 → 13 top-level toolbar entries** in build mode. The loose `place_*` direct buttons (Power, Water, Park, School, Hospital, Fire, Police, Bus Stop, Bus Depot, Stop Sign, Traffic Light) plus the awkward 2-item `transit-modes` group all consolidate into 3 new semantic groups: **Services** (7 items: utilities + parks + civic), **Industry** (2 items: forestry, farm), **Transit** (6 items: bus + traffic control + ferry + subway).
- **Popover header + flex-wrap grid layout.** Each popover now leads with a small uppercase category label ("SERVICES", "TRANSIT") and renders items in a fixed-width pill grid (84px on desktop, 76px on narrow phones) that wraps to multiple rows so a 7-item Services category tiles cleanly.
- **Viewport-clamped popovers.** `Toolbar.toggleGroup` measures the popover's rendered width and clamps the centre line into `[12 + halfPop, viewportW - 12 - halfPop]`, so popovers anchored near screen edges no longer spill off-screen.
- **Narrow-viewport CSS at `max-width: 480px`** — group pills hide their text and show icon-only at 40px wide; the active group restores its label so you always see what's painting; outer toolbar tightens its padding. **Result: all 10 build groups + 3 pinned items fit in a single non-scrolling row on a 390-420px portrait phone.**

When adding a new buildable Tool, the right home is one of the 10 groups (Roads / R / C / I / MU / Services / Industry / Transit / Landmarks / Districts), NOT a new top-level direct button. Direct buttons should only be added if they're as load-bearing as Pan or Bulldoze.

## Status: Alpha 4.0 (Architect Mode + Council Beautification Budget)

Major end-game-content drop layered on top of Alpha 3.2.4. Save schema bumped v18 → v20 (back-compat with v19+). Bundle 831 KB raw / 220 KB gzipped.

The headline:

- **Toolbar mode toggle** — leading pinned pill swaps "🏗 Build" (existing roster) ↔ "🎨 Architect" (terraforming + decorative monuments). Pan + Bulldoze stay pinned in both modes. The toggle re-renders the toolbar, tears down popovers cleanly, and resets the active tool to Pan. Lock + ban state survives the swap.
- **Architect Mode tools**:
  - **Terra group** (terraforming paint stroke): Tree ($200/tile), Meadow ($400/tile), Pond ($1500/tile), Smooth ($50/tile reset). Refuses developed tiles.
  - **Plaza group**: Plaza ($5K), Pergola ($6K), Reflecting Pool ($20K), Pier ($3K, water-only with shore neighbour).
  - **Garden group**: Flower Bed ($2K, cheapest), Topiary ($8K), Memorial Garden ($30K).
  - **Mon group** (premium end-game): Statue ($15K), Fountain ($25K), Clock Tower ($50K), Triumphal Arch ($75K — most expensive single-tile placement in the game).
- **Council Beautification Budget** — first lever where the council acts independently of the mayor. Mayor cannot influence; even Mayoral Override has no effect. Each election picks a tier from sum of councillors' `beautification` stances:
  - **None** ($0/mo) — no flair
  - **Light** ($500/mo) — corner planters
  - **Standard** ($2K/mo) — + outdoor café tables
  - **Grand** ($5K/mo) — + decorative streetlamps + flag banners (also reaches L3 R / luxury)
  - **Opulent** ($12K/mo) — + public-art pedestals + flower spillover
  - **Defund-on-shortfall**: if the projected post-settlement treasury can't cover the bill, `effectiveBeautificationTier` drops to 'none' for the month, status toast fires, renderer wipes the streetscape mesh city-wide.
- **Renderer streetscape flair**. New `buildBeautificationMesh(grid, tier)` walks every developed C/MU tile (and L3-R/luxury at Grand+) and emits per-corner decoratives based on the tier — single merged Mesh, vertex-coloured, flat-shaded. `Renderer.drawBuildings` auto-refreshes via injected `beautificationProvider` so every paint site stays in sync.
- **`FACTION_STANCES` extended** with 11 new architectural keys + `beautification`. NIMBYs love everything that raises property values; Hometown loves classical pieces; Greenleaf loves gardens / fountains; Chamber maxes beautification budget; Taxpayers HATE everything on principle. Stances flow through existing council cost-mult + ban gate.
- **Architect tools are milestone-locked** by tier: Town (basics), City (mid water/civic), Metro (fountain / reflecting pool / memorial garden), Capital (clock tower / triumphal arch).

## Status: Alpha 3.2.4 (carryover)

Currently shipped on `main` and live at https://JadenH5231.github.io/mobile-city-builder/.

The post-3.0 stretch took the prototype from "feature-complete simulator" to "polished, growable, playtestable city-builder." Save schema is now v18 (skyscrapers added in 3.1.2; backwards-compat with v12 onward).

**The 3.0.x polish pass:**
- **3.0.1** Longer day cycle (4 min → 8 min real-time) + nighttime street lights along all road tiles.
- **3.0.2** Softened lamp glow (radial gradient centre alpha eased from 0.95 → 0.65, taper kicks in earlier, overall opacity 0.95 → 0.75).
- **3.0.3** Responsive UI sizing — toolbar + HUD pills scale by viewport so small phones don't truncate labels and tablets don't waste space.
- **3.0.4** Budget panel scrolls overflow; close button stays pinned at the bottom.

**The 3.1.x skyscrapers + services session:**
- **3.1.0** Three more building variants per (zone, density) on top of Alpha 2.1's catalogue — medium and high tiers especially. Per-zone palettes get more variety per block.
- **3.1.1** HUD declutter — More-menu popover collects the secondary toggles.
- **3.1.2** **Skyscrapers** as 2×2 footprint placeable buildings (residential / commercial / mixed). Construction runs through 4 visible stages over 12 sim months: foundation pad + cranes → base floors → structural skeleton → facade going up → finished tower. Lex-smallest tile of the 2×2 is the anchor; others mirror state. Save schema v18 persists `skyscraper`, `skyscraperStage`, `skyscraperVariant` per tile.
- **3.1.3** Buy-land tool — tap a single unowned tile for $5K. `Tile.owned` bit gates zoning + placement.
- **3.1.4** Services rework — power + water are now city-wide as long as ANY power plant / water tower exists (no more individual radius for them); parks become more lenient (radius bumped from 4 to 6 tiles).
- **3.1.5** Skyscraper redesign with serious detail — window banding wraps all four faces, vertical fin reveals every ~⅓ width, podium glass on the bottom 0.45 units, five crown styles (`flat` / `stepped` / `pyramid` / `mech` / `dome`), optional spire, optional second tower for "twin" designs, rooftop water tank + HVAC vent.
- **3.1.6** Real night illumination — finished skyscrapers + Medium+ R/C/MU buildings emit lit-window overlays during the night phase. Blends with the lamp-glow layer.
- **3.1.7** Skyscrapers go translucent when the camera zooms in close (orthoSize ≤ 5 → 0.45 opacity; ≥ 12 → fully opaque). Lets the player see street-level activity behind a tall tower.
- **3.1.8** Fixed floating skyscraper windows (lit-window builder was using hardcoded dimensions; now reads the actual `SkyscraperDesign` to align bands to the real body geometry). Softened lamp glow further.
- **3.1.9** Eight park variations (was four after 2.6's modular pass; bumped to eight for more visual variety in dense park clusters).

**The 3.2.x growth + QOL session:**
- **3.2.0** Two more variants per (zone, density) cell + two more skyscraper designs per zone. Block-level streetscape variety doubled vs Alpha 3.1.0.
- **3.2.1** First attempt at land expansion — `+` buttons outside city borders for $1M each. Initial implementation kept a fixed 64×64 grid and just unlocked tiles within it via cityBounds (wrong approach per user feedback).
- **3.2.2** Pedestrians get a humanoid silhouette — body + head + hair, picked from a small palette per spawn. Replaces the plain pawn.
- **3.2.3** **Grid expansion** done correctly — `Grid.expandWorld(direction, amount)` actually reallocates the tile array, shifts existing tiles, regenerates terrain for the new strip, re-packs road edges. `Tile.x/y` and `Grid.width/height/tiles` are now writable.
- **3.2.4** Settings cheats (unlimited money / unlimited demand toggles) + subtle walking animation on pedestrians (slight up/down bob in step).

### Failed attempt: Alpha 3.2.5 (Max density tier) — reverted

A Max density tier (cluster of L4 tiles → Mega → Twin → Skyscraper based on cluster shape) was implemented and shipped as PR #63 but **reverted in PR #64 (commit `c3234fb`)** after the user reported the game freezing after a few seconds of play.

Could not reproduce the freeze in headless Chrome (sim 0.9 ms/tick, render 4 ms/frame, no console errors), so the revert was the right move while we diagnose. The Max-tier work is preserved in branch `claude/max-density` and PR #63 history.

**Likely root cause to investigate before re-rolling:**
- `Game.applyZoneStroke` (line 1852) maps `cap` to `ZoneTier` via `cap === 1 ? 'low' : cap === 2 ? 'medium' : 'high'`. When `cap === 4` this falsely resolves to `'high'`. Same bug at line 1898 in the council-block toast.
- `Council.canChangeZone` constructs stance keys like `r_high` / `r_max` from the tier string. `FACTION_STANCES` has `r_high` rows but **no `r_max` rows** — `FACTION_STANCES[id]['r_max']` returns `undefined`. `undefined >= 0` is `false` (not crashy on its own), but if any hot-loop arithmetic propagates that into NaN, it could explain the freeze.

**Plan for re-roll** (do all of these before re-shipping):
1. Add `r_max` / `c_max` / `mu_max` / `i_max` rows to every faction's `FACTION_STANCES` (mirror `_high` values).
2. Fix the `cap === 4 ? 'max'` mapping in both `applyZoneStroke` spots.
3. Audit any other tier→key string construction for missing `_max` handling (grep `\${prefix}_\${tier}`, `_high`, `_medium`).
4. Test on the user's actual phone (not just headless Chrome) before claiming green.

### The earlier Alpha 3.0 milestone (carryover)

The "feature-complete prototype" milestone. 16 PRs across one session
add the full systems sweep that takes the game from "fun loop with
governance" to "playable simulator with progression, depth, and
content." Each PR shipped independently to GitHub Pages — branch off
main → implement → typecheck → commit → push → PR → squash-merge →
deploy. Save schema progressed v12 → v17 across the run; every bump
is backwards-compatible.

The session adds, in order:

- **2.7 Forestry industry.** Forest-tile-only `forestry` building +
  oscillating global lumber market + connection-to-edge bonus. Lumber
  trucks visualised on the road graph. Faction wiring in
  `FACTION_STANCES.forestry`.
- **2.7.1 Farms.** Grass-tile counterpart to forestry on a different
  produce-price curve. Hometown / working-families love it.
- **2.7.2 Opposition tweets.** When a faction's leader runs against
  the player and loses, their leader-card flips to a mean-tweet feed
  pulled from `OPPOSITION_TWEETS` in their voice.
- **2.8 Population milestones.** Six tiers (Hamlet → Capital) gate the
  tool-bar; earning a milestone fires a celebration banner with herald
  voice + cash + PC reward. `highestPop` persisted across reloads so
  earned unlocks never relock.
- **2.9 Random events.** Recessions, fires, lawsuits, referendums —
  each shifts modifiers (lumber price, faction mood, demand) and
  surfaces a severity-tinted modal. Choice-events block until the
  player picks. Frequency tuned twice based on playtest feedback.
- **2.9.1 Council block toast.** Tap-to-paint on a tile blocked by
  council shows a "Blocked by council — N councillors oppose" toast.
- **2.10 Public services pack.** Schools, hospitals, fire stations,
  police stations. Each has a coverage radius, faction stances, and
  hospitals add a productivity bonus on covered C/I jobs.
- **2.11 Stats panel.** 240-month ring buffer captured at every month
  rollover (pop / treasury / mood / RCI demand / export revenue).
  Canvas line graphs in a modal — no chart library.
- **2.12 Bridge mode.** New HUD toggle — when active, road-paint
  operates on an upper layer (`bridgeRoadEdges`) so overpasses can
  cross at-grade roads without forming intersections. Per-tile
  `bridgeRoad` bit + a separate edge graph; renderer drops support
  pillars and lifts the deck.
- **2.13 Tile diagnostic.** Long-press tile-info panel shows colour-coded
  reasons for why a tile is or isn't progressing ("Awaiting power
  coverage", "Capped by zoning", etc.).
- **2.13.1 Bridge ramps.** Bridge endpoints slope down to meet the
  ground road's elevation rather than terminating in a 0.22 m cliff.
- **2.13.2 Right-lane driving.** Cars + buses + walkers offset onto
  the right side of the centreline so opposing traffic can pass.
- **2.14 Day/night cycle.** 4-minute real-time day. Sun arcs across the
  sky; ambient + directional + sky gradient repaint per phase.
- **2.15 Achievements + leader bios.** 28 lifetime achievements
  covering all phases of play, browseable in a 🏆 panel with corner
  toast on unlock. First time each council leader takes a seat the
  player meets them in a one-time bio modal (queueable).
- **2.16 Building patina.** `developedAt` stamped on first sprout;
  renderer dims building colors over a 15-year ramp (1.00 → 0.72
  floor). Tile-info shows building age as a 🕰 chip. Renovation =
  bulldoze + rezone.
- **2.17 Tourism + landmarks.** Three placeable landmarks (museum,
  stadium, observatory) gated by Town / City / Metropolis. Each
  generates monthly tourism revenue (base + per-resident) when road-
  connected.
- **2.18 Bonds + wealth surtax.** Three bond sizes, 24-month term,
  faction + PC penalty on default. Wealth-surtax slider adds a
  bracket on top of base R/C for L3 + luxury tiles.
- **2.19 Ferries + subway.** Ferry docks pair with their nearest
  partner across water; visible boats run between them with dwell.
  Subway entrances suppress car spawns within a 6-tile radius
  (P=0.85). Two new transit achievements.
- **2.20 Save slots.** Three slots, picker UI on the 🏙 HUD pill,
  active slot persisted in localStorage. City-name input on the
  budget panel persists alongside every autosave. Pre-2.20 saves
  remain on the 'main' / Slot 1 key.
- **2.21 Crime + heatmap.** Per-tile crime score recomputed monthly
  from density / services / mood / police. Crime HUD pill toggles a
  purple heatmap (mutually exclusive with traffic). High city crime
  drags commercial revenue and pushes safer_streets / working_families
  unhappy.
- **2.22 Districts.** Per-tile `districtId` painted via paint / erase
  tools. Districts panel lets you name + color + set per-zone surtax
  sliders that stack on top of base R/C/I rates inside the district.

Save schema is now v17 (was v12 at session start). Backwards-compat:
v12-v16 saves load with sensible defaults for each missing field. v11
and earlier still load via the schema-2 minimum-loadable threshold.

The HUD pill row now wraps to multiple rows on a 375 px viewport;
flex-wrap was added in PR7 once the count exceeded 7 pills. Toolbar
strip remains a single horizontally scrollable row with the new
landmarks / transit-modes / districts groups appended at the end.

## Status: Alpha 2.6 (carryover)

Visual overhaul + perf pass on top of 2.5. Six visual pieces and one
perf pass land together to push the prototype toward a late-beta look:

- **Bridge railings + deck stripe.** Slim parapet rails on both
  shoulders + a yellow median deck stripe so a bridge doesn't read as
  a bare slab.
- **Tree shadows.** Slim dark-green octagonal disc at each tree base
  reads as a soft cast shadow without the cost of a real shadow map.
- **Council ban visual on toolbar.** Each Tool maps to its
  `FACTION_STANCES` key; banned tools get strikethrough + dimmed +
  🚫 marker. Group buttons show "all" or "partial" ban state.
  `Game.refreshToolbarBans` runs on init and after every election.
- **Modular parks.** Adjacent park tiles flood-fill into clusters;
  the renderer emits one bigger structure per cluster (1=cottage,
  2=playground+pond, 3=pavilion+pond+fountain, 4+=grand bandstand).
- **Sidewalk decoration on commercial blocks.** Non-highway road
  tiles next to a developed C/MU tile have a 30%-deterministic
  hydrant / parking meter / bike rack on the sidewalk pad.
- **Sky gradient + clouds.** `scene.background` is now a vertical
  CanvasGradient; 5 stylized cloud clusters float far above the
  world.
- **Perf: drop normals on flat-shaded meshes.** Every Mesh uses
  `flatShading: true`, which derives normals via `dFdx/dFdy` in the
  fragment shader — the precomputed normal attribute was unread.
  `mergeGeoms` no longer allocates / stores a normals buffer; ~12
  `computeVertexNormals()` calls removed. Per-frame
  `instanceMatrix.needsUpdate` skipped on cars/buses/walkers when
  count is 0.

No save schema bump — pure visual + perf changes.

### Status: Alpha 2.5 (carryover)

Luxury low-density residential — a 2-tile-pair zone for premium tax
revenue and NIMBY/hometown population draw.

- New tool `residential_luxury_low` under the **R** popover (Lux).
  Tap-only: validates the origin tile, finds an adjacent free
  road-adjacent partner (N/E/S/W), and marks both as
  `zone='residential', luxury=true, zoneCap=1`. Refuses with a status
  toast if no valid partner.
- `Tile.luxury` bit. Save schema bumped to v8 (older v7 saves load
  with `luxury=false`).
- `Grid.setZone` clears luxury+partner when a luxury tile leaves the
  zone (bulldoze, re-zone) so we never leave orphan half-mansions.
- Population tracks `luxuryCapacity` and `luxuryResidents` separately;
  faction targeting blends regular + luxury shares (luxury weighted
  toward NIMBYs 30% / Hometown 20% / Taxpayers 18% / Chamber 10%).
- Economy applies `LUXURY_TAX_BONUS = 1.5` on top of base R tax for
  luxury residents — they pay 2.5× the regular rate.
- Up-front cost `$800` (gated by council `r_lux` cost-multiplier).
- Renderer detects luxury pairs in `buildBuildingsMesh`, emits one
  mansion per pair from the lex-smaller tile via `buildLuxuryParts`.
  Three deterministic variants (mansion / ranch / contemporary) with
  pitched roof along the long axis, attached garage, twin chimneys,
  ornamental shrubs, paved walkway, manicured lawn pad.
- New `FACTION_STANCES.r_lux` row for every faction. Strong NIMBY +0.9,
  Yimby -0.8, Working-Families -0.6, Taxpayers +0.7, Hometown +0.6.

Also in 2.5: **"Not enough money" toast** on Place tools. Previously
Place tools silently failed when the treasury was insufficient or the
council had banned the kind — now `Game.onStatusMessage` fires a 2.5 s
pill above the toolbar with the required amount or "Banned by council"
reason.

### Status: Alpha 2.4.1 (carryover)

Disabled the Alpha 2.3 elevation visual via the `FLAT_TERRAIN` flag in
`src/world/TerrainGenerator.ts`. Procedural terrain still uses
elevation noise to *decide* lake / river / forest / sand placement,
but every tile's elevation is forced to 0 in the final spec, and
`SaveGame` zeros loaded elevations too. All elevation-aware renderer
paths stay intact (they just see 0 everywhere). Flip the flag back to
`false` to re-enable rolling hills once the cross-tile artefacts
(sidewalks stepping at boundaries, zone-overlay non-corner-sharing)
are addressed in a later pass.

### Status: Alpha 2.4 (carryover)

Cleanup pass on top of 2.3 — terrain-aware overlays + zoning gates.
The procedural elevation introduced in 2.3 was already pushing buildings
up onto hills, but every other ground-anchored mesh (roads, sidewalks,
paths, zone overlays, heatmap, road furniture) and every dynamic instance
(cars, buses, walkers) was still drawn at the old flat lift, so they
sank into hilltops, floated over valleys, and passed through bridge
decks. 2.4 fixes the lot.

- **Per-tile y-lift everywhere.** Renderer pipelines now compute
  `y = (bridge ? BRIDGE_LIFT : <baseLift> + tile.elevation)` for every
  ground-anchored quad and ornament. Road quad endpoints, lane stripes,
  road stubs, sidewalks, walking paths, zone overlays, the heatmap,
  highway arrows, stop signs, traffic lights, road-attached bus stops,
  and zebra crosswalks all ride the terrain. Bridges stay absolute at
  `BRIDGE_LIFT`.
- **Cars / buses / walkers y-lerp** between segment endpoint heights.
  New helpers `roadSurfaceY` (vehicles) and `walkerSurfaceY`
  (pedestrians, picks `SIDEWALK_LIFT` / `PATH_LIFT` / `BRIDGE_LIFT` per
  tile type) drive the lerp. Cars on a bridge ride at
  `BRIDGE_LIFT + 0.05`, matching the deck. `updateCars` and
  `updateBuses` now take `Grid` instead of a bare `gridWidth`.
- **Zoning gate.** `Grid.setZone` now rejects `terrain === 'water'`
  AND `bridge === true`. User feedback: "you shouldn't be able to zone
  in the water or on bridges". Buildings can't develop in lakes; bridges
  remain pure transit.
- **No save schema bump** — purely visual / placement-rule changes.
  v7 saves load unchanged.

### Status: Alpha 2.3 (carryover)

Natural terrain pass on top of 2.2:

- **Procedural map generator** in `src/world/TerrainGenerator.ts`. Two
  octaves of value noise drive an elevation field; low pockets become
  lakes; a 70%-chance meandering river is carved edge-to-edge; forests
  cluster on mid-elevation grass; sand auto-spawns at water shorelines.
  Seeded by `Date.now()` so each fresh map is different but a saved
  map round-trips identically.
- **`Tile.elevation`** with corner-shared vertex averaging in the
  terrain mesh — smooth ramps, no stair-stepping. Hills/valleys tinted
  to read as 3D under flat shading. Buildings lift by their tile's
  elevation so they sit on the hill rather than buried in it.
- **`Tile.bridge`** auto-set by `Grid.setRoad` when the target tile is
  water. Renderer elevates the road quad to `BRIDGE_LIFT = 0.22` and
  drops two short stone pillars from below the water surface up to the
  deck. Bridges next to land naturally form a ramp because endpoint
  y-values differ along the segment.
- **Save schema v7** persists `elevation` and `bridge` per tile. v6
  saves load with elevation=0 and bridge=false (flat by construction).

### Status: Alpha 2.2 (carryover)

Second visual polish pass on top of 2.1:

- **Facade detail** auto-emitted on every R / C / MU body: window
  bands wrapping all four faces (count scales with body height) +
  ground-floor element (door for residential, lit shopfront for
  commercial / mixed-use podium). Setback towers also get window
  banding so high-rises don't read as blank slabs. Industrial stays
  windowless to keep the warehouse genre cue.
- **Tree variety** — three silhouettes picked deterministically per
  forest tile (cone, layered pine, round oak with octahedral foliage),
  per-tile scale and leaf-tint wobble.
- **Road striping** — local stays dashed yellow; avenues now have a
  solid double-yellow median; highways get white shoulder edge stripes.
- **Zebra crosswalks** — replaced the single pad with 4 alternating
  bright-white stripes per cardinal approach.
- **City building polish** — power plant has a hyperboloid-ish cooling
  tower with vapour puff; water tower has cross-bracing, dome cap, and
  drain pipe; bus depot has apron + yellow bay markers + signage.

### Status: Alpha 2.1 (carryover)

Visual polish pass on top of Alpha 2.0:

- **36-variant building kit** in `src/engine/BuildingVariants.ts` — three
  visually distinct silhouettes per (zone, density) pair across R / C /
  I / Mixed-use × low / med / high. Tiles pick a variant from their
  (x, y) hash so a block reads as a streetscape rather than a stamp.
- **Park overhaul** — green pad + paved path + pond + 2 benches + 3
  trees of varying sizes.
- **Cars and buses** got proper silhouettes (chassis + cabin, bus body +
  roof) instead of single-box slabs.
- Rendering switch: the buildings layer is now a single merged Mesh of
  all per-tile variant geometries (one draw call). The previous
  InstancedMesh-of-boxes is gone.

### Status: Alpha 2.0 (carryover)

Pedestrian/transit/traffic overhaul + UX polish on top of Alpha 1.6.
Save schema v6. Highlights (full write-up in `docs/PROGRESS.md`):

- **Mixed-use C+R zoning** — new `mixed` Zone with MU low/med/high paint
  tools. Each tile contributes half-rate residents AND half-rate
  commercial jobs; valid R origin AND C destination for cars/walkers.
  Faction stances: YIMBYs/Transit love, Hometown/NIMBYs hate.
- **Adaptive traffic lights** (`src/simulation/TrafficLights.ts`) —
  alternative to stop signs at $1500. Two-phase cycle (vert/horiz);
  end-of-phase the controller measures the upcoming queue and allocates
  the next green between [4, 12] sec proportional to demand. Beats
  stop signs ~2-3× at busy junctions because green-direction cars never
  sit still.
- **Sidewalk-side bus stops** — new `Tile.busStop` road attachment.
  Place via the existing Bus Stop tool on any non-highway road tile;
  renders as bench + sign on the sidewalk. Buses pull over for ~1.6 s
  per stop, perpendicularly offset toward the sidewalk so cars pass
  freely.
- **Pedestrians 2.5×** — cap 200 → 500, spawn rate 0.0018 → 0.005.
  Streets feel populated.
- **Crosswalks** at every walkable intersection.
- **Pause + variable sim speed** (HUD pill cycles ▶ → ▶▶ → ▶▶▶ → ⏸).
- **Photo mode** (HUD-hide toggle).
- **Skippable tutorial** on first launch; re-openable from the budget panel.
- **Per-cell residents/jobs** in the long-press tile-info panel.
- **Multi-tile bulldoze toast** with one-tap Undo for strokes > 5 tiles.
- **Reset City** swapped to inline two-tap arm (iOS standalone-mode
  ate the previous `confirm()` dialog).

### Status: Alpha 1.6 (carryover)

Pedestrian update on top of Alpha 1.5. Five interlocking pieces (see
`docs/PROGRESS.md` for the longer write-up):

- **Walking paths** as a new placeable in the Roads popover. Per-tile, no
  edge graph, visibly narrower than any road. Paint rules: paths CANNOT
  remove roads (silently skipped on a road tile), CAN remove zoning.
- **Sidewalks** auto-render on every local + avenue road tile (highway
  tiles never get one — they're vehicle-only).
- **Pedestrians** in `src/simulation/Pedestrians.ts`. Walk developed R →
  developed C/I along the new `PathGraph` (paths + non-highway roads).
  Capped at 200, walking distance ≤ 18 tiles. Render: small vertical
  pawn with perpendicular jitter so streams spread across sidewalks.
- **Path coverage suppresses car spawns** with probability 0.55 when
  origin and destination are both adjacent to a path. Composes with
  bus-stop suppression when both apply.
- **Cars return.** Outbound trips no longer despawn at the destination —
  they push a `PendingReturn` with an 8–22 sec visit timer and
  `Vehicles.scheduleReturnTrips` plans the return leg. Fixes the
  one-way-traffic feel.
- Faction wiring per the keystone rule: big bonuses for transit /
  safer-streets / environmentalists; modest bonuses for yimbys /
  hometown / nimbys / chamber / working-families; drivers and taxpayers
  unaffected.
- Save schema v5 persists the per-tile `path` bit.

### Status: Alpha 1.5 (carryover)

Tagged on `main` as `alpha-1.5`. Builds on Alpha 1.0 (all 14 build steps
+ four post-alpha tuning passes — money pressure, traffic congestion,
three road tiers with one-way highways, player-placed stop signs with
FIFO yielding) with a full civic-and-political layer:

- Tool-bar grouping + density-tier zoning (low/medium/high as player
  permissions, services still gate L3).
- **Happiness & Factions** keystone — 10 named-leader factions, each
  with a happiness function, mood-bucketed Facebook-style comments,
  and a natural share of city population. Per-resident faction
  assignment: happy factions fill, angry ones empty, totalResidents
  tracks the sum.
- **Yearly elections** (every 12 sim months). Mayor always wins
  ≥ 50.0001%; opponent = 2nd-most-angry leader. 4 of the remaining 9
  take council seats. Councillors gate costs, zoning changes, and
  bans; their faction gets +10% population share.
- **Civic actions** powered by **Political Capital** — Endorse Leader,
  Form Coalition, Photo-op, Mayoral Override. PC accrues monthly
  based on faction happiness; persisted in save schema v4.

What's in 1.0 beyond the original 14 steps:
- **Pass 1 (challenge tuning + Undo).** Tighter money, sharper traffic
  penalties, 20-deep undo stack across paint strokes and placements.
- **Pass 2 (sim scaling fix).** Spawn rate scales with population,
  MAX_VEHICLES → 250, revenue cuts + per-capita "city services"
  expense that grows with city size.
- **Pass 3 (traffic-aware spawn routing).** A* edge cost includes
  per-tile EMA load; new spawns reroute around hot corridors. Same-
  segment minimum gap so cars don't visually overlap on hot routes.
- **Pass 4 (big roads update).** Three road tiers (local / avenue /
  highway), highway one-way semantics with paint-stroke direction,
  per-tier speed + capacity + maintenance, player-placed stop signs
  with min-pause + FIFO yielding, collisions at uncontrolled
  intersections that hurt the destination's growth, queue spillback
  across segments so a stop-sign queue doesn't pile up at the entry.

Save schema at the time of 1.0 was v2; current is v6 (see Alpha 2.0
status above). Schemas v2..v6 all load — missing fields default to
sensible values (zoneCap=3, PC=0, path/trafficLight/busStop=false). v1
is silently dropped.

The next pass is presumably content / depth (Alpha 2.1+): roundabouts,
multi-lane avenues, mid-trip car rerouting, tap-a-car route preview,
per-tile speed limits, one-way local streets, bus-only lanes,
pedestrian visual variety, idle clusters, time-of-day pulse, save
slots, line-graph stats panel, weather, day/night, education / health
buildings. See `docs/PROGRESS.md` for the authoritative deferred list.
