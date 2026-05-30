import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry
} from 'three';
import type { Zone } from '../../types';
import type { VariantPart } from './types';

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
 * World-space body footprint for the variant a given tile will actually
 * render. Used by Renderer's lit-windows pass (Beta 1.6.17) so the
 * night-time window quads sit exactly on the building's faces — pre-
 * 1.6.17 they used a hardcoded halfW=0.30 that didn't match variant
 * body dimensions, so windows floated 0.02–0.10 tile off small variants
 * and hid 0.06+ inside large ones (especially L3+ where body.w grows
 * to 0.80).
 *
 * Duplicates the same `pickVariant` / jitter / yaw resolution as
 * `buildVariantParts` so a window placement query always agrees with the
 * actual body that emitBody pushes for the same tile. Returns `null` for
 * tiles that have no variant (zone=none, density=0, or no variants
 * registered for the zone/density pair).
 */
export function getVariantBodyFootprint(
  zone: Zone, density: number, tileX: number, tileY: number,
  yawOverride?: number
): { cx: number; cz: number; halfX: number; halfZ: number; height: number } | null {
  if (zone === 'none' || density <= 0) return null;
  const variants = VARIANTS[zone]?.[density as 1 | 2 | 3 | 4];
  if (!variants || variants.length === 0) return null;
  const variantIdx = pickVariant(tileX, tileY, variants.length);
  const spec = variants[variantIdx]!;
  // Same hash + jitter formula as buildVariantParts above.
  const r = Math.abs(((tileX * 374761393) ^ (tileY * 668265263)) | 0);
  const ox = ((r % 1000) / 1000 - 0.5) * 0.05;
  const oz = (((r >> 10) % 1000) / 1000 - 0.5) * 0.05;
  const yaw = yawOverride !== undefined
    ? yawOverride
    : ((r >> 20) & 3) * (Math.PI / 2);
  // Quantised yaw: 0/2 → body's w runs along world-X; 1/3 → swapped.
  const yawIdx = Math.round(yaw / (Math.PI / 2)) & 3;
  const halfX = (yawIdx & 1) ? spec.body.d / 2 : spec.body.w / 2;
  const halfZ = (yawIdx & 1) ? spec.body.w / 2 : spec.body.d / 2;
  return {
    cx: tileX + 0.5 + ox,
    cz: tileY + 0.5 + oz,
    halfX, halfZ,
    height: spec.body.h
  };
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

