import { Camera } from './Camera';
import { Input } from './Input';
import { Renderer } from './Renderer';
import { Grid } from '../world/Grid';
import { TileInfoPanel } from '../ui/TileInfoPanel';
import { Toolbar } from '../ui/Toolbar';
import { Development } from '../simulation/Development';
import { Economy } from '../simulation/Economy';
import { Pathfinding } from '../simulation/Pathfinding';
import { Population } from '../simulation/Population';
import { RoadGraph } from '../simulation/RoadGraph';
import { Buses } from '../simulation/Buses';
import { Services } from '../simulation/Services';
import { Traffic } from '../simulation/Traffic';
import { Vehicles } from '../simulation/Vehicles';
import { BudgetPanel } from '../ui/BudgetPanel';
import { SaveGame, applySave, serialize, type SaveData } from '../persistence/SaveGame';
import {
  BUILDING_COSTS,
  MAP_SIZES,
  PLACE_TOOL_TO_BUILDING,
  TILE_SIZE,
  ZONE_TOOLS,
  type Building,
  type MapSize,
  type Tool,
  type Zone
} from '../types';

/** Fixed sim-tick interval, in ms. 100ms = 10 Hz. */
const SIM_STEP_MS = 100;
/** Hard cap on catch-up ticks per frame so a backgrounded tab can't lock the loop. */
const MAX_SIM_STEPS_PER_FRAME = 5;
/** Auto-save interval (real-time milliseconds). */
const AUTOSAVE_MS = 30_000;
/** Max undo entries kept in memory. */
const UNDO_STACK_LIMIT = 20;

/**
 * Game owns the Three.js renderer, the camera, and the top-level systems.
 *
 * Painting model:
 * - Roads are stored as edges between adjacent tiles (4- or 8-connected).
 *   A stroke builds an 8-connected diagonal-first path; consecutive pairs
 *   become edges. A stationary tap creates a road *stub*.
 * - Zones are per-tile. A zone stroke applies the target zone to each
 *   path-tile that's eligible (grass + has a 4-connected road neighbour).
 * - Bulldoze is per-tile and clears everything (road edges incident to the
 *   tile, the road stub, and the zone). It records full snapshots so the
 *   rubber band can restore everything when the stroke retreats.
 *
 * Each branch reconciles a "desired" set against a per-stroke tracking
 * structure on every pointermove — that's what makes a mid-stroke direction
 * change clean up after itself.
 */
export class Game {
  readonly camera = new Camera();
  renderer!: Renderer;

  grid!: Grid;
  input!: Input;
  panel!: TileInfoPanel;
  toolbar!: Toolbar;
  budgetPanel!: BudgetPanel;

  selected: { x: number; y: number } | null = null;
  tool: Tool = 'pan';

  private host!: HTMLElement;

  // ---- Per-stroke rubber-band state ----
  private strokeOrigin: { x: number; y: number } | null = null;
  /** Road tool: edges added. Keys via {@link packEdge}. */
  private readonly strokeEdges = new Set<number>();
  /** Road tool: tile indices flipped from road=false to road=true. */
  private readonly strokeStubs = new Set<number>();
  /** Zone tool: per-tile snapshot of original zone for revert. */
  private readonly strokeZones = new Map<number, Zone>();
  /** Bulldoze tool: per-tile snapshot of all destroyed state for revert. */
  private readonly strokeBulldozed = new Map<number, BulldozedSnapshot>();

  /** Per-frame tick callbacks (FPS counter, render-rate things). */
  readonly tickCallbacks: Array<(dt: number) => void> = [];

