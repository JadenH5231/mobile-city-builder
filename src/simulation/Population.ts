import type { Grid } from '../world/Grid';
import type { Economy } from './Economy';
import type { Traffic } from './Traffic';
import { FACTION_NATURAL_SHARE, type FactionId, type Happiness } from './Happiness';
import type { Council } from './Council';
import {
  COMMERCIAL_JOBS,
  INDUSTRIAL_JOBS,
  LUXURY_RESIDENT_CAPACITY_PER_TILE,
  MIXED_COMMERCIAL_JOBS,
  MIXED_RESIDENT_CAPACITY,
  RESIDENT_CAPACITY,
  type Zone
} from '../types';

/**
 * Faction shares for luxury-low residents (Alpha 2.5). Sums to ~1.0.
 * Heavily biased toward NIMBYs / hometown / taxpayers — luxury homes
 * attract a different demographic than regular R. Working-families and
 * yimbys get crumbs because they don't WANT a mansion.
 */
const LUXURY_FACTION_SHARE: Record<FactionId, number> = {
  nimbys: 0.30,
  hometown: 0.20,
  taxpayers: 0.18,
  chamber: 0.10,
  drivers: 0.08,
  safer_streets: 0.06,
  environmentalists: 0.04,
  working_families: 0.02,
  yimbys: 0.01,
  transit: 0.01
};

/**
 * Per-zone traffic-stress demand penalty multipliers. Memory:
 * feedback_traffic_pressure — R is most sensitive (people relocate),
 * C next (shoppers don't bother), I is most resilient (factories don't move
 * because of one bad commute).
 */
const STRESS_PENALTY: Record<Exclude<Zone, 'none'>, number> = {
  residential: 0.7,
  commercial: 0.55,
  industrial: 0.25,
  // Mixed-use takes the average of R and C — half its tile is each.
  mixed: 0.625
};

/**
 * Per-tick lerp rate for faction populations toward their happiness-derived
 * targets. At 10 Hz tick rate, 0.03 per tick ≈ 30%/sec convergence — fast
 * enough that the player sees response within seconds of changing zoning,
 * slow enough that it reads as "people moving in/out" rather than a snap.
 */
const FACTION_POP_LERP = 0.03;

/**
 * Aggregates resident / job totals from per-tile densities and derives the
 * three RCI demand values that drive `Development`. Demand is a balance between
 * supply (what's already built) and absorbing capacity (jobs vs people, etc.),
 * shifted by tax rates and traffic stress.
 *
 * Faction populations (Alpha 1.2): each tick, R-tile capacity is split across
 * the 10 factions according to their natural share × willingness, where
 * willingness = clamp(1 + happiness, 0, 1). A faction at -1 happiness empties
 * out (target = 0); at 0 or above it stays at full natural share. Each
 * faction's actual count lerps toward its target so population shifts feel
 * gradual. `totalResidents` is the sum — so happiness directly affects city
 * population, which affects tax revenue, vehicle spawn, and demand-R.
 *
 * Demand domain: [-1, 1]. Negative means surplus; positive means a real pull.
 */
export class Population {
  totalResidents = 0;
  totalCommercialJobs = 0;
  totalIndustrialJobs = 0;
  demandR = 0;
  demandC = 0;
  demandI = 0;

  /** Maximum residents the built R buildings could hold if every faction
   *  was fully happy. Useful for "city is X% occupied" displays. */
  capacity = 0;

  /**
   * Subset of `totalResidents` that lives in luxury low-density homes
   * (Alpha 2.5). Read by Economy to apply the LUXURY_TAX_BONUS premium
   * on top of base R tax revenue.
   */
  luxuryResidents = 0;

  /**
   * Per-faction current population. Sum equals `totalResidents`. Floating-
   * point because the lerp passes through fractions; round when displaying.
   */
  readonly factionPopulation = new Map<FactionId, number>();

  constructor() {
    for (const id of Object.keys(FACTION_NATURAL_SHARE) as FactionId[]) {
      this.factionPopulation.set(id, 0);
    }
  }

