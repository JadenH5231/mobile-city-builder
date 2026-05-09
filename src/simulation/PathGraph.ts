import type { Grid } from '../world/Grid';
import type { Neighbor } from './RoadGraph';

/**
 * Pedestrian adjacency over walkable tiles. Walkable = walking-path tiles
 * OR non-highway road tiles (sidewalks). 4-connected only — pedestrians
 * don't cut diagonals through buildings.
 *
 * Highway tiles are never walkable (they're car-only infrastructure with no
 * sidewalk in the spec). The implication: a pedestrian trip whose only
 * route involves a highway has no path, and the spawner will skip it.
 *
 * Shape mirrors {@link RoadGraph} so it can drop into {@link Pathfinding}
 * unchanged. Edge weight is the orthogonal distance (1) — paths and
 * sidewalks all walk at the same speed.
 *
 * Note on the "cross only at intersections" rule: with a single-centerline
 * sidewalk model (per Tile, not per side), this rule is geometric flavour
 * rather than a routing constraint. The spawner doesn't pretend pedestrians
 * pick which side of the road they're on. If we add per-side sidewalks
 * later, this is the file where the constraint goes.
 */
export class PathGraph {
  readonly adj = new Map<number, Neighbor[]>();
  gridWidth = 0;

  rebuild(grid: Grid): void {
    this.adj.clear();
    this.gridWidth = grid.width;
    const w = grid.width;
    for (const t of grid.iter()) {
      if (!isWalkable(t.path, t.road, t.roadType)) continue;
      const idx = t.y * w + t.x;
      // 4-connected neighbours.
      const neigh = [
        { nx: t.x,     ny: t.y - 1 },
        { nx: t.x + 1, ny: t.y     },
        { nx: t.x,     ny: t.y + 1 },
        { nx: t.x - 1, ny: t.y     }
      ];
      for (const { nx, ny } of neigh) {
        const n = grid.get(nx, ny);
        if (!n) continue;
        if (!isWalkable(n.path, n.road, n.roadType)) continue;
        this.push(idx, ny * w + nx, 1);
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

  /** True if the tile at (x, y) is part of the walkable network. */
  isWalkableAt(grid: Grid, x: number, y: number): boolean {
    const t = grid.get(x, y);
    if (!t) return false;
    return isWalkable(t.path, t.road, t.roadType);
  }
}

function isWalkable(path: boolean, road: boolean, roadType: string): boolean {
  if (path) return true;
  if (road && roadType !== 'highway') return true;
  return false;
}
