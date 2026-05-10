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
 * - **highway**: 2-lane one-way. Fastest tier when free-flowing; restricted
 *   direction means painting matters and on/off ramps need real planning.
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
  highway:  { baseSpeed: 4.0, slowdown: 0.20, maintenance: 40, color: 0x1f1f1f, width: 0.60 }
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

export const MAX_DENSITY = 3;

/**
 * Residents per residential tile by density tier. Index 0 is unused
 * (no building yet). Roughly exponential — matches how a low-poly cluster
 * of houses → townhouses → apartment block escalates capacity in a city sim.
 */
export const RESIDENT_CAPACITY: readonly number[] = [0, 4, 16, 64];

/** Jobs per commercial tile by density tier. */
export const COMMERCIAL_JOBS: readonly number[] = [0, 3, 12, 48];

/** Jobs per industrial tile by density tier. */
export const INDUSTRIAL_JOBS: readonly number[] = [0, 5, 20, 80];

/**
 * Mixed-use (Alpha 2.0) — same building footprint, but each tile
 * contributes residents AND commercial jobs. Half rate of a pure-zone tile
 * for each axis so a mixed-use block is denser than a single-use block of
 * the same density tier overall but doesn't double-count.
 */
export const MIXED_RESIDENT_CAPACITY: readonly number[] = [0, 2, 8, 32];
export const MIXED_COMMERCIAL_JOBS: readonly number[] = [0, 2, 6, 24];

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
 * Hard cap on simultaneously-active vehicles. Sized for the InstancedMesh —
 * 250 lets a fully-developed Medium map saturate without the spawner silently
 * dropping cars. Memory: feedback_traffic_pressure (post-alpha pass 2).
 */
export const MAX_VEHICLES = 250;

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
  | 'school'
  | 'hospital'
  | 'fire_station'
  | 'police_station';

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
  // Public services pack (Alpha 2.10).
  school: 4000,
  hospital: 8000,
  fire_station: 5000,
  police_station: 5000
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
  school: 200,
  hospital: 400,
  fire_station: 250,
  police_station: 250
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
  power: 8,
  water: 8,
  park: 3,
  // Alpha 2.10 services pack — bigger reach than parks since each is
  // pricier and there are fewer per city.
  school: 6,
  hospital: 8,
  fire: 6,
  police: 6
} as const;

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
      'place_school', 'place_fire_station', 'place_police_station'
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
    unlocks: ['road_highway', 'place_traffic_light', 'residential_high', 'place_hospital'],
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
    unlocks: ['place_forestry', 'place_farm'],
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
    unlocks: [],
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
  'place_park'
]);

/**
 * Player-set zoning tier — the maximum density a tile is *permitted* to grow
 * to. Buildings still need demand + services to actually reach a tier;
 * zoning is an upper-bound permission, not a directive.
 *
 * - `low` (cap 1): tile stays at L1 detached/single-storey buildings forever.
 * - `medium` (cap 2): tile may grow to L2; L3 is locked.
 * - `high` (cap 3): tile may grow to L3 if power+water+park coverage allows.
 *
 * Zone density is a separate axis from Zone (R/C/I). All three zones support
 * all three tiers.
 */
export type ZoneTier = 'low' | 'medium' | 'high';

export const ZONE_TIER_CAP: Record<ZoneTier, 1 | 2 | 3> = {
  low: 1,
  medium: 2,
  high: 3
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
  | 'place_power'
  | 'place_water'
  | 'place_park'
  | 'place_forestry'
  | 'place_farm'
  | 'place_school'
  | 'place_hospital'
  | 'place_fire_station'
  | 'place_police_station'
  | 'place_bus_stop'
  | 'place_bus_depot'
  | 'place_stop_sign'
  | 'place_traffic_light';

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
  ['mixed_high',         { zone: 'mixed' as const,       tier: 'high' as const }]
]);

/** Tools that paint a road, mapped to their road tier. */
export const ROAD_TOOLS: ReadonlyMap<Tool, RoadType> = new Map([
  ['road_local', 'local' as const],
  ['road_avenue', 'avenue' as const],
  ['road_highway', 'highway' as const]
]);

/** Maps a place-tool to the Building kind it places. */
export const PLACE_TOOL_TO_BUILDING: ReadonlyMap<Tool, Exclude<Building, 'none'>> = new Map([
  ['place_power', 'power_plant' as const],
  ['place_water', 'water_tower' as const],
  ['place_park', 'park' as const],
  ['place_forestry', 'forestry' as const],
  ['place_farm', 'farm' as const],
  ['place_school', 'school' as const],
  ['place_hospital', 'hospital' as const],
  ['place_fire_station', 'fire_station' as const],
  ['place_police_station', 'police_station' as const],
  ['place_bus_stop', 'bus_stop' as const],
  ['place_bus_depot', 'bus_depot' as const]
]);

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
