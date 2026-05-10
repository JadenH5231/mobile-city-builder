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
/** Pressure required to promote from L0→L1, L1→L2, L2→L3, L3→L4 (Max).
 *  L3→L4 is steeper because Max is the top tier — same service
 *  requirements as L3 (Alpha 3.2.5). */
const PROMOTION_THRESHOLDS: readonly number[] = [0.4, 0.7, 2.5, 4.0];
/** Services-allowed cap when power+water+park aren't all present. L3 (and
 *  Max) is the service-gated payoff *if the player also zoned for that
 *  density*. */
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

  /**
   * @param monthsElapsed Current sim-month counter from Economy. Stamped into
   *   `t.developedAt` the first time a tile sprouts (density 0 → 1) so the
   *   Renderer can age the building visually.
   * @returns true iff at least one tile's density changed this tick.
   */
  tick(grid: Grid, monthsElapsed: number = 0): boolean {
    let changed = false;
    // Track tiles that just hit density 4 — used after the main pass to
    // probe for 2×2 Max clusters and trigger skyscraper conversion.
    const justHitMax: Array<{ x: number; y: number }> = [];
    for (const t of grid.iter()) {
      if (t.zone === 'none' || t.road || t.building !== 'none') continue;
      // Skyscraper tiles run their own construction pipeline — skip the
      // normal density growth here so we don't double-count.
      if (t.skyscraper) continue;
      const demand = this.demandFor(t.zone);
      // Effective max = min(player's zoning permission, services allow). The
      // player gates the upper bound; services still gate L3 + Max
      // specifically. Industrial caps at L3 — there's no Max Industrial
      // (skyscraper concept is R/C/MU only).
      const baseServicesCap = t.hasPower && t.hasWater && t.hasPark ? MAX_DENSITY : SERVICES_CAP_WITHOUT_PARK;
      const servicesCap = t.zone === 'industrial' ? Math.min(3, baseServicesCap) : baseServicesCap;
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
        const wasEmpty = t.density === 0;
        t.density++;
        t.developmentPressure = 0;
        if (wasEmpty) t.developedAt = monthsElapsed;
        if (t.density === 4) justHitMax.push({ x: t.x, y: t.y });
        changed = true;
      }
    }

    // Skyscraper conversion (Alpha 3.2.5): when a tile reaches density 4,
    // check the four 2×2 footprints that include it. If any 2×2 has all
    // four tiles at density 4 with the same R/C/MU zone (and none are
    // already a skyscraper), convert all four into a skyscraper start
    // (stage 0). The Skyscrapers sim ticks the stage forward monthly.
    for (const p of justHitMax) {
      // The 2×2 origins that include (p.x, p.y) — i.e. p is one corner.
      const origins: Array<[number, number]> = [
        [p.x, p.y], [p.x - 1, p.y], [p.x, p.y - 1], [p.x - 1, p.y - 1]
      ];
      for (const [ox, oy] of origins) {
        if (this.tryConvertToSkyscraper(grid, ox, oy, monthsElapsed)) {
          changed = true;
          break; // tile is now part of a skyscraper, no need to keep checking
        }
      }
    }
    return changed;
  }

  /** If the 2×2 starting at (ox, oy) is fully L4 with the same R/C/MU
   *  zone and none of the four are already a skyscraper, convert all
   *  four into a skyscraper-construction site (stage 0). Returns true
   *  iff the conversion fired. */
  private tryConvertToSkyscraper(grid: Grid, ox: number, oy: number, monthsElapsed: number): boolean {
    const tiles = [
      grid.get(ox, oy),
      grid.get(ox + 1, oy),
      grid.get(ox, oy + 1),
      grid.get(ox + 1, oy + 1)
    ];
    for (const t of tiles) {
      if (!t) return false;
      if (t.density < 4) return false;
      if (t.skyscraper) return false;
      if (t.zone !== tiles[0]!.zone) return false;
      if (t.zone !== 'residential' && t.zone !== 'commercial' && t.zone !== 'mixed') return false;
    }
    // Pick a deterministic variant from the anchor coord (lex-smallest tile)
    // so the same physical 2×2 always picks the same design across saves.
    const variant = (Math.abs(ox * 73856093) ^ Math.abs(oy * 19349663)) % 8 as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    for (const t of tiles) {
      if (!t) continue;
      t.skyscraper = true;
      t.skyscraperStage = 0;
      t.skyscraperVariant = variant;
      // Density goes back to 0 during construction — Population's Mega/Twin
      // contribution stops, the skyscraper-stage-4 contribution kicks in
      // when construction completes.
      t.density = 0;
      t.developmentPressure = 0;
      t.developedAt = monthsElapsed;
    }
    return true;
  }

  private demandFor(zone: Zone): number {
    switch (zone) {
      case 'residential': return this.population.demandR;
      case 'commercial': return this.population.demandC;
      case 'industrial': return this.population.demandI;
      // Mixed-use grows on the average of R + C demand — a healthy
      // mixed-use tile needs both housing AND commercial pull.
      case 'mixed': return (this.population.demandR + this.population.demandC) / 2;
      default: return 0;
    }
  }
}
