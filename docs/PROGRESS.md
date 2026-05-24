# Build progress

Update this file every time you complete (or partially complete) a build-order step. Keep it tight; long discussion belongs in commit messages or `docs/NOTES.md`.

## Releases

- **Beta 1.5.4 — Bulldoze icon → wrecking-ball crane** — user feedback: "Can you make the icon a wrecking ball crane instead? I think that will make the destruction more noticeable." The 1.5.3 pinned-static-icon-only treatment exposed that the old Bulldoze icon (bulldozer vehicle silhouette) didn't read as "destruction" at icon size. Replaced with a wrecking-ball crane SVG: heavy stroke for base + vertical mast + horizontal boom; thin stroke for diagonal truss brace + hoist cable; solid filled circle at the end of the cable. Reads as "demolition" at a glance. Updated in BOTH `BUILD_ITEMS` and `ARCHITECT_ITEMS` so the icon is consistent across mode switches. SW cache `mq-city-v14` → `mq-city-v15`.

- **Beta 1.5.3 — Static toolbar block goes icon-only in portrait** — user feedback: "I think the Pan Bulldoze and Build/Architect spots take up too much space, they are static so they can be smaller." On a 390px portrait phone the mode toggle + Pan + Bulldoze were eating ~200-250px of the toolbar's ~366px usable width because they kept their full labels. Build menu got the leftover ~130-150px, forcing horizontal scroll even after the 1.5.2 tightening. Fix: at `max-width: 480px and orientation: portrait`, drop the labels on `.toolbar__mode .toolbar__btn .toolbar__label` and `.toolbar__pinned .toolbar__btn .toolbar__label`, tighten padding (`0 8px`, `min-width: 40px`), tighten the right-divider margin. Static block shrinks ~200-250px → ~120-140px, freeing ~80-100px for the scrollable build menu. Mode toggle remains recognisable via its existing colour-coding (yellow = Build, purple = Architect); Pan + Bulldoze use the well-known hand-cursor / excavator icons. Landscape / desktop unaffected — labels stay because horizontal real estate isn't constrained. SW cache `mq-city-v13` → `mq-city-v14`.

- **Beta 1.5.2 — Portrait toolbar tightened (CSS only)** — new beta-user feedback: "Playing on my phone on portrait mode doesn't give enough space for the building menu. The bottom menu UI is too restrictive for vertical play." CSS-only fix in `src/styles.css`, no JS / no schema change.
  - **`@media (max-width: 480px) and (orientation: portrait)` (toolbar block):** drop the inline label expansion on the active group button. Pre-1.5.2 the active group's pill expanded to show its label inline ("Roads", "C", etc), which pushed every other pill sideways and forced horizontal scroll just to reach what you'd selected. Replaced with `box-shadow: inset 0 -2px 0 #f2c648` (yellow underline) which marks the active state without consuming horizontal layout space.
  - **`@media (max-width: 360px)` block (iPhone SE / smaller Androids):** tightened outer toolbar padding (6px side margin instead of 12), shrank group buttons (34px min-width, 6px padding, 11px font, 42px tall), compressed popover buttons from 76 × 42 to 60 × 38. So multi-tier groups (R / C / I / MU with 4-5 density tiers each) now fit a full row of tiers on a 360px-wide phone instead of wrapping to 2 rows. Popover sheet width expanded to `100vw - 12px`.
  - **`@media (max-width: 480px) and (orientation: portrait)` (HUD block):** tighter HUD pill padding (5/8 vs 6/10), smaller font (10.5px vs 11), tighter gap (4 vs 6), smaller RCI bars (8×22 vs 9×24). Keeps the HUD to a single row at 390px+ widths so it doesn't wrap to 2-3 rows and push the toolbar further from the bottom edge.
  - **Net effect on a 390px iPhone in portrait:** HUD row goes 2-3 → 1 (frees ~30-40px vertical play area), 13 toolbar entries fit without horizontal scroll, multi-tier popovers show all density tiers in a single row.
  - **SW cache `mq-city-v12` → `mq-city-v13`.** No save schema change. Bundle size unchanged (CSS only).
  - **Design principle for the next portrait-mode tuning:** inline-label-expansion on the active state is the layout-shift devil. Mark active with bottom-border / background / outline — anything that doesn't consume horizontal layout space. Otherwise selecting a tool shoves neighbouring tools offscreen and the player has to scroll just to reach what they just selected.

- **Beta 1.5.1 — Shoppers walk PathGraph instead of fanning straight** — user feedback: "When people fan out from parking lots they still need to walk towards and use normal pathing that's there for them rather than fan out in any direction." Pre-1.5.1 the `Shoppers` system used a straight-line lerp from stall to destination, so walkers visibly cut across grass / buildings / other zones. The original comment justified it as "simpler and more legible" but in a city-builder visible plausibility > shortcut-correctness.
  - **`Shoppers.spawnForParkedCar` now accepts `grid`, `pathGraph`, `pathfinder`** (passed through from `Vehicles.update`). At spawn it finds the nearest 4-adjacent walkable tile (sidewalk / path / park) to BOTH the parking lot AND the destination, runs A* on the PathGraph between them, and builds a waypoint chain `[stall, entry, ...path tiles..., approach, dest]`.
  - **`Shopper` interface restructured.** Stores `waypoints` (≥2 entries) + cumulative `lengths` + `totalLength`. `resolve` interpolates by **distance** along the chain rather than by linear lerp, so walker speed stays constant across segments of varying length. Outbound walks forward; return walks the same chain in reverse.
  - **Walking duration scales with path length** (no longer just stall→dest distance). `legSec = max(MIN_LEG_SEC, totalLength / SHOPPER_WALK_TILES_PER_SEC)`. Visit-too-short clamps legs to MIN_LEG_SEC and shrinks the middle "shopping" phase, same as before.
  - **`MAX_SHOPPER_PATH_TILES = 12` cap** protects A* expansion when destination is far. Past the cap, fall back to straight-line (rare in practice because Parking finds stalls within 3 tiles of the destination per 1.4.2).
  - **Fallback to straight-line** if any prerequisite is missing — no walkable neighbour, no PathGraph route, path too long, or any of `grid` / `pathGraph` / `pathfinder` not supplied. Preserves visual on early-game cities without paths.
  - **`Vehicles.update` signature** extended with `pathGraph?: PathGraph, walkPathfinder?: Pathfinding`. `Game.update` already had both fields wired and just plumbs them through.
  - **SW cache `mq-city-v11` → `mq-city-v12`.** Build clean. Save schema unchanged.
  - **Design principle for future "park-then-walk" mechanisms (transit, ferry):** plug into the existing PathGraph + Pathfinding wiring. Straight-line lerps look like prototype work; the network's already there, use it.

- **Beta 1.5 — Transport trucks (freight that connects I → C)** — user feedback: "Transport trucks (Fully detailed design for them to release quality standard). Transport trucks spawn from industry and bring deliveries to commercial buildings before making a return trip to industry. Transport trucks take up more space on the road and slow up traffic a bit more than a car would." Implementation reuses the existing per-frame segment-following + collision + stop-sign logic — trucks are `CarKind = 'truck'`, NOT a separate vehicle module. Code reuse > parallel sim module.
  - **Spawn model:** `spawnTruckTick` called each sim step from `Game.ts`; spawn rate scales with developed industrial tile count (`TRUCK_SPAWN_PER_INDUSTRY_PER_SEC = 0.010`). A mid-game industrial district yields ~0.4 truck spawn attempts/sec, throttled by `MAX_TRUCKS = 30` (added to `types.ts` alongside the other vehicle caps). Each spawn picks a random developed industrial tile as **origin** and a random developed commercial tile as **destination** (with big_box 2× bias for the same reason the 1.4.2 resident bias exists — big boxes get disproportionate freight).
  - **Trucks do NOT use parking lots.** The 1.4.2 `findStallNearDest` is skipped — semi-trucks deliver curbside, not in 6-stall lots.
  - **Behaviour deltas vs cars:**
    - Speed: `TRUCK_SPEED_MULT = 0.85` — 15% slower on the same road tier; preserved on return trip
    - Load weight: `TRUCK_LOAD_WEIGHT = 2` — trucks contribute 2 to per-tile `trafficLoad` (cars contribute 1). `incrementLoad` / `decrementLoad` now take an optional weight parameter; all callsites use a new `carLoadWeight(car)` helper. So a corridor of trucks visibly congests cars.
    - Dwell time: `TRUCK_VISIT_LOW_SEC = 4`, `TRUCK_VISIT_HIGH_SEC = 10` (vs cars 8–22). Trucks then queue a return trip via the existing `pendingReturns` mechanism; truck cap respected in `scheduleReturnTrips`.
  - **Visual design (release quality)** in `src/engine/Renderer.ts`:
    - Dark grey chassis (full-length base frame, 0.22 × 0.04 × 0.50)
    - Cab at the front (0.22 × 0.10 × 0.16) — slightly tall front section
    - Cargo box at the rear (0.22 × 0.15 × 0.28) — taller than the cab, classic box-truck silhouette
    - Dark windshield + side windows on the cab
    - Yellow headlights on the cab front, red taillights on the cargo box rear
    - Total truck length 0.50 vs car 0.34 — ~1.5× longer; ~10% wider
  - **Chassis colour trick:** the dark grey chassis vertex colour is baked into the vertex stream alongside white cab + cargo geometry. The body mesh's material uses `vertexColors: true`. Per-instance `setColorAt` multiplies onto each vertex's base colour — chassis (0.16 × any tint) stays dark, cab + cargo (1.0 × tint) take the fleet colour at full strength. This lets ONE InstancedMesh render trucks with mixed-colour parts; no per-instance shader logic required.
  - **`TRUCK_PALETTE`:** 7 utilitarian / delivery-fleet colours (white, silver, blue, brown, green, red, dark blue). Picked at spawn; preserved on return trip.
  - **`updateCars` branching:** the existing loop now tracks both `carIdx` and `truckIdx` separately. Cars and trucks live in `vehicles.cars` together (same array, same per-frame loop), but they write to disjoint InstancedMesh groups. Four new sibling meshes per truck (body, glass, headlights, taillights); cap = `MAX_TRUCKS = 30`.
  - **No parking, no walking shopper for trucks.** Trucks arrive at their destination's nearest road, dwell briefly, then queue a return — same despawn-and-return path that residents use when no stall is available.
  - **SW cache `mq-city-v10` → `mq-city-v11`.** Bundle +4 KB raw / +1.7 KB gzipped — lean addition. Save schema unchanged.
  - **Design principle for future "bigger" vehicle types (construction trucks, garbage trucks, etc.):** bake the always-dark parts (chassis, underframe) into the vertex colour stream so per-instance colour multiplies them to "still dark" automatically; keep the tintable parts (body panels) vertex-coloured white so per-instance colour tints them at full strength. One InstancedMesh, mixed-colour result.

- **Beta 1.4.2 — Big-box demand bump + parking lots as transit hubs** — user feedback: "If I make a big parking lot it's a little too empty. Scale up shopping trip demand for big box stores ever so slightly and make it so that if a parking lot exists citizens will also use them to park and walk to other different industrial or commercial buildings from the parking lot that way they get used a bit more." Diagnosis: big_box tiles had no spawn weighting (one commercial tile among many), and `Parking.reserveStallNear` only checked 4-adjacent tiles so any lot more than one tile from a destination was decorative.
  - **`pickRandomDevelopedTile` now takes an optional `bigBoxBias` weight** for weighted-reservoir sampling. Commercial picks use `bigBoxBias = 2`, so big_box tiles are 2× as likely to be picked among commercial tiles. With a typical city this adds 10–15 percentage points of shopping trips to big-box destinations — "ever so slightly" per the user's ask, but enough to keep large lots populated rather than empty.
  - **`Parking.findStallNearDest(destX, destY, maxRadius)`** — new method that scans expanding Chebyshev rings (r=1, 2, 3…) and returns the first available stall. Used at spawn time with `maxRadius = 3` so any commercial / industrial destination within 3 tiles of a parking lot can route through it. Old `reserveStallNear` (strict 4-adjacent) kept for back-compat documentation but no longer called.
  - **Routing-end-point change in `attemptSpawn`:** when a stall is reserved, the car routes to the **parking lot's** nearest road, NOT the destination's. So the car physically drives to the parking lot, parks at the stall, and the existing `Shopper` system walks the final leg from stall to destination (arbitrary distance — `spawnForParkedCar` already handles any leg length). Pre-1.4.2 reservation happened AFTER pathfind which only worked when the lot was visually adjacent to the destination's road; with the radius expanded to 3, the lot's distance from that road is arbitrary, so reservation must happen BEFORE pathfind. Reservation is released on any subsequent failure (no-road, no-path, same-tile) so a no-route trip doesn't leak a stall.
  - **Verified ring scan** with a unit script: 48 unique tiles within radius 3 (= 7×7 - 1 origin), no duplicates, closest-first ordering preserved. So a stall at radius 1 always wins over a stall at radius 2 / 3.
  - **What players will see:** a big-box-attached parking lot with 24 stalls (4 tiles × 6 stalls) now cycles through ~5–10× more cars at peak — visible cars in the lot at any time should match the visual size of the lot instead of being 1–2 stragglers. Standalone parking lots dropped in a commercial / industrial district now actually FUNCTION as transit hubs (citizens park there and walkers fan out to surrounding tiles) instead of being decorative.
  - **Cap stays at MAX_VEHICLES = 250**, so total cars on map is unchanged — the change re-allocates who parks where, not how many cars exist.
  - **SW cache `mq-city-v9` → `mq-city-v10`.** Save schema unchanged.
  - **Design principle for the next "park-then-walk" mechanism (subways, bike share, etc.):** the intermediate-destination must be reserved BEFORE pathfind so the route goes there, not to the final destination. The "reserve after pathfind" pattern works only when the intermediate is right at the final destination's road; once you allow any spatial separation, the car needs to know its actual route destination at pathfind time.

- **Beta 1.4.1 — Big-box fully modular (any cluster shape)** — user feedback: "the problem with big box is when it's non-rectangular. Make FULLY modular. an L shape should still make a visually appealing building for example." The 1.3.7 cohesive-rectangle rewrite + 1.3.8 polish only worked for rectangular clusters; non-rectangular shapes (L, T, U, plus, etc.) fell back to the pre-1.3.7 per-tile stamping path which emitted N copies of the same mini-store geometry. Now every cluster — rect or otherwise — emits one cohesive building whose outline traces the cluster's tile-shape.
  - **Per-tile body slabs with directional exterior insets.** Replaced the rect-vs-irregular branch in `bigBoxClusterParts` with a unified per-tile emission. Each cluster tile scans its 4 cardinal neighbours; sides facing non-cluster tiles get an inset (`SIDE_INSET=0.04` for E/W, `BACK_INSET=0.09` for N, `FRONT_INSET=0.30` for S). Sides facing cluster neighbours have **zero inset** — adjacent tile bodies abut perfectly at the tile boundary with no seam. The union of per-tile slabs traces the cluster outline.
  - **Inner-corner filler.** Where a cluster wraps around a north-side notch (3 of 4 surrounding tiles in cluster, missing tile is NE or NW of the world-grid corner), the two perpendicular exterior walls — both SIDE_INSET/BACK_INSET — don't quite meet. A small `SIDE_INSET × BACK_INSET` (0.04 × 0.09) filler box bridges the gap so the cluster reads as continuous. South-notch configs (missing BL/BR) intentionally NOT filled because the resulting FRONT_INSET (0.30) gap is a legitimate front-facade setback — an L-shaped cluster's two arms get their own storefronts facing their own aprons, mirroring how real architecture handles those footprints.
  - **Per-S-exterior-run storefronts.** Tiles with S exterior are grouped into contiguous horizontal runs. Each run gets one entry (run length 1) or two entries spaced 1/3-in from each end (run length ≥ 2). The "primary" entry (the one that gets the brand-signature accents — Target bullseye, Costco gas-station canopy, Home Depot lumber stack) lands on the east-end of the longest run. So an L with two front arms gets TWO storefronts, with primary accents on the larger arm.
  - **Per-S-exterior-tile archetype accents.** Warehouse-discount yellow corner blocks emit on each S-exterior tile's outer-front corners (only where W/E are also exterior — true cluster outer corners). Electronics window strips emit per S-exterior tile (4 windows each). Home-improvement garden display lands at the east-end of the longest S-exterior run.
  - **Per-S-exterior-run lamps.** Lamp poles emit at each run's outer front corners (pulled `SIDE_INSET` inside the run boundary so they don't float at the road seam). Runs of length ≥ 3 get an additional middle lamp. An L with two front arms has lamps on each arm.
  - **Per-tile fascia + brand stripe + corner pilasters** on every S-exterior tile. Corner pilasters are thicker at "outer" corners (W/E also exterior — true cluster boundary corners) and thinner at "inner" corners (W/E interior — meets another S-exterior tile in the same run; the thin pilaster reads as a tile-seam architectural detail).
  - **Per-tile loading-dock band** on every N-exterior tile. Adjacent N-exterior tiles produce continuous loading-dock banding along the cluster's north outline.
  - **Per-tile roof slab** with overhang only on exterior sides (interior sides abut neighbour roof tiles cleanly). Same exterior-inset rules as the body so roof traces the same outline.
  - **Side service door** lands on the east-most E-exterior tile (not the bbox east edge), centred between the cluster's north and south extents.
  - **HVAC scatter unchanged** — was already per-tile.
  - **Tested per-tile extents for 5 shapes** in a unit script (1x1, 1x2, 2x2, L, T, U). Bodies tile perfectly with no overlap at interior boundaries; insets correct on exterior boundaries; L-shape inner-corner filler covers the (0.96..1.0, 1.0..1.09) gap exactly.
  - **SW cache `mq-city-v8` → `mq-city-v9`.** Bundle 1,015 KB raw / 270 KB gzipped. Save schema unchanged.
  - **Design principle for the next modular industry:** emit per-tile geometry parameterised by which cardinal sides are exterior; group exterior tiles into runs for cluster-wide features (entries, lamps, signage). Avoid bbox-based emission unless the shape is guaranteed rectangular — the moment a player paints a non-rectangular cluster, the bbox approach either overhangs into empty tiles or falls back to N stamped mini-stores. The whole class of "big-box clusters look weird at non-rect shapes" bugs is rooted in trying to use a single bbox-spanning slab for the body.

