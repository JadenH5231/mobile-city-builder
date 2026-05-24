/**
 * Coastal Pastel theme (Beta 1.2). Free pack, full-fat: complete asset
 * palette + atmosphere shift + matcap surfaces + additive variants +
 * exclusive monument (Lighthouse).
 *
 * Visual direction: Mediterranean / Aegean coastal village —
 * Santorini, Cinque Terre, Croatian dalmatian coast. Whitewashed
 * stucco walls, cobalt-blue and terracotta-red roofs, turquoise sea,
 * cream-pale sand roads, dusty olive trees, warm dawn sky, golden
 * afternoon haze.
 *
 * The pack is shipped FREE deliberately — it sets the quality bar for
 * future paid packs. Every player on day one experiences theme
 * swapping at premium fidelity, so when a paid pack lands the value
 * proposition is obvious: not "is theme swapping a thing?" but "do I
 * want THIS specific aesthetic too?".
 */

import type { ThemePack } from './types';

export const COASTAL_PASTEL_THEME: ThemePack = {
  id: 'coastal-pastel',
  name: 'Coastal Pastel',
  tagline: 'Sun-bleached Mediterranean village — free with every install.',
  description: 'Whitewashed walls, cobalt and terracotta roofs, turquoise sea, dusty-olive groves, golden-hour skies. Adds 12 new building variants and the Lighthouse landmark. Free, forever.',
  priceUsd: 'free',
  heroSwatch: { primary: 0xf3ecd9, secondary: 0x2fa2b5, accent: 0xd55a3a, mid: 0xf2d49a },

  terrain: {
    // Sun-bleached palette — warm sandy meadow, dusty olive groves,
    // turquoise Aegean. Higher contrast between forest + grass so
    // olive groves still read at a glance.
    grass: 0xc5cf8a,
    forest: 0x7d955e,
    water: 0x37b6c6,
    sand: 0xf3e0b2,
    hillHighlight: 0xd6dba0,
    valleyTint: 0xa9b07b,
    clearColor: 0x4d6e7a
  },

  roads: {
    // Roads become weathered sandstone / cobbled flagstone instead of
    // asphalt — keeps the coastal-village look intact.
    laneStripe: 0xf6e3a8,    // faded ochre paint, gentler than the stock yellow
    sidewalk: 0xe6d7b3,      // pale limestone
    path: 0xd7b78a,           // warm sand
    highwayArrow: 0xf2c275,
    stopSignBody: 0xc25538,   // muted terracotta — still legible as a stop sign
    stopSignText: 0xfff4e2
  },

  buildings: {
    // Residential: whitewashed stucco bodies in a pastel range.
    // Variant builder still applies its own roof palette (handled
    // separately via tint() in the long-tail pass).
    residential: {
      body: [0x000000, 0xf3ead0, 0xe6dcc0, 0xd9c6a3, 0xc8a878]
    },
    // Commercial: pastel awnings + chalk-white walls. Slightly more
    // saturation at higher tiers so downtown still reads as denser.
    commercial: {
      body: [0x000000, 0xf2dcdc, 0xd0a6a6, 0xa07474, 0x7b504f]
    },
    // Industrial: terracotta + warm stone — Mediterranean industry =
    // pottery, olive presses, fishing-net workshops. Not factories.
    industrial: {
      body: [0x000000, 0xd9b48a, 0xb98a5c, 0x956340, 0x6b4530]
    },
    // Mixed-use: shop downstairs (pastel), apartments above (whitewashed).
    mixed: {
      body: [0x000000, 0xefd9c3, 0xc8b8a0, 0x8d8a78, 0x5e6766]
    },
    zoneOverlay: {
      // Overlays stay close to stock's hue families so the paint-mode
      // UI doesn't lose meaning — but shifted toward warm pastel.
      residential: 0x9fd0a3,
      commercial:  0x7ab8d0,
      industrial:  0xeac46f,
      mixed:       0x8acac0
    }
  },

  vehicles: {
    // Soft pastel rainbow — Vespa-and-Fiat-500 flavour.
    cars: [0xf2d09a, 0xf4e6d7, 0xa9d8d0, 0xe9a6a0, 0xb4c890],
    tourist: [0xf6d9a3, 0xf2b27a, 0xc8d99a, 0xf2bedc, 0x9adcd6],
    buses: [0xeacd9a, 0xb8d4d6, 0xf2c9b0],
    pedestrians: [0xf2dcc1, 0xd8c197, 0xb09176, 0xeec4be, 0xc5d2a5],
    windows: 0x2b3a4e,
    headlights: 0xfff4d2,
    taillights: 0xd86850
  },

  flora: {
    // Olive-grove palette — silver-green leaves instead of pine-green.
    trunk: 0x7a604a,
    leaf: 0x96a86a,
    shadow: 0x5a6a48,
    hedge: 0x8a9c64,
    shrub: 0x9aa874,
    plant: 0x96a86a
  },

  beautification: {
    planter: 0xe6d2a8,           // pale terracotta-cream
    bannerPrimary: 0x37b6c6,     // Aegean turquoise
    bannerSecondary: 0xf2c275,
    lampPole: 0x4a3a2e,
    lampBulb: 0xfff0c4,
    tableTop: 0xfff5e6,
    artBronze: 0xb8854a,
    artBase: 0xc8b894,
    flowerA: 0xea6e7a,           // bougainvillea pink
    flowerB: 0xe48c4a            // tangerine
  },

  atmosphere: {
    // Sky shifts toward warm Mediterranean dawn/noon/dusk. Noon zenith
    // is a paler, hazier blue than stock — the sense of a sun-bleached
    // sky rather than a crisp continental one. Dusk lingers in soft
    // peach + lavender.
    skyKeyframes: [
      { p: 0.00, zenith: 0x1c2540, mid: 0x3a3858, horizon: 0x6a4868 },  // midnight
      { p: 0.22, zenith: 0x6a4f96, mid: 0xefa476, horizon: 0xf6c590 },  // dawn
      { p: 0.50, zenith: 0x8ec4dc, mid: 0xd6e6ec, horizon: 0xf4e6cf },  // noon (warm, hazy)
      { p: 0.78, zenith: 0x6a5a96, mid: 0xeaa48a, horizon: 0xf0826c },  // dusk
      { p: 1.00, zenith: 0x1c2540, mid: 0x3a3858, horizon: 0x6a4868 }   // midnight wrap
    ],
    skyMidStop: 0.50,             // mid sits a touch higher → more horizon glow
    // Sun colours: warmer everywhere. Even noon is a touch off-white
    // (the "Greek summer sun" feel).
    sunColorNight: 0x4a5aa0,
    sunColorWarm:  0xf6c290,
    sunColorNoon:  0xfff4dc,
    sunIntensityNight: 0.16,
    sunIntensityDay:   0.95,       // brighter daylight — Mediterranean is sun-soaked
    ambientIntensityNight: 0.22,
    ambientIntensityDay:   0.70,
    hemiSkyDay:    0xd9ecf2,       // soft turquoise overhead
    hemiGroundDay: 0xd6c89a,       // warm sand reflecting up
    hemiSkyNight:    0x404870,
    hemiGroundNight: 0x1a1c28,
    // Gentle haze — perceptual depth without losing low-poly clarity.
    fog: { color: 0xefe1c2, density: 0.0028 }
  },

  matcaps: {
    // Whitewashed stucco — soft, chalky, slight subsurface warmth.
    stucco: {
      highlight: 0xfff8e8,
      base:      0xf2e8d4,
      rim:       0xc5a78a,
      glossiness: 0.18
    },
    // Glossy Aegean water — bright highlight reads as sun glint.
    water: {
      highlight: 0xffffff,
      base:      0x37b6c6,
      rim:       0x186870,
      glossiness: 0.42
    },
    // Glass on commercial / skyscraper podiums — soft warm tint.
    glass: {
      highlight: 0xfff2d8,
      base:      0xbdd0d8,
      rim:       0x495c66,
      glossiness: 0.35
    },
    // Polished metal — slightly warm chrome instead of cool.
    metal: {
      highlight: 0xfff0d0,
      base:      0xd0c8b8,
      rim:       0x6a6258,
      glossiness: 0.30
    }
  },

  // Long-tail filter: gently warm + soften every colour the renderer
  // hasn't been individually re-authored for. Coastal Pastel = subtle
  // saturation drop, gentle lightness lift, blend toward warm cream.
  // Strength is deliberately moderate so explicit palette colours
  // dominate while everything still feels of-a-piece.
  moodTint: {
    toward: 0xfff0d0,    // warm cream
    strength: 0.18,
    saturationMul: 0.82,
    lightnessMul: 1.05
  },

  // Additive variants — variety only grows. Each entry adds a new
  // building variant to the (zone × tier) pool without removing any
  // stock variant. Weights are tuned so themed variants appear a
  // little more often than stock when the theme is active (so the
  // city visually shifts), but stock still shows up regularly to
  // preserve the original variety the player paid for.
  extraVariants: [
    { zone: 'residential', tier: 1, weight: 1.5, variantId: 'coastal-whitewashed-villa' },
    { zone: 'residential', tier: 1, weight: 1.2, variantId: 'coastal-terracotta-cottage' },
    { zone: 'residential', tier: 2, weight: 1.5, variantId: 'coastal-stacked-stucco' },
    { zone: 'residential', tier: 3, weight: 1.2, variantId: 'coastal-pastel-apartments' },
    { zone: 'commercial',  tier: 1, weight: 1.4, variantId: 'coastal-awning-shop' },
    { zone: 'commercial',  tier: 2, weight: 1.2, variantId: 'coastal-cafe-terrace' },
    { zone: 'commercial',  tier: 3, weight: 1.0, variantId: 'coastal-harbour-warehouse' },
    { zone: 'industrial',  tier: 1, weight: 1.2, variantId: 'coastal-fishing-cannery' },
    { zone: 'industrial',  tier: 2, weight: 1.0, variantId: 'coastal-olive-press' },
    { zone: 'mixed',       tier: 1, weight: 1.4, variantId: 'coastal-shop-and-flat' },
    { zone: 'mixed',       tier: 2, weight: 1.2, variantId: 'coastal-balconied-mixed' },
    { zone: 'mixed',       tier: 3, weight: 1.0, variantId: 'coastal-courtyard-block' }
  ],

  exclusiveMonument: {
    id: 'lighthouse',
    label: 'Lighthouse',
    cost: 35000,
    upkeep: 200,
    footprint: { w: 1, h: 1 },
    milestone: 'city'
  }
};
