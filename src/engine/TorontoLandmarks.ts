/**
 * Toronto landmark Easter eggs (Alpha 4.24).
 *
 * Geometry builders for the iconic Toronto landmarks the generic
 * museum / stadium / observatory don't capture. These are NOT exposed
 * in the toolbar / place tools / faction stances / milestone unlocks —
 * a normal player will never encounter them in regular gameplay. They
 * exist purely so the bundled Toronto preset (scripts/generate-
 * toronto.mjs) can paint each landmark on its real-world spot.
 *
 * Source-divers find this file as a hint: yes, the Toronto preset is
 * an easter egg, and yes, every landmark in the bottom-of-PROGRESS
 * "left blank" list now actually has its own visual.
 *
 * Single-tile each. Visuals are deliberately scaled larger than normal
 * buildings (CN Tower runs ~5 units tall) so they read as landmarks at
 * the game's orthographic zoom. The renderer's `cityBuildingParts`
 * switch dispatches to these.
 *
 * Coordinate convention: each builder returns parts in tile-local
 * space — (dx, dy, dz) is offset from the tile center, the renderer
 * adds the tile's world position. The same convention as the
 * existing service-building parts (museum / stadium / observatory).
 */

import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry
} from 'three';

export interface LandmarkPart {
  makeGeom: () => BufferGeometry;
  color: number;
  dx: number;
  dy: number;
  dz: number;
}

// --- Geometry helpers (tiny duplicates of Renderer's helpers, kept
//     local so this file is self-contained for easier source-diving).

function box(w: number, h: number, d: number): BufferGeometry {
  return new BoxGeometry(w, h, d);
}
function cyl(r: number, h: number, segs: number): BufferGeometry {
  return new CylinderGeometry(r, r, h, segs);
}
function cylTaper(rTop: number, rBot: number, h: number, segs: number): BufferGeometry {
  return new CylinderGeometry(rTop, rBot, h, segs);
}
function cone(r: number, h: number, segs: number): BufferGeometry {
  return new ConeGeometry(r, h, segs);
}
function dome(r: number): BufferGeometry {
  return new IcosahedronGeometry(r, 1);
}

// --- Shared landmark palette ------------------------------------------

const CONCRETE_LIGHT = 0xc8c4be;
const CONCRETE_MID = 0x9a948a;
const CONCRETE_DARK = 0x7a7468;
const LIMESTONE = 0xeae0c8;
const LIMESTONE_DEEP = 0xc8b890;
const STEEL = 0x44494c;
const GLASS_BLUE = 0x6a8aaa;
const GLASS_TEAL = 0x4a8a8e;
const RED_BRICK = 0x9a3a2a;
const BRICK_DARK = 0x6a2818;
const ROOF_SLATE = 0x4a5060;
const CN_RED = 0xb84030;
const ASPHALT = 0x2a2a2c;
const RUNWAY_PAINT = 0xece8e0;

// ---------- CN Tower ---------------------------------------------------
/**
 * 553 m of concrete defiance. Tapered shaft + observation pod (SkyPod) +
 * tall whip antenna. Total in-game height ~5.5 units — towers above
 * the financial district skyscrapers at any zoom.
 */
