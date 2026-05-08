import type { Grid } from '../world/Grid';

const EMA_DECAY = 0.92;
const EMA_UPDATE = 0.08;

/**
 * Stress saturates to 1 once average load reaches this value. Memory:
 * feedback_traffic_pressure — sustained traffic should actively drag demand,
 * not just be a vibe. Tightened from 1.5 to 0.8 in the post-alpha tuning pass.
 */
const STRESS_SATURATION = 0.8;

/**
 * Per-tile traffic load EMA + city-wide stress aggregate.
 *
 * `Tile.trafficLoad` is the instantaneous count of cars currently sitting on
 * a tile (Vehicles increments it on segment-cross / spawn and decrements on
 * despawn). `Tile.trafficLoadAvg` is the smoothed signal we actually feed to
 * the demand model and the heatmap — without smoothing, the heatmap would
 * strobe with each car.
 */
export class Traffic {
  tickEma(grid: Grid): void {
    for (const t of grid.iter()) {
      if (!t.road && t.trafficLoadAvg === 0) continue;
      t.trafficLoadAvg = t.trafficLoadAvg * EMA_DECAY + t.trafficLoad * EMA_UPDATE;
    }
  }

  /** City-wide stress in [0, 1]. Mean of road-tile EMAs, saturated. */
  overallStress(grid: Grid): number {
    let sum = 0;
    let count = 0;
    for (const t of grid.iter()) {
      if (!t.road) continue;
      sum += t.trafficLoadAvg;
      count++;
    }
    if (count === 0) return 0;
    const avg = sum / count;
    return Math.min(1, avg / STRESS_SATURATION);
  }
}
