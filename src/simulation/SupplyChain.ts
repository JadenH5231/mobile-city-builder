/**
 * Supply Chain (Beta 1.6). Layered on top of the existing 1.5 freight
 * truck system. Commercial buildings now hold a per-tile `supplies`
 * inventory in [0, 1]:
 *
 *   - Supplies tick DOWN each sim month (consumption).
 *   - Truck arrivals REFILL supplies (delivery).
 *   - Commercial revenue scales with the city-wide supply level —
 *     tiles at 0 supplies generate no commercial tax revenue at all,
 *     tiles served only by outside imports take a -25% penalty.
 *
 * Supply sources, in order of preference:
 *
 *   1. Industry → Warehouse → Commercial (most efficient, biggest payload)
 *   2. Industry → Commercial (direct, smaller payload, works without
 *      any warehouse)
 *   3. Outside-connection → Commercial (import truck from city edge,
 *      -25% revenue penalty applied to that tile)
 *
 * The truck routing logic lives in `Vehicles.attemptTruckSpawn` (see
 * Beta 1.6 changes there); this module owns the per-tile state +
 * monthly consumption + revenue-multiplier math.
 *
 * Warehouse tiles ALSO carry a supplies value — it's their internal
 * buffer (filled by industry-→-warehouse trucks, drained by warehouse-
 * →-commercial trucks). A warehouse with 0 supplies stops dispatching
 * outbound trucks until its next industrial restock.
 */

import type { Grid } from '../world/Grid';
import type { Tile } from '../world/Tile';

/** Per-month supply consumption rate on developed commercial tiles.
 *  At 0.18, a fully-stocked tile (supplies = 1.0) runs dry after ~5.5
 *  months without resupply — enough buffer that a temporary truck
 *  shortage isn't an immediate revenue cliff, but a chronic industry
 *  deficit will starve the commercial layer in under half a year. */
const MONTHLY_CONSUMPTION = 0.18;

/** Per-month consumption on warehouse tiles (slower than commercial —
 *  warehouses are buffers, they bleed into delivery trucks not direct
 *  customer demand). */
const WAREHOUSE_CONSUMPTION = 0.08;

/** Truck-delivery payloads (each fills this fraction of the destination
 *  tile's supplies, clamped to 1). Tuned so that ONE direct industrial
 *  truck doesn't fully refill a tile (forces sustained traffic to keep
 *  supplies high), but a warehouse delivery is meaningfully more
 *  efficient than direct industrial. */
export const PAYLOAD_INDUSTRY_DIRECT = 0.35;
export const PAYLOAD_WAREHOUSE_TO_C = 0.55;
export const PAYLOAD_INDUSTRY_TO_W = 0.50;
export const PAYLOAD_IMPORT = 0.40;

/** Revenue multiplier when the most recent delivery to a commercial
 *  tile came from an outside-connection import. -25% — imports keep
 *  the store open but cost the city margin. Cleared on next domestic
 *  delivery. */
export const IMPORT_REVENUE_MULTIPLIER = 0.75;

/** Source-kind passed to `deliver()` so the SupplyChain knows whether
 *  this delivery counts as an "import" (penalty applies) or domestic
 *  (penalty cleared). */
export type DeliverySource = 'industry-direct' | 'warehouse' | 'import' | 'industry-to-warehouse';

/** Returned from `commercialSupplyState` — used by Economy.ts to scale
 *  the totalCommercialJobs-based revenue line. `multiplier` is the
 *  ratio of (supply-weighted jobs / total jobs); 1.0 = perfectly
 *  stocked, 0.0 = every commercial tile is out of stock. */
export interface SupplyChainState {
  /** Effective commercial revenue multiplier in [0, 1]. */
  multiplier: number;
  /** Average supply level across developed commercial tiles in [0, 1].
   *  For UI / debug. NaN if there are no commercial tiles. */
  averageSupplies: number;
  /** Fraction of commercial jobs currently served only by outside
   *  imports — these tiles take the IMPORT_REVENUE_MULTIPLIER penalty. */
  importedFraction: number;
}

export class SupplyChain {
  /**
   * Apply monthly consumption to every developed commercial tile +
   * every warehouse tile. Called from Game.runMonth. Idempotent per
   * month — each call decrements supplies by the configured rate.
   *
   * Also clears the `importSource` flag on tiles that hit zero, so
   * they don't keep the penalty stuck once they're refilled.
   */
  tickMonth(grid: Grid): void {
    for (const t of grid.iter()) {
      if (this.isCommercialConsumer(t)) {
        t.supplies = Math.max(0, t.supplies - MONTHLY_CONSUMPTION);
        if (t.supplies === 0) {
          // Out of stock — clear the import flag so the next delivery
          // (whatever its source) resets the penalty state cleanly.
          t.importSource = false;
        }
      } else if (t.building === 'warehouse') {
        t.supplies = Math.max(0, t.supplies - WAREHOUSE_CONSUMPTION);
      }
    }
  }