- **Beta 1.4 — Highway redesign: bidirectional divided multi-lane** — user feedback (direct quote): "Highways are still just too confusing. They often times don't work. Can you please find a way to make a functional, beautiful, easy to use highway system once you're done?" The pre-1.4 system had layered on a lot of surface area trying to make one-way highways work — `road_highway` (auto-paired dual carriageway), `road_highway_oneway` (single-lane variant), `highway_flip` (component-wise direction reverser), `highwayDir` per-tile stamps, animated chevron arrows. In practice this still produced silent routing failures whenever the painted direction didn't match what the player intuitively expected, and the only debugging feedback was "no cars are using this highway."
  - **The fix:** drop the one-way model entirely. Highways are now a single **bidirectional** road tier that just visibly reads as a divided multi-lane road. The visual style does the heavy lifting via four layered cues at render time: a double-yellow median down the centre, white outer edge stripes, white inner lane lines suggesting one travel lane per direction, and **asphalt ramp flares at every highway↔non-highway adjacency** so the merge from local/avenue into highway has a clear visual cue.
  - **Behaviour change in `RoadGraph.rebuild`:** removed the `highwayDir !== offset` traversal check entirely. Every road edge is now symmetric in the adjacency list. Edge weight still uses the destination tile's tier (highways 0.55, avenues 0.75, locals 1.0), so A* continues to strongly prefer highways for long trips — fast routing intact.
  - **`Game.applyRoadStroke` simplified:** dropped the per-tile direction stamping AND the `computeHighwayParallelPath` auto-paired parallel lane. A highway stroke now paints exactly the tiles the player drew, all bidirectional.
  - **Retired tools:** `road_highway_oneway` (1-Way variant), `highway_flip` (direction flip). Both Tool values stay in the union for save back-compat; the toolbar surface drops the pills. `road_highway` is now the only highway tool — a single bidirectional brush.
  - **Retired helpers:** `Game.computeHighwayParallelPath` and `Game.flipHighwayDirection` deleted from `Game.ts` (~80 lines combined). Cloverleaf `setHighwayDir` calls in `placeBigBuild` are no-ops now and were removed too.
  - **Renderer changes in `buildRoadMesh` highway striping:** swapped the old "dashed white centerline" for a **double-yellow median** (matches avenue's median convention with tighter spacing for the narrower lane width) + a second pair of inner white lane lines. Old saves with `highwayDir > -1` show a faded grey single chevron as a legacy hint, but it's just decoration — the sim treats the tile as bidirectional.
  - **New: ramp flares in `buildRoadOrnamentsGroup`.** At every cardinal-adjacent highway↔non-highway edge, a slim trapezoidal asphalt extension (0.50 long, full highway width tapering to the local-road width) bridges the seam. Reads as "this is the merge ramp" without any one-way arrow.
  - **`TileInfoPanel` headline:** dropped the `→N`/`→E`/etc direction suffix on highway tiles. Just "highway road · grass" now.
  - **Save schema unchanged.** `Tile.highwayDir` is inert at runtime; old saves load and play. Players who painted deliberate one-way highways pre-1.4 will see those highways now work in both directions — which is what they were trying to achieve in the first place.
  - **SW cache `mq-city-v7` → `mq-city-v8`.** Clean tsc + build at 1,014 KB raw / 269 KB gzipped (slightly smaller than 1.3.8 because we deleted more code than we added).
  - **Design principle for the next session, from this release:** visual clarity beats simulation realism. A double-yellow median + edge stripes + ramp flares makes a player say "of course that's a highway" without reading any tutorial. The pre-1.4 one-way-arrow system was simulation-accurate (real highways are usually one-way) but visually opaque, and that gap between what the player saw and what the road graph enforced was the source of every "doesn't work" complaint.

- **Beta 1.3.8 — Big-box rotation sign fix + multi-tile cluster polish** — user feedback after shipping 1.3.7: "still very weird and not working as it should. particularly after 2x2 and beyond." Investigation traced it to a longstanding **sign bug in the position rotation formula** that's been latent since the 1.3.6 storefront-rotation pass, plus several proportions issues that only became visible at multi-tile sizes.
  - **The sign bug.** `BufferGeometry.rotateY(yaw)` in Three.js uses the convention `new_x = x·cos + z·sin`, `new_z = -x·sin + z·cos`. The per-part `(dx, dz)` offset rotation used the OPPOSITE 2D convention (`new_dx = odx·cos - odz·sin`, `new_dz = odx·sin + odz·cos`). So while a part's GEOMETRY rotated correctly to face east, the position OFFSET moved it in the opposite world direction. For 1-tile clusters the misplacement was ≤0.20 units (within the same tile, looked "slightly off but recognizable"); for 2x2 the misplacement scaled to ~0.71-1.0 units, so lamps that should be at the EAST cluster edge (when parking is east) landed at the WEST cluster edge, the entry sat on the wrong wall, etc. Mathematically the bug ONLY manifests for east/west rotations because `sin(0) = sin(π) = 0` (south/north rotations were unaffected). User testing with parking-south parking lots wouldn't have triggered it.
  - **Verified with a unit-style trace.** For a 2x2 cluster at (10,20)-(11,21) with parking east, the FIXED rotation puts the front-centre at x=11.71 (cluster east edge — correct, where the parking sits) and the lamps at x=11.81; the BUGGY formula was sending the same lamps to x=10.15 (the WEST side of the cluster, away from parking).
  - **Body height scales with footprint.** Was a flat 0.30 regardless of size; a 2x2 with the same height read as a squashed pancake. Now `sizeBonus = min(min(W,D) - 1, 4) × 0.05`, capped at +0.20 so even 5x5 doesn't tower. Min(W,D) so a 1xN strip stays at the baseline (single-bay store) — the size bump is for "warehouse" proportions.
  - **Multiple entries on widthTiles ≥ 2.** One tiny door on a 1.92-wide facade looked badly out of scale. Two entries spaced 1/3 in from each side now, mirroring a real Walmart Supercenter. Bullseye / canopy / lumber-stack accents stay only on the primary entry (`isPrimary`) so the brand silhouette stays readable.
  - **Vertical pilasters at tile seams + thicker corner pilasters.** A multi-tile-wide store no longer reads as one blank billboard — interior tile seams get thin pilasters, corners get slightly thicker accent boxes. Both use `pal.wallDark` so they read as architectural cladding.
  - **Side service door.** Multi-tile clusters get a small dark slab on the east flank — real big-boxes have a side-loading service entrance.
  - **Garden-centre wing rework for cohesive clusters.** The 1.3.7 wing search was looking at `primary.x + 1` which for a 2x2 was INSIDE the cohesive building, overlapping the warehouse. Two paths now: single-tile/irregular still gets the old wing-on-flank greenhouse + plant racks; rectangular multi-tile gets an outdoor plant display + lumber pallets + greenhouse-glass fascia accent at the east end of the store's apron. Reads as "garden centre is the east end of the store" — Home Depot does exactly this in real life.
  - **HVAC scatter mixes 4 unit types.** Was all `pal.roofAccent` uniform vent boxes; now picks deterministically between dark vent boxes / brushed-aluminum AC units / cylindrical exhaust stacks / wide flat ducts. Count bumped from 1-3 to 2-4 per tile. Roof now reads as actual industrial equipment.
  - **Lamps pulled inside the cluster.** Was at `buildingW/2 ± 0.04` (the very outer tile edge — floats at the road/parking seam); now at `± buildingW/2 - 0.08` inside the storefront. For widthTiles ≥ 3 an additional middle lamp lights the apron centre.
  - **Yellow corner accent blocks (warehouse-discount)** also pulled 0.08 inside the wall so they don't sit at the tile-boundary seam and fight with the dark-grey corner pilasters.
  - **SW cache `mq-city-v6` → `mq-city-v7`.** Clean tsc + build (`npm run build`). Save schema unchanged.

- **Beta 1.3.7 — Big-box clusters are now ONE cohesive building, not N stamped stores** — user feedback: "the big box stores are still weird. They aren't modular enough. If the stores are combined they should make a bigger more cohesive store." Right — the previous code stamped the same per-tile wall + fascia + brand stripe + roof + entry on each cluster member, so a 1×3 cluster looked like 3 identical adjacent stores instead of ONE bigger building.
  - **`bigBoxClusterParts` rewrite**: compute cluster bbox + rectangularity check (size === width × depth). For rectangular clusters emit ONE wall + ONE loading-dock band + ONE fascia + ONE brand stripe + ONE roof slab spanning the FULL bbox, sized at `widthTiles - 0.08` × `bodyHeight` × `depthTiles - 0.38`. Centroid biased back-shifted in Z so the apron stays visible in front (mirroring the single-tile -0.10 Z offset).
  - **Per-tile HVAC roof scatter**: 1-3 HVAC units per tile at deterministic-hash-derived positions on the continuous roof slab. Gives the long roof industrial texture without re-stamping the building shell.
  - **Single entry at building front-centre**: not on the lex-smallest "primary" tile (which is the back-left for a south-facing cluster). Entry is now positioned at `(buildingCX, frontZ)` so a 3-wide store reads as ONE Walmart with one entrance.
  - **Archetype facade accents** span the full building width: yellow corner blocks (warehouse-discount) at the building extents; electronics window strip with one window per ~0.25 building-width unit (so a 2-wide store gets 8 windows, a 1-wide store gets 4).
  - **Lamps at building corners** (not per-tile corners) so a wider building gets two lamps further apart, matching the apron width.
  - **Garden-centre wing** (home-improvement) still bolts to the east/west of the primary as a distinct extension.
  - **Irregular clusters** (L-shape, etc.) fall back to the original per-tile emission so a rectangular shell doesn't overhang non-cluster tiles. Detection: `sorted.length !== widthTiles × depthTiles`.
  - All this still works with the Beta 1.3.6 rotation pass — the cohesive building lands in `storeParts`, gets post-rotated as a rigid body to face the parking-lot direction.

- **Beta 1.3.6 — Big-box clusters face their parking lot (no more identical-direction stamping)** — user feedback: "the big box stores need to be able to point in different directions based on what direction you are building them. They look weird all facing the same direction." Right — the cluster builder always baked the storefront on +Z.
  - **New `computeBigBoxFrontYaw(sorted, adjacentParking, grid)`** — picks a cardinal yaw (0, π/2, π, or -π/2) from where the cluster's parking lots sit (first priority) or the nearest adjacent road (second priority), defaulting to south (yaw 0) when neither exists. Snap-to-cardinal via `cardinalYaw(dx, dy)` — the larger axis wins. Returns the world-space pivot for rotation (cluster centroid).
  - **`bigBoxClusterParts`** restructured to emit STORE geometry into a `storeParts` array and absorbed parking-lot geometry into a separate `parkingParts` array. After all parts are emitted, the rotation pass rotates each `storeParts` entry's (dx, dz) around the cluster centroid AND wraps `makeGeom` to pre-rotate the geometry by `yaw` — so the whole composition turns as a rigid body. Concat: `storeParts.concat(parkingParts)` at return.
  - **Why parking lots stay axis-aligned**: the Parking module hands cars stall coords computed from fixed `STALL_OFFSETS`. If I rotated the parking tile, the painted stripes would be in different world positions than the stall coords cars park at. Since rotation is TOWARD the parking, the relative orientation (storefront opens onto the lot) stays correct without rotating the lot itself.
  - **Verified** with math: yaw=0 → entry at z+0.22, yaw=π/2 → entry at x+0.22, yaw=π → entry at z-0.22, yaw=-π/2 → entry at x-0.22. All four cardinals lined up.
  - All archetype-specific accents (gas canopy on membership-club, bullseye on mass-merchant, garden centre on home-improvement, glass strip on electronics, yellow corner blocks on warehouse-discount) rotate with the rest of the store body.

- **Beta 1.3.5 — Parking strictness difficulty (Phase 3, completes the parking feature)** — final phase of the parking-management arc. Adds a player-facing "Parking management" setting in Settings → Simulation with four escalating levels:
  - **Off** — parking lots are decorative. `Vehicles.attemptSpawn` skips `reserveStallNear` entirely; no cars visibly park; no revenue penalty. For players who don't want parking as a gameplay element.
  - **Lenient** (default) — current behaviour. Cars use parking when available, no penalty when missing. Preserves the Phase 2 + 2.1 experience for existing players.
  - **Realistic** — cars use parking when available + commercial / mixed-use / big_box tiles WITHOUT a 4-adjacent `parking_lot` take a revenue penalty scaling with the city's under-parked fraction. Worst case: every commercial tile lacks parking → -15% commercial revenue.
  - **Strict** — same routing as Realistic but worst-case penalty doubled to -30%.
  - **`ParkingStrictness` type** added to `SettingsPanel.ts` + new `parkingStrictness` field in `SettingsData` (defaults to `'lenient'`).
  - **Settings panel UI**: new "Parking management" select in the Simulation group with each level's headline penalty in its label so the player knows what they're choosing.
  - **`Game.parkingStrictness`** field — synced from `settings.data.parkingStrictness` on boot + on every Settings panel select change. The select's change handler is wired in `main.ts` (not in `SettingsPanel.ts`) — listener reads from `select.value` directly to side-step a listener-registration-order race where the main.ts listener fires before SettingsPanel's bindSelect updates `settings.data`.
  - **Vehicles.spawnTick** receives `parking` conditionally — Off mode passes `undefined` so the reservation pipeline never engages.
  - **Economy.runMonth** receives the strictness; computes a `parkingMult ∈ [1 - max, 1]` from the under-parked fraction; applies it on the commercial-jobs revenue line right next to the existing crime + hospital multipliers.
  - **SW cache** `mq-city-v5` → `v6`.
  - Verified at iPhone 15 Pro: cycling through Off / Lenient / Realistic / Strict in the Settings select correctly updates `game.parkingStrictness` each time; build is clean.

- **Beta 1.3.4 — Parking walker (Phase 2.1: shopper completes the trip on foot)** — second-to-last piece of the parking feature. When a car parks at a stall, a **Shopper** spawns at the stall position, walks in a straight line to the actual destination tile (commercial / big_box), "shops" briefly while invisible (entered the store), then walks back to the parked car. The shopper's total duration is aligned to the car's `parkedUntil` so they despawn together.
  - **`src/simulation/Shoppers.ts`** — new module. `Shopper` struct carries `{ startX, startZ, endX, endZ, elapsed, totalSec, outEnd, shopEnd, color, yLift }`. `spawnForParkedCar(stall, destX, destY, durationMs, color, yBase)` computes leg duration from straight-line distance + a minimum-leg floor; `resolve(s)` returns the current `{x, z, yaw, visible}` based on phase boundaries. `update(dt)` ticks elapsed + despawns on `>= totalSec`. Cap at `MAX_SHOPPERS = 300` (cheap on InstancedMesh budget).
  - **`Vehicles.update`** arrival hook now also calls `shoppers.spawnForParkedCar()` alongside the `car.isParked = true` transition, passing the car's destination tile + visit duration + colour.
  - **`Renderer`** gets two new InstancedMeshes (`shopperBodiesMesh` + `shopperHeadsMesh`) — same humanoid body+head geometry as pedestrians but separate count tracking. New `updateShoppers(shoppers, grid)` mirrors `updatePedestrians`: per-shopper position from `shoppers.resolve()`, walking bob clock, yaw from travel direction, skip during the "shopping" middle phase.
  - **`Game`** owns the `Shoppers` instance, ticks `shoppers.update(dt)` next to the vehicles update, calls `renderer.updateShoppers` next to `updatePedestrians`, clears shoppers on city reset alongside vehicles/buses/pedestrians.
  - **Why a separate module instead of extending Pedestrians**: shoppers walk OFF the path graph (stall is mid-asphalt, destination is mid-building-tile). Straight-line interpolation is simpler + more legible than forcing the player to paint a sidewalk between every commercial tile and parking lot.
  - **Verified** at iPhone 15 Pro viewport — phase machine correct: halfway-out (visible, lerp midpoint, yaw toward dest), mid-shop (invisible, parked at dest), mid-return (visible, lerp midpoint, yaw toward stall).

- **Beta 1.3.3 — Big Box archetypes + parking-lot decorations + functional lamps** — visual depth pass on the new modular industry. Three layered improvements:
  1. **Five real-world store archetypes** for big_box, picked deterministically per cluster anchor (same coords → same store forever): `warehouse-discount` (Walmart-style: tan walls + blue/yellow fascia + yellow corner blocks), `electronics` (Best-Buy-style: dark grey + yellow stripe + glass-strip window facade), `home-improvement` (Home-Depot-style: orange brand stripe + taller warehouse roof + garden-centre extension on the east/west wing with greenhouse glass + outdoor plant racks + lumber stack), `mass-merchant` (Target-style: white walls + red brand stripe + rounded entry portico + concentric-circle bullseye disc above the entry), `membership-club` (Costco-style: solid blue body + minimal entry + gas station canopy with pumps on the apron). All silhouettes + palettes only — no copyrighted logos or branding. Each archetype gets its own `BIG_BOX_PALETTES` row + the cluster builder branches on archetype for the entry style + signature accents.
  2. **Parking-lot decorations**: accessible-stall blue paint + central white symbol dot on the front-row leftmost stall, painted crosswalk stripes across the median (6 short rectangles running between the two stall rows), perimeter chain-link fence on edges NOT adjacent to a big_box / road / sidewalk / another parking_lot (so a standalone lot in a grass field gets a full 4-side fence; a lot beside the store inherits the wall), corner cart corral on standalone lots, terracotta planter pots between row ends on standalone lots.
  3. **Functional lamp lighting**: parking_lot tiles and big_box clusters now register lamp positions with both `buildNightLightsMesh` (the visible pole+bulb geometry) AND `buildLampGlowMesh` (the soft radial halo). Existing day-night opacity ramp does the rest — lamps glow warmly during night phase. Big_box clusters get two front-corner halos for storefront wash; parking_lots get one far-corner halo per tile.
  - **Verified at iPhone 15 Pro**: five sites placed produced four distinct archetypes side-by-side. Switching to midnight phase shows clearly visible halo glows under every parking-lot and big-box lamp position. Build is clean.

- **Beta 1.3.2 — Big Box / Parking Lot Phase 2 (cars visibly park in stalls)** — second of three phases for the parking-management feature. Phase 1 shipped the buildables + visuals; this PR wires the actual simulation behaviour: cars going to a destination that has an adjacent parking lot reserve a stall at spawn time, drive to the destination's nearest road, and on arrival transition into a visible parked state instead of the previous despawn-and-queue-return. The visit interval is then spent visibly in the stall rather than invisibly queued.
  - **`src/simulation/Parking.ts`** — new module. Tracks 6 stalls per `parking_lot` tile (2 rows × 3 stalls, positions matching the painted stripes in `emitParkingTile`). Public API: `rebuild(grid)` / `reserveStallNear(x, y)` / `release(stall)` / `isReservationValid(stall)` / `stats()`. Reservations carry the world-space (x, z, yaw) so the renderer can position the car without a second lookup.
  - **`Car` interface** extended (`Vehicles.ts`): `parking?: ParkingStall`, `isParked?: boolean`, `parkedUntil?: number`. Existing fields untouched.
  - **`Vehicles.attemptSpawn`** now calls `parking?.reserveStallNear(dest.x, dest.y)` AFTER a successful pathfind, attaches the reservation to the new car if any. If pathfinding then fails, the reservation is released — no leak.
  - **`Vehicles.update`** gets a new parked-state branch at the top of the per-car loop: parked cars skip movement physics, just count down their `parkedUntil` timer; when it expires, the stall is released, the car despawns, and a `PendingReturn` fires with `readyAt: now` so the return car spawns on the next tick.
  - **Arrival** in `update` (end of path) now branches: if `car.parking` is set AND the reservation is still valid, transition to parked instead of the immediate despawn-and-queue. The visit interval (`CAR_VISIT_LOW_SEC` to `CAR_VISIT_HIGH_SEC`) is then spent visibly at the stall.
  - **`Renderer.updateCars`** gets a parked-state branch at the top of its per-car loop: position from `car.parking.{worldX, worldZ, yaw}` instead of segment interpolation; sibling overlays (windows / headlights / taillights / police accessories) all share the same matrix.
  - **`Game.ts`** owns the `Parking` instance, calls `parking.rebuild(grid)` everywhere `services.recompute()` runs (6 sites) so the registry stays in sync with paint / bulldoze. Passes `parking` through to `spawnTick` + `update`.
  - **Verified at iPhone 15 Pro viewport**: parking registry has the expected stall count per placed `parking_lot` tile (6 stalls each); reserved stalls show correct world coords + yaw; a synthetic parked car's matrix is written to the InstancedMesh at the exact stall position.
  - **Known follow-up for Phase 2.1**: walker for the final leg (currently the car parks, then despawns; no pedestrian completes the trip to the actual destination). Phase 3 still owed: difficulty slider for parking strictness.

- **Beta 1.3.1 — Pinch-vs-paint disambiguation (fixes "pinch placed a road" bug)** — new-user report: with the road tool selected, starting a pinch-to-zoom would place a road tile where the first finger landed because that touch had already committed before the second finger arrived a few milliseconds later. Caused by paint mode firing `onPaintStart` immediately on `pointerdown` (per a deliberate comment in `Input.ts` — "stationary tap should still mark exactly one tile").
  - **`PAINT_INTENT_DELAY_MS = 110` + `PAINT_INTENT_MOVE_PX = 6`** — new intent-detection window. On pointerdown in paint mode, we now DEFER the `onPaintStart` call: a `paintIntentTimer` is queued for 110 ms with a stored `paintIntentStart` position.
  - **Four resolutions** for the window:
    1. **Pinch arrives** (second pointer down within 110ms) → `cancelPaintIntent()` runs, no paint commits, gesture proceeds as a normal pinch.
    2. **Confirmed drag-paint** (pointer moves > 6px during the window) → `onPaintStart` fires at the original touch position, paint state activates, subsequent moves fire `onPaintMove` as before.
    3. **Window expires with one finger still down + no significant move** → `onPaintStart` fires (this is the tap-to-place case).
    4. **Fast tap** (pointer lifts before the window expires) → `onPaintStart` + `onPaintEnd` fire back-to-back so quick taps still place a tile with no perceptible latency relative to the system tap delay.
  - **Mode swap** (`setMode`) also calls `cancelPaintIntent()` so a pending paint doesn't accidentally commit after the player picks Pan / a different tool.
  - **Verified** in the Vite dev server at iPhone 15 Pro: synthetic two-finger pinch with the second finger arriving 5 ms after the first places **zero** roads. Real-touch verification needed on device.

- **Beta 1.3 — Big Box + Parking Lot (Phase 1: buildable + cluster rendering)** — first half of a three-phase parking-management feature. Phase 1 adds the two new building types as buildables + visuals + cluster behaviour; **no sim behaviour changes** yet (cars still despawn at destinations normally). Phase 2 will wire cars routing to parking lots + walking the final leg; Phase 3 adds the difficulty slider.
  - **`big_box`** — Walmart-style retail box. Modular like farm/forestry: adjacent big_box tiles flood-fill into one strip-mall composition (single continuous storefront + tar roof + red brand stripe + glass entry vestibule + cart corrals). Generates 2 commercial jobs per tile (below a zoned L1 commercial tile's 3 — deliberately low so big-box adds entry-level retail capacity without competing with downtown). $1200/tile placement, $60/tile/month upkeep. Faction-polarising: Chamber +0.7 / Working Families +0.5 / Drivers +0.6 LOVE; Hometown Heritage -0.9 / YIMBYs -0.7 / Transit -0.7 / Greenleaf -0.6 HATE.
  - **`parking_lot`** — flat asphalt tile with painted stalls (6 visible stall stripes per tile + faded yellow median + corner lamp). Stands alone OR clusters with adjacent big_box tiles for the visual composition — the big_box cluster builder absorbs adjacent parking_lots into the same paved field so there's no visible boundary. $200/tile, $12/tile/month upkeep. Drivers +1.0 LOVE; YIMBYs -0.8 / Transit -0.8 / Greenleaf -0.7 HATE.
  - Both gated to **Metro milestone tier** (alongside forestry/farm) and added to the **Industry toolbar group**. Bulldoze removes either kind normally.
  - **Faction stances**: rows added to all 10 faction tables in `FACTION_STANCES`. `FactionDetailPanel` label map extended so the panel shows "Big Box stores" / "Parking lots" correctly when a faction's strongest stance is one of them.
  - **Renderer**: new `bigBoxClusterParts(cluster, grid)` cluster builder + `parkingLotParts(cluster)` + shared `emitParkingTile(...)` helper. Cluster builder collects adjacent parking_lot tiles via the grid lookup, marks them visited so the standalone parking_lot branch doesn't double-render.
  - **Placement validation**: big_box and parking_lot reject water + forest terrain, reject already-zoned tiles, with friendly error toasts.
  - **Save schema bump v27 → v28**: pure additive — older saves load identically since neither building can have been placed in them.
  - **No behaviour changes**: cars still despawn at destinations normally. Phase 2 will introduce the parking-and-walk simulation.

- **Beta 1.2.3 — Polish pass for professional-game feel (slider tracks + paused-by-default + FPS hidden + More icon)** — full QA pass run at iPhone 15 Pro viewport (393×852) after the beta tester's "vibe coded prototype" feedback. Fix five quality bugs:
  1. **Tax sliders had invisible tracks** in the Budget panel — yellow thumbs floated in space with nothing connecting them. Caused by the slider input declaring `padding: 8px 0; height: 6px; background-clip: content-box` combined with global `* { box-sizing: border-box }`, which collapsed the content-box (where the background paints) to 0px. **Fix:** rebuild the slider with explicit `::-webkit-slider-runnable-track` + `::-moz-range-track` pseudo-elements for the visual track, and a transparent input for the hit area. Track is now visibly grey, thumb sits centered on it. Same pattern that pro web games and design systems use.
  2. **Default sim speed was Normal (▶), draining the treasury** while new players read the tutorial / explored menus — at ~$750/month bleed, a fresh $15K city is at zero before the player can build. **Fix:** change `DEFAULTS.defaultSimSpeed` to `0` (paused). Matches city-builder convention (Cities: Skylines, SimCity all start paused). Players hit ▶ when ready. Existing users with a saved setting keep their preference.
  3. **FPS counter prominent in production** — debug noise that pro games hide from end users. Also caused an awkward visible gap on the HUD's second row at iPhone 15 Pro because `#hud-fps { margin-left: auto }` pushed it right of a wrap. **Fix:** new `showFps` setting (default `false`); CSS rule `#hud-fps { display: none }` unless `body[data-show-fps="true"]` is set. Settings → Display → "Show FPS counter (debug)" checkbox toggles it on for power users.
  4. **"More" HUD pill was text-only**, inconsistent with iconified pills (Pop · 0, ☀ Day, ↻ Undo). **Fix:** `⋯ More` — small change, big consistency improvement.
  5. **SW cache `mq-city-v4` → `v5`** so installed PWAs grab fresh HTML.
  - Verified each fix in Vite dev server at 393×852 before claiming done. Slider screenshot shows visible tracks with thumbs centered correctly at 9% / 10% / 11% / 0%.

- **Beta 1.2.2 — Critical UX hotfix: toolbar pinning + photo-mode exit + close-button visibility** — three serious issues from a beta-tester report:
  1. **Toolbar at top instead of bottom (catastrophic regression I introduced in 1.2.1).** When I added `.toolbar { position: relative }` to give the fade-edge pseudo-elements a positioning context, that rule cascaded over the existing `position: fixed` because both selectors had equal specificity and mine was later in the file. Result: the toolbar dropped out of fixed positioning and rendered at its document-flow location near the top of `<body>`. This also explains "I can't even build anything" — the popovers anchor relative to where the toolbar was supposed to be (viewport bottom), so taps + popovers didn't land where the player expected. **Fix:** removed the override; `position: fixed` is itself a positioning context for absolute pseudo-elements, so the fade edges still work.
  2. **Photo mode had no exit.** A stale code comment in `main.ts` claimed "tap canvas to exit" but no such listener was ever wired. Combined with the `body.photo-mode` CSS hiding the HUD + toolbar + popovers, players entering photo mode were stuck — the only "exit" affordance (the Photo pill inside `#hud-more-popover`) was hidden too. **Fix:** new `#photo-exit` floating button — top-right with safe-area-inset awareness, large 44×44 tap target, visible only when `body.photo-mode` is on. Wired in `main.ts` with a clean `setPhotoMode(false)` handler.
  3. **Close (×) buttons hard to see on overlays.** Every close button got hardened: 44×44 (WCAG mobile target, up from 32–36 in some), high-contrast white ✕ on `rgba(20, 24, 32, 0.85)` backdrop, explicit `touch-action: manipulation`, `z-index: 3` so they never sit behind panel content, `-webkit-tap-highlight-color: transparent` so iOS doesn't paint a tap halo. Applied to `.info-panel__close`, `.tile-info__close`, `.auth-modal__close`, `.modal__close`, `.event-modal__close`.
  - SW cache bumped `mq-city-v3` → `mq-city-v4` so PWA users grab the fresh HTML.
  - Verified at 375x812 in Vite dev server: toolbar `position: fixed` with bottom-edge at y=800 (viewport 812), all 10 build groups present, Roads popover opens with 6 tools, Election Day modal close button renders at 44×44 white on dark.

- **Beta 1.2.1 — Toolbar overflow affordance on narrow phones (iPhone mini fix)** — beta-tester report: an iPhone mini user couldn't see toolbar items to the right of Bulldoze. Root cause: on a 375px viewport the toolbar scroll strip overflows (10 build groups + ~263px of hidden content), but there was no visual indication scrolling was possible. The strip was actually scrollable; the user just didn't know.
  - **Fade-edge gradients** on the right/left of `.toolbar` via `::before` + `::after` pseudo-elements. Painted only when there's content past that edge (driven by a new `data-scroll-state` attribute on `.toolbar`: `none | start | middle | end`).
  - **Tiny chevron hints** (`‹` / `›`) absolutely positioned over the fade edges. Same data-attribute-driven visibility.
  - **One-time scroll-teach animation** on first launch — when the toolbar has overflow and the player hasn't seen the hint before (localStorage gate `mqcity-toolbar-scroll-hinted`), the scroll strip gently animates 0 → 40px → 0 over 1.1s with the right chevron pulsing in sync. Teaches the gesture without ever needing copy.
  - **`Toolbar.updateScrollState()`** computes the state from `scrollWidth / clientWidth / scrollLeft`. Wired to the existing scroll listener + a new `window.resize` listener so rotation / keyboard-pop refresh it correctly.
  - **Very-narrow-phone breakpoint at `<400px`**: padding 10→8, min-width 40→36, smaller gaps. Fits ~1 extra scroll item on iPhone mini before forcing the scroll, plus tighter density on the pinned cluster (Pan / Bulldoze).
  - Verified via Vite dev server at 375x812: 10 scroll items, 263px overflow, `start → middle → end → start` state transitions all paint correctly.

- **Beta 1.2 — Theme packs (system + first free pack "Coastal Pastel")** — first cosmetic-content release. Introduces the `ThemePack` architecture: a pluggable single-source-of-truth for every dominant visual surface (terrain palette, road palette, building zone palettes, vehicle palette, flora, beautification, atmosphere — sky gradient, sun colours, fog) plus a `tint(hex)` long-tail filter that perceptually unifies the unmigrated detail colours. Stock theme = identity tint = pixel-identical to pre-1.2; Coastal Pastel ships with a Mediterranean / Aegean palette + warm hazy atmosphere + olive-grove flora. Bundle 994 KB raw / 264 KB gzipped.
  - **`src/themes/`** new module:
    - `types.ts` — `ThemePack` interface (terrain, roads, buildings, vehicles, flora, beautification, atmosphere, matcaps, moodTint, extraVariants, exclusiveMonument).
    - `stock.ts` — every previously-hardcoded constant captured as the Stock theme. Identity moodTint (strength: 0) so legacy rendering is byte-equivalent.
    - `coastalPastel.ts` — free first pack: Aegean-village vibe — whitewashed walls, cobalt + terracotta roofs, turquoise sea, sand-stone roads, olive-grove flora, warm Mediterranean sky with gentle fog haze. 12 additive variant ids (variety never decreases, only grows). Exclusive Lighthouse monument id (renderer hook lands in a follow-up).
    - `registry.ts` — `getActiveTheme()` / `setActiveTheme(id)` / `onThemeChange(handler)` / `initThemes()`. The `tint(hex)` function applies the active theme's HSL transform + mood blend to any unmigrated colour, so every asset reads as part of the theme.
  - **Renderer.ts refactor**: top-of-file `TERRAIN_COLORS / TREE_TRUNK / TREE_LEAF / TREE_SHADOW / ROAD_LANE / HIGHWAY_ARROW / STOP_SIGN_COLOR / STOP_SIGN_TEXT / PATH_COLOR / SIDEWALK_COLOR / ZONE_COLORS` all read from `THEME()`. Sky-gradient repaint takes per-theme keyframes; sun/ambient/hemisphere lighting bounds come from `atm`. Fog (Coastal only) installs an `FogExp2` on the scene. Every `colours.push(p.color)` site in `buildBuildingsMesh` and `buildCityBuildingsMesh` is wrapped in `tint()` — long-tail per-variant colours flow through the theme without touching `BuildingVariants.ts`.
  - **Vehicles.ts + Pedestrians.ts**: civilian / tourist / pedestrian palettes read from `getActiveTheme().vehicles.*` at spawn time.
  - **Renderer.refreshTheme(grid, …)** rebuilds every world mesh + re-derives clearColor / fog / sky in one call. Wired from the picker's `onApply` so swap-and-see is instant — no reload.
  - **Settings → Theme** is now the FIRST group in the Settings panel. Card grid auto-renders from the registry (`ThemePicker.ts`). Each card: hero swatch gradient (primary → mid → secondary + accent dot), name, tagline, status pill (`Active` / `Free` / `$X.XX`). Tap a card → swap + repaint.
  - Active theme persists to `localStorage` under `mqcity-active-theme`. NO save-schema bump — theme is a per-device preference (like UI scale / palette), not city data. Imported saves keep the importer's theme.
  - Architectural intent for future paid packs (Tokyo Neon, etc.): same `ThemePack` shape + a `sku` field that future Stripe-Edge-Function entitlement checks gate on. Free packs use `priceUsd: 'free'` and skip the entitlement check.

- **Beta 1.1.6 — Legal links into Settings (drop the canvas chip); Ontario governing law** — user feedback on 1.1.5: the floating bottom-left `Terms · Privacy` chip was too easy to miss and cluttered the canvas. So 1.1.6 pulls it out entirely and lands the discoverability inside Settings.
  - Removed `#legal-footer` from `index.html` and its `.legal-footer` CSS block.
  - Added a dedicated **Legal & support** group to the Settings panel with two prominent `.settings__legal-link` rows (Privacy Policy / Terms of Service) and a `hello@mqcity.app` contact line below.
  - Account & data group dropped its trailing legal blurb — its only job is now the signed-in account display + Delete-my-account button.
  - Terms section 16 jurisdiction: BC → **Ontario** (user is Ontario-based).
  - SW cache name `mq-city-v2` → `mq-city-v3`.

- **Beta 1.1.5 — Legal pages + account deletion (public-launch unblocker)** — gates removed for GDPR / CCPA / PIPEDA + mobile app-store compliance. No new gameplay surface; pure compliance polish.
  - **`public/privacy.html`** — full privacy policy covering what's collected (Supabase account email + UUID + hashed password + game-state snapshots), what's stored client-side (IndexedDB `city-builder` DB, `localStorage` settings + auth tokens), third-party processors (Supabase, GitHub Pages, Cloudflare), GDPR/CCPA/PIPEDA rights table, account-deletion process, children's data exemption, security posture. Plain-English summary callout up top. Same dark theme as `pitch.html`. Last-updated date stamped.
  - **`public/terms.html`** — beta-stage Terms of Service: acceptance, 13+ eligibility, beta-status disclaimer (save formats can change), license to use, prohibited conduct, user content licence (for cities saved to cloud), pricing (free during beta; future paid options disclosed at purchase), third-party reliance, termination, AS-IS disclaimer, liability cap (greater of paid amount or US$50), indemnification, BC/Canada governing law. Mirrors privacy.html styling.
  - **Auth modal subtitle** gains a small "By continuing you agree to the Terms and Privacy Policy" line linking both pages (`auth-modal__legal` class). Shown to every signed-out visitor before they touch a credential field.
  - **Settings → Account & data group** added at the bottom of the Settings panel. Always shows the Terms / Privacy links. When signed in, exposes the user's email + UUID and a `Delete my account` button — clicking it opens a `mailto:hello@mqcity.app` draft with subject "Account deletion request — MQ City Builder" and body prefilled with email + UUID. Beta-stage GDPR Article 17 flow; processed manually within 30 days. Self-service edge-function deletion is on the roadmap.
  - **Persistent `#legal-footer` chip** anchored bottom-left of the viewport (`.legal-footer` class) with `Terms · Privacy` links. Hidden in `photo-mode`. Ensures the legal disclosures are one tap from anywhere in the app, not just on the auth modal.
  - **Service worker** cache name bumped `mq-city-v1` → `mq-city-v2` and `privacy.html` + `terms.html` added to the install-time SHELL. Navigation handler now falls back to the exact request from cache (so `/privacy.html` and `/terms.html` work offline), then to `index.html` for unknown routes. Important for compliance: users must be able to read the privacy policy whether or not they have a connection.
  - **No save schema bump**; no gameplay code touched.

- **Beta 1.0 — MQ City Builder rebrand + Google/Apple OAuth + first-launch sign-in prompt** — first beta release. The game is now branded **MQ City Builder** everywhere user-visible (page title, manifest, README, auth modal, app icon name). Three changes on top of Alpha 4.25's cloud-saves layer:
  - **Google + Apple OAuth buttons in the auth modal**. Both render at the top above the email/password tabs with proper provider branding (white-on-black Apple, white with Google logo). Each tap calls `supabase.auth.signInWithOAuth({ provider, redirectTo: location.href })`. The provider must be enabled in the Supabase dashboard (`Authentication → Providers → Google` / `→ Apple`); without that, the click surfaces an error in the modal's status pane. CLOUD_SETUP.md walks through both flows — Google takes ~5 min, Apple needs a $99/yr Apple Developer account.
  - **First-launch auto-prompt**: after `initAuth()`, if Supabase is configured AND the user isn't signed in AND they've never seen the prompt before (`localStorage['mqcity-auth-prompted']` flag), the auth modal opens automatically after 800 ms. A "Skip for now — play without saving to the cloud" link at the bottom of the modal lets them dismiss; the flag is set the moment we open the modal so refresh doesn't re-prompt. Once they sign in OR explicitly skip, they can always reopen via the Account pill in the More menu. Player ask: "I would like the login to pop up to come up if the user is not logged in so they know to log in."
  - **Rebrand to MQ City Builder + version 1.0.0-beta.1**:
    - `<title>` → `MQ City Builder — Beta 1.0`
    - `apple-mobile-web-app-title` + `application-name` meta tags set
    - `manifest.webmanifest` name → `MQ City Builder`, short_name → `MQ City`
    - `README.md` H1 → `MQ City Builder`, status line → Beta 1.0
    - `package.json` name → `mq-city-builder`, version → `1.0.0-beta.1`
    - Auth modal title → `Welcome to MQ City Builder`
    - **Storage keys deliberately unchanged** (`city-builder-active-slot` localStorage key, `city-builder` IndexedDB DB name) — renaming would orphan every existing local save. Cosmetic rebrand only; data layer untouched.
  - No save schema bump (still v27). Bundle ~983 KB raw / ~257 KB gzipped.

- **Alpha 4.25 — Beta launch prep: optional Supabase cloud saves + auth modal** — user direction: "I would like a way for a user to sign up and have an account so city import/export is more for sharing than it is saving the world." Adds Supabase-backed cloud saves + sign-in/sign-up flow, **fully opt-in at the build level** — without `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, the auth pill is hidden and saves stay 100% IndexedDB local (existing behaviour preserved for forks).
  - **New `src/auth/` module**:
    - `SupabaseClient.ts` — single-instance `getSupabase()` reading `import.meta.env.VITE_SUPABASE_*`. Returns `null` when unset (no warning — local-only is a fully-supported state).
    - `AuthState.ts` — `initAuth()` restores any persisted session before `Game.init`, `onAuthChange()` lets UI subscribe to sign-in / sign-out / token refresh, `isSignedIn()` for sync checks.
    - `CloudSaveStore.ts` — Postgres-backed save store mirroring SaveGame's slice (load / save / writeRaw / loadSummary / clear / useSlot). Saves stored gzipped in a `bytea` column; PostgREST hex round-trip handled inline.
  - **`SaveGame.ts` fans out to cloud automatically** when `cloud.available()` (signed-in + Supabase configured):
    - `load()`: cloud first, fall back to local. Cloud loads also mirror back to local IndexedDB for offline cache.
    - `save()`: writes local AND fires-and-forgets to cloud (won't block autosave on network).
    - `writeRaw()` (city-code import): writes local + cloud so an imported city is bound to the user's account.
    - `clear()`: wipes both.
    - `loadSummary()`: cloud first.
  - **New `src/ui/AuthModal.ts`** — vanilla DOM modal with three tabs:
    - **Sign in**: email + password
    - **Create account**: email + password + email verification
    - **Email link**: passwordless magic-link (one-tap from inbox, no password to remember)
    - Status pane shows live error / success messages from Supabase
  - **More-menu Account group** (hidden when cloud isn't configured) — `👤 Sign in` pill opens the modal; signed-in state shows the user's email + a `Sign out` pill.
  - **GitHub Actions deploy workflow** updated to inject the two env vars from repo secrets at build time. If unset, the production build runs in local-only mode (zero downside).
  - **`docs/CLOUD_SETUP.md`** — 10-minute step-by-step: create Supabase project → run SQL schema → grab API keys → drop into `.env.local` + GitHub secrets → ship.
  - **Cost trajectory**: $0/month on Supabase free tier (50K MAU / 500 MB) → $25/mo Pro at 50K-100K MAU. Each save row is ~25-90 KB compressed; 500 MB ≈ 1.6K-6.6K active 3-slot users.
  - **Unchanged for normal play**: portable city codes still exist (now positioned as **sharing**, not backup, since cloud handles backup automatically). Local IndexedDB remains the offline cache. Existing saves untouched. Save schema v27.
  - Bundle 977 KB raw / ~256 KB gzipped (+10 KB raw — Supabase JS SDK).

- **Alpha 4.23 — Skyscraper construction stages look like a real construction site** — player ask: "Can you make skyscraper construction phases look a little more interesting and like a building being constructed?" Old stages were just a scaling-up box + 1-2 cranes; the new stages each tell a different story:
  - **Stage 0 — Site Prep**: excavated foundation pit + plywood formwork around the perimeter + on-site construction trailer (white box with windows + door panel) + lumber stack with strap bands + rebar bundle + concrete mixer (drum on a chassis with a yellow stripe ring) + dirt-spoil pile cone + a half-erected starter crane (lattice mast only, no jib yet). Reads as "first week on site."
  - **Stage 1 — Lower Floors**: poured concrete foundation slab + 3 stacked floor plates with darker shadow gaps between them + 4 concrete corner columns extending above the latest floor + 3 rebar bundles sticking out the top (anticipating the next pour) + construction hoist (lattice tower with cab parked partway up) on the east face + one full-height tower crane with operator cab + counterweight + cable + hook + lumber stack on the ground. Reads as "the building's getting started."
  - **Stage 2 — Steel Skeleton**: concrete podium for the lower 35% (with floor-plate caps) + steel I-beam framework above (4 corner columns + 4 horizontal beam levels) + scaffolding wrap on two faces (thin steel cross-members) + grey safety tarp/scrim on the north face + construction hoist still attached + **two cranes** (peak structural-work moment). Reads as "the bones are going up."
  - **Stage 3 — Facade Going Up**: lower 75% of the tower has finished facade + window banding + corner fins + 4 vertical fins + glass colour from the design's actual palette. Top 25% is still bare steel skeleton + scaffolding. One crane at the top of the unfinished section + construction hoist still attached. Reads as "almost done, just the cladding to finish."
  - **Common across all four stages**: hi-vis orange-and-white site fence panels ringing the perimeter (with a small entry gap on the south face for site access). Same colour palette (concrete grey, steel dark, crane yellow + counterweight orange, hi-vis fence orange + white) so the stages feel like one continuous build rather than four unrelated assemblies.
  - **New shared helpers**: `emitSiteFence`, `emitFoundationPad`, `emitTowerCrane` (lattice mast + jib + counter-jib + cab + counterweight + hanging hook on cable), `emitTrailer`, `emitLumberStack`, `emitRebarBundle`, `emitConcreteMixer`, `emitHoistLift` (vertical lattice track with cab). Each stage composes these helpers + adds its own structural geometry.
  - **Performance**: each stage emits ~25-50 BufferGeometry parts (vs ~6-8 for the old single-box version). All merge into the existing `buildSkyscrapersMesh` single Mesh, so per-tile cost is "more vertices in one draw call" rather than more draw calls. Tested on a city with multiple in-progress towers — sim + render budgets unchanged.
  - Bundle 961 KB raw / ~252 KB gzipped (+8 KB raw).

- **Alpha 4.22.2 — Highway direction is dynamic (claimed by first car, reset on empty)** — playtest verdict on 4.22.1: my collision fix was solving a different problem. The user wants direction to be **emergent**, not pre-painted: "I dont want the roads to have predetermined directions. The direction of the road is determined by the other cars already on the highway. If a car is on the highway going in the opposite direction the other car picks the lane with traffic flowing in the same direction, but those road directions are not set in stone. They are set by the first car to drive on each side, this resets every time the highway is empty to ensure new highways being built dont have to care what direction they paint in."
  - **Highway tiles paint with NO direction** — `applyRoadStroke` no longer sets `highwayDir` on highway strokes. Tiles are bidirectional/unclaimed at paint time. `Tile.highwayDir` stays at the default `-1`.
  - **`RoadGraph.canTraverse` treats `highwayDir === -1` as bidirectional** — added `highwayDir !== -1 &&` to the wrong-direction check on both endpoints. An unclaimed highway tile lets cars traverse either way; a claimed one enforces its claim.
  - **Cars dynamically claim direction on tile entry** — new `Vehicles.claimHighwayDir(grid, fromIdx, toIdx)` is called at every spawn site (5 of them: residents, return trips, tourists, emergency dispatch, motorcade) and every mid-trip transition. Sets the entered tile's `highwayDir` to the car's motion direction. Last-writer-wins if multiple cars cross paths.
  - **`decrementLoad` resets direction when the lane empties** — when `trafficLoad` goes from 1 to 0 on a highway tile, `highwayDir` resets to `-1`. The lane is bidirectional again. Next car to arrive claims fresh.
  - **Save migration**: existing saves load with all highway tiles' `highwayDir` cleared to `-1`. Players don't have to repaint their old highways to benefit — the new behaviour kicks in immediately on every existing city.
  - **Direction arrows removed** — `buildRoadOrnamentsGroup` no longer emits highway arrows; the road mesh only rebuilds on paint events anyway, so dynamic-direction arrows would always be stale. Cars themselves now visually convey direction. `HIGHWAY_ARROW_COLOR` + `makeArrowGeom` dropped.
  - **Net effect**: paint highways however you want, in any direction, whenever you want. The dual-carriageway from 4.22 still gives you 2 parallel lanes per stroke, both unclaimed. The first car to drive each lane locks it for that direction; opposing-direction cars naturally route to the other lane (or wait until lanes clear). When all highway traffic stops, every lane resets to "any direction allowed."
  - No save schema bump — `highwayDir` was always per-tile, just reinterpreted. Bundle 953 KB raw / 251 KB gzipped (~unchanged — small additions in Vehicles offset by removed arrow code in Renderer).

- **Alpha 4.22.1 — Highways are collision-free (no random crash rolls anywhere highway touches)** — playtest verdict on 4.22 dual carriageway: "The highway system makes it hard to remember what direction everything is going and what direction you painted it. Make it so that the highways just automatically filter it so that there are no collisions one way or another. If a car is going in the opposite direction the other cars know not to take that lane and pick the other lane. This makes it so I dont have to plan so hard to get highways to work."
  - **Diagnosis**: routing was already correct — `RoadGraph.canTraverseHighway` enforces highway one-way per tile, so a car going east never routes through a westbound highway lane. With the dual carriageway from 4.22, every highway has both directions available, so the right lane is always picked. The actual user pain was the **intersection collision rolls**: any 3+ way intersection without a stop sign / traffic light / ramp / authority car triggers `crashesThisFrame.push(...)` rolls. Highway intersections fired these rolls just like local ones — every time a highway crossed another road, the player got punished with random crashes. Felt like a planning trap and discouraged building any highways at all.
  - **Fix**: collision rolls now skip:
    - Tiles where `roadType === 'highway'` (the highway side of any intersection)
    - Tiles 4-adjacent to a highway (the LOCAL side of a highway-meets-local intersection — covers the other half of the experience)
  - **Net effect**: highways and any intersection that touches a highway are completely collision-free. Cars on adjacent opposing-direction highway tiles don't crash because they're physically parallel (one-way enforcement keeps them on their own lane). The player can build highways however they want without paying a crash tax.
  - **What's preserved**: pure local-road intersections (no highway nearby) still trigger collision rolls. Stop signs and traffic lights still suppress rolls everywhere. Authority cars still pass through.
  - No save schema change. Pure simulation behaviour fix.

- **Alpha 4.21.1 — Rotate works on invalid spots too** — playtest report: "when its in a spot you can't place it in it doesn't rotate." Bug: `armOrConfirmMonument` cleared `pendingMonument` to null when the first tap landed on an invalid spot, so the floating Rotate button was never shown — player had to tap somewhere VALID first, rotate to find the orientation they wanted, then tap their actual target spot. With the fix, the player can tap their target spot first, then rotate the previewed footprint freely until they find an orientation that fits, then commit.
  - **Fix**: in `armOrConfirmMonument`, ARM the preview even when the placement is invalid. Status toast updated to `"City Hall won't fit at this orientation — ↻ to rotate or tap elsewhere"` so the player knows what to do. The second-tap commit path already re-validates and will surface a clear toast if the player tries to confirm an invalid orientation.

- **Alpha 4.22 — Highway dual carriageway (auto-paint two opposite-direction lanes)** — player ask: "have highways automatically paint two roads, one going in one direction one going the other. I also want you to find ways to crack the code on building good highways." First pass at the highway redesign — making the most-requested change (auto-parallel) and shipping for playtest before adding more.
  - **Highway tool now paints a 2-tile-wide dual carriageway** in a single drag. Each stroke generates the forward lane (painted path) AND a parallel reverse-direction lane shifted one tile perpendicular. Both lanes are real highway tiles with their own `highwayDir` (cars on the forward lane drive the stroke direction, cars on the parallel lane drive the opposite direction). Reads visually as a divided highway because the two adjacent tiles each draw their own road surface + arrows.
  - **Perpendicular preference: RIGHT of stroke direction**. Matches right-hand traffic convention (driving east → westbound parallel lane is to the south). Falls back to LEFT if the right side runs off-map for any tile in the stroke. Falls back to single-lane if both sides fail (player gets a one-way highway near map edges, which still works).
  - **No tool change required** — same Highway button in the Roads group, same drag gesture. The dual-carriageway is the new default for every highway stroke. No save schema bump (the existing per-tile highway state already supports this — the parallel just adds more tiles, no new fields).
  - **Diagonal strokes supported** via diagonal perpendicular offsets. The `path8` rubber band still works; the parallel just shifts each tile by the perpendicular of the overall stroke direction, then reverses for opposite flow.
  - **Maintenance doubles automatically** because there are 2× as many highway tiles per stroke. Realistic — a real highway costs 2× a one-way road of the same length.
  - **Implementation**: new helper `Game.computeHighwayParallelPath(path)` returns the offset+reversed path; `applyRoadStroke` for highway tier processes BOTH paths through the same `desiredEdges` / `desiredStubs` / `desiredDirs` sets in a single pass — no double-render, no double-graph-rebuild. `strokeEdges` / `strokeStubs` track both lanes for retreat support so painting/un-painting a stroke handles both lanes atomically.
  - **What's NOT in this PR** (deferred to follow-ups based on playtest): visual median strip between paired lanes; auto-merge-no-collisions when a highway tile meets a non-highway road; explicit "single-lane highway" tool for special cases. Ship the killer feature first, iterate from there.
  - Bundle 953 KB raw / 251 KB gzipped (no measurable change — pure paint-logic addition).

- **Alpha 4.21 — Rotate big civic buildings** — player ask: "big buildings need to have an ability for the user to rotate them so they can fit the building where it's needed." Adds 90° rotation for the four per-block civic monuments (Mayor's Mansion, City Hall, Provincial Capital, National Capital). Cloverleaves stay rotation-locked (5×5 symmetric — rotating would change nothing visually).
  - **New per-anchor `Tile.bigBuildRotation: 0|1|2|3`** (Alpha 4.21 / schema 27). Number of 90° CW turns. Only meaningful on the lex-smallest anchor tile of a footprint; renderer reads it there. Old saves load with rotation 0 — every existing monument keeps its original orientation across the upgrade.
  - **`pendingMonument` state extended** with a `rotation` field. First tap arms the preview at rotation 0; subsequent rotates cycle 0 → 1 → 2 → 3 → 0; second tap on the same tile commits at the currently-armed rotation.
  - **Floating "Rotate ↻" button** appears just above the toolbar whenever a monument is armed. Big enough for fingertip on a phone (~120×40 with the icon spinning subtly to advertise "tappable"). Tapping it cycles the rotation, re-validates the new footprint dimensions, and re-renders the preview ghost. Status toast updates to `"City Hall rotated · 3×5 · tap again to confirm ($100,000)"`. **R key** cycles rotation on desktop (skipped when typing in any input field).
  - **Footprint validation honours rotation** — `canPlaceMonumentFootprint` and `reserveMonumentFootprint` both call `rotatedFootprint(nativeW, nativeH, rot)` to swap dimensions for odd rotations and iterate the rotated bounding box. The 5×3 City Hall becomes a 3×5 footprint at rotation 1; if those tiles aren't all clear grass, the preview goes red.
  - **Renderer rotates parts in place** via a single helper `rotateBigBuildPartsInPlace(parts, rot, ax, ay, nativeW, nativeH)` called per dispatch site. Each part's geometry is translated to put the native footprint center at the origin, rotated by `-rot * π/2` around Y, then translated to the rotated world center. The anchor (ax, ay) stays put; the building extends right+down by the rotated dimensions. Builders themselves are unchanged — the transform is one after-the-fact pass per draw.
  - **Motorcade road-access scan honours rotation** — `findCapitalAnchor` returns rotated `(w, h)` so the perimeter scan walks the correct world-space face. Without this fix a rotated capital would scan the wrong perimeter and falsely report "no road access" even with a road clearly hugging its rotated front.
  - **Per-tile construction sites + ghost web layout** untouched — both iterate the kind-bit-set tiles directly (which already carry the correct rotated footprint), so they "just work" with no per-rotation special-casing.
  - Bundle 953 KB raw / 251 KB gzipped (+5 KB raw — rotation helper + state + UI button + CSS).

- **Reverted: Alpha 4.20.x night-lighting attempts** — four PRs (#98 / #100 / #102 / #104) tried to address "make the city more vibrant at night" and all were rejected as ugly. The whole batch got reverted to the Alpha 4.19 state (commit `2a6beef`). Lessons captured for the next attempt:
  - **4.20 (ground halo glow)**: cream-white radial glow pads on the ground around L2+ buildings + skyscrapers. User: "I didn't see a difference." Halos were too small / too low opacity to read past the building footprint that eclipsed them.
  - **4.20.1 (visibility tune-up)**: doubled halo radii, bumped texture peak alpha, raised opacity multiplier. User: "i dont want ground light I want lighting on the buildings, you know to make it feel like there is some depth. The lighting in this style is very flat." → wrong direction entirely. Ground halos are not what the player wants for "city feels alive at night."
  - **4.20.2 (moonLight + per-mesh emissive)**: added a cool-white DirectionalLight that activates at night to restore face-to-face shading contrast, AND set `emissive: 0xffd8a8 + emissiveIntensity 0.32` on `buildingsMesh` / `skyscrapersMesh` / `cityBuildingsGroup` mesh materials. User: "All of the buildings are just this ugly light brown colour. the entire building." → math: at intensity 0.32 the warm-cream was adding `(81, 69, 54)` per channel, dominating diffuse colours and washing every face cream-brown. Lambert `.emissive` is uniform additive — even modest values overpower diffuse when night lights are dim.
  - **4.20.3 (de-saturation)**: dropped `emissiveIntensity` 0.32 → 0.05 and bumped moon intensity 0.55 → 0.75. Still ugly per playtest — even a subliminal cream emissive plus the cool-blue moon visibly tinted everything.
  - **What to try next**: don't touch material `.emissive` on the merged building meshes (it cannot respect per-tile vertex colours). Instead extend the existing `litWindowsMesh` (already lights up Medium+ R/C/MU at night) with more / brighter / better-distributed window emitters; OR add subtle bottom-up streetlamp wash via a separate per-tile mesh (NOT a flat ground quad) that sits against the building's bottom face only. The moonLight idea was probably correct in principle but couldn't be tested clean — try it solo, with NO emissive at all, and tune intensity / colour carefully.

- **Alpha 4.19 — Animated farm tractor on large farm clusters** — player ask: "If a farm is bigger than 20 blocks total can it have a detailed tractor that drives through the fields so it looks nice and polished."
  - **Cluster detection**: every time `drawCityBuildings` rebuilds (placement / bulldoze events), `refreshFarmClusters(grid)` flood-fills the farm tiles into 4-connected clusters. Clusters with ≥ `FARM_TRACTOR_MIN_CLUSTER` (20) tiles get a tractor; smaller ones don't. Cap of `MAX_TRACTORS = 16` concurrent tractors across the map.
  - **Snake / boustrophedon path** — for each qualifying cluster, sorts tiles by y ascending, then within each row sorts by x with alternating direction. The result is one continuous strip the tractor traces row-by-row, like a real plow / harvester. Handles non-rectangular clusters fine (only visits actual cluster tiles).
  - **Detailed geometry** — 12 baked parts per tractor: chassis (red body) + cabin + chrome hood + flat roof + chrome exhaust stack + 2 small front wheels + 2 big rear wheels + 2 headlights + rear hitch. The big-rear-small-front wheel proportion is the classic farm-tractor silhouette. Plus a sibling InstancedMesh for the dark-tinted cabin glass (4 windows).
  - **Animation**: `updateTractors(dt, grid)` runs in the render loop alongside `updateCars`. Each tractor advances at `0.55 tiles/sec` along its path; position lerps between adjacent path tiles; yaw faces the path-tangent. Tractor lifts to the current tile's terrain elevation so it climbs hills.
  - **Initial progress randomized** per cluster so tractors don't all visibly start at the same point.
  - **No save state, no road graph interaction, no collision logic** — purely a visual decoration that turns big farms from "field of stamped trees" into "active agricultural operation."
  - Bundle 951 KB raw / 251 KB gzipped (+3 KB raw — tractor geometry + per-frame animator).

- **Alpha 4.18.1 — Scrapped: Ramp + Cloverleaf interchanges (UI removal only)** — playtest verdict: "i didn't like the merge lane or the cloverleafs, let's scrap the entire idea ocmpletely." Same surgical-removal pattern the user previously specified for big buildings: keep the underlying assets in the codebase so existing saves still work, just remove the player-facing options.
  - **Toolbar entries removed** for both `Ramp` and `Clover` from the Roads group. The two unused ICON SVGs also dropped.
  - **Milestone unlocks removed** — `place_ramp` and `place_cloverleaf` are no longer added to the City milestone's unlock list, so they can never become "available."
  - **Everything else kept intact**: Tool union entries, dispatch code in `Game.handlePaintStart`, `Game.placeRamp` / `reserveMonumentFootprint('cloverleaf')`, the renderer's ramp visual + cloverleaf geometry, faction stances, save schema fields. This means **anyone with an existing save that has built ramps or cloverleaves will still see them rendered correctly** and can still bulldoze them — they just can't make new ones. No save migration needed.
  - The Faction Detail panel still lists "Highway ramps" and "Cloverleaf interchanges" stance rows because the stances are still real for any built instances.
  - Bundle 948 KB raw / 250 KB gzipped (~1 KB saved from the dropped icon SVGs).

- **Alpha 4.18 — Level 4 / Max density tier (bridges L3 → skyscrapers)** — user spec: "A Level 4 density. It needs to bridge the gap between skyscrapers and Level 3 density so the height difference is not so stark as density drops from skyscrapers." This is the second attempt at this tier — Alpha 3.2.5 shipped a similar feature but was reverted after a freeze caused by two specific bugs (documented in CLAUDE.md). Both addressed at the start of this PR.
  - **New `'max'` tier in `ZoneTier`** with `cap = 4` and 4 new tools: `residential_max` / `commercial_max` / `industrial_max` / `mixed_max`. Listed in each zone group's toolbar between "High" and "Sky" with a new ICON_TIER_MAX (rect with two horizontal divider lines, suggesting a stacked mid-rise mass).
  - **Unlocks at Metropolis** (the natural next step after City unlocks both L3 and skyscrapers).
  - **12 new building variants** (R/C/I/MU × 3 visual variants per zone): mid-rise apartments, brownstones, 5-over-1s, mid-rise offices, boutique hotels, multi-bay industrial processing facilities, podium-tower mixed-use. Heights range 2.1-2.6 — squarely between L3 (~1.5-2.1) and the skyscraper baseline (~3+).
  - **Capacity arrays** widened from `[0,4,16,64]` to `[0,4,16,64,160]` for residents, `[0,3,12,48]→[0,3,12,48,120]` for commercial jobs, etc. L4 capacity ≈ 2.5× L3, matching the visual mass step.
  - **Promotion threshold for L3→L4 = 5.0** (much higher than the 2.5 for L2→L3) so L4 only emerges in genuinely high-demand areas.
  - **Faction stances** added: `r_max` / `c_max` / `i_max` / `mu_max` rows for **all 10 factions**, more polarized than their L3 values (NIMBYs/Hometown -1.0 max-everything; Yimbys/Transit/Chamber +1.0 on the zones they like). Surfaced in the Faction Detail panel as "Residential (max)" etc.
  - **Bugs from the prior attempt fixed upfront:**
    - `applyZoneStroke` had `cap === 1 ? 'low' : cap === 2 ? 'medium' : 'high'` in TWO sites — `cap === 4` would falsely resolve to `'high'`. Both updated to `cap === 1 ? 'low' : cap === 2 ? 'medium' : cap === 3 ? 'high' : 'max'`.
    - `Council.canChangeZone` constructs `${prefix}_${tier}` stance keys; with all 10 factions now having `r_max` / `c_max` / `i_max` / `mu_max`, no more undefined-stance NaN propagation. (`Council.canChangeZone` itself didn't need touching — the upstream fixes are sufficient.)
    - Also widened: `Tile.zoneCap` / `Grid.setZone` / `TileInfo.zoneCap` / `BulldozedSnapshot.zoneCap` / `strokeZones` all extended to `0|1|2|3|4`. `MAX_DENSITY` constant changed from 3 to 4 (Development uses it as the upper bound).
    - `Achievements.l3Buildings` / `Happiness.density3Tiles` / `Happiness.zonedHigh` / `Economy.wealthSurtax` / `Renderer.isPremiumRes` all widened from `=== 3` to `>= 3` so L4 tiles count toward existing L3 logic where appropriate.
  - **Save schema 25 → 26.** The on-disk format is unchanged (`zoneCap` and `density` were already serialized as plain numbers); the schema bump just signals the new value range. v25-and-earlier saves load fine — they never have density=4 tiles.
  - Bundle 949 KB raw / 250 KB gzipped (+6 KB raw — the 12 new variants + ICON_TIER_MAX + the 4×10 stance rows).

- **Alpha 4.17 — Cloverleaf interchanges (per-block prefab) + cleaner single-tile ramp visual** — playtest spec: "I don't like how the merge lanes work, they look ugly. The merge lanes should look like real interchanges. Is there a way you can do that construction placement method like you do for big buildings to build more intricate and beautiful road designs for things like clovers?"
  - **New Cloverleaf tool** in the Roads group. 5×5 prefab (25 blocks) built per-block via the same construction system as the big civic monuments — extending the Alpha 4.15 infrastructure to support a 5th kind. ~$2K per block, $50K total.
  - **Layout**: two crossing highways (N-S in centre column, E-W in centre row, bridged at the centre) + 4 curved loop ramps in each quadrant + 4 grass infields with ornamental trees. The 4 cardinal endpoints are highway road tiles the player connects their existing highways to.
  - **Curved loop visual**: each loop is a 270° arc traced by 12 short box segments along a circular path of radius ~1 tile, with white shoulder stripes following the curve. The segmented arcs read as smooth curves at typical zoom.
  - **Bridge with concrete piers**: the upper E-W highway is lifted to BRIDGE_LIFT (= 0.22) over the lower N-S, supported by 4 stout concrete piers + parapet rails along both edges. Cars on the upper deck visually pass over cars on the lower deck.
  - **Real road network on completion**: `Game.finalizeCloverleaf` runs after the last block is paid — populates the road graph by calling `setRoad` on each road-bearing tile in the cloverleaf, sets highway directions on the through-lanes, adds internal road edges between adjacent road tiles, and marks every tile as `ramp = true` so cars skip stops + collisions through the whole interchange. The 4 cardinal endpoints are highway tier so the player connects their existing highways there.
  - **Multi-instance**: unlike the civic monuments, cloverleaves are NOT one-per-city. Players can place several across a sprawling highway network.
  - **Construction sites + ghost web**: paid-but-incomplete tiles render the standard Alpha 4.15 construction site (scaffolding + crane); unpaid reserved tiles render the standard gold ghost outline when the Cloverleaf tool is active. Same per-block UX as big buildings.
  - **8 lampposts** along the highway shoulders + ornamental tree per quadrant + dark estate pad — the whole composition reads as monumental civic infrastructure.
  - **Cleaner single-tile Ramp visual** (replaces the noisy chevron + orange-dot decals from Alpha 4.16): now a clean dark-asphalt shoulder extension toward the highway side + two parallel white merge stripes perpendicular to the merge direction + a real exit sign (post + green signboard with white text bar). Reads as actual highway design, not ground decals.
  - **Faction stances** added (`cloverleaf` row for all 10 factions, more polarized than the single-tile ramp). Drivers +1.0 / Chamber +0.9 (apex), NIMBYs -0.9 / Greenleaf -0.9 (apex offender). Surfaced in the Faction Detail panel as "Cloverleaf interchanges".
  - **Save schema 24 → 25**: new per-tile `cloverleaf` bit. v24-and-earlier saves load with `false` everywhere. Bulldozing any cloverleaf tile tears down the whole 5×5 footprint AND clears the internal road graph state.
  - Bundle 943 KB raw / 249 KB gzipped (+8 KB raw — cloverleaf geometry + per-block extension).

- **Alpha 4.16 — Highway interchange ramps** — user spec: "give interchanges. Make it easy and intuitive to make exits and entrances for highways that can flow into local roads/avenues seamlessly."
  - **New Ramp tool** in the Roads group (next to Highway). Tap any road tile that's adjacent to BOTH a highway and a non-highway road (or is itself one tier with the other adjacent), and the tile becomes an interchange ramp. Single-tap, $1,500 per ramp tile.
  - **Validation toasts** keep placement intuitive: "Ramps go on existing road tiles" / "Ramps need a highway AND a local/avenue road adjacent" — the player can't mis-place.
  - **Smooth-merge behaviour**: cars passing through a ramp tile **skip stop signs and intersection collision rolls** entirely. Stop signs / traffic lights on the same tile are mutually exclusive (placing a ramp clears them) — a ramp is a merge, not a controlled crossing.
  - **Distinctive visual** so the player sees ramps at a glance:
    - **Yellow merge stripe** painted diagonally across the surface
    - **4 white chevrons** in a `>>` pattern reading as "merge / exit"
    - **Hi-vis orange shoulder dots** at the edge facing each highway neighbour
    - **Small green freeway-style EXIT sign** on the shoulder facing the local road (post + green signboard, classic interstate look)
  - **Faction stances**: Drivers love (+1.0 — easy on/off), Chamber loves (+0.6 — freight access), Working Families likes (+0.3 — easier commute). NIMBYs hate (-0.6 — more cars in their neighbourhood), Transit / Greenleaf / Safer Streets / Hometown all dislike. Taxpayers grudgingly approve (+0.2). Surfaced in the Faction Detail panel as "Highway ramps".
  - **Unlocks at the City milestone** alongside highways themselves — they're useless before the player has highways anyway.
  - **Save schema 23 → 24**: new per-tile `ramp` bit. v23-and-earlier saves load with `ramp = false` everywhere. Bulldozing a road tile clears the bit alongside stop sign / traffic light / bus stop.
  - Bundle 936 KB raw / 247 KB gzipped (+2 KB raw).

- **Alpha 4.15.3 — Motorcade returns to production cadence (every 4 years)** — `MOTORCADE_INTERVAL_MONTHS: 1 → 48`. The user verified the convoy + escorts + pull-over + visuals all work after 4.15.1 (deadlock fix) and 4.15.2 (police-car / fire-truck visual rework), so the motorcade is back to the original spec'd cadence: once every 4 sim years for any city with a Provincial or National Capital. One-line change.

- **Alpha 4.15.2 — Police cars + fire trucks finally LOOK like police cars + fire trucks** — playtest report: "the police cars escorting the vehicle don't look like police cars, they should have blue and red lights on the top and look distinctly like police cars. Same with fire trucks but as fire trucks. High detail. Police cars from station are same as ones that flank motorcade."
  - **Police accessory overlay** — new `policeAccessoriesMesh` sibling InstancedMesh that mirrors the body's per-instance matrix only for `patrol` / `motorcade_lead` / `motorcade_tail` cars. Baked geometry: dark **light bar base** on top of the cabin + a **blue dome light (left)** + **red dome light (right)** + thin centre divider so the colours read as distinct lights. Plus thin **black side stripes** along each flank ("Crown Vic" silhouette) and **front + rear black bumper trim**. Vertex-coloured so the bar/blue/red render in fixed colours regardless of body tint. Patrol cars dispatched from police stations and the two motorcade escorts use IDENTICAL geometry — they're the same cruiser model.
  - **Fire truck accessory overlay** — new `fireAccessoriesMesh` sibling InstancedMesh for `fire_response` cars. Baked geometry: **yellow extension ladder** running lengthwise on top of the cabin (two rails + 6 perpendicular rungs) + **red light bar in front** with twin red domes + **white reflective side stripes** + **chrome grille** + **chrome front bumper**.
  - **Fire trucks visibly bigger** than sedans — per-instance scale set to `(1.10, 1.50, 1.40)` so the body reads as a chunky truck. Accessory mesh inherits the same matrix so the ladder + lights scale with the body and stay attached. (Motorcade limo's existing 1.6× length scale still applies.)
  - **Per-frame counters** in `updateCars` walk through the cars array and route each kind to the right mesh: `policeIdx` for police accessories, `fireIdx` for fire. Each accessory mesh's `count` is set to the running tally so unused instance slots aren't drawn.
  - No save schema bump. Bundle 934 KB raw / 247 KB gzipped (+2 KB raw).

- **Alpha 4.15.1 — Fix: motorcade pull-over deadlock (cars never resumed)** — playtest report: "The cars need to go back to the road driving after the motorcade passes. This broke the game."
  - **Two compounding bugs** that together left ambient cars frozen forever after a motorcade:
    1. **Pull-over → yielding leak.** When a car's `pauseRemaining` (from the motorcade's per-frame pull-over refresh) drained to 0, it unconditionally entered the FIFO yielding state — which was originally designed only for stop-sign cars parked at intersection boundaries. Pull-over cars are paused MID-SEGMENT, not at any intersection, so the yielding logic had nothing meaningful to release them on.
    2. **Motorcade leader-gap deadlock.** The motorcade's pull-over freezes the car directly in front of it on the same road segment. The leader-gap clamp then prevented the motorcade from advancing past, but the motorcade continued refreshing the paused car's pause every frame → infinite deadlock. Motorcade never reached its destination → never despawned → cars never recovered.
  - **Fix 1**: When a car's pause drains, only enter yielding mode if `segmentT === STOP_PRE_T` (i.e. parked at the stop-sign boundary). Otherwise just resume driving normally on the next tick. Pull-over cars now correctly fall through to motion when the pause ends.
  - **Fix 2**: Authority cars (motorcade + emergency) now bypass paused/yielding cars in BOTH the leader-gap pre-pass and the spillback check. Police, fire trucks, and motorcade vehicles drive past frozen traffic instead of queueing behind it. Without the deadlock, the motorcade reaches its destination and despawns normally; pause refreshes stop firing; ambient cars drain their pause and resume.
  - No save schema bump. Pure per-tick behaviour fix.

- **Alpha 4.15 — Per-block placement for big civic builds (with construction sites + ghost web)** — user spec following the 4.14.3 road-access fix: "Make every big building require individual block placements... Break the cost down to its by-block cost... When the user places the first block the game should check if the rest of the building can be put. The game should also show a web of where to put the rest of the blocks." This is the big architectural pivot away from all-at-once monument placement.
  - **New per-block placement flow** for **Mayor's Mansion (8 blocks), City Hall (15), Provincial Capital (24), National Capital (28)**.
    - First tap → two-tap arm/confirm preview from Alpha 4.13 still applies. The "armed" position locks in the footprint anchor (top-left).
    - Second tap on same tile → **reserves the footprint** (sets the kind-bit on every footprint tile), **charges per-block cost** for the first block only, marks the anchor as paid. Status: "City Hall reserved · 1 of 15 blocks placed · tap 14 more".
    - Each subsequent tap on an unpaid reserved tile of the same kind → **single-tap installment**: charges per-block cost, marks paid, status: "City Hall · 5 of 15 blocks placed". When the final block is paid, the anchor's `building` value flips to the kind and the renderer switches from per-tile construction sites to the merged finished geometry. "City Hall complete! 🎉"
    - The previous "drop $1.5M-$20M in one go" model is gone — players now spend over many sim months as cash accumulates.
  - **Per-block cost** (`monumentBlockCost` helper in `types.ts`) — `ceil(BUILDING_COSTS[kind] / footprintTileCount)`:
    - Mayor's Mansion: $500K / 8 = **$62,500 per block**
    - City Hall: $1.5M / 15 = **$100,000 per block**
    - Provincial Capital: $7.5M / 24 = **$312,500 per block**
    - National Capital: $20M / 28 = **$714,286 per block**
  - **Construction-site visuals** for every paid-but-incomplete block — earthen pad + plank decking + 4 corner safety posts with orange/white striped tape + mini-crane (mast + arm + hanging cable + hook) + rebar stack + yellow concrete mixer. ~22 BufferGeometry parts per tile, fits entirely within 1 tile.
  - **Ghost web** showing every unpaid block of an active reservation as a soft gold outlined tile. Only visible when the matching big-build tool is the active tool — switching away clears it; switching back redraws it. Refreshes after every block placement so it shrinks one tile at a time.
  - **Bulldoze unchanged in shape**: tearing down any tile of a footprint (complete OR in-progress) clears the entire reservation. No refund. `bigBuildBlockPaid` resets to false on every cleared tile so the next reservation starts fresh.
  - **Save schema 22 → 23**: new per-tile `bigBuildBlockPaid` field. v22-and-earlier saves load with the bit defaulted to TRUE for any tile that has a kind-bit set, so previously-completed buildings remain complete across the upgrade (no migration pain).
  - **Cost pill** updated — when a big-build tool is active, the pill shows the per-block installment (e.g. "$100K") instead of the total. Label suffix `(block)` makes it explicit.
  - **The four toolbar entries remain** (Mansion / City Hall / Provincial / National in the Mon group) — the per-block flow IS the placement flow now. Existing built buildings render unchanged because the renderer's anchor-dispatch is gated on `building === kind`, which only happens at completion.
  - Bundle 932 KB raw / 246 KB gzipped (+5 KB raw — construction-site geometry + ghost-web renderer).

- **Alpha 4.14.3 — Motorcade road-access fix (scan the WHOLE capital footprint)** — playtest report: "It says capital has no road access but there is a road right in front of it."
  - **Root cause** — `Motorcade.nearestRoadTile` only searched a small ring (radius ~2) around the **anchor tile** (lex-smallest = top-left of the footprint). For a 7×4 National Capital that's the BACK corner of the building. The road the player painted along the visible "front" (south face, at `y + 4` from the anchor) was completely outside the search ring, so the motorcade saw "no road access" even when a road was hugging the front.
  - **Fix** — `nearestRoadTile` now takes `(ax, ay, w, h)` and walks all four faces of the footprint perimeter in priority order: south face → east face → north face → west face (south first because the ceremonial-front-door side is where players almost always paint the approach road). `findCapitalAnchor` now also returns the footprint dimensions.
  - **No save schema bump.** Pure detection-window fix.
  - Bigger architectural redesign (per-block placement w/ construction sites + ghost web) is the next planned drop.

- **Alpha 4.14.2 — Motorcade now monthly + diagnostic toasts when blocked** — playtest follow-up: "I haven't seen the motorcade yet. Can you make it a monthly occurrence for now so I can make sure it works?"
  - **Interval bumped** `MOTORCADE_INTERVAL_MONTHS = 6 → 1` so the convoy fires every sim month for verification. Will go back to 48 ("every 4 years") once the chain is confirmed.
  - **Targeted failure toasts.** `Motorcade.monthlyTick` now returns a discriminated result (`'started' | 'no_capital' | 'no_road_access' | 'no_avenues' | 'no_route' | 'pending'`). Game routes each to a specific status toast so the player can see WHY the motorcade isn't firing if a prereq is missing:
    - `started` → 🚓 "Motorcade departing the capital"
    - `no_road_access` → "Motorcade blocked — capital has no road access"
    - `no_avenues` → "Motorcade blocked — paint at least one Avenue tile"
    - `no_route` → "Motorcade blocked — couldn't route to your avenues"
    - `pending` and `no_capital` are silent (don't spam every month).
  - **Failure doesn't reset the countdown** — the next month re-attempts so the convoy fires the moment the city qualifies (e.g. as soon as you paint an avenue, the next month's tick starts the motorcade).
  - No save schema bump.

- **Alpha 4.14.1 — Fix: import-from-code race against the 30s autosave** — playtest bug report: "I tested import/export and it worked but when I refreshed the world it reverted back to the untouched world. I made changes to the old world that are now lost because it reset."
  - **Root cause** — the import handler in main.ts did `await saveGame.writeRaw(data)` then `setTimeout(reload, 350)`. During the await AND during those 350ms the render loop kept ticking. If the 30-second autosave timer was already pending (i.e. `autosaveAccumMs >= AUTOSAVE_MS`) when the player clicked Import, it would fire mid-window, call `saveGame.save(...)`, serialize the in-memory OLD city, and overwrite the freshly-imported slot. After reload, init reads IDB and gets the auto-saved-old data — the player loses both their recent edits AND the import.
  - **Fix** — new `Game.suspendAutosavesForReload()` public method that flips `this.resetting = true`, the same flag the autosave check already gates on (`if (this.autosaveAccumMs >= AUTOSAVE_MS && !this.resetting)`). The import handler in main.ts now calls this BEFORE `writeRaw`. The reload tears down the runtime, so no resume call is needed.
  - **No save schema bump** (one-line race fix). Bundle 927 KB raw / 245 KB gzipped (~unchanged).

- **Alpha 4.14 — Traffic depth: farm/forestry workers + tourists + emergency vehicles + presidential motorcade** — direct response to playtest feedback that "farms and logging operations don't bring traffic" and a four-part feature spec. The vehicle simulation now has a real `kind` taxonomy and four new spawn paths layered on top of the resident commute.
  - **Worker traffic to farms + forestry** — extended the resident commute destination roll. New weights: 45% commercial / 30% industrial / 17% forestry tile / 8% farm tile (forestry > farm matches user spec — logging is more labor-intensive). When the city has no forestry/farm placed, those rolls fall through to commercial so small early cities aren't penalised.
  - **Tourist arrivals from outside** — when `globalMarket.isConnected()` (any city-edge road tile exists), tourists periodically spawn at a random edge road tile and drive in to a random tourist destination: parks, plazas, museums, stadiums, observatories, fountains, statues, memorial gardens, reflecting pools, clock towers, triumphal arches, topiaries, flower beds, pergolas, piers, the Mansion, and ALL three civic monuments (City Hall / Provincial / National). **Tourist cars count against a SEPARATE cap of `MAX_TOURIST_VEHICLES = 50`** that stacks ON TOP of `MAX_VEHICLES`, so total visible traffic visibly grows when the city is connected and tourist-rich. Tourist palette is brighter (gold / orange / lime / pink) so they're distinct from the muted resident palette. After visiting (8-15s) they drive back out to the edge.
  - **Emergency vehicles** — police stations dispatch white **patrol cars** (60% of dispatches) and fire stations dispatch bright-red **fire trucks** (40%) on a slow cadence (~0.4 attempts/sec, capped at `MAX_SERVICE_VEHICLES = 20`). They tour the city to a random road tile and return home. Slight 1.15× speed boost. They **skip stop signs, traffic lights, and intersection collision rolls** — running flashers.
  - **Motorcade event** — fires every `MOTORCADE_INTERVAL_MONTHS` (currently **6 sim months for testing**, will bump to 48 = "every 4 years" once verified). Trigger: city has at least one Provincial Capital or National Capital. The 3-vehicle convoy is **lead police car → black 1.6×-stretched limousine → tail police car**, spawned 1.4s apart so they convoy correctly on the same path. Route: nearest road tile of the capital → greedy farthest-point sample of up to 18 avenue tiles → loop back to capital → despawn. Same authority-vehicle bypass as patrols (no stops / lights / collisions).
  - **Pull-over behavior** — every render frame, any non-motorcade car within 4 tiles (Manhattan) of any motorcade vehicle gets its `pauseRemaining` refreshed to 0.7s, freezing them on the shoulder until the convoy clears. Drains naturally as the motorcade moves on.
  - **`Car.kind` enum** in `Vehicles.ts` is the new taxonomy: `'resident' | 'tourist' | 'patrol' | 'fire_response' | 'motorcade_lead' | 'motorcade_limo' | 'motorcade_tail'`. Defaults to `'resident'` if undefined so legacy code paths work unchanged. Drives cap-counting, behaviour exemptions, and renderer color/scale.
  - **Return trips inherit kind + color** — `PendingReturn` now carries the original kind so a tourist's return drive is also a tourist (not a recolored resident). Cap check on the return is per-kind too.
  - **Renderer**: InstancedMesh capacity bumped from 250 → ~325 (`MAX_VEHICLES + MAX_TOURIST + MAX_SERVICE + 3`). Per-kind scale: motorcade limo gets `scale.z = 1.6` so it visibly reads as a stretched limo. Per-instance color already drives the rest (police white, fire red, tourist palette, motorcade limo black) — no shader changes needed.
  - **`src/simulation/Motorcade.ts`** is the new orchestrator: monthly tick decrements the countdown, on fire builds the route via greedy farthest-point sampling + per-segment A*, queues the 3 spawns staggered by 1.4s. Per-frame `tick()` drains the spawn queue. `reset()` is called on save-restore / reset-city.
  - No save schema bump (everything's transient sim state). Bundle 927 KB raw / 245 KB gzipped (+11 KB raw, +3 KB gzipped — Motorcade module + extended Vehicles).

- **Alpha 4.13 — Two-tap placement preview for large multi-tile civic builds** — direct response to playtest feedback after 4.12 shipped: "These buildings are really hard to place right now. Is there a way to see a preview to know where it's trying to place before it actually places? They are expensive and there's no way to move them."
  - **First tap arms a green footprint ghost** at the tapped tile. The ghost is a translucent fill + outlined boundary covering the exact W×H tiles the build will occupy. Status toast: `Tap again to confirm <Name> ($N,NNN,NNN)`.
  - **Second tap on the same tile commits.** Single-tap-and-done is gone for these four — confirmation is mandatory.
  - **Tap a different tile** → re-arms there (timer resets).
  - **Invalid tile** (off-map, occupied, can't afford, banned, wrong terrain) → red ghost + `Cannot place X here` toast. Won't commit even on second tap.
  - **8-second arm timer** auto-clears the ghost so a forgotten arm doesn't surprise-commit later.
  - **Cancel paths**: changing tool, undo, page reload all clear the pending preview.
  - Applies to all four large multi-tile builds — **Mayor's Mansion, City Hall, Provincial Capital, National Capital**. Skyscrapers, parks, and other 1-tile placements remain single-tap.
  - **`Renderer.showFootprintPreview(ax, ay, w, h, valid, elevation)`** is the new primitive — translucent fill + four border strips inside a `Group`, full disposal on clear. Lives in `worldGroup` so it follows camera + elevation.
  - **`Game.canPlaceMonumentFootprint(kind, x, y)`** is the new silent validation predicate — mirrors the checks inside `placeMayorMansion` / `placeCivicMonument` but emits no toasts and has no side effects. Used to colour the ghost.
  - No save schema bump. Bundle 919 KB raw / 242 KB gzipped (+3 KB raw, ~0 KB gzipped).

- **Alpha 4.12 — Civic monuments (City Hall + Provincial Capital + National Capital)** — three new escalating one-per-city showpiece builds. Save schema bumped v21 → v22 with three new per-tile bits (`cityHall` / `provincialCapital` / `nationalCapital`), each following the same anchor-tile multi-tile pattern as the Mayor's Mansion. Bundle 916 KB raw / 242 KB gzipped (+34 KB raw, +8 KB gzipped — almost entirely the three geometry builders).
  - **City Hall** (5 × 3, $1.5M, Town milestone) — Beaux-Arts limestone composition that reads as five distinct modules across the facade: west pavilion → west wing → central rotunda block → east wing → east pavilion. The central rotunda carries a copper-green dome with 8 meridian ribs, a colonnade of 12 small columns around the drum, and a four-faced lantern with clock dials above it. Below: a 6-column grand portico with classical pediment + gold escutcheon + arched main entrance. Wings have 4 arched windows each behind pilasters; pavilions get mansard roofs with gabled tops. Front grounds include a 4-step grand staircase with finialed railings, a circular limestone fountain with gold jet, twin flanking flagpoles, bronze statues on plinths, parterre gardens with topiary cones + hedge crosses, six ornamental lampposts along the perimeter, and a perimeter balustrade with corner / gate posts. ~165 BufferGeometry parts.
  - **Provincial Capital** (6 × 4, $7.5M, Metro milestone) — **Queens Park (Toronto) influence**: Romanesque Revival in warm pink-orange sandstone, distinctive tall pyramidal slate roofs on the end pavilions, central main block with the signature massive arched main entrance (sandstone voussoirs + keystone + flanking columns + provincial crest above), low central tower with copper pyramidal cupola + gold ball finial. Wing blocks have 6 arched windows each behind sandstone pilasters with steep gabled roofs. Front plaza features a three-tiered ornamental fountain in an octagonal basin, three flagpoles (provincial + city + civic), ornamental trees in all four corners, and six lampposts along the perimeter. ~220 BufferGeometry parts.
  - **National Capital** (7 × 4, $20M, Capital milestone) — **Centre Block (Ottawa) influence**: Gothic Revival in cool grey Nepean-buff sandstone with copper-green roofs throughout. The centrepiece is a deliberately-tall **Peace Tower**: square sandstone base + setback + clock storey with four working clock faces (Roman numeral hour marks, hour + minute hands) + stepped copper roof + open stone lantern + secondary copper roof + tall ribbed copper spire with apex flagpole. **Tower height is capped well below skyscraper peak** so it reads as monumental but not skyscraper-tier. Twin flanking flag towers at the wing-ends; long Gothic-Revival wings with pointed-arch windows and copper banded roofs. The back row carries a round **Library of Parliament** drum with 16 buttress ribs, 8 pointed-arch windows around the perimeter, a conical copper roof, and a finial. Front plaza features the **Eternal Flame** (octagonal sandstone basin with a perpetual orange-and-gold flame on a bronze holder), five flagpoles across the plaza front, bronze statue pairs on plinths flanking the staircase, and a wrought-iron-fence perimeter with eight monumental gate posts. ~310 BufferGeometry parts — the most detailed build in the game.
  - **35-tile L3 service field.** Every developed building within 35 tiles of any civic monument anchor gets `hasPower + hasWater + hasPark` flags set unconditionally — that's the full L3-unlock service triad. Implemented as Phase 4 in `Services.recompute`. Cheap because each is one-per-city, so the inner disc sweep runs at most three times per recompute.
  - **Faction stances** added (`city_hall` / `provincial_capital` / `national_capital`) for all 10 factions. Hometown + Chamber + NIMBYs love the prestige builds (scales up to National = 1.0). Taxpayers HATE them at any tier (-0.5 / -0.8 / -1.0). Yimbys warm to City Hall (L3 services = pro-density) but cool toward National (huge footprint). Working Families like City Hall (services for their neighbourhood) but turn against capitals (could've been housing). Transit + Safer-Streets see them as transit/civic destinations.
  - **Toolbar.** All three live at the end of the existing Mon (Monuments) group in Architect Mode, with new SVG icons. Milestone gates: Town / Metro / Capital.
  - **Anchor-tile bulldoze** walks back to the lex-smallest tile of the footprint (left, then up) and clears the entire rectangle. Same pattern as the Mansion's bulldoze, factored per kind.

- **Alpha 4.11 — Portable city codes (export / import between devices)** — single-snapshot move-a-city-between-devices flow. Player asked: "is it possible to export the world in the form of a randomized code you can copy and paste into a new device to start where you left off." Answer: yes. Trade-off they identified is correct — there's no merge / two-way sync (that needs a server, which this game doesn't have), so each export is a one-way snapshot and re-importing requires re-exporting the source.
  - **New `src/persistence/PortableSave.ts`** — codec that round-trips a `SaveData` through `JSON.stringify → UTF-8 → CompressionStream('gzip') → base64`, prefixed with header `MQCITYv1.` so paste-error detection happens before the parser. Decode does the reverse + re-validates the schema version. Errors throw player-friendly Error messages the UI surfaces.
  - **New `SaveGame.writeRaw(data)`** — writes a SaveData straight to the active slot with the schema gate checked (rejects out-of-range schemaVersion). Used by import; bypasses the live-state `serialize()` path.
  - **Backup & sync section in Settings** — two buttons (`Export this city`, `Import from code`), each opening an inline drawer.
    - Export drawer: read-only textarea with the code + "Copy to clipboard" button + size readout (e.g. "17.3 KB · 17,665 chars"). Auto-selects the textarea on open so a single Cmd/Ctrl+C grabs it. Falls back to `document.execCommand('copy')` on browsers without `navigator.clipboard`.
    - Import drawer: paste textarea + danger-styled `Overwrite active slot` button with **inline two-tap arm** (matches the Reset City pattern). First tap arms with a "Tap again within 5 seconds to confirm" warning; second tap commits. Editing the textarea mid-arm disarms.
  - **Code size in practice**: a 64×64 small map serializes to ~80 KB JSON → ~17 KB base64 after gzip. Long but trivially copy-pasteable in any text channel (DM, email, notes app). A fully-developed Medium/Large map would be larger but still under ~50 KB.
  - **No save schema bump.** Bundle 882 KB raw / 234 KB gzipped (+5 KB raw — the codec + UI + new SaveGame method).

- **Alpha 4.10.1 — HUD stability + Settings scroll + Cheats relocated** — three small polish fixes from playtest feedback.
  - **HUD pill row no longer jumps as digits / icons change.** The wrapping HUD row used to reflow on every Pop / Treasury / time-of-day update; on a fully-developed city the pill widths visibly bounced 4 Hz, which is distracting and looks broken. Fix: stable widths on the variable-content elements (`#hud-pop-label` 8ch tabular-nums, `#hud-treasury-label` 9ch, `#hud-time` 86px, trend arrows 14px). Plus `#hud-tool-cost` is now anchored ABOVE THE TOOLBAR via `position:fixed` instead of being a flex child of `#hud`, so toggling its visibility no longer rewraps the HUD row.
  - **Settings panel now scrolls.** Wrapping the panel body in a new `.settings__scroll` div with `flex:1 1 auto; min-height:0; overflow-y:auto` lets the inner content scroll within the `.info-panel--tall` cap of `100vh - 120px`. Pre-fix, anything below ~4 settings groups was permanently clipped on a typical phone viewport.
  - **Cheats moved from the budget panel to Settings** + **enabling any cheat now freezes Achievements.** New `Achievements.cheatsActive` flag is `true` whenever `cheatUnlimitedMoney || cheatUnlimitedDemand` is on. `evaluateMonth` bails before unlocking anything (and before bumping peak-pop / peak-treasury so streak-based unlocks can't be farmed by toggling on for one month). Every `record*` counter-bump method is also gated. Existing unlocks are preserved — the kill switch is forward-only. A small "⚠ Achievements paused while cheats are on." line appears under the toggles whenever cheats are active.
  - No save schema bump, no faction-stance changes, no new Tools. Bundle 877 KB raw / 233 KB gzipped (no meaningful change).

- **Alpha 4.10 — Play-as-you-learn tutorial** — A5 from the production-readiness audit, executed against the user's modified spec: "make it so the user has an option to open a tutorial world that teaches them the game as they play rather than teaching them as reading cards." The pre-4.10 onboarding was a 4-step modal of static instructions ("Roads first." / "Zone next to a road.") that the player had to dismiss before doing anything. New build is a live coach that watches the city while the player plays.
  - **New `Tutorial` class** (`src/engine/Tutorial.ts`) — small state machine with phase ∈ {`prompt`, `active`, `skipped`, `completed`} + step index. Persists in `localStorage` under `mq-tutorial-state`. 9-step linear curriculum, each step carries `{ title, hint, check(game): boolean }`. `tick(game)` runs the current step's predicate every render frame and auto-advances when satisfied.
  - **Step list, fuzzy by design.** Predicates check intent, not layout — "any road edge exists", "any tile zoned residential", "population ≥ 20", "any power plant placed", "any water tower", "any park", "happiness panel opened at least once", "budget panel opened at least once", and a final "build a real city" step that only the "Got it" button can clear. Two new fields on `Game` — `happinessPanelOpenedOnce` + `budgetPanelOpenedOnce` — flip true the first time the player opens those panels, surfacing them for the predicates without requiring DOM polling.
  - **First-launch prompt.** New `#tutorial-prompt` modal centred on screen with two actions: **No thanks** (writes `phase: 'skipped'`) and **Start tutorial** (writes `phase: 'active'`). Only shown when `phase === 'prompt'` — once the player has chosen, never re-prompts.
  - **Live banner.** New `#tutorial-banner` pill anchored at top-center under the HUD. Shows `Step N of 9 · {title} · {hint}` plus three actions: **Skip tutorial**, **Already did this** (advance manually for off-script play), and a terminal **Got it** that swaps in on the final step. Updates instantly on phase / step change via a `Tutorial.onChange` subscription.
  - **Replaces the old reading-card flow.** The old `#tutorial` DOM block + its `TUTORIAL_SEEN_KEY` localStorage flag are gone. Both "Show tutorial again" entry points (Settings panel button + budget panel link) now call `tutorial.restart()` and re-arm the banner.
  - **Photo mode hides the banner** alongside other HUD chrome via the existing `body.photo-mode` class.
  - **No save schema bump** (tutorial state lives in localStorage, not the IndexedDB save). **No faction-stance changes, no new Tools.** Bundle 877 KB raw / 232 KB gzipped (~4 KB raw added).

- **Alpha 4.9 — Faction-stance browser (drill-in from Community Sentiment)** — B3 from the production-readiness audit. Pre-4.9 the Community Sentiment panel showed every faction's mood + a one-line comment, but the player couldn't drill into "*why* does Karen Whitfield hate me." Now they can.
  - **New `FactionDetailPanel`** (`src/ui/FactionDetailPanel.ts`) — slide-up modal opened when the player taps a leader row in the Community Sentiment panel. Renders the leader's avatar + name + title + bio against the faction's accent colour, a council-status badge (★ Council Member / ✕ Ran Against You / Not In Office), a "What they care about" block, the current mood bar with bucket label, the population share, and **two-column stance breakdown**: top 5 stances ≥ +0.5 (sorted descending — green "They Support") and bottom 5 stances ≤ −0.5 (sorted ascending — red "They Oppose"). Stance keys are humanised via a single `STANCE_LABEL` lookup ("mu_high" → "Mixed-use (high)").
  - **New tap affordance on leader rows.** `HappinessPanel` now exposes an `onLeaderTap?: (faction: FactionId) => void` callback. main.ts wires it to `FactionDetailPanel.show(factionId)`, hides the Community Sentiment panel while the drill-in is open, and re-opens it on close so the player isn't dumped back to the map.
  - **CSS** for the new panel + a `.happiness__row { cursor: pointer; }` hover affordance.
  - **No save schema bump, no faction-stance changes, no new Tools.** Bundle 873 KB raw / 231 KB gzipped (~6 KB raw added).

- **Alpha 4.8 — Settings menu + Difficulty selector** — two production-readiness items from the audit (B1 + B2). The first dedicated settings surface in the game beyond the cheat toggles in the budget panel.
  - **New `Settings` class** (`src/ui/SettingsPanel.ts`) + `bindSettingsPanel(settings, hooks)` factory. Owns a SettingsData dict persisted to `localStorage` under key `mq-city-settings`. Fields: difficulty, volumeMaster, volumeMusic, volumeSfx, uiScale, palette, reduceMotion, defaultSimSpeed, confirmReset. `load()` reads + applies CSS side effects (UI scale class on `<html>`, palette class on `<body>`).
  - **Settings modal** in the More-menu popover via new `⚙ Settings` pill. Sections: difficulty (4-card picker), audio (3 inert sliders ready for the future sound system), display (UI scale select, colourblind palette select, reduce-motion checkbox), simulation (default sim speed select, confirm-reset checkbox, "Show tutorial again" button, "Reset all settings" button).
  - **`DIFFICULTY_EFFECTS` table** — single source of truth for downstream systems:
    - Easy: $30K start, demand +15%, events ×0.5
    - Normal: $15K, defaults, ×1
    - Hard: $8K, demand −10%, events ×1.5
    - Sandbox: $1M, demand +30%, events ×0 (no random events)
  - **Difficulty applies to NEW cities only.** Mid-game changes don't retroactively resize treasury. main.ts seeds `game.economy.treasury` to the difficulty's starting value when `game.economy.monthsElapsed === 0` (fresh slot / just-reset).
  - **Reduce-motion (Alpha 4.8)** — when checked, the day/night sun arc slows to 10% of normal speed. Implemented via new `Game.reduceMotion` field consulted in the time-of-day advance.
  - **Default sim speed preference** — main.ts reads `settings.data.defaultSimSpeed` at boot and applies if not 1.
  - **No save schema bump** (settings live in `localStorage`, not the IndexedDB save). **No faction-stance changes, no new Tools.** Bundle 867 KB raw / 230 KB gzipped (~4 KB raw added).

- **Alpha 4.7 — Camera rotation + PWA install with Mayor's Mansion icon** — two production-readiness items from the audit (B6 + B8).
  - **90° camera rotation.** `Camera.yaw` is no longer `readonly` — new `Camera.rotateBy90(direction)` snaps the orthographic camera through the four cardinal iso angles (45° → 135° → 225° → 315°). `panBy` and `screenToWorld` already derive their right/forward vectors from the camera's matrix so they keep working after rotation with no other changes. New `↻` pill in the HUD strip (between Speed and More) — tap to rotate clockwise. Lets the player see behind tall buildings / mansions.
  - **PWA install with Mayor's Mansion icon.** Three new files in `public/`:
    - `manifest.webmanifest` — name "Greenmeadow — City Builder", short_name "Greenmeadow", display "standalone", theme + background `#1a2722`. References both icons.
    - `mansion-icon.svg` — hand-drawn 512×512 silhouette of the 4×2 showpiece: 5-block mansion with copper-green dome + spire + gold ball finial, pedimented portico with 6 columns + gold escutcheon, perimeter wall with gold-finial gate posts, lawn grounds, warm sky. Same palette as the in-game mansion.
    - `mansion-icon-maskable.svg` — same drawing on the safe-zone (40% padding) with theme-colour background so iOS/Android can mask to any shape.
    - `sw.js` — minimal service worker. Network-first for the HTML shell, cache-first for assets / icons / manifest. Versioned cache name (`mq-city-v1`) so a new build invalidates the old one. IndexedDB save data is untouched.
  - **index.html** gets a `<link rel="manifest">`, a `favicon.svg` link, and an `apple-touch-icon`. `main.ts` registers the SW on `load` (only on production builds — dev / HMR sessions skip it). Players can now "Add to home screen" on iOS/Android and play offline once loaded.
  - **No save schema bump, no faction-stance changes, no new Tools.** Bundle 863 KB raw / 229 KB gzipped (no JS change — assets are static).

- **Alpha 4.6 — HUD pill polish (trend arrows + time-of-day pill)** — two small "feels finished" additions to the HUD.
  - **Trend arrows on Pop + Treasury pills.** Tiny ↑ (green) / ↓ (red) / → (grey-flat) glyph appended to each pill, indicating the 3-month trend pulled from `Stats.samples`. Dead-zone of max(50, 2% relative delta) so the arrow doesn't flicker on tiny fluctuations. The player gets an at-a-glance "are things getting better or worse" signal without opening the Stats panel.
  - **Time-of-day pill.** New `#hud-time` HUD button between More and FPS, showing `🌙 Night` / `🌅 Dawn` / `☀ Day` / `🌇 Dusk` based on the current `game.timeOfDay` phase. Tapping toggles between morning (phase 0.25, ~7am) and peak night (phase 0.00, midnight) — the day/night cycle continues forward from whichever phase the player set. Lets the player jump the lighting on demand for screenshots or to see their lit-window/lamp-glow work without waiting through a full cycle.
  - **No save schema bump, no faction-stance changes, no new Tools.** Bundle 863 KB raw / 229 KB gzipped (~1 KB raw added).

- **Alpha 4.5 — Placement preview UX (cost pill + service-radius disc)** — the first two items from the production-readiness audit. Both address "the player has to guess" gaps in the placement flow.
  - **Active-tool cost pill.** New `#hud-tool-cost` element in the HUD. When a paid Place tool / road tool / luxury / skyscraper / mansion / terraforming tool is the active tool, the pill shows the tool's label + cost reflecting the current council multiplier (e.g. "Hospital · $8,000"). Three states: gold (affordable), amber (treasury < cost — pre-warning), red (banned by council). Hidden when the active tool is free (pan, bulldoze, zone paint, district paint). `Game.refreshToolCostPill()` is called on every `setTool`, every council election, and every monthly tick so the displayed number stays accurate as treasury / council changes.
  - **Service-radius preview disc.** `Renderer.showServiceRadiusPreview(x, y, radius, elevation)` emits a translucent gold cylinder at the selected tile sized to the building's `SERVICE_RADIUS`. Shown for park / school / hospital / fire / police tools when a tile is selected. Hides on tool deselect or when no tile is selected. Players can preview coverage by: (1) Pan-tool tap → select a tile, (2) switch to e.g. Hospital → see the disc — without committing the placement. Game.`refreshServiceRadiusPreview` fires on setTool + tap.
  - **No save schema bump, no faction-stance changes, no new Tools.** Bundle 862 KB raw / 228 KB gzipped (~5 KB raw added).

- **Alpha 4.4 — Vehicle window/light overlays + universal tree shadows** — two visual polish passes that addressed the remaining items on the prior session's handoff list (#3 and #4). Plus a full pass over README.md to bring it current with everything since Alpha 3.2.4 (the README was stuck at 3.2.4 even though we'd shipped 4.0 through 4.3.1).
  - **Cars + buses gain sibling InstancedMeshes** for windows + headlights + taillights. The body keeps its per-instance VEHICLE_PALETTE tint; windows / headlights / taillights have their own fixed-colour materials so they don't wash out under the body tint. Six new InstancedMesh objects total (cars: body + windows + headlights + taillights; buses: body + windows + headlights). Each frame the body's per-instance matrix is mirrored to every sibling — same position, same yaw.
  - **Tree shadow discs extended to every instanced tree.** Forest tiles already had them since Alpha 2.6. Now also:
    - Park-cluster trees across all 8 cluster-size layouts. Implemented via a `finalize(out)` post-process helper at the top of `parkClusterParts` that scans for parts with the trunk colour `0x6b3f1f` and prepends sibling shadow discs at the same (dx, dz). Replaces all 8 `return out;` sites with `return finalize(out);` — clean single-pass without inline shadow duplication.
    - Mayor's Mansion ornamental back-corner trees — each tree now gets a slim dark-green octagonal pad at its base.
  - **README.md fully resynced.** Pre-4.4 the README's status header still said "Alpha 3.2.4" and was missing every 4.x highlight (Architect Mode + Beautification Budget, Mayor's Mansion, toolbar QoL rework, curb-appeal pass, service rotation, luxury walkway aim). Now leads with Alpha 4.4 status, summarises every 4.x release with module-level detail, and lists the current save schema (v21). Project-structure block updated with the full module roster (Council, Happiness, Milestones, Events, Stats, Achievements, Bonds, Ferries, Crime, Districts, Skyscrapers, etc) — previously missing 13 modules added since Alpha 3.0.
  - **No save schema bump, no faction-stance changes, no new Tools.** Bundle 858 KB raw / 227 KB gzipped (~3 KB raw added vs 4.3.1).

- **Alpha 4.3.1 — Luxury mansion walkway aims at the road** — luxury 2-tile mansions previously laid a centred T-shape walkway across the lawn pad regardless of where the road was. Now the walkway extends from the body's edge toward whichever cardinal direction has a road. Matches the "buildings face the road" pattern from commit `252c770` and Alpha 4.3's service rotation, completing the curb-appeal pass for every kind of building in the game.
  - **New `computeLuxuryRoadYaw(grid, ax, ay, bx, by)`** in Renderer.ts. Pair-aware analogue of `computeRoadFacingYaw` — checks 4-adjacent tiles of BOTH pair tiles (the pair spans 2 tiles, so cardinal road neighbours can lie next to either). Preference order matches single-tile: S → E → N → W, non-highway roads outrank highways.
  - **`buildLuxuryParts` gains `roadYaw?: number` param.** When provided, the walkway is emitted as a strip from the body's edge to the pair tile-edge in the chosen direction. When undefined (no road adjacent — e.g. mansion deep on a park lot), falls back to the pre-4.3.1 centred-T walkway so the lawn still has a visible front-walk element.
  - **Renderer dispatch updated** to call `computeLuxuryRoadYaw` and pass the result through.
  - **No save schema bump, no faction-stance changes, no new Tools.** Bundle 855 KB raw / 227 KB gzipped (~1 KB raw added).

- **Alpha 4.3 — Service buildings rotate toward the road** — the final piece of the curb-appeal pass that started with commits `313b61e` (ground accents on zoned tiles) and `252c770` (zoned buildings face the road). Now school, hospital, fire station, police station, museum, bus stop, and bus depot also rotate so their asymmetric front faces (clock tower, red-cross sign, bay doors, porch, colonnade, bench/canopy, garage) point toward the nearest adjacent road tile. Each rotated service tile also gets a short paved walkway connecting its front to the road, matching the flagstone palette used for the zoned-tile walkways.
  - **New `SERVICE_BUILDING_ROTATES: Set<string>`** in Renderer.ts — the seven asymmetric-front service kinds. Symmetric kinds (park, power, water, stadium, observatory, ferry, subway) are deliberately excluded — they look the same from any angle, and ferry/subway have their own orientation logic driven by the water/sidewalk side they're placed against.
  - **`buildCityBuildingsMesh` rotation hook** — at the generic-cityBuildingParts dispatch, the renderer now calls `computeRoadFacingYaw(grid, x, y)` for tiles in `SERVICE_BUILDING_ROTATES`, then rotates each part's geometry by yaw AND rotates the (dx, dz) offset around the tile centre so the whole composition turns as one rigid body. Reuses the same `computeRoadFacingYaw` helper shipped in 252c770 for zoned buildings.
  - **`buildServiceWalkway(grid, x, y, kind)`** — emits a short paved strip (0.16 wide × 0.36 long, flagstone colour) from the body's front edge toward the centre of the adjacent road tile. Returns an empty array when the tile has no adjacent road (handoff trap: service tiles dropped mid-block on a park lot shouldn't get a path leading to grass).
  - **Verified visually** in the dev preview with a synthetic test: a + of 5 road tiles at (32, 32) with school / hospital / fire / police placed at each of the 4 cardinal arms. Each service building rotated correctly to face its road and emitted its walkway.
  - **No save schema bump, no faction-stance changes, no new Tools.** Bundle 854 KB raw / 226 KB gzipped (~5 KB raw added).