  // Fixed-rate sim systems run inside `startLoop` via an accumulator clock.
  // Population must tick before Development since the latter reads demand;
  // Economy reads Population for monthly settlement and Population reads
  // Economy for the tax-driven demand penalty (one-frame stale tax penalty
  // is fine — the slider was about to settle anyway).
  readonly economy = new Economy();
  readonly population = new Population();
  private readonly development = new Development(this.population);
  // Road graph is rebuilt on any road-state change. Pathfinder reuses
  // internal buffers across calls.
  readonly roadGraph = new RoadGraph();
  private readonly pathfinder = new Pathfinding();
  readonly vehicles = new Vehicles();
  readonly buses = new Buses();
  // Service-coverage flags get rebuilt on any building placement / removal.
  private readonly services = new Services();
  // Traffic owns the per-tile EMA + stress aggregate read by Population.
  readonly traffic = new Traffic();
  private simAccumulatorMs = 0;
  /** Toggle for the traffic heatmap overlay. */
  heatmapVisible = false;
  /** Throttle so the heatmap mesh isn't rebuilt every render frame. */
  private heatmapAccumMs = 0;
  // Persistence — auto-saves every AUTOSAVE_MS, also restores on init.
  readonly saveGame = new SaveGame();
  private autosaveAccumMs = 0;
  // Undo — capped FIFO stack of full snapshots. One entry per user-initiated
  // operation (paint stroke, building placement). Tax slider tweaks aren't
  // tracked because the user can just slide back.
  private readonly undoStack: SaveData[] = [];
  /** True if we pushed an entry at this stroke's start (so end can untie noops). */
  private strokeDidSnapshot = false;

  async init(host: HTMLElement, mapSize: MapSize = MAP_SIZES.small): Promise<void> {
    this.host = host;
    const canvas = document.createElement('canvas');
    canvas.style.touchAction = 'none';
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.appendChild(canvas);

    this.renderer = new Renderer(canvas);
    this.grid = new Grid(mapSize.width, mapSize.height);

    this.input = new Input(canvas, this.camera, {
      onTap: (sx, sy) => this.handleTap(sx, sy),
      onLongPress: (sx, sy) => this.handleLongPress(sx, sy),
      onPaintStart: (sx, sy) => this.handlePaintStart(sx, sy),
      onPaintMove: (sx, sy) => this.handlePaintMove(sx, sy),
      onPaintEnd: () => this.handlePaintEnd()
    });

    this.panel = new TileInfoPanel();
    this.toolbar = new Toolbar();
    this.toolbar.onChange = (tool) => this.setTool(tool);
    this.budgetPanel = new BudgetPanel(this.economy);

    // Try to restore an existing save before drawing initial state. Failures
    // (no save / version mismatch / IDB unavailable) silently fall through
    // to a fresh map.
    try {
      await this.saveGame.open();
      const data = await this.saveGame.load();
      if (data) applySave(data, this.grid, this.economy);
    } catch {
      // IndexedDB not available (private browsing on iOS, etc.) — ignore.
    }

    this.renderer.drawWorld(this.grid);
    this.renderer.drawZones(this.grid);
    this.renderer.drawRoads(this.grid);
    this.renderer.drawBuildings(this.grid);
    this.renderer.drawCityBuildings(this.grid);
    this.services.recompute(this.grid);
    this.roadGraph.rebuild(this.grid);
    this.fitCameraToGrid();
    this.handleResize();

    window.addEventListener('resize', this.handleResize);
    this.startLoop();
  }

  setTool(tool: Tool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.input.setMode(tool === 'pan' ? 'navigate' : 'paint');
    this.toolbar.setTool(tool);
    if (tool !== 'pan') {
      this.renderer.clearSelection();
      this.selected = null;
      this.panel.hide();
    }
  }

  // --- Camera framing -----------------------------------------------------

  private fitCameraToGrid(): void {
    const w = this.grid.width * TILE_SIZE;
    const h = this.grid.height * TILE_SIZE;
    this.camera.target.set(w / 2, 0, h / 2);
    this.camera.orthoSize = Math.max(w, h) * 0.6;
    this.camera.maxOrthoSize = Math.max(w, h);
    this.camera.minOrthoSize = 3;
    this.camera.update();
  }

  private handleResize = (): void => {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.setViewport(w, h);
  };

  // --- Render / sim loop --------------------------------------------------

