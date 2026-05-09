import type { Grid } from '../world/Grid';
import type { PathGraph } from './PathGraph';
import type { Pathfinding } from './Pathfinding';
import { MAX_PEDESTRIANS, PEDESTRIAN_PALETTE } from '../types';

/**
 * Pedestrian sim — runs alongside Vehicles and Buses. A walker spawns at a
 * developed residential tile (when it has a walkable neighbour), heads to a
 * developed commercial / industrial tile, walks the route over the
 * {@link PathGraph}, and despawns on arrival.
 *
 * Walking is decoupled from cars: pedestrians don't roll collisions, don't
 * stop for stop signs, don't yield. They move at a steady pace along their
 * route. The presence of a path covering an R↔C/I route reduces car spawns
 * (see {@link Vehicles.attemptSpawn} — same suppression knob as bus stops).
 *
 * Walking distance cap: pedestrians only spawn for routes shorter than
 * {@link MAX_WALK_TILES}. Long trips stay drivers — paths are for
 * neighborhood mobility, not cross-city journeys.
 */

const MAX_WALK_TILES = 18;
/**
 * Spawn attempts per resident per real-time second. Bumped in Alpha 2.0
 * — at the previous 0.0018 the streets felt empty for the size of the
 * cap. 0.005 is roughly equal to the car spawn rate; combined with cap
 * 500 the visual density now matches a mid-sized European downtown at
 * peak (~1 walker per tile on busy blocks).
 */
const SPAWN_PER_RESIDENT_PER_SEC = 0.005;
/** Walking speed in tile units per second. Real-feeling: ~5 km/h on a 1m grid. */
const WALK_SPEED = 0.85;

export interface Walker {
  pathTiles: number[];
  segmentIdx: number;
  segmentT: number;
  color: number;
  /**
   * Which side of the direction-of-travel the walker uses: -1 = left,
   * +1 = right. Picked at spawn and held for the trip. The renderer
   * resolves this to a perpendicular offset that depends on the tile
   * the walker is currently on (sidewalk-band offset on a road tile,
   * a small spread on a path tile) so they walk *beside* cars rather
   * than on top of them.
   */
  side: 1 | -1;
}

export class Pedestrians {
  readonly walkers: Walker[] = [];
  private spawnAccumulator = 0;

  spawnTick(stepMs: number, grid: Grid, pathGraph: PathGraph, pathfinder: Pathfinding, residents: number): void {
    if (residents <= 0) return;
    const seconds = stepMs / 1000;
    this.spawnAccumulator += residents * SPAWN_PER_RESIDENT_PER_SEC * seconds;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      if (this.walkers.length >= MAX_PEDESTRIANS) {
        this.spawnAccumulator = 0;
        break;
      }
      this.attemptSpawn(grid, pathGraph, pathfinder);
    }
  }

  private attemptSpawn(grid: Grid, pathGraph: PathGraph, pathfinder: Pathfinding): void {
    const origin = pickRandomDevelopedTile(grid, 'residential');
    if (!origin) return;
    const destZone = Math.random() < 0.5 ? 'commercial' : 'industrial';
    const dest = pickRandomDevelopedTile(grid, destZone);
    if (!dest) return;

    const start = nearestWalkableTile(grid, pathGraph, origin.x, origin.y);
    if (!start) return;
    const end = nearestWalkableTile(grid, pathGraph, dest.x, dest.y);
    if (!end) return;

    const startIdx = start.y * grid.width + start.x;
    const endIdx = end.y * grid.width + end.x;
    if (startIdx === endIdx) return;

    const path = pathfinder.findPath(pathGraph, startIdx, endIdx, grid.width);
    if (!path || path.length < 2 || path.length > MAX_WALK_TILES) return;

    const color = PEDESTRIAN_PALETTE[Math.floor(Math.random() * PEDESTRIAN_PALETTE.length)] ?? 0xffffff;
    this.walkers.push({
      pathTiles: path,
      segmentIdx: 0,
      segmentT: 0,
      color,
      side: Math.random() < 0.5 ? -1 : 1
    });
  }

  /** Advance every walker. Walkers despawn when they reach their final tile. */
  update(dt: number, gridWidth: number): void {
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i]!;
      const aIdx = w.pathTiles[w.segmentIdx]!;
      const bIdx = w.pathTiles[w.segmentIdx + 1];
      if (bIdx === undefined) {
        this.walkers.splice(i, 1);
        continue;
      }
      const ax = aIdx % gridWidth;
      const ay = (aIdx - ax) / gridWidth;
      const bx = bIdx % gridWidth;
      const by = (bIdx - bx) / gridWidth;
      const segLen = Math.hypot(bx - ax, by - ay) || 1;
      const advance = (WALK_SPEED * dt) / segLen;
      w.segmentT += advance;
      while (w.segmentT >= 1) {
        w.segmentT -= 1;
        w.segmentIdx++;
        if (w.segmentIdx >= w.pathTiles.length - 1) {
          this.walkers.splice(i, 1);
          break;
        }
      }
    }
  }

  clear(): void {
    this.walkers.length = 0;
  }
}

