import type { Grid } from '../world/Grid';

export interface Neighbor {
  /** Flat tile index = y * width + x. */
  readonly idx: number;
  /** Edge weight in tile units. 1 for orthogonal, √2 for diagonal. */
  readonly w: number;
}

const SQRT2 = Math.SQRT2;

/**
 * Adjacency list keyed by tile flat index. Rebuilt from scratch on any road
 * change — full sweeps are sub-millisecond up to Medium maps and the alternative
 * (incremental edits) doubles the surface area to test.
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
      const weight = e.ax !== e.bx && e.ay !== e.by ? SQRT2 : 1;
      this.push(ai, bi, weight);
      this.push(bi, ai, weight);
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
