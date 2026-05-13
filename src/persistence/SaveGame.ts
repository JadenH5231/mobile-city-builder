import type { Grid } from '../world/Grid';
import type { Economy } from '../simulation/Economy';
import type { Council } from '../simulation/Council';
import type { Milestones } from '../simulation/Milestones';
import type { Events, EventsSnapshot } from '../simulation/Events';
import type { Stats, StatsSnapshot } from '../simulation/Stats';
import type { Achievements, AchievementsSnapshot } from '../simulation/Achievements';
import type { Bonds, BondsSnapshot } from '../simulation/Bonds';
import type { Districts, DistrictsSnapshot } from '../simulation/Districts';
import type { Building, RoadType, TerrainType, Zone } from '../types';
import { isFlatTerrain } from '../world/TerrainGenerator';

const DB_NAME = 'city-builder';
const DB_VERSION = 1;
const STORE = 'saves';
/** Default / legacy slot key. v15-and-earlier saves all live in this slot;
 *  Alpha 2.20 introduces multi-slot. */
const DEFAULT_SLOT_KEY = 'main';
/** Number of save slots exposed to the player. */
export const NUM_SLOTS = 3;
/** Slot keys in display order. The first one is `main` for backwards compat
 *  with single-slot saves — that's where any pre-2.20 city already lives. */
export const SLOT_KEYS: readonly string[] = ['main', 'slot2', 'slot3'];
/**
 * Schema 23 (Alpha 4.15 — Per-block big-building placement): adds
 * `bigBuildBlockPaid` per tile so the four large civic builds (Mayor's
 * Mansion + City Hall + Provincial Capital + National Capital) can
 * persist mid-construction. Pre-4.15 these were all-or-nothing
 * placements. v22-and-earlier saves load with `bigBuildBlockPaid = true`
 * on every tile that has a kind-bit set, so previously-completed
 * buildings remain completed across the upgrade.
 *
 * Earlier: v22 civic monuments, v21 mansion, v20 beautification,
 * v19 land ownership, v18 skyscrapers, v17 districts, v16 bonds,
 * v15 tourism, v14 patina, v13 achievements, v12 bridges, v11 stats,
 * v10 events, v9 highestPop, v8 luxury, v7 elevation+bridge.
 */
