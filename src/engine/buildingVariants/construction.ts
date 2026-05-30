import { BoxGeometry, ConeGeometry, CylinderGeometry } from 'three';
import type { VariantPart } from './types';
// Type-only import: emitConstructionStage is parameterised by the same
// SkyscraperDesign skyscrapers.ts defines. skyscrapers.ts value-imports
// emitConstructionStage from here, so this MUST stay `import type` to keep
// the cycle types-only (no runtime circular dependency).
import type { SkyscraperDesign } from './skyscrapers';

/** Local hex-lerp helper (mirrors core's mixHex; kept private to the
 *  construction-site palette so this module stands alone). */
function mixHexLocal(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

const CON_PAD_DARK = 0x504a44;       // excavation pit floor
const CON_PAD_LIGHT = 0x9a948a;      // concrete pad
const CON_CONCRETE = 0xc8c4be;       // poured concrete
const CON_CONCRETE_DEEP = 0xa49e94;  // shadowed concrete face
const CON_STEEL = 0x44494c;          // steel I-beams
const CON_STEEL_BRIGHT = 0x6a7280;   // bright steel highlight
const CON_CRANE_YELLOW = 0xeec453;
const CON_CRANE_ORANGE = 0xc89030;
const CON_FENCE_ORANGE = 0xf07020;   // hi-vis safety fencing
const CON_FENCE_WHITE = 0xece8e0;    // alternating panels
const CON_TRAILER = 0xe8e4d8;        // site trailer body
const CON_TRAILER_TRIM = 0x3a3a3a;   // trailer windows / door
const CON_LUMBER = 0xa07c50;         // lumber stack
const CON_REBAR = 0x9a4a28;          // rust-orange rebar
const CON_MIXER = 0x4a6a4a;          // concrete mixer body
const CON_TARP = 0x6a7280;           // safety scrim / tarp
const CON_HOIST = 0xb84a30;          // construction lift cab

export function emitConstructionStage(
  d: SkyscraperDesign, cx: number, cz: number, stage: 0 | 1 | 2 | 3, out: VariantPart[]
): void {
  // Common: site fence around the perimeter (every stage).
  emitSiteFence(cx, cz, out);
  switch (stage) {
    case 0: emitStage0SitePrep(d, cx, cz, out); break;
    case 1: emitStage1LowerFloors(d, cx, cz, out); break;
    case 2: emitStage2SteelSkeleton(d, cx, cz, out); break;
    case 3: emitStage3FacadeGoingUp(d, cx, cz, out); break;
  }
}

/** Hi-vis orange-and-white site fence ringing the 2×2 footprint at low
 *  height (~0.20 above ground). 4 sides built as a series of short
 *  alternating-colour panels. Leaves a small entry gap on the south
 *  face so it reads as an active site rather than a sealed enclosure. */
function emitSiteFence(cx: number, cz: number, out: VariantPart[]): void {
  const half = 0.95;        // half-width of the 2×2 footprint
  const fenceY = 0.10;
  const fenceH = 0.20;
  const panelW = 0.30;
  const fenceT = 0.025;
  const sides: Array<{ cx: number; cz: number; w: number; d: number; horizontal: boolean }> = [
    { cx,         cz: cz - half, w: 2 * half, d: fenceT,    horizontal: true  }, // north
    { cx: cx + half, cz,         w: fenceT,   d: 2 * half,  horizontal: false }, // east
    { cx,         cz: cz + half, w: 2 * half, d: fenceT,    horizontal: true  }, // south
    { cx: cx - half, cz,         w: fenceT,   d: 2 * half,  horizontal: false }, // west
  ];
  for (const s of sides) {
    // Skip a panel-sized gap on the south face for site entry.
    const isSouth = s.cz === cz + half;
    const length = s.horizontal ? s.w : s.d;
    const start = -length / 2;
    const panelCount = Math.max(2, Math.round(length / panelW));
    const actualPanelW = length / panelCount;
    for (let i = 0; i < panelCount; i++) {
      // Skip the middle panel on the south face for the entry gap.
      if (isSouth && i === Math.floor(panelCount / 2)) continue;
      const t = start + actualPanelW * (i + 0.5);
      const px = s.horizontal ? s.cx + t : s.cx;
      const pz = s.horizontal ? s.cz : s.cz + t;
      const pw = s.horizontal ? actualPanelW * 0.94 : s.w;
      const pd = s.horizontal ? s.d : actualPanelW * 0.94;
      const panel = new BoxGeometry(pw, fenceH, pd);
      panel.translate(px, fenceY, pz);
      out.push({ geom: panel, color: i % 2 === 0 ? CON_FENCE_ORANGE : CON_FENCE_WHITE });
    }
  }
}

/** Foundation pad — every stage has one. The pit is deeper / darker on
 *  stage 0 (excavation), gets a lighter concrete colour on stage 1+. */
function emitFoundationPad(stage: number, cx: number, cz: number, out: VariantPart[]): void {
  const padW = 1.85, padD = 1.85;
  if (stage === 0) {
    // Excavation pit — recessed dark pad with formwork edges.
    const pit = new BoxGeometry(padW, 0.03, padD);
    pit.translate(cx, 0.015, cz);
    out.push({ geom: pit, color: CON_PAD_DARK });
    // Formwork — 4 thin border slabs around the pit (concrete pour mould).
    const fT = 0.04, fH = 0.10;
    for (const [dx, dz, w, d] of [
      [0, -padD / 2 + fT / 2, padW, fT] as const,
      [0,  padD / 2 - fT / 2, padW, fT] as const,
      [-padW / 2 + fT / 2, 0, fT, padD] as const,
      [ padW / 2 - fT / 2, 0, fT, padD] as const
    ]) {
      const f = new BoxGeometry(w, fH, d);
      f.translate(cx + dx, fH / 2, cz + dz);
      out.push({ geom: f, color: CON_LUMBER });
    }
  } else {
    // Poured concrete slab.
    const pad = new BoxGeometry(padW, 0.08, padD);
    pad.translate(cx, 0.04, cz);
    out.push({ geom: pad, color: CON_PAD_LIGHT });
  }
}

/** Tower crane (parametric height). Mast + horizontal jib + counter-jib +
 *  operator cab + a hanging hook on a cable. Lattice mast suggested via
 *  4 thin vertical members + 2-3 horizontal cross-bars. */
function emitTowerCrane(
  cox: number, coz: number, height: number, jibLen: number, hasHook: boolean,
  out: VariantPart[]
): void {
  // Lattice mast — 4 vertical bars in a small square + horizontal cross-braces.
  const mastHalf = 0.06;
  for (const [mx, mz] of [
    [-mastHalf, -mastHalf] as const, [ mastHalf, -mastHalf] as const,
    [-mastHalf,  mastHalf] as const, [ mastHalf,  mastHalf] as const
  ]) {
    const bar = new BoxGeometry(0.022, height, 0.022);
    bar.translate(cox + mx, height / 2, coz + mz);
    out.push({ geom: bar, color: CON_CRANE_YELLOW });
  }
  // 4 cross-brace rings spaced up the mast.
  const ringCount = Math.max(3, Math.floor(height / 0.5));
  for (let i = 1; i < ringCount; i++) {
    const ry = (height * i) / ringCount;
    const horiz = new BoxGeometry(mastHalf * 2 + 0.04, 0.018, 0.018);
    horiz.translate(cox, ry, coz - mastHalf);
    out.push({ geom: horiz, color: CON_CRANE_YELLOW });
    const horiz2 = new BoxGeometry(mastHalf * 2 + 0.04, 0.018, 0.018);
    horiz2.translate(cox, ry, coz + mastHalf);
    out.push({ geom: horiz2, color: CON_CRANE_YELLOW });
  }
  // Operator cab at the top of the mast.
  const cab = new BoxGeometry(0.16, 0.10, 0.14);
  cab.translate(cox + 0.04, height + 0.05, coz);
  out.push({ geom: cab, color: CON_CRANE_ORANGE });
  // Jib (long horizontal arm pointing one direction).
  const jib = new BoxGeometry(jibLen, 0.05, 0.05);
  jib.translate(cox + jibLen / 2, height + 0.02, coz);
  out.push({ geom: jib, color: CON_CRANE_YELLOW });
  // Counter-jib (short opposite-direction balance).
  const cjib = new BoxGeometry(0.30, 0.05, 0.05);
  cjib.translate(cox - 0.15, height + 0.02, coz);
  out.push({ geom: cjib, color: CON_CRANE_ORANGE });
  // Counter-weight at the end of the counter-jib.
  const cw = new BoxGeometry(0.12, 0.10, 0.10);
  cw.translate(cox - 0.30, height + 0.05, coz);
  out.push({ geom: cw, color: CON_STEEL });
  // Hook hanging from the jib on a thin cable.
  if (hasHook) {
    const cableLen = height * 0.35;
    const cable = new BoxGeometry(0.012, cableLen, 0.012);
    cable.translate(cox + jibLen * 0.65, height - cableLen / 2, coz);
    out.push({ geom: cable, color: CON_STEEL });
    const hook = new BoxGeometry(0.05, 0.05, 0.05);
    hook.translate(cox + jibLen * 0.65, height - cableLen - 0.02, coz);
    out.push({ geom: hook, color: CON_CRANE_ORANGE });
  }
}

/** Construction trailer parked on-site — small box with darker windows
 *  + door suggested via thin trim panels. */
function emitTrailer(cx: number, cz: number, out: VariantPart[]): void {
  const body = new BoxGeometry(0.40, 0.18, 0.22);
  body.translate(cx, 0.13, cz);
  out.push({ geom: body, color: CON_TRAILER });
  // Roof (slightly darker overhang).
  const roof = new BoxGeometry(0.42, 0.02, 0.24);
  roof.translate(cx, 0.23, cz);
  out.push({ geom: roof, color: CON_TRAILER_TRIM });
  // Two window panels (long thin dark stripes).
  const win1 = new BoxGeometry(0.10, 0.06, 0.005);
  win1.translate(cx - 0.10, 0.16, cz - 0.11);
  out.push({ geom: win1, color: CON_TRAILER_TRIM });
  const win2 = new BoxGeometry(0.10, 0.06, 0.005);
  win2.translate(cx + 0.05, 0.16, cz - 0.11);
  out.push({ geom: win2, color: CON_TRAILER_TRIM });
  // Door panel (narrow vertical stripe).
  const door = new BoxGeometry(0.06, 0.14, 0.005);
  door.translate(cx + 0.16, 0.10, cz - 0.11);
  out.push({ geom: door, color: CON_TRAILER_TRIM });
}

/** Lumber stack — short tan box of stacked planks. */
function emitLumberStack(cx: number, cz: number, out: VariantPart[]): void {
  const stack = new BoxGeometry(0.30, 0.08, 0.12);
  stack.translate(cx, 0.04, cz);
  out.push({ geom: stack, color: CON_LUMBER });
  // Strap bands across the stack (thin dark stripes).
  for (const sx of [-0.08, 0.08]) {
    const band = new BoxGeometry(0.018, 0.085, 0.13);
    band.translate(cx + sx, 0.04, cz);
    out.push({ geom: band, color: CON_TRAILER_TRIM });
  }
}

/** Rebar bundle — cluster of thin orange-rust cylinders sticking up. */
function emitRebarBundle(cx: number, cz: number, count: number, out: VariantPart[]): void {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const r = 0.04;
    const rx = cx + Math.cos(angle) * r;
    const rz = cz + Math.sin(angle) * r;
    const rebar = new CylinderGeometry(0.012, 0.012, 0.20, 4);
    rebar.translate(rx, 0.10, rz);
    out.push({ geom: rebar, color: CON_REBAR });
  }
}

