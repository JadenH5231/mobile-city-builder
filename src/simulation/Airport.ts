/**
 * Airport simulation (Beta 2.1). Manages the state derived from the player's
 * placed airport infrastructure tiles. Rebuilt each monthly tick from the
 * grid; the Planes system reads it to spawn / route aircraft.
 *
 * Design principle: Airport is a pure data aggregate — it never mutates the
 * grid. All simulation effects (revenue, passengers, transit routing) are
 * consumed by Economy and Planes; Aircraft animation is managed by Planes.
 */
import type { Grid } from '../world/Grid';
import { APT_MIN_RUNWAY_TILES } from '../types';

export interface AptGate {
  id: number;
  /** Apron tile coordinates (gate is on an apron tile adjacent to terminal). */
  x: number;
  y: number;
  occupied: boolean;
  /** Id of the aircraft currently docked here, or 0 if empty. */
  aircraftId: number;
}

export interface AptRunway {
  tiles: { x: number; y: number }[];
  /** 0 = NS (tiles vary along Y / world-Z), Math.PI/2 = EW (tiles vary along X). */
  yaw: number;
  /** World-space centre of the runway (in tile units, TILE_SIZE = 1). */
  centerX: number;
  centerZ: number;
  /** Approach-end threshold world position (where touchdown occurs). */
  thresholdX: number;
  thresholdZ: number;
  /** Departure-end world position (where climb-out begins). */
  farEndX: number;
  farEndZ: number;
  /** Number of tiles in this runway segment. */
  length: number;
}

export class Airport {
  runways: AptRunway[] = [];
  gates: AptGate[] = [];
  hasTower = false;
  terminalTileCount = 0;
  apronTileCount = 0;
  /** True when a bus stop, bus_depot, or subway_entrance sits within
   *  12 tiles of any apron tile.  Drives the transit revenue multiplier. */
  transitConnected = false;
  /** Current active visitors staying in the city from air arrivals.
   *  Ticked down by Planes.update as passengers depart. */
  activePassengers = 0;

  private gateIdCounter = 1;

  /** Rebuild runway + gate registries from the current grid state. Called
   *  once per sim month by Game.ts (immediately before Economy.runMonth
   *  so revenue sees fresh gate + runway counts). */
  rebuild(grid: Grid): void {
    this.runways = [];
    this.gates = [];
    this.hasTower = false;
    this.terminalTileCount = 0;
    this.apronTileCount = 0;

    // Single-pass tile audit.
    for (const t of grid.iter()) {
      switch (t.building) {
        case 'apt_terminal': this.terminalTileCount++; break;
        case 'apt_apron':    this.apronTileCount++;    break;
        case 'apt_tower':    this.hasTower = true;     break;
      }
    }

    // Runway segments — 4-connected BFS over apt_runway tiles. Each
    // contiguous island becomes one AptRunway. Orientation comes from the
    // aptRunwayYaw of the first tile in the flood fill.
    const visitedRwy = new Set<number>();
    const w = grid.width;
    for (const t of grid.iter()) {
      if (t.building !== 'apt_runway') continue;
      const key = t.y * w + t.x;
      if (visitedRwy.has(key)) continue;
      const tiles: { x: number; y: number }[] = [];
      const stack: { x: number; y: number }[] = [{ x: t.x, y: t.y }];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const k = cur.y * w + cur.x;
        if (visitedRwy.has(k)) continue;
        const ct = grid.get(cur.x, cur.y);
        if (!ct || ct.building !== 'apt_runway') continue;
        visitedRwy.add(k);
        tiles.push(cur);
        stack.push({ x: cur.x + 1, y: cur.y }, { x: cur.x - 1, y: cur.y },
                   { x: cur.x, y: cur.y + 1 }, { x: cur.x, y: cur.y - 1 });
      }
      if (tiles.length === 0) continue;

      const anchorTile = grid.get(tiles[0]!.x, tiles[0]!.y)!;
      const yaw = anchorTile.aptRunwayYaw;

      let minX = tiles[0]!.x, maxX = tiles[0]!.x;
      let minY = tiles[0]!.y, maxY = tiles[0]!.y;
      for (const p of tiles) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      // World-space center (tile-unit coordinates; TILE_SIZE = 1).
      const centerX = (minX + maxX + 1) * 0.5;
      const centerZ = (minY + maxY + 1) * 0.5;

      let thresholdX: number, thresholdZ: number;
      let farEndX: number, farEndZ: number;

      if (Math.abs(yaw) < 0.1) {
        // NS runway: aircraft approach from the south (high Z = high grid Y).
        thresholdX = centerX; thresholdZ = maxY + 0.5; // south end
        farEndX = centerX;    farEndZ = minY + 0.5;    // north end
      } else {
        // EW runway: approach from the east (high X).
        thresholdX = maxX + 0.5; thresholdZ = centerZ; // east end
        farEndX = minX + 0.5;    farEndZ = centerZ;    // west end
      }

      this.runways.push({
        tiles, yaw, centerX, centerZ,
        thresholdX, thresholdZ, farEndX, farEndZ,
        length: tiles.length
      });
    }

