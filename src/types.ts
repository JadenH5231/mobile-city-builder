// Shared types and constants. Kept dependency-free so any module can import freely.

/** World-space side length of one grid cell, in Three.js units. 1.0 keeps math simple. */
export const TILE_SIZE = 1;

/**
 * Visual road width as a fraction of TILE_SIZE for the local tier. Avenue and
 * highway override this — see {@link ROAD_TIER}.
 */
export const ROAD_WIDTH = 0.45;

/** How far above the terrain plane the road meshes sit, to avoid z-fighting. */
export const ROAD_LIFT = 0.02;
/**
 * Bridge deck height above the surrounding water (Alpha 2.3). Roads
 * painted on water tiles are elevated to this Y so cars visibly cross
 * over the river/lake. Pillars span from the water surface (~ -0.06)
 * up to this lift. Future overpass support (Alpha 2.4+) will reuse this
 * for road-over-road bridges.
 */
export const BRIDGE_LIFT = 0.22;
/** Zone overlays sit just above terrain but under roads. */
export const ZONE_LIFT = 0.005;

/**
 * Three road tiers (post-alpha pass 4 — "big roads update").
 *
 * - **local**: 2-lane bidirectional. The default tier; cheapest maintenance.
 * - **avenue**: 4-lane bidirectional. Wider, faster, higher capacity.
 * - **highway**: 2-lane one-way per tile. Fastest tier when free-flowing.
 *   **Auto-paints as a dual carriageway** (Alpha 4.22) — every highway
 *   stroke creates BOTH a forward lane (the painted path) AND a parallel
 *   reverse-direction lane one tile perpendicular (right of stroke
 *   direction by default; falls back to left if the right side runs
 *   off-map). The result is a real divided highway with two lanes
 *   going opposite ways. Each lane is still mechanically a one-way
 *   highway tile — `highwayDir` is set per tile to the local flow
 *   direction. Maintenance doubles naturally because there are two
 *   tiles per stroke step.
 *
 * Per-tile `roadType` lives on `Tile`. Edges between adjacent road tiles are
 * still stored as undirected pairs in `Grid.roadEdges`; direction comes from
 * `Tile.highwayDir` and is enforced when `RoadGraph.rebuild` builds the
 * adjacency list.
 */
export type RoadType = 'local' | 'avenue' | 'highway';

export interface RoadTierProps {
  /** Free-flow speed in tiles/sec. Cars on this tier multiply this by the
   *  per-car `speed` factor before applying load slowdown. */
  baseSpeed: number;
  /** Slowdown coefficient: effSpeed = base / (1 + load × slowdown). Lower
   *  number = higher capacity (more cars before noticeable slowdown). */
  slowdown: number;
  /** Per-edge monthly maintenance cost in $. */
  maintenance: number;
  /** Mesh colour — read by Renderer. */
  color: number;
  /** Visual width as a fraction of TILE_SIZE. */
  width: number;
}

export const ROAD_TIER: Record<RoadType, RoadTierProps> = {
  local:    { baseSpeed: 2.0, slowdown: 0.50, maintenance: 15, color: 0x3b3b3b, width: 0.45 },
  avenue:   { baseSpeed: 2.8, slowdown: 0.25, maintenance: 25, color: 0x2c2c2c, width: 0.65 },
  // Highway visually widened in Beta 1.1.2 (0.60 → 0.78) so it actually
  // reads as "the bigger road" — was previously narrower than an
  // avenue. New asphalt colour 0x252525 is slightly lighter so the
  // white edge stripes + dashed white centerline pop at zoom-out.
  highway:  { baseSpeed: 4.0, slowdown: 0.20, maintenance: 40, color: 0x252525, width: 0.78 }
};

/**
 * Pathfinding speed factor — relative cost-of-travel multiplier for each
 * tier. Lower = cheaper to traverse, so A* prefers it. Numbers chosen so the
 * pathfinder strongly prefers highways and avenues for long trips, falling
 * back to locals for short hops.
 */
export const ROAD_PATH_WEIGHT: Record<RoadType, number> = {
  local: 1.0,
  avenue: 0.75,
  highway: 0.55
};

/* ---- Walking paths + sidewalks (Alpha 1.6) ---------------------------- */

/** Walking-path render width as a fraction of TILE_SIZE — visibly smaller than any road. */
export const PATH_WIDTH = 0.20;
/** Render lift: above zone overlay, below road so roads occlude paths visually. */
export const PATH_LIFT = 0.012;
/** Walking-path mesh colour — warm flagstone. */
export const PATH_COLOR = 0xb89a6c;

/** Sidewalk render lift: just above terrain, below road so roads occlude sidewalks. */
export const SIDEWALK_LIFT = 0.009;
/** Sidewalk strip colour — pale concrete. */
export const SIDEWALK_COLOR = 0xc7c2b3;
/** How wide a sidewalk extends past the road on each side, as fraction of TILE_SIZE. */
export const SIDEWALK_PAD = 0.10;

/** Pedestrian InstancedMesh capacity. Bumped to 500 in Alpha 2.0 alongside
 *  density-scaled spawn rate so cities feel populated. The pawn geom is
 *  small enough that 500 instances stay well within the InstancedMesh
 *  budget on Pixel-7-tier devices. */
export const MAX_PEDESTRIANS = 500;
/** Pedestrian render colour palette — picked at random when one spawns. */
export const PEDESTRIAN_PALETTE: readonly number[] = [
  0xeac984, 0xb38f5b, 0x8e6e4a, 0xd8a4a4, 0x9bb685
];

/**
 * Cars that arrive at their destination linger here (sim seconds) before
 * starting the return trip. Picked uniformly between LOW and HIGH so traffic
 * doesn't pulse in lockstep with the spawn rate. Memory: round-trip traffic
 * (Alpha 1.6) — fixes the "all traffic flows one way" feel.
 */
export const CAR_VISIT_LOW_SEC = 8;
export const CAR_VISIT_HIGH_SEC = 22;

/**
 * Per-residential-tile probability per spawn attempt that an outbound trip
 * gets converted to a pedestrian when a path covers the route. Tuned with
 * BUS_STOP_SUPPRESSION as a sister knob — both reduce car spawns when an
 * alternative mode is available nearby.
 */
export const PATH_CAR_SUPPRESSION = 0.55;

/**
 * Stop sign — a player-placed flag on a road tile. Cars crossing a stop-sign
 * tile pause briefly; in exchange, no collision check fires there. Memory:
 * feedback_intersection_control (post-alpha pass 4).
 */
export const STOP_SIGN_COST = 250;
/** Real-time seconds a car pauses at a stop sign before continuing. */
export const STOP_SIGN_PAUSE_SEC = 0.4;

/**
 * Traffic light (Alpha 2.0) — placed on intersections. Mutex with stop
 * sign on the same tile. Costs more than a stop sign because at busy
 * junctions it dramatically out-throughputs one (~3× when adaptive
 * timing kicks in for the busy axis).
 */
export const TRAFFIC_LIGHT_COST = 1500;

/**
 * Highway interchange ramp cost (Alpha 4.16). Placed on a road tile
 * that's between a highway and a non-highway road tile, marking that
 * tile as a smooth merge point — cars passing through skip stop signs
 * + intersection collision rolls. Cheap so the player paints them
 * freely wherever they want highway exits / entrances.
 */
export const RAMP_COST = 1500;

/**
 * Per-other-car probability of a collision when arriving at an uncontrolled
 * intersection (3+ road edges, no stop sign). Capped so a single jammed tile
 * doesn't pulverise an entire stream of cars in seconds.
 */
export const COLLISION_RATE_PER_OTHER = 0.018;
export const COLLISION_RATE_CAP = 0.10;
/** Treasury hit per crash — emergency response, infrastructure damage. */
export const CRASH_TREASURY_PENALTY = 200;
/** Each crash deducts this much developmentPressure from the destination tile. */
export const CRASH_DEMAND_PENALTY = 0.15;

export type TerrainType = 'grass' | 'forest' | 'water' | 'sand';

export type Zone = 'none' | 'residential' | 'commercial' | 'industrial' | 'mixed';

