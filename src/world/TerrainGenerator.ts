import type { Tile } from './Tile';
import type { TerrainType } from '../types';

/**
 * Procedural terrain generator (Alpha 2.3).
 *
 * Replaces the original "6% sprinkled forest on grass" placeholder with a
 * believable map: rolling elevation, lakes carved out of the lowest
 * pockets, a meandering river that crosses the map edge-to-edge, and
 * forests clustered on mid-elevation grassland. Designed to read at the
 * chunky low-poly aesthetic — no texture-quality features, just gross
 * landform.
 *
 * Determinism: takes a seed (currently `Date.now()` from Game on a fresh
 * map) so a fresh world looks different each time but a saved world
 * round-trips through serialise/restore unchanged (the *result* is
 * persisted per-tile, not the seed).
 *
 * Algorithm:
 *  1. Two octaves of value noise → continuous elevation field.
 *  2. Threshold on elevation ⇒ low pockets become lakes (water).
 *  3. River: pick two opposite-edge points, walk a meandering path
 *     between them, carve those tiles to water below ground level.
 *  4. Forest: forest-noise + biome rule (mid-elevation grass).
 */

/**
 * Flat-terrain feature flag (Alpha 2.4.1). When true, the generator still
 * uses elevation noise to *decide* where lakes and forests go (so the map
 * still has natural-looking biome distribution), but every tile's
 * elevation is forced to 0 in the final spec — the map renders flat.
 *
 * Elevation introduced visual artifacts at tile boundaries (sidewalks
 * stepped, bridge ramps awkward, etc.) that we'd need a corner-shared
 * vertex-averaging approach to fully fix. Disabled until we have time
 * to do that pass. Flip back to false to re-enable rolling hills.
 *
 * All elevation-aware code in the renderer remains intact and reads
 * `tile.elevation` — it just sees 0 everywhere when this flag is on.
 */
const FLAT_TERRAIN = true;

interface GenOpts {
  seed: number;
  /** Probability that a given map gets a river (some maps stay landlocked). */
  riverChance?: number;
  /** Lake threshold — tiles with elevation noise below this become water. */
  lakeThreshold?: number;
  /** Forest threshold — tiles above this in forest noise become forest. */
  forestThreshold?: number;
}

const DEFAULTS: Required<Omit<GenOpts, 'seed'>> = {
  riverChance: 0.7,
  // Tuned so ~6-12% of tiles become lake.
  lakeThreshold: 0.18,
  // Tuned so ~12-18% of land tiles become forest.
  forestThreshold: 0.62
};

export interface GeneratedTileSpec {
  terrain: TerrainType;
  /** Elevation in tile units. Water is negative; land 0..0.5. */
  elevation: number;
}

/**
 * Build a per-tile terrain spec for a fresh map. Returns `width × height`
 * specs in row-major order; the caller writes them onto Tile objects.
 */
export function generateTerrain(width: number, height: number, opts: GenOpts): GeneratedTileSpec[] {
  const o = { ...DEFAULTS, ...opts };
  const seed = opts.seed >>> 0;
  // Three independent noise fields — we add small offsets to the seed so
  // the elevation, forest, and lake-jitter samples don't correlate.
  const elev = makeNoise2D(seed, 0.085);
  const forest = makeNoise2D(seed ^ 0x9e3779b9, 0.180);

  const out: GeneratedTileSpec[] = new Array(width * height);

  // First pass — base terrain from noise.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Two octaves of elevation noise + a continental falloff so the map
      // edges don't become un-buildable.
      const e1 = elev(x, y);
      const e2 = elev(x * 2.3 + 100, y * 2.3 + 100) * 0.5;
      const raw = (e1 + e2) / 1.5; // ~0..1
      // Map raw to elevation in tile units. Most tiles stay near 0
      // (gentle hills); a small fraction of high spots gets to ~0.5.
      // Subtract the lake threshold so low pockets go negative ⇒ water.
      const eValue = (raw - 0.5) * 0.6; // -0.30 .. +0.30 typical
      const isLake = raw < o.lakeThreshold;
      let terrain: TerrainType = 'grass';
      let elevation = isLake ? -0.10 - (o.lakeThreshold - raw) * 0.6 : eValue;
      if (isLake) {
        terrain = 'water';
        // Sand at the shoreline — done in second pass.
      } else {
        // Forest noise on mid-elevation grass.
        const f = forest(x, y);
        if (f > o.forestThreshold && elevation > -0.05 && elevation < 0.25) {
          terrain = 'forest';
        }
      }
      out[y * width + x] = { terrain, elevation };
    }
  }

  // Second pass — carve a river if we rolled it. Random opposite-edge
  // start/end points; meander via biased random walk until we hit the
  // far edge. Each river tile becomes shallow water and pulls neighbour
  // tiles to a sandy shoreline.
  const rng = mulberry32(seed ^ 0xb5297a4d);
  if (rng() < o.riverChance) {
    carveRiver(out, width, height, rng);
  }

  // Third pass — sand around water. Any grass tile with a 4-neighbour
  // water tile becomes sand to suggest a beach/shore.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = out[i]!;
      if (t.terrain !== 'grass') continue;
      if (hasNeighbourTerrain(out, width, height, x, y, 'water')) {
        t.terrain = 'sand';
        // Beach edge — slightly above ground level so the sand band
        // reads as a strip, not flat with the rest of the lawn.
        if (t.elevation < 0.02) t.elevation = 0.02;
      }
    }
  }

  // Fourth pass — flatten if the feature flag is on. Biome assignment
  // (lake/river/forest/sand) above already used the noise; now we throw
  // away the elevation values so the map renders flat.
  if (FLAT_TERRAIN) {
    for (let i = 0; i < out.length; i++) {
      out[i]!.elevation = 0;
    }
  }

  return out;
}

