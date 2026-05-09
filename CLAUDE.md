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
- **Persistence:** IndexedDB via `idb` (added in Step 13)
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
    Renderer.ts       Three.js scene: terrain, roads, trees, selection
  world/
    Grid.ts           tile container + road-edge graph
    Tile.ts           single-tile struct (terrain, road bool)
  simulation/
    Population.ts     aggregate residents + jobs, derive RCI demand
    Development.ts    demand-driven density growth tick (10 Hz), service-gated L3
    RoadGraph.ts      adjacency list rebuilt on road changes
    Pathfinding.ts    A* over the road graph, reusable buffers
    Vehicles.ts       car spawn (sim) + path-following movement (render)
    Economy.ts        treasury, tax rates, monthly settlement tick
    Services.ts       radius sweep that flags hasPower / hasWater / hasPark
    Traffic.ts        per-tile EMA + city-wide stress for demand feedback
    Buses.ts          bus spawn (sim) + path-following movement; spawn suppression
  persistence/
    SaveGame.ts       IndexedDB single-slot auto-save + restore
  ui/
    TileInfoPanel.ts  bottom-sheet info card (DOM)
    BudgetPanel.ts    treasury + tax sliders sheet (DOM)
    Toolbar.ts        scrollable bottom tool selector
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
3-month election cycle. The 2nd-most-angry faction's leader runs as the
mayor's opponent (and is excluded from the council that term). 4 of the
remaining 9 take seats, ranked by `vote = factionPop × turnout` where
turnout climbs with anger. Councillors do three things in office:

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

- A flat 3D world with chunky vertex-coloured terrain, instanced cone-trees on forest tiles, an orthographic 3/4 camera, and selection highlight.
- One-finger drag pans, two-finger pinch zooms anchored on the gesture midpoint, mouse wheel zooms on desktop.
- Tap → yellow highlight; long-press → bottom-sheet info card with terrain + coords.
- A road tool that paints proper 3D mesh segments (orthogonal **and** diagonal) using an 8-connected diagonal-first rubber band; bulldoze tool reverses it; toolbar at the bottom switches modes.
- See [`docs/PROGRESS.md`](docs/PROGRESS.md) for per-step detail.

## Status: Alpha 1.0

Tagged on `main` as `alpha-1.0`. All 14 build steps are in plus four
post-alpha tuning passes; the prototype plays end-to-end with money
that gets tight at scale, traffic that congests, three road tiers
with one-way highways, player-placed stop signs with FIFO yielding
across approaches, and queue spillback so cars never visually overlap.

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

Save schema is v2 — a v1 save (pre-pass-4) silently fails to load.

The next pass is presumably content / depth (not infrastructure):
intersection lights as a richer alternative to stop signs, real
bus-route drawing, weather, day-night, more building types. The
simulation is in a place where new mechanics layer on cleanly.