export function buildCNTowerParts(): LandmarkPart[] {
  return [
    // Foundation pad.
    { makeGeom: () => box(0.55, 0.04, 0.55), color: CONCRETE_DARK, dx: 0, dy: 0.02, dz: 0 },
    // Three-prong base flange (where the concrete tripod legs flare).
    { makeGeom: () => box(0.36, 0.20, 0.10), color: CONCRETE_LIGHT, dx: 0, dy: 0.10, dz: 0 },
    { makeGeom: () => box(0.10, 0.20, 0.36), color: CONCRETE_LIGHT, dx: 0, dy: 0.10, dz: 0 },
    // Main tapered concrete shaft (3.2 units of climb).
    { makeGeom: () => cylTaper(0.06, 0.10, 3.20, 6), color: CONCRETE_LIGHT, dx: 0, dy: 0.20 + 1.60, dz: 0 },
    // Three vertical raceway grooves (decorative ribs running up the shaft).
    { makeGeom: () => box(0.012, 3.10, 0.025), color: CONCRETE_DARK, dx: -0.06, dy: 0.20 + 1.55, dz: 0 },
    { makeGeom: () => box(0.012, 3.10, 0.025), color: CONCRETE_DARK, dx:  0.06, dy: 0.20 + 1.55, dz: 0 },
    { makeGeom: () => box(0.025, 3.10, 0.012), color: CONCRETE_DARK, dx: 0, dy: 0.20 + 1.55, dz: -0.06 },
    // SkyPod doughnut (the wider observation pod ~70% up).
    { makeGeom: () => cyl(0.20, 0.10, 12), color: CONCRETE_MID, dx: 0, dy: 2.55, dz: 0 },
    { makeGeom: () => cyl(0.22, 0.04, 12), color: STEEL, dx: 0, dy: 2.62, dz: 0 },
    // SkyPod restaurant level (slightly larger upper ring).
    { makeGeom: () => cyl(0.18, 0.08, 12), color: GLASS_BLUE, dx: 0, dy: 2.72, dz: 0 },
    // Pod cap.
    { makeGeom: () => cone(0.20, 0.12, 12), color: CONCRETE_LIGHT, dx: 0, dy: 2.80, dz: 0 },
    // Continuation of the shaft above SkyPod (narrower).
    { makeGeom: () => cylTaper(0.04, 0.06, 1.20, 6), color: CONCRETE_LIGHT, dx: 0, dy: 3.20 + 0.60, dz: 0 },
    // Top deck (small box for the upper observation level).
    { makeGeom: () => cyl(0.10, 0.06, 8), color: STEEL, dx: 0, dy: 4.40, dz: 0 },
    // Whip antenna mast — long thin red-banded mast.
    { makeGeom: () => cyl(0.018, 1.20, 4), color: STEEL, dx: 0, dy: 5.05, dz: 0 },
    // Red aviation warning bands on the antenna.
    { makeGeom: () => cyl(0.022, 0.08, 4), color: CN_RED, dx: 0, dy: 4.55, dz: 0 },
    { makeGeom: () => cyl(0.022, 0.08, 4), color: CN_RED, dx: 0, dy: 5.20, dz: 0 },
    { makeGeom: () => cyl(0.022, 0.08, 4), color: CN_RED, dx: 0, dy: 5.80, dz: 0 },
    // Spike tip.
    { makeGeom: () => cone(0.018, 0.18, 4), color: STEEL, dx: 0, dy: 5.74, dz: 0 },
  ];
}

// ---------- Rogers Centre (SkyDome) ------------------------------------
/**
 * The big white retractable-roof stadium. Round-ish base + segmented
 * dome + vertical seam suggesting the roof panel split.
 */
export function buildRogersCentreParts(): LandmarkPart[] {
  return [
    // Stadium oval base (slightly elliptical via two cylinders).
    { makeGeom: () => cyl(0.42, 0.30, 16), color: CONCRETE_LIGHT, dx: 0, dy: 0.15, dz: 0 },
    // Lower seating tier ring.
    { makeGeom: () => cyl(0.45, 0.10, 16), color: CONCRETE_DARK, dx: 0, dy: 0.06, dz: 0 },
    // Dome (half-sphere on top).
    { makeGeom: () => dome(0.40), color: 0xece8e0, dx: 0, dy: 0.40, dz: 0 },
    // Dome panel seam — thin dark line across the equator suggesting the
    // retractable roof panel boundary.
    { makeGeom: () => box(0.84, 0.02, 0.04), color: CONCRETE_DARK, dx: 0, dy: 0.50, dz: 0 },
    // Lighting standards — 4 small spires around the rim (under-rim lights).
    { makeGeom: () => cyl(0.012, 0.18, 4), color: STEEL, dx:  0.40, dy: 0.39, dz:  0.0 },
    { makeGeom: () => cyl(0.012, 0.18, 4), color: STEEL, dx: -0.40, dy: 0.39, dz:  0.0 },
    { makeGeom: () => cyl(0.012, 0.18, 4), color: STEEL, dx:  0.0,  dy: 0.39, dz:  0.40 },
    { makeGeom: () => cyl(0.012, 0.18, 4), color: STEEL, dx:  0.0,  dy: 0.39, dz: -0.40 },
    // Entrance overhang (curved lip on the south face).
    { makeGeom: () => box(0.30, 0.04, 0.10), color: STEEL, dx: 0, dy: 0.18, dz: 0.42 },
    { makeGeom: () => cyl(0.018, 0.18, 4), color: STEEL, dx: -0.13, dy: 0.09, dz: 0.46 },
    { makeGeom: () => cyl(0.018, 0.18, 4), color: STEEL, dx:  0.13, dy: 0.09, dz: 0.46 },
  ];
}

