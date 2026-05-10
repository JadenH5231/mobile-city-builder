import { Tile } from './Tile';
import { generateTerrain } from './TerrainGenerator';
import type { Building, RoadType, Zone } from '../types';

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
  /** Upper-layer (Bridge Mode) road edges. Independent network from
   *  ground roadEdges — both can coexist on the same tile pair. */
  private readonly bridgeRoadEdges = new Set<number>();
  /** City-bounds rectangle (Alpha 3.2.1). Inclusive [x0..x1] × [y0..y1].
   *  Tiles inside the rectangle are owned automatically; outside is
   *  for-sale. Player grows the rectangle by tapping the four "+" buttons
   *  rendered just outside each edge — each tap costs $1M and adds
   *  EXPANSION_BLOCK_SIZE tiles to that direction. */
  cityBoundsX0 = 0;
  cityBoundsX1 = 0;
  cityBoundsY0 = 0;
  cityBoundsY1 = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Array(width * height);
    this.generate();
  }

  /**
   * Procedural map generator (Alpha 2.3). Two octaves of value noise drive
   * an elevation field; low pockets become lakes, mid-elevation grass
   * gets forest clusters, and there's a 70% chance of a meandering river
   * carved from one map edge to another. Sand spawns automatically along
   * any water shoreline. See {@link generateTerrain} for the algorithm.
   *
   * Seed comes from `Date.now()` on a fresh map so each "Reset City" gets
   * a different world — but the per-tile result is what `SaveGame`
   * persists, so reload restores the exact same world.
   */
  private generate(): void {
    const specs = generateTerrain(this.width, this.height, { seed: Date.now() });
    // Initial ownership (Alpha 3.1.3 / 3.2.1): only the central half of
    // the map is owned at city start. cityBounds defines the rectangle;
    // outside is for-sale. Player grows the rectangle by tapping the
    // "+" buttons rendered just outside each edge.
    const ownedHalfW = Math.floor(this.width / 4);
    const ownedHalfH = Math.floor(this.height / 4);
    const cx = Math.floor(this.width / 2);
    const cy = Math.floor(this.height / 2);
    this.cityBoundsX0 = Math.max(0, cx - ownedHalfW);
    this.cityBoundsX1 = Math.min(this.width - 1, cx + ownedHalfW);
    this.cityBoundsY0 = Math.max(0, cy - ownedHalfH);
    this.cityBoundsY1 = Math.min(this.height - 1, cy + ownedHalfH);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const spec = specs[y * this.width + x]!;
        const tile = new Tile(x, y, spec.terrain);
        tile.elevation = spec.elevation;
        tile.owned = this.isWithinBounds(x, y);
        this.tiles[y * this.width + x] = tile;
      }
    }
  }

  /** True iff (x, y) is inside the current cityBounds rectangle. */
  isWithinBounds(x: number, y: number): boolean {
    return x >= this.cityBoundsX0 && x <= this.cityBoundsX1
        && y >= this.cityBoundsY0 && y <= this.cityBoundsY1;
  }

  /** Expand the cityBounds by `amount` tiles in `direction` (Alpha 3.2.1).
   *  Newly-included tiles flip to owned. Returns the count of tiles that
   *  actually got included (0 if the bounds already touched the grid edge
   *  in that direction). The Game layer is responsible for the cost +
   *  treasury check before calling. */
  expandBounds(direction: 'N' | 'S' | 'E' | 'W', amount: number): number {
    let added = 0;
    if (direction === 'N') {
      const newY0 = Math.max(0, this.cityBoundsY0 - amount);
      for (let y = newY0; y < this.cityBoundsY0; y++) {
        for (let x = this.cityBoundsX0; x <= this.cityBoundsX1; x++) {
          const t = this.get(x, y);
          if (t && !t.owned) { t.owned = true; added++; }
        }
      }
      this.cityBoundsY0 = newY0;
    } else if (direction === 'S') {
      const newY1 = Math.min(this.height - 1, this.cityBoundsY1 + amount);
      for (let y = this.cityBoundsY1 + 1; y <= newY1; y++) {
        for (let x = this.cityBoundsX0; x <= this.cityBoundsX1; x++) {
          const t = this.get(x, y);
          if (t && !t.owned) { t.owned = true; added++; }
        }
      }
      this.cityBoundsY1 = newY1;
    } else if (direction === 'W') {
      const newX0 = Math.max(0, this.cityBoundsX0 - amount);
      for (let x = newX0; x < this.cityBoundsX0; x++) {
        for (let y = this.cityBoundsY0; y <= this.cityBoundsY1; y++) {
          const t = this.get(x, y);
          if (t && !t.owned) { t.owned = true; added++; }
        }
      }
      this.cityBoundsX0 = newX0;
    } else {
      const newX1 = Math.min(this.width - 1, this.cityBoundsX1 + amount);
      for (let x = this.cityBoundsX1 + 1; x <= newX1; x++) {
        for (let y = this.cityBoundsY0; y <= this.cityBoundsY1; y++) {
          const t = this.get(x, y);
          if (t && !t.owned) { t.owned = true; added++; }
        }
      }
      this.cityBoundsX1 = newX1;
    }
    return added;
  }

  /** True iff the cityBounds can grow further in `direction` (i.e. there's
   *  still space inside the underlying grid). */
  canExpand(direction: 'N' | 'S' | 'E' | 'W'): boolean {
    if (direction === 'N') return this.cityBoundsY0 > 0;
    if (direction === 'S') return this.cityBoundsY1 < this.height - 1;
    if (direction === 'W') return this.cityBoundsX0 > 0;
    return this.cityBoundsX1 < this.width - 1;
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
    // Land-purchase gate (Alpha 3.1.3): unowned tiles refuse builds.
    // Allowing `on=false` so bulldoze on owned land that previously had
    // a road still works after a defensive ownership change.
    if (on && !t.owned) return false;
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
      // Auto-bridge: a road painted on a water tile becomes a bridge.
      // The renderer elevates the road plane and drops support pillars.
      // Land roads have bridge=false (set defensively).
      t.bridge = t.terrain === 'water';
      return true;
    } else {
      if (!t.road) return false;
      t.road = false;
      t.roadType = 'local';
      t.highwayDir = -1;
      t.stopSign = false;
      t.trafficLight = false;
      t.busStop = false;
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
    // Stop sign and traffic light are mutually exclusive — placing one
    // implicitly removes the other.
    if (on) t.trafficLight = false;
    return true;
  }

  /** Toggle a traffic light on a road tile. Caller enforces "intersection only". */
  setTrafficLight(x: number, y: number, on: boolean): boolean {
    const t = this.get(x, y);
    if (!t || !t.road) return false;
    if (t.trafficLight === on) return false;
    t.trafficLight = on;
    if (on) t.stopSign = false;
    return true;
  }

  /**
   * Toggle a road-attached bus stop. Caller is expected to filter to
   * non-highway road tiles. Independent of stopSign / trafficLight on the
   * same tile — the stop sits on the sidewalk, those control the road.
   */
  setBusStop(x: number, y: number, on: boolean): boolean {
    const t = this.get(x, y);
    if (!t || !t.road) return false;
    if (t.busStop === on) return false;
    t.busStop = on;
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
    if (on && !t.owned) return false;
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

  /** True if any 4-connected neighbour of (x, y) is water (Alpha 2.19). */
  has4WaterNeighbour(x: number, y: number): boolean {
    const dirs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of dirs) {
      const t = this.get(x + dx, y + dy);
      if (t?.terrain === 'water') return true;
    }
    return false;
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
    if (zone !== 'none' && !t.owned) return false;
    if (zone !== 'none') {
      if (t.road) return false;
      // No zoning on water (Alpha 2.4) — buildings can't develop in lakes
      // or rivers. Bridges count as roads anyway and are caught above, but
      // re-check defensively in case a bridge tile loses its road bit.
      if (t.terrain === 'water') return false;
      if (t.bridge) return false;
      if (!this.hasRoadAdjacent(x, y)) return false;
    }
    const sameZone = t.zone === zone;
    const sameCap = t.zoneCap === cap;
    if (sameZone && sameCap) return false;
    const wasNone = t.zone === 'none';
    const wasLuxury = t.luxury;
    t.zone = zone;
    t.zoneCap = cap;
    if (zone === 'none') {
      t.resetDevelopment();
      // Luxury cleanup (Alpha 2.5) — when this tile leaves the zone, also
      // un-luxury its partner so we don't leave an orphan half-mansion.
      if (wasLuxury) {
        t.luxury = false;
        this.clearAdjacentLuxury(x, y);
      }
    } else if (wasNone || !sameZone) {
      // Switched zone kind (or zoned a fresh tile) — start over. If we
      // came from a luxury R into a non-luxury zone, also clear the
      // partner so the pair invariant holds.
      t.resetDevelopment();
      if (wasLuxury) {
        t.luxury = false;
        this.clearAdjacentLuxury(x, y);
      }
    }
    // Cap-only changes preserve current density. If the new cap is below
    // current density the tile is "grandfathered" — Development.tick won't
    // grow it further, but the existing building stays. Bulldoze to wipe.
    return true;
  }

  /**
   * Clear `luxury` on any 4-neighbour residential+luxury tile. Used by
   * `setZone` when a luxury tile drops out of the zone, so its partner
   * doesn't end up as an orphan half-mansion. Doesn't recurse — assumes
   * pairs are exactly two tiles.
   */
  private clearAdjacentLuxury(x: number, y: number): void {
    const dirs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of dirs) {
      const n = this.get(x + dx, y + dy);
      if (n && n.luxury && n.zone === 'residential') {
        n.luxury = false;
        n.resetDevelopment();
      }
    }
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
    if (b !== 'none' && !t.owned) return false;
    if (b !== 'none') {
      if (t.road || t.zone !== 'none' || t.building !== 'none') return false;
      // Forestry-specific: only on forest terrain (Alpha 2.7).
      if (b === 'forestry' && t.terrain !== 'forest') return false;
      // Farm-specific: only on grass terrain (Alpha 2.7.1).
      if (b === 'farm' && t.terrain !== 'grass') return false;
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

  // ---- Upper-layer (Bridge Mode) road edge graph (Alpha 2.12) ----------

  /**
   * Set/clear an UPPER-LAYER road edge between two adjacent tiles.
   * Independent from the ground edge graph — both layers can co-exist
   * on the same tile-pair so an overpass crosses an at-grade road
   * without forming an intersection.
   */
  setBridgeRoadEdge(
    ax: number, ay: number, bx: number, by: number,
    on: boolean,
    type: RoadType = 'local'
  ): boolean {
    if (!this.inBounds(ax, ay) || !this.inBounds(bx, by)) return false;
    const dx = bx - ax;
    const dy = by - ay;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
    const key = this.edgeKey(ax, ay, bx, by);
    const ta = this.get(ax, ay);
    const tb = this.get(bx, by);
    if (on) {
      if (ta) { ta.bridgeRoad = true; ta.bridgeRoadType = type; }
      if (tb) { tb.bridgeRoad = true; tb.bridgeRoadType = type; }
      if (this.bridgeRoadEdges.has(key)) return false;
      this.bridgeRoadEdges.add(key);
      return true;
    } else {
      if (!this.bridgeRoadEdges.has(key)) return false;
      this.bridgeRoadEdges.delete(key);
      // Demote tiles to non-bridge-road only if they have no remaining
      // upper-layer edges.
      if (!this.tileHasAnyBridgeEdge(ax, ay) && ta) {
        ta.bridgeRoad = false;
        ta.bridgeRoadType = 'local';
        ta.bridgeHighwayDir = -1;
      }
      if (!this.tileHasAnyBridgeEdge(bx, by) && tb) {
        tb.bridgeRoad = false;
        tb.bridgeRoadType = 'local';
        tb.bridgeHighwayDir = -1;
      }
      return true;
    }
  }

  hasBridgeRoadEdge(ax: number, ay: number, bx: number, by: number): boolean {
    return this.bridgeRoadEdges.has(this.edgeKey(ax, ay, bx, by));
  }

  *iterBridgeRoadEdges(): IterableIterator<RoadEdge> {
    for (const key of this.bridgeRoadEdges) {
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

  loadBridgeRoadEdges(edges: readonly number[]): void {
    this.bridgeRoadEdges.clear();
    for (let i = 0; i + 3 < edges.length; i += 4) {
      const ax = edges[i]!;
      const ay = edges[i + 1]!;
      const bx = edges[i + 2]!;
      const by = edges[i + 3]!;
      if (!this.inBounds(ax, ay) || !this.inBounds(bx, by)) continue;
      this.bridgeRoadEdges.add(this.edgeKey(ax, ay, bx, by));
      const ta = this.get(ax, ay);
      if (ta) ta.bridgeRoad = true;
      const tb = this.get(bx, by);
      if (tb) tb.bridgeRoad = true;
    }
  }

  private tileHasAnyBridgeEdge(x: number, y: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        if (this.bridgeRoadEdges.has(this.edgeKey(x, y, nx, ny))) return true;
      }
    }
    return false;
  }

  /** Number of upper-layer road edges incident to (x, y). */
  incidentBridgeRoadEdgeCount(x: number, y: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        if (this.bridgeRoadEdges.has(this.edgeKey(x, y, nx, ny))) n++;
      }
    }
    return n;
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
