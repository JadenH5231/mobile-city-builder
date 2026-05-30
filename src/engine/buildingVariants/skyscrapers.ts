import { BoxGeometry, ConeGeometry, CylinderGeometry } from 'three';
import type { VariantPart } from './types';
import { emitConstructionStage } from './construction';

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
  // Beta 1.6.19 — shrink body height by 0.02 so its top face sits below
  // any crown geometry (which sits at y ∈ [top - crownH, top] on every
  // crownStyle). Pre-1.6.19 body's top face was at y=top, same as the
  // crown's top face → coplanar → z-fighting that flickered with camera
  // movement. The 0.02 reduction is invisible at gameplay zoom but
  // gives the depth buffer a clear winner.
  const bodyH = height - 0.02;
  const body = new BoxGeometry(innerW, bodyH, innerD);
  body.translate(cx, yBase + bodyH / 2, cz);
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

/* ----------------------------------------------------------------------------
 * Skyscraper construction stages (Alpha 4.23)
 *
 * Four progressively richer stages reading as a real construction site:
 *   stage 0 — Site prep:    foundation pit + formwork + trailer + materials
 *                           + concrete mixer + half-erected starter crane.
 *   stage 1 — Lower floors: stacked concrete floor plates + corner columns
 *                           + rebar sticking from the top + construction
 *                           lift on the side + full-height tower crane.
 *   stage 2 — Steel skeleton: lower podium of concrete + steel I-beam grid
 *                            above + scaffolding wrap + safety tarp on
 *                            one face + 2 cranes (peak structural work).
 *   stage 3 — Facade going up: most of the tower has facade + windows;
 *                              the top section is still bare steel +
 *                              scaffolding; one crane near the top +
 *                              construction lift still on the side.
 *
 * Common across all four: orange-and-white site fence around the 2×2
 * footprint perimeter (with a small entry gap). Same palette (concrete,
 * steel, crane yellow, hi-vis orange) so the four stages feel like one
 * continuous build rather than four unrelated assemblies.
 * ---------------------------------------------------------------------- */

// Construction palette — kept as constants so the four stages share a look.
