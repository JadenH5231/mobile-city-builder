import type { Grid } from '../world/Grid';
import type { Pathfinding } from './Pathfinding';
import type { RoadGraph } from './RoadGraph';
import {
  COLLISION_RATE_CAP,
  COLLISION_RATE_PER_OTHER,
  MAX_VEHICLES,
  ROAD_TIER,
  STOP_SIGN_PAUSE_SEC,
  VEHICLE_PALETTE,
  type RoadType
} from '../types';
import { nearBusStop } from './Buses';

/**
 * Spawn attempts per resident per real-time second. With 1500 residents that's
 * ~7.5 attempts/sec — enough to saturate the road network and force the
 * player to think about traffic flow. Memory: feedback_traffic_pressure.
 */
const SPAWN_PER_RESIDENT_PER_SEC = 0.005;
/** Probability a candidate spawn near a bus stop is silently dropped. */
const BUS_STOP_SUPPRESSION = 0.7;
/**
 * Path-search congestion coefficient. Each unit of EMA load on a tile
 * inflates the edge cost into that tile by this fraction — drivers
 * spawning during a jam pick around it. Cars in flight don't re-plan.
 */
const CONGESTION_PATH_COEF = 0.6;
/** Minimum gap between same-segment cars (fraction of segment length). */
const MIN_CAR_GAP = 0.18;

export interface Car {
  /** Flat tile indices, length ≥ 2. The path the car follows in order. */
  pathTiles: number[];
  /** Current segment is from pathTiles[segmentIdx] → pathTiles[segmentIdx + 1]. */
  segmentIdx: number;
  /** [0..1] progress along the current segment. */
  segmentT: number;
  /** Per-car speed multiplier on top of the road tier's base speed. */
  speed: number;
  color: number;
  /** The tile we're currently counted against for traffic load. */
  loadedTile: number;
  /** Real-time seconds remaining at a stop sign. > 0 means "frozen this frame". */
  pauseRemaining: number;
  /** Destination zone tile (for crash demand penalty). */
  destX: number;
  destY: number;
}

/**
 * Outcome surfaced by `update` for a single tick — Game uses these to deduct
 * treasury, apply destination demand penalties, and update accident counters.
 */
export interface CrashEvent {
  destX: number;
  destY: number;
  /** Tile where the crash occurred (for visual / log purposes). */
  atIdx: number;
}

/**
 * Cars: spawning at sim rate, smooth motion at render rate.
 *
 * Per-tier speed (post-alpha pass 4): each car's free-flow speed comes from
 * the destination tile's `roadType` lookup in `ROAD_TIER`. So a car heading
 * down a highway segment is fast; the same car merging onto a local street
 * decelerates next segment-cross.
 *
 * Collisions: when a car arrives at a tile with 3+ incident road edges and
 * NO stop sign, we roll a per-other-car collision probability against
 * `trafficLoad`. A hit despawns the car, surfaces a `CrashEvent`, and the
 * caller (Game) deducts treasury + demand from the destination tile.
 *
 * Stop signs: arriving at a stop-sign tile sets `pauseRemaining =
 * STOP_SIGN_PAUSE_SEC`. While paused the car holds its load count on the
 * stop tile (so other cars approaching see the wait realistically). When
 * the timer drains, the load transitions to the next segment's destination
 * and motion resumes.
 */
export class Vehicles {
  readonly cars: Car[] = [];
  /** Spawn credits accumulator, in fractional cars-to-spawn. */
  private spawnAccumulator = 0;
  /** Crash events that fired during the most recent `update` call. Cleared each tick. */
  readonly crashesThisFrame: CrashEvent[] = [];

