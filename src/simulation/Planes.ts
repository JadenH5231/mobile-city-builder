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
 * Approach: a plane spawns 18 tiles outside the map edge, at CRUISE_ALT
 * altitude, and follows a curved glidepath toward the runway threshold.
 * Departure: the reverse — accelerates along the runway then climbs away.
 *
 * Passenger economy: on gate arrival the Airport.activePassengers count
 * increments by the aircraft's capacity * occupancy. Economy.runMonth reads
 * activePassengers and pays out APT_PASSENGER_REVENUE per visitor per month
 * (scaled by transit connectivity). Passengers "depart" when their aircraft
 * pushes back from the gate and decrease the count accordingly.
 */
import type { Airport, AptRunway } from './Airport';
import type { Grid } from '../world/Grid';
import { MAX_AIRCRAFT } from '../types';

const GROUND_Y = 0.05;   // y-coordinate when on the ground (just above tiles)
const CRUISE_ALT = 7.0;  // altitude above ground for approach/departure
const APPROACH_DIST = 18; // tiles outside map edge where aircraft spawns
const TAXI_SPEED = 0.6;  // tiles/sec on the ground (taxiing)
const LAND_SPEED_MAX = 3.2; // speed at touch-down (tiles/sec)
const LAND_SPEED_MIN = 0.8; // speed after rollout, before turn
const TAKEOFF_SPEED = 3.5; // speed during takeoff roll
const ROTATE_SPEED = 3.0;  // speed when nose lifts for climb-out
const APPROACH_SPEED = 2.0; // speed on final approach
const PARKTIME_MIN_MS = 25_000; // min dwell at gate
const PARKTIME_MAX_MS = 55_000; // max dwell at gate

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
  | 'lineup'      // at runway threshold, brief hold before takeoff
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
}

/** Typical seat count for fare economy: regional 45, narrowbody 175, widebody 370. */
function passengerCapacity(type: AircraftType): number {
  return type === 'regional' ? 45 : type === 'narrowbody' ? 175 : 370;
}

/** Occupancy fraction (0.6–0.95). */
function randomOccupancy(): number {
  return 0.60 + Math.random() * 0.35;
}

export class Planes {
  aircraft: Aircraft[] = [];
  private nextId = 1;
  private spawnAccumMs = 0;
  private readonly SPAWN_INTERVAL_MS = 15_000; // try to spawn every 15 s

  update(dtMs: number, airport: Airport, grid: Grid): void {
    if (!airport.isOperational()) return;

    // Spawn cadence: try every SPAWN_INTERVAL_MS; also respect MAX_AIRCRAFT.
    this.spawnAccumMs += dtMs;
    if (this.spawnAccumMs >= this.SPAWN_INTERVAL_MS && this.aircraft.length < MAX_AIRCRAFT) {
      this.spawnAccumMs = 0;
      this.trySpawnAircraft(airport, grid);
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

  private trySpawnAircraft(airport: Airport, grid: Grid): boolean {
    // Pick an available gate + runway.
    const gate = airport.findAvailableGate();
    if (!gate) return false;
    const rwyIdx = airport.runways.findIndex(r => r.length >= 3);
    if (rwyIdx === -1) return false;
    const runway = airport.runways[rwyIdx]!;

    // Choose aircraft type based on terminal size.
    const termSize = airport.terminalTileCount;
    let type: AircraftType;
    if (termSize <= 4)       type = 'regional';
    else if (termSize <= 15) type = Math.random() < 0.5 ? 'regional' : 'narrowbody';
    else                     type = Math.random() < 0.33 ? 'regional' : Math.random() < 0.5 ? 'narrowbody' : 'widebody';

    const liveryIdx = Math.floor(Math.random() * AIRLINE_LIVERIES.length);
    const id = this.nextId++;

    // Build approach waypoints from map edge → runway threshold.
    const waypoints = this.buildApproachWaypoints(runway, grid);
    if (waypoints.length === 0) return false;

    // Starting position (first waypoint, off-map).
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
      departureMs: 0
    };

    // Reserve the gate.
    airport.occupyGate(gate.id, id);
    this.aircraft.push(a);
    return true;
  }

  private tickAircraft(a: Aircraft, dt: number, dtMs: number, airport: Airport, grid: Grid): void {
    switch (a.phase) {
      case 'approach':
      case 'flare':
      case 'lineup':
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
      case 'flare':    a.phase = 'landing'; break;
      case 'landing':  /* handled in doLanding */ break;
      case 'taxi_in':  a.phase = 'parked';  break;
      case 'pushback': a.phase = 'taxi_out'; break;
      case 'taxi_out': a.phase = 'lineup';  break;
      case 'lineup':   a.phase = 'takeoff'; break;
      case 'takeoff':  /* handled in doTakeoff */ break;
      case 'departure': a.phase = 'done'; break;
    }
  }

  /**
   * Landing roll: decelerate along runway, then start taxi_in phase
   * by computing path from runway to gate.
   */
  private doLanding(a: Aircraft, dt: number, airport: Airport, grid: Grid): void {
    // Roll in the heading direction the plane was already going.
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    a.speed = Math.max(LAND_SPEED_MIN, a.speed - dt * 1.8);
    a.wx += fx * a.speed * dt;
    a.wz += fz * a.speed * dt;
    a.wy = GROUND_Y;

    if (a.speed <= LAND_SPEED_MIN + 0.1) {
      // Rolled out enough — build taxi path to gate.
      const runway = airport.runways[a.runwayIdx]!;
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
        // No taxi path — teleport to gate area.
        a.waypoints = [{ wx: gate.x + 0.5, wy: GROUND_Y, wz: gate.y + 0.5, speed: TAXI_SPEED }];
      }
      a.wpIdx = 0;
      a.phase = 'taxi_in';
    }
  }

