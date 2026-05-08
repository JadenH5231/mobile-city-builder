import type { Grid } from '../world/Grid';
import type { Economy } from '../simulation/Economy';
import type { Building, RoadType, TerrainType, Zone } from '../types';

const DB_NAME = 'city-builder';
const DB_VERSION = 1;
const STORE = 'saves';
const SLOT_KEY = 'main';
/**
 * Schema 3 (Alpha 1.1): adds per-tile `zoneCap` (player-set density permission
 * 0..3). Schema 2 saves load with `zoneCap` defaulted to 3 for any zoned tile,
 * preserving the pre-1.1 "any zone can grow to L3 if services allow" behaviour.
 * Schema 1 (pre-Alpha-1.0) is silently dropped.
 */
const SCHEMA = 3;
const MIN_LOADABLE_SCHEMA = 2;

/**
 * Single-slot save.
 *
 * - Per-tile: terrain, road bool + tier + highway dir + stop sign, zone,
 *   density, dev pressure, city building.
 * - Road graph: flat `[ax, ay, bx, by, …]` of every edge.
 * - Economy: treasury + three tax rates + months elapsed + lifetime accidents.
 *
 * Vehicles, traffic flags, service flags are NOT saved — they're regenerated
 * deterministically on load (Services.recompute, Traffic stays at 0,
 * Vehicles/Buses respawn from depots/zones over the next sim ticks).
 */
export interface TileSnapshot {
  terrain: TerrainType;
  road: boolean;
  roadType: RoadType;
  highwayDir: number;
  stopSign: boolean;
  zone: Zone;
  /** Player-set density cap (0..3). 0 means unzoned. Schema 3+. */
  zoneCap?: 0 | 1 | 2 | 3;
  density: number;
  pressure: number;
  building: Building;
}

export interface SaveData {
  schemaVersion: number;
  width: number;
  height: number;
  tiles: TileSnapshot[];
  roadEdges: number[];
  treasury: number;
  taxR: number;
  taxC: number;
  taxI: number;
  monthsElapsed: number;
  totalAccidents: number;
}

/**
 * Wraps raw IndexedDB so we don't pull in `idb` for one store + one slot.
 * Methods are async and resolve undefined on no-such-save / IDB unavailable
 * (private browsing on iOS, etc.) — caller falls back to a fresh map.
 */
export class SaveGame {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async load(): Promise<SaveData | undefined> {
    if (!this.db) return undefined;
    return new Promise<SaveData | undefined>((resolve, reject) => {
      const tx = this.db!.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(SLOT_KEY);
      req.onsuccess = () => {
        const raw = req.result as SaveData | undefined;
        if (!raw) return resolve(undefined);
        // Accept any schema in [MIN_LOADABLE_SCHEMA, SCHEMA]. applySave fills
        // in missing fields with defaults.
        if (raw.schemaVersion < MIN_LOADABLE_SCHEMA || raw.schemaVersion > SCHEMA) {
          return resolve(undefined);
        }
        resolve(raw);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async save(grid: Grid, economy: Economy): Promise<void> {
    if (!this.db) return;
    const data = serialize(grid, economy);
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, SLOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(): Promise<void> {
    if (!this.db) return;
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(SLOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/**
 * Snapshot the current game state to a plain object. Used both by the
 * SaveGame round-trip and by Game's undo stack — the JSON shape is identical
 * so we get a single restore path for both.
 */
export function serialize(grid: Grid, economy: Economy): SaveData {
  const tiles: TileSnapshot[] = new Array(grid.width * grid.height);
  let i = 0;
  for (const t of grid.iter()) {
    tiles[i++] = {
      terrain: t.terrain,
      road: t.road,
      roadType: t.roadType,
      highwayDir: t.highwayDir,
      stopSign: t.stopSign,
      zone: t.zone,
      zoneCap: t.zoneCap,
      density: t.density,
      pressure: t.developmentPressure,
      building: t.building
    };
  }
  const edges: number[] = [];
  for (const e of grid.iterRoadEdges()) {
    edges.push(e.ax, e.ay, e.bx, e.by);
  }
  return {
    schemaVersion: SCHEMA,
    width: grid.width,
    height: grid.height,
    tiles,
    roadEdges: edges,
    treasury: economy.treasury,
    taxR: economy.taxR,
    taxC: economy.taxC,
    taxI: economy.taxI,
    monthsElapsed: economy.monthsElapsed,
    totalAccidents: economy.totalAccidents
  };
}

/**
 * Restore state from a snapshot. The grid must already exist with matching
 * dimensions — typically Game owns one Grid for the lifetime of the session
 * and we mutate it in place. Mismatched dimensions abort the restore so we
 * don't half-apply state from a different map.
 *
 * Service flags get cleared here; the caller is expected to call
 * Services.recompute(grid) afterward. Same for the road graph rebuild.
 */
export function applySave(data: SaveData, grid: Grid, economy: Economy): void {
  if (data.width !== grid.width || data.height !== grid.height) return;

  let i = 0;
  for (const t of grid.iter()) {
    const snap = data.tiles[i++];
    if (!snap) continue;
    t.terrain = snap.terrain;
    t.road = snap.road;
    t.roadType = snap.roadType ?? 'local';
    t.highwayDir = snap.highwayDir ?? -1;
    t.stopSign = snap.stopSign ?? false;
    t.zone = snap.zone;
    // zoneCap is schema 3+. v2 saves get the implicit "high" cap (3) for
    // any zoned tile, mirroring pre-1.1 behaviour where services alone
    // gated L3.
    t.zoneCap = snap.zoneCap ?? (snap.zone === 'none' ? 0 : 3);
    t.density = snap.density;
    t.developmentPressure = snap.pressure;
    t.building = snap.building;
    t.resetServices();
    t.trafficLoad = 0;
    t.trafficLoadAvg = 0;
  }

  // Reload road edges in one go (loadRoadEdges defensively re-flags endpoints).
  grid.loadRoadEdges(data.roadEdges);

  economy.treasury = data.treasury;
  economy.taxR = data.taxR;
  economy.taxC = data.taxC;
  economy.taxI = data.taxI;
  economy.monthsElapsed = data.monthsElapsed;
  economy.totalAccidents = data.totalAccidents ?? 0;
  economy.lastRevenue = 0;
  economy.lastExpenses = 0;
  economy.lastAccidentCost = 0;
  economy.accidentsThisMonth = 0;
}