/** Concrete mixer — drum on a chassis. The drum is a tilted cylinder
 *  for that classic mixer silhouette. */
function emitConcreteMixer(cx: number, cz: number, out: VariantPart[]): void {
  // Chassis base.
  const chassis = new BoxGeometry(0.34, 0.06, 0.18);
  chassis.translate(cx, 0.05, cz);
  out.push({ geom: chassis, color: CON_TRAILER_TRIM });
  // Mixing drum — wider end forward, narrower end back.
  const drum = new CylinderGeometry(0.13, 0.10, 0.32, 8);
  drum.rotateZ(Math.PI / 2);
  drum.translate(cx, 0.18, cz);
  out.push({ geom: drum, color: CON_MIXER });
  // Yellow stripe ring around the drum.
  const stripe = new CylinderGeometry(0.135, 0.135, 0.04, 8);
  stripe.rotateZ(Math.PI / 2);
  stripe.translate(cx, 0.18, cz);
  out.push({ geom: stripe, color: CON_CRANE_YELLOW });
}

/** Construction hoist / material lift — a tall vertical track with a
 *  cab parked partway up. Sits on one side of the building. */
function emitHoistLift(
  cox: number, coz: number, towerH: number, cabHeightFrac: number, out: VariantPart[]
): void {
  // Vertical track (lattice).
  for (const tx of [-0.04, 0.04]) {
    const track = new BoxGeometry(0.018, towerH, 0.018);
    track.translate(cox + tx, towerH / 2, coz);
    out.push({ geom: track, color: CON_STEEL });
  }
  // Horizontal lattice cross-bars.
  const rungCount = Math.max(3, Math.floor(towerH / 0.4));
  for (let i = 1; i < rungCount; i++) {
    const ry = (towerH * i) / rungCount;
    const rung = new BoxGeometry(0.10, 0.014, 0.014);
    rung.translate(cox, ry, coz);
    out.push({ geom: rung, color: CON_STEEL });
  }
  // Cab parked partway up.
  const cabY = towerH * cabHeightFrac;
  const cab = new BoxGeometry(0.18, 0.16, 0.18);
  cab.translate(cox, cabY, coz);
  out.push({ geom: cab, color: CON_HOIST });
  // Cab roof.
  const roof = new BoxGeometry(0.20, 0.02, 0.20);
  roof.translate(cox, cabY + 0.09, coz);
  out.push({ geom: roof, color: CON_TRAILER_TRIM });
}

