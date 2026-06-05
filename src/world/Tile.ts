import type { Building, RoadType, TerrainType, Zone } from '../types';

/**
 * A single tile on the grid. `road` is true when *anything road-related*
 * occupies this cell — either as an endpoint of a road edge or as a
 * standalone stub. When `road` is true, `roadType` describes the tier
 * (local / avenue / highway) and, for highways, `highwayDir` carries the
 * flow direction. `zone` is mutually exclusive with road on the same cell.
 *
 * All fields must stay JSON-serializable for save games.
 */
export class Tile {
  /** Tile X coordinate. Writable as of Alpha 3.2.3 so Grid.expandWorld can
   *  shift existing tiles when the grid grows (was readonly before). */
  x: number;
  /** Tile Y coordinate. See `x` for the same caveat. */
  y: number;
  terrain: TerrainType;
  /**
   * Terrain elevation in tile units (Alpha 2.3). 0 = ground level, water
   * sits at slightly negative, hills go up to ~0.5. Used by the terrain
   * mesh builder (corner vertices average the four meeting tiles' values
   * for smooth ramps) and by future systems that might gate gameplay on
   * slope. Roads currently render flat at ROAD_LIFT regardless — paving
   * still works on hills, it just doesn't follow the slope visually yet.
   */
  elevation = 0;
  road = false;
  /**
   * Bridge bit (Alpha 2.3). True when this road tile spans water — the
   * renderer elevates the road plane and drops two short pillars to the
   * water surface. Set automatically by `Grid.setRoad` when called on a
   * water tile; cleared when the road is removed.
   */
  bridge = false;
  /**
   * Upper-layer road (Alpha 2.12, Bridge Mode). Independent from the
   * ground `road` bit — both layers can co-exist on a single tile so
   * an overpass crosses an at-grade road without forming an
   * intersection. Renderer lifts the upper deck to BRIDGE_LIFT and
   * drops support pillars to the ground.
   *
   * v1 (Alpha 2.12): the upper-layer road has its own edge set in
   * `Grid.bridgeRoadEdges` for future routing, but vehicles still
   * spawn / route on the ground layer only — overpasses are visual
   * + structural, not yet drivable. A later pass will wire layer-
   * aware RoadGraph + Vehicles routing.
   */
  bridgeRoad = false;
  bridgeRoadType: RoadType = 'local';
  bridgeHighwayDir = -1;
  /** Road tier when `road` is true. Reset to 'local' when `road` flips off. */
  roadType: RoadType = 'local';
  /** Highway flow direction (0..7 from `Dir` enum), -1 when not a highway or
   *  direction is unset. Cars on a highway tile only travel in this direction. */
  highwayDir = -1;
  /** Player-placed stop sign on this road tile. Only meaningful at intersections. */
  stopSign = false;
  /**
   * Player-placed traffic light on this intersection (Alpha 2.0). Mutually
   * exclusive with stopSign. Per-tile dynamic state (current phase, queue
   * estimates) lives in {@link TrafficLights} — the bool here is the
   * persistent placement flag.
   */
  trafficLight = false;
  /**
   * Bus stop attached to this road tile (Alpha 2.0). Renders as a sidewalk
   * fixture, doesn't block car traffic. Different from `Tile.building ===
   * 'bus_stop'` which is the older standalone-tile form (still supported
   * for save-game compat). Both forms count for `nearBusStop` suppression
   * and bus-route waypoints.
   */
  busStop = false;
  /**
   * Walking-path bit (Alpha 1.6). Per-tile, no edge graph — pedestrians treat
   * paths as 4-connected walkable surfaces. Mutually exclusive with road
   * (paths refuse to overwrite roads); CAN sit on top of zoned tiles, in
   * which case painting clears the zone first. Never settable on a road tile.
   */
  path = false;
  zone: Zone = 'none';
  /**
   * Player-set density cap (1..3) — the upper bound this tile is *permitted*
   * to grow to. 0 means unzoned. Effective max density is the minimum of
   * this and the services-allowed cap (services still gate L3). Memory:
   * feedback_zone_tier_permissions.
   */
  zoneCap: 0 | 1 | 2 | 3 | 4 = 0;
  /**
   * Luxury low-density bit (Alpha 2.5). When true and `zone === 'residential'`,
   * this tile is part of a 2-tile luxury home pair. The partner is whichever
   * 4-neighbour tile also has `luxury` true; bulldozing one auto-clears the
   * other. Luxury tiles never grow past density 1 (zoneCap stays 1), house
   * fewer residents per tile, but pay a premium tax rate and bias the
   * faction-population mix toward NIMBYs.
   */
  luxury = false;
  /** 0 = no building yet, 1..3 = low / medium / high density. */
  density = 0;
  /** Sim-tick accumulator. Crossing 1.0 promotes density by one tier. */
  developmentPressure = 0;
  /**
   * Months-elapsed value at the moment density first went 0 → 1 on this
   * tile (Alpha 2.16). Used by the Renderer to apply patina (a darkening
   * factor that scales with age) so older buildings read as weathered.
   * Reset to 0 on bulldoze + when a fresh paint cycle starts. Renovating
   * a building is just bulldoze + rezone — the new structure naturally
   * stamps a fresh `developedAt`.
   */
  developedAt = 0;
  /** City service building occupying this tile. Mutually exclusive with road and zone. */
  building: Building = 'none';
  // Service flags — derived state, recomputed by `Services.recompute` whenever
  // building placement changes. Don't write directly.
  hasPower = false;
  hasWater = false;
  hasPark = false;
  /** Public-services pack (Alpha 2.10). */
  hasSchool = false;
  hasHospital = false;
  hasFireProtection = false;
  hasPolice = false;

