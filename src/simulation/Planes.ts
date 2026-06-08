/**
 * Aircraft simulation (Beta 2.1). Manages aircraft life-cycles from
 * off-map approach through landing, taxiing, gate dwell, taxi-out, and
 * departure. Each aircraft follows a sequence of 3D world-space waypoints;
 * the renderer reads the live position + yaw each frame to drive
 * InstancedMesh transforms.
 *
 * Coordinate convention: world-space x/z follow tile coords (TILE_SIZE = 1
 * so world x = tile.x, world z = tile.y). World y is altitude (above ground).
 * Aircraft on the ground ride at y ≈ GROUND_Y; airborne altitude ramps from
 * GROUND_Y up to CRUISE_ALT during takeoff/approach.
 *
 * Approach: a plane spawns 42 tiles outside the map edge, at CRUISE_ALT
 * altitude, and follows a curved glidepath toward the runway threshold.
 *
 * Departure: two kinds of departure —
 *   (A) Inbound planes that landed and are now pushing back from their gate.
 *   (B) Ground-spawned "turnaround" planes that start directly at a gate
 *       (simulate the airport as a hub, not just a destination). These spawn
 *       via trySpawnDeparture on a separate timer.
 *
 * ATC separation (Beta 2.1.2):
 *   - New arrivals are blocked while any aircraft is on the runway
 *     (approach / flare / landing / takeoff / departure phase).
 *   - Departing aircraft hold at the lineup position until the runway is
 *     clear of incoming traffic before starting the takeoff roll.
 *   - Spawn intervals are randomised so traffic feels organic.
 *
 * Passenger economy: on gate arrival the Airport.activePassengers count
 * increments by the aircraft's capacity * occupancy. Economy.runMonth reads
 * activePassengers and pays out APT_PASSENGER_REVENUE per visitor per month
 * (scaled by transit connectivity). Passengers "depart" when their aircraft
 * pushes back from the gate.
 */
import type { Airport, AptRunway } from './Airport';
import type { Grid } from '../world/Grid';
import { MAX_AIRCRAFT } from '../types';

const GROUND_Y = 0.05;   // y-coordinate when on the ground (just above tiles)
const CRUISE_ALT = 7.0;  // altitude above ground for approach/departure
const APPROACH_DIST = 42; // tiles outside map edge where aircraft spawns (long enough for a visible glidepath)
const TAXI_SPEED = 0.6;  // tiles/sec on the ground (taxiing)
const LAND_SPEED_MAX = 3.2; // speed at touch-down (tiles/sec)
const TAKEOFF_SPEED = 3.5; // speed during takeoff roll
const ROTATE_SPEED = 3.0;  // speed when nose lifts for climb-out
const APPROACH_SPEED = 2.0; // speed on final approach
const PARKTIME_MIN_MS = 25_000; // min dwell at gate (arrival)
const PARKTIME_MAX_MS = 55_000; // max dwell at gate (arrival)
const TURNAROUND_MIN_MS = 8_000; // min dwell for ground-spawned departure
const TURNAROUND_MAX_MS = 18_000; // max dwell for ground-spawned departure

// Arrival spawn interval range (randomised per spawn attempt).
const ARRIVAL_MIN_MS = 45_000;  // 45 s minimum between arrivals
const ARRIVAL_MAX_MS = 90_000;  // 90 s maximum between arrivals

// Ground-departure spawn interval range.
const DEPART_MIN_MS  = 35_000;  // 35 s minimum between departure spawns
const DEPART_MAX_MS  = 80_000;  // 80 s maximum

// How long a departure is allowed to fly after rotation before despawning.
// At TAKEOFF_SPEED*1.3 ≈ 4.55 tiles/s, 20 s carries the plane ~91 tiles
// (well beyond any map size — clearly off-screen).
const DEPARTURE_LIFETIME_MS = 20_000;

const AIRLINE_LIVERIES: number[] = [
  0xffffff, // white (generic)
  0x002fa7, // deep blue
  0xe8001b, // red
  0xf58220, // orange (Southwest-style)
  0x3d9970, // teal
  0x1a1a2e, // dark navy
  0xc0392b, // crimson
];