/** Stage 0 — Site Prep:
 *  Excavation pit + formwork + trailer + lumber + rebar + concrete mixer
 *  + a short half-erected crane. Reads as "first week on site." */
function emitStage0SitePrep(
  d: SkyscraperDesign, cx: number, cz: number, out: VariantPart[]
): void {
  emitFoundationPad(0, cx, cz, out);
  // Trailer in the back-left corner.
  emitTrailer(cx - 0.55, cz - 0.55, out);
  // Lumber stack near the trailer.
  emitLumberStack(cx - 0.55, cz - 0.20, out);
  // Rebar bundle in the front-right corner.
  emitRebarBundle(cx + 0.55, cz - 0.55, 6, out);
  // Concrete mixer in the front-left.
  emitConcreteMixer(cx - 0.30, cz + 0.50, out);
  // Pile of dirt (excavation spoil) near the back-right.
  const spoil = new ConeGeometry(0.16, 0.14, 6);
  spoil.translate(cx + 0.55, 0.07, cz + 0.30);
  out.push({ geom: spoil, color: CON_PAD_DARK });
  // Half-erected starter crane — short, no jib yet.
  const starterH = d.height * 0.35;
  // Lattice mast only.
  for (const [mx, mz] of [
    [-0.06, -0.06] as const, [ 0.06, -0.06] as const,
    [-0.06,  0.06] as const, [ 0.06,  0.06] as const
  ]) {
    const bar = new BoxGeometry(0.022, starterH, 0.022);
    bar.translate(cx + 0.30 + mx, starterH / 2, cz + 0.30 + mz);
    out.push({ geom: bar, color: CON_CRANE_YELLOW });
  }
  // Single ring of cross-braces midway.
  const horiz = new BoxGeometry(0.16, 0.018, 0.018);
  horiz.translate(cx + 0.30, starterH * 0.5, cz + 0.30 - 0.06);
  out.push({ geom: horiz, color: CON_CRANE_YELLOW });
}