/**
 * Cities: Skylines convention — green / blue / yellow. Slightly desaturated so
 * the overlay reads as "tinted ground" rather than a solid colour swatch.
 * Mixed-use is teal — sits between R-green and C-blue intentionally.
 */
export const ZONE_COLORS: Record<Exclude<Zone, 'none'>, number> = {
  residential: 0x6dd06a,
  commercial: 0x4d8ce8,
  industrial: 0xeec453,
  mixed: 0x5cc4ad
};

/**
 * Per-zone, per-density placeholder building palette. Index 0 is unused
 * (density 0 = no building); 1..3 = low / medium / high. Each row escalates
 * from a softer "village" tone to a dense "downtown" tone.
 */
export const BUILDING_COLORS: Record<Exclude<Zone, 'none'>, readonly [number, number, number, number]> = {
  residential: [0x000000, 0xd9c89e, 0xb89970, 0x8a6f4e],
  commercial:  [0x000000, 0xc0d4ec, 0x7a92b5, 0x52688a],
  industrial:  [0x000000, 0xb0a080, 0x7e6e58, 0x584c3a],
  // Mixed-use leans warm-cool — tan podium with a bluish glass tower implied
  // by the colour ramp. Reads as "shop downstairs, apartments above".
  mixed:       [0x000000, 0xc8b294, 0x8d92a4, 0x4f5e7a]
};

/**
 * Footprint (XZ) and height (Y) per density level, in tile units. Index 0 is
 * unused. Footprints stay below 1 so a slim sliver of grass / road shows
 * around each building.
 */
export const BUILDING_DIMS: ReadonlyArray<{ readonly w: number; readonly h: number }> = [
  { w: 0,    h: 0    },
  { w: 0.45, h: 0.40 },
  { w: 0.65, h: 0.80 },
  { w: 0.80, h: 1.50 }
];

/**
 * Maximum density tier (Alpha 4.18). Was 3 (low/med/high) since launch;
 * bumped to 4 to bridge the visual gap between L3 and skyscrapers — L3
 * tops out at ~3-4 storeys, skyscrapers jump to ~10-15 storeys, leaving
 * a stark height drop wherever skyscrapers ended. L4 fills it with
 * mid-rise (~6-9 storey) buildings: brownstones, mid-rise offices,
 * podium-style mixed-use. Indices 0..4 in capacity arrays.
 */
export const MAX_DENSITY = 4;

/**
 * Residents per residential tile by density tier. Index 0 is unused
 * (no building yet). Roughly exponential — matches how a low-poly cluster
 * of houses → townhouses → apartment block → mid-rise escalates
 * capacity in a city sim. L4 (Alpha 4.18) sits between L3 (apartment
 * block) and skyscraper density.
 */
export const RESIDENT_CAPACITY: readonly number[] = [0, 4, 16, 64, 160];

/** Jobs per commercial tile by density tier. */
export const COMMERCIAL_JOBS: readonly number[] = [0, 3, 12, 48, 120];

/** Jobs per industrial tile by density tier. L4 industrial = larger
 *  multi-bay processing facility, not a skyscraper-tall factory. */
export const INDUSTRIAL_JOBS: readonly number[] = [0, 5, 20, 80, 180];

/**
 * Mixed-use (Alpha 2.0) — same building footprint, but each tile
 * contributes residents AND commercial jobs. Half rate of a pure-zone tile
 * for each axis so a mixed-use block is denser than a single-use block of
 * the same density tier overall but doesn't double-count.
 */
export const MIXED_RESIDENT_CAPACITY: readonly number[] = [0, 2, 8, 32, 80];
export const MIXED_COMMERCIAL_JOBS: readonly number[] = [0, 2, 6, 24, 60];

/**
 * Luxury low-density residential (Alpha 2.5). One luxury home spans a
 * 2-tile pair; each tile holds half the residents (so a pair = 4 total,
 * matching a single regular R1 tile's count). Premium tax rate is layered
 * on top in Economy via `LUXURY_TAX_BONUS`.
 */
export const LUXURY_RESIDENT_CAPACITY_PER_TILE = 2;

/**
 * Multiplier on a luxury resident's tax contribution. 1.5 means a luxury
 * resident pays 2.5x the regular rate (1.0x base from totalResidents +
 * 1.5x luxury bonus on top).
 */
export const LUXURY_TAX_BONUS = 1.5;

/**
 * Up-front placement cost for a luxury low-density pair (Alpha 2.5).
 * Charged once, on placement of the pair (not at development time).
 */
export const LUXURY_LOW_COST = 800;

/**
 * Skyscraper parameters (Alpha 3.1.2). Each skyscraper occupies a 2×2
 * footprint and goes through a 12-month construction phase before it
 * starts housing residents / jobs.
 *
 * Cost is steep — the entry-tier R skyscraper is $20K up-front (vs
 * $800 for a luxury home) — both because the building itself is
 * monumental and to make the choice meaningful.
 */
export const SKYSCRAPER_COST = {
  residential: 20000,
  commercial: 25000,
  mixed: 28000
} as const;
/** Months per construction stage. 4 stages × 3 months = 12 months total. */
export const SKYSCRAPER_MONTHS_PER_STAGE = 3;
/** Per-tile resident capacity for an R skyscraper at stage 4 (built).
 *  4 tiles × 64 = 256 residents per skyscraper — substantially more
 *  than 4×L3 (4 × 64 = 256, same), but the visual + civic statement
 *  is the real reward. */
export const SKYSCRAPER_RESIDENTS_PER_TILE = 64;
/** Per-tile commercial jobs (C + MU) at stage 4. */
export const SKYSCRAPER_C_JOBS_PER_TILE = 56;
/** Number of finished-design variants per zone (R/C/MU).
 *  Bumped 6 → 8 in Alpha 3.2.0. The `skyscraperVariant` field in Tile +
 *  SaveGame is widened to 0..7 to match. */
export const SKYSCRAPER_VARIANT_COUNT = 8;

/**
 * Land purchase cost in $ per tile (Alpha 3.1.3 — kept for back-compat).
 * The Land tool was retired in Alpha 3.2.1 in favour of the bulk
 * + button expansion system, but the constant stays referenced from
 * a few existing call sites.
 */
export const LAND_PURCHASE_COST_PER_TILE = 500;

/** Cost in $ to expand the city bounds by one block in any direction
 *  (Alpha 3.2.1). One million dollars per expansion — a big-ticket
 *  decision that grows the playable area meaningfully. */
export const CITY_EXPANSION_COST = 1_000_000;
/** How many tiles each + tap adds in one direction (Alpha 3.2.3).
 *  Sized to match the half-dimension of the starting region (Small map
 *  starts at 32×32, half-extent 16 tiles either side of centre — so an
 *  expansion of 32 tiles doubles the playable area along that axis). */
export const CITY_EXPANSION_BLOCK_SIZE = 32;

/**
 * Hard cap on simultaneously-active vehicles. Sized for the InstancedMesh —
 * 250 lets a fully-developed Medium map saturate without the spawner silently
 * dropping cars. Memory: feedback_traffic_pressure (post-alpha pass 2).
 */
export const MAX_VEHICLES = 250;
/**
 * Tourist vehicle cap (Alpha 4.14). Tourists arrive from the outside
 * connection and visit landmarks / parks / civic monuments. They count
 * SEPARATELY from MAX_VEHICLES — the player should see traffic visibly
 * EXCEED the resident-cap when the city is connected and tourist-rich.
 */
export const MAX_TOURIST_VEHICLES = 50;
/**
 * Emergency-vehicle cap (Alpha 4.14). Patrol cars + fire trucks combined.
 * Each station can have at most one of its kind out at a time; the cap is
 * the upper bound across the whole city.
 */
export const MAX_SERVICE_VEHICLES = 20;
/**
 * Freight truck cap (Beta 1.5, bumped 30 → 50 in 1.6.7). Transport
 * trucks spawn from industrial tiles, deliver to commercial tiles,
 * then queue a return trip back to their origin. Bigger than cars
 * (visually) and contribute 2× to per-tile trafficLoad so a fleet of
 * trucks measurably slows car traffic. Counts SEPARATELY from
 * MAX_VEHICLES — trucks are freight, not commuters. The 1.6.7 bump
 * pairs with `TRUCK_SPAWN_PER_DEMAND_PER_SEC` now scaling with
 * commercial + industrial + warehouse count; a mid-game retail city
 * needs ~30-40 active trucks to keep its stores stocked, so 30 was
 * a cap that bit before the supply chain reached steady state.
 */
