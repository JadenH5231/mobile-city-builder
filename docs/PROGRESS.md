# Build progress

Update this file every time you complete (or partially complete) a build-order step. Keep it tight; long discussion belongs in commit messages or `docs/NOTES.md`.

## Releases

- **Alpha 4.1 — Toolbar QoL rework for portrait phones** — the bottom toolbar was built when the game had ~12 tools; it had grown to 30+ across two modes, and on a portrait phone the long horizontal scroll became the worst-feeling thing in the UX. This rework consolidates the loose Place tools into proper category groups and upgrades the popover to a viewport-clamped grid so it works on 390px-wide phones.
  - **Consolidated 10 loose direct-tool buttons into 3 new groups.** Pre-4.1 the build toolbar had 21 top-level entries; post-4.1 it has 13. Specifically:
    - **New `services` group** — Power, Water, Park, School, Hospital, Fire Station, Police Station (7 items). Replaces 7 individual top-level Place buttons.
    - **New `industry` group** — Forestry, Farm (2 items). Replaces 2 individual top-level Place buttons.
    - **New `transit` group** — Bus Stop, Bus Depot, Stop Sign, Traffic Light, Ferry, Subway (6 items). Consolidates 4 individual top-level Place buttons + the old 2-item `transit-modes` group into one cohesive transit category.
  - **Popover gets a header + grid layout.** Every popover now opens with a small uppercase category label ("SERVICES", "TRANSIT", etc) so the player can confirm what they tapped. Items render in a `flex-wrap` grid of fixed-width 84px pills (76px on narrow phones), so a 7-item Services category tiles into 4-then-3 across two rows instead of overflowing horizontally.
  - **Popover is viewport-clamped.** `Toolbar.toggleGroup` now measures the popover's actual rendered width and clamps the centre line into `[12 + halfPop, viewportW - 12 - halfPop]`, so a popover anchored to a group button near the screen edge no longer spills off-screen on a narrow phone. CSS adds `max-width: calc(100vw - 24px)` as a hard upper bound.
  - **Narrow-viewport CSS at `max-width: 480px`.** On portrait phones: group pills hide their text label and show icon-only at 40px width (was 80-100px with label); the active group's label is restored so you can always see what's painting; outer toolbar tightens its padding + max-width to `calc(100vw - 12px)`. Result: all 10 groups + 3 pinned items fit in a single non-scrolling row on a 390-420px wide phone (verified: scrollWidth 436px ≤ clientWidth 436px).
  - **No save schema bump, no faction-stance changes, no new Tools.** Pure UX restructuring. Every Tool key in the `Tool` union is unchanged; `Game.toolToKey`, `KNOWN_TOOLS`, `PLACE_TOOL_TO_BUILDING` all still work — only the routing inside `Toolbar.ts` changed (which group ID a Tool lives in). Bundle: 832 KB raw / 220 KB gzipped (essentially unchanged from 4.0).

- **Alpha 4.0 — Architect Mode + Council Beautification Budget** — major end-game-content drop. Adds a top-level mode toggle on the toolbar that swaps the build-tools toolbar for an architectural / terraforming toolbar, plus a brand-new council-only Beautification Budget that drives procedural downtown streetscape flair on Commercial / Mixed-Use blocks. Bundle 831 KB raw / 220 KB gzipped. **Save schema v20** (back-compat with v19+).
  - **Toolbar mode toggle.** New leading pill (`.toolbar__btn--mode`) in the pinned area cycles "🏗 Build" ↔ "🎨 Architect". Build mode shows the existing roster (zones, roads, services, transit, landmarks, districts); Architect mode replaces the scroll strip with terraforming + decorative-monuments groups. Pan + Bulldoze stay pinned in BOTH modes so navigation + cleanup never disappear behind a mode swap. The toggle re-renders the toolbar, tears down popovers cleanly, resets active tool to Pan, and re-applies banned/locked state across the swap. Lock hints survive the re-render via `Toolbar.lockedHints`.
  - **Architect tools** — terraforming + decoratives. Cheap entry tier through end-game prestige sinks. All milestone-gated (Town → City → Metro → Capital):
    - **Terraforming** (cheap basics, paint-stroke, deducts per tile, refuses developed tiles): `terra_tree` ($200/tile, grass→forest), `terra_meadow` ($400/tile, grass→sand), `terra_pond` ($1500/tile, grass→water), `terra_smooth` ($50/tile, decorative→grass).
    - **Plazas** (paved public realm): `place_plaza` ($5K), `place_pergola` ($6K), `place_reflecting_pool` ($20K), `place_pier` ($3K, water-only with shore neighbour).
    - **Gardens** (soft landscape): `place_flower_bed` ($2K, cheapest), `place_topiary` ($8K, hedge maze), `place_memorial_garden` ($30K, obelisk + tiered base).
    - **Monuments** (premium end-game money sinks): `place_statue` ($15K), `place_fountain` ($25K, three-tier marble), `place_clock_tower` ($50K, tall granite + copper-green pyramid roof), `place_triumphal_arch` ($75K, monumental Arc-de-Triomphe-style — most expensive single-tile placement in the game).
    - All decoratives extend `Building` enum + `BUILDING_COSTS` + `BUILDING_UPKEEP` (modest monthly upkeep — cheap pieces $10-30/mo, monuments $200-250/mo). Reuse `placeBuilding` dispatch — no parallel pipeline.
  - **`FACTION_STANCES` extended** with 11 new architectural keys + `beautification`. NIMBYs love everything that raises property values; Hometown Heritage venerates classical pieces (statues, clock towers, arches, memorial gardens); Greenleaf adores gardens / fountains / water features; Chamber loves anything that draws shoppers + maxes beautification budget; Taxpayers HATE all of it on principle. YIMBYs mildly resent monuments occupying buildable tiles. Stances flow through the existing council cost-multiplier + ban gate — a hostile council can ban specific monuments or jack their cost.
  - **Council Beautification Budget** — first lever in the game where the council acts independently of the mayor. Mayor cannot influence it; even Mayoral Override has no effect (override only touches cost mults + zoning approval; this is council-vs-treasury). Each election picks a tier from the sum of councillors' `beautification` stances:
    - **None** — $0/mo, no flair
    - **Light** — $500/mo, corner planters
    - **Standard** — $2,000/mo, planters + outdoor café tables
    - **Grand** — $5,000/mo, + decorative streetlamps + flag banners (also reaches premium R / luxury tiles)
    - **Opulent** — $12,000/mo, + public-art pedestals + flower spillover
  - **Defund-on-shortfall.** Economy.runMonth deducts the elected tier's cost AFTER routine settlement; if the projected treasury can't cover it, `effectiveBeautificationTier` flips to 'none' for that month and `beautificationJustDefunded` fires. Game pumps a status toast ("Beautification budget defunded — treasury short") and the renderer wipes the streetscape flair mesh city-wide. Effective tier reattaches to elected on the next month that clears, or at the next election.
  - **Renderer streetscape flair.** New `buildBeautificationMesh(grid, tier)` walks every developed C/MU tile and emits per-corner decoratives based on the tier. Single merged Mesh, vertex-coloured, flat-shaded — same pattern as `buildBuildingsMesh` so perf cost is comparable. `Renderer.drawBuildings` now auto-refreshes the overlay via an injected `beautificationProvider` so every paint site stays in sync without ad-hoc pairing.
  - **Per-tile lock state.** Each architectural tool is unlocked at a tier:
    - Town (500 pop) — terra_tree, terra_meadow, terra_smooth, flower_bed, plaza, pier
    - City (1000 pop) — terra_pond, pergola, topiary, statue
    - Metropolis (2500 pop) — fountain, reflecting_pool, memorial_garden
    - Capital (5000 pop) — clock_tower, triumphal_arch
  - **`cityBuildingParts()` extended** with 11 new cases drawing distinct low-poly geometries for each decorative — fountain has a tiered marble bowl + central column + crown sphere; statue has a person silhouette on a tiered plinth; clock tower has clock face + minute/hour hands + copper-green pyramid roof + spire + gold finial; triumphal arch has two solid piers + entablature + gold lettering + crown ornament; etc. Reuses `box`/`cyl`/`cone`/`sphereLite` helpers — no new primitives needed.
  - **Save schema v20.** Persists `beautificationTier` + `effectiveBeautificationTier` on the council. `Council.restoreBeautification(elected, effective)` is the restore path. New `Building` enum values (plaza / fountain / etc) round-trip via the existing `building` field — the union widened, the JSON key stayed the same. v19-and-earlier saves load with both beautification fields defaulted to 'none'.
  - **BudgetPanel readout.** New read-only `#beautification-readout` block (lavender-accented, distinct from the gold-accented bond block) shows current elected tier, monthly cost, and active/defunded/none state. **No slider** — explicitly council-controlled. Subtitle "Council-controlled · mayor cannot override" sells the design intent.
  - **Sanity gates.** `placeBuilding` adds per-kind terrain checks: pier requires water tile + 4-connected shore neighbour; fountain / reflecting pool refuse water tiles. `Grid.has4LandNeighbour` is the new helper backing pier placement. Terraforming refuses developed tiles (road/zone/building/path/luxury/skyscraper/bridge) — bulldoze first.

