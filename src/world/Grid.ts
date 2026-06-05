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
  /** Grid width in tiles. Writable as of Alpha 3.2.3 so expandWorld can
   *  grow the map at runtime (was readonly before). */
  width: number;
  /** Grid height in tiles. See `width`. */
  height: number;
  /** Backing tile array. Writable as of Alpha 3.2.3 so expandWorld can
   *  swap in a resized array. */
  private tiles: Tile[];
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
    // Alpha 3.2.3: city bounds cover the entire grid at start. The grid
    // itself grows on demand via expandWorld, so there's no longer an
    // unowned ring — fresh starts get a fully-claimed playable area
    // matching the requested MAP_SIZE, and "+" buttons sit just past
    // the grid edges (in world space) to grow the world further.
    this.cityBoundsX0 = 0;
    this.cityBoundsX1 = this.width - 1;
    this.cityBoundsY0 = 0;
    this.cityBoundsY1 = this.height - 1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const spec = specs[y * this.width + x]!;
        const tile = new Tile(x, y, spec.terrain);
        tile.elevation = spec.elevation;
        tile.owned = true;
        this.tiles[y * this.width + x] = tile;
      }
    }
  }

  /** True iff (x, y) is inside the current cityBounds rectangle. */
  isWithinBounds(x: number, y: number): boolean {
    return x >= this.cityBoundsX0 && x <= this.cityBoundsX1
        && y >= this.cityBoundsY0 && y <= this.cityBoundsY1;
  }

  /** Grow the underlying grid by `amount` tiles in `direction` (Alpha 3.2.3).
   *  This is a real grid resize — it reallocates the tile array, shifts
   *  existing tiles to their new coordinates (when growing N or W), and
   *  generates fresh terrain for the newly-added strip. All road / bridge
   *  edges get re-packed against the new width. Returns the {offsetX,
   *  offsetY} that existing tiles shifted by — caller (Game) uses this
   *  to translate the camera target so the visual position doesn't jump.
   *
   *  After this call ALL downstream systems that index by tile position
   *  (RoadGraph / PathGraph / TrafficLights / Vehicles / Buses / Pedestrians /
   *  Ferries / Skyscrapers / Renderer meshes) are stale and must be
   *  rebuilt. Game.expandCity orchestrates that rebuild via afterStateRestore. */
  expandWorld(direction: 'N' | 'S' | 'E' | 'W', amount: number): { offsetX: number; offsetY: number } {
    const offsetX = direction === 'W' ? amount : 0;
    const offsetY = direction === 'N' ? amount : 0;
    const oldWidth = this.width;
    const oldHeight = this.height;
    const newWidth = oldWidth + (direction === 'E' || direction === 'W' ? amount : 0);
    const newHeight = oldHeight + (direction === 'N' || direction === 'S' ? amount : 0);

    // Capture old edges (with their road type) BEFORE we change `width`.
    type EdgeSnap = { ax: number; ay: number; bx: number; by: number };
    const groundEdges: EdgeSnap[] = [];
    for (const e of this.iterRoadEdges()) groundEdges.push({ ...e });
    const bridgeEdges: EdgeSnap[] = [];
    for (const e of this.iterBridgeRoadEdges()) bridgeEdges.push({ ...e });
    this.roadEdges.clear();
    this.bridgeRoadEdges.clear();

    // Reallocate tile array. Existing tiles shift to (x+offsetX, y+offsetY);
    // newly-added regions are populated with fresh terrain.
    const newTiles = new Array<Tile>(newWidth * newHeight);
    const oldTiles = this.tiles;
    for (let y = 0; y < oldHeight; y++) {
      for (let x = 0; x < oldWidth; x++) {
        const t = oldTiles[y * oldWidth + x]!;
        const nx = x + offsetX;
        const ny = y + offsetY;
        t.x = nx;
        t.y = ny;
        newTiles[ny * newWidth + nx] = t;
      }
    }
    // Generate fresh terrain for the newly-added strip. We seed with the
    // expansion direction + amount so the new region is reproducible
    // across reloads (alongside the per-tile snapshot the save persists).
    const specs = generateTerrain(newWidth, newHeight, { seed: Date.now() ^ (newWidth * 31) });
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        if (newTiles[y * newWidth + x]) continue; // existing tile
        const spec = specs[y * newWidth + x]!;
        const tile = new Tile(x, y, spec.terrain);
        tile.elevation = spec.elevation;
        tile.owned = false; // newly-added land starts as owned by the player
                             // who paid for the expansion (toggled below).
        newTiles[y * newWidth + x] = tile;
      }
    }

    this.tiles = newTiles;
    this.width = newWidth;
    this.height = newHeight;

    // Shift cityBounds with the offset, then expand on the new edge to
    // include the newly-added strip — that's what the player paid for.
    this.cityBoundsX0 += offsetX;
    this.cityBoundsX1 += offsetX;
    this.cityBoundsY0 += offsetY;
    this.cityBoundsY1 += offsetY;
    if (direction === 'N') this.cityBoundsY0 = Math.max(0, this.cityBoundsY0 - amount);
    else if (direction === 'S') this.cityBoundsY1 = Math.min(newHeight - 1, this.cityBoundsY1 + amount);
    else if (direction === 'W') this.cityBoundsX0 = Math.max(0, this.cityBoundsX0 - amount);
    else this.cityBoundsX1 = Math.min(newWidth - 1, this.cityBoundsX1 + amount);

    // Mark the newly-included tiles (within the expanded bounds) as owned.
    for (let y = this.cityBoundsY0; y <= this.cityBoundsY1; y++) {
      for (let x = this.cityBoundsX0; x <= this.cityBoundsX1; x++) {
        const t = newTiles[y * newWidth + x];
        if (t) t.owned = true;
      }
    }

    // Re-pack edges with the new width + shifted coords.
    for (const e of groundEdges) {
      const t = this.get(e.ax + offsetX, e.ay + offsetY);
      const tier = t?.roadType ?? 'local';
      this.setRoadEdge(e.ax + offsetX, e.ay + offsetY, e.bx + offsetX, e.by + offsetY, true, tier);
    }
    for (const e of bridgeEdges) {
      const t = this.get(e.ax + offsetX, e.ay + offsetY);
      const tier = t?.bridgeRoadType ?? 'local';
      this.setBridgeRoadEdge(e.ax + offsetX, e.ay + offsetY, e.bx + offsetX, e.by + offsetY, true, tier);
    }

    return { offsetX, offsetY };
  }

  /** Always true (Alpha 3.2.3) — the grid grows on demand, so there's no
   *  hard cap on direction. Kept as a method so renderers / UI that
   *  asked the old in-bounds question still compile. */
  canExpand(_direction: 'N' | 'S' | 'E' | 'W'): boolean {
    return true;
  }

  /** Resize the backing tile array to match a saved snapshot (Alpha 3.2.3).
   *  Allocates `width × height` blank Tile instances at default state;
   *  the SaveGame.applySave loop will overwrite each one's fields with
   *  the saved data. Edges are NOT preserved here — applySave reloads
   *  them from the snapshot.
   *
   *  Bounds-checked (Beta 1.0.7) — clamps to [8, 512] on each axis so a
   *  malicious portable city code with `width: 100000` can't OOM the
   *  recipient's browser by allocating billions of Tile instances. The
   *  largest legitimate map (Large preset) is 256×256, so 512 leaves
   *  headroom for grid-expansion players who've grown the map. */
  resizeForLoad(width: number, height: number): void {
    const safeW = Math.max(8, Math.min(512, Math.floor(Number(width) || 0)));
    const safeH = Math.max(8, Math.min(512, Math.floor(Number(height) || 0)));
    this.width = safeW;
    this.height = safeH;
    this.tiles = new Array<Tile>(safeW * safeH);
    for (let y = 0; y < safeH; y++) {
      for (let x = 0; x < safeW; x++) {
        this.tiles[y * safeW + x] = new Tile(x, y);
      }
    }
    this.roadEdges.clear();
    this.bridgeRoadEdges.clear();
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
      t.ramp = false;   // Alpha 4.16 — ramp bit is a road attachment
      // Bridge bit (Beta 1.1.3 fix). Pre-fix this stayed `true` after a
      // bridge was bulldozed, which made the tile permanently un-zoneable
      // / un-terraformable / un-monumentable (every placement check
      // includes `if (t.bridge) return false`). Player report:
      // "When a bridge is made it's hard to change the ground afterneath
      // even after demoing it." Clearing on road removal restores the
      // tile to a plain water tile that the player can fill / re-pave.
      t.bridge = false;
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

  /** True if any 4-connected neighbour of (x, y) is non-water land
   *  (Alpha 4.0). Used by the pier placement gate — a pier sits on
   *  water, but must touch the shore. */
  has4LandNeighbour(x: number, y: number): boolean {
    const dirs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of dirs) {
      const t = this.get(x + dx, y + dy);
      if (t && t.terrain !== 'water') return true;
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
  setZone(x: number, y: number, zone: Zone, cap: 0 | 1 | 2 | 3 | 4 = 0): boolean {
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
    const wasLuxurySingle = t.luxurySingle;
    t.zone = zone;
    t.zoneCap = cap;
    if (zone === 'none') {
      t.resetDevelopment();
      // Luxury cleanup (Alpha 2.5) — when this tile leaves the zone, also
      // un-luxury its partner so we don't leave an orphan half-mansion.
      if (wasLuxury) {
        t.luxury = false;
        t.luxurySingle = false;
        // A single-tile estate (Beta 1.10) has no partner to clear.
        if (!wasLuxurySingle) this.clearAdjacentLuxury(x, y);
      }
    } else if (wasNone || !sameZone) {
      // Switched zone kind (or zoned a fresh tile) — start over. If we
      // came from a luxury R into a non-luxury zone, also clear the
      // partner so the pair invariant holds.
      t.resetDevelopment();
      if (wasLuxury) {
        t.luxury = false;
        t.luxurySingle = false;
        // A single-tile estate (Beta 1.10) has no partner to clear.
        if (!wasLuxurySingle) this.clearAdjacentLuxury(x, y);
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
      // Only clear a PAIR partner — a single-tile estate is its own home.
      if (n && n.luxury && !n.luxurySingle && n.zone === 'residential') {
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

  unpackEdgeKey(key: number): { ax: number; ay: number; bx: number; by: number } {
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
      // Beta 1.6.16 — capture each setRoad's return value so a tier
      // upgrade on an already-connected pair (e.g. painting avenue over
      // an existing local edge) propagates "state changed" upward. Pre-
      // 1.6.16 this short-circuited to `return false` whenever the edge
      // bit was already set, so the caller's roadsChanged flag stayed
      // false and the renderer never rebuilt — players saw their freshly
      // upgraded tier only after some unrelated next placement triggered
      // a redraw.
      const aChanged = this.setRoad(ax, ay, true, type);
      const bChanged = this.setRoad(bx, by, true, type);
      if (this.roadEdges.has(key)) return aChanged || bChanged;
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
      // Beta 1.6.16 — track per-endpoint tier change so a tier upgrade on
      // an already-connected bridge edge still reports "state changed"
      // and the caller rebuilds the bridge-road mesh (same fix as
      // setRoadEdge above).
      let tierChanged = false;
      if (ta) {
        if (!ta.bridgeRoad || ta.bridgeRoadType !== type) tierChanged = true;
        ta.bridgeRoad = true;
        ta.bridgeRoadType = type;
      }
      if (tb) {
        if (!tb.bridgeRoad || tb.bridgeRoadType !== type) tierChanged = true;
        tb.bridgeRoad = true;
        tb.bridgeRoadType = type;
      }
      if (this.bridgeRoadEdges.has(key)) return tierChanged;
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

  edgeKey(ax: number, ay: number, bx: number, by: number): number {
    const ai = ay * this.width + ax;
    const bi = by * this.width + bx;
    const lo = ai < bi ? ai : bi;
    const hi = ai < bi ? bi : ai;
    return hi * PACK_SHIFT + lo;
  }
}
