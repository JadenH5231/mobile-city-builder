import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry
} from 'three';
import type { Zone } from '../types';

/**
 * Per-zone × per-tier × variant building geometry kit (Alpha 2.1).
 *
 * Three visually distinct silhouettes per (zone, density) pair, picked
 * deterministically per tile so a single street of L1 residences shows a
 * mix of cottages / ranches / cabins without looking random. The kit is a
 * spec table: each variant is a plain config object describing a body box,
 * an optional roof, and optional decorations. {@link buildVariantParts}
 * resolves the spec into a flat list of `{ geom, color }` pairs already
 * positioned at the tile's world centre, ready to merge into the global
 * buildings mesh.
 *
 * Why specs vs hand-coded geometry per variant: 36 variants would be 36
 * functions of similar shape. The spec-driven path lets the kit grow with
 * one-line config additions and keeps the visual taxonomy readable.
 */

export interface VariantPart {
  geom: BufferGeometry;
  color: number;
}

/* ---- Spec types ----------------------------------------------------- */

interface Body {
  /** XZ footprint in tile units (max ~0.95 to leave a sliver). */
  w: number;
  d: number;
  /** Vertical height in tile units. */
  h: number;
  color: number;
  /** Optional XZ inset for setbacks (tower-on-podium etc). Defaults to 0. */
  inset?: number;
  /** Y offset of the body's base. Defaults to 0 (sits on ground). */
  yBase?: number;
}

interface Roof {
  /** flat = no roof piece (body is its own top); pyramid = 4-sided cone;
   *  gable = triangular prism; hip = pyramid with shorter ridge. */
  kind: 'flat' | 'pyramid' | 'gable' | 'hip';
  /** Roof height above the body top. */
  height: number;
  color: number;
}

interface Chimney { kind: 'chimney'; dx: number; dz: number; h: number; color: number }
interface Antenna { kind: 'antenna'; h: number; color: number }
interface Tower {
  kind: 'tower';
  /** Smaller body on top of the main body (skyscraper setback). */
  w: number; d: number; h: number; color: number;
  roofKind?: 'flat' | 'pyramid' | 'gable';
  roofHeight?: number;
  roofColor?: number;
}
interface Awning {
  kind: 'awning';
  /** Side: which face of the body. */
  side: 'N' | 'S' | 'E' | 'W';
  width: number;
  depth: number;
  color: number;
}
interface Sign {
  kind: 'sign';
  side: 'N' | 'S' | 'E' | 'W';
  /** Width along building face. */
  w: number;
  /** Vertical height of sign. */
  h: number;
  /** Y offset (above ground). */
  y: number;
  color: number;
}
interface Tank {
  kind: 'tank';
  dx: number; dz: number;
  /** Cylinder radius, height. */
  r: number; h: number;
  color: number;
}
interface Stack {
  kind: 'stack';
  dx: number; dz: number;
  /** Tall industrial chimney. */
  h: number; color: number;
}
interface Crane {
  kind: 'crane';
  dx: number; dz: number;
  h: number;
  color: number;
}

type Decoration = Chimney | Antenna | Tower | Awning | Sign | Tank | Stack | Crane;

interface Spec {
  body: Body;
  roof?: Roof;
  /** Optional secondary body (e.g. attached garage, shop wing). */
  body2?: Body;
  decorations?: Decoration[];
}

/* ---- Builder -------------------------------------------------------- */

/**
 * Resolve a Spec into world-positioned BufferGeometry parts. Each part
 * carries its colour separately so the caller can vertex-paint it during
 * the merge step.
 */
export function buildVariantParts(
  zone: Zone, density: number, tileX: number, tileY: number,
  happiness = 0.5, yawOverride?: number
): VariantPart[] {
  if (zone === 'none' || density <= 0) return [];
  const variants = VARIANTS[zone]?.[density as 1 | 2 | 3 | 4];
  if (!variants || variants.length === 0) return [];
  // Deterministic variant pick — same tile always renders the same variant.
  const variantIdx = pickVariant(tileX, tileY, variants.length);
  const spec = variants[variantIdx]!;

  // Tiny deterministic jitter so a row of identical-variant tiles still
  // reads as individual buildings rather than a stamp.
  const r = Math.abs(((tileX * 374761393) ^ (tileY * 668265263)) | 0);
  const ox = ((r % 1000) / 1000 - 0.5) * 0.05;
  const oz = (((r >> 10) % 1000) / 1000 - 0.5) * 0.05;
  // Yaw: prefer the road-facing override so the building's front face,
  // awning, sign, walkway and shrubs all aim at the nearest road. Falls
  // back to a deterministic random rotation when no road is adjacent
  // (shouldn't happen in normal play, but it keeps the renderer robust
  // for off-grid or transient states).
  const yaw = yawOverride !== undefined
    ? yawOverride
    : ((r >> 20) & 3) * (Math.PI / 2);

  const cx = tileX + 0.5 + ox;
  const cz = tileY + 0.5 + oz;

  const out: VariantPart[] = [];
  emitGroundAccents(spec.body, zone, density, cx, cz, yaw, tileX, tileY, out);
  applySpec(spec, cx, cz, yaw, out, zone, tileX, tileY, happiness);
  return out;
}

/**
 * Curb appeal — every zoned tile gets a ground pad, a walkway to the
 * "front" face (chosen by the body's yaw), and zone-appropriate accents:
 *   - Residential L1/L2: hedge along back, shrubs flanking entrance
 *   - Residential L3 / Mixed L2+: planter near entrance
 *   - Commercial: planter boxes at corners on some variants
 *   - Industrial: chain-link perimeter (4 corner posts + 4 rails)
 *
 * Drawn BEFORE the body so the body always sits on top — no z-fighting
 * between pad and building.
 */
function emitGroundAccents(
  body: Body, zone: Zone, density: number,
  cx: number, cz: number, yaw: number,
  tileX: number, tileY: number, out: VariantPart[]
): void {
  if (zone === 'none' || body.w <= 0 || body.d <= 0) return;
  const r = Math.abs(((tileX * 1597334677) ^ (tileY * 2246822519)) | 0);

  // Quantised yaw → which face is "front" (0=+Z, 1=+X, 2=-Z, 3=-X).
  const yawIdx = Math.round(yaw / (Math.PI / 2)) & 3;

  // Ground pad colour per zone — green lawn for R, paved for C, concrete
  // dust for I, garden mix for MU.
  let padColor: number;
  let walkColor: number;
  if (zone === 'residential') {
    padColor = 0x4a8a44;
    walkColor = 0xc7b08a;
  } else if (zone === 'commercial') {
    padColor = 0xa8a094;
    walkColor = 0xc7c2b3;
  } else if (zone === 'industrial') {
    padColor = 0x8a7a5c;
    walkColor = 0x9a9080;
  } else {
    // mixed-use
    padColor = 0x6a8a5e;
    walkColor = 0xc7b08a;
  }

  // 1) Lawn / pavement pad covering the tile.
  const pad = new BoxGeometry(0.94, 0.008, 0.94);
  pad.translate(cx, 0.004, cz);
  out.push({ geom: pad, color: padColor });

  // 2) Front walkway — from the body's front face out to the tile edge.
  const halfTile = 0.46;
  const bodyHalf = (yawIdx & 1) ? body.w / 2 : body.d / 2;
  const walkLen = halfTile - bodyHalf;
  if (walkLen > 0.05) {
    const walkW = 0.18;
    let walkX = 0, walkZ = 0, gw = walkW, gd = walkW;
    if (yawIdx === 0)      { walkZ =  bodyHalf + walkLen / 2; gd = walkLen; }
    else if (yawIdx === 1) { walkX =  bodyHalf + walkLen / 2; gw = walkLen; }
    else if (yawIdx === 2) { walkZ = -bodyHalf - walkLen / 2; gd = walkLen; }
    else                   { walkX = -bodyHalf - walkLen / 2; gw = walkLen; }
    const walk = new BoxGeometry(gw, 0.014, gd);
    walk.translate(cx + walkX, 0.011, cz + walkZ);
    out.push({ geom: walk, color: walkColor });
  }

  // 3) Per-zone accents.
  if (zone === 'residential' && density === 1) {
    // Two shrubs flanking the entrance.
    const shrubR = 0.06;
    const shrubH = 0.10;
    const gap = 0.18;
    let s1x = 0, s1z = 0, s2x = 0, s2z = 0;
    if (yawIdx === 0)      { s1x = -gap; s1z =  body.d/2 + 0.08; s2x =  gap; s2z =  body.d/2 + 0.08; }
    else if (yawIdx === 1) { s1x =  body.w/2 + 0.08; s1z = -gap; s2x =  body.w/2 + 0.08; s2z =  gap; }
    else if (yawIdx === 2) { s1x = -gap; s1z = -body.d/2 - 0.08; s2x =  gap; s2z = -body.d/2 - 0.08; }
    else                   { s1x = -body.w/2 - 0.08; s1z = -gap; s2x = -body.w/2 - 0.08; s2z =  gap; }
    const s1 = new ConeGeometry(shrubR, shrubH, 6);
    s1.translate(cx + s1x, shrubH / 2 + 0.008, cz + s1z);
    out.push({ geom: s1, color: 0x4f6b3a });
    const s2 = new ConeGeometry(shrubR, shrubH, 6);
    s2.translate(cx + s2x, shrubH / 2 + 0.008, cz + s2z);
    out.push({ geom: s2, color: 0x4f6b3a });
  }

  // 4) Hedge along the back of residential/mixed lots (deterministic).
  if ((zone === 'residential' || zone === 'mixed') && (r & 1) === 0) {
    const backIdx = (yawIdx + 2) & 3;
    const hedgeColor = 0x4a6b3a;
    const hedgeH = 0.09;
    const hedgeLen = 0.55;
    const hedgeThick = 0.06;
    let hx = 0, hz = 0, hw = 0, hd = 0;
    if (backIdx === 0)      { hz =  body.d/2 + 0.11; hw = hedgeLen;  hd = hedgeThick; }
    else if (backIdx === 1) { hx =  body.w/2 + 0.11; hw = hedgeThick; hd = hedgeLen; }
    else if (backIdx === 2) { hz = -body.d/2 - 0.11; hw = hedgeLen;  hd = hedgeThick; }
    else                    { hx = -body.w/2 - 0.11; hw = hedgeThick; hd = hedgeLen; }
    const hedge = new BoxGeometry(hw, hedgeH, hd);
    hedge.translate(cx + hx, hedgeH / 2 + 0.008, cz + hz);
    out.push({ geom: hedge, color: hedgeColor });
  }

  // 5) Industrial chain-link perimeter.
  if (zone === 'industrial') {
    const fenceColor = 0x5a5a5a;
    const postH = 0.11;
    const postOffs = [
      [-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42],
      [0, -0.42], [0, 0.42], [-0.42, 0], [0.42, 0]
    ];
    for (const [px, pz] of postOffs) {
      const post = new BoxGeometry(0.022, postH, 0.022);
      post.translate(cx + px!, postH / 2 + 0.008, cz + pz!);
      out.push({ geom: post, color: fenceColor });
    }
    // Top + middle rails on the 4 sides.
    const rail = (w: number, d: number, dx: number, dz: number, y: number) => {
      const g = new BoxGeometry(w, 0.018, d);
      g.translate(cx + dx, y, cz + dz);
      out.push({ geom: g, color: fenceColor });
    };
    rail(0.84, 0.012, 0, -0.42, 0.10);
    rail(0.84, 0.012, 0,  0.42, 0.10);
    rail(0.012, 0.84, -0.42, 0,  0.10);
    rail(0.012, 0.84,  0.42, 0,  0.10);
  }

  // 6) Commercial planter boxes at the front corners (1-in-4 variant).
  if (zone === 'commercial' && (r & 3) === 0) {
    const planterColor = 0x6b4f3a;
    const plantColor = 0x4a7a3a;
    // Place planters near the entrance corner.
    let corners: [number, number][] = [];
    if (yawIdx === 0)      corners = [[-0.36, 0.36], [0.36, 0.36]];
    else if (yawIdx === 1) corners = [[0.36, -0.36], [0.36, 0.36]];
    else if (yawIdx === 2) corners = [[-0.36, -0.36], [0.36, -0.36]];
    else                   corners = [[-0.36, -0.36], [-0.36, 0.36]];
    for (const [px, pz] of corners) {
      const pl = new BoxGeometry(0.10, 0.05, 0.10);
      pl.translate(cx + px, 0.033, cz + pz);
      out.push({ geom: pl, color: planterColor });
      const plant = new ConeGeometry(0.05, 0.10, 6);
      plant.translate(cx + px, 0.058 + 0.05, cz + pz);
      out.push({ geom: plant, color: plantColor });
    }
  }

  // 7) Mixed-use: bike rack along the front sidewalk (1-in-2 variant).
  if (zone === 'mixed' && (r & 2) === 0 && density >= 2) {
    const rackColor = 0x4a4a52;
    const rackH = 0.08;
    let rx = 0, rz = 0, rw = 0.22, rd = 0.025;
    if (yawIdx === 0)      { rz =  body.d/2 + 0.12; }
    else if (yawIdx === 1) { rx =  body.w/2 + 0.12; rw = 0.025; rd = 0.22; }
    else if (yawIdx === 2) { rz = -body.d/2 - 0.12; }
    else                   { rx = -body.w/2 - 0.12; rw = 0.025; rd = 0.22; }
    // Three loops on a horizontal bar
    const rack = new BoxGeometry(rw, 0.012, rd);
    rack.translate(cx + rx, rackH, cz + rz);
    out.push({ geom: rack, color: rackColor });
    // Two end posts
    const post1 = new BoxGeometry(0.018, rackH, 0.018);
    if (yawIdx & 1) {
      post1.translate(cx + rx, rackH / 2, cz + rz - rd / 2 + 0.01);
    } else {
      post1.translate(cx + rx - rw / 2 + 0.01, rackH / 2, cz + rz);
    }
    out.push({ geom: post1, color: rackColor });
    const post2 = new BoxGeometry(0.018, rackH, 0.018);
    if (yawIdx & 1) {
      post2.translate(cx + rx, rackH / 2, cz + rz + rd / 2 - 0.01);
    } else {
      post2.translate(cx + rx + rw / 2 - 0.01, rackH / 2, cz + rz);
    }
    out.push({ geom: post2, color: rackColor });
  }
}

function pickVariant(x: number, y: number, n: number): number {
  // Same hash family as the building jitter and tree placement.
  const h = Math.abs(((x * 2654435761) ^ (y * 1597334677)) | 0);
  return h % n;
}

/* ---- Luxury low-density (Alpha 2.5) -------------------------------- */

/**
 * Build a single luxury home spanning two adjacent tiles. Caller passes
 * the lex-smaller tile's coords first; partner is one of the 4-neighbours.
 *
 * Design: a grand 2-storey home, peaked gabled roof along the long axis,
 * an attached 1-storey garage on one end, dormer windows, twin chimneys,
 * a manicured lawn pad, a paved front walk, and 2 ornamental shrubs. Three
 * deterministic variants per pair (mansion, ranch, modern-glass).
 */
export function buildLuxuryParts(
  ax: number, ay: number, bx: number, by: number,
  /** Cardinal yaw (0=S, π/2=E, π=N, 3π/2=W) pointing toward the
   *  nearest road tile, or undefined when no road is 4-adjacent to
   *  either tile of the pair. Alpha 4.3.1: when provided, the walkway
   *  is aimed at the road instead of laid as a centred T. */
  roadYaw?: number
): VariantPart[] {
  const out: VariantPart[] = [];
  // Pair centre (midpoint between the two tile centres).
  const cx = (ax + bx) / 2 + 0.5;
  const cz = (ay + by) / 2 + 0.5;
  // Long-axis = direction from a to b.
  const longX = bx !== ax;
  // 2-tile span: 2 units along long axis, 1 unit perpendicular.
  // Variant pick keyed off the lex-smaller tile so it's stable across
  // re-renders.
  const variantIdx = pickVariant(ax, ay, LUXURY_VARIANTS.length);
  const v = LUXURY_VARIANTS[variantIdx]!;

  // Lawn pad — soft green, slightly inset, sits at ground.
  const lawnW = longX ? 1.85 : 0.85;
  const lawnD = longX ? 0.85 : 1.85;
  const lawn = new BoxGeometry(lawnW, 0.015, lawnD);
  lawn.translate(cx, 0.0075, cz);
  out.push({ geom: lawn, color: v.lawnColor });

  // Paved walkway. Alpha 4.3.1: when the caller computed a road yaw,
  // aim the walkway at the road instead of laying a centred T. Body
  // dimensions are bodyLong=1.40, bodyShort=0.62 (see below); the
  // walkway runs from the body's edge in the chosen direction out to
  // the pair tile-edge.
  if (roadYaw !== undefined) {
    const yawIdx = Math.round(roadYaw / (Math.PI / 2)) & 3;  // 0=S, 1=E, 2=N, 3=W
    // Is the road direction along the pair's long axis or perpendicular?
    const alongLong = (longX && (yawIdx === 1 || yawIdx === 3))
                   || (!longX && (yawIdx === 0 || yawIdx === 2));
    const bodyHalf = alongLong ? 0.70 : 0.31;   // bodyLong/2 or bodyShort/2
    const pairHalf = alongLong ? 1.0 : 0.5;     // half-length of pair along this axis
    const walkLen = pairHalf - bodyHalf;
    if (walkLen > 0.05) {
      const walkOffset = bodyHalf + walkLen / 2;
      let dx = 0, dz = 0, gw = 0.20, gd = 0.20;
      if (yawIdx === 0)      { dz =  walkOffset; gd = walkLen; }
      else if (yawIdx === 1) { dx =  walkOffset; gw = walkLen; }
      else if (yawIdx === 2) { dz = -walkOffset; gd = walkLen; }
      else                   { dx = -walkOffset; gw = walkLen; }
      const walk = new BoxGeometry(gw, 0.018, gd);
      walk.translate(cx + dx, 0.009, cz + dz);
      out.push({ geom: walk, color: 0xb6ad9b });
    }
  } else {
    // Fallback: no road adjacent (e.g. mansion deep on a park lot, or
    // before the road is paved). Centred T-shape — matches pre-4.3.1
    // behaviour so the lawn still has a visible front-walk element.
    const walkW = longX ? 0.9 : 0.18;
    const walkD = longX ? 0.18 : 0.9;
    const walk = new BoxGeometry(walkW, 0.018, walkD);
    walk.translate(cx, 0.009, cz);
    out.push({ geom: walk, color: 0xb6ad9b });
  }

  // Main body — wider on long axis. Sits centred but biased a touch
  // toward the "back" so the front lawn reads.
  const bodyLong = 1.40;
  const bodyShort = 0.62;
  const bodyH = v.twoStorey ? 0.55 : 0.32;
  const bodyW = longX ? bodyLong : bodyShort;
  const bodyD = longX ? bodyShort : bodyLong;
  const body: Body = {
    w: bodyW, h: bodyH, d: bodyD, color: v.bodyColor
  };
  emitBody(body, cx, cz, 0, out);

  // Roof — long gable along the long axis.
  if (v.roof === 'gable') {
    emitGableLong(body, v.roofColor, longX, cx, cz, out);
  } else if (v.roof === 'hip') {
    emitHipLong(body, v.roofColor, longX, cx, cz, out);
  } else {
    // flat — emit a slim parapet so it doesn't read as bare.
    const parapet = new BoxGeometry(bodyW + 0.04, 0.04, bodyD + 0.04);
    parapet.translate(cx, bodyH + 0.02, cz);
    out.push({ geom: parapet, color: v.roofColor });
  }

  // Garage wing — 1-storey block attached to one end of the long axis.
  // Picks the "right" end deterministically per variant.
  const garageH = 0.24;
  const garageLong = 0.55;
  const garageShort = 0.50;
  const garageW = longX ? garageLong : garageShort;
  const garageD = longX ? garageShort : garageLong;
  const garageOffset = (bodyLong / 2 + garageLong / 2 - 0.05) * (v.garageSide === 'b' ? 1 : -1);
  const garageCx = longX ? cx + garageOffset : cx;
  const garageCz = longX ? cz : cz + garageOffset;
  const garage: Body = {
    w: garageW, h: garageH, d: garageD, color: v.garageColor
  };
  emitBody(garage, garageCx, garageCz, 0, out);
  // Garage flat roof slab.
  const garageRoof = new BoxGeometry(garageW + 0.02, 0.025, garageD + 0.02);
  garageRoof.translate(garageCx, garageH + 0.0125, garageCz);
  out.push({ geom: garageRoof, color: v.roofColor });
  // Garage door panel (front face).
  const doorPanel = new BoxGeometry(
    longX ? garageW * 0.5 : 0.02,
    garageH * 0.7,
    longX ? 0.02 : garageD * 0.5
  );
  doorPanel.translate(
    garageCx,
    garageH * 0.4,
    longX ? garageCz + garageD / 2 + 0.005 : garageCz
  );
  if (!longX) {
    // Door faces along the perpendicular axis when the long axis is z.
    doorPanel.translate(garageW / 2 + 0.005 - garageCx, 0, 0);
    doorPanel.translate(garageCx, 0, 0);
  }
  out.push({ geom: doorPanel, color: 0x3a3a3a });

  // Two chimneys on the main body, one near each gable end.
  const chHeight = v.twoStorey ? 0.18 : 0.14;
  const chOffset = (longX ? bodyW : bodyD) * 0.32;
  if (longX) {
    const ch1 = new BoxGeometry(0.08, chHeight, 0.08);
    ch1.translate(cx - chOffset, bodyH + chHeight / 2, cz - bodyD * 0.20);
    out.push({ geom: ch1, color: v.chimneyColor });
    const ch2 = new BoxGeometry(0.08, chHeight, 0.08);
    ch2.translate(cx + chOffset, bodyH + chHeight / 2, cz + bodyD * 0.20);
    out.push({ geom: ch2, color: v.chimneyColor });
  } else {
    const ch1 = new BoxGeometry(0.08, chHeight, 0.08);
    ch1.translate(cx - bodyW * 0.20, bodyH + chHeight / 2, cz - chOffset);
    out.push({ geom: ch1, color: v.chimneyColor });
    const ch2 = new BoxGeometry(0.08, chHeight, 0.08);
    ch2.translate(cx + bodyW * 0.20, bodyH + chHeight / 2, cz + chOffset);
    out.push({ geom: ch2, color: v.chimneyColor });
  }

  // Window strip — single thin slab wrapping the long faces of the
  // body. Reads as multi-window facade without per-pane geometry.
  const winY = bodyH * (v.twoStorey ? 0.65 : 0.55);
  const winThick = 0.02;
  const winSpan = (longX ? bodyW : bodyD) * 0.78;
  const winHeight = v.twoStorey ? 0.10 : 0.08;
  if (longX) {
    const winN = new BoxGeometry(winSpan, winHeight, winThick);
    winN.translate(cx, winY, cz - bodyD / 2 - winThick / 2);
    out.push({ geom: winN, color: 0x2a3a4a });
    const winS = new BoxGeometry(winSpan, winHeight, winThick);
    winS.translate(cx, winY, cz + bodyD / 2 + winThick / 2);
    out.push({ geom: winS, color: 0x2a3a4a });
    if (v.twoStorey) {
      const winN2 = new BoxGeometry(winSpan, winHeight * 0.8, winThick);
      winN2.translate(cx, winY - 0.18, cz - bodyD / 2 - winThick / 2);
      out.push({ geom: winN2, color: 0x2a3a4a });
      const winS2 = new BoxGeometry(winSpan, winHeight * 0.8, winThick);
      winS2.translate(cx, winY - 0.18, cz + bodyD / 2 + winThick / 2);
      out.push({ geom: winS2, color: 0x2a3a4a });
    }
  } else {
    const winE = new BoxGeometry(winThick, winHeight, winSpan);
    winE.translate(cx + bodyW / 2 + winThick / 2, winY, cz);
    out.push({ geom: winE, color: 0x2a3a4a });
    const winW = new BoxGeometry(winThick, winHeight, winSpan);
    winW.translate(cx - bodyW / 2 - winThick / 2, winY, cz);
    out.push({ geom: winW, color: 0x2a3a4a });
    if (v.twoStorey) {
      const winE2 = new BoxGeometry(winThick, winHeight * 0.8, winSpan);
      winE2.translate(cx + bodyW / 2 + winThick / 2, winY - 0.18, cz);
      out.push({ geom: winE2, color: 0x2a3a4a });
      const winW2 = new BoxGeometry(winThick, winHeight * 0.8, winSpan);
      winW2.translate(cx - bodyW / 2 - winThick / 2, winY - 0.18, cz);
      out.push({ geom: winW2, color: 0x2a3a4a });
    }
  }

  // Front door panel (centred on the front of the body, opposite garage).
  const doorH = bodyH * 0.45;
  const doorW = 0.10;
  const doorThick = 0.02;
  const doorFront = longX ? new BoxGeometry(doorW, doorH, doorThick) : new BoxGeometry(doorThick, doorH, doorW);
  if (longX) {
    doorFront.translate(cx, doorH / 2, cz + bodyD / 2 + doorThick / 2);
  } else {
    doorFront.translate(cx + bodyW / 2 + doorThick / 2, doorH / 2, cz);
  }
  out.push({ geom: doorFront, color: 0x4a3020 });

  // Two ornamental shrubs flanking the door — small cones.
  const shrubR = 0.07;
  const shrubH = 0.10;
  const shrubColor = 0x4f6b3a;
  const shrubGap = 0.18;
  if (longX) {
    const s1 = new ConeGeometry(shrubR, shrubH, 6);
    s1.translate(cx - shrubGap, shrubH / 2, cz + bodyD / 2 + 0.10);
    out.push({ geom: s1, color: shrubColor });
    const s2 = new ConeGeometry(shrubR, shrubH, 6);
    s2.translate(cx + shrubGap, shrubH / 2, cz + bodyD / 2 + 0.10);
    out.push({ geom: s2, color: shrubColor });
  } else {
    const s1 = new ConeGeometry(shrubR, shrubH, 6);
    s1.translate(cx + bodyW / 2 + 0.10, shrubH / 2, cz - shrubGap);
    out.push({ geom: s1, color: shrubColor });
    const s2 = new ConeGeometry(shrubR, shrubH, 6);
    s2.translate(cx + bodyW / 2 + 0.10, shrubH / 2, cz + shrubGap);
    out.push({ geom: s2, color: shrubColor });
  }

  return out;
}

interface LuxuryVariant {
  bodyColor: number;
  roofColor: number;
  garageColor: number;
  lawnColor: number;
  chimneyColor: number;
  twoStorey: boolean;
  roof: 'gable' | 'hip' | 'flat';
  /** 'a' = garage at the lex-smaller end, 'b' = the partner end. */
  garageSide: 'a' | 'b';
}

const LUXURY_VARIANTS: LuxuryVariant[] = [
  // Classic mansion — cream-and-brick with a steep gable.
  {
    bodyColor: 0xe8d5b0, roofColor: 0x6f3a25, garageColor: 0xd6c0a0,
    lawnColor: 0x5e8a4c, chimneyColor: 0x6e4a3a,
    twoStorey: true, roof: 'gable', garageSide: 'b'
  },
  // Modern ranch — long single-storey with a low hip.
  {
    bodyColor: 0xeee2ce, roofColor: 0x4a4034, garageColor: 0xd9cdb8,
    lawnColor: 0x6a9054, chimneyColor: 0x4a3a2a,
    twoStorey: false, roof: 'hip', garageSide: 'a'
  },
  // Contemporary — flat roof, taupe with charcoal accents.
  {
    bodyColor: 0xc9b89c, roofColor: 0x3a3a3a, garageColor: 0xa9947a,
    lawnColor: 0x547a44, chimneyColor: 0x222222,
    twoStorey: true, roof: 'flat', garageSide: 'b'
  }
];

function emitGableLong(
  body: Body, roofColor: number, longX: boolean,
  cx: number, cz: number, out: VariantPart[]
): void {
  const yTop = body.h;
  const ridgeHeight = 0.22;
  // Ridge runs along the long axis. Two trapezoidal slopes.
  if (longX) {
    const positions = new Float32Array([
      cx - body.w / 2, yTop, cz - body.d / 2,
      cx + body.w / 2, yTop, cz - body.d / 2,
      cx + body.w / 2, yTop, cz + body.d / 2,
      cx - body.w / 2, yTop, cz + body.d / 2,
      cx - body.w / 2, yTop + ridgeHeight, cz,
      cx + body.w / 2, yTop + ridgeHeight, cz
    ]);
    const indices = new Uint32Array([
      0, 4, 1, 1, 4, 5,        // north slope
      3, 2, 5, 3, 5, 4,        // south slope
      0, 3, 4,                 // west gable
      1, 5, 2                  // east gable
    ]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(indices, 1));
    // Flat-shaded: skip normals.
    out.push({ geom: g, color: roofColor });
  } else {
    const positions = new Float32Array([
      cx - body.w / 2, yTop, cz - body.d / 2,
      cx + body.w / 2, yTop, cz - body.d / 2,
      cx + body.w / 2, yTop, cz + body.d / 2,
      cx - body.w / 2, yTop, cz + body.d / 2,
      cx, yTop + ridgeHeight, cz - body.d / 2,
      cx, yTop + ridgeHeight, cz + body.d / 2
    ]);
    const indices = new Uint32Array([
      0, 1, 4,                 // north gable
      3, 5, 2,                 // south gable
      0, 4, 3, 3, 4, 5,        // west slope
      1, 2, 5, 1, 5, 4         // east slope
    ]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(indices, 1));
    // Flat-shaded: skip normals.
    out.push({ geom: g, color: roofColor });
  }
}

function emitHipLong(
  body: Body, roofColor: number, longX: boolean,
  cx: number, cz: number, out: VariantPart[]
): void {
  // Hip = gable with shortened ridge. Build with the ridge running along
  // the long axis, ending well before the gable face.
  const yTop = body.h;
  const h = 0.15;
  const ridgeRecess = (longX ? body.w : body.d) * 0.30;
  if (longX) {
    const positions = new Float32Array([
      cx - body.w / 2, yTop, cz - body.d / 2,
      cx + body.w / 2, yTop, cz - body.d / 2,
      cx + body.w / 2, yTop, cz + body.d / 2,
      cx - body.w / 2, yTop, cz + body.d / 2,
      cx - body.w / 2 + ridgeRecess, yTop + h, cz,
      cx + body.w / 2 - ridgeRecess, yTop + h, cz
    ]);
    const indices = new Uint32Array([
      0, 4, 1, 1, 4, 5,
      3, 2, 5, 3, 5, 4,
      0, 3, 4,
      1, 5, 2
    ]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(indices, 1));
    // Flat-shaded: skip normals.
    out.push({ geom: g, color: roofColor });
  } else {
    const positions = new Float32Array([
      cx - body.w / 2, yTop, cz - body.d / 2,
      cx + body.w / 2, yTop, cz - body.d / 2,
      cx + body.w / 2, yTop, cz + body.d / 2,
      cx - body.w / 2, yTop, cz + body.d / 2,
      cx, yTop + h, cz - body.d / 2 + ridgeRecess,
      cx, yTop + h, cz + body.d / 2 - ridgeRecess
    ]);
    const indices = new Uint32Array([
      0, 1, 4,
      3, 5, 2,
      0, 4, 3, 3, 4, 5,
      1, 2, 5, 1, 5, 4
    ]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(indices, 1));
    // Flat-shaded: skip normals.
    out.push({ geom: g, color: roofColor });
  }
}

