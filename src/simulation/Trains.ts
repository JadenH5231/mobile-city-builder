import type { Grid } from '../world/Grid';

const SPEED = 2.5;         // tiles per second
const DWELL_SECONDS = 2.0; // pause at each station

export interface Train {
  stations: Array<{ x: number; y: number }>;
  /** Index of the station we're heading TOWARD. */
  destIdx: number;
  /** 0..1 progress toward destIdx. */
  t: number;
  dir: 1 | -1;
  dwell: number;
}

export class Trains {
  readonly active: Train[] = [];
  private lastSig = '';

  rebuildIfNeeded(grid: Grid): void {
    const parts: string[] = [];
    for (const tile of grid.iter()) {
      if (tile.building === 'subway_entrance') parts.push(`s${tile.x},${tile.y}`);
      if (tile.subwayTrack) parts.push(`t${tile.x},${tile.y}`);
    }
    const sig = parts.sort().join('|');
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.rebuild(grid);
  }

  private rebuild(grid: Grid): void {
    this.active.length = 0;
    const stations: Array<{ x: number; y: number }> = [];
    const trackKeys = new Set<number>();
    const w = grid.width;
    for (const tile of grid.iter()) {
      if (tile.building === 'subway_entrance') stations.push({ x: tile.x, y: tile.y });
      if (tile.subwayTrack) trackKeys.add(tile.y * w + tile.x);
    }
    if (stations.length < 2 || trackKeys.size === 0) return;

    // BFS track tiles into connected components. Each component becomes
    // one Train line.
    const visitedTrack = new Set<number>();
    for (const startK of trackKeys) {
      if (visitedTrack.has(startK)) continue;
      // BFS through this component.
      const compTiles = new Set<number>();
      const queue: number[] = [startK];
      visitedTrack.add(startK);
      compTiles.add(startK);
      while (queue.length > 0) {
        const k = queue.shift()!;
        const cx = k % w;
        const cy = Math.floor(k / w);
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          const nk = (cy + dy) * w + (cx + dx);
          if (trackKeys.has(nk) && !visitedTrack.has(nk)) {
            visitedTrack.add(nk);
            compTiles.add(nk);
            queue.push(nk);
          }
        }
      }

      // Find all stations on or 4-adjacent to this track component.
      const compStations: Array<{ x: number; y: number }> = [];
      for (const s of stations) {
        const sk = s.y * w + s.x;
        if (compTiles.has(sk)) { compStations.push(s); continue; }
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          if (compTiles.has((s.y + dy) * w + (s.x + dx))) {
            compStations.push(s);
            break;
          }
        }
      }

      if (compStations.length >= 2) {
        // Sort stations along the diagonal so the train follows a sensible
        // route for most linear layouts. Complex networks will look fine
        // at this fidelity (there's one train per connected line).
        compStations.sort((a, b) => (a.x + a.y) - (b.x + b.y));
        this.active.push({ stations: compStations, destIdx: 1, t: 0, dir: 1, dwell: 0 });
      }
    }
  }

  update(dt: number, grid: Grid): void {
    this.rebuildIfNeeded(grid);
    for (const train of this.active) {
      if (train.dwell > 0) {
        train.dwell = Math.max(0, train.dwell - dt);
        continue;
      }
      const n = train.stations.length;
      const fromIdx = Math.max(0, Math.min(train.destIdx - train.dir, n - 1));
      const from = train.stations[fromIdx]!;
      const to   = train.stations[Math.max(0, Math.min(train.destIdx, n - 1))]!;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      if (dist === 0) { train.dwell = DWELL_SECONDS; continue; }
      train.t += (SPEED / dist) * dt;
      if (train.t >= 1) {
        train.t = 0;
        train.dwell = DWELL_SECONDS;
        if (train.dir === 1 && train.destIdx >= n - 1) {
          train.dir = -1;
          train.destIdx--;
        } else if (train.dir === -1 && train.destIdx <= 0) {
          train.dir = 1;
          train.destIdx++;
        } else {
          train.destIdx += train.dir;
        }
      }
    }
  }
}
