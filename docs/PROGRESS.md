# Build progress

Update this file every time you complete (or partially complete) a build-order step. Keep it tight; long discussion belongs in commit messages or `docs/NOTES.md`.

## Releases

- **Alpha 1.0** — tagged `alpha-1.0` on `main`. All 14 build steps + four post-alpha tuning passes (pass 1: challenge tuning + Undo; pass 2: sim scaling fix; pass 3: traffic-aware spawn routing + same-segment gap; pass 4: big roads update — three road tiers, highway one-way, player-placed stop signs with FIFO yielding, collisions, queue spillback). Save schema v2.
- **Alpha 1.1 (in progress)** — toolbar groups variations behind one button (Roads → Local/Avenue/Highway popover; R/C/I → Low/Med/High popover); zoning splits into player-set density permissions (low caps at L1, medium at L2, high at L3 if services support it). Save schema v3 (v2 loadable via "default to high cap" compat).
- **Alpha 1.2 (in progress)** — Happiness & Factions keystone. Ten named-leader factions (NIMBYs, YIMBYs, Environmentalists, Hometown Heritage, Chamber, Transit Riders, Drivers, Taxpayers, Safer Streets, Working Families) each with a persona, happiness derived from city state, and 15 mood-bucketed Facebook-style comments. Population pill opens Community Sentiment panel. Documented as a keystone in CLAUDE.md — every future feature should explicitly consider faction impact. Each resident is now associated with a faction (per-faction populations, sum = totalResidents); happy factions stay full-share, angry factions empty out below capacity, total population drives revenue and demand.
- **Alpha 1.3 (in progress) — Council & elections.** Every 3 sim months an election fires. Mayor (player) wins ≥ 50.0001% with the actual % scaled by overall mood. Opponent = 2nd-most-angry leader (excluded from council that term). 4 of the remaining 9 factions take council seats, ranked by `factionPop × turnout` where turnout climbs with anger. Councillors apply a cost multiplier to every buildable (banned if all 4 strongly oppose), gate zoning *changes* (need ≥ 2 approvers), and give their own faction +10% population share. Election results auto-popup; councillor leader posts switch to "city hall mode." `FACTION_STANCES` matrix in `src/simulation/Council.ts` codifies who likes / hates what.
- **Alpha 1.4 (in progress) — Civic actions & Political Capital.** Election cadence moved from 3 → 12 sim months (yearly). New Political Capital resource accrues monthly (+1 base, +0.5 per faction at happiness ≥ 0.5; cap 50). Three player-driven civic actions (all consumed at the next election): **Endorse Leader** (5 PC: target faction +20% vote share + immune from being opponent; non-endorsed factions take a small happiness penalty). **Form Coalition** (10 PC: pick two factions → both gain happiness; their natural rivals per `FACTION_RIVALS` lose happiness). **Photo-op** (2 PC + $200, 1/faction/term, opportunistic at building placement: turnout boost for the supportive faction; opponents of the placed thing take a small happiness hit). And one big-bet investment: **Mayoral Override** (40 PC: takes effect at next election, lasts one full term, bypasses all council restrictions — no cost penalties, no zoning approval, no bans). Sentiment panel now shows a prominent council bar at the top, civic-action buttons + PC progress, and renders election results / pickers via modals. Save schema bumped to v4 to persist Political Capital across reloads.

## Status

| Step | Feature | Status | Notes |
| --- | --- | --- | --- |
| 1 | Vite + TS bootstrap | ✅ | Originally Pixi; pivoted to Three.js in Step 4 v2. DPR capped at 2×. |
| 2 | 64×64 grid, pan + pinch zoom | ✅ | Now a 3D vertex-coloured terrain mesh + instanced trees. Ortho camera at fixed 3/4 angle. |
| 3 | Tile selection (tap / long-press) | ✅ | Tap → yellow square highlight; long-press → bottom-sheet info card. |
| 4 | Roads | ✅ | Three.js mesh segments. Diagonal-first 8-connected rubber band on road *edges* — diagonals are real corner-to-corner pieces, not stair-stepped. |
| 5 | Zoning (R/C/I) | ✅ | Per-tile zone field; semi-transparent overlay; mutual exclusion with roads. |
| 6 | Building spawning | ✅ | 10 Hz dev sim, density 0–3, low-poly InstancedMesh w/ per-instance scale + colour. |
| 7 | Population & demand (RCI) | ✅ | Per-tier thresholds (0.4/0.7/2.5), demand-modulated rate, HUD pop pill + RCI bars. |
| 8 | Vehicles + A* pathfinding | ✅ | RoadGraph + A*; render-rate car movement; one InstancedMesh, capped at 80. |
| 9 | Economy + tax sliders | ✅ | $50K start, 20s/month, R/C/I tax sliders that also penalise demand. |
| 10 | City buildings (radius services) | ✅ | Power, water, parks, bus stop, bus depot. L3 unlocked by power+water+park coverage. |
| 11 | Traffic congestion + heatmap | ✅ | Per-tile load slows cars; EMA drives global stress that suppresses R/C demand. Toggleable heatmap. |
| 12 | Bus system | ✅ | Stops suppress 70% of nearby car-spawns; depots auto-spawn buses that loop stops on A* legs. |
| 13 | Save/load (IndexedDB) | ✅ | Single slot, schema v1, 30 s auto-save, auto-restore on init, reset in budget panel. |
| 14 | Performance pass | ✅ | Heatmap throttled to 5 Hz. Build = 528 KB / 135 KB gzipped. Three.js dominates. |

