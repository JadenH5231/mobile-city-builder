/**
 * Theme-pack types (Beta 1.2). A `ThemePack` is the single source of
 * truth for every visual constant the renderer reads. The renderer no
 * longer hardcodes `0xHHHHHH` — it reads from `getActiveTheme()`.
 *
 * Design constraints:
 *  - **Every asset matches**: the explicit fields cover the dominant
 *    surfaces (terrain, sky, roads, buildings, vehicles, trees,
 *    lights). For unmigrated literals (skyscraper subdetails, service
 *    building accents, etc.), the theme exposes `tint(hex)` — a
 *    perceptual blend toward the theme's mood tone — so EVERYTHING
 *    reads cohesively even where individual colours haven't been
 *    re-authored.
 *  - **Variety never decreases, only grows**: themes can append
 *    `extraVariants` and `exclusiveMonument` definitions; they cannot
 *    remove or override stock variants.
 *  - **Free first pack is full-fat**: Coastal Pastel ships at the same
 *    tier as future paid packs — atmosphere + matcap-style materials
 *    + 1 exclusive monument + full asset coverage.
 */

import type { Zone } from '../types';

/* ---- Palette pieces -------------------------------------------------- */

export interface TerrainPalette {
  grass: number;
  forest: number;
  water: number;
  sand: number;
  hillHighlight: number;
  valleyTint: number;
  /** Backdrop colour BEHIND the sky gradient when the gradient is partial. */
  clearColor: number;
}

export interface RoadPalette {
  /** Centre-line / lane stripe colour. */
  laneStripe: number;
  /** Sidewalk strip colour. */
  sidewalk: number;
  /** Walking-path tile colour. */
  path: number;
  /** Highway arrow colour. */
  highwayArrow: number;
  /** Stop-sign body + text. */
  stopSignBody: number;
  stopSignText: number;
}

export interface ZonePaletteTier {
  /** Index 0 unused; 1..4 = density tiers low/med/high/L4 + skyscraper-podium. */
  body: readonly [number, number, number, number, number];
  /** Optional roof palette per tier (5 entries; 0 unused). When absent, the
   *  building variant's hardcoded roof palette is used. */
  roof?: readonly [number, number, number, number, number];
}

export interface BuildingZonePalettes {
  residential: ZonePaletteTier;
  commercial: ZonePaletteTier;
  industrial: ZonePaletteTier;
  mixed: ZonePaletteTier;
  /** Zone-overlay colour shown while paint-mode is active. */
  zoneOverlay: Record<Exclude<Zone, 'none'>, number>;
}

export interface VehiclePalette {
  /** Base body palette used for civilian cars. */
  cars: readonly number[];
  /** Tourist-car palette (Vehicles.ts). */
  tourist: readonly number[];
  /** Bus body palette. */
  buses: readonly number[];
  /** Pedestrian clothing palette. */
  pedestrians: readonly number[];
  windows: number;
  headlights: number;
  taillights: number;
}

export interface FloraPalette {
  trunk: number;
  leaf: number;
  shadow: number;
  /** Hedge / shrub greens used in beautification + parks. */
  hedge: number;
  shrub: number;
  /** Generic potted-plant green. */
  plant: number;
}

export interface BeautificationPalette {
  planter: number;
  bannerPrimary: number;
  bannerSecondary: number;
  lampPole: number;
  lampBulb: number;
  tableTop: number;
  artBronze: number;
  artBase: number;
  flowerA: number;
  flowerB: number;
}

/* ---- Atmosphere ------------------------------------------------------ */

export interface SkyKeyframe {
  /** Phase (0..1) — 0 = midnight, 0.5 = noon. */
  p: number;
  zenith: number;
  mid: number;
  horizon: number;
}

export interface AtmosphereConfig {
  /** 5-stop sky gradient that loops over the day cycle. */
  skyKeyframes: readonly SkyKeyframe[];
  /** Where the mid stop sits in the canvas paint (0..1). Stock = 0.55. */
  skyMidStop: number;
  /** Sun light colour at deep night, dawn/dusk warm, and noon. */
  sunColorNight: number;
  sunColorWarm: number;
  sunColorNoon: number;
  /** Sun intensity bounds. */
  sunIntensityNight: number;
  sunIntensityDay: number;
  /** Ambient light intensity bounds. */
  ambientIntensityNight: number;
  ambientIntensityDay: number;
  /** Hemisphere light sky/ground colours by day phase. */
  hemiSkyDay: number;
  hemiGroundDay: number;
  hemiSkyNight: number;
  hemiGroundNight: number;
  /** Optional fog colour + density. Stock has no fog. */
  fog?: { color: number; density: number };
}

/* ---- Matcap / surface materials ------------------------------------- */

/**
 * A matcap reference. The renderer uses these to add the *perception*
 * of polished / glossy / chalky surfaces without UV-unwrapping
 * geometry. The texture itself is generated at runtime via a procedural
 * canvas gradient — no asset bloat.
 */