/** Stage 1 — Lower Floors:
 *  Concrete foundation slab with 2-3 floor plates rising. Corner columns,
 *  rebar sticking out the top, construction hoist on the east side, and
 *  one full tower crane. */
function emitStage1LowerFloors(
  d: SkyscraperDesign, cx: number, cz: number, out: VariantPart[]
): void {
  emitFoundationPad(1, cx, cz, out);
  const baseW = 2.0 - d.inset * 2;
  const baseD = 2.0 - d.inset * 2;
  // Built height — 30% of total. Stack as 2-3 visible floor plates.
  const builtH = d.height * 0.30;
  const floorCount = 3;
  const floorH = builtH / floorCount;
  for (let i = 0; i < floorCount; i++) {
    // Floor plate.
    const plate = new BoxGeometry(baseW, floorH * 0.85, baseD);
    plate.translate(cx, 0.08 + floorH * i + floorH * 0.425, cz);
    out.push({ geom: plate, color: CON_CONCRETE });
    // Thin shadow gap between plates (suggests floor edge).
    if (i < floorCount - 1) {
      const gap = new BoxGeometry(baseW + 0.01, floorH * 0.10, baseD + 0.01);
      gap.translate(cx, 0.08 + floorH * (i + 1) - floorH * 0.05, cz);
      out.push({ geom: gap, color: CON_CONCRETE_DEEP });
    }
  }
  // 4 corner columns sticking up above the built height (columns for next floor).
  const colExtra = floorH * 0.8;
  for (const [dx, dz] of [
    [-baseW / 2 + 0.12, -baseD / 2 + 0.12] as const,
    [ baseW / 2 - 0.12, -baseD / 2 + 0.12] as const,
    [-baseW / 2 + 0.12,  baseD / 2 - 0.12] as const,
    [ baseW / 2 - 0.12,  baseD / 2 - 0.12] as const
  ]) {
    const col = new BoxGeometry(0.10, colExtra, 0.10);
    col.translate(cx + dx, 0.08 + builtH + colExtra / 2, cz + dz);
    out.push({ geom: col, color: CON_CONCRETE_DEEP });
  }
  // Rebar bundles on top, ready for the next pour.
  for (const [dx, dz] of [[0.30, 0.30], [-0.30, -0.30], [0.30, -0.30]] as const) {
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const rx = cx + dx + Math.cos(angle) * 0.04;
      const rz = cz + dz + Math.sin(angle) * 0.04;
      const rebar = new CylinderGeometry(0.010, 0.010, 0.18, 4);
      rebar.translate(rx, 0.08 + builtH + 0.09, rz);
      out.push({ geom: rebar, color: CON_REBAR });
    }
  }
  // Construction hoist on the east face (outside the building).
  emitHoistLift(cx + 0.85, cz, builtH * 1.4, 0.6, out);
  // One full tower crane — taller than anything currently built.
  emitTowerCrane(cx - 0.50, cz - 0.50, d.height * 0.85, 0.55, true, out);
  // Lumber stack on the ground.
  emitLumberStack(cx + 0.50, cz + 0.55, out);
}