export function isFlatTerrain(): boolean {
  return FLAT_TERRAIN;
}

/**
 * Apply a generated spec to a Tile. Convenience for the Grid's first-time
 * population pass.
 */
export function applySpec(tile: Tile, spec: GeneratedTileSpec): void {
  tile.terrain = spec.terrain;
  tile.elevation = spec.elevation;
}

// ---- River carving --------------------------------------------------

function carveRiver(out: GeneratedTileSpec[], w: number, h: number, rng: () => number): void {
  // Pick two opposite edges and a starting point on each.
  const horizontal = rng() < 0.5;
  let x0: number, y0: number, x1: number, y1: number;
  if (horizontal) {
    y0 = Math.floor(rng() * (h - 4)) + 2;
    y1 = Math.floor(rng() * (h - 4)) + 2;
    x0 = 0; x1 = w - 1;
  } else {
    x0 = Math.floor(rng() * (w - 4)) + 2;
    x1 = Math.floor(rng() * (w - 4)) + 2;
    y0 = 0; y1 = h - 1;
  }
  // Walk from (x0,y0) toward (x1,y1) with meandering steps. At each
  // step move 1 unit toward the goal in the dominant axis with chance
  // 0.7, otherwise step perpendicular for the meander. Carve a 2-tile
  // wide channel.
  let x = x0, y = y0;
  let steps = 0;
  const maxSteps = (w + h) * 3;
  while (steps++ < maxSteps && (x !== x1 || y !== y1)) {
    carveRiverCell(out, w, h, x, y);
    // Width — also carve one perpendicular neighbour for a 2-wide river.
    if (horizontal) carveRiverCell(out, w, h, x, y + 1);
    else carveRiverCell(out, w, h, x + 1, y);
    const dx = Math.sign(x1 - x);
    const dy = Math.sign(y1 - y);
    if (horizontal) {
      // Mostly step east/west, occasionally up/down for meander.
      if (rng() < 0.7 && dx !== 0) x += dx;
      else if (dy !== 0) y += dy;
      else if (dx !== 0) x += dx;
    } else {
      if (rng() < 0.7 && dy !== 0) y += dy;
      else if (dx !== 0) x += dx;
      else if (dy !== 0) y += dy;
    }
  }
  carveRiverCell(out, w, h, x1, y1);
}

function carveRiverCell(out: GeneratedTileSpec[], w: number, h: number, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const t = out[y * w + x]!;
  t.terrain = 'water';
  // Rivers sit slightly higher than lake bottoms so they read as
  // shallow flowing water vs deep stagnant water.
  t.elevation = -0.06;
}

// ---- Helpers --------------------------------------------------------

function hasNeighbourTerrain(out: GeneratedTileSpec[], w: number, h: number, x: number, y: number, kind: TerrainType): boolean {
  const nbr = [
    [0, -1], [1, 0], [0, 1], [-1, 0]
  ] as const;
  for (const [dx, dy] of nbr) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (out[ny * w + nx]!.terrain === kind) return true;
  }
  return false;
}

/**
 * Tiny seeded PRNG — Mulberry32. Plenty random for terrain, fits in a
 * dozen lines, no dep.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cheap 2D value noise — interpolated lattice samples driven by a
 * Mulberry32 RNG keyed off the integer lattice point. Smooth-ish
 * (bilinear) so the elevation field doesn't look pixelated.
 */
function makeNoise2D(seed: number, freq: number): (x: number, y: number) => number {
  const rng = mulberry32(seed);
  // Pre-compute a small lattice and tile it with hashing for any (x,y).
  // Cheaper than per-sample seeding.
  const LATTICE_SIZE = 256;
  const lattice = new Float32Array(LATTICE_SIZE * LATTICE_SIZE);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const sample = (ix: number, iy: number): number => {
    const x = ((ix % LATTICE_SIZE) + LATTICE_SIZE) % LATTICE_SIZE;
    const y = ((iy % LATTICE_SIZE) + LATTICE_SIZE) % LATTICE_SIZE;
    return lattice[y * LATTICE_SIZE + x]!;
  };
  return (x: number, y: number) => {
    const fx = x * freq;
    const fy = y * freq;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const a = sample(ix, iy);
    const b = sample(ix + 1, iy);
    const c = sample(ix, iy + 1);
    const d = sample(ix + 1, iy + 1);
    // Smoothstep for bilinear quality without the visual stripes.
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const ab = a + (b - a) * sx;
    const cd = c + (d - c) * sx;
    return ab + (cd - ab) * sy;
  };
}
