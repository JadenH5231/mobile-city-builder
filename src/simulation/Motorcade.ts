import type { Grid } from '../world/Grid';
import type { RoadGraph } from './RoadGraph';
import type { Pathfinding } from './Pathfinding';
import type { Vehicles } from './Vehicles';
import { MOTORCADE_INTERVAL_MONTHS } from '../types';

/**
 * Result of a `Motorcade.monthlyTick` call (Alpha 4.14.2). Discriminated
 * union so the caller (Game) can route each outcome to a specific status
 * message. 'no_capital' is silent (player just doesn't have one yet);
 * 'no_road_access' / 'no_avenues' / 'no_route' all surface targeted
 * toasts so the player can fix the missing prereq.
 */
export type MotorcadeTickResult =
  | { kind: 'pending' }              // countdown not yet elapsed
  | { kind: 'started' }              // motorcade convoy queued
  | { kind: 'no_capital' }           // no Provincial / National Capital placed
  | { kind: 'no_road_access' }       // capital exists but has no adjacent road
  | { kind: 'no_avenues' }           // no avenue tiles to tour
  | { kind: 'no_route' };            // routing failed (likely disconnected avenues)

/**
 * Motorcade event (Alpha 4.14).
 *
 * Triggered every {@link MOTORCADE_INTERVAL_MONTHS} when the city has at
 * least one Provincial Capital or National Capital placed. Spawns a
 * three-vehicle convoy (lead police car → black limousine → tail police
 * car) that drives from the capital out through every avenue in the
 * city and back to the capital, then despawns.
 *
 * Route construction: starting from the capital's nearest road tile, we
 * collect every avenue road tile, sample down to MAX_WAYPOINTS via
 * spatial spreading, and route through them in greedy nearest-neighbour
 * order via A* on the road graph. The full path is the concatenation of
 * those segments + the loop back to the start.
 *
 * Spawn timing: lead car goes immediately; limo follows after
 * SPAWN_INTERVAL_SEC; tail follows another SPAWN_INTERVAL_SEC after.
 * They naturally space themselves on the same path because each starts
 * at segmentT=0 of pathTiles[0].
 *
 * The pull-over behaviour for ambient traffic lives in
 * `Vehicles.update` — a per-frame proximity sweep that refreshes
 * `pauseRemaining` on any non-motorcade car within
 * MOTORCADE_PULLOVER_RADIUS of any motorcade vehicle.
 */
export class Motorcade {
  /** Sim months remaining until the next motorcade fires. Decremented
   *  on each monthly tick. When ≤ 0 we attempt to start; on success the
   *  countdown resets to MOTORCADE_INTERVAL_MONTHS. On failure (no
   *  capital, no avenues, no path) we keep the negative count so the
   *  next tick re-tries — the player gets the motorcade as soon as
   *  the city actually qualifies. */
  monthsToNext = MOTORCADE_INTERVAL_MONTHS;

  /** Pending vehicle spawns queued during a `start()` call. Each entry
   *  has the spawn timestamp + the kind + a shared path reference.
   *  Drained per-frame by `tick()`. */
  private spawnQueue: Array<{
    spawnAt: number;
    kind: 'motorcade_lead' | 'motorcade_limo' | 'motorcade_tail';
    path: number[];
  }> = [];

  /** Real-time seconds between consecutive vehicle spawns in the convoy.
   *  Tuned so each car has a comfortable gap behind the previous one
   *  — too small and they overlap, too large and the convoy reads as
   *  unrelated cars. */
  private static readonly SPAWN_INTERVAL_SEC = 1.4;

  /** Upper bound on avenue waypoints visited per motorcade run. Picked
   *  to keep the route a reasonable length on Medium maps (~40-60 sec
   *  of total travel) without trying to A* between hundreds of
   *  waypoints. The waypoint sampler picks a spatially-spread subset
   *  so we still visit every quadrant of the avenue network. */
  private static readonly MAX_WAYPOINTS = 18;

