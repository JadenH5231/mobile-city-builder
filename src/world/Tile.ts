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
  readonly x: number;
  readonly y: number;
  terrain: TerrainType;
  road = false;
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
  zoneCap: 0 | 1 | 2 | 3 = 0;
  /** 0 = no building yet, 1..3 = low / medium / high density. */
  density = 0;
  /** Sim-tick accumulator. Crossing 1.0 promotes density by one tier. */
  developmentPressure = 0;
  /** City service building occupying this tile. Mutually exclusive with road and zone. */
  building: Building = 'none';
  // Service flags — derived state, recomputed by `Services.recompute` whenever
  // building placement changes. Don't write directly.
  hasPower = false;
  hasWater = false;
  hasPark = false;

  constructor(x: number, y: number, terrain: TerrainType = 'grass') {
    this.x = x;
    this.y = y;
    this.terrain = terrain;
  }

  /** Wipe development progress — used when zone changes or a tile becomes road. */
  resetDevelopment(): void {
    this.density = 0;
    this.developmentPressure = 0;
  }

  resetServices(): void {
    this.hasPower = false;
    this.hasWater = false;
    this.hasPark = false;
  }

  // Traffic state — updated by Vehicles + Traffic systems on the main loop.
  // `trafficLoad` is the instantaneous count of cars currently occupying this
  // tile; `trafficLoadAvg` is an EMA used for the heatmap and demand
  // feedback so the signal doesn't strobe with individual cars.
  trafficLoad = 0;
  trafficLoadAvg = 0;
}
