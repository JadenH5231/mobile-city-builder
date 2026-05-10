import type { Grid } from '../world/Grid';

/**
 * Ferries (Alpha 2.19). Boats sail point-to-point between ferry docks
 * across water. No graph — just straight-line travel between paired
 * docks. The pairing is "each dock points to its nearest other dock"
 * recomputed any time docks are added/removed.
 *
 * Visualised by Renderer.updateFerries; this module owns the position +
 * heading state. One boat per dock pair, dwelling 3 sec at each end.
 *
 * Save state: not persisted — boats respawn deterministically on load
 * by walking the grid for ferry_dock buildings, same approach as buses
 * + cars. This keeps the save schema unaffected.
 */

const SPEED = 1.4; // tiles/sec across water
const DWELL_SECONDS = 3.0;
/** Max line-of-water-distance between paired docks. Beyond this, the
 *  pair is dropped — the route is too long to be plausibly served. */
const MAX_PAIR_DISTANCE = 28;

export interface Ferry {
  ax: number; ay: number;
  bx: number; by: number;
  /** 0..1 progress from A → B; `dir` flips when we arrive. */
  t: number;
  /** +1 means moving A→B; -1 means B→A. */
  dir: 1 | -1;
  /** Dwell timer at the current endpoint; 0 means actively moving. */
  dwell: number;
  /** World-space heading in radians (computed lazily for the renderer). */
  headingRadians: number;
}

export class Ferries {
  readonly active: Ferry[] = [];
  /** Hash of all dock positions — when this changes we rebuild active. */
  private lastDockSig = '';

  /**
   * Idempotent: if dock list hasn't changed, no-op. Otherwise rebuild the
   * active set with a fresh boat per pair.
   */
  rebuildIfNeeded(grid: Grid): void {
    const docks: Array<{ x: number; y: number }> = [];
    for (const t of grid.iter()) {
      if (t.building === 'ferry_dock') docks.push({ x: t.x, y: t.y });
    }
    const sig = docks.map((d) => `${d.x},${d.y}`).sort().join('|');
    if (sig === this.lastDockSig) return;
    this.lastDockSig = sig;

    this.active.length = 0;
    if (docks.length < 2) return;

    // Pair docks: each one paired with its nearest other dock. To avoid
    // double-counting we only emit a pair where i < j by index.
    for (let i = 0; i < docks.length; i++) {
      // Find j > i with smallest distance.
      let bestJ = -1;
      let bestD = Infinity;
      for (let j = 0; j < docks.length; j++) {
        if (i === j) continue;
        const a = docks[i]!, b = docks[j]!;
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d < bestD) { bestD = d; bestJ = j; }
      }
      if (bestJ <= i) continue; // each pair only emitted once (by lower-i)
      if (bestD > MAX_PAIR_DISTANCE) continue;
      const a = docks[i]!, b = docks[bestJ]!;
      this.active.push({
        ax: a.x, ay: a.y,
        bx: b.x, by: b.y,
        t: 0, dir: 1, dwell: 0,
        headingRadians: Math.atan2(b.x - a.x, b.y - a.y)
      });
    }
  }

  update(dt: number, grid: Grid): void {
    this.rebuildIfNeeded(grid);
    if (this.active.length === 0) return;
    for (const f of this.active) {
      if (f.dwell > 0) {
        f.dwell = Math.max(0, f.dwell - dt);
        continue;
      }
      const dist = Math.hypot(f.bx - f.ax, f.by - f.ay);
      if (dist === 0) continue;
      const step = (SPEED / dist) * dt;
      f.t += step * f.dir;
      if (f.dir === 1 && f.t >= 1) {
        f.t = 1;
        f.dir = -1;
        f.dwell = DWELL_SECONDS;
      } else if (f.dir === -1 && f.t <= 0) {
        f.t = 0;
        f.dir = 1;
        f.dwell = DWELL_SECONDS;
      }
      // Recompute heading on each tick (cheap; ferry count is tiny).
      const sx = f.dir === 1 ? f.bx - f.ax : f.ax - f.bx;
      const sz = f.dir === 1 ? f.by - f.ay : f.ay - f.by;
      f.headingRadians = Math.atan2(sx, sz);
    }
  }

  /** Reset the dock-signature cache so the next update rebuilds from scratch.
   *  Call after a save restore or city reset. */
  reset(): void {
    this.active.length = 0;
    this.lastDockSig = '';
  }
}
