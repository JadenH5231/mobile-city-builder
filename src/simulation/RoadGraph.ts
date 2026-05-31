import type { Grid } from '../world/Grid';
import { ROAD_PATH_WEIGHT } from '../types';

export interface Neighbor {
  /** Flat tile index = y * width + x. */
  readonly idx: number;
  /** Edge weight in tile units. Inflated/deflated per tier — see ROAD_PATH_WEIGHT. */
  readonly w: number;
}

const SQRT2 = Math.SQRT2;

/**
 * Adjacency list keyed by tile flat index. Rebuilt from scratch on any road
 * change — full sweeps are sub-millisecond up to Medium maps and the
 * alternative (incremental edits) doubles the surface area to test.
 *
 * Edge weight = base × ROAD_PATH_WEIGHT[destTile.roadType]. Lower for
 * higher-tier roads, so A* prefers highways and avenues for long trips.
 *
 * Beta 1.4 — All road tiers are BIDIRECTIONAL. Pre-1.4 highways were
 * one-way per-tile via a `highwayDir` stamp imprinted at paint time,
 * but playtest feedback made it clear that the direction-stamp model
 * was the single biggest source of "highways don't work" frustration
 * (dead-end direction mismatches, silent routing failures, confused
 * dual-carriageway auto-paint, no paint-time preview, etc). The
 * field `Tile.highwayDir` is kept for save back-compat but ignored
 * at runtime. Highways are now visibly divided multi-lane roads
 * (median + edge lines + ramp flares at non-highway adjacencies)
 * that work in both directions on a single tile.
 */
export class RoadGraph {
  /** Empty until {@link rebuild} runs. */
  readonly adj = new Map<number, Neighbor[]>();
  /** Cached at rebuild time so consumers don't have to thread it through. */
  gridWidth = 0;

  rebuild(grid: Grid): void {
    this.adj.clear();
    this.gridWidth = grid.width;
    const w = grid.width;
    for (const e of grid.iterRoadEdges()) {
      const ai = e.ay * w + e.ax;
      const bi = e.by * w + e.bx;
      const isDiag = e.ax !== e.bx && e.ay !== e.by;
      const base = isDiag ? SQRT2 : 1;
      const ta = grid.get(e.ax, e.ay);
      const tb = grid.get(e.bx, e.by);
      if (!ta || !tb) continue;

      // Roundabout ring edges (Beta 1.8) are ONE-WAY (counter-clockwise),
      // so cars circulate like a real roundabout instead of crossing it.
      // An edge between two ring tiles of the SAME roundabout gets only
      // its CCW-directed neighbor pushed; every other edge (including
      // external road ↔ ring tile, which serve as entries AND exits)
      // stays bidirectional.
      const ra = grid.roundaboutAt(e.ax, e.ay);
      const rb = grid.roundaboutAt(e.bx, e.by);
      if (ra && rb && ra.isRing && rb.isRing && ra.ax === rb.ax && ra.ay === rb.ay) {
        // Tangent test: radial r = (a - centre); move m = (b - a). The
        // sign of the 2D cross r×m tells us the rotational sense of a→b.
        // cross < 0 is counter-clockwise as viewed from above with north
        // up (matches right-hand-traffic roundabouts). Keep that one.
        const rx = e.ax - ra.cx;
        const ry = e.ay - ra.cy;
        const mx = e.bx - e.ax;
        const my = e.by - e.ay;
        const cross = rx * my - ry * mx;
        if (cross < 0) {
          this.push(ai, bi, base * ROAD_PATH_WEIGHT[tb.roadType]);
        } else {
          this.push(bi, ai, base * ROAD_PATH_WEIGHT[ta.roadType]);
        }
        continue;
      }

      // Bidirectional in both directions — edge cost uses the destination
      // tile's tier so A* still prefers highways for long trips.
      this.push(ai, bi, base * ROAD_PATH_WEIGHT[tb.roadType]);
      this.push(bi, ai, base * ROAD_PATH_WEIGHT[ta.roadType]);
    }
  }

  private push(from: number, to: number, weight: number): void {
    let bucket = this.adj.get(from);
    if (!bucket) {
      bucket = [];
      this.adj.set(from, bucket);
    }
    bucket.push({ idx: to, w: weight });
  }

  has(idx: number): boolean {
    return this.adj.has(idx);
  }

  /** Tile flat indices that have at least one outgoing edge. */
  *roadTiles(): IterableIterator<number> {
    for (const k of this.adj.keys()) yield k;
  }
}