  private startLoop(): void {
    let last = performance.now();
    const frame = (): void => {
      const now = performance.now();
      const dtMs = now - last;
      last = now;

      // Fixed-rate sim: accumulate real time, run as many fixed steps as fit.
      // Capped per frame so a long stall doesn't trigger a death-spiral catch-up.
      this.simAccumulatorMs += dtMs;
      let steps = 0;
      let buildingsDirty = false;
      while (this.simAccumulatorMs >= SIM_STEP_MS && steps < MAX_SIM_STEPS_PER_FRAME) {
        this.simAccumulatorMs -= SIM_STEP_MS;
        steps++;
        // Order: Traffic EMA → Population (reads stress) → Development →
        // Economy → Vehicles spawn. Each consumer reads from up-to-date
        // upstream state.
        this.traffic.tickEma(this.grid);
        this.population.tick(this.grid, this.economy, this.traffic);
        if (this.development.tick(this.grid)) buildingsDirty = true;
        this.economy.tick(SIM_STEP_MS, this.grid, this.population);
        this.vehicles.spawnTick(
          SIM_STEP_MS,
          this.grid,
          this.roadGraph,
          this.pathfinder,
          this.population.totalResidents
        );
        this.buses.spawnTick(SIM_STEP_MS, this.grid, this.roadGraph, this.pathfinder);
      }
      // If we hit the cap, drop accumulated time so we don't immediately
      // catch up on the next frame either.
      if (steps >= MAX_SIM_STEPS_PER_FRAME && this.simAccumulatorMs > SIM_STEP_MS) {
        this.simAccumulatorMs = 0;
      }
      if (buildingsDirty) this.renderer.drawBuildings(this.grid);

      const dt = dtMs / 1000;
      // Cars move smoothly at render rate, decoupled from the sim tick.
      this.vehicles.update(dt, this.grid, this.grid.width);
      this.renderer.updateCars(this.vehicles, this.grid.width);
      this.buses.update(dt, this.grid, this.grid.width, this.roadGraph, this.pathfinder);
      this.renderer.updateBuses(this.buses, this.grid.width);
      // Heatmap rebuild is the most expensive optional layer (full road
      // mesh rebuild). Throttle to 5 Hz when visible — the EMA only moves
      // that fast anyway. Memory: feedback_traffic_pressure (heatmap must
      // be informative, not flickery).
      if (this.heatmapVisible) {
        this.heatmapAccumMs += dtMs;
        if (this.heatmapAccumMs >= 200) {
          this.heatmapAccumMs = 0;
          this.renderer.drawHeatmap(this.grid);
        }
      }

      // Auto-save throttled to AUTOSAVE_MS. Fire-and-forget — don't block
      // the render loop on disk.
      this.autosaveAccumMs += dtMs;
      if (this.autosaveAccumMs >= AUTOSAVE_MS) {
        this.autosaveAccumMs = 0;
        void this.saveGame.save(this.grid, this.economy).catch(() => {});
      }

      for (const cb of this.tickCallbacks) cb(dt);
      this.renderer.render(this.camera);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // --- Coordinate helpers -------------------------------------------------

  private screenToTile(sx: number, sy: number): { x: number; y: number } | null {
    const w = this.camera.screenToWorld(sx, sy);
    if (!w) return null;
    const gx = Math.floor(w.x / TILE_SIZE);
    const gy = Math.floor(w.z / TILE_SIZE);
    if (gx < 0 || gy < 0 || gx >= this.grid.width || gy >= this.grid.height) return null;
    return { x: gx, y: gy };
  }

  // --- Navigate-mode handlers --------------------------------------------

  private handleTap(sx: number, sy: number): void {
    const tile = this.screenToTile(sx, sy);
    if (!tile) {
      this.clearSelection();
      return;
    }
    this.selected = tile;
    this.renderer.drawSelection(tile.x, tile.y);
    this.panel.hide();
  }

  private handleLongPress(sx: number, sy: number): void {
    const tile = this.screenToTile(sx, sy);
    if (!tile) return;
    this.selected = tile;
    this.renderer.drawSelection(tile.x, tile.y);
    const t = this.grid.get(tile.x, tile.y);
    if (!t) return;
    // Only one bottom panel at a time.
    this.budgetPanel.hide();
    this.panel.show({
      x: tile.x,
      y: tile.y,
      terrain: t.terrain,
      road: t.road,
      zone: t.zone,
      density: t.density,
      building: t.building,
      hasPower: t.hasPower,
      hasWater: t.hasWater,
      hasPark: t.hasPark
    });
  }

  // --- Undo --------------------------------------------------------------

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Capture the current grid + economy state and push it onto the undo stack. */
  private snapshotForUndo(): void {
    this.undoStack.push(serialize(this.grid, this.economy));
    if (this.undoStack.length > UNDO_STACK_LIMIT) this.undoStack.shift();
  }

  /**
   * Pop the latest snapshot and restore everything to it. Vehicles + buses
   * are cleared on undo because their paths reference road state that may
   * no longer exist after restoration.
   */
  undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    applySave(snap, this.grid, this.economy);
    this.afterStateRestore();
  }

  private afterStateRestore(): void {
    this.services.recompute(this.grid);
    this.roadGraph.rebuild(this.grid);
    this.renderer.drawZones(this.grid);
    this.renderer.drawRoads(this.grid);
    this.renderer.drawBuildings(this.grid);
    this.renderer.drawCityBuildings(this.grid);
    this.vehicles.clear(this.grid, this.grid.width);
    this.buses.clear();
  }

  /**
   * Wipe the current city back to a fresh map. Clears the IndexedDB save
   * too so a reload doesn't restore the old state.
   */
  async resetCity(): Promise<void> {
    try {
      await this.saveGame.clear();
    } catch {
      /* ignore */
    }
    // Easiest reliable reset on the prototype: full page reload. Avoids a
    // long list of "also reset that, also that" bugs as systems grow.
    location.reload();
  }

  /** Toggle the budget panel; closes the tile-info card if it was open. */
  toggleBudget(): void {
    if (this.budgetPanel.isOpen()) {
      this.budgetPanel.hide();
    } else {
      this.panel.hide();
      this.budgetPanel.show();
    }
  }

  private clearSelection(): void {
    this.selected = null;
    this.renderer.clearSelection();
    this.panel.hide();
  }

  // --- Paint-mode handlers ------------------------------------------------

  private handlePaintStart(sx: number, sy: number): void {
    const tile = this.screenToTile(sx, sy);
    this.strokeOrigin = tile;
    this.strokeEdges.clear();
    this.strokeStubs.clear();
    this.strokeZones.clear();
    this.strokeBulldozed.clear();
    this.strokeDidSnapshot = false;
    if (!tile) return;

    // Snapshot before any state mutation so we can undo this whole stroke
    // in a single Undo press. handlePaintEnd will pop it back if the stroke
    // turned out to be a no-op (e.g. paint over already-painted tiles).
    this.snapshotForUndo();
    this.strokeDidSnapshot = true;

    // Place tools are tap-only (single building per tap). Skip the rubber
    // band entirely so a stationary touch doesn't keep dropping buildings.
    const placeKind = PLACE_TOOL_TO_BUILDING.get(this.tool);
    if (placeKind) {
      const placed = this.placeBuilding(tile.x, tile.y, placeKind);
      if (!placed) {
        // Place failed (insufficient funds / occupied tile) — keep the
        // undo stack clean.
        this.undoStack.pop();
        this.strokeDidSnapshot = false;
      }
      this.strokeOrigin = null;
      return;
    }

    this.applyRubberBand(tile);
  }

  private handlePaintMove(sx: number, sy: number): void {
    if (!this.strokeOrigin) return;
    const tile = this.screenToTile(sx, sy);
    if (!tile) return;
    this.applyRubberBand(tile);
  }

  private handlePaintEnd(): void {
    if (this.strokeDidSnapshot) {
      const noop =
        this.strokeEdges.size === 0 &&
        this.strokeStubs.size === 0 &&
        this.strokeZones.size === 0 &&
        this.strokeBulldozed.size === 0;
      if (noop) this.undoStack.pop();
      this.strokeDidSnapshot = false;
    }
    this.strokeOrigin = null;
    this.strokeEdges.clear();
    this.strokeStubs.clear();
    this.strokeZones.clear();
    this.strokeBulldozed.clear();
  }

  /**
   * Single-tap building placement. Validates: tile is free (no road, zone,
   * or other building) and treasury can afford the cost. Returns true iff
   * a building was actually placed — caller (handlePaintStart) uses this
   * to decide whether the snapshot it pushed should be popped. Refunds
   * nothing on bulldoze — keep the prototype simple.
   */
  private placeBuilding(x: number, y: number, kind: Exclude<Building, 'none'>): boolean {
    const cost = BUILDING_COSTS[kind];
    if (this.economy.treasury < cost) return false;
    if (!this.grid.setBuilding(x, y, kind)) return false;
    this.economy.treasury -= cost;
    this.services.recompute(this.grid);
    this.renderer.drawCityBuildings(this.grid);
    return true;
  }

  private applyRubberBand(end: { x: number; y: number }): void {
    if (!this.strokeOrigin) return;
    const path = path8(this.strokeOrigin, end);
    if (this.tool === 'road') this.applyRoadStroke(path);
    else if (this.tool === 'bulldoze') this.applyBulldozeStroke(path);
    else if (ZONE_TOOLS.has(this.tool)) this.applyZoneStroke(path, this.tool as Zone);
  }

  // --- Road tool stroke ---------------------------------------------------

  private applyRoadStroke(path: { x: number; y: number }[]): void {
    const desiredEdges = new Set<number>();
    const desiredStubs = new Set<number>();

    if (path.length === 1) {
      desiredStubs.add(this.tileIndex(path[0]!.x, path[0]!.y));
    } else {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        desiredEdges.add(packEdge(this.tileIndex(a.x, a.y), this.tileIndex(b.x, b.y)));
      }
    }

    let roadsChanged = false;
    let zonesChanged = false;

    // Revert this-stroke edges no longer wanted.
    for (const ek of this.strokeEdges) {
      if (desiredEdges.has(ek)) continue;
      if (this.grid.setRoadEdgeByKey(ek, false)) roadsChanged = true;
      this.strokeEdges.delete(ek);
    }
    for (const sk of this.strokeStubs) {
      if (desiredStubs.has(sk)) continue;
      const { x, y } = this.unpackTile(sk);
      if (this.grid.setRoad(x, y, false)) roadsChanged = true;
      this.strokeStubs.delete(sk);
    }

    // Apply the desired road state.
    for (const ek of desiredEdges) {
      // setRoadEdge promotes the endpoints to road and silently displaces
      // their zones. We get a small free side-effect: a zone overlay redraw
      // will be triggered if any zone was cleared.
      const { ax, ay, bx, by } = unpackEdge(ek, this.grid.width);
      const beforeZA = this.grid.zoneAt(ax, ay);
      const beforeZB = this.grid.zoneAt(bx, by);
      if (this.grid.hasRoadEdge(ax, ay, bx, by)) continue;
      if (this.grid.setRoadEdge(ax, ay, bx, by, true)) {
        this.strokeEdges.add(ek);
        roadsChanged = true;
        if (beforeZA !== this.grid.zoneAt(ax, ay) || beforeZB !== this.grid.zoneAt(bx, by)) {
          zonesChanged = true;
        }
      }
    }
    for (const sk of desiredStubs) {
      const { x, y } = this.unpackTile(sk);
      const t = this.grid.get(x, y);
      if (!t || t.road) continue;
      if (this.grid.setRoad(x, y, true)) {
        // Promoting to road also displaces any zone on this tile.
        if (t.zone !== 'none') {
          t.zone = 'none';
          zonesChanged = true;
        }
        this.strokeStubs.add(sk);
        roadsChanged = true;
      }
    }

    if (roadsChanged) {
      this.renderer.drawRoads(this.grid);
      // A* needs an up-to-date adjacency for any spawn that follows.
      this.roadGraph.rebuild(this.grid);
    }
    if (zonesChanged) {
      this.renderer.drawZones(this.grid);
      // Promoting a zoned tile to road wipes its building.
      this.renderer.drawBuildings(this.grid);
    }
  }

