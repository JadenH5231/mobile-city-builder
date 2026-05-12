import { Camera } from './Camera';
import { Input } from './Input';
import { Renderer } from './Renderer';
import { Grid } from '../world/Grid';
import { TileInfoPanel, diagnoseTile } from '../ui/TileInfoPanel';
import { Toolbar } from '../ui/Toolbar';
import { Development } from '../simulation/Development';
import { Economy } from '../simulation/Economy';
import { GlobalMarket } from '../simulation/GlobalMarket';
import { Milestones } from '../simulation/Milestones';
import { Events, type GameEvent } from '../simulation/Events';
import { Stats } from '../simulation/Stats';
import { Achievements, type Achievement } from '../simulation/Achievements';
import { Bonds, type BondId } from '../simulation/Bonds';
import { Ferries } from '../simulation/Ferries';
import { Crime } from '../simulation/Crime';
import { Districts } from '../simulation/Districts';
import { Skyscrapers } from '../simulation/Skyscrapers';
import { Pathfinding } from '../simulation/Pathfinding';
import { PathGraph } from '../simulation/PathGraph';
import { Pedestrians } from '../simulation/Pedestrians';
import { Population } from '../simulation/Population';
import { RoadGraph } from '../simulation/RoadGraph';
import { Buses } from '../simulation/Buses';
import { Services } from '../simulation/Services';
import { Traffic } from '../simulation/Traffic';
import { TrafficLights } from '../simulation/TrafficLights';
import { Vehicles } from '../simulation/Vehicles';
import { BudgetPanel } from '../ui/BudgetPanel';
import { HappinessPanel } from '../ui/HappinessPanel';
import { CouncilPanel } from '../ui/CouncilPanel';
import { Happiness } from '../simulation/Happiness';
import { Council, FACTION_RIVALS, FACTION_STANCES, type StanceKey } from '../simulation/Council';
import type { FactionId } from '../simulation/Happiness';
import { PhotoOpBanner } from '../ui/PhotoOpBanner';
import { SaveGame, applySave, serialize, type SaveData } from '../persistence/SaveGame';
import {
  BUILDING_COSTS,
  CRASH_DEMAND_PENALTY,
  CRASH_TREASURY_PENALTY,
  CITY_EXPANSION_BLOCK_SIZE,
  CITY_EXPANSION_COST,
  LAND_PURCHASE_COST_PER_TILE,
  LUXURY_LOW_COST,
  MAYOR_MANSION_DEPTH,
  MAYOR_MANSION_WIDTH,
  SKYSCRAPER_COST,
  SKYSCRAPER_VARIANT_COUNT,
  MAP_SIZES,
  PLACE_TOOL_TO_BUILDING,
  ROAD_TIER,
  ROAD_TOOLS,
  SERVICE_RADIUS,
  STOP_SIGN_COST,
  TERRAFORM_COSTS,
  TILE_SIZE,
  TRAFFIC_LIGHT_COST,
  ZONE_TIER_CAP,
  ZONE_TOOL_INFO,
  dirBetween,
  type Building,
  type MapSize,
  type RoadType,
  type Tool,
  type Zone,
  type ZoneTier
} from '../types';

/** Fixed sim-tick interval, in ms. 100ms = 10 Hz. */
const SIM_STEP_MS = 100;
/** Hard cap on catch-up ticks per frame so a backgrounded tab can't lock the loop. */
const MAX_SIM_STEPS_PER_FRAME = 5;
/** Auto-save interval (real-time milliseconds). */
const AUTOSAVE_MS = 30_000;
/** Max undo entries kept in memory. */
const UNDO_STACK_LIMIT = 20;
/** SessionStorage key set by `resetCity` so the post-reload init skips
 *  loading any stray autosave that won the race. */
const RESET_FLAG = 'city-builder-just-reset';

/** Human-readable labels for the cost-pill display (Alpha 4.5). Falls
 *  back to the Building key when missing. */
const TOOL_LABEL: Partial<Record<Tool, string>> = {
  road_local: 'Local Road',
  road_avenue: 'Avenue',
  road_highway: 'Highway',
  place_path: 'Walking Path',
  place_power: 'Power Plant',
  place_water: 'Water Tower',
  place_park: 'Park',
  place_forestry: 'Forestry',
  place_farm: 'Farm',
  place_school: 'School',
  place_hospital: 'Hospital',
  place_fire_station: 'Fire Station',
  place_police_station: 'Police Station',
  place_bus_stop: 'Bus Stop',
  place_bus_depot: 'Bus Depot',
  place_museum: 'Museum',
  place_stadium: 'Stadium',
  place_observatory: 'Observatory',
  place_ferry_dock: 'Ferry Dock',
  place_subway_entrance: 'Subway',
  place_plaza: 'Plaza',
  place_fountain: 'Fountain',
  place_statue: 'Statue',
  place_flower_bed: 'Flower Bed',
  place_topiary: 'Topiary',
  place_pergola: 'Pergola',
  place_reflecting_pool: 'Reflecting Pool',
  place_memorial_garden: 'Memorial Garden',
  place_clock_tower: 'Clock Tower',
  place_triumphal_arch: 'Triumphal Arch',
  place_pier: 'Pier',
  place_mayor_mansion: 'Mayor\'s Mansion'
};

/**
 * Service buildings whose radius should be previewed when their Place
 * tool is the active tool (Alpha 4.5). Each maps to the SERVICE_RADIUS
 * key that drives the disc size — most match the kind, but power /
 * water are city-wide as of 3.1.4 and don't get a tile-radius disc.
 */