  /**
   * Refill supplies on a tile when a truck arrives. Called from
   * Vehicles.update at the end-of-path branch.
   *
   * Behaviour by source:
   *   - 'industry-direct'  → top up commercial tile, clear import flag
   *   - 'warehouse'        → top up commercial tile, clear import flag
   *   - 'import'           → top up commercial tile, SET import flag
   *   - 'industry-to-warehouse' → top up warehouse tile (no flag)
   *
   * Tiles that aren't valid receivers for the given source (e.g. an
   * import truck arriving at an industrial tile) are silently
   * ignored — keeps the contract loose so the truck logic doesn't
   * have to know exact tile types at call time.
   */
  deliver(grid: Grid, tileX: number, tileY: number, source: DeliverySource): void {
    const t = grid.get(tileX, tileY);
    if (!t) return;
    let payload = 0;
    switch (source) {
      case 'industry-direct':
        if (!this.isCommercialConsumer(t)) return;
        payload = PAYLOAD_INDUSTRY_DIRECT;
        t.importSource = false;
        break;
      case 'warehouse':
        if (!this.isCommercialConsumer(t)) return;
        payload = PAYLOAD_WAREHOUSE_TO_C;
        t.importSource = false;
        break;
      case 'import':
        if (!this.isCommercialConsumer(t)) return;
        payload = PAYLOAD_IMPORT;
        t.importSource = true;
        break;
      case 'industry-to-warehouse':
        if (t.building !== 'warehouse') return;
        payload = PAYLOAD_INDUSTRY_TO_W;
        break;
    }
    t.supplies = Math.min(1, t.supplies + payload);
  }

  /**
   * Compute the city-wide effective commercial revenue multiplier.
   * Called from Economy.runMonth — the `multiplier` value is folded
   * into the existing `population.totalCommercialJobs *
   * REV_PER_C_JOB * ...` line.
   *
   * Weighting: each commercial tile's "supply contribution" is its
   * supplies value (0..1) × its import-penalty multiplier (0.75 if
   * import-sourced, 1.0 otherwise) × its commercial-jobs count. We
   * then divide by the sum of jobs to get a single per-job
   * multiplier the existing revenue formula can use.
   */
  commercialSupplyState(grid: Grid): SupplyChainState {
    let weightedJobs = 0;
    let totalJobs = 0;
    let supplySum = 0;
    let supplyCount = 0;
    let importedJobs = 0;
    for (const t of grid.iter()) {
      if (!this.isCommercialConsumer(t)) continue;
      const jobs = jobsOnTile(t);
      if (jobs <= 0) continue;
      const importMult = t.importSource ? IMPORT_REVENUE_MULTIPLIER : 1.0;
      weightedJobs += jobs * t.supplies * importMult;
      totalJobs += jobs;
      supplySum += t.supplies;
      supplyCount += 1;
      if (t.importSource) importedJobs += jobs;
    }
    if (totalJobs === 0) {
      return { multiplier: 1.0, averageSupplies: NaN, importedFraction: 0 };
    }
    return {
      multiplier: weightedJobs / totalJobs,
      averageSupplies: supplyCount > 0 ? supplySum / supplyCount : NaN,
      importedFraction: importedJobs / totalJobs
    };
  }

  /** True if this tile counts as a "commercial consumer" for the
   *  supply chain. Includes developed C and MU zoning plus the
   *  big_box building (a single-tile retail destination). */
  isCommercialConsumer(t: Tile): boolean {
    if (t.building === 'big_box') return true;
    if (t.density === 0) return false;
    return t.zone === 'commercial' || t.zone === 'mixed';
  }

  /** Reset all supply state — called on new city / save load to a
   *  clean slate. Existing saves load with supplies=1 by default
   *  (set in Tile.ts), so a v28 save loaded post-1.6 starts
   *  fully-stocked and ticks down naturally. */
  clear(grid: Grid): void {
    for (const t of grid.iter()) {
      if (this.isCommercialConsumer(t) || t.building === 'warehouse') {
        t.supplies = 1;
        t.importSource = false;
      }
    }
  }
}

/** Rough per-tile commercial-jobs count (mirrors the per-density
 *  values in Population.ts but kept local to avoid the cross-module
 *  import). big_box tiles contribute 3 jobs each (low-margin retail). */
function jobsOnTile(t: Tile): number {
  if (t.building === 'big_box') return 3;
  if (t.zone === 'commercial') {
    return t.density === 1 ? 4 : t.density === 2 ? 12 : t.density === 3 ? 30 : t.density === 4 ? 60 : 0;
  }
  if (t.zone === 'mixed') {
    // Half-rate commercial jobs on MU (the other half is residents).
    return t.density === 1 ? 2 : t.density === 2 ? 6 : t.density === 3 ? 15 : t.density === 4 ? 30 : 0;
  }
  return 0;
}
