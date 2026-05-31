import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  SRGBColorSpace
} from 'three';
import type { Grid } from '../../world/Grid';
import {
  buildCityHallParts,
  buildCloverleafParts,
  buildLuxuryParts,
  buildMayorMansionParts,
  buildNationalCapitalParts,
  buildProvincialCapitalParts,
  buildSkyscraperParts,
  buildVariantParts,
  getSkyscraperDesign,
  getVariantBodyFootprint,
  type VariantPart
} from '../BuildingVariants';
import {
  buildCNTowerParts,
  buildRogersCentreParts,
  buildScotiabankArenaParts,
  buildUnionStationParts,
  buildCasaLomaParts,
  buildROMParts,
  buildAGOParts,
  buildDistilleryParts,
  buildPearsonTerminalParts,
  buildRunwayParts
} from '../TorontoLandmarks';
import {
  DIR_OFFSETS,
  MAYOR_MANSION_WIDTH,
  MAYOR_MANSION_DEPTH,
  CITY_HALL_WIDTH,
  CITY_HALL_DEPTH,
  PROVINCIAL_CAPITAL_WIDTH,
  PROVINCIAL_CAPITAL_DEPTH,
  NATIONAL_CAPITAL_WIDTH,
  NATIONAL_CAPITAL_DEPTH,
  PATH_LIFT,
  PATH_WIDTH,
  BRIDGE_LIFT,
  ROAD_LIFT,
  ROAD_TIER,
  SIDEWALK_LIFT,
  SIDEWALK_PAD,
  TILE_SIZE,
  ZONE_LIFT,
  rotatedFootprint,
  type BigBuildRotation,
  type Zone
} from '../../types';
import { getActiveTheme, tint } from '../../themes/registry';

// THEME() accessor (mirrors Renderer.ts) — theme state can change at
// runtime, so never capture getActiveTheme() into a const at load.
function THEME() { return getActiveTheme(); }

// --- Terrain ------------------------------------------------------------

export function buildTerrainMesh(grid: Grid): Mesh {
  // Vertex-coloured plane covering the whole grid (Alpha 2.3 — corner
  // vertices average elevation across the up-to-4 tiles meeting there
  // so hills slope smoothly instead of stair-stepping). Each tile is
  // still 4 unique vertices so per-tile colour can vary, but Y values
  // are derived from the shared corner average, giving the visual of
  // shared corners without losing per-tile colour control.
  const totalTiles = grid.width * grid.height;
  const positions = new Float32Array(totalTiles * 4 * 3);
  const colours = new Float32Array(totalTiles * 4 * 3);
  const indices = new Uint32Array(totalTiles * 6);
  const c = new Color();

  // Pre-compute corner elevations: corner (cx, cy) sits at the meeting
  // of tiles (cx-1, cy-1), (cx, cy-1), (cx-1, cy), (cx, cy). Average
  // their elevations (treating off-map as 0).
  const cornerElev = (cx: number, cy: number): number => {
    let sum = 0;
    let n = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      sum += grid.get(nx, ny)!.elevation;
      n++;
    }
    return n === 0 ? 0 : sum / n;
  };

  let vi = 0;
  let ii = 0;
  let v = 0;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const tile = grid.get(x, y)!;
      // Tint by elevation: brighten hilltops, darken valleys for grass
      // so terrain reads as 3D even on flat-shaded vertex colours.
      // Theme-driven (Beta 1.2) — each pack defines its own grass/forest/
      // water/sand + hill highlight / valley tint values.
      const _terrain = THEME().terrain;
      const baseHex =
        tile.terrain === 'grass'  ? _terrain.grass  :
        tile.terrain === 'forest' ? _terrain.forest :
        tile.terrain === 'water'  ? _terrain.water  :
        tile.terrain === 'sand'   ? _terrain.sand   :
        _terrain.grass;
      if (tile.terrain === 'grass' && tile.elevation > 0.10) {
        c.setHex(_terrain.hillHighlight);
      } else if (tile.terrain === 'grass' && tile.elevation < -0.02) {
        c.setHex(_terrain.valleyTint);
      } else {
        c.setHex(baseHex);
      }

      const x0 = x * TILE_SIZE;
      const x1 = (x + 1) * TILE_SIZE;
      const z0 = y * TILE_SIZE;
      const z1 = (y + 1) * TILE_SIZE;
      // Four corner elevations (averaged across neighbours).
      const yNW = cornerElev(x,     y);
      const yNE = cornerElev(x + 1, y);
      const ySE = cornerElev(x + 1, y + 1);
      const ySW = cornerElev(x,     y + 1);

      positions[vi++] = x0; positions[vi++] = yNW; positions[vi++] = z0;
      positions[vi++] = x1; positions[vi++] = yNE; positions[vi++] = z0;
      positions[vi++] = x1; positions[vi++] = ySE; positions[vi++] = z1;
      positions[vi++] = x0; positions[vi++] = ySW; positions[vi++] = z1;

      for (let i = 0; i < 4; i++) {
        colours[v * 3 + i * 3 + 0] = c.r;
        colours[v * 3 + i * 3 + 1] = c.g;
        colours[v * 3 + i * 3 + 2] = c.b;
      }

      // CCW from above so normals point +Y (up) and the face survives
      // back-face culling against the camera that's looking down.
      indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
      indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
      v += 4;
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normal computation (Alpha 2.5 perf pass).

  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(geom, mat);
}

// --- Trees --------------------------------------------------------------

export function buildTreesMesh(grid: Grid): Mesh | null {
  // Tree variety (Alpha 2.2). Each forest tile deterministically picks
  // one of three silhouettes:
  //   0 — cone tree: broad single cone on a stout trunk (the original)
  //   1 — pine tree: narrow tall cone with a stacked smaller cone
  //   2 — round tree: low sphere-ish foliage on a short trunk
  // Plus subtle per-tile variation in trunk height, leaf scale, and
  // foliage tint so a forest reads as woodland rather than a uniform
  // stamp pattern.
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];
  for (const t of grid.iter()) {
    if (t.terrain !== 'forest') continue;
    const r = Math.abs(((t.x * 374761393) ^ (t.y * 668265263)) | 0);
    const ox = ((r % 1000) / 1000 - 0.5) * 0.4;
    const oz = (((r >> 10) % 1000) / 1000 - 0.5) * 0.4;
    const rot = ((r >> 20) % 1000) / 1000 * Math.PI * 2;
    const variant = (r >> 8) % 3;
    // Scale wobble: 0.85..1.15 — keeps the forest visually loose.
    const scale = 0.85 + ((r >> 14) & 0xFF) / 255 * 0.30;
    // Leaf tint variation — three closely related greens, anchored to
    // the active theme's primary leaf colour (Beta 1.2). Coastal Pastel
    // gives this olive-grove silver-green; stock gives forest-green.
    const _leaf = THEME().flora.leaf;
    const leafTints = [_leaf, tint(0x3a7a3a), tint(0x4a8e3a)];
    const leafColor = leafTints[(r >> 22) % leafTints.length]!;
    const cx = (t.x + 0.5) * TILE_SIZE + ox;
    const cz = (t.y + 0.5) * TILE_SIZE + oz;

    // Shadow disc (Alpha 2.6 visual pass) — slim dark octagonal pad
    // under each tree at the terrain surface. Reads as a soft cast
    // shadow without the cost of a real shadow map. Sits 0.005 above
    // tile elevation to avoid z-fighting with the terrain mesh.
    const shadowR = 0.32 * scale;
    const shadow = new CylinderGeometry(shadowR, shadowR * 0.92, 0.005, 8);
    shadow.translate(cx, t.elevation + 0.0035, cz);
    geoms.push(shadow); colours.push(THEME().flora.shadow);

    if (variant === 0) {
      // Cone tree
      const trunkH = 0.18 * scale;
      const leafH = 0.55 * scale;
      const trunk = new CylinderGeometry(0.055 * scale, 0.06 * scale, trunkH, 6);
      trunk.translate(0, trunkH / 2, 0);
      trunk.rotateY(rot);
      trunk.translate(cx, 0, cz);
      geoms.push(trunk); colours.push(THEME().flora.trunk);
      const leaves = new ConeGeometry(0.28 * scale, leafH, 8);
      leaves.translate(0, trunkH + leafH / 2, 0);
      leaves.rotateY(rot);
      leaves.translate(cx, 0, cz);
      geoms.push(leaves); colours.push(leafColor);
    } else if (variant === 1) {
      // Pine — taller, narrower, two stacked cones for a layered look.
      const trunkH = 0.16 * scale;
      const trunk = new CylinderGeometry(0.04 * scale, 0.05 * scale, trunkH, 6);
      trunk.translate(0, trunkH / 2, 0);
      trunk.rotateY(rot);
      trunk.translate(cx, 0, cz);
      geoms.push(trunk); colours.push(THEME().flora.trunk);
      const lowerH = 0.40 * scale;
      const lower = new ConeGeometry(0.22 * scale, lowerH, 8);
      lower.translate(0, trunkH + lowerH / 2, 0);
      lower.rotateY(rot);
      lower.translate(cx, 0, cz);
      geoms.push(lower); colours.push(leafColor);
      const upperH = 0.30 * scale;
      const upper = new ConeGeometry(0.15 * scale, upperH, 8);
      upper.translate(0, trunkH + lowerH * 0.7 + upperH / 2, 0);
      upper.rotateY(rot);
      upper.translate(cx, 0, cz);
      geoms.push(upper); colours.push(leafColor);
    } else {
      // Round / oak-style tree — short trunk, octahedral foliage.
      const trunkH = 0.14 * scale;
      const trunk = new CylinderGeometry(0.06 * scale, 0.07 * scale, trunkH, 6);
      trunk.translate(0, trunkH / 2, 0);
      trunk.rotateY(rot);
      trunk.translate(cx, 0, cz);
      geoms.push(trunk); colours.push(THEME().flora.trunk);
      // Octahedron — sphere-ish low-poly leaf cluster.
      const leafR = 0.30 * scale;
      const leaves = new ConeGeometry(leafR, leafR * 1.6, 6);
      leaves.translate(0, trunkH + leafR * 0.8, 0);
      leaves.rotateY(rot);
      leaves.translate(cx, 0, cz);
      geoms.push(leaves); colours.push(leafColor);
      // Second offset blob for a fuller crown.
      const blob = new ConeGeometry(leafR * 0.7, leafR * 1.2, 6);
      blob.translate(leafR * 0.3, trunkH + leafR * 0.8, leafR * 0.2);
      blob.rotateY(rot);
      blob.translate(cx, 0, cz);
      geoms.push(blob); colours.push(leafColor);
    }
  }
  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(merged, mat);
}

/**
 * Merge a batch of source geometries into one BufferGeometry, vertex-
 * painting each source with its colour from `colours[]`. All consumers of
 * this function attach a `flatShading: true` material, so we deliberately
 * skip the normal attribute and `computeVertexNormals` — Three.js's flat-
 * shading fragment shader derives the face normal via dFdx/dFdy of the
 * view-space position, leaving any precomputed normals unread. Skipping
 * them saves CPU per rebuild AND GPU memory + upload bandwidth per draw.
 */
export function mergeGeoms(geoms: BufferGeometry[], colours: number[]): BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geoms) {
    totalVerts += g.getAttribute('position').count;
    const idx = g.getIndex();
    totalIndices += idx ? idx.count : g.getAttribute('position').count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const cols = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vOff = 0;
  let iOff = 0;
  const c = new Color();
  for (let gi = 0; gi < geoms.length; gi++) {
    const g = geoms[gi]!;
    const p = g.getAttribute('position');
    const idx = g.getIndex();
    c.setHex(colours[gi]!);

    for (let i = 0; i < p.count; i++) {
      positions[(vOff + i) * 3 + 0] = p.getX(i);
      positions[(vOff + i) * 3 + 1] = p.getY(i);
      positions[(vOff + i) * 3 + 2] = p.getZ(i);
      cols[(vOff + i) * 3 + 0] = c.r;
      cols[(vOff + i) * 3 + 1] = c.g;
      cols[(vOff + i) * 3 + 2] = c.b;
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[iOff + i] = idx.getX(i) + vOff;
      }
      iOff += idx.count;
    } else {
      for (let i = 0; i < p.count; i++) indices[iOff + i] = vOff + i;
      iOff += p.count;
    }
    vOff += p.count;
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(positions, 3));
  out.setAttribute('color', new BufferAttribute(cols, 3));
  out.setIndex(new BufferAttribute(indices, 1));
  // Dispose source geometries — their buffers are now copied into `out`.
  for (const g of geoms) g.dispose();
  return out;
}

// --- Buildings ----------------------------------------------------------

/**
 * Build the merged buildings mesh from the variant catalogue (Alpha 2.1).
 *
 * Each developed tile picks one of three variants per (zone, density)
 * deterministically from its (x, y) hash, so the mix is consistent
 * across reloads. {@link buildVariantParts} returns world-positioned
 * BufferGeometry parts (already scaled, rotated, and translated to the
 * tile centre); we accumulate every part across every developed tile and
 * fuse them into a single vertex-coloured Mesh.
 *
 * Why merge instead of per-variant InstancedMesh: variants compose 1-5
 * primitives each, so a city of ~1000 tiles produces ~3000 primitives.
 * One merged mesh is a single draw call versus 36 InstancedMeshes that
 * each do small-N batches. Rebuild cost is comparable to the previous
 * single-InstancedMesh approach (sub-millisecond on Small/Medium).
 */
export function buildBuildingsMesh(grid: Grid, cityMood: number, monthsElapsed: number): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];
  // Per-tile lift = ROAD_LIFT/2 (avoid z-fighting with zone overlay)
  // PLUS the tile's terrain elevation (Alpha 2.3) so buildings sit on
  // the actual hill rather than buried in it.
  const baseLift = ROAD_LIFT * 0.5;
  // City mood is in [-1, +1]; lift to [0, 1] base.
  const moodBase = (cityMood + 1) * 0.5;
  for (const t of grid.iter()) {
    if (t.zone === 'none' || t.road) continue;
    // Luxury (Alpha 2.5): a 2-tile pair renders as one mansion. Emit only
    // from the lex-smaller tile of the pair (lower x, then lower y) so we
    // don't double-render. The mansion body extends into the partner.
    // Luxury homes are NEVER modulated by happiness — they always look
    // pristine per spec (Alpha 2.7).
    if (t.luxury && t.zone === 'residential') {
      const partner = findLuxuryPartner(grid, t.x, t.y);
      if (!partner) continue; // orphan — render nothing
      // Lex order: lower x wins; tie → lower y wins.
      if (t.x > partner.x || (t.x === partner.x && t.y > partner.y)) continue;
      // Alpha 4.3.1: compute the road yaw for the pair so the walkway
      // aims at the road instead of laying a centred T.
      const roadYaw = computeLuxuryRoadYaw(grid, t.x, t.y, partner.x, partner.y);
      const parts = buildLuxuryParts(t.x, t.y, partner.x, partner.y, roadYaw);
      const yLift = baseLift + t.elevation;
      for (const p of parts) {
        if (TILE_SIZE !== 1) p.geom.scale(TILE_SIZE, TILE_SIZE, TILE_SIZE);
        if (yLift !== 0) p.geom.translate(0, yLift, 0);
        geoms.push(p.geom);
        // Theme tint (Beta 1.2): long-tail filter so unmigrated detail
        // colours still feel of-a-piece with the active palette.
        colours.push(tint(p.color));
      }
      continue;
    }
    // Skyscrapers (Alpha 3.1.2) live in their own mesh now (Alpha 3.1.7)
    // so we can fade them when the camera zooms in. Skip them in the
    // main building mesh — `buildSkyscrapersMesh` handles them.
    if (t.skyscraper) continue;
    if (t.density === 0) continue;
    // Per-tile happiness (Alpha 2.7): city mood, nudged by services. Tiles
    // with park coverage feel better; tiles missing power/water feel worse.
    let happy = moodBase;
    if (t.hasPark) happy += 0.10;
    if (!t.hasPower) happy -= 0.20;
    if (!t.hasWater) happy -= 0.15;
    happy = Math.max(0, Math.min(1, happy));
    // Patina (Alpha 2.16): newer buildings stay vibrant, older ones
    // dim toward a weathered tone over the first decade. The factor is
    // sampled once per tile and applied to every part's color so a single
    // building reads consistently weathered (rather than a roof aging
    // faster than its walls).
    const ageMonths = Math.max(0, monthsElapsed - t.developedAt);
    const patina = patinaFactor(ageMonths);
    const yawForRoad = computeRoadFacingYaw(grid, t.x, t.y);
    const parts = buildVariantParts(t.zone, t.density, t.x, t.y, happy, yawForRoad);
    const yLift = baseLift + t.elevation;
    for (const p of parts) {
      if (TILE_SIZE !== 1) p.geom.scale(TILE_SIZE, TILE_SIZE, TILE_SIZE);
      if (yLift !== 0) p.geom.translate(0, yLift, 0);
      geoms.push(p.geom);
      // Theme tint applied at merge time (Beta 1.2) — every per-variant
      // colour passes through the active pack's mood filter, so the
      // whole zoned city reads as a coherent palette even though each
      // variant's BuildingVariants.ts entry stays as authored.
      const tinted = tint(p.color);
      colours.push(patina < 1 ? darkenHex(tinted, patina) : tinted);
    }
  }
  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(merged, mat);
}

/** Build the skyscraper mesh separately (Alpha 3.1.7) so we can fade
 *  its material when the camera zooms in. Walks anchors and emits their
 *  parts the same way the main builder used to. Returns null if no
 *  skyscrapers. */
export function buildSkyscrapersMesh(grid: Grid): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];
  const baseLift = ROAD_LIFT * 0.5;
  for (const t of grid.iter()) {
    if (!t.skyscraper) continue;
    if (!isSkyscraperAnchor(grid, t.x, t.y)) continue;
    const parts = buildSkyscraperParts(
      t.x, t.y, t.zone as 'residential' | 'commercial' | 'mixed',
      t.skyscraperVariant, t.skyscraperStage
    );
    const yLift = baseLift + t.elevation;
    for (const p of parts) {
      if (TILE_SIZE !== 1) p.geom.scale(TILE_SIZE, TILE_SIZE, TILE_SIZE);
      if (yLift !== 0) p.geom.translate(0, yLift, 0);
      geoms.push(p.geom);
      colours.push(tint(p.color));
    }
  }
  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: 1.0
  });
  return new Mesh(merged, mat);
}

/**
 * Patina ramp (Alpha 2.16). Returns a 0..1 multiplier applied to building
 * vertex colors so older buildings read as weathered.
 *
 * - 0 months   → 1.00 (pristine)
 * - 12 months  → ~0.95
 * - 60 months  → ~0.85
 * - 180 months → 0.72 (asymptote)
 *
 * Cap at 0.72 so even a 50-year city still reads as a city, not a ruin.
 * Single ramp covers low / medium / high density; the visual delta is
 * subtle on L1 cottages and meaningful on L3 towers because the high
 * density palettes start brighter.
 */
function patinaFactor(ageMonths: number): number {
  const FLOOR = 0.72;
  const RAMP_MONTHS = 180;
  if (ageMonths <= 0) return 1.0;
  if (ageMonths >= RAMP_MONTHS) return FLOOR;
  return 1.0 - (1.0 - FLOOR) * (ageMonths / RAMP_MONTHS);
}

/**
 * Rotate a list of big-build parts in place around the rotated footprint
 * center (Alpha 4.21). Builders emit parts positioned in world coords
 * for rotation 0 (anchor at (ax, ay), footprint extends right+down by
 * (nativeW, nativeH)). To support rotated placements without rewriting
 * each builder's hundred-line layout code, we apply a single after-the-
 * fact transform per part:
 *
 *   1. Translate by `(-ax - nativeW/2, 0, -ay - nativeH/2)` — moves the
 *      native footprint center to the origin.
 *   2. RotateY by `-rot * π/2` (negative = CW from above in Three.js's
 *      right-handed system).
 *   3. Translate by `(ax + worldW/2, 0, ay + worldH/2)` — moves the
 *      rotated geometry into its world-space position. The anchor
 *      stays at (ax, ay); the footprint extends right+down by the
 *      ROTATED dimensions (worldW, worldH = swapped for odd rotations).
 *
 * Rotation 0 is a no-op early-return — no allocation, no transform.
 */
function rotateBigBuildPartsInPlace(
  parts: VariantPart[],
  rot: BigBuildRotation,
  ax: number, ay: number,
  nativeW: number, nativeH: number
): void {
  if (rot === 0) return;
  const cxN = (ax + nativeW * 0.5) * TILE_SIZE;
  const czN = (ay + nativeH * 0.5) * TILE_SIZE;
  const { w: worldW, h: worldH } = rotatedFootprint(nativeW, nativeH, rot);
  const cxR = (ax + worldW * 0.5) * TILE_SIZE;
  const czR = (ay + worldH * 0.5) * TILE_SIZE;
  const angle = -rot * Math.PI * 0.5;
  for (const p of parts) {
    p.geom.translate(-cxN, 0, -czN);
    p.geom.rotateY(angle);
    p.geom.translate(cxR, 0, czR);
  }
}

/** Multiply each RGB channel of a packed 0xRRGGBB by `factor`, return a new
 *  packed colour. Channels are clamped at 0; factor < 1 darkens. */
function darkenHex(hex: number, factor: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

/**
 * Yaw (radians) that rotates a building's "front" face (the spec's south
 * / +Z face — where awnings, doors and walkways are authored) toward the
 * nearest road. Returns undefined if no road is adjacent so the caller
 * can fall back to a deterministic random rotation.
 *
 * Yaw convention:
 *   0      → front faces +Z (south)  → road is south of the building
 *   π/2    → front faces +X (east)   → road is east
 *   π      → front faces -Z (north)  → road is north
 *   3π/2   → front faces -X (west)   → road is west
 *
 * Preference rules:
 *   1. Non-highway cardinal neighbour first (S, E, N, W in order).
 *   2. Any cardinal road neighbour (including highways).
 *   3. Diagonal road neighbour (fallback for corner lots).
 */
function computeRoadFacingYaw(grid: Grid, x: number, y: number): number | undefined {
  const candidates: Array<{ dx: number; dy: number; yaw: number }> = [
    { dx: 0,  dy: 1,  yaw: 0 },                // road south → face south
    { dx: 1,  dy: 0,  yaw: Math.PI / 2 },      // road east  → face east
    { dx: 0,  dy: -1, yaw: Math.PI },          // road north → face north
    { dx: -1, dy: 0,  yaw: (3 * Math.PI) / 2 } // road west  → face west
  ];
  // Pass 1: non-highway cardinal road.
  for (const c of candidates) {
    const n = grid.get(x + c.dx, y + c.dy);
    if (n && n.road && n.roadType !== 'highway') return c.yaw;
  }
  // Pass 2: any cardinal road (highway accepted).
  for (const c of candidates) {
    const n = grid.get(x + c.dx, y + c.dy);
    if (n && n.road) return c.yaw;
  }
  // Pass 3: diagonal fallback — quantise to the nearest cardinal yaw so
  // the walkway still points roughly the right way.
  const diagonals: Array<{ dx: number; dy: number; yaw: number }> = [
    { dx: 1,  dy: 1,  yaw: Math.PI / 4 },
    { dx: -1, dy: 1,  yaw: -Math.PI / 4 + 2 * Math.PI },
    { dx: 1,  dy: -1, yaw: 3 * Math.PI / 4 },
    { dx: -1, dy: -1, yaw: (5 * Math.PI) / 4 }
  ];
  for (const c of diagonals) {
    const n = grid.get(x + c.dx, y + c.dy);
    if (n && n.road) {
      // Quantise to the nearest cardinal so emitGroundAccents (which
      // expects yaw % π/2 ≈ 0) routes the walkway cleanly.
      return Math.round(c.yaw / (Math.PI / 2)) * (Math.PI / 2);
    }
  }
  return undefined;
}

/**
 * Pair-aware road-facing yaw for luxury 2-tile mansions (Alpha 4.3.1).
 * A luxury home spans two 4-adjacent tiles; we want the walkway to aim
 * at whichever road tile is 4-adjacent to either of those two tiles.
 *
 * Cardinal order (S, E, N, W) matches `computeRoadFacingYaw` so the
 * preference between two candidate roads is consistent across
 * single-tile and pair-tile builds. Non-highway roads outrank highways
 * (a quiet street is a better address than a freeway).
 *
 * Returns undefined when no cardinal road neighbour exists — caller
 * falls back to the centred-T walkway.
 */
function computeLuxuryRoadYaw(
  grid: Grid, ax: number, ay: number, bx: number, by: number
): number | undefined {
  const longX = bx !== ax;
  // Build the per-cardinal candidate tile list, accounting for the
  // pair's orientation. Tiles INSIDE the pair are never road neighbours
  // (they're the building itself), so we only check tiles OUTSIDE the
  // pair in each direction.
  type Candidate = { tiles: Array<[number, number]>; yaw: number };
  let candidates: Candidate[];
  if (longX) {
    const lx = Math.min(ax, bx);
    const rx = Math.max(ax, bx);
    candidates = [
      { tiles: [[lx, ay + 1], [rx, ay + 1]], yaw: 0 },                    // S
      { tiles: [[rx + 1, ay]],               yaw: Math.PI / 2 },          // E
      { tiles: [[lx, ay - 1], [rx, ay - 1]], yaw: Math.PI },              // N
      { tiles: [[lx - 1, ay]],               yaw: (3 * Math.PI) / 2 }     // W
    ];
  } else {
    const ty = Math.min(ay, by);
    const by2 = Math.max(ay, by);
    candidates = [
      { tiles: [[ax, by2 + 1]],              yaw: 0 },                    // S
      { tiles: [[ax + 1, ty], [ax + 1, by2]], yaw: Math.PI / 2 },         // E
      { tiles: [[ax, ty - 1]],               yaw: Math.PI },              // N
      { tiles: [[ax - 1, ty], [ax - 1, by2]], yaw: (3 * Math.PI) / 2 }    // W
    ];
  }
  // Pass 1: non-highway road in any candidate tile.
  for (const c of candidates) {
    for (const [tx, ty] of c.tiles) {
      const n = grid.get(tx, ty);
      if (n && n.road && n.roadType !== 'highway') return c.yaw;
    }
  }
  // Pass 2: any road (highway accepted).
  for (const c of candidates) {
    for (const [tx, ty] of c.tiles) {
      const n = grid.get(tx, ty);
      if (n && n.road) return c.yaw;
    }
  }
  return undefined;
}

/**
 * Service buildings that should rotate to face the nearest road
 * (Alpha 4.3). Each has an asymmetric front face that reads weird if
 * pointed away from the street: school clock-tower + flagpole, hospital
 * red-cross sign + entry, fire-station bay doors, police porch + step,
 * museum colonnade entry, bus-stop bench + canopy, depot garage door.
 *
 * Deliberately excluded:
 * - park: symmetric (lawn + path + benches all around)
 * - power_plant / water_tower: symmetric cylinders + boxes
 * - stadium: oval, no front face
 * - observatory: dome on a pad, symmetric
 * - ferry_dock / subway_entrance: orientation is determined by the
 *   water shoreline / sidewalk side they're placed against, not by
 *   the nearest road tile
 */
const SERVICE_BUILDING_ROTATES = new Set<string>([
  'school', 'hospital', 'fire_station', 'police_station', 'museum',
  'bus_stop', 'bus_depot'
]);

/**
 * Build a short paved walkway from the service building's front face
 * toward the centre of the adjacent road tile (Alpha 4.3). Reuses the
 * same flagstone palette as the zoned-tile walkways from commit
 * `313b61e` so the city's pedestrian infrastructure reads as a single
 * coherent layer.
 *
 * Returns an empty array when no road is adjacent — service tiles
 * dropped mid-block (e.g. a school placed deep on a park-bordered lot)
 * don't get a path leading to nowhere. Same guard applies to buildings
 * that don't rotate (park, utilities, etc.) — no walkway because there's
 * no front face to anchor it.
 */
function buildServiceWalkway(grid: Grid, x: number, y: number, kind: string): CityBuildingPart[] {
  if (!SERVICE_BUILDING_ROTATES.has(kind)) return [];
  const yaw = computeRoadFacingYaw(grid, x, y);
  if (yaw === undefined) return [];
  // Walkway runs from the body's front edge (~0.25 in front of the
  // tile centre) to the road edge (~0.48 in front), in the building's
  // facing direction. We emit it in local frame (along +Z at yaw=0)
  // and use sin/cos to push it along the chosen yaw.
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const walkLen = 0.36;
  const walkWidth = 0.16;
  const midDist = 0.30;  // distance from tile centre along the front axis
  const dx = sin * midDist;
  const dz = cos * midDist;
  // Box orientation: long axis follows the yaw vector. Easiest is to
  // emit a box that's long along Z then rotate it into place via the
  // makeGeom callback.
  const walkway: CityBuildingPart = {
    makeGeom: () => {
      const g = new BoxGeometry(walkWidth, 0.022, walkLen);
      g.rotateY(yaw);
      return g;
    },
    color: 0xc7c2b3,
    dx, dy: 0.011, dz
  };
  return [walkway];
}

/** First 4-neighbour with `luxury && zone==='residential'`, else null. */
function findLuxuryPartner(grid: Grid, x: number, y: number): { x: number; y: number } | null {
  const dirs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [dx, dy] of dirs) {
    const n = grid.get(x + dx, y + dy);
    if (n && n.luxury && n.zone === 'residential') return { x: n.x, y: n.y };
  }
  return null;
}

/** Anchor check for skyscraper 2×2 footprint (Alpha 3.1.2). The anchor
 *  is the lex-smallest of the four — same logic as Skyscrapers.isAnchor
 *  but inlined so the renderer doesn't need the simulation import. */
function isSkyscraperAnchor(grid: Grid, x: number, y: number): boolean {
  const t = grid.get(x, y);
  if (!t || !t.skyscraper) return false;
  const cmp = (px: number, py: number): boolean => {
    const p = grid.get(px, py);
    return !!(p && p.skyscraper && p.zone === t.zone && p.skyscraperVariant === t.skyscraperVariant);
  };
  if (cmp(x - 1, y)) return false;
  if (cmp(x, y - 1)) return false;
  if (cmp(x - 1, y - 1)) return false;
  if (!cmp(x + 1, y) || !cmp(x, y + 1) || !cmp(x + 1, y + 1)) return false;
  return true;
}

/** Read the matching big-build kind bit on a tile (Alpha 4.15). Used by
 *  the per-block construction-site pass to walk back to the anchor. */
export function readKind(
  t: import('../../world/Tile').Tile,
  kind: 'mayor_mansion' | 'city_hall' | 'provincial_capital' | 'national_capital' | 'cloverleaf'
): boolean {
  switch (kind) {
    case 'mayor_mansion':      return t.mayorMansion;
    case 'city_hall':          return t.cityHall;
    case 'provincial_capital': return t.provincialCapital;
    case 'national_capital':   return t.nationalCapital;
    case 'cloverleaf':         return t.cloverleaf;
  }
}

/**
 * Per-tile construction-site geometry (Alpha 4.15). Returned when a big
 * civic build has had this tile's block paid but the overall footprint
 * is still incomplete. Reads as "this block is paid for, the building
 * isn't finished yet." Composition: wooden scaffolding pad +
 * orange-and-white striped barriers + a few crane / material stacks.
 * Fits entirely within one tile so adjacent tiles can render their
 * own state independently.
 */
function constructionSiteParts(): Array<{
  makeGeom: () => BufferGeometry; dx: number; dy: number; dz: number; color: number;
}> {
  // Earth-tone material pad (light brown — looks like dirt + plywood
  // boards laid over the footprint). Almost full tile so the corners
  // visually frame the construction.
  const DIRT = 0xa07a4a;
  const PLANK = 0x8a5a30;
  const STRIPE_ORANGE = 0xe06030;
  const STRIPE_WHITE = 0xf0f0e8;
  const CRANE = 0xd8b020;
  const REBAR = 0x484848;
  const out: Array<{ makeGeom: () => BufferGeometry; dx: number; dy: number; dz: number; color: number }> = [];
  // Earthen pad
  out.push({ makeGeom: () => new BoxGeometry(0.92, 0.020, 0.92), dx: 0, dy: 0.010, dz: 0, color: DIRT });
  // Two crossed plank boards (decking)
  out.push({ makeGeom: () => new BoxGeometry(0.80, 0.030, 0.10), dx: 0, dy: 0.025, dz: 0.20, color: PLANK });
  out.push({ makeGeom: () => new BoxGeometry(0.10, 0.030, 0.80), dx: -0.20, dy: 0.025, dz: 0, color: PLANK });
  // Four corner safety posts with orange-and-white tape
  for (const [px, pz] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]] as const) {
    out.push({ makeGeom: () => new BoxGeometry(0.045, 0.25, 0.045), dx: px, dy: 0.135, dz: pz, color: STRIPE_WHITE });
    out.push({ makeGeom: () => new BoxGeometry(0.050, 0.04, 0.050), dx: px, dy: 0.21, dz: pz, color: STRIPE_ORANGE });
    out.push({ makeGeom: () => new BoxGeometry(0.050, 0.04, 0.050), dx: px, dy: 0.09, dz: pz, color: STRIPE_ORANGE });
  }
  // Tiny mini-crane: vertical mast + horizontal arm
  out.push({ makeGeom: () => new BoxGeometry(0.040, 0.50, 0.040), dx: 0.18, dy: 0.27, dz: -0.18, color: CRANE });
  out.push({ makeGeom: () => new BoxGeometry(0.30, 0.030, 0.030), dx: 0.05, dy: 0.50, dz: -0.18, color: CRANE });
  // Hanging cable + hook
  out.push({ makeGeom: () => new BoxGeometry(0.008, 0.18, 0.008), dx: -0.08, dy: 0.41, dz: -0.18, color: 0x202020 });
  out.push({ makeGeom: () => new BoxGeometry(0.045, 0.025, 0.045), dx: -0.08, dy: 0.31, dz: -0.18, color: 0x303030 });
  // Rebar stack
  for (let i = 0; i < 4; i++) {
    out.push({ makeGeom: () => new BoxGeometry(0.30, 0.015, 0.015), dx: -0.10, dy: 0.045 + i * 0.018, dz: -0.30, color: REBAR });
  }
  // A small "in progress" pile — yellow concrete-mixer body
  out.push({ makeGeom: () => new BoxGeometry(0.18, 0.10, 0.14), dx: 0.25, dy: 0.075, dz: 0.25, color: 0xfecf45 });
  out.push({ makeGeom: () => new BoxGeometry(0.045, 0.13, 0.045), dx: 0.18, dy: 0.085, dz: 0.30, color: 0x404040 });
  return out;
}

// --- Traffic heatmap ----------------------------------------------------

export function buildHeatmapMesh(grid: Grid): Mesh | null {
  let count = 0;
  for (const t of grid.iter()) if (t.road) count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color();
  const inset = 0.05;
  const baseY = ROAD_LIFT + 0.04;

  let vi = 0;
  let ci = 0;
  let ii = 0;
  let v = 0;

  for (const t of grid.iter()) {
    if (!t.road) continue;
    // Heat colour: green (0) → yellow (1.0) → red (2.5+).
    heatColor(t.trafficLoadAvg, c);

    const x0 = t.x * TILE_SIZE + inset;
    const x1 = (t.x + 1) * TILE_SIZE - inset;
    const z0 = t.y * TILE_SIZE + inset;
    const z1 = (t.y + 1) * TILE_SIZE - inset;
    // Lift heatmap by tile elevation so it follows the road surface
    // (Alpha 2.4); bridges sit absolute at BRIDGE_LIFT + tiny offset.
    const y = t.bridge ? BRIDGE_LIFT + 0.04 : baseY + t.elevation;

    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normals.
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    flatShading: true
  });
  return new Mesh(geom, mat);
}

function heatColor(load: number, out: Color): void {
  // Two-stop gradient: 0 → 1 maps green → yellow; 1 → 2.5+ maps yellow → red.
  const lo = 0x4ad06d; // green
  const mid = 0xf2cd5c; // yellow
  const hi = 0xd03a3a;  // red
  if (load <= 1) {
    const t = Math.max(0, Math.min(1, load));
    out.setHex(lo).lerp(new Color(mid), t);
  } else {
    const t = Math.max(0, Math.min(1, (load - 1) / 1.5));
    out.setHex(mid).lerp(new Color(hi), t);
  }
}

/** Night-lights overlay (Alpha 3.0.1). One small geometry cluster per
 *  light-emitting tile — a thin pole + a glowing emissive cap + a soft
 *  ground-glow disc. Rendered with an unlit MeshBasicMaterial so the
 *  light reads "lit" even when the directional sun is at midnight
 *  intensity. Opacity is driven by Renderer.applyTimeOfDay so the
 *  overlay fades in at dusk + out at dawn.
 *
 *  Sources of lights:
 *  - Avenue road tiles → 2 lamp posts (one per sidewalk side).
 *  - Walking-path tiles → 1 lamp post.
 *  - Park tiles → 1 ornate lamp.
 *
 *  All in one merged mesh = a single draw call. Build cost is one grid
 *  sweep; rebuild when roads / paths / parks change. */
export function buildNightLightsMesh(grid: Grid): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];

  // Theme-driven lamp colours (Beta 1.2). Bulb glow inherits from the
  // theme's lampBulb; the secondary "park" tone is a softer warm-shift
  // of the same hue. Pole reads from theme.beautification.lampPole.
  const _bp = THEME().beautification;
  const LAMP_GLOW = _bp.lampBulb;
  const PARK_LAMP_GLOW = tint(0xffe4b0);
  const LAMP_POLE = _bp.lampPole;
  const GROUND_GLOW = _bp.lampBulb;
  const PARK_GROUND_GLOW = tint(0xffe4b0);

  /** Lamp fixture (Alpha 3.1.6): emits ONLY the visible pole + bulb.
   *  The smooth ground-glow is now a separate `lampGlowMesh` rendered
   *  with a radial-gradient texture for proper falloff. */
  const dim = (hex: number, factor: number): number => {
    const r = Math.round(((hex >> 16) & 0xff) * factor);
    const g = Math.round(((hex >> 8) & 0xff) * factor);
    const b = Math.round((hex & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
  };
  const addLamp = (
    cx: number, cz: number, baseY: number, glowHex: number, scale = 1
  ): void => {
    // Pole (thin dark cylinder).
    const pole = new CylinderGeometry(0.018 * scale, 0.018 * scale, 0.34 * scale, 6);
    pole.translate(cx, baseY + 0.17 * scale, cz);
    geoms.push(pole); colours.push(LAMP_POLE);
    // Bulb — small emissive sphere.
    const bulb = new IcosahedronGeometry(0.05 * scale, 0);
    bulb.translate(cx, baseY + 0.36 * scale, cz);
    geoms.push(bulb); colours.push(dim(glowHex, 0.95));
    void GROUND_GLOW;
  };

  for (const t of grid.iter()) {
    const cx = t.x + 0.5;
    const cz = t.y + 0.5;
    if (t.road && t.roadType === 'avenue') {
      // Two sidewalk-side lamps along the long-ish axis. Use the
      // sidewalk lift so the lamp base sits on the sidewalk surface.
      // Beta 1.6.18 — bridge tiles get lamps too, lifted to the bridge
      // deck height. Pre-1.6.18 the `!t.bridge` filter skipped bridges
      // entirely, so an avenue crossing water went dark for one segment
      // and the rest of the avenue looked oddly luminous in contrast.
      const baseY = t.bridge ? BRIDGE_LIFT : SIDEWALK_LIFT + t.elevation;
      addLamp(cx, cz - 0.36, baseY, LAMP_GLOW);
      addLamp(cx, cz + 0.36, baseY, LAMP_GLOW);
    }
    if (t.path && !t.road) {
      // Single small lamp at the centre of each path tile.
      const baseY = PATH_LIFT + t.elevation;
      addLamp(cx, cz, baseY, LAMP_GLOW, 0.85);
    }
    if (t.building === 'park') {
      // Ornate park lamp in the centre.
      const baseY = SIDEWALK_LIFT + t.elevation;
      addLamp(cx, cz, baseY, PARK_LAMP_GLOW, 1.1);
      // Suppress unused-variable lint
      void PARK_GROUND_GLOW;
    }
    // Parking lot + Big Box lamps (Beta 1.3.3) — the lamps already
    // render as visible poles in the cluster geometry; this branch
    // adds them to the night-lights overlay so they actually GLOW
    // during the night phase. Big_box clusters get 2 lamps at the
    // cluster's outer corners (matching the per-cluster lamp paint
    // in bigBoxClusterParts). Parking_lot tiles get 1 lamp at the
    // far corner (matching the per-tile lamp in emitParkingTile).
    if (t.building === 'parking_lot') {
      const baseY = SIDEWALK_LIFT + t.elevation;
      // Single far-corner lamp matching the geometry in
      // emitParkingTile (offset 0.42 from tile centre).
      addLamp(cx + 0.42, cz + 0.42, baseY, LAMP_GLOW, 0.95);
    }
    if (t.building === 'big_box') {
      const baseY = SIDEWALK_LIFT + t.elevation;
      // Two front-corner lamps per cluster tile so multi-tile stores
      // get an obvious lit storefront. The lamp paint in
      // bigBoxClusterParts only emits corners on the cluster extents,
      // but per-tile is fine here for the glow — overlapping halos
      // just brighten the apron.
      addLamp(cx - 0.40, cz + 0.40, baseY, LAMP_GLOW, 1.05);
      addLamp(cx + 0.40, cz + 0.40, baseY, LAMP_GLOW, 1.05);
    }
  }

  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  // Unlit material so the lights read as "lit" even at deep midnight when
  // the directional sun light is dim.  Transparent + depthWrite:false so
  // the ground-glow doesn't z-fight with the road/path surface beneath
  // and so the overlay can fade out at dawn.
  const mat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const mesh = new Mesh(merged, mat);
  // Off by default — applyTimeOfDay will toggle visibility based on time.
  mesh.visible = false;
  return mesh;
}

/** Generate the radial-gradient texture used by every lamp glow pool.
 *  Single CanvasTexture is shared across all lamps — built once per
 *  Renderer lifetime. Smooth bell-curve falloff via Canvas2D
 *  radialGradient gives lamps a natural-looking light spill. */
export function makeRadialGlowTexture(): import('three').Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Bright warm centre → soft warm mid → fully transparent edge.
  // Softer falloff (Alpha 3.1.8) — the previous gradient was washing
  // out everything under the lamp. Lower centre alpha + earlier
  // taper keeps the glow readable without flattening the road texture.
  grad.addColorStop(0, 'rgba(255, 240, 168, 0.65)');
  grad.addColorStop(0.25, 'rgba(255, 220, 150, 0.38)');
  grad.addColorStop(0.55, 'rgba(255, 200, 130, 0.12)');
  grad.addColorStop(1, 'rgba(255, 200, 130, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Texture for the four "+" expansion buttons rendered just outside the
 *  city bounds (Alpha 3.2.1). Chunky white plus glyph on a translucent
 *  dark rounded square so it reads from any zoom level. */
export function makePlusButtonTexture(): import('three').Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Rounded-rect background.
  const r = 24;
  ctx.fillStyle = 'rgba(20, 20, 20, 0.78)';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(size, 0, size, size, r);
  ctx.arcTo(size, size, 0, size, r);
  ctx.arcTo(0, size, 0, 0, r);
  ctx.arcTo(0, 0, size, 0, r);
  ctx.closePath();
  ctx.fill();
  // Outer ring.
  ctx.strokeStyle = 'rgba(255, 200, 90, 0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();
  // Plus glyph.
  ctx.strokeStyle = 'rgba(255, 240, 168, 1.0)';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.30, size * 0.50);
  ctx.lineTo(size * 0.70, size * 0.50);
  ctx.moveTo(size * 0.50, size * 0.30);
  ctx.lineTo(size * 0.50, size * 0.70);
  ctx.stroke();
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Build one flat textured plane per lamp — the smooth radial glow that
 *  spills onto the ground around the fixture (Alpha 3.1.6). Each plane
 *  is ~2.4 tiles wide and lies flat just above the surface, with the
 *  shared radial-gradient texture providing the soft falloff. */
export function buildLampGlowMesh(grid: Grid, texture: import('three').Texture): Mesh | null {
  // Count lamp positions first so we can size buffers exactly.
  type LampSpec = { cx: number; cz: number; y: number; r: number };
  const lamps: LampSpec[] = [];
  for (const t of grid.iter()) {
    const cx = t.x + 0.5;
    const cz = t.y + 0.5;
    if (t.road && t.roadType === 'avenue') {
      // Beta 1.6.18 — bridge tiles get glow pools too, lifted to deck.
      const baseY = t.bridge ? BRIDGE_LIFT + 0.01 : SIDEWALK_LIFT + t.elevation + 0.01;
      lamps.push({ cx, cz: cz - 0.36, y: baseY, r: 1.20 });
      lamps.push({ cx, cz: cz + 0.36, y: baseY, r: 1.20 });
    }
    if (t.path && !t.road) {
      const baseY = PATH_LIFT + t.elevation + 0.01;
      lamps.push({ cx, cz, y: baseY, r: 1.10 });
    }
    if (t.building === 'park') {
      const baseY = SIDEWALK_LIFT + t.elevation + 0.01;
      lamps.push({ cx, cz, y: baseY, r: 1.50 });
    }
    // Parking lot + Big Box halo glows (Beta 1.3.3) — match the lamp
    // positions registered in buildNightLightsMesh so the radial
    // glow lands under each lamp. Parking lot = single far-corner
    // halo. Big box = two front-corner halos for the storefront wash.
    if (t.building === 'parking_lot') {
      const baseY = SIDEWALK_LIFT + t.elevation + 0.01;
      lamps.push({ cx: cx + 0.42, cz: cz + 0.42, y: baseY, r: 1.20 });
    }
    if (t.building === 'big_box') {
      const baseY = SIDEWALK_LIFT + t.elevation + 0.01;
      lamps.push({ cx: cx - 0.40, cz: cz + 0.40, y: baseY, r: 1.30 });
      lamps.push({ cx: cx + 0.40, cz: cz + 0.40, y: baseY, r: 1.30 });
    }
    // Architectural decoratives (Alpha 4.2.1) — soft halo glow under
    // each plaza / fountain / statue / monument so the showpieces
    // properly read as lit at night, not just dim icons. Halo radius
    // scales with build importance (mansion > arch > clock > fountain).
    const baseY = SIDEWALK_LIFT + t.elevation + 0.01;
    switch (t.building) {
      case 'plaza':
        // Soft warm glow filling the entire plaza pad.
        lamps.push({ cx, cz, y: baseY, r: 1.40 });
        break;
      case 'fountain':
        // Bright central halo + slightly-larger outer wash.
        lamps.push({ cx, cz, y: baseY, r: 1.60 });
        break;
      case 'statue':
        // Dramatic statue uplighting — narrower but intense halo.
        lamps.push({ cx, cz, y: baseY, r: 1.20 });
        break;
      case 'flower_bed':
        // Subtle accent on the planter row.
        lamps.push({ cx, cz, y: baseY, r: 0.90 });
        break;
      case 'topiary':
        lamps.push({ cx, cz, y: baseY, r: 1.20 });
        break;
      case 'pergola':
        // String-light pool under the pergola.
        lamps.push({ cx, cz, y: baseY, r: 1.40 });
        break;
      case 'reflecting_pool':
        // Long pool of moonlight along the water.
        lamps.push({ cx, cz, y: baseY, r: 1.50 });
        break;
      case 'memorial_garden':
        // Grand civic monument floodlight effect.
        lamps.push({ cx, cz, y: baseY, r: 1.80 });
        break;
      case 'clock_tower':
        // Beacon glow from the lit clock face + cupola.
        lamps.push({ cx, cz, y: baseY, r: 1.70 });
        break;
      case 'triumphal_arch':
        // Big floodlight halo befitting the most expensive single-tile
        // monument in the game.
        lamps.push({ cx, cz, y: baseY, r: 2.00 });
        break;
      case 'pier':
        // End-of-pier accent.
        lamps.push({ cx, cz: cz + 0.30, y: baseY, r: 0.90 });
        break;
      case 'mayor_mansion': {
        // Multiple halos across the 4×2 footprint so the entire estate
        // glows. Anchor is at (t.x, t.y); cover both rows + both
        // outer sides + the centre.
        const ax = t.x;
        const ay = t.y;
        const mcx = ax + 2;
        const fcz = ay + 1;
        const mz = fcz - 0.5;
        // Mansion-row halos (one per ~2 tiles wide section).
        lamps.push({ cx: mcx - 1.30, cz: mz, y: baseY, r: 1.60 });
        lamps.push({ cx: mcx,        cz: mz, y: baseY, r: 2.20 });  // grand central halo
        lamps.push({ cx: mcx + 1.30, cz: mz, y: baseY, r: 1.60 });
        // Front-row grounds halos (parterre + driveway + pools).
        lamps.push({ cx: mcx - 1.65, cz: fcz + 0.5, y: baseY, r: 1.40 });
        lamps.push({ cx: mcx,        cz: fcz + 0.5, y: baseY, r: 1.80 });  // fountain-drive area
        lamps.push({ cx: mcx + 1.65, cz: fcz + 0.5, y: baseY, r: 1.40 });
        break;
      }
      case 'city_hall': {
        // 5×3 footprint. Anchor at (t.x, t.y); centre at +2.5, +1.5.
        const cxh = t.x + 2.5;
        const czh = t.y + 1.5;
        // Building-row halos (back row, building runs the full 5 width)
        lamps.push({ cx: cxh - 1.85, cz: czh - 1.0, y: baseY, r: 1.50 });
        lamps.push({ cx: cxh,        cz: czh - 1.0, y: baseY, r: 2.40 });  // dome glow
        lamps.push({ cx: cxh + 1.85, cz: czh - 1.0, y: baseY, r: 1.50 });
        // Plaza + fountain
        lamps.push({ cx: cxh,        cz: czh + 0.8, y: baseY, r: 1.80 });
        // Front lawns
        lamps.push({ cx: cxh - 1.55, cz: czh + 1.0, y: baseY, r: 1.30 });
        lamps.push({ cx: cxh + 1.55, cz: czh + 1.0, y: baseY, r: 1.30 });
        break;
      }
      case 'provincial_capital': {
        // 6×4 footprint. Anchor at (t.x, t.y); centre at +3, +2.
        const cxp = t.x + 3.0;
        const czp = t.y + 2.0;
        // Building row (back) — wider, with central tower halo brightest
        lamps.push({ cx: cxp - 2.50, cz: czp - 1.45, y: baseY, r: 1.70 });
        lamps.push({ cx: cxp - 1.45, cz: czp - 1.45, y: baseY, r: 1.60 });
        lamps.push({ cx: cxp,        cz: czp - 1.45, y: baseY, r: 2.60 });  // central tower
        lamps.push({ cx: cxp + 1.45, cz: czp - 1.45, y: baseY, r: 1.60 });
        lamps.push({ cx: cxp + 2.50, cz: czp - 1.45, y: baseY, r: 1.70 });
        // Plaza + fountain
        lamps.push({ cx: cxp,        cz: czp + 0.85, y: baseY, r: 2.00 });
        // Flagpoles
        lamps.push({ cx: cxp - 1.30, cz: czp + 1.60, y: baseY, r: 1.30 });
        lamps.push({ cx: cxp,        cz: czp + 1.60, y: baseY, r: 1.30 });
        lamps.push({ cx: cxp + 1.30, cz: czp + 1.60, y: baseY, r: 1.30 });
        break;
      }
      case 'national_capital': {
        // 7×4 footprint. Anchor at (t.x, t.y); centre at +3.5, +2.
        const cxn = t.x + 3.5;
        const czn = t.y + 2.0;
        // Library round drum at the back
        lamps.push({ cx: cxn,        cz: t.y + 0.40, y: baseY, r: 1.80 });
        // Wing towers (the ends of the main building)
        lamps.push({ cx: cxn - 3.05, cz: czn - 0.95, y: baseY, r: 1.80 });
        lamps.push({ cx: cxn + 3.05, cz: czn - 0.95, y: baseY, r: 1.80 });
        // Wings
        lamps.push({ cx: cxn - 2.00, cz: czn - 0.95, y: baseY, r: 1.50 });
        lamps.push({ cx: cxn + 2.00, cz: czn - 0.95, y: baseY, r: 1.50 });
        // Peace Tower — biggest halo, anchored on the central block
        lamps.push({ cx: cxn,        cz: czn - 0.95, y: baseY, r: 3.00 });
        // Eternal flame
        lamps.push({ cx: cxn,        cz: t.y + 3.20, y: baseY, r: 1.80 });
        // Flagpole row across the front
        lamps.push({ cx: cxn - 1.80, cz: t.y + 3.75, y: baseY, r: 1.20 });
        lamps.push({ cx: cxn - 0.90, cz: t.y + 3.75, y: baseY, r: 1.20 });
        lamps.push({ cx: cxn,        cz: t.y + 3.75, y: baseY, r: 1.20 });
        lamps.push({ cx: cxn + 0.90, cz: t.y + 3.75, y: baseY, r: 1.20 });
        lamps.push({ cx: cxn + 1.80, cz: t.y + 3.75, y: baseY, r: 1.20 });
        break;
      }
    }
    // Beta 1.6.8 — interior spillover halo under L3+ (high + max
    // density) buildings of any zone. Reads as warm light leaking from
    // the ground floor onto the sidewalk. Mid-density (L2) buildings
    // stay halo-less so there's a clear visual hierarchy: low+medium
    // density blocks are subdued at night, high-density blocks shine.
    if (
      t.density >= 3
      && (t.zone === 'residential' || t.zone === 'commercial' || t.zone === 'mixed' || t.zone === 'industrial')
      && !t.skyscraper
      && !t.bridge
    ) {
      lamps.push({ cx, cz, y: baseY, r: 1.10 });
    }
    // Skyscrapers — single bigger halo per anchor tile that covers the
    // 2×2 footprint. Higher radius (1.80) because the building is taller
    // and the spill physically reaches further. Anchor logic mirrors
    // buildLitWindowsMesh's skyscraper detection.
    if (t.skyscraper && t.skyscraperStage >= 4) {
      const cmp = (px: number, py: number): boolean => {
        const p = grid.get(px, py);
        return !!(p && p.skyscraper && p.zone === t.zone && p.skyscraperVariant === t.skyscraperVariant);
      };
      const isAnchor = !cmp(t.x - 1, t.y) && !cmp(t.x, t.y - 1) && !cmp(t.x - 1, t.y - 1)
        && cmp(t.x + 1, t.y) && cmp(t.x, t.y + 1) && cmp(t.x + 1, t.y + 1);
      if (isAnchor) {
        lamps.push({ cx: t.x + 1.0, cz: t.y + 1.0, y: baseY, r: 1.80 });
      }
    }
  }
  if (lamps.length === 0) return null;

  const positions = new Float32Array(lamps.length * 4 * 3);
  const uvs = new Float32Array(lamps.length * 4 * 2);
  const indices = new Uint32Array(lamps.length * 6);

  let vi = 0, ui = 0, ii = 0, v = 0;
  for (const l of lamps) {
    const x0 = l.cx - l.r;
    const x1 = l.cx + l.r;
    const z0 = l.cz - l.r;
    const z1 = l.cz + l.r;
    const y = l.y;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;
    uvs[ui++] = 0; uvs[ui++] = 0;
    uvs[ui++] = 1; uvs[ui++] = 0;
    uvs[ui++] = 1; uvs[ui++] = 1;
    uvs[ui++] = 0; uvs[ui++] = 1;
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('uv', new BufferAttribute(uvs, 2));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Additive blending so overlapping lamps make the area properly
  // brighter, mimicking real light. depthWrite off so we don't z-fight
  // with the ground geometry below.
  const mat = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending
  });
  const mesh = new Mesh(geom, mat);
  mesh.visible = false;
  return mesh;
}

/** Build the lit-windows overlay (Alpha 3.1.6). Walks every developed
 *  building tile (medium+ R/C/MU, all skyscrapers at stage 4) and
 *  emits a small bright rectangle per window position. The whole mesh
 *  uses MeshBasicMaterial so windows always read at full brightness
 *  regardless of scene lighting; opacity is driven by applyTimeOfDay. */
export function buildLitWindowsMesh(grid: Grid): Mesh | null {
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  let v = 0;

  // Window palette — slightly varied warm yellows so windows don't look
  // identical. Each tile picks a deterministic colour from this list.
  const PALETTE = [0xfff0a8, 0xffe8a0, 0xf8d088, 0xffd8a8, 0xffe8c0];

  const addWindow = (x: number, y: number, z: number, w: number, h: number, dir: 'X' | 'Z', hex: number): void => {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    let p0x = 0, p0z = 0, p1x = 0, p1z = 0;
    if (dir === 'X') {
      // Window on a face perpendicular to z-axis; w extends in x.
      p0x = x - w / 2; p0z = z;
      p1x = x + w / 2; p1z = z;
    } else {
      // Face perpendicular to x-axis; w extends in z.
      p0x = x; p0z = z - w / 2;
      p1x = x; p1z = z + w / 2;
    }
    positions.push(p0x, y - h / 2, p0z);
    positions.push(p1x, y - h / 2, p1z);
    positions.push(p1x, y + h / 2, p1z);
    positions.push(p0x, y + h / 2, p0z);
    for (let i = 0; i < 4; i++) { colours.push(r, g, b); }
    indices.push(v, v + 2, v + 1);
    indices.push(v, v + 3, v + 2);
    v += 4;
  };

  for (const t of grid.iter()) {
    // Beta 1.6.17 — cx/cz no longer computed here; each developed-tile
    // branch fetches its variant's actual centre (which includes the
    // deterministic ±0.025 jitter) via getVariantBodyFootprint, so a
    // shared tile-centre value would only mislead.
    // Beta 1.6.19 — `>>> 0` forces unsigned int32 BEFORE the modulo,
    // so a large XOR result that overflows int32 to a negative number
    // no longer makes `palIdx` negative. Pre-1.6.19 a 32-bit-overflow
    // tile (e.g. coords like (36, 39)) got `palIdx = -2`, looked up
    // `PALETTE[-2] = undefined`, and addWindow's `(hex >> 16) & 0xff`
    // produced 0 for every channel — every lit window on that tile
    // rendered as a pitch-black quad invisible against the night sky.
    // This was the actual root cause of "skyscrapers don't pop at
    // night": the windows WERE there, just painted with no colour.
    const palIdx = ((Math.abs(t.x * 73856093) ^ Math.abs(t.y * 19349663)) >>> 0) % PALETTE.length;
    const litColor = PALETTE[palIdx]!;
    // Skyscrapers — emit lit windows up the height of the tower at the
    // anchor tile only (we let the renderer's anchor check exclude
    // duplicates by skipping non-anchors).
    if (t.skyscraper && t.skyscraperStage >= 4) {
      // Re-use anchor logic inline — same lex-smaller check.
      const cmp = (px: number, py: number): boolean => {
        const p = grid.get(px, py);
        return !!(p && p.skyscraper && p.zone === t.zone && p.skyscraperVariant === t.skyscraperVariant);
      };
      const isAnchor = !cmp(t.x - 1, t.y) && !cmp(t.x, t.y - 1) && !cmp(t.x - 1, t.y - 1)
        && cmp(t.x + 1, t.y) && cmp(t.x, t.y + 1) && cmp(t.x + 1, t.y + 1);
      if (!isAnchor) continue;
      // Anchor centre is at (anchor + 1.0). Read the actual design so
      // window placement matches the body geometry instead of guessing.
      // Without this, designs with high `inset` or low `setbackAtFrac`
      // showed windows floating in the air outside the body.
      const acx = t.x + 1.0;
      const acz = t.y + 1.0;
      const design = getSkyscraperDesign(t.zone as 'residential' | 'commercial' | 'mixed', t.skyscraperVariant);
      // The base body width is `2.0 - inset*2` and the setback (if any)
      // narrows to that × setbackInsetFactor. Windows live on whichever
      // body section they're inside.
      const baseHalfW = (2.0 - design.inset * 2) / 2;
      const towerHalfW = baseHalfW * (design.setbackInsetFactor || 1.0);
      const setbackY = design.setbackAtFrac > 0 && design.setbackAtFrac < 1
        ? design.height * design.setbackAtFrac
        : design.height; // no setback → never narrows
      // Skip the ground-level zone where podium glass already paints a
      // dark band (avoids overlap that washes out the glass).
      const startY = design.hasPodiumGlass ? 0.65 : 0.30;
      // Beta 1.6.19 — denser, brighter window grid so skyscrapers actually
      // pop at night. Pre-1.6.19: 3 columns at 0.10×0.18, ~75% lit. Now:
      // 5 columns at 0.13×0.22, ~87.5% lit. Pitch still matches the body's
      // 0.55 band spacing so windows sit cleanly between the dark glass
      // bands; end just below the crown band.
      const pitch = 0.55;
      const cols = 5;
      const winW = 0.13;
      const winH = 0.22;
      for (let row = 0; ; row++) {
        const wy = startY + row * pitch;
        if (wy > design.height - 0.45) break;
        const halfW = wy < setbackY ? baseHalfW : towerHalfW;
        if (halfW < 0.20) continue; // tower too narrow for windows at this height
        for (let col = 0; col < cols; col++) {
          // ~87.5% lit (skip only when low 3 bits all set) — only 1 in 8
          // windows dark, reads as a fully-occupied tower at night.
          if (((row * 7 + col + palIdx) & 7) === 7) continue;
          const t01 = (col + 0.5) / cols;
          const offset = -halfW * 0.88 + t01 * halfW * 1.76;
          // Inset windows just outside the body face so they don't
          // z-fight with the dark glass band geometry. The body face is
          // at ±halfW; windows sit at ±(halfW + 0.008).
          const surfaceOffset = halfW + 0.008;
          addWindow(acx + offset, wy, acz - surfaceOffset, winW, winH, 'X', litColor);
          addWindow(acx + offset, wy, acz + surfaceOffset, winW, winH, 'X', litColor);
          addWindow(acx + surfaceOffset, wy, acz + offset, winW, winH, 'Z', litColor);
          addWindow(acx - surfaceOffset, wy, acz + offset, winW, winH, 'Z', litColor);
        }
        // Second tower (twin designs) — emit windows on it too.
        if (design.secondTower) {
          const s = design.secondTower;
          if (wy > s.h - 0.45) continue;
          const sHalf = s.w / 2;
          const sx = acx + s.offsetX;
          const sz = acz + s.offsetZ;
          for (let col = 0; col < cols; col++) {
            // Match main-tower ~87.5% lit.
            if (((row * 11 + col + palIdx + 3) & 7) === 7) continue;
            const t01 = (col + 0.5) / cols;
            const offset = -sHalf * 0.88 + t01 * sHalf * 1.76;
            const surfaceOffset = sHalf + 0.008;
            addWindow(sx + offset, wy, sz - surfaceOffset, winW, winH, 'X', litColor);
            addWindow(sx + offset, wy, sz + surfaceOffset, winW, winH, 'X', litColor);
            addWindow(sx + surfaceOffset, wy, sz + offset, winW, winH, 'Z', litColor);
            addWindow(sx - surfaceOffset, wy, sz + offset, winW, winH, 'Z', litColor);
          }
        }
      }
      // Beta 1.6.8 — skyscraper crown band + apex beacon. Pushes the
      // skyline from "lit windows on tall boxes" to "iconic city silhouette."
      //
      // Crown band: a thin emissive ring near the body apex (below the
      // crown geometry). Zone-coloured so a financial district reads
      // cyan-blue while residential towers glow warm gold and mixed-use
      // splits the difference. Width matches whichever body section the
      // crown lives at (above or below the setback).
      //
      // Apex beacon: small red emissive cube (FAA aviation-warning
      // colour) at the very top. Identifies tall structures from across
      // the map and reads as a real-world skyline marker.
      const crownColor = t.zone === 'commercial' ? 0x80e0ff
        : t.zone === 'residential' ? 0xfff0a0
        : 0xfff0d0; // mixed
      const crownY = Math.max(0.30, design.height - 0.35);
      const crownHalf = crownY < setbackY ? baseHalfW : towerHalfW;
      if (crownHalf >= 0.18) {
        const crownBand = new BoxGeometry(crownHalf * 2 - 0.04, 0.05, crownHalf * 2 - 0.04);
        crownBand.translate(acx, crownY, acz);
        // Inline push: replicate the pushLit pattern from
        // addArchitecturalLights (we don't have the helper in scope here).
        const cb = crownBand.getAttribute('position');
        const cbIdx = crownBand.getIndex();
        const cbR = ((crownColor >> 16) & 0xff) / 255;
        const cbG = ((crownColor >> 8) & 0xff) / 255;
        const cbB = (crownColor & 0xff) / 255;
        const cbBase = v;
        for (let i = 0; i < cb.count; i++) {
          positions.push(cb.getX(i), cb.getY(i), cb.getZ(i));
          colours.push(cbR, cbG, cbB);
        }
        if (cbIdx) {
          for (let i = 0; i < cbIdx.count; i++) indices.push(cbBase + cbIdx.getX(i));
        }
        v += cb.count;
        crownBand.dispose();
      }
      // Apex beacon — red aviation warning light at the tower top.
      const beacon = new BoxGeometry(0.07, 0.07, 0.07);
      beacon.translate(acx, design.height + 0.05, acz);
      const bp = beacon.getAttribute('position');
      const bIdx = beacon.getIndex();
      const beaconBase = v;
      for (let i = 0; i < bp.count; i++) {
        positions.push(bp.getX(i), bp.getY(i), bp.getZ(i));
        // 0xff4040 — bright red beacon. R=1.0, G=0.25, B=0.25.
        colours.push(1.0, 0.25, 0.25);
      }
      if (bIdx) {
        for (let i = 0; i < bIdx.count; i++) indices.push(beaconBase + bIdx.getX(i));
      }
      v += bp.count;
      beacon.dispose();
      continue;
    }
    // Medium+ commercial / mixed-use — lit windows on all four faces.
    if (t.density >= 2 && (t.zone === 'commercial' || t.zone === 'mixed')) {
      // Beta 1.6.17 — fetch the variant's actual world-space footprint
      // and centre instead of using a hardcoded halfW + tile centre.
      // Pre-1.6.17 used cx=t.x+0.5, halfW=0.30 — variant bodies range
      // ~0.45..0.85 wide and have a ±0.025 deterministic jitter on the
      // centre, so lit windows floated 0.02–0.10 off small bodies and
      // hid inside the larger ones (L3 body.w grows to ~0.80).
      const fp = getVariantBodyFootprint(t.zone, t.density, t.x, t.y);
      if (!fp) continue;
      const { cx: bcx, cz: bcz, halfX, halfZ, height: h } = fp;
      // Beta 1.6.19 — denser grid on max-density tiles so L3+ commercial
      // towers pop at night like real downtown blocks. L2 stays 2×3 with
      // a sparse pattern; L3+ gets 4 rows × 4 cols at slightly larger
      // window quads and ~87.5% lit. The result is roughly 50 visible
      // lit windows per max-density tile (up from ~9) — enough to read
      // as a fully-occupied office.
      const isMaxDensity = t.density >= 3;
      const rows = t.density === 2 ? 2 : t.density === 3 ? 4 : 5;
      const cols = isMaxDensity ? 4 : 3;
      const winW = isMaxDensity ? 0.11 : 0.08;
      const winH = isMaxDensity ? 0.18 : 0.14;
      const colSpreadX = halfX * (isMaxDensity ? 0.85 : 0.7);
      const colSpreadZ = halfZ * (isMaxDensity ? 0.85 : 0.7);
      for (let row = 0; row < rows; row++) {
        const wy = 0.30 + row * 0.30;
        if (wy > h - 0.10) break;
        for (let col = 0; col < cols; col++) {
          // L3+ ~87.5% lit (skip when low 3 bits set); L2 ~50% (mask=2).
          const skip = isMaxDensity
            ? ((row * 7 + col + palIdx) & 7) === 7
            : ((row * 5 + col + palIdx) & 2) === 0;
          if (skip) continue;
          // Windows on the +Z and -Z faces span across X — use halfX spread.
          const t01 = (col + 0.5) / cols;
          const offsetX = -colSpreadX + t01 * (colSpreadX * 2);
          addWindow(bcx + offsetX, wy, bcz + halfZ + 0.005, winW, winH, 'X', litColor);
          addWindow(bcx + offsetX, wy, bcz - halfZ - 0.005, winW, winH, 'X', litColor);
          // Windows on the +X and -X faces span across Z — use halfZ spread.
          const offsetZ = -colSpreadZ + t01 * (colSpreadZ * 2);
          addWindow(bcx + halfX + 0.005, wy, bcz + offsetZ, winW, winH, 'Z', litColor);
          addWindow(bcx - halfX - 0.005, wy, bcz + offsetZ, winW, winH, 'Z', litColor);
        }
      }
      // Apex beacon for L3+ commercial / mixed.
      if (t.density >= 3) {
        const b = new BoxGeometry(0.06, 0.06, 0.06);
        b.translate(bcx, h + 0.04, bcz);
        const bp = b.getAttribute('position');
        const bIdx = b.getIndex();
        const beaconBase = v;
        for (let i = 0; i < bp.count; i++) {
          positions.push(bp.getX(i), bp.getY(i), bp.getZ(i));
          colours.push(1.0, 0.25, 0.25);
        }
        if (bIdx) {
          for (let i = 0; i < bIdx.count; i++) indices.push(beaconBase + bIdx.getX(i));
        }
        v += bp.count;
        b.dispose();
      }
    }
    // Beta 1.6.8 — Medium+ residential lit windows. Pre-1.6.8 only C/MU
    // got window overlays; an apartment block on the same street stayed
    // visually dark while the offices next door glowed. Now L2 and L3+
    // residential emit warm-yellow windows that read as "people are
    // home". Higher "lit" density (~70% on) than commercial because
    // homes have lights on at night while offices are mostly empty.
    if (t.density >= 2 && t.zone === 'residential' && !t.luxury && !t.skyscraper) {
      // Beta 1.6.17 — fetch variant footprint (see commercial branch above).
      const fp = getVariantBodyFootprint(t.zone, t.density, t.x, t.y);
      if (!fp) continue;
      const { cx: bcx, cz: bcz, halfX, halfZ, height: h } = fp;
      // Beta 1.6.19 — denser grid on max-density apartments so L3+
      // residential reads as a fully-occupied building (lights in
      // most windows). L2 keeps its 3-col mostly-on pattern.
      const isMaxDensity = t.density >= 3;
      const rows = t.density === 2 ? 2 : t.density === 3 ? 4 : 5;
      const cols = isMaxDensity ? 4 : 3;
      const winW = isMaxDensity ? 0.11 : 0.08;
      const winH = isMaxDensity ? 0.18 : 0.14;
      const colSpreadX = halfX * (isMaxDensity ? 0.85 : 0.7);
      const colSpreadZ = halfZ * (isMaxDensity ? 0.85 : 0.7);
      for (let row = 0; row < rows; row++) {
        const wy = 0.30 + row * 0.30;
        if (wy > h - 0.10) break;
        for (let col = 0; col < cols; col++) {
          // L3+ ~87.5% lit. L2 keeps the existing ~75% (skip only when
          // both low bits set).
          const skip = isMaxDensity
            ? ((row * 7 + col + palIdx) & 7) === 7
            : ((row * 5 + col + palIdx) & 3) === 3;
          if (skip) continue;
          const t01 = (col + 0.5) / cols;
          const offsetX = -colSpreadX + t01 * (colSpreadX * 2);
          addWindow(bcx + offsetX, wy, bcz + halfZ + 0.005, winW, winH, 'X', litColor);
          addWindow(bcx + offsetX, wy, bcz - halfZ - 0.005, winW, winH, 'X', litColor);
          const offsetZ = -colSpreadZ + t01 * (colSpreadZ * 2);
          addWindow(bcx + halfX + 0.005, wy, bcz + offsetZ, winW, winH, 'Z', litColor);
          addWindow(bcx - halfX - 0.005, wy, bcz + offsetZ, winW, winH, 'Z', litColor);
        }
      }
      // Apex beacon for L3+ residential.
      if (t.density >= 3) {
        const b = new BoxGeometry(0.06, 0.06, 0.06);
        b.translate(bcx, h + 0.04, bcz);
        const bp = b.getAttribute('position');
        const bIdx = b.getIndex();
        const beaconBase = v;
        for (let i = 0; i < bp.count; i++) {
          positions.push(bp.getX(i), bp.getY(i), bp.getZ(i));
          colours.push(1.0, 0.25, 0.25);
        }
        if (bIdx) {
          for (let i = 0; i < bIdx.count; i++) indices.push(beaconBase + bIdx.getX(i));
        }
        v += bp.count;
        b.dispose();
      }
    }
    // Beta 1.6.8 — Medium+ industrial lit windows. Sparse cool-white
    // utility/security lighting on the front face. Reads as factory
    // floor work lights or shipping-dock floods rather than home/office
    // warmth. Industrial L3+ also gets the apex beacon so the skyline
    // is consistent regardless of zone.
    if (t.density >= 2 && t.zone === 'industrial' && !t.skyscraper) {
      const INDUSTRIAL_LIT = 0xddeaff; // cool blue-white floodlight
      // Beta 1.6.17 — fetch variant footprint (see commercial branch above).
      const fp = getVariantBodyFootprint(t.zone, t.density, t.x, t.y);
      if (!fp) continue;
      const { cx: bcx, cz: bcz, halfX, halfZ, height: h } = fp;
      const rows = t.density === 2 ? 1 : t.density === 3 ? 2 : 3;
      // Sparser column spread (industrial security lights aren't window
      // banks — keep them clustered around the entrance area).
      const colSpreadX = halfX * 0.8;
      const colSpreadZ = halfZ * 0.8;
      for (let row = 0; row < rows; row++) {
        const wy = 0.25 + row * 0.30;
        if (wy > h - 0.05) break;
        for (let col = 0; col < 2; col++) {
          // Sparse — only ~30% on (security lighting feel).
          if (((row * 7 + col + palIdx * 3) & 3) !== 0) continue;
          const offsetX = -colSpreadX * 0.5 + col * colSpreadX;
          addWindow(bcx + offsetX, wy, bcz + halfZ + 0.005, 0.10, 0.08, 'X', INDUSTRIAL_LIT);
          addWindow(bcx + offsetX, wy, bcz - halfZ - 0.005, 0.10, 0.08, 'X', INDUSTRIAL_LIT);
          const offsetZ = -colSpreadZ * 0.5 + col * colSpreadZ;
          addWindow(bcx + halfX + 0.005, wy, bcz + offsetZ, 0.10, 0.08, 'Z', INDUSTRIAL_LIT);
          addWindow(bcx - halfX - 0.005, wy, bcz + offsetZ, 0.10, 0.08, 'Z', INDUSTRIAL_LIT);
        }
      }
      if (t.density >= 3) {
        const b = new BoxGeometry(0.06, 0.06, 0.06);
        b.translate(bcx, h + 0.04, bcz);
        const bp = b.getAttribute('position');
        const bIdx = b.getIndex();
        const beaconBase = v;
        for (let i = 0; i < bp.count; i++) {
          positions.push(bp.getX(i), bp.getY(i), bp.getZ(i));
          colours.push(1.0, 0.25, 0.25);
        }
        if (bIdx) {
          for (let i = 0; i < bIdx.count; i++) indices.push(beaconBase + bIdx.getX(i));
        }
        v += bp.count;
        b.dispose();
      }
    }
    // Architectural decoratives (Alpha 4.2.1) — every plaza / fountain /
    // statue / clock-tower / monument that is touchable from the
    // Architect Mode menu gets a unique lit overlay so the late-game
    // city becomes a luminous showpiece at night. Each case emits its
    // own pattern. We piggyback on the same addWindow quad helper
    // (cheap, vertex-coloured, MeshBasicMaterial) and a new pushLit
    // helper for non-quad lights (spheres, cylinders, accent rings)
    // declared just below.
    addArchitecturalLights(t, addWindow, (geom, hex) => {
      const r2 = ((hex >> 16) & 0xff) / 255;
      const g2 = ((hex >> 8) & 0xff) / 255;
      const b2 = (hex & 0xff) / 255;
      const p = geom.getAttribute('position');
      const idx = geom.getIndex();
      const baseV = v;
      for (let i = 0; i < p.count; i++) {
        positions.push(p.getX(i), p.getY(i), p.getZ(i));
        colours.push(r2, g2, b2);
      }
      if (idx) {
        for (let i = 0; i < idx.count; i++) indices.push(baseV + idx.getX(i));
      } else {
        for (let i = 0; i < p.count; i++) indices.push(baseV + i);
      }
      v += p.count;
      geom.dispose();
    });
  }

  if (positions.length === 0) return null;
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3));
  geom.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  const mat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    // Beta 1.6.13 — DoubleSide so windows on the +Z and -X faces aren't
    // back-face culled. addWindow's vertex winding gives every quad a
    // fixed front-face normal (X-quads face -z, Z-quads face +x), so the
    // wrap-around windows added in 1.6.12 were only visible on two of the
    // four faces — buildings looked half-lit depending on camera yaw.
    // Depth-write is off and the building body still depth-occludes any
    // far-side window, so DoubleSide adds no overdraw cost in practice.
    side: DoubleSide
  });
  const mesh = new Mesh(geom, mat);
  mesh.visible = false;
  return mesh;
}

/**
 * Per-architectural-building lit overlay (Alpha 4.2.1). Each plaza /
 * fountain / statue / clock-tower / arch / mansion gets a tailored
 * set of glowing accents that fade in at night. Reuses the lit-windows
 * mesh's MeshBasicMaterial pipeline so opacity ramps with the
 * day/night cycle without any extra material work.
 *
 * `addWin` paints a flat lit quad on a vertical face (unchanged from
 * the C/MU window pipeline). `pushLit` accepts arbitrary BufferGeometry
 * and pushes its vertices into the lit-mesh stream — used for spheres,
 * cylinders, and other 3D accents that read as "light fixtures glowing
 * in the dark" rather than "windows on a face".
 *
 * Colours: a warm amber (0xffe8a0) for table lamps + bollards + door
 * lights; a soft white (0xfff8e0) for window glass; a gold (0xfff0a0)
 * for monument finials + escutcheons; a cool dusk blue (0xa0d0f0) for
 * water surfaces + reflecting pools (reads as moonlight bouncing).
 */
function addArchitecturalLights(
  t: import('../../world/Tile').Tile,
  addWin: (x: number, y: number, z: number, w: number, h: number, dir: 'X' | 'Z', hex: number) => void,
  pushLit: (geom: BufferGeometry, hex: number) => void
): void {
  const cx = t.x + 0.5;
  const cz = t.y + 0.5;
  const AMBER = 0xffe8a0;
  const WARM_WHITE = 0xfff8e0;
  const GOLD = 0xfff0a0;
  const DUSK_WATER = 0xa0d0f0;
  const PALE_TEAL = 0xb0e0d0;

  switch (t.building) {
    case 'plaza': {
      // Lit bollard tops at the four lot corners + glow on top of the
      // central planter so the plaza reads as occupied at night.
      for (const [dx, dz] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]] as Array<[number, number]>) {
        const bulb = new IcosahedronGeometry(0.040, 1);
        bulb.translate(cx + dx, 0.20, cz + dz);
        pushLit(bulb, AMBER);
      }
      // Soft glow ring on the central planter (reads as accent uplighting).
      const planterGlow = new BoxGeometry(0.32, 0.020, 0.32);
      planterGlow.translate(cx, 0.18, cz);
      pushLit(planterGlow, WARM_WHITE);
      break;
    }
    case 'fountain': {
      // Glowing crown sphere + glowing central column (the column reads
      // as a lit shaft at night) + glowing water surface.
      const crown = new IcosahedronGeometry(0.085, 1);
      crown.translate(cx, 0.72, cz);
      pushLit(crown, GOLD);
      // Central column glow — slightly larger than the column itself so
      // it reads as the column emitting light.
      const colGlow = new CylinderGeometry(0.075, 0.075, 0.40, 8);
      colGlow.translate(cx, 0.32, cz);
      pushLit(colGlow, WARM_WHITE);
      // Water disc inside the basin — soft blue glow as if uplit.
      const waterGlow = new CylinderGeometry(0.32, 0.32, 0.020, 16);
      waterGlow.translate(cx, 0.155, cz);
      pushLit(waterGlow, DUSK_WATER);
      break;
    }
    case 'statue': {
      // Bronze figure backlit by a low ring of uplighting around the
      // plinth + a halo glow above the head.
      const ring = new CylinderGeometry(0.18, 0.18, 0.014, 12);
      ring.translate(cx, 0.025, cz);
      pushLit(ring, WARM_WHITE);
      // Subtle head glow (the bronze head catches the uplight).
      const headHalo = new IcosahedronGeometry(0.06, 1);
      headHalo.translate(cx, 0.86, cz);
      pushLit(headHalo, AMBER);
      break;
    }
    case 'flower_bed': {
      // Tiny accent dots on the dot-flowers so the bed reads as
      // luminous wildflowers at night.
      for (const [dx, dz] of [[-0.28, -0.06], [-0.10, 0.06], [0.08, -0.06], [0.26, 0.06]] as Array<[number, number]>) {
        const accent = new IcosahedronGeometry(0.025, 1);
        accent.translate(cx + dx, 0.13, cz + dz);
        pushLit(accent, GOLD);
      }
      break;
    }
    case 'topiary': {
      // Glowing tops on the four corner topiary cones.
      for (const [dx, dz] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]] as Array<[number, number]>) {
        const top = new IcosahedronGeometry(0.030, 1);
        top.translate(cx + dx, 0.24, cz + dz);
        pushLit(top, AMBER);
      }
      // Centre topiary ball glow.
      const centre = new IcosahedronGeometry(0.045, 1);
      centre.translate(cx, 0.24, cz);
      pushLit(centre, WARM_WHITE);
      break;
    }
    case 'pergola': {
      // String-light effect: 5 bulbs hanging under the cross-beams +
      // bulb at each of the 4 corner posts.
      for (const [dx, dz] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]] as Array<[number, number]>) {
        const post = new IcosahedronGeometry(0.040, 1);
        post.translate(cx + dx, 0.50, cz + dz);
        pushLit(post, AMBER);
      }
      for (const dx of [-0.32, -0.16, 0.0, 0.16, 0.32]) {
        const string = new IcosahedronGeometry(0.030, 1);
        string.translate(cx + dx, 0.46, cz);
        pushLit(string, GOLD);
      }
      break;
    }
    case 'reflecting_pool': {
      // Long glowing strip along the centre of the water — reads as
      // moonlight catching the still surface.
      const surface = new BoxGeometry(0.70, 0.018, 0.06);
      surface.translate(cx, 0.07, cz);
      pushLit(surface, DUSK_WATER);
      // Four corner bollard caps glow.
      for (const [dx, dz] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]] as Array<[number, number]>) {
        const cap = new IcosahedronGeometry(0.030, 1);
        cap.translate(cx + dx, 0.13, cz + dz);
        pushLit(cap, AMBER);
      }
      break;
    }
    case 'memorial_garden': {
      // Spotlit obelisk (top + base ring) — reads as a national-style
      // floodlit civic monument at night.
      const obeliskTop = new IcosahedronGeometry(0.06, 1);
      obeliskTop.translate(cx, 1.05, cz);
      pushLit(obeliskTop, GOLD);
      const obeliskMid = new IcosahedronGeometry(0.05, 1);
      obeliskMid.translate(cx, 0.65, cz);
      pushLit(obeliskMid, WARM_WHITE);
      // Base spotlight ring.
      const baseRing = new CylinderGeometry(0.22, 0.22, 0.014, 12);
      baseRing.translate(cx, 0.09, cz);
      pushLit(baseRing, WARM_WHITE);
      break;
    }
    case 'clock_tower': {
      // Glowing clock face (white ring around the dark dial), glowing
      // belfry openings, glowing cupola lantern, glowing finial.
      // The clock-face geometry sits at z = +0.245 of the tile centre.
      const clockFace = new CylinderGeometry(0.11, 0.11, 0.018, 16);
      clockFace.rotateX(Math.PI / 2);
      clockFace.translate(cx, 1.05, cz + 0.247);
      pushLit(clockFace, WARM_WHITE);
      // Belfry — open arched section glows.
      const belfry = new BoxGeometry(0.45, 0.14, 0.45);
      belfry.translate(cx, 1.30, cz);
      pushLit(belfry, AMBER);
      // Spire ball finial — shines bright.
      const finial = new IcosahedronGeometry(0.05, 1);
      finial.translate(cx, 1.91, cz);
      pushLit(finial, GOLD);
      // Tower-body windows on the front face.
      for (const dy of [0.50, 0.78]) {
        addWin(cx, dy, cz + 0.205, 0.10, 0.18, 'X', WARM_WHITE);
      }
      break;
    }
    case 'triumphal_arch': {
      // Floodlit gold lettering plaque + glowing crown ornament + a
      // soft glow inside the archway opening.
      const plaque = new BoxGeometry(0.32, 0.06, 0.020);
      plaque.translate(cx, 1.08, cz + 0.255);
      pushLit(plaque, GOLD);
      const crown = new IcosahedronGeometry(0.07, 1);
      crown.translate(cx, 1.32, cz);
      pushLit(crown, GOLD);
      // Glow under the arch (soft warm light filling the opening).
      const archGlow = new BoxGeometry(0.40, 0.40, 0.40);
      archGlow.translate(cx, 0.55, cz);
      pushLit(archGlow, AMBER);
      break;
    }
    case 'pier': {
      // Glowing seaward bollards (the rope-end posts on the deck).
      for (const dx of [-0.30, 0.30]) {
        const cap = new IcosahedronGeometry(0.040, 1);
        cap.translate(cx + dx, 0.30, cz + 0.36);
        pushLit(cap, AMBER);
      }
      break;
    }
    case 'mayor_mansion': {
      // The showpiece. Lit windows across all five mansion blocks +
      // glowing dome + glowing pediment escutcheon + glowing grand door
      // + glowing lamppost bulbs. Mansion geometry is anchored at
      // (ax, ay) = (t.x, t.y) (lex-smallest tile of the 4×2 footprint).
      const ax = t.x;
      const ay = t.y;
      const mcx = ax + 2;          // footprint centre X
      const fcz = ay + 1;          // footprint centre Z
      const mz = fcz - 0.5;        // mansion-row centre Z
      const mansionDepth = 0.65;
      const mansionBackZ = mz - 0.10;
      const frontFace = mansionBackZ + mansionDepth / 2 + 0.005;

      // Wing windows — 6 lit panels per wing × 2 wings = 12.
      for (const wingX of [-1.30, 1.30]) {
        for (let story = 0; story < 2; story++) {
          const yWindow = 0.06 + 0.18 + story * 0.32;
          for (const wxOff of [-0.25, 0.0, 0.25]) {
            addWin(mcx + wingX + wxOff, yWindow, frontFace, 0.08, 0.16, 'X', WARM_WHITE);
          }
        }
      }
      // Inner-block windows — 4 lit per block × 2 = 8.
      for (const innerX of [-0.55, 0.55]) {
        for (let story = 0; story < 2; story++) {
          const yWindow = 0.06 + 0.22 + story * 0.38;
          for (const wxOff of [-0.13, 0.13]) {
            addWin(mcx + innerX + wxOff, yWindow, frontFace, 0.09, 0.20, 'X', WARM_WHITE);
          }
        }
      }
      // Central-block: story-2 (2 windows flanking pediment) + story-3
      // (4 round-top windows above the pediment).
      for (const wxOff of [-0.34, 0.34]) {
        addWin(mcx + wxOff, 0.06 + 0.55, frontFace, 0.10, 0.22, 'X', WARM_WHITE);
      }
      for (const wxOff of [-0.30, -0.10, 0.10, 0.30]) {
        addWin(mcx + wxOff, 0.06 + 0.95, frontFace, 0.08, 0.14, 'X', WARM_WHITE);
      }
      // Grand door — warm doorway light.
      addWin(mcx, 0.06 + 0.22, frontFace, 0.18, 0.40, 'X', AMBER);
      // Pediment escutcheon — gold relief plaque glow. Matches the
      // 4.2.2 cleaned-up pediment geometry: pedY = 0.06 + 1.10*0.85,
      // pedZ = mansionBackZ + 0.65/2 + 0.05; escutcheon at +0.10/+0.07.
      const escutcheon = new BoxGeometry(0.10, 0.07, 0.022);
      escutcheon.translate(mcx, 0.06 + 1.10 * 0.85 + 0.10, mansionBackZ + mansionDepth / 2 + 0.05 + 0.07);
      pushLit(escutcheon, GOLD);
      // Dome glow — entire dome reads luminous (soft uplighting).
      const dome = new ConeGeometry(0.20, 0.30, 16);
      dome.translate(mcx, 0.06 + 1.10 + 0.36, mansionBackZ);
      pushLit(dome, PALE_TEAL);
      // Cupola + spire finial — bright gold beacons on top.
      const cupola = new IcosahedronGeometry(0.055, 1);
      cupola.translate(mcx, 0.06 + 1.10 + 0.64, mansionBackZ);
      pushLit(cupola, GOLD);
      const ball = new IcosahedronGeometry(0.045, 1);
      ball.translate(mcx, 0.06 + 1.10 + 0.91, mansionBackZ);
      pushLit(ball, GOLD);
      // Lamppost bulbs flanking the entrance steps — bright amber.
      for (const lx of [-0.85, 0.85]) {
        const bulb = new IcosahedronGeometry(0.045, 1);
        bulb.translate(mcx + lx, 0.55, mz + 0.50);
        pushLit(bulb, AMBER);
      }
      // Front-gate-post finials glow gold.
      for (const px of [-0.50, 0.50]) {
        const gateF = new IcosahedronGeometry(0.040, 1);
        gateF.translate(mcx + px, 0.34, fcz + 0.97);
        pushLit(gateF, GOLD);
      }
      // Reflecting-pool surface glow strips — moonlight on the water.
      for (const sideX of [-1.10, 1.10]) {
        const surf = new BoxGeometry(0.35, 0.018, 0.04);
        surf.translate(mcx + sideX, 0.052, fcz + 0.50);
        pushLit(surf, DUSK_WATER);
      }
      break;
    }
  }
}

/** Districts overlay mesh (Alpha 2.22). Translucent tint per district. */
export function buildDistrictsMesh(grid: Grid, districts: import('../../simulation/Districts').Districts): Mesh | null {
  let count = 0;
  for (const t of grid.iter()) if (t.districtId > 0) count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color();
  const baseY = ROAD_LIFT * 0.15;

  let vi = 0, ci = 0, ii = 0, v = 0;
  for (const t of grid.iter()) {
    if (t.districtId === 0) continue;
    const d = districts.get(t.districtId);
    if (!d) continue;
    c.setHex(d.color);
    const x0 = t.x * TILE_SIZE;
    const x1 = (t.x + 1) * TILE_SIZE;
    const z0 = t.y * TILE_SIZE;
    const z1 = (t.y + 1) * TILE_SIZE;
    const y = baseY + t.elevation;

    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.30,
    depthWrite: false
  });
  return new Mesh(geom, mat);
}

/** Crime heatmap (Alpha 2.21): one quad per zoned tile coloured by Crime
 *  score [0, 1]. Distinct purple-tinted gradient so it doesn't visually
 *  compete with the green→red traffic heatmap. */
export function buildCrimeHeatmapMesh(grid: Grid, crime: import('../../simulation/Crime').Crime): Mesh | null {
  let count = 0;
  for (const t of grid.iter()) if (t.zone !== 'none' && t.density > 0) count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color();
  const inset = 0.06;
  const baseY = ROAD_LIFT * 0.3;

  let vi = 0, ci = 0, ii = 0, v = 0;
  for (const t of grid.iter()) {
    if (t.zone === 'none' || t.density === 0) continue;
    crimeColor(crime.scoreAt(grid, t.x, t.y), c);
    const x0 = t.x * TILE_SIZE + inset;
    const x1 = (t.x + 1) * TILE_SIZE - inset;
    const z0 = t.y * TILE_SIZE + inset;
    const z1 = (t.y + 1) * TILE_SIZE - inset;
    const y = baseY + t.elevation;

    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  const mat = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55 });
  return new Mesh(geom, mat);
}

function crimeColor(score: number, out: Color): void {
  // Calm pale-green at 0 → muted purple at 0.5 → magenta-red at 1.
  const lo = 0xb6e0bb;
  const mid = 0x9c5a9e;
  const hi = 0xc73a52;
  if (score <= 0.5) {
    const t = Math.max(0, Math.min(1, score / 0.5));
    out.setHex(lo).lerp(new Color(mid), t);
  } else {
    const t = Math.max(0, Math.min(1, (score - 0.5) / 0.5));
    out.setHex(mid).lerp(new Color(hi), t);
  }
}

// --- City buildings -----------------------------------------------------

/**
 * Build a single merged Mesh containing all placed city buildings. Each
 * building kind contributes a distinctive low-poly geometry with its own
 * colour via vertex colours. Result is one draw call regardless of count.
 *
 * Geometry choices:
 * - power_plant: dark grey box + red chimney cylinder
 * - water_tower: blue cylinder on a thinner support
 * - park: flat green pad + a tiny cone tree
 * - bus_stop: thin yellow pole + a small canopy
 * - bus_depot: orange box (bigger than bus_stop)
 */
export function buildCityBuildingsMesh(grid: Grid, forestryHealth: number, farmHealth: number): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];

  // Modular parks (Alpha 2.6) and modular forestry (Alpha 2.7) both
  // flood-fill: instead of rendering each tile of the same kind in
  // isolation, group adjacent ones into clusters and emit ONE bigger
  // structure scaled / themed by cluster size. Non-clustered city
  // buildings still render per-tile.
  const visited = new Set<number>();
  for (const t of grid.iter()) {
    if (t.building === 'none') continue;
    if (t.building === 'park') {
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      const cluster = floodBuilding(grid, t.x, t.y, 'park', visited);
      const parts = parkClusterParts(cluster);
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(p.dx, p.dy, p.dz);
        geoms.push(g);
        colours.push(tint(p.color));
      }
      continue;
    }
    if (t.building === 'forestry') {
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      const cluster = floodBuilding(grid, t.x, t.y, 'forestry', visited);
      const parts = forestryClusterParts(cluster, forestryHealth);
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(p.dx, p.dy, p.dz);
        geoms.push(g);
        colours.push(tint(p.color));
      }
      continue;
    }
    if (t.building === 'farm') {
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      const cluster = floodBuilding(grid, t.x, t.y, 'farm', visited);
      const parts = farmClusterParts(cluster, farmHealth);
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(p.dx, p.dy, p.dz);
        geoms.push(g);
        colours.push(tint(p.color));
      }
      continue;
    }
    // Warehouse (Beta 1.6) — modular cluster of adjacent warehouse
    // tiles forms one freight distribution centre. Same per-tile
    // exterior-side detection pattern as bigBoxClusterParts; absorbs
    // adjacent parking_lot tiles into the apron.
    if (t.building === 'warehouse') {
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      const cluster = floodBuilding(grid, t.x, t.y, 'warehouse', visited);
      const parts = warehouseClusterParts(cluster, grid);
      for (const c of cluster) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = c.x + dx, ny = c.y + dy;
          const nt = grid.get(nx, ny);
          if (nt && nt.building === 'parking_lot') {
            visited.add(ny * grid.width + nx);
          }
        }
      }
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(p.dx, p.dy, p.dz);
        geoms.push(g);
        colours.push(tint(p.color));
      }
      continue;
    }
    // Big Box (Beta 1.3) — modular cluster of adjacent big_box tiles
    // forms one strip-mall composition. The cluster builder also
    // absorbs adjacent parking_lot tiles into the same paved field.
    if (t.building === 'big_box') {
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      const cluster = floodBuilding(grid, t.x, t.y, 'big_box', visited);
      const parts = bigBoxClusterParts(cluster, grid);
      // Also mark adjacent parking tiles as visited so they don't
      // double-render when the per-tile parking_lot branch fires.
      for (const c of cluster) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = c.x + dx, ny = c.y + dy;
          const nt = grid.get(nx, ny);
          if (nt && nt.building === 'parking_lot') {
            visited.add(ny * grid.width + nx);
          }
        }
      }
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(p.dx, p.dy, p.dz);
        geoms.push(g);
        colours.push(tint(p.color));
      }
      continue;
    }
    // Parking Lot (Beta 1.3) — standalone tile. Note: parking tiles
    // adjacent to a big_box already rendered with the big_box cluster
    // above (and have been added to `visited`), so only orphan
    // parking lots reach this branch.
    if (t.building === 'parking_lot') {
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      visited.add(key);
      const parts = parkingLotParts([{ x: t.x, y: t.y }], grid);
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(p.dx, p.dy, p.dz);
        geoms.push(g);
        colours.push(tint(p.color));
      }
      continue;
    }
    // Mayor's Mansion (Alpha 4.2) — single-instance 4×2 showpiece. The
    // anchor tile (lex-smallest of the footprint) carries `building =
    // 'mayor_mansion'`; the other seven tiles have `mayorMansion=true`
    // but `building='none'` (so the generic loop skips them via the
    // `'none'` check at the top). Emit the entire merged composition
    // from the anchor; lift by the anchor tile's elevation so the
    // estate sits on the ground.
    if (t.building === 'mayor_mansion') {
      const parts = buildMayorMansionParts(t.x, t.y);
      const yLift = ROAD_LIFT * 0.5 + t.elevation;
      // Apply per-anchor rotation (Alpha 4.21). Rotates each part's
      // geometry around the rotated footprint center so the whole
      // composition turns as a rigid body.
      rotateBigBuildPartsInPlace(parts, t.bigBuildRotation, t.x, t.y, MAYOR_MANSION_WIDTH, MAYOR_MANSION_DEPTH);
      for (const p of parts) {
        if (yLift !== 0) p.geom.translate(0, yLift, 0);
        geoms.push(p.geom);
        colours.push(tint(p.color));
      }
      continue;
    }
    // Civic monuments (Alpha 4.12). Same anchor-tile pattern as the
    // Mayor's Mansion — emit the entire merged composition from the
    // anchor tile; the other footprint tiles are skipped because their
    // `building` is `'none'`.
    if (t.building === 'city_hall') {
      const parts = buildCityHallParts(t.x, t.y);
      const yLift = ROAD_LIFT * 0.5 + t.elevation;
      rotateBigBuildPartsInPlace(parts, t.bigBuildRotation, t.x, t.y, CITY_HALL_WIDTH, CITY_HALL_DEPTH);
      for (const p of parts) {
        if (yLift !== 0) p.geom.translate(0, yLift, 0);
        geoms.push(p.geom);
        colours.push(tint(p.color));
      }
      continue;
    }
    if (t.building === 'provincial_capital') {
      const parts = buildProvincialCapitalParts(t.x, t.y);
      const yLift = ROAD_LIFT * 0.5 + t.elevation;
      rotateBigBuildPartsInPlace(parts, t.bigBuildRotation, t.x, t.y, PROVINCIAL_CAPITAL_WIDTH, PROVINCIAL_CAPITAL_DEPTH);
      for (const p of parts) {
        if (yLift !== 0) p.geom.translate(0, yLift, 0);
        geoms.push(p.geom);
        colours.push(tint(p.color));
      }
      continue;
    }
    if (t.building === 'national_capital') {
      const parts = buildNationalCapitalParts(t.x, t.y);
      const yLift = ROAD_LIFT * 0.5 + t.elevation;
      rotateBigBuildPartsInPlace(parts, t.bigBuildRotation, t.x, t.y, NATIONAL_CAPITAL_WIDTH, NATIONAL_CAPITAL_DEPTH);
      for (const p of parts) {
        if (yLift !== 0) p.geom.translate(0, yLift, 0);
        geoms.push(p.geom);
        colours.push(tint(p.color));
      }
      continue;
    }
    // Cloverleaf interchange (Alpha 4.17) — same anchor-tile dispatch
    // pattern. Anchor's `building` is `'cloverleaf'` once all 25 blocks
    // are paid; the geometry includes the highway through-lanes,
    // bridge, loop ramps, infields, and lampposts. The OTHER 24
    // footprint tiles render nothing here (their per-tile road
    // visual is handled by drawRoads since they're real road tiles
    // after finalizeCloverleaf).
    if (t.building === 'cloverleaf') {
      const parts = buildCloverleafParts(t.x, t.y);
      const yLift = t.elevation;   // cloverleaf parts have their own y; just lift for terrain
      for (const p of parts) {
        if (yLift !== 0) p.geom.translate(0, yLift, 0);
        geoms.push(p.geom);
        colours.push(tint(p.color));
      }
      continue;
    }
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    // Service buildings (Alpha 4.3) — asymmetric kinds (school clock-
    // tower, hospital red-cross sign, fire-station bay doors, police
    // porch, museum colonnade, bus stop bench/canopy, depot garage
    // door) rotate to face the nearest road. Symmetric kinds (park,
    // utilities, stadium, observatory, ferry, subway) skip rotation
    // because they look the same from any angle.
    const yaw = SERVICE_BUILDING_ROTATES.has(t.building as Exclude<typeof t.building, 'none'>)
      ? computeRoadFacingYaw(grid, t.x, t.y) ?? 0
      : 0;
    const parts = cityBuildingParts(t.building);
    if (yaw !== 0) {
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      for (const p of parts) {
        const g = p.makeGeom();
        g.rotateY(yaw);
        // Rotate the (dx, dz) offset around the tile centre so the
        // whole composition turns as one rigid body.
        const dxR = p.dx * cosY - p.dz * sinY;
        const dzR = p.dx * sinY + p.dz * cosY;
        g.translate(cx + dxR, p.dy, cz + dzR);
        geoms.push(g);
        colours.push(tint(p.color));
      }
    } else {
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(cx + p.dx, p.dy, cz + p.dz);
        geoms.push(g);
        colours.push(tint(p.color));
      }
    }
    // Walkway connecting the building's front face to the adjacent road
    // tile (Alpha 4.3). Empty when no road is adjacent — service tiles
    // dropped mid-block don't get a path leading to grass.
    const walkway = buildServiceWalkway(grid, t.x, t.y, t.building);
    for (const p of walkway) {
      const g = p.makeGeom();
      g.translate(cx + p.dx, p.dy, cz + p.dz);
      geoms.push(g);
      colours.push(tint(p.color));
    }
  }

  // Per-block construction sites (Alpha 4.15). A second pass over every
  // tile that is part of an INCOMPLETE big civic build (kind-bit set
  // but `building` not yet promoted to the kind value, AND this tile's
  // block has been paid for). Each emits a small scaffolding visual
  // — wooden frame + corner posts + tarp — fitting inside one tile.
  // Unpaid tiles of the same footprint render nothing here; they get
  // the ghost-web overlay separately (Renderer.showMonumentGhostWeb).
  for (const t of grid.iter()) {
    if (!t.bigBuildBlockPaid) continue;
    const isReserved = t.mayorMansion || t.cityHall || t.provincialCapital || t.nationalCapital || t.cloverleaf;
    if (!isReserved) continue;
    // Is this footprint COMPLETE? We detect by finding the anchor (lex-
    // smallest of the kind-bit set) and checking its `building` value.
    // If the anchor is promoted, the merged finished geometry already
    // covered this tile — skip.
    const kind: 'mayor_mansion' | 'city_hall' | 'provincial_capital' | 'national_capital' | 'cloverleaf' =
      t.mayorMansion ? 'mayor_mansion' :
      t.cityHall ? 'city_hall' :
      t.provincialCapital ? 'provincial_capital' :
      t.nationalCapital ? 'national_capital' : 'cloverleaf';
    // Cheap "is the building complete" check: scan north + west from this
    // tile for the anchor; if anchor.building === kind we're complete.
    let ax = t.x, ay = t.y;
    while (ax > 0 && readKind(grid.get(ax - 1, ay)!, kind)) ax--;
    while (ay > 0 && readKind(grid.get(ax, ay - 1)!, kind)) ay--;
    const anchor = grid.get(ax, ay);
    if (anchor && anchor.building === kind) continue;   // complete; skip
    // Incomplete + paid → emit a construction-site visual on this tile.
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    const yLift = ROAD_LIFT * 0.5 + t.elevation;
    for (const p of constructionSiteParts()) {
      const g = p.makeGeom();
      g.translate(cx + p.dx, p.dy + yLift, cz + p.dz);
      geoms.push(g);
      colours.push(tint(p.color));
    }
  }

  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(merged, mat);
}

/**
 * 4-connected flood-fill of tiles whose `building === kind`, starting at
 * (sx,sy). Marks each visited tile in `visited` (packed y*w+x) so the
 * outer loop doesn't revisit the cluster.
 */
export function floodBuilding(
  grid: Grid, sx: number, sy: number, kind: string, visited: Set<number>
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const stack: Array<[number, number]> = [[sx, sy]];
  const w = grid.width;
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = y * w + x;
    if (visited.has(key)) continue;
    const t = grid.get(x, y);
    if (!t || t.building !== kind) continue;
    visited.add(key);
    out.push({ x, y });
    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }
  return out;
}

/**
 * Modular park renderer. Cluster size determines the size class:
 *   1 tile  → small park (2 layouts)
 *   2 tiles → community park (2 layouts)
 *   3 tiles → neighbourhood park (2 layouts)
 *   4+ tiles → grand park (2 layouts)
 *
 * Within each size class, a deterministic hash of the cluster's anchor
 * tile picks between two layouts (Alpha 3.1.9), giving 8 visually
 * distinct park designs total. The lex-smallest tile of the cluster
 * supplies the hash so the same physical park always picks the same
 * layout across renders / saves.
 *
 * The cluster's "centroid" anchors central features; lawns and trees
 * are emitted per-tile so the cluster shape stays organic.
 */
function parkClusterParts(cluster: Array<{ x: number; y: number }>): CityBuildingPart[] {
  if (cluster.length === 0) return [];
  const out: CityBuildingPart[] = [];
  // Centroid in world space.
  let sumX = 0, sumZ = 0;
  for (const c of cluster) {
    sumX += (c.x + 0.5) * TILE_SIZE;
    sumZ += (c.y + 0.5) * TILE_SIZE;
  }
  const centerX = sumX / cluster.length;
  const centerZ = sumZ / cluster.length;
  const size = cluster.length;
  // Alpha 4.4 — every park tree gets a slim dark-green shadow disc
  // under it, matching the Alpha 2.6 forest-tile polish. Trunks are
  // emitted across multiple cluster-size code paths; rather than
  // duplicate shadow emission at each, we run a single pass at every
  // return site that finds parts with the trunk colour (0x6b3f1f) and
  // pushes a sibling shadow part at the same (dx, dz).
  const finalize = (parts: CityBuildingPart[]): CityBuildingPart[] => {
    const shadows: CityBuildingPart[] = [];
    for (const p of parts) {
      if (p.color !== 0x6b3f1f) continue;
      shadows.push({
        makeGeom: () => cyl(0.20, 0.005, 8),
        color: 0x2a3a22,
        dx: p.dx,
        dy: 0.005,
        dz: p.dz
      });
    }
    // Push shadows first in the array so they render before the
    // trunks/leaves above them — visually correct, no z-fighting.
    return [...shadows, ...parts];
  };

  // Lawn pad on every tile — the green base regardless of cluster size.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => box(0.92, 0.04, 0.92), color: 0x4a8c3a, dx: cx, dy: 0.02, dz: cz });
  }

  // Pick a sub-variant within each size class from the lex-smallest tile.
  // Two layouts per class × four classes = 8 total designs.
  let anchor = cluster[0]!;
  for (const c of cluster) {
    if (c.x < anchor.x || (c.x === anchor.x && c.y < anchor.y)) anchor = c;
  }
  const subVariant = (Math.abs(anchor.x * 73856093) ^ Math.abs(anchor.y * 19349663)) & 1;

  if (size === 1) {
    if (subVariant === 1) {
      addSculpturePlaza(cluster[0]!, centerX, centerZ, out);
      return finalize(out);
    }
    // === 1-tile cottage park ===
    const c = cluster[0]!;
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    // Diagonal stone path strip.
    out.push({ makeGeom: () => box(0.18, 0.05, 0.85), color: 0xc7c2b3, dx: cx, dy: 0.025, dz: cz });
    // Round pond.
    out.push({ makeGeom: () => cyl(0.18, 0.06, 12), color: 0x4d8eb9, dx: cx - 0.20, dy: 0.025, dz: cz - 0.18 });
    // Two benches.
    out.push({ makeGeom: () => box(0.18, 0.025, 0.04), color: 0x6b4f3a, dx: cx + 0.22, dy: 0.07, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: cx + 0.30, dy: 0.045, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: cx + 0.14, dy: 0.045, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.18, 0.025, 0.04), color: 0x6b4f3a, dx: cx - 0.22, dy: 0.07, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: cx - 0.14, dy: 0.045, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: cx - 0.30, dy: 0.045, dz: cz + 0.18 });
    // Three trees.
    out.push({ makeGeom: () => cyl(0.04, 0.16, 6), color: 0x6b3f1f, dx: cx + 0.22, dy: 0.11, dz: cz - 0.22 });
    out.push({ makeGeom: () => cone(0.20, 0.34, 8), color: 0x2f6a2d, dx: cx + 0.22, dy: 0.36, dz: cz - 0.22 });
    out.push({ makeGeom: () => cyl(0.035, 0.13, 6), color: 0x6b3f1f, dx: cx - 0.32, dy: 0.095, dz: cz - 0.05 });
    out.push({ makeGeom: () => cone(0.16, 0.26, 8), color: 0x3a7a3a, dx: cx - 0.32, dy: 0.30, dz: cz - 0.05 });
    out.push({ makeGeom: () => cyl(0.028, 0.10, 6), color: 0x6b3f1f, dx: cx + 0.32, dy: 0.08, dz: cz + 0.05 });
    out.push({ makeGeom: () => cone(0.13, 0.20, 8), color: 0x4a8e44, dx: cx + 0.32, dy: 0.25, dz: cz + 0.05 });
    return finalize(out);
  }

  if (size === 2) {
    if (subVariant === 1) {
      addTennisCourt(cluster, centerX, centerZ, out);
      return finalize(out);
    }
    // === 2-tile community park: playground + pond + paths ===
    // Determine axis: tiles share an x or share a y.
    const a = cluster[0]!;
    const b = cluster[1]!;
    const horizontal = a.y === b.y;
    // Centre between the two tiles.
    const cx = centerX;
    const cz = centerZ;
    // Long paved path connecting both tile centers.
    if (horizontal) {
      out.push({ makeGeom: () => box(1.85, 0.05, 0.18), color: 0xc7c2b3, dx: cx, dy: 0.025, dz: cz });
    } else {
      out.push({ makeGeom: () => box(0.18, 0.05, 1.85), color: 0xc7c2b3, dx: cx, dy: 0.025, dz: cz });
    }
    // Playground: slide (angled box) + swing frame on the lex-smaller tile.
    const pgX = (a.x + 0.5) * TILE_SIZE + (horizontal ? -0.05 : 0);
    const pgZ = (a.y + 0.5) * TILE_SIZE + (horizontal ? 0 : -0.05);
    // Swing frame (A-shape).
    out.push({ makeGeom: () => box(0.30, 0.022, 0.022), color: 0xb14a4a, dx: pgX, dy: 0.22, dz: pgZ - 0.20 });
    out.push({ makeGeom: () => box(0.022, 0.22, 0.022), color: 0xb14a4a, dx: pgX - 0.13, dy: 0.11, dz: pgZ - 0.20 });
    out.push({ makeGeom: () => box(0.022, 0.22, 0.022), color: 0xb14a4a, dx: pgX + 0.13, dy: 0.11, dz: pgZ - 0.20 });
    // Two swing seats.
    out.push({ makeGeom: () => box(0.05, 0.018, 0.04), color: 0x3a2a20, dx: pgX - 0.05, dy: 0.10, dz: pgZ - 0.20 });
    out.push({ makeGeom: () => box(0.05, 0.018, 0.04), color: 0x3a2a20, dx: pgX + 0.05, dy: 0.10, dz: pgZ - 0.20 });
    // Slide — sloped box.
    out.push({ makeGeom: () => box(0.10, 0.18, 0.30), color: 0x4d8eb9, dx: pgX + 0.18, dy: 0.09, dz: pgZ + 0.05 });
    out.push({ makeGeom: () => box(0.06, 0.06, 0.06), color: 0xb14a4a, dx: pgX + 0.18, dy: 0.21, dz: pgZ - 0.05 });
    // Pond on the partner tile.
    const pondX = (b.x + 0.5) * TILE_SIZE;
    const pondZ = (b.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => cyl(0.22, 0.06, 12), color: 0x4d8eb9, dx: pondX, dy: 0.025, dz: pondZ + 0.10 });
    // Trees scattered.
    out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx + 0.30, dy: 0.10, dz: cz + 0.30 });
    out.push({ makeGeom: () => cone(0.18, 0.30, 8), color: 0x2f6a2d, dx: cx + 0.30, dy: 0.32, dz: cz + 0.30 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx - 0.35, dy: 0.09, dz: cz + 0.30 });
    out.push({ makeGeom: () => cone(0.15, 0.24, 8), color: 0x3a7a3a, dx: cx - 0.35, dy: 0.28, dz: cz + 0.30 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: pondX - 0.30, dy: 0.09, dz: pondZ - 0.30 });
    out.push({ makeGeom: () => cone(0.15, 0.24, 8), color: 0x4a8e44, dx: pondX - 0.30, dy: 0.28, dz: pondZ - 0.30 });
    return finalize(out);
  }

  if (size === 3) {
    if (subVariant === 1) {
      addRoseGarden(cluster, centerX, centerZ, out);
      return finalize(out);
    }
    // === 3-tile neighbourhood park: pavilion + central pond + path ===
    // Pavilion (open-air shelter) at centroid.
    out.push({ makeGeom: () => box(0.50, 0.025, 0.40), color: 0x6f4a2c, dx: centerX, dy: 0.32, dz: centerZ });
    // Roof (pyramid).
    out.push({ makeGeom: () => cone(0.34, 0.18, 4), color: 0x4a3020, dx: centerX, dy: 0.40, dz: centerZ });
    // Four pavilion posts.
    out.push({ makeGeom: () => box(0.025, 0.30, 0.025), color: 0x4a3a2a, dx: centerX - 0.22, dy: 0.15, dz: centerZ - 0.18 });
    out.push({ makeGeom: () => box(0.025, 0.30, 0.025), color: 0x4a3a2a, dx: centerX + 0.22, dy: 0.15, dz: centerZ - 0.18 });
    out.push({ makeGeom: () => box(0.025, 0.30, 0.025), color: 0x4a3a2a, dx: centerX - 0.22, dy: 0.15, dz: centerZ + 0.18 });
    out.push({ makeGeom: () => box(0.025, 0.30, 0.025), color: 0x4a3a2a, dx: centerX + 0.22, dy: 0.15, dz: centerZ + 0.18 });
    // Central round pond near the pavilion.
    out.push({ makeGeom: () => cyl(0.30, 0.06, 16), color: 0x4d8eb9, dx: centerX + 0.5, dy: 0.025, dz: centerZ });
    // Small fountain post in the middle of the pond.
    out.push({ makeGeom: () => cyl(0.05, 0.18, 8), color: 0x9a9a9a, dx: centerX + 0.5, dy: 0.09, dz: centerZ });
    out.push({ makeGeom: () => sphereLite(0.08), color: 0xe0e6ec, dx: centerX + 0.5, dy: 0.22, dz: centerZ });
    // Connecting paths from each tile center to centroid.
    for (const c of cluster) {
      const cx = (c.x + 0.5) * TILE_SIZE;
      const cz = (c.y + 0.5) * TILE_SIZE;
      const dx = centerX - cx;
      const dz = centerZ - cz;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      // Approximate a path quad oriented along the (cx,cz)→centroid axis.
      // Just lay short axis-aligned pads — the cluster is rectilinear so
      // this looks fine without rotation math.
      const horiz = Math.abs(dx) > Math.abs(dz);
      if (horiz) {
        out.push({ makeGeom: () => box(len, 0.05, 0.16), color: 0xc7c2b3, dx: (cx + centerX) / 2, dy: 0.026, dz: cz });
      } else {
        out.push({ makeGeom: () => box(0.16, 0.05, len), color: 0xc7c2b3, dx: cx, dy: 0.026, dz: (cz + centerZ) / 2 });
      }
    }
    // Trees scattered around.
    for (let i = 0; i < cluster.length; i++) {
      const c = cluster[i]!;
      const cx = (c.x + 0.5) * TILE_SIZE;
      const cz = (c.y + 0.5) * TILE_SIZE;
      out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx - 0.32, dy: 0.10, dz: cz + 0.32 });
      out.push({ makeGeom: () => cone(0.18, 0.30, 8), color: i === 0 ? 0x2f6a2d : 0x3a7a3a, dx: cx - 0.32, dy: 0.32, dz: cz + 0.32 });
      out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx + 0.32, dy: 0.09, dz: cz - 0.32 });
      out.push({ makeGeom: () => cone(0.15, 0.24, 8), color: 0x4a8e44, dx: cx + 0.32, dy: 0.28, dz: cz - 0.32 });
    }
    return finalize(out);
  }

  if (subVariant === 1) {
    addBotanicalGarden(cluster, centerX, centerZ, out);
    return finalize(out);
  }

  // === 4+ tile grand park: bandstand centerpiece + ring + dense trees ===
  // Bandstand: octagonal raised platform with a tiered roof.
  out.push({ makeGeom: () => cyl(0.42, 0.06, 8), color: 0xc4a684, dx: centerX, dy: 0.05, dz: centerZ });
  out.push({ makeGeom: () => cyl(0.34, 0.15, 8), color: 0xd9c08a, dx: centerX, dy: 0.13, dz: centerZ });
  // Bandstand posts.
  for (let p = 0; p < 8; p++) {
    const ang = (p / 8) * Math.PI * 2;
    const px = centerX + Math.cos(ang) * 0.30;
    const pz = centerZ + Math.sin(ang) * 0.30;
    out.push({ makeGeom: () => box(0.025, 0.28, 0.025), color: 0x4a3020, dx: px, dy: 0.20 + 0.14, dz: pz });
  }
  // Bandstand roof — wide cone.
  out.push({ makeGeom: () => cone(0.45, 0.18, 8), color: 0xb14a4a, dx: centerX, dy: 0.20 + 0.30, dz: centerZ });
  // Roof finial.
  out.push({ makeGeom: () => cone(0.06, 0.10, 6), color: 0xe5c25a, dx: centerX, dy: 0.20 + 0.45, dz: centerZ });
  // Per-tile decoration: bench on each tile facing the bandstand.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    // Skip the centroid tile (covered by bandstand).
    if (Math.hypot(cx - centerX, cz - centerZ) < 0.5) continue;
    // Bench facing centroid.
    const dx = centerX - cx;
    const dz = centerZ - cz;
    const len = Math.hypot(dx, dz) || 1;
    const off = 0.30;
    const bx = cx + (dx / len) * off;
    const bz = cz + (dz / len) * off;
    out.push({ makeGeom: () => box(0.20, 0.025, 0.05), color: 0x6b4f3a, dx: bx, dy: 0.07, dz: bz });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.05), color: 0x3a2a20, dx: bx - 0.08, dy: 0.045, dz: bz });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.05), color: 0x3a2a20, dx: bx + 0.08, dy: 0.045, dz: bz });
    // Two trees per tile in opposite corners.
    out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx - 0.36, dy: 0.10, dz: cz - 0.36 });
    out.push({ makeGeom: () => cone(0.18, 0.32, 8), color: 0x2f6a2d, dx: cx - 0.36, dy: 0.34, dz: cz - 0.36 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx + 0.36, dy: 0.09, dz: cz + 0.36 });
    out.push({ makeGeom: () => cone(0.15, 0.26, 8), color: 0x4a8e44, dx: cx + 0.36, dy: 0.30, dz: cz + 0.36 });
  }
  // Connecting paved paths from each non-centroid tile to centroid.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const dx = centerX - cx;
    const dz = centerZ - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const horiz = Math.abs(dx) > Math.abs(dz);
    if (horiz) {
      out.push({ makeGeom: () => box(len, 0.05, 0.16), color: 0xc7c2b3, dx: (cx + centerX) / 2, dy: 0.026, dz: cz });
    } else {
      out.push({ makeGeom: () => box(0.16, 0.05, len), color: 0xc7c2b3, dx: cx, dy: 0.026, dz: (cz + centerZ) / 2 });
    }
  }
  return finalize(out);
}

// --- Park sub-variant layouts (Alpha 3.1.9) ---------------------------

/** 1-tile sculpture plaza: paved circle + central abstract sculpture +
 *  4 perimeter benches facing inward. No pond, no trees on the tile —
 *  contrast to the cottage garden's organic look. */
function addSculpturePlaza(
  c: { x: number; y: number }, _centerX: number, _centerZ: number, out: CityBuildingPart[]
): void {
  const cx = (c.x + 0.5) * TILE_SIZE;
  const cz = (c.y + 0.5) * TILE_SIZE;
  // Paved circular plaza.
  out.push({ makeGeom: () => cyl(0.42, 0.04, 24), color: 0xb8b3a4, dx: cx, dy: 0.026, dz: cz });
  // Inner accent ring.
  out.push({ makeGeom: () => cyl(0.28, 0.045, 24), color: 0x9a948a, dx: cx, dy: 0.030, dz: cz });
  // Sculpture base.
  out.push({ makeGeom: () => cyl(0.12, 0.10, 16), color: 0x4a4f56, dx: cx, dy: 0.075, dz: cz });
  // Sculpture itself — three stacked rotated boxes for an abstract feel.
  out.push({ makeGeom: () => box(0.18, 0.16, 0.12), color: 0xc83838, dx: cx, dy: 0.20, dz: cz });
  out.push({ makeGeom: () => box(0.12, 0.18, 0.16), color: 0xeec453, dx: cx, dy: 0.36, dz: cz });
  out.push({ makeGeom: () => box(0.10, 0.12, 0.10), color: 0x4d8eb9, dx: cx, dy: 0.50, dz: cz });
  // Four perimeter benches facing the plaza.
  const benchOffsets: Array<[number, number, number, number]> = [
    [0.34, 0, 1, 0], [-0.34, 0, 1, 0], [0, 0.34, 0, 1], [0, -0.34, 0, 1]
  ];
  for (const [bx, bz, ax, az] of benchOffsets) {
    const w = ax === 1 ? 0.04 : 0.20;
    const d = az === 1 ? 0.04 : 0.20;
    out.push({ makeGeom: () => box(w, 0.025, d), color: 0x6b4f3a, dx: cx + bx, dy: 0.07, dz: cz + bz });
  }
  // Four corner shrubs to soften the paved look.
  for (const [bx, bz] of [[0.36, 0.36], [-0.36, 0.36], [0.36, -0.36], [-0.36, -0.36]] as Array<[number, number]>) {
    out.push({ makeGeom: () => sphereLite(0.10), color: 0x4a8e44, dx: cx + bx, dy: 0.10, dz: cz + bz });
  }
}

/** 2-tile tennis court: paved court + net + line markings + 2 perimeter
 *  benches + corner trees. */
function addTennisCourt(
  cluster: Array<{ x: number; y: number }>, centerX: number, centerZ: number, out: CityBuildingPart[]
): void {
  const a = cluster[0]!;
  const b = cluster[1]!;
  const horizontal = a.y === b.y;
  // Court — clay-orange surface spans both tiles.
  if (horizontal) {
    out.push({ makeGeom: () => box(1.65, 0.03, 0.65), color: 0xc46c34, dx: centerX, dy: 0.030, dz: centerZ });
    // Centre net (low slim box).
    out.push({ makeGeom: () => box(0.025, 0.10, 0.65), color: 0xeae0c4, dx: centerX, dy: 0.080, dz: centerZ });
    // Court lines — white edge stripes.
    out.push({ makeGeom: () => box(1.65, 0.035, 0.025), color: 0xece4cf, dx: centerX, dy: 0.035, dz: centerZ - 0.30 });
    out.push({ makeGeom: () => box(1.65, 0.035, 0.025), color: 0xece4cf, dx: centerX, dy: 0.035, dz: centerZ + 0.30 });
  } else {
    out.push({ makeGeom: () => box(0.65, 0.03, 1.65), color: 0xc46c34, dx: centerX, dy: 0.030, dz: centerZ });
    out.push({ makeGeom: () => box(0.65, 0.10, 0.025), color: 0xeae0c4, dx: centerX, dy: 0.080, dz: centerZ });
    out.push({ makeGeom: () => box(0.025, 0.035, 1.65), color: 0xece4cf, dx: centerX - 0.30, dy: 0.035, dz: centerZ });
    out.push({ makeGeom: () => box(0.025, 0.035, 1.65), color: 0xece4cf, dx: centerX + 0.30, dy: 0.035, dz: centerZ });
  }
  // Perimeter benches off the court endlines.
  if (horizontal) {
    out.push({ makeGeom: () => box(0.20, 0.025, 0.04), color: 0x6b4f3a, dx: centerX - 0.92, dy: 0.07, dz: centerZ });
    out.push({ makeGeom: () => box(0.20, 0.025, 0.04), color: 0x6b4f3a, dx: centerX + 0.92, dy: 0.07, dz: centerZ });
  } else {
    out.push({ makeGeom: () => box(0.04, 0.025, 0.20), color: 0x6b4f3a, dx: centerX, dy: 0.07, dz: centerZ - 0.92 });
    out.push({ makeGeom: () => box(0.04, 0.025, 0.20), color: 0x6b4f3a, dx: centerX, dy: 0.07, dz: centerZ + 0.92 });
  }
  // 4 corner trees.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx + 0.36, dy: 0.10, dz: cz + 0.36 });
    out.push({ makeGeom: () => cone(0.18, 0.30, 8), color: 0x2f6a2d, dx: cx + 0.36, dy: 0.32, dz: cz + 0.36 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx - 0.36, dy: 0.09, dz: cz - 0.36 });
    out.push({ makeGeom: () => cone(0.15, 0.24, 8), color: 0x4a8e44, dx: cx - 0.36, dy: 0.28, dz: cz - 0.36 });
  }
}

/** 3-tile rose garden: geometric flower beds + central fountain +
 *  perimeter hedges + perimeter benches. Formal layout. */
function addRoseGarden(
  cluster: Array<{ x: number; y: number }>, centerX: number, centerZ: number, out: CityBuildingPart[]
): void {
  // Central round fountain.
  out.push({ makeGeom: () => cyl(0.30, 0.06, 16), color: 0xc8c4be, dx: centerX, dy: 0.05, dz: centerZ });
  out.push({ makeGeom: () => cyl(0.22, 0.08, 16), color: 0x4d8eb9, dx: centerX, dy: 0.07, dz: centerZ });
  out.push({ makeGeom: () => cyl(0.06, 0.20, 8), color: 0x9a9a9a, dx: centerX, dy: 0.10, dz: centerZ });
  out.push({ makeGeom: () => sphereLite(0.10), color: 0xe0e6ec, dx: centerX, dy: 0.24, dz: centerZ });
  // Geometric flower beds — 4 small rectangles + 4 round patches around centre.
  // Outer red roses.
  const beds: Array<[number, number, number]> = [
    [0.45, 0.0, 0xc83838],   // east
    [-0.45, 0.0, 0xc83838],  // west
    [0.0, 0.45, 0xeec453],   // north - yellow
    [0.0, -0.45, 0xeec453],  // south - yellow
    [0.32, 0.32, 0xd06ab8],  // pink corner
    [-0.32, 0.32, 0xd06ab8],
    [0.32, -0.32, 0xd06ab8],
    [-0.32, -0.32, 0xd06ab8]
  ];
  for (const [bx, bz, color] of beds) {
    out.push({ makeGeom: () => box(0.18, 0.04, 0.18), color: 0x5c3e2a, dx: centerX + bx, dy: 0.030, dz: centerZ + bz });
    out.push({ makeGeom: () => box(0.14, 0.05, 0.14), color, dx: centerX + bx, dy: 0.045, dz: centerZ + bz });
  }
  // Hedge perimeter on each tile (low green strip on the outward side).
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    // Skip if this tile contains the fountain (centroid).
    if (Math.hypot(cx - centerX, cz - centerZ) < 0.5) continue;
    // Hedge facing away from centroid.
    const dx = cx - centerX;
    const dz = cz - centerZ;
    const len = Math.hypot(dx, dz) || 1;
    const hx = cx + (dx / len) * 0.32;
    const hz = cz + (dz / len) * 0.32;
    out.push({ makeGeom: () => box(0.45, 0.10, 0.10), color: 0x4a8e44, dx: hx, dy: 0.08, dz: hz });
    // Bench in front of the hedge facing the fountain.
    const bx = cx + (dx / len) * 0.18;
    const bz = cz + (dz / len) * 0.18;
    out.push({ makeGeom: () => box(0.20, 0.025, 0.05), color: 0x6b4f3a, dx: bx, dy: 0.07, dz: bz });
  }
  // Connecting paved paths from each tile to centroid.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const dx = centerX - cx;
    const dz = centerZ - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const horiz = Math.abs(dx) > Math.abs(dz);
    if (horiz) {
      out.push({ makeGeom: () => box(len, 0.04, 0.14), color: 0xc7c2b3, dx: (cx + centerX) / 2, dy: 0.028, dz: cz });
    } else {
      out.push({ makeGeom: () => box(0.14, 0.04, len), color: 0xc7c2b3, dx: cx, dy: 0.028, dz: (cz + centerZ) / 2 });
    }
  }
}

/** 4+ tile botanical garden: greenhouse pavilion + winding pond chain
 *  + dense exotic-tree mix + perimeter hedge maze segments. */
function addBotanicalGarden(
  cluster: Array<{ x: number; y: number }>, centerX: number, centerZ: number, out: CityBuildingPart[]
): void {
  // Central greenhouse — long glass-walled pavilion with a peaked roof.
  out.push({ makeGeom: () => box(0.85, 0.05, 0.55), color: 0xc8c4be, dx: centerX, dy: 0.025, dz: centerZ });
  // Glass walls (pale teal).
  out.push({ makeGeom: () => box(0.82, 0.32, 0.52), color: 0xa8d4cc, dx: centerX, dy: 0.21, dz: centerZ });
  // Slightly darker glass band at the top.
  out.push({ makeGeom: () => box(0.85, 0.04, 0.55), color: 0x6c9a90, dx: centerX, dy: 0.39, dz: centerZ });
  // Pitched roof.
  out.push({ makeGeom: () => cone(0.45, 0.20, 4), color: 0x4a3020, dx: centerX, dy: 0.50, dz: centerZ });
  // Roof finial.
  out.push({ makeGeom: () => cone(0.04, 0.08, 6), color: 0xe5c25a, dx: centerX, dy: 0.60, dz: centerZ });
  // Pond chain — three small connected ponds curving around the greenhouse.
  out.push({ makeGeom: () => cyl(0.20, 0.06, 12), color: 0x4d8eb9, dx: centerX + 0.85, dy: 0.030, dz: centerZ - 0.30 });
  out.push({ makeGeom: () => cyl(0.16, 0.06, 12), color: 0x4d8eb9, dx: centerX + 0.62, dy: 0.030, dz: centerZ + 0.40 });
  out.push({ makeGeom: () => cyl(0.18, 0.06, 12), color: 0x4d8eb9, dx: centerX - 0.78, dy: 0.030, dz: centerZ + 0.20 });
  // Hedge maze segments — a few short hedges per tile (skip the greenhouse tile).
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    if (Math.hypot(cx - centerX, cz - centerZ) < 0.5) continue;
    // Two perpendicular short hedges.
    out.push({ makeGeom: () => box(0.30, 0.10, 0.06), color: 0x3a6a3a, dx: cx + 0.10, dy: 0.07, dz: cz - 0.20 });
    out.push({ makeGeom: () => box(0.06, 0.10, 0.30), color: 0x3a6a3a, dx: cx - 0.20, dy: 0.07, dz: cz + 0.10 });
  }
  // Dense exotic tree mix — each non-centroid tile gets 3 trees of
  // varied colours (palm-green, deep teal-green, autumn red-orange).
  const palette = [0x2f6a2d, 0x4a8e44, 0x3a7a3a, 0xc46c34, 0x6a9a4a];
  for (let i = 0; i < cluster.length; i++) {
    const c = cluster[i]!;
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    if (Math.hypot(cx - centerX, cz - centerZ) < 0.5) continue;
    out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx - 0.36, dy: 0.10, dz: cz - 0.36 });
    out.push({ makeGeom: () => cone(0.18, 0.32, 8), color: palette[i % palette.length]!, dx: cx - 0.36, dy: 0.34, dz: cz - 0.36 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx + 0.36, dy: 0.09, dz: cz + 0.36 });
    out.push({ makeGeom: () => sphereLite(0.16), color: palette[(i + 2) % palette.length]!, dx: cx + 0.36, dy: 0.30, dz: cz + 0.36 });
    out.push({ makeGeom: () => cyl(0.035, 0.10, 6), color: 0x6b3f1f, dx: cx - 0.30, dy: 0.08, dz: cz + 0.30 });
    out.push({ makeGeom: () => cone(0.13, 0.20, 8), color: palette[(i + 1) % palette.length]!, dx: cx - 0.30, dy: 0.25, dz: cz + 0.30 });
  }
  // Connecting paths (gravel) — same as bandstand layout for navigability.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const dx = centerX - cx;
    const dz = centerZ - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const horiz = Math.abs(dx) > Math.abs(dz);
    if (horiz) {
      out.push({ makeGeom: () => box(len, 0.04, 0.14), color: 0xc4b894, dx: (cx + centerX) / 2, dy: 0.028, dz: cz });
    } else {
      out.push({ makeGeom: () => box(0.14, 0.04, len), color: 0xc4b894, dx: cx, dy: 0.028, dz: (cz + centerZ) / 2 });
    }
  }
}

/**
 * Modular forestry renderer (Alpha 2.7.1). A cluster of forestry tiles
 * renders as ONE cohesive timber operation rather than N independent
 * sheds. The cluster gets:
 *
 *  1. A continuous gravel yard pad spanning every tile (overlapping at
 *     edges so adjacent tile pads visibly merge).
 *  2. A perimeter rail fence — sweeps each tile's 4-edges and emits a
 *     fence segment only on edges that face out (no forestry neighbour).
 *  3. Internal connector paths between every pair of 4-adjacent tiles —
 *     paved beige strips so the operation reads as linked.
 *  4. Per-tile roles assigned from a fixed sequence (hut → sawmill →
 *     orchard → log_pile → drying_yard → orchard → log_truck → crane →
 *     orchard → kiln → fuel_tank → office → orchard → conveyor →
 *     rail). Orchard tiles render rows of small spruce saplings —
 *     a sustainable tree farm to make the cluster read as renewable.
 *
 * `health` ∈ [0, 1] modulates colour saturation, paint vibrancy, weed
 * tufts when struggling, and steam puffs when thriving.
 */
function forestryClusterParts(
  cluster: Array<{ x: number; y: number }>,
  health: number
): CityBuildingPart[] {
  if (cluster.length === 0) return [];
  const out: CityBuildingPart[] = [];
  // Sort cluster deterministically (lex by x, then y) so role assignment
  // is stable across renders.
  const sorted = cluster.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  // O(1) lookup whether a tile is part of the cluster.
  const member = new Set<string>();
  for (const c of sorted) member.add(c.x + ',' + c.y);
  const isMember = (x: number, y: number) => member.has(x + ',' + y);

  // Health-tinted colours.
  const dirt = lerpColor(0x4a3a26, 0x6a5a40, health);
  const woodMain = lerpColor(0x6e4d2c, 0x8a5e34, health);
  const woodPale = lerpColor(0xb18a5a, 0xd6a868, health);
  const tinRoof = lerpColor(0x4a4a44, 0x707064, health);
  const log = lerpColor(0x6a4830, 0x8a5d3c, health);
  const path = lerpColor(0x9c9080, 0xc7baa8, health);
  const struggling = health < 0.45;
  const thriving = health > 0.85;

  // 1. Continuous yard pad. Slightly wider than 1.0 so adjacent pads
  // overlap by a sliver — the cluster reads as one big gravel yard
  // rather than 9 squares with seams.
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => box(1.04, 0.025, 1.04), color: dirt, dx: cx, dy: 0.013, dz: cz });
    if (struggling) {
      const h = (Math.abs(c.x * 374761393) ^ Math.abs(c.y * 668265263)) | 0;
      const tx = ((h % 100) / 100 - 0.5) * 0.7;
      const tz = (((h >> 7) % 100) / 100 - 0.5) * 0.7;
      out.push({ makeGeom: () => cone(0.04, 0.08, 5), color: 0xc8b04a, dx: cx + tx, dy: 0.04, dz: cz + tz });
    }
  }

  // 2. Internal connector paths. For each pair of 4-adjacent forestry
  // tiles, lay a long paved strip from the lower tile center to the
  // higher one. We only emit one strip per pair (lex-smaller→larger).
  const dirs: Array<[number, number]> = [[1, 0], [0, 1]];
  for (const c of sorted) {
    for (const [dx, dy] of dirs) {
      if (!isMember(c.x + dx, c.y + dy)) continue;
      const cx0 = (c.x + 0.5) * TILE_SIZE;
      const cz0 = (c.y + 0.5) * TILE_SIZE;
      const cx1 = (c.x + dx + 0.5) * TILE_SIZE;
      const cz1 = (c.y + dy + 0.5) * TILE_SIZE;
      const midX = (cx0 + cx1) / 2;
      const midZ = (cz0 + cz1) / 2;
      // Strip dimension: thin perpendicular, wide along the connection axis.
      const w = dx !== 0 ? 1.10 : 0.18;
      const d = dy !== 0 ? 1.10 : 0.18;
      out.push({ makeGeom: () => box(w, 0.012, d), color: path, dx: midX, dy: 0.027, dz: midZ });
    }
  }

  // 3. Perimeter rail fence. For each tile, look at the 4 cardinal
  // edges; if the neighbour isn't a forestry tile, emit a fence
  // segment running along that edge. Two posts + a top rail.
  const fenceColor = lerpColor(0x4a3a28, 0x6e5a3a, health);
  const fenceLen = 0.85;
  const fencePostH = 0.10;
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const sides: Array<[number, number, [number, number]]> = [
      [0, -1, [0, -0.50]],   // N edge
      [1, 0, [0.50, 0]],     // E edge
      [0, 1, [0, 0.50]],     // S edge
      [-1, 0, [-0.50, 0]]    // W edge
    ];
    for (const [ndx, ndy, [ex, ez]] of sides) {
      if (isMember(c.x + ndx, c.y + ndy)) continue;
      const horizontal = ndy !== 0;
      const railW = horizontal ? fenceLen : 0.018;
      const railD = horizontal ? 0.018 : fenceLen;
      // Top rail.
      out.push({ makeGeom: () => box(railW, 0.018, railD), color: fenceColor, dx: cx + ex, dy: 0.085, dz: cz + ez });
      // Two posts.
      const postOff = horizontal ? [(-fenceLen / 2 + 0.04), (fenceLen / 2 - 0.04)] : [];
      const postOffZ = !horizontal ? [(-fenceLen / 2 + 0.04), (fenceLen / 2 - 0.04)] : [];
      if (horizontal) {
        for (const po of postOff) {
          out.push({ makeGeom: () => box(0.022, fencePostH, 0.022), color: fenceColor, dx: cx + ex + po, dy: 0.05, dz: cz + ez });
        }
      } else {
        for (const po of postOffZ) {
          out.push({ makeGeom: () => box(0.022, fencePostH, 0.022), color: fenceColor, dx: cx + ex, dy: 0.05, dz: cz + ez + po });
        }
      }
    }
  }

  // 4. Per-tile roles. Sequence weaves orchards in between primary
  // features so even a small cluster shows the tree-farm side, and a
  // big cluster reads as a real industrial complex.
  const ROLES: ForestryRole[] = [
    'hut', 'sawmill', 'orchard', 'log_pile', 'drying_yard',
    'orchard', 'log_truck', 'crane', 'orchard', 'kiln',
    'fuel_tank', 'office', 'orchard', 'conveyor', 'rail'
  ];
  // For clusters bigger than ROLES.length, repeat orchards at the end.
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const role: ForestryRole = i < ROLES.length ? ROLES[i]! : 'orchard';
    emitForestryFeature(out, role, cx, cz, woodMain, woodPale, tinRoof, log, thriving);
  }

  return out;
}

type ForestryRole =
  | 'hut' | 'sawmill' | 'orchard' | 'log_pile' | 'drying_yard'
  | 'log_truck' | 'crane' | 'kiln' | 'fuel_tank' | 'office'
  | 'conveyor' | 'rail';

function emitForestryFeature(
  out: CityBuildingPart[], role: ForestryRole,
  cx: number, cz: number,
  woodMain: number, woodPale: number, tinRoof: number, log: number,
  thriving: boolean
): void {
  switch (role) {
    case 'hut': {
      // Logger's hut: small wood box + gabled tin roof + door.
      out.push({ makeGeom: () => box(0.42, 0.30, 0.42), color: woodMain, dx: cx, dy: 0.165, dz: cz });
      out.push({ makeGeom: () => cone(0.32, 0.18, 4), color: tinRoof, dx: cx, dy: 0.30 + 0.09, dz: cz });
      out.push({ makeGeom: () => box(0.10, 0.18, 0.018), color: 0x3a2a18, dx: cx, dy: 0.09, dz: cz + 0.21 + 0.009 });
      // Smokestack on the hut when thriving.
      if (thriving) {
        out.push({ makeGeom: () => cyl(0.04, 0.16, 6), color: 0x2a2a2a, dx: cx + 0.16, dy: 0.30 + 0.08, dz: cz - 0.10 });
        out.push({ makeGeom: () => sphereLite(0.07), color: 0xe0e6ec, dx: cx + 0.16, dy: 0.30 + 0.20, dz: cz - 0.10 });
      }
      break;
    }
    case 'sawmill': {
      // Sawmill — bigger gabled barn with a tin roof + tall chimney.
      out.push({ makeGeom: () => box(0.62, 0.42, 0.50), color: woodMain, dx: cx, dy: 0.21, dz: cz });
      out.push({ makeGeom: () => cone(0.42, 0.22, 4), color: tinRoof, dx: cx, dy: 0.42 + 0.11, dz: cz });
      // Chimney + smoke when thriving.
      out.push({ makeGeom: () => cyl(0.05, 0.32, 6), color: 0x3a3a3a, dx: cx + 0.18, dy: 0.42 + 0.16, dz: cz });
      if (thriving) {
        out.push({ makeGeom: () => sphereLite(0.10), color: 0xe0e6ec, dx: cx + 0.18, dy: 0.42 + 0.36, dz: cz });
      }
      break;
    }
    case 'orchard': {
      // Tree farm — 3 rows × 4 small spruce saplings on the dirt pad.
      // The orchard is what makes the operation feel sustainable / real.
      const greens = [0x2f6a2d, 0x3a7a3a, 0x4a8e3a];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          const ox = -0.30 + col * 0.20;
          const oz = -0.30 + row * 0.30;
          // Small trunk + cone foliage. Skip the trunk for distance —
          // at this size it's barely visible anyway.
          out.push({ makeGeom: () => cone(0.06, 0.20, 5), color: greens[(row + col) % 3]!, dx: cx + ox, dy: 0.13, dz: cz + oz });
        }
      }
      break;
    }
    case 'log_pile': {
      // Log pile — three logs stacked + cross-row.
      for (let k = 0; k < 3; k++) {
        const g = new CylinderGeometry(0.06, 0.06, 0.55, 7);
        g.rotateZ(Math.PI / 2);
        out.push({ makeGeom: () => g, color: log, dx: cx, dy: 0.06 + k * 0.10, dz: cz - 0.18 });
      }
      for (let k = 0; k < 2; k++) {
        const g = new CylinderGeometry(0.06, 0.06, 0.55, 7);
        g.rotateZ(Math.PI / 2);
        out.push({ makeGeom: () => g, color: log, dx: cx, dy: 0.16 + k * 0.10, dz: cz + 0.05 });
      }
      break;
    }
    case 'drying_yard': {
      // Three log racks: parallel rails carrying logs.
      for (let r = 0; r < 3; r++) {
        const off = (r - 1) * 0.18;
        out.push({ makeGeom: () => box(0.50, 0.04, 0.04), color: 0x4a3020, dx: cx, dy: 0.05, dz: cz + off });
        const g = new CylinderGeometry(0.045, 0.045, 0.50, 7);
        g.rotateZ(Math.PI / 2);
        out.push({ makeGeom: () => g, color: log, dx: cx, dy: 0.115, dz: cz + off });
      }
      break;
    }
    case 'log_truck': {
      // Chassis box + cab + log payload.
      out.push({ makeGeom: () => box(0.60, 0.06, 0.20), color: 0x4a4a4a, dx: cx, dy: 0.04, dz: cz });
      out.push({ makeGeom: () => box(0.18, 0.16, 0.20), color: 0xb14a4a, dx: cx - 0.20, dy: 0.14, dz: cz });
      for (let k = 0; k < 3; k++) {
        const g = new CylinderGeometry(0.05, 0.05, 0.32, 7);
        g.rotateZ(Math.PI / 2);
        out.push({ makeGeom: () => g, color: log, dx: cx + 0.10, dy: 0.13 + k * 0.06, dz: cz });
      }
      break;
    }
    case 'crane': {
      out.push({ makeGeom: () => box(0.06, 0.55, 0.06), color: 0xc9a437, dx: cx, dy: 0.275, dz: cz });
      out.push({ makeGeom: () => box(0.42, 0.04, 0.04), color: 0xc9a437, dx: cx + 0.18, dy: 0.55, dz: cz });
      out.push({ makeGeom: () => box(0.012, 0.20, 0.012), color: 0x222222, dx: cx + 0.34, dy: 0.45, dz: cz });
      out.push({ makeGeom: () => box(0.05, 0.05, 0.05), color: 0x4a4a4a, dx: cx + 0.34, dy: 0.32, dz: cz });
      break;
    }
    case 'kiln': {
      out.push({ makeGeom: () => cyl(0.18, 0.40, 10), color: 0xa68260, dx: cx, dy: 0.20, dz: cz });
      out.push({ makeGeom: () => cone(0.18, 0.10, 10), color: 0x6e4a30, dx: cx, dy: 0.40 + 0.05, dz: cz });
      if (thriving) {
        out.push({ makeGeom: () => sphereLite(0.13), color: 0xe0e6ec, dx: cx, dy: 0.40 + 0.18, dz: cz });
      }
      break;
    }
    case 'fuel_tank': {
      const g = new CylinderGeometry(0.16, 0.16, 0.52, 10);
      g.rotateZ(Math.PI / 2);
      out.push({ makeGeom: () => g, color: 0xb14a3a, dx: cx, dy: 0.20, dz: cz });
      out.push({ makeGeom: () => box(0.06, 0.06, 0.10), color: 0x222222, dx: cx - 0.20, dy: 0.06, dz: cz });
      out.push({ makeGeom: () => box(0.06, 0.06, 0.10), color: 0x222222, dx: cx + 0.20, dy: 0.06, dz: cz });
      break;
    }
    case 'office': {
      out.push({ makeGeom: () => box(0.65, 0.22, 0.35), color: woodPale, dx: cx, dy: 0.16, dz: cz });
      out.push({ makeGeom: () => box(0.66, 0.02, 0.36), color: 0x4a4a44, dx: cx, dy: 0.28, dz: cz });
      out.push({ makeGeom: () => box(0.50, 0.06, 0.018), color: 0x2a3a4a, dx: cx, dy: 0.20, dz: cz - 0.18 });
      out.push({ makeGeom: () => box(0.10, 0.14, 0.018), color: 0x3a2a18, dx: cx + 0.18, dy: 0.13, dz: cz + 0.18 });
      break;
    }
    case 'conveyor': {
      const belt = new BoxGeometry(0.55, 0.04, 0.16);
      belt.rotateZ(-Math.PI / 8);
      out.push({ makeGeom: () => belt, color: 0x222222, dx: cx, dy: 0.18, dz: cz });
      out.push({ makeGeom: () => box(0.06, 0.04, 0.18), color: 0x4a4a4a, dx: cx - 0.24, dy: 0.10, dz: cz });
      out.push({ makeGeom: () => box(0.06, 0.04, 0.18), color: 0x4a4a4a, dx: cx + 0.24, dy: 0.26, dz: cz });
      break;
    }
    case 'rail': {
      out.push({ makeGeom: () => box(0.85, 0.018, 0.04), color: 0x6a6a6a, dx: cx, dy: 0.012, dz: cz - 0.10 });
      out.push({ makeGeom: () => box(0.85, 0.018, 0.04), color: 0x6a6a6a, dx: cx, dy: 0.012, dz: cz + 0.10 });
      for (let k = 0; k < 5; k++) {
        const off = -0.30 + k * 0.16;
        out.push({ makeGeom: () => box(0.10, 0.014, 0.30), color: 0x4a3020, dx: cx + off, dy: 0.008, dz: cz });
      }
      break;
    }
  }
}

/**
 * Linearly interpolate between two hex RGB colours by t ∈ [0,1].
 * Used by both the forestry health palette and (Alpha 2.7) the
 * happiness-based building tinting.
 */
/**
 * Modular farm renderer (Alpha 2.7.1). Same cohesive-cluster approach as
 * forestry: continuous green pad, perimeter rail fence, paved connector
 * paths between adjacent tiles, and per-tile roles drawn from a sequence
 * that weaves crop fields between primary structures so even a small
 * farm reads as fields-plus-buildings.
 *
 * Roles (tile order in lex-sorted cluster):
 *  hut (farmhouse) → barn → crops → silo → crops → animal_pen → tractor
 *  → crops → greenhouse → water_tank → crops → orchard → windmill →
 *  compost
 *
 * `health` ∈ [0, 1] modulates colour saturation, crop fullness, paint
 * vibrancy, and whether the windmill blades are healthy white vs faded.
 */
function farmClusterParts(
  cluster: Array<{ x: number; y: number }>,
  health: number
): CityBuildingPart[] {
  if (cluster.length === 0) return [];
  const out: CityBuildingPart[] = [];
  const sorted = cluster.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const member = new Set<string>();
  for (const c of sorted) member.add(c.x + ',' + c.y);
  const isMember = (x: number, y: number) => member.has(x + ',' + y);

  const grass = lerpColor(0x4a6f3a, 0x6a9054, health);
  const dirt = lerpColor(0x5a4830, 0x7a6240, health);
  const woodMain = lerpColor(0x9a4a3a, 0xc06750, health);   // barn-red, faded → vivid
  const woodPale = lerpColor(0xc0a87a, 0xe8d4a4, health);
  const tinRoof = lerpColor(0x4a4a44, 0x707064, health);
  const cropMature = lerpColor(0x9aa838, 0xd6c64a, health);
  const cropYoung = lerpColor(0x6a8a30, 0x9ab644, health);
  const struggling = health < 0.45;
  const thriving = health > 0.85;

  // 1. Continuous green pad — like a managed pasture under everything.
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => box(1.04, 0.025, 1.04), color: grass, dx: cx, dy: 0.013, dz: cz });
  }

  // 2. Internal connector paths — dirt strips so adjacent farm tiles
  // visibly link into one operation.
  const dirs: Array<[number, number]> = [[1, 0], [0, 1]];
  for (const c of sorted) {
    for (const [dx, dy] of dirs) {
      if (!isMember(c.x + dx, c.y + dy)) continue;
      const cx0 = (c.x + 0.5) * TILE_SIZE;
      const cz0 = (c.y + 0.5) * TILE_SIZE;
      const cx1 = (c.x + dx + 0.5) * TILE_SIZE;
      const cz1 = (c.y + dy + 0.5) * TILE_SIZE;
      const midX = (cx0 + cx1) / 2;
      const midZ = (cz0 + cz1) / 2;
      const w = dx !== 0 ? 1.10 : 0.16;
      const d = dy !== 0 ? 1.10 : 0.16;
      out.push({ makeGeom: () => box(w, 0.012, d), color: dirt, dx: midX, dy: 0.027, dz: midZ });
    }
  }

  // 3. Perimeter rail fence (white) — classic country farm look.
  const fenceColor = lerpColor(0xb0a890, 0xe8e2cc, health);
  const fenceLen = 0.85;
  const fencePostH = 0.10;
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const sides: Array<[number, number, [number, number]]> = [
      [0, -1, [0, -0.50]],
      [1, 0, [0.50, 0]],
      [0, 1, [0, 0.50]],
      [-1, 0, [-0.50, 0]]
    ];
    for (const [ndx, ndy, [ex, ez]] of sides) {
      if (isMember(c.x + ndx, c.y + ndy)) continue;
      const horizontal = ndy !== 0;
      // Two parallel rails (looks like classic 3-board farm fence).
      for (const railY of [0.06, 0.105]) {
        const railW = horizontal ? fenceLen : 0.018;
        const railD = horizontal ? 0.018 : fenceLen;
        out.push({ makeGeom: () => box(railW, 0.014, railD), color: fenceColor, dx: cx + ex, dy: railY, dz: cz + ez });
      }
      const postOff = horizontal ? [(-fenceLen / 2 + 0.04), 0, (fenceLen / 2 - 0.04)] : [];
      const postOffZ = !horizontal ? [(-fenceLen / 2 + 0.04), 0, (fenceLen / 2 - 0.04)] : [];
      if (horizontal) {
        for (const po of postOff) {
          out.push({ makeGeom: () => box(0.022, fencePostH, 0.022), color: fenceColor, dx: cx + ex + po, dy: 0.05, dz: cz + ez });
        }
      } else {
        for (const po of postOffZ) {
          out.push({ makeGeom: () => box(0.022, fencePostH, 0.022), color: fenceColor, dx: cx + ex, dy: 0.05, dz: cz + ez + po });
        }
      }
    }
  }

  // 4. Per-tile roles. Crops fill in between primary buildings.
  const ROLES: FarmRole[] = [
    'farmhouse', 'barn', 'crops', 'silo', 'crops',
    'animal_pen', 'tractor', 'crops', 'greenhouse', 'water_tank',
    'crops', 'orchard', 'windmill', 'compost'
  ];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const role: FarmRole = i < ROLES.length ? ROLES[i]! : 'crops';
    emitFarmFeature(out, role, cx, cz, woodMain, woodPale, tinRoof, dirt, cropMature, cropYoung, thriving, struggling);
  }

  return out;
}

type FarmRole =
  | 'farmhouse' | 'barn' | 'crops' | 'silo' | 'animal_pen'
  | 'tractor' | 'greenhouse' | 'water_tank' | 'orchard'
  | 'windmill' | 'compost';

function emitFarmFeature(
  out: CityBuildingPart[], role: FarmRole,
  cx: number, cz: number,
  woodMain: number, woodPale: number, tinRoof: number, dirt: number,
  cropMature: number, cropYoung: number,
  thriving: boolean, struggling: boolean
): void {
  switch (role) {
    case 'farmhouse': {
      // Two-storey farmhouse: cream body + red gable roof + chimney.
      out.push({ makeGeom: () => box(0.48, 0.36, 0.40), color: woodPale, dx: cx, dy: 0.18, dz: cz });
      out.push({ makeGeom: () => cone(0.35, 0.20, 4), color: woodMain, dx: cx, dy: 0.36 + 0.10, dz: cz });
      out.push({ makeGeom: () => box(0.07, 0.18, 0.07), color: 0x6e4a3a, dx: cx + 0.16, dy: 0.36 + 0.09, dz: cz - 0.08 });
      // Front door + window.
      out.push({ makeGeom: () => box(0.10, 0.18, 0.018), color: 0x3a2a18, dx: cx, dy: 0.09, dz: cz + 0.20 + 0.009 });
      out.push({ makeGeom: () => box(0.08, 0.06, 0.018), color: 0x2a3a4a, dx: cx + 0.14, dy: 0.22, dz: cz + 0.20 + 0.009 });
      if (thriving) {
        out.push({ makeGeom: () => sphereLite(0.06), color: 0xe0e6ec, dx: cx + 0.16, dy: 0.36 + 0.22, dz: cz - 0.08 });
      }
      break;
    }
    case 'barn': {
      // Big red barn — wider gable + tall roof + hayloft door.
      out.push({ makeGeom: () => box(0.65, 0.42, 0.55), color: woodMain, dx: cx, dy: 0.21, dz: cz });
      out.push({ makeGeom: () => cone(0.46, 0.24, 4), color: 0x4a3020, dx: cx, dy: 0.42 + 0.12, dz: cz });
      // White trim on the doors.
      out.push({ makeGeom: () => box(0.30, 0.32, 0.018), color: woodPale, dx: cx, dy: 0.16, dz: cz + 0.275 + 0.009 });
      // X-brace on the doors.
      out.push({ makeGeom: () => box(0.30, 0.022, 0.020), color: woodMain, dx: cx, dy: 0.16, dz: cz + 0.275 + 0.018 });
      out.push({ makeGeom: () => box(0.022, 0.32, 0.020), color: woodMain, dx: cx, dy: 0.16, dz: cz + 0.275 + 0.018 });
      // Hayloft door.
      out.push({ makeGeom: () => box(0.10, 0.08, 0.020), color: 0x3a2a18, dx: cx, dy: 0.40, dz: cz + 0.275 + 0.020 });
      break;
    }
    case 'crops': {
      // Crop field — 5 rows × 6 short rectangular crop strips. Mature
      // when thriving (taller, golden), young when struggling.
      const rows = 5;
      const cols = 6;
      const stripW = 0.10;
      const stripD = 0.13;
      const stripH = thriving ? 0.10 : (struggling ? 0.04 : 0.07);
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const ox = -0.36 + col * 0.144;
          const oz = -0.30 + r * 0.15;
          const c = (r + col) % 2 === 0 ? cropMature : cropYoung;
          out.push({ makeGeom: () => box(stripW, stripH, stripD * 0.5), color: c, dx: cx + ox, dy: stripH / 2, dz: cz + oz });
        }
      }
      // Furrow lines between rows.
      for (let r = 0; r <= rows; r++) {
        out.push({ makeGeom: () => box(0.86, 0.012, 0.020), color: dirt, dx: cx, dy: 0.026, dz: cz - 0.36 + r * 0.15 });
      }
      break;
    }
    case 'silo': {
      // Tall metal silo + dome cap + ladder strip.
      out.push({ makeGeom: () => cyl(0.18, 0.70, 12), color: 0xb8b8b0, dx: cx, dy: 0.35, dz: cz });
      out.push({ makeGeom: () => cone(0.18, 0.10, 12), color: 0x707064, dx: cx, dy: 0.70 + 0.05, dz: cz });
      // Ladder.
      for (let k = 0; k < 5; k++) {
        out.push({ makeGeom: () => box(0.05, 0.018, 0.014), color: 0x3a3a3a, dx: cx + 0.18 + 0.012, dy: 0.10 + k * 0.13, dz: cz });
      }
      // Conveyor pipe dropping from silo to barn-side.
      out.push({ makeGeom: () => box(0.18, 0.05, 0.06), color: 0x707064, dx: cx + 0.10, dy: 0.50, dz: cz });
      break;
    }
    case 'animal_pen': {
      // Small open shelter + 4 sheep / cows (just colored cubes for the
      // low-poly aesthetic).
      out.push({ makeGeom: () => box(0.50, 0.18, 0.30), color: woodMain, dx: cx - 0.18, dy: 0.09, dz: cz });
      out.push({ makeGeom: () => cone(0.35, 0.10, 4), color: tinRoof, dx: cx - 0.18, dy: 0.18 + 0.05, dz: cz });
      // Animals — small white (sheep) + brown (cow) blobs.
      const animals = [
        { x: 0.10, z: -0.18, c: 0xeae3d0 },
        { x: 0.22, z: 0.10, c: 0xeae3d0 },
        { x: 0.28, z: -0.05, c: 0x6a4a3a },
        { x: 0.05, z: 0.20, c: 0xeae3d0 }
      ];
      for (const a of animals) {
        out.push({ makeGeom: () => box(0.10, 0.07, 0.07), color: a.c, dx: cx + a.x, dy: 0.04, dz: cz + a.z });
      }
      break;
    }
    case 'tractor': {
      // Small green tractor — body + cab + 4 wheels.
      out.push({ makeGeom: () => box(0.32, 0.10, 0.18), color: 0x5e8e3a, dx: cx, dy: 0.07, dz: cz });
      out.push({ makeGeom: () => box(0.12, 0.10, 0.16), color: 0x5e8e3a, dx: cx + 0.04, dy: 0.16, dz: cz });
      // Wheels (large rear, small front).
      for (const w of [
        { x: -0.10, z: -0.12, r: 0.07 },
        { x: -0.10, z:  0.12, r: 0.07 },
        { x:  0.12, z: -0.10, r: 0.045 },
        { x:  0.12, z:  0.10, r: 0.045 }
      ]) {
        const g = new CylinderGeometry(w.r, w.r, 0.04, 8);
        g.rotateX(Math.PI / 2);
        out.push({ makeGeom: () => g, color: 0x222222, dx: cx + w.x, dy: w.r, dz: cz + w.z });
      }
      // Exhaust stack.
      out.push({ makeGeom: () => cyl(0.018, 0.12, 6), color: 0x222222, dx: cx + 0.10, dy: 0.27, dz: cz - 0.06 });
      break;
    }
    case 'greenhouse': {
      // Glass A-frame: pale frame body + light-blue gable roof.
      out.push({ makeGeom: () => box(0.55, 0.16, 0.40), color: woodPale, dx: cx, dy: 0.08, dz: cz });
      // Glass roof — gable. Build positions in tile-local space so the
      // outer translate(p.dx, p.dy, p.dz) works correctly.
      out.push({
        makeGeom: () => {
          const positions = new Float32Array([
            -0.275, 0.16, -0.20,
             0.275, 0.16, -0.20,
             0.275, 0.16,  0.20,
            -0.275, 0.16,  0.20,
                 0, 0.36, -0.20,
                 0, 0.36,  0.20
          ]);
          const indices = new Uint32Array([
            0, 1, 4, 4, 1, 5,
            3, 5, 2, 5, 1, 2,
            0, 4, 3, 3, 4, 5,
            1, 5, 4
          ]);
          const g = new BufferGeometry();
          g.setAttribute('position', new BufferAttribute(positions, 3));
          g.setIndex(new BufferAttribute(indices, 1));
          return g;
        },
        color: 0xa6c8d4,
        dx: cx, dy: 0, dz: cz
      });
      // Door on the south face.
      out.push({ makeGeom: () => box(0.08, 0.10, 0.018), color: woodPale, dx: cx, dy: 0.05, dz: cz + 0.20 + 0.009 });
      break;
    }
    case 'water_tank': {
      // Round blue water tank on stilts.
      for (const dx of [-0.16, 0.16]) for (const dz of [-0.16, 0.16]) {
        out.push({ makeGeom: () => box(0.04, 0.30, 0.04), color: 0x2f3f4a, dx: cx + dx, dy: 0.15, dz: cz + dz });
      }
      out.push({ makeGeom: () => cyl(0.22, 0.22, 12), color: 0x4d8eb9, dx: cx, dy: 0.30 + 0.11, dz: cz });
      out.push({ makeGeom: () => cone(0.22, 0.10, 12), color: 0x3e7aa0, dx: cx, dy: 0.30 + 0.22 + 0.05, dz: cz });
      // Spigot pipe.
      out.push({ makeGeom: () => cyl(0.018, 0.30, 6), color: 0x707880, dx: cx + 0.16, dy: 0.15, dz: cz });
      break;
    }
    case 'orchard': {
      // 9 small fruit trees in a 3x3 grid.
      for (let r = 0; r < 3; r++) {
        for (let col = 0; col < 3; col++) {
          const ox = -0.30 + col * 0.30;
          const oz = -0.30 + r * 0.30;
          out.push({ makeGeom: () => cyl(0.025, 0.10, 5), color: 0x6e4a30, dx: cx + ox, dy: 0.05, dz: cz + oz });
          out.push({ makeGeom: () => sphereLite(0.10), color: 0x3a7a3a, dx: cx + ox, dy: 0.16, dz: cz + oz });
          // Fruit dots when thriving.
          if (thriving) {
            out.push({ makeGeom: () => sphereLite(0.022), color: 0xb14a3a, dx: cx + ox + 0.05, dy: 0.18, dz: cz + oz });
          }
        }
      }
      break;
    }
    case 'windmill': {
      // Tower + blades.
      out.push({ makeGeom: () => box(0.10, 0.55, 0.10), color: woodPale, dx: cx, dy: 0.275, dz: cz });
      // Hub.
      out.push({ makeGeom: () => cyl(0.05, 0.05, 8), color: 0x4a4a4a, dx: cx, dy: 0.55, dz: cz - 0.05 });
      // Four blades — long thin boxes radiating from the hub.
      const bladeColor = thriving ? 0xfafbfc : 0xc8bdac;
      const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      for (const a of angles) {
        const blade = new BoxGeometry(0.30, 0.04, 0.012);
        blade.translate(0.15, 0, 0);
        blade.rotateZ(a);
        blade.translate(cx, 0.55, cz - 0.05);
        out.push({ makeGeom: () => blade, color: bladeColor, dx: 0, dy: 0, dz: 0 });
      }
      break;
    }
    case 'compost': {
      // Three covered compost bins side by side.
      for (let k = -1; k <= 1; k++) {
        const ox = k * 0.20;
        out.push({ makeGeom: () => box(0.16, 0.10, 0.20), color: 0x4a3a28, dx: cx + ox, dy: 0.05, dz: cz });
        out.push({ makeGeom: () => box(0.18, 0.018, 0.22), color: 0x6a5a40, dx: cx + ox, dy: 0.10 + 0.009, dz: cz });
        // Crumbly visible top.
        out.push({ makeGeom: () => box(0.10, 0.04, 0.16), color: 0x3a2a1a, dx: cx + ox, dy: 0.07, dz: cz });
      }
      break;
    }
  }
}

/* ---- Big Box + Parking Lot (Beta 1.3, Phase 1) ----------------------- *
 *
 * Big Box stores cluster like farm/forestry — adjacent big_box tiles
 * flood-fill into one larger composition. The cluster builder ALSO
 * walks adjacent parking_lot tiles and paves them as part of the same
 * field, so a player surrounding a big_box with stalls reads as one
 * lot. Parking lots placed standalone get their own builder below.
 *
 * Phase 1 ships the visuals + buildable types only. Phase 2 will wire
 * the actual parking simulation (cars route to a stall, park, walker
 * spawns to complete the trip). Phase 3 adds the difficulty slider.
 * --------------------------------------------------------------------- */

/* ---- Big Box variants (Beta 1.3.3) ---------------------------------- *
 *
 * Five real-world store archetypes. Each archetype is selected by
 * deterministic hash on the cluster's anchor (lex-smallest) tile, so a
 * given location renders the same store every paint. NO actual logos
 * or trademarked branding — silhouettes, palette codes, and signature
 * structural cues only.
 *
 * Archetypes:
 *  - 'warehouse-discount' (Walmart-style): tan walls, blue-and-yellow
 *    fascia stripe, plain wide entry vestibule, simple flat roof.
 *  - 'electronics'        (Best-Buy-style): black-and-yellow fascia,
 *    blue-grey body, glass-heavy storefront, no garden centre.
 *  - 'home-improvement'   (Home-Depot/Lowes-style): orange-and-grey
 *    fascia, taller warehouse roof, garden-centre extension off the
 *    primary tile with greenhouse + outdoor lumber stacks.
 *  - 'mass-merchant'      (Target-style): red-and-white fascia,
 *    rounded entry portico, bullseye-suggesting circular accent.
 *  - 'membership-club'    (Costco-style): solid blue exterior, no
 *    windows on side walls, GAS STATION canopy on the apron front.
 * --------------------------------------------------------------------- */

type BigBoxArchetype =
  | 'warehouse-discount'
  | 'electronics'
  | 'home-improvement'
  | 'mass-merchant'
  | 'membership-club';

interface BigBoxPalette {
  archetype: BigBoxArchetype;
  wall: number;
  wallDark: number;
  fascia: number;       // top trim band
  brandStripe: number;  // the visible brand-coloured stripe under fascia
  brandAccent: number;  // secondary brand colour (corner blocks, garden centre, etc.)
  roof: number;
  roofAccent: number;
  entryGlass: number;
  entryFrame: number;   // dark frame around the entry, also door split line
}

const BIG_BOX_PALETTES: Record<BigBoxArchetype, BigBoxPalette> = {
  // Walmart-warehouse: tan walls + blue/yellow fascia, classic wide
  // single-storey big-box look. The blue stripe is the dominant brand
  // signal; yellow accent corners reinforce.
  'warehouse-discount': {
    archetype: 'warehouse-discount',
    wall: 0xd6c9aa, wallDark: 0xa89e84,
    fascia: 0xf4ecd9, brandStripe: 0x2a5fb8, brandAccent: 0xf2b938,
    roof: 0x4f463a, roofAccent: 0x3e352a,
    entryGlass: 0x2a3a52, entryFrame: 0x141a24
  },
  // Best-Buy-electronics: dark grey body + black + yellow flash.
  // Modern glass-heavy storefront, no garden centre.
  electronics: {
    archetype: 'electronics',
    wall: 0x6a7682, wallDark: 0x484f57,
    fascia: 0x1a1d22, brandStripe: 0xf4cc25, brandAccent: 0xf2efe5,
    roof: 0x2e2f33, roofAccent: 0x1e1f23,
    entryGlass: 0x2a3a52, entryFrame: 0x141a24
  },
  // Home-Depot-improvement: warm orange brand stripe + grey walls +
  // garden centre extension. The garden centre is the visual cue.
  'home-improvement': {
    archetype: 'home-improvement',
    wall: 0xa39888, wallDark: 0x7e7466,
    fascia: 0xf2efe5, brandStripe: 0xe57a23, brandAccent: 0x4a4a4a,
    roof: 0x3e3a35, roofAccent: 0x2e2a25,
    entryGlass: 0x2a3a52, entryFrame: 0x141a24
  },
  // Target-mass-merchant: white walls + red brand stripe + rounded
  // entry portico + bullseye-suggesting red disc above the entry.
  'mass-merchant': {
    archetype: 'mass-merchant',
    wall: 0xeae7df, wallDark: 0xb6b1a4,
    fascia: 0xffffff, brandStripe: 0xc83838, brandAccent: 0xc83838,
    roof: 0x5a514a, roofAccent: 0x453d36,
    entryGlass: 0x2a3a52, entryFrame: 0x141a24
  },
  // Costco-membership-club: solid blue body, no decorative trim,
  // industrial roof, GAS STATION on the apron front.
  'membership-club': {
    archetype: 'membership-club',
    wall: 0x365a98, wallDark: 0x254479,
    fascia: 0xe24b3a, brandStripe: 0xffffff, brandAccent: 0xe24b3a,
    roof: 0x3a3f4a, roofAccent: 0x2a2e36,
    entryGlass: 0x2a3a52, entryFrame: 0x141a24
  }
};

/** Deterministic archetype pick from the anchor tile coordinates.
 *  Hash matches the variant-picker used elsewhere so two adjacent
 *  big_box clusters with the same anchor would (impossibly) get the
 *  same archetype — same-tile-same-store stability is the contract. */
function pickBigBoxArchetype(ax: number, ay: number): BigBoxArchetype {
  const h = ((ax * 2654435761) ^ (ay * 1597334677)) >>> 0;
  const archetypes: BigBoxArchetype[] = [
    'warehouse-discount', 'electronics', 'home-improvement',
    'mass-merchant', 'membership-club'
  ];
  return archetypes[h % archetypes.length]!;
}

function bigBoxClusterParts(
  cluster: Array<{ x: number; y: number }>,
  grid: Grid
): CityBuildingPart[] {
  if (cluster.length === 0) return [];
  // Beta 1.3.6 — store-front rotation. The store-related geometry
  // (asphalt apron, body, fascia, brand stripe, entry, lamps) goes
  // into `storeParts`, gets POST-ROTATED to face whichever cardinal
  // the parking lot (or nearest road) sits on. Absorbed parking_lot
  // tiles go into `parkingParts` and stay axis-aligned — the
  // rotation is TOWARD the parking, so the relative orientation
  // store→parking stays correct (storefront opens onto the lot).
  const storeParts: CityBuildingPart[] = [];
  const parkingParts: CityBuildingPart[] = [];
  // Lex-order the cluster — first tile is the "primary store"; the
  // rest are wings / annexes that extend the storefront.
  const sorted = cluster.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const primary = sorted[0]!;
  const archetype = pickBigBoxArchetype(primary.x, primary.y);
  const pal = BIG_BOX_PALETTES[archetype];

  // Collect adjacent parking_lot tiles (NOT inside the cluster) so we
  // pave them in the same composition AND render them with parking-
  // lot decorations that match the lot's adjacency to the store.
  const adjacentParking = new Set<string>();
  for (const c of sorted) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = c.x + dx, ny = c.y + dy;
      const nt = grid.get(nx, ny);
      if (nt && nt.building === 'parking_lot') adjacentParking.add(nx + ',' + ny);
    }
  }
  // Local alias so the rest of the function can keep writing to `out`
  // (storeParts) without churn. Parking-lot emission appends to
  // parkingParts explicitly at the end.
  const out = storeParts;

  // Shared lot palette — Phase 1 colours kept stable so adjacent
  // parking lots merge visually with the apron.
  const asphalt = 0x2e2f33;
  const stripeWhite = 0xefe7d2;
  const stripeYellow = 0xf2c648;
  const stripeBlue = 0x2a5fb8;       // accessible (handicapped) stall paint
  const cartCorral = 0xa9a297;
  const lampPole = 0x2c2d31;
  const lampHead = 0xfff2c8;
  const fenceCol = 0xb6ad9b;         // chain-link tone (pale grey-green)
  const fencePost = 0x6e6a64;
  const planter = 0x6e4622;          // terracotta planter
  const planterLeaf = 0x4a6b3a;

  // 1. Asphalt apron under the entire cluster. Single flat layer 0.018
  // thick so it reads as paving without being a hill the store sits on.
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => box(1.02, 0.018, 1.02), color: asphalt, dx: cx, dy: 0.009, dz: cz });
  }

  // Cluster bbox + per-tile exterior-side metadata (Beta 1.4.1). The
  // pre-1.4.1 system branched between an "isRectangular" cohesive path
  // and an "irregular" per-tile fallback that produced N stamped mini-
  // stores. The new system is fully modular: every cluster — rect, L,
  // T, U, plus, etc — emits ONE cohesive building whose outline traces
  // the cluster's tile shape. The trick is per-tile body slabs that
  // share their interior walls with neighbours and inset only on
  // exterior sides.
  const minX = sorted.reduce((m, c) => Math.min(m, c.x), sorted[0]!.x);
  const maxX = sorted.reduce((m, c) => Math.max(m, c.x), sorted[0]!.x);
  const minY = sorted.reduce((m, c) => Math.min(m, c.y), sorted[0]!.y);
  const maxY = sorted.reduce((m, c) => Math.max(m, c.y), sorted[0]!.y);
  const widthTiles = maxX - minX + 1;
  const depthTiles = maxY - minY + 1;
  // Build a fast cluster lookup for adjacency checks.
  const clusterKey = (x: number, y: number) => x + ',' + y;
  const clusterSet = new Set(sorted.map((c) => clusterKey(c.x, c.y)));
  const inCluster = (x: number, y: number) => clusterSet.has(clusterKey(x, y));
  // Per-tile metadata: which of the 4 cardinal sides is exterior?
  type TileMeta = { x: number; y: number; N: boolean; E: boolean; S: boolean; W: boolean };
  const tileMeta: TileMeta[] = sorted.map((c) => ({
    x: c.x, y: c.y,
    N: !inCluster(c.x, c.y - 1),
    E: !inCluster(c.x + 1, c.y),
    S: !inCluster(c.x, c.y + 1),
    W: !inCluster(c.x - 1, c.y)
  }));

  // Body height — archetype-tweaked. Membership-club + home-improvement
  // are warehouse-tall; the others sit at the standard 0.30. Height
  // scales with the cluster's smallest bbox dimension (capped at +0.20)
  // so a 2x2 reads as a proportionate warehouse instead of a pancake.
  const sizeBonus = Math.min(0.20, Math.max(0, Math.min(widthTiles, depthTiles) - 1) * 0.05);
  const bodyHeight = (archetype === 'home-improvement' ? 0.36
                   : archetype === 'membership-club' ? 0.34
                   : 0.30) + sizeBonus;

  // Per-side body insets. SIDE_INSET on east/west exteriors creates a
  // thin grass margin between the wall and the tile edge. BACK_INSET
  // is slightly deeper to leave room for the loading-dock band on the
  // north face. FRONT_INSET is the big one — leaves room for the
  // entry vestibule + cart corrals + apron on the south face. Interior
  // sides have NO inset, so adjacent cluster tiles' bodies abut at
  // the tile boundary with no seam.
  const SIDE_INSET = 0.04;
  const BACK_INSET = 0.09;
  const FRONT_INSET = 0.30;

  /** Per-tile body extent given its exterior-side metadata. */
  const tileExtent = (m: TileMeta) => {
    const insetN = m.N ? BACK_INSET : 0;
    const insetS = m.S ? FRONT_INSET : 0;
    const insetE = m.E ? SIDE_INSET : 0;
    const insetW = m.W ? SIDE_INSET : 0;
    const w = TILE_SIZE - insetE - insetW;
    const d = TILE_SIZE - insetN - insetS;
    const cx = (m.x + 0.5) * TILE_SIZE + (insetW - insetE) / 2;
    const cz = (m.y + 0.5) * TILE_SIZE + (insetN - insetS) / 2;
    // World-coord faces (useful for fascia/dock/lamp placement).
    const xWest = cx - w / 2;
    const xEast = cx + w / 2;
    const zNorth = cz - d / 2;
    const zSouth = cz + d / 2;
    return { w, d, cx, cz, xWest, xEast, zNorth, zSouth };
  };

  // 2. Cohesive store body — per-tile wall slabs that abut on interior
  // sides and inset on exterior sides. For any cluster shape, the
  // union of these slabs traces the cluster outline.
  for (const m of tileMeta) {
    const { w, d, cx, cz } = tileExtent(m);
    if (w <= 0 || d <= 0) continue;
    out.push({
      makeGeom: () => box(w, bodyHeight, d),
      color: pal.wall,
      dx: cx, dy: bodyHeight / 2 + 0.03, dz: cz
    });
  }

  // 2a. Inner-corner filler. When the cluster wraps around a NORTH
  // notch (3 of 4 tiles around a world-grid corner are in cluster,
  // missing tile is north of the corner), the two perpendicular
  // exterior walls — both SIDE_INSET/BACK_INSET — don't quite meet at
  // the inner corner. A small filler box bridges the gap. We only
  // fill the NORTH-notch case (missing TL or TR) because south-notch
  // configurations have a FRONT_INSET (0.30) on one side, and the
  // resulting "gap" is actually a legitimate front-facade setback —
  // each arm of an L-shaped cluster gets its own storefront facing
  // its own apron, which is what real architecture would do for that
  // footprint anyway.
  for (let gy = minY; gy <= maxY + 1; gy++) {
    for (let gx = minX; gx <= maxX + 1; gx++) {
      const tl = inCluster(gx - 1, gy - 1);
      const tr = inCluster(gx, gy - 1);
      const bl = inCluster(gx - 1, gy);
      const br = inCluster(gx, gy);
      const cnt = (tl ? 1 : 0) + (tr ? 1 : 0) + (bl ? 1 : 0) + (br ? 1 : 0);
      if (cnt !== 3) continue;
      if (!tl) {
        // Missing TL (north-west of corner). Cluster wraps E/SW.
        // TR's W exterior (SIDE_INSET) at x = gx + 0.04.
        // BL's N exterior (BACK_INSET) at z = gy + 0.09.
        out.push({
          makeGeom: () => box(SIDE_INSET, bodyHeight, BACK_INSET),
          color: pal.wall,
          dx: gx + SIDE_INSET / 2, dy: bodyHeight / 2 + 0.03, dz: gy + BACK_INSET / 2
        });
      } else if (!tr) {
        // Missing TR (north-east of corner). Cluster wraps W/SE.
        // TL's E exterior (SIDE_INSET) at x = gx - 0.04.
        // BR's N exterior (BACK_INSET) at z = gy + 0.09.
        out.push({
          makeGeom: () => box(SIDE_INSET, bodyHeight, BACK_INSET),
          color: pal.wall,
          dx: gx - SIDE_INSET / 2, dy: bodyHeight / 2 + 0.03, dz: gy + BACK_INSET / 2
        });
      }
      // Missing BL / BR cases intentionally not filled — the FRONT_INSET
      // creates a legitimate facade setback at the inner corner, which
      // reads as two storefronts meeting at a structural seam.
    }
  }

  // 3. Per-tile roof slab with overhang on exterior sides only. Adjacent
  // cluster tiles' roof slabs abut on interior boundaries with no gap.
  for (const m of tileMeta) {
    const { w, d, cx, cz } = tileExtent(m);
    if (w <= 0 || d <= 0) continue;
    const overhang = 0.01;
    const overE = m.E ? overhang : 0;
    const overW = m.W ? overhang : 0;
    const overN = m.N ? overhang : 0;
    const overS = m.S ? overhang : 0;
    const overWidth = w + overE + overW;
    const overDepth = d + overN + overS;
    const overCX = cx + (overE - overW) / 2;
    const overCZ = cz + (overS - overN) / 2;
    out.push({
      makeGeom: () => box(overWidth, 0.02, overDepth),
      color: pal.roof,
      dx: overCX, dy: bodyHeight + 0.04, dz: overCZ
    });
  }

  // 4. Loading-dock band on every N-exterior tile's back face.
  for (const m of tileMeta) {
    if (!m.N) continue;
    const { w, cx, zNorth } = tileExtent(m);
    out.push({
      makeGeom: () => box(w, 0.10, 0.06),
      color: pal.wallDark,
      dx: cx, dy: 0.05, dz: zNorth + 0.03
    });
  }

  // 5. Fascia + brand stripe + pilasters on every S-exterior tile's
  // storefront face. Adjacent S-exterior tiles produce continuous
  // fascia + stripe along the cluster's south outline.
  for (const m of tileMeta) {
    if (!m.S) continue;
    const { w, cx, zSouth } = tileExtent(m);
    // White parapet fascia along this tile's south wall.
    out.push({
      makeGeom: () => box(w, 0.06, 0.04),
      color: pal.fascia,
      dx: cx, dy: bodyHeight + 0.06, dz: zSouth - 0.02
    });
    // Brand-coloured stripe just under the fascia.
    out.push({
      makeGeom: () => box(w, 0.025, 0.03),
      color: pal.brandStripe,
      dx: cx, dy: bodyHeight + 0.01, dz: zSouth - 0.025
    });
    // Vertical pilasters at the tile's two front corners. The "outer"
    // corner (one that's also W or E exterior) gets a thicker
    // pilaster; the "inner" corner (interior W/E — joins another
    // S-exterior tile in the cluster) gets a thin tile-seam pilaster
    // that breaks up the long facade.
    const westThick = m.W;
    const eastThick = m.E;
    out.push({
      makeGeom: () => box(westThick ? 0.06 : 0.035, bodyHeight + (westThick ? 0.04 : 0), westThick ? 0.06 : 0.035),
      color: pal.wallDark,
      dx: cx - w / 2 + (westThick ? 0.03 : 0.018),
      dy: bodyHeight / 2 + (westThick ? 0.05 : 0.03),
      dz: zSouth - 0.025
    });
    out.push({
      makeGeom: () => box(eastThick ? 0.06 : 0.035, bodyHeight + (eastThick ? 0.04 : 0), eastThick ? 0.06 : 0.035),
      color: pal.wallDark,
      dx: cx + w / 2 - (eastThick ? 0.03 : 0.018),
      dy: bodyHeight / 2 + (eastThick ? 0.05 : 0.03),
      dz: zSouth - 0.025
    });
  }

  // 6. Side service door on the east-most E-exterior tile (only when
  // the cluster has more than one tile — single-tile stores don't get
  // a side door). Picks the tile with the highest x; ties broken by
  // tile.y closest to the cluster centre so the door sits in the
  // middle of the east flank.
  if (sorted.length > 1) {
    const eExt = tileMeta.filter((m) => m.E);
    if (eExt.length > 0) {
      const midY = (minY + maxY) / 2;
      eExt.sort((a, b) => b.x - a.x || Math.abs(a.y - midY) - Math.abs(b.y - midY));
      const door = eExt[0]!;
      const { xEast, cz } = tileExtent(door);
      out.push({
        makeGeom: () => box(0.03, bodyHeight * 0.55, 0.18),
        color: pal.entryFrame,
        dx: xEast - 0.005, dy: bodyHeight * 0.30, dz: cz
      });
    }
  }

  // 2b. Per-tile roof HVAC scatter (Beta 1.3.7) — gives the long
  // continuous roof slab some industrial texture. Each cluster tile
  // adds 1-3 HVAC units at deterministic-but-varied positions.
  //
  // Beta 1.3.8 — HVAC units alternate between roofAccent (darker
  // box vents) and a metal-grey tone (silver rooftop AC units) so
  // the roof reads as a mix of equipment rather than one uniform
  // material. Also added an occasional ROUND vent stack so the
  // silhouette isn't all rectangles.
  const hvacMetal = 0x9098a2;        // brushed-aluminum AC unit
  const hvacVent = 0x4a4f56;          // dark metal exhaust pipe
  for (const c of sorted) {
    const tileX = (c.x + 0.5) * TILE_SIZE;
    const tileZ = (c.y + 0.5) * TILE_SIZE;
    // Hash from tile coords for deterministic but per-cluster-tile-
    // unique HVAC layouts.
    const h = ((c.x * 374761393) ^ (c.y * 668265263)) >>> 0;
    const count = ((h >> 2) % 3) + 2;  // 2..4 units per tile (was 1..3)
    for (let i = 0; i < count; i++) {
      const ox = (((h >> (i * 5)) & 0xff) / 255 - 0.5) * 0.70;
      const oz = (((h >> (i * 5 + 4)) & 0xff) / 255 - 0.5) * 0.45 - 0.10;
      const w = 0.08 + (((h >> (i * 3 + 12)) & 0x07) / 7) * 0.10;
      const hh = 0.03 + (((h >> (i * 3 + 16)) & 0x07) / 7) * 0.04;
      const kind = (h >> (i * 4 + 20)) & 0x03;
      if (kind === 0) {
        // Dark roofAccent vent box.
        out.push({
          makeGeom: () => box(w, hh, w * 0.8),
          color: pal.roofAccent,
          dx: tileX + ox, dy: bodyHeight + 0.04 + hh / 2, dz: tileZ + oz
        });
      } else if (kind === 1) {
        // Metal-grey AC unit (slightly taller, square footprint).
        out.push({
          makeGeom: () => box(w * 0.9, hh * 1.2, w * 0.9),
          color: hvacMetal,
          dx: tileX + ox, dy: bodyHeight + 0.04 + (hh * 1.2) / 2, dz: tileZ + oz
        });
      } else if (kind === 2) {
        // Cylindrical exhaust stack.
        const r = w * 0.35;
        out.push({
          makeGeom: () => cyl(r, hh * 1.6, 10),
          color: hvacVent,
          dx: tileX + ox, dy: bodyHeight + 0.04 + (hh * 1.6) / 2, dz: tileZ + oz
        });
      } else {
        // Wide flat duct.
        out.push({
          makeGeom: () => box(w * 1.3, hh * 0.6, w * 0.5),
          color: pal.wallDark,
          dx: tileX + ox, dy: bodyHeight + 0.04 + (hh * 0.6) / 2, dz: tileZ + oz
        });
      }
    }
  }

  // 7. Archetype-specific facade accents — apply PER S-EXTERIOR TILE so
  // every front-facing tile of any cluster shape gets the archetype
  // signature. Pre-1.4.1 these were only emitted for rectangular
  // clusters; now an L-shape's two front arms each get the full
  // signature, making the modular footprint feel intentional rather
  // than a fallback.
  for (const m of tileMeta) {
    if (!m.S) continue;
    const { w, cx, zSouth } = tileExtent(m);
    if (archetype === 'warehouse-discount') {
      // Yellow corner blocks at the tile's outer corners (only when
      // the corner is a true cluster outer corner — i.e. the adjacent
      // E/W side is also exterior so this corner faces open ground).
      if (m.W) {
        out.push({ makeGeom: () => box(0.04, bodyHeight * 0.6, 0.06), color: pal.brandAccent, dx: cx - w / 2 + 0.08, dy: bodyHeight * 0.30 + 0.03, dz: zSouth - 0.02 });
      }
      if (m.E) {
        out.push({ makeGeom: () => box(0.04, bodyHeight * 0.6, 0.06), color: pal.brandAccent, dx: cx + w / 2 - 0.08, dy: bodyHeight * 0.30 + 0.03, dz: zSouth - 0.02 });
      }
    }
    if (archetype === 'electronics') {
      // Vertical glass windows along this S-exterior tile's full
      // front width (4 windows per tile).
      const windowCount = 4;
      const spacing = w / (windowCount + 1);
      for (let i = 1; i <= windowCount; i++) {
        const wx = cx - w / 2 + i * spacing;
        out.push({ makeGeom: () => box(0.06, bodyHeight * 0.45, 0.02), color: pal.entryGlass, dx: wx, dy: bodyHeight * 0.35, dz: zSouth - 0.01 });
      }
    }
  }

  // 8. Storefront entry doors + cart corrals.
  //
  // Beta 1.4.1 — entry placement is now per-S-exterior-tile-range
  // instead of per-bbox. For a rectangular cluster this matches the
  // pre-1.4.1 behaviour (S-exterior tiles span the full bottom row);
  // for L/T/U-shapes, entries spread across each contiguous front
  // segment so every storefront arm of the cluster gets its own door.
  //
  // Algorithm:
  //   1. Group S-exterior tiles into contiguous horizontal runs.
  //   2. Each run of length 1 → ONE entry at the tile's centre.
  //   3. Each run of length ≥ 2 → TWO entries spaced 1/3 in from
  //      each end, like a real Walmart Supercenter.
  //   4. The cluster's "primary" entry (the one that gets brand
  //      accents like the Target bullseye) is the run-2 east entry
  //      of the largest run (matches the pre-1.4.1 single-entry
  //      "isPrimary" semantics for rectangular clusters).
  const sExtTiles = tileMeta.filter((m) => m.S).sort((a, b) =>
    a.y - b.y || a.x - b.x
  );
  // Group into horizontal runs (same y, contiguous x).
  const sRuns: TileMeta[][] = [];
  for (const m of sExtTiles) {
    const lastRun = sRuns[sRuns.length - 1];
    if (lastRun && lastRun[lastRun.length - 1]!.y === m.y &&
        lastRun[lastRun.length - 1]!.x === m.x - 1) {
      lastRun.push(m);
    } else {
      sRuns.push([m]);
    }
  }
  // Build the entry list. Track the primary entry (designated
  // `isPrimary`) — picked as the east-most entry on the longest run.
  type EntryPos = { cx: number; cz: number; isPrimary: boolean; tile: TileMeta };
  const entryPositions: EntryPos[] = [];
  // Find longest run (ties broken by southern-most then western-most)
  // so the primary always lands on the most prominent front of the
  // building.
  const longestRun = sRuns.reduce<TileMeta[] | null>((best, run) => {
    if (!best) return run;
    if (run.length > best.length) return run;
    if (run.length < best.length) return best;
    const bestY = best[0]!.y, runY = run[0]!.y;
    if (runY > bestY) return run;
    if (runY < bestY) return best;
    return run[0]!.x < best[0]!.x ? run : best;
  }, null);
  for (const run of sRuns) {
    const isLongest = run === longestRun;
    if (run.length === 1) {
      const m = run[0]!;
      const { cx, zSouth } = tileExtent(m);
      entryPositions.push({ cx, cz: zSouth - 0.01, isPrimary: isLongest, tile: m });
    } else {
      // Run length ≥ 2 — spread 2 entries across the run.
      const leftTile = run[0]!;
      const rightTile = run[run.length - 1]!;
      const leftExt = tileExtent(leftTile);
      const rightExt = tileExtent(rightTile);
      const leftX = leftExt.xWest;
      const rightX = rightExt.xEast;
      const span = rightX - leftX;
      const entry1X = leftX + span * 0.25;
      const entry2X = leftX + span * 0.75;
      // Each entry's z = the south-face z of the tile it lands on.
      const tileAtX = (worldX: number): TileMeta => {
        const tx = Math.floor(worldX);
        return run.find((m) => m.x === tx) ?? run[0]!;
      };
      const m1 = tileAtX(entry1X);
      const m2 = tileAtX(entry2X);
      const z1 = tileExtent(m1).zSouth - 0.01;
      const z2 = tileExtent(m2).zSouth - 0.01;
      entryPositions.push({ cx: entry1X, cz: z1, isPrimary: false, tile: m1 });
      entryPositions.push({ cx: entry2X, cz: z2, isPrimary: isLongest, tile: m2 });
    }
  }
  // Cart corral spread — tighter when 2 entries share a run so they
  // don't overlap.
  const wideRunCount = sRuns.filter((r) => r.length >= 2).length;
  const corralSpread = wideRunCount === 0 ? 0.30 : 0.16;

  for (const entry of entryPositions) {
    const { cx, cz, isPrimary, tile } = entry;
    // Entry vestibule (delta from front face, in unrotated coords).
    if (archetype === 'mass-merchant') {
      if (isPrimary) {
        out.push({ makeGeom: () => cyl(0.18, 0.06, 12), color: pal.brandAccent, dx: cx, dy: bodyHeight + 0.10, dz: cz - 0.05 });
        out.push({ makeGeom: () => cyl(0.10, 0.07, 12), color: pal.fascia, dx: cx, dy: bodyHeight + 0.105, dz: cz - 0.05 });
        out.push({ makeGeom: () => cyl(0.05, 0.075, 12), color: pal.brandAccent, dx: cx, dy: bodyHeight + 0.11, dz: cz - 0.05 });
      }
      out.push({ makeGeom: () => box(0.36, 0.22, 0.04), color: pal.entryGlass, dx: cx, dy: 0.14, dz: cz + 0.01 });
      out.push({ makeGeom: () => cyl(0.18, 0.04, 14), color: pal.fascia, dx: cx, dy: 0.26, dz: cz + 0.01 });
    } else if (archetype === 'membership-club') {
      out.push({ makeGeom: () => box(0.26, 0.22, 0.04), color: pal.entryGlass, dx: cx, dy: 0.14, dz: cz + 0.01 });
      out.push({ makeGeom: () => box(0.012, 0.22, 0.05), color: pal.entryFrame, dx: cx, dy: 0.14, dz: cz + 0.01 });
      // Gas-station canopy on the apron — only beside the primary
      // entry. Lives 0.50 east of the entry, on the apron in front
      // of an adjacent S-exterior tile (or the entry's own tile if
      // no eastern neighbour).
      if (isPrimary) {
        const canopyX = cx + 0.50;
        const canopyZ = tileExtent(tile).zSouth + 0.25;
        out.push({ makeGeom: () => box(0.42, 0.012, 0.18), color: pal.brandAccent, dx: canopyX, dy: 0.20, dz: canopyZ });
        for (const [px, pz] of [[-0.18, -0.06], [0.18, -0.06], [-0.18, 0.06], [0.18, 0.06]] as const) {
          out.push({ makeGeom: () => box(0.014, 0.20, 0.014), color: pal.fascia, dx: canopyX + px, dy: 0.10, dz: canopyZ + pz });
        }
        for (const px of [-0.08, 0.08]) {
          out.push({ makeGeom: () => box(0.05, 0.08, 0.03), color: pal.entryFrame, dx: canopyX + px, dy: 0.04, dz: canopyZ });
        }
      }
    } else if (archetype === 'home-improvement') {
      out.push({ makeGeom: () => box(0.40, 0.24, 0.04), color: pal.entryGlass, dx: cx, dy: 0.15, dz: cz + 0.01 });
      out.push({ makeGeom: () => box(0.012, 0.24, 0.05), color: pal.entryFrame, dx: cx, dy: 0.15, dz: cz + 0.01 });
      out.push({ makeGeom: () => box(0.46, 0.012, 0.06), color: pal.brandStripe, dx: cx, dy: 0.28, dz: cz + 0.03 });
      if (isPrimary) {
        for (let s = 0; s < 4; s++) {
          out.push({ makeGeom: () => box(0.06, 0.012, 0.22), color: 0x8b6b3a, dx: cx + 0.36, dy: 0.024 + s * 0.013, dz: cz + 0.09 });
        }
      }
    } else if (archetype === 'electronics') {
      out.push({ makeGeom: () => box(0.42, 0.22, 0.04), color: pal.entryGlass, dx: cx, dy: 0.14, dz: cz + 0.01 });
      out.push({ makeGeom: () => box(0.012, 0.22, 0.05), color: pal.entryFrame, dx: cx, dy: 0.14, dz: cz + 0.01 });
      out.push({ makeGeom: () => box(0.48, 0.025, 0.04), color: pal.brandStripe, dx: cx, dy: 0.27, dz: cz + 0.01 });
    } else {
      // warehouse-discount.
      out.push({ makeGeom: () => box(0.34, 0.22, 0.04), color: pal.entryGlass, dx: cx, dy: 0.14, dz: cz + 0.01 });
      out.push({ makeGeom: () => box(0.012, 0.22, 0.05), color: pal.entryFrame, dx: cx, dy: 0.14, dz: cz + 0.01 });
    }
    if (archetype !== 'membership-club') {
      for (const cxOff of [-corralSpread, corralSpread]) {
        out.push({ makeGeom: () => box(0.10, 0.05, 0.18), color: cartCorral, dx: cx + cxOff, dy: 0.025, dz: cz + 0.15 });
      }
    }
  }

  // 9. Home-improvement garden-centre extension.
  //
  // Beta 1.4.1 — modular. Garden display lands on the east end of
  // whichever S-exterior run is the longest, on its apron. For
  // single-tile / irregular clusters this still puts the garden at
  // the right "front-east" spot regardless of cluster shape.
  if (archetype === 'home-improvement' && sorted.length > 1 && longestRun) {
    // East-most tile of the longest run.
    const eastTile = longestRun[longestRun.length - 1]!;
    const { xEast, zSouth } = tileExtent(eastTile);
    const gardenX = xEast - 0.18;
    for (let i = 0; i < 3; i++) {
      const offX = (i - 1) * 0.10;
      out.push({ makeGeom: () => box(0.10, 0.06, 0.10), color: planterLeaf, dx: gardenX + offX, dy: 0.030, dz: zSouth + 0.22 });
      out.push({ makeGeom: () => box(0.10, 0.02, 0.10), color: planter, dx: gardenX + offX, dy: 0.013, dz: zSouth + 0.22 });
    }
    // Greenhouse-glass accent on the east-end fascia of this tile.
    const greenhouseW = Math.min(tileExtent(eastTile).w * 0.40, 0.40);
    out.push({
      makeGeom: () => box(greenhouseW, 0.22, 0.02),
      color: 0xb8d4d6,
      dx: xEast - greenhouseW / 2 - 0.06,
      dy: bodyHeight * 0.30 + 0.03,
      dz: zSouth
    });
    for (let s = 0; s < 3; s++) {
      out.push({ makeGeom: () => box(0.14, 0.012, 0.18), color: 0x8b6b3a, dx: gardenX + 0.26, dy: 0.024 + s * 0.013, dz: zSouth + 0.20 });
    }
  }

  // 10. Lamp posts — one pair per S-exterior run, with an extra middle
  // lamp on runs of length ≥ 3 so wide storefronts aren't dark in
  // the centre. Pulled slightly INSIDE the run boundary so they don't
  // float at the road/parking seam.
  for (const run of sRuns) {
    const lampInset = 0.08;
    const leftTile = run[0]!;
    const rightTile = run[run.length - 1]!;
    const leftExt = tileExtent(leftTile);
    const rightExt = tileExtent(rightTile);
    const lampZ = leftExt.zSouth + 0.10;
    const lampXs: number[] = [
      leftExt.xWest + lampInset,
      rightExt.xEast - lampInset
    ];
    if (run.length >= 3) {
      lampXs.push((leftExt.xWest + rightExt.xEast) / 2);
    }
    for (const x of lampXs) {
      out.push({ makeGeom: () => box(0.020, 0.22, 0.020), color: lampPole, dx: x, dy: 0.11, dz: lampZ });
      out.push({ makeGeom: () => box(0.06, 0.03, 0.06), color: lampHead, dx: x, dy: 0.23, dz: lampZ });
    }
  }

  // 6. Adjacent parking-lot tiles — paved + striped + decorated. The
  // decorations argument tells emitParkingTile to skip lights it's
  // already provided by big_box lamps, and to use store-adjacent
  // cluster-aware fencing (skips the edge shared with the store).
  // Emitted to parkingParts (NOT storeParts) so the post-rotation
  // pass only twists the store geometry; the parking stripes stay
  // axis-aligned, matching the world coords the Parking module hands
  // out for in-stall car placement.
  for (const key of adjacentParking) {
    const [sxStr, syStr] = key.split(',');
    const sx = parseInt(sxStr!, 10), sy = parseInt(syStr!, 10);
    emitParkingTile(parkingParts, sx, sy, {
      asphalt, stripeWhite, stripeYellow, stripeBlue,
      lampPole, lampHead, fenceCol, fencePost, planter, planterLeaf, cartCorral
    }, grid, /* attachedToBigBox */ true);
  }

  // 7. Beta 1.3.6 — rotate the store geometry so the storefront faces
  // whichever cardinal the absorbed parking lot (or nearest road)
  // sits on. Yaw is snapped to 0 / π/2 / π / 3π/2 because the painted
  // building geometry is axis-aligned boxes — fractional rotations
  // look weird at this zoom.
  //
  // Beta 1.3.8 — the position rotation formula was using the
  // STANDARD 2D rotation matrix, but Three.js's rotateY uses the
  // OPPOSITE sign convention (CCW vs CW depending on which axis
  // you're looking down). The geometry was rotating correctly via
  // BufferGeometry.rotateY(yaw), but the (dx, dz) offsets were
  // ending up on the wrong side of the pivot. For 1-tile clusters
  // the misplacement was within the same tile (~0.20 off) and
  // tolerated; for 2x2+ the misplacement scaled with offset distance
  // (~0.71-1.0) — lamps landed at the WEST edge when parking was
  // EAST, entry was on the wrong wall, etc. Fix: match Three.js's
  // rotateY convention: new_x = x·cos + z·sin, new_z = -x·sin + z·cos.
  const { yaw, cx: pivotX, cz: pivotZ } = computeBigBoxFrontYaw(sorted, adjacentParking, grid);
  if (yaw !== 0) {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const p of storeParts) {
      // Rotate (dx, dz) around (pivotX, pivotZ) using Three.js's
      // rotateY convention so the offsets follow the geometry.
      const odx = p.dx - pivotX;
      const odz = p.dz - pivotZ;
      p.dx = pivotX + odx * cos + odz * sin;
      p.dz = pivotZ - odx * sin + odz * cos;
      // Pre-rotate the geometry itself by wrapping makeGeom. Since the
      // box geoms are built at origin, rotateY(yaw) reorients them
      // around their own centre — combined with the (dx, dz)
      // rotation above, the whole composition turns as a rigid body.
      const orig = p.makeGeom;
      p.makeGeom = () => {
        const g = orig();
        g.rotateY(yaw);
        return g;
      };
    }
  }

  // Concat: store geometry first (rotated), parking lots second (axis-aligned).
  return storeParts.concat(parkingParts);
}

/**
 * Determine which cardinal direction a big_box cluster's storefront
 * should face (Beta 1.3.6). Returns a yaw value snapped to one of
 * 0 / π/2 / π / -π/2 (south / east / north / west) and the world-
 * space pivot to rotate around.
 *
 * Priority:
 *  1. If any parking_lot is 4-adjacent to the cluster, face the
 *     centroid of those parking lots.
 *  2. Otherwise, face the first road tile 4-adjacent to any cluster
 *     tile.
 *  3. Otherwise, default to south (yaw = 0) — the original baked
 *     orientation of every box in `bigBoxClusterParts`.
 *
 * Snapping rule (cardinalYaw): the bigger axis of the (dx, dy)
 * offset wins. The yaw rotates the un-rotated +Z-facing geometry to
 * line up with the chosen cardinal:
 *   +Z (south, dy > 0): yaw = 0
 *   +X (east,  dx > 0): yaw = +π/2
 *   -Z (north, dy < 0): yaw = π
 *   -X (west,  dx < 0): yaw = -π/2
 */
function computeBigBoxFrontYaw(
  sorted: Array<{ x: number; y: number }>,
  adjacentParking: Set<string>,
  grid: Grid
): { yaw: number; cx: number; cz: number } {
  // Cluster centroid (tile coords).
  let cxSum = 0, cySum = 0;
  for (const c of sorted) { cxSum += c.x; cySum += c.y; }
  const ccx = cxSum / sorted.length;
  const ccy = cySum / sorted.length;
  const pivotX = (ccx + 0.5) * TILE_SIZE;
  const pivotZ = (ccy + 0.5) * TILE_SIZE;

  if (adjacentParking.size > 0) {
    let pxSum = 0, pySum = 0;
    for (const key of adjacentParking) {
      const parts = key.split(',');
      pxSum += parseInt(parts[0]!, 10);
      pySum += parseInt(parts[1]!, 10);
    }
    const pcx = pxSum / adjacentParking.size;
    const pcy = pySum / adjacentParking.size;
    return { yaw: cardinalYaw(pcx - ccx, pcy - ccy), cx: pivotX, cz: pivotZ };
  }
  // No parking → use road adjacency.
  for (const c of sorted) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nt = grid.get(c.x + dx, c.y + dy);
      if (nt && nt.road) {
        return { yaw: cardinalYaw(dx, dy), cx: pivotX, cz: pivotZ };
      }
    }
  }
  // Default — face south, same as the un-rotated geometry.
  return { yaw: 0, cx: pivotX, cz: pivotZ };
}

function cardinalYaw(dx: number, dy: number): number {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  return dy > 0 ? 0 : Math.PI;
}

/* ---- Warehouse (Beta 1.6) ----------------------------------------- *
 * Fully-modular warehouse cluster — same per-tile exterior-side
 * detection as bigBoxClusterParts so any shape (1xN, 2x2, L, T, U,
 * plus, etc) emits ONE cohesive freight building. Visual signature:
 *
 *   - Long flat warehouse body, slightly taller than a big_box
 *     (warehouses are tall to fit pallet racks).
 *   - Repeating row of LOADING-DOCK doors along the front (south)
 *     face — one per cluster front tile.
 *   - Subtle roof vents (cylindrical exhaust stacks) and a single
 *     skylight strip along the centre.
 *   - Painted brand-stripe in industrial-grey + safety-yellow.
 *   - Optional rooftop sign on the largest cluster tile.
 *
 * Colour palette is neutral / industrial (greys + safety-yellow
 * accents), distinct from big_box's retail-brand palette.
 * --------------------------------------------------------------------- */
function warehouseClusterParts(
  cluster: Array<{ x: number; y: number }>,
  _grid: Grid
): CityBuildingPart[] {
  if (cluster.length === 0) return [];
  const out: CityBuildingPart[] = [];

  // Industrial / freight palette.
  const wallLight = 0xbab8b2;        // pale industrial concrete
  const wallDark = 0x6c6a64;          // dock-band / cladding accent
  const roof = 0x3a3a38;              // dark tar/rubber roof
  const roofVent = 0x4a4f56;          // exhaust stack
  const safety = 0xf2c648;            // safety yellow accent stripe
  const dockDoor = 0x2e3036;          // dark loading-dock door
  const skylight = 0xb8d4d6;          // pale blue-glass skylight strip
  const apron = 0x2e2f33;             // asphalt (matches parking)
  const lampPole = 0x2c2d31;
  const lampHead = 0xfff2c8;

  const sorted = cluster.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const minX = sorted.reduce((m, c) => Math.min(m, c.x), sorted[0]!.x);
  const maxX = sorted.reduce((m, c) => Math.max(m, c.x), sorted[0]!.x);
  const minY = sorted.reduce((m, c) => Math.min(m, c.y), sorted[0]!.y);
  const maxY = sorted.reduce((m, c) => Math.max(m, c.y), sorted[0]!.y);
  const widthTiles = maxX - minX + 1;
  const depthTiles = maxY - minY + 1;
  const clusterSet = new Set(sorted.map((c) => c.x + ',' + c.y));
  const inCluster = (x: number, y: number) => clusterSet.has(x + ',' + y);

  type Meta = { x: number; y: number; N: boolean; E: boolean; S: boolean; W: boolean };
  const tileMeta: Meta[] = sorted.map((c) => ({
    x: c.x, y: c.y,
    N: !inCluster(c.x, c.y - 1),
    E: !inCluster(c.x + 1, c.y),
    S: !inCluster(c.x, c.y + 1),
    W: !inCluster(c.x - 1, c.y)
  }));

  // Warehouse body is slightly taller than big_box (pallet rack
  // heights need ~10m clearance in real life); height scales with
  // footprint like big_box.
  const sizeBonus = Math.min(0.20, Math.max(0, Math.min(widthTiles, depthTiles) - 1) * 0.06);
  const bodyHeight = 0.40 + sizeBonus;

  const SIDE_INSET = 0.04;
  const BACK_INSET = 0.10;
  const FRONT_INSET = 0.28;
  const extent = (m: Meta) => {
    const iN = m.N ? BACK_INSET : 0;
    const iS = m.S ? FRONT_INSET : 0;
    const iE = m.E ? SIDE_INSET : 0;
    const iW = m.W ? SIDE_INSET : 0;
    const w = TILE_SIZE - iE - iW;
    const d = TILE_SIZE - iN - iS;
    const cx = (m.x + 0.5) * TILE_SIZE + (iW - iE) / 2;
    const cz = (m.y + 0.5) * TILE_SIZE + (iN - iS) / 2;
    return { w, d, cx, cz, xWest: cx - w / 2, xEast: cx + w / 2, zNorth: cz - d / 2, zSouth: cz + d / 2 };
  };

  // 1. Asphalt apron under cluster — like big_box, matches parking
  // surface so adjacent parking_lot tiles blend in.
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => box(1.02, 0.018, 1.02), color: apron, dx: cx, dy: 0.009, dz: cz });
  }

  // 2. Per-tile body slab.
  for (const m of tileMeta) {
    const { w, d, cx, cz } = extent(m);
    if (w <= 0 || d <= 0) continue;
    out.push({
      makeGeom: () => box(w, bodyHeight, d),
      color: wallLight,
      dx: cx, dy: bodyHeight / 2 + 0.03, dz: cz
    });
  }

  // 2a. Inner-corner filler at NORTH-side notches (same idea as
  // bigBoxClusterParts — fills the small gap where two perpendicular
  // SIDE_INSET walls meet at an inner corner).
  for (let gy = minY; gy <= maxY + 1; gy++) {
    for (let gx = minX; gx <= maxX + 1; gx++) {
      const tl = inCluster(gx - 1, gy - 1);
      const tr = inCluster(gx, gy - 1);
      const bl = inCluster(gx - 1, gy);
      const br = inCluster(gx, gy);
      const cnt = (tl ? 1 : 0) + (tr ? 1 : 0) + (bl ? 1 : 0) + (br ? 1 : 0);
      if (cnt !== 3) continue;
      if (!tl) {
        out.push({
          makeGeom: () => box(SIDE_INSET, bodyHeight, BACK_INSET),
          color: wallLight,
          dx: gx + SIDE_INSET / 2, dy: bodyHeight / 2 + 0.03, dz: gy + BACK_INSET / 2
        });
      } else if (!tr) {
        out.push({
          makeGeom: () => box(SIDE_INSET, bodyHeight, BACK_INSET),
          color: wallLight,
          dx: gx - SIDE_INSET / 2, dy: bodyHeight / 2 + 0.03, dz: gy + BACK_INSET / 2
        });
      }
    }
  }

  // 3. Roof per-tile with small overhang on exterior sides.
  for (const m of tileMeta) {
    const { w, d, cx, cz } = extent(m);
    if (w <= 0 || d <= 0) continue;
    const ovE = m.E ? 0.01 : 0;
    const ovW = m.W ? 0.01 : 0;
    const ovN = m.N ? 0.01 : 0;
    const ovS = m.S ? 0.01 : 0;
    out.push({
      makeGeom: () => box(w + ovE + ovW, 0.02, d + ovN + ovS),
      color: roof,
      dx: cx + (ovE - ovW) / 2, dy: bodyHeight + 0.04, dz: cz + (ovS - ovN) / 2
    });
  }

  // 4. Loading-dock band on every S-exterior tile — multiple visible
  // dock doors painted on the front face (this is the warehouse's
  // signature visual).
  for (const m of tileMeta) {
    if (!m.S) continue;
    const { w, cx, zSouth } = extent(m);
    // Concrete dock band along the full tile front.
    out.push({
      makeGeom: () => box(w, 0.12, 0.05),
      color: wallDark,
      dx: cx, dy: 0.06, dz: zSouth - 0.025
    });
    // Three loading-dock doors per S-exterior tile, evenly spaced.
    const doorCount = 3;
    const doorSpacing = w / (doorCount + 1);
    for (let i = 1; i <= doorCount; i++) {
      const dx = cx - w / 2 + i * doorSpacing;
      out.push({
        makeGeom: () => box(0.16, 0.18, 0.03),
        color: dockDoor,
        dx, dy: 0.09, dz: zSouth - 0.01
      });
      // Painted dock-number bar above each door (yellow safety stripe).
      out.push({
        makeGeom: () => box(0.18, 0.018, 0.02),
        color: safety,
        dx, dy: 0.195, dz: zSouth - 0.01
      });
    }
  }

  // 5. Parapet + brand stripe along the front, plus corner pilasters.
  for (const m of tileMeta) {
    if (!m.S) continue;
    const { w, cx, zSouth } = extent(m);
    // Parapet (top of wall) in the lighter wall colour.
    out.push({
      makeGeom: () => box(w, 0.06, 0.04),
      color: wallLight,
      dx: cx, dy: bodyHeight + 0.06, dz: zSouth - 0.02
    });
    // Safety-yellow brand stripe near the top.
    out.push({
      makeGeom: () => box(w, 0.020, 0.025),
      color: safety,
      dx: cx, dy: bodyHeight + 0.02, dz: zSouth - 0.025
    });
    // Corner pilasters (thicker on true cluster outer corners).
    const westThick = m.W;
    const eastThick = m.E;
    out.push({
      makeGeom: () => box(westThick ? 0.06 : 0.035, bodyHeight + (westThick ? 0.04 : 0), westThick ? 0.06 : 0.035),
      color: wallDark,
      dx: cx - w / 2 + (westThick ? 0.03 : 0.018),
      dy: bodyHeight / 2 + (westThick ? 0.05 : 0.03),
      dz: zSouth - 0.025
    });
    out.push({
      makeGeom: () => box(eastThick ? 0.06 : 0.035, bodyHeight + (eastThick ? 0.04 : 0), eastThick ? 0.06 : 0.035),
      color: wallDark,
      dx: cx + w / 2 - (eastThick ? 0.03 : 0.018),
      dy: bodyHeight / 2 + (eastThick ? 0.05 : 0.03),
      dz: zSouth - 0.025
    });
  }

  // 6. Back-side loading-dock band (less prominent — for over-the-road
  // delivery if needed).
  for (const m of tileMeta) {
    if (!m.N) continue;
    const { w, cx, zNorth } = extent(m);
    out.push({
      makeGeom: () => box(w, 0.10, 0.06),
      color: wallDark,
      dx: cx, dy: 0.05, dz: zNorth + 0.03
    });
  }

  // 7. Skylight strip — one per tile, lengthwise down the centre.
  for (const m of tileMeta) {
    const { w, d, cx, cz } = extent(m);
    if (w <= 0 || d <= 0) continue;
    out.push({
      makeGeom: () => box(w * 0.5, 0.012, d * 0.55),
      color: skylight,
      dx: cx, dy: bodyHeight + 0.055, dz: cz
    });
  }

  // 8. Rooftop vents — cylindrical exhaust stacks (1-2 per tile).
  for (const c of sorted) {
    const tileX = (c.x + 0.5) * TILE_SIZE;
    const tileZ = (c.y + 0.5) * TILE_SIZE;
    const h = ((c.x * 374761393) ^ (c.y * 668265263)) >>> 0;
    const count = ((h >> 2) % 2) + 1;
    for (let i = 0; i < count; i++) {
      const ox = (((h >> (i * 5)) & 0xff) / 255 - 0.5) * 0.50;
      const oz = (((h >> (i * 5 + 4)) & 0xff) / 255 - 0.5) * 0.40;
      const r = 0.04 + (((h >> (i * 3 + 12)) & 0x07) / 7) * 0.025;
      const hh = 0.06 + (((h >> (i * 3 + 16)) & 0x07) / 7) * 0.04;
      out.push({
        makeGeom: () => cyl(r, hh, 10),
        color: roofVent,
        dx: tileX + ox, dy: bodyHeight + 0.04 + hh / 2, dz: tileZ + oz
      });
    }
  }

  // 9. Front lamps at each S-exterior run's corners (per-run, matches
  // big_box lamp placement convention).
  const sExtTiles = tileMeta.filter((m) => m.S).sort((a, b) => a.y - b.y || a.x - b.x);
  const sRuns: Meta[][] = [];
  for (const m of sExtTiles) {
    const lastRun = sRuns[sRuns.length - 1];
    if (lastRun && lastRun[lastRun.length - 1]!.y === m.y &&
        lastRun[lastRun.length - 1]!.x === m.x - 1) {
      lastRun.push(m);
    } else {
      sRuns.push([m]);
    }
  }
  for (const run of sRuns) {
    const lampInset = 0.08;
    const leftExt = extent(run[0]!);
    const rightExt = extent(run[run.length - 1]!);
    const lampZ = leftExt.zSouth + 0.10;
    const lampXs: number[] = [
      leftExt.xWest + lampInset,
      rightExt.xEast - lampInset
    ];
    if (run.length >= 3) {
      lampXs.push((leftExt.xWest + rightExt.xEast) / 2);
    }
    for (const x of lampXs) {
      out.push({ makeGeom: () => box(0.020, 0.22, 0.020), color: lampPole, dx: x, dy: 0.11, dz: lampZ });
      out.push({ makeGeom: () => box(0.06, 0.03, 0.06), color: lampHead, dx: x, dy: 0.23, dz: lampZ });
    }
  }

  return out;
}

/** Standalone parking-lot tile builder. Same paving + striping as the
 *  parking lots absorbed into a big_box cluster, but with full
 *  perimeter fencing because there's no store wall to merge against. */
function parkingLotParts(
  cluster: Array<{ x: number; y: number }>,
  grid: Grid
): CityBuildingPart[] {
  if (cluster.length === 0) return [];
  const out: CityBuildingPart[] = [];
  const opts = {
    asphalt: 0x2e2f33,
    stripeWhite: 0xefe7d2,
    stripeYellow: 0xf2c648,
    stripeBlue: 0x2a5fb8,
    lampPole: 0x2c2d31,
    lampHead: 0xfff2c8,
    fenceCol: 0xb6ad9b,
    fencePost: 0x6e6a64,
    planter: 0x6e4622,
    planterLeaf: 0x4a6b3a,
    cartCorral: 0xa9a297
  };
  for (const c of cluster) {
    emitParkingTile(out, c.x, c.y, opts, grid, /* attachedToBigBox */ false);
  }
  return out;
}

interface ParkingTileOpts {
  asphalt: number;
  stripeWhite: number;
  stripeYellow: number;
  stripeBlue: number;     // accessible-stall paint
  lampPole: number;
  lampHead: number;
  fenceCol: number;
  fencePost: number;
  planter: number;
  planterLeaf: number;
  cartCorral: number;
}

/** Shared per-tile paving + stall + decoration geometry. Called by
 *  the big_box cluster builder (for adjacent parking tiles, with
 *  `attachedToBigBox = true`) and by `parkingLotParts` (standalone,
 *  `attachedToBigBox = false`).
 *
 *  Emits:
 *  - Asphalt pad
 *  - Centre median yellow line
 *  - Two rows of 3 stall stripes (6 stalls total)
 *  - 1 ACCESSIBLE stall painted blue on the front row
 *  - Crosswalk stripes painted across the median (only between rows)
 *  - Corner lamp pole (geometric only; the GLOW is registered in
 *    buildLampGlowMesh per-tile)
 *  - Perimeter chain-link fence on edges that aren't adjacent to a
 *    big_box, road, sidewalk, or another parking_lot — only "raw"
 *    grass / sand edges get fenced
 *  - Cart corral at one corner
 *  - Small terracotta planters between stall rows on standalone lots
 */
function emitParkingTile(
  out: CityBuildingPart[],
  tileX: number, tileY: number,
  opts: ParkingTileOpts,
  grid: Grid,
  attachedToBigBox: boolean
): void {
  const cx = (tileX + 0.5) * TILE_SIZE;
  const cz = (tileY + 0.5) * TILE_SIZE;
  // 1. Asphalt pad.
  out.push({ makeGeom: () => box(1.02, 0.018, 1.02), color: opts.asphalt, dx: cx, dy: 0.009, dz: cz });
  // 2. Faded yellow centre median.
  out.push({ makeGeom: () => box(0.86, 0.005, 0.03), color: opts.stripeYellow, dx: cx, dy: 0.020, dz: cz });
  // 3. Two rows of stall stripes — 6 stalls per tile. The LEFTMOST
  // stall of the FRONT row (positive Z, x = -0.36) gets the
  // accessible blue paint instead of white.
  for (const rowZ of [-0.30, 0.30]) {
    for (const stallX of [-0.30, 0.00, 0.30]) {
      out.push({
        makeGeom: () => box(0.022, 0.005, 0.24),
        color: opts.stripeWhite, dx: cx + stallX, dy: 0.021, dz: cz + rowZ
      });
    }
    // Outer-edge stripes on both sides for row completion.
    out.push({
      makeGeom: () => box(0.022, 0.005, 0.24),
      color: opts.stripeWhite, dx: cx + 0.42, dy: 0.021, dz: cz + rowZ
    });
    out.push({
      makeGeom: () => box(0.022, 0.005, 0.24),
      color: opts.stripeWhite, dx: cx - 0.42, dy: 0.021, dz: cz + rowZ
    });
  }
  // 3b. Accessibility paint — fill the front-row leftmost stall floor
  // with blue. Sits between the -0.42 outer stripe and the -0.30
  // divider, so x centre ≈ -0.36, width 0.10.
  out.push({
    makeGeom: () => box(0.10, 0.005, 0.20),
    color: opts.stripeBlue, dx: cx - 0.36, dy: 0.022, dz: cz + 0.30
  });
  // White accessibility-symbol dot in the centre of the blue stall.
  out.push({
    makeGeom: () => cyl(0.022, 0.006, 8),
    color: opts.stripeWhite, dx: cx - 0.36, dy: 0.025, dz: cz + 0.30
  });
  // 3c. Crosswalk stripes between the two rows — six short rectangles
  // running parallel to the median, just inside the row openings. Read
  // as the painted pedestrian crossing where shoppers walk from their
  // car toward the store.
  for (let i = 0; i < 6; i++) {
    const cwx = cx - 0.35 + i * 0.14;
    out.push({
      makeGeom: () => box(0.10, 0.005, 0.025),
      color: opts.stripeWhite, dx: cwx, dy: 0.022, dz: cz
    });
  }
  // 4. Corner lamp pole (geometric anchor — glow registered separately
  // in buildLampGlowMesh / buildNightLightsMesh).
  out.push({ makeGeom: () => box(0.020, 0.20, 0.020), color: opts.lampPole, dx: cx + 0.42, dy: 0.10, dz: cz + 0.42 });
  out.push({ makeGeom: () => box(0.06, 0.03, 0.06), color: opts.lampHead, dx: cx + 0.42, dy: 0.21, dz: cz + 0.42 });
  // 5. Cart corral — small rail at the far-front-LEFT corner. Skipped
  // for big_box-attached lots that already have corrals at the store
  // entry.
  if (!attachedToBigBox) {
    out.push({ makeGeom: () => box(0.10, 0.05, 0.18), color: opts.cartCorral, dx: cx - 0.34, dy: 0.025, dz: cz + 0.36 });
  }
  // 6. Perimeter chain-link fence. Skip edges that are adjacent to a
  // big_box, road, sidewalk (path), or another parking_lot — fence
  // those would be silly. Standalone lot in a grass field gets a full
  // 4-side perimeter fence. The fence is a thin grey rail + a few
  // post stubs per side.
  const edges: Array<{ dx: number; dy: number; cap: 'x' | 'z' }> = [
    { dx: 0, dy: -1, cap: 'x' }, // north edge — runs along x axis
    { dx: 1, dy: 0, cap: 'z' },  // east edge — runs along z axis
    { dx: 0, dy: 1, cap: 'x' },  // south edge
    { dx: -1, dy: 0, cap: 'z' }  // west edge
  ];
  for (const e of edges) {
    const neighbour = grid.get(tileX + e.dx, tileY + e.dy);
    if (!neighbour) continue;
    // Skip fence on edges shared with infrastructure that already
    // bounds the lot visually.
    if (
      neighbour.road ||
      neighbour.path ||
      neighbour.building === 'big_box' ||
      neighbour.building === 'parking_lot'
    ) continue;
    // Edge centre (just inside the tile boundary by 0.02 to avoid
    // z-fighting with the asphalt edge).
    const ecx = cx + e.dx * 0.49;
    const ecz = cz + e.dy * 0.49;
    const rail1W = e.cap === 'x' ? 0.92 : 0.020;
    const rail1D = e.cap === 'x' ? 0.020 : 0.92;
    // Two horizontal rails at y = 0.07 and y = 0.13.
    for (const railY of [0.07, 0.13]) {
      out.push({
        makeGeom: () => box(rail1W, 0.012, rail1D),
        color: opts.fenceCol, dx: ecx, dy: railY, dz: ecz
      });
    }
    // 3 fence posts along the edge.
    const postStops = [-0.40, 0.0, 0.40];
    for (const stop of postStops) {
      const px = e.cap === 'x' ? ecx + stop : ecx;
      const pz = e.cap === 'x' ? ecz : ecz + stop;
      out.push({
        makeGeom: () => box(0.025, 0.16, 0.025),
        color: opts.fencePost, dx: px, dy: 0.08, dz: pz
      });
    }
  }
  // 7. Two terracotta planters between stall row ends — only on
  // standalone lots (big_box-attached lots have store walls + lamp
  // halos for visual relief already).
  if (!attachedToBigBox) {
    for (const px of [-0.45, 0.45]) {
      out.push({ makeGeom: () => box(0.10, 0.05, 0.10), color: opts.planter, dx: cx + px, dy: 0.025, dz: cz });
      out.push({ makeGeom: () => sphereLite(0.07), color: opts.planterLeaf, dx: cx + px, dy: 0.080, dz: cz });
    }
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const c = Math.round(ab + (bb - ab) * u);
  return (r << 16) | (g << 8) | c;
}

interface CityBuildingPart {
  makeGeom: () => BufferGeometry;
  color: number;
  dx: number;
  dy: number;
  dz: number;
}

function cityBuildingParts(b: string): CityBuildingPart[] {
  switch (b) {
    case 'power_plant':
      // Polished power plant (Alpha 2.2) — main hall, hyperboloid-ish
      // cooling tower (cylinder narrowing to a smaller top), exhaust
      // stack with red cap, plus a vapour puff above the cooling tower.
      return [
        // Main hall.
        { makeGeom: () => box(0.65, 0.45, 0.55), color: 0x484848, dx: 0, dy: 0.225, dz: 0 },
        // Roof banding to break up the slab.
        { makeGeom: () => box(0.66, 0.04, 0.56), color: 0x2e2e2e, dx: 0, dy: 0.46, dz: 0 },
        // Cooling tower base (wide cylinder).
        { makeGeom: () => cyl(0.18, 0.25, 12), color: 0x9a9a9a, dx: -0.20, dy: 0.125, dz: 0.18 },
        // Cooling tower waist (narrower).
        { makeGeom: () => cyl(0.13, 0.45, 12), color: 0xb0b0b0, dx: -0.20, dy: 0.25 + 0.225, dz: 0.18 },
        // Cooling tower lip.
        { makeGeom: () => cyl(0.16, 0.04, 12), color: 0x808080, dx: -0.20, dy: 0.25 + 0.45 + 0.02, dz: 0.18 },
        // Vapour puff above the cooling tower.
        { makeGeom: () => sphereLite(0.18), color: 0xe0e6ec, dx: -0.20, dy: 0.25 + 0.45 + 0.20, dz: 0.18 },
        // Exhaust stack on the hall roof.
        { makeGeom: () => cyl(0.08, 0.55, 8), color: 0x6e6e6e, dx: 0.20, dy: 0.45 + 0.275, dz: -0.10 },
        // Stack red top band.
        { makeGeom: () => cyl(0.085, 0.06, 8), color: 0xb14a4a, dx: 0.20, dy: 0.45 + 0.55 + 0.03, dz: -0.10 }
      ];
    case 'water_tower':
      // Polished water tower (Alpha 2.2) — cross-braced legs, ladder
      // strip up one side, dome top, drain pipe.
      return [
        // Four corner legs.
        { makeGeom: () => box(0.07, 0.55, 0.07), color: 0x2f3f4a, dx: -0.18, dy: 0.275, dz: -0.18 },
        { makeGeom: () => box(0.07, 0.55, 0.07), color: 0x2f3f4a, dx:  0.18, dy: 0.275, dz: -0.18 },
        { makeGeom: () => box(0.07, 0.55, 0.07), color: 0x2f3f4a, dx: -0.18, dy: 0.275, dz:  0.18 },
        { makeGeom: () => box(0.07, 0.55, 0.07), color: 0x2f3f4a, dx:  0.18, dy: 0.275, dz:  0.18 },
        // Cross-braces (X pattern on the south face).
        { makeGeom: () => box(0.42, 0.022, 0.022), color: 0x222a32, dx: 0, dy: 0.32, dz: -0.18 },
        { makeGeom: () => box(0.42, 0.022, 0.022), color: 0x222a32, dx: 0, dy: 0.20, dz:  0.18 },
        // Tank — fatter cylinder.
        { makeGeom: () => cyl(0.32, 0.40, 12), color: 0x4d8eb9, dx: 0, dy: 0.55 + 0.20, dz: 0 },
        // Cap dome (cone) on top.
        { makeGeom: () => cone(0.32, 0.14, 12), color: 0x3e7aa0, dx: 0, dy: 0.55 + 0.40 + 0.07, dz: 0 },
        // Drain pipe down one leg to the ground.
        { makeGeom: () => cyl(0.018, 0.55, 6), color: 0x707880, dx: 0.20, dy: 0.275, dz: 0 }
      ];
    case 'park':
      // Polished park (Alpha 2.1) — green pad, central pond, two
      // benches flanking a paved path, and three trees in different
      // sizes for visual variety. Reads as a real city park rather
      // than a single tree on a green dot.
      return [
        // Lawn pad.
        { makeGeom: () => box(0.85, 0.04, 0.85), color: 0x4a8c3a, dx: 0, dy: 0.02, dz: 0 },
        // Diagonal stone path strip.
        { makeGeom: () => box(0.18, 0.05, 0.85), color: 0xc7c2b3, dx: 0, dy: 0.025, dz: 0 },
        // Round pond.
        { makeGeom: () => cyl(0.18, 0.06, 12), color: 0x4d8eb9, dx: -0.20, dy: 0.025, dz: -0.18 },
        // Bench 1 — slats + 2 legs.
        { makeGeom: () => box(0.18, 0.025, 0.04), color: 0x6b4f3a, dx: 0.22, dy: 0.07, dz: 0.18 },
        { makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: 0.30, dy: 0.045, dz: 0.18 },
        { makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: 0.14, dy: 0.045, dz: 0.18 },
        // Bench 2 — opposite side.
        { makeGeom: () => box(0.18, 0.025, 0.04), color: 0x6b4f3a, dx: -0.22, dy: 0.07, dz: 0.18 },
        { makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: -0.14, dy: 0.045, dz: 0.18 },
        { makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: -0.30, dy: 0.045, dz: 0.18 },
        // Tree A — large central-back.
        { makeGeom: () => cyl(0.04, 0.16, 6), color: 0x6b3f1f, dx: 0.22, dy: 0.11, dz: -0.22 },
        { makeGeom: () => cone(0.20, 0.34, 8), color: 0x2f6a2d, dx: 0.22, dy: 0.36, dz: -0.22 },
        // Tree B — medium left.
        { makeGeom: () => cyl(0.035, 0.13, 6), color: 0x6b3f1f, dx: -0.32, dy: 0.095, dz: -0.05 },
        { makeGeom: () => cone(0.16, 0.26, 8), color: 0x3a7a3a, dx: -0.32, dy: 0.30, dz: -0.05 },
        // Tree C — small right.
        { makeGeom: () => cyl(0.028, 0.10, 6), color: 0x6b3f1f, dx: 0.32, dy: 0.08, dz: 0.05 },
        { makeGeom: () => cone(0.13, 0.20, 8), color: 0x4a8e44, dx: 0.32, dy: 0.25, dz: 0.05 }
      ];
    case 'school': {
      // Brick schoolhouse + clock tower + flagpole. Reads as a small
      // K-8 building. Cream stucco walls, terracotta roof.
      return [
        // Lawn pad.
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0x4a8c3a, dx: 0, dy: 0.013, dz: 0 },
        // Main wing.
        { makeGeom: () => box(0.78, 0.36, 0.46), color: 0xd6c9a8, dx: 0, dy: 0.18, dz: -0.02 },
        // Hipped roof.
        { makeGeom: () => cone(0.50, 0.18, 4), color: 0x8a3d2a, dx: 0, dy: 0.36 + 0.09, dz: -0.02 },
        // Clock tower.
        { makeGeom: () => box(0.18, 0.40, 0.18), color: 0xc7b08a, dx: 0.24, dy: 0.20, dz: 0.18 },
        { makeGeom: () => cyl(0.10, 0.04, 12), color: 0xe6d8b8, dx: 0.24, dy: 0.42, dz: 0.18 },
        { makeGeom: () => cone(0.13, 0.16, 6), color: 0x6a3422, dx: 0.24, dy: 0.50, dz: 0.18 },
        // Flagpole + flag.
        { makeGeom: () => cyl(0.012, 0.55, 5), color: 0x9c9c9c, dx: -0.30, dy: 0.275, dz: 0.30 },
        { makeGeom: () => box(0.10, 0.07, 0.012), color: 0xb14a3a, dx: -0.30 + 0.05, dy: 0.50, dz: 0.30 },
        // Door.
        { makeGeom: () => box(0.10, 0.18, 0.018), color: 0x4a3a18, dx: 0, dy: 0.09, dz: -0.02 + 0.23 + 0.009 },
        // Window strip on the front face.
        { makeGeom: () => box(0.50, 0.06, 0.018), color: 0x2a3a4a, dx: 0, dy: 0.22, dz: -0.02 + 0.23 + 0.009 }
      ];
    }
    case 'hospital': {
      // White building, red cross sign, ambulance bay.
      return [
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0xc8c4be, dx: 0, dy: 0.013, dz: 0 },
        // Main tower (taller).
        { makeGeom: () => box(0.62, 0.62, 0.50), color: 0xeae3d0, dx: 0, dy: 0.31, dz: -0.06 },
        // Top trim.
        { makeGeom: () => box(0.64, 0.04, 0.52), color: 0xc7c2b3, dx: 0, dy: 0.62 + 0.02, dz: -0.06 },
        // Red cross sign — vertical + horizontal bars on the front face.
        { makeGeom: () => box(0.06, 0.18, 0.018), color: 0xb14a3a, dx: 0, dy: 0.42, dz: -0.06 + 0.25 + 0.009 },
        { makeGeom: () => box(0.18, 0.06, 0.018), color: 0xb14a3a, dx: 0, dy: 0.42, dz: -0.06 + 0.25 + 0.009 },
        // Ambulance bay (lower wing).
        { makeGeom: () => box(0.40, 0.22, 0.32), color: 0xc7c2b3, dx: 0.30, dy: 0.11, dz: 0.20 },
        { makeGeom: () => box(0.40, 0.025, 0.32), color: 0x4a4a44, dx: 0.30, dy: 0.22 + 0.013, dz: 0.20 },
        { makeGeom: () => box(0.30, 0.16, 0.018), color: 0x3a3a3a, dx: 0.30, dy: 0.08, dz: 0.20 + 0.16 + 0.009 },
        // Window grid suggestion.
        { makeGeom: () => box(0.50, 0.08, 0.018), color: 0x6a8eb0, dx: 0, dy: 0.20, dz: -0.06 + 0.25 + 0.010 },
        { makeGeom: () => box(0.50, 0.08, 0.018), color: 0x6a8eb0, dx: 0, dy: 0.55, dz: -0.06 + 0.25 + 0.010 }
      ];
    }
    case 'fire_station': {
      // Red brick station with a tall hose-drying tower + ladder + sign.
      return [
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0x6a6a6a, dx: 0, dy: 0.013, dz: 0 },
        // Main hall.
        { makeGeom: () => box(0.72, 0.40, 0.52), color: 0xb14a3a, dx: 0, dy: 0.20, dz: -0.04 },
        // White trim band.
        { makeGeom: () => box(0.74, 0.04, 0.54), color: 0xeae3d0, dx: 0, dy: 0.40 + 0.02, dz: -0.04 },
        // Hose-drying tower.
        { makeGeom: () => box(0.22, 0.62, 0.22), color: 0x9c4030, dx: 0.22, dy: 0.31, dz: 0.18 },
        { makeGeom: () => cone(0.18, 0.10, 4), color: 0x4a3a2a, dx: 0.22, dy: 0.62 + 0.05, dz: 0.18 },
        // Bay door.
        { makeGeom: () => box(0.40, 0.32, 0.018), color: 0x2a2a2a, dx: -0.10, dy: 0.16, dz: -0.04 + 0.26 + 0.009 },
        // White cross-bar on the bay door.
        { makeGeom: () => box(0.40, 0.022, 0.020), color: 0xeae3d0, dx: -0.10, dy: 0.16, dz: -0.04 + 0.26 + 0.018 },
        // Sign panel above the bay.
        { makeGeom: () => box(0.40, 0.07, 0.018), color: 0xeae3d0, dx: -0.10, dy: 0.34, dz: -0.04 + 0.26 + 0.012 }
      ];
    }
    case 'police_station': {
      // Stone-grey precinct with blue lights + a small porch.
      return [
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0x6a6a6a, dx: 0, dy: 0.013, dz: 0 },
        // Main building.
        { makeGeom: () => box(0.72, 0.40, 0.52), color: 0x4a5a6a, dx: 0, dy: 0.20, dz: -0.04 },
        // Trim band.
        { makeGeom: () => box(0.74, 0.04, 0.54), color: 0x2a3a4a, dx: 0, dy: 0.40 + 0.02, dz: -0.04 },
        // Roof.
        { makeGeom: () => box(0.72, 0.05, 0.52), color: 0x2a2a2a, dx: 0, dy: 0.40 + 0.07, dz: -0.04 },
        // Porch.
        { makeGeom: () => box(0.36, 0.04, 0.18), color: 0x3a3a3a, dx: 0, dy: 0.04, dz: 0.30 },
        // Two columns on the porch.
        { makeGeom: () => box(0.04, 0.20, 0.04), color: 0xc8c4be, dx: -0.14, dy: 0.10, dz: 0.36 },
        { makeGeom: () => box(0.04, 0.20, 0.04), color: 0xc8c4be, dx:  0.14, dy: 0.10, dz: 0.36 },
        // Door.
        { makeGeom: () => box(0.10, 0.18, 0.018), color: 0x222222, dx: 0, dy: 0.09, dz: -0.04 + 0.26 + 0.009 },
        // "POLICE" sign band.
        { makeGeom: () => box(0.50, 0.06, 0.018), color: 0xeae3d0, dx: 0, dy: 0.30, dz: -0.04 + 0.26 + 0.010 },
        // Two blue light bars on the roof.
        { makeGeom: () => box(0.06, 0.04, 0.06), color: 0x4d8eb9, dx: -0.10, dy: 0.40 + 0.10, dz: -0.04 },
        { makeGeom: () => box(0.06, 0.04, 0.06), color: 0xb14a3a, dx:  0.10, dy: 0.40 + 0.10, dz: -0.04 }
      ];
    }
    case 'bus_stop':
      // Premium pass — proper shelter with bench, back glass wall,
      // canopy roof, route placard, and a wayfinding flag pole.
      return [
        // Concrete pad under the shelter.
        { makeGeom: () => box(0.62, 0.02, 0.30), color: 0x9a9690, dx: 0, dy: 0.01, dz: 0 },
        // Bench seat — wooden slats on two iron legs.
        { makeGeom: () => box(0.50, 0.03, 0.10), color: 0x6b4f3a, dx: 0, dy: 0.13, dz: 0.02 },
        { makeGeom: () => box(0.02, 0.12, 0.10), color: 0x2a2a2a, dx: -0.22, dy: 0.07, dz: 0.02 },
        { makeGeom: () => box(0.02, 0.12, 0.10), color: 0x2a2a2a, dx:  0.22, dy: 0.07, dz: 0.02 },
        // Back glass wall (tinted slab).
        { makeGeom: () => box(0.56, 0.30, 0.018), color: 0x8caec9, dx: 0, dy: 0.18, dz: -0.10 },
        // Two side glass panels.
        { makeGeom: () => box(0.018, 0.30, 0.12), color: 0x8caec9, dx: -0.27, dy: 0.18, dz: -0.04 },
        { makeGeom: () => box(0.018, 0.30, 0.12), color: 0x8caec9, dx:  0.27, dy: 0.18, dz: -0.04 },
        // Canopy roof — slim slab cantilevered over the bench.
        { makeGeom: () => box(0.66, 0.025, 0.32), color: 0x3a4a5a, dx: 0, dy: 0.34, dz: -0.02 },
        { makeGeom: () => box(0.66, 0.01, 0.32), color: 0xe5c25a, dx: 0, dy: 0.355, dz: -0.02 },
        // Route placard mounted on the back glass.
        { makeGeom: () => box(0.24, 0.10, 0.016), color: 0xeae3d0, dx: 0, dy: 0.26, dz: -0.09 },
        { makeGeom: () => box(0.22, 0.022, 0.018), color: 0xb14a3a, dx: 0, dy: 0.28, dz: -0.085 },
        // Flag pole + bus-stop flag on the side, away from the bench.
        { makeGeom: () => box(0.04, 0.55, 0.04), color: 0xb0aca2, dx: 0.30, dy: 0.275, dz: 0.10 },
        { makeGeom: () => box(0.20, 0.10, 0.018), color: 0xc9a437, dx: 0.38, dy: 0.50, dz: 0.10 },
        // Trash bin tucked at one end.
        { makeGeom: () => cyl(0.06, 0.16, 8), color: 0x3a3a3a, dx: -0.30, dy: 0.08, dz: 0.10 },
        { makeGeom: () => cyl(0.065, 0.018, 8), color: 0x222222, dx: -0.30, dy: 0.17, dz: 0.10 }
      ];
    case 'museum': {
      // Neoclassical: stone podium + columned colonnade + pedimented roof.
      // Pure facade: keeps the silhouette readable on a single tile.
      const cols: ReturnType<() => CityBuildingPart[]> = [];
      const colY = 0.04 + 0.32 / 2; // sit half-depth above the podium top
      for (let i = 0; i < 6; i++) {
        const dx = -0.30 + i * 0.12;
        cols.push({ makeGeom: () => cyl(0.025, 0.32, 8), color: 0xece4cf, dx, dy: 0.04 + 0.16, dz: 0.30 });
        // Suppress unused-variable lint
        void colY;
      }
      return [
        { makeGeom: () => box(0.92, 0.05, 0.78), color: 0xc7bfa9, dx: 0, dy: 0.025, dz: 0 },
        // Stone body (sits behind the colonnade).
        { makeGeom: () => box(0.85, 0.42, 0.55), color: 0xddd2b7, dx: 0, dy: 0.04 + 0.21, dz: -0.10 },
        // Pediment — triangular roof gestured with a thin slab.
        { makeGeom: () => box(0.85, 0.06, 0.55), color: 0xb19f7f, dx: 0, dy: 0.04 + 0.42 + 0.03, dz: -0.10 },
        // Apex block.
        { makeGeom: () => box(0.20, 0.10, 0.20), color: 0xb19f7f, dx: 0, dy: 0.04 + 0.42 + 0.10, dz: -0.10 },
        ...cols,
        // Colonnade entablature.
        { makeGeom: () => box(0.85, 0.04, 0.10), color: 0xb6ac8e, dx: 0, dy: 0.04 + 0.34, dz: 0.30 },
        // Steps.
        { makeGeom: () => box(0.55, 0.025, 0.06), color: 0xc7bfa9, dx: 0, dy: 0.04 + 0.013, dz: 0.36 }
      ];
    }
    case 'stadium': {
      // Oval bowl: low base ring + raised seating + interior field.
      // Crisp silhouette on a single tile thanks to the elliptical body.
      // Cylinder approximated by a hex prism + interior field box; reads
      // unambiguously as a stadium at this art scale.
      return [
        // Field interior (green).
        { makeGeom: () => box(0.55, 0.025, 0.40), color: 0x4d8442, dx: 0, dy: 0.013, dz: 0 },
        // Outer concrete ring as 4 sweeping wedges of a hex prism.
        { makeGeom: () => cyl(0.46, 0.18, 18), color: 0xc4c0b6, dx: 0, dy: 0.09, dz: 0 },
        // Cut the field out by laying a green inner cylinder on top —
        // creates the bowl reveal.
        { makeGeom: () => cyl(0.34, 0.04, 18), color: 0x4d8442, dx: 0, dy: 0.18 + 0.02, dz: 0 },
        // Stadium lights — 4 corner pylons.
        { makeGeom: () => box(0.025, 0.30, 0.025), color: 0xb0b0b0, dx: -0.32, dy: 0.30, dz: -0.18 },
        { makeGeom: () => box(0.025, 0.30, 0.025), color: 0xb0b0b0, dx:  0.32, dy: 0.30, dz: -0.18 },
        { makeGeom: () => box(0.025, 0.30, 0.025), color: 0xb0b0b0, dx: -0.32, dy: 0.30, dz:  0.18 },
        { makeGeom: () => box(0.025, 0.30, 0.025), color: 0xb0b0b0, dx:  0.32, dy: 0.30, dz:  0.18 },
        // Light fixtures atop pylons.
        { makeGeom: () => box(0.10, 0.04, 0.04), color: 0xfff7d0, dx: -0.32, dy: 0.46, dz: -0.18 },
        { makeGeom: () => box(0.10, 0.04, 0.04), color: 0xfff7d0, dx:  0.32, dy: 0.46, dz: -0.18 },
        { makeGeom: () => box(0.10, 0.04, 0.04), color: 0xfff7d0, dx: -0.32, dy: 0.46, dz:  0.18 },
        { makeGeom: () => box(0.10, 0.04, 0.04), color: 0xfff7d0, dx:  0.32, dy: 0.46, dz:  0.18 }
      ];
    }
    case 'ferry_dock': {
      // Wooden pier on land + a short jetty extending toward water. Bright
      // red flag pole reads at any zoom level.
      return [
        // Land pad.
        { makeGeom: () => box(0.45, 0.04, 0.30), color: 0x6c4f2c, dx: -0.10, dy: 0.02, dz: 0 },
        // Jetty extending out (toward what we hope is water — the player
        // chose this tile because of the water adjacency).
        { makeGeom: () => box(0.20, 0.04, 0.85), color: 0x5a3f22, dx: 0.18, dy: 0.02, dz: 0 },
        // Cleat / bollard.
        { makeGeom: () => cyl(0.04, 0.10, 8), color: 0x444444, dx: 0.18, dy: 0.07, dz: 0.36 },
        { makeGeom: () => cyl(0.04, 0.10, 8), color: 0x444444, dx: 0.18, dy: 0.07, dz: -0.30 },
        // Sign + flagpole.
        { makeGeom: () => box(0.025, 0.40, 0.025), color: 0xb0a89b, dx: -0.18, dy: 0.20, dz: -0.06 },
        { makeGeom: () => box(0.18, 0.10, 0.012), color: 0xc94038, dx: -0.10, dy: 0.36, dz: -0.06 }
      ];
    }
    case 'subway_entrance': {
      // Compact stair-down pad: low pavement square with a recessed dark
      // pit + a green entry-sign post and a pair of bright handrails.
      return [
        // Pavement pad.
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0x9a9690, dx: 0, dy: 0.013, dz: 0 },
        // Recessed pit (the stairs going down).
        { makeGeom: () => box(0.36, 0.04, 0.50), color: 0x18181a, dx: 0, dy: 0.005, dz: -0.05 },
        // Stair tread suggestions — three bright rectangles across the pit.
        { makeGeom: () => box(0.32, 0.005, 0.06), color: 0x78b878, dx: 0, dy: 0.030, dz: 0.06 },
        { makeGeom: () => box(0.32, 0.005, 0.06), color: 0x78b878, dx: 0, dy: 0.030, dz: -0.04 },
        { makeGeom: () => box(0.32, 0.005, 0.06), color: 0x78b878, dx: 0, dy: 0.030, dz: -0.14 },
        // Handrails.
        { makeGeom: () => box(0.025, 0.10, 0.55), color: 0x5b6f78, dx: -0.20, dy: 0.06, dz: -0.05 },
        { makeGeom: () => box(0.025, 0.10, 0.55), color: 0x5b6f78, dx:  0.20, dy: 0.06, dz: -0.05 },
        // Sign post + green M placard.
        { makeGeom: () => box(0.030, 0.50, 0.030), color: 0xb0b0b0, dx: 0, dy: 0.25, dz: 0.36 },
        { makeGeom: () => box(0.20, 0.18, 0.018), color: 0x4d8442, dx: 0, dy: 0.40, dz: 0.36 }
      ];
    }
    case 'observatory': {
      // Conical building base + dome top + telescope slit. Reads instantly
      // because of the dome — no other building uses a hemisphere primitive.
      return [
        // Concrete pad.
        { makeGeom: () => box(0.92, 0.04, 0.92), color: 0x9a9690, dx: 0, dy: 0.02, dz: 0 },
        // Tapered conical body (bottom radius wider than the dome).
        { makeGeom: () => cone(0.40, 0.20, 18), color: 0xe7e4dc, dx: 0, dy: 0.04 + 0.10, dz: 0 },
        // Slim cylinder linking the body to the dome.
        { makeGeom: () => cyl(0.30, 0.18, 18), color: 0xe7e4dc, dx: 0, dy: 0.04 + 0.20 + 0.09, dz: 0 },
        // Dome cap — half-sphere via icosahedron, scaled flat by a thin box.
        { makeGeom: () => sphereLite(0.30), color: 0xc4c0b6, dx: 0, dy: 0.04 + 0.20 + 0.18, dz: 0 },
        // Telescope slit — dark thin slab cutting across the dome face.
        { makeGeom: () => box(0.06, 0.32, 0.04), color: 0x222222, dx: 0, dy: 0.04 + 0.20 + 0.18, dz: 0 },
        // Side door / entry.
        { makeGeom: () => box(0.10, 0.16, 0.018), color: 0x2a2a2a, dx: 0, dy: 0.04 + 0.08, dz: 0.30 + 0.005 }
      ];
    }
    case 'bus_depot':
      // Polished depot (Alpha 2.2) — main building + 3 yellow bay-marker
      // strips on the apron + a roof sign so it reads as a transit depot.
      return [
        // Apron base.
        { makeGeom: () => box(0.85, 0.04, 0.85), color: 0x6a6a6a, dx: 0, dy: 0.02, dz: 0 },
        // Bay markers — three yellow stripes on the apron.
        { makeGeom: () => box(0.04, 0.05, 0.30), color: 0xeec453, dx: -0.20, dy: 0.025, dz: 0.22 },
        { makeGeom: () => box(0.04, 0.05, 0.30), color: 0xeec453, dx:  0.00, dy: 0.025, dz: 0.22 },
        { makeGeom: () => box(0.04, 0.05, 0.30), color: 0xeec453, dx:  0.20, dy: 0.025, dz: 0.22 },
        // Main depot building (set back from the apron).
        { makeGeom: () => box(0.85, 0.42, 0.45), color: 0xc77a2a, dx: 0, dy: 0.04 + 0.21, dz: -0.18 },
        // Roof line.
        { makeGeom: () => box(0.85, 0.05, 0.45), color: 0x854f1c, dx: 0, dy: 0.04 + 0.42 + 0.025, dz: -0.18 },
        // Garage door — wide darker panel on the apron-facing wall.
        { makeGeom: () => box(0.55, 0.32, 0.012), color: 0x6a3818, dx: 0, dy: 0.04 + 0.16, dz: -0.18 + 0.225 + 0.005 },
        // Yellow sign at the roofline.
        { makeGeom: () => box(0.30, 0.10, 0.014), color: 0xeec453, dx: 0, dy: 0.04 + 0.42 + 0.05, dz: -0.18 + 0.225 + 0.008 }
      ];
    /* ============== Architect Mode decoratives (Alpha 4.0) ============= */
    case 'plaza': {
      // Cobbled paved square + central planter + four corner posts.
      // Reads as the kind of public realm tile you'd find downtown.
      return [
        // Paved pad.
        { makeGeom: () => box(0.92, 0.04, 0.92), color: 0xb8b1a0, dx: 0, dy: 0.02, dz: 0 },
        // Cobble pattern — four lighter inset squares.
        { makeGeom: () => box(0.40, 0.045, 0.40), color: 0xc8c0ad, dx: -0.21, dy: 0.024, dz: -0.21 },
        { makeGeom: () => box(0.40, 0.045, 0.40), color: 0xc8c0ad, dx:  0.21, dy: 0.024, dz:  0.21 },
        // Central planter (square stone box with a small hedge).
        { makeGeom: () => box(0.30, 0.10, 0.30), color: 0x9a8f7a, dx: 0, dy: 0.07, dz: 0 },
        { makeGeom: () => box(0.24, 0.10, 0.24), color: 0x466c3a, dx: 0, dy: 0.16, dz: 0 },
        // Four corner bollards.
        { makeGeom: () => cyl(0.04, 0.18, 8), color: 0x4a4030, dx: -0.36, dy: 0.10, dz: -0.36 },
        { makeGeom: () => cyl(0.04, 0.18, 8), color: 0x4a4030, dx:  0.36, dy: 0.10, dz: -0.36 },
        { makeGeom: () => cyl(0.04, 0.18, 8), color: 0x4a4030, dx: -0.36, dy: 0.10, dz:  0.36 },
        { makeGeom: () => cyl(0.04, 0.18, 8), color: 0x4a4030, dx:  0.36, dy: 0.10, dz:  0.36 }
      ];
    }
    case 'fountain': {
      // Tiered marble fountain — circular basin, central column, splash
      // cap. Reads as monumental even at small scale.
      return [
        // Plaza pad under the fountain.
        { makeGeom: () => box(0.92, 0.04, 0.92), color: 0xc8c0ad, dx: 0, dy: 0.02, dz: 0 },
        // Outer basin (tall narrow cylinder).
        { makeGeom: () => cyl(0.36, 0.10, 24), color: 0xe8e2d4, dx: 0, dy: 0.09, dz: 0 },
        // Inner water (slightly recessed cylinder, water-blue).
        { makeGeom: () => cyl(0.32, 0.04, 24), color: 0x6ab0d8, dx: 0, dy: 0.13, dz: 0 },
        // Central column.
        { makeGeom: () => cyl(0.07, 0.40, 12), color: 0xeae5d8, dx: 0, dy: 0.32, dz: 0 },
        // Mid-tier splash bowl.
        { makeGeom: () => cyl(0.20, 0.04, 18), color: 0xeae5d8, dx: 0, dy: 0.50, dz: 0 },
        // Top splash bowl (narrower).
        { makeGeom: () => cyl(0.12, 0.04, 14), color: 0xeae5d8, dx: 0, dy: 0.62, dz: 0 },
        // Crown sphere.
        { makeGeom: () => sphereLite(0.08), color: 0x6ab0d8, dx: 0, dy: 0.72, dz: 0 }
      ];
    }
    case 'statue': {
      // Bronze figure on a stone plinth. The figure is reads as
      // person-shaped (head + torso + arms + base) at low poly.
      return [
        // Plaza pad.
        { makeGeom: () => box(0.85, 0.04, 0.85), color: 0xb8b1a0, dx: 0, dy: 0.02, dz: 0 },
        // Stone plinth (tall block).
        { makeGeom: () => box(0.30, 0.36, 0.30), color: 0x9a9286, dx: 0, dy: 0.22, dz: 0 },
        { makeGeom: () => box(0.34, 0.04, 0.34), color: 0x756d61, dx: 0, dy: 0.42, dz: 0 },
        // Bronze legs (single block, simplified).
        { makeGeom: () => box(0.12, 0.18, 0.10), color: 0x7a5a32, dx: 0, dy: 0.51, dz: 0 },
        // Bronze torso.
        { makeGeom: () => box(0.18, 0.20, 0.12), color: 0x8c6a3a, dx: 0, dy: 0.70, dz: 0 },
        // Bronze head.
        { makeGeom: () => box(0.10, 0.10, 0.10), color: 0xa07a44, dx: 0, dy: 0.85, dz: 0 },
        // Outstretched arm (hero pose).
        { makeGeom: () => box(0.22, 0.05, 0.05), color: 0x8c6a3a, dx: 0.12, dy: 0.74, dz: 0 }
      ];
    }
    case 'flower_bed': {
      // Low timber-edged rectangle with bright dot-flowers in red,
      // yellow, white. Cheap entry-tier piece. Cluster-friendly: many
      // of these in a row read as a long planted boulevard.
      return [
        // Soil base.
        { makeGeom: () => box(0.78, 0.04, 0.36), color: 0x5a3e22, dx: 0, dy: 0.02, dz: 0 },
        // Timber edge — four thin slabs.
        { makeGeom: () => box(0.78, 0.05, 0.04), color: 0x6e4e2a, dx: 0, dy: 0.025, dz: -0.18 },
        { makeGeom: () => box(0.78, 0.05, 0.04), color: 0x6e4e2a, dx: 0, dy: 0.025, dz:  0.18 },
        { makeGeom: () => box(0.04, 0.05, 0.36), color: 0x6e4e2a, dx: -0.39, dy: 0.025, dz: 0 },
        { makeGeom: () => box(0.04, 0.05, 0.36), color: 0x6e4e2a, dx:  0.39, dy: 0.025, dz: 0 },
        // Dot-flowers — bright spheres scattered across the bed.
        { makeGeom: () => sphereLite(0.05), color: 0xd84545, dx: -0.28, dy: 0.10, dz: -0.06 },
        { makeGeom: () => sphereLite(0.05), color: 0xf2cd5c, dx: -0.10, dy: 0.10, dz:  0.06 },
        { makeGeom: () => sphereLite(0.05), color: 0xf6f0e0, dx:  0.08, dy: 0.10, dz: -0.06 },
        { makeGeom: () => sphereLite(0.05), color: 0xd84545, dx:  0.26, dy: 0.10, dz:  0.06 },
        { makeGeom: () => sphereLite(0.04), color: 0xa75ad4, dx:  0.00, dy: 0.10, dz: -0.10 }
      ];
    }
    case 'topiary': {
      // Manicured hedge maze block — square outer hedge with inner
      // cross hedges. Reads as a formal English garden parterre.
      return [
        // Lawn pad.
        { makeGeom: () => box(0.92, 0.04, 0.92), color: 0x4d8c3a, dx: 0, dy: 0.02, dz: 0 },
        // Outer hedge wall — four slabs forming a square frame.
        { makeGeom: () => box(0.92, 0.20, 0.10), color: 0x2d5e2a, dx: 0, dy: 0.12, dz: -0.41 },
        { makeGeom: () => box(0.92, 0.20, 0.10), color: 0x2d5e2a, dx: 0, dy: 0.12, dz:  0.41 },
        { makeGeom: () => box(0.10, 0.20, 0.92), color: 0x2d5e2a, dx: -0.41, dy: 0.12, dz: 0 },
        { makeGeom: () => box(0.10, 0.20, 0.92), color: 0x2d5e2a, dx:  0.41, dy: 0.12, dz: 0 },
        // Inner cross — narrower hedges.
        { makeGeom: () => box(0.65, 0.16, 0.06), color: 0x3a7a3a, dx: 0, dy: 0.10, dz: 0 },
        { makeGeom: () => box(0.06, 0.16, 0.65), color: 0x3a7a3a, dx: 0, dy: 0.10, dz: 0 },
        // Centre topiary ball.
        { makeGeom: () => sphereLite(0.08), color: 0x4a8e44, dx: 0, dy: 0.20, dz: 0 }
      ];
    }
    case 'pergola': {
      // Wooden pergola — four corner posts holding parallel cross-beams.
      // Light shade structure for a courtyard or garden corner.
      return [
        // Stone pad.
        { makeGeom: () => box(0.78, 0.04, 0.78), color: 0xc7c2b3, dx: 0, dy: 0.02, dz: 0 },
        // Four corner posts.
        { makeGeom: () => box(0.06, 0.46, 0.06), color: 0x8a5a32, dx: -0.32, dy: 0.23, dz: -0.32 },
        { makeGeom: () => box(0.06, 0.46, 0.06), color: 0x8a5a32, dx:  0.32, dy: 0.23, dz: -0.32 },
        { makeGeom: () => box(0.06, 0.46, 0.06), color: 0x8a5a32, dx: -0.32, dy: 0.23, dz:  0.32 },
        { makeGeom: () => box(0.06, 0.46, 0.06), color: 0x8a5a32, dx:  0.32, dy: 0.23, dz:  0.32 },
        // Two long top rails.
        { makeGeom: () => box(0.78, 0.05, 0.05), color: 0x6e4622, dx: 0, dy: 0.50, dz: -0.30 },
        { makeGeom: () => box(0.78, 0.05, 0.05), color: 0x6e4622, dx: 0, dy: 0.50, dz:  0.30 },
        // Five cross-beams perpendicular.
        { makeGeom: () => box(0.05, 0.04, 0.66), color: 0x7a4f28, dx: -0.32, dy: 0.49, dz: 0 },
        { makeGeom: () => box(0.05, 0.04, 0.66), color: 0x7a4f28, dx: -0.16, dy: 0.49, dz: 0 },
        { makeGeom: () => box(0.05, 0.04, 0.66), color: 0x7a4f28, dx:  0.00, dy: 0.49, dz: 0 },
        { makeGeom: () => box(0.05, 0.04, 0.66), color: 0x7a4f28, dx:  0.16, dy: 0.49, dz: 0 },
        { makeGeom: () => box(0.05, 0.04, 0.66), color: 0x7a4f28, dx:  0.32, dy: 0.49, dz: 0 },
        // Trailing greenery — small hedges at two corner posts.
        { makeGeom: () => sphereLite(0.10), color: 0x3a7a3a, dx: -0.32, dy: 0.10, dz: -0.32 },
        { makeGeom: () => sphereLite(0.10), color: 0x3a7a3a, dx:  0.32, dy: 0.10, dz:  0.32 }
      ];
    }
    case 'reflecting_pool': {
      // Long marble-edged rectangular water feature — reads as a
      // monumental Jefferson-Memorial-style reflecting pool. Very still
      // water surface, decorative only.
      return [
        // Stone surround.
        { makeGeom: () => box(0.92, 0.06, 0.92), color: 0xeae3d0, dx: 0, dy: 0.03, dz: 0 },
        // Inset water (slightly lower than surround).
        { makeGeom: () => box(0.78, 0.05, 0.78), color: 0x4d8eb9, dx: 0, dy: 0.04, dz: 0 },
        // Subtle reflection ripple — slim white slab on the surface.
        { makeGeom: () => box(0.40, 0.06, 0.04), color: 0xc6dff0, dx: 0, dy: 0.05, dz: 0 },
        // Four corner stone bollards.
        { makeGeom: () => box(0.06, 0.10, 0.06), color: 0xc7c2b3, dx: -0.42, dy: 0.07, dz: -0.42 },
        { makeGeom: () => box(0.06, 0.10, 0.06), color: 0xc7c2b3, dx:  0.42, dy: 0.07, dz: -0.42 },
        { makeGeom: () => box(0.06, 0.10, 0.06), color: 0xc7c2b3, dx: -0.42, dy: 0.07, dz:  0.42 },
        { makeGeom: () => box(0.06, 0.10, 0.06), color: 0xc7c2b3, dx:  0.42, dy: 0.07, dz:  0.42 }
      ];
    }
    case 'memorial_garden': {
      // Sculptural memorial — central obelisk on a tiered base
      // surrounded by paving + hedges + flowers. The premium garden
      // tier; reads as solemn civic landmark.
      return [
        // Wide stone pad (large memorial plaza footprint).
        { makeGeom: () => box(0.95, 0.05, 0.95), color: 0xc7c0ae, dx: 0, dy: 0.025, dz: 0 },
        // Tiered base under the obelisk — three steps.
        { makeGeom: () => box(0.50, 0.06, 0.50), color: 0xa8a094, dx: 0, dy: 0.08, dz: 0 },
        { makeGeom: () => box(0.36, 0.06, 0.36), color: 0xc0b8a8, dx: 0, dy: 0.14, dz: 0 },
        // Tall granite obelisk (tapered cone).
        { makeGeom: () => cone(0.15, 0.85, 4), color: 0x7a7368, dx: 0, dy: 0.62, dz: 0 },
        // Four corner hedge balls.
        { makeGeom: () => sphereLite(0.10), color: 0x3a7a3a, dx: -0.40, dy: 0.10, dz: -0.40 },
        { makeGeom: () => sphereLite(0.10), color: 0x3a7a3a, dx:  0.40, dy: 0.10, dz: -0.40 },
        { makeGeom: () => sphereLite(0.10), color: 0x3a7a3a, dx: -0.40, dy: 0.10, dz:  0.40 },
        { makeGeom: () => sphereLite(0.10), color: 0x3a7a3a, dx:  0.40, dy: 0.10, dz:  0.40 },
        // Edge flower clusters — small dots between hedges.
        { makeGeom: () => sphereLite(0.04), color: 0xd84545, dx: 0, dy: 0.10, dz: -0.42 },
        { makeGeom: () => sphereLite(0.04), color: 0xf2cd5c, dx: 0, dy: 0.10, dz:  0.42 }
      ];
    }
    case 'clock_tower': {
      // Dedicated tall slender clock tower — distinct from the school's
      // small clock turret. Real centerpiece civic landmark.
      return [
        // Plaza pad.
        { makeGeom: () => box(0.92, 0.04, 0.92), color: 0xb8b1a0, dx: 0, dy: 0.02, dz: 0 },
        // Tall granite tower body.
        { makeGeom: () => box(0.40, 1.20, 0.40), color: 0xd6c9a8, dx: 0, dy: 0.04 + 0.60, dz: 0 },
        // Window strip on the front face.
        { makeGeom: () => box(0.08, 0.18, 0.018), color: 0x2a3a4a, dx: 0, dy: 0.50, dz: 0.20 + 0.005 },
        // Clock face — large dark disc with white frame on each face.
        { makeGeom: () => cyl(0.13, 0.04, 16), color: 0x2a2a2a, dx: 0, dy: 1.05, dz: 0.20 + 0.025 },
        { makeGeom: () => cyl(0.10, 0.05, 16), color: 0xeae3d0, dx: 0, dy: 1.05, dz: 0.20 + 0.045 },
        // Minute hand.
        { makeGeom: () => box(0.012, 0.10, 0.018), color: 0x1a1a1a, dx: 0, dy: 1.10, dz: 0.20 + 0.06 },
        // Hour hand.
        { makeGeom: () => box(0.014, 0.06, 0.018), color: 0x1a1a1a, dx: 0.025, dy: 1.07, dz: 0.20 + 0.06 },
        // Belfry — open arched section above the clock.
        { makeGeom: () => box(0.50, 0.18, 0.50), color: 0xc7b08a, dx: 0, dy: 1.30, dz: 0 },
        // Pyramidal copper-green roof.
        { makeGeom: () => cone(0.30, 0.30, 4), color: 0x4f9f7a, dx: 0, dy: 1.55, dz: 0 },
        // Spire on top.
        { makeGeom: () => cyl(0.012, 0.18, 5), color: 0xc4c0b6, dx: 0, dy: 1.79, dz: 0 },
        // Gold ball finial.
        { makeGeom: () => sphereLite(0.04), color: 0xeec453, dx: 0, dy: 1.91, dz: 0 }
      ];
    }
    case 'triumphal_arch': {
      // Massive stone arch — tallest, widest single-tile decorative.
      // The end-game prestige build. Reads as Arc-de-Triomphe-style.
      return [
        // Plaza pad (wide).
        { makeGeom: () => box(0.95, 0.04, 0.95), color: 0xc7c2b3, dx: 0, dy: 0.02, dz: 0 },
        // Two solid leg piers (left + right).
        { makeGeom: () => box(0.22, 0.95, 0.50), color: 0xd6c9a8, dx: -0.32, dy: 0.04 + 0.475, dz: 0 },
        { makeGeom: () => box(0.22, 0.95, 0.50), color: 0xd6c9a8, dx:  0.32, dy: 0.04 + 0.475, dz: 0 },
        // Arch top entablature — long heavy slab spanning the legs.
        { makeGeom: () => box(0.92, 0.18, 0.50), color: 0xc7b08a, dx: 0, dy: 0.04 + 0.95 + 0.09, dz: 0 },
        // Top cornice (slightly wider crown).
        { makeGeom: () => box(0.96, 0.06, 0.54), color: 0xb8a07a, dx: 0, dy: 0.04 + 0.95 + 0.18 + 0.03, dz: 0 },
        // Decorative relief plaque on the front face.
        { makeGeom: () => box(0.40, 0.10, 0.018), color: 0xa8916a, dx: 0, dy: 0.04 + 0.95 + 0.09, dz: 0.25 + 0.005 },
        // Gold lettering hint on the plaque.
        { makeGeom: () => box(0.30, 0.04, 0.020), color: 0xeec453, dx: 0, dy: 0.04 + 0.95 + 0.09, dz: 0.25 + 0.018 },
        // Top crown ornament — a small statue/quadriga silhouette.
        { makeGeom: () => box(0.18, 0.12, 0.10), color: 0x8c6a3a, dx: 0, dy: 0.04 + 0.95 + 0.27, dz: 0 }
      ];
    }
    case 'pier': {
      // Wooden deck on water — planks, pilings dropping into the
      // water, two posts at the seaward end with rope strung between.
      return [
        // Deck — flat wooden plank surface (slim, sitting just above water).
        { makeGeom: () => box(0.85, 0.04, 0.85), color: 0x8a5a32, dx: 0, dy: 0.05, dz: 0 },
        // Plank seams — three darker strips across the deck.
        { makeGeom: () => box(0.85, 0.045, 0.04), color: 0x6a4422, dx: 0, dy: 0.052, dz: -0.20 },
        { makeGeom: () => box(0.85, 0.045, 0.04), color: 0x6a4422, dx: 0, dy: 0.052, dz:  0.00 },
        { makeGeom: () => box(0.85, 0.045, 0.04), color: 0x6a4422, dx: 0, dy: 0.052, dz:  0.20 },
        // Four pilings dropping below the deck (visual cue of supports).
        { makeGeom: () => cyl(0.04, 0.20, 6), color: 0x4a3220, dx: -0.36, dy: -0.07, dz: -0.36 },
        { makeGeom: () => cyl(0.04, 0.20, 6), color: 0x4a3220, dx:  0.36, dy: -0.07, dz: -0.36 },
        { makeGeom: () => cyl(0.04, 0.20, 6), color: 0x4a3220, dx: -0.36, dy: -0.07, dz:  0.36 },
        { makeGeom: () => cyl(0.04, 0.20, 6), color: 0x4a3220, dx:  0.36, dy: -0.07, dz:  0.36 },
        // Two seaward bollards with a rope between.
        { makeGeom: () => cyl(0.04, 0.20, 8), color: 0x5a3a22, dx: -0.30, dy: 0.18, dz: 0.36 },
        { makeGeom: () => cyl(0.04, 0.20, 8), color: 0x5a3a22, dx:  0.30, dy: 0.18, dz: 0.36 },
        { makeGeom: () => box(0.60, 0.018, 0.018), color: 0x9a8a72, dx: 0, dy: 0.24, dz: 0.36 }
      ];
    }
    // ===== Toronto landmark Easter eggs (Alpha 4.24) =====
    // Not exposed to the toolbar — only painted by the Toronto preset
    // generator (scripts/generate-toronto.mjs). Each delegates to its
    // builder in TorontoLandmarks.ts.
    case 'cn_tower':              return buildCNTowerParts();
    case 'rogers_centre':         return buildRogersCentreParts();
    case 'scotiabank_arena':      return buildScotiabankArenaParts();
    case 'union_station':         return buildUnionStationParts();
    case 'casa_loma':             return buildCasaLomaParts();
    case 'royal_ontario_museum':  return buildROMParts();
    case 'art_gallery_ontario':   return buildAGOParts();
    case 'distillery_district':   return buildDistilleryParts();
    case 'pearson_terminal':      return buildPearsonTerminalParts();
    case 'runway':                return buildRunwayParts();
    default:
      return [];
  }
}

/**
 * Build the beautification overlay mesh (Alpha 4.0 — Architect Mode).
 *
 * Walks every developed Commercial / Mixed-Use tile (and L3 R / luxury
 * at the top tier) and emits per-tile decorative props on the four
 * corners of the lot — planter boxes, café tables, banner poles,
 * sculpture, etc — scaled by the council's elected `BeautificationTier`.
 *
 * **Why this is council-controlled:** the player has no slider for it;
 * the renderer just reads whatever tier is currently effective and
 * draws accordingly. When the budget defunds (treasury short), the
 * tier flips to 'none' and this mesh is wiped — the streetscape
 * visibly strips down across the whole city in one frame.
 *
 * Each tier additively unlocks props:
 *   light    — corner planter
 *   standard — light + outdoor café table
 *   grand    — standard + decorative streetlamp + banner pennant
 *   opulent  — grand + public-art pedestal + flower spillover
 *
 * Returns null when no eligible tiles exist (fresh city without C/MU
 * yet) so the caller can skip adding the mesh entirely.
 */
export function buildBeautificationMesh(
  grid: Grid,
  tier: import('../../types').BeautificationTier
): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];

  // Tier-gated additive flags. Each tier turns on its props PLUS all
  // cheaper tiers' props. Read the tier once into a struct so the
  // hot loop below doesn't re-evaluate the switch per tile.
  const tierLevel =
    tier === 'opulent'  ? 4 :
    tier === 'grand'    ? 3 :
    tier === 'standard' ? 2 :
    tier === 'light'    ? 1 : 0;
  if (tierLevel === 0) return null;

  // Palette — theme-driven beautification colours (Beta 1.2). Each
  // theme provides its own planter / banner / lamp / table / art
  // values so streetscape flair reads as part of the active pack.
  const _b = THEME().beautification;
  const PLANT_GREEN = THEME().flora.plant;
  const PLANTER     = _b.planter;
  const BANNER_RED  = _b.bannerPrimary;
  const BANNER_BLUE = _b.bannerSecondary;
  const LAMP_POLE   = _b.lampPole;
  const LAMP_BULB   = _b.lampBulb;
  const TABLE_TOP   = _b.tableTop;
  const ART_BRONZE  = _b.artBronze;
  const ART_BASE    = _b.artBase;

  // Per-corner offsets — the four lot corners of a developed tile.
  // We deliberately push toward the lot edge so props land on the
  // sidewalk rim, NOT inside the building footprint.
  const CORNERS: ReadonlyArray<readonly [number, number]> = [
    [-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]
  ];

  for (const t of grid.iter()) {
    if (t.density === 0) continue;
    if (t.road) continue;
    // C / MU are the canonical beautified zones. R-L3 + luxury get
    // upgrades only at grand+ tier (residential streetscape flair is
    // a higher-tier amenity).
    const isCommercial = t.zone === 'commercial' || t.zone === 'mixed';
    // Premium residential includes L3, L4 (Alpha 4.18), and luxury.
    const isPremiumRes = t.zone === 'residential' && (t.density >= 3 || t.luxury);
    if (!isCommercial && !(isPremiumRes && tierLevel >= 3)) continue;

    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    // Deterministic per-tile RNG so a re-render picks the same colours.
    const r = Math.abs(((t.x * 73856093) ^ (t.y * 19349663)) | 0);
    // Pick a banner colour per tile.
    const bannerColor = (r % 2 === 0) ? BANNER_RED : BANNER_BLUE;

    // Pick which two of the four corners get props per tier — keeps the
    // visual density manageable and the corner choice deterministic.
    const cornerCountByTier = [0, 1, 2, 3, 4];
    const cornerCount = cornerCountByTier[tierLevel]!;
    const cornerStart = (r >> 4) % 4;
    for (let ci = 0; ci < cornerCount; ci++) {
      const corner = CORNERS[(cornerStart + ci) % 4]!;
      const ox = corner[0];
      const oz = corner[1];

      // Tier 1+ — corner planter box with a small hedge.
      const planter = box(0.16, 0.06, 0.16);
      planter.translate(cx + ox, 0.03, cz + oz);
      geoms.push(planter); colours.push(PLANTER);
      const hedge = box(0.12, 0.10, 0.12);
      hedge.translate(cx + ox, 0.10, cz + oz);
      geoms.push(hedge); colours.push(PLANT_GREEN);

      // Tier 2+ — outdoor café table (only on alternating corners so
      // every tile doesn't read identically).
      if (tierLevel >= 2 && ci % 2 === 0) {
        const tableTop = cyl(0.07, 0.014, 10);
        tableTop.translate(cx + ox + 0.10, 0.18, cz + oz + 0.10);
        geoms.push(tableTop); colours.push(TABLE_TOP);
        const tableLeg = cyl(0.012, 0.18, 5);
        tableLeg.translate(cx + ox + 0.10, 0.09, cz + oz + 0.10);
        geoms.push(tableLeg); colours.push(LAMP_POLE);
        // Two tiny chair-seat dots flanking the table.
        const chairA = cyl(0.04, 0.016, 6);
        chairA.translate(cx + ox + 0.04, 0.13, cz + oz + 0.10);
        geoms.push(chairA); colours.push(LAMP_POLE);
        const chairB = cyl(0.04, 0.016, 6);
        chairB.translate(cx + ox + 0.16, 0.13, cz + oz + 0.10);
        geoms.push(chairB); colours.push(LAMP_POLE);
      }

      // Tier 3+ — decorative streetlamp + flag banner.
      if (tierLevel >= 3) {
        const pole = cyl(0.018, 0.46, 6);
        pole.translate(cx + ox, 0.27, cz + oz);
        geoms.push(pole); colours.push(LAMP_POLE);
        // Decorative arm.
        const arm = box(0.14, 0.018, 0.018);
        arm.translate(cx + ox + 0.06, 0.48, cz + oz);
        geoms.push(arm); colours.push(LAMP_POLE);
        // Lamp bulb.
        const bulb = sphereLite(0.040);
        bulb.translate(cx + ox + 0.12, 0.47, cz + oz);
        geoms.push(bulb); colours.push(LAMP_BULB);
        // Pennant banner.
        const banner = box(0.10, 0.16, 0.012);
        banner.translate(cx + ox, 0.36, cz + oz + 0.020);
        geoms.push(banner); colours.push(bannerColor);
      }

      // Tier 4 — public-art pedestal on one corner (the first chosen).
      if (tierLevel >= 4 && ci === 0) {
        const base = box(0.16, 0.08, 0.16);
        base.translate(cx + ox, 0.04, cz + oz);
        geoms.push(base); colours.push(ART_BASE);
        // Abstract twisted spire — a tall narrow cone offset to read
        // as sculpture.
        const spire = cone(0.06, 0.36, 5);
        spire.translate(cx + ox, 0.26, cz + oz);
        geoms.push(spire); colours.push(ART_BRONZE);
        // Crown sphere.
        const crown = sphereLite(0.050);
        crown.translate(cx + ox, 0.46, cz + oz);
        geoms.push(crown); colours.push(LAMP_BULB);
        // Spillover flower clusters around the pedestal.
        const f1 = sphereLite(0.030);
        f1.translate(cx + ox - 0.10, 0.10, cz + oz);
        geoms.push(f1); colours.push(0xd84545);
        const f2 = sphereLite(0.030);
        f2.translate(cx + ox + 0.10, 0.10, cz + oz);
        geoms.push(f2); colours.push(0xa75ad4);
      }
    }
  }

  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  // Slightly emissive material so the streetscape decorations read as
  // bright + alive even in shaded areas.
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(merged, mat);
}

export function box(w: number, h: number, d: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  return g;
}
function sphereLite(r: number): BufferGeometry {
  // Detail 0 = octahedron, detail 1 = 42 verts. Detail 1 reads as a
  // believable cloud puff or rounded cap without the smooth-sphere cost.
  return new IcosahedronGeometry(r, 1);
}
function cyl(r: number, h: number, segs: number): BufferGeometry {
  const g = new CylinderGeometry(r, r, h, segs);
  return g;
}
function cone(r: number, h: number, segs: number): BufferGeometry {
  const g = new ConeGeometry(r, h, segs);
  return g;
}

/**
 * Vertical sky-gradient texture (Alpha 2.6 visual pass). 1 px wide,
 * 256 px tall, painted with a CanvasGradient from horizon (warm pale) up
 * to zenith (saturated blue). Used as `scene.background` so the canvas
 * reads as sky instead of a flat dark colour. One-time cost at init.
 */
export function makeSkyGradient(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  // Initial paint at noon — `applyTimeOfDay` will repaint with the
  // active theme on the very first sim frame.
  repaintSkyGradient(tex, 0.5, getActiveTheme().atmosphere);
  return tex;
}

/**
 * Repaint the sky gradient texture for the current time of day (Alpha
 * 2.14). Five keyframe ramps — night → dawn → noon → dusk → night —
 * lerped together so the sky shifts smoothly across the day cycle.
 *
 * Theme-driven (Beta 1.2): keyframes + mid-stop position come from the
 * active theme's atmosphere. Stock uses the original deep-blue noon /
 * peach dusk palette; Coastal Pastel uses warm pastel zeniths + soft
 * horizon glow that reads as Aegean light.
 */
export function repaintSkyGradient(
  tex: CanvasTexture,
  phase: number,
  atm: { skyKeyframes: ReadonlyArray<{ p: number; zenith: number; mid: number; horizon: number }>; skyMidStop: number }
): void {
  const canvas = tex.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const KF = atm.skyKeyframes;
  let lo = KF[0]!, hi = KF[1]!;
  for (let i = 0; i < KF.length - 1; i++) {
    if (phase >= KF[i]!.p && phase <= KF[i + 1]!.p) { lo = KF[i]!; hi = KF[i + 1]!; break; }
  }
  const t = (phase - lo.p) / Math.max(1e-6, hi.p - lo.p);
  const zenith = lerpHexColor(lo.zenith, hi.zenith, t);
  const mid    = lerpHexColor(lo.mid, hi.mid, t);
  const horizon = lerpHexColor(lo.horizon, hi.horizon, t);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.00, '#' + zenith.toString(16).padStart(6, '0'));
  grad.addColorStop(atm.skyMidStop, '#' + mid.toString(16).padStart(6, '0'));
  grad.addColorStop(1.00, '#' + horizon.toString(16).padStart(6, '0'));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1, 256);
  tex.needsUpdate = true;
}

/** Phase warp (Alpha 3.0.1): map an unwarped phase ∈ [0, 1] through a
 *  piecewise-linear function so the [0.15, 0.85] day-window covers 70%
 *  of the cycle and the night bands cover 30% combined. The warp
 *  preserves the midnight (p=0/1) and noon (p=0.5) anchor points so
 *  the rest of the renderer math stays unchanged. */
export function warpDayPhase(p: number): number {
  if (p <= 0.15) return p * (0.25 / 0.15);
  if (p <= 0.85) return 0.25 + (p - 0.15) * (0.50 / 0.70);
  return 0.75 + (p - 0.85) * (0.25 / 0.15);
}

export function lerpHexColor(a: number, b: number, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const c = Math.round(ab + (bb - ab) * u);
  return (r << 16) | (g << 8) | c;
}

/**
 * A small Group of stylized clouds floating high above the world (Alpha
 * 2.6). Each cloud is a cluster of 3-5 IcosahedronGeometry "puffs" merged
 * into a single mesh, no transparency (low-poly aesthetic), unlit
 * MeshBasicMaterial so they read uniformly white regardless of scene
 * lighting changes. Static — added once at init.
 */
export function makeClouds(): Group {
  const group = new Group();
  // Five cloud blobs scattered across the sky at varying heights/sizes.
  const cloudSpecs: Array<{ x: number; y: number; z: number; scale: number }> = [
    { x: -22, y: 18, z: -18, scale: 1.0 },
    { x:  20, y: 22, z: -25, scale: 1.4 },
    { x:  35, y: 16, z:  10, scale: 0.9 },
    { x: -30, y: 20, z:  20, scale: 1.2 },
    { x:   5, y: 24, z:  35, scale: 1.1 }
  ];
  for (const spec of cloudSpecs) {
    const puffs: BufferGeometry[] = [];
    // Each cloud = 4 puffs in an asymmetric cluster.
    const offsets: Array<[number, number, number, number]> = [
      [ 0.0, 0.0,  0.0, 1.0 * spec.scale],
      [ 1.0, 0.1, -0.2, 0.85 * spec.scale],
      [-0.9, 0.0,  0.1, 0.80 * spec.scale],
      [ 0.3, 0.4,  0.5, 0.65 * spec.scale]
    ];
    for (const [ox, oy, oz, r] of offsets) {
      const puff = new IcosahedronGeometry(r, 1);
      puff.translate(ox, oy, oz);
      puffs.push(puff);
    }
    // Manual merge — concatenate position + index attrs across the puffs.
    let totalVerts = 0, totalIndices = 0;
    for (const p of puffs) {
      totalVerts += p.getAttribute('position').count;
      const idx = p.getIndex();
      totalIndices += idx ? idx.count : p.getAttribute('position').count;
    }
    const positions = new Float32Array(totalVerts * 3);
    const indices = new Uint32Array(totalIndices);
    let vOff = 0, iOff = 0;
    for (const p of puffs) {
      const pos = p.getAttribute('position');
      const idx = p.getIndex();
      for (let i = 0; i < pos.count; i++) {
        positions[(vOff + i) * 3 + 0] = pos.getX(i);
        positions[(vOff + i) * 3 + 1] = pos.getY(i);
        positions[(vOff + i) * 3 + 2] = pos.getZ(i);
      }
      if (idx) {
        for (let i = 0; i < idx.count; i++) indices[iOff + i] = idx.getX(i) + vOff;
        iOff += idx.count;
      } else {
        for (let i = 0; i < pos.count; i++) indices[iOff + i] = vOff + i;
        iOff += pos.count;
      }
      vOff += pos.count;
      p.dispose();
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setIndex(new BufferAttribute(indices, 1));
    const mesh = new Mesh(
      geom,
      new MeshBasicMaterial({ color: 0xfafbfc })
    );
    mesh.position.set(spec.x, spec.y, spec.z);
    group.add(mesh);
  }
  return group;
}

// --- Unowned land overlay (Alpha 3.1.3) -------------------------------

/** Translucent grey overlay covering every tile that the player hasn't
 *  yet purchased. Sits just above the terrain — like a thin "for sale"
 *  sticker on the land. Zoned tiles never appear unowned (the gate
 *  inside Grid.setZone refuses), so this overlay never overlaps zone
 *  colour. */
export function buildUnownedLandMesh(grid: Grid): Mesh | null {
  let count = 0;
  for (const t of grid.iter()) if (!t.owned) count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color(0x1a1a1a);
  const inset = 0;
  const baseY = ROAD_LIFT * 0.10;

  let vi = 0, ci = 0, ii = 0, v = 0;
  for (const t of grid.iter()) {
    if (t.owned) continue;
    const x0 = t.x * TILE_SIZE + inset;
    const x1 = (t.x + 1) * TILE_SIZE - inset;
    const z0 = t.y * TILE_SIZE + inset;
    const z1 = (t.y + 1) * TILE_SIZE - inset;
    const y = baseY + t.elevation;

    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
  });
  return new Mesh(geom, mat);
}

// --- Zones --------------------------------------------------------------

export function buildZoneMesh(grid: Grid): Mesh | null {
  // Count zoned tiles first to size buffers exactly. Cheap full-grid sweep.
  let count = 0;
  for (const t of grid.iter()) if (t.zone !== 'none') count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color();

  let vi = 0;
  let ci = 0;
  let ii = 0;
  let v = 0;
  // Slight inset so a zoned tile reads as "this cell" rather than bleeding
  // into its neighbours' borders.
  const inset = 0.03;

  for (const t of grid.iter()) {
    if (t.zone === 'none') continue;
    c.setHex(THEME().buildings.zoneOverlay[t.zone as Exclude<Zone, 'none'>]);
    // Tier shading — low zones look slightly washed out, high zones more
    // saturated. Player can read intent from the overlay alone. Multiply
    // each channel by the tier factor (0.78 / 0.92 / 1.06) so the colour
    // family stays intact.
    const tierFactor = t.zoneCap === 1 ? 0.78 : t.zoneCap === 2 ? 0.92 : 1.06;
    c.r = Math.min(1, c.r * tierFactor);
    c.g = Math.min(1, c.g * tierFactor);
    c.b = Math.min(1, c.b * tierFactor);

    const x0 = t.x * TILE_SIZE + inset;
    const x1 = (t.x + 1) * TILE_SIZE - inset;
    const z0 = t.y * TILE_SIZE + inset;
    const z1 = (t.y + 1) * TILE_SIZE - inset;

    // Lift by tile elevation so zones drape over hilly terrain (Alpha 2.4).
    const yz = ZONE_LIFT + t.elevation;
    positions[vi++] = x0; positions[vi++] = yz; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = yz; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = yz; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = yz; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }

    // CCW from above so the top face survives back-face culling.
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normals.

  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    flatShading: true
  });
  return new Mesh(geom, mat);
}

// --- Roads --------------------------------------------------------------

interface BuiltRoads {
  mesh: Mesh;
  lanes: LineSegments | null;
}

export function buildRoadMesh(grid: Grid): BuiltRoads | null {
  // Beta 1.8 — internal roundabout ring↔ring edges are NOT drawn as
  // square road quads; the circular roundabout mesh (buildRoundaboutsGroup)
  // replaces them. External approach edges (ring tile ↔ outside road) stay,
  // so connecting roads still visually meet the ring.
  const isInternalRingEdge = (e: { ax: number; ay: number; bx: number; by: number }): boolean => {
    const ra = grid.roundaboutAt(e.ax, e.ay);
    const rb = grid.roundaboutAt(e.bx, e.by);
    return !!(ra && rb && ra.isRing && rb.isRing && ra.ax === rb.ax && ra.ay === rb.ay);
  };
  const edges = Array.from(grid.iterRoadEdges()).filter((e) => !isInternalRingEdge(e));
  // Stub tiles (road=true with no incident edge) get a small centre square.
  // Roundabout tiles are excluded — the circular mesh covers them, so a
  // ring tile whose only edges were filtered out must NOT render a stub.
  const stubs: { x: number; y: number }[] = [];
  for (const t of grid.iter()) {
    if (!t.road || t.roundabout) continue;
    let hasEdge = false;
    for (const e of edges) {
      if ((e.ax === t.x && e.ay === t.y) || (e.bx === t.x && e.by === t.y)) {
        hasEdge = true; break;
      }
    }
    if (!hasEdge) stubs.push({ x: t.x, y: t.y });
  }

  if (edges.length === 0 && stubs.length === 0) return null;

  // Beta 1.6.14 — each edge is split into TWO half-quads, one per side,
  // each rendered at its OWN tile's tier width and colour. Same-tier
  // halves visually merge into one continuous edge; cross-tier halves
  // produce a width step at the tile boundary (avenue stays avenue-width
  // up to the boundary, local stays local-width from the boundary on),
  // so neither road's width changes where they meet. Pre-1.6.14 picked
  // a single tier per edge (first MAX, then MIN) — both schemes pushed
  // one road's width onto the other at intersections.
  const totalQuads = edges.length * 2 + stubs.length;
  const positions = new Float32Array(totalQuads * 4 * 3);
  const colours = new Float32Array(totalQuads * 4 * 3);
  const indices = new Uint32Array(totalQuads * 6);
  const c = new Color();

  let vi = 0;
  let ci = 0;
  let ii = 0;
  let v = 0;
  const yLift = ROAD_LIFT;

  // --- edge half-quads ---
  // Yellow stripes: local dashed centerline + avenue solid double-yellow.
  const yellowLanePositions: number[] = [];
  // White stripes: highway shoulder lines.
  const whiteLanePositions: number[] = [];

  // Emit one half-edge quad: a rectangle from `sx,sz` to `ex,ez` at the
  // given perpendicular half-width and colour. y interpolates linearly
  // between the two endpoint elevations so the road ramps over hills.
  const emitHalf = (
    sx: number, sz: number, ex: number, ez: number,
    ys: number, ye: number,
    px: number, pz: number, hex: number
  ): void => {
    c.setHex(hex);
    positions[vi++] = sx + px; positions[vi++] = ys; positions[vi++] = sz + pz;
    positions[vi++] = ex + px; positions[vi++] = ye; positions[vi++] = ez + pz;
    positions[vi++] = ex - px; positions[vi++] = ye; positions[vi++] = ez - pz;
    positions[vi++] = sx - px; positions[vi++] = ys; positions[vi++] = sz - pz;
    for (let k = 0; k < 4; k++) {
      colours[ci++] = c.r; colours[ci++] = c.g; colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 1; indices[ii++] = v + 2;
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 3;
    v += 4;
  };

  for (const e of edges) {
    const ta = grid.get(e.ax, e.ay);
    const tb = grid.get(e.bx, e.by);
    const tierA = ta?.roadType ?? 'local';
    const tierB = tb?.roadType ?? 'local';

    const ax = (e.ax + 0.5) * TILE_SIZE;
    const az = (e.ay + 0.5) * TILE_SIZE;
    const bx = (e.bx + 0.5) * TILE_SIZE;
    const bz = (e.by + 0.5) * TILE_SIZE;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len; // unit perpendicular x
    const nz = dx / len;  // unit perpendicular z
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;

    // Per-endpoint elevation (Alpha 2.3+): bridge tiles lift the road
    // deck to BRIDGE_LIFT; land roads stay at ROAD_LIFT plus the tile's
    // terrain elevation so the road sits ON the hill instead of being
    // buried in it. The midpoint y is the average — same linear ramp
    // profile the original full-edge quad produced.
    const yA = ta?.bridge ? BRIDGE_LIFT : (yLift + (ta?.elevation ?? 0));
    const yB = tb?.bridge ? BRIDGE_LIFT : (yLift + (tb?.elevation ?? 0));
    const yMid = (yA + yB) / 2;

    // A's half: tile A center → midpoint at A's tier width.
    const propsA = ROAD_TIER[tierA];
    const halfA = propsA.width / 2;
    emitHalf(ax, az, mx, mz, yA, yMid, nx * halfA, nz * halfA, propsA.color);

    // B's half: midpoint → tile B center at B's tier width.
    const propsB = ROAD_TIER[tierB];
    const halfB = propsB.width / 2;
    emitHalf(mx, mz, bx, bz, yMid, yB, nx * halfB, nz * halfB, propsB.color);

    // Lane stripes (Alpha 2.2 polish):
    //  - Local: dashed yellow centreline (two short dashes per edge).
    //  - Avenue: solid double-yellow centreline (two parallel solid lines).
    //  - Highway: white solid edge stripes near each shoulder.
    // Beta 1.6.18 — bridge tiles now get stripes too. Pre-1.6.18 they
    // were skipped on the theory that ramp stripes would "float in
    // mid-air", but the yStripe values follow the per-endpoint y
    // (which already accounts for bridge vs land), so a line segment
    // running from a land y to a bridge y naturally follows the ramp
    // surface. Without stripes, highway-over-water tiles went dark
    // mid-road and the lit-highway segments on either side looked
    // weirdly luminous in contrast.
    // Cross-tier edges (Beta 1.6.14) still skip stripes — the width
    // step at the boundary is the visual cue, and a half-length stripe
    // at one tier's style would read as a stub. Same-tier edges keep
    // the existing center-to-center stripe pattern unchanged.
    if (tierA !== tierB) {
      // Skip stripes on cross-tier edges.
    } else {
    // Use the shared tier; back-compat with the existing per-tier branches.
    const tier = tierA;
    const half = halfA;
    const px = nx * half;
    const pz = nz * half;
    const yStripeA = yA + 0.001;
    const yStripeB = yB + 0.001;
    if (tier === 'local') {
      yellowLanePositions.push(
        ax + dx * 0.18, yStripeA + (yStripeB - yStripeA) * 0.18, az + dz * 0.18,
        ax + dx * 0.42, yStripeA + (yStripeB - yStripeA) * 0.42, az + dz * 0.42,
        ax + dx * 0.58, yStripeA + (yStripeB - yStripeA) * 0.58, az + dz * 0.58,
        ax + dx * 0.82, yStripeA + (yStripeB - yStripeA) * 0.82, az + dz * 0.82
      );
    } else if (tier === 'avenue') {
      // Two solid yellow lines straddling the centreline by ~0.04 tile.
      const off = 0.04;
      const opx = px / half * off;
      const opz = pz / half * off;
      yellowLanePositions.push(
        ax + opx, yStripeA, az + opz,
        bx + opx, yStripeB, bz + opz,
        ax - opx, yStripeA, az - opz,
        bx - opx, yStripeB, bz - opz
      );
    } else {
      // Highway (Beta 1.4) — bidirectional divided multi-lane look:
      //   1. Solid WHITE edge stripes near each shoulder (outer
      //      boundary of the carriageway)
      //   2. Solid WHITE inner lane lines slightly inside the edge
      //      stripes (suggests one travel lane on each side of the
      //      median)
      //   3. Double-YELLOW median running down the centre (separates
      //      the two opposing directions — the dominant visual cue
      //      that this is a real divided highway, not a wide local)
      //
      // Pre-1.4 highways were one-way per tile and rendered a single
      // dashed white centerline. The new bidirectional model uses a
      // yellow median to signal "two-way" at a glance.
      const edgeInset = 0.05;
      const laneInset = 0.16;
      const sxEdge = px - (px / half) * edgeInset;
      const szEdge = pz - (pz / half) * edgeInset;
      const sxLane = px - (px / half) * laneInset;
      const szLane = pz - (pz / half) * laneInset;
      // Solid edge stripes, both shoulders.
      whiteLanePositions.push(
        ax + sxEdge, yStripeA, az + szEdge,
        bx + sxEdge, yStripeB, bz + szEdge,
        ax - sxEdge, yStripeA, az - szEdge,
        bx - sxEdge, yStripeB, bz - szEdge
      );
      // Inner lane lines (one per direction-of-travel).
      whiteLanePositions.push(
        ax + sxLane, yStripeA, az + szLane,
        bx + sxLane, yStripeB, bz + szLane,
        ax - sxLane, yStripeA, az - szLane,
        bx - sxLane, yStripeB, bz - szLane
      );
      // Double-yellow median — two parallel solid lines straddling
      // the centreline by 0.03 tiles each (same convention as the
      // avenue double-yellow, slightly tighter spacing to fit the
      // narrower lane width).
      const medianOff = 0.03;
      const mopx = px / half * medianOff;
      const mopz = pz / half * medianOff;
      yellowLanePositions.push(
        ax + mopx, yStripeA, az + mopz,
        bx + mopx, yStripeB, bz + mopz,
        ax - mopx, yStripeA, az - mopz,
        bx - mopx, yStripeB, bz - mopz
      );
    }
    }
  }

  // --- stub squares ---
  for (const s of stubs) {
    const t = grid.get(s.x, s.y);
    const tier = t?.roadType ?? 'local';
    const tierProps = ROAD_TIER[tier];
    const half = tierProps.width / 2;
    c.setHex(tierProps.color);
    const cx = (s.x + 0.5) * TILE_SIZE;
    const cz = (s.y + 0.5) * TILE_SIZE;
    const stubY = t?.bridge ? BRIDGE_LIFT : (yLift + (t?.elevation ?? 0));
    positions[vi++] = cx - half; positions[vi++] = stubY; positions[vi++] = cz - half;
    positions[vi++] = cx + half; positions[vi++] = stubY; positions[vi++] = cz - half;
    positions[vi++] = cx + half; positions[vi++] = stubY; positions[vi++] = cz + half;
    positions[vi++] = cx - half; positions[vi++] = stubY; positions[vi++] = cz + half;
    for (let k = 0; k < 4; k++) {
      colours[ci++] = c.r; colours[ci++] = c.g; colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 1; indices[ii++] = v + 2;
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 3;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normals.
  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    flatShading: true
  });
  const mesh = new Mesh(geom, mat);

  // Two LineSegments objects — yellow (local + avenue centerlines) and
  // white (highway shoulder stripes). Returning the white set as part of
  // the mesh group is cleaner than a third return field; we tack it onto
  // the mesh as a child so worldGroup tracks both via the same root.
  let lanes: LineSegments | null = null;
  if (yellowLanePositions.length > 0) {
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(yellowLanePositions), 3));
    lanes = new LineSegments(lg, new LineBasicMaterial({ color: THEME().roads.laneStripe }));
  }
  if (whiteLanePositions.length > 0) {
    const wg = new BufferGeometry();
    wg.setAttribute('position', new BufferAttribute(new Float32Array(whiteLanePositions), 3));
    const whiteLines = new LineSegments(wg, new LineBasicMaterial({ color: 0xe8e8e8 }));
    if (lanes) lanes.add(whiteLines);
    else lanes = whiteLines;
  }

  return { mesh, lanes };
}

function tierIndex(t: 'local' | 'avenue' | 'highway'): number {
  return t === 'local' ? 0 : t === 'avenue' ? 1 : 2;
}

/**
 * Upper-layer (Bridge Mode) road mesh (Alpha 2.12). Each bridgeRoad
 * edge gets a road quad lifted to BRIDGE_LIFT, plus support pillars
 * sliced into pairs at every bridgeRoad tile. Returns null if no
 * upper-layer roads exist on the grid.
 */
export function buildBridgeRoadMesh(grid: Grid): Group | null {
  const edges = Array.from(grid.iterBridgeRoadEdges());
  if (edges.length === 0) return null;

  const decks: BufferGeometry[] = [];
  const deckColours: number[] = [];
  const railColours: number[] = [];
  const rails: BufferGeometry[] = [];
  const pillars: BufferGeometry[] = [];
  const pillarColours: number[] = [];

  // Ramp logic (Alpha 2.13.1) — the FIRST and LAST tiles of an upper-
  // layer bridge segment ramp down to ground if a road exists there
  // too. A tile is a ramp if it has only ONE incident bridge edge AND
  // a ground road (so the bridge transitions to the ground network).
  const yAt = (tx: number, ty: number): number => {
    const t = grid.get(tx, ty);
    if (!t || !t.bridgeRoad) return ROAD_LIFT + (t?.elevation ?? 0);
    const incident = grid.incidentBridgeRoadEdgeCount(tx, ty);
    // Terminal + ground road → ramp down. Otherwise full deck height.
    if (incident <= 1 && t.road) return ROAD_LIFT + t.elevation;
    return BRIDGE_LIFT;
  };

  // Edge decks.
  for (const e of edges) {
    const ta = grid.get(e.ax, e.ay);
    const tb = grid.get(e.bx, e.by);
    const tierA = ta?.bridgeRoadType ?? 'local';
    const tierB = tb?.bridgeRoadType ?? 'local';
    // Beta 1.6.14 — bridges still use the lower tier (simple single-quad
    // edge). Ground roads got the full half-edge split because cross-tier
    // T-junctions on the ground are common; on bridges the same scenario
    // is rare enough that the wider rail/pillar refactor isn't worth the
    // complexity yet. Revisit if bridges grow real cross-tier junctions.
    const tier = tierIndex(tierA) <= tierIndex(tierB) ? tierA : tierB;
    const tierProps = ROAD_TIER[tier];
    const half = tierProps.width / 2;
    const ax = (e.ax + 0.5) * TILE_SIZE;
    const az = (e.ay + 0.5) * TILE_SIZE;
    const bx = (e.bx + 0.5) * TILE_SIZE;
    const bz = (e.by + 0.5) * TILE_SIZE;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const px = -dz / len * half;
    const pz = dx / len * half;
    const yA = yAt(e.ax, e.ay);
    const yB = yAt(e.bx, e.by);

    const deck = new BufferGeometry();
    const positions = new Float32Array([
      ax + px, yA, az + pz,
      bx + px, yB, bz + pz,
      bx - px, yB, bz - pz,
      ax - px, yA, az - pz
    ]);
    deck.setAttribute('position', new BufferAttribute(positions, 3));
    deck.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
    decks.push(deck);
    deckColours.push(tierProps.color);

    // Rail edges along both shoulders, sit slightly above the deck.
    // Build with explicit endpoint heights so the rail follows the ramp.
    const railH = 0.06;
    for (const sign of [1, -1]) {
      const sx = sign * px;
      const sz = sign * pz;
      const railPositions = new Float32Array([
        ax + sx - 0.0, yA + railH * 0.0, az + sz - 0.0,
        ax + sx,        yA + railH,       az + sz,
        bx + sx,        yB + railH,       bz + sz,
        bx + sx - 0.0, yB + railH * 0.0, bz + sz - 0.0
      ]);
      // Hoist the rail bar up to floor + railH; build as a thin twisted
      // strip. Easier: just pair lower + upper line and use them as a
      // strip via two triangles.
      const positionsRail = new Float32Array([
        // lower-left, upper-left, upper-right, lower-right (along axis)
        ax + sx, yA,         az + sz,
        ax + sx, yA + railH, az + sz,
        bx + sx, yB + railH, bz + sz,
        bx + sx, yB,         bz + sz
      ]);
      const railGeom = new BufferGeometry();
      railGeom.setAttribute('position', new BufferAttribute(positionsRail, 3));
      railGeom.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
      // Suppress unused railPositions array (was a previous prototype).
      void railPositions;
      // Add a mirror face so the rail isn't culled when viewed from the other side.
      const back = new BufferGeometry();
      back.setAttribute('position', new BufferAttribute(positionsRail, 3));
      back.setIndex(new BufferAttribute(new Uint32Array([0, 2, 1, 0, 3, 2]), 1));
      rails.push(railGeom);
      railColours.push(0xb6a98a);
      rails.push(back);
      railColours.push(0xb6a98a);
      // Add slight thickness — push a duplicated rail shifted inward a hair.
      const inset = 0.012;
      const insetX = sign * (px === 0 ? 0 : -Math.sign(px) * inset);
      const insetZ = sign * (pz === 0 ? 0 : -Math.sign(pz) * inset);
      const inner = new Float32Array([
        ax + sx + insetX, yA,         az + sz + insetZ,
        ax + sx + insetX, yA + railH, az + sz + insetZ,
        bx + sx + insetX, yB + railH, bz + sz + insetZ,
        bx + sx + insetX, yB,         bz + sz + insetZ
      ]);
      const innerGeom = new BufferGeometry();
      innerGeom.setAttribute('position', new BufferAttribute(inner, 3));
      innerGeom.setIndex(new BufferAttribute(new Uint32Array([0, 2, 1, 0, 3, 2]), 1));
      rails.push(innerGeom);
      railColours.push(0xa0937a);
    }
  }

  // Support pillars at each upper-layer tile that has a bridge edge but
  // is NOT also auto-bridged over water. Pillar height matches the deck
  // height at that tile (terminals have shorter pillars matching ramp).
  for (const t of grid.iter()) {
    if (!t.bridgeRoad) continue;
    if (t.bridge) continue; // ground-water bridge already pillared
    const tileY = yAt(t.x, t.y);
    // No pillars on a ramped-down terminal (the deck is at ground level
    // there — pillars would stick up above the road).
    if (tileY <= ROAD_LIFT + t.elevation + 0.02) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    let horizontal = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (grid.hasBridgeRoadEdge(t.x, t.y, t.x + dx, t.y + dy)) {
          if (Math.abs(dx) > Math.abs(dy)) horizontal = true;
        }
      }
    }
    const tierProps = ROAD_TIER[t.bridgeRoadType];
    const half = tierProps.width / 2;
    const pillarH = tileY + 0.05;
    const pillarYBase = -0.05;
    const pillarOffset = half + 0.04;
    const offsets: Array<[number, number]> = horizontal
      ? [[0, -pillarOffset], [0, pillarOffset]]
      : [[-pillarOffset, 0], [pillarOffset, 0]];
    for (const [ox, oz] of offsets) {
      const pillar = new BoxGeometry(0.06, pillarH, 0.06);
      pillar.translate(cx + ox, pillarYBase + pillarH / 2, cz + oz);
      pillars.push(pillar);
      pillarColours.push(0x6e6e6e);
    }
  }

  const group = new Group();
  if (decks.length > 0) {
    const merged = mergeGeoms(decks, deckColours);
    group.add(new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  }
  if (rails.length > 0) {
    const merged = mergeGeoms(rails, railColours);
    group.add(new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  }
  if (pillars.length > 0) {
    const merged = mergeGeoms(pillars, pillarColours);
    group.add(new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  }
  return group;
}

/**
 * Stop sign markers + (Beta 1.4) highway on/off-ramp asphalt flares
 * + (legacy) highway arrows for any save-loaded tile that still has a
 * non-default highwayDir.
 *
 * Beta 1.4: highway direction arrows no longer render for newly-painted
 * highways (the highwayDir field is unused on fresh paints). Old saves
 * with painted directions DO still render a faded chevron — players who
 * loaded a Beta 1.3 save get a visual hint that those tiles used to be
 * one-way, but the simulation treats them as bidirectional.
 */
export function buildRoadOrnamentsGroup(grid: Grid): Group | null {
  const arrows: BufferGeometry[] = [];
  const arrowColours: number[] = [];
  const stops: BufferGeometry[] = [];
  const stopColours: number[] = [];
  const rampFlares: BufferGeometry[] = [];
  const rampFlareColours: number[] = [];

  for (const t of grid.iter()) {
    if (!t.road) continue;
    // Bridge tiles override elevation: their deck floats over water at
    // BRIDGE_LIFT regardless of the (negative) underlying elevation.
    const tileY = t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
    // Beta 1.4 — legacy highway arrows render only for non-default
    // highwayDir on existing save data. New paints leave highwayDir
    // at -1 (the default), so this branch is skipped.
    if (t.roadType === 'highway' && t.highwayDir >= 0 && t.highwayDir < 8) {
      const cx = (t.x + 0.5) * TILE_SIZE;
      const cz = (t.y + 0.5) * TILE_SIZE;
      const offset = DIR_OFFSETS[t.highwayDir]!;
      const yaw = Math.atan2(offset[0], offset[1]);
      const chevron = makeChevronGeom(0.16, 0.12);
      chevron.rotateY(yaw);
      chevron.translate(cx, tileY + 0.004, cz);
      arrows.push(chevron);
      // Dim grey — these are legacy hints, not active directional cues.
      arrowColours.push(0x5a5a5a);
    }
    // Beta 1.4 — on/off-ramp flares at every highway↔non-highway
    // adjacency. Renders a slim trapezoidal asphalt extension into
    // the neighbouring non-highway tile so the connection visually
    // reads as a merge ramp, not an abrupt seam. The merge cue helps
    // the player understand "this is where cars enter and leave the
    // big road" without any one-way arrow.
    if (t.roadType === 'highway') {
      for (let d = 0; d < 8; d += 2) {     // cardinals only
        const off = DIR_OFFSETS[d]!;
        const nx = t.x + off[0];
        const ny = t.y + off[1];
        const n = grid.get(nx, ny);
        if (!n || !n.road) continue;
        if (n.roadType === 'highway') continue;   // highway↔highway: no ramp
        if (!grid.hasRoadEdge(t.x, t.y, nx, ny)) continue;
        // Trapezoidal flare: wide at the highway side, tapering down to
        // the local-road width on the neighbour's side. Lives just above
        // the asphalt so it reads as a merge lane painted onto the road.
        const cxA = (t.x + 0.5) * TILE_SIZE;
        const czA = (t.y + 0.5) * TILE_SIZE;
        const cxB = (nx + 0.5) * TILE_SIZE;
        const czB = (ny + 0.5) * TILE_SIZE;
        const hwHalf = ROAD_TIER.highway.width / 2;
        const localHalf = ROAD_TIER[n.roadType].width / 2;
        // Perpendicular to the highway→local direction.
        const dxAB = cxB - cxA;
        const dzAB = czB - czA;
        const lenAB = Math.hypot(dxAB, dzAB) || 1;
        const ppx = -dzAB / lenAB;
        const ppz = dxAB / lenAB;
        // Endpoints of the flare: full highway width at the boundary
        // between A and B, tapering to local-road width at B's centre.
        const boundaryX = (cxA + cxB) / 2;
        const boundaryZ = (czA + czB) / 2;
        // Stretch 0.30 into the highway tile + 0.45 into the local
        // tile so the flare bridges the seam clearly. (Pure boundary
        // flares were too short to read at zoom-out.)
        const intoHwX = cxA + dxAB * (-0.30) / lenAB * lenAB;
        const intoHwZ = czA + dzAB * (-0.30) / lenAB * lenAB;
        void intoHwX; void intoHwZ;
        const startX = boundaryX - dxAB / lenAB * 0.20;
        const startZ = boundaryZ - dzAB / lenAB * 0.20;
        const endX = boundaryX + dxAB / lenAB * 0.30;
        const endZ = boundaryZ + dzAB / lenAB * 0.30;
        const flareHalfStart = hwHalf * 0.95;
        const flareHalfEnd = Math.max(localHalf, hwHalf * 0.45);
        const flarePositions = new Float32Array([
          startX + ppx * flareHalfStart, tileY + 0.0015, startZ + ppz * flareHalfStart,
          endX   + ppx * flareHalfEnd,   tileY + 0.0015, endZ   + ppz * flareHalfEnd,
          endX   - ppx * flareHalfEnd,   tileY + 0.0015, endZ   - ppz * flareHalfEnd,
          startX - ppx * flareHalfStart, tileY + 0.0015, startZ - ppz * flareHalfStart
        ]);
        const flareIndices = new Uint32Array([0, 1, 2, 0, 2, 3]);
        const flareGeom = new BufferGeometry();
        flareGeom.setAttribute('position', new BufferAttribute(flarePositions, 3));
        flareGeom.setIndex(new BufferAttribute(flareIndices, 1));
        rampFlares.push(flareGeom);
        rampFlareColours.push(0x2a2a2a);
      }
    }
    if (t.stopSign) {
      // Place one small stop sign per road approach, on the right shoulder
      // of incoming traffic — i.e. where a real stop sign goes (driver's
      // right as they arrive at the intersection). For a 4-way intersection
      // we get four signs around the corners.
      const cx = (t.x + 0.5) * TILE_SIZE;
      const cz = (t.y + 0.5) * TILE_SIZE;
      const EDGE = TILE_SIZE * 0.40;       // distance from tile centre to approach edge
      const SHOULDER = TILE_SIZE * 0.22;   // offset toward right shoulder of incoming car
      for (let d = 0; d < 8; d++) {
        const off = DIR_OFFSETS[d]!;
        const nx = t.x + off[0];
        const ny = t.y + off[1];
        // Only place a sign for this side if a road actually approaches
        // from there (an edge to that neighbour exists OR neighbour is road).
        if (!grid.hasRoadEdge(t.x, t.y, nx, ny)) continue;
        // Incoming motion vector = -off. Right shoulder is that rotated 90°
        // CW in XZ (top-down): (vx, vz) → (vz, -vx). With v = (-off[0], -off[1])
        // → right = (-off[1], off[0]).
        const px = cx + off[0] * EDGE - off[1] * SHOULDER;
        const pz = cz + off[1] * EDGE + off[0] * SHOULDER;

        // Smaller than before — these are roadside furniture, not landmarks.
        const post = new CylinderGeometry(0.012, 0.012, 0.10, 6);
        post.translate(px, tileY + 0.05, pz);
        stops.push(post);
        stopColours.push(0x666666);

        const sign = new CylinderGeometry(0.05, 0.05, 0.02, 8);
        sign.rotateX(Math.PI / 2);
        sign.translate(px, tileY + 0.10, pz);
        stops.push(sign);
        stopColours.push(THEME().roads.stopSignBody);

        // White face hint for the silhouette of a stop sign.
        const face = new CylinderGeometry(0.035, 0.035, 0.003, 8);
        face.rotateX(Math.PI / 2);
        face.translate(px, tileY + 0.111, pz);
        stops.push(face);
        stopColours.push(THEME().roads.stopSignText);
      }
    }
  }

  // Zebra crosswalks (Alpha 2.2 — was a single pad in 2.0). Four cardinal
  // approaches at each walkable intersection get a striped pattern: 4
  // alternating white pads spanning the road width, perpendicular to the
  // approach direction. Reads unmistakably as a crosswalk.
  for (const t of grid.iter()) {
    if (!t.road || t.roadType === 'highway') continue;
    if (grid.incidentRoadEdgeCount(t.x, t.y) < 3) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    const tileY = t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
    const roadHalf = ROAD_TIER[t.roadType].width / 2;
    const sides: Array<[number, number]> = [
      [0, -1], [1, 0], [0, 1], [-1, 0]
    ];
    const STRIPE_COUNT = 4;
    const STRIPE_WIDTH = 0.04;
    const STRIPE_GAP = 0.02;
    const totalSpan = STRIPE_COUNT * STRIPE_WIDTH + (STRIPE_COUNT - 1) * STRIPE_GAP;
    for (const [dx, dz] of sides) {
      const nbr = grid.get(t.x + dx, t.y + dz);
      if (!nbr || !nbr.road) continue;
      // Lay stripes spanning the road width (perpendicular to approach).
      // For an N approach (dx=0, dz=-1), stripes are oriented E-W and
      // stacked along Z (the approach direction).
      for (let s = 0; s < STRIPE_COUNT; s++) {
        const stripeOffset = -totalSpan / 2 + s * (STRIPE_WIDTH + STRIPE_GAP) + STRIPE_WIDTH / 2;
        const stripe = new BoxGeometry(
          Math.abs(dz) > 0 ? roadHalf * 1.7 : STRIPE_WIDTH,
          0.005,
          Math.abs(dz) > 0 ? STRIPE_WIDTH : roadHalf * 1.7
        );
        stripe.translate(
          cx + dx * (roadHalf + 0.02) + (Math.abs(dz) > 0 ? 0 : stripeOffset),
          tileY + 0.005,
          cz + dz * (roadHalf + 0.02) + (Math.abs(dz) > 0 ? stripeOffset : 0)
        );
        stops.push(stripe);
        stopColours.push(0xf2efe5); // bright white
      }
    }
  }

  // Road-attached bus stops (Alpha 2.0). A small bench + sign rendered on
  // the sidewalk pad of the road tile. Choose the side facing the most
  // adjacent buildings/zones — that's where the riders are.
  for (const t of grid.iter()) {
    if (!t.road || t.roadType === 'highway' || !t.busStop) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    const tileY = t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
    const side = pickStopSide(grid, t.x, t.y);
    // Sidewalk-edge offset perpendicular to the road centre, on `side`.
    const off = TILE_SIZE * 0.35;
    const sx = cx + side[0] * off;
    const sz = cz + side[1] * off;
    // Bench: a low flat box.
    const bench = new BoxGeometry(0.18, 0.04, 0.07);
    bench.translate(sx, tileY + 0.04, sz);
    stops.push(bench);
    stopColours.push(0x6f5f43);
    // Sign post — yellow lollipop on a thin stem.
    const stem = new CylinderGeometry(0.013, 0.013, 0.18, 6);
    stem.translate(sx + side[0] * 0.06, tileY + 0.09, sz + side[1] * 0.06);
    stops.push(stem);
    stopColours.push(0x444444);
    const head = new BoxGeometry(0.07, 0.05, 0.02);
    head.translate(sx + side[0] * 0.06, tileY + 0.20, sz + side[1] * 0.06);
    stops.push(head);
    stopColours.push(0xe5c25a);
  }

  // Traffic lights — a tall pole at the centre of each lit intersection
  // with three small disc "lenses" (red/amber/green stack). Static, no
  // phase animation here; phase state lives in TrafficLights and a future
  // pass can light up the active lens via vertex colour swap.
  const lights: BufferGeometry[] = [];
  const lightColours: number[] = [];
  for (const t of grid.iter()) {
    if (!t.trafficLight) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    const tileY = t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
    // Pole.
    const pole = new CylinderGeometry(0.015, 0.015, 0.32, 6);
    pole.translate(cx, tileY + 0.16, cz);
    lights.push(pole);
    lightColours.push(0x444444);
    // Housing.
    const housing = new CylinderGeometry(0.05, 0.05, 0.18, 6);
    housing.translate(cx, tileY + 0.32 + 0.09, cz);
    lights.push(housing);
    lightColours.push(0x222222);
    // Three lenses — red, amber, green stack.
    const lensRadius = 0.025;
    const lensZ = tileY + 0.32;
    const lenses: Array<[number, number]> = [
      [lensZ + 0.045, 0xd03a3a], // red on top
      [lensZ + 0.090, 0xf2cd5c], // amber middle
      [lensZ + 0.135, 0x4ad06d]  // green bottom
    ];
    for (const [y, color] of lenses) {
      const lens = new CylinderGeometry(lensRadius, lensRadius, 0.012, 8);
      lens.rotateZ(Math.PI / 2);
      lens.translate(cx + 0.055, y, cz);
      lights.push(lens);
      lightColours.push(color);
    }
  }

  // Bridge pillars (Alpha 2.3) — for each bridge tile (road tile flagged
  // as bridge by Grid.setRoad), drop two short stone pillars from the
  // water surface up to the bridge deck, on either side of the road
  // perpendicular axis. Determines axis from the dominant incident-edge
  // direction so pillars stand sensibly under E-W or N-S spans alike.
  // Bridges (Beta 1.1.3 visual rework). Per-tile geometry:
  //   - Concrete deck slab hanging under the asphalt road quad
  //   - 2 stout concrete pillars dropping below the water surface,
  //     with a footing block at the waterline + a capital cap where
  //     they meet the deck
  //   - Concrete parapet walls along both shoulders, with a darker
  //     top-cap rail
  //   - Optional jersey-style sloped kerb between road + parapet
  //
  // Color palette (warm concrete, matches the lampposts + civic monuments):
  const PILLAR_CONCRETE = 0x9a948a;
  const PILLAR_DARK = 0x6e6a64;
  const DECK_CONCRETE = 0xb0aa9c;
  const PARAPET_CONCRETE = 0xc0baad;
  const PARAPET_CAP = 0x787268;
  const KERB = 0x9a948a;
  const pillars: BufferGeometry[] = [];
  const pillarColours: number[] = [];
  for (const t of grid.iter()) {
    if (!t.road || !t.bridge) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    // Approximate axis: look at incident road edges; if any edge is
    // horizontal (dx != 0, dz == 0) treat the bridge as east-west, else
    // north-south. Pillars sit perpendicular to that axis so they're
    // under the edges of the road deck.
    let horizontal = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (grid.hasRoadEdge(t.x, t.y, t.x + dx, t.y + dy)) {
          if (Math.abs(dx) > Math.abs(dy)) horizontal = true;
        }
      }
    }
    const tierProps = ROAD_TIER[t.roadType];
    const half = tierProps.width / 2;

    // --- Concrete deck slab under the asphalt --------------------------
    // Slightly wider than the road, hangs visually under the road quad.
    // Span the full tile length so adjacent bridge tiles' decks meet.
    const deckSpan = TILE_SIZE * 1.0;
    const deckThick = 0.06;
    const deckOverhang = 0.06;
    const deckW = (half * 2) + deckOverhang * 2;
    const deckBoxX = horizontal ? deckSpan : deckW;
    const deckBoxZ = horizontal ? deckW : deckSpan;
    const deck = new BoxGeometry(deckBoxX, deckThick, deckBoxZ);
    deck.translate(cx, BRIDGE_LIFT - deckThick / 2 - 0.005, cz);
    pillars.push(deck);
    pillarColours.push(DECK_CONCRETE);

    // --- 2 stout concrete pillars (perpendicular to the bridge axis) ---
    // Drop from BRIDGE_LIFT down to y=-0.30 (well below water surface).
    const pillarTopY = BRIDGE_LIFT - deckThick;        // capital sits just under deck
    const pillarBottomY = -0.30;
    const pillarH = pillarTopY - pillarBottomY;
    const pillarW = 0.13;
    const pillarOffset = half + 0.02;
    const pOffsets: Array<[number, number]> = horizontal
      ? [[0, -pillarOffset], [0, pillarOffset]]
      : [[-pillarOffset, 0], [pillarOffset, 0]];
    for (const [ox, oz] of pOffsets) {
      // Main column.
      const col = new BoxGeometry(pillarW, pillarH, pillarW);
      col.translate(cx + ox, pillarBottomY + pillarH / 2, cz + oz);
      pillars.push(col);
      pillarColours.push(PILLAR_CONCRETE);
      // Capital cap at the top — slightly wider so it visually "supports"
      // the deck like a real concrete pier head.
      const cap = new BoxGeometry(pillarW + 0.04, 0.05, pillarW + 0.04);
      cap.translate(cx + ox, pillarTopY - 0.025, cz + oz);
      pillars.push(cap);
      pillarColours.push(PILLAR_DARK);
      // Footing block at the water line — wider square base above the
      // submerged column for the "pier rises out of the water" read.
      const footing = new BoxGeometry(pillarW + 0.08, 0.06, pillarW + 0.08);
      footing.translate(cx + ox, -0.04, cz + oz);
      pillars.push(footing);
      pillarColours.push(PILLAR_DARK);
    }

    // --- Concrete parapet walls along both shoulders -------------------
    // Thicker than the previous thin rails, with a darker cap on top.
    const parapetH = 0.13;
    const parapetThick = 0.06;
    const parapetSpan = TILE_SIZE * 1.0;
    if (horizontal) {
      // North + south shoulders.
      for (const sign of [-1, 1] as const) {
        const wallZ = cz + sign * (half + parapetThick / 2 + 0.005);
        const wall = new BoxGeometry(parapetSpan, parapetH, parapetThick);
        wall.translate(cx, BRIDGE_LIFT + parapetH / 2, wallZ);
        pillars.push(wall);
        pillarColours.push(PARAPET_CONCRETE);
        // Top cap rail — slightly wider, darker grey.
        const cap = new BoxGeometry(parapetSpan, 0.022, parapetThick + 0.018);
        cap.translate(cx, BRIDGE_LIFT + parapetH + 0.011, wallZ);
        pillars.push(cap);
        pillarColours.push(PARAPET_CAP);
      }
      // Slim concrete kerbs between road surface and parapet (read as
      // the curb separating the lane from the barrier wall).
      for (const sign of [-1, 1] as const) {
        const kerbZ = cz + sign * (half - 0.018);
        const kerb = new BoxGeometry(parapetSpan, 0.025, 0.035);
        kerb.translate(cx, BRIDGE_LIFT + 0.012, kerbZ);
        pillars.push(kerb);
        pillarColours.push(KERB);
      }
    } else {
      // West + east shoulders.
      for (const sign of [-1, 1] as const) {
        const wallX = cx + sign * (half + parapetThick / 2 + 0.005);
        const wall = new BoxGeometry(parapetThick, parapetH, parapetSpan);
        wall.translate(wallX, BRIDGE_LIFT + parapetH / 2, cz);
        pillars.push(wall);
        pillarColours.push(PARAPET_CONCRETE);
        const cap = new BoxGeometry(parapetThick + 0.018, 0.022, parapetSpan);
        cap.translate(wallX, BRIDGE_LIFT + parapetH + 0.011, cz);
        pillars.push(cap);
        pillarColours.push(PARAPET_CAP);
      }
      for (const sign of [-1, 1] as const) {
        const kerbX = cx + sign * (half - 0.018);
        const kerb = new BoxGeometry(0.035, 0.025, parapetSpan);
        kerb.translate(kerbX, BRIDGE_LIFT + 0.012, cz);
        pillars.push(kerb);
        pillarColours.push(KERB);
      }
    }
  }

  // Sidewalk decorations (Alpha 2.6) — small street furniture on
  // non-highway road tiles next to a developed-commercial / mixed-use
  // tile. Distributes hydrants / parking meters / bike racks
  // deterministically by tile hash so the same block always shows the
  // same pieces. Only ~25% of eligible tiles get a piece — too many
  // would crowd the sidewalk visually.
  for (const t of grid.iter()) {
    if (!t.road || t.roadType === 'highway') continue;
    if (t.bridge) continue;
    if (t.busStop || t.stopSign || t.trafficLight) continue;
    // Find a commercial / mixed-use 4-neighbour with a developed building
    // (density > 0). No commercial neighbour = no street furniture.
    let side: [number, number] | null = null;
    const dirs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dz] of dirs) {
      const n = grid.get(t.x + dx, t.y + dz);
      if (!n) continue;
      if ((n.zone === 'commercial' || n.zone === 'mixed') && n.density > 0) {
        side = [dx, dz];
        break;
      }
    }
    if (!side) continue;
    // Hash gates placement to ~30% of eligible tiles.
    const h = Math.abs(((t.x * 2654435761) ^ (t.y * 1597334677)) | 0);
    if ((h % 100) >= 30) continue;
    const tileY = ROAD_LIFT + t.elevation;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    // Sidewalk pad position: outside the road's half-width on the chosen side.
    const roadHalf = ROAD_TIER[t.roadType].width / 2;
    const padOff = roadHalf + 0.06;
    const sx = cx + side[0] * padOff;
    const sz = cz + side[1] * padOff;
    // Pick one of three pieces by a different hash slice.
    const piece = (h >> 7) % 3;
    if (piece === 0) {
      // Hydrant — short red-and-yellow squat cylinder with two side ports.
      const body = new CylinderGeometry(0.04, 0.045, 0.10, 8);
      body.translate(sx, tileY + 0.05, sz);
      stops.push(body);
      stopColours.push(0xc04a3a);
      const cap = new CylinderGeometry(0.045, 0.045, 0.022, 8);
      cap.translate(sx, tileY + 0.111, sz);
      stops.push(cap);
      stopColours.push(0xe5c25a);
    } else if (piece === 1) {
      // Parking meter — thin grey post + small head box.
      const post = new CylinderGeometry(0.013, 0.013, 0.18, 6);
      post.translate(sx, tileY + 0.09, sz);
      stops.push(post);
      stopColours.push(0x707070);
      const head = new BoxGeometry(0.05, 0.08, 0.04);
      head.translate(sx, tileY + 0.22, sz);
      stops.push(head);
      stopColours.push(0x4a4a4a);
      const screen = new BoxGeometry(0.04, 0.04, 0.005);
      screen.translate(sx + (Math.abs(side[0]) > 0 ? 0 : 0.025) - (side[0] === 0 ? 0 : side[0] * 0.026),
                       tileY + 0.23,
                       sz + (Math.abs(side[1]) > 0 ? 0 : 0.025) - (side[1] === 0 ? 0 : side[1] * 0.026));
      stops.push(screen);
      stopColours.push(0x9c9c9c);
    } else {
      // Bike rack — three vertical loops on a short crossbar. Approximate
      // a loop with a top box + two side stems for low-poly silhouette.
      const horizontal = side[1] !== 0; // axis perpendicular to road runs along x
      const rackLen = 0.18;
      const stems: Array<[number, number]> = [
        [-rackLen / 2, 0],
        [0, 0],
        [rackLen / 2, 0]
      ];
      // Cross bar.
      const cross = horizontal
        ? new BoxGeometry(rackLen, 0.018, 0.022)
        : new BoxGeometry(0.022, 0.018, rackLen);
      cross.translate(sx, tileY + 0.10, sz);
      stops.push(cross);
      stopColours.push(0x4d6a8e);
      // Three loops.
      for (const [ox, _] of stems) {
        const loopX = horizontal ? sx + ox : sx;
        const loopZ = horizontal ? sz : sz + ox;
        const top = horizontal
          ? new BoxGeometry(0.04, 0.022, 0.022)
          : new BoxGeometry(0.022, 0.022, 0.04);
        top.translate(loopX, tileY + 0.18, loopZ);
        stops.push(top);
        stopColours.push(0x4d6a8e);
        // Two thin stems forming the loop.
        const stemL = new BoxGeometry(0.012, 0.08, 0.012);
        stemL.translate(loopX - (horizontal ? 0.018 : 0), tileY + 0.14, loopZ - (horizontal ? 0 : 0.018));
        stops.push(stemL);
        stopColours.push(0x4d6a8e);
        const stemR = new BoxGeometry(0.012, 0.08, 0.012);
        stemR.translate(loopX + (horizontal ? 0.018 : 0), tileY + 0.14, loopZ + (horizontal ? 0 : 0.018));
        stops.push(stemR);
        stopColours.push(0x4d6a8e);
      }
    }
  }

  // Highway interchange ramps (Alpha 4.16, cleaner visual in 4.17). For
  // each ramp tile, render a clean visual that reads as "merge lane":
  //  - Subtle dark-asphalt extension along the highway shoulder.
  //  - Two clean parallel white merge stripes converging across the tile.
  //  - A real exit sign on the shoulder facing the local road (post +
  //    green signboard with white EXIT text bar).
  // Cleaner than the original chevron-clutter — same spatial information
  // but reads as actual highway design rather than ground decals.
  const RAMP_ASPHALT_DARK = 0x2a2e36;
  const RAMP_WHITE = 0xf2efe5;
  const RAMP_SIGN_GREEN = 0x2f7a3a;
  const RAMP_POST = 0x9ea4b0;
  for (const t of grid.iter()) {
    if (!t.road || !t.ramp) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    const tileY = t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
    const yLift = tileY + 0.005;
    const halfRoad = ROAD_TIER[t.roadType].width / 2;
    // Find the highway side (which neighbour is the highway). The exit
    // sign goes on the OPPOSITE shoulder; the merge stripes orient
    // perpendicular to the merge direction.
    let highwayDx = 0, highwayDz = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = grid.get(t.x + dx, t.y + dz);
      if (n && n.road && n.roadType === 'highway') {
        highwayDx = dx; highwayDz = dz;
        break;
      }
    }
    // Asphalt shoulder extension toward the highway side — fills the
    // visual gap between the ramp tile and the highway tile so they
    // read as one continuous surface, not two separate roads meeting.
    if (highwayDx !== 0 || highwayDz !== 0) {
      const shoulder = new BoxGeometry(
        Math.abs(highwayDz) > 0 ? halfRoad * 1.4 : 0.18,
        0.012,
        Math.abs(highwayDz) > 0 ? 0.18 : halfRoad * 1.4
      );
      shoulder.translate(
        cx + highwayDx * (halfRoad + 0.05),
        yLift,
        cz + highwayDz * (halfRoad + 0.05)
      );
      stops.push(shoulder);
      stopColours.push(RAMP_ASPHALT_DARK);
    }
    // Two parallel white merge stripes oriented PERPENDICULAR to the
    // merge direction. They visually communicate "lane being added/
    // removed" in a way drivers know at a glance.
    if (highwayDx !== 0 || highwayDz !== 0) {
      const isHorizontalMerge = Math.abs(highwayDx) > 0;
      for (const offset of [-0.10, 0.10]) {
        const stripe = new BoxGeometry(
          isHorizontalMerge ? 0.20 : 0.020,
          0.005,
          isHorizontalMerge ? 0.020 : 0.20
        );
        stripe.translate(
          cx + (isHorizontalMerge ? 0 : offset),
          yLift + 0.008,
          cz + (isHorizontalMerge ? offset : 0)
        );
        stops.push(stripe);
        stopColours.push(RAMP_WHITE);
      }
    }
    // Exit sign post on the shoulder facing the local road (away from
    // highway). Same as before but slightly polished — taller post,
    // larger signboard, white text-bar across.
    if (highwayDx !== 0 || highwayDz !== 0) {
      const sx = -highwayDx, sz = -highwayDz;
      const px = cx + sx * (halfRoad + 0.06);
      const pz = cz + sz * (halfRoad + 0.06);
      const post = new CylinderGeometry(0.014, 0.014, 0.22, 6);
      post.translate(px, yLift + 0.110, pz);
      stops.push(post);
      stopColours.push(RAMP_POST);
      // Larger green signboard
      const signW = Math.abs(sz) > 0 ? 0.18 : 0.025;
      const signD = Math.abs(sz) > 0 ? 0.025 : 0.18;
      const sign = new BoxGeometry(signW, 0.07, signD);
      sign.translate(px, yLift + 0.245, pz);
      stops.push(sign);
      stopColours.push(RAMP_SIGN_GREEN);
      // White stripe across the sign reading as "EXIT" text bar
      const textBar = new BoxGeometry(signW * 0.75, 0.008, signD * 0.75);
      textBar.translate(px, yLift + 0.245, pz);
      stops.push(textBar);
      stopColours.push(RAMP_WHITE);
    }
  }

  if (
    arrows.length === 0 && stops.length === 0 && lights.length === 0 &&
    pillars.length === 0 && rampFlares.length === 0
  ) return null;
  const group = new Group();
  if (rampFlares.length > 0) {
    // Render BEFORE arrows/stops so they sit under any other ornaments.
    const merged = mergeGeoms(rampFlares, rampFlareColours);
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(mesh);
  }
  if (arrows.length > 0) {
    const merged = mergeGeoms(arrows, arrowColours);
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(mesh);
  }
  if (stops.length > 0) {
    const merged = mergeGeoms(stops, stopColours);
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(mesh);
  }
  if (lights.length > 0) {
    const merged = mergeGeoms(lights, lightColours);
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(mesh);
  }
  if (pillars.length > 0) {
    const merged = mergeGeoms(pillars, pillarColours);
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(mesh);
  }
  return group;
}

// --- Roundabouts (Beta 1.8) ---------------------------------------------

/** Flat ring (annulus) in the XZ plane at height `y`, centred at (wx,wz),
 *  spanning [arcStart, arcEnd] (full circle by default). Uncoloured — the
 *  caller pairs it with a hex in mergeGeoms. rInner=0 yields a filled disc. */
function roundaboutAnnulus(
  wx: number, wz: number, rInner: number, rOuter: number,
  y: number, segs: number, arcStart = 0, arcEnd = Math.PI * 2
): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < segs; s++) {
    const a0 = arcStart + (arcEnd - arcStart) * (s / segs);
    const a1 = arcStart + (arcEnd - arcStart) * ((s + 1) / segs);
    const c0 = Math.cos(a0), n0 = Math.sin(a0);
    const c1 = Math.cos(a1), n1 = Math.sin(a1);
    const b = pos.length / 3;
    pos.push(
      wx + c0 * rInner, y, wz + n0 * rInner,
      wx + c0 * rOuter, y, wz + n0 * rOuter,
      wx + c1 * rOuter, y, wz + n1 * rOuter,
      wx + c1 * rInner, y, wz + n1 * rInner
    );
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

/** Flat triangle in the XZ plane from three world points at height `y`. */
function roundaboutTri(
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number, y: number
): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    ax, y, az, bx, y, bz, cx, y, cz
  ]), 3));
  g.setIndex([0, 1, 2]);
  return g;
}

/**
 * Detailed roundabout mesh (Beta 1.8). One merged vertex-coloured Mesh for
 * ALL roundabouts on the map (single draw call). Per roundabout: circular
 * asphalt ring, white outer edge stripe, dashed yellow lane circle, four
 * CCW directional arrows, a raised concrete curb, a grassy central island,
 * and a fountain/monument centrepiece (the 3×3 also gets a ring of trees +
 * flower beds). The circular asphalt replaces the square road quads, which
 * buildRoadMesh suppresses for internal ring↔ring edges.
 */
export function buildRoundaboutsGroup(grid: Grid): Group | null {
  const anchors: Array<{ x: number; y: number; size: number }> = [];
  for (const t of grid.iter()) {
    if (t.roundaboutSize >= 2) anchors.push({ x: t.x, y: t.y, size: t.roundaboutSize });
  }
  if (anchors.length === 0) return null;

  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];
  const add = (g: BufferGeometry, hex: number): void => { geoms.push(g); colours.push(hex); };

  // Palette — themed where a theme colour exists, tinted literals otherwise.
  const asphalt = ROAD_TIER.local.color;
  const stripe = THEME().roads.laneStripe;     // yellow centre-line
  const white = tint(0xece8e0);
  const curbCol = tint(0xb9b2a0);
  const grassCol = THEME().terrain.grass;
  const stone = tint(0xcfc8b6);
  const water = tint(0x4d8eb9);
  const gold = tint(0xeec453);
  const treeLeaf = tint(0x2f6a2d);
  const treeTrunk = tint(0x6e3e1d);
  const flowerA = tint(0xd84545);
  const flowerB = tint(0xf2cd5c);

  for (const a of anchors) {
    const cx = a.x + (a.size - 1) / 2;
    const cy = a.y + (a.size - 1) / 2;
    const wx = (cx + 0.5) * TILE_SIZE;
    const wz = (cy + 0.5) * TILE_SIZE;
    const outerR = a.size * 0.5 * TILE_SIZE - 0.03;
    const roadW = a.size === 3 ? 0.52 : 0.44;
    const innerR = Math.max(0.2, outerR - roadW);   // island edge radius
    const segs = a.size === 3 ? 44 : 32;
    const yRoad = ROAD_LIFT + 0.012;
    const yMark = yRoad + 0.006;

    // Asphalt ring + white outer edge stripe.
    add(roundaboutAnnulus(wx, wz, innerR, outerR, yRoad, segs), asphalt);
    add(roundaboutAnnulus(wx, wz, outerR - 0.05, outerR - 0.02, yMark, segs), white);
    // Dashed yellow lane circle at mid radius (every other segment).
    const midR = (innerR + outerR) / 2;
    for (let s = 0; s < segs; s += 2) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1) / segs) * Math.PI * 2;
      add(roundaboutAnnulus(wx, wz, midR - 0.022, midR + 0.022, yMark, 1, a0, a1), stripe);
    }

    // Four CCW directional arrows on the asphalt — travel dir (sinθ,-cosθ).
    const arrowLen = 0.17, arrowW = 0.11;
    for (let k = 0; k < 4; k++) {
      const th = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const px = wx + Math.cos(th) * midR;
      const pz = wz + Math.sin(th) * midR;
      const dx = Math.sin(th), dz = -Math.cos(th);   // CCW tangent
      const ex = -dz, ez = dx;                        // perpendicular
      add(roundaboutTri(
        px + dx * arrowLen, pz + dz * arrowLen,
        px - dx * arrowLen * 0.3 + ex * arrowW, pz - dz * arrowLen * 0.3 + ez * arrowW,
        px - dx * arrowLen * 0.3 - ex * arrowW, pz - dz * arrowLen * 0.3 - ez * arrowW,
        yMark
      ), white);
    }

    // Raised concrete curb wall + grassy island cap.
    add(cyl(innerR, 0.10, segs).translate(wx, ROAD_LIFT + 0.05, wz), curbCol);
    add(roundaboutAnnulus(wx, wz, 0, innerR - 0.02, ROAD_LIFT + 0.10, segs), grassCol);

    // Centrepiece fountain / monument.
    const baseR = innerR * 0.6;
    add(cyl(baseR, 0.12, 18).translate(wx, ROAD_LIFT + 0.16, wz), stone);
    add(cyl(baseR * 0.82, 0.05, 18).translate(wx, ROAD_LIFT + 0.21, wz), water);
    const colH = a.size === 3 ? 0.62 : 0.40;
    add(cyl(0.07, colH, 10).translate(wx, ROAD_LIFT + 0.16 + colH / 2, wz), stone);
    add(cone(0.13, 0.18, 10).translate(wx, ROAD_LIFT + 0.16 + colH + 0.05, wz), gold);

    if (a.size === 3) {
      // Big roundabout: ring of ornamental trees + alternating flower beds.
      const treeR = innerR * 0.78;
      for (let k = 0; k < 6; k++) {
        const th = (k / 6) * Math.PI * 2 + 0.35;
        const tx = wx + Math.cos(th) * treeR;
        const tz = wz + Math.sin(th) * treeR;
        add(cyl(0.04, 0.16, 6).translate(tx, ROAD_LIFT + 0.18, tz), treeTrunk);
        add(cone(0.17, 0.36, 7).translate(tx, ROAD_LIFT + 0.40, tz), treeLeaf);
      }
      for (let k = 0; k < 6; k++) {
        const th = (k / 6) * Math.PI * 2;
        const fx = wx + Math.cos(th) * (innerR * 0.45);
        const fz = wz + Math.sin(th) * (innerR * 0.45);
        add(box(0.11, 0.04, 0.11).translate(fx, ROAD_LIFT + 0.12, fz), k % 2 ? flowerA : flowerB);
      }
    }
  }

  const merged = mergeGeoms(geoms, colours);
  const group = new Group();
  group.add(new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  return group;
}

// --- Walking paths ------------------------------------------------------

/**
 * One small flagstone-coloured quad per path tile, with extensions toward
 * each 4-connected path neighbour so a run of paths reads as a continuous
 * strip. Roads are NOT path neighbours visually — paths terminate at road
 * tiles per the spec ("the path does not cross the road visually").
 */
export function buildPathMesh(grid: Grid): Mesh | null {
  const tiles: { x: number; y: number }[] = [];
  for (const t of grid.iter()) {
    if (t.path && !t.road) tiles.push({ x: t.x, y: t.y });
  }
  if (tiles.length === 0) return null;

  // Up to 5 quads per tile (centre + 4 stub extensions). Allocate worst case.
  const maxQuads = tiles.length * 5;
  const positions = new Float32Array(maxQuads * 4 * 3);
  const colours = new Float32Array(maxQuads * 4 * 3);
  const indices = new Uint32Array(maxQuads * 6);
  const c = new Color();
  c.setHex(THEME().roads.path);

  let vi = 0, ci = 0, ii = 0, v = 0;
  const half = PATH_WIDTH / 2;
  const stubLen = TILE_SIZE * 0.5; // half a tile, meets the neighbour's centre-stub

  for (const tile of tiles) {
    const cx = (tile.x + 0.5) * TILE_SIZE;
    const cz = (tile.y + 0.5) * TILE_SIZE;
    // Lift the path quad by terrain elevation (Alpha 2.4) so the path
    // sits on hilly ground instead of being buried in it.
    const t = grid.get(tile.x, tile.y);
    const yPath = PATH_LIFT + (t?.elevation ?? 0);

    // Centre quad — square, half-width on each side.
    pushQuad(
      positions, colours, indices,
      cx - half, cz - half, cx + half, cz + half,
      yPath, c, vi, ci, ii, v
    );
    vi += 12; ci += 12; ii += 6; v += 4;

    // Stub extensions toward each 4-neighbour that's another path tile OR a
    // walkable (non-highway) road tile. Extending toward roads is what makes
    // a path "feed into" the road's sidewalk visually — without this the
    // path would terminate one half-tile shy of the road and read as
    // disconnected.
    const connectN = grid.hasPath(tile.x, tile.y - 1) || isSidewalkTile(grid, tile.x, tile.y - 1);
    const connectE = grid.hasPath(tile.x + 1, tile.y) || isSidewalkTile(grid, tile.x + 1, tile.y);
    const connectS = grid.hasPath(tile.x, tile.y + 1) || isSidewalkTile(grid, tile.x, tile.y + 1);
    const connectW = grid.hasPath(tile.x - 1, tile.y) || isSidewalkTile(grid, tile.x - 1, tile.y);
    if (connectN) {
      pushQuad(positions, colours, indices,
        cx - half, cz - stubLen, cx + half, cz - half,
        yPath, c, vi, ci, ii, v);
      vi += 12; ci += 12; ii += 6; v += 4;
    }
    if (connectE) {
      pushQuad(positions, colours, indices,
        cx + half, cz - half, cx + stubLen, cz + half,
        yPath, c, vi, ci, ii, v);
      vi += 12; ci += 12; ii += 6; v += 4;
    }
    if (connectS) {
      pushQuad(positions, colours, indices,
        cx - half, cz + half, cx + half, cz + stubLen,
        yPath, c, vi, ci, ii, v);
      vi += 12; ci += 12; ii += 6; v += 4;
    }
    if (connectW) {
      pushQuad(positions, colours, indices,
        cx - stubLen, cz - half, cx - half, cz + half,
        yPath, c, vi, ci, ii, v);
      vi += 12; ci += 12; ii += 6; v += 4;
    }
  }

  // Trim to the actual used range so unused tail doesn't render zero-area tris.
  const usedQuads = ii / 6;
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions.slice(0, usedQuads * 4 * 3), 3));
  geom.setAttribute('color', new BufferAttribute(colours.slice(0, usedQuads * 4 * 3), 3));
  geom.setIndex(new BufferAttribute(indices.slice(0, usedQuads * 6), 1));
  // Flat-shaded: skip normals.
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(geom, mat);
}

/**
 * Sidewalk strips on every non-highway road tile. One pad per tile — the
 * road overlay sits on top, so what shows is the SIDEWALK_PAD border
 * around the road. Highway tiles are skipped (they're vehicle-only).
 *
 * Per-side extension: when a 4-neighbour is a walking-path tile, the pad
 * stretches all the way to the tile boundary on that side so the path's
 * stub meets it without a grass gap. Result: paths feed into sidewalks
 * cleanly even though paths and sidewalks live in different meshes.
 */
export function buildSidewalkMesh(grid: Grid): Mesh | null {
  const tiles: { x: number; y: number; tier: 'local' | 'avenue'; elevation: number }[] = [];
  for (const t of grid.iter()) {
    if (!t.road) continue;
    if (t.roadType === 'highway') continue;
    // Bridges over water don't get a sidewalk pad — there's nothing
    // for it to sit on (it would float underwater) and the bridge
    // deck reads cleanly without one.
    if (t.bridge) continue;
    tiles.push({ x: t.x, y: t.y, tier: t.roadType, elevation: t.elevation });
  }
  if (tiles.length === 0) return null;

  const positions = new Float32Array(tiles.length * 4 * 3);
  const colours = new Float32Array(tiles.length * 4 * 3);
  const indices = new Uint32Array(tiles.length * 6);
  const c = new Color();
  c.setHex(THEME().roads.sidewalk);
  const halfTile = TILE_SIZE * 0.5;

  let vi = 0, ci = 0, ii = 0, v = 0;
  for (const tile of tiles) {
    const cx = (tile.x + 0.5) * TILE_SIZE;
    const cz = (tile.y + 0.5) * TILE_SIZE;
    const roadHalf = ROAD_TIER[tile.tier].width / 2;
    const baseHalf = roadHalf + SIDEWALK_PAD;

    // Asymmetric pad — extend toward each path-tile neighbour.
    const halfN = grid.hasPath(tile.x, tile.y - 1) ? halfTile : baseHalf;
    const halfE = grid.hasPath(tile.x + 1, tile.y) ? halfTile : baseHalf;
    const halfS = grid.hasPath(tile.x, tile.y + 1) ? halfTile : baseHalf;
    const halfW = grid.hasPath(tile.x - 1, tile.y) ? halfTile : baseHalf;

    pushQuad(
      positions, colours, indices,
      cx - halfW, cz - halfN, cx + halfE, cz + halfS,
      SIDEWALK_LIFT + tile.elevation, c, vi, ci, ii, v
    );
    vi += 12; ci += 12; ii += 6; v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normals.
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(geom, mat);
}

/** True if the tile at (x, y) is a non-highway road — i.e. it has a sidewalk. */
/**
 * Perpendicular offset (in tile units, unsigned) where a pedestrian
 * should walk on this tile. Multiply by ±side to place them left or
 * right of travel direction.
 *
 * For a non-highway road the band sits squarely on the sidewalk pad
 * (just outside the road surface). For a path tile we use a small
 * spread so two-direction streams visibly split. Highways and grass
 * default to 0 — a planned route shouldn't put walkers there, but if
 * one slips through the renderer doesn't push them sideways into
 * nothing.
 */
/**
 * Y of the road driving surface at the given tile (Alpha 2.4). Bridges
 * sit at the absolute deck height; everything else rides the terrain.
 * Off-grid lookups fall back to the flat road lift so vehicles wrapping
 * the edge don't snap to y=0.
 */
export function roadSurfaceY(grid: Grid, x: number, y: number): number {
  const t = grid.get(x, y);
  if (!t) return ROAD_LIFT;
  return t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
}

/**
 * Y of the walking surface at the given tile (Alpha 2.4). Mirrors
 * roadSurfaceY but uses the slightly higher SIDEWALK_LIFT for road
 * tiles (walker is on the sidewalk pad) and PATH_LIFT for path tiles.
 * Bridges still override to the deck height — pedestrians cross
 * bridges at the same level as the road.
 */
export function walkerSurfaceY(grid: Grid, x: number, y: number): number {
  const t = grid.get(x, y);
  if (!t) return SIDEWALK_LIFT;
  if (t.bridge) return BRIDGE_LIFT;
  if (t.path && !t.road) return PATH_LIFT + t.elevation;
  // Park tiles (Alpha 2.6.1) — walkers cut through parks at path height.
  if (t.building === 'park') return PATH_LIFT + t.elevation;
  return SIDEWALK_LIFT + t.elevation;
}

export function pedestrianOffsetForTile(grid: Grid, x: number, y: number): number {
  const t = grid.get(x, y);
  if (!t) return 0;
  if (t.road && t.roadType !== 'highway') {
    // Place on the sidewalk pad: just outside the road's half-width,
    // halfway through the SIDEWALK_PAD strip.
    return ROAD_TIER[t.roadType].width / 2 + SIDEWALK_PAD * 0.5;
  }
  if (t.path) {
    return 0.05; // small spread on a narrow path
  }
  // Park tiles (Alpha 2.6.1) — wider spread so walkers stream across the
  // grass without all single-filing through the centre.
  if (t.building === 'park') return 0.18;
  return 0;
}

function isSidewalkTile(grid: Grid, x: number, y: number): boolean {
  const t = grid.get(x, y);
  if (!t) return false;
  return t.road && t.roadType !== 'highway';
}

/**
 * Pick which 4-neighbour side of a road tile to put the bus stop on. Prefers
 * the direction with a developed building (zone tile with density > 0); falls
 * back to whichever side isn't a road tile. Returns a unit-length direction
 * (dx, dz) in tile-space.
 */
function pickStopSide(grid: Grid, x: number, y: number): [number, number] {
  const candidates: Array<[number, number]> = [
    [0, -1], // N
    [1, 0],  // E
    [0, 1],  // S
    [-1, 0]  // W
  ];
  // Score each side by how built-up the neighbour is.
  let bestSide: [number, number] = candidates[0]!;
  let bestScore = -Infinity;
  for (const [dx, dz] of candidates) {
    const n = grid.get(x + dx, y + dz);
    let score = 0;
    if (!n) score = -100;
    else if (n.road) score = -10;            // can't sit a stop on a road tile
    else if (n.zone !== 'none' && n.density > 0) score = 5;
    else if (n.zone !== 'none') score = 2;   // zoned, undeveloped
    else if (n.building !== 'none') score = 4;
    else score = 0;                           // grass — fine, just not preferred
    if (score > bestScore) {
      bestScore = score;
      bestSide = [dx, dz];
    }
  }
  return bestSide;
}

/** Push a flat quad on the XZ plane at height `y`. Mutates the buffers in place. */
function pushQuad(
  positions: Float32Array, colours: Float32Array, indices: Uint32Array,
  x0: number, z0: number, x1: number, z1: number,
  y: number, c: Color, vi: number, ci: number, ii: number, v: number
): void {
  positions[vi + 0] = x0; positions[vi + 1] = y; positions[vi + 2] = z0;
  positions[vi + 3] = x1; positions[vi + 4] = y; positions[vi + 5] = z0;
  positions[vi + 6] = x1; positions[vi + 7] = y; positions[vi + 8] = z1;
  positions[vi + 9] = x0; positions[vi + 10] = y; positions[vi + 11] = z1;
  for (let k = 0; k < 4; k++) {
    colours[ci + k * 3 + 0] = c.r;
    colours[ci + k * 3 + 1] = c.g;
    colours[ci + k * 3 + 2] = c.b;
  }
  indices[ii + 0] = v;     indices[ii + 1] = v + 2; indices[ii + 2] = v + 1;
  indices[ii + 3] = v;     indices[ii + 4] = v + 3; indices[ii + 5] = v + 2;
}

// makeArrowGeom (single-triangle direction arrow) was replaced in
// Beta 1.1.2 by the makeChevronGeom below — chevrons read more
// like real freeway pavement markings. Removed to keep the bundle clean.

// Beta 1.1.2 — chevron-style arrow (two notched triangles forming a
// `>` shape) for highway pavement markings. Reads as "freeway flow"
// at any zoom, much more legible than a single solid triangle.
// Two stacked of these per highway tile create the classic dashed
// chevron pattern.
function makeChevronGeom(width: number, length: number): BufferGeometry {
  const w = width / 2;
  const l = length / 2;
  // Outer chevron > with an inner notch cut so it reads as an arrow
  // outline, not a solid triangle. 6 vertices: tip + 2 wings + 2
  // inner-notch points + 1 base-center.
  const tipZ = l;
  const baseZ = -l;
  const innerZ = -l * 0.40;     // notch depth
  const positions = new Float32Array([
    // 0: tip
       0, 0, tipZ,
    // 1: right wing (back)
       w, 0, baseZ,
    // 2: right inner (notch)
       w * 0.45, 0, innerZ,
    // 3: base center (notch peak)
       0, 0, innerZ - 0.04,
    // 4: left inner (notch)
      -w * 0.45, 0, innerZ,
    // 5: left wing (back)
      -w, 0, baseZ,
  ]);
  // Triangulate: two triangles per side of the chevron (left + right wings).
  // Wind so the tile-y normal points up.
  const indices = new Uint32Array([
    // Right side
    0, 2, 1,
    1, 2, 3,
    // Left side
    0, 5, 4,
    5, 3, 4,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  return g;
}
