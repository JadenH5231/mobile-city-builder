import type { RoadGraph } from './RoadGraph';

/**
 * Vanilla A* over the road graph. Heuristic = Euclidean distance in tile
 * units. Per-call buffers (gScore, cameFrom, openSet) are reused so only the
 * returned path array allocates. Open-set "pop min" is a linear scan — promote
 * to a binary heap only if a fully-developed Medium map shows it as a hotspot.
 */
export class Pathfinding {
  private readonly gScore = new Map<number, number>();
  private readonly fScore = new Map<number, number>();
  private readonly cameFrom = new Map<number, number>();
  private readonly open = new Set<number>();

  /**
   * @returns Tile flat indices from start (inclusive) to end (inclusive), or
   *   null if no path exists. Both endpoints must be present in the graph.
   */
  findPath(graph: RoadGraph, start: number, end: number, gridWidth: number): number[] | null {
    if (!graph.has(start) || !graph.has(end)) return null;
    if (start === end) return [start];

    this.gScore.clear();
    this.fScore.clear();
    this.cameFrom.clear();
    this.open.clear();

    this.gScore.set(start, 0);
    this.fScore.set(start, heuristic(start, end, gridWidth));
    this.open.add(start);

    while (this.open.size > 0) {
      let current = -1;
      let bestF = Infinity;
      for (const idx of this.open) {
        const f = this.fScore.get(idx) ?? Infinity;
        if (f < bestF) { bestF = f; current = idx; }
      }
      if (current === -1) return null;
      if (current === end) return this.reconstruct(current);

      this.open.delete(current);
      const cg = this.gScore.get(current) ?? Infinity;
      const neighbours = graph.adj.get(current);
      if (!neighbours) continue;

      for (const n of neighbours) {
        const tentative = cg + n.w;
        if (tentative < (this.gScore.get(n.idx) ?? Infinity)) {
          this.cameFrom.set(n.idx, current);
          this.gScore.set(n.idx, tentative);
          this.fScore.set(n.idx, tentative + heuristic(n.idx, end, gridWidth));
          this.open.add(n.idx);
        }
      }
    }
    return null;
  }

  private reconstruct(end: number): number[] {
    const path: number[] = [end];
    let cur = end;
    for (;;) {
      const prev = this.cameFrom.get(cur);
      if (prev === undefined) break;
      path.push(prev);
      cur = prev;
    }
    path.reverse();
    return path;
  }
}

function heuristic(a: number, b: number, w: number): number {
  const ax = a % w;
  const ay = (a - ax) / w;
  const bx = b % w;
  const by = (b - bx) / w;
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
