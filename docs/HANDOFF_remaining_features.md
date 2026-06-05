# Handoff: Resorts, Hotels/Motels, Subways (+ consolidated What's New)

**Purpose:** continue the player's multi-feature batch in a fresh session.
Read `CLAUDE.md` first (as always), then this file. Everything here is
grounded in patterns established while shipping 1.9.5–1.9.12 in the previous
session.

---

## Where things stand (as of Beta 1.9.12, on `main`)

The player asked (verbatim) for this batch:

1. ✅ Remove roundabouts entirely — **done (1.9.5)**
2. ✅ Multi-block Grand Stadium — **done (1.9.6)**, polished in 1.9.10–1.9.12
   (clean geometry + night lighting + animated players)
3. ✅ 1×1 luxury home, same effects as the 2-tile pair — **done (1.9.7)**,
   omni-directional facing fixed in 1.9.9
4. ✅ More architectural variety, milestone-gated — **done (1.9.8)**
5. ⏳ **Resorts** — modular industry, ≥6 varieties by size — **NOT STARTED**
6. ⏳ **Hotels/Motels** — modular, size→airbnb/motel/hotel — **NOT STARTED**
7. ⏳ **Subways** — real transit lines — **NOT STARTED**

Current `APP_VERSION` = **1.9.12**, SW cache = **`mq-city-v47`**. Continue
numbering at **1.9.13** (Resorts), **1.9.14** (Hotels), **1.9.15** (Subways),
then **1.10.0** for the final consolidation.

The original verbatim asks for the remaining three:

> Add a new modular industry of "Resorts" that has at least 6 different
> varieties depending on how big you make it.
>
> Add a new modular industry of "Hotels/Motels" if the variety is 1x1 it's
> more of an airbnb. 1x2-1x5 makes a motel and going more 2x2 - 2x5 /
> 3x2-3x5 makes a multi story hotel. All assets need to look premium for
> this game and like it's a ready-to-launch new feature.
>
> Add real transit lines for subways.

---

## ⚠ Standing workflow rules (the player set these explicitly)

- **Complete one feature → verify in-browser → push to `main` individually →
  move to the next.** Don't stop to check between features ("just keep
  going") UNLESS the player has said to pause (they did, twice, to give
  feedback — respect that, then resume).
- **Each feature is a SILENT PATCH bump.** Bump `APP_VERSION` by a patch
  (1.9.13, 1.9.14, …) and the SW cache (`public/sw.js`), but do **NOT** add a
  `WHATS_NEW` entry yet. Player instruction: *"only add the pop-up changelog
  AFTER all of these features have been implemented so they all show as one
  update. Still push each new feature to main individually."*
- **Final step only:** after all three land, bump to **`1.10.0`** (a MINOR)
  and add **one consolidated `WHATS_NEW['1.10']` entry** in
  `src/ui/WhatsNew.ts` covering the player-facing new features (Grand
  Stadium, 1×1 luxury, architectural variety, Resorts, Hotels, Subways).
  Roundabout *removal* is cleanup — do NOT announce it.
- Every release: `npm run typecheck` must pass; verify in the browser; keep
  `CLAUDE.md` + `docs/PROGRESS.md` in sync **in the same commit** (the
  iCloud-sync rule — non-negotiable per CLAUDE.md).
- Commit trailer: `Co-Authored-By: Claude … <noreply@anthropic.com>`. Push
  straight to `main` (the player's account bypasses the PR rule; that's their
  building-phase flow).

---

## Shared pattern: modular industries (Resorts + Hotels)

Both are **single-tile building kinds placed tile-by-tile that auto-cluster
at render time** — exactly like `big_box` and `warehouse`. The template to
copy is **`big_box`** (and `warehouse`). Study these:

- **Placement:** they go through the generic `placeBuilding(kind)` flow. The
  player taps/paints individual tiles; each tile gets `t.building = kind`.
  Terrain gate lives in `Game.ts` ~line 2304 (`if (kind === 'big_box' || …)`)
  — add the new kinds there (grass/sand only, not water/forest/zoned).