  // --- Zone tool stroke ---------------------------------------------------

  private applyZoneStroke(path: { x: number; y: number }[], zone: Zone): void {
    const desired = new Set<number>();
    for (const p of path) desired.add(this.tileIndex(p.x, p.y));

    let changed = false;

    // Revert tiles whose zone we changed in earlier moves but that no longer
    // fall on the rubber band.
    for (const [idx, original] of this.strokeZones) {
      if (desired.has(idx)) continue;
      const { x, y } = this.unpackTile(idx);
      if (this.grid.setZone(x, y, original)) changed = true;
      this.strokeZones.delete(idx);
    }

    // Apply desired zone where eligible. Invalid tiles (road, no road
    // adjacent, off-map) are silently skipped — feels nicer than rejecting
    // a whole stroke.
    for (const idx of desired) {
      const { x, y } = this.unpackTile(idx);
      const tile = this.grid.get(x, y);
      if (!tile) continue;
      if (tile.zone === zone) continue;
      // Snapshot original ONCE per tile per stroke so a wiggle restores
      // correctly even if we touched the cell multiple times.
      if (!this.strokeZones.has(idx)) this.strokeZones.set(idx, tile.zone);
      if (this.grid.setZone(x, y, zone)) changed = true;
      else if (!this.strokeZones.has(idx)) {
        // setZone refused; don't keep a phantom snapshot around.
      }
    }

    if (changed) {
      this.renderer.drawZones(this.grid);
      // Re-zoning a developed tile resets its density to 0; rebuild buildings.
      this.renderer.drawBuildings(this.grid);
    }
  }