function applySpec(
  spec: Spec, cx: number, cz: number, yaw: number, out: VariantPart[],
  zone: Zone, tileX: number, tileY: number, happiness: number
): void {
  // Per-tile happiness modulates body / roof colour (Alpha 2.7). Below
  // 0.4 → push toward dingy grey; above 0.7 → slight saturation lift.
  // Luxury low-density opted out higher up the call stack.
  const moodBody = moodColor(spec.body.color, happiness);
  const moodBody2 = spec.body2 ? moodColor(spec.body2.color, happiness) : 0;
  const moodRoof = spec.roof ? moodColor(spec.roof.color, happiness) : 0;
  // Body 1 — emit with the modulated colour.
  emitBody({ ...spec.body, color: moodBody }, cx, cz, yaw, out);
  if (spec.roof && spec.roof.kind !== 'flat') {
    emitRoof(spec.body, { ...spec.roof, color: moodRoof }, cx, cz, yaw, out);
  }
  // Facade detail (Alpha 2.2) — windows + ground-floor treatment for
  // R/C/MU. Industrial bodies stay windowless to read as warehouses /
  // factories. Tower decorations are facaded too further down.
  if (zoneShowsWindows(zone)) {
    emitFacade(spec.body, cx, cz, yaw, out, zone, tileX, tileY, /*isPodium*/ false);
  }
  if (spec.body2) {
    emitBody({ ...spec.body2, color: moodBody2 }, cx, cz, yaw, out);
    if (zoneShowsWindows(zone)) {
      // body2 is conventionally the podium / shop wing on mixed-use, so
      // it always gets the shopfront treatment regardless of which body
      // is "lower" — mixed-use authors body2 with that intent.
      emitFacade(spec.body2, cx, cz, yaw, out, zone, tileX, tileY, /*isPodium*/ zone === 'mixed');
    }
  }
  // Graffiti / boarded-window scuff (Alpha 2.7) — when happiness is very
  // low, paint a dark vertical streak on one face and add a small board
  // over a window. Skips industrial (they have no facade to deface).
  if (happiness < 0.40 && zoneShowsWindows(zone)) {
    emitGraffiti(spec.body, cx, cz, yaw, out, tileX, tileY);
  }
  if (!spec.decorations) return;
  for (const dec of spec.decorations) {
    switch (dec.kind) {
      case 'chimney': emitChimney(dec, spec.body, cx, cz, yaw, out); break;
      case 'antenna': emitAntenna(dec, spec.body, spec.roof, cx, cz, out); break;
      case 'tower': {
        const moodTower = { ...dec, color: moodColor(dec.color, happiness),
                            roofColor: dec.roofColor !== undefined ? moodColor(dec.roofColor, happiness) : dec.roofColor };
        emitTower(moodTower, spec.body, cx, cz, yaw, out);
        // Setback towers also get window banding when they're R/C/MU —
        // a high-rise residence without windows reads as a blank slab.
        if (zoneShowsWindows(zone)) {
          emitTowerFacade(dec, spec.body, cx, cz, yaw, out, tileX, tileY);
        }
        break;
      }
      case 'awning': emitAwning(dec, spec.body, cx, cz, yaw, out); break;
      case 'sign': emitSign(dec, spec.body, cx, cz, yaw, out); break;
      case 'tank': emitTank(dec, cx, cz, out); break;
      case 'stack': emitStack(dec, cx, cz, out); break;
      case 'crane': emitCrane(dec, cx, cz, out); break;
    }
  }
}

/**
 * Modulate a body / roof colour by per-tile happiness (Alpha 2.7).
 *  happiness < 0.40 → lerp toward neutral grey + slight darken
 *  0.40..0.70      → unchanged
 *  > 0.70          → tiny saturation lift toward white
 */
function moodColor(base: number, happiness: number): number {
  if (happiness < 0.40) {
    // Lerp toward dingy concrete grey by up to 60% as happiness drops.
    const t = (0.40 - happiness) / 0.40; // 0..1
    return mixHex(base, 0x7a7368, t * 0.6);
  }
  if (happiness > 0.70) {
    // Tiny brighten toward warm white, max 18%.
    const t = (happiness - 0.70) / 0.30; // 0..1
    return mixHex(base, 0xfff8e8, t * 0.18);
  }
  return base;
}

function mixHex(a: number, b: number, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const c = Math.round(ab + (bb - ab) * u);
  return (r << 16) | (g << 8) | c;
}

/**
 * Graffiti streak (Alpha 2.7) — paint a slim coloured stripe on the south
 * face of the body. Colour picked from a small palette by tile hash so
 * neighbouring graffiti reads as different tags rather than a stamp.
 */
function emitGraffiti(
  body: Body, cx: number, cz: number, yaw: number, out: VariantPart[],
  tileX: number, tileY: number
): void {
  const r = Math.abs(((tileX * 1597334677) ^ (tileY * 374761393)) | 0);
  const palette = [0xb14a4a, 0x4a8eb9, 0x7a4ab1, 0xc9a437, 0x4ab17a];
  const tagColor = palette[r % palette.length]!;
  // Slim slab 30% of body width, 25% of body height, on the south face.
  const stripeW = body.w * 0.30;
  const stripeH = body.h * 0.30;
  const yBase = body.yBase ?? 0;
  const stripe = new BoxGeometry(stripeW, stripeH, 0.012);
  // Pick which side to tag (rotate based on hash).
  const sideHash = (r >> 8) % 4;
  let dx = 0, dz = body.d / 2 + 0.007, rot = 0;
  if (sideHash === 1) { dx = body.w / 2 + 0.007; dz = 0; rot = Math.PI / 2; }
  else if (sideHash === 2) { dx = 0; dz = -body.d / 2 - 0.007; rot = Math.PI; }
  else if (sideHash === 3) { dx = -body.w / 2 - 0.007; dz = 0; rot = -Math.PI / 2; }
  if (rot) stripe.rotateY(rot);
  stripe.translate(dx, yBase + body.h * 0.30, dz);
  if (yaw) stripe.rotateY(yaw);
  stripe.translate(cx, 0, cz);
  out.push({ geom: stripe, color: tagColor });
}

function emitBody(b: Body, cx: number, cz: number, yaw: number, out: VariantPart[]): void {
  const geom = new BoxGeometry(b.w, b.h, b.d);
  geom.translate(0, b.h / 2 + (b.yBase ?? 0), 0);
  if (yaw) geom.rotateY(yaw);
  geom.translate(cx, 0, cz);
  out.push({ geom, color: b.color });
}

function emitRoof(body: Body, r: Roof, cx: number, cz: number, yaw: number, out: VariantPart[]): void {
  const yTop = body.h + (body.yBase ?? 0);
  if (r.kind === 'pyramid') {
    // 4-sided cone matching body footprint.
    const radius = Math.max(body.w, body.d) * 0.55;
    const cone = new ConeGeometry(radius, r.height, 4);
    cone.rotateY(Math.PI / 4); // align flat sides to N/S/E/W
    cone.translate(0, yTop + r.height / 2, 0);
    if (yaw) cone.rotateY(yaw);
    cone.translate(cx, 0, cz);
    out.push({ geom: cone, color: r.color });
  } else if (r.kind === 'hip') {
    // Hip = pyramid with the apex flattened along one axis. Approximate as
    // a low pyramid plus a small top box ridge.
    const radius = Math.max(body.w, body.d) * 0.55;
    const cone = new ConeGeometry(radius, r.height * 0.7, 4);
    cone.rotateY(Math.PI / 4);
    cone.translate(0, yTop + r.height * 0.35, 0);
    if (yaw) cone.rotateY(yaw);
    cone.translate(cx, 0, cz);
    out.push({ geom: cone, color: r.color });
    const ridge = new BoxGeometry(body.w * 0.4, r.height * 0.3, 0.06);
    ridge.translate(0, yTop + r.height * 0.85, 0);
    if (yaw) ridge.rotateY(yaw);
    ridge.translate(cx, 0, cz);
    out.push({ geom: ridge, color: r.color });
  } else if (r.kind === 'gable') {
    // Triangular prism — long ridge along Z, flat sides E/W.
    const positions = new Float32Array([
      -body.w / 2, yTop, -body.d / 2,
       body.w / 2, yTop, -body.d / 2,
       body.w / 2, yTop,  body.d / 2,
      -body.w / 2, yTop,  body.d / 2,
                0, yTop + r.height, -body.d / 2,
                0, yTop + r.height,  body.d / 2
    ]);
    const indices = new Uint32Array([
      // Two slope faces.
      0, 4, 1,
      2, 5, 3,
      // Two gable triangles.
      0, 3, 4,  3, 5, 4,
      1, 4, 2,  2, 4, 5
    ]);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(indices, 1));
    // Flat-shaded: skip normals.
    if (yaw) g.rotateY(yaw);
    g.translate(cx, 0, cz);
    out.push({ geom: g, color: r.color });
  }
}

function emitChimney(c: Chimney, body: Body, cx: number, cz: number, yaw: number, out: VariantPart[]): void {
  const yTop = body.h + (body.yBase ?? 0);
  const g = new BoxGeometry(0.07, c.h, 0.07);
  g.translate(c.dx, yTop + c.h / 2, c.dz);
  if (yaw) g.rotateY(yaw);
  g.translate(cx, 0, cz);
  out.push({ geom: g, color: c.color });
}

function emitAntenna(a: Antenna, body: Body, roof: Roof | undefined, cx: number, cz: number, out: VariantPart[]): void {
  const yBase = body.h + (body.yBase ?? 0) + (roof?.height ?? 0);
  const g = new CylinderGeometry(0.012, 0.012, a.h, 5);
  g.translate(cx, yBase + a.h / 2, cz);
  out.push({ geom: g, color: a.color });
}

function emitTower(t: Tower, body: Body, cx: number, cz: number, yaw: number, out: VariantPart[]): void {
  const yBase = body.h + (body.yBase ?? 0);
  const g = new BoxGeometry(t.w, t.h, t.d);
  g.translate(0, yBase + t.h / 2, 0);
  if (yaw) g.rotateY(yaw);
  g.translate(cx, 0, cz);
  out.push({ geom: g, color: t.color });
  if (t.roofKind && t.roofKind !== 'flat' && t.roofHeight && t.roofColor !== undefined) {
    const fakeBody: Body = { w: t.w, h: t.h, d: t.d, color: t.color, yBase: yBase };
    const fakeRoof: Roof = { kind: t.roofKind, height: t.roofHeight, color: t.roofColor };
    emitRoof(fakeBody, fakeRoof, cx, cz, yaw, out);
  }
}

function emitAwning(a: Awning, body: Body, cx: number, cz: number, yaw: number, out: VariantPart[]): void {
  const offset = sideOffset(a.side, body);
  const g = new BoxGeometry(a.width, 0.03, a.depth);
  // Awnings sit at the body's first-floor entry — about 1/4 of body height.
  const y = (body.h + (body.yBase ?? 0)) * 0.32;
  g.translate(offset.x, y, offset.z);
  if (yaw) g.rotateY(yaw);
  g.translate(cx, 0, cz);
  out.push({ geom: g, color: a.color });
}

function emitSign(s: Sign, body: Body, cx: number, cz: number, yaw: number, out: VariantPart[]): void {
  const offset = sideOffset(s.side, body);
  const g = new BoxGeometry(s.w, s.h, 0.03);
  // Rotate face to the building front.
  if (s.side === 'E' || s.side === 'W') g.rotateY(Math.PI / 2);
  g.translate(offset.x, s.y + s.h / 2, offset.z);
  if (yaw) g.rotateY(yaw);
  g.translate(cx, 0, cz);
  out.push({ geom: g, color: s.color });
}

function emitTank(t: Tank, cx: number, cz: number, out: VariantPart[]): void {
  const g = new CylinderGeometry(t.r, t.r, t.h, 8);
  g.translate(cx + t.dx, t.h / 2, cz + t.dz);
  out.push({ geom: g, color: t.color });
}

function emitStack(s: Stack, cx: number, cz: number, out: VariantPart[]): void {
  const g = new CylinderGeometry(0.045, 0.06, s.h, 6);
  g.translate(cx + s.dx, s.h / 2, cz + s.dz);
  out.push({ geom: g, color: s.color });
}

function emitCrane(c: Crane, cx: number, cz: number, out: VariantPart[]): void {
  const post = new CylinderGeometry(0.025, 0.025, c.h, 5);
  post.translate(cx + c.dx, c.h / 2, cz + c.dz);
  out.push({ geom: post, color: c.color });
  const arm = new BoxGeometry(0.03, 0.02, c.h * 0.7);
  arm.translate(cx + c.dx, c.h - 0.02, cz + c.dz + c.h * 0.25);
  out.push({ geom: arm, color: c.color });
}

function sideOffset(side: 'N' | 'S' | 'E' | 'W', body: Body): { x: number; z: number } {
  const halfW = body.w / 2;
  const halfD = body.d / 2;
  switch (side) {
    case 'N': return { x: 0, z: -halfD - 0.03 };
    case 'S': return { x: 0, z:  halfD + 0.03 };
    case 'E': return { x:  halfW + 0.03, z: 0 };
    case 'W': return { x: -halfW - 0.03, z: 0 };
  }
}

/* ---- Facade detail (Alpha 2.2) ------------------------------------- */

/** Industrial buildings stay windowless — they read as warehouses /
 *  factories, which is the genre cue. R / C / MU all get windows. */
function zoneShowsWindows(zone: Zone): boolean {
  return zone === 'residential' || zone === 'commercial' || zone === 'mixed';
}

/** Window glass colour. Slightly varied with a tile hash so a row of
 *  identical buildings still has subtle variation in glass tone. */
function windowColor(tileX: number, tileY: number): number {
  const r = Math.abs(((tileX * 1597334677) ^ (tileY * 2654435761)) | 0);
  // Three glass tones — neutral grey-blue, warmer yellow-tinged, cooler teal.
  const palette = [0x2c3e54, 0x3a3a48, 0x2a4250];
  return palette[r % palette.length]!;
}

/**
 * Wrap a body with window bands on all four sides plus a ground-floor
 * element (door for residential, shopfront for commercial / mixed
 * podium). Each band is a very thin slab attached to the outside of the
 * body face so the dark glass colour reads cleanly against the body's
 * warm/cool palette.
 *
 * Window count scales with body height: 1 floor for h ≤ 0.30, 2 for
 * 0.31..0.55, scaling up to ~6 for a 1.5-tall tower. The bottom 0.18 of
 * each face is reserved for the ground-floor element so windows don't
 * collide with the door/shopfront.
 */
function emitFacade(
  body: Body, cx: number, cz: number, yaw: number, out: VariantPart[],
  zone: Zone, tileX: number, tileY: number, isPodium: boolean
): void {
  const yBase = body.yBase ?? 0;
  const groundReserved = Math.min(body.h * 0.4, 0.20);
  const winColor = windowColor(tileX, tileY);

  // Number of window bands above the ground reserved zone.
  const bandSpace = body.h - groundReserved;
  const floors = Math.max(1, Math.round(bandSpace / 0.22));

  if (bandSpace > 0.05) {
    for (let f = 0; f < floors; f++) {
      const t = (f + 0.5) / floors;
      const y = yBase + groundReserved + bandSpace * t;
      // North face band.
      pushWindowBand(out, body, cx, cz, yaw, 'N', y, winColor);
      pushWindowBand(out, body, cx, cz, yaw, 'S', y, winColor);
      // Side bands shorter so corners read.
      pushWindowBand(out, body, cx, cz, yaw, 'E', y, winColor);
      pushWindowBand(out, body, cx, cz, yaw, 'W', y, winColor);
    }
  }

  // Ground-floor element. Mixed-use podium and commercial both get
  // shopfronts (wide light-glass). Residential gets a door + 1-2 small
  // windows.
  const wantsShopfront =
    zone === 'commercial' ||
    (zone === 'mixed' && isPodium) ||
    // Mixed-use without a body2 (single-body variants) still gets a
    // shopfront on its main body — that's the "shop down, flat above" feel.
    (zone === 'mixed' && !isPodium);
  if (wantsShopfront) {
    emitShopfront(body, cx, cz, yaw, out, tileX, tileY);
  } else {
    emitDoor(body, cx, cz, yaw, out, winColor);
  }
}

function pushWindowBand(
  out: VariantPart[], body: Body, cx: number, cz: number, yaw: number,
  side: 'N' | 'S' | 'E' | 'W', y: number, color: number
): void {
  // Window band hugs the body face — 0.7 of face width, 0.07 tall,
  // 0.012 thick (just barely standing out from the wall plane).
  let w: number, d: number;
  if (side === 'N' || side === 'S') {
    w = body.w * 0.7;
    d = 0.012;
  } else {
    w = 0.012;
    d = body.d * 0.7;
  }
  const g = new BoxGeometry(w, 0.07, d);
  const offset = side === 'N' ? { x: 0, z: -body.d / 2 - 0.005 }
               : side === 'S' ? { x: 0, z:  body.d / 2 + 0.005 }
               : side === 'E' ? { x:  body.w / 2 + 0.005, z: 0 }
               :                { x: -body.w / 2 - 0.005, z: 0 };
  g.translate(offset.x, y, offset.z);
  if (yaw) g.rotateY(yaw);
  g.translate(cx, 0, cz);
  out.push({ geom: g, color });
}

function emitDoor(
  body: Body, cx: number, cz: number, yaw: number, out: VariantPart[], _winColor: number
): void {
  const yBase = body.yBase ?? 0;
  // Small dark door panel on the N face, plus a tiny window beside it.
  const door = new BoxGeometry(body.w * 0.16, 0.16, 0.012);
  door.translate(-body.w * 0.18, yBase + 0.08, -body.d / 2 - 0.005);
  if (yaw) door.rotateY(yaw);
  door.translate(cx, 0, cz);
  out.push({ geom: door, color: 0x4a342a });
  // Step / threshold light strip.
  const step = new BoxGeometry(body.w * 0.16, 0.012, 0.05);
  step.translate(-body.w * 0.18, yBase + 0.006, -body.d / 2 - 0.025);
  if (yaw) step.rotateY(yaw);
  step.translate(cx, 0, cz);
  out.push({ geom: step, color: 0x6a6e74 });
}

function emitShopfront(
  body: Body, cx: number, cz: number, yaw: number, out: VariantPart[],
  tileX: number, tileY: number
): void {
  const yBase = body.yBase ?? 0;
  // Wide bright shopfront window on the N face — half-tile wide, low.
  const r = Math.abs(((tileX * 1597334677) ^ (tileY * 374761393)) | 0);
  // Three shopfront tints — warm yellow (lit interior), cool teal, neutral.
  const tintPalette = [0xeec888, 0x6ea8bb, 0xc9c9d0];
  const tint = tintPalette[r % tintPalette.length]!;
  const shop = new BoxGeometry(body.w * 0.7, 0.14, 0.012);
  shop.translate(0, yBase + 0.10, -body.d / 2 - 0.005);
  if (yaw) shop.rotateY(yaw);
  shop.translate(cx, 0, cz);
  out.push({ geom: shop, color: tint });
  // Frame strip below shopfront — darker so the lit window pops.
  const frame = new BoxGeometry(body.w * 0.7, 0.022, 0.014);
  frame.translate(0, yBase + 0.022, -body.d / 2 - 0.006);
  if (yaw) frame.rotateY(yaw);
  frame.translate(cx, 0, cz);
  out.push({ geom: frame, color: 0x2a2018 });
}

/**
 * Window banding for a setback Tower decoration. Same logic as emitFacade
 * but positioned on top of the main body (yBase = body.h) and without a
 * shopfront / door (the tower entrance is at ground level on the body).
 */
function emitTowerFacade(
  t: Tower, body: Body, cx: number, cz: number, yaw: number, out: VariantPart[],
  tileX: number, tileY: number
): void {
  const yBase = body.h + (body.yBase ?? 0);
  const winColor = windowColor(tileX, tileY);
  const towerBody: Body = { w: t.w, d: t.d, h: t.h, color: t.color, yBase };
  const bandSpace = t.h * 0.85;
  const floors = Math.max(2, Math.round(bandSpace / 0.22));
  for (let f = 0; f < floors; f++) {
    const tFrac = (f + 0.5) / floors;
    const y = yBase + t.h * 0.05 + bandSpace * tFrac;
    pushWindowBand(out, towerBody, cx, cz, yaw, 'N', y, winColor);
    pushWindowBand(out, towerBody, cx, cz, yaw, 'S', y, winColor);
    pushWindowBand(out, towerBody, cx, cz, yaw, 'E', y, winColor);
    pushWindowBand(out, towerBody, cx, cz, yaw, 'W', y, winColor);
  }
}

/* ---- Variant catalogue --------------------------------------------- */

/**
 * 3 variants per (zone, density). Picked deterministically per tile via
 * {@link pickVariant}. Densities are 1..3 (low / medium / high).
 *
 * Style guide:
 *  - Residential warm tones (tans, terracotta, cream).
 *  - Commercial cool tones (slate, steel-blue, glass-grey).
 *  - Industrial muted/dirty palette (grey, brown, weathered).
 *  - Mixed-use: tan podium under a cooler upper body — "shops below, flats above".
 *
 * Footprints stay ≤ ~0.85 tiles wide so a sliver of grass / road shows
 * around each block; heights match BUILDING_DIMS gradient (0.4 / 0.8 / 1.5).
 */

type VariantTable = Record<Exclude<Zone, 'none'>, Record<1 | 2 | 3 | 4, Spec[]>>;

