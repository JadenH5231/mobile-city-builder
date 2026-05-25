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

/** Per-month supply consumption rate on developed commercial tiles —
 *  baseline. Beta 1.6.4 made this softer (was 0.18) AND added per-tile
 *  jitter so different stores hit empty at staggered times instead of
 *  every commercial tile drying up on the same month. Net effect: a
 *  fully-stocked tile lasts ~7-12 sim months on the consumption
 *  curve, never less than ~5. */
const MONTHLY_CONSUMPTION_BASE = 0.10;
/** Per-tile jitter window. Final consumption rate per tile =
 *  BASE + (deterministic hash of tile coords) × JITTER. Range
 *  [0.10, 0.18]. The tile-hash keeps it stable across save/load —
 *  the same tile drains at the same rate every month. */
const MONTHLY_CONSUMPTION_JITTER = 0.08;

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

/** Beta 1.6.4 — "Purchase order" threshold. When a commercial tile's
 *  supplies dip below this value, it joins the city-wide priority
 *  queue that `Vehicles.attemptTruckSpawn` consults FIRST. So a store
 *  at 50% supplies will get a delivery dispatched proactively, well
 *  before it hits zero. The previous behaviour (random destination
 *  rolling) effectively only restocked tiles by chance, which meant
 *  some unlucky tiles starved while others sat at near-full. */
export const RESTOCK_REQUEST_THRESHOLD = 0.55;

/** Per-tile consumption rate, deterministically jittered from tile
 *  coords so different stores drain at staggered rates. Cheap
 *  bit-mix hash → fraction in [0, 1] → scaled to JITTER. */
function consumptionRate(x: number, y: number): number {
  const h = ((x * 374761393) ^ (y * 668265263)) >>> 0;
  const frac = (h & 0xffff) / 0xffff;     // [0, 1]
  return MONTHLY_CONSUMPTION_BASE + frac * MONTHLY_CONSUMPTION_JITTER;
}

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
        // Beta 1.6.4 — per-tile jittered consumption. Different stores
        // hit empty at staggered times instead of all dropping
        // together.
        const rate = consumptionRate(t.x, t.y);
        t.supplies = Math.max(0, t.supplies - rate);
        if (t.supplies === 0) {
          t.importSource = false;
        }
      } else if (t.building === 'warehouse') {
        t.supplies = Math.max(0, t.supplies - WAREHOUSE_CONSUMPTION);
      }
    }
  }

  /**
   * Beta 1.6.4 — list of commercial tiles that have dropped below the
   * "purchase order" threshold and should be prioritised by the next
   * truck dispatch. The truck spawn picker consults this BEFORE doing
   * a random pick, so a store at 50% supplies gets a delivery
   * proactively — they have a real chance of being restocked before
   * they hit zero.
   *
   * Reservoir-sampled to keep the call O(grid) per spawn. Returns up
   * to one tile per call (truck spawn only routes one truck at a time
   * anyway). When no tile is below the threshold, returns null and
   * the truck spawn falls through to its random pick.
   */
  pickRestockNeedingCommercialTile(grid: Grid): { x: number; y: number } | null {
    let chosen: { x: number; y: number } | null = null;
    let chosenSupplies = Infinity;
    let count = 0;
    for (const t of grid.iter()) {
      if (!this.isCommercialConsumer(t)) continue;
      if (t.supplies >= RESTOCK_REQUEST_THRESHOLD) continue;
      // Weighted-reservoir: prefer LOWER-supply tiles (more urgent).
      // Each candidate has weight = (1 - supplies); near-empty tiles
      // are much more likely to win. Tie-breaks favour lower supplies
      // explicitly via chosenSupplies comparison.
      const weight = 1 - t.supplies;
      count += weight;
      if (Math.random() * count < weight || t.supplies < chosenSupplies) {
        chosen = { x: t.x, y: t.y };
        chosenSupplies = t.supplies;
      }
    }
    return chosen;
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