  // --- Bulldoze stroke ----------------------------------------------------

  private applyBulldozeStroke(path: { x: number; y: number }[]): void {
    const desired = new Set<number>();
    for (const p of path) desired.add(this.tileIndex(p.x, p.y));

    let roadsChanged = false;
    let zonesChanged = false;
    let cityBuildingsChanged = false;

    // Find tiles previously bulldozed by this stroke that aren't on the
    // new rubber-band path — we'll restore them.
    const toRestore: number[] = [];
    for (const idx of this.strokeBulldozed.keys()) {
      if (!desired.has(idx)) toRestore.push(idx);
    }

    // PHASE 1 — restore roads first across all to-restore tiles. Doing all
    // road restoration before any zone restoration matters: a zone tile
    // might depend on an adjacent road that's also being restored, and we
    // need that road back before re-zoning is valid.
    for (const idx of toRestore) {
      const snap = this.strokeBulldozed.get(idx)!;
      const { x, y } = this.unpackTile(idx);
      for (const ek of snap.edges) {
        if (this.grid.setRoadEdgeByKey(ek, true)) roadsChanged = true;
      }
      if (snap.wasRoad && !this.grid.hasRoad(x, y)) {
        if (this.grid.setRoad(x, y, true)) roadsChanged = true;
      }
    }
    // PHASE 2 — restore zones + density + buildings (bypasses setZone /
    // setBuilding validation since the snapshot was a previously-valid state).
    for (const idx of toRestore) {
      const snap = this.strokeBulldozed.get(idx)!;
      const { x, y } = this.unpackTile(idx);
      const t = this.grid.get(x, y);
      if (!t) continue;

      // City building takes precedence over zone (they're mutually exclusive).
      if (snap.building !== 'none' && !t.road && t.zone === 'none' && t.building === 'none') {
        t.building = snap.building;
        cityBuildingsChanged = true;
      }
      if (t.road || t.building !== 'none') continue;
      if (snap.zone === 'none' && t.zone === 'none') continue;
      if (t.zone !== snap.zone || t.density !== snap.density) {
        t.zone = snap.zone;
        t.density = snap.density;
        t.developmentPressure = snap.developmentPressure;
        zonesChanged = true;
      }
    }
    for (const idx of toRestore) this.strokeBulldozed.delete(idx);

    // Destroy each new path tile, snapshotting first so we can revert later.
    for (const idx of desired) {
      if (this.strokeBulldozed.has(idx)) continue; // already snapshotted
      const { x, y } = this.unpackTile(idx);
      const tile = this.grid.get(x, y);
      if (!tile) continue;
      if (!tile.road && tile.zone === 'none' && tile.building === 'none') continue;

      const snap: BulldozedSnapshot = {
        wasRoad: tile.road,
        zone: tile.zone,
        density: tile.density,
        developmentPressure: tile.developmentPressure,
        edges: this.grid.incidentRoadEdges(x, y),
        building: tile.building
      };
      this.strokeBulldozed.set(idx, snap);

      // Clear edges first (auto-demotes stub when last edge goes).
      for (const ek of snap.edges) {
        if (this.grid.setRoadEdgeByKey(ek, false)) roadsChanged = true;
      }
      if (this.grid.setRoad(x, y, false)) roadsChanged = true;
      if (tile.zone !== 'none') {
        if (this.grid.setZone(x, y, 'none')) zonesChanged = true;
      }
      if (tile.building !== 'none') {
        if (this.grid.setBuilding(x, y, 'none')) cityBuildingsChanged = true;
      }
    }

    if (roadsChanged) {
      this.renderer.drawRoads(this.grid);
      this.roadGraph.rebuild(this.grid);
    }
    if (zonesChanged) {
      this.renderer.drawZones(this.grid);
      // Bulldozing tears down whatever was developing on that tile.
      this.renderer.drawBuildings(this.grid);
    }
    if (cityBuildingsChanged) {
      this.renderer.drawCityBuildings(this.grid);
      // Service coverage changed — rerun the sweep so Development sees it.
      this.services.recompute(this.grid);
    }
  }

