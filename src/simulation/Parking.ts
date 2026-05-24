/**
 * Parking simulation (Beta 1.3 Phase 2). Tracks per-tile parking
 * stalls, allocates them to cars on spawn, frees them when the car
 * leaves (visit timer expires, or the parking_lot tile is bulldozed).
 *
 * Stall layout per `parking_lot` tile (6 stalls = 2 rows × 3 stalls):
 *
 *   z = -0.30:  [A] [B] [C]   ← back row, cars face -z (yaw = π)
 *               -------
 *               (median)
 *               -------
 *   z = +0.30:  [D] [E] [F]   ← front row, cars face +z (yaw = 0)
 *               x = -0.32, 0, +0.32
 *
 * Stall positions match the painted stripes emitted by
 * `emitParkingTile()` in Renderer.ts — cars visually align with the
 * paint.
 *
 * The registry is bootstrapped by walking the grid for `parking_lot`
 * tiles whenever the structure changes (`rebuild(grid)`), so we never
 * have stale stalls referring to bulldozed tiles. Reservations carry a
 * back-pointer to the tile so we can fully revoke when the tile dies.
 */

import type { Grid } from '../world/Grid';
import { TILE_SIZE } from '../types';

/** A specific parking stall on a specific tile. */
export interface ParkingStall {
  /** Tile this stall belongs to. */
  tileX: number;
  tileY: number;
  /** 0..5 — which stall on this tile. Indices A..F per the diagram. */
  stallIdx: number;
  /** World-space coords + yaw for the car when parked. */
  worldX: number;
  worldZ: number;
  yaw: number;
}

/** Offsets per stall index (0..5). Order: back row A, B, C, then front
 *  row D, E, F. yaw = π for back row (facing -z), 0 for front (+z). */
const STALL_OFFSETS: ReadonlyArray<{ dx: number; dz: number; yaw: number }> = [
  { dx: -0.32, dz: -0.30, yaw: Math.PI },
  { dx:  0.00, dz: -0.30, yaw: Math.PI },
  { dx:  0.32, dz: -0.30, yaw: Math.PI },
  { dx: -0.32, dz:  0.30, yaw: 0 },
  { dx:  0.00, dz:  0.30, yaw: 0 },
  { dx:  0.32, dz:  0.30, yaw: 0 }
];

/** Total stalls per parking_lot tile — see STALL_OFFSETS. */
export const STALLS_PER_TILE = STALL_OFFSETS.length;

export class Parking {
  /** Map from flat tile index → array of 6 occupancy slots (true =
   *  reserved or occupied). A tile with no entry isn't a parking_lot
   *  in the current grid. */
  private readonly tileStalls = new Map<number, boolean[]>();
  /** Current grid width — captured at last rebuild so flat-index math
   *  in get/release matches what was stored. Rebuild keeps this in
   *  sync; if the world expands and rebuild() isn't called, lookups
   *  will simply miss (treated as no parking available). */
  private gridWidth = 0;

  /** Walk the grid for parking_lot tiles and refresh the registry.
   *  Called whenever the world changes (paint, bulldoze, grid expand,
   *  save load). Idempotent and cheap — O(grid). Existing occupied
   *  slots on still-present tiles are preserved; bulldozed tiles drop
   *  out (caller should also invalidate any in-flight reservations
   *  pointing at those tiles — see `revokeReservationsForTile`). */
  rebuild(grid: Grid): void {
    this.gridWidth = grid.width;
    // Mark every existing tileStalls entry as "candidate for removal" by
    // copying its keys, then re-confirm each as we walk the grid.
    const surviving = new Set<number>();
    for (const t of grid.iter()) {
      if (t.building !== 'parking_lot') continue;
      const key = t.y * grid.width + t.x;
      surviving.add(key);
      if (!this.tileStalls.has(key)) {
        this.tileStalls.set(key, new Array(STALLS_PER_TILE).fill(false));
      }
    }
    // Drop tiles that no longer exist as parking_lots. Vehicles holding
    // reservations to these tiles must self-cancel — see
    // Vehicles.update where parked cars verify their stall is still
    // valid each tick (Phase 2.1 safety net).
    for (const key of Array.from(this.tileStalls.keys())) {
      if (!surviving.has(key)) this.tileStalls.delete(key);
    }
  }