- **Alpha 4.2.2 — Mansion glitch fix + Mayoral Override extends to Beautification** — two targeted fixes.
  - **Mansion top "weird black box" bug.** Two issues compounded:
    1. The wing-chimney cap had a typo — `chimney.translate(...)` instead of `chimneyCap.translate(...)` — so the chimney got translated TWICE (once to the base position, then again by the cap delta), and the cap stayed at world origin (0, 0, 0) which rendered as a stray dark box at the corner of the map. Fixed.
    2. The pediment fascia used a 3-segment ConeGeometry with `rotateX(π/2) + rotateZ(π/6)`, which produced a wedge silhouette protruding behind the central block instead of a clean triangular gable. Replaced with a proper 4-piece classical pediment composition (entablature base + triangular tympanum via 4-segment cone scaled thin in Z + 2 angled roof slabs + gold escutcheon). Reads cleaner from every angle and the silhouette is structurally honest.
  - **Mayoral Override now also covers the Beautification Budget.** Pre-4.2.2 the budget was strictly council-controlled — Override had no effect on it. The expanded behaviour: when Override is active, the BudgetPanel's read-only state line is replaced with an editable 5-pill tier picker (None / Light / Standard / Grand / Opulent, each with its monthly cost). Tapping a pill calls `Council.setBeautificationTier(tier)` which is gated on `isOverrideActive()` (no-op if Override expired between render and tap). The tier change propagates immediately — `effectiveBeautificationTier` updates and the renderer's streetscape mesh refreshes on the next sim tick. Override is one-term-only; at the next election, council control resumes via `electBeautificationTier()` as before.
  - **No save schema bump, no faction-stance changes, no new Tools.** Bundle 849 KB raw / 225 KB gzipped (~2 KB raw added).

