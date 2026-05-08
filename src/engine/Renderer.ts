import { Container, Graphics } from 'pixi.js';
import type { Grid } from '../world/Grid';
import { TILE_HEIGHT, TILE_WIDTH, type TerrainType } from '../types';

/**
 * Per-terrain palette. Stroke is darker than fill; we draw it inside the
 * polygon to keep tiles seamless.
 */
const TERRAIN_PALETTE: Record<TerrainType, { fill: number; stroke: number }> = {
  grass: { fill: 0x4a7c3a, stroke: 0x365828 },
  forest: { fill: 0x2d5a26, stroke: 0x1d3c18 },
  water: { fill: 0x2a6da8, stroke: 0x1a4d78 },
  sand: { fill: 0xd4b770, stroke: 0xa48a4a }
};

/**
 * Renderer owns the world Container that the Camera transforms. For Step 2,
 * we render the entire grid into a single Graphics — Pixi v8 batches the
 * polygons into one draw call, which is plenty fast for 64×64 (4 096 tiles)
 * and handles the medium 128×128 (16 384) too. We'll switch to chunked
 * RenderTextures or a sprite atlas when we hit perf cliffs at large sizes.
 */
export class Renderer {
  readonly worldContainer = new Container();
  private readonly tileLayer = new Graphics();

  constructor() {
    this.worldContainer.addChild(this.tileLayer);
    // We don't need per-tile hit testing yet, and disabling lets Pixi skip
    // event work for thousands of polygons.
    this.tileLayer.eventMode = 'none';
  }

  /** Convert grid (gx, gy) to world-space (pre-camera) screen coords. */
  static gridToWorld(gx: number, gy: number): { x: number; y: number } {
    return {
      x: (gx - gy) * (TILE_WIDTH / 2),
      y: (gx + gy) * (TILE_HEIGHT / 2)
    };
  }

  /** Bake the whole grid into the tile layer. Call once per terrain change. */
  drawGrid(grid: Grid): void {
    const g = this.tileLayer;
    g.clear();

    const hw = TILE_WIDTH / 2;
    const hh = TILE_HEIGHT / 2;

    for (const tile of grid.iter()) {
      const { x: wx, y: wy } = Renderer.gridToWorld(tile.x, tile.y);
      const palette = TERRAIN_PALETTE[tile.terrain];

      // Diamond, clockwise from top.
      g.poly([
        wx,        wy - hh,
        wx + hw,   wy,
        wx,        wy + hh,
        wx - hw,   wy
      ]);
      g.fill({ color: palette.fill });
      // Default-aligned (0.5) stroke — at full zoom this gives a clean
      // 1px diamond outline. Adjacent strokes overlap with the same color,
      // so no visible doubling.
      g.stroke({ width: 1, color: palette.stroke });
    }
  }

  applyCamera(cam: { x: number; y: number; zoom: number }): void {
    this.worldContainer.position.set(cam.x, cam.y);
    this.worldContainer.scale.set(cam.zoom, cam.zoom);
  }
}