export interface MatcapSpec {
  /** Centre highlight colour (the "sun glint" on the matcap sphere). */
  highlight: number;
  /** Mid base colour (the body of the matcap sphere). */
  base: number;
  /** Rim shadow colour (the edge of the matcap sphere). */
  rim: number;
  /** Width of the highlight, 0..1. Higher = glossier. */
  glossiness: number;
}

export interface MatcapSet {
  /** Whitewashed-stucco / chalky surface (walls of beachside houses). */
  stucco?: MatcapSpec;
  /** Glossy water (mediterranean turquoise). */
  water?: MatcapSpec;
  /** Glossy glass (curtain walls, skyscraper facades). */
  glass?: MatcapSpec;
  /** Polished metal (vehicle bodies, urban accents). */
  metal?: MatcapSpec;
}

/* ---- Additive variants (variety never decreases) -------------------- */

/**
 * Themes can ADD building variants to specific (zone × density) cells.
 * They cannot remove or replace stock variants. At build time the
 * renderer's variant picker draws from `stockVariants ++ extraVariants`,
 * so every paint stroke can roll any variant from either set.
 */
export interface ThemeVariantOverride {
  zone: Zone;
  /** Density tier this variant slots into (1..4). */
  tier: 1 | 2 | 3 | 4;
  /** Probability weight relative to stock variants. Stock variants
   *  have weight 1; setting this to 1 means "themed variants are
   *  equally likely as stock"; 2 = themed twice as likely; 0.5 = half.
   *  Pure additive — never removes a stock variant from the pool. */
  weight: number;
  /** Identifier passed to the BuildingVariants builder so it knows
   *  which themed variant to render. The builder dispatches on this
   *  string the same way it currently dispatches on numeric variant
   *  indices for stock. */
  variantId: string;
}

/* ---- Exclusive monument --------------------------------------------- */

/**
 * Each theme MAY ship a single exclusive landmark — placed via the
 * normal monument toolbar but only present when the theme is active.
 * Variety addition only — it adds, never removes.
 */
export interface ThemeMonument {
  /** Toolbar id — must be unique across themes. */
  id: string;
  /** Label in the monument popover. */
  label: string;
  /** Cost in $. */
  cost: number;
  /** Monthly upkeep in $. */
  upkeep: number;
  /** Footprint W×H in tiles. */
  footprint: { w: number; h: number };
  /** Milestone tier needed to unlock. */
  milestone: 'town' | 'city' | 'metro' | 'capital';
}

/* ---- Hero swatch for the picker UI ---------------------------------- */

export interface ThemeHeroSwatch {
  primary: number;
  secondary: number;
  accent: number;
  /** Optional gradient mid for the swatch — defaults to a midpoint blend. */
  mid?: number;
}

/* ---- The pack itself ------------------------------------------------- */

export interface ThemePack {
  /** Stable id — used as the localStorage value + future SKU. */
  id: string;
  /** Display name in the picker. */
  name: string;
  /** Short marketing line below the name in the picker. */
  tagline: string;
  /** Longer description shown when the card is focused / pressed. */
  description: string;
  /** Free for v1; future paid packs set a USD price. */
  priceUsd: number | 'free';
  /** Stripe SKU once paid packs ship. Free packs use the id directly. */
  sku?: string;

  /** Hero colour swatch for the picker. */
  heroSwatch: ThemeHeroSwatch;

  /** Explicit asset palettes — the dominant 80% of visual surface. */
  terrain: TerrainPalette;
  roads: RoadPalette;
  buildings: BuildingZonePalettes;
  vehicles: VehiclePalette;
  flora: FloraPalette;
  beautification: BeautificationPalette;
  atmosphere: AtmosphereConfig;
  matcaps?: MatcapSet;

  /** Mood-tint config — applied via `theme.tint(hex)` to colour
   *  constants the renderer hasn't been migrated to read explicitly.
   *  Ensures the long tail of detail colours still reads as part of
   *  the theme. Stock theme uses strength=0 (identity). */
  moodTint: {
    /** Colour to blend toward (warm cream for Mediterranean, neon
     *  magenta for Tokyo Neon, sepia for Industrial, etc.) */
    toward: number;
    /** Blend strength 0..1. Coastal Pastel = ~0.18 (subtle but
     *  perceptible). Tokyo Neon could be higher. Stock = 0. */
    strength: number;
    /** HSL saturation multiplier applied BEFORE the blend. Coastal
     *  Pastel desaturates slightly (0.85); Tokyo Neon would push
     *  saturation up (1.20). Stock = 1.0. */
    saturationMul: number;
    /** Lightness adjust 0..1 — lifts shadows. Coastal Pastel = 1.05
     *  (subtle lift). Stock = 1.0. */
    lightnessMul: number;
  };

  /** Additive building variants — variety only grows. */
  extraVariants?: readonly ThemeVariantOverride[];

  /** Optional pack-exclusive monument. */
  exclusiveMonument?: ThemeMonument;
}
