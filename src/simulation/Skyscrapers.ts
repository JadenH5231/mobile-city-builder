import type { Grid } from '../world/Grid';
import { SKYSCRAPER_MONTHS_PER_STAGE } from '../types';

/**
 * Skyscraper construction simulation (Alpha 3.1.2).
 *
 * A skyscraper occupies a 2×2 footprint marked via `Tile.skyscraper`.
 * The lex-smaller tile of the four (lowest x, then lowest y) is the
 * "anchor" — it carries the live `skyscraperStage` (0..4); the other
 * three tiles are mirror copies kept in sync for save round-tripping.
 *
 * Each sim month, the anchor's stage advances by one stage every
 * SKYSCRAPER_MONTHS_PER_STAGE months. Total: 4 stages × 3 months = 12
 * months from foundation to finished. At stage 4 the building is
 * complete and starts contributing residents / jobs (handled by
 * Population's existing per-tile sweep, which now reads the
 * skyscraper-specific capacity constants).
 *
 * No save schema bump beyond the per-tile fields — the sim is purely
 * a function of the tile state + how many months have elapsed since
 * placement, and "since placement" is encoded in the stage counter
 * itself (one stage per 3 months of in-game time).
 *
 * The construction work is tracked via a per-anchor in-memory
 * `monthsAtStage` counter — we don't persist this; on load we resume
 * with monthsAtStage=0 for the current stage, so a partially built
 * skyscraper might take an extra fraction of a stage to finish but
 * never regresses.
 */
export class Skyscrapers {
  /** Per-anchor (y*width+x) months elapsed in the current stage. Cleared
   *  on save restore — a freshly-loaded city resumes at month-0 of
   *  whatever stage it was on. */
  private readonly monthsAtStage = new Map<number, number>();

  /** Run once per sim month. Walks every anchor tile (lex-smallest of a
   *  2×2 skyscraper group), bumps its stage when SKYSCRAPER_MONTHS_PER_STAGE
   *  is reached, and propagates the stage to the other 3 tiles in the group.
   *  Returns true if any stage advanced (caller may want to redraw). */
  tickMonth(grid: Grid): boolean {
    let advanced = false;
    for (const t of grid.iter()) {
      if (!t.skyscraper) continue;
      if (!isAnchor(grid, t.x, t.y)) continue;
      if (t.skyscraperStage >= 4) continue;
      const idx = t.y * grid.width + t.x;
      const cur = (this.monthsAtStage.get(idx) ?? 0) + 1;
      if (cur >= SKYSCRAPER_MONTHS_PER_STAGE) {
        this.monthsAtStage.set(idx, 0);
        const next = (Math.min(4, t.skyscraperStage + 1)) as 0 | 1 | 2 | 3 | 4;
        t.skyscraperStage = next;
        // Mirror to the other 3 tiles in the group.
        for (const peer of groupTiles(grid, t.x, t.y)) {
          if (peer === t) continue;
          peer.skyscraperStage = next;
        }
        advanced = true;
      } else {
        this.monthsAtStage.set(idx, cur);
      }
    }
    return advanced;
  }

  /** Reset the per-anchor stage timers — call after save restore so
   *  resumed construction picks up cleanly. */
  reset(): void {
    this.monthsAtStage.clear();
  }
}

/** True if (x, y) is the lex-smallest tile in its 2×2 skyscraper group. */
export function isAnchor(grid: Grid, x: number, y: number): boolean {
  const t = grid.get(x, y);
  if (!t || !t.skyscraper) return false;
  // Anchor = lowest x, then lowest y. Check the three potentially smaller
  // tiles: (x-1,y), (x,y-1), (x-1,y-1). If any is also a skyscraper of the
  // same zone + variant, this isn't the anchor.
  const cmp = (px: number, py: number): boolean => {
    const p = grid.get(px, py);
    return !!(p && p.skyscraper && p.zone === t.zone && p.skyscraperVariant === t.skyscraperVariant);
  };
  if (cmp(x - 1, y)) return false;
  if (cmp(x, y - 1)) return false;
  if (cmp(x - 1, y - 1)) return false;
  // Verify the other 3 of the 2×2 are present at (x+1,y), (x,y+1), (x+1,y+1).
  if (!cmp(x + 1, y) || !cmp(x, y + 1) || !cmp(x + 1, y + 1)) return false;
  return true;
}

/** Return all 4 tiles of the 2×2 group anchored at (x, y). The anchor
 *  must be the lex-smallest. Returns empty array if the group isn't
 *  intact (defensive for partial save corruption). */
export function groupTiles(grid: Grid, x: number, y: number): import('../world/Tile').Tile[] {
  const out: import('../world/Tile').Tile[] = [];
  const offsets: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
  for (const [dx, dy] of offsets) {
    const p = grid.get(x + dx, y + dy);
    if (p && p.skyscraper) out.push(p);
  }
  return out;
}
