import type { Grid } from '../world/Grid';
import type { Pathfinding } from './Pathfinding';
import type { RoadGraph } from './RoadGraph';
import type { PathGraph } from './PathGraph';
import type { TrafficLights } from './TrafficLights';
import type { Tile } from '../world/Tile';
import {
  CAR_VISIT_HIGH_SEC,
  CAR_VISIT_LOW_SEC,
  COLLISION_RATE_CAP,
  COLLISION_RATE_PER_OTHER,
  MAX_VEHICLES,
  MAX_TRUCKS,
  MAX_TOURIST_VEHICLES,
  MAX_SERVICE_VEHICLES,
  PATH_CAR_SUPPRESSION,
  SUBWAY_SUPPRESSION_RADIUS,
  ROAD_TIER,
  STOP_SIGN_PAUSE_SEC,
  type Building,
  type RoadType
} from '../types';
import { nearBusStop } from './Buses';
import { getActiveTheme } from '../themes/registry';
/** Theme-driven civilian car palette accessor (Beta 1.2). Wrapped in
 *  a function because the active theme can change at runtime; any
 *  cached const at import time would freeze the original palette. */
function vehiclePalette(): readonly number[] { return getActiveTheme().vehicles.cars; }

/**
 * Car kind (Alpha 4.14). The simulation gates spawn caps and visual
 * appearance off this. Ordering matters slightly — `'resident'` is the
 * default historical value and is what every legacy spawn path emits.
 *
 * - `resident`: classic R→C/I/MU commute. Counts against MAX_VEHICLES.
 *   Subject to all stop signs / traffic lights / collisions.
 * - `tourist`: arrives from the city's outside-edge road and visits a
 *   landmark / park / civic monument. Counts against MAX_TOURIST_VEHICLES,
 *   ABOVE MAX_VEHICLES so traffic visibly grows when tourists arrive.
 *   Subject to normal traffic rules.
 * - `patrol` / `fire_response`: emergency cars dispatched from a police
 *   or fire station. Skip stop signs + traffic lights (running lights),
 *   no collision rolls. Cap MAX_SERVICE_VEHICLES.
 * - `motorcade_lead` / `motorcade_limo` / `motorcade_tail`: the three
 *   members of a motorcade convoy spawned by `Motorcade.ts`. Skip stops
 *   + lights, no collision rolls. Trigger `nearbyMotorcadePullover` —
 *   any non-motorcade car within MOTORCADE_PULLOVER_RADIUS gets its
 *   pauseRemaining bumped each tick (frozen on the shoulder until the
 *   convoy passes).
 * - `truck` (Beta 1.5): freight transport that spawns from a developed
 *   industrial tile, drives to a developed commercial tile, dwells
 *   briefly (delivery), then queues a return trip to the industrial
 *   origin. Slower than cars (0.85× speed) and contributes 2× to per-
 *   tile trafficLoad — they take up MORE space on the road so a fleet
 *   of trucks measurably slows nearby cars. Subject to stop signs /
 *   lights / collisions like normal cars. Counts against its own cap
 *   `MAX_TRUCKS`, separate from MAX_VEHICLES.
 */
export type CarKind =
  | 'resident'
  | 'tourist'
  | 'patrol'
  | 'fire_response'
  | 'motorcade_lead'
  | 'motorcade_limo'
  | 'motorcade_tail'
  | 'truck';

/** Tile-radius around a motorcade vehicle inside which other cars freeze
 *  on the shoulder (Alpha 4.14). Manhattan distance — cheap. */
const MOTORCADE_PULLOVER_RADIUS = 4;
/** Pullover pause refreshed each tick a car is within range of a
 *  motorcade vehicle. Just long enough that the cars stay parked while
 *  the convoy passes; drains naturally once the motorcade moves on. */
const MOTORCADE_PULLOVER_PAUSE_SEC = 0.7;

/**
 * Spawn attempts per resident per real-time second. With 1500 residents that's
 * ~7.5 attempts/sec — enough to saturate the road network and force the
 * player to think about traffic flow. Memory: feedback_traffic_pressure.
 */
const SPAWN_PER_RESIDENT_PER_SEC = 0.005;
/**
 * Truck spawn rate per developed industrial tile per real-time second
 * (Beta 1.5). With ~40 industrial tiles that's ~0.4 trucks/sec attempted,
 * naturally throttled by the MAX_TRUCKS = 30 cap. Tuned low so trucks
 * read as occasional freight, not constant convoys.
 */
const TRUCK_SPAWN_PER_INDUSTRY_PER_SEC = 0.010;
/** Truck speed multiplier vs cars (Beta 1.5). Trucks are heavier and
 *  accelerate / cruise slower than cars on the same road tier. */
const TRUCK_SPEED_MULT = 0.85;
/** Per-tile trafficLoad weight for trucks (Beta 1.5). Cars contribute 1;
 *  trucks contribute 2 because they take more physical road space. The
 *  per-tile load drives EMA + congestion-aware A* edge cost + cap on
 *  free-flow speed, so a corridor of trucks visibly slows other traffic
 *  passing through. */
const TRUCK_LOAD_WEIGHT = 2;
/** Truck delivery dwell time at commercial destination (Beta 1.5).
 *  Slightly shorter than a resident's visit because trucks are dropping
 *  cargo, not running errands. */
const TRUCK_VISIT_LOW_SEC = 4;
const TRUCK_VISIT_HIGH_SEC = 10;
/** Truck colour palette (Beta 1.5). Utilitarian / delivery-fleet colours
 *  — picked at spawn so a city's truck fleet reads as a mixed bag of
 *  carriers. The chassis stays dark grey regardless (baked into the
 *  vertex colors of the body geometry); per-instance colour tints only
 *  the cab + cargo box. */
