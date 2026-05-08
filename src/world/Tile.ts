import type { Building, TerrainType, Zone } from '../types';

/**
 * A single tile on the grid. `road` is true when *anything road-related*
 * occupies this cell — either as an endpoint of a road edge or as a
 * standalone stub. The actual graph topology lives on Grid as a set of
 * edges between adjacent tiles (4- or 8-connected). `zone` is mutually
 * exclusive with road on the same cell: a zoned tile can't be a road and
 * vice versa, enforced by Grid.setZone / setRoadEdge.
 *
 * All fields must stay JSON-serializable for save games.
 */
export class Tile {
  readonly x: number;
  readonly y: number;
  terrain: TerrainType;
  road = false;
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
