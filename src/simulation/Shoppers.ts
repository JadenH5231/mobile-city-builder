/**
 * Shoppers (Beta 1.3.4 — Phase 2.1; Beta 1.5.1 — PathGraph routing).
 * The walking final-leg of a parking trip. When a car arrives at a
 * destination with a parking stall, the car parks visibly in the stall
 * AND a Shopper is spawned at the stall position. The Shopper walks
 * to the destination tile via the PEDESTRIAN PATH NETWORK (sidewalks +
 * walking paths), "shops" briefly at the destination, then walks the
 * same route back to the stall. When the timer expires, the Shopper
 * despawns (its associated Car already despawns on the same timer via
 * `parkedUntil`).
 *
 * Pre-1.5.1 the shopper used a straight-line lerp from stall to
 * destination, which made the player see walkers cutting straight
 * across grass / buildings / other zones. Beta 1.5.1 replaces the lerp
 * with a PathGraph A* pathfind so shoppers travel along the same
 * sidewalk network that regular pedestrians use. Fallback to straight-
 * line behaviour preserved for the case where no walkable tiles exist
 * near the parking lot or destination (early-game cities without paths).
 *
 * Renderer hooks: `shopperBodiesMesh` + `shopperHeadsMesh` in
 * Renderer.ts, sized at MAX_SHOPPERS capacity. `updateShoppers` reads
 * each Shopper's interpolated world position each frame.
 */

import type { ParkingStall } from './Parking';
import type { Grid } from '../world/Grid';
import type { PathGraph } from './PathGraph';
import type { Pathfinding } from './Pathfinding';
import { TILE_SIZE } from '../types';

/** Cap on simultaneously-visible shoppers. One per parked car at the
 *  Vehicles cap (~250 cars) sets an upper bound, but in practice most
 *  trips don't have parking so far fewer fire. 300 is generous and
 *  cheap on the InstancedMesh budget. */
export const MAX_SHOPPERS = 300;

/** Walking speed sentinel — used only by the duration calculator so
 *  the shopper's outbound + return legs feel consistent regardless of
 *  the path length from stall to destination. */
const SHOPPER_WALK_TILES_PER_SEC = 0.7;

/** Minimum outbound / return phase duration, in seconds. Even on a
 *  tiny lot where stall is right at the storefront, the shopper walks
 *  AT LEAST this long so the visual reads. */
const MIN_LEG_SEC = 2;

/** Fraction of the total trip spent "shopping" at the destination
 *  (invisible — the shopper has entered the store). Sits between the
 *  outbound and return legs. */
const SHOPPING_FRACTION = 0.20;

/** Cap on the shopper's PathGraph A* expansion (Beta 1.5.1). Most
 *  shopper trips are 1-5 tiles; this cap protects against expensive
 *  searches when the graph is large and the destination is far. If
 *  the path can't be found within this many tiles, we fall back to a
 *  straight line — a longer trip would visually read as a parked car
 *  whose shopper teleports anyway. */
const MAX_SHOPPER_PATH_TILES = 12;

export interface Shopper {
  /** World-space waypoints the shopper walks through in order
   *  (outbound). Length ≥ 2: first entry is the stall position, last
   *  entry is the destination tile centre. Intermediate entries are
   *  the PathGraph tile centres along the route. Return leg walks the
   *  same waypoints in reverse. */
  waypoints: ReadonlyArray<{ x: number; z: number }>;
  /** Cumulative distance from waypoints[0] to waypoints[i]. Same length
   *  as `waypoints`; `lengths[0] = 0`. Used by `resolve` to find which
   *  segment the shopper is currently on without iterating per-frame. */
  lengths: ReadonlyArray<number>;
  /** Total walk distance = lengths[length - 1]. Cached for the outbound
   *  fraction → world-position math. */
  totalLength: number;
  /** Elapsed seconds since spawn. */
  elapsed: number;
  /** Total trip duration in seconds. Aligned to the Car's `parkedUntil`
   *  in the Vehicles sim so they expire together. */
  totalSec: number;
  /** Phase boundaries computed at spawn time. */
  outEnd: number;    // seconds — outbound leg ends
  shopEnd: number;   // seconds — shopping ends, return begins
  /** Colour from the existing pedestrian palette so shoppers blend
   *  visually with regular walkers. */
  color: number;
  /** Floor lift to keep the model on top of the asphalt without
   *  z-fighting. SIDEWALK_LIFT-ish. */
  yLift: number;
}

export class Shoppers {
  readonly list: Shopper[] = [];