export const MAX_TRUCKS = 50;
/**
 * Farm tractor visual polish (Alpha 4.19). A contiguous cluster of this
 * many farm tiles or more gets ONE animated tractor that drives a
 * boustrophedon (snake) path across the cluster — looks like plowing /
 * harvesting. Pure visual decoration; no save state, no road graph
 * interaction. Cluster < 20 tiles → no tractor (saves render budget
 * + small farms wouldn't realistically have one).
 */
export const FARM_TRACTOR_MIN_CLUSTER = 20;
/** Max tractors rendered concurrently. Each tractor is ~14 baked
 *  parts in the body InstancedMesh; cap keeps the per-frame matrix
 *  writes bounded on a map with many large farms. */
export const MAX_TRACTORS = 16;

/**
 * Motorcade event interval, in sim months. Production cadence: every
 * 48 months = once every 4 years (Alpha 4.15.3 — confirmed working
 * after the 4.15.1 deadlock fix and the 4.15.2 visual rework, so
 * back to the original spec). Triggers when the city has at least
 * one Provincial Capital or National Capital placed.
 */
export const MOTORCADE_INTERVAL_MONTHS = 48;

/** Per-instance car colours — picked at random when a car spawns. */
export const VEHICLE_PALETTE: readonly number[] = [
  0xd06464, // red
  0x6da5d6, // blue
  0x76c876, // green
  0xf2cd5c, // yellow
  0xb678d6  // purple
];

/**
 * City buildings (Step 10). Each is single-tile and mutually exclusive with
 * road and zone state. Includes the Step-12 transit primitives so we can
 * place stops/depots before the bus sim is wired up.
 */
export type Building =
  | 'none'
  | 'power_plant'
  | 'water_tower'
  | 'park'
  | 'bus_stop'
  | 'bus_depot'
  | 'forestry'
  | 'farm'
  // Big Box store (Beta 1.3). Modular like farm/forestry — adjacent
  // big_box tiles flood-fill into one larger composition (a Walmart-
  // style strip across the cluster). Generates a small number of
  // commercial jobs per tile at a deliberately lower per-job revenue
  // than zoned commercial — big-box is meant to be a low-margin job
  // generator, not a high-tax-yield zone. Faction-polarising: drivers
  // + chamber love it, hometown + greenleaf + transit hate it. Often
  // placed adjacent to one or more `parking_lot` tiles which the
  // renderer's cluster builder absorbs into the same paved field.
  | 'big_box'
  // Warehouse (Beta 1.6). Modular freight distribution centre — middle
  // of the new supply chain. Industrial trucks deliver here; the
  // warehouse then dispatches its own trucks to nearby commercial
  // tiles. Truly modular (any cluster shape, mirrors the 1.4.1 big_box
  // emission). Requires a parking lot within 3 tiles to be
  // operational (employees), same constraint big_box uses.
  | 'warehouse'
  // Parking Lot (Beta 1.3). Single-tile flat asphalt with painted
  // parking stalls. Stands alone OR clusters with adjacent big_box
  // tiles for the visual composition. Phase 1 ships the buildable +
  // visuals; Phase 2 wires the car-parking simulation behaviour
  // (cars route here, park in a stall, occupant walks the rest of
  // the trip to their destination).
  | 'parking_lot'
  | 'school'
  | 'hospital'
  | 'fire_station'
  | 'police_station'
  // Landmarks (Alpha 2.17). 1-tile each, generate monthly tourism revenue
  // scaled by city population once they have road access.
  | 'museum'
  | 'stadium'
  | 'observatory'
  // Transit pack (Alpha 2.19). Ferry docks live on the water edge and
  // run boats between paired docks; subway entrances are cosmetic
  // people-teleporters that suppress nearby car spawns.
  | 'ferry_dock'
  | 'subway_entrance'
  // Architectural decoratives (Alpha 4.0 — Architect Mode). Each is a
  // single-tile placeable building with no upkeep simulation hooks; their
  // job is purely visual + civic prestige. Cheap basics (plaza / garden)
  // through to monumental end-game sinks (clock tower / triumphal arch).
  // Many cluster like parks — adjacent Architect tiles of the same kind
  // are flood-filled in the renderer for richer compositions, but the
  // building bit lives per-tile so save shape is unchanged.
  | 'plaza'
  | 'fountain'
  | 'statue'
  | 'flower_bed'
  | 'topiary'
  | 'pergola'
  | 'reflecting_pool'
  | 'memorial_garden'
  | 'clock_tower'
  | 'triumphal_arch'
  | 'pier'
  // Toronto landmark Easter eggs (Alpha 4.24). NOT exposed in any
  // toolbar / place tool / faction stance / milestone unlock — they
  // exist purely so the bundled Toronto preset (scripts/generate-
  // toronto.mjs) can paint iconic landmarks the generic museum /
  // stadium / observatory don't capture. Single-tile each with
  // visuals deliberately scaled larger than normal buildings so
  // they read as landmarks at the game's orthographic zoom. The
  // renderer's `cityBuildingParts` switch knows about them; every
  // simulation system silently ignores them (no population, no jobs,
  // no upkeep, no service coverage). Source-divers can spot them
  // here as a hint that the Toronto preset is the easter egg.
  | 'cn_tower'
  | 'rogers_centre'
  | 'scotiabank_arena'
  | 'union_station'
  | 'casa_loma'
  | 'royal_ontario_museum'
  | 'art_gallery_ontario'
  | 'distillery_district'
  | 'pearson_terminal'
  | 'runway'
  // The Mayor's Mansion (Alpha 4.2). Single-instance 4×2 showpiece —
  // the most detailed build in the game. The mansion itself occupies
  // the back row (4 tiles wide); the front row is lavish formal
  // grounds (parterre gardens, reflecting pool with central fountain,
  // bronze statues, balustrade, ornamental trees).
  //
  // Anchor pattern follows skyscrapers: the lex-smallest tile of the
  // 8-tile footprint owns the rendered geometry; the other seven are
  // marked-only via `Tile.mayorMansion`.
  | 'mayor_mansion'
  // Civic monuments (Alpha 4.12). Single-instance, multi-tile, anchor
  // pattern. Each provides a 35-tile L3 service field (power + water
  // + park) for free, suppressing the need for the player to scatter
  // utilities through the central district.
  // - city_hall: 5×3, modular composition (central rotunda + east /
  //   west wings + grand portico + clock cupola). Town milestone.
  // - provincial_capital: 6×4, Queens Park (Toronto) influence —
  //   pink-sandstone Romanesque Revival, central arched portico,
  //   stubby copper-domed central tower over a transverse axis.
  //   Metro milestone.
  // - national_capital: 7×4, Centre Block (Ottawa) influence —
  //   Gothic Revival, central tall clock tower with copper spire
  //   (intentionally capped below skyscraper height), twin symmetric
  //   wings, round library element behind. Capital milestone.
  | 'city_hall'
  | 'provincial_capital'
  | 'national_capital'
  // Cloverleaf interchange (Alpha 4.17). 5×5 prefab built via the per-
  // block placement system, same anchor pattern as the civic monuments.
  // The anchor's `building` value flips to `'cloverleaf'` only when all
  // 25 footprint blocks are paid; until then the anchor stays
  // `'none'` and per-tile construction sites render on paid blocks.
  | 'cloverleaf';

/**
 * One-time placement cost in $. Memory: feedback_challenge_tuning — services
 * should be a real budget call, not background spend.
 */