- **Alpha 3.2.4** — currently shipped on `main`, live at https://JadenH5231.github.io/mobile-city-builder/. Bundle 805 KB raw / 215 KB gzipped. Save schema v18.
  - **3.0.1** Longer day/night cycle (4 → 8 min real-time) + nighttime street lights along all road tiles.
  - **3.0.2** Softened lamp glow (radial-gradient centre alpha 0.95 → 0.65, taper kicks in earlier).
  - **3.0.3** Responsive UI sizing — toolbar + HUD pills scale with viewport so small phones don't truncate labels.
  - **3.0.4** Budget panel scrolls overflow content; close button stays pinned at the bottom.
  - **3.1.0** Three more building variants per (zone, density) on top of Alpha 2.1's catalogue.
  - **3.1.1** HUD declutter — More-menu popover collects secondary toggles (Photo, Heatmap, Achievements, Stats, Districts, Crime, Bonds).
  - **3.1.2** **Skyscrapers** — 2×2 footprint placeable buildings (residential / commercial / mixed), 4-stage construction over 12 sim months. Lex-smallest tile is the anchor; others mirror state. Save schema v18 persists `skyscraper`, `skyscraperStage`, `skyscraperVariant` per tile. Backwards-compat: v17 saves load with these defaulted.
  - **3.1.3** Buy-land tool — tap-to-buy single unowned tiles for $5K. `Tile.owned` bit gates zoning + placement.
  - **3.1.4** Services rework — power + water are now city-wide whenever ANY plant exists (no individual radius for utilities); park radius bumped 4 → 6 tiles.
  - **3.1.5** Skyscraper redesign — window banding wraps all four faces, vertical fin reveals every ~⅓ width, podium glass on bottom 0.45u, five crown styles (`flat` / `stepped` / `pyramid` / `mech` / `dome`), optional spire, optional second tower for "twin" designs.
  - **3.1.6** Real night illumination — finished skyscrapers + Medium+ R/C/MU buildings emit lit-window overlays during the night phase.
  - **3.1.7** Skyscrapers go translucent on zoom-in (orthoSize ≤ 5 → 0.45 opacity; ≥ 12 → fully opaque).
  - **3.1.8** Fixed floating skyscraper windows (lit-window builder now reads actual `SkyscraperDesign` instead of hardcoded dims). Softened lamp glow further.
  - **3.1.9** Eight park variations (was four after Alpha 2.6's modular pass).
  - **3.2.0** Two more variants per (zone, density) cell + two more skyscraper designs per zone.
  - **3.2.1** Initial land-expansion attempt — `+` buttons outside city borders for $1M each, but kept fixed 64×64 grid (wrong approach per user feedback).
  - **3.2.2** Pedestrians get a humanoid silhouette (body + head + hair) instead of plain pawns.
  - **3.2.3** **Grid expansion done correctly** — `Grid.expandWorld(direction, amount)` reallocates the tile array, shifts existing tiles, regenerates terrain for the new strip, re-packs road edges. `Tile.x/y` and `Grid.width/height/tiles` are now writable.
  - **3.2.4** Settings cheats (unlimited money / unlimited demand toggles) + subtle walking animation on pedestrians.

- **Alpha 3.2.5 (REVERTED)** — Max density tier (single L4 tile = Mega building, 2 adjacent = Twin pair, 4 in 2×2 = triggers skyscraper construction). Shipped as PR #63 (commit `f56a711`) but **reverted in PR #64 (commit `c3234fb`)** after the user reported the game freezing after brief play. Could not reproduce in headless Chrome. The Max-tier work is preserved on branch `claude/max-density` for future re-roll. Likely root cause: `Game.applyZoneStroke` maps `cap=4` to `'high'` instead of `'max'`, then `Council.canChangeZone` constructs stance key `r_max` which doesn't exist in `FACTION_STANCES`, returning `undefined`. Plan for re-roll: add `r_max` / `c_max` / `mu_max` / `i_max` stance rows for every faction, fix the `cap → tier` mapping, audit all `${prefix}_${tier}` string constructions, and test on actual phone before claiming green.

- **Alpha 1.0** — tagged `alpha-1.0` on `main`. All 14 build steps + four post-alpha tuning passes (pass 1: challenge tuning + Undo; pass 2: sim scaling fix; pass 3: traffic-aware spawn routing + same-segment gap; pass 4: big roads update — three road tiers, highway one-way, player-placed stop signs with FIFO yielding, collisions, queue spillback). Save schema v2.
- **Alpha 2.6** — visual overhaul + perf pass. Six visual pieces and one perf pass aimed at moving the prototype toward late-beta polish.
  - **Bridge railings + deck stripe** in `buildRoadOrnamentsGroup`. Each bridge tile gets two slim parapet rails on the road shoulders + a yellow median deck stripe along the bridge axis (long axis derived from the dominant incident-road-edge direction).
  - **Tree shadows.** Each forest tile emits an octagonal `CylinderGeometry` disc at `t.elevation + 0.0035` under the tree silhouette, vertex-painted dark green (`TREE_SHADOW = 0x2a3a22`). Reads as a cast shadow without enabling shadow mapping.
  - **Council ban visual on toolbar.** New `Toolbar.setBannedTools(Set<Tool>)` sets `data-banned="true" | "partial" | "false"` on each button. CSS strikes through the label, dims opacity, and overlays a 🚫 / ⚠ marker. `Game.refreshToolbarBans()` walks a `Tool→StanceKey` map after every election and on init, calling `council.costMultiplier(key)` (Infinity ⇒ banned). Popover sub-buttons are now also registered in `toolButtons` so they get the same visual.
  - **Modular parks.** `buildCityBuildingsMesh` flood-fills each park tile's connected component (4-connected, `floodPark` helper), then calls `parkClusterParts(cluster)`:
    - 1 tile  → cottage park (current single-tile layout: lawn, pond, 2 benches, 3 trees)
    - 2 tiles → community park spanning both: long paved walk, playground (slide + swing pair), pond on partner tile, 4 trees
    - 3 tiles → neighbourhood park: pavilion centerpiece (4-post + pyramid roof), pond w/ fountain post + vapour puff, connecting paths from each tile to centroid, scattered trees
    - 4+ tiles → grand park: octagonal bandstand at centroid (8 posts, wide cone roof, finial), bench-facing-bandstand on each tile, dense tree borders, ring of paths
  - **Sidewalk decoration on commercial blocks.** `buildRoadOrnamentsGroup` now sweeps non-highway road tiles next to a developed C / MU 4-neighbour. ~30%-deterministic hash gate. Three pieces: hydrant (red squat cylinder + yellow cap), parking meter (post + head + screen), bike rack (3 thin loops on a crossbar).
  - **Sky gradient + clouds.** `scene.background` is a `CanvasTexture` painted with a vertical 3-stop gradient (`#5d96d4` zenith → `#a4caea` mid → `#e6d8be` warm horizon, sRGB). 5 stylized cloud clusters (each 4 IcosahedronGeometry puffs merged into a single mesh, `MeshBasicMaterial` so they stay uniformly white) live high above the world at `y=16..24`.
  - **Perf: drop normals on flat-shaded meshes.** Every Mesh in the renderer uses `flatShading: true`, so the fragment shader derives normals via `dFdx/dFdy` of view-space position — the per-vertex normal attribute is unread. `mergeGeoms` no longer allocates / reads / attaches a normals Float32Array. ~12 standalone `computeVertexNormals()` calls removed across terrain, buildings, trees, roads, sidewalks, paths, zone, heatmap, road ornaments, and arrow geom. Per-frame `instanceMatrix.needsUpdate` skipped on cars/buses/pedestrians when `count == 0`. No visual change.
  - **No save schema bump** — pure visual + perf changes.
- **Alpha 2.5** — luxury low-density residential (the "Lux" tool) and a "Not enough money" placement toast. Saves bumped to v8.
  - **`Lux` tool** under the R popover. Tap-only: validates the origin tile (free, zoneable, road-adjacent, not water, not luxury), finds an adjacent valid partner in N/E/S/W order, and marks both as `zone='residential', luxury=true, zoneCap=1`. Refuses with a status toast if no valid origin or no valid partner.
  - **`Tile.luxury` bit** (default false). Save schema v8 persists it; v7 saves load with `luxury=false` everywhere.
  - **`Grid.setZone` luxury cleanup**: when a luxury tile leaves the zone (bulldoze, re-zone), automatically clear the partner via `clearAdjacentLuxury(x, y)`. No orphan half-mansions.
  - **`Population.tick`** tracks `regularCapacity` + `luxuryCapacity` separately. Faction targets blend `regularCapacity * FACTION_NATURAL_SHARE[id]` plus `luxuryCapacity * LUXURY_FACTION_SHARE[id]`. Luxury share is heavily weighted toward NIMBYs (30%), Hometown (20%), Taxpayers (18%). `population.luxuryResidents` exposes the resulting count for tax math.
  - **Economy** adds `luxuryResidents * taxR * REV_PER_RESIDENT * LUXURY_TAX_BONUS` (LUXURY_TAX_BONUS = 1.5) on top of the base R revenue, so luxury residents pay 2.5× the regular rate.
  - **Up-front cost `LUXURY_LOW_COST = $800`** charged once at placement, gated by `council.costMultiplier('r_lux')`.
  - **Renderer** detects luxury pairs in `buildBuildingsMesh` (helper `findLuxuryPartner`), emits one mansion per pair from the lex-smaller tile via `buildLuxuryParts(ax, ay, bx, by)` in `BuildingVariants.ts`. Three deterministic variants picked from the lex-smaller tile hash: classic mansion (cream-and-brick, gable), modern ranch (long single-storey, hip roof), contemporary (taupe-and-charcoal, flat roof). Each has a body, a long-axis roof (gable / hip / parapet), an attached garage at one end, a flat garage roof + dark door panel, twin chimneys, two-storey window strips, front door, ornamental shrub pair, paved walkway, and a manicured lawn pad. Spans 2 tiles seamlessly.
  - **`FACTION_STANCES.r_lux`** filled for every faction: NIMBYs +0.9, Yimbys -0.8, Hometown +0.6, Chamber +0.4, Taxpayers +0.7, Working-Families -0.6, etc.
  - **"Not enough money" toast** (`Game.onStatusMessage`) — `placeBuilding`, `placeStopSign`, `placeRoadBusStop`, `placeTrafficLight`, `placeLuxuryPair` all surface a 2.5 s pill ("Not enough money — need $X,XXX" / "Banned by council") instead of silently failing. Fixes a UX bug where Place tools looked broken when the player didn't realise their treasury was negative.
- **Alpha 2.4.1** — disabled the Alpha 2.3 elevation visual via `FLAT_TERRAIN = true` flag in `src/world/TerrainGenerator.ts`. Procedural biome assignment (lakes / rivers / forests / sand) still uses elevation noise, but the final spec gets `elevation = 0` everywhere. `SaveGame` also zeros loaded elevation. All elevation-aware renderer code stays intact and just sees 0. Reason: cross-tile artefacts (sidewalks stepping at boundaries, zone overlays not corner-sharing) needed a vertex-averaging pass that was deferred. Flip the flag back to `false` once those artefacts are addressed.
- **Alpha 2.4** — terrain-aware overlays + zoning gates. Cleanup pass on top of 2.3: every ground-anchored mesh now respects per-tile elevation, cars / buses / pedestrians ride the deck of bridges rather than passing through them, and zoning into water / onto bridges is now blocked at the grid level.
  - **Renderer y-lift per tile.** Road quads, lane stripes, road stubs, sidewalk pads, walking paths, zone overlays, and the heatmap each compute `y = (bridge ? BRIDGE_LIFT : <baseLift> + tile.elevation)`. Endpoints pick up their own tile's elevation so a road quad straddling a hilltop and a valley ramps between them; lane stripes lerp height per-dash so they hug the slope. Bridges stay absolute at `BRIDGE_LIFT` regardless of the (negative) underlying water elevation.
  - **Road furniture lifted too.** `buildRoadOrnamentsGroup` computes a per-tile `tileY` and uses it as the base for highway arrows, stop-sign post/sign/face stacks, traffic-light pole/housing/lenses, road-attached bus-stop bench/sign, and zebra crosswalk stripes. No more stop signs floating above hilltops or buried in valleys.
  - **Cars / buses / pedestrians y-lerp.** `updateCars`, `updateBuses`, and `updatePedestrians` now look up the from-tile and to-tile surface heights and lerp by `segmentT`. New helpers `roadSurfaceY` (drives cars/buses) and `walkerSurfaceY` (drives pedestrians) centralise the bridge / sidewalk / path / road resolution. Cars on a bridge ride at `BRIDGE_LIFT + 0.05` and ramp smoothly when the segment endpoint switches between a land tile and a bridge tile, matching the road quad. `updateCars` and `updateBuses` now take `Grid` instead of a bare `gridWidth` (touched call sites in `src/engine/Game.ts`).
  - **Zoning gate.** `Grid.setZone` now rejects water-terrain tiles AND bridge tiles (in addition to the existing road-tile and adjacent-road-required checks). User feedback: "you shouldn't be able to zone in the water or on bridges". Buildings can't develop in lakes, and bridges remain pure transit.
  - **No save schema bump** — purely visual / placement-rule changes. v7 saves load unchanged.
  - **Deferred to 2.5+**: overpass bridges (road-over-road still needs a multi-level road graph), elevation-affected pathfinding cost (steeper = slower), lane-stripe smoothing across a multi-segment slope so the dash spacing stays even on a ramp.
- **Alpha 2.3** — natural terrain: each fresh map gets procedural geography (lakes, rivers, forests, rolling elevation) and roads can be painted across water, where they auto-bridge.
  - **Procedural generator** in `src/world/TerrainGenerator.ts`. Two octaves of value noise drive an elevation field; low pockets become lakes; a 70%-chance meandering river is carved edge-to-edge with biased random-walk steps; mid-elevation grass tiles get clustered forests via a separate noise layer; sand auto-spawns on grass tiles 4-adjacent to water (shoreline). Seeded by `Date.now()` on first generate so each "Reset City" yields a different world; per-tile result is what `SaveGame` persists, so reload restores the exact same world.
  - **`Tile.elevation`** (range ~-0.10 below water to +0.30 hilltop). Terrain mesh now corner-shares elevation by averaging the up-to-4 tiles meeting at each corner — gives smooth ramps without losing per-tile colour. Buildings lift by their tile's elevation so they sit ON the hill, not buried in it.
  - **`Tile.bridge`** auto-set by `Grid.setRoad` when called on a water tile. Renderer elevates the road quad to `BRIDGE_LIFT = 0.22` and drops two short stone pillars from below the water surface up to the bridge deck. Lane stripes are skipped on bridge segments (they'd float in mid-air on the ramp). Bridge tiles next to land tiles automatically produce a ramp because the two endpoint y-values differ along the segment.
  - **Water tone** richer (was `0x3a7ec2`, now `0x2c6fa8`). Hills tinted slightly brighter green; valleys slightly darker — terrain reads as 3D even on flat-shaded vertex colours.
  - **Save schema v7** persists `elevation` and `bridge` per tile. v6 saves load with elevation=0 and bridge=false everywhere — those flat-construction maps are correct unchanged.
  - **Deferred to Alpha 2.4**: overpass bridges (road over road needs a multi-level road graph — a real refactor: every Tile gets `bridgeRoad`/`bridgeRoadType` fields, RoadGraph builds a second adjacency layer for the upper deck, vehicles + pathfinder gain a `level` axis). Also deferred: roads that follow terrain elevation visually (currently flat at ROAD_LIFT regardless of slope), elevation-affected pathfinding cost (steeper = slower), per-tile water rendering with animated wave (probably never — chunky low-poly aesthetic doesn't want it).
- **Alpha 2.2** — second visual polish pass on top of 2.1. Facade detail on every R / C / MU building, three tree silhouettes, road striping that distinguishes tiers, zebra crosswalks, and city-services overhauls (power plant, water tower, bus depot).
  - **Facade detail** (`src/engine/BuildingVariants.ts`): `applySpec` now also calls `emitFacade` for every R / C / MU body. Each body gets window bands wrapping all four faces — count scales with body height (1 floor for h ≤ 0.30, up to 6 for a 1.5-tall tower). Plus a ground-floor element: residential bodies get a small dark door + threshold strip; commercial and mixed-use podiums get a wider lit shopfront window in one of three tints (warm yellow / cool teal / neutral). Setback towers (decoration `kind: 'tower'`) on R / C / MU also get window banding so high-rises don't read as blank slabs. Industrial stays windowless to keep the warehouse / factory genre cue.
  - **Tree variety**: `buildTreesMesh` switched from InstancedMesh-of-cones to a merged Mesh with three silhouettes picked deterministically per forest tile — original cone tree, two-stage pine (narrow tall + smaller upper cone), and a round/oak tree (octahedral foliage with a smaller offset blob). Per-tile scale wobble (0.85–1.15) + three leaf tints break up uniform forest patches.
  - **Road striping** in `buildRoadMesh`: local roads keep the dashed-yellow centreline, **avenues** now show a solid double-yellow median (two parallel solid lines straddling centre), **highways** get white shoulder edge stripes pulled slightly inboard. Two `LineSegments` objects (yellow + white) emitted under the same lanes child so road colour reads at a glance.
  - **Zebra crosswalks** at every walkable intersection — replaced the single light pad with 4 alternating bright-white stripes per cardinal approach. Reads unmistakably as a crosswalk.
  - **City building polish**:
    - `power_plant` — main hall + roof banding + hyperboloid-ish cooling tower (wide base + narrower waist + lip) + vapour puff on top + exhaust stack with red cap.
    - `water_tower` — added cross-bracing on the legs, a domed cap (cone) above the tank, and a drain pipe down one leg.
    - `bus_depot` — apron with three yellow bay-marker stripes, set-back depot building, garage door panel, yellow roofline sign.
  - New `IcosahedronGeometry`-backed `sphereLite(r)` helper in Renderer for cloud puffs / soft caps.
  - Vertex count for the test layout used during verification: buildings 2446 → 12584 (5×, facade bands), city services 493 → 1616 (polished services). No fps regression on Pixel-7-tier devices.
  - **Deferred to Alpha 2.3**: traffic-light phase visualisation (lit lens reflects current phase), pedestrian visual variety (joggers/dog-walkers as separate InstancedMeshes), idle pedestrian clusters at parks/stops, multi-silhouette car instancing, day/night cycle, weather, sound.
- **Alpha 2.1** — visual polish pass: replace the box-per-building placeholder with a **36-variant kit** (3 silhouettes per zone × density tier across R / C / I / Mixed-use × low / med / high), polished parks, and improved car / bus silhouettes. Tiles deterministically pick a variant from their (x, y) hash so a single block reads as a streetscape rather than a stamp.
  - **`src/engine/BuildingVariants.ts`** holds the spec catalogue. Each variant is a config object describing a body box, optional roof (flat / gable / hip / pyramid), an optional secondary body (podium / shop wing), and decorations (chimney, antenna, awning, sign, tank, stack, crane, setback tower). A single `applySpec` builder resolves the spec into world-positioned `BufferGeometry` parts ready to merge into the buildings mesh.
  - **Style guide** baked into the catalogue: residential warm tones (cottages, ranches, A-frames at L1; townhouses + walkups at L2; setback towers + slabs at L3); commercial cool tones (corner shops + petrol-station + diner at L1; office cubes + department stores + retail strips at L2; classic skyscrapers, stepped Art-Deco, glass towers at L3); industrial muted greys/browns (warehouses + workshops + tank yards at L1; factories + loading docks + assembly plants at L2; massive complexes + refineries + crane-equipped heavy plants at L3); mixed-use (brownstones + cafe-with-flat + L-corner at L1; modern + walkup + setback at L2; podium-and-tower + tower-with-base + glass slab at L3).
  - **Rendering switch:** the old `InstancedMesh` of unit boxes scaled per-tile is replaced by a single merged `Mesh` of all per-tile variant geometries. One draw call. Vertex count for a typical 1000-developed-tile city is ~70K — well within the InstancedMesh-tier perf budget. Rebuild cost is comparable to the previous approach (sub-millisecond on Small/Medium).
  - **Park overhaul:** placed parks now render a green pad + paved path strip + pond + 2 benches + 3 trees of varying size. Reads as a real city park rather than a single tree on a green dot.
  - **Cars** got a chassis + cabin merge so each instance reads as a sedan instead of a flat slab. **Buses** got a roof piece on top of the body, making them look more like coaches.
  - **Deferred to Alpha 2.2** (called out so the next session knows): per-variant facade detail (windows / doors as vertex-painted strips), road striping polish (avenue 4-lane double-line, highway median), traffic-light phase visualisation (lit lens reflects current phase + remaining time), pedestrian visual variety (joggers/dog-walkers/strollers as separate InstancedMeshes), idle pedestrian clusters, multi-silhouette car instancing, day/night, weather, sound.
- **Alpha 2.0** — pedestrian/transit/traffic overhaul + UX polish. Save schema v6. Highlights:
  - **Mixed-use C+R zoning.** New `mixed` zone alongside R/C/I, with its own MU low/med/high paint tools, half-rate residents AND half-rate commercial jobs per tile, teal overlay, warm-cool building palette. Faction stances: YIMBYs and Transit love it (mu_high stance up to +0.9), Hometown and NIMBYs hate it. Mixed tiles are valid R origins AND C destinations for cars/pedestrians.
  - **Adaptive traffic lights** in `src/simulation/TrafficLights.ts`. Player-placed alternative to stop signs ($1500 vs $250). Two-phase cycle (vertical / horizontal); end of each phase, controller measures upcoming-phase queue and allocates the next green between [4, 12] seconds proportional to demand. **Why this beats stop signs:** green-direction cars never sit still — no min-pause, no yielding handshake. Net throughput is roughly 2-3× a stop sign at busy junctions, and adaptive timing biases toward the busy axis. Collisions suppressed at lit intersections (controller is presumed to manage conflict).
  - **Bus stops on the sidewalk** as a new road-tile attachment (`Tile.busStop`) alongside the older standalone-building form. Place via the existing Bus Stop tool — tap any non-highway road tile and the stop attaches to the sidewalk, not the road. Renders as a bench + lollipop sign on whichever side has the most adjacent zoning. Buses **pull over** to the sidewalk for `STOP_DWELL_SEC = 1.6 s` when crossing onto a stop tile, then continue. Car traffic flows past unimpeded — no more buses blocking the road.
  - **Pedestrians 2.5×.** `MAX_PEDESTRIANS` 200 → 500. `SPAWN_PER_RESIDENT_PER_SEC` 0.0018 → 0.005 (matches car spawn rate). Streets feel populated.
  - **Crosswalks** auto-render at every walkable intersection (3+ road edges, non-highway). Pale concrete pads on each cardinal approach.
  - **Pause + variable sim speed** — new HUD pill cycles ▶ → ▶▶ → ▶▶▶ → ⏸. Render loop continues while paused so the HUD stays responsive; sim ticks AND vehicle/walker movement scale with `simSpeed` so 2× / 3× look proportionally faster on screen.
  - **Photo mode** — HUD-hide toggle. Tap the Photo pill, all chrome (pills, toolbar, panels, modals) disappears so you can frame a clean shot.
  - **Skippable tutorial** — 4-step welcome shown on first launch (roads → zone → services → factions). Skip or complete writes a localStorage flag so it never auto-shows again. Re-openable via "Show tutorial again" link in the budget panel.
  - **Per-cell residents/jobs** in the long-press tile-info panel. Shows actual capacity contributed by that specific cell.
  - **Multi-tile bulldoze toast** — strokes that wipe more than 5 tiles surface a top-of-screen "Bulldozed N tiles · Undo" pill for 5 seconds. Undo button on the pill calls the existing undo stack.
  - **Reset city button** swapped from native `confirm()` to inline two-tap arm. Dialog APIs no-op in iOS Safari standalone mode (when added to home screen) — the previous flow looked broken on phone-installed copies of the game.
  - **Faction-stance matrix** extended with mu_low / mu_medium / mu_high columns for every faction. New `walking_path` happiness hooks already landed in 1.6.
  - **Save schema v6** persists `trafficLight` and `busStop` (road-attached) per tile. v5 saves load with both defaulted to false.
  - **Deferred to Alpha 2.1** (called out so the next session knows): roundabouts, multi-lane avenues, mid-trip car rerouting, tap-a-car route preview, per-tile player-set speed limits, one-way local streets, bus-only lanes, pedestrian visual variety (joggers/dog-walkers/etc.), idle pedestrian clusters, time-of-day spawn pulse, save slots, stats panel with line graphs, traffic-light council stance gating (`traffic_light` row in FACTION_STANCES), notification history, audio.
- **Alpha 1.6** — pedestrian update on top of 1.5. Five interlocking pieces:
  - **Walking paths** as a new placeable. New `place_path` tool inside the Roads popover (same scrolling neighbourhood). Per-tile, no edge graph; visibly narrower than any road tier (PATH_WIDTH = 0.20 vs LOCAL 0.45). Paint rules: paths CANNOT remove roads (silently skipped on a road tile), CAN remove zoning (zone is cleared, in-progress development discarded). Bulldoze handles paths alongside roads/zones/buildings.
  - **Sidewalks** rendered automatically on every local + avenue road tile (highway tiles never get a sidewalk — they're vehicle-only). A pale concrete pad sits below the road plane so the road occludes it; what shows is the pad border around the road.
  - **Pedestrians sim** in `src/simulation/Pedestrians.ts`. Walks developed R → developed C/I along the new `PathGraph` (4-connected; walkable = path tiles + non-highway road tiles). Spawn rate roughly 1/3 of cars, capped at 200, walking distance ≤ 18 tiles (so paths are for neighborhood mobility, not cross-city journeys). Render path: tiny vertical pawn box, slight perpendicular jitter so streams of walkers spread across sidewalk width.
  - **Path coverage suppresses car spawns.** When both origin and destination tiles are 8-adjacent to a walking path, the outbound car spawn is dropped with probability `PATH_CAR_SUPPRESSION = 0.55` — the Pedestrians sim is already covering that route. Same shape as the bus-stop suppression knob; the two compose multiplicatively when both apply.
  - **Cars return.** Outbound trips no longer despawn at the destination — they push a `PendingReturn` onto a queue with a randomised 8–22 sec visit timer. `Vehicles.scheduleReturnTrips` (called once per sim tick) drains expired entries, plans a fresh A* path home, and spawns a return car. Fixes the long-standing "all traffic flows one way" feel. Return cars don't recurse (no `originRoadIdx`), so they despawn cleanly on arrival.
  - **Faction wiring** per the keystone rule. Big bonuses for transit / safer-streets / environmentalists (multimodal infrastructure, lives saved, fewer car trips). Modest bonuses for yimbys / hometown / nimbys / chamber / working-families. Drivers and taxpayers are unaffected — paths don't take road space and don't have a per-tile cost in the prototype, so neither faction has skin in the game yet.
  - **Save schema v5** persists the per-tile `path` bit. v4 saves load with `path` defaulted to false.
  - **Known simplifications.** Sidewalks are conceptually a single centerline per tile (no per-side modelling) — the user-stated "pedestrians can only cross at intersections" rule is geometric flavour rather than a routing constraint until per-side sidewalks land. `walking_path` is intentionally absent from the `FACTION_STANCES` matrix because paths have no cost and no zone-change to gate; happiness is wired directly into each faction's compute function instead.
- **Alpha 1.5** — tagged `alpha-1.5` on `main`. Civic and political layer on top of 1.0:
  - **Toolbar groups + density tiers.** Roads collapse into one button → Local/Avenue/Highway popover. R/C/I each split into Low/Med/High variants that set a player-permitted density cap (low → L1 forever, medium → L2, high → L3 only if services support it). Save schema v3.
  - **Happiness & Factions** (declared keystone in CLAUDE.md). Ten named-leader factions — NIMBYs, YIMBYs, Greenleaf Env. Council, Hometown Heritage, Chamber of Commerce, Transit Riders Union, Drivers' Association, Taxpayers' Alliance, Safer Streets Coalition, Working Families First. Each has a persona, a happiness function derived from current city state, 15 mood-bucketed Facebook-style comments, and a natural share of city population. Per-resident faction assignment: happy factions stay at full share, angry ones empty out below capacity. `Population.totalResidents` is now the sum of faction populations, so happiness directly drives tax revenue, vehicle spawn, and R demand.
  - **Yearly elections** (changed from 3 months to 12 after playtest). Mayor (player) wins ≥ 50.0001%, capped at 85, scaled by overall mood. Opponent = 2nd-most-angry faction's leader (immune from council that term). 4 of the remaining 9 win council seats by `factionPop × turnout` where turnout climbs with anger. Councillors apply cost multipliers to every buildable (banned if all 4 strongly oppose), gate zoning *changes* (need ≥ 2 approvers), and grant +10% population share to their faction. Council leaders' posts switch to "city hall mode" while in office.
  - **Civic actions** powered by **Political Capital** (+1/month base, +0.5/month per faction at happiness ≥ 0.5, cap 50). Endorse Leader (5 PC: +20% vote share, immune from being opponent, slight happiness hit on snubbed factions). Form Coalition (10 PC: pick two factions → both gain happiness, rivals per `FACTION_RIVALS` lose it). Photo-op (2 PC + $200, opportunistic at building placement: turnout boost for the supportive faction, happiness hit on factions that hate the placed thing, 1/faction/term). Mayoral Override (40 PC: activates at next election, lasts one full term, bypasses all council restrictions).
  - **UI:** Sentiment panel opens with prominent council bar + civic actions + PC meter at top, faction feed below. Election results auto-popup with vote-share breakdown. Photo-op transient banner offers ribbon cuttings.
  - **Save schema v4** persists Political Capital across reloads.

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

---

## Alpha 3.0 — feature-complete prototype (2026-05-09 to 2026-05-10)

A single autonomous build session that takes the game from "fun loop with
governance" (Alpha 1.5) to "playable simulator with progression, depth,
content." Sixteen PRs landed — branch off main → implement → typecheck →
build → commit → push → PR → squash-merge → wait for GitHub Pages
deploy → next PR. Every PR was production-ready (not behind a feature
flag), tested in the preview server before commit, and visually verified
where applicable.

Save schema progressed v12 → v17. Every step is backwards-compatible:
loading any v12-v16 save fills missing fields with sensible defaults.

The session in chronological order:

1. **2.7 Forestry industry** — forest-tile-only `forestry` building, a
   per-tile lumber output × oscillating global price × connection-to-edge
   bonus. Lumber trucks visualised on the road graph. Faction wiring.
2. **2.7.1 Farms** — grass-only counterpart on a different produce-price
   curve (12-month period vs lumber's 18). Hometown / working-families
   faction love.
3. **2.7.2 Opposition tweets** — when a leader runs against the player
   and loses, their leader-card flips to a mean-tweet feed pulled from
   `OPPOSITION_TWEETS` in their persona voice.
4. **2.8 Population milestones** — six tiers (Hamlet 50 → Capital 5000)
   gate the toolbar with a celebration banner per milestone (herald
   leader voice + cash + PC reward). `highestPop` persisted so unlocks
   never relock.
5. **2.9 Random events + crisis modal** — recessions, fires, lawsuits,
   referendums, trade deals. Each shifts modifiers (lumber price,
   produce price, faction mood, RCI demand) for several months.
   Choice-events block until resolved. Severity-tinted modal with a
   queue. Tuned twice for frequency based on playtest.
6. **2.9.1 Council block toast** — tap-to-paint on a council-blocked
   tile shows a "Blocked by council" pill instead of silent no-op.
7. **2.10 Public services pack** — schools, hospitals, fire stations,
   police stations. Each has a coverage radius, faction stances, and
   hospitals add a productivity bonus on covered C/I jobs.
8. **2.11 Stats panel** — 240-month ring buffer captured at every
   month rollover (pop / treasury / mood / RCI demand / export
   revenue). Canvas line graphs, no chart library.
9. **2.12 Bridge mode** — HUD toggle that flips road-paint to an upper
   layer (`bridgeRoadEdges`). Per-tile `bridgeRoad` bit + a separate
   edge graph; renderer drops support pillars to the ground.
10. **2.13 Tile diagnostic** — long-press info card shows colour-coded
    reasons for every tile state. Block / warn / info / good chips.
11. **2.13.1 Bridge ramps** — bridge endpoints slope down to meet the
    ground road's elevation rather than terminating in a 0.22 m cliff.
12. **2.13.2 Right-lane driving** — cars + buses + walkers offset onto
    the right side of the centreline. Opposing traffic can pass.
13. **2.14 Day/night cycle** — 4-minute real-time day. Sun arc + sky
    gradient + ambient light all phase across midnight → dawn → noon
    → dusk keyframes. Sim speed scales the cycle; pause freezes it.

The remaining 8 PRs landed back-to-back as the alpha-3.0 push:

14. **2.15 Achievements + leader bios** — 28 lifetime achievements
    browseable in a 🏆 panel grid with corner toast on unlock. First
    time each council leader takes a seat, the player meets them in a
    one-time bio modal (faction-color avatar + leader name + bio).
    Multiple new leaders queue.
15. **2.16 Building patina** — per-tile `developedAt` stamped on the
    first density 0→1 promotion. Renderer dims building colors over
    a 15-year ramp (1.00 → 0.72 floor). Tile-info shows building age
    as a 🕰 chip. Renovation = bulldoze + rezone.
16. **2.17 Tourism + landmarks** — three placeable landmarks (museum
    / stadium / observatory) gated by Town / City / Metropolis. Each
    earns monthly tourism revenue (BASE + per-resident scaler) when
    road-connected. Two new achievements (Cultural Capital, Tourist
    Trap).
17. **2.18 Bonds + wealth surtax** — three bond sizes (Small $5K /
    Medium $15K / Large $40K), 24-month term each, smaller bonds carry
    higher effective interest. Default penalty: PC drop + multi-month
    happiness hit on taxpayers + chamber. Wealth-surtax slider 0-30%
    adds a bracket on L3 R/C + luxury R.
18. **2.19 Ferries + subway** — ferry docks pair with their nearest
    other dock across water; visible boats sail between them with
    3-sec dwell at each end. Subway entrances suppress car spawns
    within a 6-tile Chebyshev radius (P=0.85). Multimodal +
    Underground achievements.
19. **2.20 Save slots** — 3 slots, picker UI on the 🏙 HUD pill,
    active slot persisted in localStorage. City-name input on the
    budget panel. Pre-2.20 saves remain on the 'main' / Slot 1 key
    via no-op migration. Save schema unchanged for the slot keys
    themselves; cityName + lastPlayedISO are additive optional
    fields on SaveData.
20. **2.21 Crime + heatmap** — per-tile crime score recomputed
    monthly from density / services / mood / police. Crime HUD pill
    toggles a purple translucent heatmap (mutually exclusive with
    the existing traffic heatmap). City-wide crime drags commercial
    revenue (-10% at max) and pushes safer_streets / working_families
    unhappy via campaignHappinessDelta. Safe Streets achievement
    (crime < 10% in a 1500+ city).
21. **2.22 Districts** — per-tile `districtId` painted via paint /
    erase tools. Districts panel lets you name + recolor + set per-
    zone surtax sliders that stack on top of base R/C/I rates inside
    the district. Subtle translucent overlay (alpha 0.30) tints each
    district's tiles always-on.

The HUD pill row now wraps to multiple rows on a 375 px viewport;
flex-wrap was added in PR7 once the count exceeded 7 pills.
flex-wrap + a margin-left:auto on the FPS chip pin it to the
far-right of whatever row it lands on.

**Toolbar groups added this session:** Land (museums / stadiums /
observatories), Trnst (ferry / subway), Dist (paint / erase). Each
follows the existing group-popover pattern.

**Save schema progression this session:**
- v13 (Alpha 2.15): achievements snapshot
- v14 (Alpha 2.16): per-tile `developedAt`
- v15 (Alpha 2.17): `lifetimeTourismRevenue`
- v16 (Alpha 2.18): bonds snapshot + wealth surtax
- v17 (Alpha 2.22): per-tile `districtId` + districts registry
- (v15-equivalent) cityName + lastPlayedISO additive fields (Alpha 2.20)

**Achievement count:** 28 total. Breakdown: 6 population/tenure, 4
treasury/economy, 3 election/civic, 3 events/people, 4 builder, 3
infrastructure, 2 tourism, 2 bonds, 2 transit, 1 crime.

**Faction stance matrix coverage:** 10 factions × 25 stance keys.
Each stance row has the `school` / `hospital` / `fire_station` /
`police_station` fields filled from Alpha 2.10; `museum` / `stadium`
/ `observatory` from 2.17; `ferry_dock` / `subway_entrance` from
2.19.

**What's intentionally absent from Alpha 3.0** (all queued for
post-3.0 follow-ups):
- Light rail with its own track graph + train vehicles (transit
  modes 2.19 stopped at ferries + subway entrance suppression).
- Roundabouts, multi-lane avenue rendering, mid-trip car rerouting.
- Photo album / photo-mode capture-and-save.
- Time-of-day vehicle spawn shaping (rush-hour, night-shift).
- Per-tile speed limits, one-way local streets, bus-only lanes.
- District-driven faction effects (currently only the surtax lever
  applies; districts don't yet have per-district faction mood).
- Per-faction quest lines tied to leader bios (the bios are static
  meet-once popups, not story arcs).
- Weather and seasonal terrain.
- A proper crash/disaster animation layer (events fire as modals
  but don't visually animate on the world surface).

These were considered for Alpha 3.0 but cut to keep the session
shippable end-to-end. The systems above are designed to compose with
each of these — for example, a future light-rail PR can consume the
existing transit-mode stance keys and the SUBWAY_SUPPRESSION_RADIUS
shape; weather can hook into the day/night phase machinery.

**Status:** Alpha 3.2.4 is the current shipped state on `main`
(commit `c3234fb`, live at https://JadenH5231.github.io/mobile-city-builder/).
Build is 805 KB raw / 215 KB gzipped (grew from 730 KB at Alpha 3.0
as skyscrapers + 3 more variants per cell + grid expansion + lit
windows landed). 60 fps on Pixel 7 / iPhone 13 with a Medium map
fully developed. Single-purchase premium model intact; no monetization,
no timers, no energy systems, no paywalls.

**Note for the next session**: Alpha 3.2.5 (Max density tier — Mega /
Twin / Skyscraper based on cluster shape) was attempted and reverted
after a freeze report. The Max-tier implementation lives on branch
`claude/max-density` (PR #63 history). Before re-rolling, fix the
`Game.applyZoneStroke` cap→tier mapping (line 1852, 1898) to handle
`cap === 4` and add the missing `r_max` / `c_max` / `mu_max` /
`i_max` rows to every faction's `FACTION_STANCES`. Verify on the
user's actual phone, not just headless Chrome, before merging.