- **Alpha 4.2.1 — Popover full-word headers + architectural night lights** — two QoL polish passes on top of 4.2.
  - **Popover headers use full words.** When the Alpha 4.1 toolbar rework went icon-only on portrait phones, players tapping a 1-2 letter pill (R / C / I / MU / Mon) had no confirmation of what they opened. New `ToolGroup.headerLabel?: string` field defaults to `label` but overrides it for the cryptic-pill groups: R → "Residential", C → "Commercial", I → "Industrial", MU → "Mixed-Use", Mon → "Monuments". Other groups already had readable labels (Roads, Services, Transit, etc) so they're unchanged.
  - **Architectural decoratives glow at night.** Plazas / fountains / statues / clock towers / triumphal arches / pergolas / reflecting pools / topiary / flower beds / memorial gardens / piers / and the Mayor's Mansion all gain unique lit-overlay geometry that fades in with the day/night cycle. Implemented as new `addArchitecturalLights(t, addWin, pushLit)` helper inside `buildLitWindowsMesh`:
    - Plaza: 4 corner bollard tops (amber) + central planter glow.
    - Fountain: glowing crown sphere (gold) + lit central column (warm white) + dusk-blue water disc.
    - Statue: uplighting ring around the plinth + amber halo above the bronze head.
    - Flower bed: 4 gold accent dots on the dot-flowers.
    - Topiary: 4 corner amber tops + central white glow.
    - Pergola: 4 corner posts + 5 string-light bulbs hanging under the cross-beams.
    - Reflecting pool: long dusk-blue surface strip + 4 corner bollard caps.
    - Memorial garden: lit obelisk top (gold) + mid-glow + base spotlight ring.
    - Clock tower: glowing white clock face + amber belfry openings + gold spire finial + 2 tower-body window lights.
    - Triumphal arch: floodlit gold lettering plaque + glowing gold crown ornament + soft warm glow inside the arch opening.
    - Pier: 2 amber bulbs on the seaward bollards.
    - Mayor's Mansion: 12 wing windows (warm white) + 8 inner-block windows + 6 central-block windows + amber grand door + gold pediment escutcheon + pale-teal glowing dome + 2 gold cupola/finial beacons + 2 amber lamppost bulbs at the entrance + 2 gold gate-post finials + 2 dusk-blue reflecting-pool surfaces.
  - **Glow halos for architectural buildings.** The biggest UX win: extended `buildLampGlowMesh` to add radial-gradient halo discs under each architectural building, sized by build importance (mansion 6×, triumphal arch 2.0, memorial garden 1.8, clock tower 1.7, fountain 1.6, etc). Without these, the lit accents were tiny dots lost in a dark scene; with them, every monument reads as a beacon glowing in the dark. The mansion gets six halos covering both rows of its 4×2 footprint so the entire estate properly glows.
  - **No save schema bump, no faction-stance changes, no new Tools.** Pure rendering polish. Bundle 847 KB raw / 224 KB gzipped (~3 KB raw added).