const SERVICE_RADIUS_PREVIEW: Partial<Record<Tool, { key: keyof typeof SERVICE_RADIUS; label: string }>> = {
  place_park:   { key: 'park',   label: 'Park coverage' },
  place_school: { key: 'school', label: 'School coverage' },
  place_hospital: { key: 'hospital', label: 'Hospital coverage' },
  place_fire_station: { key: 'fire', label: 'Fire protection' },
  place_police_station: { key: 'police', label: 'Police coverage' }
};

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
  /** Active-tool cost pill (Alpha 4.5). Updated by `refreshToolCostPill`
   *  whenever the active tool changes, the council elects a new term,
   *  or the treasury crosses below the active tool's cost. main.ts
   *  passes in the HTMLElement reference at init. */
  toolCostPillEl: HTMLElement | null = null;
  budgetPanel!: BudgetPanel;
  happinessPanel!: HappinessPanel;
  councilPanel!: CouncilPanel;
  photoOpBanner!: PhotoOpBanner;
  /** Happiness state: faction map, recomputed when the panel refreshes. */
  readonly happiness = new Happiness();
  /** Council state: current term's councillors, opponent, last election result. */
  readonly council = new Council();

  selected: { x: number; y: number } | null = null;
  tool: Tool = 'pan';

  /**
   * Fired at the end of a bulldoze stroke that touched > 5 tiles. main.ts
   * subscribes to surface a "Bulldozed N tiles · Undo" toast. The undo
   * stack already holds a snapshot from the stroke's start, so the toast's
   * Undo button just calls {@link Game.undo}.
   */
  onBigBulldoze?: (tileCount: number) => void;

  /**
   * Short status pill (Alpha 2.4.2). Fired when an action silently fails
   * for a reason the player should know about — typically "not enough
   * money" on a Place tool, where the original behaviour was a silent
   * no-op that looked like the button was broken. main.ts owns the DOM.
   */
  onStatusMessage?: (msg: string) => void;

  /**
   * Milestone earned (Alpha 2.8). Fired once per milestone the city
   * crosses, with the Milestone object so main.ts can render the
   * celebration banner. Multiple milestones earned in one tick are
   * delivered one at a time across subsequent frames.
   */
  onMilestoneEarned?: (m: import('../types').Milestone) => void;

  /**
   * Random / crisis event fired (Alpha 2.9). main.ts wires this to a
   * modal — for `severity: 'choice'` events the modal blocks until the
   * player picks; everything else auto-dismisses. Resolution happens
   * via the resolveEventChoice() method on Game.
   */
  onEvent?: (e: GameEvent) => void;

  resolveEventChoice(event: GameEvent, choiceId: string): void {
    this.events.resolveChoice(event, choiceId, this.economy);
    this.achievements.recordEventResolved();
  }

  /**
   * Issue a bond (Alpha 2.18). Credits the principal to the treasury and
   * adds the bond to the active list. Returns true on success, false if
   * the player is already at the bond cap. Surfaces a status toast either
   * way so the budget panel doesn't have to do its own messaging.
   */
  issueBond(specId: BondId): boolean {
    const principal = this.bonds.issue(specId, this.economy.monthsElapsed);
    if (principal === 0) {
      this.onStatusMessage?.('Bond declined — already at the limit');
      return false;
    }
    this.economy.treasury += principal;
    this.onStatusMessage?.(`Bond issued · +$${principal.toLocaleString()}`);
    return true;
  }

  /** Achievement just unlocked (Alpha 2.15). main.ts surfaces a corner toast. */
  onAchievementUnlocked?: (a: Achievement) => void;
  /** New council leader the player has never met (Alpha 2.15). main.ts owns
   *  the modal; Game just emits per faction id, in council order. */
  onNewLeader?: (id: FactionId) => void;

  /**
   * Sim speed multiplier. 0 = paused (no sim ticks, no vehicle/walker
   * motion). 1 = normal. 2 / 3 fast-forward. The render loop continues
   * regardless so the HUD stays responsive while paused.
   */
  simSpeed: 0 | 1 | 2 | 3 = 1;
  /**
   * Photo mode hides all HUD chrome (pills, toolbar, panels). Kept on
   * Game so we can persist it later if we want; today it's purely a CSS
   * toggle owned by main.ts.
   */
  photoMode = false;
  /** Reduce-motion preference (Alpha 4.8). When true, the day/night
   *  sun arc slows to 10% of normal speed so the ambient sky doesn't
   *  pulse for motion-sensitive players. Set by main.ts from the
   *  Settings panel's checkbox. */
  reduceMotion = false;

  private host!: HTMLElement;

  // ---- Per-stroke rubber-band state ----
  private strokeOrigin: { x: number; y: number } | null = null;
  /** Road tool: edges added. Keys via {@link packEdge}. */
  private readonly strokeEdges = new Set<number>();
  /** Road tool: tile indices flipped from road=false to road=true. */
  private readonly strokeStubs = new Set<number>();
  /** Zone tool: per-tile snapshot of original (zone, cap) for revert. */
  private readonly strokeZones = new Map<number, { zone: Zone; cap: 0 | 1 | 2 | 3 }>();
  /** Path tool: tile indices flipped from path=false to path=true this stroke. */
  private readonly strokePaths = new Set<number>();
  /** Bulldoze tool: per-tile snapshot of all destroyed state for revert. */
  private readonly strokeBulldozed = new Map<number, BulldozedSnapshot>();
  /**
   * Road tool: tile indices where the stroke cleared a forest tile down to
   * grass. Used to restore the tree if the rubber band retreats. Outside of
   * an active stroke this stays empty; the trees are permanently gone once
   * the stroke commits (matches real life: paving over a forest is a
   * one-way operation unless the player Undoes the whole stroke).
   */
  private readonly strokeForestCleared = new Set<number>();
  /** Council-block toast guard (Alpha 2.9.1): fires once per stroke. */
  private councilBlockNotifiedThisStroke = false;

  /**
   * Bridge Mode (Alpha 2.12): when true, road-paint operates on the
   * upper layer (`bridgeRoadEdges`) instead of the ground layer. This
   * lets the player draw overpasses that cross at-grade roads without
   * forming intersections. Toggled via the HUD pill.
   */
  bridgeMode = false;
  /** Per-stroke tracking for upper-layer edges (parallel to strokeEdges). */
  private readonly strokeBridgeEdges = new Set<number>();

  /** Per-frame tick callbacks (FPS counter, render-rate things). */
  readonly tickCallbacks: Array<(dt: number) => void> = [];

  /**
   * Day/night cycle phase ∈ [0, 1] (Alpha 2.14). 0 = midnight, 0.5 =
   * noon, etc. Advanced every render frame at DAY_SECONDS rate. Sim
   * speed multiplies the day cycle too — fast-forwarding the city
   * speeds the sun. Pause stops it.
   */
  timeOfDay = 0.40;
  /** Real-time seconds per full day cycle (Alpha 3.0.1). 12 minutes at
   *  1×. The renderer additionally warps the phase so ~70% of the cycle
   *  is day and ~30% is night — see Renderer.applyTimeOfDay. */
  static readonly DAY_SECONDS = 720;

  // Fixed-rate sim systems run inside `startLoop` via an accumulator clock.
  // Population must tick before Development since the latter reads demand;
  // Economy reads Population for monthly settlement and Population reads
  // Economy for the tax-driven demand penalty (one-frame stale tax penalty
  // is fine — the slider was about to settle anyway).
  readonly economy = new Economy();
  /** Global lumber market + outside-world connection check (Alpha 2.7). */
  readonly globalMarket = new GlobalMarket();
  /** Population milestones + tool unlocks (Alpha 2.8). */
  readonly milestones = new Milestones();
  /** Random events + crises (Alpha 2.9). */
  readonly events = new Events();
  /** Time-series history (Alpha 2.11). Captured monthly. */
  readonly stats = new Stats();
  /** Lifetime achievements + leader-bio met set (Alpha 2.15). */
  readonly achievements = new Achievements();
  /** Municipal bonds + active loan tracker (Alpha 2.18). */
  readonly bonds = new Bonds();
  /** Ferry routes between dock pairs (Alpha 2.19). */
  readonly ferries = new Ferries();
  /** Per-tile crime simulation (Alpha 2.21). Recomputed monthly, drives the
   *  Crime heatmap layer + a small commercial-revenue penalty. */
  readonly crime = new Crime();
  /** District registry + per-tile assignment (Alpha 2.22). */
  readonly districts = new Districts();
  /** Skyscraper construction simulation (Alpha 3.1.2). */
  readonly skyscrapers = new Skyscrapers();
  /** District being painted by the paint_district tool (Alpha 2.22). 0 means
   *  "allocate a fresh district on first paint of the stroke". */
  activeDistrictId = 0;
  /** Player-given name for the active save slot (Alpha 2.20). Empty
   *  string means "use the default 'City N' label". Persisted alongside
   *  every autosave. */
  cityName = '';
  /** Cheat: top up treasury to a billion at every monthly settlement
   *  (Alpha 3.2.4). Useful for playtesting late-game systems without
   *  having to grind. Persisted in the save so it survives reloads. */
  cheatUnlimitedMoney = false;
  /** Cheat: clamp R/C/I demand to +1.0 each frame so zoning grows
   *  immediately regardless of city happiness or job balance. */
  cheatUnlimitedDemand = false;
  readonly population = new Population();
  private readonly development = new Development(this.population);
  // Road graph is rebuilt on any road-state change. Pathfinder reuses
  // internal buffers across calls.
  readonly roadGraph = new RoadGraph();
  private readonly pathfinder = new Pathfinding();
  /** Pedestrian adjacency graph — paths + non-highway road tiles. Rebuilt
   *  alongside the road graph whenever walkable tiles change. */
  readonly pathGraph = new PathGraph();
  /** Walker pathfinder — separate buffers from the car pathfinder so the two
   *  systems don't trip over each other's gScore/cameFrom maps within a tick. */
  private readonly walkPathfinder = new Pathfinding();
  readonly vehicles = new Vehicles();
  readonly buses = new Buses();
  readonly pedestrians = new Pedestrians();
  // Service-coverage flags get rebuilt on any building placement / removal.
  private readonly services = new Services();
  // Traffic owns the per-tile EMA + stress aggregate read by Population.
  readonly traffic = new Traffic();
  // Adaptive traffic-light controller — phases + queue-aware green timing.
  readonly trafficLights = new TrafficLights();
  private simAccumulatorMs = 0;
  /** Toggle for the traffic heatmap overlay. */
  heatmapVisible = false;
  /** Crime heatmap toggle (Alpha 2.21). Mutually exclusive with the
   *  traffic heatmap — only one heatmap layer renders at a time. */
  crimeHeatmapVisible = false;
  /** Throttle so the heatmap mesh isn't rebuilt every render frame. */
  private heatmapAccumMs = 0;
  // Persistence — auto-saves every AUTOSAVE_MS, also restores on init.
  readonly saveGame = new SaveGame();
  private autosaveAccumMs = 0;
  /** Set true when {@link resetCity} runs, so the autosave doesn't race the
   *  imminent location.reload() and re-write the city to IDB after we
   *  cleared it. Also gated by a sessionStorage flag (`RESET_FLAG`) that
   *  init() honours after the reload, in case the race wins anyway. */
  private resetting = false;
  // Undo — capped FIFO stack of full snapshots. One entry per user-initiated
  // operation (paint stroke, building placement). Tax slider tweaks aren't
  // tracked because the user can just slide back.
  private readonly undoStack: SaveData[] = [];
  /** True if we pushed an entry at this stroke's start (so end can untie noops). */
  private strokeDidSnapshot = false;

  async init(host: HTMLElement, mapSize: MapSize = MAP_SIZES.small, slotKey?: string): Promise<void> {
    if (slotKey) this.saveGame.useSlot(slotKey);
    this.host = host;
    const canvas = document.createElement('canvas');
    canvas.style.touchAction = 'none';
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.appendChild(canvas);

    this.renderer = new Renderer(canvas);
    // Beautification overlay is council-controlled (Alpha 4.0). Install
    // a provider so every Renderer.drawBuildings rebuild auto-refreshes
    // the streetscape mesh — no need to pair calls at every paint site.
    this.renderer.setBeautificationProvider(() => this.council.effectiveBeautificationTier);
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
    // Architect Mode swap (Alpha 4.0) — Game just ack-toasts the change
    // so the player has clear feedback. Toolbar handles the actual
    // ITEMS swap + resets the active tool to Pan internally.
    this.toolbar.onModeChange = (mode) => {
      this.onStatusMessage?.(
        mode === 'architect'
          ? 'Architect mode — terraform + decoratives'
          : 'Build mode — zones, roads, services'
      );
    };
    // Surface the "Unlocks at <Milestone> · NNN pop" toast when a player
    // taps a locked tool (Alpha 2.8).
    this.toolbar.onLocked = (tool) => {
      // Defensive (Alpha 2.12.1): if the milestone IS earned but the
      // toolbar's lock state is stale (e.g. mid-restore race or a missed
      // refresh), refresh + activate instead of toasting an inaccurate
      // message. Milestones are permanent — once earned, never relock.
      if (this.milestones.isUnlocked(tool)) {
        this.refreshToolbarLocks();
        this.setTool(tool);
        return;
      }
      const m = this.milestones.milestoneForTool(tool);
      if (!m) {
        this.onStatusMessage?.('Tool not yet available');
        return;
      }
      this.onStatusMessage?.(`Unlocks at ${m.name} · ${m.popThreshold.toLocaleString()} pop`);
    };
    // Refresh banned-tool indicators on first paint and after any election.
    this.refreshToolbarBans();
    this.refreshToolbarLocks();
    this.budgetPanel = new BudgetPanel(this.economy, this.bonds, this.council);
    this.budgetPanel.onIssueBond = (id) => { this.issueBond(id); this.budgetPanel.refresh(); };
    this.happinessPanel = new HappinessPanel({
      happiness: this.happiness,
      council: this.council,
      grid: () => this.grid,
      economy: this.economy,
      population: this.population,
      traffic: this.traffic,
      achievements: this.achievements
    });
    this.councilPanel = new CouncilPanel(this.council);
    this.photoOpBanner = new PhotoOpBanner();

    // Try to restore an existing save before drawing initial state. Failures
    // (no save / version mismatch / IDB unavailable) silently fall through
    // to a fresh map. If the previous tab session called resetCity, honour
    // that even if the autosave-vs-reload race somehow committed a save —
    // re-clear here so the slot is genuinely empty.
    const justReset = (() => {
      try {
        const v = sessionStorage.getItem(RESET_FLAG);
        if (v) sessionStorage.removeItem(RESET_FLAG);
        return v === '1';
      } catch {
        return false;
      }
    })();
    try {
      await this.saveGame.open();
      if (justReset) {
        await this.saveGame.clear();
      } else {
        const data = await this.saveGame.load();
        if (data) {
          applySave(data, this.grid, this.economy, this.council, this.milestones, this.events, this.stats, this.achievements, this.bonds, this.districts);
          if (data.cityName) this.cityName = data.cityName;
          this.cheatUnlimitedMoney = data.cheatUnlimitedMoney ?? false;
          this.cheatUnlimitedDemand = data.cheatUnlimitedDemand ?? false;
        }
      }
    } catch {
      // IndexedDB not available (private browsing on iOS, etc.) — ignore.
    }

    this.renderer.drawWorld(this.grid);
    this.renderer.drawZones(this.grid);
    this.renderer.drawPaths(this.grid);
    this.renderer.drawRoads(this.grid);
    this.renderer.drawBuildings(this.grid, this.cityMood(), this.economy.monthsElapsed);
    this.renderer.drawCityBuildings(this.grid, this.forestryHealth(), this.farmHealth());
    this.services.recompute(this.grid);
    this.roadGraph.rebuild(this.grid);
    this.pathGraph.rebuild(this.grid);
    this.trafficLights.rebuild(this.grid);
    this.globalMarket.recompute(this.grid);
    this.fitCameraToGrid();
    this.handleResize();

    window.addEventListener('resize', this.handleResize);
    this.startLoop();
  }

  /**
   * Recompute which Tools are banned by the current council and push the
   * set into the Toolbar so it can flip the visual state. Called on init
   * and after every election so the player sees instantly what's blocked.
   */
  /**
   * Average city mood (Alpha 2.7), in [-1, +1]. Mean of every faction's
   * happiness — used by Renderer.drawBuildings to modulate building
   * colours (low mood → graffiti + dingy, high mood → vibrant). Per-tile
   * happiness inside the renderer further modulates by services.
   */
  cityMood(): number {
    if (!this.happiness) return 0;
    const ids: FactionId[] = [
      'nimbys','yimbys','environmentalists','hometown','chamber',
      'transit','drivers','taxpayers','safer_streets','working_families'
    ];
    let sum = 0;
    for (const id of ids) sum += this.happiness.get(id);
    return sum / ids.length;
  }

  /**
   * Visual health for forestry clusters (Alpha 2.7), 0..1. Healthy when
   * the city is connected to the outside world AND the global lumber
   * price is high; struggling otherwise. Read by Renderer.
   */
  forestryHealth(): number {
    if (!this.globalMarket.isConnected()) return 0.30;
    const price = this.globalMarket.lumberPrice(this.economy.monthsElapsed);
    // lumber price oscillates roughly in [0.55, 1.45]; map to [0, 1].
    return Math.max(0, Math.min(1, (price - 0.55) / 0.9));
  }

  /**
   * Visual health for farm clusters (Alpha 2.7.1). Same shape as
   * forestryHealth but reads the produce-price oscillation. Disconnected
   * farms struggle visually but less severely than disconnected forestry
   * (food has more local market).
   */
  farmHealth(): number {
    if (!this.globalMarket.isConnected()) return 0.40;
    const price = this.globalMarket.producePrice(this.economy.monthsElapsed);
    // produce price oscillates roughly in [0.65, 1.35]; map to [0, 1].
    return Math.max(0, Math.min(1, (price - 0.65) / 0.7));
  }

  /**
   * Push the council's currently-effective Beautification tier into
   * the renderer (Alpha 4.0). Called whenever the buildings layer is
   * rebuilt (catches new C/MU paint) AND whenever the tier flips
   * (election or monthly defund). Cheap on a cold rebuild.
   */
  private refreshBeautification(): void {
    this.renderer.drawBeautification(this.grid, this.council.effectiveBeautificationTier);
  }

  private refreshToolbarBans(): void {
    const banned = new Set<Tool>();
    // Each tool maps to its FACTION_STANCES key. Walking-path and
    // traffic-light have no stance row by design — never banned.
    const toolToKey: Array<[Tool, StanceKey]> = [
      ['road_local', 'road_local'],
      ['road_avenue', 'road_avenue'],
      ['road_highway', 'road_highway'],
      ['residential_low', 'r_low'],
      ['residential_medium', 'r_medium'],
      ['residential_high', 'r_high'],
      ['residential_luxury_low', 'r_lux'],
      ['commercial_low', 'c_low'],
      ['commercial_medium', 'c_medium'],
      ['commercial_high', 'c_high'],
      ['industrial_low', 'i_low'],
      ['industrial_medium', 'i_medium'],
      ['industrial_high', 'i_high'],
      ['mixed_low', 'mu_low'],
      ['mixed_medium', 'mu_medium'],
      ['mixed_high', 'mu_high'],
      ['place_power', 'power_plant'],
      ['place_water', 'water_tower'],
      ['place_park', 'park'],
      ['place_forestry', 'forestry'],
      ['place_farm', 'farm'],
      ['place_school', 'school'],
      ['place_hospital', 'hospital'],
      ['place_fire_station', 'fire_station'],
      ['place_police_station', 'police_station'],
      ['place_bus_stop', 'bus_stop'],
      ['place_bus_depot', 'bus_depot'],
      ['place_stop_sign', 'stop_sign'],
      ['place_museum', 'museum'],
      ['place_stadium', 'stadium'],
      ['place_observatory', 'observatory'],
      ['place_ferry_dock', 'ferry_dock'],
      ['place_subway_entrance', 'subway_entrance'],
      // Architect Mode decoratives (Alpha 4.0) — same dispatch shape,
      // each tool keys into its FACTION_STANCES row.
      ['place_plaza', 'plaza'],
      ['place_fountain', 'fountain'],
      ['place_statue', 'statue'],
      ['place_flower_bed', 'flower_bed'],
      ['place_topiary', 'topiary'],
      ['place_pergola', 'pergola'],
      ['place_reflecting_pool', 'reflecting_pool'],
      ['place_memorial_garden', 'memorial_garden'],
      ['place_clock_tower', 'clock_tower'],
      ['place_triumphal_arch', 'triumphal_arch'],
      ['place_pier', 'pier'],
      // Mayor's Mansion (Alpha 4.2) — single-instance prestige build.
      ['place_mayor_mansion', 'mayor_mansion']
    ];
    for (const [tool, key] of toolToKey) {
      if (!isFinite(this.council.costMultiplier(key))) banned.add(tool);
    }
    this.toolbar.setBannedTools(banned);
  }

  /**
   * Push the current locked-tool set into the toolbar (Alpha 2.8).
   * A tool is locked iff it isn't in `STARTING_TOOLS` and the
   * milestones tracker hasn't unlocked it yet. The toolbar renders
   * locked buttons with a 🔒 + greyed style and refuses to activate
   * them; tapping shows an "Unlocks at <Milestone> · NNN pop" toast.
   */
  private refreshToolbarLocks(): void {
    const KNOWN_TOOLS: readonly Tool[] = [
      'pan', 'bulldoze',
      'road_local', 'road_avenue', 'road_highway', 'place_path',
      'residential_low', 'residential_medium', 'residential_high', 'residential_luxury_low',
      'commercial_low', 'commercial_medium', 'commercial_high',
      'industrial_low', 'industrial_medium', 'industrial_high',
      'mixed_low', 'mixed_medium', 'mixed_high',
      'place_power', 'place_water', 'place_park',
      'place_forestry', 'place_farm',
      'place_school', 'place_hospital', 'place_fire_station', 'place_police_station',
      'place_bus_stop', 'place_bus_depot',
      'place_stop_sign', 'place_traffic_light',
      'place_museum', 'place_stadium', 'place_observatory',
      'place_ferry_dock', 'place_subway_entrance',
      'paint_district', 'erase_district',
      'residential_skyscraper', 'commercial_skyscraper', 'mixed_skyscraper',
      'buy_land',
      // Architect Mode (Alpha 4.0) — terraforming + decoratives.
      'terra_tree', 'terra_meadow', 'terra_pond', 'terra_smooth',
      'place_plaza', 'place_fountain', 'place_statue',
      'place_flower_bed', 'place_topiary', 'place_pergola',
      'place_reflecting_pool', 'place_memorial_garden',
      'place_clock_tower', 'place_triumphal_arch', 'place_pier',
      // Mayor's Mansion (Alpha 4.2) — Capital tier unlock.
      'place_mayor_mansion'
    ];
    const locked = new Set<Tool>();
    for (const t of KNOWN_TOOLS) {
      if (!this.milestones.isUnlocked(t)) locked.add(t);
    }
    const lockHints = new Map<Tool, string>();
    for (const t of locked) {
      const m = this.milestones.milestoneForTool(t);
      lockHints.set(t, m ? `${m.name} · ${m.popThreshold.toLocaleString()} pop` : 'Locked');
    }
    this.toolbar.setLockedTools(locked, lockHints);
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
    this.refreshToolCostPill();
    this.refreshServiceRadiusPreview();
  }

  /**
   * Update the HUD "active tool cost" pill (Alpha 4.5). Shown only
   * when the active tool has a per-tap cost — i.e. paid Place tools,
   * roads (per-edge cost), luxury pair, skyscrapers, mayor's mansion.
   * Reflects the council multiplier in the displayed cost so the
   * player sees what they'll actually pay, not the base price.
   *
   * States:
   * - hidden when active tool is `pan` / `bulldoze` / district paint
   *   etc. (anything not paid)
   * - gold "{name} · ${cost}" when affordable + not banned
   * - red "{name} · Banned" when council banned
   * - amber "{name} · ${cost} (short)" when treasury is below cost
   */
  refreshToolCostPill(): void {
    if (!this.toolCostPillEl) return;
    const info = this.toolCostInfo(this.tool);
    if (!info) {
      this.toolCostPillEl.classList.add('hidden');
      return;
    }
    this.toolCostPillEl.classList.remove('hidden');
    this.toolCostPillEl.classList.remove('banned', 'short');
    if (info.banned) {
      this.toolCostPillEl.classList.add('banned');
      this.toolCostPillEl.textContent = `${info.label} · Banned`;
      return;
    }
    if (this.economy.treasury < info.cost) {
      this.toolCostPillEl.classList.add('short');
    }
    this.toolCostPillEl.textContent = `${info.label} · $${info.cost.toLocaleString()}`;
  }

  /**
   * Update the service-radius preview disc (Alpha 4.5). Shown when a
   * service tool (park / school / hospital / fire / police) is the
   * active tool AND the player has a tile selected — the disc
   * appears around the selected tile at the building's coverage
   * radius, giving an immediate "would this reach the block I care
   * about?" check before tapping to place.
   *
   * Triggers:
   * - On `setTool` (service tool selected → show; non-service → hide)
   * - On tile selection change (Pan tool tap)
   * - On tile inspection from any source
   */
  private refreshServiceRadiusPreview(): void {
    const spec = SERVICE_RADIUS_PREVIEW[this.tool];
    if (!spec || !this.selected) {
      this.renderer.clearServiceRadiusPreview();
      return;
    }
    const radius = SERVICE_RADIUS[spec.key];
    const tile = this.grid.get(this.selected.x, this.selected.y);
    const elevation = tile ? tile.elevation : 0;
    this.renderer.showServiceRadiusPreview(this.selected.x, this.selected.y, radius, elevation);
  }

  /** Inspect the active tool and return its display label + cost.
   *  Returns null for free-of-charge tools (pan, bulldoze, district
   *  paint, terraforming-smooth, etc.) so the cost pill hides. */
  private toolCostInfo(tool: Tool): { label: string; cost: number; banned: boolean } | null {
    // Paid place tools (matches PLACE_TOOL_TO_BUILDING).
    const placeKind = PLACE_TOOL_TO_BUILDING.get(tool);
    if (placeKind) {
      const base = BUILDING_COSTS[placeKind];
      const stanceKey = placeKind as StanceKey;
      const mult = this.council.costMultiplier(stanceKey);
      const banned = !isFinite(mult);
      const cost = banned ? base : Math.round(base * mult);
      return { label: TOOL_LABEL[tool] ?? placeKind, cost, banned };
    }
    // Roads — per-edge cost. Tiers come from ROAD_TIER.
    const roadTier = ROAD_TOOLS.get(tool);
    if (roadTier) {
      const baseCost = ROAD_TIER[roadTier].maintenance; // surrogate: 1mo of upkeep ≈ build cost feel
      // Roads don't have an up-front cost in this game — they only pay
      // monthly maintenance — so show maintenance/mo as a proxy.
      return { label: TOOL_LABEL[tool] ?? `Road ${roadTier}`, cost: baseCost, banned: false };
    }
    if (tool === 'place_path') {
      return { label: 'Walking Path', cost: 0, banned: false };
    }
    // Luxury pair — one-time placement cost.
    if (tool === 'residential_luxury_low') {
      const mult = this.council.costMultiplier('r_lux');
      const banned = !isFinite(mult);
      const cost = banned ? LUXURY_LOW_COST : Math.round(LUXURY_LOW_COST * mult);
      return { label: 'Luxury Lot', cost, banned };
    }
    // Stop sign + traffic light — flat costs.
    if (tool === 'place_stop_sign') {
      const mult = this.council.costMultiplier('stop_sign');
      const banned = !isFinite(mult);
      const cost = banned ? STOP_SIGN_COST : Math.round(STOP_SIGN_COST * mult);
      return { label: 'Stop Sign', cost, banned };
    }
    if (tool === 'place_traffic_light') {
      return { label: 'Traffic Light', cost: TRAFFIC_LIGHT_COST, banned: false };
    }
    // Skyscrapers — fixed cost per zone variant.
    if (tool === 'residential_skyscraper') return { label: 'R Skyscraper', cost: SKYSCRAPER_COST.residential, banned: false };
    if (tool === 'commercial_skyscraper') return { label: 'C Skyscraper', cost: SKYSCRAPER_COST.commercial, banned: false };
    if (tool === 'mixed_skyscraper')       return { label: 'MU Skyscraper', cost: SKYSCRAPER_COST.mixed,       banned: false };
    // Mayor's Mansion — single-instance prestige build.
    if (tool === 'place_mayor_mansion') {
      const mult = this.council.costMultiplier('mayor_mansion');
      const banned = !isFinite(mult);
      const cost = banned ? BUILDING_COSTS.mayor_mansion : Math.round(BUILDING_COSTS.mayor_mansion * mult);
      return { label: 'Mayor\'s Mansion', cost, banned };
    }
    // Land purchase.
    if (tool === 'buy_land') {
      return { label: 'Buy Land', cost: LAND_PURCHASE_COST_PER_TILE, banned: false };
    }
    // Terraforming paint tools (Alpha 4.0). Per-tile costs.
    if (tool === 'terra_tree')    return { label: 'Plant Tree', cost: TERRAFORM_COSTS.terra_tree, banned: false };
    if (tool === 'terra_meadow')  return { label: 'Meadow', cost: TERRAFORM_COSTS.terra_meadow, banned: false };
    if (tool === 'terra_pond')    return { label: 'Pond', cost: TERRAFORM_COSTS.terra_pond, banned: false };
    if (tool === 'terra_smooth')  return { label: 'Smooth Land', cost: TERRAFORM_COSTS.terra_smooth, banned: false };
    // Zone paints + bulldoze + districts + pan are free.
    return null;
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
      // Pause: simSpeed=0 freezes everything. Fast-forward: simSpeed>1
      // multiplies the accumulator so more sim steps fit per real frame
      // AND multiplies the render-rate `dt` later so vehicles/walkers move
      // proportionally faster on screen too.
      const simDt = dtMs * this.simSpeed;
      this.simAccumulatorMs += simDt;
      let steps = 0;
      let buildingsDirty = false;
      while (this.simAccumulatorMs >= SIM_STEP_MS && steps < MAX_SIM_STEPS_PER_FRAME) {
        this.simAccumulatorMs -= SIM_STEP_MS;
        steps++;
        // Order: Traffic EMA → Population (reads stress) → Development →
        // Economy → Vehicles spawn. Each consumer reads from up-to-date
        // upstream state.
        this.traffic.tickEma(this.grid);
        // Happiness is computed first each tick so Population can read it
        // when distributing residents across factions. Civic-action
        // modifiers (endorsement, coalition) layer on after the raw compute.
        this.happiness.computeAll(
          this.grid,
          this.economy,
          this.population,
          this.traffic,
          this.civicModifiers(),
          this.events
        );
        this.population.tick(this.grid, this.economy, this.traffic, this.happiness, this.council, this.events);
        // Cheat: pin demand at +1 every tick (Alpha 3.2.4). Population
        // recomputes demand each tick from current city state, so the
        // override has to fire after the recompute every step.
        if (this.cheatUnlimitedDemand) {
          this.population.demandR = 1;
          this.population.demandC = 1;
          this.population.demandI = 1;
        }
        // Milestones (Alpha 2.8) — earn population thresholds, hand out
        // tool unlocks + cash + PC, queue celebration banners. Called
        // after population.tick so we see the freshest count.
        if (this.milestones.tick(this.population.totalResidents)) {
          // Apply rewards immediately — banners drain pending after.
          while (this.milestones.hasPending()) {
            const m = this.milestones.shiftPending();
            if (!m) break;
            this.economy.treasury += m.rewardCash;
            this.council.politicalCapital = Math.min(
              this.council.politicalCapital + m.rewardPC,
              50  // PC_CAP — keep in sync with Council.ts
            );
            this.onMilestoneEarned?.(m);
          }
          this.refreshToolbarLocks();
        }
        if (this.development.tick(this.grid, this.economy.monthsElapsed)) buildingsDirty = true;
        const monthsBefore = this.economy.monthsElapsed;
        this.economy.tick(SIM_STEP_MS, this.grid, this.population, this.globalMarket, this.events, this.bonds, this.crime, this.districts, this.council);
        // Beautification budget defunded this month (Alpha 4.0) — surface
        // a status toast so the player understands why the streetscape
        // suddenly stripped down. The flag is set by Economy and
        // consumed (cleared) here so the message fires exactly once.
        if (this.council.beautificationJustDefunded) {
          this.council.beautificationJustDefunded = false;
          this.onStatusMessage?.('Beautification budget defunded — treasury short');
        }
        // Cheat: top up to a billion after the monthly settlement so
        // expensive things (skyscrapers, $1M expansions, bonds) are
        // always affordable while playtesting.
        if (this.cheatUnlimitedMoney && this.economy.treasury < 1_000_000_000) {
          this.economy.treasury = 1_000_000_000;
        }
        // Election cycle — every 3 months. Runs after Economy bumps the
        // month counter so the election sees the latest happiness.
        if (this.economy.monthsElapsed > monthsBefore) {
          // Monthly patina refresh (Alpha 2.16): even with no new development
          // we want existing buildings to dim as they age. Cheap rebuild —
          // sub-millisecond on Small/Medium and only fires on month rollover.
          buildingsDirty = true;
          // Treasury may have crossed the "can afford the active tool"
          // threshold — refresh the cost pill so the colour stays in
          // sync (Alpha 4.5).
          this.refreshToolCostPill();
          // PC accrues every month (before the election so the player
          // walks into election day with the latest balance).
          this.council.awardMonthlyPC(this.happiness);
          // Bond default penalty (Alpha 2.18). When the treasury can't
          // cover monthly debt service, taxpayers + chamber take a
          // multi-month happiness hit and the player loses 5 PC. Surface
          // a status toast so the player sees what just happened.
          if (this.bonds.defaultedThisMonth) {
            this.bonds.defaultedThisMonth = false;
            this.council.politicalCapital = Math.max(0, this.council.politicalCapital - 5);
            const cur = this.council.campaignHappinessDelta;
            cur.set('taxpayers', (cur.get('taxpayers') ?? 0) - 0.30);
            cur.set('chamber', (cur.get('chamber') ?? 0) - 0.20);
            this.onStatusMessage?.('Bond defaulted — taxpayers + Chamber are furious');
          }
          const fired = this.council.maybeRunElection(
            this.economy.monthsElapsed,
            this.happiness,
            this.population
          );
          if (fired) {
            this.councilPanel.show();
            this.refreshToolbarBans();
            // Cost mults flipped — refresh the active-tool cost pill
            // so the new council's pricing is reflected immediately.
            this.refreshToolCostPill();
            this.achievements.recordElection();
            // Surface bio popups for any new council member or opponent
            // the player has never met. Each emit is queued in main.ts.
            // The opponent is the runner-up — players see them every
            // election cycle, so they're worth introducing too.
            for (const id of fired.councillors) {
              if (this.achievements.shouldShowLeaderBio(id)) {
                this.achievements.markLeaderMet(id);
                this.onNewLeader?.(id);
              }
            }
            const opp = fired.opponentId;
            if (opp && this.achievements.shouldShowLeaderBio(opp)) {
              this.achievements.markLeaderMet(opp);
              this.onNewLeader?.(opp);
            }
          }
          // Random events + crises (Alpha 2.9). Run on every month
          // boundary; fires + recessions + lawsuits + referendums all
          // tick here. The Events system decays its modifiers and may
          // queue 0..N events. Drain them; modal events block.
          this.events.tickMonth(
            this.grid, this.economy, this.population, this.council, this.happiness
          );
          // Skyscraper construction (Alpha 3.1.2): advance any active build
          // by one month; if any stage tipped over, mark buildings dirty so
          // the renderer rebuilds the geometry with the new construction
          // stage visible.
          if (this.skyscrapers.tickMonth(this.grid)) buildingsDirty = true;
          // Refresh per-tile crime scores once per month (Alpha 2.21).
          // Cheap single grid sweep; drives the heatmap and the
          // commercial-revenue penalty applied next month.
          this.crime.recompute(this.grid, this.happiness);
          // Faction wiring (Alpha 2.21): high city crime makes
          // safer_streets furious and working_families uncomfortable.
          // Happiness layers via campaignHappinessDelta which is read
          // by Happiness.computeAll on the next refresh.
          if (this.crime.cityCrime > 0.20) {
            const delta = this.council.campaignHappinessDelta;
            const intensity = Math.min(1, (this.crime.cityCrime - 0.20) / 0.30);
            delta.set('safer_streets', (delta.get('safer_streets') ?? 0) - 0.30 * intensity);
            delta.set('working_families', (delta.get('working_families') ?? 0) - 0.15 * intensity);
          }
          // Capture history sample (Alpha 2.11) for the Stats panel.
          this.stats.capture(
            this.economy.monthsElapsed, this.economy, this.population, this.happiness
          );
          // Achievements pass (Alpha 2.15) — runs once per month, drains
          // any newly-unlocked entries to the toast queue via onAchievementUnlocked.
          this.achievements.evaluateMonth({
            monthsElapsed: this.economy.monthsElapsed,
            economy: this.economy,
            population: this.population,
            happiness: this.happiness,
            council: this.council,
            grid: this.grid,
            milestones: this.milestones,
            bonds: { lifetimeIssued: this.bonds.lifetimeIssued, activeCount: this.bonds.active.length },
            cityCrime: this.crime.cityCrime
          });
          while (this.achievements.hasPending()) {
            const a = this.achievements.shiftPending();
            if (!a) break;
            this.onAchievementUnlocked?.(a);
          }
          while (this.events.hasPending()) {
            const e = this.events.shiftPending();
            if (!e) break;
            this.onEvent?.(e);
          }
        }
        this.vehicles.spawnTick(
          SIM_STEP_MS,
          this.grid,
          this.roadGraph,
          this.pathfinder,
          this.population.totalResidents,
          this.pathGraph,
          this.walkPathfinder
        );
        this.vehicles.scheduleReturnTrips(this.grid, this.roadGraph, this.pathfinder);
        this.buses.spawnTick(SIM_STEP_MS, this.grid, this.roadGraph, this.pathfinder);
        this.pedestrians.spawnTick(
          SIM_STEP_MS,
          this.grid,
          this.pathGraph,
          this.walkPathfinder,
          this.population.totalResidents
        );
      }
      // If we hit the cap, drop accumulated time so we don't immediately
      // catch up on the next frame either.
      if (steps >= MAX_SIM_STEPS_PER_FRAME && this.simAccumulatorMs > SIM_STEP_MS) {
        this.simAccumulatorMs = 0;
      }
      if (buildingsDirty) {
        // drawBuildings auto-refreshes the beautification overlay via
        // the provider installed in init() — no separate call needed.
        this.renderer.drawBuildings(this.grid, this.cityMood(), this.economy.monthsElapsed);
      } else if (this.renderer.getBeautificationTier() !== this.council.effectiveBeautificationTier) {
        // Tier flipped without the building set changing — e.g. a
        // council just elected a new tier or the budget defunded mid-
        // month. Rebuild the overlay alone (cheap, no buildings rebuild).
        this.refreshBeautification();
      }

      // Render-rate dt: scale by simSpeed so vehicles/walkers visually move
      // faster at 2× / 3× and freeze at 0.
      const dt = (dtMs * this.simSpeed) / 1000;
      // Cars move smoothly at render rate, decoupled from the sim tick.
      // Tick traffic-light phases at render rate so visual + sim match.
      // Scaled by simSpeed so 2× / 3× advance the lights too.
      this.trafficLights.tick(dt, this.grid, this.vehicles);
      this.vehicles.update(dt, this.grid, this.grid.width, this.trafficLights);
      // Drain any crashes that fired this frame: deduct treasury, hit the
      // destination tile's developmentPressure (so business growth slows
      // when crashes prevent shoppers/workers from arriving).
      if (this.vehicles.crashesThisFrame.length > 0) {
        for (const crash of this.vehicles.crashesThisFrame) {
          this.economy.recordCrash(CRASH_TREASURY_PENALTY);
          const destTile = this.grid.get(crash.destX, crash.destY);
          if (destTile) {
            destTile.developmentPressure = Math.max(
              0,
              destTile.developmentPressure - CRASH_DEMAND_PENALTY
            );
          }
        }
      }
      this.renderer.updateCars(this.vehicles, this.grid);
      this.buses.update(dt, this.grid, this.grid.width, this.roadGraph, this.pathfinder);
      this.renderer.updateBuses(this.buses, this.grid);
      this.ferries.update(dt, this.grid);
      this.renderer.updateFerries(this.ferries, this.grid);
      this.pedestrians.update(dt, this.grid.width);
      this.renderer.updatePedestrians(this.pedestrians, this.grid);
      // Heatmap rebuild is the most expensive optional layer (full road
      // mesh rebuild). Throttle to 5 Hz when visible — the EMA only moves
      // that fast anyway. Memory: feedback_traffic_pressure (heatmap must
      // be informative, not flickery).
      if (this.heatmapVisible) {
        this.heatmapAccumMs += dtMs;
        if (this.heatmapAccumMs >= 200) {
          this.heatmapAccumMs = 0;
          this.renderer.drawHeatmap(this.grid, 'traffic');
        }
      } else if (this.crimeHeatmapVisible) {
        // Crime updates monthly so the heatmap rebuild can run far less
        // often than traffic — once a second is overkill but cheap.
        this.heatmapAccumMs += dtMs;
        if (this.heatmapAccumMs >= 1000) {
          this.heatmapAccumMs = 0;
          this.renderer.drawHeatmap(this.grid, 'crime', this.crime);
        }
      }

      // Auto-save throttled to AUTOSAVE_MS. Fire-and-forget — don't block
      // the render loop on disk. Skip if a reset is in flight; otherwise
      // a save can fire between saveGame.clear() and location.reload(),
      // restoring the city we just wiped.
      this.autosaveAccumMs += dtMs;
      if (this.autosaveAccumMs >= AUTOSAVE_MS && !this.resetting) {
        this.autosaveAccumMs = 0;
        void this.saveGame.save(
          this.grid, this.economy, this.council, this.milestones, this.events,
          this.stats, this.achievements, this.bonds, this.cityName, this.districts,
          { unlimitedMoney: this.cheatUnlimitedMoney, unlimitedDemand: this.cheatUnlimitedDemand }
        ).catch(() => {});
      }

      for (const cb of this.tickCallbacks) cb(dt);
      // Day/night advance (Alpha 2.14). Sim-speed multiplies so fast-
      // forwarding the city also speeds up the sun. Paused = sun freeze.
      // Reduce-motion (Alpha 4.8) slows the cycle 10× so the sky doesn't
      // pulse for players who prefer less ambient motion.
      if (this.simSpeed > 0) {
        const motionMult = this.reduceMotion ? 0.1 : 1;
        const dayDelta = (dt / Game.DAY_SECONDS) * this.simSpeed * motionMult;
        this.timeOfDay = (this.timeOfDay + dayDelta) % 1;
      }
      this.renderer.applyTimeOfDay(this.timeOfDay);
      // Push the camera's current ortho size into the renderer so
      // skyscraper opacity tracks zoom (Alpha 3.1.7).
      this.renderer.applyCameraZoom(this.camera.orthoSize);
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
    // Expand-button hit-test (Alpha 3.2.1): the four "+" buttons sit
    // just outside the city bounds and grow the map by one block per
    // tap for $1M. Resolved before tile selection so a tap on a button
    // doesn't drop a misleading selection on the underlying tile.
    const world = this.camera.screenToWorld(sx, sy);
    if (world) {
      const wx = world.x / TILE_SIZE;
      const wz = world.z / TILE_SIZE;
      for (const dir of ['N', 'S', 'E', 'W'] as const) {
        const pos = this.renderer.expandButtonPositions[dir];
        if (!pos) continue;
        const dx = wx - pos.x;
        const dz = wz - pos.z;
        if (dx * dx + dz * dz <= pos.r * pos.r) {
          this.expandCity(dir);
          return;
        }
      }
    }
    const tile = this.screenToTile(sx, sy);
    if (!tile) {
      this.clearSelection();
      return;
    }
    this.selected = tile;
    this.renderer.drawSelection(tile.x, tile.y);
    this.panel.hide();
    this.refreshServiceRadiusPreview();
  }

  /** Pay $1M and grow the WORLD itself in the given direction (Alpha 3.2.3).
   *  The grid actually resizes — adds CITY_EXPANSION_BLOCK_SIZE tiles
   *  past the existing edge, generates fresh terrain there, marks the
   *  newly-included tiles as owned, and shifts the camera target so the
   *  visual position doesn't jump. Old worlds keep their save schema —
   *  just persist a wider/taller grid next save. */
  expandCity(direction: 'N' | 'S' | 'E' | 'W'): boolean {
    if (this.economy.treasury < CITY_EXPANSION_COST) {
      this.onStatusMessage?.(`City expansion costs $${CITY_EXPANSION_COST.toLocaleString()}`);
      return false;
    }
    const { offsetX, offsetY } = this.grid.expandWorld(direction, CITY_EXPANSION_BLOCK_SIZE);
    this.economy.treasury -= CITY_EXPANSION_COST;
    // Shift the camera target to compensate for the offset so what the
    // player was looking at doesn't visually jump.
    if (offsetX !== 0 || offsetY !== 0) {
      this.camera.target.x += offsetX * TILE_SIZE;
      this.camera.target.z += offsetY * TILE_SIZE;
      this.camera.update();
    }
    // Full re-render dance — tiles shifted, edges re-packed, new terrain
    // exists. Treat this like a save restore: rebuild every tile-indexed
    // system + every renderer mesh, clear in-flight vehicles/walkers
    // because their cached path indices no longer point at the right tiles.
    // afterStateRestore handles terrain + everything else.
    this.afterStateRestore();
    this.onStatusMessage?.(`City expanded · +${CITY_EXPANSION_BLOCK_SIZE} tile${direction} edge`);
    return true;
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
    // Pick the city-wide demand for this tile's zone (Alpha 2.13).
    const zoneDemand =
      t.zone === 'residential' ? this.population.demandR
      : t.zone === 'commercial' ? this.population.demandC
      : t.zone === 'industrial' ? this.population.demandI
      : t.zone === 'mixed' ? (this.population.demandR + this.population.demandC) / 2
      : 0;
    const baseInfo = {
      x: tile.x,
      y: tile.y,
      terrain: t.terrain,
      road: t.road,
      roadType: t.roadType,
      highwayDir: t.highwayDir,
      stopSign: t.stopSign,
      trafficLight: t.trafficLight,
      zone: t.zone,
      zoneCap: t.zoneCap,
      density: t.density,
      ageMonths: t.developedAt > 0 ? Math.max(0, this.economy.monthsElapsed - t.developedAt) : 0,
      crimeScore: this.crime.scoreAt(this.grid, t.x, t.y),
      building: t.building,
      path: t.path,
      hasPower: t.hasPower,
      hasWater: t.hasWater,
      hasPark: t.hasPark,
      hasSchool: t.hasSchool,
      hasHospital: t.hasHospital,
      hasFireProtection: t.hasFireProtection,
      hasPolice: t.hasPolice,
      luxury: t.luxury,
      bridge: t.bridge,
      bridgeRoad: t.bridgeRoad,
      hasRoadAdjacent: this.grid.hasRoadAdjacent(tile.x, tile.y),
      zoneDemand
    };
    this.panel.show({ ...baseInfo, reasons: diagnoseTile(baseInfo) });
  }

  // --- Undo --------------------------------------------------------------

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Capture the current grid + economy state and push it onto the undo stack. */
  private snapshotForUndo(): void {
    this.undoStack.push(serialize(this.grid, this.economy, this.council, this.milestones, this.events, this.stats, this.achievements, this.bonds, this.districts));
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
    applySave(snap, this.grid, this.economy, this.council, this.milestones, this.events, this.stats, this.achievements, this.bonds, this.districts);
    this.afterStateRestore();
  }

  private afterStateRestore(): void {
    this.services.recompute(this.grid);
    this.roadGraph.rebuild(this.grid);
    this.pathGraph.rebuild(this.grid);
    this.trafficLights.rebuild(this.grid);
    this.globalMarket.recompute(this.grid);
    this.ferries.reset();
    this.skyscrapers.reset();
    // Re-derive milestone unlocks from the restored highestPop (Alpha 2.8).
    this.refreshToolbarLocks();
    // Grid dims may have changed (Alpha 3.2.3 expanded saves). Update the
    // camera's max-zoom-out cap to match the new world. Don't reset the
    // target — we want to preserve whatever the player was looking at.
    const w = this.grid.width * TILE_SIZE;
    const h = this.grid.height * TILE_SIZE;
    this.camera.maxOrthoSize = Math.max(w, h);
    // Terrain mesh is dim-dependent — rebuild after every restore.
    this.renderer.drawWorld(this.grid);
    this.renderer.drawZones(this.grid);
    this.renderer.drawPaths(this.grid);
    this.renderer.drawRoads(this.grid);
    this.renderer.drawBuildings(this.grid, this.cityMood(), this.economy.monthsElapsed);
    this.renderer.drawCityBuildings(this.grid, this.forestryHealth(), this.farmHealth());
    this.renderer.drawDistricts(this.grid, this.districts);
    this.renderer.drawNightLights(this.grid);
    this.vehicles.clear(this.grid, this.grid.width);
    this.buses.clear();
    this.pedestrians.clear();
  }

  /**
   * Wipe the current city back to a fresh map. Clears the IndexedDB save
   * too so a reload doesn't restore the old state. Two-layer safety against
   * the autosave-vs-reload race: gate the autosave via {@link resetting},
   * AND drop a sessionStorage flag that the next init() honours by
   * re-clearing the slot before any load attempt.
   */
  async resetCity(): Promise<void> {
    this.resetting = true;
    try {
      sessionStorage.setItem(RESET_FLAG, '1');
    } catch {
      /* sessionStorage unavailable (rare) — the in-memory flag still gates the save */
    }
    try {
      await this.saveGame.clear();
    } catch {
      /* ignore */
    }
    // Easiest reliable reset on the prototype: full page reload. Avoids a
    // long list of "also reset that, also that" bugs as systems grow.
    location.reload();
  }

  /** Tutorial uses these flags to detect the player opening the panel
   *  at least once (Alpha 4.10). Setting once and never clearing is the
   *  whole semantic — replaying the tutorial doesn't re-arm them, since
   *  the player already knows where these panels live. */
  happinessPanelOpenedOnce = false;
  budgetPanelOpenedOnce = false;

  /** Toggle the budget panel; closes any other bottom panel. */
  toggleBudget(): void {
    if (this.budgetPanel.isOpen()) {
      this.budgetPanel.hide();
    } else {
      this.panel.hide();
      this.happinessPanel.hide();
      this.budgetPanel.show();
      this.budgetPanelOpenedOnce = true;
    }
  }

  /** Toggle the community-sentiment panel; closes any other bottom panel. */
  toggleHappiness(): void {
    if (this.happinessPanel.isOpen()) {
      this.happinessPanel.hide();
    } else {
      this.panel.hide();
      this.budgetPanel.hide();
      this.happinessPanel.show();
      this.happinessPanelOpenedOnce = true;
    }
  }

  private clearSelection(): void {
    this.selected = null;
    this.renderer.clearSelection();
    this.panel.hide();
  }

  /**
   * Shape `Happiness.computeAll` consumes for civic-action modifiers.
   * Resolves coalition rivals from the FACTION_RIVALS table.
   */
  private civicModifiers() {
    const allies: FactionId[] = this.council.coalition
      ? [this.council.coalition.a, this.council.coalition.b]
      : [];
    const rivals = new Set<FactionId>();
    for (const ally of allies) {
      for (const r of FACTION_RIVALS[ally]) rivals.add(r);
    }
    return {
      endorsedFaction: this.council.endorsedFaction,
      coalitionAllies: allies,
      coalitionRivals: [...rivals],
      campaignDeltas: this.council.campaignHappinessDelta
    };
  }

  // --- Paint-mode handlers ------------------------------------------------

  private handlePaintStart(sx: number, sy: number): void {
    const tile = this.screenToTile(sx, sy);
    this.strokeOrigin = tile;
    this.strokeEdges.clear();
    this.strokeStubs.clear();
    this.strokeZones.clear();
    this.strokePaths.clear();
    this.strokeBulldozed.clear();
    this.strokeForestCleared.clear();
    this.strokeBridgeEdges.clear();
    this.strokeDidSnapshot = false;
    this.councilBlockNotifiedThisStroke = false;
    // Defensive (Alpha 2.12.1) — re-derive toolbar lock state at every
    // stroke so a missed refresh can't strand a player on a "locked"
    // milestone they actually earned.
    this.refreshToolbarLocks();
    if (!tile) return;

    // Snapshot before any state mutation so we can undo this whole stroke
    // in a single Undo press. handlePaintEnd will pop it back if the stroke
    // turned out to be a no-op (e.g. paint over already-painted tiles).
    this.snapshotForUndo();
    this.strokeDidSnapshot = true;

    // Stop sign — tap-only on a road tile that's an intersection.
    if (this.tool === 'place_stop_sign') {
      const placed = this.placeStopSign(tile.x, tile.y);
      if (!placed) {
        this.undoStack.pop();
        this.strokeDidSnapshot = false;
      }
      this.strokeOrigin = null;
      return;
    }

    // Traffic light — tap-only on a road tile that's an intersection. Same
    // shape as stop-sign placement; uses TRAFFIC_LIGHT_COST and rebuilds
    // the TrafficLights controller so the new light starts cycling.
    if (this.tool === 'place_traffic_light') {
      const placed = this.placeTrafficLight(tile.x, tile.y);
      if (!placed) {
        this.undoStack.pop();
        this.strokeDidSnapshot = false;
      }
      this.strokeOrigin = null;
      return;
    }

    // Bus stop — if the target tile is a non-highway road, attach the stop
    // to the road's sidewalk (Alpha 2.0). Otherwise fall through to the
    // standalone-building path below for backwards-compat with old saves.
    if (this.tool === 'place_bus_stop') {
      const t = this.grid.get(tile.x, tile.y);
      if (t && t.road && t.roadType !== 'highway') {
        const placed = this.placeRoadBusStop(tile.x, tile.y);
        if (!placed) {
          this.undoStack.pop();
          this.strokeDidSnapshot = false;
        }
        this.strokeOrigin = null;
        return;
      }
    }

    // Luxury low-density residential — tap-only, takes a 2-tile pair.
    // Validates origin tile + finds an adjacent free zoneable tile, then
    // marks both tiles luxury+R+lowCap. Refuses (with toast) if there's
    // no valid partner adjacent.
    if (this.tool === 'residential_luxury_low') {
      const placed = this.placeLuxuryPair(tile.x, tile.y);
      if (!placed) {
        this.undoStack.pop();
        this.strokeDidSnapshot = false;
      }
      this.strokeOrigin = null;
      return;
    }

    // Skyscrapers — tap-only, take a 2×2 footprint anchored at the tap.
    // Validates the 2×2 area is free + treasury is sufficient + zone is
    // R / C / MU. Stamps all 4 tiles with skyscraper bits at stage 0.
    if (this.tool === 'buy_land') {
      const placed = this.buyLand(tile.x, tile.y);
      if (!placed) {
        this.undoStack.pop();
        this.strokeDidSnapshot = false;
      }
      this.strokeOrigin = null;
      return;
    }

    if (
      this.tool === 'residential_skyscraper' ||
      this.tool === 'commercial_skyscraper' ||
      this.tool === 'mixed_skyscraper'
    ) {
      const zone =
        this.tool === 'residential_skyscraper' ? 'residential' :
        this.tool === 'commercial_skyscraper' ? 'commercial' : 'mixed';
      const placed = this.placeSkyscraper(tile.x, tile.y, zone);
      if (!placed) {
        this.undoStack.pop();
        this.strokeDidSnapshot = false;
      }
      this.strokeOrigin = null;
      return;
    }

    // Mayor's Mansion (Alpha 4.2) — tap-only, single-instance, takes
    // a 4×2 footprint anchored at the tap (tap is the lex-smallest
    // tile of the 8). Validates the entire footprint is free + on
    // owned grass land + treasury can afford + no mansion already
    // exists. Stamps mayorMansion=true on all 8 tiles, building=
    // 'mayor_mansion' on the anchor.
    if (this.tool === 'place_mayor_mansion') {
      const placed = this.placeMayorMansion(tile.x, tile.y);
      if (!placed) {
        this.undoStack.pop();
        this.strokeDidSnapshot = false;
      }
      this.strokeOrigin = null;
      return;
    }

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
    // Capture the bulldozed-tile count BEFORE we clear the stroke set so
    // the post-stroke toast can mention "Bulldozed 47 tiles".
    const bulldozedCount = this.strokeBulldozed.size;
    if (this.strokeDidSnapshot) {
      const noop =
        this.strokeEdges.size === 0 &&
        this.strokeStubs.size === 0 &&
        this.strokeZones.size === 0 &&
        this.strokePaths.size === 0 &&
        this.strokeBulldozed.size === 0;
      if (noop) this.undoStack.pop();
      this.strokeDidSnapshot = false;
    }
    if (bulldozedCount > 5 && this.onBigBulldoze) this.onBigBulldoze(bulldozedCount);
    this.strokeOrigin = null;
    this.strokeEdges.clear();
    this.strokeStubs.clear();
    this.strokeZones.clear();
    this.strokePaths.clear();
    this.strokeBulldozed.clear();
    this.strokeForestCleared.clear();
    this.terraformBlockNotifiedThisStroke = false;
    this.councilBlockNotifiedThisStroke = false;
  }

  /**
   * Single-tap building placement. Validates: tile is free (no road, zone,
   * or other building) and treasury can afford the cost. Returns true iff
   * a building was actually placed — caller (handlePaintStart) uses this
   * to decide whether the snapshot it pushed should be popped. Refunds
   * nothing on bulldoze — keep the prototype simple.
   */
  private placeBuilding(x: number, y: number, kind: Exclude<Building, 'none'>): boolean {
    const baseCost = BUILDING_COSTS[kind];
    const stanceKey = kind as StanceKey;
    const mult = this.council.costMultiplier(stanceKey);
    if (!isFinite(mult)) {
      this.onStatusMessage?.('Banned by council');
      return false;
    }
    const cost = Math.round(baseCost * mult);
    if (this.economy.treasury < cost) {
      this.onStatusMessage?.(`Not enough money — need $${cost.toLocaleString()}`);
      return false;
    }
    // Forestry-specific terrain gate (Alpha 2.7) — surface a clear toast
    // if the player taps a non-forest tile, instead of silent failure.
    if (kind === 'forestry') {
      const t = this.grid.get(x, y);
      if (t && t.terrain !== 'forest') {
        this.onStatusMessage?.('Forestry can only be placed on forest tiles');
        return false;
      }
    }
    // Farm-specific terrain gate (Alpha 2.7.1).
    if (kind === 'farm') {
      const t = this.grid.get(x, y);
      if (t && t.terrain !== 'grass') {
        this.onStatusMessage?.('Farms can only be placed on grass tiles');
        return false;
      }
    }
    // Ferry dock (Alpha 2.19): tile must NOT be water itself, AND must
    // have at least one 4-connected water neighbour. Sand tiles (the
    // procedural shoreline) work fine; water tiles don't because we'd
    // be paving over the route the boat is supposed to use.
    if (kind === 'ferry_dock') {
      const tile = this.grid.get(x, y);
      if (tile && tile.terrain === 'water') {
        this.onStatusMessage?.('Ferry dock cannot be placed on water itself');
        return false;
      }
      if (!this.grid.has4WaterNeighbour(x, y)) {
        this.onStatusMessage?.('Ferry dock needs an adjacent water tile');
        return false;
      }
    }
    // Pier (Alpha 4.0) — must be on water with at least one 4-connected
    // non-water neighbour. Reads as a wooden deck extending into the
    // lake from the shore. Pure decorative, no transit hookup.
    if (kind === 'pier') {
      const tile = this.grid.get(x, y);
      if (!tile || tile.terrain !== 'water') {
        this.onStatusMessage?.('Pier must be placed on a water tile');
        return false;
      }
      if (!this.grid.has4LandNeighbour(x, y)) {
        this.onStatusMessage?.('Pier must touch the shore');
        return false;
      }
    }
    // Reflecting pool / fountain (Alpha 4.0) — large water-feature
    // monuments that sit on land but evoke water. No special gates;
    // we just want to surface a friendlier reject when the player
    // taps on a body of water trying to place one.
    if ((kind === 'reflecting_pool' || kind === 'fountain') && this.grid.get(x, y)?.terrain === 'water') {
      this.onStatusMessage?.(`${kind === 'fountain' ? 'Fountain' : 'Reflecting pool'} must be placed on land`);
      return false;
    }
    if (!this.grid.setBuilding(x, y, kind)) return false;
    this.economy.treasury -= cost;
    this.services.recompute(this.grid);
    this.renderer.drawCityBuildings(this.grid, this.forestryHealth(), this.farmHealth());
    // Parks are walkable (Alpha 2.6.1) — rebuild the pedestrian graph
    // so walkers can route through the new park tile immediately.
    if (kind === 'park') this.pathGraph.rebuild(this.grid);
    this.maybeOfferPhotoOp(stanceKey);
    return true;
  }

  /**
   * Place a stop sign on a road tile. Validates: tile is an intersection
   * (3+ incident edges), no stop sign already, treasury can afford the cost.
   */
  private placeStopSign(x: number, y: number): boolean {
    const t = this.grid.get(x, y);
    if (!t || !t.road || t.stopSign) return false;
    if (this.grid.incidentRoadEdgeCount(x, y) < 3) return false;
    const mult = this.council.costMultiplier('stop_sign');
    if (!isFinite(mult)) {
      this.onStatusMessage?.('Banned by council');
      return false;
    }
    const cost = Math.round(STOP_SIGN_COST * mult);
    if (this.economy.treasury < cost) {
      this.onStatusMessage?.(`Not enough money — need $${cost.toLocaleString()}`);
      return false;
    }
    if (!this.grid.setStopSign(x, y, true)) return false;
    this.economy.treasury -= cost;
    this.renderer.drawRoads(this.grid);
    this.trafficLights.rebuild(this.grid);
    this.maybeOfferPhotoOp('stop_sign');
    return true;
  }

  /**
   * Attach a bus stop to a non-highway road tile (Alpha 2.0). Cost mirrors
   * the standalone-building form. Council stance gating uses the existing
   * `bus_stop` row in FACTION_STANCES — same key so factions react the
   * same way.
   */
  private placeRoadBusStop(x: number, y: number): boolean {
    const t = this.grid.get(x, y);
    if (!t || !t.road || t.roadType === 'highway' || t.busStop) return false;
    const baseCost = BUILDING_COSTS.bus_stop;
    const mult = this.council.costMultiplier('bus_stop');
    if (!isFinite(mult)) {
      this.onStatusMessage?.('Banned by council');
      return false;
    }
    const cost = Math.round(baseCost * mult);
    if (this.economy.treasury < cost) {
      this.onStatusMessage?.(`Not enough money — need $${cost.toLocaleString()}`);
      return false;
    }
    if (!this.grid.setBusStop(x, y, true)) return false;
    this.economy.treasury -= cost;
    this.renderer.drawRoads(this.grid);
    this.maybeOfferPhotoOp('bus_stop');
    return true;
  }

  /**
   * Place a traffic light on a road-tile intersection. Mutex with stop
   * sign — `setTrafficLight` clears any existing stop on the same tile.
   * Cost is flat in this prototype; council stance gating for lights is a
   * future pass (no `traffic_light` row in FACTION_STANCES yet).
   */
  private placeTrafficLight(x: number, y: number): boolean {
    const t = this.grid.get(x, y);
    if (!t || !t.road || t.trafficLight) return false;
    if (this.grid.incidentRoadEdgeCount(x, y) < 3) return false;
    if (this.economy.treasury < TRAFFIC_LIGHT_COST) {
      this.onStatusMessage?.(`Not enough money — need $${TRAFFIC_LIGHT_COST.toLocaleString()}`);
      return false;
    }
    if (!this.grid.setTrafficLight(x, y, true)) return false;
    this.economy.treasury -= TRAFFIC_LIGHT_COST;
    this.renderer.drawRoads(this.grid);
    this.trafficLights.rebuild(this.grid);
    return true;
  }

  /**
   * Luxury low-density paint (Alpha 2.5). Tap-only — places a 2-tile pair.
   * The tapped tile becomes the primary; we look for any 4-neighbour tile
   * that's also free + zoneable + adjacent-to-road, in N/E/S/W order, and
   * mark BOTH as zone='residential', luxury=true, zoneCap=1. Refuses with
   * a status toast if there's no valid partner adjacent or treasury is
   * short. Council cost-multiplier and ban gating reuse the new `r_lux`
   * stance row.
   */
  private placeLuxuryPair(x: number, y: number): boolean {
    const primary = this.grid.get(x, y);
    if (!primary) return false;
    if (!this.canZoneLuxury(x, y)) {
      this.onStatusMessage?.('Luxury home needs a free road-adjacent tile');
      return false;
    }
    // Find a partner — first 4-neighbour that's also valid for luxury.
    const dirs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    let partner: { x: number; y: number } | null = null;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.canZoneLuxury(nx, ny)) {
        partner = { x: nx, y: ny };
        break;
      }
    }
    if (!partner) {
      this.onStatusMessage?.('Luxury home needs an adjacent free tile');
      return false;
    }
    const mult = this.council.costMultiplier('r_lux');
    if (!isFinite(mult)) {
      this.onStatusMessage?.('Banned by council');
      return false;
    }
    const cost = Math.round(LUXURY_LOW_COST * mult);
    if (this.economy.treasury < cost) {
      this.onStatusMessage?.(`Not enough money — need $${cost.toLocaleString()}`);
      return false;
    }
    // Mutate both tiles. setZone gates already checked via canZoneLuxury,
    // so these calls should not refuse — set them, flag luxury, deduct.
    if (!this.grid.setZone(x, y, 'residential', 1)) return false;
    if (!this.grid.setZone(partner.x, partner.y, 'residential', 1)) {
      // Roll back the primary if partner zoning unexpectedly fails.
      this.grid.setZone(x, y, 'none');
      return false;
    }
    primary.luxury = true;
    const partnerTile = this.grid.get(partner.x, partner.y)!;
    partnerTile.luxury = true;
    this.economy.treasury -= cost;
    this.maybeOfferPhotoOp('r_lux');
    return true;
  }

  /**
   * Buy land (Alpha 3.1.3). Tap-to-buy a single tile of unowned land.
   * Costs LAND_PURCHASE_COST_PER_TILE per tile. Owned tiles are no-ops.
   * After purchase the tile becomes buildable and the renderer drops
   * its "for sale" overlay on the next zone-redraw.
   */
  private buyLand(x: number, y: number): boolean {
    const t = this.grid.get(x, y);
    if (!t) return false;
    if (t.owned) {
      this.onStatusMessage?.('You already own that land');
      return false;
    }
    if (this.economy.treasury < LAND_PURCHASE_COST_PER_TILE) {
      this.onStatusMessage?.(`Not enough money — land costs $${LAND_PURCHASE_COST_PER_TILE.toLocaleString()}/tile`);
      return false;
    }
    t.owned = true;
    this.economy.treasury -= LAND_PURCHASE_COST_PER_TILE;
    this.renderer.drawZones(this.grid);
    return true;
  }

  /**
   * Skyscraper placement (Alpha 3.1.2). Validates a 2×2 area starting at
   * (x, y) — all 4 tiles must be free + zoneable + at least one of the
   * four must be road-adjacent. Treasury is debited by SKYSCRAPER_COST.
   * On success: stamps all 4 tiles with skyscraper bits at stage 0
   * (foundation pit). The Skyscrapers sim ticks the stage forward
   * monthly until stage 4 (built).
   */
  private placeSkyscraper(x: number, y: number, zone: 'residential' | 'commercial' | 'mixed'): boolean {
    const offsets: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
    // All 4 tiles must be valid for new zone paint.
    for (const [dx, dy] of offsets) {
      const t = this.grid.get(x + dx, y + dy);
      if (!t) {
        this.onStatusMessage?.('Skyscraper needs a 2×2 free area');
        return false;
      }
      if (t.road || t.path || t.zone !== 'none' || t.building !== 'none') {
        this.onStatusMessage?.('Skyscraper needs all 4 tiles free');
        return false;
      }
      if (t.terrain === 'water' || t.bridge || t.skyscraper) {
        this.onStatusMessage?.('Skyscraper needs flat free land');
        return false;
      }
    }
    // At least one of the 4 must be road-adjacent.
    let hasRoadAdj = false;
    for (const [dx, dy] of offsets) {
      if (this.grid.hasRoadAdjacent(x + dx, y + dy)) { hasRoadAdj = true; break; }
    }
    if (!hasRoadAdj) {
      this.onStatusMessage?.('Skyscraper needs a road touching the lot');
      return false;
    }
    const cost = SKYSCRAPER_COST[zone];
    if (this.economy.treasury < cost) {
      this.onStatusMessage?.(`Not enough money — skyscraper costs $${cost.toLocaleString()}`);
      return false;
    }
    // Pick a deterministic variant from the placement coordinate so a
    // skyscraper at (12, 8) always picks the same design across saves.
    const variant = Math.abs((x * 73856093) ^ (y * 19349663)) % SKYSCRAPER_VARIANT_COUNT as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
    for (const [dx, dy] of offsets) {
      const t = this.grid.get(x + dx, y + dy)!;
      t.zone = zone;
      t.zoneCap = 3;
      t.skyscraper = true;
      t.skyscraperStage = 0;
      t.skyscraperVariant = variant;
      t.developedAt = this.economy.monthsElapsed;
      // Density stays 0 until stage 4 → at stage 4 the population
      // sweep reads SKYSCRAPER_RESIDENTS_PER_TILE directly.
    }
    this.economy.treasury -= cost;
    this.renderer.drawCityBuildings(this.grid, this.forestryHealth(), this.farmHealth());
    this.renderer.drawBuildings(this.grid, this.cityMood(), this.economy.monthsElapsed);
    this.renderer.drawZones(this.grid);
    return true;
  }

  /**
   * Mayor's Mansion placement (Alpha 4.2). Validates the 4×2 footprint
   * starting at `(x, y)` (which is the lex-smallest tile of the eight),
   * one-per-city constraint, treasury, and stamps the bits across all
   * eight tiles. The anchor tile gets `building='mayor_mansion'`; the
   * other seven get `mayorMansion=true` only.
   *
   * Failure reasons (each surfaces a clear toast so the player knows
   * why placement was rejected):
   * - Footprint runs off-map
   * - Any of the 8 tiles is occupied / not owned / wrong terrain
   * - A mayor's mansion already exists in this city
   * - Treasury < $500K (after council multiplier)
   * - Council banned (full ban from the costMultiplier gate)
   *
   * No road-adjacency requirement — this isn't a working civic build,
   * it's a private estate; players can plant it deep in the woods.
   */
  private placeMayorMansion(x: number, y: number): boolean {
    // One-per-city constraint. A quick sweep — cheap on Small/Medium
    // and tolerable on Large since this is a one-time placement.
    for (const t of this.grid.iter()) {
      if (t.mayorMansion) {
        this.onStatusMessage?.('Only one Mayor\'s Mansion per city');
        return false;
      }
    }
    // Cost + council gate.
    const baseCost = BUILDING_COSTS.mayor_mansion;
    const mult = this.council.costMultiplier('mayor_mansion');
    if (!isFinite(mult)) {
      this.onStatusMessage?.('Banned by council');
      return false;
    }
    const cost = Math.round(baseCost * mult);
    if (this.economy.treasury < cost) {
      this.onStatusMessage?.(`Not enough money — Mayor's Mansion costs $${cost.toLocaleString()}`);
      return false;
    }
    // Footprint validation. 4 wide × 2 deep = 8 tiles, all must be
    // free, owned, on grass (no water / bridge / sand inside the
    // grounds — the manicured estate doesn't make sense in mixed
    // terrain).
    const offsets: Array<[number, number]> = [];
    for (let dy = 0; dy < MAYOR_MANSION_DEPTH; dy++) {
      for (let dx = 0; dx < MAYOR_MANSION_WIDTH; dx++) {
        offsets.push([dx, dy]);
      }
    }
    for (const [dx, dy] of offsets) {
      const t = this.grid.get(x + dx, y + dy);
      if (!t) {
        this.onStatusMessage?.('Mayor\'s Mansion needs a 4×2 free area');
        return false;
      }
      if (!t.owned) {
        this.onStatusMessage?.('Mayor\'s Mansion footprint includes unowned land');
        return false;
      }
      if (t.road || t.path || t.zone !== 'none' || t.building !== 'none') {
        this.onStatusMessage?.('Mayor\'s Mansion needs all 8 tiles free');
        return false;
      }
      if (t.terrain !== 'grass' || t.bridge || t.skyscraper || t.luxury) {
        this.onStatusMessage?.('Mayor\'s Mansion needs flat grass land');
        return false;
      }
    }
    // Stamp the bits. Anchor (lex-smallest = (x, y)) carries the
    // `building` value; the other seven are marked-only.
    for (const [dx, dy] of offsets) {
      const t = this.grid.get(x + dx, y + dy)!;
      t.mayorMansion = true;
      if (dx === 0 && dy === 0) {
        t.building = 'mayor_mansion';
      }
    }
    this.economy.treasury -= cost;
    this.services.recompute(this.grid);
    this.renderer.drawCityBuildings(this.grid, this.forestryHealth(), this.farmHealth());
    this.maybeOfferPhotoOp('mayor_mansion');
    return true;
  }

  /**
   * Luxury-paint pre-check: is `(x,y)` a tile that could become half of a
   * luxury pair? Same constraints as a regular zone paint (free, zoneable,
   * adjacent-to-road), AND the tile must not already be luxury (so two
   * pairs don't share a tile).
   */
  private canZoneLuxury(x: number, y: number): boolean {
    const t = this.grid.get(x, y);
    if (!t) return false;
    if (t.road || t.zone !== 'none' || t.building !== 'none' || t.path) return false;
    if (t.terrain === 'water' || t.bridge) return false;
    if (t.luxury) return false;
    return this.grid.hasRoadAdjacent(x, y);
  }

  /**
   * After a placement, check whether any faction's stance toward the placed
   * thing is strong enough (≥ 0.5) to invite a photo-op. If so, queue the
   * banner — player can accept (spends PC + $$, boosts that faction's
   * turnout, makes opponents mad) or skip.
   */
  private maybeOfferPhotoOp(key: StanceKey): void {
    let best: FactionId | null = null;
    let bestStance = 0.5; // threshold
    for (const id of Object.keys(FACTION_STANCES) as FactionId[]) {
      const s = FACTION_STANCES[id][key];
      if (s > bestStance) { best = id; bestStance = s; }
    }
    if (!best) return;
    if (this.council.hasPhotoOpThisTerm(best)) return;
    if (this.council.politicalCapital < 2) return;
    if (this.economy.treasury < 200) return;

    // Opponents = factions that strongly dislike this thing.
    const opponents: FactionId[] = [];
    for (const id of Object.keys(FACTION_STANCES) as FactionId[]) {
      if (FACTION_STANCES[id][key] <= -0.3) opponents.push(id);
    }

    const factionId = best;
    this.photoOpBanner.show(factionId, () => {
      const ok = this.council.tryPhotoOp(factionId, this.economy.treasury >= 200, opponents);
      if (ok) this.economy.treasury -= 200;
    });
  }

  private applyRubberBand(end: { x: number; y: number }): void {
    if (!this.strokeOrigin) return;
    const path = path8(this.strokeOrigin, end);
    const tier = ROAD_TOOLS.get(this.tool);
    if (tier) {
      this.applyRoadStroke(path, tier);
      return;
    }
    if (this.tool === 'place_path') {
      this.applyPathStroke(path);
      return;
    }
    if (this.tool === 'bulldoze') {
      this.applyBulldozeStroke(path);
      return;
    }
    if (this.tool === 'paint_district') {
      this.applyDistrictPaintStroke(path);
      return;
    }
    if (this.tool === 'erase_district') {
      this.applyDistrictEraseStroke(path);
      return;
    }
    // Terraforming (Alpha 4.0 — Architect Mode). Each terra_* tool maps
    // to a target terrain kind plus a per-tile cost. Painted tiles must
    // be free of road / zone / building / path / luxury / skyscraper —
    // we don't allow terraforming a developed city.
    if (
      this.tool === 'terra_tree' || this.tool === 'terra_meadow' ||
      this.tool === 'terra_pond' || this.tool === 'terra_smooth'
    ) {
      this.applyTerraformStroke(path, this.tool);
      return;
    }
    const zoneInfo = ZONE_TOOL_INFO.get(this.tool);
    if (zoneInfo) {
      this.applyZoneStroke(path, zoneInfo.zone, ZONE_TIER_CAP[zoneInfo.tier]);
    }
  }

  /** Paint district membership over a 4-connected stroke. If activeDistrictId
   *  is 0 we allocate a fresh district on the first painted tile and stamp
   *  every subsequent tile with that id. */
  private applyDistrictPaintStroke(path: { x: number; y: number }[]): void {
    let id = this.activeDistrictId;
    if (id === 0) {
      const fresh = this.districts.allocate();
      id = fresh.id;
      this.activeDistrictId = id;
    } else if (!this.districts.get(id)) {
      this.districts.ensure(id);
    }
    let touched = false;
    for (const p of path) {
      const t = this.grid.get(p.x, p.y);
      if (!t) continue;
      if (t.districtId === id) continue;
      t.districtId = id;
      touched = true;
    }
    if (touched) this.renderer.drawDistricts(this.grid, this.districts);
  }

  /** Clear district membership on every painted tile. */
  private applyDistrictEraseStroke(path: { x: number; y: number }[]): void {
    let touched = false;
    for (const p of path) {
      const t = this.grid.get(p.x, p.y);
      if (!t || t.districtId === 0) continue;
      t.districtId = 0;
      touched = true;
    }
    if (touched) this.renderer.drawDistricts(this.grid, this.districts);
  }

  /**
   * Terraforming stroke (Alpha 4.0 — Architect Mode). Mutates a tile's
   * terrain in place; cheap because the renderer's terrain + trees mesh
   * is rebuilt by `drawWorld` (already a sub-frame operation on Small/
   * Medium). Per-tile cost is deducted incrementally — strokes that
   * outrun the treasury simply stop applying mid-stroke.
   *
   * Refuses tiles that are developed (road / zone / building / path /
   * luxury / skyscraper / bridge) — terraforming a built city would
   * leave roads floating or zones marooned in water.
   */
  private applyTerraformStroke(
    path: { x: number; y: number }[],
    tool: 'terra_tree' | 'terra_meadow' | 'terra_pond' | 'terra_smooth'
  ): void {
    const target: import('../types').TerrainType =
      tool === 'terra_tree'   ? 'forest' :
      tool === 'terra_meadow' ? 'sand'   :
      tool === 'terra_pond'   ? 'water'  :
      'grass';
    const baseCost = TERRAFORM_COSTS[tool];
    const mult = this.council.costMultiplier('park'); // reuse park stance for terraforming pricing
    if (!isFinite(mult)) {
      this.onStatusMessage?.('Banned by council');
      return;
    }
    const perTileCost = Math.round(baseCost * mult);
    let changed = false;
    let blockedByCash = false;
    let blockedByDeveloped = false;
    const seen = new Set<number>();
    for (const p of path) {
      const idx = this.tileIndex(p.x, p.y);
      if (seen.has(idx)) continue;
      seen.add(idx);
      const t = this.grid.get(p.x, p.y);
      if (!t) continue;
      if (!t.owned) continue;
      if (t.terrain === target) continue;
      // Refuse developed tiles — terraforming would leave roads floating
      // / zones marooned. Player must bulldoze first.
      if (
        t.road || t.bridge || t.bridgeRoad || t.path ||
        t.zone !== 'none' || t.building !== 'none' ||
        t.luxury || t.skyscraper
      ) { blockedByDeveloped = true; continue; }
      if (this.economy.treasury < perTileCost) { blockedByCash = true; continue; }
      this.economy.treasury -= perTileCost;
      t.terrain = target;
      changed = true;
    }
    if (changed) {
      // drawWorld rebuilds terrain + trees in one shot; cheap on Small/Medium.
      this.renderer.drawWorld(this.grid);
      // Path graph reads non-water tiles as walkable in places — rebuild
      // defensively so a meadow → pond stroke updates pedestrian routing.
      this.pathGraph.rebuild(this.grid);
    }
    if (blockedByCash && !this.terraformBlockNotifiedThisStroke) {
      this.terraformBlockNotifiedThisStroke = true;
      this.onStatusMessage?.(`Stroke stopped — need $${perTileCost.toLocaleString()}/tile`);
    } else if (blockedByDeveloped && !changed && !this.terraformBlockNotifiedThisStroke) {
      this.terraformBlockNotifiedThisStroke = true;
      this.onStatusMessage?.('Bulldoze first — terraforming refuses developed tiles');
    }
  }
  /** Per-stroke guard so the terraform "not enough money" toast fires
   *  exactly once even on a long unaffordable stroke. */
  private terraformBlockNotifiedThisStroke = false;

  // --- Road tool stroke ---------------------------------------------------

  private applyRoadStroke(path: { x: number; y: number }[], tier: RoadType): void {
    // Bridge Mode (Alpha 2.12): paint on the upper layer instead.
    if (this.bridgeMode) {
      this.applyBridgeRoadStroke(path, tier);
      return;
    }
    const desiredEdges = new Set<number>();
    const desiredStubs = new Set<number>();
    // For highway strokes, remember the flow direction at each tile so we
    // can imprint it after edges are placed. Map<tileIdx, dirIndex>.
    const desiredDirs = tier === 'highway' ? new Map<number, number>() : null;

    if (path.length === 1) {
      desiredStubs.add(this.tileIndex(path[0]!.x, path[0]!.y));
    } else {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        desiredEdges.add(packEdge(this.tileIndex(a.x, a.y), this.tileIndex(b.x, b.y)));
        if (desiredDirs) {
          // Flow direction = "from a toward b" — applies to tile a.
          const d = dirBetween(a.x, a.y, b.x, b.y);
          if (d !== -1) desiredDirs.set(this.tileIndex(a.x, a.y), d);
        }
      }
      // Last tile inherits the previous segment's direction (no outgoing edge
      // in this stroke; cars passing through just continue in the same flow).
      if (desiredDirs && path.length >= 2) {
        const a = path[path.length - 2]!;
        const b = path[path.length - 1]!;
        const d = dirBetween(a.x, a.y, b.x, b.y);
        if (d !== -1) desiredDirs.set(this.tileIndex(b.x, b.y), d);
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

    // Apply the desired road state at the chosen tier. Paint always wins —
    // an existing local under a highway stroke gets upgraded.
    for (const ek of desiredEdges) {
      const { ax, ay, bx, by } = unpackEdge(ek, this.grid.width);
      const beforeZA = this.grid.zoneAt(ax, ay);
      const beforeZB = this.grid.zoneAt(bx, by);
      const hadEdge = this.grid.hasRoadEdge(ax, ay, bx, by);
      const ta = this.grid.get(ax, ay);
      const tb = this.grid.get(bx, by);
      const tierChanged =
        (ta && ta.roadType !== tier) || (tb && tb.roadType !== tier);
      if (hadEdge && !tierChanged) continue;
      if (this.grid.setRoadEdge(ax, ay, bx, by, true, tier)) {
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
      if (!t) continue;
      if (t.road && t.roadType === tier) continue;
      if (this.grid.setRoad(x, y, true, tier)) {
        if (t.zone !== 'none') {
          // setRoad already cleared the zone, but the renderer needs to know.
          zonesChanged = true;
        }
        this.strokeStubs.add(sk);
        roadsChanged = true;
      }
    }

    // Imprint highway flow direction on each tile in the stroke.
    if (desiredDirs) {
      for (const [tileIdx, dir] of desiredDirs) {
        const { x, y } = this.unpackTile(tileIdx);
        if (this.grid.setHighwayDir(x, y, dir)) roadsChanged = true;
      }
    }

    // Forest clearing — every tile that's now a road but was forest gets
    // paved over. Track each cleared tile so a stroke retreat can grow the
    // tree back. Walk the tile sets we know we touched (endpoints of any
    // desired edge, plus any desired stub) rather than every road tile on
    // the map.
    let forestChanged = false;
    const touched = new Set<number>(desiredStubs);
    for (const ek of desiredEdges) {
      const { ax, ay, bx, by } = unpackEdge(ek, this.grid.width);
      touched.add(this.tileIndex(ax, ay));
      touched.add(this.tileIndex(bx, by));
    }
    for (const idx of touched) {
      const { x, y } = this.unpackTile(idx);
      const t = this.grid.get(x, y);
      if (!t || !t.road) continue;
      if (t.terrain === 'forest') {
        t.terrain = 'grass';
        this.strokeForestCleared.add(idx);
        forestChanged = true;
      }
    }
    // Restore trees on retreat — any tile we previously cleared that's no
    // longer a road grows its forest back.
    for (const idx of [...this.strokeForestCleared]) {
      const { x, y } = this.unpackTile(idx);
      const t = this.grid.get(x, y);
      if (!t) continue;
      if (!t.road) {
        t.terrain = 'forest';
        this.strokeForestCleared.delete(idx);
        forestChanged = true;
      }
    }

    if (roadsChanged) {
      this.renderer.drawRoads(this.grid);
      // A* needs an up-to-date adjacency for any spawn that follows.
      this.roadGraph.rebuild(this.grid);
      // Road tiles are walkable for pedestrians (except highways), so the
      // pedestrian graph must rebuild whenever road tiles change.
      this.pathGraph.rebuild(this.grid);
      // Outside-world connection (Alpha 2.7) depends on edge-tile road
      // membership; refresh whenever roads change.
      this.globalMarket.recompute(this.grid);
    }
    if (zonesChanged) {
      this.renderer.drawZones(this.grid);
      // Promoting a zoned tile to road wipes its building.
      this.renderer.drawBuildings(this.grid, this.cityMood(), this.economy.monthsElapsed);
    }
    if (forestChanged) {
      // Terrain colour + tree-instance set both depend on Tile.terrain.
      // drawWorld rebuilds both — on Small/Medium maps this is sub-frame.
      this.renderer.drawWorld(this.grid);
    }
  }

  // --- Bridge Mode road stroke (Alpha 2.12) ------------------------------

  /**
   * Upper-layer (overpass) road stroke. Parallel to applyRoadStroke but
   * touches the bridge edge graph and the upper-layer per-tile fields.
   * Doesn't clear zones / forests on the ground tile — the overpass
   * leaves the surface beneath untouched. No stub support (single-tile
   * overpasses look weird without a span).
   */
  private applyBridgeRoadStroke(path: { x: number; y: number }[], tier: RoadType): void {
    if (path.length < 2) return; // single-tile overpasses skipped
    const desiredEdges = new Set<number>();
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      desiredEdges.add(packEdge(this.tileIndex(a.x, a.y), this.tileIndex(b.x, b.y)));
    }

    let changed = false;
    // Revert this-stroke upper edges no longer wanted.
    for (const ek of this.strokeBridgeEdges) {
      if (desiredEdges.has(ek)) continue;
      const { ax, ay, bx, by } = unpackEdge(ek, this.grid.width);
      if (this.grid.setBridgeRoadEdge(ax, ay, bx, by, false)) changed = true;
      this.strokeBridgeEdges.delete(ek);
    }
    // Apply desired upper edges.
    for (const ek of desiredEdges) {
      const { ax, ay, bx, by } = unpackEdge(ek, this.grid.width);
      if (this.grid.hasBridgeRoadEdge(ax, ay, bx, by)) continue;
      if (this.grid.setBridgeRoadEdge(ax, ay, bx, by, true, tier)) {
        this.strokeBridgeEdges.add(ek);
        changed = true;
      }
    }
    if (changed) this.renderer.drawRoads(this.grid);
  }

  // --- Zone tool stroke ---------------------------------------------------

  private applyZoneStroke(
    path: { x: number; y: number }[],
    zone: Exclude<Zone, 'none'>,
    cap: 1 | 2 | 3
  ): void {
    const desired = new Set<number>();
    for (const p of path) desired.add(this.tileIndex(p.x, p.y));

    let changed = false;

    // Council zoning-change gate: re-zoning an already-zoned tile to a
    // different zone-or-tier needs ≥2 councillors with non-negative stance.
    // Painting fresh grass is always allowed. Pre-compute once per stroke.
    const tier: ZoneTier = cap === 1 ? 'low' : cap === 2 ? 'medium' : 'high';
    const changeAllowed = this.council.canChangeZone(zone, tier);

    // Revert tiles whose zone we changed in earlier moves but that no longer
    // fall on the rubber band.
    for (const [idx, original] of this.strokeZones) {
      if (desired.has(idx)) continue;
      const { x, y } = this.unpackTile(idx);
      if (this.grid.setZone(x, y, original.zone, original.cap)) changed = true;
      this.strokeZones.delete(idx);
    }

    // Apply desired zone+cap where eligible. Invalid tiles (road, no road
    // adjacent, off-map) are silently skipped — feels nicer than rejecting
    // a whole stroke. Rezoning an existing zone tile additionally requires
    // council approval; if the council blocks the change, skip that tile.
    let blockedByCouncil = 0;
    for (const idx of desired) {
      const { x, y } = this.unpackTile(idx);
      const tile = this.grid.get(x, y);
      if (!tile) continue;
      if (tile.zone === zone && tile.zoneCap === cap) continue;
      // If the tile is already zoned to something different, this is a
      // "change" and needs council approval.
      const isChange = tile.zone !== 'none';
      if (isChange && !changeAllowed) {
        blockedByCouncil++;
        continue;
      }
      // Snapshot original ONCE per tile per stroke so a wiggle restores
      // correctly even if we touched the cell multiple times.
      if (!this.strokeZones.has(idx)) {
        this.strokeZones.set(idx, { zone: tile.zone, cap: tile.zoneCap });
      }
      if (this.grid.setZone(x, y, zone, cap)) changed = true;
    }
    // Council-block toast (Alpha 2.9.1) — surface a clear pop-up when
    // the change was actually blocked, not just for "no road adjacent"
    // or other silent-skip reasons. Only fire once per stroke.
    if (blockedByCouncil > 0 && !this.councilBlockNotifiedThisStroke) {
      this.councilBlockNotifiedThisStroke = true;
      const zoneName =
        zone === 'residential' ? 'Residential'
        : zone === 'commercial' ? 'Commercial'
        : zone === 'industrial' ? 'Industrial'
        : 'Mixed-use';
      const tierName = cap === 1 ? 'low' : cap === 2 ? 'medium' : 'high';
      this.onStatusMessage?.(
        `Council blocked re-zoning to ${zoneName} ${tierName} — needs ≥ 2 councillor approvals.`
      );
    }

    if (changed) {
      this.renderer.drawZones(this.grid);
      // Re-zoning a developed tile resets its density to 0; rebuild buildings.
      this.renderer.drawBuildings(this.grid, this.cityMood(), this.economy.monthsElapsed);
    }
  }

  // --- Path tool stroke ---------------------------------------------------

  /**
   * Walking-path stroke. Per-tile, no edge graph (pedestrians treat 4-connected
   * path tiles as walkable). Rules:
   *  - Path CANNOT overwrite a road (road tile is silently skipped).
   *  - Path CAN overwrite a zone (zone is cleared, in-progress development is
   *    discarded). Re-zoning the tile later requires bulldozing the path.
   *  - Stroke retreat undoes path tiles set this stroke. Zones cleared mid-
   *    stroke are NOT auto-restored on retreat (mirrors road-stroke
   *    behaviour); the full Undo stack handles the entire stroke if needed.
   */
  private applyPathStroke(path: { x: number; y: number }[]): void {
    const desired = new Set<number>();
    for (const p of path) desired.add(this.tileIndex(p.x, p.y));

    let pathsChanged = false;
    let zonesChanged = false;

    // Retreat: tiles we set in earlier moves but no longer on the band.
    for (const idx of this.strokePaths) {
      if (desired.has(idx)) continue;
      const { x, y } = this.unpackTile(idx);
      if (this.grid.setPath(x, y, false)) pathsChanged = true;
      this.strokePaths.delete(idx);
    }

    // Apply to fresh tiles. Roads silently skipped per the rule above.
    for (const idx of desired) {
      const { x, y } = this.unpackTile(idx);
      const tile = this.grid.get(x, y);
      if (!tile) continue;
      if (tile.road || tile.path) continue;
      const hadZone = tile.zone !== 'none';
      if (this.grid.setPath(x, y, true)) {
        this.strokePaths.add(idx);
        pathsChanged = true;
        if (hadZone) zonesChanged = true;
      }
    }

    if (pathsChanged) {
      this.renderer.drawPaths(this.grid);
      this.pathGraph.rebuild(this.grid);
    }
    if (zonesChanged) {
      this.renderer.drawZones(this.grid);
      // Clearing a zone wipes any building that was developing on it.
      this.renderer.drawBuildings(this.grid, this.cityMood(), this.economy.monthsElapsed);
    }
  }

  // --- Bulldoze stroke ----------------------------------------------------

  private applyBulldozeStroke(path: { x: number; y: number }[]): void {
    const desired = new Set<number>();
    for (const p of path) desired.add(this.tileIndex(p.x, p.y));

    let roadsChanged = false;
    let zonesChanged = false;
    let cityBuildingsChanged = false;
    let pathsChanged = false;

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
        if (this.grid.setRoadEdgeByKey(ek, true, snap.roadType)) roadsChanged = true;
      }
      if (snap.wasRoad && !this.grid.hasRoad(x, y)) {
        if (this.grid.setRoad(x, y, true, snap.roadType)) roadsChanged = true;
      }
      // Re-imprint per-tile road metadata (tier, highway dir, stop sign) — the
      // edge restore above sets tier on the endpoints but a stub-only restore
      // and per-tile state need explicit handling.
      const tile = this.grid.get(x, y);
      if (tile && tile.road) {
        tile.roadType = snap.roadType;
        tile.highwayDir = snap.highwayDir;
        tile.stopSign = snap.stopSign;
        tile.trafficLight = snap.trafficLight;
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
      // Walking path restore (mutually exclusive with road, but zone+path
      // can't coexist either — so only restore if no zone is being restored
      // on top of it). Apply zone restore below.
      if (snap.path && !t.path && t.zone === 'none') {
        t.path = true;
        pathsChanged = true;
      }
      if (snap.zone === 'none' && t.zone === 'none') continue;
      if (t.zone !== snap.zone || t.zoneCap !== snap.zoneCap || t.density !== snap.density) {
        // setPath was true above? clear it before restoring a zone (mutually exclusive).
        if (t.path) { t.path = false; pathsChanged = true; }
        t.zone = snap.zone;
        t.zoneCap = snap.zoneCap;
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
      if (!tile.road && tile.zone === 'none' && tile.building === 'none' && !tile.path) continue;

      const snap: BulldozedSnapshot = {
        wasRoad: tile.road,
        roadType: tile.roadType,
        highwayDir: tile.highwayDir,
        stopSign: tile.stopSign,
        trafficLight: tile.trafficLight,
        zone: tile.zone,
        zoneCap: tile.zoneCap,
        density: tile.density,
        developmentPressure: tile.developmentPressure,
        edges: this.grid.incidentRoadEdges(x, y),
        building: tile.building,
        path: tile.path
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
      // Skyscraper cleanup (Alpha 3.1.2): bulldozing any tile of a 2×2
      // skyscraper clears the bits on all four tiles so we don't leave
      // orphaned partial footprints. The renderer's anchor check would
      // otherwise drop the geometry silently — but the gameplay state
      // would still hold a phantom skyscraper-marked tile.
      if (tile.skyscraper) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const peer = this.grid.get(x + dx, y + dy);
            if (peer && peer.skyscraper && peer.zone === tile.zone && peer.skyscraperVariant === tile.skyscraperVariant) {
              peer.skyscraper = false;
              peer.skyscraperStage = 0;
              peer.skyscraperVariant = 0;
              if (peer.zone !== 'none') {
                this.grid.setZone(peer.x, peer.y, 'none');
                zonesChanged = true;
              }
            }
          }
        }
      }
      if (tile.building !== 'none') {
        if (this.grid.setBuilding(x, y, 'none')) cityBuildingsChanged = true;
      }
      // Mayor's Mansion (Alpha 4.2) — bulldozing any of the 8 tiles
      // tears down the whole 4×2 footprint. Find the lex-smallest
      // bit-set tile (the anchor) by walking left+up from the tap, then
      // clear the entire MAYOR_MANSION_WIDTH × MAYOR_MANSION_DEPTH
      // rectangle from there.
      if (tile.mayorMansion) {
        // Walk left to find the western edge of the footprint.
        let ax = x;
        while (ax > 0 && this.grid.get(ax - 1, y)?.mayorMansion) ax--;
        // Walk up to find the northern edge.
        let ay = y;
        while (ay > 0 && this.grid.get(ax, ay - 1)?.mayorMansion) ay--;
        for (let dy = 0; dy < MAYOR_MANSION_DEPTH; dy++) {
          for (let dx = 0; dx < MAYOR_MANSION_WIDTH; dx++) {
            const peer = this.grid.get(ax + dx, ay + dy);
            if (!peer || !peer.mayorMansion) continue;
            peer.mayorMansion = false;
            if (peer.building === 'mayor_mansion') {
              if (this.grid.setBuilding(peer.x, peer.y, 'none')) cityBuildingsChanged = true;
            }
          }
        }
        cityBuildingsChanged = true;
      }
      if (tile.path) {
        if (this.grid.setPath(x, y, false)) pathsChanged = true;
      }
    }

    if (roadsChanged) {
      this.renderer.drawRoads(this.grid);
      this.roadGraph.rebuild(this.grid);
      this.globalMarket.recompute(this.grid);
    }
    if (zonesChanged) {
      this.renderer.drawZones(this.grid);
      // Bulldozing tears down whatever was developing on that tile.
      this.renderer.drawBuildings(this.grid, this.cityMood(), this.economy.monthsElapsed);
    }
    if (cityBuildingsChanged) {
      this.renderer.drawCityBuildings(this.grid, this.forestryHealth(), this.farmHealth());
      // Service coverage changed — rerun the sweep so Development sees it.
      this.services.recompute(this.grid);
    }
    if (pathsChanged) {
      this.renderer.drawPaths(this.grid);
      this.pathGraph.rebuild(this.grid);
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
  /** Road tier captured at bulldoze time — restored if the rubber band retreats. */
  roadType: RoadType;
  highwayDir: number;
  stopSign: boolean;
  trafficLight: boolean;
  zone: Zone;
  /** Player-set density cap (0..3) at bulldoze time. Restored alongside zone. */
  zoneCap: 0 | 1 | 2 | 3;
  /** Density at bulldoze time — restored verbatim if the rubber band retreats. */
  density: number;
  developmentPressure: number;
  /** Packed edge keys that existed at the moment we bulldozed this tile. */
  edges: number[];
  /** City building (power plant, water tower, …) that occupied this tile. */
  building: Building;
  /** Walking-path bit at bulldoze time. */
  path: boolean;
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