  /**
   * Parked: count down timer, then credit passengers, then start pushback.
   */
  private doParked(a: Aircraft, dtMs: number, airport: Airport, _grid: Grid): void {
    if (a.passengerCount === 0) {
      // First frame parked: credit passengers.
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
      // Build taxi_out path to runway.
      const runway = airport.runways[a.runwayIdx]!;
      // Use far-end threshold for lineup.
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

  private doTakeoff(a: Aircraft, dt: number, airport: Airport, grid: Grid): void {
    const runway = airport.runways[a.runwayIdx]!;
    // Accelerate toward threshold (opposite of approach direction).
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    a.speed = Math.min(TAKEOFF_SPEED, a.speed + dt * 2.5);
    a.wx += fx * a.speed * dt;
    a.wz += fz * a.speed * dt;
    a.wy = GROUND_Y;

    // Check if we've reached rotate speed AND passed the threshold.
    const atThreshold = Math.abs(a.yaw) < 0.1
      ? (a.wz < runway.thresholdZ - 0.5)    // NS: flew past south threshold
      : (a.wx > runway.thresholdX + 0.5);   // EW: flew past east threshold
    if (a.speed >= ROTATE_SPEED && atThreshold) {
      // Build departure waypoints (climb away off-map).
      a.waypoints = this.buildDepartureWaypoints(runway, grid, a.yaw);
      a.wpIdx = 0;
      a.phase = 'departure';
    }
  }

  private doDeparture(a: Aircraft, dt: number, dtMs: number, _airport: Airport): void {
    // Climb while flying off-map.
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    a.speed = Math.min(TAKEOFF_SPEED * 1.3, a.speed + dt * 1.5);
    a.wx += fx * a.speed * dt;
    a.wy = Math.min(CRUISE_ALT, a.wy + dt * 1.8);
    a.wz += fz * a.speed * dt;
    a.departureMs += dtMs;
    // Despawn after 8 seconds or when well off-map.
    if (a.departureMs > 8_000) a.phase = 'done';
  }

  // --- Waypoint builders --------------------------------------------------

  private buildApproachWaypoints(runway: AptRunway, _grid: Grid): AircraftWaypoint[] {
    const isNS = Math.abs(runway.yaw) < 0.1;
    let spawnX: number, spawnZ: number;
    let approachYaw: number; // heading aircraft flies ON approach

    if (isNS) {
      // Approach from south (high Z).
      spawnX = runway.thresholdX;
      spawnZ = runway.thresholdZ + APPROACH_DIST;
      approachYaw = Math.PI; // facing north (-Z)
    } else {
      // Approach from east (high X).
      spawnX = runway.thresholdX + APPROACH_DIST;
      spawnZ = runway.thresholdZ;
      approachYaw = -Math.PI / 2; // facing west (-X)
    }

    // Waypoints: spawn → intercept altitude reduction → flare start → threshold.
    const interceptX = isNS ? spawnX : (runway.thresholdX + 5);
    const interceptZ = isNS ? (runway.thresholdZ + 5) : spawnZ;

    return [
      { wx: spawnX, wy: CRUISE_ALT, wz: spawnZ, speed: APPROACH_SPEED, yaw: approachYaw },
      { wx: interceptX, wy: CRUISE_ALT * 0.6, wz: interceptZ, speed: APPROACH_SPEED },
      { wx: runway.thresholdX, wy: CRUISE_ALT * 0.15, wz: runway.thresholdZ, speed: APPROACH_SPEED * 0.9 },
      { wx: runway.thresholdX, wy: GROUND_Y, wz: runway.thresholdZ, speed: LAND_SPEED_MAX }
    ];
  }

  /** For takeoff, determine which direction to depart based on lineup yaw. */
  private buildDepartureWaypoints(runway: AptRunway, _grid: Grid, takeoffYaw: number): AircraftWaypoint[] {
    const fx = Math.sin(takeoffYaw), fz = Math.cos(takeoffYaw);
    const outX = runway.thresholdX + fx * APPROACH_DIST;
    const outZ = runway.thresholdZ + fz * APPROACH_DIST;
    return [
      { wx: outX, wy: CRUISE_ALT, wz: outZ, speed: TAKEOFF_SPEED * 1.2 }
    ];
  }

}

