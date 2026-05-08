import type { Grid } from '../world/Grid';
import { ROAD_PATH_WEIGHT, dirBetween } from '../types';

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
 * Highway one-way semantics (post-alpha pass 4): a directed traversal X → Y
 * is added only if every endpoint that's a highway-tier tile has its
 * `highwayDir` matching the X→Y direction. So a highway flowing east
 * exposes east-bound edges only; west-bound traversal of the same edge is
 * silently dropped from the adjacency. Local/avenue tiles impose no
 * direction constraint, so connections between a highway and a local act
 * as on/off ramps in the natural direction.
 *
 * Edge weight = base × ROAD_PATH_WEIGHT[destTile.roadType]. Lower for
 * higher-tier roads, so A* prefers highways and avenues for long trips.
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

      // Direction A→B
      if (canTraverse(grid, e.ax, e.ay, e.bx, e.by)) {
        const tb = grid.get(e.bx, e.by);
        const tier = tb?.roadType ?? 'local';
        this.push(ai, bi, base * ROAD_PATH_WEIGHT[tier]);
      }
      // Direction B→A
      if (canTraverse(grid, e.bx, e.by, e.ax, e.ay)) {
        const ta = grid.get(e.ax, e.ay);
        const tier = ta?.roadType ?? 'local';
        this.push(bi, ai, base * ROAD_PATH_WEIGHT[tier]);
      }
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

/**
 * Is traversal `from → to` allowed under highway one-way rules?
 *
 * - If neither endpoint is a highway: always.
 * - If `from` is a highway: its `highwayDir` must point toward `to` (i.e.
 *   the offset matches the flow).
 * - If `to` is a highway: its `highwayDir` must point AWAY from `from`
 *   along the same offset (i.e. the car arrives at `to` in `to`'s flow
 *   direction, not against it).
 *
 * In a typical highway both endpoints share the same direction, so a
 * forward edge is allowed and the reverse is not. At a boundary with a
 * local road, only the highway tile's direction is checked → cars enter
 * and exit in the natural direction.
 */
function canTraverse(
  grid: Grid,
  fromX: number, fromY: number,
  toX: number, toY: number
): boolean {
  const offset = dirBetween(fromX, fromY, toX, toY);
  if (offset === -1) return false;
  const from = grid.get(fromX, fromY);
  const to = grid.get(toX, toY);
  if (!from || !to) return false;
  if (from.roadType === 'highway' && from.highwayDir !== offset) return false;
  if (to.roadType === 'highway' && to.highwayDir !== offset) return false;
  return true;
}