// ---------- Scotiabank Arena -------------------------------------------
/**
 * Modern glass-and-steel hockey arena (the ACC) — boxy with a curved
 * dark glass roof and a podium of glass storefronts.
 */
export function buildScotiabankArenaParts(): LandmarkPart[] {
  return [
    // Main arena box.
    { makeGeom: () => box(0.85, 0.40, 0.65), color: CONCRETE_DARK, dx: 0, dy: 0.20, dz: 0 },
    // Curved roof (slightly wider, darker).
    { makeGeom: () => box(0.88, 0.06, 0.68), color: STEEL, dx: 0, dy: 0.43, dz: 0 },
    // Roof curve hint — dome stretched over the top.
    { makeGeom: () => dome(0.32), color: STEEL, dx: 0, dy: 0.46, dz: 0 },
    // Glass podium (lower half of the south face).
    { makeGeom: () => box(0.86, 0.16, 0.04), color: GLASS_BLUE, dx: 0, dy: 0.10, dz: 0.34 },
    // Light bar across the front (signature LED strip).
    { makeGeom: () => box(0.84, 0.03, 0.02), color: 0xeec453, dx: 0, dy: 0.21, dz: 0.34 },
    // Side glass panels (east + west faces).
    { makeGeom: () => box(0.04, 0.16, 0.62), color: GLASS_BLUE, dx:  0.43, dy: 0.10, dz: 0 },
    { makeGeom: () => box(0.04, 0.16, 0.62), color: GLASS_BLUE, dx: -0.43, dy: 0.10, dz: 0 },
    // Entry canopy.
    { makeGeom: () => box(0.30, 0.04, 0.10), color: 0xc83c3c, dx: 0, dy: 0.16, dz: 0.40 },
  ];
}

// ---------- Union Station ----------------------------------------------
/**
 * Long Beaux-Arts limestone façade with a row of Ionic columns and a
 * shallow pediment. The east end of downtown's classical anchor.
 */
export function buildUnionStationParts(): LandmarkPart[] {
  const parts: LandmarkPart[] = [
    // Main limestone block.
    { makeGeom: () => box(0.90, 0.42, 0.45), color: LIMESTONE, dx: 0, dy: 0.21, dz: 0 },
    // Cornice band along the top.
    { makeGeom: () => box(0.92, 0.06, 0.47), color: LIMESTONE_DEEP, dx: 0, dy: 0.45, dz: 0 },
    // Roof slab (slate).
    { makeGeom: () => box(0.92, 0.05, 0.47), color: ROOF_SLATE, dx: 0, dy: 0.50, dz: 0 },
    // Pediment over the central entrance.
    { makeGeom: () => cone(0.16, 0.12, 4), color: LIMESTONE_DEEP, dx: 0, dy: 0.56, dz: 0.18 },
    // Grand entrance — recessed dark portal at center-front.
    { makeGeom: () => box(0.18, 0.30, 0.04), color: 0x2a1a10, dx: 0, dy: 0.16, dz: 0.235 },
  ];
  // Row of Ionic columns across the south façade (8 columns).
  const colCount = 8;
  for (let i = 0; i < colCount; i++) {
    const cx = -0.40 + (i / (colCount - 1)) * 0.80;
    parts.push({ makeGeom: () => cyl(0.025, 0.34, 8), color: LIMESTONE, dx: cx, dy: 0.18, dz: 0.215 });
    // Capital cap on each column.
    parts.push({ makeGeom: () => box(0.06, 0.03, 0.05), color: LIMESTONE_DEEP, dx: cx, dy: 0.36, dz: 0.215 });
    // Base under each column.
    parts.push({ makeGeom: () => box(0.06, 0.03, 0.05), color: LIMESTONE_DEEP, dx: cx, dy: 0.02, dz: 0.215 });
  }
  return parts;
}

// ---------- Casa Loma --------------------------------------------------
/**
 * Edwardian Gothic Revival "castle" on the hill. Multiple stone walls,
 * pitched roof central hall, and three turret towers with conical caps.
 */
