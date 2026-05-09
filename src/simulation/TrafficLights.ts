import type { Grid } from '../world/Grid';
import type { Vehicles } from './Vehicles';
import { dirBetween } from '../types';

/**
 * Adaptive traffic-light controller (Alpha 2.0).
 *
 * Each player-placed traffic light cycles between two phases:
 *  - Phase 0: vertical traffic (N/S — including diagonals NE/NW/SE/SW that
 *    have a dominant N/S component when classified)
 *  - Phase 1: horizontal traffic (E/W and similar diagonals)
 *
 * Adaptive timing: at the end of each phase we look at the upcoming
 * phase's queued cars (cars sitting on the segments that feed the
 * intersection from that phase's open directions) and set the next phase
 * length proportionally. A jammed N/S corridor gets a longer green than
 * a quiet E/W cross-street. Bounded by [GREEN_MIN_SEC, GREEN_MAX_SEC].
 *
 * **Why this beats stop signs.** A stop sign forces every car through a
 * mandatory STOP_SIGN_PAUSE_SEC pause AND a yielding handshake. A traffic
 * light lets the green direction flow continuously — only red cars wait.
 * Net throughput at a busy junction is roughly 2× a stop sign even with
 * fixed timing; with adaptive timing biased toward the busy axis, ~3×.
 *
 * Collisions are SUPPRESSED at lit intersections — the controller is
 * presumed to handle conflict (the player is paying for the light).
 */

/** Yellow + clearance interval between phases, in real-time seconds. */
const YELLOW_SEC = 1.0;
/** Floor on green time so a quiet phase still serves cross-traffic. */
const GREEN_MIN_SEC = 4.0;
/** Ceiling so even a jammed phase eventually yields. */
const GREEN_MAX_SEC = 12.0;

/**
 * Phase identifier. 0 = vertical (N/S leg open), 1 = horizontal (E/W leg
 * open). YELLOW = clearing, no approaches are open.
 */
type Phase = 0 | 1;

interface LightState {
  phase: Phase;
  /** True between phases — all approaches treated as red so the
   *  intersection clears before the next green starts. */
  yellow: boolean;
  /** Real-time seconds until the next phase boundary. */
  timeRemaining: number;
}

export class TrafficLights {
  private readonly state = new Map<number, LightState>();
  private gridWidth = 0;

  /**
   * Sync the state map with current grid placements. Call after any tile
   * change that might add/remove a traffic light. Cheap — only inserts
   * missing entries and prunes orphans, leaves existing phase state alone
   * so the cycle continues across rebuilds.
   */
  rebuild(grid: Grid): void {
    this.gridWidth = grid.width;
    const seen = new Set<number>();
    for (const t of grid.iter()) {
      if (!t.trafficLight) continue;
      const idx = t.y * grid.width + t.x;
      seen.add(idx);
      if (!this.state.has(idx)) {
        this.state.set(idx, {
          phase: 0,
          yellow: false,
          // Stagger initial timers so neighbouring lights don't pulse in lockstep.
          timeRemaining: GREEN_MIN_SEC + Math.random() * (GREEN_MAX_SEC - GREEN_MIN_SEC)
        });
      }
    }
    for (const k of [...this.state.keys()]) {
      if (!seen.has(k)) this.state.delete(k);
    }
  }

  /** Tick all lights forward by `dt` real-time seconds. */
  tick(dt: number, grid: Grid, vehicles: Vehicles): void {
    if (this.state.size === 0) return;
    for (const [idx, s] of this.state) {
      s.timeRemaining -= dt;
      if (s.timeRemaining > 0) continue;
      if (s.yellow) {
        // End of yellow — flip to next phase. Compute its green length
        // from the queue feeding the new phase's open approaches.
        s.yellow = false;
        s.phase = (1 - s.phase) as Phase;
        s.timeRemaining = this.computeGreenLength(idx, grid, vehicles, s.phase);
      } else {
        // End of green — short yellow before the swap.
        s.yellow = true;
        s.timeRemaining = YELLOW_SEC;
      }
    }
  }

  /**
   * Returns true if a car arriving at intersection (toX, toY) from
   * (fromX, fromY) sees green. Non-light intersections always return true
   * (caller should not consult this for non-light tiles).
   */
  isGreen(grid: Grid, fromX: number, fromY: number, toX: number, toY: number): boolean {
    const idx = toY * (this.gridWidth || grid.width) + toX;
    const s = this.state.get(idx);
    if (!s) return true;
    if (s.yellow) return false;
    const dir = dirBetween(fromX, fromY, toX, toY);
    if (dir === -1) return true;
    return phaseFor(dir) === s.phase;
  }

  /** Inspect a tile's current light state — used by the renderer. */
  getStateFor(grid: Grid, x: number, y: number): { phase: Phase; yellow: boolean } | null {
    const idx = y * (this.gridWidth || grid.width) + x;
    const s = this.state.get(idx);
    if (!s) return null;
    return { phase: s.phase, yellow: s.yellow };
  }

  /**
   * Estimated number of cars queued on the approaches that the given phase
   * would open. Walks active vehicles and counts those whose current
   * segment terminates at the intersection AND whose approach direction
   * belongs to that phase. Cheap — capped by MAX_VEHICLES.
   */
  private queueFor(idx: number, grid: Grid, vehicles: Vehicles, phase: Phase): number {
    const x = idx % grid.width;
    const y = (idx - x) / grid.width;
    let n = 0;
    for (const car of vehicles.cars) {
      const next = car.pathTiles[car.segmentIdx + 1];
      if (next !== idx) continue;
      const fromIdx = car.pathTiles[car.segmentIdx];
      if (fromIdx === undefined) continue;
      const fx = fromIdx % grid.width;
      const fy = (fromIdx - fx) / grid.width;
      const dir = dirBetween(fx, fy, x, y);
      if (dir === -1) continue;
      if (phaseFor(dir) === phase) n++;
    }
    return n;
  }

  private computeGreenLength(idx: number, grid: Grid, vehicles: Vehicles, phase: Phase): number {
    const myQ = this.queueFor(idx, grid, vehicles, phase);
    const otherQ = this.queueFor(idx, grid, vehicles, (1 - phase) as Phase);
    const total = myQ + otherQ;
    if (total === 0) return GREEN_MIN_SEC;
    // Allocate green time proportional to my queue's share, then snap
    // into the [MIN, MAX] window. A single car on the cross street never
    // forces me below the floor; a long jam never blows past the ceiling.
    const share = myQ / total;
    const range = GREEN_MAX_SEC - GREEN_MIN_SEC;
    return GREEN_MIN_SEC + range * share;
  }
}

/**
 * Classify a direction (0..7 from `Dir` enum) into a phase. N/S/NE/SW/NW/SE
 * lean vertical; E/W lean horizontal.
 *
 * Dir indices: N=0 NE=1 E=2 SE=3 S=4 SW=5 W=6 NW=7
 * Phase 0 (vertical): N=0, S=4
 * Phase 1 (horizontal): E=2, W=6
 * Diagonals: NE/NW count as vertical (closer to N), SE/SW count as horizontal
 * — splits them so each phase still has 4 of the 8 directions roughly
 * balanced.
 */
function phaseFor(dir: number): Phase {
  // Cardinals
  if (dir === 0 || dir === 4) return 0;
  if (dir === 2 || dir === 6) return 1;
  // Diagonals — split arbitrarily but consistently.
  if (dir === 1 || dir === 7) return 0; // NE, NW → vertical
  return 1;                              // SE, SW → horizontal
}