export const BUILDING_COSTS: Record<Exclude<Building, 'none'>, number> = {
  power_plant: 8000,
  water_tower: 4000,
  park: 1500,
  bus_stop: 800,
  bus_depot: 4000,
  // Forestry (Alpha 2.7) — modest sticker price; the lumber revenue is
  // the long-tail return. Only placeable on forest terrain.
  forestry: 1200,
  // Farm (Alpha 2.7.1) — grass-only modular industry mirroring forestry.
  farm: 1000,
  // Big Box store (Beta 1.3) — cheap per-tile sticker price (the
  // business model is a wide low-cost footprint, not a tall premium
  // build). A 4-tile big_box "supercluster" totals $4.8K — cheaper
  // than a single bus depot.
  big_box: 1200,
  // Warehouse (Beta 1.6) — per-tile sticker price. A 4-tile cluster
  // = $6K which is meaningful but cheaper than a hospital. The value
  // is in throughput: warehouses deliver supplies to commercial much
  // more efficiently than direct industry→commercial shipments.
  warehouse: 1500,
  // Parking Lot (Beta 1.3) — pavement is cheap; the lot's value comes
  // from how many cars it can stage. $200/tile keeps the player
  // willing to surround a big_box (or a downtown destination) with
  // enough stalls to actually relieve traffic.
  parking_lot: 200,
  // Public services pack (Alpha 2.10).
  school: 4000,
  hospital: 8000,
  fire_station: 5000,
  police_station: 5000,
  // Landmarks (Alpha 2.17). Sticker prices reflect their reach: a stadium
  // is the splashy big-ticket build, observatory is mid, museum is the
  // entry-tier landmark unlocked at Town.
  museum: 6000,
  stadium: 12000,
  observatory: 9000,
  // Transit pack (Alpha 2.19). Ferry dock anchors a water route; subway
  // entrance is the most expensive single-tile build because of the
  // large car-spawn-suppression radius it commands.
  ferry_dock: 4000,
  subway_entrance: 6000,
  // Architectural decoratives (Alpha 4.0). Pricing curve: cheap entry
  // basics (~$2K), mid-tier civic features ($5–25K), and end-game
  // monumental sinks ($50K+). These are deliberately the most
  // expensive single-tile placements in the game — late-game cash
  // dump for cities sitting on a fat treasury.
  plaza: 5000,
  fountain: 25000,
  statue: 15000,
  flower_bed: 2000,
  topiary: 8000,
  pergola: 6000,
  reflecting_pool: 20000,
  memorial_garden: 30000,
  clock_tower: 50000,
  triumphal_arch: 75000,
  pier: 3000,
  // Mayor's Mansion (Alpha 4.2) — by far the most expensive single
  // placement in the game. 4×2 footprint, single-instance, late-game
  // prestige sink. Replaces "what to spend a fat treasury on" with a
  // concrete monumental answer.
  mayor_mansion: 500000,
  // Civic monuments (Alpha 4.12). Each is one-per-city, with a step
  // up in cost matching the prestige tier:
  //   - City Hall: $1.5M (Town+) — every city should be able to build
  //     one before late-game.
  //   - Provincial Capital: $7.5M (Metro+) — the showpiece of a major
  //     city, replaces the role of "I have $10M what now" cleanly.
  //   - National Capital: $20M (Capital+) — the largest single sink in
  //     the game; designed to take a fully-developed treasury seriously.
  city_hall: 1500000,
  provincial_capital: 7500000,
  national_capital: 20000000,
  // Cloverleaf interchange (Alpha 4.17) — 5×5 prefab placed via per-
  // block construction. Total ~$50K spread across 25 blocks ≈ $2K/block.
  cloverleaf: 50000,
  // Toronto landmark Easter eggs (Alpha 4.24). Cost 0 because they're
  // not exposed in any place tool — only the bundled Toronto preset
  // stamps them. Listed here only so TS's exhaustive Building Record
  // type-checks. Source-divers, hi 👋
  cn_tower: 0,
  rogers_centre: 0,
  scotiabank_arena: 0,
  union_station: 0,
  casa_loma: 0,
  royal_ontario_museum: 0,
  art_gallery_ontario: 0,
  distillery_district: 0,
  pearson_terminal: 0,
  runway: 0
};

/** Monthly upkeep in $. Aggregated by `Economy` at month rollover. */
export const BUILDING_UPKEEP: Record<Exclude<Building, 'none'>, number> = {
  power_plant: 400,
  water_tower: 250,
  park: 80,
  bus_stop: 60,
  bus_depot: 300,
  forestry: 90,
  farm: 75,
  // Big Box upkeep (Beta 1.3). Lower than a school but real — the
  // store is a recurring expense beyond its job-generation revenue.
  big_box: 60,
  // Warehouse upkeep (Beta 1.6). Real recurring cost — staff,
  // forklifts, lighting, climate control. Higher than big_box
  // upkeep because warehouses do heavier work per tile (more truck
  // trips through them).
  warehouse: 80,
  // Parking Lot upkeep (Beta 1.3). Sweepers, paint, lighting — a
  // small but real recurring expense so the player can't pave the
  // city in stalls for free. Per-tile.
  parking_lot: 12,
  school: 200,
  hospital: 400,
  fire_station: 250,
  police_station: 250,
  museum: 200,
  stadium: 500,
  observatory: 250,
  ferry_dock: 250,
  subway_entrance: 350,
  // Architectural decoratives (Alpha 4.0) — modest upkeep on the cheap
  // pieces, real upkeep on the monuments. Net effect: late-game flair
  // costs ongoing money to keep, so a cash-rich player who built a row
  // of statues will see a fresh expense line every month forever.
  plaza: 20,
  fountain: 80,
  statue: 40,
  flower_bed: 10,
  topiary: 30,
  pergola: 25,
  reflecting_pool: 70,
  memorial_garden: 120,
  clock_tower: 200,
  triumphal_arch: 250,
  pier: 15,
  // Mayor's Mansion upkeep — equal to the most expensive ongoing line
  // in the game. Staff, gardeners, security. Cash-rich endgame
  // cities feel this on the budget panel forever.
  mayor_mansion: 1500,
  // Civic monuments (Alpha 4.12). Upkeep scales like the cost — these
  // are real ongoing operating costs (staff, security, maintenance).
  city_hall: 4000,
  provincial_capital: 15000,
  national_capital: 35000,
  // Cloverleaf upkeep — meaningful but not punishing. Multi-acre
  // pavement + medians + lighting. Equivalent to a small landmark.
  cloverleaf: 200,
  // Toronto landmark Easter eggs (Alpha 4.24). Free upkeep — they're
  // cosmetic-only and not exposed via any place tool.
  cn_tower: 0,
  rogers_centre: 0,
  scotiabank_arena: 0,
  union_station: 0,
  casa_loma: 0,
  royal_ontario_museum: 0,
  art_gallery_ontario: 0,
  distillery_district: 0,
  pearson_terminal: 0,
  runway: 0
};

/** Subway car-spawn suppression radius in tiles (Alpha 2.19). Tiles
 *  within this radius of an entrance get a strong probability of
 *  converting a car spawn into a walker — modelling the abstraction of
 *  underground rail without a separate graph. */
export const SUBWAY_SUPPRESSION_RADIUS = 6;

/**
 * Tourism revenue per landmark per month (Alpha 2.17). Each landmark adds
 * a flat base + a per-resident scaler. Revenue is gated on road access
 * (no road neighbour → no tourists). Stadium scales fastest because the
 * higher upkeep + cost should be worth it as the city grows; museum is
 * the entry-tier earner so it's always positive net once unlocked.
 */
export const LANDMARK_TOURISM_BASE: Record<'museum' | 'stadium' | 'observatory', number> = {
  museum: 50,
  stadium: 80,
  observatory: 40
};
export const LANDMARK_TOURISM_PER_RESIDENT: Record<'museum' | 'stadium' | 'observatory', number> = {
  museum: 0.05,
  stadium: 0.10,
  observatory: 0.04
};

/**
 * Forestry global-market parameters (Alpha 2.7). Per-tile per-month
 * lumber output × current global price × city's connection bonus.
 * Tuning targets: a 4-tile forestry op connected to the world should
 * earn roughly $400-$600/month at average market price.
 */
export const FORESTRY_BASE_REVENUE_PER_TILE = 110;
/** Multiplier on revenue when the city is NOT connected to the outside
 *  world by a highway-to-edge. Tradeable goods can still move locally
 *  but at a steep discount. */
