// Shared types and constants. Kept dependency-free so any module can import freely.

/**
 * Tile diamond dimensions in *world* (pre-camera) pixels at zoom = 1.
 * 2:1 width:height is the classic isometric ratio.
 */
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;

export type TerrainType = 'grass' | 'forest' | 'water' | 'sand';

export interface MapSize {
  readonly width: number;
  readonly height: number;
}

export const MAP_SIZES: Record<'small' | 'medium' | 'large', MapSize> = {
  small: { width: 64, height: 64 },
  medium: { width: 128, height: 128 },
  large: { width: 256, height: 256 }
};
