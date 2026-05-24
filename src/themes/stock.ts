/**
 * Stock theme (Beta 1.2). The original art direction frozen as a
 * `ThemePack` so the renderer can read from a uniform interface even
 * when no alternate pack is active. Identity tint (`strength: 0`)
 * means calling `tint(hex)` on a stock-themed scene returns the input
 * unchanged.
 *
 * **Source-of-truth fidelity**: every hex in this file was copied
 * directly from the values previously hardcoded in `Renderer.ts`,
 * `BuildingVariants.ts`, and `types.ts` as of Beta 1.1.6. Swapping the
 * stock theme should produce a pixel-identical scene to pre-themes.
 */

import type { ThemePack } from './types';

export const STOCK_THEME: ThemePack = {
  id: 'stock',
  name: 'Original',
  tagline: 'The launch look — vivid greens, deep blues, big city energy.',
  description: 'The chunky low-poly aesthetic MQ City Builder shipped with. Bright greens for the countryside, classic asphalt and sidewalks, North-American skyline. Always free.',
  priceUsd: 'free',
  heroSwatch: { primary: 0x6aa84f, secondary: 0x2c6fa8, accent: 0xeec453 },

  terrain: {
    grass: 0x6aa84f,
    forest: 0x4d8442,
    water: 0x2c6fa8,
    sand: 0xddc174,
    hillHighlight: 0x7bb558,
    valleyTint: 0x5d9744,
    clearColor: 0x1a2722
  },

  roads: {
    laneStripe: 0xf2cd5c,
    sidewalk: 0xc7c2b3,
    path: 0xb89a6c,
    highwayArrow: 0xf2cd5c,
    stopSignBody: 0xc83838,
    stopSignText: 0xffffff
  },

  buildings: {
    residential: {
      body: [0x000000, 0xd9c89e, 0xb89970, 0x8a6f4e, 0x7a5e3e]
    },
    commercial: {
      body: [0x000000, 0xc0d4ec, 0x7a92b5, 0x52688a, 0x3e4e6e]
    },
    industrial: {
      body: [0x000000, 0xb0a080, 0x7e6e58, 0x584c3a, 0x453a2c]
    },
    mixed: {
      body: [0x000000, 0xc8b294, 0x8d92a4, 0x4f5e7a, 0x3e4a64]
    },
    zoneOverlay: {
      residential: 0x6dd06a,
      commercial: 0x4d8ce8,
      industrial: 0xeec453,
      mixed: 0x5cc4ad
    }
  },

  vehicles: {
    cars: [0xd06464, 0x6da5d6, 0x76c876, 0xf2cd5c, 0xb678d6],
    tourist: [0xf0c060, 0xe88a4d, 0xb8d068, 0xeac4e2, 0x6bc4c8],
    buses: [0xe96b3d, 0x4d8eb9, 0xb6c7c8],
    pedestrians: [0xeac984, 0xb38f5b, 0x8e6e4a, 0xd8a4a4, 0x9bb685],
    windows: 0x1a2434,
    headlights: 0xfff4c0,
    taillights: 0xd83838
  },

  flora: {
    trunk: 0x6e3e1d,
    leaf: 0x2f6a2d,
    shadow: 0x2a3a22,
    hedge: 0x4a6b3a,
    shrub: 0x4f6b3a,
    plant: 0x4d8c3a
  },

  beautification: {
    planter: 0x6e4622,
    bannerPrimary: 0xd84545,
    bannerSecondary: 0x4d8eb9,
    lampPole: 0x222a32,
    lampBulb: 0xf2cd5c,
    tableTop: 0xe8e2d4,
    artBronze: 0x8c6a3a,
    artBase: 0x8a857a,
    flowerA: 0xd84545,
    flowerB: 0xa75ad4
  },

  atmosphere: {
    skyKeyframes: [
      { p: 0.00, zenith: 0x141a35, mid: 0x2a2c4a, horizon: 0x4a3a5a },
      { p: 0.22, zenith: 0x4a4f8a, mid: 0xc6886a, horizon: 0xe8a060 },
      { p: 0.50, zenith: 0x5d96d4, mid: 0xa4caea, horizon: 0xe6d8be },
      { p: 0.78, zenith: 0x3a4a8a, mid: 0xa66a8a, horizon: 0xe06850 },
      { p: 1.00, zenith: 0x141a35, mid: 0x2a2c4a, horizon: 0x4a3a5a }
    ],
    skyMidStop: 0.55,
    sunColorNight: 0x4060c0,
    sunColorWarm:  0xf0a060,
    sunColorNoon:  0xffffff,
    sunIntensityNight: 0.18,
    sunIntensityDay:   0.85,
    ambientIntensityNight: 0.20,
    ambientIntensityDay:   0.65,
    hemiSkyDay:    0xbcd9ff,
    hemiGroundDay: 0x223322,
    hemiSkyNight:    0x303860,
    hemiGroundNight: 0x101820
    // No fog in stock — chunky low-poly reads clean at any distance.
  },

  // Identity tint: stock theme is a no-op for the long-tail filter.
  moodTint: {
    toward: 0xffffff,
    strength: 0,
    saturationMul: 1.0,
    lightnessMul: 1.0
  }
};
