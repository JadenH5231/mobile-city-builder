import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry
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
export function buildVariantParts(zone: Zone, density: number, tileX: number, tileY: number): VariantPart[] {
  if (zone === 'none' || density <= 0) return [];
  const variants = VARIANTS[zone]?.[density as 1 | 2 | 3];
  if (!variants || variants.length === 0) return [];
  // Deterministic variant pick — same tile always renders the same variant.
  const variantIdx = pickVariant(tileX, tileY, variants.length);
  const spec = variants[variantIdx]!;

  // Tiny deterministic jitter and rotation so a row of identical-variant
  // tiles still reads as individual buildings rather than a stamp.
  const r = Math.abs(((tileX * 374761393) ^ (tileY * 668265263)) | 0);
  const ox = ((r % 1000) / 1000 - 0.5) * 0.05;
  const oz = (((r >> 10) % 1000) / 1000 - 0.5) * 0.05;
  const yaw = ((r >> 20) & 3) * (Math.PI / 2);

  const cx = tileX + 0.5 + ox;
  const cz = tileY + 0.5 + oz;

  const out: VariantPart[] = [];
  applySpec(spec, cx, cz, yaw, out, zone, tileX, tileY);
  return out;
}

function pickVariant(x: number, y: number, n: number): number {
  // Same hash family as the building jitter and tree placement.
  const h = Math.abs(((x * 2654435761) ^ (y * 1597334677)) | 0);
  return h % n;
}

function applySpec(
  spec: Spec, cx: number, cz: number, yaw: number, out: VariantPart[],
  zone: Zone, tileX: number, tileY: number
): void {
  // Body 1.
  emitBody(spec.body, cx, cz, yaw, out);
  if (spec.roof && spec.roof.kind !== 'flat') {
    emitRoof(spec.body, spec.roof, cx, cz, yaw, out);
  }
  // Facade detail (Alpha 2.2) — windows + ground-floor treatment for
  // R/C/MU. Industrial bodies stay windowless to read as warehouses /
  // factories. Tower decorations are facaded too further down.
  if (zoneShowsWindows(zone)) {
    emitFacade(spec.body, cx, cz, yaw, out, zone, tileX, tileY, /*isPodium*/ false);
  }
  if (spec.body2) {
    emitBody(spec.body2, cx, cz, yaw, out);
    if (zoneShowsWindows(zone)) {
      // body2 is conventionally the podium / shop wing on mixed-use, so
      // it always gets the shopfront treatment regardless of which body
      // is "lower" — mixed-use authors body2 with that intent.
      emitFacade(spec.body2, cx, cz, yaw, out, zone, tileX, tileY, /*isPodium*/ zone === 'mixed');
    }
  }
  if (!spec.decorations) return;
  for (const dec of spec.decorations) {
    switch (dec.kind) {
      case 'chimney': emitChimney(dec, spec.body, cx, cz, yaw, out); break;
      case 'antenna': emitAntenna(dec, spec.body, spec.roof, cx, cz, out); break;
      case 'tower':
        emitTower(dec, spec.body, cx, cz, yaw, out);
        // Setback towers also get window banding when they're R/C/MU —
        // a high-rise residence without windows reads as a blank slab.
        if (zoneShowsWindows(zone)) {
          emitTowerFacade(dec, spec.body, cx, cz, yaw, out, tileX, tileY);
        }
        break;
      case 'awning': emitAwning(dec, spec.body, cx, cz, yaw, out); break;
      case 'sign': emitSign(dec, spec.body, cx, cz, yaw, out); break;
      case 'tank': emitTank(dec, cx, cz, out); break;
      case 'stack': emitStack(dec, cx, cz, out); break;
      case 'crane': emitCrane(dec, cx, cz, out); break;
    }
  }
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
    g.computeVertexNormals();
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

type VariantTable = Record<Exclude<Zone, 'none'>, Record<1 | 2 | 3, Spec[]>>;

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
      }
    ]
  }
};