export const FORESTRY_DISCONNECTED_MULT = 0.40;
/** Lumber-price oscillation: 1 ± LUMBER_AMP, period in sim months. */
export const LUMBER_AMP = 0.30;
export const LUMBER_PERIOD_MONTHS = 18;

/**
 * Farm global-market parameters (Alpha 2.7.1). Same shape as forestry —
 * per-tile lumber/produce per month × global price × connection. Lower
 * base revenue since farms are easier to set up and far less capital
 * intensive than a sawmill operation.
 */
export const FARM_BASE_REVENUE_PER_TILE = 85;
export const FARM_DISCONNECTED_MULT = 0.55;
/** Produce price oscillation. Different period from lumber (12 vs 18
 *  months) so the two markets don't perfectly align — a player who
 *  diversifies between forestry and farming has smoother revenue. */
export const PRODUCE_AMP = 0.25;
export const PRODUCE_PERIOD_MONTHS = 12;

/**
 * Service coverage radii in tile units. Buildings within a building's radius
 * mark the touched tiles' `hasPower` / `hasWater` / `hasPark` flags. Power +
 * water are required for any zoned tile to develop quickly; park is the
 * extra ingredient that unlocks L3.
 */
export const SERVICE_RADIUS = {
  // Power + water are city-wide as of Alpha 3.1.4 — kept here only for
  // legacy callers that still ask. The actual gating reads
  // `Services.cityHasPower / cityHasWater` and ignores per-tile distance.
  power: Infinity,
  water: Infinity,
  // Parks are now far more lenient (Alpha 3.1.4) — 10 tiles vs the
  // original 3 — so a single park covers a big chunk of a neighbourhood.
  park: 10,
  // Alpha 2.10 services pack — bigger reach than parks since each is
  // pricier and there are fewer per city. Beta 1.6.34 doubled
  // hospital / fire / police; Beta 1.6.35 bumped them another 50%
  // on playtest feedback. Net vs the 2.10 baseline: hospital ×3,
  // fire / police ×3. One emergency station now covers a small
  // city; a Metro needs 2-3 of each to fully blanket coverage,
  // which still leaves the player a real planning decision but
  // doesn't punish them for missing edge tiles.
  // Park / school left alone: park 10 is already generous; school 6
  // is a "walking distance" intent rather than a "coverage" intent.
  school: 6,
  hospital: 24,
  fire: 18,
  police: 18
} as const;

/**
 * Per-utility-plant capacity in "demand units" (Alpha 3.1.4). One
 * developed building (any density) consumes 1 unit. A power plant
 * supplies POWER_PLANT_CAPACITY units city-wide; if total demand
 * exceeds total supply, every developed tile loses power until the
 * player builds another plant.
 *
 * Numbers picked so the starter $8K power plant carries a small city
 * comfortably (~250 buildings) and a serious metropolis needs at
 * least 2-3 plants.
 */
export const POWER_PLANT_CAPACITY = 250;
export const WATER_TOWER_CAPACITY = 250;

/**
 * Fire station damping (Alpha 2.10) — multiplier on the per-tile fire
 * chance for industrial tiles inside a fire-station's coverage. 0.25
 * means a covered tile only catches fire 25% as often as an uncovered
 * one. Strong incentive to drop a fire station near industrial blocks.
 */
export const FIRE_PROTECTION_MULT = 0.25;

/**
 * Hospital coverage productivity bonus (Alpha 2.10). Tiles inside a
 * hospital radius generate +HOSPITAL_PRODUCTIVITY_BONUS commercial /
 * industrial revenue this month — sick days don't drag earnings.
 */
export const HOSPITAL_PRODUCTIVITY_BONUS = 0.08;

export interface MapSize {
  readonly width: number;
  readonly height: number;
}

export const MAP_SIZES: Record<'small' | 'medium' | 'large', MapSize> = {
  small: { width: 64, height: 64 },
  medium: { width: 128, height: 128 },
  large: { width: 256, height: 256 }
};

/* ---- Milestones (Alpha 2.8) ---------------------------------------- */

export type MilestoneId =
  | 'hamlet' | 'village' | 'town' | 'city' | 'metro' | 'capital';

export interface Milestone {
  readonly id: MilestoneId;
  readonly name: string;
  /** Display tag — appears in the banner. */
  readonly subtitle: string;
  /** Population threshold to earn this milestone. */
  readonly popThreshold: number;
  /** Tools unlocked when this milestone is earned. */
  readonly unlocks: readonly Tool[];
  /** One-time treasury bonus on earning. */
  readonly rewardCash: number;
  /** One-time Political Capital bonus on earning. */
  readonly rewardPC: number;
  /** Faction whose leader voices the congratulations banner. */
  readonly herald: 'chamber' | 'hometown' | 'working_families' | 'yimbys' | 'taxpayers' | 'transit';
  /** Bannered congratulations line in the herald's voice. */
  readonly blurb: string;
}

/**
 * Milestones in earn order (Alpha 2.8). Each one gates a slice of the
 * toolbar so a fresh city starts with basic R/C/I + local roads + parks
 * and earns the rest as it grows. Save persists `highestPop` so saves
 * loaded after this update don't lose access to anything they already
 * earned in the past.
 *
 * Always-available baseline: pan, bulldoze, road_local, place_path,
 * residential_low, commercial_low, industrial_low, mixed_low, place_park.
 */