/** Stage 2 — Steel Skeleton:
 *  Concrete podium below + steel I-beam framework above + scaffolding
 *  wrap + safety tarp on one face. Two cranes (peak structural work).
 *  Reads as "the building's bones are going up." */
function emitStage2SteelSkeleton(
  d: SkyscraperDesign, cx: number, cz: number, out: VariantPart[]
): void {
  emitFoundationPad(2, cx, cz, out);
  const baseW = 2.0 - d.inset * 2;
  const baseD = 2.0 - d.inset * 2;
  const totalBuilt = d.height * 0.55;
  const podiumH = totalBuilt * 0.35;
  const skeletonH = totalBuilt - podiumH;
  // Concrete podium (lower 35% of the built portion).
  const podium = new BoxGeometry(baseW, podiumH, baseD);
  podium.translate(cx, 0.08 + podiumH / 2, cz);
  out.push({ geom: podium, color: CON_CONCRETE });
  // Floor plate caps on the podium (so the floors read).
  for (let i = 1; i < 3; i++) {
    const ly = 0.08 + (podiumH * i) / 3;
    const plate = new BoxGeometry(baseW + 0.01, 0.04, baseD + 0.01);
    plate.translate(cx, ly, cz);
    out.push({ geom: plate, color: CON_CONCRETE_DEEP });
  }
  // Steel skeleton — 4 corner columns + horizontal beam grid.
  const skBaseY = 0.08 + podiumH;
  const colW = 0.08;
  for (const [dx, dz] of [
    [-baseW / 2 + colW, -baseD / 2 + colW] as const,
    [ baseW / 2 - colW, -baseD / 2 + colW] as const,
    [-baseW / 2 + colW,  baseD / 2 - colW] as const,
    [ baseW / 2 - colW,  baseD / 2 - colW] as const
  ]) {
    const col = new BoxGeometry(colW, skeletonH, colW);
    col.translate(cx + dx, skBaseY + skeletonH / 2, cz + dz);
    out.push({ geom: col, color: CON_STEEL });
  }
  // Horizontal beams at each floor level (suggests floor framing).
  const skFloorCount = 4;
  for (let i = 1; i <= skFloorCount; i++) {
    const fy = skBaseY + (skeletonH * i) / skFloorCount;
    // 4 perimeter beams forming a rectangle.
    const beamT = 0.04;
    const bn = new BoxGeometry(baseW - colW, beamT, beamT);
    bn.translate(cx, fy, cz - baseD / 2 + colW);
    out.push({ geom: bn, color: CON_STEEL_BRIGHT });
    const bs = new BoxGeometry(baseW - colW, beamT, beamT);
    bs.translate(cx, fy, cz + baseD / 2 - colW);
    out.push({ geom: bs, color: CON_STEEL_BRIGHT });
    const be = new BoxGeometry(beamT, beamT, baseD - colW);
    be.translate(cx + baseW / 2 - colW, fy, cz);
    out.push({ geom: be, color: CON_STEEL_BRIGHT });
    const bw = new BoxGeometry(beamT, beamT, baseD - colW);
    bw.translate(cx - baseW / 2 + colW, fy, cz);
    out.push({ geom: bw, color: CON_STEEL_BRIGHT });
  }
  // Scaffolding — thin diagonal/horizontal members on two visible faces.
  // Just enough to suggest a wrap without rendering 200 thin boxes.
  for (let i = 0; i < 4; i++) {
    const sy = 0.10 + (totalBuilt * (i + 0.5)) / 4;
    // South face horizontal member.
    const sh = new BoxGeometry(baseW * 1.05, 0.018, 0.018);
    sh.translate(cx, sy, cz + baseD / 2 + 0.02);
    out.push({ geom: sh, color: CON_STEEL_BRIGHT });
    // East face horizontal member.
    const eh = new BoxGeometry(0.018, 0.018, baseD * 1.05);
    eh.translate(cx + baseW / 2 + 0.02, sy, cz);
    out.push({ geom: eh, color: CON_STEEL_BRIGHT });
  }
  // Safety tarp / scrim on one face (north face — large grey panel).
  const tarp = new BoxGeometry(baseW * 1.02, totalBuilt * 0.7, 0.01);
  tarp.translate(cx, 0.08 + totalBuilt * 0.45, cz - baseD / 2 - 0.02);
  out.push({ geom: tarp, color: CON_TARP });
  // Construction hoist on east face.
  emitHoistLift(cx + 0.92, cz + 0.10, totalBuilt * 1.1, 0.7, out);
  // Two cranes — peak structural-work moment.
  emitTowerCrane(cx - 0.55, cz - 0.55, d.height * 0.95, 0.60, true, out);
  emitTowerCrane(cx + 0.30, cz + 0.55, d.height * 0.85, 0.50, false, out);
}