  constructor(x: number, y: number, terrain: TerrainType = 'grass') {
    this.x = x;
    this.y = y;
    this.terrain = terrain;
  }

  /** Wipe development progress — used when zone changes or a tile becomes road. */
  resetDevelopment(): void {
    this.density = 0;
    this.developmentPressure = 0;
    this.developedAt = 0;
  }

  resetServices(): void {
    this.hasPower = false;
    this.hasWater = false;
    this.hasPark = false;
    this.hasSchool = false;
    this.hasHospital = false;
    this.hasFireProtection = false;
    this.hasPolice = false;
  }

  // Traffic state — updated by Vehicles + Traffic systems on the main loop.
  // `trafficLoad` is the instantaneous count of cars currently occupying this
  // tile; `trafficLoadAvg` is an EMA used for the heatmap and demand
  // feedback so the signal doesn't strobe with individual cars.
  trafficLoad = 0;
  trafficLoadAvg = 0;
  /** District membership (Alpha 2.22). 0 = unassigned. Per-district tax
   *  surtaxes apply to revenue calculation when this is non-zero. */
  districtId = 0;
  /**
   * Skyscraper bit (Alpha 3.1.2). When true, this tile is part of a
   * 2×2 skyscraper footprint. The lex-smaller tile of the four (lowest
   * x, then lowest y) owns the rendered geometry; the other three are
   * marked-only. Skyscrapers go through 4 visual construction stages
   * over 12 sim months before they become "developed" — `density` stays
   * at 0 until stage 4 (built), at which point it goes straight to a
   * special skyscraper density that beats L3.
   */
  skyscraper = false;
  /** Construction progress for skyscrapers. 0 = freshly placed (foundation
   *  pit), 1..3 = intermediate stages, 4 = built (all four stages
   *  complete). Each stage takes 3 sim months. */
  skyscraperStage: 0 | 1 | 2 | 3 | 4 = 0;
  /** Variant index (0..7) for the 2×2 skyscraper (Alpha 3.2.0 — was 0..5
   *  before). Stamped on placement so the choice stays stable across
   *  re-renders. */
  skyscraperVariant: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 = 0;
  /**
   * Land ownership (Alpha 3.1.3). True = the player has claimed this
   * tile and may build on it; false = land for sale. The default is
   * `true` so existing behaviour and existing saves don't suddenly
   * lose access to half their map. New cities seed only a central
   * starter area as owned; the rest is "for sale" and must be bought
   * through the Land tool.
   */
  owned = true;
  /**
   * Mayor's Mansion bit (Alpha 4.2). When true, this tile is part of
   * the single 4×2 footprint mayor's mansion. The lex-smallest tile
   * (lowest x, then lowest y) is the *anchor* — its `building` field
   * holds `'mayor_mansion'`; the other seven tiles are marked-only
   * via this flag with `building='none'`. Bulldozing any of the 8
   * tiles tears down the entire showpiece (Game.bulldoze handles the
   * cleanup).
   *
   * Single-instance per city — `Game.placeMayorMansion` refuses if
   * any tile already has `mayorMansion=true`.
   */
  mayorMansion = false;
  /**
   * Civic-monument bits (Alpha 4.12). Same anchor pattern as
   * mayorMansion — the lex-smallest tile of the footprint is the
   * anchor and carries the matching `building` value (`'city_hall'`
   * / `'provincial_capital'` / `'national_capital'`); every other
   * tile in the rectangle has only the matching bit set with
   * `building = 'none'`. Bulldozing any tile in the footprint walks
   * back to the anchor and clears the entire rectangle.
   *
   * Each kind is single-instance per city — placement refuses if any
   * tile already has the matching bit set.
   */
  cityHall = false;
  provincialCapital = false;
  nationalCapital = false;
  /** Grand Stadium bit (Beta 1.10). Same anchor pattern as the civic
   *  monuments; the anchor carries `building = 'grand_stadium'`. */
  grandStadium = false;
  /**
   * Big-build rotation (Alpha 4.21). Only meaningful on the ANCHOR tile
   * of a multi-tile civic monument footprint (Mayor's Mansion / City
   * Hall / Provincial / National Capital). 0 = native orientation
   * (footprint extends right+down from anchor). Each step is 90° CW
   * rotation around the footprint center; for odd rotations (1, 3) the
   * world-space footprint dimensions swap (a 4×2 mansion at rot 1 is a
   * 2×4 footprint). Renderer rotates geometry by `-rot * π/2` around
   * the rotated footprint center. Old saves (schema ≤ 26) load with
   * rotation = 0 everywhere — backwards-compat.
   */
  bigBuildRotation: 0 | 1 | 2 | 3 = 0;
  /**
   * Highway interchange ramp bit (Alpha 4.16). When true, this tile is
   * a highway-to-local/avenue merge ramp:
   *  - Renders with merge chevrons + yellow stripes + EXIT signage so
   *    the player visually identifies it as an interchange.
   *  - Cars passing through skip stop signs and intersection collision
   *    rolls — it's a smooth merge, not a crossing — letting traffic
   *    flow seamlessly between highway and local/avenue tiers.
   * Set by placing the Ramp tool on a road tile that's 4-adjacent to
   * a highway AND a non-highway road (or is itself one of those, with
   * the other tier within reach). Cleared on bulldoze.
   */
  ramp = false;
  /**
   * Per-block placement bit (Alpha 4.15). When a big civic build (Mayor's
   * Mansion / City Hall / Provincial / National Capital) is placed via
   * the per-block flow, all footprint tiles get the matching kind-bit
   * set immediately to *reserve* the rectangle, but only individual
   * tiles the player has actually paid for get this bit set. The
   * renderer uses the combination:
   *   - reserved + paid + ALL footprint tiles paid → anchor's `building`
   *     field is set, anchor draws the merged finished geometry.
   *   - reserved + paid + some footprint tiles unpaid → this tile shows
   *     a per-tile construction site.
   *   - reserved + unpaid → ghost outline, only when the matching tool
   *     is active.
   * Legacy saves (schema ≤ 22) load with this defaulted to TRUE on any
   * footprint tile that has the kind-bit set, so previously-completed
   * buildings stay completed across the upgrade.
   */
  bigBuildBlockPaid = false;
  /**
   * Cloverleaf interchange bit (Alpha 4.17). When true, this tile is part
   * of a 5×5 cloverleaf prefab — a multi-tile interchange built via the
   * per-block placement system (extension of the bigBuild infrastructure
   * from Alpha 4.15). The lex-smallest tile of the 25-tile footprint
   * is the anchor, carrying `building = 'cloverleaf'` once all blocks
   * are paid; until then the anchor's `building` is `'none'` and the
   * renderer dispatches per-tile construction sites for paid blocks +
   * ghost web for unpaid blocks (matches monument flow).
   *
   * On completion the cloverleaf becomes a fully-functional interchange:
   * 4 cardinal endpoint tiles are highway road tiles the player
   * connects their roads to, internal loop tiles act as smooth-merge
   * ramps, and the remaining tiles render as grass infield + bridge
   * supports.
   */
  cloverleaf = false;
  /**
   * Supply chain (Beta 1.6). For developed commercial tiles + warehouse
   * tiles, this is the current inventory (0..1, normalised). Truck
   * arrivals refill it; SupplyChain.tick consumes a small amount each
   * sim month. When 0 on a commercial tile, that tile generates no tax
   * revenue (the store is "out of stock"). On warehouse tiles, 0 means
   * no goods to ship downstream — the warehouse stops dispatching
   * delivery trucks until industry restocks it. Unused on every other
   * building kind (residential, industrial, services, decoratives, etc).
   */
  supplies = 1;
  /**
   * Import-source flag (Beta 1.6). True when the most recent delivery
   * to this commercial tile came from a city-edge import truck rather
   * than from the city's own industry/warehouse network. Imports keep
   * the store open but apply a -25% revenue penalty (priced-in cost of
   * outsourced supply). Cleared on the next domestic delivery.
   */
  importSource = false;
}