- **Clustering at render time:** in `builders.ts` `buildCityBuildingsMesh`
  (~line 2186–2230), there's a dispatch:
  ```ts
  if (t.building === 'big_box') {
    const cluster = floodBuilding(grid, t.x, t.y, 'big_box', visited);
    const parts = bigBoxClusterParts(cluster, grid);
    for (const p of parts) { const g = p.makeGeom(); g.translate(p.dx,p.dy,p.dz); geoms.push(g); colours.push(tint(p.color)); }
    continue;
  }
  ```
  Add the same block for `'resort'` / `'hotel'`. `floodBuilding(grid, x, y,
  kind, visited)` returns the connected cluster (array of `{x,y}`) and marks
  them visited so they render once.
- **Cluster renderer:** write `resortClusterParts(cluster, grid)` /
  `hotelClusterParts(cluster, grid)` returning `CityBuildingPart[]`. Note the
  type difference from monuments:
  - **`CityBuildingPart`** = `{ makeGeom: () => BufferGeometry, dx, dy, dz,
    color }` (used by `cityBuildingParts` / cluster builders).
  - `VariantPart` = `{ geom: BufferGeometry, color }` (used by zoned-building
    variants + monuments like `buildGrandStadiumParts`).
  - Cluster builders use `CityBuildingPart`. Reference `bigBoxClusterParts`
    (~line 3617) and `warehouseClusterParts` for the exact shape: compute the
    cluster bounding box, do per-tile cardinal-exterior-side detection
    (a side is "exterior" if the 4-neighbour isn't in the cluster), emit
    geometry per tile so any cluster shape (L, T, U, plus) reads cohesively.
    This per-tile-exterior approach is the Beta 1.4.1 "fully modular" lesson
    — do NOT emit one bbox-spanning slab (breaks on non-rectangular shapes).
- **`box()` / `cyl()` / `cone()` helpers** are available inside builders.ts
  for `makeGeom` closures (see `cityBuildingParts`).

### Modular-industry integration checklist (do ALL for each new kind)

- `src/types.ts`: add to the `Building` union; `BUILDING_COSTS`; the upkeep
  record; the `Tool` union (`place_resort` / `place_hotel`);
  `PLACE_TOOL_TO_BUILDING`; a milestone `unlocks` list (Resorts → probably
  Metro/`metro`; Hotels → City/`city` or Town).
- `src/engine/Game.ts`: the `place_*` → label map (~line 130); the
  toolbar-ban `toolToKey` map (~line 806); the milestone unlock array
  (~line 879); the terrain-gate `if (kind === …)` block (~line 2304).
- `src/ui/Toolbar.ts`: a tool entry (put them in the **Industry** group with
  forestry/farm/big_box/warehouse) + an SVG icon.
- `src/simulation/Council.ts`: a faction-stance row. The interface field +
  all 10 faction values. (Tip from last session: the 10 stance rows have
  duplicate `mayor_mansion:`/etc anchor values, so a per-line Python insert
  after a known anchor line is cleaner than 10 `Edit`s. See the 1.9.6/1.9.8
  commits.) Resorts: Chamber/Working-Families love, Greenleaf/NIMBY mildly
  dislike (footprint), Taxpayers neutral. Hotels: similar tourism flavour.
- `src/ui/FactionDetailPanel.ts`: a display label.
- `src/engine/renderer/builders.ts`: the cluster dispatch + the
  `*ClusterParts` builder.
- **Jobs (Population):** if the building is an employment destination (it is),
  add it in `Population.tick`'s job loop — the Beta 1.6.6 pattern:
  `if (t.building === 'resort') iJobs += N;` (placed BEFORE the
  `t.zone === 'none'` early-out). Match N to implied workforce (resort ~2,
  hotel ~2, motel/airbnb ~1).
- **Tourism/revenue (Economy):** resorts especially should earn tourism. See
  the landmark-tourism sweep in `Economy.ts` (~line 256) — either extend it
  or add a parallel resort/hotel revenue line. Consider a coast/water
  adjacency bonus for resorts.
- **Car destinations (Vehicles):** add to the resident-car destination roll
  in `Vehicles.attemptSpawn` (the big_box/warehouse 6% pattern) and/or the
  `isTouristDestination` switch (~line 1788) so visitors drive there.
- **SaveGame:** NO extra work — `t.building` is serialized generically as a
  string. (Only kinds with extra per-tile *bits* — skyscraper, luxury,
  grandStadium — needed SaveGame changes.) Old saves without the kind load
  fine; a save WITH the kind round-trips automatically.

### Resorts specifics (≥6 size varieties)

Bucket by cluster **size** (`cluster.length`). Suggested 6+ tiers — make each
visibly grander, premium low-poly:
1. **1 tile** — a beach villa / cabana (small building + a couple of palms).
2. **2–3** — boutique resort (a low building + a small pool + loungers).
3. **4–6** — resort w/ a proper pool, palms, cabanas.
4. **7–10** — large resort complex (multiple buildings + big pool + paths).
5. **11–15** — mega resort (a mid-rise hotel block + lagoon pool + gardens).
6. **16+** — grand resort / water-park (slides, multiple pools, a tower).
Reuse the per-tile-exterior detection for the perimeter (low wall / palm
border) and place the "centrepiece" (pool/tower) near the cluster centroid.
Palette: warm stucco, terracotta, turquoise pool water, sand paths, palms.

### Hotels/Motels specifics (dimension-based, not size-based)

Branch on the cluster **bounding-box dimensions** (`w × h`):
- **1×1** → *airbnb*: a single premium house/unit (think a nice cottage).
- **1×N (N 2–5)** → *motel*: a long single-storey strip — room doors along
  the front, a covered walkway, a parking apron, a roadside sign.
- **M×N (≥2 in both, up to 3×5)** → *multi-storey hotel*: a taller block
  (3–5 storeys), banded windows, a lobby/entrance canopy, rooftop units.
Compute `w = maxX-minX+1`, `h = maxY-minY+1` from the cluster, pick the
archetype, then emit per-tile so odd shapes still read. Premium look is the
explicit bar — windows, signage, entrance canopy, parking.

---

## Subways (real transit lines) — the big one

Today only `subway_entrance` tiles exist (they suppress nearby car spawns,
P=0.85 within radius 6). "Real transit lines" means drawable lines +
stations + visible trains + riders actually using them. This is a **new
subsystem** — budget for it. Mirror the closest existing systems:

- **`src/simulation/Ferries.ts`** — paired docks across water with visible
  boats that run between them with dwell. Closest analogue for
  "stations + a vehicle cycling between them."
- **`src/simulation/Buses.ts`** — depots auto-cycle their stops; buses
  follow a path with sidewalk pull-over dwell; suppress nearby car spawns.
  Closest analogue for "a line with multiple stops + a vehicle cycling them
  + spawn suppression."
- **Road/path drawing** in `Game.ts` (`applyRoadStroke` / `applyPathStroke`)
  + the edge-graph (`Grid.setRoadEdge`, `RoadGraph`) — the model for a
  **drawable line** the player paints.

### Suggested scoping (smallest premium-feeling version first)

1. **Subway line data:** a per-tile `subwayLine` bit + a dedicated edge graph
   (like `bridgeRoadEdges` is a separate layer), OR reuse the
   `subway_entrance` as a *station* and let lines connect stations. A
   "Subway" paint tool draws the line (its own colour, rendered as a
   coloured track ribbon, can run UNDER roads since it's a metro).
2. **Stations:** promote `subway_entrance` to a station node on a line (or a
   new `subway_station` kind). A line needs ≥2 stations.
3. **Trains:** a new `Trains.ts` sim + an InstancedMesh in the Renderer
   (mirror buses/ferries) — a train cycles the line's stations with dwell.
   Animate at render-rate like `updateBuses` / `updateFerries` /
   `updateStadiumPlayers` (all called from the Game loop).
4. **Riders:** integrate with the pedestrian `PathGraph` / `Pathfinding` so a
   walker whose trip is long can "take the subway" — board at the nearest
   station, teleport/animate along the line, alight at the station nearest
   the destination, finish on foot. (Even a simplified version — subway
   stations strongly suppress surface car spawns and spawn train traffic —
   delivers the "real transit" feel.) Pedestrians cap is 500; trains a small
   InstancedMesh.
5. **Factions:** Transit Riders Union loves it (pro-transit keystone);
   Drivers neutral/slightly + (fewer cars); add a `subway` / line stance if
   it has a per-tile cost (per the keystone rule in CLAUDE.md).

Integration checklist is the same shape as the modular industries (types
Tool union + cost + toolbar + milestone + Game dispatch + renderer), PLUS the
new sim module + the loop wiring + (optionally) the pathfinding hook + a
SaveGame field for the line bits (a new per-tile bit DOES need SaveGame
read/write + the undo snapshot, like `bridgeRoad`).

This is the largest of the three — consider shipping it in two patches:
1.9.15 = lines + stations + trains (visible, cycling), 1.9.16 = rider
pathfinding integration, if it gets big.

---

## Verification recipe (used all last session)

- `npm run typecheck` after every change.
- Dev server: `Workflow`/preview tooling, or `npm run dev`. Load with
  **`?dev=1`** to expose `window.game` + the FPS/geom/draws overlay.
- Place things programmatically via `preview_eval` on `window.game` (the
  build flow through pointer events is fiddly): set `t.building`, `t.owned`,
  `t.terrain`, then `game.renderer.drawCityBuildings(grid, 1, 1)` and
  screenshot. For clusters, set several adjacent tiles to the kind.
- For night features: `game.timeOfDay = 0.0` (peak night), and
  `game.simSpeed = 0` to freeze the cycle for a clean screenshot (call the
  animated `update*` once directly to position instances).
- Camera: `game.camera.zoomAt(factor, screenX, screenY)` — **factor > 1
  zooms IN**, < 1 zooms OUT; anchor on the building's screen position.
- The dev "native size" viewport is unreliably tiny — use
  `preview_resize` to an explicit size (e.g. 1100×800).

## Gotchas learned this session

- **Flat-shaded lighting:** meshes use `flatShading` (normals from
  dFdx/dFdy). **Tilted** thin slabs get inconsistent/patchy shading (that was
  the stadium "lighting bug"). Prefer flat/axis-aligned surfaces; overlap
  pieces to avoid gaps rather than tilting.
- **Lit overlays vs solid geometry depth:** the night lit-overlay
  (`litWindowsMesh`, transparent) draws AFTER opaque. If a lit overlay sits
  *above* (closer to camera) a solid object, it covers it. (Stadium players
  were washed out until the field-glow overlay was lowered below them.)
- **`CityBuildingPart` vs `VariantPart`** — see above; cluster builders use
  the former, monuments/variants the latter.
- **Milestone-gated variants** (1.9.8): `Spec.minTier` + module-level
  `activeMilestoneTier` set by `setVariantMilestoneTier(milestones.earned.size)`
  from `Game.refreshToolbarLocks`. Reuse this pattern if a feature should
  unlock visuals by city tier.
- **Removing a building kind** (did it for roundabouts + 1-tile stadium):
  grep the kind across `src/`, remove every ref; old saves with the kind
  string load harmlessly (unrenderable, bulldozeable) — no schema bump
  needed when only *removing* an optional string value.

## Final consolidation (after Resorts + Hotels + Subways)

1. `src/version.ts`: `APP_VERSION = '1.10.0'`.
2. `src/ui/WhatsNew.ts`: add `WHATS_NEW['1.10']` with player-facing
   highlights for **Grand Stadium, 1×1 luxury homes, more architecture as
   your city grows, Resorts, Hotels & Motels, Subways**. (The `maybeShowWhatsNew`
   logic fires it for returning players on the 1.9→1.10 minor change.)
3. SW cache bump.
4. `CLAUDE.md` + `PROGRESS.md`: a "Beta 1.10.0" status section.
5. Push. Done.