const TRUCK_PALETTE: ReadonlyArray<number> = [
  0xe8e6dc,  // white delivery
  0xc0c8d4,  // silver fleet
  0x6090b0,  // light blue carrier
  0xa05030,  // brown courier
  0x4a6a3a,  // dark green hauler
  0xb05050,  // red logistics
  0x3a4a60   // dark blue freight
];

/** Per-vehicle trafficLoad weight (Beta 1.5). Trucks count double. */
function carLoadWeight(car: Car): number {
  return (car.kind === 'truck') ? TRUCK_LOAD_WEIGHT : 1;
}
/** Probability a candidate spawn near a bus stop is silently dropped. */
const BUS_STOP_SUPPRESSION = 0.7;
/** Probability that a candidate spawn near a subway entrance is suppressed
 *  (Alpha 2.19). Stronger than bus-stop because subways move much more.
 *  Read together with SUBWAY_SUPPRESSION_RADIUS in types.ts. */
const SUBWAY_SUPPRESSION = 0.85;
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
  /** Car kind (Alpha 4.14). Defaults to 'resident' if undefined to keep
   *  every existing code path working without an explicit set. Drives:
   *  - cap counting (only 'resident' counts against MAX_VEHICLES)
   *  - traffic-rule exemptions (emergency + motorcade skip stops/lights)
   *  - render appearance (different colour / scale per kind)
   *  - pullover behaviour (motorcade kinds force others off the road) */
  kind?: CarKind;
  /** Parking reservation (Beta 1.3 Phase 2). Set at spawn time if the
   *  destination has a free stall on an adjacent `parking_lot` tile. On
   *  arrival the car transitions into the visible parked-state instead
   *  of an immediate despawn-and-queue-return. */
  parking?: import('./Parking').ParkingStall;
  /** True once the car has reached its destination and is sitting
   *  in its stall (Phase 2). Skips movement physics + collisions; the
   *  Renderer reads `car.parking` for its world position instead of
   *  interpolating along the path. */
  isParked?: boolean;
  /** performance.now() timestamp when the car should unpark. Set when
   *  the car enters the parked phase; on expiry the stall is released,
   *  the car despawns, and a `PendingReturn` fires (the visit interval
   *  has been spent visibly at the stall rather than invisibly queued). */
  parkedUntil?: number;
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
  /** Car kind to apply to the return car (Alpha 4.14). Tourists return as
   *  tourists, patrols as patrols, etc. — keeps cap-counting + colour
   *  consistent across the round trip. Defaults to 'resident'. */
  kind?: CarKind;
  /** Original colour, so the return car visually matches the outbound. */
  color?: number;
}