## What's implemented

### Step 1 — Bootstrap
- `package.json` with `pixi.js@^8.2.0`, `vite@^5.2.11`, `typescript@^5.4.5`.
- TS strict mode, ES2022 target, bundler module resolution.
- Vite bound to `0.0.0.0:5173` for LAN phone testing.
- `index.html` with mobile-friendly viewport (no zoom, safe-area insets, theme color).
- Global CSS locks page scroll (`overflow:hidden`, `overscroll-behavior:none`, `touch-action:none`).
- `src/main.ts` does top-level `await game.init(...)`.

### Step 2 — Grid + camera
- `src/types.ts` defines `TILE_WIDTH = 64`, `TILE_HEIGHT = 32`, `MAP_SIZES`.
- `src/world/Grid.ts` generates a deterministic placeholder map: ~6% forest, rest grass.
- `src/engine/Renderer.ts` projects grid coords to iso world space via `(gx-gy)*hw, (gx+gy)*hh` and bakes all tile diamonds into a single `Graphics`. Per-terrain palette.
- `src/engine/Camera.ts` exposes `panBy`, `zoomAt`, `screenToWorld`. `zoomAt(factor, sx, sy)` keeps the world point under `(sx, sy)` fixed — required for pinch to feel right.
- `src/engine/Input.ts` uses Pointer Events. 1 pointer = pan; 2 pointers = pinch + two-finger pan; wheel = zoom (desktop). Pointer capture handles fingers drifting off-canvas.
- `src/engine/Game.ts` wires everything: creates `Application`, mounts canvas, fits camera to grid, ticks `applyCamera` each frame.
- HUD has a live FPS pill (sampled at 500ms).

## Known issues / things to watch

- Single `Graphics` for the whole grid is fine for Small (4 096 tiles) and Medium (16 384) but will hit a wall on Large (65 536). Plan: chunked `RenderTexture`s during Step 14's perf pass.
- No off-screen culling yet. Pixi's batched Graphics largely makes this a non-issue at current sizes.
- Camera position is in screen-space, so on viewport resize the camera doesn't auto-recenter. Acceptable for now.
- iOS Safari URL bar can shift `window.innerHeight` mid-session; `resizeTo: window` handles the canvas, camera stays where the user left it.

### Step 3 — Tile selection

- `Renderer.worldToGrid(wx, wy)` is the inverse of `gridToWorld`: divide by half-tile dims to land on rotated `(u, v)` axes, then average to recover integer tile coords.
- A second `Graphics` (`selectionLayer`) sits above the tile layer inside `worldContainer`. `drawSelection(gx, gy)` paints a soft yellow diamond glow + crisp outline; `clearSelection()` empties it.
- `Input` now disambiguates tap / long-press / pan:
  - Camera pan is **deferred** until the active pointer has moved > 10px from its start. Below that threshold the world stays still so a quick release fires a tap.
  - A `setTimeout(500ms)` long-press fires only if the gesture stays uncommitted *and* still has exactly one pointer.
  - A second pointer down marks the gesture as committed (kills the long-press) and pinch takes over.
- `TileInfoPanel` (`src/ui/TileInfoPanel.ts`) is a vanilla-DOM bottom sheet. Hidden by default, slides in via a CSS transform when `show()` is called. Backdrop blur, 44pt close button.
- `Game` wires it all up: `screenToTile()` does `screenToWorld → worldToGrid` with a bounds check, tap highlights only, long-press highlights + opens the panel, tap on empty space clears.

### Step 4 v2 — 3D pivot + Roads

User feedback after the 2D-iso first pass: the per-pointermove Bresenham produced ugly zig-zag stair-step roads on diagonals, and 8-connected jumps caused "fast skipping" where adjacent diagonal cells didn't visually connect (auto-tiler was 4-connected only). Rather than band-aid, we pivoted the whole renderer.

**Tech-stack pivot:** PixiJS v8 → **Three.js**. Same `Camera` interface (`panBy`, `zoomAt`, `screenToWorld`) so `Input` carried over unchanged. Same Pointer-Events gesture model. The simulation layer (`Tile`, `Grid`, `Tool`) survived; everything in `engine/Renderer.ts`, `engine/Camera.ts` was rewritten.

**Renderer (`src/engine/Renderer.ts`):**
- Ortho camera, fixed 45° yaw + 35° pitch — no rotation gestures.
- Terrain: one `BufferGeometry` for the whole grid, vertex-coloured per terrain type. Single draw call.
- Trees: `InstancedMesh` of a merged trunk-cylinder + cone-leaf geometry. One instance per forest tile, deterministic per-tile rotation/offset jitter. Single draw call.
- Roads: rebuilt as one `BufferGeometry` per change. **Each edge becomes a flat oriented quad** between the two tile centres — orthogonal *or* diagonal. Diagonal edges are 45° quads that meet at tile corners. Plus per-edge dashed yellow lane stripe.
- Selection: a translucent yellow square + line-loop wireframe outline, repositioned on tap.

**Camera (`src/engine/Camera.ts`):** orthographic, target on y=0 plane. `panBy(dx,dy)` projects the camera's right + forward vectors onto the ground plane and shifts target by `dx*right + (-dy)*forward * pxToWorld`. `zoomAt(factor, sx, sy)` saves the world point under (sx, sy), updates `orthoSize`, then nudges target to keep that point pinned. `screenToWorld` is a Three.js raycast onto the y=0 plane.

