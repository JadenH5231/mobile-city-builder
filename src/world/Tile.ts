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
  zone: Zone = 'none';
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
