import type { Grid } from '../world/Grid';
import type { Population } from './Population';
import { BUILDING_UPKEEP, type Building, type Zone } from '../types';

/** Real-time milliseconds per simulated month. ~3 months/min on a stable tab. */
const MONTH_MS = 20_000;

/**
 * Tax sweet spots — at these rates the demand penalty is zero. Below: small
 * boost to demand (good for kickstarting growth, bad for revenue). Above:
 * demand drag (citizens grumble, growth slows). Memory:
 * feedback_challenge_tuning — these are the levers, money has to feel tight.
 */
const TAX_SWEET = {
  residential: 9,
  commercial: 10,
  industrial: 11
} as const;
const TAX_PENALTY_DENOMINATOR = 30;

/**
 * Revenue coefficients — `residents * taxR * REV_PER_RESIDENT` etc. At the
 * default rates this lands on roughly `$18/resident` and `$25/job` per month,
 * matching the post-alpha tuning numbers.
 */
const REV_PER_RESIDENT = 2;
const REV_PER_C_JOB = 2.5;
const REV_PER_I_JOB = 2.27;

/** Per-edge monthly road maintenance, in $. */
const ROAD_EDGE_MAINTENANCE = 12;

/**
 * Treasury, tax rates, monthly settlement. The settlement runs every
 * `MONTH_MS` of accumulated real-time inside `tick`, NOT every render frame —
 * keeps cadence stable across stutter or backgrounded tabs.
 *
 * All public fields here are part of the save game (see persistence/SaveGame).
 */
export class Economy {
  treasury = 15_000;
  taxR = 9;
  taxC = 10;
  taxI = 11;
  monthsElapsed = 0;
  /** Last completed month's totals — read by BudgetPanel. */
  lastRevenue = 0;
  lastExpenses = 0;

  private accumulatorMs = 0;

  tick(stepMs: number, grid: Grid, population: Population): void {
    this.accumulatorMs += stepMs;
    while (this.accumulatorMs >= MONTH_MS) {
      this.accumulatorMs -= MONTH_MS;
      this.runMonth(grid, population);
    }
  }

  private runMonth(grid: Grid, population: Population): void {
    const revenue =
      population.totalResidents * this.taxR * REV_PER_RESIDENT +
      population.totalCommercialJobs * this.taxC * REV_PER_C_JOB +
      population.totalIndustrialJobs * this.taxI * REV_PER_I_JOB;

    let expenses = grid.roadEdgeCount * ROAD_EDGE_MAINTENANCE;
    for (const t of grid.iter()) {
      if (t.building === 'none') continue;
      expenses += BUILDING_UPKEEP[t.building as Exclude<Building, 'none'>] ?? 0;
    }

    const netRevenue = Math.round(revenue);
    const netExpenses = Math.round(expenses);
    this.treasury += netRevenue - netExpenses;
    this.lastRevenue = netRevenue;
    this.lastExpenses = netExpenses;
    this.monthsElapsed++;
  }

  /**
   * Demand penalty for a zone, applied by Population. Zero at the sweet spot,
   * positive (= demand drag) above it, negative (= demand boost) below it.
   */
  taxDemandPenalty(zone: Exclude<Zone, 'none'>): number {
    const rate =
      zone === 'residential' ? this.taxR :
      zone === 'commercial' ? this.taxC : this.taxI;
    return (rate - TAX_SWEET[zone]) / TAX_PENALTY_DENOMINATOR;
  }
}