function pickRandomDevelopedTile(
  grid: Grid,
  zone: 'residential' | 'commercial' | 'industrial'
): { x: number; y: number } | null {
  let chosen: { x: number; y: number } | null = null;
  let count = 0;
  for (const t of grid.iter()) {
    if (t.density === 0 || t.road) continue;
    // Mixed-use tiles count as both R origin and C destination — they
    // hold residents AND commercial jobs.
    const matches =
      t.zone === zone ||
      (t.zone === 'mixed' && (zone === 'residential' || zone === 'commercial'));
    if (!matches) continue;
    count++;
    if (Math.random() * count < 1) chosen = { x: t.x, y: t.y };
  }
  return chosen;
}

/**
 * 4-connected walkable neighbour of (x, y), preferring path tiles over
 * road tiles. A residential tile next to both a path and a road sends its
 * pedestrians via the path first.
 */
function nearestWalkableTile(grid: Grid, pathGraph: PathGraph, x: number, y: number): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number }> = [
    { x: x, y: y - 1 },
    { x: x + 1, y: y },
    { x: x, y: y + 1 },
    { x: x - 1, y: y }
  ];
  // First pass: pick a path tile if available.
  for (const c of candidates) {
    if (grid.hasPath(c.x, c.y) && pathGraph.isWalkableAt(grid, c.x, c.y)) return c;
  }
  for (const c of candidates) {
    if (pathGraph.isWalkableAt(grid, c.x, c.y)) return c;
  }
  return null;
}

/**
 * True if the residential tile at (rx, ry) has a walkable connection to a
 * commercial OR industrial developed tile within MAX_WALK_TILES. Used by
 * Vehicles to suppress car spawns when paths cover the trip. Cheap-ish:
 * does one A*-style early-exit on a small budget.
 */
export function residentialHasWalkableJob(
  grid: Grid,
  pathGraph: PathGraph,
  pathfinder: Pathfinding,
  rx: number,
  ry: number
): boolean {
  const start = nearestWalkableTile(grid, pathGraph, rx, ry);
  if (!start) return false;
  const startIdx = start.y * grid.width + start.x;
  if (!pathGraph.has(startIdx)) return false;
  // Sample one C/I tile and see if a short walk exists. Random sample keeps
  // the check O(walking limit) instead of O(zoned-tiles²).
  const dest =
    pickRandomDevelopedTile(grid, Math.random() < 0.5 ? 'commercial' : 'industrial');
  if (!dest) return false;
  const end = nearestWalkableTile(grid, pathGraph, dest.x, dest.y);
  if (!end) return false;
  const endIdx = end.y * grid.width + end.x;
  if (startIdx === endIdx) return true;
  const path = pathfinder.findPath(pathGraph, startIdx, endIdx, grid.width);
  return !!path && path.length <= MAX_WALK_TILES;
}
