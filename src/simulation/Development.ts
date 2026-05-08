import type { Grid } from '../world/Grid';
import type { Population } from './Population';
import { MAX_DENSITY, type Zone } from '../types';

/** Per-tick base accumulation rate. Modulated by demand + services. */
const BASE_RATE = 0.06;
/**
 * L0 floor — even with zero or negative demand, a freshly-zoned tile gets
 * this much pressure each tick so a starter building shows up. Without this,
 * an empty city with weak demand would never sprout. Memory:
 * feedback_density_curve.
 */
const L0_FLOOR = 0.3;
/** Pressure required to promote from L0→L1, L1→L2, L2→L3 respectively. */
const PROMOTION_THRESHOLDS: readonly number[] = [0.4, 0.7, 2.5];
/** Services-allowed cap when power+water+park aren't all present. L3 is the
 *  service-gated payoff *if the player also zoned for high density*. */
const SERVICES_CAP_WITHOUT_PARK = 2;
/** Penalty multiplier per missing utility. Cumulative — both missing → 0.09×. */
const MISSING_SERVICE_PENALTY = 0.3;

/**
 * Demand-driven density growth. Sweeps every zoned, non-road, non-built tile
 * each fixed-rate sim tick, accumulates pressure, promotes density when
 * thresholds are crossed.
 *
 * Reads aggregate demand from `Population`. Caller (Game) determines whether
 * any density actually changed via the boolean return so the renderer only
 * rebuilds the buildings InstancedMesh on demand.
 */
export class Development {
  constructor(private readonly population: Population) {}

  /** @returns true iff at least one tile's density changed this tick. */
  tick(grid: Grid): boolean {
    let changed = false;
    for (const t of grid.iter()) {
      if (t.zone === 'none' || t.road || t.building !== 'none') continue;
      const demand = this.demandFor(t.zone);
      // Effective max = min(player's zoning permission, services allow). The
      // player gates the upper bound; services still gate L3 specifically.
      const servicesCap = t.hasPower && t.hasWater && t.hasPark ? MAX_DENSITY : SERVICES_CAP_WITHOUT_PARK;
      const playerCap = t.zoneCap > 0 ? t.zoneCap : MAX_DENSITY;
      const cap = Math.min(playerCap, servicesCap);
      if (t.density >= cap) continue;

      // Concave rate curve so weak positive demand still grows visibly. L0
      // tiles get a floor so a freshly-painted cell always sprouts.
      let rate: number;
      if (demand > 0) rate = BASE_RATE * Math.sqrt(demand);
      else if (t.density === 0) rate = BASE_RATE * L0_FLOOR;
      else rate = 0;

      // Service penalties for occupied tiles only — L0 is allowed to sprout
      // before utilities are wired up so the player sees something happening.
      if (t.density > 0) {
        if (!t.hasPower) rate *= MISSING_SERVICE_PENALTY;
        if (!t.hasWater) rate *= MISSING_SERVICE_PENALTY;
      }

      if (rate <= 0) continue;
      t.developmentPressure += rate;
      const threshold = PROMOTION_THRESHOLDS[t.density] ?? Infinity;
      if (t.developmentPressure >= threshold && t.density < cap) {
        t.density++;
        t.developmentPressure = 0;
        changed = true;
      }
    }
    return changed;
  }

  private demandFor(zone: Zone): number {
    switch (zone) {
      case 'residential': return this.population.demandR;
      case 'commercial': return this.population.demandC;
      case 'industrial': return this.population.demandI;
      default: return 0;
    }
  }
}