const VARIANTS: VariantTable = {
  // ---- Residential -------------------------------------------------------
  residential: {
    1: [
      // Cottage with a steep gable roof.
      {
        body: { w: 0.40, h: 0.30, d: 0.45, color: 0xd9c89e },
        roof: { kind: 'gable', height: 0.18, color: 0x8a4a2c },
        decorations: [{ kind: 'chimney', dx: 0.13, dz: -0.18, h: 0.10, color: 0x6e5040 }]
      },
      // Ranch home — wide and low with hip roof.
      {
        body: { w: 0.55, h: 0.22, d: 0.40, color: 0xe6d5a8 },
        roof: { kind: 'hip', height: 0.10, color: 0x7e5a3a }
      },
      // A-frame cabin — narrow and tall with a sharp pyramid roof.
      {
        body: { w: 0.30, h: 0.22, d: 0.42, color: 0xb89970 },
        roof: { kind: 'pyramid', height: 0.30, color: 0x4d3520 }
      },
      // Bungalow — pale yellow walls, deep green gable, screened porch awning.
      {
        body: { w: 0.50, h: 0.26, d: 0.42, color: 0xeede9c },
        roof: { kind: 'gable', height: 0.14, color: 0x3a5a3a },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.34, depth: 0.10, color: 0x2a4030 }
        ]
      },
      // Mid-century split — slate walls + terracotta hip roof + side body.
      {
        body: { w: 0.45, h: 0.30, d: 0.50, color: 0xa8b4b8 },
        body2: { w: 0.32, h: 0.22, d: 0.32, color: 0x9aa6ac, yBase: 0 },
        roof: { kind: 'hip', height: 0.10, color: 0xc06038 }
      },
      // Storybook cottage — pale blue + slate roof, prominent chimney.
      {
        body: { w: 0.40, h: 0.28, d: 0.40, color: 0xc6dee6 },
        roof: { kind: 'gable', height: 0.20, color: 0x3a3a48 },
        decorations: [
          { kind: 'chimney', dx: -0.14, dz: 0.12, h: 0.18, color: 0x6a5648 }
        ]
      },
      // Modern minimalist — white box + flat roof + slim entrance awning.
      {
        body: { w: 0.50, h: 0.30, d: 0.42, color: 0xf2eee4 },
        roof: { kind: 'flat', height: 0, color: 0 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.18, depth: 0.12, color: 0x2e2e2e }
        ]
      },
      // Cape Cod — grey clapboard + steep gable + small dormer (chimney).
      {
        body: { w: 0.45, h: 0.26, d: 0.38, color: 0x9aa6ac },
        roof: { kind: 'gable', height: 0.22, color: 0x3a4048 },
        decorations: [
          { kind: 'chimney', dx: 0.16, dz: 0.10, h: 0.14, color: 0x9c5a4a }
        ]
      }
    ],
    2: [
      // Townhouse row — three connected gabled blocks.
      {
        body: { w: 0.70, h: 0.55, d: 0.32, color: 0xc8a878 },
        roof: { kind: 'gable', height: 0.16, color: 0x6a3a22 },
        decorations: [
          { kind: 'chimney', dx: 0.20, dz: -0.10, h: 0.10, color: 0x4a342a }
        ]
      },
      // 2-storey duplex with a wide hipped roof.
      {
        body: { w: 0.60, h: 0.65, d: 0.50, color: 0xb8a47a },
        roof: { kind: 'hip', height: 0.18, color: 0x5e3e2a },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.18, depth: 0.10, color: 0x3a2a20 }
        ]
      },
      // 3-storey walkup apartment — flat top.
      {
        body: { w: 0.55, h: 0.78, d: 0.55, color: 0xc7b08a },
        roof: { kind: 'flat', height: 0, color: 0 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.14, depth: 0.08, color: 0x6a4030 }
        ]
      },
      // Brick courtyard apartment — deep red, central setback tower.
      {
        body: { w: 0.75, h: 0.55, d: 0.55, color: 0x8e3a2e },
        decorations: [
          { kind: 'tower', w: 0.45, d: 0.45, h: 0.40, color: 0x9c4838, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // Sage garden walkup — green walls, white-trim gable.
      {
        body: { w: 0.55, h: 0.62, d: 0.45, color: 0x8aa890 },
        roof: { kind: 'gable', height: 0.14, color: 0xece4cf },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.16, depth: 0.10, color: 0x4a6650 }
        ]
      },
      // Tudor revival — cream body + dark brown corner tower with pyramid roof.
      {
        body: { w: 0.60, h: 0.55, d: 0.50, color: 0xece4cf },
        decorations: [
          { kind: 'tower', w: 0.22, d: 0.22, h: 0.78, color: 0x4e3826, roofKind: 'pyramid', roofHeight: 0.18, roofColor: 0x2a1c14 }
        ]
      },
      // Stacked townhouses — deep blue 3-storey stepped silhouette.
      {
        body: { w: 0.60, h: 0.50, d: 0.45, color: 0x2c4060 },
        body2: { w: 0.45, h: 0.78, d: 0.45, color: 0x36507a, yBase: 0 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.20, depth: 0.10, color: 0xece4cf }
        ]
      },
      // Spanish revival — cream stucco + terracotta tile gable + arched awning.
      {
        body: { w: 0.55, h: 0.52, d: 0.48, color: 0xf2e4c8 },
        roof: { kind: 'gable', height: 0.16, color: 0xc46c34 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.24, depth: 0.10, color: 0xb8814a }
        ]
      }
    ],
    3: [
      // High-rise tower with stepped setback.
      {
        body: { w: 0.85, h: 0.55, d: 0.85, color: 0x8a6f4e },
        decorations: [
          { kind: 'tower', w: 0.55, d: 0.55, h: 0.95, color: 0xa0866a, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'antenna', h: 0.20, color: 0x222222 }
        ]
      },
      // Brutalist slab — single big block with horizontal banding (dark band line).
      {
        body: { w: 0.80, h: 1.45, d: 0.45, color: 0x96775a }
      },
      // Glass tower — narrow, tall, slim spire.
      {
        body: { w: 0.55, h: 1.55, d: 0.55, color: 0x7a6a52 },
        decorations: [{ kind: 'antenna', h: 0.30, color: 0x444444 }]
      },
      // Twin-tower residence — two slim white towers above a shared podium.
      {
        body: { w: 0.85, h: 0.40, d: 0.85, color: 0xd6cdb6 },
        decorations: [
          { kind: 'tower', w: 0.30, d: 0.30, h: 1.30, color: 0xeee5cc, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'antenna', h: 0.18, color: 0x222222 }
        ]
      },
      // Brick high-rise — deep crimson with antenna.
      {
        body: { w: 0.65, h: 1.55, d: 0.55, color: 0x6e2a22 },
        decorations: [{ kind: 'antenna', h: 0.18, color: 0x333333 }]
      },
      // Modern green-glass tower — teal body, slim spire.
      {
        body: { w: 0.55, h: 1.50, d: 0.55, color: 0x3a6a64 },
        decorations: [
          { kind: 'tower', w: 0.30, d: 0.30, h: 0.30, color: 0x4a7e78, roofKind: 'pyramid', roofHeight: 0.20, roofColor: 0x223a36 }
        ]
      },
      // Pink condo — rose-pink modernist body with stepped setback crown.
      {
        body: { w: 0.75, h: 1.30, d: 0.55, color: 0xd06ab8 },
        decorations: [
          { kind: 'tower', w: 0.40, d: 0.40, h: 0.30, color: 0xb84a98, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // Bronze tower — warm metallic body + tall antenna.
      {
        body: { w: 0.55, h: 1.55, d: 0.55, color: 0x9a6a3a },
        decorations: [{ kind: 'antenna', h: 0.32, color: 0x222222 }]
      }
    ],
    // ---- L4 / Max density (Alpha 4.18) ----
    // Mid-rise bridges between L3 (~3-4 storey apartment blocks) and
    // skyscrapers (~10-15 storeys). L4 R = ~6-9 storey buildings:
    // brownstones + mid-rise apartment buildings + co-ops.
    4: [
      // 7-storey brownstone block — warm brick body, stone-trim base,
      // low parapet, set of vertical sash windows implied by tower
      // setback. Heights ~2.5 = 7-8 storeys.
      {
        body: { w: 0.85, h: 2.40, d: 0.85, color: 0x9c5a3a },
        decorations: [
          // Slim parapet/cornice band
          { kind: 'tower', w: 0.92, d: 0.92, h: 0.10, color: 0x6e3e1d, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // 8-storey 5-over-1 — wider podium (commercial ground floor) +
      // stacked residential above. Cream walls, brick podium.
      {
        body: { w: 0.85, h: 0.40, d: 0.85, color: 0x8a4a3a },  // brick podium
        decorations: [
          { kind: 'tower', w: 0.78, d: 0.78, h: 2.20, color: 0xeed5b8, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // 6-storey co-op — uniform tan facade, slight setback, no antenna.
      {
        body: { w: 0.80, h: 2.10, d: 0.80, color: 0xc4ad7a },
        decorations: [
          { kind: 'tower', w: 0.55, d: 0.55, h: 0.30, color: 0xa68b58, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // 9-storey deco mid-rise — cream walls + maroon trim + decorative crown.
      {
        body: { w: 0.75, h: 2.60, d: 0.75, color: 0xeede9c },
        decorations: [
          { kind: 'tower', w: 0.60, d: 0.60, h: 0.25, color: 0x6e2a3a, roofKind: 'pyramid', roofHeight: 0.12, roofColor: 0x4a1a26 }
        ]
      },
      // 7-storey grey concrete — minimalist, slight setback, no decorations.
      {
        body: { w: 0.85, h: 2.30, d: 0.70, color: 0x9aa1a8 }
      },
      // 8-storey blue-glass mid-rise — teal walls + bright parapet.
      {
        body: { w: 0.70, h: 2.40, d: 0.70, color: 0x4a6a8a },
        decorations: [
          { kind: 'tower', w: 0.78, d: 0.78, h: 0.08, color: 0xeee5cc, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      }
    ]
  },
  // ---- Commercial -------------------------------------------------------
  commercial: {
    1: [
      // Corner shop with awning + sign.
      {
        body: { w: 0.60, h: 0.36, d: 0.55, color: 0xc0d4ec },
        roof: { kind: 'flat', height: 0, color: 0 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.40, depth: 0.10, color: 0xd06a3a },
          { kind: 'sign', side: 'S', w: 0.34, h: 0.10, y: 0.26, color: 0xeec453 }
        ]
      },
      // Petrol-station-style — wide flat canopy.
      {
        body: { w: 0.40, h: 0.32, d: 0.40, color: 0xd6dde5 },
        roof: { kind: 'flat', height: 0, color: 0 },
        decorations: [
          { kind: 'awning', side: 'E', width: 0.10, depth: 0.55, color: 0xa44a3a }
        ]
      },
      // Diner — long low silhouette with a parapet.
      {
        body: { w: 0.75, h: 0.30, d: 0.35, color: 0xe4eaef },
        roof: { kind: 'flat', height: 0, color: 0 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.40, h: 0.12, y: 0.30, color: 0xd03a55 }
        ]
      },
      // Boutique — pure white walls, copper-orange awning + tall sign.
      {
        body: { w: 0.50, h: 0.40, d: 0.45, color: 0xf2eee4 },
        roof: { kind: 'flat', height: 0, color: 0 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.34, depth: 0.10, color: 0xc06030 },
          { kind: 'sign', side: 'S', w: 0.30, h: 0.16, y: 0.30, color: 0x2e2e2e }
        ]
      },
      // Coffeehouse — dark green walls, wood-tan awning, flat roof.
      {
        body: { w: 0.55, h: 0.34, d: 0.50, color: 0x2c4636 },
        roof: { kind: 'flat', height: 0, color: 0 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.40, depth: 0.12, color: 0xb88a4e },
          { kind: 'sign', side: 'S', w: 0.28, h: 0.08, y: 0.26, color: 0xece4cf }
        ]
      },
      // Convenience store — bright red walls, white parapet sign.
      {
        body: { w: 0.55, h: 0.32, d: 0.45, color: 0xc83838 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.46, h: 0.10, y: 0.30, color: 0xece4cf }
        ]
      },
      // Bookstore — deep purple stucco + gold lettering sign.
      {
        body: { w: 0.55, h: 0.40, d: 0.50, color: 0x4a2c5a },
        roof: { kind: 'flat', height: 0, color: 0 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.34, depth: 0.10, color: 0x2a1832 },
          { kind: 'sign', side: 'S', w: 0.32, h: 0.08, y: 0.32, color: 0xeec453 }
        ]
      },
      // Bistro — cream stucco + bright orange awning + small patio.
      {
        body: { w: 0.55, h: 0.36, d: 0.42, color: 0xf2eee4 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.40, depth: 0.18, color: 0xc46c34 },
          { kind: 'sign', side: 'E', w: 0.16, h: 0.08, y: 0.28, color: 0x2e2e2e }
        ]
      }
    ],
    2: [
      // 3-storey office cube.
      {
        body: { w: 0.60, h: 0.78, d: 0.60, color: 0x7a92b5 }
      },
      // Wide department store with stepped front.
      {
        body: { w: 0.80, h: 0.58, d: 0.55, color: 0x8aa2bf },
        body2: { w: 0.55, h: 0.78, d: 0.55, color: 0x6e8aac, yBase: 0 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.38, h: 0.10, y: 0.65, color: 0xeec453 }
        ]
      },
      // Retail strip — long and low, roof billboards.
      {
        body: { w: 0.85, h: 0.50, d: 0.40, color: 0x9ab0c8 },
        decorations: [
          { kind: 'sign', side: 'N', w: 0.50, h: 0.14, y: 0.50, color: 0xd06a3a },
          { kind: 'sign', side: 'S', w: 0.50, h: 0.14, y: 0.50, color: 0xd06a3a }
        ]
      },
      // Modernist office — matte charcoal slab with bright glass band.
      {
        body: { w: 0.60, h: 0.85, d: 0.55, color: 0x32363c },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.50, h: 0.04, y: 0.55, color: 0x6ad0c8 }
        ]
      },
      // Mall plaza — wide cream body with green awning + central tower.
      {
        body: { w: 0.85, h: 0.45, d: 0.65, color: 0xe6decb },
        decorations: [
          { kind: 'tower', w: 0.40, d: 0.40, h: 0.65, color: 0x6e8aac, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'awning', side: 'S', width: 0.50, depth: 0.10, color: 0x4a7e54 }
        ]
      },
      // Burgundy bank — deep red brick body with white columned awning.
      {
        body: { w: 0.65, h: 0.70, d: 0.55, color: 0x6e2a30 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.46, depth: 0.10, color: 0xece4cf },
          { kind: 'sign', side: 'S', w: 0.30, h: 0.08, y: 0.55, color: 0xc8a040 }
        ]
      },
      // Tech startup — black body with neon-cyan accent strip + sign.
      {
        body: { w: 0.65, h: 0.85, d: 0.55, color: 0x14181c },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.45, h: 0.04, y: 0.55, color: 0x44e0c8 },
          { kind: 'sign', side: 'S', w: 0.20, h: 0.10, y: 0.30, color: 0xece4cf }
        ]
      },
      // Hotel mid-rise — cream + warm-amber sign + entry awning.
      {
        body: { w: 0.55, h: 0.85, d: 0.55, color: 0xece4cf },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.30, depth: 0.10, color: 0xc8a040 },
          { kind: 'sign', side: 'S', w: 0.34, h: 0.08, y: 0.62, color: 0x6a4a2a }
        ]
      }
    ],
    3: [
      // Classic skyscraper — tall narrow rectangle.
      {
        body: { w: 0.55, h: 1.50, d: 0.55, color: 0x52688a },
        decorations: [{ kind: 'antenna', h: 0.22, color: 0xc83838 }]
      },
      // Stepped pyramid skyscraper (Art Deco-ish).
      {
        body: { w: 0.85, h: 0.55, d: 0.85, color: 0x4e6586 },
        decorations: [
          { kind: 'tower', w: 0.62, d: 0.62, h: 0.55, color: 0x5a7290 },
          { kind: 'tower', w: 0.40, d: 0.40, h: 0.45, color: 0x6680a0, roofKind: 'pyramid', roofHeight: 0.18, roofColor: 0x2a3a52 }
        ]
      },
      // Glass tower with antenna spire.
      {
        body: { w: 0.50, h: 1.45, d: 0.65, color: 0x4a607c },
        decorations: [{ kind: 'antenna', h: 0.40, color: 0x222222 }]
      },
      // Black-glass slab — sleek monolith with corporate vibes.
      {
        body: { w: 0.50, h: 1.65, d: 0.50, color: 0x1a1d24 },
        decorations: [{ kind: 'antenna', h: 0.30, color: 0x666666 }]
      },
      // Twin office tower — two slim copper-tinted towers.
      {
        body: { w: 0.85, h: 0.30, d: 0.85, color: 0xb89876 },
        decorations: [
          { kind: 'tower', w: 0.32, d: 0.30, h: 1.20, color: 0xc8a07c, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // Spire skyscraper — green-glass body with sharp pyramid crown.
      {
        body: { w: 0.55, h: 1.30, d: 0.55, color: 0x44746a },
        decorations: [
          { kind: 'tower', w: 0.40, d: 0.40, h: 0.30, color: 0x4e8678, roofKind: 'pyramid', roofHeight: 0.40, roofColor: 0x223e38 }
        ]
      },
      // Maroon corporate tower — deep wine body + gold trim band sign.
      {
        body: { w: 0.55, h: 1.55, d: 0.55, color: 0x4a1820 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.48, h: 0.06, y: 1.10, color: 0xc8a040 }
        ]
      },
      // Geometric crystal — faceted base + slim setback tower with pyramid cap.
      {
        body: { w: 0.85, h: 0.55, d: 0.85, color: 0x4a607c },
        decorations: [
          { kind: 'tower', w: 0.45, d: 0.45, h: 0.85, color: 0x5a7290, roofKind: 'pyramid', roofHeight: 0.30, roofColor: 0x2c3a4e }
        ]
      }
    ],
    // ---- L4 / Max density (Alpha 4.18) ----
    // Mid-rise commercial: 6-9 storey office buildings + boutique
    // hotels + larger retail towers. Bridges 3-4 storey L3 retail and
    // skyscrapers. Wider footprints than residential L4 — commercial
    // mid-rise tends to mass out the lot more than residential.
    4: [
      // 8-storey corporate office — light grey curtain wall + crown band.
      {
        body: { w: 0.85, h: 2.40, d: 0.85, color: 0xa6b0bc },
        decorations: [
          { kind: 'tower', w: 0.92, d: 0.92, h: 0.10, color: 0x4a607c, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // 7-storey boutique hotel — warm beige + dark cornice + ground sign.
      {
        body: { w: 0.85, h: 2.20, d: 0.80, color: 0xd6c8a8 },
        decorations: [
          { kind: 'tower', w: 0.92, d: 0.85, h: 0.08, color: 0x3a3026, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'sign', side: 'S', w: 0.34, h: 0.10, y: 0.32, color: 0xc8a040 }
        ]
      },
      // 9-storey deco bank — dark blue stone + recessed setback tower.
      {
        body: { w: 0.80, h: 1.20, d: 0.80, color: 0x2c3e5a },
        decorations: [
          { kind: 'tower', w: 0.55, d: 0.55, h: 1.40, color: 0x3a5076, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // 6-storey retail-over-office — bright signage band on ground floor.
      {
        body: { w: 0.85, h: 0.40, d: 0.85, color: 0xeee5cc },  // ground retail
        decorations: [
          { kind: 'tower', w: 0.78, d: 0.80, h: 1.70, color: 0xa6b0bc, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'sign', side: 'S', w: 0.50, h: 0.18, y: 0.18, color: 0xd03a3a }
        ]
      },
      // 7-storey terra-cotta tower — warm orange-brown with thick parapet.
      {
        body: { w: 0.75, h: 2.30, d: 0.75, color: 0xc06030 },
        decorations: [
          { kind: 'tower', w: 0.82, d: 0.82, h: 0.10, color: 0x6a3018, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // 8-storey black-and-glass — sleek minimalist mid-rise.
      {
        body: { w: 0.75, h: 2.50, d: 0.75, color: 0x2a2c34 }
      }
    ]
  },
  // ---- Industrial -------------------------------------------------------
  industrial: {
    1: [
      // Square low warehouse.
      {
        body: { w: 0.65, h: 0.32, d: 0.65, color: 0xb0a080 },
        decorations: [{ kind: 'stack', dx: 0.20, dz: -0.20, h: 0.30, color: 0x6a5848 }]
      },
      // Workshop with a single steep roof.
      {
        body: { w: 0.55, h: 0.30, d: 0.60, color: 0xa89476 },
        roof: { kind: 'gable', height: 0.18, color: 0x554840 }
      },
      // Storage yard — low building plus stacked cylinders.
      {
        body: { w: 0.40, h: 0.26, d: 0.40, color: 0xa49474 },
        decorations: [
          { kind: 'tank', dx:  0.22, dz:  0.20, r: 0.08, h: 0.14, color: 0x8a7860 },
          { kind: 'tank', dx: -0.22, dz:  0.20, r: 0.08, h: 0.18, color: 0x8a7860 },
          { kind: 'tank', dx:  0.22, dz: -0.20, r: 0.08, h: 0.10, color: 0x8a7860 }
        ]
      },
      // Garage — corrugated steel-grey body with a wide loading sign.
      {
        body: { w: 0.60, h: 0.30, d: 0.50, color: 0x7c8088 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.40, h: 0.10, y: 0.24, color: 0xeec453 }
        ]
      },
      // Lumber yard — small slate office plus three stacks of timber.
      {
        body: { w: 0.32, h: 0.28, d: 0.32, color: 0x6c5a48 },
        decorations: [
          { kind: 'tank', dx: -0.18, dz: -0.18, r: 0.10, h: 0.10, color: 0xb88c5e },
          { kind: 'tank', dx:  0.18, dz: -0.18, r: 0.10, h: 0.10, color: 0xb88c5e },
          { kind: 'tank', dx:  0.18, dz:  0.18, r: 0.10, h: 0.10, color: 0xb88c5e }
        ]
      },
      // Quonset workshop — rust-red curved-feel body with a single tall stack.
      {
        body: { w: 0.50, h: 0.38, d: 0.55, color: 0x9e4a32 },
        roof: { kind: 'hip', height: 0.20, color: 0x6e3a26 },
        decorations: [{ kind: 'stack', dx: 0, dz: -0.20, h: 0.40, color: 0x3a261a }]
      },
      // Recycling center — orange-and-green sorting bays with sign.
      {
        body: { w: 0.55, h: 0.30, d: 0.55, color: 0xc46c34 },
        body2: { w: 0.55, h: 0.18, d: 0.20, color: 0x4a8e44, yBase: 0 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.30, h: 0.08, y: 0.26, color: 0xece4cf }
        ]
      },
      // Brewing micro — red-brick body + one prominent vertical tank.
      {
        body: { w: 0.45, h: 0.34, d: 0.45, color: 0x822c24 },
        decorations: [
          { kind: 'tank', dx: 0.20, dz: 0.10, r: 0.10, h: 0.55, color: 0xc8c4be }
        ]
      }
    ],
    2: [
      // Factory with 2 chimneys.
      {
        body: { w: 0.75, h: 0.55, d: 0.55, color: 0x7e6e58 },
        decorations: [
          { kind: 'stack', dx: -0.20, dz: -0.18, h: 0.55, color: 0x4a3e30 },
          { kind: 'stack', dx:  0.20, dz: -0.18, h: 0.50, color: 0x4a3e30 }
        ]
      },
      // Warehouse with loading dock (small attached body).
      {
        body: { w: 0.70, h: 0.65, d: 0.55, color: 0x8a7a60 },
        body2: { w: 0.30, h: 0.30, d: 0.20, color: 0x6e5e48, yBase: 0 }
      },
      // Assembly plant — wide and low with sawtooth roof (approx as gable).
      {
        body: { w: 0.85, h: 0.55, d: 0.45, color: 0x847460 },
        roof: { kind: 'gable', height: 0.18, color: 0x4e4030 }
      },
      // Brewing plant — pale-green-tinted body + two tall vertical tanks.
      {
        body: { w: 0.55, h: 0.55, d: 0.50, color: 0x6c8a78 },
        decorations: [
          { kind: 'tank', dx: -0.22, dz: 0.18, r: 0.12, h: 0.85, color: 0xc8d2bd },
          { kind: 'tank', dx:  0.22, dz: 0.18, r: 0.12, h: 0.85, color: 0xc8d2bd },
          { kind: 'sign', side: 'S', w: 0.30, h: 0.08, y: 0.52, color: 0x2c4636 }
        ]
      },
      // Cement plant — grey body with a row of silos.
      {
        body: { w: 0.50, h: 0.50, d: 0.40, color: 0x9a9a96 },
        decorations: [
          { kind: 'tank', dx: -0.30, dz: -0.10, r: 0.10, h: 1.00, color: 0xb0b0ac },
          { kind: 'tank', dx: -0.30, dz:  0.10, r: 0.10, h: 1.00, color: 0xb0b0ac },
          { kind: 'tank', dx:  0.30, dz:  0,    r: 0.10, h: 0.95, color: 0xb0b0ac }
        ]
      },
      // Logistics warehouse — long low orange body + side crane.
      {
        body: { w: 0.85, h: 0.45, d: 0.50, color: 0xc46c34 },
        decorations: [
          { kind: 'crane', dx: 0.30, dz: 0.10, h: 0.85, color: 0x3a3a3a },
          { kind: 'sign', side: 'S', w: 0.40, h: 0.10, y: 0.42, color: 0x1a1a1a }
        ]
      },
      // Pharma plant — sterile white body with twin tall stacks.
      {
        body: { w: 0.65, h: 0.55, d: 0.55, color: 0xece4cf },
        decorations: [
          { kind: 'stack', dx: -0.20, dz: -0.18, h: 0.75, color: 0x6a6e72 },
          { kind: 'stack', dx:  0.20, dz: -0.18, h: 0.65, color: 0x6a6e72 },
          { kind: 'sign', side: 'S', w: 0.32, h: 0.06, y: 0.50, color: 0x4d8eb9 }
        ]
      },
      // Auto-parts factory — slate slab + central crane + dock.
      {
        body: { w: 0.80, h: 0.50, d: 0.50, color: 0x4a525c },
        body2: { w: 0.30, h: 0.20, d: 0.20, color: 0x3a4048, yBase: 0 },
        decorations: [
          { kind: 'crane', dx: 0, dz: 0, h: 0.85, color: 0xeec453 }
        ]
      }
    ],
    3: [
      // Massive factory complex — main hall + two chimneys + tank.
      {
        body: { w: 0.85, h: 0.85, d: 0.65, color: 0x584c3a },
        decorations: [
          { kind: 'stack', dx: -0.25, dz: -0.22, h: 1.10, color: 0x3a2e20 },
          { kind: 'stack', dx:  0.25, dz: -0.22, h: 0.95, color: 0x3a2e20 },
          { kind: 'tank',  dx: -0.20, dz:  0.22, r: 0.10, h: 0.45, color: 0x6a5840 }
        ]
      },
      // Refinery — tank farm with a small admin building.
      {
        body: { w: 0.40, h: 0.50, d: 0.35, color: 0x5e4e3a },
        decorations: [
          { kind: 'tank', dx: -0.25, dz:  0.25, r: 0.13, h: 0.85, color: 0x807060 },
          { kind: 'tank', dx:  0.20, dz:  0.30, r: 0.10, h: 0.65, color: 0x807060 },
          { kind: 'tank', dx:  0.30, dz: -0.20, r: 0.11, h: 0.95, color: 0x807060 },
          { kind: 'stack', dx: 0, dz: -0.30, h: 1.40, color: 0x40342a }
        ]
      },
      // Heavy plant with cranes.
      {
        body: { w: 0.85, h: 0.95, d: 0.55, color: 0x4e4030 },
        decorations: [
          { kind: 'crane', dx: -0.30, dz:  0.10, h: 1.20, color: 0xb84a30 },
          { kind: 'crane', dx:  0.30, dz: -0.10, h: 1.05, color: 0xb84a30 },
          { kind: 'stack', dx:  0,    dz: -0.22, h: 1.30, color: 0x2e2418 }
        ]
      },
      // Steel mill — rust-red mega-hall with three asymmetric stacks.
      {
        body: { w: 0.85, h: 0.75, d: 0.70, color: 0x6e3024 },
        decorations: [
          { kind: 'stack', dx: -0.30, dz: -0.18, h: 1.40, color: 0x2a1612 },
          { kind: 'stack', dx:  0.10, dz: -0.18, h: 1.05, color: 0x2a1612 },
          { kind: 'stack', dx:  0.30, dz: -0.18, h: 0.85, color: 0x2a1612 }
        ]
      },
      // Auto plant — slate slab body + central crane + side sign.
      {
        body: { w: 0.85, h: 0.65, d: 0.85, color: 0x3e424a },
        decorations: [
          { kind: 'crane', dx: 0, dz: 0, h: 1.20, color: 0xeec453 },
          { kind: 'sign', side: 'S', w: 0.46, h: 0.12, y: 0.50, color: 0xece4cf }
        ]
      },
      // Petrochemical — pale-grey admin block + dense tank cluster.
      {
        body: { w: 0.40, h: 0.55, d: 0.40, color: 0xc8c4be },
        decorations: [
          { kind: 'tank', dx: -0.30, dz:  0.20, r: 0.10, h: 0.95, color: 0xece4cf },
          { kind: 'tank', dx:  0.30, dz:  0.20, r: 0.10, h: 0.95, color: 0xece4cf },
          { kind: 'tank', dx: -0.30, dz: -0.20, r: 0.10, h: 0.75, color: 0xece4cf },
          { kind: 'tank', dx:  0.30, dz: -0.20, r: 0.10, h: 0.75, color: 0xece4cf },
          { kind: 'stack', dx: 0, dz: -0.30, h: 1.55, color: 0x444840 }
        ]
      },
      // Shipyard — long blue admin block with pair of dockside cranes.
      {
        body: { w: 0.85, h: 0.65, d: 0.45, color: 0x2c3a5a },
        decorations: [
          { kind: 'crane', dx: -0.32, dz: 0.18, h: 1.30, color: 0x4d8eb9 },
          { kind: 'crane', dx:  0.32, dz: 0.18, h: 1.40, color: 0x4d8eb9 },
          { kind: 'tank',  dx: 0, dz: -0.30, r: 0.12, h: 0.55, color: 0x6a7a90 }
        ]
      },
      // Mining op — earth-toned wide body + tall central stack + ore tanks.
      {
        body: { w: 0.85, h: 0.75, d: 0.55, color: 0x5a3e2a },
        decorations: [
          { kind: 'stack', dx: 0,    dz: -0.22, h: 1.50, color: 0x2e1c12 },
          { kind: 'tank',  dx: -0.30, dz:  0.22, r: 0.12, h: 0.85, color: 0x9a7860 },
          { kind: 'tank',  dx:  0.30, dz:  0.22, r: 0.12, h: 0.65, color: 0x9a7860 }
        ]
      }
    ],
    // ---- L4 / Max density (Alpha 4.18) ----
    // Heavy-industrial mid-rise — multi-storey processing facilities,
    // mega-warehouses with rooftop equipment. Industrial doesn't go
    // skyscraper-tall in real cities, so L4 caps at ~5 storeys but
    // gets WIDER + more stacks/tanks on top.
    4: [
      // 5-storey processing plant — wide gunmetal slab + 4 tall stacks.
      {
        body: { w: 0.95, h: 1.50, d: 0.85, color: 0x4a4844 },
        decorations: [
          { kind: 'stack', dx: -0.32, dz: -0.28, h: 1.60, color: 0x1c1a16 },
          { kind: 'stack', dx:  0.32, dz: -0.28, h: 1.40, color: 0x1c1a16 },
          { kind: 'stack', dx: -0.10, dz:  0.30, h: 1.20, color: 0x1c1a16 },
          { kind: 'stack', dx:  0.20, dz:  0.30, h: 1.05, color: 0x1c1a16 }
        ]
      },
      // Mega-refinery — wide white tank farm with central stack.
      {
        body: { w: 0.50, h: 1.20, d: 0.40, color: 0xc8c4be },
        decorations: [
          { kind: 'tank', dx: -0.32, dz:  0.30, r: 0.14, h: 1.40, color: 0xece4cf },
          { kind: 'tank', dx:  0.32, dz:  0.30, r: 0.14, h: 1.40, color: 0xece4cf },
          { kind: 'tank', dx: -0.32, dz: -0.28, r: 0.14, h: 1.20, color: 0xece4cf },
          { kind: 'tank', dx:  0.32, dz: -0.28, r: 0.14, h: 1.20, color: 0xece4cf },
          { kind: 'stack', dx: 0, dz: -0.32, h: 2.20, color: 0x444840 }
        ]
      },
      // Steel works mega-hall — rust-red mass + 5 dense stacks.
      {
        body: { w: 0.95, h: 1.30, d: 0.85, color: 0x6e3024 },
        decorations: [
          { kind: 'stack', dx: -0.36, dz: -0.20, h: 1.95, color: 0x2a1612 },
          { kind: 'stack', dx: -0.18, dz: -0.20, h: 1.65, color: 0x2a1612 },
          { kind: 'stack', dx:  0.00, dz: -0.20, h: 1.85, color: 0x2a1612 },
          { kind: 'stack', dx:  0.18, dz: -0.20, h: 1.55, color: 0x2a1612 },
          { kind: 'stack', dx:  0.36, dz: -0.20, h: 1.75, color: 0x2a1612 }
        ]
      },
      // Multi-bay logistics warehouse — long flat low-grey + heavy crane.
      {
        body: { w: 0.95, h: 0.95, d: 0.95, color: 0x7c8088 },
        decorations: [
          { kind: 'crane', dx: -0.25, dz: -0.15, h: 1.55, color: 0xeec453 },
          { kind: 'crane', dx:  0.25, dz:  0.15, h: 1.55, color: 0xeec453 },
          { kind: 'sign', side: 'S', w: 0.50, h: 0.16, y: 0.65, color: 0xece4cf }
        ]
      },
      // Heavy-machinery yard — slate slab + 3 cranes + admin tower.
      {
        body: { w: 0.85, h: 0.85, d: 0.85, color: 0x3e424a },
        decorations: [
          { kind: 'crane', dx: -0.30, dz:  0.10, h: 1.70, color: 0xb84a30 },
          { kind: 'crane', dx:  0.30, dz: -0.10, h: 1.55, color: 0xb84a30 },
          { kind: 'crane', dx:  0.00, dz:  0.30, h: 1.40, color: 0xb84a30 },
          { kind: 'tower', w: 0.32, d: 0.32, h: 0.55, color: 0x7a8088, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // Petrochemical mega-complex — white admin + dense tank cluster + 2 stacks.
      {
        body: { w: 0.55, h: 1.10, d: 0.55, color: 0xc8c4be },
        decorations: [
          { kind: 'tank', dx: -0.32, dz:  0.32, r: 0.13, h: 1.50, color: 0xece4cf },
          { kind: 'tank', dx:  0.32, dz:  0.32, r: 0.13, h: 1.50, color: 0xece4cf },
          { kind: 'tank', dx: -0.32, dz: -0.32, r: 0.13, h: 1.30, color: 0xece4cf },
          { kind: 'tank', dx:  0.32, dz: -0.32, r: 0.13, h: 1.30, color: 0xece4cf },
          { kind: 'stack', dx: -0.05, dz: -0.36, h: 2.10, color: 0x444840 },
          { kind: 'stack', dx:  0.20, dz: -0.36, h: 1.80, color: 0x444840 }
        ]
      }
    ]
  },
  // ---- Mixed-use --------------------------------------------------------
  mixed: {
    1: [
      // 2-storey brownstone — shop down, flat above.
      {
        body: { w: 0.55, h: 0.40, d: 0.50, color: 0xc8b294 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.40, depth: 0.10, color: 0x9a4a2a },
          { kind: 'sign',   side: 'S', w: 0.30, h: 0.08, y: 0.30, color: 0xeec453 }
        ]
      },
      // Cafe with patio + small flat above.
      {
        body: { w: 0.60, h: 0.42, d: 0.40, color: 0xd2bd9c },
        decorations: [
          { kind: 'awning', side: 'E', width: 0.10, depth: 0.30, color: 0x6a8eaa }
        ]
      },
      // Corner mixed-use — L-shape (body + body2).
      {
        body: { w: 0.55, h: 0.42, d: 0.40, color: 0xc4ae8e },
        body2: { w: 0.30, h: 0.42, d: 0.55, color: 0xb89e7c, yBase: 0 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.20, h: 0.08, y: 0.32, color: 0x4a8aa0 }
        ]
      },
      // Bookstore + flat — deep-blue body, white sign band.
      {
        body: { w: 0.55, h: 0.45, d: 0.50, color: 0x2e3a52 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.36, depth: 0.10, color: 0xeec453 },
          { kind: 'sign', side: 'S', w: 0.34, h: 0.08, y: 0.34, color: 0xece4cf }
        ]
      },
      // Bakery with patio — warm orange awning, peach walls.
      {
        body: { w: 0.60, h: 0.40, d: 0.42, color: 0xeac494 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.40, depth: 0.14, color: 0xc46c34 },
          { kind: 'sign', side: 'E', w: 0.20, h: 0.08, y: 0.30, color: 0x6e2e1e }
        ]
      },
      // Mixed L-shape with retail wing — terracotta + olive.
      {
        body: { w: 0.50, h: 0.42, d: 0.45, color: 0xc26a4a },
        body2: { w: 0.30, h: 0.30, d: 0.55, color: 0x6c7a4a, yBase: 0 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.20, h: 0.08, y: 0.32, color: 0xece4cf }
        ]
      },
      // Pharmacy + flat — mint-green walls + white awning + cross sign.
      {
        body: { w: 0.55, h: 0.42, d: 0.45, color: 0xa6d4b8 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.36, depth: 0.10, color: 0xece4cf },
          { kind: 'sign', side: 'S', w: 0.16, h: 0.10, y: 0.32, color: 0x2c8a4c }
        ]
      },
      // Wine shop + flat — deep purple stucco + warm-amber awning.
      {
        body: { w: 0.55, h: 0.45, d: 0.45, color: 0x46285c },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.36, depth: 0.12, color: 0xc8a040 },
          { kind: 'sign', side: 'E', w: 0.16, h: 0.08, y: 0.32, color: 0xece4cf }
        ]
      }
    ],
    2: [
      // 4-storey modern mixed.
      {
        body: { w: 0.55, h: 0.78, d: 0.55, color: 0x8d92a4 },
        body2: { w: 0.65, h: 0.30, d: 0.65, color: 0xc8b294, yBase: 0 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.40, depth: 0.10, color: 0x6a4a3a }
        ]
      },
      // Classic walkup with retail base.
      {
        body: { w: 0.55, h: 0.85, d: 0.50, color: 0x9aa0b2 },
        body2: { w: 0.62, h: 0.28, d: 0.55, color: 0xb89a7e, yBase: 0 }
      },
      // Mid-rise with setback.
      {
        body: { w: 0.65, h: 0.30, d: 0.55, color: 0xc4ad8a },
        decorations: [
          { kind: 'tower', w: 0.45, d: 0.45, h: 0.62, color: 0x8d92a4 }
        ]
      },
      // Rooftop garden mid-rise — green-tinted tower above tan podium.
      {
        body: { w: 0.55, h: 0.78, d: 0.55, color: 0xa6b8a0 },
        body2: { w: 0.65, h: 0.30, d: 0.60, color: 0xc8b294, yBase: 0 },
        decorations: [
          { kind: 'tower', w: 0.30, d: 0.30, h: 0.10, color: 0x4a6650, roofKind: 'flat', roofHeight: 0, roofColor: 0 }
        ]
      },
      // Boutique hotel — copper-tinted tower above retail base.
      {
        body: { w: 0.50, h: 0.85, d: 0.50, color: 0xb88c5e },
        body2: { w: 0.65, h: 0.30, d: 0.60, color: 0xece4cf, yBase: 0 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.34, h: 0.08, y: 0.18, color: 0x2e2e2e }
        ]
      },
      // Brick + glass combo — red brick body + glass corner tower.
      {
        body: { w: 0.60, h: 0.55, d: 0.55, color: 0x7a3a30 },
        decorations: [
          { kind: 'tower', w: 0.30, d: 0.30, h: 0.78, color: 0x6a8aac, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'awning', side: 'S', width: 0.32, depth: 0.10, color: 0x1a1a1a }
        ]
      },
      // Live/work loft — red brick body with black trim + warehouse vibe.
      {
        body: { w: 0.65, h: 0.78, d: 0.55, color: 0x6a3024 },
        body2: { w: 0.65, h: 0.18, d: 0.55, color: 0x14181c, yBase: 0 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.40, h: 0.05, y: 0.25, color: 0xece4cf }
        ]
      },
      // Modern condo + plaza — pale grey body, plaza setback, wide awning.
      {
        body: { w: 0.55, h: 0.85, d: 0.55, color: 0xb0b8c0 },
        body2: { w: 0.85, h: 0.10, d: 0.65, color: 0xc8c4be, yBase: 0 },
        decorations: [
          { kind: 'awning', side: 'S', width: 0.50, depth: 0.14, color: 0x2c4060 }
        ]
      }
    ],
    3: [
      // High-rise with podium (commercial base + residential tower).
      {
        body: { w: 0.85, h: 0.42, d: 0.85, color: 0xb89a7e },
        decorations: [
          { kind: 'tower', w: 0.55, d: 0.55, h: 1.20, color: 0x4f5e7a, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'antenna', h: 0.18, color: 0x222222 },
          { kind: 'awning', side: 'S', width: 0.50, depth: 0.10, color: 0xd06a3a }
        ]
      },
      // Tower with retail base — slim form.
      {
        body: { w: 0.50, h: 1.50, d: 0.50, color: 0x4f5e7a },
        body2: { w: 0.75, h: 0.32, d: 0.65, color: 0xc8b294, yBase: 0 }
      },
      // Glass mixed-use slab.
      {
        body: { w: 0.75, h: 1.35, d: 0.45, color: 0x556a85 },
        body2: { w: 0.85, h: 0.28, d: 0.55, color: 0xc4ad8a, yBase: 0 },
        decorations: [
          { kind: 'sign', side: 'S', w: 0.50, h: 0.10, y: 0.18, color: 0xeec453 }
        ]
      },
      // Triple-tower complex — three slim cream towers above shared podium.
      {
        body: { w: 0.85, h: 0.30, d: 0.75, color: 0xece4cf },
        decorations: [
          { kind: 'tower', w: 0.20, d: 0.30, h: 1.30, color: 0xd6cdb6, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'antenna', h: 0.16, color: 0x222222 }
        ]
      },
      // Terraced setback tower — green-tinted with stepped greenery effect.
      {
        body: { w: 0.85, h: 0.40, d: 0.85, color: 0x6a8a72 },
        decorations: [
          { kind: 'tower', w: 0.62, d: 0.62, h: 0.55, color: 0x82a890 },
          { kind: 'tower', w: 0.40, d: 0.40, h: 0.85, color: 0xa0c2ac, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'awning', side: 'S', width: 0.50, depth: 0.10, color: 0x3a4a32 }
        ]
      },
      // Sky-bridge tower — twin slim towers in dark navy with podium.
      {
        body: { w: 0.85, h: 0.32, d: 0.85, color: 0x2a3142 },
        decorations: [
          { kind: 'tower', w: 0.28, d: 0.28, h: 1.40, color: 0x3a4258, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'antenna', h: 0.20, color: 0x444444 }
        ]
      },
      // Ochre tower — warm yellow-tan classic stepped form with crown.
      {
        body: { w: 0.85, h: 0.50, d: 0.85, color: 0xc8a040 },
        decorations: [
          { kind: 'tower', w: 0.62, d: 0.62, h: 0.55, color: 0xb88a3a },
          { kind: 'tower', w: 0.40, d: 0.40, h: 0.55, color: 0xa87a30, roofKind: 'pyramid', roofHeight: 0.16, roofColor: 0x6a4a1a }
        ]
      },
      // Asymmetric duo — slate slabs of unequal heights joined by a podium.
      {
        body: { w: 0.85, h: 0.32, d: 0.85, color: 0x4a525c },
        decorations: [
          { kind: 'tower', w: 0.28, d: 0.40, h: 1.45, color: 0x5e6878, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'antenna', h: 0.18, color: 0x444444 }
        ]
      }
    ],
    // ---- L4 / Max density (Alpha 4.18) ----
    // Mid-rise mixed-use — proper podium-and-tower designs in the 6-9
    // storey range. The classic "5-over-1" type architecture: ground-
    // floor retail, 5-7 storeys of residential above. Bridges L3
    // (small podium-tower) and skyscraper-tier (full skyscraper).
    4: [
      // 8-storey podium-tower — bright retail base + warm-stone tower above.
      {
        body: { w: 0.85, h: 0.42, d: 0.85, color: 0xece4cf },   // ground retail
        decorations: [
          { kind: 'tower', w: 0.78, d: 0.78, h: 2.10, color: 0xc4a87a, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'awning', side: 'S', width: 0.50, depth: 0.10, color: 0xc06030 },
          { kind: 'sign', side: 'S', w: 0.40, h: 0.10, y: 0.20, color: 0xeec453 }
        ]
      },
      // 7-storey brick-podium tower — red brick ground + concrete tower.
      {
        body: { w: 0.85, h: 0.40, d: 0.85, color: 0x8a3a2a },   // brick podium
        decorations: [
          { kind: 'tower', w: 0.78, d: 0.78, h: 1.95, color: 0xc8c4be, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'sign', side: 'S', w: 0.40, h: 0.10, y: 0.18, color: 0xece4cf }
        ]
      },
      // 9-storey live/work — dark brick body + retail awning + tall slim crown.
      {
        body: { w: 0.85, h: 2.20, d: 0.80, color: 0x6a3024 },
        decorations: [
          { kind: 'tower', w: 0.55, d: 0.55, h: 0.45, color: 0x4a1c14, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'awning', side: 'S', width: 0.55, depth: 0.12, color: 0x14181c }
        ]
      },
      // 8-storey teal-glass podium — modern coastal city feel.
      {
        body: { w: 0.85, h: 0.40, d: 0.85, color: 0xece4cf },
        decorations: [
          { kind: 'tower', w: 0.78, d: 0.78, h: 2.20, color: 0x4a8a86, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'sign', side: 'S', w: 0.34, h: 0.08, y: 0.22, color: 0x2c4060 }
        ]
      },
      // 7-storey deco — cream walls + ochre crown band + small pediment.
      {
        body: { w: 0.85, h: 2.30, d: 0.80, color: 0xeede9c },
        decorations: [
          { kind: 'tower', w: 0.62, d: 0.62, h: 0.20, color: 0xc8a040, roofKind: 'pyramid', roofHeight: 0.10, roofColor: 0x6e5020 },
          { kind: 'awning', side: 'S', width: 0.40, depth: 0.10, color: 0x6e5020 }
        ]
      },
      // 9-storey black-stone-podium tower — sleek minimalist mid-rise.
      {
        body: { w: 0.85, h: 0.45, d: 0.85, color: 0x1a1d24 },
        decorations: [
          { kind: 'tower', w: 0.78, d: 0.78, h: 2.30, color: 0xa6b0bc, roofKind: 'flat', roofHeight: 0, roofColor: 0 },
          { kind: 'sign', side: 'S', w: 0.40, h: 0.10, y: 0.22, color: 0xeec453 }
        ]
      }
    ]
  }
};