export const MILESTONES: readonly Milestone[] = [
  {
    id: 'hamlet',
    name: 'Hamlet',
    subtitle: 'First households',
    popThreshold: 50,
    unlocks: ['residential_medium', 'commercial_medium', 'industrial_medium', 'mixed_medium'],
    rewardCash: 1000,
    rewardPC: 1,
    herald: 'hometown',
    blurb: 'Word\'s gettin around the country. Folks are puttin down roots here. Mid-density zoning is yours, mayor — use it well 🇺🇸'
  },
  {
    id: 'village',
    name: 'Village',
    subtitle: 'Becoming a real town',
    popThreshold: 200,
    unlocks: ['road_avenue', 'place_water', 'place_power', 'place_stop_sign', 'residential_luxury_low'],
    rewardCash: 2500,
    rewardPC: 2,
    herald: 'chamber',
    blurb: 'Real growth, real ratepayers. Avenues, utilities, stop signs and luxury low-density are all on the table now. Don\'t squander it 📈'
  },
  {
    id: 'town',
    name: 'Town',
    subtitle: 'Public services online',
    popThreshold: 500,
    unlocks: [
      'place_bus_stop', 'place_bus_depot',
      'commercial_high', 'industrial_high', 'mixed_high',
      'place_school', 'place_fire_station', 'place_police_station',
      'place_museum',
      // Beta 1.6.30 — Traffic lights moved from City (1000) → Town
      // (500). Playtest finding: at 500 pop with only stop signs
      // available, busy 4-way intersections gridlock because every
      // car has to FIFO-yield. Traffic lights' adaptive 2-phase
      // controller (Alpha 2.0) clears the same junction 2-3× faster.
      // Promoting the unlock to Town gives the player the right tool
      // for the traffic level they're already generating.
      'place_traffic_light',
      // Architect Mode entry tier (Alpha 4.0) — cheap basics so any
      // Town+ city can plant a tree, pour a flower bed, lay a plaza.
      'terra_tree', 'terra_meadow', 'terra_smooth',
      'place_flower_bed', 'place_plaza', 'place_pier',
      // Civic monuments (Alpha 4.12) — Town gets the entry-tier City
      // Hall. Provincial / National capitals unlock at Metro / Capital.
      'place_city_hall'
    ],
    rewardCash: 5000,
    rewardPC: 3,
    herald: 'transit',
    blurb: 'finally — a transit-eligible town. bus stops, depots, schools, fire + police stations, and high-density zoning all unlocked. let\'s make this a city that doesn\'t require a car 🚌'
  },
  {
    id: 'city',
    name: 'City',
    subtitle: 'Five digits and counting',
    popThreshold: 1000,
    unlocks: [
      'road_highway', 'residential_high', 'place_hospital', 'place_stadium', 'place_ferry_dock',
      // (Ramp + Cloverleaf were scrapped from the UI in Alpha 4.18.1
      //  — kept in code for backwards-compat with existing saves but
      //  no longer unlockable.)
      // Skyscrapers (Alpha 3.1.2). Unlocked at City — they need a real
      // city before they make sense.
      'residential_skyscraper', 'commercial_skyscraper', 'mixed_skyscraper',
      // Architect Mode mid-tier (Alpha 4.0) — water + civic features.
      'terra_pond', 'place_pergola', 'place_topiary', 'place_statue'
    ],
    rewardCash: 10000,
    rewardPC: 5,
    herald: 'yimbys',
    blurb: 'we did it!! a real city. highways, adaptive lights, high-density residential, and a hospital are unlocked. now build the housing supply your residents have been waiting for 🏙️'
  },
  {
    id: 'metro',
    name: 'Metropolis',
    subtitle: 'Diversifying the tax base',
    popThreshold: 2500,
    unlocks: [
      'place_forestry', 'place_farm', 'place_observatory',
      // Big Box + Parking Lot (Beta 1.3). Unlocked at Metro alongside
      // forestry / farm — same modular-industry tier. Big Box is a
      // suburban-commercial archetype; parking lots are the
      // infrastructure for it (and other downtown destinations).
      'place_big_box', 'place_warehouse', 'place_parking_lot',
      // Architect Mode upper-mid tier (Alpha 4.0) — premium water
      // features unlock once the city reads as a metropolis.
      'place_fountain', 'place_reflecting_pool', 'place_memorial_garden',
      // Civic monuments (Alpha 4.12) — Provincial Capital is the
      // Metro-tier showpiece building.
      'place_provincial_capital',
      // Level 4 / "Max" density (Alpha 4.18) — bridges L3 → skyscraper.
      // Unlocks at Metro since City already unlocks both L3 + skyscrapers,
      // and Metro is the natural next density progression.
      'residential_max', 'commercial_max', 'industrial_max', 'mixed_max'
    ],
    rewardCash: 20000,
    rewardPC: 8,
    herald: 'working_families',
    blurb: 'Metro status means real export industries. Forestry and farms are unlocked — these are the kind of jobs that put food on the table 🌾'
  },
  {
    id: 'capital',
    name: 'Capital',
    subtitle: 'Region-defining city',
    popThreshold: 5000,
    unlocks: [
      'place_subway_entrance',
      // Capital tier monumental architecture (Alpha 4.0) — the most
      // expensive single-tile placements in the game. Capitals can
      // build clock towers and triumphal arches; nobody else can.
      'place_clock_tower', 'place_triumphal_arch',
      // The Mayor's Mansion (Alpha 4.2) — single-instance 4×2
      // showpiece, the most detailed build in the game. Only a
      // Capital deserves one.
      'place_mayor_mansion',
      // National Capital (Alpha 4.12) — apex civic build, Centre
      // Block (Ottawa) influence, 7×4 footprint. Capital-only.
      'place_national_capital'
    ],
    rewardCash: 50000,
    rewardPC: 15,
    herald: 'taxpayers',
    blurb: 'A capital. Five thousand residents under one administration is no small feat. Treasury\'s topped up, but be prudent — every cent is borrowed from tomorrow 💼'
  }
];

/**
 * Tools available from the very first tile placed (Alpha 2.8). Everything
 * else is gated behind a milestone. Players who load a save with a
 * higher historical pop get auto-unlocks via Milestones from the
 * persisted `highestPop`.
 */
export const STARTING_TOOLS: ReadonlySet<Tool> = new Set([
  'pan', 'bulldoze',
  'road_local', 'place_path',
  'residential_low', 'commercial_low', 'industrial_low', 'mixed_low',
  'place_park',
  // Districts (Alpha 2.22) — never milestone-gated. The lever is always
  // available; district tax surtaxes only matter once you have buildings
  // to apply them to.
  'paint_district', 'erase_district',
  // Land purchase (Alpha 3.1.3) — always available so a fresh city can
  // start expanding the moment treasury allows.
  'buy_land'
]);

/**
 * Player-set zoning tier — the maximum density a tile is *permitted* to grow
 * to. Buildings still need demand + services to actually reach a tier;
 * zoning is an upper-bound permission, not a directive.
 *
 * - `low` (cap 1): tile stays at L1 detached/single-storey buildings forever.
 * - `medium` (cap 2): tile may grow to L2; L3 is locked.
 * - `high` (cap 3): tile may grow to L3 if power+water+park coverage allows.
 * - `max` (cap 4, Alpha 4.18): tile may grow to L4 mid-rise (~6-9
 *   storeys), bridging the visual gap between L3 and skyscrapers.
 *
 * Zone density is a separate axis from Zone (R/C/I/MU). All four zones
 * support all four tiers.
 */
export type ZoneTier = 'low' | 'medium' | 'high' | 'max';

export const ZONE_TIER_CAP: Record<ZoneTier, 1 | 2 | 3 | 4> = {
  low: 1,
  medium: 2,
  high: 3,
  max: 4
};

/**
 * Active tool. `pan` is the navigation default; the others repurpose
 * single-finger drag for painting on the grid. Pinch / two-finger pan still
 * navigate the camera regardless of tool.
 *
 * Road tiers (post-alpha pass 4): `road_local` / `road_avenue` /
 * `road_highway`. Highway strokes also imprint a flow direction on each
 * painted tile.
 *
 * Zone tiers (Alpha 1.1): each zone (R/C/I) splits into `_low` / `_medium`
 * / `_high` variants that set the player-permitted density cap on each
 * painted tile.
 */
export type Tool =
  | 'pan'
  | 'road_local'
  | 'road_avenue'
  | 'road_highway'
  // One-way highway tool (Beta 1.1.1). Same tier (`highway`) but
  // skips the dual-carriageway auto-paint — paints a single one-way
  // lane in the stroke direction. Used when the player wants
  // independent control over each direction of traffic flow (e.g. a
  // ramp, a slip lane, an exit-only). Direction set at paint time
  // from the stroke; flip with the highway_flip tool.
  | 'road_highway_oneway'
  // Highway flip tool (Beta 1.1.0). Single-tap a highway tile → flood-
  // fill the connected highway component (via road-graph edges, NOT
  // 4-adjacency — so two parallel one-way lanes are independent) →
  // reverse every tile's direction. Lets the player explicitly
  // control which way each highway flows.
  | 'highway_flip'
  | 'place_path'
  | 'bulldoze'
  | 'residential_low'
  | 'residential_medium'
  | 'residential_high'
  | 'residential_luxury_low'
  | 'commercial_low'
  | 'commercial_medium'
  | 'commercial_high'
  | 'industrial_low'
  | 'industrial_medium'
  | 'industrial_high'
  | 'mixed_low'
  | 'mixed_medium'
  | 'mixed_high'
  // Level 4 / "Max" density (Alpha 4.18). Mid-rise tier sitting between
  // L3 and skyscrapers — bridges the visual gap from ~3-4 storey L3 to
  // ~10-15 storey skyscrapers with ~6-9 storey buildings.
  | 'residential_max'
  | 'commercial_max'
  | 'industrial_max'
  | 'mixed_max'
  | 'place_power'
  | 'place_water'
  | 'place_park'
  | 'place_forestry'
  | 'place_farm'
  // Big Box store (Beta 1.3). Industry group toolbar entry. Modular
  // — adjacent big_box tiles cluster visually (see big_box building
  // notes). Lives in Industry alongside forestry + farm.
  | 'place_big_box'
  // Warehouse (Beta 1.6). Industry group toolbar entry. Modular like
  // big_box; requires parking. Plays the middle role of the supply
  // chain (industry → warehouse → commercial).
  | 'place_warehouse'
  // Parking Lot (Beta 1.3). Industry group toolbar entry. Stands
  // alone OR clusters into an adjacent big_box's paved field.
  | 'place_parking_lot'
  | 'place_school'
  | 'place_hospital'
  | 'place_fire_station'
  | 'place_police_station'
  | 'place_bus_stop'
  | 'place_bus_depot'
  | 'place_stop_sign'
  | 'place_traffic_light'
  // Highway interchange ramp (Alpha 4.16). Tap-only road-tile attachment;
  // marks the tile as a smooth merge between a highway and a non-highway
  // road. Visual + behavioural change — see RAMP_COST.
  | 'place_ramp'
  | 'place_museum'
  | 'place_stadium'
  | 'place_observatory'
  | 'place_ferry_dock'
  | 'place_subway_entrance'
  | 'paint_district'
  | 'erase_district'
  // Skyscrapers (Alpha 3.1.2). 2×2 footprint, 12-month build with
  // 4 visual construction stages, R / C / MU only.
  | 'residential_skyscraper'
  | 'commercial_skyscraper'
  | 'mixed_skyscraper'
  // Land purchase (Alpha 3.1.3). Tap-to-buy a single tile of unowned
  // land. Always available so the player can grow beyond the starter
  // area whenever they have the money.
  | 'buy_land'
  // ---- Architect Mode (Alpha 4.0) -------------------------------------
  // Terraforming paint tools — convert a tile's terrain so the player can
  // sculpt natural features beyond what the procedural generator gave
  // them. Paint flow (drag-stroke), per-tile cost. None of them touch
  // road / zone / building state on their own — the tile must be free.
  | 'terra_tree'        // grass → forest, single tile, cheap
  | 'terra_meadow'      // grass → sand (warm-coloured wildflower meadow)
  | 'terra_pond'        // grass → water, premium
  | 'terra_smooth'      // any decorative terrain → grass, cheap
  // Architectural decoratives — tap-to-place buildings (PLACE_TOOL_TO_BUILDING).
  // Tier and price scale up; cheapest is the flower bed, most expensive
  // is the triumphal arch.
  | 'place_plaza'
  | 'place_fountain'
  | 'place_statue'
  | 'place_flower_bed'
  | 'place_topiary'
  | 'place_pergola'
  | 'place_reflecting_pool'
  | 'place_memorial_garden'
  | 'place_clock_tower'
  | 'place_triumphal_arch'
  | 'place_pier'
  // The Mayor's Mansion (Alpha 4.2) — single-instance 4×2 footprint
  // showpiece. Tap-only; refuses if a mayor's mansion already exists.
  | 'place_mayor_mansion'
  // Civic monuments (Alpha 4.12). Each is one-per-city, anchor-tile
  // multi-tile build with a 35-tile L3 service field. Listed in the
  // toolbar's Mon group alongside the Mansion.
  | 'place_city_hall'
  | 'place_provincial_capital'
  | 'place_national_capital'
  // Cloverleaf interchange (Alpha 4.17). 5×5 prefab built per-block,
  // beautiful curved highway loops + grass infields + bridge over.
  // Lives in the Roads group (it's road infrastructure, not a building).
  | 'place_cloverleaf';

