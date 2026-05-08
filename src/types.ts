// Shared types and constants. Kept dependency-free so any module can import freely.

/** World-space side length of one grid cell, in Three.js units. 1.0 keeps math simple. */
export const TILE_SIZE = 1;

/**
 * Visual road width as a fraction of TILE_SIZE. 0.45 covers most of a tile
 * but leaves a sliver of grass between parallel roads.
 */
export const ROAD_WIDTH = 0.45;

/** How far above the terrain plane the road meshes sit, to avoid z-fighting. */
export const ROAD_LIFT = 0.02;
/** Zone overlays sit just above terrain but under roads. */
export const ZONE_LIFT = 0.005;

export type TerrainType = 'grass' | 'forest' | 'water' | 'sand';

export type Zone = 'none' | 'residential' | 'commercial' | 'industrial';

/**
 * Cities: Skylines convention — green / blue / yellow. Slightly desaturated so
 * the overlay reads as "tinted ground" rather than a solid colour swatch.
 */
export const ZONE_COLORS: Record<Exclude<Zone, 'none'>, number> = {
  residential: 0x6dd06a,
  commercial: 0x4d8ce8,
  industrial: 0xeec453
};

/**
 * Per-zone, per-density placeholder building palette. Index 0 is unused
 * (density 0 = no building); 1..3 = low / medium / high. Each row escalates
 * from a softer "village" tone to a dense "downtown" tone.
 */
export const BUILDING_COLORS: Record<Exclude<Zone, 'none'>, readonly [number, number, number, number]> = {
  residential: [0x000000, 0xd9c89e, 0xb89970, 0x8a6f4e],
  commercial:  [0x000000, 0xc0d4ec, 0x7a92b5, 0x52688a],
  industrial:  [0x000000, 0xb0a080, 0x7e6e58, 0x584c3a]
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
  | 'bus_depot';

/**
 * One-time placement cost in $. Memory: feedback_challenge_tuning — services
 * should be a real budget call, not background spend.
 */
export const BUILDING_COSTS: Record<Exclude<Building, 'none'>, number> = {
  power_plant: 8000,
  water_tower: 4000,
  park: 1500,
  bus_stop: 800,
  bus_depot: 4000
};

/** Monthly upkeep in $. Aggregated by `Economy` at month rollover. */
export const BUILDING_UPKEEP: Record<Exclude<Building, 'none'>, number> = {
  power_plant: 400,
  water_tower: 250,
  park: 80,
  bus_stop: 60,
  bus_depot: 300
};

/**
 * Service coverage radii in tile units. Buildings within a building's radius
 * mark the touched tiles' `hasPower` / `hasWater` / `hasPark` flags. Power +
 * water are required for any zoned tile to develop quickly; park is the
 * extra ingredient that unlocks L3.
 */
export const SERVICE_RADIUS = {
  power: 8,
  water: 8,
  park: 3
} as const;

export interface MapSize {
  readonly width: number;
  readonly height: number;
}

export const MAP_SIZES: Record<'small' | 'medium' | 'large', MapSize> = {
  small: { width: 64, height: 64 },
  medium: { width: 128, height: 128 },
  large: { width: 256, height: 256 }
};

/**
 * Active tool. `pan` is the navigation default; the others repurpose
 * single-finger drag for painting on the grid. Pinch / two-finger pan still
 * navigate the camera regardless of tool.
 */
export type Tool =
  | 'pan'
  | 'road'
  | 'bulldoze'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'place_power'
  | 'place_water'
  | 'place_park'
  | 'place_bus_stop'
  | 'place_bus_depot';

/** Tools that paint a zone. Maps directly to a Zone value. */
export const ZONE_TOOLS = new Set<Tool>(['residential', 'commercial', 'industrial']);

/** Maps a place-tool to the Building kind it places. */
export const PLACE_TOOL_TO_BUILDING: ReadonlyMap<Tool, Exclude<Building, 'none'>> = new Map([
  ['place_power', 'power_plant' as const],
  ['place_water', 'water_tower' as const],
  ['place_park', 'park' as const],
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