/* ---- Skyscrapers (Alpha 3.1.2) -------------------------------------- */

/**
 * Skyscraper geometry — one tall tower per 2×2 footprint. Six designs
 * per zone (R / C / MU). Each design picks a body palette + tower
 * silhouette + optional crown/spire + setback level.
 *
 * The renderer calls `buildSkyscraperParts` from the lex-smallest tile
 * of the 2×2; the geometry extends one full tile in +x and +z so it
 * fills the 2×2 footprint cleanly.
 *
 * Construction stages (0..4):
 *   0 = foundation pit (low concrete pad + crane)
 *   1 = base floors (~25% height + crane)
 *   2 = structural skeleton (~60% height, dark frame, multi-cranes)
 *   3 = facade going up (~85% height, lighter cladding, finishing crane)
 *   4 = built (full design, no construction equipment)
 */

export interface SkyscraperDesign {
  /** Main tower body colour. */
  bodyColor: number;
  /** Window-band glass colour (the dark horizontal stripes on the body). */
  glassColor: number;
  /** Vertical fin/reveal colour — slightly darker accent baked into faces. */
  finColor: number;
  /** Crown / cap colour (top accent block). */
  crownColor: number;
  /** Total height in tile units (8.0 = ~5× a typical L3 building). */
  height: number;
  /** Footprint inset from the 2×2 (0 = full 2 tiles wide). */
  inset: number;
  /** Setback height fraction — 0 means no setback. */
  setbackAtFrac: number;
  /** Setback inset fraction (0..1 of inset). */
  setbackInsetFactor: number;
  /** Crown style (Alpha 3.1.5). 'flat' = simple slab, 'stepped' = 3-tier
   *  ziggurat, 'pyramid' = sharp peak, 'mech' = boxy mechanical penthouse,
   *  'dome' = truncated pyramid with thin slab on top. */
  crownStyle: 'flat' | 'stepped' | 'pyramid' | 'mech' | 'dome';
  /** Antenna/spire height beyond crown. 0 = none. */
  spireH: number;
  /** Spire colour when spireH > 0. */
  spireColor: number;
  /** Optional secondary tower next to the main one (for "twin" designs). */
  secondTower?: { offsetX: number; offsetZ: number; w: number; h: number; color: number };
  /** Whether to render visible vertical fin/reveal columns down each face. */
  hasFins: boolean;
  /** Whether the lowest 0.4 tile units render as a darker glass podium
   *  (storefront effect). */
  hasPodiumGlass: boolean;
}

const RESIDENTIAL_SKY: SkyscraperDesign[] = [
  // 0 — Cream Modern: tall slim tower with banded windows + setback crown
  { bodyColor: 0xeae0c4, glassColor: 0x4e6680, finColor: 0xc0b694, crownColor: 0xb8a878,
    height: 7.0, inset: 0.30, setbackAtFrac: 0.7, setbackInsetFactor: 0.6,
    crownStyle: 'mech', spireH: 0, spireColor: 0,
    hasFins: true, hasPodiumGlass: true },
  // 1 — Brick Crimson: stately red high-rise with antenna + recessed windows
  { bodyColor: 0x822c24, glassColor: 0x2a1610, finColor: 0x5c1e18, crownColor: 0x4a1812,
    height: 6.8, inset: 0.30, setbackAtFrac: 0, setbackInsetFactor: 0,
    crownStyle: 'flat', spireH: 0.5, spireColor: 0x222222,
    hasFins: true, hasPodiumGlass: false },
  // 2 — Glass Teal: bright green-glass with stepped crown + horizontal banding
  { bodyColor: 0x3e7868, glassColor: 0x103328, finColor: 0x2c5e50, crownColor: 0x82b8a8,
    height: 7.5, inset: 0.34, setbackAtFrac: 0.85, setbackInsetFactor: 0.5,
    crownStyle: 'stepped', spireH: 0.4, spireColor: 0x666666,
    hasFins: false, hasPodiumGlass: true },
  // 3 — Twin White Towers: two slim towers with subtle banding
  { bodyColor: 0xf2eee4, glassColor: 0x4a5870, finColor: 0xc8c2b0, crownColor: 0xb8b0a0,
    height: 6.5, inset: 0.55, setbackAtFrac: 0, setbackInsetFactor: 0,
    crownStyle: 'flat', spireH: 0, spireColor: 0,
    hasFins: true, hasPodiumGlass: true,
    secondTower: { offsetX: 0.55, offsetZ: 0, w: 0.40, h: 6.5, color: 0xece4cf } },
  // 4 — Slate Modernist: dark wide block with crown setback + dome cap
  { bodyColor: 0x4a525c, glassColor: 0x101418, finColor: 0x2c3038, crownColor: 0x2a323c,
    height: 7.0, inset: 0.20, setbackAtFrac: 0.85, setbackInsetFactor: 0.6,
    crownStyle: 'dome', spireH: 0, spireColor: 0,
    hasFins: false, hasPodiumGlass: true },
  // 5 — Copper Tower: warm tan with sharp pyramid spire + vertical fins
  { bodyColor: 0xb88a5e, glassColor: 0x3a2614, finColor: 0x8a623a, crownColor: 0x6c4a30,
    height: 6.5, inset: 0.30, setbackAtFrac: 0.65, setbackInsetFactor: 0.5,
    crownStyle: 'pyramid', spireH: 0.7, spireColor: 0x4e3220,
    hasFins: true, hasPodiumGlass: false },
  // 6 — Pink + Glass: bright rose with mech crown
  { bodyColor: 0xd06ab8, glassColor: 0x4a1a3e, finColor: 0xb04898, crownColor: 0x8a2a72,
    height: 7.2, inset: 0.30, setbackAtFrac: 0.80, setbackInsetFactor: 0.55,
    crownStyle: 'mech', spireH: 0, spireColor: 0,
    hasFins: false, hasPodiumGlass: true },
  // 7 — Black-and-Gold Deco: dark base with gold ziggurat crown
  { bodyColor: 0x1a1d24, glassColor: 0x080a10, finColor: 0xc8a040, crownColor: 0xc8a040,
    height: 7.8, inset: 0.30, setbackAtFrac: 0.55, setbackInsetFactor: 0.45,
    crownStyle: 'stepped', spireH: 0.6, spireColor: 0xc8a040,
    hasFins: true, hasPodiumGlass: true }
];

const COMMERCIAL_SKY: SkyscraperDesign[] = [
  // 0 — Black Glass: monolithic slab with subtle banding + tall antenna
  { bodyColor: 0x1c1f26, glassColor: 0x080a10, finColor: 0x12141a, crownColor: 0x0a0c12,
    height: 8.5, inset: 0.20, setbackAtFrac: 0, setbackInsetFactor: 0,
    crownStyle: 'mech', spireH: 0.6, spireColor: 0x666666,
    hasFins: false, hasPodiumGlass: true },
  // 1 — Steel Blue Tower: tall corporate with ziggurat crown
  { bodyColor: 0x4a607c, glassColor: 0x141c2a, finColor: 0x2c3a4e, crownColor: 0x2c3a4e,
    height: 8.0, inset: 0.30, setbackAtFrac: 0.78, setbackInsetFactor: 0.5,
    crownStyle: 'stepped', spireH: 0.5, spireColor: 0xc83838,
    hasFins: true, hasPodiumGlass: true },
  // 2 — Art Deco Stepped: light stone with multi-step crown + fins
  { bodyColor: 0xc8c0ac, glassColor: 0x42382a, finColor: 0x9c9078, crownColor: 0x8a7e60,
    height: 7.0, inset: 0.20, setbackAtFrac: 0.55, setbackInsetFactor: 0.45,
    crownStyle: 'stepped', spireH: 0.6, spireColor: 0x4a3e30,
    hasFins: true, hasPodiumGlass: false },
  // 3 — Bronze + Glass: copper-tinted office with mech penthouse
  { bodyColor: 0x9e7440, glassColor: 0x2c1c0a, finColor: 0x6c4a26, crownColor: 0x6c4a26,
    height: 7.5, inset: 0.30, setbackAtFrac: 0.85, setbackInsetFactor: 0.55,
    crownStyle: 'mech', spireH: 0, spireColor: 0,
    hasFins: true, hasPodiumGlass: true },
  // 4 — Twin Office Towers: two slim parallel towers + crown caps
  { bodyColor: 0x3a4a5e, glassColor: 0x101620, finColor: 0x202c3a, crownColor: 0x202c3a,
    height: 6.8, inset: 0.55, setbackAtFrac: 0, setbackInsetFactor: 0,
    crownStyle: 'flat', spireH: 0.4, spireColor: 0x666666,
    hasFins: true, hasPodiumGlass: true,
    secondTower: { offsetX: 0.55, offsetZ: 0, w: 0.40, h: 6.8, color: 0x44546a } },
  // 5 — Spire Skyscraper: tall green-glass with pyramid crown + spire
  { bodyColor: 0x445e54, glassColor: 0x16261e, finColor: 0x2c4036, crownColor: 0x2c4036,
    height: 7.5, inset: 0.30, setbackAtFrac: 0.85, setbackInsetFactor: 0.55,
    crownStyle: 'pyramid', spireH: 1.0, spireColor: 0x223e36,
    hasFins: false, hasPodiumGlass: true },
  // 6 — Royal Purple Corporate: deep purple body + silver mech crown
  { bodyColor: 0x462c5a, glassColor: 0x14081a, finColor: 0x6a4a82, crownColor: 0xb0b8c0,
    height: 8.0, inset: 0.30, setbackAtFrac: 0.78, setbackInsetFactor: 0.5,
    crownStyle: 'mech', spireH: 0.5, spireColor: 0x9aa0ac,
    hasFins: true, hasPodiumGlass: true },
  // 7 — Cyan Glass Slab: bright cyan + flat top + tall antenna
  { bodyColor: 0x44a8c8, glassColor: 0x0c3848, finColor: 0x2c8aa8, crownColor: 0x2c6a82,
    height: 8.5, inset: 0.20, setbackAtFrac: 0, setbackInsetFactor: 0,
    crownStyle: 'flat', spireH: 0.9, spireColor: 0x666666,
    hasFins: false, hasPodiumGlass: true }
];

const MIXED_SKY: SkyscraperDesign[] = [
  // 0 — Podium + Tower: tan podium implied via wider base, navy tower above
  { bodyColor: 0x4a5878, glassColor: 0x121a2c, finColor: 0x2c3854, crownColor: 0x2c3854,
    height: 7.5, inset: 0.32, setbackAtFrac: 0.18, setbackInsetFactor: 0.85,
    crownStyle: 'mech', spireH: 0.5, spireColor: 0x222222,
    hasFins: true, hasPodiumGlass: true },
  // 1 — Glass + Brick Hybrid: red brick base under green-glass tower
  { bodyColor: 0x6e2e26, glassColor: 0x1c0a08, finColor: 0x4a1e18, crownColor: 0x44746a,
    height: 7.0, inset: 0.30, setbackAtFrac: 0.30, setbackInsetFactor: 0.6,
    crownStyle: 'dome', spireH: 0, spireColor: 0,
    hasFins: false, hasPodiumGlass: true },
  // 2 — Triple Tower: cream + setback + spire
  { bodyColor: 0xece4cf, glassColor: 0x3a3022, finColor: 0xc8bfa8, crownColor: 0xb8b0a0,
    height: 7.2, inset: 0.20, setbackAtFrac: 0.55, setbackInsetFactor: 0.55,
    crownStyle: 'stepped', spireH: 0.4, spireColor: 0x444444,
    hasFins: true, hasPodiumGlass: true },
  // 3 — Terraced Sky-Garden: green-tinted with stepped tiers + crown
  { bodyColor: 0x6a8a72, glassColor: 0x1c2a20, finColor: 0x4a6650, crownColor: 0x9ec2a8,
    height: 6.8, inset: 0.20, setbackAtFrac: 0.5, setbackInsetFactor: 0.45,
    crownStyle: 'mech', spireH: 0.4, spireColor: 0x223a30,
    hasFins: false, hasPodiumGlass: true },
  // 4 — Sky-Bridge Twin: two dark navy towers + spires
  { bodyColor: 0x2a3142, glassColor: 0x080c14, finColor: 0x1a2030, crownColor: 0x1a2030,
    height: 7.8, inset: 0.55, setbackAtFrac: 0, setbackInsetFactor: 0,
    crownStyle: 'flat', spireH: 0.5, spireColor: 0x666666,
    hasFins: true, hasPodiumGlass: true,
    secondTower: { offsetX: 0.55, offsetZ: 0, w: 0.42, h: 7.8, color: 0x36405a } },
  // 5 — Curved Stone Tower: cream stone with dome-like crown
  { bodyColor: 0xddd2b7, glassColor: 0x40342a, finColor: 0xb8ad94, crownColor: 0xa89878,
    height: 7.5, inset: 0.32, setbackAtFrac: 0.7, setbackInsetFactor: 0.5,
    crownStyle: 'dome', spireH: 0, spireColor: 0,
    hasFins: true, hasPodiumGlass: true },
  // 6 — Warm Earth Tower: terracotta + cream banded with stepped crown
  { bodyColor: 0xc46c34, glassColor: 0x3a1c10, finColor: 0xece4cf, crownColor: 0x8a4a22,
    height: 7.0, inset: 0.32, setbackAtFrac: 0.55, setbackInsetFactor: 0.5,
    crownStyle: 'stepped', spireH: 0, spireColor: 0,
    hasFins: true, hasPodiumGlass: true },
  // 7 — Black + Gold Accent: deep navy with gold-cap crown + spire
  { bodyColor: 0x1a2336, glassColor: 0x080c14, finColor: 0xc8a040, crownColor: 0xc8a040,
    height: 8.0, inset: 0.30, setbackAtFrac: 0.72, setbackInsetFactor: 0.5,
    crownStyle: 'mech', spireH: 0.7, spireColor: 0xc8a040,
    hasFins: true, hasPodiumGlass: true }
];

const SKY_TABLE: Record<'residential' | 'commercial' | 'mixed', SkyscraperDesign[]> = {
  residential: RESIDENTIAL_SKY,
  commercial: COMMERCIAL_SKY,
  mixed: MIXED_SKY
};

/** Resolve the design for a placed skyscraper. Used by Renderer to align
 *  lit-window placements with the actual body geometry instead of guessing
 *  a fixed footprint (Alpha 3.1.8). */
export function getSkyscraperDesign(
  zone: 'residential' | 'commercial' | 'mixed', variant: number
): SkyscraperDesign {
  const designs = SKY_TABLE[zone];
  return designs[variant % designs.length]!;
}

/**
 * Build the geometry parts for a single skyscraper anchored at (ax, ay).
 * The footprint extends to (ax+1, ay+1). At stage < 4 the function emits
 * construction-in-progress geometry instead of the finished design.
 */
export function buildSkyscraperParts(
  ax: number, ay: number,
  zone: 'residential' | 'commercial' | 'mixed',
  variant: number, stage: 0 | 1 | 2 | 3 | 4
): VariantPart[] {
  const designs = SKY_TABLE[zone];
  const design = designs[variant % designs.length]!;
  const out: VariantPart[] = [];
  // Centre of the 2×2 = anchor + (1, 1) since each tile is 1 unit and
  // the tile centre offset is +0.5 (Renderer scales by TILE_SIZE later).
  const cx = ax + 1.0;
  const cz = ay + 1.0;

  if (stage >= 4) {
    emitFinishedSkyscraper(design, cx, cz, out);
  } else {
    emitConstructionStage(design, cx, cz, stage as 0 | 1 | 2 | 3, out);
  }
  return out;
}

function emitFinishedSkyscraper(
  d: SkyscraperDesign, cx: number, cz: number, out: VariantPart[]
): void {
  const baseW = 2.0 - d.inset * 2;
  const baseD = 2.0 - d.inset * 2;
  // Optional shorter podium body where setback occurs.
  if (d.setbackAtFrac > 0 && d.setbackAtFrac < 1) {
    const podiumH = d.height * d.setbackAtFrac;
    emitDetailedTowerSection(d, cx, cz, 0, podiumH, baseW, baseD, out, true);
    const towerW = baseW * d.setbackInsetFactor;
    const towerD = baseD * d.setbackInsetFactor;
    const towerH = d.height - podiumH;
    emitDetailedTowerSection(d, cx, cz, podiumH, towerH, towerW, towerD, out, false);
    // Setback ledge — thin protruding ring above podium so the step reads.
    const ledge = new BoxGeometry(baseW * 0.96, 0.06, baseD * 0.96);
    ledge.translate(cx, podiumH + 0.03, cz);
    out.push({ geom: ledge, color: d.crownColor });
    emitCrown(d, cx, cz, d.height, towerW, towerD, out);
  } else {
    // Single full-height block.
    emitDetailedTowerSection(d, cx, cz, 0, d.height, baseW, baseD, out, true);
    emitCrown(d, cx, cz, d.height, baseW, baseD, out);
  }
  // Optional second tower (detailed too — same banding logic).
  if (d.secondTower) {
    const s = d.secondTower;
    emitDetailedTowerSection(d, cx + s.offsetX, cz + s.offsetZ, 0, s.h, s.w, s.w, out, true);
    emitCrown(d, cx + s.offsetX, cz + s.offsetZ, s.h, s.w, s.w, out);
  }
  // Optional spire / antenna — thin red cone above the crown.
  if (d.spireH > 0) {
    const spire = new ConeGeometry(0.06, d.spireH, 6);
    spire.translate(cx, d.height + d.spireH / 2, cz);
    out.push({ geom: spire, color: d.spireColor });
  }
  // Roof-top mechanical features that aren't part of the crown style:
  // a small water tank or HVAC box near the roof. Adds visual texture to
  // the skyline. Skipped for designs with a tall spire (already busy).
  if (d.spireH < 0.5 && d.crownStyle !== 'pyramid') {
    const tankW = 0.18;
    const tank = new CylinderGeometry(tankW * 0.5, tankW * 0.5, 0.18, 6);
    tank.translate(cx + 0.20, d.height + 0.10, cz + 0.20);
    out.push({ geom: tank, color: 0x7a807a });
    // Small HVAC vent box.
    const vent = new BoxGeometry(0.16, 0.08, 0.20);
    vent.translate(cx - 0.18, d.height + 0.06, cz - 0.18);
    out.push({ geom: vent, color: 0x5a5e60 });
  }
}

/** Emit one tower section — a body box plus banding/fins/podium-glass
 *  details (Alpha 3.1.5). The banded windows are alternating thin slabs
 *  of `glassColor` punched into each face every ~0.55 tile units, which
 *  reads as floor-by-floor windows at the orthographic scale we use. */
function emitDetailedTowerSection(
  d: SkyscraperDesign,
  cx: number, cz: number,
  yBase: number, height: number,
  w: number, dpth: number,
  out: VariantPart[],
  isPodium: boolean
): void {
  // Main body — slightly narrower than the band/fin geometry that wraps
  // it so we don't z-fight on the surface.
  const innerW = w - 0.04;
  const innerD = dpth - 0.04;
  const body = new BoxGeometry(innerW, height, innerD);
  body.translate(cx, yBase + height / 2, cz);
  out.push({ geom: body, color: d.bodyColor });

  // Window banding: thin slabs of glassColor ringing the body every
  // ~0.55 tiles up. Each band sits 0.005 proud of the body face on the
  // four sides simultaneously (one ring of 4 quads per stripe).
  const bandSpacing = 0.55;
  const bandThickness = 0.16; // reads as a row of windows
  const bandStartY = isPodium ? 0.70 : yBase + 0.30;
  const bandEndY = yBase + height - 0.40;
  for (let by = bandStartY; by < bandEndY; by += bandSpacing) {
    if (by < yBase + 0.10) continue;
    // Wrap band as a thin hollow box (4 face slabs). Cheaper to do one
    // body slab and rely on it being visible against the base.
    const band = new BoxGeometry(w + 0.005, bandThickness, dpth + 0.005);
    band.translate(cx, by, cz);
    out.push({ geom: band, color: d.glassColor });
  }

  // Vertical fin reveals — slim darker columns down each face for rhythm.
  if (d.hasFins) {
    const finCount = 3;
    const finThickness = 0.05;
    for (let i = 0; i < finCount; i++) {
      const t = (i + 1) / (finCount + 1); // 0.25, 0.5, 0.75 along width
      const finX = cx - w / 2 + t * w;
      // Two fins on x-facing sides.
      const finN = new BoxGeometry(finThickness, height - 0.10, 0.02);
      finN.translate(finX, yBase + height / 2, cz - dpth / 2 + 0.01);
      out.push({ geom: finN, color: d.finColor });
      const finS = new BoxGeometry(finThickness, height - 0.10, 0.02);
      finS.translate(finX, yBase + height / 2, cz + dpth / 2 - 0.01);
      out.push({ geom: finS, color: d.finColor });
      // Two fins on z-facing sides at the same fractional positions.
      const finZ = cz - dpth / 2 + t * dpth;
      const finE = new BoxGeometry(0.02, height - 0.10, finThickness);
      finE.translate(cx + w / 2 - 0.01, yBase + height / 2, finZ);
      out.push({ geom: finE, color: d.finColor });
      const finW = new BoxGeometry(0.02, height - 0.10, finThickness);
      finW.translate(cx - w / 2 + 0.01, yBase + height / 2, finZ);
      out.push({ geom: finW, color: d.finColor });
    }
  }

  // Podium glass storefront on the bottom 0.45 — only when this is the
  // ground-level section and the design opted in. Reads as "shops at
  // street level" especially on Mixed-use towers.
  if (isPodium && d.hasPodiumGlass) {
    const podiumGlassH = 0.45;
    const glass = new BoxGeometry(w + 0.01, podiumGlassH, dpth + 0.01);
    glass.translate(cx, yBase + podiumGlassH / 2, cz);
    out.push({ geom: glass, color: d.glassColor });
    // Entrance frame strip.
    const frame = new BoxGeometry(w * 0.20, 0.05, dpth + 0.02);
    frame.translate(cx, yBase + podiumGlassH + 0.02, cz);
    out.push({ geom: frame, color: d.crownColor });
  }
}

/** Emit the crown atop a tower section. Style picks the silhouette. */
function emitCrown(
  d: SkyscraperDesign, cx: number, cz: number, top: number,
  w: number, dpth: number, out: VariantPart[]
): void {
  switch (d.crownStyle) {
    case 'flat': {
      const crownH = 0.18;
      const crown = new BoxGeometry(w * 0.96, crownH, dpth * 0.96);
      crown.translate(cx, top - crownH / 2, cz);
      out.push({ geom: crown, color: d.crownColor });
      // Slim accent band.
      const accent = new BoxGeometry(w * 1.02, 0.06, dpth * 1.02);
      accent.translate(cx, top - crownH - 0.03, cz);
      out.push({ geom: accent, color: d.finColor });
      break;
    }
    case 'mech': {
      // Mechanical penthouse — boxy add-on on top.
      const baseSlab = new BoxGeometry(w * 0.96, 0.10, dpth * 0.96);
      baseSlab.translate(cx, top - 0.05, cz);
      out.push({ geom: baseSlab, color: d.crownColor });
      const penthouseW = w * 0.55;
      const penthouseD = dpth * 0.55;
      const penthouseH = 0.42;
      const ph = new BoxGeometry(penthouseW, penthouseH, penthouseD);
      ph.translate(cx, top + penthouseH / 2, cz);
      out.push({ geom: ph, color: d.bodyColor });
      // Small penthouse cap.
      const cap = new BoxGeometry(penthouseW * 0.90, 0.06, penthouseD * 0.90);
      cap.translate(cx, top + penthouseH + 0.03, cz);
      out.push({ geom: cap, color: d.crownColor });
      break;
    }
    case 'stepped': {
      // 3-tier ziggurat — three nested boxes shrinking toward the top.
      const tier1H = 0.18;
      const tier1 = new BoxGeometry(w * 0.96, tier1H, dpth * 0.96);
      tier1.translate(cx, top - tier1H / 2, cz);
      out.push({ geom: tier1, color: d.crownColor });
      const tier2H = 0.22;
      const tier2 = new BoxGeometry(w * 0.70, tier2H, dpth * 0.70);
      tier2.translate(cx, top + tier2H / 2, cz);
      out.push({ geom: tier2, color: d.crownColor });
      const tier3H = 0.20;
      const tier3 = new BoxGeometry(w * 0.45, tier3H, dpth * 0.45);
      tier3.translate(cx, top + tier2H + tier3H / 2, cz);
      out.push({ geom: tier3, color: d.bodyColor });
      break;
    }
    case 'pyramid': {
      // Sharp pyramid — the spire/antenna typically extends from the apex.
      const base = new BoxGeometry(w * 0.96, 0.08, dpth * 0.96);
      base.translate(cx, top - 0.04, cz);
      out.push({ geom: base, color: d.crownColor });
      const peak = new ConeGeometry(Math.min(w, dpth) * 0.55, 0.65, 4);
      peak.translate(cx, top + 0.32, cz);
      out.push({ geom: peak, color: d.crownColor });
      break;
    }
    case 'dome': {
      // Truncated pyramid base + thin slab on top suggesting a dome.
      const base = new BoxGeometry(w * 0.96, 0.10, dpth * 0.96);
      base.translate(cx, top - 0.05, cz);
      out.push({ geom: base, color: d.crownColor });
      const taper = new ConeGeometry(Math.min(w, dpth) * 0.50, 0.30, 8);
      taper.translate(cx, top + 0.18, cz);
      out.push({ geom: taper, color: d.crownColor });
      const cap = new CylinderGeometry(Math.min(w, dpth) * 0.30, Math.min(w, dpth) * 0.30, 0.06, 12);
      cap.translate(cx, top + 0.36, cz);
      out.push({ geom: cap, color: d.bodyColor });
      break;
    }
  }
}

function emitConstructionStage(
  d: SkyscraperDesign, cx: number, cz: number, stage: 0 | 1 | 2 | 3, out: VariantPart[]
): void {
  // Site pad — every stage has the foundation pad.
  const padW = 2.0 - 0.10;
  const padD = 2.0 - 0.10;
  const pad = new BoxGeometry(padW, 0.04, padD);
  pad.translate(cx, 0.02, cz);
  out.push({ geom: pad, color: 0x6a6a6a });

  // Stage-driven structural progress.
  const baseW = 2.0 - d.inset * 2;
  const baseD = 2.0 - d.inset * 2;
  const progressFrac = [0.10, 0.30, 0.55, 0.80][stage] ?? 0;
  const builtH = d.height * progressFrac;
  if (builtH > 0.05) {
    // For stage 1: solid concrete base. For stage 2-3: darker steel
    // skeleton with slightly desaturated colour.
    const isSkeleton = stage === 2;
    const colour = stage === 1 ? 0xc8c4be : isSkeleton ? 0x44494c : mixHexLocal(d.bodyColor, 0xc8c4be, 0.35);
    const body = new BoxGeometry(baseW, builtH, baseD);
    body.translate(cx, builtH / 2, cz);
    out.push({ geom: body, color: colour });
  }

  // Crane(s) — 1 crane on early stages, 2 on stage 2 (peak structural work).
  const craneCount = stage <= 1 ? 1 : stage === 2 ? 2 : 1;
  const craneH = d.height * 0.85; // crane towers above what's been built
  for (let i = 0; i < craneCount; i++) {
    const sign = i === 0 ? 1 : -1;
    const cox = cx + 0.45 * sign;
    const coz = cz + 0.45 * sign;
    // Crane mast.
    const mast = new BoxGeometry(0.06, craneH, 0.06);
    mast.translate(cox, craneH / 2, coz);
    out.push({ geom: mast, color: 0xeec453 });
    // Crane jib (horizontal arm).
    const jibW = 0.55;
    const jib = new BoxGeometry(jibW, 0.05, 0.04);
    jib.translate(cox + jibW / 2 - 0.03, craneH - 0.04, coz);
    out.push({ geom: jib, color: 0xeec453 });
    // Counter-jib.
    const cjib = new BoxGeometry(0.20, 0.05, 0.04);
    cjib.translate(cox - 0.10, craneH - 0.04, coz);
    out.push({ geom: cjib, color: 0xc89030 });
  }
}

