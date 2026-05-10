import type { Economy } from './Economy';
import type { Population } from './Population';
import type { Happiness } from './Happiness';

/**
 * One historical sample — captured at every month boundary.
 * All values are coarse rounded so the JSON save stays small.
 */
export interface StatsSample {
  month: number;
  population: number;
  treasury: number;
  revenue: number;
  expenses: number;
  /** Mean faction happiness in [-1, +1]. */
  mood: number;
  /** RCI demand at sample time, [-1, +1]. */
  demandR: number;
  demandC: number;
  demandI: number;
  /** Forestry + farm export revenue this month. */
  exportRevenue: number;
}

/** Persisted shape — just the buffer + capacity. */
export interface StatsSnapshot {
  capacity: number;
  samples: readonly StatsSample[];
}

/**
 * Time-series stats buffer (Alpha 2.11). One sample per sim month;
 * ring-buffer with a cap so a long-running city stays bounded.
 *
 * Design tenets:
 *  - Sampling is cheap (a handful of getter reads) and fires from the
 *    monthly tick block in Game.
 *  - Rendering is the StatsPanel's job — Stats just owns the data.
 *  - Save schema persists the buffer so the graph survives a reload.
 */
export class Stats {
  /** Hard cap on samples — 240 months = 20 years of in-game history. */
  static readonly DEFAULT_CAPACITY = 240;
  capacity: number = Stats.DEFAULT_CAPACITY;
  /** Newest sample is the last element. Drops the oldest when full. */
  readonly samples: StatsSample[] = [];

  /** Capture a sample. Caller decides cadence (we expect monthly). */
  capture(
    month: number, economy: Economy, population: Population, happiness: Happiness
  ): void {
    const exportRev = (economy.lastForestryRevenue ?? 0) + (economy.lastFarmRevenue ?? 0);
    const sample: StatsSample = {
      month,
      population: Math.round(population.totalResidents),
      treasury: Math.round(economy.treasury),
      revenue: economy.lastRevenue,
      expenses: economy.lastExpenses,
      mood: round2(happiness.overall()),
      demandR: round2(population.demandR),
      demandC: round2(population.demandC),
      demandI: round2(population.demandI),
      exportRevenue: exportRev
    };
    this.samples.push(sample);
    while (this.samples.length > this.capacity) this.samples.shift();
  }

  serialize(): StatsSnapshot {
    return { capacity: this.capacity, samples: this.samples.map((s) => ({ ...s })) };
  }
  restore(snap?: StatsSnapshot): void {
    this.samples.length = 0;
    if (!snap) return;
    this.capacity = snap.capacity || Stats.DEFAULT_CAPACITY;
    for (const s of snap.samples) this.samples.push({ ...s });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