export function buildCasaLomaParts(): LandmarkPart[] {
  return [
    // Central hall.
    { makeGeom: () => box(0.55, 0.45, 0.40), color: CONCRETE_LIGHT, dx: 0, dy: 0.22, dz: 0 },
    // Steeply pitched main roof.
    { makeGeom: () => cone(0.40, 0.30, 4), color: ROOF_SLATE, dx: 0, dy: 0.60, dz: 0 },
    // East wing.
    { makeGeom: () => box(0.20, 0.30, 0.30), color: CONCRETE_LIGHT, dx: 0.32, dy: 0.15, dz: 0 },
    { makeGeom: () => cone(0.16, 0.18, 4), color: ROOF_SLATE, dx: 0.32, dy: 0.39, dz: 0 },
    // West wing.
    { makeGeom: () => box(0.20, 0.30, 0.30), color: CONCRETE_LIGHT, dx: -0.32, dy: 0.15, dz: 0 },
    { makeGeom: () => cone(0.16, 0.18, 4), color: ROOF_SLATE, dx: -0.32, dy: 0.39, dz: 0 },
    // SE turret — round tower with conical cap.
    { makeGeom: () => cyl(0.10, 0.55, 8), color: CONCRETE_LIGHT, dx: 0.30, dy: 0.275, dz: 0.22 },
    { makeGeom: () => cone(0.11, 0.20, 8), color: ROOF_SLATE, dx: 0.30, dy: 0.65, dz: 0.22 },
    { makeGeom: () => cone(0.025, 0.10, 4), color: 0xeec453, dx: 0.30, dy: 0.80, dz: 0.22 },
    // SW turret.
    { makeGeom: () => cyl(0.10, 0.55, 8), color: CONCRETE_LIGHT, dx: -0.30, dy: 0.275, dz: 0.22 },
    { makeGeom: () => cone(0.11, 0.20, 8), color: ROOF_SLATE, dx: -0.30, dy: 0.65, dz: 0.22 },
    { makeGeom: () => cone(0.025, 0.10, 4), color: 0xeec453, dx: -0.30, dy: 0.80, dz: 0.22 },
    // North turret (taller, central back).
    { makeGeom: () => cyl(0.09, 0.65, 8), color: CONCRETE_LIGHT, dx: 0, dy: 0.325, dz: -0.18 },
    { makeGeom: () => cone(0.10, 0.20, 8), color: ROOF_SLATE, dx: 0, dy: 0.75, dz: -0.18 },
    { makeGeom: () => cone(0.022, 0.10, 4), color: 0xeec453, dx: 0, dy: 0.90, dz: -0.18 },
    // Crenellated parapet across the front.
    ...crenellate(-0.27, 0.27, 0.45, 0.20, 6, CONCRETE_LIGHT),
    // Grand front door (dark wood arched).
    { makeGeom: () => box(0.10, 0.18, 0.04), color: 0x3a2010, dx: 0, dy: 0.09, dz: 0.21 },
  ];
}

function crenellate(x0: number, x1: number, y: number, dz: number, count: number, color: number): LandmarkPart[] {
  const out: LandmarkPart[] = [];
  for (let i = 0; i < count; i++) {
    const cx = x0 + ((x1 - x0) * (i + 0.5)) / count;
    out.push({ makeGeom: () => box(0.04, 0.04, 0.025), color, dx: cx, dy: y, dz });
  }
  return out;
}

// ---------- Royal Ontario Museum (Crystal addition) -------------------
/**
 * Original limestone + the 2007 Daniel Libeskind glass crystal protruding
 * out the side at sharp angles. Captured here as a limestone base box
 * with three angular glass crystals (rotated cones / boxes) bursting out.
 */