function mixHexLocal(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/* ============================================================================
 * The Mayor's Mansion (Alpha 4.2)
 *
 * The most detailed single build in the game. 4 wide × 2 deep footprint.
 * The mansion sits along the back row (4 tiles wide × 1 tile deep); the
 * front row is the lavish formal estate grounds — central reflecting pool
 * with a 3-tiered marble fountain, parterre gardens flanking the pool,
 * paved drive leading to the front portico, bronze statues at the pool
 * corners, ornamental topiary cones along the perimeter, two ornamental
 * trees in the back corners, and a low stone balustrade ringing the lot.
 *
 * The mansion itself is a 5-section composition:
 *   - 2 outer wings (flanks, 2-storey, hipped roof)
 *   - 2 inner blocks (between wings + central, 2-storey, hipped roof)
 *   - 1 grand central block (3-storey, parapet, copper-green dome with
 *     spire + ball finial, pedimented portico with 6 columns + grand door
 *     + sweeping front steps)
 * Plus: 4 chimneys, ~30 individually-placed window panels with shutters,
 * a balustrade running the entire roofline, decorative cornice band
 * between stories, two flanking lampposts at the entrance, and an
 * ornamental garden urn at each front corner.
 *
 * Coordinate convention: anchor (ax, ay) is the lex-smallest tile of
 * the 4×2 footprint. The mansion footprint spans:
 *   x ∈ [ax,     ax+4)  (4 tiles wide along the X axis)
 *   z ∈ [ay,     ay+2)  (2 tiles deep along the Z axis)
 * Mansion body sits in z ∈ [ay, ay+1); grounds sit in z ∈ [ay+1, ay+2).
 *
 * Performance: ~140 BufferGeometry parts total. They merge into the same
 * `buildBuildingsMesh` (or `buildCityBuildingsMesh`) sweep that the rest
 * of the world uses, so the cost is one extra draw call's worth of
 * vertices — well within the per-frame budget on Pixel 7 / iPhone 13.
 * ========================================================================== */

/** Color palette — kept as constants up top so the whole composition
 *  reads with one consistent material story. */
const MM_LIMESTONE = 0xeae0c8;       // mansion walls, parapets
const MM_LIMESTONE_DEEP = 0xd4c8a8;  // pedestal, podium, deep cornice
const MM_LIMESTONE_DARK = 0xb8a684;  // step risers, pediment shadow
const MM_ROOF_SLATE = 0x4a5060;      // wing hipped roofs
const MM_ROOF_GABLE = 0x3a3e4a;      // pediment fascia
const MM_DOME_COPPER = 0x4f9f7a;     // weathered copper dome (matches existing clock_tower)
const MM_GOLD_TRIM = 0xeec453;       // lettering, finials
const MM_WINDOW_DARK = 0x1f2a3a;     // window glass
const MM_SHUTTER = 0x6e4622;         // dark wood shutters
const MM_DOOR_DARK = 0x3a2010;       // grand entrance door
const MM_LAWN = 0x4a8c3a;            // manicured estate lawn
const MM_LAWN_LIGHT = 0x5fa14a;      // parterre infill
const MM_HEDGE_DARK = 0x2d5e2a;      // formal hedge walls
const MM_HEDGE_BRIGHT = 0x3a7a3a;    // inner parterre cross
const MM_PAVING = 0xc7c0ad;          // driveway flagstone
const MM_PAVING_DEEP = 0xb0a895;     // pool surround
const MM_WATER = 0x4d8eb9;           // reflecting pool water
const MM_WATER_LIGHT = 0xc6dff0;     // pool surface highlight
const MM_BRONZE = 0x8c6a3a;          // statues
const MM_BRONZE_BRIGHT = 0xa07a44;   // statue heads
const MM_LAMPPOST = 0x222a32;        // wrought iron
const MM_LAMP_BULB = 0xf2cd5c;       // lamps
const MM_FLOWER_RED = 0xd84545;
const MM_FLOWER_YELLOW = 0xf2cd5c;
const MM_FLOWER_PURPLE = 0xa75ad4;
const MM_FLOWER_WHITE = 0xf6f0e0;
const MM_TREE_TRUNK = 0x6e3e1d;
const MM_TREE_LEAF = 0x2f6a2d;

export function buildMayorMansionParts(ax: number, ay: number): VariantPart[] {
  const out: VariantPart[] = [];
  // Footprint centre in world coords. TILE_SIZE = 1 so:
  //   width along X = 4 units, depth along Z = 2 units
  //   centre X = ax + 2; centre Z = ay + 1
  const cx = ax + 2;
  const cz = ay + 1;
  // Mansion body sits centred at z = cz - 0.5 (back-row centre).
  // Grounds sit centred at z = cz + 0.5 (front-row centre).
  const mz = cz - 0.5;
  const gz = cz + 0.5;

  // ===== ESTATE PAD (entire 4×2 footprint) =====
  // A subtle limestone-colored pad lifts the whole estate slightly off
  // the natural terrain. Reads as "this is a continuous, deliberate
  // composition" rather than a building dropped on grass.
  const estatePad = new BoxGeometry(3.95, 0.025, 1.95);
  estatePad.translate(cx, 0.0125, cz);
  out.push({ geom: estatePad, color: MM_LIMESTONE_DEEP });
  // Manicured lawn covers most of the front grounds + flanking borders.
  const frontLawn = new BoxGeometry(3.85, 0.020, 0.92);
  frontLawn.translate(cx, 0.024, gz);
  out.push({ geom: frontLawn, color: MM_LAWN });
  // ===== PERIMETER BALUSTRADE =====
  // Low stone wall around the entire footprint, broken at the front
  // centre by the main drive entrance.
  // Front (south) edge — left + right segments flanking the drive opening.
  const frontWallLeft = new BoxGeometry(1.45, 0.10, 0.06);
  frontWallLeft.translate(cx - 1.20, 0.07, cz + 0.97);
  out.push({ geom: frontWallLeft, color: MM_LIMESTONE });
  const frontWallRight = new BoxGeometry(1.45, 0.10, 0.06);
  frontWallRight.translate(cx + 1.20, 0.07, cz + 0.97);
  out.push({ geom: frontWallRight, color: MM_LIMESTONE });
  // Back (north) edge — solid, no break.
  const backWall = new BoxGeometry(3.95, 0.10, 0.06);
  backWall.translate(cx, 0.07, cz - 0.97);
  out.push({ geom: backWall, color: MM_LIMESTONE });
  // East + West edges.
  const eastWall = new BoxGeometry(0.06, 0.10, 1.95);
  eastWall.translate(cx + 1.97, 0.07, cz);
  out.push({ geom: eastWall, color: MM_LIMESTONE });
  const westWall = new BoxGeometry(0.06, 0.10, 1.95);
  westWall.translate(cx - 1.97, 0.07, cz);
  out.push({ geom: westWall, color: MM_LIMESTONE });
  // Corner posts — taller blocks with gold-finial caps.
  for (const [px, pz] of [[-1.97, -0.97], [1.97, -0.97], [-1.97, 0.97], [1.97, 0.97]] as Array<[number, number]>) {
    const post = new BoxGeometry(0.10, 0.20, 0.10);
    post.translate(cx + px, 0.10, cz + pz);
    out.push({ geom: post, color: MM_LIMESTONE });
    const finial = new ConeGeometry(0.05, 0.06, 6);
    finial.translate(cx + px, 0.23, cz + pz);
    out.push({ geom: finial, color: MM_GOLD_TRIM });
  }
  // Front gate posts (taller, flank the drive opening) with gold finials.
  for (const px of [-0.50, 0.50]) {
    const post = new BoxGeometry(0.10, 0.30, 0.10);
    post.translate(cx + px, 0.15, cz + 0.97);
    out.push({ geom: post, color: MM_LIMESTONE });
    const finial = new ConeGeometry(0.06, 0.08, 6);
    finial.translate(cx + px, 0.34, cz + 0.97);
    out.push({ geom: finial, color: MM_GOLD_TRIM });
  }

  // ===== GRAND DRIVE =====
  // Paved flagstone driveway running from the front gate to the steps
  // at the foot of the entrance portico.
  const drive = new BoxGeometry(1.00, 0.025, 0.95);
  drive.translate(cx, 0.027, gz);
  out.push({ geom: drive, color: MM_PAVING });
  // Drive border — slim limestone strip on each side.
  const driveBorderL = new BoxGeometry(0.06, 0.030, 0.95);
  driveBorderL.translate(cx - 0.50, 0.029, gz);
  out.push({ geom: driveBorderL, color: MM_LIMESTONE_DEEP });
  const driveBorderR = new BoxGeometry(0.06, 0.030, 0.95);
  driveBorderR.translate(cx + 0.50, 0.029, gz);
  out.push({ geom: driveBorderR, color: MM_LIMESTONE_DEEP });

  // ===== REFLECTING POOL with central FOUNTAIN =====
  // Two long reflecting pool sections flanking the central drive — they
  // run east-west between the drive border and the parterre garden.
  // (Monumental "pool by the driveway" composition.)
  for (const sideX of [-1.10, 1.10]) {
    // Pool surround.
    const surround = new BoxGeometry(1.05, 0.040, 0.50);
    surround.translate(cx + sideX, 0.035, gz);
    out.push({ geom: surround, color: MM_PAVING_DEEP });
    // Water inset.
    const water = new BoxGeometry(0.85, 0.030, 0.36);
    water.translate(cx + sideX, 0.045, gz);
    out.push({ geom: water, color: MM_WATER });
    // Subtle light reflection slab.
    const ripple = new BoxGeometry(0.30, 0.035, 0.05);
    ripple.translate(cx + sideX, 0.050, gz);
    out.push({ geom: ripple, color: MM_WATER_LIGHT });
    // Bronze statue at each end of the pool.
    for (const ex of [-0.42, 0.42]) {
      const plinth = new BoxGeometry(0.10, 0.10, 0.10);
      plinth.translate(cx + sideX + ex, 0.06, gz);
      out.push({ geom: plinth, color: MM_PAVING_DEEP });
      const statueLegs = new BoxGeometry(0.05, 0.10, 0.04);
      statueLegs.translate(cx + sideX + ex, 0.16, gz);
      out.push({ geom: statueLegs, color: MM_BRONZE });
      const statueTorso = new BoxGeometry(0.07, 0.08, 0.05);
      statueTorso.translate(cx + sideX + ex, 0.25, gz);
      out.push({ geom: statueTorso, color: MM_BRONZE });
      const statueHead = new BoxGeometry(0.04, 0.04, 0.04);
      statueHead.translate(cx + sideX + ex, 0.31, gz);
      out.push({ geom: statueHead, color: MM_BRONZE_BRIGHT });
    }
  }

  // ===== PARTERRE GARDENS (at the outermost columns of the front row) =====
  // Geometric formal hedges with flower-dot accents. One garden on each
  // outer corner of the front row.
  for (const sideX of [-1.65, 1.65]) {
    // Outer hedge frame — square box.
    const hedgeN = new BoxGeometry(0.60, 0.10, 0.04);
    hedgeN.translate(cx + sideX, 0.075, gz - 0.28);
    out.push({ geom: hedgeN, color: MM_HEDGE_DARK });
    const hedgeS = new BoxGeometry(0.60, 0.10, 0.04);
    hedgeS.translate(cx + sideX, 0.075, gz + 0.28);
    out.push({ geom: hedgeS, color: MM_HEDGE_DARK });
    const hedgeW = new BoxGeometry(0.04, 0.10, 0.60);
    hedgeW.translate(cx + sideX - 0.28, 0.075, gz);
    out.push({ geom: hedgeW, color: MM_HEDGE_DARK });
    const hedgeE = new BoxGeometry(0.04, 0.10, 0.60);
    hedgeE.translate(cx + sideX + 0.28, 0.075, gz);
    out.push({ geom: hedgeE, color: MM_HEDGE_DARK });
    // Inner cross hedge (forming 4 quadrants).
    const hCrossH = new BoxGeometry(0.50, 0.07, 0.03);
    hCrossH.translate(cx + sideX, 0.06, gz);
    out.push({ geom: hCrossH, color: MM_HEDGE_BRIGHT });
    const hCrossV = new BoxGeometry(0.03, 0.07, 0.50);
    hCrossV.translate(cx + sideX, 0.06, gz);
    out.push({ geom: hCrossV, color: MM_HEDGE_BRIGHT });
    // Flower dots in each of the four quadrants.
    const flowerColors = [MM_FLOWER_RED, MM_FLOWER_YELLOW, MM_FLOWER_PURPLE, MM_FLOWER_WHITE];
    let i = 0;
    for (const fz of [-0.13, 0.13]) {
      for (const fx of [-0.13, 0.13]) {
        const flower = new ConeGeometry(0.040, 0.06, 6);
        flower.translate(cx + sideX + fx, 0.10, gz + fz);
        out.push({ geom: flower, color: flowerColors[i++ % flowerColors.length]! });
      }
    }
    // Topiary corners — small cones at the four outer corners.
    for (const [tx, tz] of [[-0.30, -0.30], [0.30, -0.30], [-0.30, 0.30], [0.30, 0.30]] as Array<[number, number]>) {
      const top = new ConeGeometry(0.07, 0.18, 8);
      top.translate(cx + sideX + tx, 0.13, gz + tz);
      out.push({ geom: top, color: MM_HEDGE_BRIGHT });
    }
    // Lawn infill behind the hedge frame to brighten the parterre.
    const parterreLawn = new BoxGeometry(0.55, 0.025, 0.55);
    parterreLawn.translate(cx + sideX, 0.030, gz);
    out.push({ geom: parterreLawn, color: MM_LAWN_LIGHT });
  }

  // ===== ENTRANCE STEPS (foot of the portico, between drive + mansion) =====
  // Three-step grand stair leading up to the mansion porch level.
  for (let s = 0; s < 3; s++) {
    const step = new BoxGeometry(1.20 - s * 0.10, 0.045, 0.10);
    step.translate(cx, 0.045 + s * 0.045, mz + 0.45 - s * 0.05);
    out.push({ geom: step, color: MM_LIMESTONE_DARK });
  }
  // Two ornamental urns flanking the steps.
  for (const ux of [-0.65, 0.65]) {
    const urnBase = new CylinderGeometry(0.06, 0.05, 0.04, 8);
    urnBase.translate(cx + ux, 0.08, mz + 0.50);
    out.push({ geom: urnBase, color: MM_LIMESTONE_DEEP });
    const urnBowl = new CylinderGeometry(0.07, 0.06, 0.10, 8);
    urnBowl.translate(cx + ux, 0.15, mz + 0.50);
    out.push({ geom: urnBowl, color: MM_LIMESTONE });
    const urnTopiary = new ConeGeometry(0.07, 0.16, 8);
    urnTopiary.translate(cx + ux, 0.28, mz + 0.50);
    out.push({ geom: urnTopiary, color: MM_HEDGE_BRIGHT });
  }
  // Two wrought-iron lampposts flanking the steps further out.
  for (const lx of [-0.85, 0.85]) {
    const lampPole = new CylinderGeometry(0.018, 0.018, 0.46, 6);
    lampPole.translate(cx + lx, 0.27, mz + 0.50);
    out.push({ geom: lampPole, color: MM_LAMPPOST });
    const lampHead = new BoxGeometry(0.10, 0.10, 0.10);
    lampHead.translate(cx + lx, 0.55, mz + 0.50);
    out.push({ geom: lampHead, color: MM_LAMPPOST });
    const lampBulb = new BoxGeometry(0.06, 0.06, 0.06);
    lampBulb.translate(cx + lx, 0.55, mz + 0.50);
    out.push({ geom: lampBulb, color: MM_LAMP_BULB });
    const lampFinial = new ConeGeometry(0.025, 0.05, 6);
    lampFinial.translate(cx + lx, 0.625, mz + 0.50);
    out.push({ geom: lampFinial, color: MM_GOLD_TRIM });
  }

  // ===== MANSION BODY =====
  // The mansion runs along the back row, 4 tiles wide × 1 tile deep.
  // It's composed of 5 connected blocks: outer wings (×2), inner blocks
  // (×2), grand central (×1, taller).
  // Mansion footprint: width 3.40 (under the 4-unit estate width),
  // depth 0.65 (under the 1-unit back-row depth).
  const mansionDepth = 0.65;
  const mansionBackZ = mz - 0.10;  // body centre slightly behind centre of back row

  // Podium under the entire mansion — slim limestone slab.
  const mansionPodium = new BoxGeometry(3.50, 0.06, mansionDepth + 0.10);
  mansionPodium.translate(cx, 0.06, mansionBackZ);
  out.push({ geom: mansionPodium, color: MM_LIMESTONE_DEEP });

  // ----- OUTER WINGS (left + right, 2-storey, lower than centre) -----
  for (const wingX of [-1.30, 1.30]) {
    const wingW = 0.80;
    const wingH = 0.70;
    const wing = new BoxGeometry(wingW, wingH, mansionDepth);
    wing.translate(cx + wingX, 0.06 + wingH / 2 + 0.03, mansionBackZ);
    out.push({ geom: wing, color: MM_LIMESTONE });
    // Cornice band between the two stories.
    const cornice = new BoxGeometry(wingW + 0.02, 0.04, mansionDepth + 0.02);
    cornice.translate(cx + wingX, 0.06 + wingH * 0.5 + 0.03, mansionBackZ);
    out.push({ geom: cornice, color: MM_LIMESTONE_DEEP });
    // Hipped roof.
    const wingRoof = new ConeGeometry(0.55, 0.18, 4);
    wingRoof.rotateY(Math.PI / 4);
    wingRoof.translate(cx + wingX, 0.06 + wingH + 0.03 + 0.09, mansionBackZ);
    out.push({ geom: wingRoof, color: MM_ROOF_SLATE });
    // Roof balustrade — slim parapet running the wing's front edge.
    const wingBalustrade = new BoxGeometry(wingW + 0.04, 0.04, 0.04);
    wingBalustrade.translate(cx + wingX, 0.06 + wingH + 0.05, mansionBackZ + mansionDepth / 2 + 0.01);
    out.push({ geom: wingBalustrade, color: MM_LIMESTONE });
    // Twin chimneys per wing.
    for (const chx of [-0.20, 0.20]) {
      const chimney = new BoxGeometry(0.07, 0.12, 0.07);
      chimney.translate(cx + wingX + chx, 0.06 + wingH + 0.03 + 0.18, mansionBackZ - 0.10);
      out.push({ geom: chimney, color: MM_LIMESTONE_DARK });
      const chimneyCap = new BoxGeometry(0.09, 0.025, 0.09);
      chimneyCap.translate(cx + wingX + chx, 0.06 + wingH + 0.03 + 0.255, mansionBackZ - 0.10);
      out.push({ geom: chimneyCap, color: MM_ROOF_GABLE });
    }
    // Wing windows — 3 per story × 2 stories = 6 windows per wing.
    // Tall narrow rectangle with shutters on each side.
    for (let story = 0; story < 2; story++) {
      const yWindow = 0.06 + 0.18 + story * 0.32;
      for (const wxOff of [-0.25, 0.0, 0.25]) {
        // Glass.
        const win = new BoxGeometry(0.08, 0.16, 0.022);
        win.translate(cx + wingX + wxOff, yWindow, mansionBackZ + mansionDepth / 2 + 0.003);
        out.push({ geom: win, color: MM_WINDOW_DARK });
        // Left shutter.
        const sL = new BoxGeometry(0.045, 0.16, 0.018);
        sL.translate(cx + wingX + wxOff - 0.07, yWindow, mansionBackZ + mansionDepth / 2 + 0.005);
        out.push({ geom: sL, color: MM_SHUTTER });
        // Right shutter.
        const sR = new BoxGeometry(0.045, 0.16, 0.018);
        sR.translate(cx + wingX + wxOff + 0.07, yWindow, mansionBackZ + mansionDepth / 2 + 0.005);
        out.push({ geom: sR, color: MM_SHUTTER });
      }
    }
  }

  // ----- INNER BLOCKS (2-storey, between wings + central) -----
  for (const innerX of [-0.55, 0.55]) {
    const innerW = 0.55;
    const innerH = 0.85;  // slightly taller than wings
    const inner = new BoxGeometry(innerW, innerH, mansionDepth);
    inner.translate(cx + innerX, 0.06 + innerH / 2 + 0.03, mansionBackZ);
    out.push({ geom: inner, color: MM_LIMESTONE });
    // Cornice band.
    const cornice = new BoxGeometry(innerW + 0.02, 0.04, mansionDepth + 0.02);
    cornice.translate(cx + innerX, 0.06 + innerH * 0.5 + 0.03, mansionBackZ);
    out.push({ geom: cornice, color: MM_LIMESTONE_DEEP });
    // Hipped roof.
    const innerRoof = new ConeGeometry(0.40, 0.16, 4);
    innerRoof.rotateY(Math.PI / 4);
    innerRoof.translate(cx + innerX, 0.06 + innerH + 0.03 + 0.08, mansionBackZ);
    out.push({ geom: innerRoof, color: MM_ROOF_SLATE });
    // Inner-block windows — 2 per story × 2 stories = 4 each.
    for (let story = 0; story < 2; story++) {
      const yWindow = 0.06 + 0.22 + story * 0.38;
      for (const wxOff of [-0.13, 0.13]) {
        const win = new BoxGeometry(0.09, 0.20, 0.022);
        win.translate(cx + innerX + wxOff, yWindow, mansionBackZ + mansionDepth / 2 + 0.003);
        out.push({ geom: win, color: MM_WINDOW_DARK });
        const sL = new BoxGeometry(0.045, 0.20, 0.018);
        sL.translate(cx + innerX + wxOff - 0.075, yWindow, mansionBackZ + mansionDepth / 2 + 0.005);
        out.push({ geom: sL, color: MM_SHUTTER });
        const sR = new BoxGeometry(0.045, 0.20, 0.018);
        sR.translate(cx + innerX + wxOff + 0.075, yWindow, mansionBackZ + mansionDepth / 2 + 0.005);
        out.push({ geom: sR, color: MM_SHUTTER });
      }
    }
  }

  // ----- GRAND CENTRAL BLOCK (3-storey, parapet, dome, portico) -----
  const centralW = 0.95;
  const centralH = 1.10;
  const central = new BoxGeometry(centralW, centralH, mansionDepth + 0.10);
  central.translate(cx, 0.06 + centralH / 2 + 0.03, mansionBackZ);
  out.push({ geom: central, color: MM_LIMESTONE });
  // Two cornice bands (between three stories).
  for (const yC of [centralH / 3, centralH * 2 / 3]) {
    const cornice = new BoxGeometry(centralW + 0.03, 0.045, mansionDepth + 0.13);
    cornice.translate(cx, 0.06 + yC + 0.03, mansionBackZ);
    out.push({ geom: cornice, color: MM_LIMESTONE_DEEP });
  }
  // Roof parapet — wraps the top of the central block (no pitched roof,
  // it's a flat-top with a balustrade so the dome sits clean).
  const parapet = new BoxGeometry(centralW + 0.04, 0.06, mansionDepth + 0.14);
  parapet.translate(cx, 0.06 + centralH + 0.06, mansionBackZ);
  out.push({ geom: parapet, color: MM_LIMESTONE_DEEP });
  // Balustrade detail — a row of tiny posts along the parapet front.
  for (let i = 0; i < 11; i++) {
    const px = -centralW * 0.45 + i * (centralW * 0.9 / 10);
    const post = new BoxGeometry(0.022, 0.06, 0.022);
    post.translate(cx + px, 0.06 + centralH + 0.06, mansionBackZ + (mansionDepth + 0.14) / 2 + 0.005);
    out.push({ geom: post, color: MM_LIMESTONE });
  }
  // ===== PEDIMENT (triangular gable above the entrance, on the front) =====
  // Classical pediment built from 4 pieces:
  //   1. Horizontal entablature base (the architrave below the gable)
  //   2. Tympanum — flat triangular wall behind the gable, holds the
  //      gold escutcheon. Sits slightly recessed so the slopes cast a
  //      subtle shadow on it.
  //   3-4. Two angled slabs forming the triangular roof silhouette.
  // Pre-4.2.2 used a rotated 3-segment cone for the gable which produced
  // a wedge artifact protruding behind the central block ("weird black
  // box at the top"). The 4-piece composition is both cleaner visually
  // and structurally honest — the gable + tympanum + base read as a
  // proper Beaux-Arts pediment.
  const pedY = 0.06 + centralH * 0.85;       // base of the pediment
  const pedZ = mansionBackZ + mansionDepth / 2 + 0.05;
  // 1. Base entablature.
  const pedBase = new BoxGeometry(0.85, 0.04, 0.07);
  pedBase.translate(cx, pedY, pedZ + 0.05);
  out.push({ geom: pedBase, color: MM_LIMESTONE_DEEP });
  // 2. Tympanum (triangular wall behind the gable). Uses a 4-segment
  //    cone scaled thin in Z so it reads as a triangular slab from the
  //    front face. No rotation drama — the cone's natural apex-up
  //    orientation IS the pediment shape.
  const tympanum = new ConeGeometry(0.42, 0.20, 4);
  tympanum.rotateY(Math.PI / 4);   // align flat face to front
  tympanum.scale(1.0, 1.0, 0.18);  // squash in Z so it's a thin slab
  tympanum.translate(cx, pedY + 0.10, pedZ);
  out.push({ geom: tympanum, color: MM_LIMESTONE_DEEP });
  // 3-4. Two angled roof slabs forming the gable apex, in the darker
  //      slate-gable colour so the silhouette reads.
  const slopeLen = Math.hypot(0.40, 0.20);
  const slopeAngle = Math.atan2(0.20, 0.40);
  const leftSlope = new BoxGeometry(slopeLen, 0.04, 0.09);
  leftSlope.rotateZ(slopeAngle);
  leftSlope.translate(cx - 0.20, pedY + 0.10, pedZ + 0.005);
  out.push({ geom: leftSlope, color: MM_ROOF_GABLE });
  const rightSlope = new BoxGeometry(slopeLen, 0.04, 0.09);
  rightSlope.rotateZ(-slopeAngle);
  rightSlope.translate(cx + 0.20, pedY + 0.10, pedZ + 0.005);
  out.push({ geom: rightSlope, color: MM_ROOF_GABLE });
  // Gold escutcheon in the centre of the tympanum.
  const escutcheon = new BoxGeometry(0.10, 0.07, 0.022);
  escutcheon.translate(cx, pedY + 0.10, pedZ + 0.07);
  out.push({ geom: escutcheon, color: MM_GOLD_TRIM });

  // ===== PORTICO COLUMNS (6 columns supporting the pediment) =====
  // Tall slim cylinders running from podium to under the entablature.
  const colY = 0.06 + 0.45;
  const colH = 0.85;
  for (let i = 0; i < 6; i++) {
    const colX = -0.40 + i * (0.80 / 5);
    const col = new CylinderGeometry(0.025, 0.030, colH, 8);
    col.translate(cx + colX, colY, mansionBackZ + mansionDepth / 2 + 0.12);
    out.push({ geom: col, color: MM_LIMESTONE });
    // Capital (top of column).
    const cap = new BoxGeometry(0.08, 0.025, 0.08);
    cap.translate(cx + colX, colY + colH / 2 + 0.013, mansionBackZ + mansionDepth / 2 + 0.12);
    out.push({ geom: cap, color: MM_LIMESTONE_DEEP });
    // Base (bottom of column).
    const cBase = new BoxGeometry(0.08, 0.025, 0.08);
    cBase.translate(cx + colX, colY - colH / 2 - 0.013, mansionBackZ + mansionDepth / 2 + 0.12);
    out.push({ geom: cBase, color: MM_LIMESTONE_DEEP });
  }
  // Entablature above the columns (slim slab connecting their tops).
  const entablature = new BoxGeometry(0.95, 0.07, 0.08);
  entablature.translate(cx, colY + colH / 2 + 0.05, mansionBackZ + mansionDepth / 2 + 0.12);
  out.push({ geom: entablature, color: MM_LIMESTONE_DEEP });

  // ===== GRAND DOOR (centred under the portico) =====
  const door = new BoxGeometry(0.18, 0.40, 0.025);
  door.translate(cx, 0.06 + 0.22, mansionBackZ + mansionDepth / 2 + 0.005);
  out.push({ geom: door, color: MM_DOOR_DARK });
  // Door arch (rounded top — half cone).
  const doorArch = new ConeGeometry(0.10, 0.06, 12);
  doorArch.translate(cx, 0.06 + 0.45, mansionBackZ + mansionDepth / 2 + 0.005);
  out.push({ geom: doorArch, color: MM_LIMESTONE_DEEP });
  // Gold door handle.
  const handle = new BoxGeometry(0.020, 0.020, 0.030);
  handle.translate(cx + 0.06, 0.06 + 0.22, mansionBackZ + mansionDepth / 2 + 0.020);
  out.push({ geom: handle, color: MM_GOLD_TRIM });

  // ===== CENTRAL BLOCK WINDOWS (story 2 + 3, flanking the pediment) =====
  // Story 2 has 2 windows (one each side of the pediment area).
  // Story 3 has 4 windows in a row (above the pediment).
  for (const wxOff of [-0.34, 0.34]) {
    const win = new BoxGeometry(0.10, 0.22, 0.022);
    win.translate(cx + wxOff, 0.06 + 0.55, mansionBackZ + mansionDepth / 2 + 0.005);
    out.push({ geom: win, color: MM_WINDOW_DARK });
    const sL = new BoxGeometry(0.05, 0.22, 0.018);
    sL.translate(cx + wxOff - 0.085, 0.06 + 0.55, mansionBackZ + mansionDepth / 2 + 0.007);
    out.push({ geom: sL, color: MM_SHUTTER });
    const sR = new BoxGeometry(0.05, 0.22, 0.018);
    sR.translate(cx + wxOff + 0.085, 0.06 + 0.55, mansionBackZ + mansionDepth / 2 + 0.007);
    out.push({ geom: sR, color: MM_SHUTTER });
  }
  // Story 3 — top floor row of round-topped windows above pediment.
  for (const wxOff of [-0.30, -0.10, 0.10, 0.30]) {
    const win = new BoxGeometry(0.08, 0.14, 0.022);
    win.translate(cx + wxOff, 0.06 + 0.95, mansionBackZ + mansionDepth / 2 + 0.005);
    out.push({ geom: win, color: MM_WINDOW_DARK });
  }

  // ===== DOME on top of the central block =====
  // Drum (cylindrical base for the dome).
  const drum = new CylinderGeometry(0.20, 0.22, 0.10, 16);
  drum.translate(cx, 0.06 + centralH + 0.16, mansionBackZ);
  out.push({ geom: drum, color: MM_LIMESTONE });
  // Decorative columns around the drum.
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const px = Math.cos(angle) * 0.205;
    const pz = Math.sin(angle) * 0.205;
    const drumCol = new CylinderGeometry(0.012, 0.012, 0.10, 6);
    drumCol.translate(cx + px, 0.06 + centralH + 0.16, mansionBackZ + pz);
    out.push({ geom: drumCol, color: MM_LIMESTONE_DEEP });
  }
  // Dome itself — half-sphere via cone with many segments, topped by spire.
  const dome = new ConeGeometry(0.20, 0.30, 16);
  dome.translate(cx, 0.06 + centralH + 0.36, mansionBackZ);
  out.push({ geom: dome, color: MM_DOME_COPPER });
  // Lantern cupola at the top of the dome.
  const cupolaBase = new CylinderGeometry(0.05, 0.06, 0.08, 8);
  cupolaBase.translate(cx, 0.06 + centralH + 0.55, mansionBackZ);
  out.push({ geom: cupolaBase, color: MM_LIMESTONE });
  const cupolaTop = new ConeGeometry(0.06, 0.10, 8);
  cupolaTop.translate(cx, 0.06 + centralH + 0.64, mansionBackZ);
  out.push({ geom: cupolaTop, color: MM_DOME_COPPER });
  // Spire above the cupola.
  const spire = new CylinderGeometry(0.012, 0.012, 0.18, 5);
  spire.translate(cx, 0.06 + centralH + 0.78, mansionBackZ);
  out.push({ geom: spire, color: MM_GOLD_TRIM });
  // Gold ball finial on top.
  const ballFinial = new ConeGeometry(0.040, 0.07, 6);
  ballFinial.rotateX(Math.PI);
  ballFinial.translate(cx, 0.06 + centralH + 0.91, mansionBackZ);
  out.push({ geom: ballFinial, color: MM_GOLD_TRIM });

  // ===== ORNAMENTAL TREES in the back corners (behind wings) =====
  for (const tx of [-1.75, 1.75]) {
    // Shadow disc (Alpha 4.4) — slim dark-green octagonal pad under
    // the tree at the estate-pad surface. Matches the Alpha 2.6 polish
    // for forest tiles; extends shadow treatment to every tree-shaped
    // emission in the game.
    const shadow = new CylinderGeometry(0.34, 0.30, 0.005, 8);
    shadow.translate(cx + tx + 0.04, 0.030, mz - 0.27);
    out.push({ geom: shadow, color: 0x2a3a22 });
    const trunk = new CylinderGeometry(0.05, 0.06, 0.30, 6);
    trunk.translate(cx + tx, 0.18, mz - 0.30);
    out.push({ geom: trunk, color: MM_TREE_TRUNK });
    const foliage = new ConeGeometry(0.30, 0.65, 8);
    foliage.translate(cx + tx, 0.65, mz - 0.30);
    out.push({ geom: foliage, color: MM_TREE_LEAF });
    // Second smaller blob for a fuller crown.
    const blob = new ConeGeometry(0.20, 0.40, 8);
    blob.translate(cx + tx + 0.10, 0.85, mz - 0.20);
    out.push({ geom: blob, color: MM_TREE_LEAF });
  }

  return out;
}

