import type { Grid } from '../world/Grid';
import type { Pathfinding } from './Pathfinding';
import type { RoadGraph } from './RoadGraph';
import { MAX_VEHICLES, VEHICLE_PALETTE } from '../types';
import { nearBusStop } from './Buses';

/**
 * Spawn attempts per resident per real-time second. With 1500 residents that's
 * ~7.5 attempts/sec — enough to saturate the road network and force the
 * player to think about traffic flow.
 *
 * Memory: feedback_traffic_pressure (post-alpha pass 2). The original fixed
 * 1.5s interval kept a 100-pop city and a 1500-pop city at the same car
 * volume, which is why traffic stress never engaged in playtesting.
 */
const SPAWN_PER_RESIDENT_PER_SEC = 0.005;
/** Tiles per second of a free-flowing car. */
const BASE_SPEED = 2.0;
/** Slowdown coefficient: effective speed = base / (1 + load × COEF). Memory: feedback_traffic_pressure. */
const SLOWDOWN_COEF = 0.5;
/** Probability a candidate spawn near a bus stop is silently dropped. */
const BUS_STOP_SUPPRESSION = 0.7;

export interface Car {
  /** Flat tile indices, length ≥ 2. The path the car follows in order. */
  pathTiles: number[];
  /** Current segment is from pathTiles[segmentIdx] → pathTiles[segmentIdx + 1]. */
  segmentIdx: number;
  /** [0..1] progress along the current segment. */
  segmentT: number;
  /** Tiles per second along the segment, before traffic-load slowdown. */
  speed: number;
  color: number;
  /** The tile we're currently counted against for traffic load. */
  loadedTile: number;
}

/**
 * Cars: spawning at sim rate, smooth motion at render rate.
 *
 * Spawn picks a random developed Residential tile as the origin and a random
 * developed Commercial or Industrial tile as the destination, then routes via
 * A* on the road graph. Movement is decoupled from sim — `update(dt, …)` runs
 * every render frame so cars never appear to skip or freeze when the sim
 * tick fires.
 *
 * Traffic load on each tile is maintained here so consumers (Traffic EMA,
 * Population stress, the heatmap) get a consistent number to read.
 */
export class Vehicles {
  readonly cars: Car[] = [];
  /** Spawn credits accumulator, in fractional cars-to-spawn. */
  private spawnAccumulator = 0;