  // --- Helpers ------------------------------------------------------------

  private tileIndex(x: number, y: number): number {
    return y * this.grid.width + x;
  }
  private unpackTile(idx: number): { x: number; y: number } {
    return { x: idx % this.grid.width, y: Math.floor(idx / this.grid.width) };
  }
}

interface BulldozedSnapshot {
  wasRoad: boolean;
  zone: Zone;
  /** Density at bulldoze time — restored verbatim if the rubber band retreats. */
  density: number;
  developmentPressure: number;
  /** Packed edge keys that existed at the moment we bulldozed this tile. */
  edges: number[];
  /** City building (power plant, water tower, …) that occupied this tile. */
  building: Building;
}

/**
 * 8-connected diagonal-first path on a grid. Diagonal moves consume both
 * axes at once until one runs out, then the remainder steps orthogonally.
 * Result: a single bend at most for any straight drag.
 */
function path8(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [{ x: a.x, y: a.y }];
  let x = a.x;
  let y = a.y;
  for (let i = 0; i < 4096; i++) {
    if (x === b.x && y === b.y) break;
    if (x !== b.x) x += Math.sign(b.x - x);
    if (y !== b.y) y += Math.sign(b.y - y);
    out.push({ x, y });
  }
  return out;
}

const EDGE_PACK_SHIFT = 1 << 20;
function packEdge(ai: number, bi: number): number {
  const lo = ai < bi ? ai : bi;
  const hi = ai < bi ? bi : ai;
  return hi * EDGE_PACK_SHIFT + lo;
}
function unpackEdge(key: number, width: number): { ax: number; ay: number; bx: number; by: number } {
  const lo = key % EDGE_PACK_SHIFT;
  const hi = Math.floor(key / EDGE_PACK_SHIFT);
  return {
    ax: lo % width,
    ay: Math.floor(lo / width),
    bx: hi % width,
    by: Math.floor(hi / width)
  };
}