**Road state (`src/world/Grid.ts`):** roads are now a graph of **edges** between adjacent tiles (4- or 8-connected). `Set<number>` of packed edge keys. `setRoadEdge(ax, ay, bx, by, on)` enforces adjacency, also flips the endpoint tiles' `road` bool. Tiles can also be road *stubs* (road=true, no incident edges) — that's how a single click in road mode renders. Demoting a stub on edge-removal happens automatically when no edges remain.

**Paint logic (`src/engine/Game.ts`):**
- `path8(a, b)`: 8-connected diagonal-first king-moves path. Diagonals consume both axes at once, then the remainder runs orthogonal. From (0,0) → (5,3) you get diagonals to (3,3) then E,E.
- Rubber band tracks **edges added** (or removed for bulldoze) plus standalone **stubs**. On every pointermove, recomputes the desired edge set from origin → current cell, reverts this-stroke edges no longer wanted, applies new ones. Stationary tap creates a stub.
- Result: a NE drag draws one clean diagonal road of corner-to-corner segments. No stair-step, no skipping.

**UI:** Toolbar (Pan / Road / Bulldoze) and TileInfoPanel are unchanged from the 2D pivot — pure DOM, didn't need to move.

**Loose ends to revisit:** road segments butt up at tile centres without an explicit "intersection cap," so at T- and X-junctions the centre patch can look slightly hollow at the very edges. Once we have proper buildings (Step 6) the visual will be denser and this may not matter; if it bugs us, add a small disc per road tile at intersections.

### Step 5 — Zoning

- `Tile.zone: Zone` (`'none' | 'residential' | 'commercial' | 'industrial'`). Three new tools — `'residential'`, `'commercial'`, `'industrial'` — share the existing paint mode. R/C/I icons added to `Toolbar`.
- `Grid.setZone(x, y, zone)` validates: clearing always succeeds; setting a real zone requires `!t.road` AND `hasRoadAdjacent(x, y)` (4-connected). `setRoadEdge(..., true)` also clears the zone on its endpoints — roads and zones are mutually exclusive on the same tile, and roads always win.
- New zone overlay layer in `Renderer` (`drawZones(grid)`): a single vertex-coloured `BufferGeometry` of all zoned tile quads at `y = ZONE_LIFT (0.005)`, just above terrain and beneath roads. Material is semi-transparent (`opacity: 0.55`, `depthWrite: false`) so the terrain colour bleeds through. Inset of 0.03 world units leaves a sliver of grass between zoned cells for visual rhythm.
- `Game` now has three rubber-band branches keyed by tool:
  - `applyRoadStroke` (existing, edge-based) — also reports zone changes when promoting tiles to road, so the overlay stays in sync.
  - `applyZoneStroke` — per-tile rubber band. Snapshots the *original* zone the first time a stroke touches a cell (`Map<idx, originalZone>`), reverts on rubber-band shrink. Invalid cells (road, no road adjacent) are silently skipped — feels nicer than rejecting the whole stroke.
  - `applyBulldozeStroke` — per-tile, snapshots `{wasRoad, zone, edges[]}` before clearing. Restores everything (including incident road edges) when the rubber band retreats. This made bulldoze a strict superset of "clear road" + "clear zone".
- `TileInfoPanel` now shows road/zone status alongside terrain on long-press (e.g. `grass · residential`, `grass · road`). Quick way to verify a paint actually stuck.

### Step 6 — Building spawning

- Two new `Tile` fields: `density` (0..3) and `developmentPressure` (float, sim accumulator). `Tile.resetDevelopment()` zeroes both — called from `Grid.setZone` (any zone change tears the building down) and from `Grid.setRoadEdge` when a road displaces a zone.
- New `simulation/Development.ts`. `Development.tick(grid)` sweeps every zoned non-road tile, adds `PRESSURE_RATE = 0.06`, and promotes density when pressure crosses 1.0. Returns true iff anything changed so the renderer only rebuilds on demand. Constant rate is a Step 6 placeholder; Step 7's RCI demand will modulate it.
- `Game.startLoop` now runs a fixed-rate sim accumulator: `simAccumulatorMs += dtMs` per render frame, runs as many `SIM_STEP_MS = 100` ticks as fit, capped at `MAX_SIM_STEPS_PER_FRAME = 5` so a long stall (backgrounded tab, dropped frame) can't trigger a death-spiral catch-up. Render rate stays decoupled from sim rate.
- `Renderer.drawBuildings(grid)` builds a single `InstancedMesh` from a unit `BoxGeometry` translated to its base. Per-instance: matrix (position + per-density scale + deterministic 0/90/180/270° rotation + tiny per-tile XZ jitter), `setColorAt` colour from `BUILDING_COLORS[zone][density]`. One draw call for *all* buildings on the map. `MeshLambertMaterial` with `flatShading: true` gives the chunky low-poly look without textures.
- Bulldoze rubber band now snapshots `density` + `developmentPressure` alongside `wasRoad`, `zone`, and incident `edges`. Restore happens in **two phases** across the to-restore set: phase 1 re-adds all road state (so adjacency is correct everywhere), phase 2 restores zones — bypassing `setZone`'s validation since the snapshot was a previously-valid state, and copying density + pressure verbatim. Net effect: dragging bulldoze in then back out fully un-bulldozes a developed tile, density included.
- `TileInfoPanel` now also shows `L<density>` after the zone (e.g. `grass · residential L2`).