/* ============================================================================
 * Civic monuments (Alpha 4.12)
 *
 * Three escalating one-per-city showpiece builds. Each is anchored at the
 * lex-smallest tile of its footprint (ax, ay) and emits the entire merged
 * geometry from that single dispatch site — same pattern as the Mayor's
 * Mansion. The visible footprint is sized so each step up reads as more
 * grand than the last:
 *
 *   City Hall            5 × 3   stately Beaux-Arts limestone, copper dome
 *   Provincial Capital   6 × 4   Queens Park (Toronto) influence, pink sandstone
 *   National Capital     7 × 4   Centre Block (Ottawa) influence, peace tower
 *
 * Each emits the building proper occupying the back ~1.2 tiles of the
 * footprint plus formal grounds (lawn, parterre, plaza, steps, statues,
 * lamposts) across the rest. Conventions match the mansion code:
 *   - World coords: TILE_SIZE = 1; centre X = ax + W/2; centre Z = ay + D/2
 *   - All geometries are translated into world position before push
 *   - Materials are flat-shaded via the global mergeGeoms pass (no normals)
 *   - Anchor (ax, ay) is the lex-smallest tile of the footprint
 * ========================================================================= */

// Shared palette — limestone + copper + bronze read as "civic monument" without
// needing a per-build palette. The provincial / national variants override
// the limestone tone (provincial = pink sandstone, national = grey Nepean
// sandstone) for visual identity.
const CH_LIMESTONE = 0xe8ddc6;
const CH_LIMESTONE_SHADOW = 0xb8a984;
const CH_LIMESTONE_DEEP = 0x8e7e60;
const CH_COPPER_GREEN = 0x4f9979;
const CH_COPPER_GREEN_DEEP = 0x3a7a5a;
const CH_GOLD = 0xd9b25a;
const CH_GOLD_BRIGHT = 0xeac96d;
const CH_DARK_WINDOW = 0x1e2632;
const CH_SLATE = 0x47525e;
const CH_LAWN = 0x4a7d3e;
const CH_PATH = 0xc9bfa1;
const CH_BRONZE = 0x8c6a3a;
const CH_LAMPPOST = 0x1c232b;
const CH_LAMP_BULB = 0xf2cd5c;
const CH_RED_FLAG = 0xc94343;
const CH_BLUE_FLAG = 0x3a5fa6;
const CH_HEDGE = 0x2f6a2d;
const CH_TREE_TRUNK = 0x6e3e1d;
const CH_TREE_LEAF = 0x2f6a2d;
// Provincial Capital — Queens Park's distinctive warm pink-orange sandstone.
const PC_SANDSTONE = 0xc89a7a;
const PC_SANDSTONE_SHADOW = 0x9c7458;
const PC_SANDSTONE_DEEP = 0x6e4d35;
const PC_SLATE_ROOF = 0x4a3a3a;
const PC_ROOF_DARK = 0x2f2422;
// National Capital — Centre Block's Nepean sandstone (cool grey-buff).
const NC_SANDSTONE = 0xbab09a;
const NC_SANDSTONE_SHADOW = 0x877e6a;
const NC_SANDSTONE_DEEP = 0x5a5448;
const NC_COPPER_ROOF = 0x4f9979;
const NC_COPPER_DEEP = 0x3a7a5a;
const NC_RED_DOOR = 0x8a3a2a;

/**
 * City Hall (Alpha 4.12). 5×3 footprint, Beaux-Arts composition.
 *
 * Layout (looking south, ax = west edge, ay = north edge):
 *
 *   ROW 0 (back, z = ay+0):  main building — 5 modules wide × ~0.7 deep
 *     [ W-PAVILION ] [ W-WING ] [ CENTRAL BLOCK + ROTUNDA + DOME ] [ E-WING ] [ E-PAVILION ]
 *
 *   ROW 1 (mid):             grand portico extending forward from centre,
 *                            flanking parterre gardens on both sides
 *
 *   ROW 2 (front):           ceremonial plaza + grand staircase down to
 *                            the street + flagpoles + fountain
 *
 * The user spec is explicit: more detail than the mansion, "modular"
 * meaning the building reads as five distinct modules (the SimCity 4 -
 * style civic composition pattern), with "bigger tiles" of geometry —
 * the central block and its dome are deliberately oversized for
 * monumental presence.
 */
export function buildCityHallParts(ax: number, ay: number): VariantPart[] {
  const out: VariantPart[] = [];
  // Footprint = 5 × 3. Centres:
  const cx = ax + 2.5;
  const cz = ay + 1.5;
  // Per-row centres:
  const bz = ay + 0.5;     // back-row (building) centre
  const mz = ay + 1.5;     // mid-row centre (portico + flanking parterres)
  const fz = ay + 2.5;     // front-row centre (ceremonial plaza)

  // ===== ESTATE PAD (entire 5×3 footprint) =====
  // Subtle limestone-tinted plinth that lifts the whole composition
  // off the natural terrain by 0.03. Marks the property line.
  const estatePad = new BoxGeometry(4.95, 0.025, 2.95);
  estatePad.translate(cx, 0.0125, cz);
  out.push({ geom: estatePad, color: CH_LIMESTONE_DEEP });
  // Front lawn rectangles flanking the ceremonial plaza.
  for (const dx of [-1.55, 1.55]) {
    const lawn = new BoxGeometry(1.75, 0.018, 1.85);
    lawn.translate(cx + dx, 0.024, fz - 0.05);
    out.push({ geom: lawn, color: CH_LAWN });
  }
  // Ceremonial central plaza — light flagstone strip from south edge
  // running to the grand stairs.
  const centralPath = new BoxGeometry(1.30, 0.022, 1.95);
  centralPath.translate(cx, 0.028, fz);
  out.push({ geom: centralPath, color: CH_PATH });
  // Flanking-parterre lawns either side of the portico (row 1).
  for (const dx of [-1.55, 1.55]) {
    const parterre = new BoxGeometry(1.75, 0.018, 0.92);
    parterre.translate(cx + dx, 0.024, mz - 0.03);
    out.push({ geom: parterre, color: CH_LAWN });
  }

  // ===== PERIMETER BALUSTRADE =====
  // Low stone wall around the whole footprint, broken at the front
  // centre by the ceremonial gate opening.
  const frontWallLeft = new BoxGeometry(1.85, 0.10, 0.06);
  frontWallLeft.translate(cx - 1.55, 0.07, cz + 1.47);
  out.push({ geom: frontWallLeft, color: CH_LIMESTONE });
  const frontWallRight = new BoxGeometry(1.85, 0.10, 0.06);
  frontWallRight.translate(cx + 1.55, 0.07, cz + 1.47);
  out.push({ geom: frontWallRight, color: CH_LIMESTONE });
  const backWall = new BoxGeometry(4.95, 0.10, 0.06);
  backWall.translate(cx, 0.07, cz - 1.47);
  out.push({ geom: backWall, color: CH_LIMESTONE });
  const eastWall = new BoxGeometry(0.06, 0.10, 2.95);
  eastWall.translate(cx + 2.47, 0.07, cz);
  out.push({ geom: eastWall, color: CH_LIMESTONE });
  const westWall = new BoxGeometry(0.06, 0.10, 2.95);
  westWall.translate(cx - 2.47, 0.07, cz);
  out.push({ geom: westWall, color: CH_LIMESTONE });
  // Six corner / gate posts with gold-finial caps.
  const cornerPosts: Array<[number, number]> = [
    [-2.47, -1.47], [2.47, -1.47],
    [-2.47,  1.47], [2.47,  1.47],
    [-0.65,  1.47], [0.65,  1.47]   // gate posts flanking the front opening
  ];
  for (const [px, pz] of cornerPosts) {
    const post = new BoxGeometry(0.10, 0.22, 0.10);
    post.translate(cx + px, 0.11, cz + pz);
    out.push({ geom: post, color: CH_LIMESTONE });
    const finial = new ConeGeometry(0.06, 0.10, 4);
    finial.translate(cx + px, 0.27, cz + pz);
    out.push({ geom: finial, color: CH_GOLD });
  }

  // ===== MAIN BUILDING (back row) =====
  // The "modular" composition — five distinct blocks read across the
  // facade: west pavilion → west wing → grand central block → east
  // wing → east pavilion.
  const buildingDepth = 0.80;
  const buildingZ = bz + 0.05;   // pushed slightly forward of back wall
  const buildingFrontZ = buildingZ + buildingDepth / 2;
  const baseY = 0.05;            // top of estate pad

  // --- WEST PAVILION (block 1) ---
  const wPavBody = new BoxGeometry(0.75, 0.85, buildingDepth);
  wPavBody.translate(cx - 1.85, baseY + 0.85 / 2, buildingZ);
  out.push({ geom: wPavBody, color: CH_LIMESTONE });
  // Pavilion mansard roof
  const wPavRoof = new BoxGeometry(0.85, 0.18, buildingDepth + 0.10);
  wPavRoof.translate(cx - 1.85, baseY + 0.85 + 0.09, buildingZ);
  out.push({ geom: wPavRoof, color: CH_SLATE });
  // Pavilion gabled top
  const wPavGable = new ConeGeometry(0.42, 0.18, 4);
  wPavGable.rotateY(Math.PI / 4);
  wPavGable.translate(cx - 1.85, baseY + 0.85 + 0.18 + 0.09, buildingZ);
  out.push({ geom: wPavGable, color: CH_SLATE });
  // Pavilion windows — 3 arched on the south face.
  for (const wxOff of [-0.18, 0, 0.18]) {
    for (let story = 0; story < 2; story++) {
      const win = new BoxGeometry(0.10, 0.18, 0.012);
      win.translate(cx - 1.85 + wxOff, baseY + 0.18 + story * 0.35, buildingFrontZ + 0.006);
      out.push({ geom: win, color: CH_DARK_WINDOW });
    }
  }

  // --- WEST WING (block 2) ---
  const wWingBody = new BoxGeometry(1.05, 0.75, buildingDepth);
  wWingBody.translate(cx - 1.05, baseY + 0.75 / 2, buildingZ);
  out.push({ geom: wWingBody, color: CH_LIMESTONE });
  // Wing roof — flat with cornice line.
  const wWingCornice = new BoxGeometry(1.12, 0.06, buildingDepth + 0.05);
  wWingCornice.translate(cx - 1.05, baseY + 0.75 + 0.03, buildingZ);
  out.push({ geom: wWingCornice, color: CH_LIMESTONE_SHADOW });
  // Arched windows across the wing — 4 tall arched openings.
  for (const wxOff of [-0.36, -0.12, 0.12, 0.36]) {
    // Pilaster between windows
    const pilaster = new BoxGeometry(0.05, 0.65, 0.025);
    pilaster.translate(cx - 1.05 + wxOff - 0.12, baseY + 0.36, buildingFrontZ + 0.013);
    out.push({ geom: pilaster, color: CH_LIMESTONE_SHADOW });
    // Window pane (arched top approximated by tall rectangle + tiny half-disc cap)
    const win = new BoxGeometry(0.12, 0.32, 0.012);
    win.translate(cx - 1.05 + wxOff, baseY + 0.36, buildingFrontZ + 0.007);
    out.push({ geom: win, color: CH_DARK_WINDOW });
    // Arched cap
    const arch = new CylinderGeometry(0.06, 0.06, 0.012, 8, 1, false, 0, Math.PI);
    arch.rotateX(Math.PI / 2);
    arch.rotateZ(-Math.PI / 2);
    arch.translate(cx - 1.05 + wxOff, baseY + 0.55, buildingFrontZ + 0.008);
    out.push({ geom: arch, color: CH_DARK_WINDOW });
  }

  // --- CENTRAL BLOCK (block 3) — the showpiece ---
  // Two storeys tall + rotunda + dome stack on top.
  const ccBlockH = 1.05;
  const ccBlock = new BoxGeometry(1.30, ccBlockH, buildingDepth);
  ccBlock.translate(cx, baseY + ccBlockH / 2, buildingZ);
  out.push({ geom: ccBlock, color: CH_LIMESTONE });
  // Entablature band running around the top of the central block.
  const entablature = new BoxGeometry(1.45, 0.08, buildingDepth + 0.08);
  entablature.translate(cx, baseY + ccBlockH + 0.04, buildingZ);
  out.push({ geom: entablature, color: CH_LIMESTONE_SHADOW });
  // Pediment over the front portico — classical triangular gable.
  const pediment = new ConeGeometry(0.55, 0.28, 3);
  pediment.rotateY(Math.PI / 2);
  pediment.scale(1.0, 1.0, 0.5);
  pediment.translate(cx, baseY + ccBlockH + 0.08 + 0.14, buildingFrontZ + 0.30);
  out.push({ geom: pediment, color: CH_LIMESTONE });
  // Gold escutcheon on the pediment
  const escutcheon = new BoxGeometry(0.20, 0.10, 0.020);
  escutcheon.translate(cx, baseY + ccBlockH + 0.10, buildingFrontZ + 0.32);
  out.push({ geom: escutcheon, color: CH_GOLD });

  // 6-column grand portico under the pediment
  const porticoZ = buildingFrontZ + 0.30;
  for (const colX of [-0.55, -0.33, -0.11, 0.11, 0.33, 0.55]) {
    // Column shaft
    const shaft = new CylinderGeometry(0.05, 0.055, 0.95, 8);
    shaft.translate(cx + colX, baseY + 0.475, porticoZ);
    out.push({ geom: shaft, color: CH_LIMESTONE });
    // Capital (Doric)
    const cap = new BoxGeometry(0.13, 0.05, 0.13);
    cap.translate(cx + colX, baseY + 0.95 + 0.025, porticoZ);
    out.push({ geom: cap, color: CH_LIMESTONE_SHADOW });
    // Base
    const cbase = new BoxGeometry(0.13, 0.04, 0.13);
    cbase.translate(cx + colX, baseY + 0.02, porticoZ);
    out.push({ geom: cbase, color: CH_LIMESTONE_SHADOW });
  }
  // Portico roof slab spanning the columns
  const porticoRoof = new BoxGeometry(1.30, 0.06, 0.18);
  porticoRoof.translate(cx, baseY + 1.00 + 0.03, porticoZ);
  out.push({ geom: porticoRoof, color: CH_LIMESTONE_SHADOW });

  // Grand arched main entrance behind the columns
  const doorBody = new BoxGeometry(0.32, 0.50, 0.025);
  doorBody.translate(cx, baseY + 0.27, buildingFrontZ + 0.013);
  out.push({ geom: doorBody, color: 0x4a2e1f });   // mahogany
  const doorArch = new CylinderGeometry(0.16, 0.16, 0.025, 10, 1, false, 0, Math.PI);
  doorArch.rotateX(Math.PI / 2);
  doorArch.rotateZ(-Math.PI / 2);
  doorArch.translate(cx, baseY + 0.55, buildingFrontZ + 0.013);
  out.push({ geom: doorArch, color: 0x4a2e1f });
  // Stone arch frame around the door
  const archFrame = new CylinderGeometry(0.20, 0.20, 0.018, 12, 1, false, 0, Math.PI);
  archFrame.rotateX(Math.PI / 2);
  archFrame.rotateZ(-Math.PI / 2);
  archFrame.translate(cx, baseY + 0.55, buildingFrontZ + 0.020);
  out.push({ geom: archFrame, color: CH_LIMESTONE_SHADOW });

  // ROTUNDA — circular drum sitting on the central block
  const rotundaH = 0.55;
  const rotunda = new CylinderGeometry(0.45, 0.45, rotundaH, 18);
  rotunda.translate(cx, baseY + ccBlockH + 0.08 + rotundaH / 2, buildingZ);
  out.push({ geom: rotunda, color: CH_LIMESTONE });
  // Rotunda colonnade — 12 small columns around the perimeter
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const rcx = Math.cos(angle) * 0.42;
    const rcz = Math.sin(angle) * 0.42;
    const rcol = new CylinderGeometry(0.025, 0.025, rotundaH - 0.06, 6);
    rcol.translate(cx + rcx, baseY + ccBlockH + 0.08 + rotundaH / 2, buildingZ + rcz);
    out.push({ geom: rcol, color: CH_LIMESTONE_SHADOW });
  }
  // Rotunda entablature
  const rotundaCap = new CylinderGeometry(0.50, 0.50, 0.06, 18);
  rotundaCap.translate(cx, baseY + ccBlockH + 0.08 + rotundaH + 0.03, buildingZ);
  out.push({ geom: rotundaCap, color: CH_LIMESTONE_SHADOW });
  // DOME — copper-green hemisphere on the rotunda
  const dome = new CylinderGeometry(0.05, 0.45, 0.45, 18);  // truncated cone approximating dome
  dome.translate(cx, baseY + ccBlockH + 0.08 + rotundaH + 0.06 + 0.225, buildingZ);
  out.push({ geom: dome, color: CH_COPPER_GREEN });
  // Dome ribs — slim copper-deep meridians for definition
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const rib = new BoxGeometry(0.012, 0.46, 0.012);
    rib.translate(
      cx + Math.cos(angle) * 0.25,
      baseY + ccBlockH + 0.08 + rotundaH + 0.06 + 0.225,
      buildingZ + Math.sin(angle) * 0.25
    );
    rib.rotateY(angle);
    out.push({ geom: rib, color: CH_COPPER_GREEN_DEEP });
  }
  // Lantern atop the dome — small white-stone cupola with clock faces
  const lanternY = baseY + ccBlockH + 0.08 + rotundaH + 0.06 + 0.45;
  const lantern = new CylinderGeometry(0.10, 0.12, 0.18, 8);
  lantern.translate(cx, lanternY + 0.09, buildingZ);
  out.push({ geom: lantern, color: CH_LIMESTONE });
  // Four clock faces on the lantern (N/E/S/W)
  for (const [fx, fz] of [[0, 0.11], [0.11, 0], [0, -0.11], [-0.11, 0]] as Array<[number, number]>) {
    const clockFace = new CylinderGeometry(0.055, 0.055, 0.008, 12);
    clockFace.rotateX(Math.PI / 2);
    if (fx !== 0) clockFace.rotateY(Math.PI / 2);
    clockFace.translate(cx + fx, lanternY + 0.10, buildingZ + fz);
    out.push({ geom: clockFace, color: 0xf0e8d0 });
    // Hour hand
    const hourHand = new BoxGeometry(0.030, 0.006, 0.003);
    if (fx !== 0) hourHand.rotateY(Math.PI / 2);
    hourHand.translate(cx + fx, lanternY + 0.10, buildingZ + fz + (fz > 0 ? 0.005 : -0.005));
    out.push({ geom: hourHand, color: CH_DARK_WINDOW });
  }
  // Cupola roof — small copper cone
  const cupolaRoof = new ConeGeometry(0.13, 0.16, 8);
  cupolaRoof.translate(cx, lanternY + 0.18 + 0.08, buildingZ);
  out.push({ geom: cupolaRoof, color: CH_COPPER_GREEN_DEEP });
  // Gold ball finial
  const finialBall = new IcosahedronGeometry(0.04, 1);
  finialBall.translate(cx, lanternY + 0.30, buildingZ);
  out.push({ geom: finialBall, color: CH_GOLD_BRIGHT });
  // Flagpole
  const flagpole = new CylinderGeometry(0.008, 0.008, 0.35, 5);
  flagpole.translate(cx, lanternY + 0.46, buildingZ);
  out.push({ geom: flagpole, color: 0xb8b8b8 });
  // Flag
  const flag = new BoxGeometry(0.16, 0.10, 0.005);
  flag.translate(cx + 0.08, lanternY + 0.56, buildingZ);
  out.push({ geom: flag, color: CH_RED_FLAG });

  // --- EAST WING (block 4) — mirror of west wing ---
  const eWingBody = new BoxGeometry(1.05, 0.75, buildingDepth);
  eWingBody.translate(cx + 1.05, baseY + 0.75 / 2, buildingZ);
  out.push({ geom: eWingBody, color: CH_LIMESTONE });
  const eWingCornice = new BoxGeometry(1.12, 0.06, buildingDepth + 0.05);
  eWingCornice.translate(cx + 1.05, baseY + 0.75 + 0.03, buildingZ);
  out.push({ geom: eWingCornice, color: CH_LIMESTONE_SHADOW });
  for (const wxOff of [-0.36, -0.12, 0.12, 0.36]) {
    const pilaster = new BoxGeometry(0.05, 0.65, 0.025);
    pilaster.translate(cx + 1.05 + wxOff - 0.12, baseY + 0.36, buildingFrontZ + 0.013);
    out.push({ geom: pilaster, color: CH_LIMESTONE_SHADOW });
    const win = new BoxGeometry(0.12, 0.32, 0.012);
    win.translate(cx + 1.05 + wxOff, baseY + 0.36, buildingFrontZ + 0.007);
    out.push({ geom: win, color: CH_DARK_WINDOW });
    const arch = new CylinderGeometry(0.06, 0.06, 0.012, 8, 1, false, 0, Math.PI);
    arch.rotateX(Math.PI / 2);
    arch.rotateZ(-Math.PI / 2);
    arch.translate(cx + 1.05 + wxOff, baseY + 0.55, buildingFrontZ + 0.008);
    out.push({ geom: arch, color: CH_DARK_WINDOW });
  }

  // --- EAST PAVILION (block 5) — mirror of west pavilion ---
  const ePavBody = new BoxGeometry(0.75, 0.85, buildingDepth);
  ePavBody.translate(cx + 1.85, baseY + 0.85 / 2, buildingZ);
  out.push({ geom: ePavBody, color: CH_LIMESTONE });
  const ePavRoof = new BoxGeometry(0.85, 0.18, buildingDepth + 0.10);
  ePavRoof.translate(cx + 1.85, baseY + 0.85 + 0.09, buildingZ);
  out.push({ geom: ePavRoof, color: CH_SLATE });
  const ePavGable = new ConeGeometry(0.42, 0.18, 4);
  ePavGable.rotateY(Math.PI / 4);
  ePavGable.translate(cx + 1.85, baseY + 0.85 + 0.18 + 0.09, buildingZ);
  out.push({ geom: ePavGable, color: CH_SLATE });
  for (const wxOff of [-0.18, 0, 0.18]) {
    for (let story = 0; story < 2; story++) {
      const win = new BoxGeometry(0.10, 0.18, 0.012);
      win.translate(cx + 1.85 + wxOff, baseY + 0.18 + story * 0.35, buildingFrontZ + 0.006);
      out.push({ geom: win, color: CH_DARK_WINDOW });
    }
  }

  // ===== GRAND STAIRCASE (middle row, leading from portico to plaza) =====
  // Four wide steps cascading down. Each step is wider than the last
  // visually, but here we render as a stack of slightly receding boxes.
  for (let i = 0; i < 4; i++) {
    const stepW = 1.30 + i * 0.15;
    const stepZ = mz - 0.55 + i * 0.18;
    const stepY = baseY - i * 0.012;
    const step = new BoxGeometry(stepW, 0.05, 0.18);
    step.translate(cx, Math.max(0.035, stepY + 0.025), stepZ);
    out.push({ geom: step, color: CH_LIMESTONE_SHADOW });
  }
  // Stair flanking railings
  for (const dx of [-0.85, 0.85]) {
    const rail = new BoxGeometry(0.08, 0.30, 0.72);
    rail.translate(cx + dx, baseY + 0.15, mz - 0.20);
    out.push({ geom: rail, color: CH_LIMESTONE });
    // Cap finial
    const railCap = new ConeGeometry(0.05, 0.08, 4);
    railCap.translate(cx + dx, baseY + 0.34, mz - 0.20);
    out.push({ geom: railCap, color: CH_GOLD });
  }

  // ===== FLANKING PARTERRE GARDENS (mid row) =====
  // Two formal gardens flanking the portico: each is a 1.5×0.85 lawn pad
  // with a hedge cross + flower-spot quadrants + topiary cone corners.
  for (const dx of [-1.55, 1.55]) {
    // Hedge cross
    const hedgeNS = new BoxGeometry(0.08, 0.10, 0.80);
    hedgeNS.translate(cx + dx, baseY + 0.07, mz - 0.03);
    out.push({ geom: hedgeNS, color: CH_HEDGE });
    const hedgeEW = new BoxGeometry(0.90, 0.10, 0.08);
    hedgeEW.translate(cx + dx, baseY + 0.07, mz - 0.03);
    out.push({ geom: hedgeEW, color: CH_HEDGE });
    // Topiary cones at each corner of the parterre
    for (const [qx, qz] of [[-0.55, -0.30], [0.55, -0.30], [-0.55, 0.30], [0.55, 0.30]] as Array<[number, number]>) {
      const topiary = new ConeGeometry(0.10, 0.22, 6);
      topiary.translate(cx + dx + qx, baseY + 0.11, mz - 0.03 + qz);
      out.push({ geom: topiary, color: CH_HEDGE });
    }
    // Flower-spot quadrants
    for (const [fx, fz] of [[-0.25, -0.18], [0.25, -0.18], [-0.25, 0.18], [0.25, 0.18]] as Array<[number, number]>) {
      const flower = new BoxGeometry(0.18, 0.022, 0.18);
      flower.translate(cx + dx + fx, baseY + 0.012, mz - 0.03 + fz);
      out.push({ geom: flower, color: 0xd84545 });
    }
  }

  // ===== FRONT FOUNTAIN (front row centre) =====
  // Circular limestone basin with central plinth and gold jet.
  const fountainBasin = new CylinderGeometry(0.32, 0.32, 0.10, 18);
  fountainBasin.translate(cx, baseY + 0.05, fz - 0.20);
  out.push({ geom: fountainBasin, color: CH_LIMESTONE });
  // Basin water
  const fountainWater = new CylinderGeometry(0.28, 0.28, 0.02, 18);
  fountainWater.translate(cx, baseY + 0.10, fz - 0.20);
  out.push({ geom: fountainWater, color: 0x6da8d6 });
  // Central plinth
  const fountainPlinth = new BoxGeometry(0.14, 0.20, 0.14);
  fountainPlinth.translate(cx, baseY + 0.20, fz - 0.20);
  out.push({ geom: fountainPlinth, color: CH_LIMESTONE_SHADOW });
  // Jet (gold cone, pointing up)
  const fountainJet = new ConeGeometry(0.05, 0.22, 8);
  fountainJet.translate(cx, baseY + 0.41, fz - 0.20);
  out.push({ geom: fountainJet, color: CH_GOLD_BRIGHT });

  // ===== FLANKING FLAGPOLES (front of staircase) =====
  for (const dx of [-1.10, 1.10]) {
    // Granite base
    const flagBase = new BoxGeometry(0.20, 0.10, 0.20);
    flagBase.translate(cx + dx, baseY + 0.05, fz - 0.55);
    out.push({ geom: flagBase, color: CH_LIMESTONE_SHADOW });
    // Pole
    const pole = new CylinderGeometry(0.018, 0.020, 0.85, 6);
    pole.translate(cx + dx, baseY + 0.52, fz - 0.55);
    out.push({ geom: pole, color: 0xb8b8b8 });
    // Flag
    const flagF = new BoxGeometry(0.22, 0.14, 0.005);
    flagF.translate(cx + dx + 0.11, baseY + 0.85, fz - 0.55);
    out.push({ geom: flagF, color: dx < 0 ? CH_RED_FLAG : CH_BLUE_FLAG });
    // Gold ball at pole top
    const poleBall = new IcosahedronGeometry(0.022, 1);
    poleBall.translate(cx + dx, baseY + 0.96, fz - 0.55);
    out.push({ geom: poleBall, color: CH_GOLD });
  }

  // ===== ORNAMENTAL LAMPPOSTS (six along the perimeter walls) =====
  const lampSpots: Array<[number, number]> = [
    [-2.25, -0.50], [2.25, -0.50],
    [-2.25,  0.70], [2.25,  0.70],
    [-2.25,  1.30], [2.25,  1.30]
  ];
  for (const [px, pz] of lampSpots) {
    // Cast-iron post
    const lampPost = new CylinderGeometry(0.020, 0.025, 0.45, 6);
    lampPost.translate(cx + px, baseY + 0.225, cz + pz);
    out.push({ geom: lampPost, color: CH_LAMPPOST });
    // Lamp housing
    const lampHouse = new BoxGeometry(0.08, 0.08, 0.08);
    lampHouse.translate(cx + px, baseY + 0.49, cz + pz);
    out.push({ geom: lampHouse, color: CH_LAMPPOST });
    // Bulb
    const bulb = new IcosahedronGeometry(0.035, 1);
    bulb.translate(cx + px, baseY + 0.49, cz + pz);
    out.push({ geom: bulb, color: CH_LAMP_BULB });
  }

  // ===== BRONZE STATUES (two on plinths flanking the central plaza) =====
  for (const dx of [-0.70, 0.70]) {
    // Granite plinth
    const sPlinth = new BoxGeometry(0.18, 0.20, 0.18);
    sPlinth.translate(cx + dx, baseY + 0.10, fz + 0.20);
    out.push({ geom: sPlinth, color: CH_LIMESTONE_SHADOW });
    // Bronze figure (simplified — torso + head, no limbs)
    const sBody = new BoxGeometry(0.06, 0.16, 0.05);
    sBody.translate(cx + dx, baseY + 0.28, fz + 0.20);
    out.push({ geom: sBody, color: CH_BRONZE });
    const sHead = new IcosahedronGeometry(0.030, 1);
    sHead.translate(cx + dx, baseY + 0.38, fz + 0.20);
    out.push({ geom: sHead, color: CH_BRONZE });
  }

  // ===== ORNAMENTAL TREES IN BACK CORNERS =====
  // Behind the building (back row, behind the pavilions).
  for (const tx of [-2.20, 2.20]) {
    const shadow = new CylinderGeometry(0.32, 0.28, 0.005, 8);
    shadow.translate(cx + tx + 0.04, 0.030, bz - 0.40);
    out.push({ geom: shadow, color: 0x2a3a22 });
    const trunk = new CylinderGeometry(0.05, 0.06, 0.30, 6);
    trunk.translate(cx + tx, 0.18, bz - 0.40);
    out.push({ geom: trunk, color: CH_TREE_TRUNK });
    const foliage = new ConeGeometry(0.28, 0.60, 8);
    foliage.translate(cx + tx, 0.62, bz - 0.40);
    out.push({ geom: foliage, color: CH_TREE_LEAF });
  }

  return out;
}

/**
 * Provincial Capital (Alpha 4.12). 6×4 footprint, Queens Park influence —
 * Romanesque Revival in pink-orange sandstone, distinctive central
 * arched main entrance, low central tower with copper cupola, twin
 * symmetrical wings ending in pyramidal-roofed pavilions.
 *
 * Layout (looking south, ax = west, ay = north):
 *   ROW 0 (back):  legislative building — 6 modules wide × 1 deep
 *   ROW 1:         main facade extension + central porte-cochère
 *   ROW 2:         broad ceremonial plaza + grand approach steps
 *   ROW 3 (front): formal lawn + flagpole row + perimeter wall
 */
