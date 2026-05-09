import type { Grid } from '../world/Grid';
import {
  LUMBER_AMP,
  LUMBER_PERIOD_MONTHS,
  PRODUCE_AMP,
  PRODUCE_PERIOD_MONTHS
} from '../types';

/**
 * Global market simulation (Alpha 2.7) — the slice of the world
 * that exists outside the playable map. The city interacts with it
 * for export-coded revenue (currently lumber from forestry) when it's
 * connected to the outside world by a road tile that touches the map
 * edge.
 *
 * Lumber price is a simple sin-wave oscillation around 1.0:
 *   priceFactor(month) = 1 + LUMBER_AMP × sin(2π × month / PERIOD)
 *
 * with a bit of slow drift via a second harmonic so it doesn't read
 * as perfectly periodic. Range ≈ [0.55, 1.45]. The Economy reads
 * this via `lumberPrice()` once per month-end.
 *
 * "Connected to outside world" = at least one road tile (any tier,
 * highway or local) touches the map edge. Highways touching the edge
 * count as a strong export connection (full price); local roads touch
 * counts too (the spec doesn't get more granular yet).
 */
export class GlobalMarket {
  /** Cached connection bit, recomputed lazily via `recompute()` after
   *  any road change. */
  private _connected = false;

  /**
   * Does the city have a road tile on the map edge? Cheap O(perimeter)
   * sweep. Cached value lives in `_connected`; call `recompute(grid)`
   * after road changes to refresh.
   */
  recompute(grid: Grid): void {
    const w = grid.width;
    const h = grid.height;
    let connected = false;
    // Top + bottom edges.
    for (let x = 0; x < w; x++) {
      if (grid.get(x, 0)?.road || grid.get(x, h - 1)?.road) { connected = true; break; }
    }
    if (!connected) {
      for (let y = 0; y < h; y++) {
        if (grid.get(0, y)?.road || grid.get(w - 1, y)?.road) { connected = true; break; }
      }
    }
    this._connected = connected;
  }

  isConnected(): boolean {
    return this._connected;
  }

  /**
   * Multiplier on global-market lumber revenue this month. Centred on
   * 1.0; oscillates within ±LUMBER_AMP over a LUMBER_PERIOD_MONTHS
   * cycle. Two harmonics so the curve doesn't read as a clean sine.
   */
  lumberPrice(monthsElapsed: number): number {
    const t = (monthsElapsed % LUMBER_PERIOD_MONTHS) / LUMBER_PERIOD_MONTHS;
    const primary = Math.sin(t * Math.PI * 2);
    const secondary = Math.sin(t * Math.PI * 5) * 0.18;
    return 1.0 + LUMBER_AMP * (primary + secondary);
  }

  /**
   * Multiplier on global-market produce revenue this month (Alpha 2.7.1).
   * Same shape as `lumberPrice` but with a 12-month period offset by π so
   * lumber and produce don't peak at the same month — diversifying
   * smooths cash flow.
   */
  producePrice(monthsElapsed: number): number {
    const t = (monthsElapsed % PRODUCE_PERIOD_MONTHS) / PRODUCE_PERIOD_MONTHS;
    const primary = Math.sin(t * Math.PI * 2 + Math.PI);
    const secondary = Math.sin(t * Math.PI * 4 + 0.7) * 0.20;
    return 1.0 + PRODUCE_AMP * (primary + secondary);
  }
}