### Step 7 — Population & demand

- New per-density capacity tables in `types.ts`: `RESIDENT_CAPACITY = [0, 4, 16, 64]`, `COMMERCIAL_JOBS = [0, 3, 12, 48]`, `INDUSTRIAL_JOBS = [0, 5, 20, 80]`. Exponential to mirror how a real low-poly cluster of houses → townhouses → apartment block escalates.
- `simulation/Population.ts` sweeps the grid each sim tick and derives three demand values clamped to `[-1, 1]` from rough Cities-style rules: R demand = `(jobs − residents + 5) / 30`, C demand ≈ `(P/4 − Jc) / 15`, I demand ≈ `(P/2 − Ji + 2) / 20`. The `+5` and `+2` baselines bootstrap an empty city so a freshly-painted zone actually starts to grow.
- `simulation/Development.ts` rewritten to consume `Population`. Pressure rate becomes `BASE_RATE × demand[zone]`, and `PROMOTION_THRESHOLDS = [0.4, 0.7, 2.5]` indexed by current density gives the non-linear pacing the user asked for: cheap up to L1, cheap-ish to L2, expensive to L3 (memory: feedback_density_curve). Negative demand freezes growth.
- Game tick order: Population → Development each fixed step. Population is a public field on `Game` so `main.ts` can read it for the HUD.
- HUD: replaced the static instructions pill with a live population pill (`Pop · 142`), added a centre-mounted RCI pill with three vertical bars, fills tween from a midline (positive = up, negative = down). Throttled to 4 Hz so DOM doesn't thrash on every render frame.

**Mid-step rebalance (still Step 7):**
- User flagged that demand stalled too easily and L3 came too cheaply. Two corrections:
  - **Demand-side:** widened formulas (R bias `+20`, C `+2`, I `+5`, denominators 50/15/25). Added a concave `sqrt(demand)` curve to the rate so weak positive demand still produces visible growth. Added an L0 floor of 0.3 so freshly-painted tiles always sprout a starter building regardless of city economics.
  - **Density cap:** `Development.MAX_REACHABLE_DENSITY = 2`. The demand sim can only push tiles to L2 ("medium"). L3 is reserved for the service-coverage gate landing in Step 10 — it should feel earned, not granted. `BUILDING_COLORS` / `BUILDING_DIMS` keep their L3 entries as forward-compat. See memory: feedback_high_density_gate.

### Step 8 — Vehicles + A* pathfinding

- New `simulation/RoadGraph.ts` — adjacency list keyed by tile flat index. `rebuild(grid)` walks `Grid.iterRoadEdges`, classifies each edge as orthogonal (`w=1`) or diagonal (`w=√2`), and pushes both directions into a `Map<number, Neighbor[]>`. Called from `Game` after every road or bulldoze stroke that changed road state. Full rebuilds are sub-millisecond at this scale; not worth incremental updates.
- New `simulation/Pathfinding.ts` — vanilla A* with Euclidean heuristic in tile units. `gScore` / `fScore` / `cameFrom` Maps + open Set are reused across calls so only the returned path array allocates. Open-set pop is a linear scan over the Set — promote to a binary heap if a fully-developed Medium map ever bottlenecks here.
- New `simulation/Vehicles.ts` — `Car` is `{pathTiles, segmentIdx, segmentT, speed, color}`. Two entry points:
  - `update(dt, gridWidth)` — render-rate. Advances `segmentT` by `(speed × dt) / segmentLength`, splices arrived cars off the back. Smooth animation regardless of sim tick rate.
  - `spawnTick(dtMs, ...)` — sim-rate. Every `SPAWN_INTERVAL_MS` (1.5 s) it tries one spawn under the `MAX_VEHICLES` cap. Picks a random developed R via reservoir sampling, picks a random developed C/I (50/50), finds nearest 4-connected road for each, runs A*, and pushes the car if a path exists.
- `Renderer.updateCars(vehicles, gridWidth)` — single `InstancedMesh` (capacity 80, low-poly box, flat-shaded) sized once at construction. Each render frame: lerp `(ax, az) → (bx, bz)` by `segmentT`, set yaw from `atan2(dx, dz)`, write matrix + per-instance colour, set `count = cars.length`. Reuses scratch `Object3D` and `Color` to avoid per-car allocations.
- `Game.startLoop` now drives both rates: sim-rate `spawnTick` inside the fixed-step accumulator, render-rate `update` + `updateCars` once per frame. Decoupled cleanly so 10Hz spawning never feels stuttery and 60Hz movement never makes spawning rare.
- Cars don't validate paths against road changes mid-trip — bulldozing under a moving car briefly shows it driving on grass before it finishes the path. Acceptable for prototype; if it bothers us, validate on graph rebuild and either re-path or despawn.

### Step 9 — Economy