export type AircraftPhase =
  | 'approach'    // flying toward runway from off-map
  | 'flare'       // last 3 tiles of approach, descending steeply
  | 'landing'     // on runway decelerating
  | 'taxi_in'     // following taxi path from runway to gate
  | 'parked'      // at gate, passenger exchange timer running
  | 'pushback'    // reversing away from gate (short animation)
  | 'taxi_out'    // following taxi path from gate to runway
  | 'lineup'      // at runway threshold, holding for clearance
  | 'takeoff'     // accelerating down runway
  | 'departure'   // airborne, climbing away from map
  | 'done';       // despawn this frame

export type AircraftType = 'regional' | 'narrowbody' | 'widebody';

export interface AircraftWaypoint {
  wx: number; wy: number; wz: number;
  /** Speed to target on arrival at this waypoint. */
  speed: number;
  /** Desired yaw (radians) to face on arrival. If null, computed from direction. */
  yaw?: number;
}

export interface Aircraft {
  id: number;
  type: AircraftType;
  /** Livery colour index into AIRLINE_LIVERIES. */
  liveryIdx: number;
  phase: AircraftPhase;
  /** World-space position in tile units (y = altitude). */
  wx: number; wy: number; wz: number;
  /** Facing direction in radians. 0 = faces +Z (south). */
  yaw: number;
  /** Current forward speed in tiles/sec. */
  speed: number;
  /** Waypoints for the current phase. */
  waypoints: AircraftWaypoint[];
  wpIdx: number;
  /** Gate id the aircraft is targeting / parked at. -1 = no gate assigned. */
  gateId: number;
  /** Runway this aircraft is using. */
  runwayIdx: number;
  /** Milliseconds remaining at gate (parked phase). */
  parkTimerMs: number;
  /** Passengers contributed to Airport.activePassengers. */
  passengerCount: number;
  /** Total airborne time (ms) — used to cap departure animation. */
  departureMs: number;
  /**
   * True for ground-spawned "turnaround" departures that start at a gate.
   * These aircraft skip the arrival passenger credit so activePassengers
   * isn't inflated — they represent planes that were already there.
   */
  isDeparture: boolean;
}

/** Typical seat count for fare economy: regional 45, narrowbody 175, widebody 370. */
function passengerCapacity(type: AircraftType): number {
  return type === 'regional' ? 45 : type === 'narrowbody' ? 175 : 370;
}

/** Occupancy fraction (0.6–0.95). */
function randomOccupancy(): number {
  return 0.60 + Math.random() * 0.35;
}

/** Random aircraft type weighted by terminal size. */
function pickType(termSize: number): AircraftType {
  if (termSize <= 4)       return 'regional';
  if (termSize <= 15)      return Math.random() < 0.5 ? 'regional' : 'narrowbody';
  return Math.random() < 0.33 ? 'regional' : Math.random() < 0.5 ? 'narrowbody' : 'widebody';
}

export class Planes {
  aircraft: Aircraft[] = [];
  private nextId = 1;

  // Arrival timing — randomised interval so traffic feels organic, not metronomic.
  private arrivalAccumMs = 0;
  private nextArrivalMs = ARRIVAL_MIN_MS + Math.random() * (ARRIVAL_MAX_MS - ARRIVAL_MIN_MS);

  // Ground-departure timing — separate cadence from arrivals.
  private departAccumMs = 0;
  private nextDepartMs = DEPART_MIN_MS + Math.random() * (DEPART_MAX_MS - DEPART_MIN_MS);

