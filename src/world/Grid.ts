import { Tile } from './Tile';
import type { Building, RoadType, TerrainType, Zone } from '../types';

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

  /**
   * Set or clear the standalone road bit on a tile. When turning a tile INTO
   * a road, `type` (default 'local') sets the tier; calling on an existing
   * road overrides its tier. Clearing also resets road metadata.
   */
  setRoad(x: number, y: number, on: boolean, type: RoadType = 'local'): boolean {
    const t = this.get(x, y);
    if (!t) return false;
    if (on) {
      const wasRoad = t.road;
      const sameType = t.roadType === type;
      if (wasRoad && sameType) return false;
      t.road = true;
      t.roadType = type;
      // Highway direction is set per-stroke via setHighwayDir, not here.
      if (type !== 'highway') t.highwayDir = -1;
      // Roads are mutually exclusive with zones — clear defensively.
      t.zone = 'none';
      t.zoneCap = 0;
      t.resetDevelopment();
      // Roads also overwrite walking paths on the same tile.
      t.path = false;
      return true;
    } else {
      if (!t.road) return false;
      t.road = false;
      t.roadType = 'local';
      t.highwayDir = -1;
      t.stopSign = false;
      return true;
    }
  }

  hasRoad(x: number, y: number): boolean {
    return this.get(x, y)?.road === true;
  }

  /**
   * Set the highway flow direction on a tile. Direction is 0..7 from the
   * `Dir` enum (or -1 to clear). Only meaningful on highway-tier road tiles
   * — silently no-ops otherwise.
   */
  setHighwayDir(x: number, y: number, dir: number): boolean {
    const t = this.get(x, y);
    if (!t || !t.road || t.roadType !== 'highway') return false;
    if (t.highwayDir === dir) return false;
    t.highwayDir = dir;
    return true;
  }

  /** Toggle a stop sign on a road tile. Caller enforces "intersection only". */
  setStopSign(x: number, y: number, on: boolean): boolean {
    const t = this.get(x, y);
    if (!t || !t.road) return false;
    if (t.stopSign === on) return false;
    t.stopSign = on;
    return true;
  }

  // --- Walking paths (Alpha 1.6) ----------------------------------------

  /**
   * Set or clear a walking path on a tile. Refuses to write a path on a road
   * tile (paths CANNOT remove roads — see CLAUDE.md / SPEC.md). Painting a
   * path on a zoned tile clears the zone (paths CAN remove zoning) and resets
   * any in-progress development. Returns true iff the bit changed.
   */
  setPath(x: number, y: number, on: boolean): boolean {
    const t = this.get(x, y);
    if (!t) return false;
    if (on) {
      if (t.road) return false;
      if (t.path) return false;
      t.path = true;
      // Paths can sit on grass that was zoned; clear the zone so the
      // development pipeline doesn't try to grow a building underneath.
      if (t.zone !== 'none') {
        t.zone = 'none';
        t.zoneCap = 0;
        t.resetDevelopment();
      }
      return true;
    } else {
      if (!t.path) return false;
      t.path = false;
      return true;
    }
  }

  hasPath(x: number, y: number): boolean {
    return this.get(x, y)?.path === true;
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
   * Set the zone on a tile + the player-permitted density cap (1..3 for real
   * zones, 0 for 'none'). Clearing (zone='none') always succeeds. Setting a
   * real zone requires the tile to be on grass (no road, in bounds) AND to
   * have a 4-connected road neighbour. Returns true iff zone or cap changed.
   *
   * Re-painting an existing zone with a different cap (e.g. upgrading a low
   * residential to high) updates the cap without clearing density — the
   * player's permission widens or narrows but built buildings stay until
   * demand naturally adjusts (or until cap drops below current density,
   * which we let stand as "grandfathered" rather than bulldoze through).
   */
  setZone(x: number, y: number, zone: Zone, cap: 0 | 1 | 2 | 3 = 0): boolean {
    const t = this.get(x, y);
    if (!t) return false;
    if (zone !== 'none') {
      if (t.road) return false;
      if (!this.hasRoadAdjacent(x, y)) return false;
    }
    const sameZone = t.zone === zone;
    const sameCap = t.zoneCap === cap;
    if (sameZone && sameCap) return false;
    const wasNone = t.zone === 'none';
    t.zone = zone;
    t.zoneCap = cap;
    if (zone === 'none') {
      t.resetDevelopment();
    } else if (wasNone || !sameZone) {
      // Switched zone kind (or zoned a fresh tile) — start over.
      t.resetDevelopment();
    }
    // Cap-only changes preserve current density. If the new cap is below
    // current density the tile is "grandfathered" — Development.tick won't
    // grow it further, but the existing building stays. Bulldoze to wipe.
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

  /** Set/clear an edge given its packed key (paired with incidentRoadEdges).
   *  Defaults to local tier when re-setting; bulldoze restore preserves tier
   *  via the snapshot path that writes tiles directly. */
  setRoadEdgeByKey(key: number, on: boolean, type: RoadType = 'local'): boolean {
    const e = this.unpackEdgeKey(key);
    return this.setRoadEdge(e.ax, e.ay, e.bx, e.by, on, type);
  }

  /** Number of road edges incident to (x, y). 3+ = intersection. */
  incidentRoadEdgeCount(x: number, y: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        if (this.roadEdges.has(this.edgeKey(x, y, nx, ny))) n++;
      }
    }
    return n;
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
   * endpoint tiles as road of the given tier (default 'local'); paint always
   * wins, so painting an avenue over an existing local upgrades the tier.
   *
   * Highway direction is set separately by Game (via {@link setHighwayDir})
   * after the edges are placed — that keeps this method tier-agnostic.
   *
   * Returns true if the edge state actually changed.
   */
  setRoadEdge(
    ax: number, ay: number, bx: number, by: number,
    on: boolean,
    type: RoadType = 'local'
  ): boolean {
    if (!this.inBounds(ax, ay) || !this.inBounds(bx, by)) return false;
    const dx = bx - ax;
    const dy = by - ay;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;

    const key = this.edgeKey(ax, ay, bx, by);
    if (on) {
      // Always (re)set tier on both endpoints — paint always wins.
      this.setRoad(ax, ay, true, type);
      this.setRoad(bx, by, true, type);
      if (this.roadEdges.has(key)) return false;
      this.roadEdges.add(key);
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
   * [ax,ay,bx,by, …]). Tile-level state (roadType, highwayDir, stopSign)
   * is restored from per-tile snapshots BEFORE this is called — the loader
   * here is just the edge graph.
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
      // Defensive — the tile snapshot above should already have set these.
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