- New `simulation/Economy.ts`. Holds the treasury (`$50,000` start), three R/C/I tax rates as percent (defaults 9 / 10 / 11), and last month's revenue / expenses cache for the budget panel.
- `tick(dtMs, grid, population)` accumulates real-time milliseconds and fires a "monthly settlement" every `MONTH_MS = 20_000` (20 s real-time). Settlement: `revenue = Σ residents × taxR + jobs × taxC/I`, `expenses = roadEdges × maintenance`, treasury += net.
- Tax rate also drives demand. `Economy.taxDemandPenalty(zone)` returns `(rate − 9) / 30`, subtracted from the base demand in `Population.recomputeDemand`. Sweet spot at 9% leaves R unchanged; rates above sweet spot drag demand, rates below give it a small boost. Means cutting taxes is a real tool for forcing growth, but you pay for it monthly.
- `Population.tick(grid, economy)` now takes an Economy reference. `Game.startLoop`'s sim tick calls them in order Population → Development → Economy → Vehicles so each step has fresh inputs.
- HUD: new `#hud-treasury` button (mono pill, monospace tabular nums, red on negative balance) sits between RCI and FPS. Clicking it calls `Game.toggleBudget()` which closes the tile-info panel and opens / closes the budget sheet.
- `ui/BudgetPanel.ts`: slide-up sheet showing treasury, last income, last expenses, net, current month, plus three R/C/I sliders (range 0–25%). Slider `input` events write directly to the Economy in real time so demand reacts as the player drags.
- Going broke is a fail-state but recoverable per spec — we just let balance go negative; no game over.

**Tuning notes for later steps:**
- 20 s/month → ~3 months/min. Felt like a good cadence on Pixel 7. Will tune again once Step 10 services add monthly upkeep.
- Tax sweet spot at 9% may be wrong; revisit when L3 unlocks change the population scale.

### Step 10 — City buildings + service coverage

- New `Building` type (`'power_plant' | 'water_tower' | 'park' | 'bus_stop' | 'bus_depot' | 'none'`), single-tile, mutually exclusive with road and zone. Costs/upkeep tables in `types.ts`.
- Five new place-tools added to the `Tool` enum (`place_power`, `place_water`, …) and the toolbar. Tap places one building per touch (no drag-paint — feels right for unique-position buildings).
- `Game.placeBuilding` validates: tile is free + treasury can afford. Deducts cost. Then calls `services.recompute(grid)` to refresh coverage flags and `renderer.drawCityBuildings(grid)` to redraw.
- Bulldoze now also clears buildings. The `BulldozedSnapshot` now records the original `building` and the rubber-band restore re-places it (no refund either way — keeps the prototype simple).
- `simulation/Services.ts` does an O(buildings × radius²) sweep and writes `hasPower / hasWater / hasPark` flags onto each tile. Power and water radius = 8 tiles, park = 3 tiles.
- `Development` now reads service flags. Missing power/water multiplies the per-tick rate by 0.3 each (cumulative — both missing → 0.09× rate). The hard cap at L2 is replaced with a per-tile gate: a tile can climb to L3 only when it has all three of power, water, and park. Memory: feedback_high_density_gate is now satisfied.
- `Economy.runMonth` adds per-building upkeep to expenses, summed each rollover.
- `Renderer.drawCityBuildings` builds a single merged geometry from per-kind low-poly silhouettes (power plant = box + chimney; water tower = legs + cylinder; park = pad + tree; bus stop = pole + canopy; bus depot = orange shed). One Mesh, one draw call.
- Tile info card now reports `building` and a `power+water+park` summary line.

### Step 11 — Traffic congestion + heatmap

- Two new fields on Tile: `trafficLoad` (instantaneous count of cars currently occupying this tile) and `trafficLoadAvg` (EMA, decay=0.92, update=0.08 per sim tick).
- `Vehicles` now tracks load: `+1` on the spawn tile, swap as cars cross segments, `-1` on despawn. `update` reads the *next* tile's load and scales effective speed by `1 / (1 + load × 0.3)`. Cars piling onto the same tile see it as crowded → upstream cars slow → queue propagates.
- `simulation/Traffic.ts` runs the per-tile EMA on every sim tick and exposes `overallStress(grid)` (0..1, saturating at avg load 1.5).
- `Population.recomputeDemand` subtracts a tax-shaped traffic-stress term: R loses up to 0.5 demand to high stress, C loses 0.4, I loses 0.15. Memory: feedback_traffic_pressure is satisfied — sustained traffic actively pushes residents and shoppers away. The user has to either widen roads or add transit (Step 12) to keep growth alive.
- New HUD pill `Heat` toggles `Renderer.drawHeatmap`. The mesh is rebuilt every 200 ms (5 Hz) when visible — fast enough to track changes, slow enough to not torch GPU bandwidth. Colour ramp is green → yellow → red over EMA range [0, 2.5+].
- Cars don't currently re-path on graph changes mid-trip; tracking holds because they continue on the same `pathTiles`. Bulldozing under a queue can leave ghost cars on grass for a few seconds — known issue, acceptable for prototype.

### Step 12 — Bus system

- `simulation/Buses.ts`. Two effects:
  1. **Spawn suppression** — `nearBusStop(grid, x, y)` returns true if any `bus_stop` building sits within Chebyshev radius 4 of an R origin. When true, 70% of `Vehicles.attemptSpawn` calls bail before producing a car. That's the lever — a single well-placed stop pulls roughly 7 of every 10 trips off the road from its catchment.
  2. **Visible buses** — every `bus_depot` keeps one bus alive (cap 16 buses citywide). The bus's "route" is the full list of bus stops at spawn time; A* is rerun for each leg (depot → stop[0] → stop[1] → … → stop[0] → loop). Speed = 2.0 tiles/s, distinct yellow colour, larger silhouette than cars.
- Buses share the road graph with cars (no dedicated lanes for prototype). They contribute to traffic too — both with their physical presence and with the spawn suppression they replace.
- Routes are not user-drawn for the prototype. Step 12 polish, if needed, would add a route-drawing tool.

