import { Tile } from './Tile';
import type { TerrainType } from '../types';

/**
 * Grid stores tiles in a flat row-major Float32-backed-style array of Tile
 * objects. We keep a typed array on the side for terrain so that simulation
 * passes (later) can iterate without touching object headers.
 */
export class Grid {
  readonly width: number;
  readonly height: number;
  private readonly tiles: Tile[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Array(width * height);
    this.generate();
  }

  /**
   * Deterministic placeholder generator. Mostly grass with sprinkled forests
   * — gives the eye something to anchor on while we test camera + zoom.
   * Replace with a real noise-based generator in MapGenerator later.
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
    // Cheap deterministic hash → 0..99 bucket.
    const h = Math.abs(((x * 374761393) ^ (y * 668265263)) | 0) % 100;
    if (h < 6) return 'forest';
    return 'grass';
  }

  get(x: number, y: number): Tile | undefined {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return undefined;
    return this.tiles[y * this.width + x];
  }

  /** Iterate tiles in row-major order. */
  *iter(): IterableIterator<Tile> {
    for (let i = 0; i < this.tiles.length; i++) yield this.tiles[i]!;
  }
}