- **Alpha 4.2 — The Mayor's Mansion (showpiece build)** — single-instance 4×2 footprint architectural build that the user explicitly asked to be the most detailed build in the game. Sits in the Architect Mode `Mon` group as the apex prestige item. Bundle 844 KB raw / 223 KB gzipped (~12 KB raw added for the showpiece). **Save schema v21** (back-compat with v20+).
  - **4×2 footprint with anchor-tile pattern.** Mirrors the skyscraper / luxury-pair design: the lex-smallest tile of the 8 (lowest x, then lowest y) carries `building='mayor_mansion'`; the other seven are marked-only via `Tile.mayorMansion=true`. Bulldozing any of the eight tiles tears down the entire showpiece (Game.applyBulldozeStroke walks left+up to find the anchor, then clears the full MAYOR_MANSION_WIDTH × MAYOR_MANSION_DEPTH rectangle).
  - **Capital-tier milestone gate** ($500K up-front, $1.5K/mo upkeep). Capital is 5,000 pop — only the largest cities can afford / unlock it. Single-instance per city (placement refuses with toast if a mansion already exists).
  - **One-per-city + free-grass-only constraint.** All 8 tiles must be on owned grass land, no road/path/zone/building/skyscraper/luxury/water/bridge — surfaces a clear toast for each rejection reason.
  - **Showpiece geometry in `buildMayorMansionParts(ax, ay)`** (BuildingVariants.ts) — ~140 BufferGeometry parts merged into one mesh. The mansion runs along the back row (4 tiles wide × 1 deep) as a 5-block composition: 2 outer wings (2-storey, slate hipped roof, 2 chimneys each, 6 windows each with shutters) + 2 inner blocks (2-storey, slate hipped roof, 4 windows each) + 1 grand central block (3-storey, parapet+balustrade, copper-green dome with spire + gold ball finial, pedimented portico with 6 cylindrical columns + grand arched door + gold handle + gold escutcheon, ~6 windows). Two cornice bands between stories on the central block. The front row (4 tiles wide × 1 deep) is the lavish formal estate grounds: central flagstone driveway, two reflecting pools flanking it (each with stone surround, water inset, bronze statue at each end on a plinth, water-light reflection slab), two parterre gardens at the outer corners (geometric outer hedge frame + inner cross hedge + 4 flower-dot quadrants in red/yellow/purple/white + 4 corner topiary cones + bright lawn infill), three-step grand entrance stair, two ornamental urns flanking the steps, two wrought-iron lampposts with gold finials, two ornamental trees in the back corners, low limestone perimeter balustrade with corner posts (gold finials) and a centre-front gate opening with taller posts.
  - **`FACTION_STANCES.mayor_mansion`** — strongly polarizing values that make the build a real political event: NIMBYs +0.8 (property values), Hometown Heritage +1.0 (their dream — classical, grand, heritage), Chamber +0.8 (city prestige + tourism magnet), YIMBYs -0.9 (huge non-housing footprint), Working Families -0.8 (could've been 100 housing units), Taxpayers -1.0 (the apex vanity build, their worst nightmare). Greenleaf +0.2, Transit -0.2, Drivers +0.2, Safer Streets -0.3.
  - **Photo-op trigger** — placement fires `Game.maybeOfferPhotoOp('mayor_mansion')` so the player gets the standard photo-op opportunity for whichever faction loves it most (likely Hometown).
  - **Save schema v21.** Persists `Tile.mayorMansion` per tile; the `building='mayor_mansion'` value round-trips via the existing `building` field. v20-and-earlier saves load with `mayorMansion=false` everywhere.
  - **Toolbar entry** — added at the END of the Architect Mode `Mon` group (Statue / Fountain / Tower / Arch / **Mansion**) with a distinctive crown-finialled colonnaded-mansion icon. Sits as the apex prestige item.

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
