import type { Grid } from '../world/Grid';
import { SERVICE_RADIUS } from '../types';

/**
 * Service-coverage sweep. Walks every placed building, brute-force flips the
 * `hasPower / hasWater / hasPark` flags on tiles within Chebyshev radius. The
 * full pass is O(buildings × radius²) — at the radii we use (≤ 8) this is
 * cheap even on a fully-built Medium map.
 *
 * Spec note: power and water are deliberately radius checks, not a network
 * graph. The anti-goal here is "no elaborate pipes/wires the player has to
 * babysit" — coverage is binary, present or absent.
 */
export class Services {
  recompute(grid: Grid): void {
    // Phase 1 — clear all flags. Cheap full sweep; alternative (track dirty
    // buildings + radii) wasn't worth the bookkeeping at prototype scale.
    for (const t of grid.iter()) t.resetServices();

    // Phase 2 — for each placed service building, paint its coverage circle.
    for (const t of grid.iter()) {
      if (t.building === 'none') continue;
      switch (t.building) {
        case 'power_plant':
          this.paint(grid, t.x, t.y, SERVICE_RADIUS.power, 'power');
          break;
        case 'water_tower':
          this.paint(grid, t.x, t.y, SERVICE_RADIUS.water, 'water');
          break;
        case 'park':
          this.paint(grid, t.x, t.y, SERVICE_RADIUS.park, 'park');
          break;
        // Public services pack (Alpha 2.10).
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
        // bus_stop / bus_depot don't grant services — they're handled by Buses.
        default:
          break;
      }
    }
  }

  private paint(
    grid: Grid, cx: number, cy: number, radius: number,
    kind: 'power' | 'water' | 'park' | 'school' | 'hospital' | 'fire' | 'police'
  ): void {
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
        if (kind === 'power') t.hasPower = true;
        else if (kind === 'water') t.hasWater = true;
        else if (kind === 'park') t.hasPark = true;
        else if (kind === 'school') t.hasSchool = true;
        else if (kind === 'hospital') t.hasHospital = true;
        else if (kind === 'fire') t.hasFireProtection = true;
        else t.hasPolice = true;
      }
    }
  }
}