  /**
   * Monthly tick — decrement countdown and attempt to fire if elapsed.
   * Returns a result so callers can surface targeted feedback for each
   * failure mode (Alpha 4.14.2). 'pending' means the countdown hasn't
   * elapsed yet; 'no_capital' silently no-ops because the player just
   * doesn't have one yet (no toast); the other failures DO surface a
   * status toast so the player knows what's blocking the convoy.
   *
   * Called from Game's per-month rollover hook.
   */
  monthlyTick(
    grid: Grid, roadGraph: RoadGraph, pathfinder: Pathfinding
  ): MotorcadeTickResult {
    this.monthsToNext -= 1;
    if (this.monthsToNext > 0) return { kind: 'pending' };
    const result = this.tryStart(grid, roadGraph, pathfinder);
    if (result.kind === 'started') {
      this.monthsToNext = MOTORCADE_INTERVAL_MONTHS;
    } else {
      // Don't reset the countdown on failure — the next month's tick
      // re-attempts so the player gets the motorcade as soon as the
      // city actually qualifies (e.g. once they paint an avenue).
    }
    return result;
  }

  /**
   * Per-frame pump — drain the spawn queue when each spawn timestamp
   * fires. Cheap; the queue is at most 3 entries.
   */
  tick(grid: Grid, vehicles: Vehicles): void {
    if (this.spawnQueue.length === 0) return;
    const now = performance.now();
    while (this.spawnQueue.length > 0 && this.spawnQueue[0]!.spawnAt <= now) {
      const entry = this.spawnQueue.shift()!;
      vehicles.spawnMotorcadeVehicle(grid, entry.path, entry.kind);
    }
  }

  /** True iff there is currently an active motorcade (spawn pending or
   *  vehicle still on the road). Used by Game to surface a HUD pip /
   *  status line letting the player know the motorcade is in town. */
  isActive(vehicles: Vehicles): boolean {
    if (this.spawnQueue.length > 0) return true;
    for (const c of vehicles.cars) {
      if (c.kind === 'motorcade_lead' || c.kind === 'motorcade_limo' || c.kind === 'motorcade_tail') return true;
    }
    return false;
  }

  /**
   * Build the motorcade route + queue the three vehicle spawns. Returns
   * a discriminated result so the caller can surface targeted feedback
   * for each failure mode.
   */
  private tryStart(grid: Grid, roadGraph: RoadGraph, pathfinder: Pathfinding): MotorcadeTickResult {
    const capital = findCapitalAnchor(grid);
    if (!capital) return { kind: 'no_capital' };
    const startRoad = nearestRoadTile(grid, capital.x, capital.y);
    if (!startRoad) return { kind: 'no_road_access' };
    const startIdx = startRoad.y * grid.width + startRoad.x;

    // Collect every avenue road tile in the grid.
    const avenues: Array<{ x: number; y: number; idx: number }> = [];
    for (const t of grid.iter()) {
      if (!t.road) continue;
      if (t.roadType !== 'avenue') continue;
      avenues.push({ x: t.x, y: t.y, idx: t.y * grid.width + t.x });
    }
    if (avenues.length === 0) return { kind: 'no_avenues' };

    // Sample down to MAX_WAYPOINTS via spatial spreading: greedy farthest-
    // point sampling so chosen waypoints cover the avenue network rather
    // than clustering in one neighbourhood.
    const waypoints = farthestPointSample(avenues, Motorcade.MAX_WAYPOINTS);

    // Greedy nearest-neighbour TSP from the capital across waypoints, then
    // back to the capital. Build the full path by concatenating A*
    // segments between consecutive stops.
    const fullPath: number[] = [];
    let cursor = startIdx;
    let cursorXY = { x: startRoad.x, y: startRoad.y };
    const remaining = waypoints.slice();
    while (remaining.length > 0) {
      // Pick the nearest remaining waypoint by Manhattan distance —
      // cheap heuristic, doesn't need A* just to choose.
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i]!;
        const d = Math.abs(w.x - cursorXY.x) + Math.abs(w.y - cursorXY.y);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      const target = remaining.splice(bestI, 1)[0]!;
      const seg = pathfinder.findPath(roadGraph, cursor, target.idx, grid.width);
      if (seg && seg.length >= 2) {
        // Skip the duplicate first tile when extending.
        if (fullPath.length === 0) fullPath.push(...seg);
        else fullPath.push(...seg.slice(1));
      }
      cursor = target.idx;
      cursorXY = { x: target.x, y: target.y };
    }
    // Loop back to the capital.
    const homeSeg = pathfinder.findPath(roadGraph, cursor, startIdx, grid.width);
    if (homeSeg && homeSeg.length >= 2) {
      if (fullPath.length === 0) fullPath.push(...homeSeg);
      else fullPath.push(...homeSeg.slice(1));
    }
    if (fullPath.length < 2) return { kind: 'no_route' };