export function buildProvincialCapitalParts(ax: number, ay: number): VariantPart[] {
  const out: VariantPart[] = [];
  const cx = ax + 3.0;
  const cz = ay + 2.0;
  const bz = ay + 0.55;   // back-row centre (building)
  const baseY = 0.05;

  // Estate pad covers entire 6×4 footprint
  const pad = new BoxGeometry(5.95, 0.025, 3.95);
  pad.translate(cx, 0.0125, cz);
  out.push({ geom: pad, color: PC_SANDSTONE_DEEP });
  // Front lawn (row 3)
  for (const dx of [-2.0, 2.0]) {
    const lawn = new BoxGeometry(1.55, 0.018, 0.92);
    lawn.translate(cx + dx, 0.024, ay + 3.5);
    out.push({ geom: lawn, color: CH_LAWN });
  }
  // Central paved approach
  const path = new BoxGeometry(1.50, 0.022, 2.50);
  path.translate(cx, 0.028, ay + 2.30);
  out.push({ geom: path, color: CH_PATH });
  // Side lawns rows 1-2
  for (const dx of [-2.0, 2.0]) {
    const sideLawn = new BoxGeometry(1.55, 0.018, 1.75);
    sideLawn.translate(cx + dx, 0.024, ay + 2.0);
    out.push({ geom: sideLawn, color: CH_LAWN });
  }

  // Perimeter wall — heavier than the city hall, no front gate break (the
  // gate is centred and slightly raised).
  const fwL = new BoxGeometry(2.35, 0.12, 0.07);
  fwL.translate(cx - 1.80, 0.08, cz + 1.97);
  out.push({ geom: fwL, color: PC_SANDSTONE });
  const fwR = new BoxGeometry(2.35, 0.12, 0.07);
  fwR.translate(cx + 1.80, 0.08, cz + 1.97);
  out.push({ geom: fwR, color: PC_SANDSTONE });
  const backW = new BoxGeometry(5.95, 0.12, 0.07);
  backW.translate(cx, 0.08, cz - 1.97);
  out.push({ geom: backW, color: PC_SANDSTONE });
  const eW = new BoxGeometry(0.07, 0.12, 3.95);
  eW.translate(cx + 2.97, 0.08, cz);
  out.push({ geom: eW, color: PC_SANDSTONE });
  const wW = new BoxGeometry(0.07, 0.12, 3.95);
  wW.translate(cx - 2.97, 0.08, cz);
  out.push({ geom: wW, color: PC_SANDSTONE });
  // Corner posts and gate piers
  for (const [px, pz] of [[-2.97, -1.97], [2.97, -1.97], [-2.97, 1.97], [2.97, 1.97], [-0.65, 1.97], [0.65, 1.97]] as Array<[number, number]>) {
    const post = new BoxGeometry(0.12, 0.26, 0.12);
    post.translate(cx + px, 0.13, cz + pz);
    out.push({ geom: post, color: PC_SANDSTONE_SHADOW });
    const finial = new ConeGeometry(0.07, 0.10, 4);
    finial.translate(cx + px, 0.31, cz + pz);
    out.push({ geom: finial, color: PC_SANDSTONE });
  }

  // ===== MAIN BUILDING — Queens Park composition =====
  // Five-block composition: west pavilion → west wing → CENTRAL block
  // (with arched entrance + low tower + cupola) → east wing → east
  // pavilion. The pavilions have Queens Park's distinctive tall
  // pyramidal slate roofs.
  const bdpth = 0.95;
  const bldgZ = bz - 0.08;
  const bldgFrontZ = bldgZ + bdpth / 2;

  // --- WEST END PAVILION ---
  // Sandstone block 0.95 wide × 0.95 tall + tall pyramidal roof.
  const wPavBody = new BoxGeometry(0.95, 0.95, bdpth);
  wPavBody.translate(cx - 2.50, baseY + 0.475, bldgZ);
  out.push({ geom: wPavBody, color: PC_SANDSTONE });
  // Cornice
  const wPavCornice = new BoxGeometry(1.05, 0.06, bdpth + 0.06);
  wPavCornice.translate(cx - 2.50, baseY + 0.95 + 0.03, bldgZ);
  out.push({ geom: wPavCornice, color: PC_SANDSTONE_SHADOW });
  // Tall pyramidal roof — Queens Park's signature
  const wPavRoof = new ConeGeometry(0.62, 0.65, 4);
  wPavRoof.rotateY(Math.PI / 4);
  wPavRoof.translate(cx - 2.50, baseY + 0.95 + 0.06 + 0.325, bldgZ);
  out.push({ geom: wPavRoof, color: PC_SLATE_ROOF });
  // Roof spike finial
  const wPavSpike = new CylinderGeometry(0.018, 0.022, 0.20, 6);
  wPavSpike.translate(cx - 2.50, baseY + 0.95 + 0.06 + 0.65 + 0.10, bldgZ);
  out.push({ geom: wPavSpike, color: CH_GOLD });
  // Windows on the pavilion (3 per face)
  for (const wxOff of [-0.25, 0, 0.25]) {
    for (let story = 0; story < 2; story++) {
      const win = new BoxGeometry(0.10, 0.20, 0.014);
      win.translate(cx - 2.50 + wxOff, baseY + 0.22 + story * 0.40, bldgFrontZ + 0.007);
      out.push({ geom: win, color: CH_DARK_WINDOW });
    }
  }

  // --- WEST WING ---
  const wWingBody = new BoxGeometry(1.10, 0.80, bdpth);
  wWingBody.translate(cx - 1.45, baseY + 0.40, bldgZ);
  out.push({ geom: wWingBody, color: PC_SANDSTONE });
  // Steep gabled roof along the wing's length
  const wWingRoof = new BoxGeometry(1.15, 0.20, bdpth + 0.04);
  wWingRoof.translate(cx - 1.45, baseY + 0.90, bldgZ);
  out.push({ geom: wWingRoof, color: PC_SLATE_ROOF });
  // Roof ridge
  const wWingRidge = new ConeGeometry(0.45, 0.18, 4);
  wWingRidge.rotateY(Math.PI / 4);
  wWingRidge.scale(0.40, 1.0, 1.30);   // long ridge
  wWingRidge.translate(cx - 1.45, baseY + 1.00 + 0.09, bldgZ);
  out.push({ geom: wWingRidge, color: PC_ROOF_DARK });
  // 6 arched windows on the front face
  for (const wxOff of [-0.45, -0.27, -0.09, 0.09, 0.27, 0.45]) {
    const pilaster = new BoxGeometry(0.045, 0.65, 0.025);
    pilaster.translate(cx - 1.45 + wxOff - 0.09, baseY + 0.36, bldgFrontZ + 0.013);
    out.push({ geom: pilaster, color: PC_SANDSTONE_SHADOW });
    const win = new BoxGeometry(0.09, 0.36, 0.012);
    win.translate(cx - 1.45 + wxOff, baseY + 0.38, bldgFrontZ + 0.007);
    out.push({ geom: win, color: CH_DARK_WINDOW });
    const arch = new CylinderGeometry(0.045, 0.045, 0.012, 8, 1, false, 0, Math.PI);
    arch.rotateX(Math.PI / 2);
    arch.rotateZ(-Math.PI / 2);
    arch.translate(cx - 1.45 + wxOff, baseY + 0.57, bldgFrontZ + 0.008);
    out.push({ geom: arch, color: CH_DARK_WINDOW });
  }

  // --- CENTRAL BLOCK (the signature Queens Park face) ---
  // Wider and slightly taller than the wings. Romanesque Revival —
  // huge arched main entrance, low central tower with pyramidal copper
  // cupola.
  const centerH = 1.10;
  const ccBody = new BoxGeometry(1.55, centerH, bdpth + 0.10);
  ccBody.translate(cx, baseY + centerH / 2, bldgZ + 0.05);
  out.push({ geom: ccBody, color: PC_SANDSTONE });
  // Entablature band
  const ccBand = new BoxGeometry(1.65, 0.08, bdpth + 0.18);
  ccBand.translate(cx, baseY + centerH + 0.04, bldgZ + 0.05);
  out.push({ geom: ccBand, color: PC_SANDSTONE_SHADOW });
  // Central tower — square block rising another 0.65 above
  const tower = new BoxGeometry(0.85, 0.65, 0.85);
  tower.translate(cx, baseY + centerH + 0.08 + 0.325, bldgZ + 0.05);
  out.push({ geom: tower, color: PC_SANDSTONE });
  // Arched windows on each tower face
  for (const [tdx, tdz] of [[0, 0.42], [0.42, 0], [0, -0.42], [-0.42, 0]] as Array<[number, number]>) {
    const towerWin = new BoxGeometry(tdx !== 0 ? 0.012 : 0.16, 0.30, tdx !== 0 ? 0.16 : 0.012);
    towerWin.translate(cx + tdx, baseY + centerH + 0.08 + 0.30, bldgZ + 0.05 + tdz);
    out.push({ geom: towerWin, color: CH_DARK_WINDOW });
  }
  // Tower cornice
  const towerBand = new BoxGeometry(0.92, 0.06, 0.92);
  towerBand.translate(cx, baseY + centerH + 0.08 + 0.65 + 0.03, bldgZ + 0.05);
  out.push({ geom: towerBand, color: PC_SANDSTONE_SHADOW });
  // Pyramidal copper cupola roof
  const cupola = new ConeGeometry(0.60, 0.50, 4);
  cupola.rotateY(Math.PI / 4);
  cupola.translate(cx, baseY + centerH + 0.08 + 0.65 + 0.06 + 0.25, bldgZ + 0.05);
  out.push({ geom: cupola, color: CH_COPPER_GREEN });
  // Cupola spike + gold ball
  const cupolaSpike = new CylinderGeometry(0.012, 0.018, 0.22, 6);
  cupolaSpike.translate(cx, baseY + centerH + 0.08 + 0.65 + 0.06 + 0.50 + 0.11, bldgZ + 0.05);
  out.push({ geom: cupolaSpike, color: CH_GOLD });
  const cupolaBall = new IcosahedronGeometry(0.040, 1);
  cupolaBall.translate(cx, baseY + centerH + 0.08 + 0.65 + 0.06 + 0.50 + 0.25, bldgZ + 0.05);
  out.push({ geom: cupolaBall, color: CH_GOLD_BRIGHT });
  // Flagpole + flag
  const cupolaPole = new CylinderGeometry(0.008, 0.008, 0.30, 5);
  cupolaPole.translate(cx, baseY + centerH + 0.08 + 0.65 + 0.06 + 0.50 + 0.40, bldgZ + 0.05);
  out.push({ geom: cupolaPole, color: 0xb8b8b8 });
  const provFlag = new BoxGeometry(0.18, 0.11, 0.005);
  provFlag.translate(cx + 0.09, baseY + centerH + 0.08 + 0.65 + 0.06 + 0.50 + 0.50, bldgZ + 0.05);
  out.push({ geom: provFlag, color: CH_RED_FLAG });

  // CENTRAL GRAND ARCHED ENTRANCE — Queens Park's signature feature.
  // A very large arched portal occupying the entire centre of the front
  // face. Approximate with a sandstone arched surround framing an inset
  // dark recess.
  const grandArchFrontZ = bldgZ + bdpth / 2 + 0.06 + 0.025;
  const grandArchOpening = new BoxGeometry(0.65, 0.70, 0.025);
  grandArchOpening.translate(cx, baseY + 0.35, grandArchFrontZ - 0.012);
  out.push({ geom: grandArchOpening, color: 0x2a1f18 });   // very dark recess
  // Arched cap above the opening
  const grandArchCap = new CylinderGeometry(0.32, 0.32, 0.025, 14, 1, false, 0, Math.PI);
  grandArchCap.rotateX(Math.PI / 2);
  grandArchCap.rotateZ(-Math.PI / 2);
  grandArchCap.translate(cx, baseY + 0.70, grandArchFrontZ - 0.012);
  out.push({ geom: grandArchCap, color: 0x2a1f18 });
  // Sandstone arch surround — voussoirs
  const grandArchSurround = new CylinderGeometry(0.38, 0.38, 0.030, 14, 1, false, 0, Math.PI);
  grandArchSurround.rotateX(Math.PI / 2);
  grandArchSurround.rotateZ(-Math.PI / 2);
  grandArchSurround.translate(cx, baseY + 0.70, grandArchFrontZ + 0.005);
  out.push({ geom: grandArchSurround, color: PC_SANDSTONE_SHADOW });
  // Keystone
  const keystone = new BoxGeometry(0.10, 0.16, 0.035);
  keystone.translate(cx, baseY + 0.86, grandArchFrontZ + 0.007);
  out.push({ geom: keystone, color: PC_SANDSTONE_SHADOW });
  // Flanking columns around the arch
  for (const dx of [-0.45, 0.45]) {
    const archCol = new CylinderGeometry(0.06, 0.07, 0.85, 8);
    archCol.translate(cx + dx, baseY + 0.425, grandArchFrontZ + 0.015);
    out.push({ geom: archCol, color: PC_SANDSTONE_SHADOW });
    // Capital
    const archCapDeco = new BoxGeometry(0.15, 0.05, 0.15);
    archCapDeco.translate(cx + dx, baseY + 0.875, grandArchFrontZ + 0.015);
    out.push({ geom: archCapDeco, color: PC_SANDSTONE_DEEP });
  }
  // Provincial crest in stone above the arch keystone
  const crest = new BoxGeometry(0.28, 0.16, 0.025);
  crest.translate(cx, baseY + 1.00, grandArchFrontZ + 0.012);
  out.push({ geom: crest, color: CH_GOLD });

  // --- EAST WING (mirror of west) ---
  const eWingBody = new BoxGeometry(1.10, 0.80, bdpth);
  eWingBody.translate(cx + 1.45, baseY + 0.40, bldgZ);
  out.push({ geom: eWingBody, color: PC_SANDSTONE });
  const eWingRoof = new BoxGeometry(1.15, 0.20, bdpth + 0.04);
  eWingRoof.translate(cx + 1.45, baseY + 0.90, bldgZ);
  out.push({ geom: eWingRoof, color: PC_SLATE_ROOF });
  const eWingRidge = new ConeGeometry(0.45, 0.18, 4);
  eWingRidge.rotateY(Math.PI / 4);
  eWingRidge.scale(0.40, 1.0, 1.30);
  eWingRidge.translate(cx + 1.45, baseY + 1.00 + 0.09, bldgZ);
  out.push({ geom: eWingRidge, color: PC_ROOF_DARK });
  for (const wxOff of [-0.45, -0.27, -0.09, 0.09, 0.27, 0.45]) {
    const pilaster = new BoxGeometry(0.045, 0.65, 0.025);
    pilaster.translate(cx + 1.45 + wxOff - 0.09, baseY + 0.36, bldgFrontZ + 0.013);
    out.push({ geom: pilaster, color: PC_SANDSTONE_SHADOW });
    const win = new BoxGeometry(0.09, 0.36, 0.012);
    win.translate(cx + 1.45 + wxOff, baseY + 0.38, bldgFrontZ + 0.007);
    out.push({ geom: win, color: CH_DARK_WINDOW });
    const arch = new CylinderGeometry(0.045, 0.045, 0.012, 8, 1, false, 0, Math.PI);
    arch.rotateX(Math.PI / 2);
    arch.rotateZ(-Math.PI / 2);
    arch.translate(cx + 1.45 + wxOff, baseY + 0.57, bldgFrontZ + 0.008);
    out.push({ geom: arch, color: CH_DARK_WINDOW });
  }

  // --- EAST END PAVILION (mirror of west) ---
  const ePavBody = new BoxGeometry(0.95, 0.95, bdpth);
  ePavBody.translate(cx + 2.50, baseY + 0.475, bldgZ);
  out.push({ geom: ePavBody, color: PC_SANDSTONE });
  const ePavCornice = new BoxGeometry(1.05, 0.06, bdpth + 0.06);
  ePavCornice.translate(cx + 2.50, baseY + 0.95 + 0.03, bldgZ);
  out.push({ geom: ePavCornice, color: PC_SANDSTONE_SHADOW });
  const ePavRoof = new ConeGeometry(0.62, 0.65, 4);
  ePavRoof.rotateY(Math.PI / 4);
  ePavRoof.translate(cx + 2.50, baseY + 0.95 + 0.06 + 0.325, bldgZ);
  out.push({ geom: ePavRoof, color: PC_SLATE_ROOF });
  const ePavSpike = new CylinderGeometry(0.018, 0.022, 0.20, 6);
  ePavSpike.translate(cx + 2.50, baseY + 0.95 + 0.06 + 0.65 + 0.10, bldgZ);
  out.push({ geom: ePavSpike, color: CH_GOLD });
  for (const wxOff of [-0.25, 0, 0.25]) {
    for (let story = 0; story < 2; story++) {
      const win = new BoxGeometry(0.10, 0.20, 0.014);
      win.translate(cx + 2.50 + wxOff, baseY + 0.22 + story * 0.40, bldgFrontZ + 0.007);
      out.push({ geom: win, color: CH_DARK_WINDOW });
    }
  }

  // ===== GRAND CEREMONIAL STAIRCASE (rows 1-2) =====
  // 5 wide steps cascading from the arched entrance.
  for (let i = 0; i < 5; i++) {
    const stepW = 1.10 + i * 0.18;
    const stepZ = ay + 0.80 + i * 0.22;
    const step = new BoxGeometry(stepW, 0.06, 0.22);
    step.translate(cx, Math.max(0.040, baseY - i * 0.010 + 0.030), stepZ);
    out.push({ geom: step, color: PC_SANDSTONE_SHADOW });
  }
  // Side railings
  for (const dx of [-0.95, 0.95]) {
    const rail = new BoxGeometry(0.10, 0.34, 1.00);
    rail.translate(cx + dx, baseY + 0.17, ay + 1.30);
    out.push({ geom: rail, color: PC_SANDSTONE });
    const railCap = new ConeGeometry(0.06, 0.08, 4);
    railCap.translate(cx + dx, baseY + 0.38, ay + 1.30);
    out.push({ geom: railCap, color: CH_GOLD });
  }

  // ===== CIRCULAR FOUNTAIN IN FRONT PLAZA =====
  const pcFountainBasin = new CylinderGeometry(0.45, 0.45, 0.10, 22);
  pcFountainBasin.translate(cx, baseY + 0.05, ay + 2.85);
  out.push({ geom: pcFountainBasin, color: PC_SANDSTONE });
  const pcFountainWater = new CylinderGeometry(0.40, 0.40, 0.02, 22);
  pcFountainWater.translate(cx, baseY + 0.10, ay + 2.85);
  out.push({ geom: pcFountainWater, color: 0x6da8d6 });
  // Central tiered fountain — three levels
  const tier1 = new CylinderGeometry(0.20, 0.22, 0.10, 14);
  tier1.translate(cx, baseY + 0.16, ay + 2.85);
  out.push({ geom: tier1, color: PC_SANDSTONE_SHADOW });
  const tier2 = new CylinderGeometry(0.13, 0.15, 0.08, 12);
  tier2.translate(cx, baseY + 0.25, ay + 2.85);
  out.push({ geom: tier2, color: PC_SANDSTONE_SHADOW });
  const tier3 = new CylinderGeometry(0.07, 0.09, 0.06, 10);
  tier3.translate(cx, baseY + 0.32, ay + 2.85);
  out.push({ geom: tier3, color: PC_SANDSTONE_SHADOW });
  const jet = new ConeGeometry(0.04, 0.16, 8);
  jet.translate(cx, baseY + 0.43, ay + 2.85);
  out.push({ geom: jet, color: CH_GOLD_BRIGHT });

  // ===== FLAGPOLES (front of plaza) =====
  for (const dx of [-1.30, 0, 1.30]) {
    const flagBase = new BoxGeometry(0.20, 0.10, 0.20);
    flagBase.translate(cx + dx, baseY + 0.05, ay + 3.60);
    out.push({ geom: flagBase, color: PC_SANDSTONE_SHADOW });
    const pole = new CylinderGeometry(0.020, 0.022, 1.10, 6);
    pole.translate(cx + dx, baseY + 0.65, ay + 3.60);
    out.push({ geom: pole, color: 0xb8b8b8 });
    const fcolor = dx === 0 ? CH_RED_FLAG : (dx < 0 ? CH_BLUE_FLAG : 0xe9e9e9);
    const fF = new BoxGeometry(0.24, 0.16, 0.005);
    fF.translate(cx + dx + 0.12, baseY + 1.05, ay + 3.60);
    out.push({ geom: fF, color: fcolor });
    const flagBall = new IcosahedronGeometry(0.024, 1);
    flagBall.translate(cx + dx, baseY + 1.21, ay + 3.60);
    out.push({ geom: flagBall, color: CH_GOLD });
  }

  // ===== LAMPPOSTS along the perimeter =====
  const pcLamps: Array<[number, number]> = [
    [-2.78, -0.50], [2.78, -0.50],
    [-2.78,  0.80], [2.78,  0.80],
    [-2.78,  1.78], [2.78,  1.78]
  ];
  for (const [px, pz] of pcLamps) {
    const lampPost = new CylinderGeometry(0.022, 0.028, 0.50, 6);
    lampPost.translate(cx + px, baseY + 0.25, cz + pz);
    out.push({ geom: lampPost, color: CH_LAMPPOST });
    const lampHouse = new BoxGeometry(0.10, 0.10, 0.10);
    lampHouse.translate(cx + px, baseY + 0.55, cz + pz);
    out.push({ geom: lampHouse, color: CH_LAMPPOST });
    const bulb = new IcosahedronGeometry(0.040, 1);
    bulb.translate(cx + px, baseY + 0.55, cz + pz);
    out.push({ geom: bulb, color: CH_LAMP_BULB });
  }

  // ===== ORNAMENTAL TREES (4 corners of grounds) =====
  for (const [tx, tz] of [[-2.50, 2.30], [2.50, 2.30], [-2.50, -1.55], [2.50, -1.55]] as Array<[number, number]>) {
    const shadow = new CylinderGeometry(0.35, 0.30, 0.005, 8);
    shadow.translate(cx + tx + 0.04, 0.030, cz + tz);
    out.push({ geom: shadow, color: 0x2a3a22 });
    const trunk = new CylinderGeometry(0.055, 0.065, 0.32, 6);
    trunk.translate(cx + tx, 0.19, cz + tz);
    out.push({ geom: trunk, color: CH_TREE_TRUNK });
    const foliage = new ConeGeometry(0.32, 0.70, 8);
    foliage.translate(cx + tx, 0.70, cz + tz);
    out.push({ geom: foliage, color: CH_TREE_LEAF });
    const blob = new ConeGeometry(0.22, 0.42, 8);
    blob.translate(cx + tx + 0.08, 0.92, cz + tz - 0.08);
    out.push({ geom: blob, color: CH_TREE_LEAF });
  }

  return out;
}

/**
 * National Capital (Alpha 4.12). 7×4 footprint, Centre Block (Ottawa)
 * influence — Gothic Revival sandstone, tall central Peace-Tower-style
 * clock tower with copper-spired roof, twin symmetric wings ending in
 * smaller flag towers, round Library of Parliament element behind, broad
 * formal grounds with eternal flame fountain.
 *
 * Tower height: deliberately capped well below skyscraper peak (~10
 * units vs skyscraper's ~15 max) so this reads as the tallest civic
 * monument but not a tower in the skyscraper sense.
 *
 * Layout (looking south):
 *   ROW 0 (back):  library round element + back wall of main building
 *   ROW 1:         main building — 7 modules wide, central PEACE TOWER
 *   ROW 2:         broad ceremonial portico + flanking porte-cochères
 *   ROW 3 (front): ceremonial plaza + eternal flame + flagpole row
 */
