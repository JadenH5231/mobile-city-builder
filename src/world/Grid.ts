import { Tile } from './Tile';
import type { Building, TerrainType, Zone } from '../types';

/**
 * A road edge connects two adjacent tiles (4- or 8-connected). We pack the
 * endpoints into a single number key so Set membership is cheap and so save
 * games are trivial to round-trip.
 *
 * Encoding: smaller flat-index in the low 32 bits, larger in the high 32.
 * For our largest map (256×256 = 65 536 cells) max index is 65 535, so
 * `low * 2^20 + high` (≤ 2^40) stays well inside the JS safe-integer range.
 */
export interface RoadEdge {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

const PACK_SHIFT = 1 << 20;

export class Grid {
  readonly width: number;
  readonly height: number;
  private readonly tiles: Tile[];
  private readonly roadEdges = new Set<number>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Array(width * height);
    this.generate();
  }

  /**
   * Deterministic placeholder generator. Mostly grass with sprinkled forests
   * — gives the eye something to anchor on while we test camera + zoom.
   */
  private generate(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const terrain = this.placeholderTerrain(x, y);
        this.tiles[y * this.width + x] = new Tile(x, y, terrain);
      }
    }
  }

  private placeholderTerrain(x: number, y: number): TerrainType {
    const h = Math.abs(((x * 374761393) ^ (y * 668265263)) | 0) % 100;
    if (h < 6) return 'forest';
    return 'grass';
  }

  // --- Tile access -------------------------------------------------------

  get(x: number, y: number): Tile | undefined {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return undefined;
    return this.tiles[y * this.width + x];
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  *iter(): IterableIterator<Tile> {
    for (let i = 0; i < this.tiles.length; i++) yield this.tiles[i]!;
  }

  // --- Road state -------------------------------------------------------

  get roadEdgeCount(): number {
    return this.roadEdges.size;
  }

  /** Set or clear the standalone road bit on a tile. */
  setRoad(x: number, y: number, on: boolean): boolean {
    const t = this.get(x, y);
    if (!t || t.road === on) return false;
    t.road = on;
    return true;
  }

  hasRoad(x: number, y: number): boolean {
    return this.get(x, y)?.road === true;
  }

  /** True if any 4-connected neighbour of (x, y) is a road tile. */
  hasRoadAdjacent(x: number, y: number): boolean {
    return (
      this.hasRoad(x, y - 1) ||
      this.hasRoad(x + 1, y) ||
      this.hasRoad(x, y + 1) ||
      this.hasRoad(x - 1, y)
    );
  }

  // --- Zoning -----------------------------------------------------------

  /**
   * Set the zone on a tile. Clearing (zone='none') always succeeds. Setting
   * a real zone requires the tile to be on grass (no road, in bounds) AND
   * to have a 4-connected road neighbour. Returns true iff state changed.
   */
  setZone(x: number, y: number, zone: Zone): boolean {
    const t = this.get(x, y);
    if (!t) return false;
    if (zone !== 'none') {
      if (t.road) return false;
      if (!this.hasRoadAdjacent(x, y)) return false;
    }
    if (t.zone === zone) return false;
    t.zone = zone;
    // Re-zoning (or clearing) tears down whatever was developing on this cell.
    t.resetDevelopment();
    return true;
  }

  zoneAt(x: number, y: number): Zone {
    return this.get(x, y)?.zone ?? 'none';
  }

  // --- Buildings (Step 10) ----------------------------------------------

  /**
   * Place or remove a city building on a tile. Mutually exclusive with road,
   * zone, and any existing building. Returns true if state actually changed.
   * Does NOT clear zones or re-cascade — caller (Game) handles cost / refund
   * and triggers `Services.recompute`.
   */
  setBuilding(x: number, y: number, b: Building): boolean {
    const t = this.get(x, y);
    if (!t) return false;
    if (b !== 'none') {
      if (t.road || t.zone !== 'none' || t.building !== 'none') return false;
    }
    if (t.building === b) return false;
    t.building = b;
    if (b !== 'none') {
      // Buildings clear any latent development progress on the cell.
      t.resetDevelopment();
    }
    return true;
  }

  hasBuilding(x: number, y: number): boolean {
    const t = this.get(x, y);
    return !!t && t.building !== 'none';
  }

  // --- Bulldoze support -------------------------------------------------

  /**
   * Collect all road edges incident to (x, y). Returned as packed keys —
   * caller can pass each back to {@link removeRoadEdgeByKey}. Used by the
   * bulldoze rubber band so it can both clear and later restore the edges
   * a stroke touched.
   */
  incidentRoadEdges(x: number, y: number): number[] {
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const k = this.edgeKey(x, y, nx, ny);
        if (this.roadEdges.has(k)) out.push(k);
      }
    }
    return out;
  }

  /** Set/clear an edge given its packed key (paired with incidentRoadEdges). */
  setRoadEdgeByKey(key: number, on: boolean): boolean {
    const e = this.unpackEdgeKey(key);
    return this.setRoadEdge(e.ax, e.ay, e.bx, e.by, on);
  }

  private unpackEdgeKey(key: number): { ax: number; ay: number; bx: number; by: number } {
    const lo = key % PACK_SHIFT;
    const hi = Math.floor(key / PACK_SHIFT);
    return {
      ax: lo % this.width,
      ay: Math.floor(lo / this.width),
      bx: hi % this.width,
      by: Math.floor(hi / this.width)
    };
  }

  /**
   * Add an edge between two adjacent tiles. Both endpoints must be in bounds
   * and within Chebyshev distance 1 (i.e. 4- or 8-connected). Marks both
   * endpoint tiles as road.
   *
   * Returns true if the edge state actually changed.
   */
  setRoadEdge(ax: number, ay: number, bx: number, by: number, on: boolean): boolean {
    if (!this.inBounds(ax, ay) || !this.inBounds(bx, by)) return false;
    const dx = bx - ax;
    const dy = by - ay;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;

    const key = this.edgeKey(ax, ay, bx, by);
    if (on) {
      if (this.roadEdges.has(key)) return false;
      this.roadEdges.add(key);
      this.setRoad(ax, ay, true);
      this.setRoad(bx, by, true);
      // Roads and zones are mutually exclusive on the same tile; promoting
      // a tile to road silently displaces any zone on it (and the building).
      const ta = this.get(ax, ay);
      const tb = this.get(bx, by);
      if (ta) { ta.zone = 'none'; ta.resetDevelopment(); }
      if (tb) { tb.zone = 'none'; tb.resetDevelopment(); }
      return true;
    } else {
      if (!this.roadEdges.has(key)) return false;
      this.roadEdges.delete(key);
      // Demote tiles to non-road only if they have no remaining edges.
      if (!this.tileHasAnyEdge(ax, ay)) this.setRoad(ax, ay, false);
      if (!this.tileHasAnyEdge(bx, by)) this.setRoad(bx, by, false);
      return true;
    }
  }

  hasRoadEdge(ax: number, ay: number, bx: number, by: number): boolean {
    return this.roadEdges.has(this.edgeKey(ax, ay, bx, by));
  }

  /**
   * Replace the road-edge set with a deserialized list (flat
   * [ax,ay,bx,by, …]). Caller is responsible for `road` flags on
   * endpoints having been restored separately. Used by the save loader.
   */
  loadRoadEdges(edges: readonly number[]): void {
    this.roadEdges.clear();
    for (let i = 0; i + 3 < edges.length; i += 4) {
      const ax = edges[i]!;
      const ay = edges[i + 1]!;
      const bx = edges[i + 2]!;
      const by = edges[i + 3]!;
      if (!this.inBounds(ax, ay) || !this.inBounds(bx, by)) continue;
      this.roadEdges.add(this.edgeKey(ax, ay, bx, by));
      // Make sure both endpoints are flagged as roads (defensive — the
      // tile snapshot above should already have set these).
      const ta = this.get(ax, ay);
      if (ta) ta.road = true;
      const tb = this.get(bx, by);
      if (tb) tb.road = true;
    }
  }

  *iterRoadEdges(): IterableIterator<RoadEdge> {
    for (const key of this.roadEdges) {
      const lo = key % PACK_SHIFT;
      const hi = Math.floor(key / PACK_SHIFT);
      yield {
        ax: lo % this.width,
        ay: Math.floor(lo / this.width),
        bx: hi % this.width,
        by: Math.floor(hi / this.width)
      };
    }
  }

  /** Does the tile have any incident road edge? Used for stub demotion. */
  private tileHasAnyEdge(x: number, y: number): boolean {
    // 8 neighbours — small enough that brute force is fine.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        if (this.roadEdges.has(this.edgeKey(x, y, nx, ny))) return true;
      }
    }
    return false;
  }

  private edgeKey(ax: number, ay: number, bx: number, by: number): number {
    const ai = ay * this.width + ax;
    const bi = by * this.width + bx;
    const lo = ai < bi ? ai : bi;
    const hi = ai < bi ? bi : ai;
    return hi * PACK_SHIFT + lo;
  }
}