### Step 13 — Save/load

- `persistence/SaveGame.ts` wraps raw IndexedDB (no `idb` library — kept the dep list short). Single-slot save under key `main`, schema version `1`.
- Saved fields: per-tile `terrain / road / zone / density / pressure / building` and the road-edge list (flat `[ax, ay, bx, by, …]`); from `Economy`: treasury, three tax rates, months elapsed. Vehicles, traffic flags, and service flags are *not* saved — they're regenerated. Buses also reset (spawn anew from depots).
- `Game.init` opens IDB, attempts a load before drawing initial state. Failures (private browsing on iOS, schema mismatch) silently fall through to a fresh map.
- Auto-save every 30 s (real-time), fire-and-forget so disk doesn't block render.
- `Reset city` button at the bottom of the budget panel calls `Game.resetCity()`: clears the IDB save, then `location.reload()`. Behind a `confirm()` so it's not too easy to nuke a city.

### Step 14 — Performance pass

- Profile-driven changes were minimal because the architecture stayed lean.
- Single observed hotspot: the heatmap mesh rebuild was firing every render frame (60 Hz). Throttled to 5 Hz via `heatmapAccumMs`. EMA only moves at sim rate so the visual fidelity loss is zero.
- Build size: 528 KB raw / 135 KB gzipped. ~95% of that is Three.js core. Code-splitting later if it becomes an issue.
- Open follow-ups for a future perf pass:
  - `drawZones` / `drawRoads` rebuild full geometries per paint event. Could move to dirty-flag based incremental updates.
  - Population/Development/Traffic each iterate the entire grid every sim tick. For Large maps (256×256 = 65 536 tiles) the sweep is still sub-millisecond, but a tracked dirty-set on Grid would keep things tidy.
  - InstancedMesh `setColorAt` every render frame for cars/buses uploads the colour buffer even though colours never change. Skip after first set.

These weren't the bottleneck in testing — leaving them for a later session unless something feels off in your evaluation.

## Post-alpha pass 1 — challenge tuning + undo

User feedback after first alpha review: money felt too abundant, traffic too forgiving, no way to undo a mistake. Tuned + added undo.

**Money tightened (memory: feedback_challenge_tuning):**
- Starting treasury: $50,000 → **$15,000**.
- Per-resident tax base: $25 → **$18**. Per-job: $35 → **$25**.
- Road maintenance: $5/edge/month → **$12/edge/month**. A 100-edge city is now $1,200/month — a real budget item.
- Building costs roughly doubled (power $5K → $8K, water $3K → $4K, park $1K → $1.5K, depot $2K → $4K, stop $0.5K → $0.8K).
- Building upkeep roughly doubled (power $200 → $400, water $100 → $250, park $50 → $80, stop $20 → $60, depot $100 → $300).
- Net effect: a player can afford a small starter loop on opening day and that's it. Sprawling early bleeds the treasury.

**Traffic tightened (memory: feedback_traffic_pressure):**
- Stress saturation: avg-load 1.5 → **0.8**. Stress hits sooner.
- Demand penalty multipliers: R 0.5 → **0.7**, C 0.4 → **0.55**, I 0.15 → **0.25**.
- Slowdown formula: `1 / (1 + load × 0.3)` → `1 / (1 + load × 0.5)`. Steeper queueing — visible at load 1, painful by load 3.
- Net effect: a single congested artery pulls real demand off R and C. Bad networks visibly stall growth.

**Undo (`hud-undo` button next to treasury):**
- Game now keeps an in-memory FIFO stack of full state snapshots, capped at `UNDO_STACK_LIMIT = 20`. Snapshot = the same `SaveData` shape as IndexedDB persistence, so we get full grid + economy round-trip with one helper.
- Snapshot is pushed at the *start* of every paint stroke (road, zone, bulldoze) and every building placement.
- `handlePaintEnd` checks the per-stroke trackers — if all four are empty (paint over already-painted, bulldoze of nothing), the snapshot is popped immediately so a no-op stroke doesn't burn an undo slot.
- Failed building placements (insufficient funds / occupied tile) also pop their snapshot.
- Undo restores grid + economy state, recomputes services, rebuilds the road graph, redraws every layer, and **clears all cars + buses** (their paths reference now-stale state). They respawn within a few sim ticks.
- Slider drags don't snapshot — the user can just slide back. Auto-save is *not* an undo entry either; only deliberate operations count.
- Button is `disabled` whenever the stack is empty. Refreshed every 250 ms by the existing throttled HUD callback.

## Alpha shipped — known issues to flag in review

Things I caught during the run-through that the user will probably hit:

- **Cars on grass.** When you bulldoze a road with cars on it, they finish their existing path even if those tiles aren't road anymore. Path validation on graph rebuild is on the polish list.
- **No "insufficient funds" feedback.** Tapping a place-tool when broke just silently no-ops. A red flash on the treasury pill or a transient toast would help.
- **R demand cliff at L3.** Once a tile hits L3, demand it generated stays banked even if services drop. Demand recomputes are aggregate so a single tile losing power doesn't visibly change anything; the drop only registers if many tiles lose service.
- **Bus routes are auto-cycle.** Player can't draw their own routes. Each depot's bus visits *every* stop in spawn-time order. That's enough to demonstrate transit pressure but may feel arbitrary on big maps.
- **Map size is hard-coded to small (64×64).** Medium/large work but there's no UI to pick. Edit `main.ts`'s `MAP_SIZES.small` to test bigger maps.
- **Save schema doesn't persist current tool / camera position.** Reloading drops you on Pan tool, default camera. Not a big issue but worth noting.
- **Tile traffic load can briefly under-flow when bulldozing.** Math is `Math.max(0, load - 1)` to defend, but the EMA can decay slightly slower than ideal in edge cases.