export function buildROMParts(): LandmarkPart[] {
  const parts: LandmarkPart[] = [
    // Original limestone base.
    { makeGeom: () => box(0.55, 0.32, 0.45), color: LIMESTONE, dx: 0, dy: 0.16, dz: -0.08 },
    // Cornice on the original.
    { makeGeom: () => box(0.57, 0.04, 0.47), color: LIMESTONE_DEEP, dx: 0, dy: 0.34, dz: -0.08 },
    // Hipped roof on the original.
    { makeGeom: () => cone(0.32, 0.18, 4), color: ROOF_SLATE, dx: 0, dy: 0.45, dz: -0.08 },
  ];
  // The Crystal — 3 angular glass crystals jutting out the south face.
  // Each is a tilted box that breaks out at an aggressive angle.
  // Crystal 1 — biggest, lower-front.
  const c1 = box(0.34, 0.22, 0.20);
  c1.rotateY(0.40);
  c1.rotateZ(-0.20);
  parts.push({ makeGeom: () => c1, color: GLASS_TEAL, dx: 0.04, dy: 0.20, dz: 0.22 });
  // Crystal 2 — upper, tilting outward.
  const c2 = box(0.28, 0.18, 0.16);
  c2.rotateY(-0.30);
  c2.rotateZ(0.30);
  parts.push({ makeGeom: () => c2, color: 0x88a8c8, dx: -0.10, dy: 0.30, dz: 0.18 });
  // Crystal 3 — small cap on top.
  const c3 = box(0.20, 0.14, 0.14);
  c3.rotateY(0.55);
  c3.rotateZ(-0.45);
  parts.push({ makeGeom: () => c3, color: GLASS_BLUE, dx: 0.18, dy: 0.42, dz: 0.10 });
  // Aluminium framing strips on the crystals (suggested via thin dark boxes).
  parts.push({ makeGeom: () => box(0.36, 0.012, 0.01), color: STEEL, dx: 0.04, dy: 0.31, dz: 0.22 });
  return parts;
}

// ---------- Art Gallery of Ontario (Gehry façade) ----------------------
/**
 * Frank Gehry's curving glass-and-wood front façade. Approximated as a
 * long curved wall (segmented strip of glass panels) backed by a brick-
 * red mass. Reads as "long horizontal curving glass" at a glance.
 */
export function buildAGOParts(): LandmarkPart[] {
  const parts: LandmarkPart[] = [
    // Brick base behind the glass.
    { makeGeom: () => box(0.85, 0.34, 0.30), color: 0x6a4a32, dx: 0, dy: 0.17, dz: -0.10 },
    // Roof.
    { makeGeom: () => box(0.85, 0.04, 0.30), color: 0x3a2818, dx: 0, dy: 0.36, dz: -0.10 },
  ];
  // Curved Galleria glass façade — 7 thin segments forming a gentle arc.
  const segCount = 7;
  for (let i = 0; i < segCount; i++) {
    const t = (i / (segCount - 1)) * 2 - 1; // -1..1
    const cx = t * 0.42;
    // Curve forward slightly toward the south (dz positive).
    const cz = 0.05 + (1 - Math.abs(t)) * 0.18;
    parts.push({ makeGeom: () => box(0.13, 0.30, 0.06), color: 0xa8c8d8, dx: cx, dy: 0.18, dz: cz });
    // Wood frame strut between panels.
    parts.push({ makeGeom: () => box(0.012, 0.32, 0.012), color: 0x6a4a28, dx: cx + 0.065, dy: 0.18, dz: cz });
  }
  // Stair tower / titanium scoop on the back side.
  parts.push({ makeGeom: () => cyl(0.08, 0.50, 8), color: 0x9a8870, dx: 0.30, dy: 0.25, dz: -0.20 });
  return parts;
}

// ---------- Distillery District ----------------------------------------
/**
 * Cluster of red-brick Victorian industrial buildings (Gooderham &
 * Worts). 4 rectangular masses with peaked roofs, two smokestack
 * chimneys, all in a tight arrangement.
 */
export function buildDistilleryParts(): LandmarkPart[] {
  return [
    // Building A (NW): tall narrow brick mass.
    { makeGeom: () => box(0.30, 0.50, 0.20), color: RED_BRICK, dx: -0.22, dy: 0.25, dz: -0.18 },
    { makeGeom: () => cone(0.18, 0.14, 4), color: BRICK_DARK, dx: -0.22, dy: 0.57, dz: -0.18 },
    // Building B (NE): wider lower brick block.
    { makeGeom: () => box(0.28, 0.36, 0.30), color: RED_BRICK, dx: 0.22, dy: 0.18, dz: -0.12 },
    { makeGeom: () => cone(0.20, 0.16, 4), color: BRICK_DARK, dx: 0.22, dy: 0.42, dz: -0.12 },
    // Building C (S center): long horizontal mass.
    { makeGeom: () => box(0.65, 0.28, 0.18), color: RED_BRICK, dx: 0, dy: 0.14, dz: 0.22 },
    { makeGeom: () => box(0.66, 0.04, 0.20), color: BRICK_DARK, dx: 0, dy: 0.30, dz: 0.22 },
    // Smokestack chimney 1 (north center).
    { makeGeom: () => cyl(0.04, 0.85, 6), color: BRICK_DARK, dx: -0.05, dy: 0.425, dz: -0.32 },
    { makeGeom: () => cyl(0.05, 0.05, 6), color: 0x3a1808, dx: -0.05, dy: 0.85, dz: -0.32 },
    // Smokestack chimney 2 (NE).
    { makeGeom: () => cyl(0.035, 0.65, 6), color: BRICK_DARK, dx: 0.32, dy: 0.325, dz: -0.30 },
    { makeGeom: () => cyl(0.045, 0.04, 6), color: 0x3a1808, dx: 0.32, dy: 0.65, dz: -0.30 },
    // Cobblestone courtyard suggested via dark grey pad.
    { makeGeom: () => box(0.95, 0.012, 0.95), color: 0x4a4238, dx: 0, dy: 0.005, dz: 0 },
    // Window bands across the ground floor of building C.
    { makeGeom: () => box(0.66, 0.06, 0.005), color: 0x2a1a10, dx: 0, dy: 0.10, dz: 0.31 },
  ];
}