const SCHEMA = 23;
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
  /** Player-placed traffic light. Schema 6+. */
  trafficLight?: boolean;
  /** Road-attached bus stop. Schema 6+. */
  busStop?: boolean;
  /** Terrain elevation in tile units. Schema 7+. */
  elevation?: number;
  /** Bridge bit — road on a water tile renders elevated. Schema 7+. */
  bridge?: boolean;
  zone: Zone;
  /** Player-set density cap (0..3). 0 means unzoned. Schema 3+. */
  zoneCap?: 0 | 1 | 2 | 3;
  /** Luxury low-density bit. Schema 8+. */
  luxury?: boolean;
  density: number;
  pressure: number;
  /** Months when density first went 0 → 1 on this tile. Schema 14+. Drives
   *  the renderer's patina pass; new saves stamp it from the dev tick. */
  developedAt?: number;
  building: Building;
  /** Walking-path bit (Alpha 1.6). Schema 5+. */
  path?: boolean;
  /** Upper-layer Bridge-Mode road bits (Alpha 2.12 / schema 12+). */
  bridgeRoad?: boolean;
  bridgeRoadType?: RoadType;
  bridgeHighwayDir?: number;
  /** District membership (Alpha 2.22 / schema 17+). 0 = unassigned. */
  districtId?: number;
  /** Skyscraper bits (Alpha 3.1.2 / schema 18+). */
  skyscraper?: boolean;
  skyscraperStage?: 0 | 1 | 2 | 3 | 4;
  skyscraperVariant?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Land ownership (Alpha 3.1.3 / schema 19+). v18 saves load with
   *  owned=true on every tile (back-compat). */
  owned?: boolean;
  /** Mayor's Mansion bit (Alpha 4.2 / schema 21+). True on each of
   *  the 4×2 footprint tiles; the lex-smallest tile is the anchor
   *  with `building='mayor_mansion'`, the other seven are
   *  marked-only. v20-and-earlier saves load with `false`. */
  mayorMansion?: boolean;
  /** Civic-monument bits (Alpha 4.12 / schema 22+). Same anchor
   *  pattern as `mayorMansion`. v21-and-earlier saves load with all
   *  three `false`. */
  cityHall?: boolean;
  provincialCapital?: boolean;
  nationalCapital?: boolean;
  /** Per-block placement bit (Alpha 4.15 / schema 23+). True iff the
   *  player has paid for THIS block of a big civic build. v22-and-
   *  earlier saves load with this defaulted to `true` for any tile
   *  that has a kind-bit set, so previously-complete buildings
   *  remain complete. */
  bigBuildBlockPaid?: boolean;
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
  /** Schema 4+. Slow-accumulating civic-action resource. */
  politicalCapital?: number;
  /** Schema 9+. Highest population the city has ever reached. Drives
   *  which milestones / tool unlocks are restored on load. */
  highestPop?: number;
  /** Schema 10+. Active event modifiers (recession aftermath, etc.). */
  eventsSnapshot?: EventsSnapshot;
  /** Schema 11+. Monthly time-series for the Stats panel. */
  statsSnapshot?: StatsSnapshot;
  /** Schema 12+. Upper-layer road graph (Bridge Mode overpasses). */
  bridgeRoadEdges?: number[];
  /** Schema 13+. Achievements lifetime counters + unlocked set +
   *  one-time leader-bio "metLeaders" tracker. */
  achievementsSnapshot?: AchievementsSnapshot;
  /** Schema 15+. Lifetime tourism revenue earned from landmarks. */
  lifetimeTourismRevenue?: number;
  /** Schema 16+. Active bonds + lifetime issuance tally. */
  bondsSnapshot?: BondsSnapshot;
  /** Schema 16+. Player-set wealth surtax % (0..30). */
  wealthSurtax?: number;
  /** Player-given city name (Alpha 2.20). Optional; the slot picker
   *  falls back to "City 1" / "City 2" / "City 3" if unset. */
  cityName?: string;
  /** ISO timestamp of last save (Alpha 2.20). Drives slot-picker sort. */
  lastPlayedISO?: string;
  /** District registry (Alpha 2.22). Schema 17+. */
  districtsSnapshot?: DistrictsSnapshot;
  /** City-bounds rectangle (Alpha 3.2.1). Schema 19+. v18-and-earlier
   *  saves load with bounds covering the whole grid (back-compat — they
   *  used per-tile owned bits exclusively). */
  cityBoundsX0?: number;
  cityBoundsX1?: number;
  cityBoundsY0?: number;
  cityBoundsY1?: number;
  /** Cheat toggles (Alpha 3.2.4). Persisted so a playtest with cheats on
   *  resumes with cheats on after a reload. */
  cheatUnlimitedMoney?: boolean;
  cheatUnlimitedDemand?: boolean;
  /** Council Beautification Budget — elected tier (Alpha 4.0). The
   *  council picks this each term; mayor cannot override. Persisted
   *  so a mid-term reload doesn't regress to 'none' until the next
   *  election. v19-and-earlier saves default to 'none'. */
  beautificationTier?: import('../types').BeautificationTier;
  /** Effective beautification tier last month (may differ from elected
   *  if the bill defunded). v19-and-earlier saves default to 'none'. */
  effectiveBeautificationTier?: import('../types').BeautificationTier;
}

/** Slim slot-summary shape rendered in the slot picker. */
export interface SlotSummary {
  cityName?: string;
  monthsElapsed: number;
  treasury: number;
  highestPop: number;
  width: number;
  height: number;
  lastPlayedISO?: string;
}

/**
 * Wraps raw IndexedDB so we don't pull in `idb` for one store + one slot.
 * Methods are async and resolve undefined on no-such-save / IDB unavailable
 * (private browsing on iOS, etc.) — caller falls back to a fresh map.
 */
export class SaveGame {
  private db: IDBDatabase | null = null;
  /** Active slot for read/write operations. Set via `useSlot`; defaults to
   *  `main` so existing single-slot save flow keeps working unchanged. */
  private slotKey: string = DEFAULT_SLOT_KEY;

  /** Switch to a specific slot. Subsequent load/save/clear target it. */
  useSlot(slotKey: string): void {
    this.slotKey = slotKey;
  }
  currentSlot(): string {
    return this.slotKey;
  }

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
      const req = tx.objectStore(STORE).get(this.slotKey);
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