  tick(
    grid: Grid, economy: Economy, traffic: Traffic, happiness: Happiness, council: Council,
    events?: import('./Events').Events
  ): void {
    // Capacity = how many residents the built buildings COULD hold; jobs =
    // built C / I jobs. Same pattern as before for jobs.
    // Luxury capacity (Alpha 2.5) is tracked separately so we can split
    // faction-share targeting into "regular" vs "luxury" buckets.
    let regularCapacity = 0;
    let luxuryCapacity = 0;
    let cJobs = 0;
    let iJobs = 0;
    for (const t of grid.iter()) {
      if (t.zone === 'none' || t.road) continue;
      // Luxury tiles count even at density 0 — they're permanent placement
      // (not demand-driven growth), so capacity is fixed per tile.
      if (t.luxury && t.zone === 'residential') {
        luxuryCapacity += LUXURY_RESIDENT_CAPACITY_PER_TILE;
        continue;
      }
      if (t.density === 0) continue;
      switch (t.zone) {
        case 'residential':
          regularCapacity += RESIDENT_CAPACITY[t.density] ?? 0;
          break;
        case 'commercial':
          cJobs += COMMERCIAL_JOBS[t.density] ?? 0;
          break;
        case 'industrial':
          iJobs += INDUSTRIAL_JOBS[t.density] ?? 0;
          break;
        case 'mixed':
          // Mixed-use: half-rate residents AND half-rate commercial jobs.
          regularCapacity += MIXED_RESIDENT_CAPACITY[t.density] ?? 0;
          cJobs += MIXED_COMMERCIAL_JOBS[t.density] ?? 0;
          break;
      }
    }
    const capacity = regularCapacity + luxuryCapacity;
    this.capacity = capacity;
    this.totalCommercialJobs = cJobs;
    this.totalIndustrialJobs = iJobs;

    // Lerp each faction's population toward (capacity × share × willingness × councilBoost).
    // Willingness: 0 → 1 as happiness goes from -1 → 0; clamped at 1 for
    // any positive happiness. So a happy or content faction stays at full
    // share; a furious one empties out. Councillors get +10% on their
    // faction's target, drawing from the pool — normalised so the sum of
    // all targets never exceeds capacity.
    let totalRawTarget = 0;
    const rawTargets = new Map<FactionId, number>();
    for (const id of Object.keys(FACTION_NATURAL_SHARE) as FactionId[]) {
      const h = happiness.get(id);
      const willingness = Math.max(0, Math.min(1, 1 + h));
      const boost = council.populationBoost(id);
      // Regular capacity uses each faction's natural share. Luxury capacity
      // overrides with LUXURY_FACTION_SHARE so a luxury home draws NIMBYs
      // and hometown disproportionately. Both still gate on willingness +
      // council boost since happiness gates everyone.
      const regularRaw = regularCapacity * FACTION_NATURAL_SHARE[id] * willingness * boost;
      const luxuryRaw = luxuryCapacity * LUXURY_FACTION_SHARE[id] * willingness * boost;
      const raw = regularRaw + luxuryRaw;
      rawTargets.set(id, raw);
      totalRawTarget += raw;
    }
    // If the boosts pushed total demand above capacity, scale every target
    // down proportionally so the city can't over-fill.
    const scale = totalRawTarget > capacity && capacity > 0 ? capacity / totalRawTarget : 1;

    let totalResidents = 0;
    for (const id of Object.keys(FACTION_NATURAL_SHARE) as FactionId[]) {
      const target = (rawTargets.get(id) ?? 0) * scale;
      const current = this.factionPopulation.get(id) ?? 0;
      const next = current + (target - current) * FACTION_POP_LERP;
      this.factionPopulation.set(id, next);
      totalResidents += next;
    }
    this.totalResidents = totalResidents;
    // Luxury residents = the share of totalResidents that lives in luxury
    // tiles. Approximated by (luxuryCapacity / capacity) * totalResidents
    // — exact enough for tax math; no need to track per-faction split.
    this.luxuryResidents = capacity > 0 ? totalResidents * (luxuryCapacity / capacity) : 0;

    // Base demand formulas. Bias terms (+20, +2, +5) bootstrap an empty city
    // so freshly-painted zones have something to grow from. Denominators tune
    // sensitivity — bigger denominator = more residents/jobs needed to move
    // the needle.
    let r = (iJobs + cJobs - totalResidents + 20) / 50;
    let c = (totalResidents / 4 - cJobs + 2) / 15;
    let i = (totalResidents / 2 - iJobs + 5) / 25;

    // Tax penalty — pulled from Economy so the BudgetPanel sliders move demand
    // in real time as the player drags.
    r -= economy.taxDemandPenalty('residential');
    c -= economy.taxDemandPenalty('commercial');
    i -= economy.taxDemandPenalty('industrial');
    // Wealth-surtax demand penalty (Alpha 2.18). Half-strength of base-tax
    // penalty since it only hits the L3 / luxury bracket — keeps the lever
    // useful but firmly impactful when cranked high.
    r -= economy.surtaxDemandPenalty('residential');
    c -= economy.surtaxDemandPenalty('commercial');

    // Traffic stress penalty.
    const stress = traffic.overallStress(grid);
    r -= stress * STRESS_PENALTY.residential;
    c -= stress * STRESS_PENALTY.commercial;
    i -= stress * STRESS_PENALTY.industrial;

    // Event-driven demand shifts (Alpha 2.9) — recessions push C demand
    // down, booms push everything up, etc. Sum into the per-zone demand
    // before clamping.
    if (events) {
      r += events.demandShiftFor('residential');
      c += events.demandShiftFor('commercial');
      i += events.demandShiftFor('industrial');
    }
    this.demandR = clamp(r, -1, 1);
    this.demandC = clamp(c, -1, 1);
    this.demandI = clamp(i, -1, 1);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