    // Queue the three vehicles. Lead spawns immediately, limo +
    // SPAWN_INTERVAL_SEC, tail + 2 * SPAWN_INTERVAL_SEC.
    const now = performance.now();
    this.spawnQueue.push(
      { spawnAt: now,                                                  kind: 'motorcade_lead', path: fullPath },
      { spawnAt: now + Motorcade.SPAWN_INTERVAL_SEC * 1000,            kind: 'motorcade_limo', path: fullPath },
      { spawnAt: now + Motorcade.SPAWN_INTERVAL_SEC * 2000,            kind: 'motorcade_tail', path: fullPath }
    );
    return { kind: 'started' };
  }

  /** Reset the event state (used on city reset / save load).  Does NOT
   *  despawn already-active motorcade vehicles — those are in
   *  `vehicles.cars` and the next vehicles.clear() handles them. */
  reset(): void {
    this.spawnQueue.length = 0;
    this.monthsToNext = MOTORCADE_INTERVAL_MONTHS;
  }
}

// --- helpers -----------------------------------------------------------

/** Find the anchor tile of any Provincial Capital or National Capital in
 *  the city. Both share the lex-smallest-tile-is-anchor pattern. Returns
 *  the first one found (the player will only have at most one of each
 *  per city anyway). National takes precedence visually but for routing
 *  the choice doesn't matter — both work. */
function findCapitalAnchor(grid: Grid): { x: number; y: number } | null {
  for (const t of grid.iter()) {
    if (t.building === 'national_capital' || t.building === 'provincial_capital') {
      return { x: t.x, y: t.y };
    }
  }
  return null;
}

/** Greedy farthest-point sampling: pick the first waypoint at random,
 *  then repeatedly pick the candidate that maximises the minimum
 *  distance to the already-chosen set. Yields a spatially-spread
 *  subset so the motorcade visits every part of the avenue network
 *  rather than backtracking through one cluster. */
function farthestPointSample(
  pool: Array<{ x: number; y: number; idx: number }>,
  k: number
): Array<{ x: number; y: number; idx: number }> {
  if (pool.length <= k) return pool.slice();
  const chosen: Array<{ x: number; y: number; idx: number }> = [];
  // Seed with a random pick for variety run-to-run.
  chosen.push(pool[Math.floor(Math.random() * pool.length)]!);
  while (chosen.length < k) {
    let bestI = -1;
    let bestMin = -1;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i]!;
      // Skip if already chosen.
      let dup = false;
      for (const c of chosen) if (c.idx === p.idx) { dup = true; break; }
      if (dup) continue;
      // Min distance to chosen set.
      let minD = Infinity;
      for (const c of chosen) {
        const d = Math.abs(c.x - p.x) + Math.abs(c.y - p.y);
        if (d < minD) minD = d;
      }
      if (minD > bestMin) { bestMin = minD; bestI = i; }
    }
    if (bestI < 0) break;
    chosen.push(pool[bestI]!);
  }
  return chosen;
}

/** Find the nearest 4-connected road tile to (x, y). Mirrors
 *  Vehicles.nearestRoadTile but exposed here (Vehicles' helper is
 *  module-private). */
function nearestRoadTile(grid: Grid, x: number, y: number): { x: number; y: number } | null {
  const candidates: Array<{ x: number; y: number }> = [
    { x, y: y - 1 }, { x: x + 1, y },
    { x, y: y + 1 }, { x: x - 1, y },
    // Capitals are large, so check a 2-ring too.
    { x, y: y - 2 }, { x: x + 2, y },
    { x, y: y + 2 }, { x: x - 2, y },
    { x: x - 1, y: y - 1 }, { x: x + 1, y: y - 1 },
    { x: x - 1, y: y + 1 }, { x: x + 1, y: y + 1 }
  ];
  for (const c of candidates) {
    if (grid.hasRoad(c.x, c.y)) return c;
  }
  return null;
}