  update(dtMs: number, airport: Airport, grid: Grid): void {
    if (!airport.isOperational()) return;

    this.arrivalAccumMs += dtMs;
    this.departAccumMs  += dtMs;

    // Arrival spawn: pick a free runway at random (ATC separation per-runway).
    if (this.arrivalAccumMs >= this.nextArrivalMs && this.aircraft.length < MAX_AIRCRAFT) {
      const freeRwy = this.pickFreeRunway(airport);
      if (freeRwy !== -1) {
        this.arrivalAccumMs = 0;
        this.nextArrivalMs = ARRIVAL_MIN_MS + Math.random() * (ARRIVAL_MAX_MS - ARRIVAL_MIN_MS);
        this.trySpawnAircraft(airport, grid, freeRwy);
      }
      // If no runway free, timer keeps running — try every tick until one clears.
    }

    // Ground-departure spawn (independent of arrivals, also per-runway).
    if (this.departAccumMs >= this.nextDepartMs && this.aircraft.length < MAX_AIRCRAFT) {
      this.departAccumMs = 0;
      this.nextDepartMs = DEPART_MIN_MS + Math.random() * (DEPART_MAX_MS - DEPART_MIN_MS);
      // Departures don't need the runway yet (they start parked), so pick any
      // qualifying runway — the lineup ATC hold will gate the actual takeoff.
      const anyRwy = this.pickAnyQualifyingRunway(airport);
      if (anyRwy !== -1) this.trySpawnDeparture(airport, grid, anyRwy);
    }

    // Advance each aircraft.
    const dt = dtMs / 1000; // seconds
    for (let i = this.aircraft.length - 1; i >= 0; i--) {
      const a = this.aircraft[i]!;
      this.tickAircraft(a, dt, dtMs, airport, grid);
      if (a.phase === 'done') {
        this.aircraft.splice(i, 1);
      }
    }
  }

  /**
   * True when a specific runway is actively occupied by an aircraft on
   * approach, flare, landing, takeoff, or departure.  Checked per-runway
   * so a two-runway airport can work both runways simultaneously.
   */
  private isRunwayHot(rwyIdx: number): boolean {
    return this.aircraft.some(a =>
      a.runwayIdx === rwyIdx &&
      (a.phase === 'approach' || a.phase === 'flare' ||
       a.phase === 'landing'  || a.phase === 'takeoff' ||
       a.phase === 'departure')
    );
  }

