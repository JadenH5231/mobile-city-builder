/**
 * Shoppers (Beta 1.3.4 — Phase 2.1). The walking final-leg of a
 * parking trip. When a car arrives at a destination with a parking
 * stall, the car parks visibly in the stall AND a Shopper is spawned
 * at the stall position. The Shopper walks in a straight line to the
 * destination tile, "shops" briefly at the destination, then walks
 * back to the stall. When the timer expires, the Shopper despawns
 * (its associated Car already despawns on the same timer via
 * `parkedUntil`).
 *
 * Why a separate module instead of extending Pedestrians:
 *  - Pedestrians walk the `PathGraph` (sidewalks + paths). Shoppers
 *    start at a stall position INSIDE a parking lot — not on the
 *    graph — and end at a building tile that may or may not be on
 *    the graph either. Pathfinding the route would force the player
 *    to paint sidewalks between every commercial tile and every
 *    parking lot for the visuals to work; a straight-line walk is
 *    simpler and more legible.
 *  - The visit-time alignment with the Car's `parkedUntil` is a
 *    simple per-Shopper timer here; cleanly isolated from the
 *    Pedestrians sim's collision/spawn logic.
 *
 * Renderer hooks: `shopperBodiesMesh` + `shopperHeadsMesh` in
 * Renderer.ts, sized at MAX_SHOPPERS capacity. `updateShoppers` reads
 * each Shopper's interpolated world position each frame.
 */

import type { ParkingStall } from './Parking';
import { TILE_SIZE } from '../types';

/** Cap on simultaneously-visible shoppers. One per parked car at the
 *  Vehicles cap (~250 cars) sets an upper bound, but in practice most
 *  trips don't have parking so far fewer fire. 300 is generous and
 *  cheap on the InstancedMesh budget. */
export const MAX_SHOPPERS = 300;

/** Walking speed sentinel — used only by the duration calculator so
 *  the shopper's outbound + return legs feel consistent regardless of
 *  the straight-line distance from stall to destination. */
const SHOPPER_WALK_TILES_PER_SEC = 0.7;

/** Minimum outbound / return phase duration, in seconds. Even on a
 *  tiny lot where stall is right at the storefront, the shopper walks
 *  AT LEAST this long so the visual reads. */
const MIN_LEG_SEC = 2;

/** Fraction of the total trip spent "shopping" at the destination
 *  (invisible — the shopper has entered the store). Sits between the
 *  outbound and return legs. */
const SHOPPING_FRACTION = 0.20;

export interface Shopper {
  /** World-space start (stall) coordinates. */
  startX: number;
  startZ: number;
  /** World-space end (destination tile center) coordinates. */
  endX: number;
  endZ: number;
  /** Elapsed seconds since spawn. */
  elapsed: number;
  /** Total trip duration in seconds. Aligned to the Car's `parkedUntil`
   *  in the Vehicles sim so they expire together. */
  totalSec: number;
  /** Phase boundaries computed at spawn time. */
  outEnd: number;    // seconds — outbound leg ends
  shopEnd: number;   // seconds — shopping ends, return begins
  /** Colour from the existing pedestrian palette so shoppers blend
   *  visually with regular walkers. */
  color: number;
  /** Floor lift to keep the model on top of the asphalt without
   *  z-fighting. SIDEWALK_LIFT-ish. */
  yLift: number;
}

export class Shoppers {
  readonly list: Shopper[] = [];

  /** Spawn a shopper for a parked car. Total duration is the car's
   *  visit window (same `parkedUntil - now` as the car), so the
   *  shopper and the car despawn together. Distance + walking speed
   *  determine the outbound + return leg durations; the remaining
   *  time is spent at the destination ("shopping").
   *
   *  If the trip duration is too short to comfortably accommodate the
   *  walking legs, the legs get clamped to MIN_LEG_SEC and the
   *  shopping middle shrinks accordingly. */
  spawnForParkedCar(
    stall: ParkingStall,
    destTileX: number,
    destTileY: number,
    visitDurationMs: number,
    color: number,
    yBase: number
  ): void {
    if (this.list.length >= MAX_SHOPPERS) return;
    const totalSec = Math.max(0.5, visitDurationMs / 1000);
    const endX = (destTileX + 0.5) * TILE_SIZE;
    const endZ = (destTileY + 0.5) * TILE_SIZE;
    const dist = Math.hypot(endX - stall.worldX, endZ - stall.worldZ);
    // Each leg takes at least MIN_LEG_SEC; longer for distant lots.
    const legSec = Math.max(MIN_LEG_SEC, dist / SHOPPER_WALK_TILES_PER_SEC);
    // If both legs + a SHOPPING_FRACTION middle don't fit in totalSec,
    // squeeze the middle. legSec * 2 + middle = totalSec.
    const idealMiddle = totalSec * SHOPPING_FRACTION;
    const projectedTotal = legSec * 2 + idealMiddle;
    const middleSec = projectedTotal <= totalSec
      ? idealMiddle
      : Math.max(0, totalSec - legSec * 2);
    const outEnd = legSec;
    const shopEnd = outEnd + middleSec;
    // If even MIN_LEG_SEC legs + 0 middle overshoot totalSec (very
    // short visit), the shopper just won't quite make it back —
    // they'll be partway through the return leg when despawn happens.
    // Acceptable for the visual; correctness is preserved by despawn
    // on elapsed >= totalSec.
    this.list.push({
      startX: stall.worldX,
      startZ: stall.worldZ,
      endX,
      endZ,
      elapsed: 0,
      totalSec,
      outEnd,
      shopEnd,
      color,
      yLift: yBase + 0.005
    });
  }

  /** Tick every shopper forward. Despawn when the timer expires.
   *  Called from Game per render frame (same cadence as updateCars). */
  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i]!;
      s.elapsed += dt;
      if (s.elapsed >= s.totalSec) {
        this.list.splice(i, 1);
      }
    }
  }

  /** Drop every shopper — called on city reset / save load. */
  clear(): void {
    this.list.length = 0;
  }

  /** Resolve the current world-space position + visibility + facing
   *  for one shopper. Used by Renderer.updateShoppers. Returns
   *  `visible: false` while the shopper is "in the store" (shopping
   *  phase). */
  resolve(s: Shopper): {
    x: number; z: number; yaw: number; visible: boolean;
  } {
    if (s.elapsed < s.outEnd) {
      // Outbound leg. Lerp start → end. Facing toward end.
      const lerp = s.outEnd > 0 ? s.elapsed / s.outEnd : 1;
      const x = s.startX + (s.endX - s.startX) * lerp;
      const z = s.startZ + (s.endZ - s.startZ) * lerp;
      const yaw = Math.atan2(s.endX - s.startX, s.endZ - s.startZ);
      return { x, z, yaw, visible: true };
    } else if (s.elapsed < s.shopEnd) {
      // Shopping. Hidden from world — they're "inside" the store.
      return { x: s.endX, z: s.endZ, yaw: 0, visible: false };
    } else {
      // Return leg. Lerp end → start. Facing toward start.
      const legSec = s.totalSec - s.shopEnd;
      const lerp = legSec > 0 ? (s.elapsed - s.shopEnd) / legSec : 1;
      const lerpC = Math.min(1, lerp);
      const x = s.endX + (s.startX - s.endX) * lerpC;
      const z = s.endZ + (s.startZ - s.endZ) * lerpC;
      const yaw = Math.atan2(s.startX - s.endX, s.startZ - s.endZ);
      return { x, z, yaw, visible: true };
    }
  }
}