  /** Read just the slot summary fields. Used by the slot picker to render
   *  the city name + pop + treasury without loading the full grid. */
  async loadSummary(slotKey: string): Promise<SlotSummary | undefined> {
    if (!this.db) return undefined;
    return new Promise<SlotSummary | undefined>((resolve, reject) => {
      const tx = this.db!.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(slotKey);
      req.onsuccess = () => {
        const raw = req.result as SaveData | undefined;
        if (!raw) return resolve(undefined);
        if (raw.schemaVersion < MIN_LOADABLE_SCHEMA || raw.schemaVersion > SCHEMA) {
          return resolve(undefined);
        }
        resolve({
          cityName: raw.cityName,
          monthsElapsed: raw.monthsElapsed,
          treasury: raw.treasury,
          highestPop: raw.highestPop ?? 0,
          width: raw.width,
          height: raw.height,
          lastPlayedISO: raw.lastPlayedISO
        });
      };
      req.onerror = () => reject(req.error);
    });
  }

  async save(grid: Grid, economy: Economy, council?: Council, milestones?: Milestones, events?: Events, stats?: Stats, achievements?: Achievements, bonds?: Bonds, cityName?: string, districts?: Districts, cheats?: { unlimitedMoney: boolean; unlimitedDemand: boolean }): Promise<void> {
    if (!this.db) return;
    const data = serialize(grid, economy, council, milestones, events, stats, achievements, bonds, districts);
    if (cityName !== undefined) data.cityName = cityName;
    if (cheats) {
      data.cheatUnlimitedMoney = cheats.unlimitedMoney;
      data.cheatUnlimitedDemand = cheats.unlimitedDemand;
    }
    data.lastPlayedISO = new Date().toISOString();
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, this.slotKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(): Promise<void> {
    if (!this.db) return;
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(this.slotKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Write a raw SaveData straight to the active slot (Alpha 4.11). Used by
   * the import-from-code flow — `serialize()` is bypassed because the data
   * already came from somewhere else's serialize. The schema gate is
   * checked here so a corrupt/old code can't pollute the store. The
   * caller is expected to re-init / reload after this write so the in-
   * memory state matches what's now persisted.
   */
  async writeRaw(data: SaveData): Promise<void> {
    if (!this.db) throw new Error('Save store unavailable (private mode?)');
    if (typeof data.schemaVersion !== 'number'
        || data.schemaVersion < MIN_LOADABLE_SCHEMA
        || data.schemaVersion > SCHEMA) {
      throw new Error(`Save schema v${data.schemaVersion} is outside the loadable range (${MIN_LOADABLE_SCHEMA}..${SCHEMA}).`);
    }
    data.lastPlayedISO = new Date().toISOString();
    return new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, this.slotKey);
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
export function serialize(
  grid: Grid, economy: Economy, council?: Council, milestones?: Milestones, events?: Events, stats?: Stats, achievements?: Achievements, bonds?: Bonds, districts?: Districts
): SaveData {
  const tiles: TileSnapshot[] = new Array(grid.width * grid.height);
  let i = 0;
  for (const t of grid.iter()) {
    tiles[i++] = {
      terrain: t.terrain,
      road: t.road,
      roadType: t.roadType,
      highwayDir: t.highwayDir,
      stopSign: t.stopSign,
      trafficLight: t.trafficLight,
      busStop: t.busStop,
      elevation: t.elevation,
      bridge: t.bridge,
      zone: t.zone,
      zoneCap: t.zoneCap,
      luxury: t.luxury,
      density: t.density,
      pressure: t.developmentPressure,
      developedAt: t.developedAt,
      building: t.building,
      path: t.path,
      bridgeRoad: t.bridgeRoad,
      bridgeRoadType: t.bridgeRoadType,
      bridgeHighwayDir: t.bridgeHighwayDir,
      districtId: t.districtId,
      skyscraper: t.skyscraper,
      skyscraperStage: t.skyscraperStage,
      skyscraperVariant: t.skyscraperVariant,
      owned: t.owned,
      mayorMansion: t.mayorMansion,
      cityHall: t.cityHall,
      provincialCapital: t.provincialCapital,
      nationalCapital: t.nationalCapital,
      bigBuildBlockPaid: t.bigBuildBlockPaid
    };
  }
  const edges: number[] = [];
  for (const e of grid.iterRoadEdges()) {
    edges.push(e.ax, e.ay, e.bx, e.by);
  }
  const bridgeEdges: number[] = [];
  for (const e of grid.iterBridgeRoadEdges()) {
    bridgeEdges.push(e.ax, e.ay, e.bx, e.by);
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
    totalAccidents: economy.totalAccidents,
    politicalCapital: council?.politicalCapital ?? 0,
    highestPop: milestones?.highestPop ?? 0,
    eventsSnapshot: events?.serialize(),
    statsSnapshot: stats?.serialize(),
    bridgeRoadEdges: bridgeEdges,
    achievementsSnapshot: achievements?.serialize(),
    lifetimeTourismRevenue: economy.lifetimeTourismRevenue,
    bondsSnapshot: bonds?.serialize(),
    wealthSurtax: economy.wealthSurtax,
    districtsSnapshot: districts?.serialize(),
    cityBoundsX0: grid.cityBoundsX0,
    cityBoundsX1: grid.cityBoundsX1,
    cityBoundsY0: grid.cityBoundsY0,
    cityBoundsY1: grid.cityBoundsY1,
    // Council Beautification Budget (Alpha 4.0 / schema 20+).
    beautificationTier: council?.beautificationTier ?? 'none',
    effectiveBeautificationTier: council?.effectiveBeautificationTier ?? 'none'
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
export function applySave(
  data: SaveData, grid: Grid, economy: Economy, council?: Council, milestones?: Milestones, events?: Events, stats?: Stats, achievements?: Achievements, bonds?: Bonds, districts?: Districts
): void {
  // Saved dims may differ from the freshly-constructed Grid's dims if the
  // player previously expanded the world (Alpha 3.2.3). Resize the grid
  // to match the snapshot before reading tiles.
  if (data.width !== grid.width || data.height !== grid.height) {
    grid.resizeForLoad(data.width, data.height);
  }
  if (council) {
    council.politicalCapital = data.politicalCapital ?? 0;
    // Beautification Budget (Alpha 4.0 / schema 20+). Pre-4.0 saves
    // default both to 'none' — those cities boot back into a
    // pre-elected state and the next election picks a fresh tier.
    council.restoreBeautification(
      data.beautificationTier,
      data.effectiveBeautificationTier
    );
  }
  if (milestones) {
    milestones.applyHighestPop(data.highestPop ?? 0);
  }
  if (events) {
    events.restore(data.eventsSnapshot);
  }
  if (stats) {
    stats.restore(data.statsSnapshot);
  }
  if (achievements) {
    achievements.restore(data.achievementsSnapshot);
    // Backfill peakPop / monthsRun from neighbouring systems for v12 saves
    // that pre-date Achievements — players don't lose credit for the city
    // they were already running.
    if (!data.achievementsSnapshot) {
      const seedPop = data.highestPop ?? 0;
      if (seedPop > achievements.peakPop) achievements.peakPop = seedPop;
      const seedMonths = data.monthsElapsed ?? 0;
      if (seedMonths > achievements.monthsRun) achievements.monthsRun = seedMonths;
    }
  }

  let i = 0;
  for (const t of grid.iter()) {
    const snap = data.tiles[i++];
    if (!snap) continue;
    t.terrain = snap.terrain;
    t.road = snap.road;
    t.roadType = snap.roadType ?? 'local';
    t.highwayDir = snap.highwayDir ?? -1;
    t.stopSign = snap.stopSign ?? false;
    // Traffic light is schema 6+. Older saves had no lights. Defensive
    // mutex: if both bits ever appear true (corrupt save), prefer the
    // more powerful traffic light.
    t.trafficLight = snap.trafficLight ?? false;
    if (t.trafficLight) t.stopSign = false;
    t.busStop = snap.busStop ?? false;
    // Elevation forced to 0 while FLAT_TERRAIN is on (Alpha 2.4.1) so old
    // v7 saves with rolling hills load flat too. Switch back when the
    // generator flag flips.
    t.elevation = isFlatTerrain() ? 0 : (snap.elevation ?? 0);
    t.bridge = snap.bridge ?? false;
    t.zone = snap.zone;
    // zoneCap is schema 3+. v2 saves get the implicit "high" cap (3) for
    // any zoned tile, mirroring pre-1.1 behaviour where services alone
    // gated L3.
    t.zoneCap = snap.zoneCap ?? (snap.zone === 'none' ? 0 : 3);
    // Luxury bit is schema 8+. Older saves had no luxury zone.
    t.luxury = snap.luxury ?? false;
    t.density = snap.density;
    t.developmentPressure = snap.pressure;
    // developedAt schema 14+. v13-and-earlier saves treat current density as
    // "freshly built at the load month" — the only sensible default since
    // the alternative dates them all to month 0 and renders the entire
    // pre-existing city as fully aged. Buildings will then age forward
    // from this restore point.
    t.developedAt = snap.developedAt ?? (snap.density > 0 ? data.monthsElapsed : 0);
    t.building = snap.building;
    // Path is schema 5+. Older saves had no walking paths.
    t.path = snap.path ?? false;
    // Defensive: a path on a road tile would violate the invariant.
    if (t.road) t.path = false;
    // Bridge Mode upper-layer fields (schema 12+).
    t.bridgeRoad = snap.bridgeRoad ?? false;
    t.bridgeRoadType = snap.bridgeRoadType ?? 'local';
    t.bridgeHighwayDir = snap.bridgeHighwayDir ?? -1;
    // District membership (schema 17+).
    t.districtId = snap.districtId ?? 0;
    // Skyscraper bits (schema 18+). Older saves have no skyscrapers.
    t.skyscraper = snap.skyscraper ?? false;
    t.skyscraperStage = snap.skyscraperStage ?? 0;
    t.skyscraperVariant = snap.skyscraperVariant ?? 0;
    // Land ownership (schema 19+). v18 saves grandfather everything to
    // owned=true so existing cities don't suddenly lose half their map.
    t.owned = snap.owned ?? true;
    // Mayor's Mansion bit (schema 21+). v20-and-earlier saves load
    // with `false` since no mayor's mansion ever existed there.
    t.mayorMansion = snap.mayorMansion ?? false;
    // Civic-monument bits (schema 22+). v21-and-earlier saves load
    // with all three `false` (no civic monument ever existed there).
    t.cityHall = snap.cityHall ?? false;
    t.provincialCapital = snap.provincialCapital ?? false;
    t.nationalCapital = snap.nationalCapital ?? false;
    // Per-block placement bit (schema 23+). v22-and-earlier saves
    // pre-date per-block construction, so any tile with a kind-bit
    // set is implicitly already paid for (the building was complete
    // when saved). New saves carry the explicit value.
    if (snap.bigBuildBlockPaid !== undefined) {
      t.bigBuildBlockPaid = snap.bigBuildBlockPaid;
    } else {
      t.bigBuildBlockPaid = t.mayorMansion || t.cityHall || t.provincialCapital || t.nationalCapital;
    }
    t.resetServices();
    t.trafficLoad = 0;
    t.trafficLoadAvg = 0;
  }

  // Reload road edges in one go (loadRoadEdges defensively re-flags endpoints).
  grid.loadRoadEdges(data.roadEdges);
  // Reload upper-layer (Bridge Mode) edges, schema 12+.
  if (data.bridgeRoadEdges) grid.loadBridgeRoadEdges(data.bridgeRoadEdges);

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
  economy.lifetimeTourismRevenue = data.lifetimeTourismRevenue ?? 0;
  economy.wealthSurtax = data.wealthSurtax ?? 0;
  if (bonds) bonds.restore(data.bondsSnapshot);
  if (districts) districts.restore(data.districtsSnapshot);
  // City bounds (Alpha 3.2.1). v18 saves load with bounds covering the
  // whole grid (back-compat with the old per-tile owned approach).
  grid.cityBoundsX0 = data.cityBoundsX0 ?? 0;
  grid.cityBoundsX1 = data.cityBoundsX1 ?? grid.width - 1;
  grid.cityBoundsY0 = data.cityBoundsY0 ?? 0;
  grid.cityBoundsY1 = data.cityBoundsY1 ?? grid.height - 1;
}
