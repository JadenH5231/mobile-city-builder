/**
 * Building-variant geometry kit (Alpha 2.1, split into modules in Beta 1.7).
 *
 * This file is now a thin barrel: the ~5,200-line monolith was split into
 * focused modules under `./buildingVariants/` so each chunk of the kit is
 * independently navigable. The public API is unchanged — every symbol the
 * renderer imported from './BuildingVariants' is re-exported here.
 *
 *   buildingVariants/types.ts        — the shared VariantPart output type
 *   buildingVariants/core.ts         — zoned R/C/I/MU spec table + emit
 *                                      toolkit + buildVariantParts +
 *                                      getVariantBodyFootprint + luxury
 *   buildingVariants/skyscrapers.ts  — skyscraper designs + builders
 *   buildingVariants/construction.ts — 4-stage construction-site emitters
 *   buildingVariants/monuments.ts    — civic monuments (mansion / city hall
 *                                      / provincial / national / cloverleaf)
 *
 * Dependency DAG (no cycles): types ← core, types ← construction ←
 * skyscrapers, types ← monuments.
 */

export type { VariantPart } from './buildingVariants/types';
export {
  buildVariantParts,
  getVariantBodyFootprint,
  buildLuxuryParts
} from './buildingVariants/core';
export type { SkyscraperDesign } from './buildingVariants/skyscrapers';
export {
  getSkyscraperDesign,
  buildSkyscraperParts
} from './buildingVariants/skyscrapers';
export {
  buildMayorMansionParts,
  buildCityHallParts,
  buildProvincialCapitalParts,
  buildNationalCapitalParts,
  buildCloverleafParts
} from './buildingVariants/monuments';