export class Vehicles {
  readonly cars: Car[] = [];
  /** Spawn credits accumulator, in fractional cars-to-spawn. */
  private spawnAccumulator = 0;
  /** Spawn credits accumulator for trucks (Beta 1.5). Drives the
   *  industrial-tile-count × TRUCK_SPAWN_PER_INDUSTRY_PER_SEC rate. */
  private truckSpawnAccumulator = 0;
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
    _walkPathfinder?: Pathfinding,
    parking?: import('./Parking').Parking
  ): void {
    if (residents <= 0) return;
    const seconds = stepMs / 1000;
    this.spawnAccumulator += residents * SPAWN_PER_RESIDENT_PER_SEC * seconds;
    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      // Only resident cars count against MAX_VEHICLES (Alpha 4.14).
      // Tourists / patrols / motorcade live in their own caps so total
      // visible traffic can exceed MAX when those events fire.
      if (this.countByKind('resident') >= MAX_VEHICLES) {
        this.spawnAccumulator = 0;
        break;
      }
      this.attemptSpawn(grid, roadGraph, pathfinder, pathGraph, parking);
    }
  }

  /**
   * Truck spawn tick (Beta 1.5). Called each sim step from Game.ts.
   * Trucks spawn at a rate proportional to developed industrial tile
   * count (industry generates freight). Each spawn picks a random
   * developed industrial tile as origin and a random developed
   * commercial tile as destination. Trucks do NOT use parking lots
   * (semi-trucks deliver curbside, not in stalls).
   */
  spawnTruckTick(
    stepMs: number,
    grid: Grid,
    roadGraph: RoadGraph,
    pathfinder: Pathfinding
  ): void {
    // Count developed industrial tiles cheaply — gates the spawn rate
    // to "how much industry exists" without per-frame iteration when
    // industry is tiny / absent.
    let industryCount = 0;
    for (const t of grid.iter()) {
      if (t.density > 0 && tileMatchesRole(t.zone, 'industrial')) industryCount++;
    }
    if (industryCount === 0) return;
    const seconds = stepMs / 1000;
    this.truckSpawnAccumulator += industryCount * TRUCK_SPAWN_PER_INDUSTRY_PER_SEC * seconds;
    while (this.truckSpawnAccumulator >= 1) {
      this.truckSpawnAccumulator -= 1;
      if (this.countByKind('truck') >= MAX_TRUCKS) {
        this.truckSpawnAccumulator = 0;
        break;
      }
      this.attemptTruckSpawn(grid, roadGraph, pathfinder);
    }
  }

  private attemptTruckSpawn(
    grid: Grid,
    roadGraph: RoadGraph,
    pathfinder: Pathfinding
  ): void {
    const origin = pickRandomDevelopedTile(grid, 'industrial');
    if (!origin) return;
    // Bias destination toward big_box (matches the resident-car bias
    // from 1.4.2). Big_box stores receive disproportionately more
    // freight than regular commercial in real life.
    const dest = pickRandomDevelopedTile(grid, 'commercial', 2);
    if (!dest) return;

    const startRoad = nearestRoadTile(grid, origin.x, origin.y);
    if (!startRoad) return;
    const endRoad = nearestRoadTile(grid, dest.x, dest.y);
    if (!endRoad) return;

    const startIdx = startRoad.y * grid.width + startRoad.x;
    const endIdx = endRoad.y * grid.width + endRoad.x;
    if (startIdx === endIdx) return;

    const edgeCost = (_from: number, to: number, base: number): number => {
      const tx = to % grid.width;
      const ty = (to - tx) / grid.width;
      const t = grid.get(tx, ty);
      if (!t) return base;
      return base * (1 + t.trafficLoadAvg * CONGESTION_PATH_COEF);
    };
    const path = pathfinder.findPath(roadGraph, startIdx, endIdx, grid.width, edgeCost);
    if (!path || path.length < 2) return;

    const color = TRUCK_PALETTE[Math.floor(Math.random() * TRUCK_PALETTE.length)] ?? 0xe8e6dc;
    const car: Car = {
      pathTiles: path,
      segmentIdx: 0,
      segmentT: 0,
      speed: TRUCK_SPEED_MULT,
      color,
      loadedTile: path[1]!,
      pauseRemaining: 0,
      yielding: false,
      yieldSince: 0,
      destX: dest.x,
      destY: dest.y,
      originRoadIdx: startIdx,
      originHomeX: origin.x,
      originHomeY: origin.y,
      kind: 'truck'
    };
    this.cars.push(car);
    this.incrementLoad(grid, car.loadedTile, TRUCK_LOAD_WEIGHT);
  }

  /** Count active cars matching `kind` (or 'resident' if `kind` undefined,
   *  which catches legacy spawns that didn't set the field). Cheap O(N)
   *  pass — N is bounded by MAX_VEHICLES + MAX_TOURIST + MAX_SERVICE. */
  countByKind(kind: CarKind): number {
    let n = 0;
    for (const c of this.cars) {
      if ((c.kind ?? 'resident') === kind) n++;
    }
    return n;
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
      // Cap check is per-kind so tourist returns don't get squeezed by
      // the resident cap, and vice versa.
      const kind = r.kind ?? 'resident';
      if (kind === 'resident' && this.countByKind('resident') >= MAX_VEHICLES) continue;
      if (kind === 'tourist'  && this.countByKind('tourist')  >= MAX_TOURIST_VEHICLES) continue;
      if ((kind === 'patrol' || kind === 'fire_response')
          && this.countByKind('patrol') + this.countByKind('fire_response') >= MAX_SERVICE_VEHICLES) continue;
      if (kind === 'truck' && this.countByKind('truck') >= MAX_TRUCKS) continue;
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
      const _pal = vehiclePalette();
      const color = r.color ?? _pal[Math.floor(Math.random() * _pal.length)] ?? 0xffffff;
      const car: Car = {
        pathTiles: path,
        segmentIdx: 0,
        segmentT: 0,
        // Trucks preserve their slower speed on return. Emergency-vehicle
        // slight boost preserved on return. Everyone else cruises at 1.0.
        speed: kind === 'truck' ? TRUCK_SPEED_MULT
             : (kind === 'patrol' || kind === 'fire_response') ? 1.15
             : 1.0,
        color,
        loadedTile: path[1]!,
        pauseRemaining: 0,
        yielding: false,
        yieldSince: 0,
        destX: r.originHomeX,
        destY: r.originHomeY,
        kind
      };
      this.cars.push(car);
      this.incrementLoad(grid, car.loadedTile, carLoadWeight(car));
    }
  }

  private attemptSpawn(
    grid: Grid,
    roadGraph: RoadGraph,
    pathfinder: Pathfinding,
    pathGraph?: PathGraph,
    parking?: import('./Parking').Parking
  ): void {
    const origin = pickRandomDevelopedTile(grid, 'residential');
    if (!origin) return;
    if (nearBusStop(grid, origin.x, origin.y) && Math.random() < BUS_STOP_SUPPRESSION) return;
    // Subway entrance suppression (Alpha 2.19): a strong probability that
    // a trip from a tile near a subway entrance gets converted away from
    // a car. Models the abstraction of underground rail without a separate
    // graph. Stronger than bus-stop suppression because subways move
    // many more people per stop in real cities.
    if (nearSubwayEntrance(grid, origin.x, origin.y) && Math.random() < SUBWAY_SUPPRESSION) return;

    // Destination roll (Alpha 4.14): commercial / industrial commute as
    // before, plus forestry + farm as employment destinations. Logging
    // operations (forestry) draw more workers than farms — both spec'd
    // by user playtest feedback. Roll: 45% C, 30% I, 17% forestry,
    // 8% farm. The forestry / farm picks fall through to commercial
    // when the map has no such buildings (small early cities).
    //
    // Beta 1.4.2 — `big_box` commercial tiles get a 2× weight in the
    // commercial pick. Big-box stores are high-traffic shopping
    // destinations in real life; the bump makes their parking lots
    // feel like the bustling retail centres they're modelled on
    // instead of mostly empty asphalt with one car parked.
    const roll = Math.random();
    let dest: { x: number; y: number } | null = null;
    if (roll < 0.45) {
      dest = pickRandomDevelopedTile(grid, 'commercial', 2);
    } else if (roll < 0.75) {
      dest = pickRandomDevelopedTile(grid, 'industrial');
    } else if (roll < 0.92) {
      dest = pickRandomBuildingTile(grid, 'forestry');
      if (!dest) dest = pickRandomDevelopedTile(grid, 'commercial', 2);
    } else {
      dest = pickRandomBuildingTile(grid, 'farm');
      if (!dest) dest = pickRandomDevelopedTile(grid, 'commercial', 2);
    }
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

    // Beta 1.4.2 — parking-aware routing. Try to reserve a stall on a
    // parking_lot near the destination (within 3 tiles Chebyshev).
    // If a stall is reserved, route the car to the PARKING LOT's
    // nearest road, not the destination's. This way:
    //   - The car physically drives to the parking lot
    //   - The Shopper walks from the stall to the destination (any
    //     distance — Shoppers.spawnForParkedCar handles arbitrary leg
    //     lengths)
    //   - Parking lots become real transit hubs: a single lot can
    //     serve big_box, regular C, MU, and even nearby I tiles
    //
    // Reservation BEFORE pathfind so the path goes to the right place;
    // we release the reservation on any subsequent failure path so a
    // no-route trip doesn't leak a stall.
    const parkingReservation = parking
      ? parking.findStallNearDest(dest.x, dest.y, 3)
      : null;

    // Routing end-point depends on whether parking is used: drive to
    // the parking lot's nearest road (Beta 1.4.2 transit-hub model) or
    // to the destination's nearest road (vanilla).
    let endRoad = parkingReservation
      ? nearestRoadTile(grid, parkingReservation.tileX, parkingReservation.tileY)
      : null;
    if (!endRoad) {
      endRoad = nearestRoadTile(grid, dest.x, dest.y);
    }
    if (!endRoad) {
      if (parkingReservation) parking?.release(parkingReservation);
      return;
    }

    const startIdx = startRoad.y * grid.width + startRoad.x;
    const endIdx = endRoad.y * grid.width + endRoad.x;
    if (startIdx === endIdx) {
      if (parkingReservation) parking?.release(parkingReservation);
      return;
    }

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
    if (!path || path.length < 2) {
      if (parkingReservation) parking?.release(parkingReservation);
      return;
    }

    const _pal2 = vehiclePalette();
    const color = _pal2[Math.floor(Math.random() * _pal2.length)] ?? 0xffffff;
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
      originHomeY: origin.y,
      kind: 'resident',
      parking: parkingReservation ?? undefined
    };
    this.cars.push(car);
    this.incrementLoad(grid, car.loadedTile);
  }

  /**
   * Tourist spawn (Alpha 4.14). Periodic — the caller (Game) calls this
   * each sim tick passing `connected`. When the city has an outside-edge
   * road AND there's at least one tourist destination, a small fraction
   * of ticks spawn a tourist car driving from a random edge road tile to
   * a random tourist building (park / landmark / civic monument).
   * Tourists count against MAX_TOURIST_VEHICLES, ABOVE the resident cap.
   */
  private touristSpawnAccumulator = 0;
  /** Spawn attempts per real-time second when the city is connected.
   *  ~0.6 / sec means roughly 1 tourist every ~1.7 seconds tries to
   *  spawn — actual rate is gated by destination availability + cap. */
  private static readonly TOURIST_SPAWN_PER_SEC = 0.6;
  spawnTouristTick(
    stepMs: number,
    grid: Grid,
    roadGraph: RoadGraph,
    pathfinder: Pathfinding,
    connected: boolean
  ): void {
    if (!connected) return;
    const seconds = stepMs / 1000;
    this.touristSpawnAccumulator += Vehicles.TOURIST_SPAWN_PER_SEC * seconds;
    while (this.touristSpawnAccumulator >= 1) {
      this.touristSpawnAccumulator -= 1;
      if (this.countByKind('tourist') >= MAX_TOURIST_VEHICLES) {
        this.touristSpawnAccumulator = 0;
        break;
      }
      this.attemptTouristSpawn(grid, roadGraph, pathfinder);
    }
  }
  private attemptTouristSpawn(grid: Grid, roadGraph: RoadGraph, pathfinder: Pathfinding): void {
    const edge = pickEdgeRoadTile(grid);
    if (!edge) return;
    const dest = pickTouristDestination(grid);
    if (!dest) return;
    const endRoad = nearestRoadTile(grid, dest.x, dest.y);
    if (!endRoad) return;
    const startIdx = edge.y * grid.width + edge.x;
    const endIdx = endRoad.y * grid.width + endRoad.x;
    if (startIdx === endIdx) return;
    const path = pathfinder.findPath(roadGraph, startIdx, endIdx, grid.width);
    if (!path || path.length < 2) return;
    // Tourists use a brighter palette so they're visually distinct (golds
    // and pastels) and stand out against the muted resident palette.
    const TOURIST_PALETTE = getActiveTheme().vehicles.tourist;
    const color = TOURIST_PALETTE[Math.floor(Math.random() * TOURIST_PALETTE.length)] ?? 0xffffff;
    const car: Car = {
      pathTiles: path, segmentIdx: 0, segmentT: 0, speed: 1.0,
      color, loadedTile: path[1]!, pauseRemaining: 0,
      yielding: false, yieldSince: 0,
      destX: dest.x, destY: dest.y,
      originRoadIdx: startIdx,
      originHomeX: edge.x, originHomeY: edge.y,
      kind: 'tourist'
    };
    this.cars.push(car);
    this.incrementLoad(grid, car.loadedTile);
  }

  /**
   * Emergency vehicle spawn (Alpha 4.14). Each police station / fire
   * station can have at most one of its kind out at a time. We sweep
   * the grid for stations once per call (cheap — at most a few dozen),
   * find the ones currently without an active patrol/response car, and
   * dispatch one to a random destination tile in the city. The car
   * returns home when its trip ends (handled by the existing return-
   * trip pipeline since `originRoadIdx` is set).
   *
   * The caller (Game) calls this on a slow cadence — every few seconds
   * is plenty since each station only needs one car at a time.
   */
  private serviceSpawnAccumulator = 0;
  /** Spawn-check cadence: ~0.4 / sec means we re-check every ~2.5s on
   *  average. Cap the total at MAX_SERVICE_VEHICLES so a city with
   *  dozens of stations doesn't drown the road network. */
  private static readonly SERVICE_SPAWN_PER_SEC = 0.4;
  spawnServiceTick(
    stepMs: number,
    grid: Grid,
    roadGraph: RoadGraph,
    pathfinder: Pathfinding
  ): void {
    const seconds = stepMs / 1000;
    this.serviceSpawnAccumulator += Vehicles.SERVICE_SPAWN_PER_SEC * seconds;
    while (this.serviceSpawnAccumulator >= 1) {
      this.serviceSpawnAccumulator -= 1;
      if (this.countByKind('patrol') + this.countByKind('fire_response') >= MAX_SERVICE_VEHICLES) {
        this.serviceSpawnAccumulator = 0;
        break;
      }
      this.attemptServiceSpawn(grid, roadGraph, pathfinder);
    }
  }
  private attemptServiceSpawn(grid: Grid, roadGraph: RoadGraph, pathfinder: Pathfinding): void {
    // Pick a random station to dispatch from. 60/40 police vs fire so
    // patrols are slightly more frequent than fire responses (real-life
    // ratio — fires are rare, patrols routine).
    const useFire = Math.random() < 0.40;
    const stationKind: Building = useFire ? 'fire_station' : 'police_station';
    const station = pickRandomBuildingTile(grid, stationKind);
    if (!station) return;
    // Pick a random road tile in the city as the destination — patrol
    // route is "tour the streets and come back".
    const destRoad = pickRandomRoadTile(grid);
    if (!destRoad) return;
    const startRoad = nearestRoadTile(grid, station.x, station.y);
    if (!startRoad) return;
    const startIdx = startRoad.y * grid.width + startRoad.x;
    const endIdx = destRoad.y * grid.width + destRoad.x;
    if (startIdx === endIdx) return;
    const path = pathfinder.findPath(roadGraph, startIdx, endIdx, grid.width);
    if (!path || path.length < 2) return;
    const car: Car = {
      pathTiles: path, segmentIdx: 0, segmentT: 0,
      // Emergency vehicles are slightly faster (they're going somewhere).
      speed: 1.15,
      // Color: fire = bright red, patrol = white. The body colour is the
      // primary identifier; subtle but enough to ID at typical zoom.
      color: useFire ? 0xe14848 : 0xf2f2f2,
      loadedTile: path[1]!, pauseRemaining: 0,
      yielding: false, yieldSince: 0,
      destX: destRoad.x, destY: destRoad.y,
      originRoadIdx: startIdx,
      originHomeX: station.x, originHomeY: station.y,
      kind: useFire ? 'fire_response' : 'patrol'
    };
    this.cars.push(car);
    this.incrementLoad(grid, car.loadedTile);
  }

  /**
   * Spawn one motorcade vehicle on the supplied path (Alpha 4.14). Used
   * by `Motorcade.ts` to push the lead/limo/tail cars onto the road one
   * at a time with a short delay between them so they convoy correctly.
   * The car runs the supplied path end-to-end then despawns.
   */
  spawnMotorcadeVehicle(
    grid: Grid,
    path: number[],
    kind: 'motorcade_lead' | 'motorcade_limo' | 'motorcade_tail'
  ): void {
    if (path.length < 2) return;
    const color =
      kind === 'motorcade_limo' ? 0x141820 :  // black limousine
                                   0xf2f2f2;   // police escort white
    const car: Car = {
      pathTiles: path, segmentIdx: 0, segmentT: 0,
      // Motorcade moves at slightly above local-road tier speed so it
      // visibly threads through traffic.
      speed: 1.1,
      color,
      loadedTile: path[1]!, pauseRemaining: 0,
      yielding: false, yieldSince: 0,
      // No real "destination tile" — set to start so crash code is well-formed.
      destX: path[0]! % grid.width, destY: Math.floor(path[0]! / grid.width),
      kind
    };
    this.cars.push(car);
    this.incrementLoad(grid, car.loadedTile);
  }

  /**
   * Advance every car along its path. See class doc for collision +
   * stop-sign behaviour. After this call, `crashesThisFrame` holds any
   * collisions that fired — Game inspects it per render frame.
   */
  update(
    dt: number,
    grid: Grid,
    gridWidth: number,
    trafficLights?: TrafficLights,
    parking?: import('./Parking').Parking,
    shoppers?: import('./Shoppers').Shoppers,
    pathGraph?: PathGraph,
    walkPathfinder?: Pathfinding
  ): void {
    this.crashesThisFrame.length = 0;
    const now = performance.now();

    // Motorcade pullover pre-pass (Alpha 4.14): for each non-motorcade
    // car within MOTORCADE_PULLOVER_RADIUS (Manhattan distance) of any
    // motorcade vehicle, refresh its pauseRemaining so it freezes on
    // the shoulder until the convoy passes. Cheap because there are at
    // most 3 motorcade vehicles active and a single inner-loop pass.
    let motorcadeActive = false;
    for (const c of this.cars) {
      const k = c.kind;
      if (k === 'motorcade_lead' || k === 'motorcade_limo' || k === 'motorcade_tail') {
        motorcadeActive = true;
        break;
      }
    }
    if (motorcadeActive) {
      // Pre-extract motorcade tile positions for the inner sweep.
      const motorcadeTiles: number[] = [];
      for (const c of this.cars) {
        const k = c.kind;
        if (k !== 'motorcade_lead' && k !== 'motorcade_limo' && k !== 'motorcade_tail') continue;
        // Use the segment endpoint the car is closer to as its "current tile".
        const tile = c.segmentT < 0.5 ? c.pathTiles[c.segmentIdx] : c.pathTiles[c.segmentIdx + 1];
        if (tile !== undefined) motorcadeTiles.push(tile);
      }
      for (const c of this.cars) {
        const k = c.kind ?? 'resident';
        if (k === 'motorcade_lead' || k === 'motorcade_limo' || k === 'motorcade_tail') continue;
        const carTile = c.segmentT < 0.5 ? c.pathTiles[c.segmentIdx] : c.pathTiles[c.segmentIdx + 1];
        if (carTile === undefined) continue;
        const cx = carTile % gridWidth;
        const cy = (carTile - cx) / gridWidth;
        let nearMotorcade = false;
        for (const mt of motorcadeTiles) {
          const mx = mt % gridWidth;
          const my = (mt - mx) / gridWidth;
          if (Math.abs(mx - cx) + Math.abs(my - cy) <= MOTORCADE_PULLOVER_RADIUS) {
            nearMotorcade = true;
            break;
          }
        }
        if (nearMotorcade) {
          // Refresh the pause timer each tick the motorcade is in range.
          c.pauseRemaining = Math.max(c.pauseRemaining, MOTORCADE_PULLOVER_PAUSE_SEC);
        }
      }
    }

    // Per-segment leader pre-pass — used to keep cars from visually overlapping.
    // Authority cars (motorcade + emergency) bypass paused/yielding cars
    // (Alpha 4.15.1 fix) so they can drive past pulled-over traffic.
    // Without this, the motorcade would freeze the car directly in front
    // of it, then leader-gap would block the motorcade from advancing
    // past — and because the motorcade keeps refreshing the paused car's
    // pause every tick, the deadlock is permanent. The user's report:
    // "cars don't go back to driving after the motorcade passes" was
    // exactly this loop.
    const leaderT: number[] = new Array(this.cars.length);
    for (let i = 0; i < this.cars.length; i++) {
      const me = this.cars[i]!;
      const myKind = me.kind ?? 'resident';
      const meIsAuthority =
        myKind === 'patrol' || myKind === 'fire_response' ||
        myKind === 'motorcade_lead' || myKind === 'motorcade_limo' || myKind === 'motorcade_tail';
      const myA = me.pathTiles[me.segmentIdx]!;
      const myB = me.pathTiles[me.segmentIdx + 1]!;
      let best = Infinity;
      for (let j = 0; j < this.cars.length; j++) {
        if (i === j) continue;
        const other = this.cars[j]!;
        if (other.pathTiles[other.segmentIdx] !== myA) continue;
        if (other.pathTiles[other.segmentIdx + 1] !== myB) continue;
        // Authority skips frozen cars — flashers / sirens, they push past.
        if (meIsAuthority && (other.pauseRemaining > 0 || other.yielding)) continue;
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

      // Beta 1.3 Phase 2 — parked-state handling. Skips all movement
      // physics, collision rolls, and segment progression. The car sits
      // at its reserved stall until `parkedUntil` expires, then we
      // release the stall, push a return-trip entry, and despawn.
      if (car.isParked) {
        if (now >= (car.parkedUntil ?? 0)) {
          // Visit complete. Free the stall + queue the return trip if
          // this car came from a known origin (returns don't recurse).
          if (car.parking && parking) parking.release(car.parking);
          if (
            car.originRoadIdx !== undefined &&
            car.originHomeX !== undefined &&
            car.originHomeY !== undefined
          ) {
            this.pendingReturns.push({
              readyAt: now,                                  // immediate
              originRoadIdx: car.originRoadIdx,
              destRoadIdx: car.pathTiles[car.pathTiles.length - 1]!,
              originHomeX: car.originHomeX,
              originHomeY: car.originHomeY,
              kind: car.kind ?? 'resident',
              color: car.color
            });
          }
          this.cars.splice(i, 1);
        }
        continue;
      }

      // Stage 1: minimum stop-sign pause. Counts down from
      // STOP_SIGN_PAUSE_SEC. When it expires, the car switches to
      // yielding mode (stage 2) — still parked, but now waiting for the
      // intersection to clear instead of just waiting on the timer.
      if (car.pauseRemaining > 0) {
        car.pauseRemaining = Math.max(0, car.pauseRemaining - dt);
        if (car.pauseRemaining > 0) continue;
        // After the pause drains, decide: enter yielding mode (stop-sign
        // case — parked at the intersection boundary, waiting for cross-
        // traffic), OR just resume driving (pull-over case — frozen
        // mid-segment by a passing motorcade, no intersection involved).
        // The discriminator is segmentT: stop-sign cars park at exactly
        // STOP_PRE_T (= 0.5), pull-over cars are at whatever position
        // they happened to be when the motorcade arrived.
        // Bug fix (Alpha 4.15.1): pre-fix, ALL paused cars dropped into
        // yielding mode after a pull-over, then waited for FIFO release
        // that may never come — leaving cars stuck on the side of the
        // road forever after the motorcade moved on.
        const atStopBoundary = Math.abs(car.segmentT - STOP_PRE_T) < 1e-3;
        if (atStopBoundary) {
          car.yielding = true;
          car.yieldSince = now;
        }
        // Else: pull-over case → fall through to advance normally on the
        // next iteration (this tick's `continue`-less path resumes).
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

      // Authority cars (Alpha 4.14) skip stops, lights, and collision
      // rolls — they're emergency/VIP traffic running flashers.
      const authority =
        car.kind === 'patrol' || car.kind === 'fire_response' ||
        car.kind === 'motorcade_lead' || car.kind === 'motorcade_limo' || car.kind === 'motorcade_tail';

      // Stop-sign approach: if the next tile is a stop-sign intersection
      // and we haven't reached STOP_PRE_T yet, cap advance so we park at
      // the boundary instead of barreling into the centre.
      const nextIsStop =
        !authority &&
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
      // Authority vehicles skip lights too (Alpha 4.14).
      if (
        !authority &&
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
          // Authority cars (motorcade + emergency) bypass spillback from
          // paused/yielding traffic too (Alpha 4.15.1 fix). Same reason
          // as the leader-gap exclusion above — without this they get
          // stuck at segmentT=1 of the current segment if the next
          // segment is jammed with pulled-over cars, contributing to
          // the same deadlock the leader-gap fix addresses.
          let minNextT = Infinity;
          for (let j = 0; j < this.cars.length; j++) {
            if (j === i) continue;
            const other = this.cars[j]!;
            if (other.pathTiles[other.segmentIdx] !== newFromIdx) continue;
            if (other.pathTiles[other.segmentIdx + 1] !== newToIdx) continue;
            if (authority && (other.pauseRemaining > 0 || other.yielding)) continue;
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
          this.decrementLoad(grid, car.loadedTile, carLoadWeight(car));

          // Beta 1.3 Phase 2 — parking-aware arrival. If the car has a
          // stall reserved AND the parking_lot is still valid (not
          // bulldozed mid-trip), transition into the visible parked
          // state INSTEAD of the immediate despawn-and-queue-return.
          // The visit interval is then spent visibly at the stall;
          // the return trip queues when the parked timer expires (see
          // the parked-state branch at the top of this loop).
          if (
            car.parking &&
            parking &&
            parking.isReservationValid(car.parking)
          ) {
            const carKind = car.kind ?? 'resident';
            const visitMs = carKind === 'tourist'
              ? (8 + Math.random() * 7) * 1000
              : (CAR_VISIT_LOW_SEC + Math.random() * (CAR_VISIT_HIGH_SEC - CAR_VISIT_LOW_SEC)) * 1000;
            car.isParked = true;
            car.parkedUntil = now + visitMs;
            // Leave segmentT/segmentIdx where they are — the renderer
            // checks `isParked` and uses the stall position directly
            // (so the floating-mid-segment problem doesn't apply).
            // Beta 1.3.4 (Phase 2.1) — also spawn a Shopper that walks
            // the final leg from the stall to the actual destination
            // tile and back. The Shopper's totalSec matches the Car's
            // visitMs so the two despawn together. car.destX/destY are
            // the original commercial / big_box destination tile coords
            // (set at spawn in attemptSpawn).
            if (shoppers && car.destX !== undefined && car.destY !== undefined) {
              // Floor y comes from the parking-lot tile's road-surface
              // height proxy — sidewalk lift + tile elevation.
              const stallTile = grid.get(car.parking.tileX, car.parking.tileY);
              const yBase = (stallTile?.elevation ?? 0) + 0.009;
              // Beta 1.5.1 — pass grid + pathGraph + walkPathfinder so
              // the shopper plans a PathGraph route along sidewalks
              // instead of cutting straight across grass. Falls back
              // to straight-line internally when any of these are
              // missing or the pathfind fails.
              shoppers.spawnForParkedCar(
                car.parking,
                car.destX,
                car.destY,
                visitMs,
                car.color,
                yBase,
                grid,
                pathGraph,
                walkPathfinder
              );
            }
            despawned = false;  // car stays alive, just parked
            break;
          }

          // No parking → fall through to the original despawn-and-
          // queue-return path. Cars without originRoadIdx (i.e. return
          // cars themselves) don't recurse — they just despawn.
          if (
            car.originRoadIdx !== undefined &&
            car.originHomeX !== undefined &&
            car.originHomeY !== undefined
          ) {
            const arrivedIdx = car.pathTiles[car.segmentIdx]!;
            const carKind = car.kind ?? 'resident';
            // Per-kind dwell time at the destination:
            //  - Tourist: 8-15s (sightseeing, but shorter than commute)
            //  - Truck:   4-10s (delivering cargo, quick stop)
            //  - Default: 8-22s (resident running errands)
            const visitMs = carKind === 'tourist'
              ? (8 + Math.random() * 7) * 1000
              : carKind === 'truck'
              ? (TRUCK_VISIT_LOW_SEC + Math.random() * (TRUCK_VISIT_HIGH_SEC - TRUCK_VISIT_LOW_SEC)) * 1000
              : (CAR_VISIT_LOW_SEC + Math.random() * (CAR_VISIT_HIGH_SEC - CAR_VISIT_LOW_SEC)) * 1000;
            this.pendingReturns.push({
              readyAt: now + visitMs,
              originRoadIdx: car.originRoadIdx,
              destRoadIdx: arrivedIdx,
              originHomeX: car.originHomeX,
              originHomeY: car.originHomeY,
              kind: carKind,
              color: car.color
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
          this.decrementLoad(grid, car.loadedTile, carLoadWeight(car));
          this.cars.splice(i, 1);
          despawned = true;
          break;
        }

        // Intersection collision check. Stop signs and traffic lights both
        // suppress the roll: a stop sign forces a yielding handshake on the
        // previous segment, a traffic light controls the conflict via phase.
        // Authority vehicles also skip the roll (Alpha 4.14). Highway
        // interchange ramps skip too (Alpha 4.16) — ramps are smooth
        // merges, not crossings, so the player doesn't get punished
        // with collisions every time a car uses an exit.
        //
        // Highways skip the roll too (Alpha 4.22.1) — playtest report:
        // "If a car is going in the opposite direction the other cars
        // know not to take that lane and pick the other lane. This
        // makes it so I dont have to plan so hard to get highways to
        // work." Highways are physically-separated, one-way-per-tile,
        // typically dual-carriageway infrastructure (Alpha 4.22), so
        // cars on adjacent opposing-direction tiles aren't actually
        // crossing paths — they're parallel. Random crash rolls at
        // highway intersections felt like a planning trap and
        // discouraged players from building any highways at all.
        const isIntersection = grid.incidentRoadEdgeCount(arrivedX, arrivedY) >= 3;
        const isHighway = arrivedTile.roadType === 'highway';
        // Also skip collision when the intersection TOUCHES a highway
        // (Alpha 4.22.1) — covers the local-road side of a
        // highway-meets-local intersection. Without this, the user
        // would still get crashes whenever a local street crossed a
        // highway, which doesn't match the "highways just work" goal.
        const touchesHighway = !isHighway && (
          (grid.get(arrivedX + 1, arrivedY)?.roadType === 'highway') ||
          (grid.get(arrivedX - 1, arrivedY)?.roadType === 'highway') ||
          (grid.get(arrivedX, arrivedY + 1)?.roadType === 'highway') ||
          (grid.get(arrivedX, arrivedY - 1)?.roadType === 'highway')
        );
        if (isIntersection && !arrivedTile.stopSign && !arrivedTile.trafficLight && !arrivedTile.ramp && !isHighway && !touchesHighway && !authority) {
          const others = Math.max(0, arrivedTile.trafficLoad - 1);
          const p = Math.min(COLLISION_RATE_CAP, others * COLLISION_RATE_PER_OTHER);
          if (Math.random() < p) {
            this.crashesThisFrame.push({
              destX: car.destX,
              destY: car.destY,
              atIdx: arrivedIdx
            });
            this.decrementLoad(grid, car.loadedTile, carLoadWeight(car));
            this.cars.splice(i, 1);
            despawned = true;
            break;
          }
        }

        // Normal load transition: leave the arrived tile, count toward next.
        const newTarget = car.pathTiles[car.segmentIdx + 1];
        if (newTarget !== undefined) {
          const w = carLoadWeight(car);
          this.decrementLoad(grid, car.loadedTile, w);
          car.loadedTile = newTarget;
          this.incrementLoad(grid, car.loadedTile, w);
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

  private incrementLoad(grid: Grid, idx: number, weight = 1): void {
    const x = idx % grid.width;
    const y = (idx - x) / grid.width;
    const t = grid.get(x, y);
    if (t) t.trafficLoad += weight;
  }
  private decrementLoad(grid: Grid, idx: number, weight = 1): void {
    const x = idx % grid.width;
    const y = (idx - x) / grid.width;
    const t = grid.get(x, y);
    if (!t) return;
    t.trafficLoad = Math.max(0, t.trafficLoad - weight);
  }
}

function pickRandomDevelopedTile(
  grid: Grid,
  zone: 'residential' | 'commercial' | 'industrial',
  bigBoxBias: number = 1
): { x: number; y: number } | null {
  // Weighted reservoir sampling. `big_box` tiles get `bigBoxBias` weight
  // (Beta 1.4.2 = 2× by default in commercial picks) so shopping trips
  // bias toward big-box stores — makes their parking lots feel
  // bustling instead of empty. Other tiles weight = 1.
  let chosen: { x: number; y: number } | null = null;
  let totalWeight = 0;
  for (const t of grid.iter()) {
    if (t.density === 0 || t.road) continue;
    if (!tileMatchesRole(t.zone, zone)) continue;
    const weight = t.building === 'big_box' ? bigBoxBias : 1;
    totalWeight += weight;
    if (Math.random() * totalWeight < weight) chosen = { x: t.x, y: t.y };
  }
  return chosen;
}

/**
 * Pick a random tile that holds a specific Building kind (Alpha 4.14).
 * Used as employment destination for farms + forestry, and as the
 * tourist destination set (parks / landmarks / civic monuments). Reservoir
 * sample so we touch the grid once.
 */
function pickRandomBuildingTile(
  grid: Grid,
  kind: Building
): { x: number; y: number } | null {
  let chosen: { x: number; y: number } | null = null;
  let count = 0;
  for (const t of grid.iter()) {
    if (t.building !== kind) continue;
    count++;
    if (Math.random() * count < 1) chosen = { x: t.x, y: t.y };
  }
  return chosen;
}

/** Tile is a tourist destination if it's any of the player's "look at me"
 *  buildings (Alpha 4.14). Public art, parks, landmarks, civic
 *  monuments, and the Mansion all draw outside-of-city visitors. */
function isTouristDestination(t: Tile): boolean {
  switch (t.building) {
    case 'park':
    case 'museum':
    case 'stadium':
    case 'observatory':
    case 'plaza':
    case 'fountain':
    case 'statue':
    case 'memorial_garden':
    case 'reflecting_pool':
    case 'clock_tower':
    case 'triumphal_arch':
    case 'topiary':
    case 'flower_bed':
    case 'pergola':
    case 'pier':
    case 'mayor_mansion':
    case 'city_hall':
    case 'provincial_capital':
    case 'national_capital':
      return true;
    default:
      return false;
  }
}

/** Pick a random tourist destination from anywhere in the grid (Alpha 4.14).
 *  Reservoir sample so callers don't need to maintain an index. */
function pickTouristDestination(grid: Grid): { x: number; y: number } | null {
  let chosen: { x: number; y: number } | null = null;
  let count = 0;
  for (const t of grid.iter()) {
    if (!isTouristDestination(t)) continue;
    count++;
    if (Math.random() * count < 1) chosen = { x: t.x, y: t.y };
  }
  return chosen;
}

/** Pick a random road tile anywhere in the city (Alpha 4.14). Used by
 *  emergency-vehicle dispatch to give patrols + fire trucks a roving
 *  destination — they tour the streets then return home. */
function pickRandomRoadTile(grid: Grid): { x: number; y: number } | null {
  let chosen: { x: number; y: number } | null = null;
  let count = 0;
  for (const t of grid.iter()) {
    if (!t.road) continue;
    count++;
    if (Math.random() * count < 1) chosen = { x: t.x, y: t.y };
  }
  return chosen;
}

/** Pick a random road tile that touches the city's outside edge (i.e. is
 *  on the perimeter of the grid). Used as the spawn point for tourist
 *  cars (they "drive in from out of town"). Returns null if no edge
 *  road exists (i.e. the city isn't connected to the outside world). */
function pickEdgeRoadTile(grid: Grid): { x: number; y: number } | null {
  const w = grid.width, h = grid.height;
  const candidates: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < w; x++) {
    if (grid.get(x, 0)?.road) candidates.push({ x, y: 0 });
    if (grid.get(x, h - 1)?.road) candidates.push({ x, y: h - 1 });
  }
  for (let y = 1; y < h - 1; y++) {
    if (grid.get(0, y)?.road) candidates.push({ x: 0, y });
    if (grid.get(w - 1, y)?.road) candidates.push({ x: w - 1, y });
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
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

/** True if (x, y) is within SUBWAY_SUPPRESSION_RADIUS (Chebyshev) of a
 *  subway entrance (Alpha 2.19). Each spawn check is O(R²) but the
 *  lookup happens only on candidate origins, not every tile. */
function nearSubwayEntrance(grid: Grid, x: number, y: number): boolean {
  const R = SUBWAY_SUPPRESSION_RADIUS;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const t = grid.get(x + dx, y + dy);
      if (t?.building === 'subway_entrance') return true;
    }
  }
  return false;
}