  /** Spawn a shopper for a parked car. Total duration is the car's
   *  visit window (same `parkedUntil - now` as the car), so the
   *  shopper and the car despawn together.
   *
   *  Beta 1.5.1 — `grid`, `pathGraph`, `pathfinder` parameters added
   *  so the shopper's route can be planned along sidewalks + walking
   *  paths instead of cutting straight across the world. When the
   *  pathfind succeeds, the shopper walks the resulting waypoint
   *  chain at SHOPPER_WALK_TILES_PER_SEC. When it fails (no walkable
   *  tile near stall or destination, no PathGraph route), the shopper
   *  falls back to a straight-line lerp like pre-1.5.1.
   *
   *  If the trip duration is too short to comfortably accommodate the
   *  walking legs, the legs get clamped to MIN_LEG_SEC and the
   *  shopping middle shrinks accordingly. */
  spawnForParkedCar(
    stall: ParkingStall,
    destTileX: number,
    destTileY: number,
    visitDurationMs: number,
    color: number,
    yBase: number,
    grid?: Grid,
    pathGraph?: PathGraph,
    pathfinder?: Pathfinding
  ): void {
    if (this.list.length >= MAX_SHOPPERS) return;
    const totalSec = Math.max(0.5, visitDurationMs / 1000);
    const destX = (destTileX + 0.5) * TILE_SIZE;
    const destZ = (destTileY + 0.5) * TILE_SIZE;

    // Build the waypoint chain. Prefer PathGraph routing; fall back to
    // straight-line if any step is missing or fails.
    const waypoints = buildShopperWaypoints(
      stall.worldX, stall.worldZ, stall.tileX, stall.tileY,
      destX, destZ, destTileX, destTileY,
      grid, pathGraph, pathfinder
    );

    // Cumulative segment lengths for distance-based interpolation.
    const lengths: number[] = [0];
    let totalLength = 0;
    for (let i = 1; i < waypoints.length; i++) {
      const dx = waypoints[i]!.x - waypoints[i - 1]!.x;
      const dz = waypoints[i]!.z - waypoints[i - 1]!.z;
      totalLength += Math.hypot(dx, dz);
      lengths.push(totalLength);
    }

    // Walk-time budget = max(MIN_LEG_SEC, totalLength / speed). Longer
    // paths take proportionally longer.
    const legSec = Math.max(MIN_LEG_SEC, totalLength / SHOPPER_WALK_TILES_PER_SEC);
    const idealMiddle = totalSec * SHOPPING_FRACTION;
    const projectedTotal = legSec * 2 + idealMiddle;
    const middleSec = projectedTotal <= totalSec
      ? idealMiddle
      : Math.max(0, totalSec - legSec * 2);
    const outEnd = legSec;
    const shopEnd = outEnd + middleSec;

    this.list.push({
      waypoints,
      lengths,
      totalLength,
      elapsed: 0,
      totalSec,
      outEnd,
      shopEnd,
      color,
      yLift: yBase + 0.005
    });
  }

  /** Tick every shopper forward. Despawn when the timer expires.
   *  Called from Game per render frame (same cadence as updateCars). */
  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i]!;
      s.elapsed += dt;
      if (s.elapsed >= s.totalSec) {
        this.list.splice(i, 1);
      }
    }
  }

  /** Drop every shopper — called on city reset / save load. */
  clear(): void {
    this.list.length = 0;
  }

  /** Resolve the current world-space position + visibility + facing
   *  for one shopper. Used by Renderer.updateShoppers. Returns
   *  `visible: false` while the shopper is "in the store" (shopping
   *  phase). Interpolates along the waypoint chain by distance so
   *  the shopper moves at constant speed regardless of the per-
   *  segment length variation. */
  resolve(s: Shopper): {
    x: number; z: number; yaw: number; visible: boolean;
  } {
    if (s.elapsed < s.outEnd) {
      // Outbound leg.
      const lerp = s.outEnd > 0 ? s.elapsed / s.outEnd : 1;
      return positionAlongWaypoints(s, lerp * s.totalLength, /* forward */ true);
    } else if (s.elapsed < s.shopEnd) {
      // Shopping. Hidden from world — they're "inside" the store.
      const last = s.waypoints[s.waypoints.length - 1]!;
      return { x: last.x, z: last.z, yaw: 0, visible: false };
    } else {
      // Return leg. Walk waypoints in reverse.
      const returnLegSec = s.totalSec - s.shopEnd;
      const lerp = returnLegSec > 0 ? Math.min(1, (s.elapsed - s.shopEnd) / returnLegSec) : 1;
      return positionAlongWaypoints(s, lerp * s.totalLength, /* forward */ false);
    }
  }
}

/** Interpolate the shopper's world position at `distance` along the
 *  waypoint chain. `forward = true` walks waypoints[0] → waypoints[N-1];
 *  `forward = false` walks the reverse. Yaw faces the next waypoint. */