/**
 * Tools that paint a zone, mapped to (zone kind, density cap). Used by Game's
 * paint dispatcher to set both `Tile.zone` and `Tile.zoneCap` in one call.
 */
export const ZONE_TOOL_INFO: ReadonlyMap<Tool, { zone: Exclude<Zone, 'none'>; tier: ZoneTier }> = new Map([
  ['residential_low',    { zone: 'residential' as const, tier: 'low' as const }],
  ['residential_medium', { zone: 'residential' as const, tier: 'medium' as const }],
  ['residential_high',   { zone: 'residential' as const, tier: 'high' as const }],
  ['commercial_low',     { zone: 'commercial' as const,  tier: 'low' as const }],
  ['commercial_medium',  { zone: 'commercial' as const,  tier: 'medium' as const }],
  ['commercial_high',    { zone: 'commercial' as const,  tier: 'high' as const }],
  ['industrial_low',     { zone: 'industrial' as const,  tier: 'low' as const }],
  ['industrial_medium',  { zone: 'industrial' as const,  tier: 'medium' as const }],
  ['industrial_high',    { zone: 'industrial' as const,  tier: 'high' as const }],
  ['mixed_low',          { zone: 'mixed' as const,       tier: 'low' as const }],
  ['mixed_medium',       { zone: 'mixed' as const,       tier: 'medium' as const }],
  ['mixed_high',         { zone: 'mixed' as const,       tier: 'high' as const }],
  // Level 4 / "Max" density tier (Alpha 4.18) — mid-rise, ~6-9 storeys.
  ['residential_max',    { zone: 'residential' as const, tier: 'max' as const }],
  ['commercial_max',     { zone: 'commercial' as const,  tier: 'max' as const }],
  ['industrial_max',     { zone: 'industrial' as const,  tier: 'max' as const }],
  ['mixed_max',          { zone: 'mixed' as const,       tier: 'max' as const }]
]);

/** Tools that paint a road, mapped to their road tier. */
export const ROAD_TOOLS: ReadonlyMap<Tool, RoadType> = new Map([
  ['road_local', 'local' as const],
  ['road_avenue', 'avenue' as const],
  ['road_highway', 'highway' as const],
  // One-way highway (Beta 1.1.1) — same `highway` tier as the dual
  // tool. The applyRoadStroke check uses the Tool, not the tier, to
  // decide whether to auto-paint the parallel reverse-direction lane.
  ['road_highway_oneway', 'highway' as const]
]);

/** Maps a place-tool to the Building kind it places. */
export const PLACE_TOOL_TO_BUILDING: ReadonlyMap<Tool, Exclude<Building, 'none'>> = new Map([
  ['place_power', 'power_plant' as const],
  ['place_water', 'water_tower' as const],
  ['place_park', 'park' as const],
  ['place_forestry', 'forestry' as const],
  ['place_farm', 'farm' as const],
  // Big Box + Parking Lot (Beta 1.3).
  ['place_big_box', 'big_box' as const],
  ['place_warehouse', 'warehouse' as const],
  ['place_parking_lot', 'parking_lot' as const],
  ['place_school', 'school' as const],
  ['place_hospital', 'hospital' as const],
  ['place_fire_station', 'fire_station' as const],
  ['place_police_station', 'police_station' as const],
  ['place_bus_stop', 'bus_stop' as const],
  ['place_bus_depot', 'bus_depot' as const],
  ['place_museum', 'museum' as const],
  ['place_stadium', 'stadium' as const],
  ['place_observatory', 'observatory' as const],
  ['place_ferry_dock', 'ferry_dock' as const],
  ['place_subway_entrance', 'subway_entrance' as const],
  // Architect Mode decoratives (Alpha 4.0).
  ['place_plaza', 'plaza' as const],
  ['place_fountain', 'fountain' as const],
  ['place_statue', 'statue' as const],
  ['place_flower_bed', 'flower_bed' as const],
  ['place_topiary', 'topiary' as const],
  ['place_pergola', 'pergola' as const],
  ['place_reflecting_pool', 'reflecting_pool' as const],
  ['place_memorial_garden', 'memorial_garden' as const],
  ['place_clock_tower', 'clock_tower' as const],
  ['place_triumphal_arch', 'triumphal_arch' as const],
  ['place_pier', 'pier' as const],
  ['place_mayor_mansion', 'mayor_mansion' as const],
  // Civic monuments (Alpha 4.12).
  ['place_city_hall', 'city_hall' as const],
  ['place_provincial_capital', 'provincial_capital' as const],
  ['place_national_capital', 'national_capital' as const],
  // Cloverleaf interchange (Alpha 4.17). Per-block flow.
  ['place_cloverleaf', 'cloverleaf' as const]
]);

/* ---- Architect Mode terraforming costs (Alpha 4.0) -------------------- */
/** Cost in $ per painted tile for each terraforming tool. Cheap baseline
 *  basics so any city can sculpt; premium pricing on water (creates new
 *  shoreline) so cash-rich cities still feel the spend. Smooth-land is
 *  the cheap reset. */
export const TERRAFORM_COSTS: Record<
  'terra_tree' | 'terra_meadow' | 'terra_pond' | 'terra_smooth',
  number
> = {
  terra_tree: 200,
  terra_meadow: 400,
  terra_pond: 1500,
  terra_smooth: 50
};

/** All architectural decorative buildings (Alpha 4.0). Used by Renderer
 *  to recognise the "Architect-mode building" class without listing them
 *  by name in dozens of switch arms. */