## Post-alpha pass 2 — sim scaling fix

User playtest at pop 1,492: never hit a single traffic problem with no transit and minimal effort, treasury reached $500K. Diagnosis: the sim didn't actually scale with city size.

**Traffic was capped, not stressed.**
- Old: `SPAWN_INTERVAL_MS = 1500` was a fixed real-time interval — 1 spawn attempt per 1.5s **regardless of population**. A 100-pop city and a 1,500-pop city saw the same car volume.
- Old: `MAX_VEHICLES = 80` total cars on the entire map. With 1,500 residents, that's 1 car per 18 residents — never enough to congest anything.
- New: spawn rate scales with `Population.totalResidents`. `SPAWN_PER_RESIDENT_PER_SEC = 0.005` — 1500 residents → 7.5 attempts/sec → ~200 cars in flight at typical trip length.
- New: `MAX_VEHICLES = 250`. Big enough that a fully-developed Medium map can saturate.
- New: `Vehicles.spawnTick` takes `residents` as a parameter. `Game` passes `population.totalResidents` from the prior sim step.
- The existing `Traffic` EMA + `Population` stress penalty mechanism (R demand drag up to 0.7 at full stress) now actually engages because cars are present in volume.

**Revenue was unbounded, expenses weren't.**
- Old revenue coefs `2 / 2.5 / 2.27` cut to `1.0 / 1.25 / 1.13`. Per-capita revenue stayed proportional to taxes but at half the rate.
- New per-capita "city services" expense: `$2/resident + $1/resident per 1000 residents in the city`. So a 100-pop city pays $210/mo, a 1,500-pop city pays $5,250/mo, a 3,000-pop city pays $15,000/mo. The growth term is what creates the squeeze at scale — population alone now generates expenses, not just infrastructure.
- Road maintenance bumped $12 → $15 per edge. Sprawling networks cost meaningfully more.

Net effect at pop 1,500 (default taxes 9/10/11): revenue ~$19K/mo, expenses ~$15-18K/mo. Player has to actually optimize — raise taxes (and eat the demand drag), tighten the road network, or grow density rather than sprawl.

Bus suppression was deliberately left at 70% (user has not yet playtested transit) — a follow-up pass will dial it once they get there.

## Post-alpha pass 3 — traffic-aware spawn routing + same-segment gap

Player asked: "do drivers take different routes if traffic on one route makes the trip slower?" Old answer: no — A* used static edge weights and cars baked their `pathTiles` at spawn. Two consequences: a popular corridor jammed solid while parallel roads sat empty, and many cars on the same hot segment converged to identical world positions (visual overlap).