  /**
   * @param residents Total residents in the city — drives spawn rate. Pass
   *   `Population.totalResidents`. Zero means no spawn attempts.
   */
  spawnTick(
    stepMs: number,
    grid: Grid,
    roadGraph: RoadGraph,
    pathfinder: Pathfinding,
    residents: number
  ): void {
    if (residents <= 0) return;
    const seconds = stepMs / 1000;
    this.spawnAccumulator += residents * SPAWN_PER_RESIDENT_PER_SEC * seconds;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      if (this.cars.length >= MAX_VEHICLES) {
        // Don't bank credits while at cap — the network is full, and hoarding
        // would cause a thundering-herd respawn the moment cars finish trips.
        this.spawnAccumulator = 0;
        break;
      }
      this.attemptSpawn(grid, roadGraph, pathfinder);
    }
  }

  private attemptSpawn(grid: Grid, roadGraph: RoadGraph, pathfinder: Pathfinding): void {
    // Reservoir-sample a developed Residential tile as origin.
    const origin = pickRandomDevelopedTile(grid, 'residential');
    if (!origin) return;
    // Bus-stop suppression — pulls 70% of car trips off the road if a stop
    // sits in the origin's catchment.
    if (nearBusStop(grid, origin.x, origin.y) && Math.random() < BUS_STOP_SUPPRESSION) return;

    // 50/50 commercial vs industrial — Cities-style "most trips go to jobs".
    const destZone = Math.random() < 0.5 ? 'commercial' : 'industrial';
    const dest = pickRandomDevelopedTile(grid, destZone);
    if (!dest) return;

    const startRoad = nearestRoadTile(grid, origin.x, origin.y);
    if (!startRoad) return;
    const endRoad = nearestRoadTile(grid, dest.x, dest.y);
    if (!endRoad) return;

    const startIdx = startRoad.y * grid.width + startRoad.x;
    const endIdx = endRoad.y * grid.width + endRoad.x;
    if (startIdx === endIdx) return;

    const path = pathfinder.findPath(roadGraph, startIdx, endIdx, grid.width);
    if (!path || path.length < 2) return;

    const color = VEHICLE_PALETTE[Math.floor(Math.random() * VEHICLE_PALETTE.length)] ?? 0xffffff;
    const car: Car = {
      pathTiles: path,
      segmentIdx: 0,
      segmentT: 0,
      speed: BASE_SPEED,
      color,
      loadedTile: path[1]! // count against the tile we're driving toward
    };
    this.cars.push(car);
    this.incrementLoad(grid, car.loadedTile);
  }

  /**
   * Advance every car along its path. Cars that finish their path are spliced
   * out (with their load decremented). Speed is scaled by the load on the
   * tile they're heading toward — high load → noticeable slowdown, propagates
   * upstream.
   */
  update(dt: number, grid: Grid, gridWidth: number): void {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i]!;
      const aIdx = car.pathTiles[car.segmentIdx]!;
      const bIdx = car.pathTiles[car.segmentIdx + 1]!;
      const ax = aIdx % gridWidth;
      const ay = (aIdx - ax) / gridWidth;
      const bx = bIdx % gridWidth;
      const by = (bIdx - bx) / gridWidth;
      const segLen = Math.hypot(bx - ax, by - ay) || 1;

      // Slow-down read from the *next* tile's load — encodes "the road ahead
      // is full" so upstream cars decelerate before reaching the queue.
      const nextLoad = grid.get(bx, by)?.trafficLoad ?? 0;
      const effSpeed = car.speed / (1 + nextLoad * SLOWDOWN_COEF);

      car.segmentT += (effSpeed * dt) / segLen;
      while (car.segmentT >= 1) {
        car.segmentT -= 1;
        car.segmentIdx++;
        if (car.segmentIdx >= car.pathTiles.length - 1) {
          // Arrived at the destination — despawn.
          this.decrementLoad(grid, car.loadedTile);
          this.cars.splice(i, 1);
          car.segmentT = 0;
          break;
        }
        // Migrate the load count to the new "tile we're heading toward".
        const newTarget = car.pathTiles[car.segmentIdx + 1]!;
        this.decrementLoad(grid, car.loadedTile);
        car.loadedTile = newTarget;
        this.incrementLoad(grid, car.loadedTile);
      }
    }
  }

  /**
   * Wipe every car. Resets per-tile `trafficLoad` to zero so a stale spike
   * doesn't outlast the cars that caused it. Used by Game on undo, when the
   * road graph may no longer match cars' baked-in paths.
   */
  clear(grid: Grid, _gridWidth: number): void {
    this.cars.length = 0;
    for (const t of grid.iter()) t.trafficLoad = 0;
  }

  private incrementLoad(grid: Grid, idx: number): void {
    const x = idx % grid.width;
    const y = (idx - x) / grid.width;
    const t = grid.get(x, y);
    if (t) t.trafficLoad++;
  }
  private decrementLoad(grid: Grid, idx: number): void {
    const x = idx % grid.width;
    const y = (idx - x) / grid.width;
    const t = grid.get(x, y);
    if (t && t.trafficLoad > 0) t.trafficLoad--;
  }
}

/**
 * Pick a random developed (density > 0) tile of the given zone using
 * reservoir sampling — single sweep, no allocation, uniform distribution.
 */
function pickRandomDevelopedTile(
  grid: Grid,
  zone: 'residential' | 'commercial' | 'industrial'
): { x: number; y: number } | null {
  let chosen: { x: number; y: number } | null = null;
  let count = 0;
  for (const t of grid.iter()) {
    if (t.zone !== zone || t.density === 0 || t.road) continue;
    count++;
    if (Math.random() * count < 1) chosen = { x: t.x, y: t.y };
  }
  return chosen;
}

/** Closest 4-connected road tile to (x, y), or null if there isn't one. */
function nearestRoadTile(grid: Grid, x: number, y: number): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number }> = [
    { x: x, y: y - 1 },
    { x: x + 1, y: y },
    { x: x, y: y + 1 },
    { x: x - 1, y: y }
  ];
  for (const c of candidates) {
    if (grid.hasRoad(c.x, c.y)) return c;
  }
  return null;
}