function positionAlongWaypoints(
  s: Shopper,
  distance: number,
  forward: boolean
): { x: number; z: number; yaw: number; visible: boolean } {
  if (s.waypoints.length < 2) {
    const wp = s.waypoints[0] ?? { x: 0, z: 0 };
    return { x: wp.x, z: wp.z, yaw: 0, visible: true };
  }
  // For backward travel, mirror the distance against the chain.
  const d = forward ? distance : s.totalLength - distance;
  // Find the segment containing distance d. Linear scan over a small
  // (≤12) waypoint chain is cheaper than binary search.
  for (let i = 1; i < s.waypoints.length; i++) {
    if (d <= s.lengths[i]!) {
      const segStart = s.waypoints[i - 1]!;
      const segEnd = s.waypoints[i]!;
      const segLen = s.lengths[i]! - s.lengths[i - 1]!;
      const segT = segLen > 0 ? (d - s.lengths[i - 1]!) / segLen : 0;
      const x = segStart.x + (segEnd.x - segStart.x) * segT;
      const z = segStart.z + (segEnd.z - segStart.z) * segT;
      // Face the direction of travel (forward = toward segEnd;
      // backward = toward segStart so we use the reverse direction).
      const yaw = forward
        ? Math.atan2(segEnd.x - segStart.x, segEnd.z - segStart.z)
        : Math.atan2(segStart.x - segEnd.x, segStart.z - segEnd.z);
      return { x, z, yaw, visible: true };
    }
  }
  // Past the end of the chain — clamp to the last waypoint.
  const last = forward ? s.waypoints[s.waypoints.length - 1]! : s.waypoints[0]!;
  return { x: last.x, z: last.z, yaw: 0, visible: true };
}

/** Compute the shopper's waypoint chain from the parking stall to the
 *  destination tile centre. Prefers the PathGraph (sidewalks + paths +
 *  parks) for the middle leg; falls back to a straight line if no
 *  walkable entry/approach tile is found or no path exists. */
function buildShopperWaypoints(
  stallX: number, stallZ: number,
  parkingTileX: number, parkingTileY: number,
  destX: number, destZ: number,
  destTileX: number, destTileY: number,
  grid?: Grid,
  pathGraph?: PathGraph,
  pathfinder?: Pathfinding
): Array<{ x: number; z: number }> {
  // If any prerequisite is missing, fall back to straight line.
  if (!grid || !pathGraph || !pathfinder) {
    return [{ x: stallX, z: stallZ }, { x: destX, z: destZ }];
  }

  // Find the closest walkable tile 4-adjacent to the parking lot tile.
  const entry = nearestWalkableNeighbour(grid, pathGraph, parkingTileX, parkingTileY);
  if (!entry) return [{ x: stallX, z: stallZ }, { x: destX, z: destZ }];

  // Find the closest walkable tile 4-adjacent to the destination tile.
  const approach = nearestWalkableNeighbour(grid, pathGraph, destTileX, destTileY);
  if (!approach) return [{ x: stallX, z: stallZ }, { x: destX, z: destZ }];

  const entryIdx = entry.y * grid.width + entry.x;
  const approachIdx = approach.y * grid.width + approach.x;

  // Same tile? Shopper walks stall → entry → dest (no middle path).
  if (entryIdx === approachIdx) {
    return [
      { x: stallX, z: stallZ },
      { x: (entry.x + 0.5) * TILE_SIZE, z: (entry.y + 0.5) * TILE_SIZE },
      { x: destX, z: destZ }
    ];
  }

  const path = pathfinder.findPath(pathGraph, entryIdx, approachIdx, grid.width);
  if (!path || path.length < 2 || path.length > MAX_SHOPPER_PATH_TILES) {
    return [{ x: stallX, z: stallZ }, { x: destX, z: destZ }];
  }

  // Build waypoints: stall, then each path tile centre, then destination.
  const waypoints: Array<{ x: number; z: number }> = [{ x: stallX, z: stallZ }];
  for (const idx of path) {
    const tx = idx % grid.width;
    const ty = (idx - tx) / grid.width;
    waypoints.push({ x: (tx + 0.5) * TILE_SIZE, z: (ty + 0.5) * TILE_SIZE });
  }
  waypoints.push({ x: destX, z: destZ });
  return waypoints;
}

/** Find the closest 4-adjacent walkable tile (sidewalk / path / park)
 *  to (x, y). Returns null if no neighbour is walkable. */
function nearestWalkableNeighbour(
  grid: Grid,
  pathGraph: PathGraph,
  x: number,
  y: number
): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number }> = [
    { x, y: y - 1 },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x - 1, y }
  ];
  // Prefer dedicated walking-path tiles over road sidewalks.
  for (const c of candidates) {
    if (grid.hasPath(c.x, c.y) && pathGraph.isWalkableAt(grid, c.x, c.y)) return c;
  }
  for (const c of candidates) {
    if (pathGraph.isWalkableAt(grid, c.x, c.y)) return c;
  }
  return null;
}