    // Gates — any apron tile that is 4-adjacent to at least one terminal tile.
    const gateKeys = new Set<number>();
    for (const t of grid.iter()) {
      if (t.building !== 'apt_apron') continue;
      let nearTerminal = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nt = grid.get(t.x + dx, t.y + dy);
        if (nt && nt.building === 'apt_terminal') { nearTerminal = true; break; }
      }
      if (!nearTerminal) continue;
      const key = t.y * w + t.x;
      if (gateKeys.has(key)) continue;
      gateKeys.add(key);
      // Preserve occupied state if the gate still exists after rebuild.
      const existing = this.gates.find(g => g.x === t.x && g.y === t.y);
      this.gates.push({
        id: existing?.id ?? this.gateIdCounter++,
        x: t.x, y: t.y,
        occupied: existing?.occupied ?? false,
        aircraftId: existing?.aircraftId ?? 0
      });
    }

    // Transit connectivity: any bus stop / depot / subway within 12 tiles
    // of any apron tile. O(apron × transit) but airport areas are small.
    this.transitConnected = false;
    outer:
    for (const t of grid.iter()) {
      if (t.building !== 'apt_apron') continue;
      for (const c of grid.iter()) {
        if (c.busStop || c.building === 'bus_stop' || c.building === 'bus_depot'
            || c.building === 'subway_entrance') {
          const dx = c.x - t.x, dy = c.y - t.y;
          if (dx * dx + dy * dy <= 144) { this.transitConnected = true; break outer; }
        }
      }
    }
  }

  /** True when the airport can accept aircraft: ≥1 runway of min length + ≥1 gate. */
  isOperational(): boolean {
    return this.runways.some(r => r.length >= APT_MIN_RUNWAY_TILES) && this.gates.length > 0;
  }

  /** Return the first unoccupied gate, or null if all are full. */
  findAvailableGate(): AptGate | null {
    return this.gates.find(g => !g.occupied) ?? null;
  }

  occupyGate(id: number, aircraftId: number): void {
    const g = this.gates.find(g => g.id === id);
    if (g) { g.occupied = true; g.aircraftId = aircraftId; }
  }

  releaseGate(id: number): void {
    const g = this.gates.find(g => g.id === id);
    if (g) { g.occupied = false; g.aircraftId = 0; }
  }

  /**
   * BFS on apt_taxiway + apt_apron + apt_runway tiles to find a path
   * between two tile coordinates. Returns an ordered list of tile positions
   * along the route, or [] if no path exists.
   */
  findTaxiPath(
    fromX: number, fromY: number,
    toX: number,   toY: number,
    grid: Grid
  ): { x: number; y: number }[] {
    if (fromX === toX && fromY === toY) return [];
    const w = grid.width;
    const parentMap = new Map<number, number>();
    const startKey = fromY * w + fromX;
    parentMap.set(startKey, -1);
    const queue: { x: number; y: number }[] = [{ x: fromX, y: fromY }];
    const targetKey = toY * w + toX;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curKey = cur.y * w + cur.x;
      if (curKey === targetKey) {
        // Reconstruct
        const path: { x: number; y: number }[] = [];
        let k = curKey;
        while (k !== -1) {
          path.unshift({ x: k % w, y: Math.floor(k / w) });
          k = parentMap.get(k)!;
        }
        path.shift(); // remove the fromX/fromY tile itself (we're already there)
        return path;
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        const nk = ny * w + nx;
        if (parentMap.has(nk)) continue;
        const nt = grid.get(nx, ny);
        if (!nt) continue;
        if (nt.building === 'apt_taxiway' || nt.building === 'apt_apron'
            || nt.building === 'apt_runway') {
          parentMap.set(nk, curKey);
          queue.push({ x: nx, y: ny });
        }
      }
    }
    return []; // no taxiway path — aircraft will skip taxiing
  }

  /** Nearest runway tile position to a given tile coord.  Used to find where
   *  an aircraft exits the runway onto the taxiway network. */
  nearestRunwayExit(
    gateX: number, gateY: number,
    runway: AptRunway
  ): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const rt of runway.tiles) {
      const d = (rt.x - gateX) ** 2 + (rt.y - gateY) ** 2;
      if (d < bestDist) { bestDist = d; best = rt; }
    }
    return best;
  }
}