export function buildNationalCapitalParts(ax: number, ay: number): VariantPart[] {
  const out: VariantPart[] = [];
  const cx = ax + 3.5;
  const cz = ay + 2.0;
  const baseY = 0.05;
  const bz = ay + 1.10;    // building-row centre (row 1)
  const fz = ay + 3.20;    // front-plaza centre (row 3)

  // Estate pad (7 × 4)
  const pad = new BoxGeometry(6.95, 0.025, 3.95);
  pad.translate(cx, 0.0125, cz);
  out.push({ geom: pad, color: NC_SANDSTONE_DEEP });
  // Front lawn (row 3 outer)
  for (const dx of [-2.5, 2.5]) {
    const lawn = new BoxGeometry(1.55, 0.018, 0.85);
    lawn.translate(cx + dx, 0.024, ay + 3.45);
    out.push({ geom: lawn, color: CH_LAWN });
  }
  // Ceremonial central paved approach
  const path = new BoxGeometry(1.80, 0.022, 2.60);
  path.translate(cx, 0.028, ay + 2.40);
  out.push({ geom: path, color: CH_PATH });
  // Side lawns rows 1-2
  for (const dx of [-2.5, 2.5]) {
    const sideLawn = new BoxGeometry(1.55, 0.018, 1.65);
    sideLawn.translate(cx + dx, 0.024, ay + 2.10);
    out.push({ geom: sideLawn, color: CH_LAWN });
  }

  // Wrought-iron perimeter fence — taller and statelier than the
  // others. Front gate opening with monumental posts.
  for (const [px, pz, w, d] of [
    [-2.20, 1.97, 2.40, 0.06], [2.20, 1.97, 2.40, 0.06],   // front L/R of gate
    [0, -1.97, 6.95, 0.06],                                  // back wall
  ] as Array<[number, number, number, number]>) {
    const seg = new BoxGeometry(w, 0.16, d);
    seg.translate(cx + px, 0.10, cz + pz);
    out.push({ geom: seg, color: NC_SANDSTONE_SHADOW });
  }
  // East + west walls
  for (const px of [-3.47, 3.47]) {
    const seg = new BoxGeometry(0.07, 0.16, 3.95);
    seg.translate(cx + px, 0.10, cz);
    out.push({ geom: seg, color: NC_SANDSTONE_SHADOW });
  }
  // Eight perimeter posts (corners + gate piers + mid-side)
  for (const [px, pz] of [
    [-3.47, -1.97], [3.47, -1.97], [-3.47, 1.97], [3.47, 1.97],
    [-1.00, 1.97], [1.00, 1.97],
    [-3.47, 0.00], [3.47, 0.00]
  ] as Array<[number, number]>) {
    const post = new BoxGeometry(0.14, 0.32, 0.14);
    post.translate(cx + px, 0.16, cz + pz);
    out.push({ geom: post, color: NC_SANDSTONE_SHADOW });
    // Gold-cap finial
    const finialCap = new ConeGeometry(0.08, 0.14, 4);
    finialCap.translate(cx + px, 0.39, cz + pz);
    out.push({ geom: finialCap, color: CH_GOLD });
  }

  // ===== LIBRARY OF PARLIAMENT (round element behind the main building) =====
  // Sits in the back row (row 0), centred. Round drum + copper-green
  // conical roof.
  const libZ = ay + 0.40;
  const libDrum = new CylinderGeometry(0.55, 0.55, 0.95, 18);
  libDrum.translate(cx, baseY + 0.475, libZ);
  out.push({ geom: libDrum, color: NC_SANDSTONE });
  // Buttress ribs around the drum (Gothic flying buttresses simplified)
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const buttress = new BoxGeometry(0.05, 0.85, 0.10);
    buttress.translate(
      cx + Math.cos(angle) * 0.58,
      baseY + 0.425,
      libZ + Math.sin(angle) * 0.58
    );
    buttress.rotateY(angle + Math.PI / 2);
    out.push({ geom: buttress, color: NC_SANDSTONE_SHADOW });
  }
  // Pointed-arch windows on the drum (8)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const win = new BoxGeometry(0.08, 0.40, 0.014);
    win.translate(
      cx + Math.cos(angle) * 0.54,
      baseY + 0.40,
      libZ + Math.sin(angle) * 0.54
    );
    win.rotateY(angle + Math.PI / 2);
    out.push({ geom: win, color: CH_DARK_WINDOW });
  }
  // Drum cornice
  const libCornice = new CylinderGeometry(0.60, 0.60, 0.06, 18);
  libCornice.translate(cx, baseY + 0.95 + 0.03, libZ);
  out.push({ geom: libCornice, color: NC_SANDSTONE_DEEP });
  // Conical copper roof
  const libRoof = new ConeGeometry(0.62, 0.55, 18);
  libRoof.translate(cx, baseY + 0.95 + 0.06 + 0.275, libZ);
  out.push({ geom: libRoof, color: NC_COPPER_ROOF });
  // Roof ribs
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const rib = new BoxGeometry(0.015, 0.56, 0.015);
    rib.translate(
      cx + Math.cos(angle) * 0.28,
      baseY + 0.95 + 0.06 + 0.275,
      libZ + Math.sin(angle) * 0.28
    );
    rib.rotateY(angle);
    out.push({ geom: rib, color: NC_COPPER_DEEP });
  }
  // Library finial
  const libFinial = new CylinderGeometry(0.012, 0.018, 0.22, 6);
  libFinial.translate(cx, baseY + 0.95 + 0.06 + 0.55 + 0.11, libZ);
  out.push({ geom: libFinial, color: CH_GOLD });
  const libBall = new IcosahedronGeometry(0.040, 1);
  libBall.translate(cx, baseY + 0.95 + 0.06 + 0.55 + 0.26, libZ);
  out.push({ geom: libBall, color: CH_GOLD_BRIGHT });

  // ===== MAIN BUILDING (row 1) — 7 modules wide =====
  const bdpth = 0.85;
  const bldgZ = bz - 0.05;
  const bldgFrontZ = bldgZ + bdpth / 2;

  // --- WEST FLAG TOWER (block 1) ---
  const wTowerH = 1.40;
  const wTower = new BoxGeometry(0.85, wTowerH, bdpth + 0.05);
  wTower.translate(cx - 3.05, baseY + wTowerH / 2, bldgZ);
  out.push({ geom: wTower, color: NC_SANDSTONE });
  // Tower cornice
  const wTowerCornice = new BoxGeometry(0.95, 0.07, bdpth + 0.15);
  wTowerCornice.translate(cx - 3.05, baseY + wTowerH + 0.035, bldgZ);
  out.push({ geom: wTowerCornice, color: NC_SANDSTONE_DEEP });
  // Tower roof — copper pyramid
  const wTowerRoof = new ConeGeometry(0.50, 0.40, 4);
  wTowerRoof.rotateY(Math.PI / 4);
  wTowerRoof.translate(cx - 3.05, baseY + wTowerH + 0.07 + 0.20, bldgZ);
  out.push({ geom: wTowerRoof, color: NC_COPPER_ROOF });
  // Tower finial + flag
  const wTowerSpike = new CylinderGeometry(0.012, 0.018, 0.18, 6);
  wTowerSpike.translate(cx - 3.05, baseY + wTowerH + 0.07 + 0.40 + 0.09, bldgZ);
  out.push({ geom: wTowerSpike, color: CH_GOLD });
  const wTowerBall = new IcosahedronGeometry(0.030, 1);
  wTowerBall.translate(cx - 3.05, baseY + wTowerH + 0.07 + 0.40 + 0.20, bldgZ);
  out.push({ geom: wTowerBall, color: CH_GOLD_BRIGHT });
  // Tower windows — 2 narrow Gothic on the front face per storey
  for (let story = 0; story < 4; story++) {
    for (const tdx of [-0.18, 0.18]) {
      const win = new BoxGeometry(0.10, 0.22, 0.014);
      win.translate(cx - 3.05 + tdx, baseY + 0.20 + story * 0.32, bldgFrontZ + 0.007);
      out.push({ geom: win, color: CH_DARK_WINDOW });
    }
  }

  // --- WEST WING (block 2) — long Gothic Revival hall ---
  const wWingH = 1.05;
  const wWingBody = new BoxGeometry(1.20, wWingH, bdpth);
  wWingBody.translate(cx - 2.00, baseY + wWingH / 2, bldgZ);
  out.push({ geom: wWingBody, color: NC_SANDSTONE });
  // Steep slate roof (copper bands)
  const wWingRoof = new BoxGeometry(1.25, 0.22, bdpth + 0.06);
  wWingRoof.translate(cx - 2.00, baseY + wWingH + 0.11, bldgZ);
  out.push({ geom: wWingRoof, color: NC_COPPER_DEEP });
  // Ridge
  const wWingRidge = new ConeGeometry(0.45, 0.20, 4);
  wWingRidge.rotateY(Math.PI / 4);
  wWingRidge.scale(0.40, 1.0, 1.40);
  wWingRidge.translate(cx - 2.00, baseY + wWingH + 0.22 + 0.10, bldgZ);
  out.push({ geom: wWingRidge, color: NC_COPPER_ROOF });
  // 4 pointed-arch windows on the front face
  for (const wxOff of [-0.42, -0.14, 0.14, 0.42]) {
    const pilaster = new BoxGeometry(0.05, 0.85, 0.025);
    pilaster.translate(cx - 2.00 + wxOff - 0.14, baseY + 0.45, bldgFrontZ + 0.013);
    out.push({ geom: pilaster, color: NC_SANDSTONE_SHADOW });
    const win = new BoxGeometry(0.13, 0.50, 0.012);
    win.translate(cx - 2.00 + wxOff, baseY + 0.48, bldgFrontZ + 0.007);
    out.push({ geom: win, color: CH_DARK_WINDOW });
    // Pointed Gothic arch top — small cone rotated to point up
    const arch = new ConeGeometry(0.07, 0.16, 4);
    arch.rotateY(Math.PI / 4);
    arch.scale(1.0, 1.0, 0.18);
    arch.translate(cx - 2.00 + wxOff, baseY + 0.80, bldgFrontZ + 0.012);
    out.push({ geom: arch, color: NC_SANDSTONE_SHADOW });
  }

  // --- CENTRAL BLOCK + PEACE TOWER (block 3) — the apex feature ---
  const ccH = 1.30;
  const ccBody = new BoxGeometry(1.20, ccH, bdpth + 0.18);
  ccBody.translate(cx, baseY + ccH / 2, bldgZ + 0.09);
  out.push({ geom: ccBody, color: NC_SANDSTONE });
  // Entablature
  const ccBand = new BoxGeometry(1.32, 0.10, bdpth + 0.28);
  ccBand.translate(cx, baseY + ccH + 0.05, bldgZ + 0.09);
  out.push({ geom: ccBand, color: NC_SANDSTONE_DEEP });

  // PEACE TOWER — the centrepiece. Tall narrow stone tower with clock
  // faces near the top, copper-green stepped roof, tall slender spire.
  // Total height: 9.5 units (well below skyscraper peak).
  const ptBaseY = baseY + ccH + 0.10;
  const ptLevel1H = 1.60;
  const ptLevel1 = new BoxGeometry(0.78, ptLevel1H, 0.78);
  ptLevel1.translate(cx, ptBaseY + ptLevel1H / 2, bldgZ + 0.09);
  out.push({ geom: ptLevel1, color: NC_SANDSTONE });
  // Pointed-arch windows on each face of level 1
  for (let face = 0; face < 4; face++) {
    const fx = Math.cos(face * Math.PI / 2) * 0.40;
    const fz = Math.sin(face * Math.PI / 2) * 0.40;
    for (let story = 0; story < 3; story++) {
      const win = new BoxGeometry(face % 2 === 0 ? 0.10 : 0.012, 0.28, face % 2 === 0 ? 0.012 : 0.10);
      win.translate(cx + fx, ptBaseY + 0.30 + story * 0.40, bldgZ + 0.09 + fz);
      out.push({ geom: win, color: CH_DARK_WINDOW });
    }
  }
  // Setback band
  const ptBand1 = new BoxGeometry(0.85, 0.08, 0.85);
  ptBand1.translate(cx, ptBaseY + ptLevel1H + 0.04, bldgZ + 0.09);
  out.push({ geom: ptBand1, color: NC_SANDSTONE_DEEP });
  // Level 2 — clock storey
  const ptClockH = 0.75;
  const ptClock = new BoxGeometry(0.85, ptClockH, 0.85);
  ptClock.translate(cx, ptBaseY + ptLevel1H + 0.08 + ptClockH / 2, bldgZ + 0.09);
  out.push({ geom: ptClock, color: NC_SANDSTONE });
  // Clock faces (N/E/S/W)
  for (const [fx, fz] of [[0, 0.43], [0.43, 0], [0, -0.43], [-0.43, 0]] as Array<[number, number]>) {
    const clockFace = new CylinderGeometry(0.20, 0.20, 0.012, 18);
    clockFace.rotateX(Math.PI / 2);
    if (fx !== 0) clockFace.rotateY(Math.PI / 2);
    clockFace.translate(cx + fx, ptBaseY + ptLevel1H + 0.08 + ptClockH / 2, bldgZ + 0.09 + fz);
    out.push({ geom: clockFace, color: 0xf3ead0 });
    // Roman numeral marks (4 small dots at 12/3/6/9)
    for (let k = 0; k < 4; k++) {
      const ka = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const mark = new BoxGeometry(0.018, 0.018, 0.003);
      const mx = Math.cos(ka) * 0.16;
      const mz = Math.sin(ka) * 0.16;
      if (fx !== 0) {
        mark.rotateY(Math.PI / 2);
        mark.translate(cx + fx + (fx > 0 ? 0.005 : -0.005), ptBaseY + ptLevel1H + 0.08 + ptClockH / 2 + mz, bldgZ + 0.09 + mx);
      } else {
        mark.translate(cx + mx, ptBaseY + ptLevel1H + 0.08 + ptClockH / 2 + mz, bldgZ + 0.09 + fz + (fz > 0 ? 0.005 : -0.005));
      }
      out.push({ geom: mark, color: CH_DARK_WINDOW });
    }
    // Hour hand
    const hourHand = new BoxGeometry(0.075, 0.012, 0.004);
    if (fx !== 0) hourHand.rotateY(Math.PI / 2);
    if (fx !== 0) hourHand.translate(cx + fx + (fx > 0 ? 0.006 : -0.006), ptBaseY + ptLevel1H + 0.08 + ptClockH / 2, bldgZ + 0.09 + fz);
    else hourHand.translate(cx + fx, ptBaseY + ptLevel1H + 0.08 + ptClockH / 2, bldgZ + 0.09 + fz + (fz > 0 ? 0.006 : -0.006));
    out.push({ geom: hourHand, color: CH_DARK_WINDOW });
    // Minute hand (vertical)
    const minHand = new BoxGeometry(0.012, 0.13, 0.004);
    if (fx !== 0) {
      minHand.rotateY(Math.PI / 2);
      minHand.translate(cx + fx + (fx > 0 ? 0.006 : -0.006), ptBaseY + ptLevel1H + 0.08 + ptClockH / 2 + 0.05, bldgZ + 0.09 + fz);
    } else {
      minHand.translate(cx + fx, ptBaseY + ptLevel1H + 0.08 + ptClockH / 2 + 0.05, bldgZ + 0.09 + fz + (fz > 0 ? 0.006 : -0.006));
    }
    out.push({ geom: minHand, color: CH_DARK_WINDOW });
  }
  // Cornice above clock
  const ptClockCornice = new BoxGeometry(0.92, 0.07, 0.92);
  ptClockCornice.translate(cx, ptBaseY + ptLevel1H + 0.08 + ptClockH + 0.035, bldgZ + 0.09);
  out.push({ geom: ptClockCornice, color: NC_SANDSTONE_DEEP });
  // Stepped copper-green roof — first level
  const ptRoof1 = new ConeGeometry(0.50, 0.32, 4);
  ptRoof1.rotateY(Math.PI / 4);
  ptRoof1.translate(cx, ptBaseY + ptLevel1H + 0.08 + ptClockH + 0.07 + 0.16, bldgZ + 0.09);
  out.push({ geom: ptRoof1, color: NC_COPPER_ROOF });
  // Open lantern stage
  const ptLantern = new BoxGeometry(0.42, 0.30, 0.42);
  ptLantern.translate(cx, ptBaseY + ptLevel1H + 0.08 + ptClockH + 0.07 + 0.32 + 0.15, bldgZ + 0.09);
  out.push({ geom: ptLantern, color: NC_SANDSTONE_SHADOW });
  // Lantern roof
  const ptRoof2 = new ConeGeometry(0.32, 0.32, 4);
  ptRoof2.rotateY(Math.PI / 4);
  ptRoof2.translate(cx, ptBaseY + ptLevel1H + 0.08 + ptClockH + 0.07 + 0.32 + 0.30 + 0.16, bldgZ + 0.09);
  out.push({ geom: ptRoof2, color: NC_COPPER_ROOF });
  // Tall spire — narrow pointed cone on top of the lantern roof
  const ptSpire = new ConeGeometry(0.10, 1.20, 8);
  ptSpire.translate(cx, ptBaseY + ptLevel1H + 0.08 + ptClockH + 0.07 + 0.32 + 0.30 + 0.32 + 0.60, bldgZ + 0.09);
  out.push({ geom: ptSpire, color: NC_COPPER_DEEP });
  // Spire ribs
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const rib = new BoxGeometry(0.018, 1.22, 0.018);
    rib.translate(
      cx + Math.cos(angle) * 0.05,
      ptBaseY + ptLevel1H + 0.08 + ptClockH + 0.07 + 0.32 + 0.30 + 0.32 + 0.60,
      bldgZ + 0.09 + Math.sin(angle) * 0.05
    );
    rib.rotateY(angle);
    out.push({ geom: rib, color: NC_COPPER_ROOF });
  }
  // Apex flagpole + flag (tower peak — well below skyscraper height)
  const peakY = ptBaseY + ptLevel1H + 0.08 + ptClockH + 0.07 + 0.32 + 0.30 + 0.32 + 1.20;
  const ptFlagpole = new CylinderGeometry(0.012, 0.012, 0.40, 5);
  ptFlagpole.translate(cx, peakY + 0.20, bldgZ + 0.09);
  out.push({ geom: ptFlagpole, color: 0xc8c8c8 });
  const ptFlag = new BoxGeometry(0.22, 0.14, 0.005);
  ptFlag.translate(cx + 0.11, peakY + 0.32, bldgZ + 0.09);
  out.push({ geom: ptFlag, color: CH_RED_FLAG });

  // Grand arched entrance under the tower
  const grandEntZ = bldgZ + bdpth / 2 + 0.18 + 0.025;
  const grandEntOpening = new BoxGeometry(0.55, 0.85, 0.025);
  grandEntOpening.translate(cx, baseY + 0.425, grandEntZ - 0.012);
  out.push({ geom: grandEntOpening, color: 0x2a1f18 });
  // Pointed Gothic arch above
  const gothicArchTop = new ConeGeometry(0.30, 0.36, 4);
  gothicArchTop.rotateY(Math.PI / 4);
  gothicArchTop.scale(1.0, 1.0, 0.20);
  gothicArchTop.translate(cx, baseY + 0.85 + 0.18, grandEntZ - 0.010);
  out.push({ geom: gothicArchTop, color: 0x2a1f18 });
  // Sandstone arch surround
  const gothicArchSurround = new ConeGeometry(0.36, 0.42, 4);
  gothicArchSurround.rotateY(Math.PI / 4);
  gothicArchSurround.scale(1.0, 1.0, 0.22);
  gothicArchSurround.translate(cx, baseY + 0.85 + 0.21, grandEntZ + 0.005);
  out.push({ geom: gothicArchSurround, color: NC_SANDSTONE_DEEP });
  // Red door
  const ncDoor = new BoxGeometry(0.45, 0.70, 0.018);
  ncDoor.translate(cx, baseY + 0.36, grandEntZ - 0.005);
  out.push({ geom: ncDoor, color: NC_RED_DOOR });

  // --- EAST WING (mirror of west) ---
  const eWingBody = new BoxGeometry(1.20, wWingH, bdpth);
  eWingBody.translate(cx + 2.00, baseY + wWingH / 2, bldgZ);
  out.push({ geom: eWingBody, color: NC_SANDSTONE });
  const eWingRoof = new BoxGeometry(1.25, 0.22, bdpth + 0.06);
  eWingRoof.translate(cx + 2.00, baseY + wWingH + 0.11, bldgZ);
  out.push({ geom: eWingRoof, color: NC_COPPER_DEEP });
  const eWingRidge = new ConeGeometry(0.45, 0.20, 4);
  eWingRidge.rotateY(Math.PI / 4);
  eWingRidge.scale(0.40, 1.0, 1.40);
  eWingRidge.translate(cx + 2.00, baseY + wWingH + 0.22 + 0.10, bldgZ);
  out.push({ geom: eWingRidge, color: NC_COPPER_ROOF });
  for (const wxOff of [-0.42, -0.14, 0.14, 0.42]) {
    const pilaster = new BoxGeometry(0.05, 0.85, 0.025);
    pilaster.translate(cx + 2.00 + wxOff - 0.14, baseY + 0.45, bldgFrontZ + 0.013);
    out.push({ geom: pilaster, color: NC_SANDSTONE_SHADOW });
    const win = new BoxGeometry(0.13, 0.50, 0.012);
    win.translate(cx + 2.00 + wxOff, baseY + 0.48, bldgFrontZ + 0.007);
    out.push({ geom: win, color: CH_DARK_WINDOW });
    const arch = new ConeGeometry(0.07, 0.16, 4);
    arch.rotateY(Math.PI / 4);
    arch.scale(1.0, 1.0, 0.18);
    arch.translate(cx + 2.00 + wxOff, baseY + 0.80, bldgFrontZ + 0.012);
    out.push({ geom: arch, color: NC_SANDSTONE_SHADOW });
  }

  // --- EAST FLAG TOWER (mirror of west) ---
  const eTower = new BoxGeometry(0.85, wTowerH, bdpth + 0.05);
  eTower.translate(cx + 3.05, baseY + wTowerH / 2, bldgZ);
  out.push({ geom: eTower, color: NC_SANDSTONE });
  const eTowerCornice = new BoxGeometry(0.95, 0.07, bdpth + 0.15);
  eTowerCornice.translate(cx + 3.05, baseY + wTowerH + 0.035, bldgZ);
  out.push({ geom: eTowerCornice, color: NC_SANDSTONE_DEEP });
  const eTowerRoof = new ConeGeometry(0.50, 0.40, 4);
  eTowerRoof.rotateY(Math.PI / 4);
  eTowerRoof.translate(cx + 3.05, baseY + wTowerH + 0.07 + 0.20, bldgZ);
  out.push({ geom: eTowerRoof, color: NC_COPPER_ROOF });
  const eTowerSpike = new CylinderGeometry(0.012, 0.018, 0.18, 6);
  eTowerSpike.translate(cx + 3.05, baseY + wTowerH + 0.07 + 0.40 + 0.09, bldgZ);
  out.push({ geom: eTowerSpike, color: CH_GOLD });
  const eTowerBall = new IcosahedronGeometry(0.030, 1);
  eTowerBall.translate(cx + 3.05, baseY + wTowerH + 0.07 + 0.40 + 0.20, bldgZ);
  out.push({ geom: eTowerBall, color: CH_GOLD_BRIGHT });
  for (let story = 0; story < 4; story++) {
    for (const tdx of [-0.18, 0.18]) {
      const win = new BoxGeometry(0.10, 0.22, 0.014);
      win.translate(cx + 3.05 + tdx, baseY + 0.20 + story * 0.32, bldgFrontZ + 0.007);
      out.push({ geom: win, color: CH_DARK_WINDOW });
    }
  }

  // ===== GRAND CEREMONIAL STAIRCASE =====
  for (let i = 0; i < 6; i++) {
    const stepW = 1.30 + i * 0.22;
    const stepZ = ay + 1.55 + i * 0.20;
    const step = new BoxGeometry(stepW, 0.06, 0.20);
    step.translate(cx, Math.max(0.040, baseY - i * 0.010 + 0.030), stepZ);
    out.push({ geom: step, color: NC_SANDSTONE_SHADOW });
  }
  // Side railings — granite balustrade
  for (const dx of [-1.05, 1.05]) {
    const rail = new BoxGeometry(0.12, 0.40, 1.10);
    rail.translate(cx + dx, baseY + 0.20, ay + 2.10);
    out.push({ geom: rail, color: NC_SANDSTONE });
    const railCap = new ConeGeometry(0.07, 0.10, 4);
    railCap.translate(cx + dx, baseY + 0.45, ay + 2.10);
    out.push({ geom: railCap, color: CH_GOLD });
  }

  // ===== ETERNAL FLAME FOUNTAIN (front plaza) =====
  // Octagonal pool with perpetual orange flame in centre
  const flameBasin = new CylinderGeometry(0.52, 0.55, 0.12, 8);
  flameBasin.translate(cx, baseY + 0.06, fz);
  out.push({ geom: flameBasin, color: NC_SANDSTONE });
  const flameWater = new CylinderGeometry(0.46, 0.46, 0.025, 8);
  flameWater.translate(cx, baseY + 0.12, fz);
  out.push({ geom: flameWater, color: 0x6da8d6 });
  // Central pedestal
  const flamePed = new CylinderGeometry(0.12, 0.16, 0.16, 8);
  flamePed.translate(cx, baseY + 0.20, fz);
  out.push({ geom: flamePed, color: NC_SANDSTONE_DEEP });
  // Bronze flame holder
  const flameHolder = new BoxGeometry(0.10, 0.06, 0.10);
  flameHolder.translate(cx, baseY + 0.30, fz);
  out.push({ geom: flameHolder, color: CH_BRONZE });
  // Flame — twin cones, warm orange
  const flame1 = new ConeGeometry(0.06, 0.20, 6);
  flame1.translate(cx, baseY + 0.43, fz);
  out.push({ geom: flame1, color: 0xf28a30 });
  const flame2 = new ConeGeometry(0.04, 0.12, 6);
  flame2.translate(cx + 0.015, baseY + 0.51, fz);
  out.push({ geom: flame2, color: 0xf2cd5c });

  // ===== FLAGPOLE ROW (5 across the front plaza edge) =====
  for (const dx of [-1.80, -0.90, 0, 0.90, 1.80]) {
    const flagBase = new BoxGeometry(0.22, 0.12, 0.22);
    flagBase.translate(cx + dx, baseY + 0.06, ay + 3.75);
    out.push({ geom: flagBase, color: NC_SANDSTONE_DEEP });
    const pole = new CylinderGeometry(0.022, 0.024, 1.30, 6);
    pole.translate(cx + dx, baseY + 0.75, ay + 3.75);
    out.push({ geom: pole, color: 0xc8c8c8 });
    const flagF = new BoxGeometry(0.28, 0.18, 0.005);
    flagF.translate(cx + dx + 0.14, baseY + 1.27, ay + 3.75);
    const fcolor = dx === 0 ? CH_RED_FLAG : (Math.abs(dx) < 1.4 ? CH_BLUE_FLAG : 0xe9e9e9);
    out.push({ geom: flagF, color: fcolor });
    const flagBall = new IcosahedronGeometry(0.026, 1);
    flagBall.translate(cx + dx, baseY + 1.42, ay + 3.75);
    out.push({ geom: flagBall, color: CH_GOLD });
  }

  // ===== BRONZE STATUE PAIR (flanking front approach) =====
  for (const dx of [-0.85, 0.85]) {
    const sPlinth = new BoxGeometry(0.20, 0.32, 0.20);
    sPlinth.translate(cx + dx, baseY + 0.16, fz - 0.55);
    out.push({ geom: sPlinth, color: NC_SANDSTONE_DEEP });
    const sBody = new BoxGeometry(0.07, 0.22, 0.06);
    sBody.translate(cx + dx, baseY + 0.43, fz - 0.55);
    out.push({ geom: sBody, color: CH_BRONZE });
    const sHead = new IcosahedronGeometry(0.034, 1);
    sHead.translate(cx + dx, baseY + 0.58, fz - 0.55);
    out.push({ geom: sHead, color: CH_BRONZE });
    // Plaque
    const plaque = new BoxGeometry(0.14, 0.05, 0.005);
    plaque.translate(cx + dx, baseY + 0.21, fz - 0.45);
    out.push({ geom: plaque, color: CH_GOLD });
  }

  // ===== LAMPPOSTS along the perimeter (8) =====
  for (const [px, pz] of [
    [-3.20, -0.50], [3.20, -0.50],
    [-3.20,  0.70], [3.20,  0.70],
    [-3.20,  1.70], [3.20,  1.70],
    [-1.80,  1.85], [1.80,  1.85]
  ] as Array<[number, number]>) {
    const lampPost = new CylinderGeometry(0.024, 0.030, 0.55, 6);
    lampPost.translate(cx + px, baseY + 0.275, cz + pz);
    out.push({ geom: lampPost, color: CH_LAMPPOST });
    const lampHouse = new BoxGeometry(0.10, 0.10, 0.10);
    lampHouse.translate(cx + px, baseY + 0.60, cz + pz);
    out.push({ geom: lampHouse, color: CH_LAMPPOST });
    const bulb = new IcosahedronGeometry(0.042, 1);
    bulb.translate(cx + px, baseY + 0.60, cz + pz);
    out.push({ geom: bulb, color: CH_LAMP_BULB });
  }

  // ===== ORNAMENTAL TREES (corners of grounds) =====
  for (const [tx, tz] of [[-3.10, 2.20], [3.10, 2.20], [-3.10, -1.55], [3.10, -1.55]] as Array<[number, number]>) {
    const shadow = new CylinderGeometry(0.38, 0.32, 0.005, 8);
    shadow.translate(cx + tx + 0.04, 0.030, cz + tz);
    out.push({ geom: shadow, color: 0x2a3a22 });
    const trunk = new CylinderGeometry(0.06, 0.07, 0.36, 6);
    trunk.translate(cx + tx, 0.21, cz + tz);
    out.push({ geom: trunk, color: CH_TREE_TRUNK });
    const foliage = new ConeGeometry(0.34, 0.78, 8);
    foliage.translate(cx + tx, 0.74, cz + tz);
    out.push({ geom: foliage, color: CH_TREE_LEAF });
    const blob = new ConeGeometry(0.24, 0.46, 8);
    blob.translate(cx + tx + 0.10, 0.98, cz + tz - 0.10);
    out.push({ geom: blob, color: CH_TREE_LEAF });
  }

  return out;
}

/* ============================================================================
 * Cloverleaf Interchange (Alpha 4.17)
 *
 * 5 × 5 prefab interchange — two crossing roads with curved loop ramps in
 * each of the 4 quadrants. Footprint anchored at (ax, ay) (lex-smallest
 * tile). Layout sketch:
 *
 *   . . H . .         row 0: highway endpoint (north)
 *   . r H r .         row 1: loop ramps + highway through
 *   H H X H H         row 2: highway crossover (E-W endpoints + bridge centre)
 *   . r H r .         row 3: loop ramps + highway through
 *   . . H . .         row 4: highway endpoint (south)
 *
 * Where:
 *   H = highway pavement (smooth grey asphalt + yellow centre stripes)
 *   X = bridge centre (highway over highway, bridge supports beneath)
 *   r = loop ramp pavement + curved white-stripe lane markings
 *   . = grass infield (manicured medians inside each loop)
 *
 * The 4 loop ramps are visualized as 270° arcs of short straight road
 * segments. Each loop has ~12 segments tracing a circular path inside its
 * quadrant — the segmented arc reads as a smooth curve at the city's
 * usual zoom range.
 *
 * Built per-block via the existing big-build infrastructure (Alpha 4.15).
 * On completion, Game.finalizeCloverleaf populates the road graph so cars
 * can route through; this geometry is purely the visual.
 * ========================================================================= */

// Palette — cloverleaf-specific tones.
const CL_ASPHALT = 0x383c45;          // main highway pavement
const CL_ASPHALT_DARK = 0x2a2e36;     // ramp pavement (slightly darker)
const CL_YELLOW = 0xf3c648;           // highway centre stripe
const CL_WHITE = 0xf2efe5;            // ramp / lane markings
const CL_INFIELD = 0x2f6a2d;          // grass median inside each loop
const CL_INFIELD_DARK = 0x1f4d1d;     // darker green for variation
const CL_BRIDGE_RAIL = 0x9a9a9a;      // concrete bridge rail
const CL_BRIDGE_PIER = 0x7a7e84;      // bridge support pier
const CL_LIGHT_POST = 0x1c232b;       // dark wrought-iron lampposts
const CL_LIGHT_BULB = 0xfff2b8;       // warm bulb tone

/** Y-lift constant — keep cloverleaf surface slightly above road
 *  surface so it visually overlaps player-built road tiles cleanly. */
const CL_SURFACE_Y = 0.025;
const CL_BRIDGE_Y = 0.22;             // matches BRIDGE_LIFT in Renderer

export function buildCloverleafParts(ax: number, ay: number): VariantPart[] {
  const out: VariantPart[] = [];
  // Footprint centre.
  const cx = ax + 2.5;
  const cz = ay + 2.5;

  // ===== ESTATE PAD =====
  // Subtle dark pad covering the entire 5×5 footprint so the cloverleaf
  // visually reads as one continuous structure.
  const estatePad = new BoxGeometry(4.95, 0.020, 4.95);
  estatePad.translate(cx, 0.010, cz);
  out.push({ geom: estatePad, color: CL_INFIELD_DARK });

  // ===== GRASS INFIELDS — 4 quadrants =====
  // Each quadrant is a 2×2 area inside the cloverleaf with a loop ramp
  // wrapping around it. The infield is a green pad with a darker centre
  // so it reads as manicured median.
  for (const [qx, qz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as Array<[number, number]>) {
    const infield = new BoxGeometry(1.55, 0.018, 1.55);
    infield.translate(cx + qx, 0.020, cz + qz);
    out.push({ geom: infield, color: CL_INFIELD });
    // Centre darker patch
    const centre = new BoxGeometry(0.85, 0.022, 0.85);
    centre.translate(cx + qx, 0.022, cz + qz);
    out.push({ geom: centre, color: CL_INFIELD_DARK });
    // Single small tree in each quadrant for visual interest
    const trunk = new CylinderGeometry(0.06, 0.07, 0.32, 6);
    trunk.translate(cx + qx, 0.18, cz + qz);
    out.push({ geom: trunk, color: 0x6e3e1d });
    const foliage = new ConeGeometry(0.30, 0.65, 8);
    foliage.translate(cx + qx, 0.65, cz + qz);
    out.push({ geom: foliage, color: 0x2f6a2d });
  }

  // ===== HIGHWAY THROUGH-LANES — N-S (column 2) =====
  // Wide grey asphalt strip running the full 5-tile length of the
  // cloverleaf in the centre column. Yellow double-centre stripe.
  const nsHwyLength = 5.0;
  const nsHwyWidth = 0.85;
  const nsHwy = new BoxGeometry(nsHwyWidth, 0.020, nsHwyLength);
  nsHwy.translate(cx, CL_SURFACE_Y, cz);
  out.push({ geom: nsHwy, color: CL_ASPHALT });
  // Yellow centre stripe (double-yellow for highway)
  const nsStripeL = new BoxGeometry(0.030, 0.005, nsHwyLength * 0.95);
  nsStripeL.translate(cx - 0.045, CL_SURFACE_Y + 0.012, cz);
  out.push({ geom: nsStripeL, color: CL_YELLOW });
  const nsStripeR = new BoxGeometry(0.030, 0.005, nsHwyLength * 0.95);
  nsStripeR.translate(cx + 0.045, CL_SURFACE_Y + 0.012, cz);
  out.push({ geom: nsStripeR, color: CL_YELLOW });
  // White shoulder stripes
  for (const dx of [-(nsHwyWidth / 2 - 0.020), (nsHwyWidth / 2 - 0.020)]) {
    const shoulder = new BoxGeometry(0.020, 0.005, nsHwyLength * 0.95);
    shoulder.translate(cx + dx, CL_SURFACE_Y + 0.012, cz);
    out.push({ geom: shoulder, color: CL_WHITE });
  }

  // ===== HIGHWAY THROUGH-LANES — E-W (row 2), bridged over the N-S =====
  // Same geometry but rotated, lifted to BRIDGE_Y so it crosses over
  // the N-S highway at the centre.
  const ewHwy = new BoxGeometry(nsHwyLength, 0.020, nsHwyWidth);
  ewHwy.translate(cx, CL_BRIDGE_Y, cz);
  out.push({ geom: ewHwy, color: CL_ASPHALT });
  const ewStripeT = new BoxGeometry(nsHwyLength * 0.95, 0.005, 0.030);
  ewStripeT.translate(cx, CL_BRIDGE_Y + 0.012, cz - 0.045);
  out.push({ geom: ewStripeT, color: CL_YELLOW });
  const ewStripeB = new BoxGeometry(nsHwyLength * 0.95, 0.005, 0.030);
  ewStripeB.translate(cx, CL_BRIDGE_Y + 0.012, cz + 0.045);
  out.push({ geom: ewStripeB, color: CL_YELLOW });
  for (const dz of [-(nsHwyWidth / 2 - 0.020), (nsHwyWidth / 2 - 0.020)]) {
    const shoulder = new BoxGeometry(nsHwyLength * 0.95, 0.005, 0.020);
    shoulder.translate(cx, CL_BRIDGE_Y + 0.012, cz + dz);
    out.push({ geom: shoulder, color: CL_WHITE });
  }

  // ===== BRIDGE RAILS =====
  // Concrete parapet rails along both edges of the upper E-W highway,
  // running the full bridge length. Reads as a real overpass.
  for (const dz of [-(nsHwyWidth / 2 + 0.020), (nsHwyWidth / 2 + 0.020)]) {
    const rail = new BoxGeometry(nsHwyLength * 0.92, 0.10, 0.040);
    rail.translate(cx, CL_BRIDGE_Y + 0.075, cz + dz);
    out.push({ geom: rail, color: CL_BRIDGE_RAIL });
  }

  // ===== BRIDGE PIERS =====
  // 4 stout concrete columns supporting the upper E-W highway over the
  // intersection where it crosses the N-S highway. Placed just outside
  // the N-S highway's edges so they're visually inboard but don't
  // overlap the N-S surface.
  for (const [px, pz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]] as Array<[number, number]>) {
    const pier = new BoxGeometry(0.10, CL_BRIDGE_Y - CL_SURFACE_Y, 0.10);
    pier.translate(cx + px, CL_SURFACE_Y + (CL_BRIDGE_Y - CL_SURFACE_Y) / 2, cz + pz);
    out.push({ geom: pier, color: CL_BRIDGE_PIER });
  }

  // ===== LOOP RAMPS — 4 quadrants =====
  // Each loop is a 270° arc traced by ~12 short box segments. The loop
  // sits inside a 2×2 quadrant area, with radius ~1.3 from quadrant
  // centre. The arc starts at the highway-on side, sweeps around the
  // grass infield, and ends at the highway-off side.
  //
  // Quadrants (offsets from cx,cz to quadrant centre):
  //  NW: (-1.5, -1.5)  // catches N→W and E→S traffic
  //  NE: ( 1.5, -1.5)  // catches N→E and W→S traffic
  //  SW: (-1.5,  1.5)
  //  SE: ( 1.5,  1.5)
  for (const [qcx, qcz, startAngleDeg, endAngleDeg] of [
    [-1.5, -1.5, 0, 270],     // NW — from E side sweeping clockwise
    [1.5, -1.5, 90, 360],     // NE
    [-1.5, 1.5, -90, 180],    // SW
    [1.5, 1.5, 180, 450],     // SE
  ] as Array<[number, number, number, number]>) {
    const radius = 1.05;
    const segments = 12;
    const arcWidth = 0.25;     // ramp width
    for (let s = 0; s < segments; s++) {
      // Interpolate angle along the arc
      const t = s / segments;
      const tNext = (s + 1) / segments;
      const angle = (startAngleDeg + t * (endAngleDeg - startAngleDeg)) * Math.PI / 180;
      const angleNext = (startAngleDeg + tNext * (endAngleDeg - startAngleDeg)) * Math.PI / 180;
      const midAngle = (angle + angleNext) / 2;
      // Mid point of the segment
      const mx = qcx + Math.cos(midAngle) * radius;
      const mz = qcz + Math.sin(midAngle) * radius;
      // Segment length = chord between angle and angleNext
      const segLen = 2 * radius * Math.sin((angleNext - angle) / 2) + 0.02;
      // Tangent direction perpendicular to radius — segment box rotates
      // so its long axis points along the tangent.
      const tangentAngle = midAngle + Math.PI / 2;
      const seg = new BoxGeometry(segLen, 0.020, arcWidth);
      seg.rotateY(tangentAngle);
      seg.translate(cx + mx, CL_SURFACE_Y, cz + mz);
      out.push({ geom: seg, color: CL_ASPHALT_DARK });
      // White shoulder stripe on the OUTER edge of the curve (radial-out)
      const stripeOffsetR = radius + arcWidth / 2 - 0.020;
      const sx = qcx + Math.cos(midAngle) * stripeOffsetR;
      const sz = qcz + Math.sin(midAngle) * stripeOffsetR;
      const stripe = new BoxGeometry(segLen * 0.85, 0.005, 0.020);
      stripe.rotateY(tangentAngle);
      stripe.translate(cx + sx, CL_SURFACE_Y + 0.013, cz + sz);
      out.push({ geom: stripe, color: CL_WHITE });
    }
  }

  // ===== LAMPPOSTS — 4 along the highway shoulders =====
  // Tall lampposts at the perimeter shoulders so the interchange reads
  // as lit/active even at day. Two on each long axis (N-S + E-W).
  for (const [px, pz] of [
    [-(nsHwyWidth / 2 + 0.10), -2.20], [(nsHwyWidth / 2 + 0.10), -2.20],
    [-(nsHwyWidth / 2 + 0.10), 2.20], [(nsHwyWidth / 2 + 0.10), 2.20],
    [-2.20, -(nsHwyWidth / 2 + 0.10)], [-2.20, (nsHwyWidth / 2 + 0.10)],
    [2.20, -(nsHwyWidth / 2 + 0.10)], [2.20, (nsHwyWidth / 2 + 0.10)],
  ] as Array<[number, number]>) {
    const post = new CylinderGeometry(0.020, 0.025, 0.55, 6);
    post.translate(cx + px, CL_SURFACE_Y + 0.275, cz + pz);
    out.push({ geom: post, color: CL_LIGHT_POST });
    const housing = new BoxGeometry(0.08, 0.06, 0.08);
    housing.translate(cx + px, CL_SURFACE_Y + 0.58, cz + pz);
    out.push({ geom: housing, color: CL_LIGHT_POST });
    const bulb = new IcosahedronGeometry(0.038, 1);
    bulb.translate(cx + px, CL_SURFACE_Y + 0.58, cz + pz);
    out.push({ geom: bulb, color: CL_LIGHT_BULB });
  }

  return out;
}