  /** @param residents Total residents in the city — drives spawn rate. */
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
        this.spawnAccumulator = 0;
        break;
      }
      this.attemptSpawn(grid, roadGraph, pathfinder);
    }
  }

  private attemptSpawn(grid: Grid, roadGraph: RoadGraph, pathfinder: Pathfinding): void {
    const origin = pickRandomDevelopedTile(grid, 'residential');
    if (!origin) return;
    if (nearBusStop(grid, origin.x, origin.y) && Math.random() < BUS_STOP_SUPPRESSION) return;

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

    // Traffic-aware spawn-time pathfinding: each candidate edge's cost is
    // the (already tier-weighted) base inflated by the destination tile's
    // EMA load. Drivers spawning during a jam pick around it.
    const edgeCost = (_from: number, to: number, base: number): number => {
      const tx = to % grid.width;
      const ty = (to - tx) / grid.width;
      const t = grid.get(tx, ty);
      if (!t) return base;
      return base * (1 + t.trafficLoadAvg * CONGESTION_PATH_COEF);
    };
    const path = pathfinder.findPath(roadGraph, startIdx, endIdx, grid.width, edgeCost);
    if (!path || path.length < 2) return;

    const color = VEHICLE_PALETTE[Math.floor(Math.random() * VEHICLE_PALETTE.length)] ?? 0xffffff;
    const car: Car = {
      pathTiles: path,
      segmentIdx: 0,
      segmentT: 0,
      speed: 1.0,
      color,
      loadedTile: path[1]!,
      pauseRemaining: 0,
      destX: dest.x,
      destY: dest.y
    };
    this.cars.push(car);
    this.incrementLoad(grid, car.loadedTile);
  }

  /**
   * Advance every car along its path. See class doc for collision +
   * stop-sign behaviour. After this call, `crashesThisFrame` holds any
   * collisions that fired — Game inspects it per render frame.
   */
  update(dt: number, grid: Grid, gridWidth: number): void {
    this.crashesThisFrame.length = 0;

    // Per-segment leader pre-pass — used to keep cars from visually overlapping.
    const leaderT: number[] = new Array(this.cars.length);
    for (let i = 0; i < this.cars.length; i++) {
      const me = this.cars[i]!;
      const myA = me.pathTiles[me.segmentIdx]!;
      const myB = me.pathTiles[me.segmentIdx + 1]!;
      let best = Infinity;
      for (let j = 0; j < this.cars.length; j++) {
        if (i === j) continue;
        const other = this.cars[j]!;
        if (other.pathTiles[other.segmentIdx] !== myA) continue;
        if (other.pathTiles[other.segmentIdx + 1] !== myB) continue;
        const aheadT =
          other.segmentT > me.segmentT ||
          (other.segmentT === me.segmentT && j < i)
            ? other.segmentT
            : Infinity;
        if (aheadT < best) best = aheadT;
      }
      leaderT[i] = best;
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i]!;

      // Stop-sign pause — count down, hold position. When the timer drains,
      // transition the load count from the stop tile to the next segment.
      if (car.pauseRemaining > 0) {
        car.pauseRemaining = Math.max(0, car.pauseRemaining - dt);
        if (car.pauseRemaining > 0) continue;
        const newTarget = car.pathTiles[car.segmentIdx + 1];
        if (newTarget !== undefined) {
          this.decrementLoad(grid, car.loadedTile);
          car.loadedTile = newTarget;
          this.incrementLoad(grid, car.loadedTile);
        }
        // Fall through to normal advance — pause is over.
      }

      const aIdx = car.pathTiles[car.segmentIdx]!;
      const bIdx = car.pathTiles[car.segmentIdx + 1];
      if (bIdx === undefined) continue; // safety — shouldn't happen for live cars
      const ax = aIdx % gridWidth;
      const ay = (aIdx - ax) / gridWidth;
      const bx = bIdx % gridWidth;
      const by = (bIdx - bx) / gridWidth;
      const segLen = Math.hypot(bx - ax, by - ay) || 1;

      // Per-tier speed: read the destination tile's tier. Highway → fast,
      // local → slow. Then apply load-based slowdown using the tier's
      // capacity coefficient.
      const destTile = grid.get(bx, by);
      const tier: RoadType = destTile?.roadType ?? 'local';
      const tierProps = ROAD_TIER[tier];
      const nextLoad = destTile?.trafficLoad ?? 0;
      const effSpeed = (tierProps.baseSpeed * car.speed) / (1 + nextLoad * tierProps.slowdown);

      let advance = (effSpeed * dt) / segLen;
      const lt = leaderT[i]!;
      if (lt !== Infinity) {
        const targetT = Math.max(0, lt - MIN_CAR_GAP);
        const allowedAdvance = Math.max(0, targetT - car.segmentT);
        advance = Math.min(advance, allowedAdvance);
      }
      car.segmentT += advance;

      let despawned = false;
      while (car.segmentT >= 1) {
        car.segmentT -= 1;
        car.segmentIdx++;

        // End of path — trip completed cleanly.
        if (car.segmentIdx >= car.pathTiles.length - 1) {
          this.decrementLoad(grid, car.loadedTile);
          this.cars.splice(i, 1);
          car.segmentT = 0;
          despawned = true;
          break;
        }

        const arrivedIdx = car.pathTiles[car.segmentIdx]!;
        const arrivedX = arrivedIdx % gridWidth;
        const arrivedY = (arrivedIdx - arrivedX) / gridWidth;
        const arrivedTile = grid.get(arrivedX, arrivedY);
        if (!arrivedTile) {
          this.decrementLoad(grid, car.loadedTile);
          this.cars.splice(i, 1);
          despawned = true;
          break;
        }

        // Intersection check — 3+ incident edges = junction.
        const isIntersection = grid.incidentRoadEdgeCount(arrivedX, arrivedY) >= 3;

        if (isIntersection && arrivedTile.stopSign) {
          // Pause — keep load on the stop-sign tile so others see the wait.
          // loadedTile is currently the arrived tile (it was the previous
          // "to" target), so no transition needed yet.
          car.pauseRemaining = STOP_SIGN_PAUSE_SEC;
          car.segmentT = 0;
          break;
        }

        if (isIntersection && !arrivedTile.stopSign) {
          const others = Math.max(0, arrivedTile.trafficLoad - 1);
          const p = Math.min(COLLISION_RATE_CAP, others * COLLISION_RATE_PER_OTHER);
          if (Math.random() < p) {
            // CRASH. Surface the event for Game to apply penalties.
            this.crashesThisFrame.push({
              destX: car.destX,
              destY: car.destY,
              atIdx: arrivedIdx
            });
            this.decrementLoad(grid, car.loadedTile);
            this.cars.splice(i, 1);
            despawned = true;
            break;
          }
        }

        // Normal load transition: leave the arrived tile, count toward next.
        const newTarget = car.pathTiles[car.segmentIdx + 1];
        if (newTarget !== undefined) {
          this.decrementLoad(grid, car.loadedTile);
          car.loadedTile = newTarget;
          this.incrementLoad(grid, car.loadedTile);
        }
      }
      if (despawned) continue;
    }
  }

  /** Wipe every car. Resets per-tile traffic load. */
  clear(grid: Grid, _gridWidth: number): void {
    this.cars.length = 0;
    this.crashesThisFrame.length = 0;
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