/** Stage 3 — Facade Going Up:
 *  Most of the tower has facade + glazing; the top section is still bare
 *  steel + scaffolding. One crane near the top of the unfinished section
 *  + construction hoist on the side. Reads as "almost done, just the
 *  cladding to finish." */
function emitStage3FacadeGoingUp(
  d: SkyscraperDesign, cx: number, cz: number, out: VariantPart[]
): void {
  emitFoundationPad(3, cx, cz, out);
  const baseW = 2.0 - d.inset * 2;
  const baseD = 2.0 - d.inset * 2;
  const totalBuilt = d.height * 0.80;
  const facadeFrac = 0.75;     // lower 75% of built height has facade
  const facadeH = totalBuilt * facadeFrac;
  const skeletonH = totalBuilt - facadeH;
  // Finished facade body for the lower portion.
  const facade = new BoxGeometry(baseW, facadeH, baseD);
  facade.translate(cx, 0.08 + facadeH / 2, cz);
  out.push({ geom: facade, color: mixHexLocal(d.bodyColor, 0xc8c4be, 0.20) });
  // Window banding on the facade — every ~0.5 units.
  const bandSpacing = 0.50;
  const facadeTopY = 0.08 + facadeH;
  for (let by = 0.45; by < facadeH - 0.15; by += bandSpacing) {
    const band = new BoxGeometry(baseW + 0.005, 0.14, baseD + 0.005);
    band.translate(cx, 0.08 + by, cz);
    out.push({ geom: band, color: d.glassColor });
  }
  // Vertical fins at the corners (so the facade reads as proper highrise).
  const finT = 0.04;
  for (const [dx, dz] of [
    [-baseW / 2 + finT / 2, -baseD / 2 + finT / 2] as const,
    [ baseW / 2 - finT / 2, -baseD / 2 + finT / 2] as const,
    [-baseW / 2 + finT / 2,  baseD / 2 - finT / 2] as const,
    [ baseW / 2 - finT / 2,  baseD / 2 - finT / 2] as const
  ]) {
    const fin = new BoxGeometry(finT, facadeH, finT);
    fin.translate(cx + dx, 0.08 + facadeH / 2, cz + dz);
    out.push({ geom: fin, color: d.bodyColor });
  }
  // Steel skeleton above the facade — 4 corner columns + horizontal beams.
  const colW = 0.08;
  for (const [dx, dz] of [
    [-baseW / 2 + colW, -baseD / 2 + colW] as const,
    [ baseW / 2 - colW, -baseD / 2 + colW] as const,
    [-baseW / 2 + colW,  baseD / 2 - colW] as const,
    [ baseW / 2 - colW,  baseD / 2 - colW] as const
  ]) {
    const col = new BoxGeometry(colW, skeletonH, colW);
    col.translate(cx + dx, facadeTopY + skeletonH / 2, cz + dz);
    out.push({ geom: col, color: CON_STEEL });
  }
  // Horizontal beams.
  for (let i = 1; i <= 2; i++) {
    const fy = facadeTopY + (skeletonH * i) / 2;
    const beamT = 0.04;
    for (const [w, d2, dx, dz] of [
      [baseW - colW, beamT, 0, -baseD / 2 + colW] as const,
      [baseW - colW, beamT, 0,  baseD / 2 - colW] as const,
      [beamT, baseD - colW,  baseW / 2 - colW, 0] as const,
      [beamT, baseD - colW, -baseW / 2 + colW, 0] as const
    ]) {
      const b = new BoxGeometry(w, beamT, d2);
      b.translate(cx + dx, fy, cz + dz);
      out.push({ geom: b, color: CON_STEEL_BRIGHT });
    }
  }
  // Scaffolding wrap on the bare-steel top section.
  for (let i = 0; i < 2; i++) {
    const sy = facadeTopY + (skeletonH * (i + 0.5)) / 2;
    const sh = new BoxGeometry(baseW * 1.05, 0.018, 0.018);
    sh.translate(cx, sy, cz + baseD / 2 + 0.02);
    out.push({ geom: sh, color: CON_STEEL_BRIGHT });
    const eh = new BoxGeometry(0.018, 0.018, baseD * 1.05);
    eh.translate(cx + baseW / 2 + 0.02, sy, cz);
    out.push({ geom: eh, color: CON_STEEL_BRIGHT });
  }
  // Construction hoist still on the east face — nearly to the top.
  emitHoistLift(cx + 0.92, cz - 0.10, totalBuilt * 1.05, 0.85, out);
  // One crane near the top of the bare-steel section.
  emitTowerCrane(cx - 0.55, cz + 0.50, d.height * 1.05, 0.55, true, out);
}

