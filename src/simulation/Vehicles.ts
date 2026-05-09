import type { Grid } from '../world/Grid';
import type { Pathfinding } from './Pathfinding';
import type { RoadGraph } from './RoadGraph';
import type { PathGraph } from './PathGraph';
import type { TrafficLights } from './TrafficLights';
import {
  CAR_VISIT_HIGH_SEC,
  CAR_VISIT_LOW_SEC,
  COLLISION_RATE_CAP,
  COLLISION_RATE_PER_OTHER,
  MAX_VEHICLES,
  PATH_CAR_SUPPRESSION,
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
/**
 * SegmentT at which a car pauses when approaching a stop-sign tile. 0.5 is
 * the visual boundary between the approach tile and the intersection tile —
 * cars stop at the edge of the intersection, not inside it. After the pause
 * we let `advance` push past 0.5 normally and the car crosses into the
 * intersection on the next segment-cross.
 */
const STOP_PRE_T = 0.5;

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
  /** Real-time seconds remaining of the *minimum* stop-sign pause. */
  pauseRemaining: number;
  /**
   * After the minimum pause expires, the car enters yielding mode: it stays
   * parked at STOP_PRE_T until the intersection clears AND no earlier
   * yielder at the same junction is ahead in the FIFO. `yieldSince` is set
   * when yielding begins (used to break ties). Both reset when the car
   * finally advances past the stop.
   */
  yielding: boolean;
  yieldSince: number;
  /** Destination zone tile (for crash demand penalty). */
  destX: number;
  destY: number;
  /** Road tile this trip departed from. Optional — only set on cars that
   *  should queue a return trip when they reach their destination. Return
   *  cars have it undefined so they don't recurse. */
  originRoadIdx?: number;
  /** Origin home (residential cell) — used for the return trip's crash
   *  attribution. Only meaningful when {@link originRoadIdx} is set. */
  originHomeX?: number;
  originHomeY?: number;
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
/**
 * A trip whose outbound leg has finished but whose return leg hasn't fired
 * yet. Stored so {@link Vehicles.scheduleReturnTrips} can spawn a return
 * car after a randomised "visit" delay.
 */
export interface PendingReturn {
  /** performance.now() timestamp at which the return car should spawn. */
  readyAt: number;
  /** Road tile the original outbound trip departed from. */
  originRoadIdx: number;
  /** Road tile the original outbound trip ended at. */
  destRoadIdx: number;
  /** Original residential cell, for crash demand attribution if it crashes. */
  originHomeX: number;
  originHomeY: number;
}

export class Vehicles {
  readonly cars: Car[] = [];
  /** Spawn credits accumulator, in fractional cars-to-spawn. */
  private spawnAccumulator = 0;
  /** Crash events that fired during the most recent `update` call. Cleared each tick. */
  readonly crashesThisFrame: CrashEvent[] = [];
  /** Outbound trips whose driver is "visiting" the destination, waiting to
   *  drive back. Drained by {@link scheduleReturnTrips}. */
  readonly pendingReturns: PendingReturn[] = [];

  /**
   * @param residents Total residents in the city — drives spawn rate.
   * @param pathGraph Optional walkable graph; if both this and `walkPathfinder`
   *   are supplied, spawns where origin AND dest are near a walking path get
   *   probabilistically suppressed (the trip is a "should be walking" — and
   *   the Pedestrians sim spawns its own walker independently).
   */
  spawnTick(
    stepMs: number,
    grid: Grid,
    roadGraph: RoadGraph,
    pathfinder: Pathfinding,
    residents: number,
    pathGraph?: PathGraph,
    _walkPathfinder?: Pathfinding
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
      this.attemptSpawn(grid, roadGraph, pathfinder, pathGraph);
    }
  }

  /**
   * Drain {@link pendingReturns} for any trips whose visit timer has expired,
   * planning a fresh A* path back to the origin and spawning a car for it.
   * If the return path can't be found (road got bulldozed mid-visit, etc.),
   * the entry is dropped silently.
   */
  scheduleReturnTrips(grid: Grid, roadGraph: RoadGraph, pathfinder: Pathfinding): void {
    if (this.pendingReturns.length === 0) return;
    const now = performance.now();
    for (let i = this.pendingReturns.length - 1; i >= 0; i--) {
      const r = this.pendingReturns[i]!;
      if (r.readyAt > now) continue;
      this.pendingReturns.splice(i, 1);
      if (this.cars.length >= MAX_VEHICLES) continue;
      // Plan the reverse leg using the same congestion-aware cost the
      // outbound spawn used. This is the "rush hour back home" car.
      const edgeCost = (_from: number, to: number, base: number): number => {
        const tx = to % grid.width;
        const ty = (to - tx) / grid.width;
        const t = grid.get(tx, ty);
        if (!t) return base;
        return base * (1 + t.trafficLoadAvg * CONGESTION_PATH_COEF);
      };
      const path = pathfinder.findPath(roadGraph, r.destRoadIdx, r.originRoadIdx, grid.width, edgeCost);
      if (!path || path.length < 2) continue;
      const color = VEHICLE_PALETTE[Math.floor(Math.random() * VEHICLE_PALETTE.length)] ?? 0xffffff;
      const car: Car = {
        pathTiles: path,
        segmentIdx: 0,
        segmentT: 0,
        speed: 1.0,
        color,
        loadedTile: path[1]!,
        pauseRemaining: 0,
        yielding: false,
        yieldSince: 0,
        destX: r.originHomeX,
        destY: r.originHomeY
      };
      this.cars.push(car);
      this.incrementLoad(grid, car.loadedTile);
    }
  }

  private attemptSpawn(
    grid: Grid,
    roadGraph: RoadGraph,
    pathfinder: Pathfinding,
    pathGraph?: PathGraph
  ): void {
    const origin = pickRandomDevelopedTile(grid, 'residential');
    if (!origin) return;
    if (nearBusStop(grid, origin.x, origin.y) && Math.random() < BUS_STOP_SUPPRESSION) return;

    const destZone = Math.random() < 0.5 ? 'commercial' : 'industrial';
    const dest = pickRandomDevelopedTile(grid, destZone);
    if (!dest) return;

    // Walking-path suppression. If both origin and destination tiles are
    // adjacent to a walking path, the Pedestrians sim is already covering
    // these trips — drop the car spawn with probability PATH_CAR_SUPPRESSION
    // so traffic doesn't double-count walkable routes.
    if (pathGraph && nearPath(grid, origin.x, origin.y) && nearPath(grid, dest.x, dest.y)) {
      if (Math.random() < PATH_CAR_SUPPRESSION) return;
    }

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
      yielding: false,
      yieldSince: 0,
      destX: dest.x,
      destY: dest.y,
      originRoadIdx: startIdx,
      originHomeX: origin.x,
      originHomeY: origin.y
    };
    this.cars.push(car);
    this.incrementLoad(grid, car.loadedTile);
  }

  /**
   * Advance every car along its path. See class doc for collision +
   * stop-sign behaviour. After this call, `crashesThisFrame` holds any
   * collisions that fired — Game inspects it per render frame.
   */
  update(dt: number, grid: Grid, gridWidth: number, trafficLights?: TrafficLights): void {
    this.crashesThisFrame.length = 0;
    const now = performance.now();

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

    // Occupancy pre-pass — which tiles currently have a car *inside* them
    // (visually past the boundary, not parked at a stop). Used by the
    // yielding check below so a stopped car waits for cross-traffic. Cars
    // that are paused or yielding at a stop sign are excluded — they're
    // at the boundary, not in the intersection.
    const occupied = new Set<number>();
    for (const c of this.cars) {
      if (c.pauseRemaining > 0 || c.yielding) continue;
      const fromIdx = c.pathTiles[c.segmentIdx];
      const toIdx = c.pathTiles[c.segmentIdx + 1];
      if (fromIdx !== undefined && c.segmentT < STOP_PRE_T) occupied.add(fromIdx);
      if (toIdx !== undefined && c.segmentT > STOP_PRE_T) occupied.add(toIdx);
    }

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i]!;

      // Stage 1: minimum stop-sign pause. Counts down from
      // STOP_SIGN_PAUSE_SEC. When it expires, the car switches to
      // yielding mode (stage 2) — still parked, but now waiting for the
      // intersection to clear instead of just waiting on the timer.
      if (car.pauseRemaining > 0) {
        car.pauseRemaining = Math.max(0, car.pauseRemaining - dt);
        if (car.pauseRemaining > 0) continue;
        car.yielding = true;
        car.yieldSince = now;
      }

      // Stage 2: yielding. Block until the intersection ahead is empty AND
      // no car at any approach to the same intersection has been yielding
      // longer (FIFO). Without the FIFO check, multiple cars all releasing
      // at the same frame would crash into each other.
      if (car.yielding) {
        const targetIdx = car.pathTiles[car.segmentIdx + 1];
        if (targetIdx !== undefined) {
          if (occupied.has(targetIdx)) continue;
          let aheadInQueue = false;
          for (let j = 0; j < this.cars.length; j++) {
            if (j === i) continue;
            const c = this.cars[j]!;
            if (!c.yielding) continue;
            if (c.pathTiles[c.segmentIdx + 1] !== targetIdx) continue;
            // Earlier yieldSince wins. Tie-break on car-array index so we
            // never deadlock on equal timestamps.
            if (c.yieldSince < car.yieldSince || (c.yieldSince === car.yieldSince && j < i)) {
              aheadInQueue = true;
              break;
            }
          }
          if (aheadInQueue) continue;
        }
        // Released — clear yielding flag and fall through to advance.
        car.yielding = false;
        car.yieldSince = 0;
      }

      const aIdx = car.pathTiles[car.segmentIdx]!;
      const bIdx = car.pathTiles[car.segmentIdx + 1];
      if (bIdx === undefined) continue; // safety
      const ax = aIdx % gridWidth;
      const ay = (aIdx - ax) / gridWidth;
      const bx = bIdx % gridWidth;
      const by = (bIdx - bx) / gridWidth;
      const segLen = Math.hypot(bx - ax, by - ay) || 1;

      // Per-tier speed: read the destination tile's tier. Highway → fast,
      // local → slow. Then apply load-based slowdown.
      const destTile = grid.get(bx, by);
      const tier: RoadType = destTile?.roadType ?? 'local';
      const tierProps = ROAD_TIER[tier];
      const nextLoad = destTile?.trafficLoad ?? 0;
      const effSpeed = (tierProps.baseSpeed * car.speed) / (1 + nextLoad * tierProps.slowdown);

      let advance = (effSpeed * dt) / segLen;

      // Same-segment leader gap — keep cars from visually overlapping.
      const lt = leaderT[i]!;
      if (lt !== Infinity) {
        const targetT = Math.max(0, lt - MIN_CAR_GAP);
        const allowedAdvance = Math.max(0, targetT - car.segmentT);
        advance = Math.min(advance, allowedAdvance);
      }

      // Stop-sign approach: if the next tile is a stop-sign intersection
      // and we haven't reached STOP_PRE_T yet, cap advance so we park at
      // the boundary instead of barreling into the centre.
      const nextIsStop =
        destTile?.stopSign === true &&
        grid.incidentRoadEdgeCount(bx, by) >= 3 &&
        car.segmentT < STOP_PRE_T;
      if (nextIsStop) {
        const allowedAdvance = Math.max(0, STOP_PRE_T - car.segmentT);
        advance = Math.min(advance, allowedAdvance);
        car.segmentT += advance;
        // If we touched STOP_PRE_T (within numerical slop), begin the pause.
        if (car.segmentT >= STOP_PRE_T - 1e-6) {
          car.segmentT = STOP_PRE_T;
          car.pauseRemaining = STOP_SIGN_PAUSE_SEC;
        }
        continue;
      }

      // Traffic-light approach: same boundary-park behaviour as a stop sign,
      // but no min-pause — once the light turns green for our approach we
      // can roll on the next frame. That's what makes lights outperform
      // stops at busy junctions: green-direction cars never sit still.
      if (
        trafficLights &&
        destTile?.trafficLight === true &&
        car.segmentT < STOP_PRE_T &&
        !trafficLights.isGreen(grid, ax, ay, bx, by)
      ) {
        const allowedAdvance = Math.max(0, STOP_PRE_T - car.segmentT);
        advance = Math.min(advance, allowedAdvance);
        car.segmentT += advance;
        if (car.segmentT >= STOP_PRE_T - 1e-6) car.segmentT = STOP_PRE_T;
        continue;
      }

      car.segmentT += advance;

      let despawned = false;
      while (car.segmentT >= 1) {
        // Spillback: don't cross into the next segment if it's full. A
        // segment is "full" if any car on it sits within MIN_CAR_GAP of
        // segmentT = 0 (the entry). Without this, a queue at a stop sign
        // overflows onto the start of the approach segment and stacks at
        // segmentT = 0 (the leader-gap clamp won't push cars below zero,
        // so they all pile up at the same world position).
        //
        // When the next segment is full we hold near segmentT = 1 of the
        // CURRENT segment; the queue extends one segment back. Recursively
        // this propagates spillback across the whole upstream chain.
        const newFromIdx = car.pathTiles[car.segmentIdx + 1];
        const newToIdx = car.pathTiles[car.segmentIdx + 2];
        if (newFromIdx !== undefined && newToIdx !== undefined) {
          let minNextT = Infinity;
          for (let j = 0; j < this.cars.length; j++) {
            if (j === i) continue;
            const other = this.cars[j]!;
            if (other.pathTiles[other.segmentIdx] !== newFromIdx) continue;
            if (other.pathTiles[other.segmentIdx + 1] !== newToIdx) continue;
            if (other.segmentT < minNextT) minNextT = other.segmentT;
          }
          if (minNextT < MIN_CAR_GAP) {
            car.segmentT = 1 - 1e-6;
            break; // out of while
          }
        }

        car.segmentT -= 1;
        car.segmentIdx++;

        // End of path — trip completed cleanly.
        if (car.segmentIdx >= car.pathTiles.length - 1) {
          this.decrementLoad(grid, car.loadedTile);
          // Outbound trip: queue a return car after a randomised visit
          // interval so traffic feels two-way. Cars without originRoadIdx
          // (i.e. return cars themselves) don't recurse — they just despawn.
          if (
            car.originRoadIdx !== undefined &&
            car.originHomeX !== undefined &&
            car.originHomeY !== undefined
          ) {
            const arrivedIdx = car.pathTiles[car.segmentIdx]!;
            const visitMs =
              (CAR_VISIT_LOW_SEC + Math.random() * (CAR_VISIT_HIGH_SEC - CAR_VISIT_LOW_SEC)) * 1000;
            this.pendingReturns.push({
              readyAt: now + visitMs,
              originRoadIdx: car.originRoadIdx,
              destRoadIdx: arrivedIdx,
              originHomeX: car.originHomeX,
              originHomeY: car.originHomeY
            });
          }
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

        // Intersection collision check. Stop signs and traffic lights both
        // suppress the roll: a stop sign forces a yielding handshake on the
        // previous segment, a traffic light controls the conflict via phase.
        const isIntersection = grid.incidentRoadEdgeCount(arrivedX, arrivedY) >= 3;
        if (isIntersection && !arrivedTile.stopSign && !arrivedTile.trafficLight) {
          const others = Math.max(0, arrivedTile.trafficLoad - 1);
          const p = Math.min(COLLISION_RATE_CAP, others * COLLISION_RATE_PER_OTHER);
          if (Math.random() < p) {
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

  /** Wipe every car (and any queued return trips). Resets per-tile traffic load. */
  clear(grid: Grid, _gridWidth: number): void {
    this.cars.length = 0;
    this.crashesThisFrame.length = 0;
    this.pendingReturns.length = 0;
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
    if (t.density === 0 || t.road) continue;
    if (!tileMatchesRole(t.zone, zone)) continue;
    count++;
    if (Math.random() * count < 1) chosen = { x: t.x, y: t.y };
  }
  return chosen;
}

/**
 * Mixed-use (Alpha 2.0) — a mu tile holds residents AND commercial jobs,
 * so it counts as both R origin and C destination. Industrial stays single-
 * purpose.
 */
function tileMatchesRole(
  tileZone: 'none' | 'residential' | 'commercial' | 'industrial' | 'mixed',
  role: 'residential' | 'commercial' | 'industrial'
): boolean {
  if (tileZone === role) return true;
  if (tileZone === 'mixed' && (role === 'residential' || role === 'commercial')) return true;
  return false;
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

/** True if any 8-connected neighbour of (x, y) is a walking-path tile. */
function nearPath(grid: Grid, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (grid.hasPath(x + dx, y + dy)) return true;
    }
  }
  return false;
}
