import type { Grid } from '../world/Grid';
import type { Pathfinding } from './Pathfinding';
import type { RoadGraph } from './RoadGraph';
import { ROAD_TIER, type RoadType } from '../types';

/** Hard cap on simultaneously-active buses citywide. */
const MAX_BUSES = 16;
/**
 * Per-bus speed multiplier on top of the road tier's `baseSpeed`. Buses are
 * slower than cars so they read as transit. With a multiplier of 0.75 a bus
 * on local = 1.5 t/s (matches the old hardcoded BUS_SPEED), on avenue = 2.1
 * t/s, on highway = 3.0 t/s — gradient that rewards transit on faster roads.
 */
const BUS_SPEED_MULT = 0.75;
/** Distinct yellow so buses pop against the car palette. */
const BUS_COLOR = 0xf2cd5c;
/** Chebyshev radius around a bus stop where R car-spawns are suppressed. */
const STOP_CATCHMENT = 4;

export interface Bus {
  pathTiles: number[];
  segmentIdx: number;
  segmentT: number;
  speed: number;
  color: number;
  /** Per-bus reference to its home depot, for re-pathing legs. */
  depotTile: number;
  /** The list of bus-stop tile indices this bus visits, in order. Captured at spawn. */
  routeStops: number[];
  /** Index into `routeStops`. -1 means heading from depot to the first stop. */
  legIdx: number;
  /**
   * Real-time seconds the bus is dwelling at a stop. While > 0 the bus
   * holds position, segmentT frozen, and the renderer offsets it
   * perpendicular to its direction toward the sidewalk to suggest a
   * pull-over. Set when the bus rolls onto a busStop road tile.
   */
  dwellRemaining: number;
}

/** Real-time seconds buses linger at a stop on arrival. */
const STOP_DWELL_SEC = 1.6;

/**
 * Buses: one per `bus_depot`, each cycling through every `bus_stop` on the
 * map (Step 12 prototype — no user-drawn routes). Each leg is its own A*
 * call; we accept the cost for simplicity. Buses share the road graph with
 * cars and contribute to per-tile load just by physical presence — though
 * because they substitute for car spawns via {@link nearBusStop} suppression,
 * the *net* load typically falls when stops are well-placed.
 */
export class Buses {
  readonly buses: Bus[] = [];

  /**
   * Maintain one bus per depot, capped citywide. Despawns/respawns are
   * deliberately rare — only on graph changes (via `clear`), or when a leg's
   * A* fails (the road network no longer reaches the next stop).
   */
  spawnTick(_stepMs: number, grid: Grid, roadGraph: RoadGraph, pathfinder: Pathfinding): void {
    if (this.buses.length >= MAX_BUSES) return;

    const depotTiles: number[] = [];
    const stopTiles: number[] = [];
    for (const t of grid.iter()) {
      if (t.building === 'bus_depot') depotTiles.push(t.y * grid.width + t.x);
      else if (t.building === 'bus_stop') stopTiles.push(t.y * grid.width + t.x);
      // Road-attached stops (Alpha 2.0) join the route directly — their
      // own road tile IS the stop tile, no nearestRoadTile lookup needed.
      else if (t.busStop && t.road) stopTiles.push(t.y * grid.width + t.x);
    }
    if (depotTiles.length === 0 || stopTiles.length === 0) return;

    // Track which depots already have a live bus.
    const live = new Set<number>();
    for (const b of this.buses) live.add(b.depotTile);

    for (const depotIdx of depotTiles) {
      if (live.has(depotIdx)) continue;
      if (this.buses.length >= MAX_BUSES) break;

      const dx = depotIdx % grid.width;
      const dy = (depotIdx - dx) / grid.width;
      const startRoad = nearestRoadTile(grid, dx, dy);
      if (!startRoad) continue;
      const startIdx = startRoad.y * grid.width + startRoad.x;

      // First stop's nearest-road becomes the first leg target.
      const firstStop = stopTiles[0]!;
      const sx = firstStop % grid.width;
      const sy = (firstStop - sx) / grid.width;
      const stopRoad = nearestRoadTile(grid, sx, sy);
      if (!stopRoad) continue;
      const endIdx = stopRoad.y * grid.width + stopRoad.x;

      const path = pathfinder.findPath(roadGraph, startIdx, endIdx, grid.width);
      if (!path || path.length < 2) continue;

      this.buses.push({
        pathTiles: path,
        segmentIdx: 0,
        segmentT: 0,
        speed: BUS_SPEED_MULT,
        color: BUS_COLOR,
        depotTile: depotIdx,
        routeStops: stopTiles.slice(),
        legIdx: -1,
        dwellRemaining: 0
      });
    }
  }