  /**
   * Return the index of a random qualifying runway that is currently free,
   * or -1 if none are available.  Qualifying = length ≥ APT_MIN_RUNWAY_TILES.
   * Randomly ordered so a two-runway airport distributes traffic evenly.
   */
  private pickFreeRunway(airport: Airport): number {
    const candidates = airport.runways
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => r.length >= 3 && !this.isRunwayHot(i));
    if (candidates.length === 0) return -1;
    return candidates[Math.floor(Math.random() * candidates.length)]!.i;
  }

  /** Return the index of any qualifying runway (ignores hot status). */
  private pickAnyQualifyingRunway(airport: Airport): number {
    const candidates = airport.runways
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.length >= 3);
    if (candidates.length === 0) return -1;
    return candidates[Math.floor(Math.random() * candidates.length)]!.i;
  }

  /**
   * Spawn an inbound aircraft that flies in from off-map, lands, taxis to a
   * gate, dwells, then pushes back and departs.
   */
  private trySpawnAircraft(airport: Airport, grid: Grid, rwyIdx: number): boolean {
    const gate = airport.findAvailableGate();
    if (!gate) return false;
    if (rwyIdx < 0 || rwyIdx >= airport.runways.length) return false;
    const runway = airport.runways[rwyIdx]!;

    const type = pickType(airport.terminalTileCount);
    const liveryIdx = Math.floor(Math.random() * AIRLINE_LIVERIES.length);
    const id = this.nextId++;

    // Build approach waypoints from map edge → runway threshold.
    const waypoints = this.buildApproachWaypoints(runway, grid);
    if (waypoints.length === 0) return false;

    const start = waypoints[0]!;

    const a: Aircraft = {
      id, type, liveryIdx,
      phase: 'approach',
      wx: start.wx, wy: start.wy, wz: start.wz,
      yaw: start.yaw ?? 0,
      speed: APPROACH_SPEED,
      waypoints, wpIdx: 0,
      gateId: gate.id,
      runwayIdx: rwyIdx,
      parkTimerMs: PARKTIME_MIN_MS + Math.random() * (PARKTIME_MAX_MS - PARKTIME_MIN_MS),
      passengerCount: 0,
      departureMs: 0,
      isDeparture: false,
    };

    airport.occupyGate(gate.id, id);
    this.aircraft.push(a);
    return true;
  }

  /**
   * Spawn a ground-originated departure — a plane that starts at a gate
   * as if it were a turnaround from a previous flight.  It skips the
   * landing sequence entirely and begins in the parked phase with a short
   * turnaround timer, then pushes back and departs normally.
   *
   * These planes make the airport feel like a hub (traffic coming AND going)
   * rather than a pure arrival-only destination.
   */
  private trySpawnDeparture(airport: Airport, grid: Grid, rwyIdx: number): boolean {
    const gate = airport.findAvailableGate();
    if (!gate) return false;
    if (rwyIdx < 0 || rwyIdx >= airport.runways.length) return false;

    // Need taxiway connectivity to the runway — if there's no path, skip.
    const runway = airport.runways[rwyIdx]!;
    const far = { x: Math.round(runway.farEndX - 0.5), y: Math.round(runway.farEndZ - 0.5) };
    const taxiTest = airport.findTaxiPath(gate.x, gate.y, far.x, far.y, grid);
    // findTaxiPath returns [] if gate and far end are the same tile OR no route.
    // Allow spawning even without a path — the taxi_out phase handles the fallback.
    void taxiTest;

    const type = pickType(airport.terminalTileCount);
    const liveryIdx = Math.floor(Math.random() * AIRLINE_LIVERIES.length);
    const id = this.nextId++;

    const a: Aircraft = {
      id, type, liveryIdx,
      phase: 'parked',
      wx: gate.x + 0.5, wy: GROUND_Y, wz: gate.y + 0.5,
      yaw: 0,
      speed: 0,
      waypoints: [], wpIdx: 0,
      gateId: gate.id,
      runwayIdx: rwyIdx,
      // Short turnaround: the plane was already serviced, just finishing boarding.
      parkTimerMs: TURNAROUND_MIN_MS + Math.random() * (TURNAROUND_MAX_MS - TURNAROUND_MIN_MS),
      passengerCount: 0, // stays 0 so doParked knows it's a departure (isDeparture flag)
      departureMs: 0,
      isDeparture: true,
    };

    airport.occupyGate(gate.id, id);
    this.aircraft.push(a);
    return true;
  }

  private tickAircraft(a: Aircraft, dt: number, dtMs: number, airport: Airport, grid: Grid): void {
    switch (a.phase) {
      case 'approach':
      case 'flare':
      case 'taxi_in':
      case 'taxi_out':
        this.followWaypoints(a, dt);
        break;
      case 'landing':
        this.doLanding(a, dt, airport, grid);
        break;
      case 'parked':
        this.doParked(a, dtMs, airport, grid);
        break;
      case 'pushback':
        this.doPushback(a, dt, airport, grid);
        break;
      case 'lineup':
        // ATC hold: taxi to lineup position then wait for runway to clear.
        this.doLineup(a, dt, airport);
        break;
      case 'takeoff':
        this.doTakeoff(a, dt, airport, grid);
        break;
      case 'departure':
        this.doDeparture(a, dt, dtMs, airport);
        break;
    }
  }

  /**
   * Follow the waypoints array. When all waypoints are consumed, advance
   * to the next phase based on the current phase.
   */
  private followWaypoints(a: Aircraft, dt: number): void {
    while (a.wpIdx < a.waypoints.length) {
      const wp = a.waypoints[a.wpIdx]!;
      const dx = wp.wx - a.wx, dz = wp.wz - a.wz, dy = wp.wy - a.wy;
      const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (dist < 0.001) { a.wpIdx++; continue; }
      // Lerp speed toward target.
      const targetSpeed = wp.speed;
      a.speed += (targetSpeed - a.speed) * Math.min(1, dt * 2);
      const step = Math.min(a.speed * dt, dist);
      const frac = step / dist;
      a.wx += dx * frac;
      a.wy += dy * frac;
      a.wz += dz * frac;
      // Compute yaw from direction of travel (horizontal).
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
        a.yaw = Math.atan2(dx, dz); // atan2(x,z) gives yaw where 0=facing+Z
      }
      if (step < dist) return; // still moving toward this waypoint
      // Reached waypoint.
      a.wx = wp.wx; a.wy = wp.wy; a.wz = wp.wz;
      if (wp.yaw !== undefined) a.yaw = wp.yaw;
      a.wpIdx++;
      return;
    }
    // All waypoints consumed — transition to next phase.
    this.advancePhase(a);
  }

  private advancePhase(a: Aircraft): void {
    switch (a.phase) {
      case 'approach': a.phase = 'flare';   break;
      case 'flare':    a.phase = 'landing'; a.waypoints = []; a.wpIdx = 0; break;
      case 'landing':  /* handled in doLanding */ break;
      case 'taxi_in':  a.phase = 'parked';  break;
      case 'pushback': a.phase = 'taxi_out'; break;
      case 'taxi_out': a.phase = 'lineup';  break;
      // lineup → takeoff is handled by doLineup (ATC hold), not here.
      case 'takeoff':  /* handled in doTakeoff */ break;
      case 'departure': a.phase = 'done'; break;
    }
  }

  /**
   * Landing roll: decelerate along the runway using waypoints so the plane
   * visibly traverses most of the runway length before turning off.
   * advancePhase resets a.waypoints=[] when entering this phase (flare→landing),
   * so length===0 reliably means "first frame."
   */
  private doLanding(a: Aircraft, dt: number, airport: Airport, grid: Grid): void {
    const runway = airport.runways[a.runwayIdx]!;

    // First frame in landing: build rollout waypoints down 72% of the runway.
    if (a.waypoints.length === 0) {
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
      const midX = lerp(runway.thresholdX, runway.farEndX, 0.38);
      const midZ = lerp(runway.thresholdZ, runway.farEndZ, 0.38);
      const turnOffX = lerp(runway.thresholdX, runway.farEndX, 0.72);
      const turnOffZ = lerp(runway.thresholdZ, runway.farEndZ, 0.72);
      a.waypoints = [
        // Still fast at mid-runway
        { wx: midX, wy: GROUND_Y, wz: midZ, speed: LAND_SPEED_MAX * 0.5 },
        // Slowed to taxi speed at the turn-off point
        { wx: turnOffX, wy: GROUND_Y, wz: turnOffZ, speed: TAXI_SPEED },
      ];
      a.wpIdx = 0;
      return;
    }

    // Rollout in progress — follow the waypoints.
    if (a.wpIdx < a.waypoints.length) {
      this.followWaypoints(a, dt);
      // followWaypoints calls advancePhase when done, which is a no-op for landing
      return;
    }

    // Rollout complete — build taxi path from current position to gate.
    const gate = airport.gates.find(g => g.id === a.gateId);
    if (!gate) { a.phase = 'done'; return; }
    const exitTile = airport.nearestRunwayExit(gate.x, gate.y, runway);
    const fromTile = { x: Math.round(a.wx - 0.5), y: Math.round(a.wz - 0.5) };
    if (exitTile) {
      const taxiPath = airport.findTaxiPath(
        fromTile.x, fromTile.y,
        gate.x, gate.y,
        grid
      );
      a.waypoints = taxiPath.map(tp => ({
        wx: tp.x + 0.5, wy: GROUND_Y, wz: tp.y + 0.5,
        speed: TAXI_SPEED
      }));
    } else {
      a.waypoints = [{ wx: gate.x + 0.5, wy: GROUND_Y, wz: gate.y + 0.5, speed: TAXI_SPEED }];
    }
    a.wpIdx = 0;
    a.phase = 'taxi_in';
  }

  /**
   * Parked: count down timer, then credit passengers, then start pushback.
   * Ground-departure planes (isDeparture=true) skip the arrival passenger
   * credit — they represent planes already serviced in the city.
   */
  private doParked(a: Aircraft, dtMs: number, airport: Airport, _grid: Grid): void {
    if (a.passengerCount === 0 && !a.isDeparture) {
      // First frame parked (arrival): credit incoming passengers.
      a.passengerCount = Math.round(passengerCapacity(a.type) * randomOccupancy());
      airport.activePassengers += a.passengerCount;
    }
    a.parkTimerMs -= dtMs;
    if (a.parkTimerMs <= 0) {
      // Depart: subtract the passengers we contributed (they've left for their hotels etc.)
      airport.activePassengers = Math.max(0, airport.activePassengers - a.passengerCount);
      a.passengerCount = 0;
      // Build pushback waypoints — reverse a short distance from the gate.
      a.waypoints = this.buildPushbackWaypoints(a);
      a.wpIdx = 0;
      a.phase = 'pushback';
    }
  }

  /** Short backward movement away from the gate building. */
  private buildPushbackWaypoints(a: Aircraft): AircraftWaypoint[] {
    const backYaw = a.yaw + Math.PI;
    const bx = Math.sin(backYaw), bz = Math.cos(backYaw);
    return [
      { wx: a.wx + bx * 0.8, wy: GROUND_Y, wz: a.wz + bz * 0.8, speed: 0.4, yaw: a.yaw + Math.PI }
    ];
  }

  private doPushback(a: Aircraft, dt: number, airport: Airport, grid: Grid): void {
    this.followWaypoints(a, dt);
    if (a.wpIdx >= a.waypoints.length) {
      // Build taxi_out path to runway far end (lineup position).
      const runway = airport.runways[a.runwayIdx]!;
      const far = { x: Math.round(runway.farEndX - 0.5), y: Math.round(runway.farEndZ - 0.5) };
      const fromTile = { x: Math.round(a.wx - 0.5), y: Math.round(a.wz - 0.5) };
      const taxiPath = airport.findTaxiPath(fromTile.x, fromTile.y, far.x, far.y, grid);
      a.waypoints = taxiPath.map(tp => ({
        wx: tp.x + 0.5, wy: GROUND_Y, wz: tp.y + 0.5, speed: TAXI_SPEED
      }));
      // Add lineup waypoint at runway far end.
      a.waypoints.push({ wx: runway.farEndX, wy: GROUND_Y, wz: runway.farEndZ, speed: 0.3 });
      a.wpIdx = 0;
      a.phase = 'taxi_out';
      // Release the gate.
      airport.releaseGate(a.gateId);
    }
  }

  /**
   * Lineup: finish taxiing to the runway end, then hold until the runway
   * is clear of incoming traffic before starting the takeoff roll.
   * This is the ATC separation gate — it prevents a departing plane from
   * rolling while another aircraft is on approach or landing.
   */
  private doLineup(a: Aircraft, dt: number, airport: Airport): void {
    // Still moving along taxi-out waypoints toward the lineup position.
    if (a.wpIdx < a.waypoints.length) {
      this.followWaypoints(a, dt);
      return;
    }

    // At lineup position.  Check runway clear of incoming traffic.
    const incomingClear = !this.aircraft.some(other =>
      other.id !== a.id &&
      other.runwayIdx === a.runwayIdx &&
      (other.phase === 'approach' || other.phase === 'flare' || other.phase === 'landing')
    );

    if (incomingClear) {
      // Set takeoff yaw so the plane rolls toward the approach end of the runway.
      // For NS runway (yaw≈0): take off toward south (facing +Z, yaw=0).
      // For EW runway (yaw≈π/2): take off toward east (facing +X, yaw=π/2).
      const runway = airport.runways[a.runwayIdx];
      if (runway) {
        const isNS = Math.abs(runway.yaw) < 0.1;
        // Takeoff direction = from farEnd toward threshold.
        const dx = runway.thresholdX - runway.farEndX;
        const dz = runway.thresholdZ - runway.farEndZ;
        if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
          a.yaw = Math.atan2(dx, dz);
        } else {
          // Fallback: use runway yaw convention
          a.yaw = isNS ? 0 : Math.PI / 2;
        }
      }
      a.phase = 'takeoff';
    }
    // else: hold position, wait for next tick.
  }

  private doTakeoff(a: Aircraft, dt: number, airport: Airport, grid: Grid): void {
    const runway = airport.runways[a.runwayIdx]!;
    // Accelerate toward threshold (opposite of approach direction).
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    a.speed = Math.min(TAKEOFF_SPEED, a.speed + dt * 2.5);
    a.wx += fx * a.speed * dt;
    a.wz += fz * a.speed * dt;
    a.wy = GROUND_Y;

    // Check if we've reached rotate speed AND are close to or past the threshold.
    const isNS = Math.abs(runway.yaw) < 0.1;
    let atThreshold: boolean;
    if (isNS) {
      // NS runway: threshold is south end (high Z). Taking off toward south
      // (yaw≈0, +Z direction). Trigger when near the south threshold.
      atThreshold = (a.wz > runway.thresholdZ - 0.5);
    } else {
      // EW runway: threshold is east end (high X). Taking off toward east
      // (yaw≈π/2, +X direction). Trigger when near the east threshold.
      atThreshold = (a.wx > runway.thresholdX - 0.5);
    }

    if (a.speed >= ROTATE_SPEED && atThreshold) {
      // Build departure waypoints (climb away off-map).
      a.waypoints = this.buildDepartureWaypoints(runway, grid, a.yaw);
      a.wpIdx = 0;
      a.phase = 'departure';
    }
  }

  private doDeparture(a: Aircraft, dt: number, dtMs: number, _airport: Airport): void {
    // Climb while flying off-map in the takeoff direction.
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    a.speed = Math.min(TAKEOFF_SPEED * 1.3, a.speed + dt * 1.5);
    a.wx += fx * a.speed * dt;
    a.wy = Math.min(CRUISE_ALT, a.wy + dt * 1.8);
    a.wz += fz * a.speed * dt;
    a.departureMs += dtMs;
    // Despawn after DEPARTURE_LIFETIME_MS — gives the plane time to clearly
    // fly off the map edge before vanishing. At 4.5+ tiles/s this covers
    // 90+ tiles, well beyond any map width.
    if (a.departureMs > DEPARTURE_LIFETIME_MS) a.phase = 'done';
  }

  // --- Waypoint builders --------------------------------------------------

  private buildApproachWaypoints(runway: AptRunway, _grid: Grid): AircraftWaypoint[] {
    const isNS = Math.abs(runway.yaw) < 0.1;
    let spawnX: number, spawnZ: number;
    let approachYaw: number;

    if (isNS) {
      // Approach from south (high Z), plane faces north (−Z).
      spawnX = runway.thresholdX;
      spawnZ = runway.thresholdZ + APPROACH_DIST;
      approachYaw = Math.PI;
    } else {
      // Approach from east (high X), plane faces west (−X).
      spawnX = runway.thresholdX + APPROACH_DIST;
      spawnZ = runway.thresholdZ;
      approachYaw = -Math.PI / 2;
    }

    // Helper: interpolate a point along the approach vector at fraction f.
    // f=1.0 → spawn (far end), f=0.0 → threshold.
    const D = APPROACH_DIST;
    const p = (f: number): [number, number] => isNS
      ? [spawnX,                             runway.thresholdZ + D * f]
      : [runway.thresholdX + D * f,          spawnZ];

    // Glidepath: cruise plateau → descent begins at ~24 tiles out →
    // low approach at ~10 tiles out → flare just before threshold → touchdown.
    const [cruX, cruZ]  = p(0.55);
    const [desX, desZ]  = p(0.25);
    const [lowX, lowZ]  = p(0.09);
    const [flrX, flrZ]  = p(0.03);

    return [
      { wx: spawnX, wy: CRUISE_ALT,         wz: spawnZ,  speed: APPROACH_SPEED, yaw: approachYaw },
      { wx: cruX,   wy: CRUISE_ALT,         wz: cruZ,    speed: APPROACH_SPEED },
      { wx: desX,   wy: CRUISE_ALT * 0.50,  wz: desZ,    speed: APPROACH_SPEED * 0.9 },
      { wx: lowX,   wy: CRUISE_ALT * 0.14,  wz: lowZ,    speed: APPROACH_SPEED * 0.8 },
      { wx: flrX,   wy: GROUND_Y + 0.30,   wz: flrZ,    speed: LAND_SPEED_MAX * 0.85 },
      { wx: runway.thresholdX, wy: GROUND_Y, wz: runway.thresholdZ, speed: LAND_SPEED_MAX },
    ];
  }

  /** Departure climb-out waypoint: fly well off the map edge in takeoff direction. */
  private buildDepartureWaypoints(runway: AptRunway, _grid: Grid, takeoffYaw: number): AircraftWaypoint[] {
    const fx = Math.sin(takeoffYaw), fz = Math.cos(takeoffYaw);
    // Depart from the threshold (approach end), heading away from the airport.
    const outX = runway.thresholdX + fx * APPROACH_DIST * 1.5;
    const outZ = runway.thresholdZ + fz * APPROACH_DIST * 1.5;
    return [
      { wx: outX, wy: CRUISE_ALT, wz: outZ, speed: TAKEOFF_SPEED * 1.2 }
    ];
  }

}