**Spawn-time traffic awareness:**
- `Pathfinding.findPath` gained an optional `edgeCost(from, to, base)` callback. When provided it's used in place of the static `n.w` for each candidate edge.
- `Vehicles.attemptSpawn` passes a closure that returns `base × (1 + trafficLoadAvg × CONGESTION_PATH_COEF)`. With `CONGESTION_PATH_COEF = 0.6`, a tile sitting at avg-load 1 looks 60% more expensive than empty road. Heuristic stays admissible because Euclidean distance is still a lower bound when costs only grow.
- Cars in flight don't re-plan — that's a deliberate scope choice for now (re-planning every N seconds would be ~30 lines but is a separate pass). The fact that *new* spawns route around the jam is enough to thin a hot route out over time.
- `Buses` still calls the unparameterised path API → static weights → buses don't avoid traffic. That's deliberate (transit shouldn't reroute on its own).

**Same-segment minimum gap:**
- Before each `update` pass, build a per-car `leaderT` array: for each car, the smallest `segmentT` among other cars sharing the same `(segStart, segEnd)` pair that's strictly ahead (with car-index tie-break so two cars at identical T don't gridlock pretending they're each behind the other).
- In the per-car advance, cap `segmentT` so the back car never gets within `MIN_CAR_GAP = 0.18` of its leader.
- O(n²) but at the new `MAX_VEHICLES = 250` cap that's 62K cheap inner iterations per render frame — negligible.
- This fixes the visual overlap on hot segments that pass-2's bumped car volume made glaring.

**Known leftover:** cars on **different** segments that converge on the same intersection tile can still visually overlap. Real fix is intersection control (the user's stop-signs / lights idea, queued as the next pass). For now the visual is least-bad at a 4-way junction with low through-traffic — by the time it's a problem, the player will be ready for the intersection mechanic anyway.

## Post-alpha pass 4 — big roads update

User playtest after pass 3: traffic awareness was working but the network was a flat sea of identical roads, money was still soft at high pop, and crashes weren't a thing. This pass adds three road tiers, player-placed stop signs, and collision mechanics that route around the user's intersection-control idea while keeping the simulation cheap.

**Three road tiers (`RoadType`):**
- **local** — 2-lane bidirectional. Base speed 2.0 t/s, slowdown coef 0.50, maintenance $15/edge. Default tier.
- **avenue** — 4-lane bidirectional. Base speed 2.8 t/s, slowdown coef 0.25 (so it carries roughly twice the cars before noticeable congestion), maintenance $25/edge. Wider visual.
- **highway** — 2-lane one-way. Base speed 4.0 t/s, slowdown coef 0.20, maintenance $40/edge. Distinct color, directional arrow markers along its length.

Per-tile `roadType` lives on `Tile`. `Grid.setRoad` / `Grid.setRoadEdge` take a `type` parameter; `Grid.setHighwayDir` records the flow direction on highway tiles. **Paint always wins** — painting an avenue over an existing local upgrades the tier; painting local over a highway demotes it. The trade-off is a hidden mistake risk for the player but eliminates a "you can't change this without bulldozing" friction.

**Highway one-way semantics:**
- Each highway tile has `highwayDir` (0..7 from the `Dir` enum). Set by the paint stroke: a stroke from A through B to C imprints "A → B" on tile A, "B → C" on tile B. The last tile inherits the previous segment's direction so it has somewhere to flow when extended.
- `RoadGraph.rebuild` honours direction: a directed edge X → Y is added only if every endpoint that's a highway has its direction matching the X → Y offset. So a highway flowing east exposes east-bound edges only; west-bound is silently dropped from the adjacency.
- Highway-to-local edges (on/off ramps) work in the highway's flow direction only — the local tile imposes no constraint, so cars enter and exit naturally where the geometry permits.
- A* still routes optimally over the directed graph. Pathfinding picks highways for long trips because per-tier weights are cheaper (`ROAD_PATH_WEIGHT`: local 1.0 / avenue 0.75 / highway 0.55).

**Per-tier vehicle speed:**
- Cars and buses look up the destination tile's tier each segment-cross, so a car merging onto a highway accelerates within ~one segment and decelerates the same way exiting onto a local. Free-flow speed is `tierBase × car.speed`; load slowdown applies the tier's `slowdown` coefficient.
- Buses use a `BUS_SPEED_MULT = 0.75` per-bus multiplier on top of the tier base. So a bus on local = 1.5 t/s (matches the old hardcoded value), avenue = 2.1, highway = 3.0 — transit gets a real benefit from running on faster roads.

**Collisions + stop signs:**
- A tile with **3+ incident road edges** is an intersection. When a car arrives at one without a stop sign, we roll a per-other-car collision probability: `min(0.10, otherCarsOnTile × 0.018)`. Hit means the car despawns immediately and emits a `CrashEvent`. Game drains those each render frame: `economy.recordCrash($200)` plus `developmentPressure -= 0.15` on the destination zone tile (so the business that wasn't reached visibly slows growth).
- Stop signs are a **player-placed flag** on a road tile, costing $250. Validation: tile must be a road with 3+ incident edges and no existing stop sign. Cars arriving at a stop-sign tile pause for `STOP_SIGN_PAUSE_SEC = 0.4`s; during that pause they hold their `loadedTile` count on the stop tile so other cars approaching see the wait realistically. While stopped, no collision check fires — the player buys safety with throughput.
- Buses are immune to both crashes and stop-sign pauses (professional drivers / dispatcher control). Another reason transit is a real lever once a network gets crowded.

**Economy:**
- Road maintenance is now per-tier — the existing flat `ROAD_EDGE_MAINTENANCE` was replaced by an iteration over edges that averages the two endpoints' tier maintenance, so a mixed-tier edge (e.g. on/off ramp) doesn't get a free pass.
- New fields on `Economy`: `totalAccidents` (lifetime), `accidentsThisMonth` (current month, reset on rollover), `lastAccidentCost` (settled total $ for the previous month). `recordCrash(treasuryHit)` is the public mutator.
- BudgetPanel shows an `Accidents N — $-cost` row when accidents > 0; HUD remains unchanged for now.

**Renderer:**
- Road mesh is vertex-coloured per quad — each edge picks its tier from the wider of the two endpoints' tiers; each stub from its own tile. Width scales with tier (local 0.45, avenue 0.65, highway 0.60).
- Highway tiles get a yellow flat triangle pointing in the flow direction. Stop signs are a small red disc on a grey post.
- Both extras live in a `roadOrnaments` Group rebuilt with the road mesh on every paint — sub-millisecond at prototype scale, nothing fancy needed.

**Save schema bumped to v2:**
- Per-tile snapshot adds `roadType`, `highwayDir`, `stopSign`. Economy snapshot adds `totalAccidents`.
- v1 saves silently fail to load (existing dropped per the `schemaVersion !== SCHEMA` check). The user is expected to hit "Reset city" in the budget panel for a clean playtest of the new mechanics anyway.

**Tools update:** the single `road` tool was split into `road_local`, `road_avenue`, `road_highway`. New `place_stop_sign` tool follows the place-tap pattern (no rubber-band, no drag). Toolbar layout: Pan, Local, Avenue, Highway, R, C, I, Power, Water, Park, Stop sign, Bus stop, Bus depot, Bulldoze.

**What still bothers me / next playtest worth a look:**
- Mixed-tier paint is forgiving but might surprise the user — painting a highway through an existing avenue overwrites the avenue tier. Mention if surprising.
- Collision rate `0.018` per other car is a placeholder; tune up if intersections feel too forgiving or down if early-game accidents wreck a starter city. Memory: feedback_intersection_control.
- Cars on different segments converging on the same intersection tile still visually stack — the gap maintenance is per-segment only. Real fix would be to sequence intersection arrivals (proper light/yield logic). For now the stop sign mechanic is the player's tool.
