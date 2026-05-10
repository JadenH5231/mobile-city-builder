import type { Grid } from '../world/Grid';
import type { Happiness } from './Happiness';

/**
 * Per-tile crime simulation (Alpha 2.21).
 *
 * Scores in [0, 1] computed monthly from a few easy-to-read inputs:
 *  - Density: high-density commercial + residential generate more crime
 *    surface area than low-density single-family.
 *  - Police coverage: tiles with hasPolice get a strong reduction.
 *  - Service coverage: tiles missing power/water/park push crime up.
 *  - Mood: city-wide unhappiness multiplies the baseline.
 *
 * The score backs three downstream signals:
 *  - Heatmap: rendered when the player toggles the Crime pill.
 *  - Aggregate score: an averaged + log-scaled number for the HUD.
 *  - Revenue penalty: each tile contributes a small commercial-revenue
 *    drag scaled by its crime score; reads in Economy.runMonth.
 *
 * Computed on demand (no per-tile state in Tile.ts) so the system stays
 * cheap to swap in or out and the save schema doesn't have to bump.
 * Each `recompute` is a single grid sweep — sub-millisecond on Small/Medium.
 */

const BASE_PER_DENSITY = [0, 0.04, 0.10, 0.20]; // L0..L3 baseline
const POLICE_REDUCTION = 0.55; // multiplier applied when hasPolice
const MISSING_SERVICE_MULT = 1.15;
const POOR_MOOD_MULT_MAX = 1.6; // applied when overall mood = -1
const COMMERCIAL_REV_PENALTY_PER_UNIT = 0.10; // up to -10% per crime point

export class Crime {
  /** Per-tile crime score, indexed by `y * width + x`. Empty until first recompute. */
  scores: Float32Array = new Float32Array(0);
  /** Last computed city-wide crime, [0, 1]. */
  cityCrime = 0;

  recompute(grid: Grid, happiness: Happiness): void {
    if (this.scores.length !== grid.width * grid.height) {
      this.scores = new Float32Array(grid.width * grid.height);
    }
    const moodMult = 1 + (POOR_MOOD_MULT_MAX - 1) * Math.max(0, -happiness.overall());
    let sum = 0;
    let counted = 0;
    for (const t of grid.iter()) {
      const idx = t.y * grid.width + t.x;
      if (t.zone === 'none' || t.density === 0) {
        this.scores[idx] = 0;
        continue;
      }
      let score = BASE_PER_DENSITY[t.density] ?? 0;
      // Industrial sites magnetise crime less than retail or housing,
      // so weight them slightly lower.
      if (t.zone === 'industrial') score *= 0.6;
      if (!t.hasPower) score *= MISSING_SERVICE_MULT;
      if (!t.hasWater) score *= MISSING_SERVICE_MULT;
      score *= moodMult;
      if (t.hasPolice) score *= POLICE_REDUCTION;
      score = Math.min(1, score);
      this.scores[idx] = score;
      sum += score;
      counted++;
    }
    this.cityCrime = counted > 0 ? sum / counted : 0;
  }

  /** Crime score for a single tile (0..1). 0 if recompute hasn't run yet. */
  scoreAt(grid: Grid, x: number, y: number): number {
    const idx = y * grid.width + x;
    return this.scores[idx] ?? 0;
  }

  /** Multiplier applied to commercial revenue (Alpha 2.21). 1.0 = no effect.
   *  At max crime this drags commercial down ~10% — visible but not punishing. */
  commercialRevenueMultiplier(): number {
    return Math.max(0.5, 1 - this.cityCrime * COMMERCIAL_REV_PENALTY_PER_UNIT);
  }
}