export const ARCHITECTURAL_BUILDINGS: ReadonlySet<Exclude<Building, 'none'>> = new Set([
  'plaza', 'fountain', 'statue', 'flower_bed', 'topiary',
  'pergola', 'reflecting_pool', 'memorial_garden',
  'clock_tower', 'triumphal_arch', 'pier', 'mayor_mansion',
  // Civic monuments (Alpha 4.12) — they live with the Architect /
  // Mon group as well, even though they have a real service field.
  'city_hall', 'provincial_capital', 'national_capital'
] as const);

/** Mayor's Mansion footprint (Alpha 4.2) — 4 wide × 2 deep. The
 *  anchor tile is the lex-smallest of the 8-tile footprint (lowest
 *  x first, then lowest y). All 8 tiles share `Tile.mayorMansion =
 *  true`; the anchor's `Tile.building` is `'mayor_mansion'`. */
export const MAYOR_MANSION_WIDTH = 4;
export const MAYOR_MANSION_DEPTH = 2;

/** Civic-monument footprints (Alpha 4.12). All three follow the
 *  anchor-tile convention used by the Mansion — lex-smallest tile
 *  carries the `building` value, every other tile in the rectangle
 *  has the `cityHall` / `provincialCapital` / `nationalCapital` bit
 *  set. The bulldoze flow walks left+up to find the anchor and
 *  clears the entire rectangle.
 *
 *  Sized so each is visibly bigger and grander than the one before:
 *    - City Hall:           5 × 3 = 15 tiles  (larger than Mansion)
 *    - Provincial Capital:  6 × 4 = 24 tiles  (Queens Park scale)
 *    - National Capital:    7 × 4 = 28 tiles  (Centre Block scale)
 */
export const CITY_HALL_WIDTH = 5;
export const CITY_HALL_DEPTH = 3;
export const PROVINCIAL_CAPITAL_WIDTH = 6;
export const PROVINCIAL_CAPITAL_DEPTH = 4;
export const NATIONAL_CAPITAL_WIDTH = 7;
export const NATIONAL_CAPITAL_DEPTH = 4;
/** Cloverleaf interchange footprint (Alpha 4.17) — 5×5 = 25 tiles.
 *  Built via the same per-block placement system as the civic
 *  monuments. Anchor is the lex-smallest tile (top-left). */
export const CLOVERLEAF_WIDTH = 5;
export const CLOVERLEAF_DEPTH = 5;

/** Tile radius around any city-hall-class building (Alpha 4.12) inside
 *  which every developed building gets free power + water + park (i.e.
 *  the L3-unlock service field). User spec: "every city service needed
 *  for demand Lvl 3" within 35 blocks. Big number — these are flagship
 *  civic builds, the player should feel them across the central
 *  district. */
export const CIVIC_MONUMENT_SERVICE_RADIUS = 35;

/** Per-block cost for a big civic build (Alpha 4.15). Returns the
 *  rounded-up integer cost of placing one tile of the kind's footprint.
 *  Computed as ceil(BUILDING_COSTS[kind] / footprintTileCount) so the
 *  total over all blocks lines up with the listed building price. The
 *  player can spread the spend across many sim months, paying for
 *  one block at a time as they earn the money. */
export function monumentBlockCost(
  kind: 'mayor_mansion' | 'city_hall' | 'provincial_capital' | 'national_capital' | 'cloverleaf'
): number {
  const dims = (() => {
    switch (kind) {
      case 'mayor_mansion':      return MAYOR_MANSION_WIDTH * MAYOR_MANSION_DEPTH;
      case 'city_hall':          return CITY_HALL_WIDTH * CITY_HALL_DEPTH;
      case 'provincial_capital': return PROVINCIAL_CAPITAL_WIDTH * PROVINCIAL_CAPITAL_DEPTH;
      case 'national_capital':   return NATIONAL_CAPITAL_WIDTH * NATIONAL_CAPITAL_DEPTH;
      case 'cloverleaf':         return CLOVERLEAF_WIDTH * CLOVERLEAF_DEPTH;
    }
  })();
  return Math.ceil(BUILDING_COSTS[kind] / dims);
}

/** Big-build rotation index (Alpha 4.21). Number of 90° clockwise turns
 *  applied to the footprint around its center. For odd values the
 *  world-space dimensions swap (a 4×2 footprint at rot 1 becomes 2×4).
 *  The anchor (lex-smallest tile of the world-space rectangle) stays
 *  the same regardless of rotation. */
export type BigBuildRotation = 0 | 1 | 2 | 3;

/** Compute the world-space footprint dimensions of a big build given
 *  its native (rot=0) dimensions and a rotation. Used everywhere the
 *  game iterates the rectangle: validation, placement, perimeter
 *  scans for road access, footprint preview ghost. */
export function rotatedFootprint(
  nativeW: number, nativeH: number, rot: BigBuildRotation
): { w: number; h: number } {
  if (rot === 1 || rot === 3) return { w: nativeH, h: nativeW };
  return { w: nativeW, h: nativeH };
}

/* ---- Beautification Budget (Alpha 4.0 — council-only) ----------------- */

/**
 * Council Beautification Budget tier — sets the level of automatic
 * downtown streetscape flair on developed Commercial / Mixed-Use blocks.
 *
 * **CRITICAL DESIGN:** the mayor (the player) does NOT set this. Each
 * elected council picks one tier based on the sum of councillors'
 * `beautification` stances; mayoral override has no effect on it. This
 * is the first lever in the game where the council acts independently
 * of the mayor — explicitly modelling that downtown beautification
 * spending in real cities is typically a council line item.
 *
 * If a month rolls over and the treasury can't pay the bill, the tier
 * is *defunded* for that month: streetscape flare disappears city-wide
 * until the next council picks it up again or the player pays.
 */
export type BeautificationTier = 'none' | 'light' | 'standard' | 'grand' | 'opulent';

export interface BeautificationTierProps {
  /** Display label shown in the budget panel. */
  readonly label: string;
  /** Monthly $ deducted from treasury. 0 means no spend. */
  readonly monthlyCost: number;
  /** Sum-of-councillor-stances threshold: tier picked is the highest one
   *  whose threshold is ≤ summed stance. */
  readonly stanceThreshold: number;
}

/**
 * Tier table. Stance thresholds are calibrated so a council with mostly
 * neutral stances on beautification lands at "light", a chamber+
 * environmentalist majority lands at "standard", and a council where
 * every seat actively supports flair maxes out at "opulent".
 */
export const BEAUTIFICATION_TIERS: Record<BeautificationTier, BeautificationTierProps> = {
  none:     { label: 'None',     monthlyCost:     0, stanceThreshold: -99 },
  light:    { label: 'Light',    monthlyCost:   500, stanceThreshold: -1.0 },
  standard: { label: 'Standard', monthlyCost:  2000, stanceThreshold:  0.5 },
  grand:    { label: 'Grand',    monthlyCost:  5000, stanceThreshold:  1.8 },
  opulent:  { label: 'Opulent',  monthlyCost: 12000, stanceThreshold:  3.2 }
};
/** Display order — used by the budget panel + UI tooltips. */
export const BEAUTIFICATION_TIER_ORDER: readonly BeautificationTier[] = [
  'none', 'light', 'standard', 'grand', 'opulent'
];

/**
 * Eight directional connections from a tile. Indices double as bits in a
 * road-port bitmask, so a tile's connectivity fits in one byte.
 */
export const enum Dir {
  N = 0,
  NE = 1,
  E = 2,
  SE = 3,
  S = 4,
  SW = 5,
  W = 6,
  NW = 7
}

export const DIR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],  // N
  [1, -1],  // NE
  [1, 0],   // E
  [1, 1],   // SE
  [0, 1],   // S
  [-1, 1],  // SW
  [-1, 0],  // W
  [-1, -1]  // NW
];

/** Returns the index of the direction opposite to `d`. */
export function oppositeDir(d: number): number {
  return (d + 4) & 7;
}

/**
 * The direction index from grid (ax,ay) to grid (bx,by) when they are
 * 8-connected neighbours. Returns -1 if they aren't.
 */
export function dirBetween(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return -1;
  if (dx === 0 && dy === 0) return -1;
  for (let i = 0; i < 8; i++) {
    const o = DIR_OFFSETS[i]!;
    if (o[0] === dx && o[1] === dy) return i;
  }
  return -1;
}