// ---------- Pearson Terminal ------------------------------------------
/**
 * Modern airport terminal — long curved glass-front building plus the
 * iconic control tower with a circular cab. Pairs visually with the
 * `runway` tiles laid out around it.
 */
export function buildPearsonTerminalParts(): LandmarkPart[] {
  return [
    // Main terminal body — long low rectangular base.
    { makeGeom: () => box(0.85, 0.16, 0.40), color: 0xece8e0, dx: 0, dy: 0.08, dz: 0 },
    // Glass-front colonnade — long thin glass band along the south face.
    { makeGeom: () => box(0.86, 0.12, 0.04), color: GLASS_BLUE, dx: 0, dy: 0.08, dz: 0.20 },
    // Curved roof overhang.
    { makeGeom: () => box(0.90, 0.04, 0.46), color: STEEL, dx: 0, dy: 0.18, dz: 0 },
    // Concourse pier (thin perpendicular finger jetty).
    { makeGeom: () => box(0.10, 0.14, 0.30), color: 0xece8e0, dx: 0.30, dy: 0.07, dz: -0.30 },
    { makeGeom: () => box(0.10, 0.04, 0.30), color: STEEL, dx: 0.30, dy: 0.16, dz: -0.30 },
    // Control tower — tall thin cylinder with circular cab on top.
    { makeGeom: () => cyl(0.04, 0.85, 8), color: 0xb0a89c, dx: -0.32, dy: 0.425, dz: 0.10 },
    // Cab base.
    { makeGeom: () => cyl(0.10, 0.06, 12), color: STEEL, dx: -0.32, dy: 0.88, dz: 0.10 },
    // Cab (glass).
    { makeGeom: () => cyl(0.08, 0.10, 12), color: GLASS_BLUE, dx: -0.32, dy: 0.95, dz: 0.10 },
    // Cab roof.
    { makeGeom: () => cone(0.10, 0.08, 12), color: STEEL, dx: -0.32, dy: 1.04, dz: 0.10 },
    // Aircraft jet bridge — small tube extending toward the apron (north face).
    { makeGeom: () => box(0.06, 0.04, 0.20), color: 0x8a8a8a, dx: -0.10, dy: 0.06, dz: -0.30 },
  ];
}

// ---------- Runway -----------------------------------------------------
/**
 * A single runway tile — mostly flat asphalt with white centerline
 * dashes + threshold markings. Lay several in a row to form a runway.
 */
export function buildRunwayParts(): LandmarkPart[] {
  const parts: LandmarkPart[] = [
    // Asphalt slab covering the whole tile.
    { makeGeom: () => box(0.98, 0.02, 0.98), color: ASPHALT, dx: 0, dy: 0.01, dz: 0 },
  ];
  // Centerline dashes along the longer axis (running E-W = along x).
  for (let i = 0; i < 5; i++) {
    const cx = -0.40 + i * 0.20;
    parts.push({ makeGeom: () => box(0.10, 0.025, 0.05), color: RUNWAY_PAINT, dx: cx, dy: 0.025, dz: 0 });
  }
  // Subtle edge stripes along the long sides.
  parts.push({ makeGeom: () => box(0.95, 0.025, 0.02), color: RUNWAY_PAINT, dx: 0, dy: 0.025, dz: 0.42 });
  parts.push({ makeGeom: () => box(0.95, 0.025, 0.02), color: RUNWAY_PAINT, dx: 0, dy: 0.025, dz: -0.42 });
  return parts;
}