  /** Try to reserve a free stall on a specific tile. Returns the
   *  stall reservation or null if none free. */
  reserveOnTile(tileX: number, tileY: number): ParkingStall | null {
    const key = tileY * this.gridWidth + tileX;
    const slots = this.tileStalls.get(key);
    if (!slots) return null;
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i]) {
        slots[i] = true;
        const off = STALL_OFFSETS[i]!;
        return {
          tileX, tileY, stallIdx: i,
          worldX: (tileX + 0.5 + off.dx) * TILE_SIZE,
          worldZ: (tileY + 0.5 + off.dz) * TILE_SIZE,
          yaw: off.yaw
        };
      }
    }
    return null;
  }

  /** Look for a free stall on any parking_lot tile 4-adjacent to
   *  (x, y). Used by the spawn-time decision: "does this destination
   *  have an available stall nearby?" Returns the reservation OR null
   *  if no neighbour is a parking_lot with a free stall.
   *
   *  Kept for back-compat with callers that want STRICT adjacency.
   *  New callers should prefer `findStallNearDest` (Beta 1.4.2) which
   *  scans an expanding radius so parking lots can serve any nearby
   *  commercial/industrial destination, not just one that's perfectly
   *  4-adjacent. */
  reserveStallNear(x: number, y: number): ParkingStall | null {
    const neighbours: Array<[number, number]> = [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y]
    ];
    for (const [nx, ny] of neighbours) {
      const stall = this.reserveOnTile(nx, ny);
      if (stall) return stall;
    }
    return null;
  }

  /** Look for a free stall on the CLOSEST parking_lot tile within
   *  `maxRadius` (Chebyshev) of (destX, destY) (Beta 1.4.2). Used as
   *  the spawn-time parking decision so a parking lot becomes a true
   *  transit hub — citizens park there and walk to any commercial /
   *  industrial destination within walking distance.
   *
   *  Scans in expanding Chebyshev rings (r = 1, 2, 3, …). Returns the
   *  first stall found, which is on the closest parking_lot tile.
   *  Within a single ring multiple parking_lot tiles may exist; we
   *  walk them in a deterministic order (N, NE, E, SE, S, SW, W, NW)
   *  for stability. The pre-1.4.2 `reserveStallNear` semantics (only
   *  4-adjacent) live in this method too when called with maxRadius=1
   *  — diagonals are tolerated as "almost adjacent" so a corner
   *  parking lot still serves a corner destination. */
  findStallNearDest(destX: number, destY: number, maxRadius: number): ParkingStall | null {
    for (let r = 1; r <= maxRadius; r++) {
      // Walk the perimeter of the radius-r square ring around (destX, destY).
      // Use a Set to avoid double-visiting corners.
      const ringTiles: Array<[number, number]> = [];
      for (let dx = -r; dx <= r; dx++) {
        ringTiles.push([destX + dx, destY - r]);   // top edge
        ringTiles.push([destX + dx, destY + r]);   // bottom edge
      }
      for (let dy = -r + 1; dy <= r - 1; dy++) {
        ringTiles.push([destX - r, destY + dy]);   // left edge
        ringTiles.push([destX + r, destY + dy]);   // right edge
      }
      for (const [nx, ny] of ringTiles) {
        const stall = this.reserveOnTile(nx, ny);
        if (stall) return stall;
      }
    }
    return null;
  }

  /** Free a previously-reserved stall. Idempotent — safe to call
   *  twice (the second call no-ops because the slot is already false).
   *  Also no-ops if the tile no longer exists (bulldozed). */
  release(stall: ParkingStall): void {
    const key = stall.tileY * this.gridWidth + stall.tileX;
    const slots = this.tileStalls.get(key);
    if (!slots) return;
    if (stall.stallIdx >= 0 && stall.stallIdx < slots.length) {
      slots[stall.stallIdx] = false;
    }
  }

  /** Check if a reservation is still valid (tile still exists as a
   *  parking_lot in the registry). Cars holding stale reservations to
   *  bulldozed tiles use this to self-cancel. */
  isReservationValid(stall: ParkingStall): boolean {
    const key = stall.tileY * this.gridWidth + stall.tileX;
    return this.tileStalls.has(key);
  }

  /** Aggregate counts for HUD / debug — returns total stalls and
   *  currently-occupied count across every parking_lot in the city. */
  stats(): { total: number; occupied: number } {
    let total = 0;
    let occupied = 0;
    for (const slots of this.tileStalls.values()) {
      total += slots.length;
      for (const s of slots) if (s) occupied++;
    }
    return { total, occupied };
  }
}
