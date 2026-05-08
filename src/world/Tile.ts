import type { TerrainType } from '../types';

/**
 * A single tile on the grid. Intentionally minimal at this stage — later
 * milestones will attach zoning, building, road, and overlay state.
 */
export class Tile {
  readonly x: number;
  readonly y: number;
  terrain: TerrainType;

  constructor(x: number, y: number, terrain: TerrainType = 'grass') {
    this.x = x;
    this.y = y;
    this.terrain = terrain;
  }
}
