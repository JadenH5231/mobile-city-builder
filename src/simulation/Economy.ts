import type { Grid } from '../world/Grid';
import type { Population } from './Population';
import { BUILDING_UPKEEP, ROAD_TIER, type Building, type Zone } from '../types';

/** Real-time milliseconds per simulated month. ~3 months/min on a stable tab. */
const MONTH_MS = 20_000;

/**
 * Tax sweet spots — at these rates the demand penalty is zero. Below: small
 * boost to demand (good for kickstarting growth, bad for revenue). Above:
 * demand drag (citizens grumble, growth slows). Memory:
 * feedback_challenge_tuning — these are the levers, money has to feel tight.
 */
const TAX_SWEET: Record<Exclude<Zone, 'none'>, number> = {
  residential: 9,
  commercial: 10,
  industrial: 11,
  // Mixed-use sits between R and C — citizens AND merchants in the same
  // tile, both averaged.
  mixed: 9.5
};
const TAX_PENALTY_DENOMINATOR = 30;

/**
 * Revenue coefficients — `residents * taxR * REV_PER_RESIDENT` etc.
 *
 * Memory: feedback_challenge_tuning (post-alpha pass 2). Cut to ~50% of the
 * pass-1 values because per-capita revenue scaled linearly with pop while
 * expenses didn't, leaving high-pop cities trivially cash-positive (a 1500-pop
 * city was banking $30K+/month on default taxes).
 */
const REV_PER_RESIDENT = 1.0;
const REV_PER_C_JOB = 1.25;
const REV_PER_I_JOB = 1.13;

/**
 * Per-edge monthly road maintenance is now tier-dependent (post-alpha pass 4):
 * see `ROAD_TIER[type].maintenance`. Local = $15, avenue = $25, highway =
 * $40. Mixed-tier edges are charged the average of both endpoints.
 */

/**
 * Per-capita "city services" expense — generic services we don't model as
 * buildings (trash, fire, admin). Effective rate per resident is
 * `BASE + totalResidents / 1000 * GROWTH`, so:
 *   100 residents → $2.1/resident → $210/mo
 *   500 residents → $2.5/resident → $1,250/mo
 *  1500 residents → $3.5/resident → $5,250/mo
 *  3000 residents → $5.0/resident → $15,000/mo
 *
 * The growth term is what creates the real squeeze at scale — pop alone now
 * generates expenses, not just infrastructure. Memory:
 * feedback_challenge_tuning (post-alpha pass 2).
 */
const SERVICES_BASE_PER_RESIDENT = 2;
const SERVICES_GROWTH_PER_1K = 1;

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
  /** Last completed month's accident-related expense (for budget breakdown). */
  lastAccidentCost = 0;
  /** Number of crashes during the current (in-progress) month. */
  accidentsThisMonth = 0;
  /** Total accidents across the lifetime of the city — for HUD / stats. */
  totalAccidents = 0;

  private accumulatorMs = 0;
  /** Accident cost accruing during the current month, settled at month rollover. */
  private monthAccidentCost = 0;

  tick(stepMs: number, grid: Grid, population: Population): void {
    this.accumulatorMs += stepMs;
    while (this.accumulatorMs >= MONTH_MS) {
      this.accumulatorMs -= MONTH_MS;
      this.runMonth(grid, population);
    }
  }

  /**
   * Apply a crash penalty: deduct the per-incident treasury cost immediately,
   * and accrue toward this month's "lost revenue from accidents" line.
   * Caller (Game) is responsible for any per-tile demand penalty.
   */
  recordCrash(treasuryHit: number): void {
    this.treasury -= treasuryHit;
    this.monthAccidentCost += treasuryHit;
    this.accidentsThisMonth++;
    this.totalAccidents++;
  }

  private runMonth(grid: Grid, population: Population): void {
    const revenue =
      population.totalResidents * this.taxR * REV_PER_RESIDENT +
      population.totalCommercialJobs * this.taxC * REV_PER_C_JOB +
      population.totalIndustrialJobs * this.taxI * REV_PER_I_JOB;

    // Tier-aware road maintenance — local $15, avenue $25, highway $40.
    // Charge the average of the two endpoints' tier so a mixed-tier edge
    // (e.g. on/off ramp) doesn't get a free pass.
    let edgeMaint = 0;
    for (const e of grid.iterRoadEdges()) {
      const ta = grid.get(e.ax, e.ay);
      const tb = grid.get(e.bx, e.by);
      const ma = ROAD_TIER[ta?.roadType ?? 'local'].maintenance;
      const mb = ROAD_TIER[tb?.roadType ?? 'local'].maintenance;
      edgeMaint += (ma + mb) / 2;
    }

    let expenses = edgeMaint;
    for (const t of grid.iter()) {
      if (t.building === 'none') continue;
      expenses += BUILDING_UPKEEP[t.building as Exclude<Building, 'none'>] ?? 0;
    }
    // Per-capita services with mild quadratic growth — see constants above.
    const ratePerResident =
      SERVICES_BASE_PER_RESIDENT +
      (population.totalResidents / 1000) * SERVICES_GROWTH_PER_1K;
    expenses += population.totalResidents * ratePerResident;

    const netRevenue = Math.round(revenue);
    const netExpenses = Math.round(expenses);
    // Accident cost was already deducted from treasury in recordCrash —
    // here we just surface it for the budget panel breakdown.
    this.treasury += netRevenue - netExpenses;
    this.lastRevenue = netRevenue;
    this.lastExpenses = netExpenses;
    this.lastAccidentCost = Math.round(this.monthAccidentCost);
    this.monthAccidentCost = 0;
    this.accidentsThisMonth = 0;
    this.monthsElapsed++;
  }

  /**
   * Demand penalty for a zone, applied by Population. Zero at the sweet spot,
   * positive (= demand drag) above it, negative (= demand boost) below it.
   */
  taxDemandPenalty(zone: Exclude<Zone, 'none'>): number {
    const rate =
      zone === 'residential' ? this.taxR :
      zone === 'commercial' ? this.taxC :
      zone === 'industrial' ? this.taxI :
      // Mixed-use trips bear the average of R + C tax pressure.
      (this.taxR + this.taxC) / 2;
    return (rate - TAX_SWEET[zone]) / TAX_PENALTY_DENOMINATOR;
  }
}
