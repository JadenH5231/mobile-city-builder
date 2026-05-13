import type { Grid } from '../world/Grid';
import {
  CIVIC_MONUMENT_SERVICE_RADIUS,
  POWER_PLANT_CAPACITY,
  SERVICE_RADIUS,
  WATER_TOWER_CAPACITY
} from '../types';

/**
 * Service-coverage sweep.
 *
 * **Power + water (Alpha 3.1.4)**: city-wide demand-based. Total city
 * demand = number of zoned tiles (existing or developing). Total supply
 * = number of plants × per-plant capacity. If supply ≥ demand, every
 * tile in the city has power/water; otherwise nobody does. The "build
 * 5 power plants spread across town" minigame is gone — the player
 * just needs enough generation to keep up. Distance no longer matters.
 *
 * **Parks (Alpha 3.1.4)**: still radius-based but bumped to 10 tiles
 * (was 3) so a single park covers a meaningful neighbourhood. L3
 * unlock still requires hasPark coverage, but the player isn't forced
 * to dot a park every 6 tiles to make it work.
 *
 * **Public services pack** (school / hospital / fire / police): unchanged
 * radius-based behaviour from Alpha 2.10.
 */
export class Services {
  /** True iff total power supply ≥ total power demand (Alpha 3.1.4). */
  cityHasPower = false;
  /** True iff total water supply ≥ total water demand. */
  cityHasWater = false;
  /** Capacity stats surfaced to UI: how much we have vs how much we need. */
  powerSupply = 0;
  powerDemand = 0;
  waterSupply = 0;
  waterDemand = 0;

  recompute(grid: Grid): void {
    // Phase 1 — clear all flags. Cheap full sweep; alternative (track dirty
    // buildings + radii) wasn't worth the bookkeeping at prototype scale.
    for (const t of grid.iter()) t.resetServices();

    // Phase 2a — count plants + zoned tiles. Both are aggregate, so we
    // build the city-wide power/water verdict before the per-tile pass.
    let powerPlants = 0;
    let waterTowers = 0;
    let demand = 0;
    for (const t of grid.iter()) {
      if (t.building === 'power_plant') powerPlants++;
      else if (t.building === 'water_tower') waterTowers++;
      // Demand = any zoned tile (developed or developing). Skyscrapers
      // count as 4 (they're a 2×2 footprint with 4 tiles each marked).
      if (t.zone !== 'none') demand++;
    }
    this.powerSupply = powerPlants * POWER_PLANT_CAPACITY;
    this.waterSupply = waterTowers * WATER_TOWER_CAPACITY;
    this.powerDemand = demand;
    this.waterDemand = demand;
    this.cityHasPower = this.powerSupply >= demand;
    this.cityHasWater = this.waterSupply >= demand;

    // Phase 2b — per-building paint pass for the radius-based services
    // (parks + public-services pack). Power + water are applied in bulk
    // at the end of this method.
    for (const t of grid.iter()) {
      if (t.building === 'none') continue;
      switch (t.building) {
        case 'park':
          this.paint(grid, t.x, t.y, SERVICE_RADIUS.park, 'park');
          break;
        case 'school':
          this.paint(grid, t.x, t.y, SERVICE_RADIUS.school, 'school');
          break;
        case 'hospital':
          this.paint(grid, t.x, t.y, SERVICE_RADIUS.hospital, 'hospital');
          break;
        case 'fire_station':
          this.paint(grid, t.x, t.y, SERVICE_RADIUS.fire, 'fire');
          break;
        case 'police_station':
          this.paint(grid, t.x, t.y, SERVICE_RADIUS.police, 'police');
          break;
        // power_plant / water_tower handled in the city-wide pass below.
        // bus_stop / bus_depot don't grant services — handled by Buses.
        default:
          break;
      }
    }

    // Phase 3 — apply the city-wide power/water verdict to every tile.
    // Cheap sweep; only sets flags on zoned tiles since that's where they
    // matter (development cap, mood penalty).
    if (this.cityHasPower || this.cityHasWater) {
      for (const t of grid.iter()) {
        if (t.zone === 'none') continue;
        if (this.cityHasPower) t.hasPower = true;
        if (this.cityHasWater) t.hasWater = true;
      }
    }

    // Phase 4 — civic monument service field (Alpha 4.12). Every
    // developed tile within 35 tiles of a City Hall / Provincial
    // Capital / National Capital anchor gets power + water + park flags
    // set unconditionally. This lets a single civic build "anchor" a
    // dense central district — the player doesn't have to scatter
    // utilities through downtown if they invested in a city hall.
    // Each is single-instance, so the inner sweep cost is bounded.
    for (const t of grid.iter()) {
      if (t.building !== 'city_hall'
          && t.building !== 'provincial_capital'
          && t.building !== 'national_capital') continue;
      this.paintCivicField(grid, t.x, t.y);
    }
  }

  /** Apply the unconditional L3 service field (power + water + park)
   *  around a civic monument anchor (Alpha 4.12). Radius is
   *  CIVIC_MONUMENT_SERVICE_RADIUS in tiles. Flips ALL three flags on
   *  every tile inside the disc — not just zoned ones — so a tile that
   *  later develops still sees the coverage. */
  private paintCivicField(grid: Grid, cx: number, cy: number): void {
    const r = CIVIC_MONUMENT_SERVICE_RADIUS;
    const r2 = r * r;
    const minX = Math.max(0, cx - r);
    const maxX = Math.min(grid.width - 1, cx + r);
    const minY = Math.max(0, cy - r);
    const maxY = Math.min(grid.height - 1, cy + r);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const t = grid.get(x, y)!;
        t.hasPower = true;
        t.hasWater = true;
        t.hasPark = true;
      }
    }
  }

  private paint(
    grid: Grid, cx: number, cy: number, radius: number,
    kind: 'park' | 'school' | 'hospital' | 'fire' | 'police'
  ): void {
    if (!isFinite(radius)) return; // city-wide kinds (power/water) don't paint
    const r2 = radius * radius;
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(grid.width - 1, cx + radius);
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(grid.height - 1, cy + radius);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const t = grid.get(x, y)!;
        if (kind === 'park') t.hasPark = true;
        else if (kind === 'school') t.hasSchool = true;
        else if (kind === 'hospital') t.hasHospital = true;
        else if (kind === 'fire') t.hasFireProtection = true;
        else t.hasPolice = true;
      }
    }
  }
}