  /**
   * Advance buses along their current leg. When a bus reaches the end of its
   * pathTiles, replan: next stop in `routeStops`, looping forever. If A*
   * fails (graph break), drop the bus — `spawnTick` will respawn it next
   * cycle once a route exists again.
   */
  update(dt: number, grid: Grid, gridWidth: number, roadGraph: RoadGraph, pathfinder: Pathfinding): void {
    for (let i = this.buses.length - 1; i >= 0; i--) {
      const bus = this.buses[i]!;
      if (bus.pathTiles.length < 2) {
        // Legless bus — try to plan its next leg now.
        if (!this.replanLeg(bus, grid, roadGraph, pathfinder)) {
          this.buses.splice(i, 1);
        }
        continue;
      }
      // Pull-over dwell: bus is parked at a stop. Freeze movement.
      if (bus.dwellRemaining > 0) {
        bus.dwellRemaining = Math.max(0, bus.dwellRemaining - dt);
        continue;
      }

      const aIdx = bus.pathTiles[bus.segmentIdx]!;
      const bIdx = bus.pathTiles[bus.segmentIdx + 1]!;
      const ax = aIdx % gridWidth;
      const ay = (aIdx - ax) / gridWidth;
      const bx = bIdx % gridWidth;
      const by = (bIdx - bx) / gridWidth;
      const segLen = Math.hypot(bx - ax, by - ay) || 1;

      // Per-tier base speed × per-bus multiplier. Buses don't crash and don't
      // pause for stop signs (professional drivers / dispatcher control).
      const destTile = grid.get(bx, by);
      const tier: RoadType = destTile?.roadType ?? 'local';
      const tierBase = ROAD_TIER[tier].baseSpeed;
      bus.segmentT += (tierBase * bus.speed * dt) / segLen;
      while (bus.segmentT >= 1) {
        bus.segmentT -= 1;
        bus.segmentIdx++;
        if (bus.segmentIdx >= bus.pathTiles.length - 1) {
          // Arrived at the end of the current leg. Dwell at the stop, then
          // plan the next leg.
          const lastIdx = bus.pathTiles[bus.pathTiles.length - 1]!;
          const lx = lastIdx % gridWidth;
          const ly = (lastIdx - lx) / gridWidth;
          const lastTile = grid.get(lx, ly);
          if (lastTile?.busStop || lastTile?.building === 'bus_stop') {
            bus.dwellRemaining = STOP_DWELL_SEC;
          }
          if (!this.replanLeg(bus, grid, roadGraph, pathfinder)) {
            this.buses.splice(i, 1);
          }
          break;
        }
        // Mid-leg pull-over: when crossing into a busStop tile, dwell.
        const arrivedTile = grid.get(
          bus.pathTiles[bus.segmentIdx]! % gridWidth,
          (bus.pathTiles[bus.segmentIdx]! - bus.pathTiles[bus.segmentIdx]! % gridWidth) / gridWidth
        );
        if (arrivedTile?.busStop) {
          bus.dwellRemaining = STOP_DWELL_SEC;
          break;
        }
      }
    }
  }

  clear(): void {
    this.buses.length = 0;
  }

  /**
   * Pick the next stop in the rotation, run A* from the bus's current tile to
   * its nearest-road, and reset segment state. Returns false if no path could
   * be found (caller drops the bus).
   */
  private replanLeg(bus: Bus, grid: Grid, roadGraph: RoadGraph, pathfinder: Pathfinding): boolean {
    if (bus.routeStops.length === 0) return false;
    bus.legIdx = (bus.legIdx + 1) % bus.routeStops.length;
    const target = bus.routeStops[bus.legIdx]!;

    const tx = target % grid.width;
    const ty = (target - tx) / grid.width;
    const targetRoad = nearestRoadTile(grid, tx, ty);
    if (!targetRoad) return false;

    // Start from where the bus actually is — the end of the previous path,
    // or its depot if the path is empty.
    const startIdx = bus.pathTiles.length > 0
      ? bus.pathTiles[bus.pathTiles.length - 1]!
      : bus.depotTile;

    const endIdx = targetRoad.y * grid.width + targetRoad.x;
    if (startIdx === endIdx) {
      // Already there — single-tile path, will replan immediately next tick.
      bus.pathTiles = [startIdx];
      bus.segmentIdx = 0;
      bus.segmentT = 0;
      return true;
    }

    const path = pathfinder.findPath(roadGraph, startIdx, endIdx, grid.width);
    if (!path || path.length < 2) return false;
    bus.pathTiles = path;
    bus.segmentIdx = 0;
    bus.segmentT = 0;
    return true;
  }
}

/**
 * True if any `bus_stop` building sits within Chebyshev radius
 * {@link STOP_CATCHMENT} of (x, y). Used by Vehicles' spawn loop to suppress
 * a fraction of car trips that originate inside a stop's catchment.
 */
export function nearBusStop(grid: Grid, x: number, y: number): boolean {
  const minX = Math.max(0, x - STOP_CATCHMENT);
  const maxX = Math.min(grid.width - 1, x + STOP_CATCHMENT);
  const minY = Math.max(0, y - STOP_CATCHMENT);
  const maxY = Math.min(grid.height - 1, y + STOP_CATCHMENT);
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const t = grid.get(xx, yy);
      if (!t) continue;
      if (t.building === 'bus_stop') return true;
      if (t.busStop && t.road) return true;
    }
  }
  return false;
}

/** Closest 4-connected road tile to (x, y), or null. Mirrors Vehicles helper. */
function nearestRoadTile(grid: Grid, x: number, y: number): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number }> = [
    { x, y: y - 1 },
    { x: x + 1, y },
    { x, y: y + 1 },
    { x: x - 1, y }
  ];
  for (const c of candidates) {
    if (grid.hasRoad(c.x, c.y)) return c;
  }
  return null;
}
