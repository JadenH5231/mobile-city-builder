import type { Grid } from '../world/Grid';
import type { Economy } from './Economy';
import type { Traffic } from './Traffic';
import {
  COMMERCIAL_JOBS,
  INDUSTRIAL_JOBS,
  RESIDENT_CAPACITY,
  type Zone
} from '../types';

/**
 * Per-zone traffic-stress demand penalty multipliers. Memory:
 * feedback_traffic_pressure — R is most sensitive (people relocate),
 * C next (shoppers don't bother), I is most resilient (factories don't move
 * because of one bad commute).
 */
const STRESS_PENALTY: Record<Exclude<Zone, 'none'>, number> = {
  residential: 0.7,
  commercial: 0.55,
  industrial: 0.25
};

/**
 * Aggregates resident / job totals from per-tile densities and derives the
 * three RCI demand values that drive `Development`. Demand is a balance between
 * supply (what's already built) and absorbing capacity (jobs vs people, etc.),
 * shifted by tax rates and traffic stress.
 *
 * Demand domain: [-1, 1]. Negative means surplus; positive means a real pull.
 * Memory: feedback_density_curve — formulas widened with bias terms so a fresh
 * city actually grows from zero, and the rate curve uses sqrt() so weak
 * positive demand still produces visible growth.
 */
export class Population {
  totalResidents = 0;
  totalCommercialJobs = 0;
  totalIndustrialJobs = 0;
  demandR = 0;
  demandC = 0;
  demandI = 0;

  tick(grid: Grid, economy: Economy, traffic: Traffic): void {
    let residents = 0;
    let cJobs = 0;
    let iJobs = 0;
    for (const t of grid.iter()) {
      if (t.zone === 'none' || t.density === 0 || t.road) continue;
      switch (t.zone) {
        case 'residential':
          residents += RESIDENT_CAPACITY[t.density] ?? 0;
          break;
        case 'commercial':
          cJobs += COMMERCIAL_JOBS[t.density] ?? 0;
          break;
        case 'industrial':
          iJobs += INDUSTRIAL_JOBS[t.density] ?? 0;
          break;
      }
    }
    this.totalResidents = residents;
    this.totalCommercialJobs = cJobs;
    this.totalIndustrialJobs = iJobs;

    // Base demand formulas. Bias terms (+20, +2, +5) bootstrap an empty city
    // so freshly-painted zones have something to grow from. Denominators tune
    // sensitivity — bigger denominator = more residents/jobs needed to move
    // the needle.
    let r = (iJobs + cJobs - residents + 20) / 50;
    let c = (residents / 4 - cJobs + 2) / 15;
    let i = (residents / 2 - iJobs + 5) / 25;

    // Tax penalty — pulled from Economy so the BudgetPanel sliders move demand
    // in real time as the player drags.
    r -= economy.taxDemandPenalty('residential');
    c -= economy.taxDemandPenalty('commercial');
    i -= economy.taxDemandPenalty('industrial');

    // Traffic stress penalty.
    const stress = traffic.overallStress(grid);
    r -= stress * STRESS_PENALTY.residential;
    c -= stress * STRESS_PENALTY.commercial;
    i -= stress * STRESS_PENALTY.industrial;

    this.demandR = clamp(r, -1, 1);
    this.demandC = clamp(c, -1, 1);
    this.demandI = clamp(i, -1, 1);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
