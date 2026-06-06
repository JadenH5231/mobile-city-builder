import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PCFSoftShadowMap,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import type { Camera } from './Camera';
import type { Grid } from '../world/Grid';
import type { Tile } from '../world/Tile';
import {
  FARM_TRACTOR_MIN_CLUSTER,
  MAX_PEDESTRIANS,
  MAX_TRACTORS,
  MAX_STADIUM_PLAYERS,
  MAX_VEHICLES,
  MAX_TOURIST_VEHICLES,
  MAX_SERVICE_VEHICLES,
  MAX_TRUCKS,
  ROAD_LIFT,
  ROAD_TIER,
  TILE_SIZE
} from '../types';
import type { Buses } from '../simulation/Buses';
import type { Pedestrians } from '../simulation/Pedestrians';
import type { Vehicles } from '../simulation/Vehicles';
import { getActiveTheme } from '../themes/registry';
import {
  buildBeautificationMesh,
  buildBridgeRoadMesh,
  buildBuildingsMesh,
  emitZonedBuildingTile,
  mergeZonedBuildings,
  buildCityBuildingsMesh,
  buildCrimeHeatmapMesh,
  buildDistrictsMesh,
  buildHeatmapMesh,
  buildLampGlowMesh,
  buildLitWindowsMesh,
  buildNightLightsMesh,
  buildPathMesh,
  buildRoadMesh,
  buildRoadOrnamentsGroup,
  buildSidewalkMesh,
  buildSkyscrapersMesh,
  buildTerrainMesh,
  buildTreesMesh,
  buildUnownedLandMesh,
  buildZoneMesh,
  floodBuilding,
  lerpHexColor,
  makeClouds,
  makePlusButtonTexture,
  makeRadialGlowTexture,
  makeSkyGradient,
  mergeGeoms,
  pedestrianOffsetForTile,
  readKind,
  repaintSkyGradient,
  roadSurfaceY,
  walkerSurfaceY,
  warpDayPhase
} from './renderer/builders';
import { PostFX, DEFAULT_POSTFX, type PostFXConfig } from './renderer/postfx';

/**
 * Read the FX kill-switch from the URL. FX default ON (Beta 1.9 "looks"
 * pass); `?fx=0` (or off/false/no) drops straight back to the pre-1.9
 * direct-render path for A/B comparison and as the guaranteed WebGL2
 * fallback. The Settings toggle persists a preference on top of this.
 */
function readFxParamEnabled(): boolean {
  try {
    const v = new URLSearchParams(window.location.search).get('fx');
    if (v === null) return true;
    return !['0', 'off', 'false', 'no'].includes(v.toLowerCase());
  } catch {
    return true;
  }
}

/**
 * Three.js renderer. Builds the world from three big meshes — terrain, trees,
 * roads — plus a small selection plane. The terrain mesh is built once at
 * load; the road mesh is rebuilt on every paint event (cheap because it only
 * has road tiles' geometry); trees use an InstancedMesh so a forest of 200+
 * cells stays in one draw call.
 *
 * The chunky low-poly look comes from per-vertex colours and flat shading
 * with simple Lambert / hemisphere-light setup. No textures yet — placeholder
 * art lives in code.
 *
 * **Theme-pack architecture (Beta 1.2):** colour constants below are
 * fed from `getActiveTheme()` instead of being baked. The renderer
 * subscribes to theme changes via `onThemeChange(() => refreshAll())`
 * so swapping the pack repaints every mesh from scratch with the new
 * palette. Long-tail colour literals deep inside build functions go
 * through `tint(stockHex)` — a per-theme HSL+blend filter — so even
 * unmigrated detail colours read as part of the active theme.
 */
// THEME() is a thin accessor so call sites stay terse. The function
// indirection is important: theme state can change at runtime, so we
// must NOT capture it into a module-level const at load.
function THEME() { return getActiveTheme(); }
const SELECTION_COLOR = 0xffd84d;
/** World-units the shadow-casting sun sits from the camera target. The world
 *  is tiny (TILE_SIZE = 1; tallest buildings only ~3 units), and a distant sun
 *  blows out the packed-depth shadow map's precision so the shadow vanishes
 *  ENTIRELY — keep it close. Empirically shadows render cleanly at ~18 and are
 *  already gone by ~22. */
const SUN_SHADOW_DIST = 18;
/** Floor for the shadow sun's elevation (the y of its unit direction). A very
 *  low sun (dawn/dusk) stretches the shadow-cam depth range and kills
 *  precision, so the SHADOW caster stays this high even when the VISUAL sun
 *  dips lower. ≈ 30° above the horizon. */
const SUN_SHADOW_MIN_ELEV = 0.5;
/** Ceiling for the shadow sun's elevation. Without it, midday's near-overhead
 *  sun casts shadows so short they vanish under the buildings — the shadows
 *  read as "barely there" exactly when the player is most likely looking. We
 *  clamp the SHADOW caster into a pleasant fixed band (≈30°–44°) so cast
 *  shadows stay a consistent, visible length all day; only their direction
 *  rotates with time. The VISUAL sun colour/intensity still tracks the real
 *  arc, so the day/night feel is unchanged. ≈ 44° above the horizon. */
const SUN_SHADOW_MAX_ELEV = 0.7;
/** Cap the orthoSize the shadow frustum tracks. Past this (zoomed way out) the
 *  frustum — and therefore the near→far depth range — would grow large enough
 *  to lose the shadow; instead we keep covering the central framed area (at far
 *  zoom the per-building shadows are sub-pixel anyway). */
const SUN_SHADOW_MAX_ORTHO = 22;
/** Per-frame time budget (ms) for the incremental zoned-buildings rebuild
 *  (Beta 1.9). Spreads a big city's ~1.5s full rebuild across frames so it
 *  never freezes; the old mesh stays on screen until the new one is ready. */
const BUILDINGS_REBUILD_BUDGET_MS = 8;

export class Renderer {
  readonly scene = new Scene();
  readonly three: WebGLRenderer;

  /** Post-processing pipeline (Beta 1.9). Lazily constructed on the first
   *  render that needs it (we need the camera, which arrives via render()).
   *  Null when FX are disabled — render() then takes the direct path. */
  private postfx: PostFX | null = null;
  private fxEnabled = readFxParamEnabled();
  private fxConfig: PostFXConfig = { ...DEFAULT_POSTFX };
  /** Last CSS viewport size, mirrored to the composer on resize + lazy init. */
  private viewW = window.innerWidth;
  private viewH = window.innerHeight;
  /** Real sun-shadow maps active (Beta 1.9). Boot-decided from the FX flag so
   *  materials compile with shadow support; `?fx=0` boots with this off. */
  private shadowsActive = false;
  /** Scratch for re-deriving the sun direction each frame in updateSunShadow. */
  private readonly sunDir = new Vector3();
  /** Last shadow-frustum half-extent — only re-derive near/far + projection
   *  when the zoom (and therefore this) actually changes. */
  private lastShadowR = -1;

  private readonly worldGroup = new Group();
  private terrainMesh: Mesh | null = null;
  private zoneMesh: Mesh | null = null;
  /** Sidewalk strips on local + avenue tiles. Rebuilt with roads. */
  private sidewalkMesh: Mesh | null = null;
  /** Walking-path strips. Rebuilt when path tiles change. */
  private pathMesh: Mesh | null = null;
  private roadMesh: Mesh | null = null;
  private roadLanes: LineSegments | null = null;
  /** Highway flow arrows + stop signs — rebuilt with the road mesh. */
  private roadOrnaments: Group | null = null;
  /** Upper-layer (Bridge Mode) road mesh — rebuilt with the ground roads. */
  private bridgeRoadMesh: Group | null = null;
  /** Trees mesh — merged variant geometry per forest tile (Alpha 2.2). */
  private treesMesh: Mesh | null = null;
  /** Merged buildings geometry (Alpha 2.1 — variant-driven). */
  private buildingsMesh: Mesh | null = null;
  /** In-flight incremental zoned-buildings rebuild (Beta 1.9). Null when idle.
   *  The autonomous sim loop builds via this so a large city never freezes on
   *  a full mesh rebuild; the current mesh stays visible until the job swaps. */
  private bJob: {
    grid: Grid; tiles: Tile[]; i: number;
    geoms: BufferGeometry[]; colours: number[];
    moodBase: number; months: number;
  } | null = null;
  /** A rebuild requested while another is mid-flight — applied when it finishes
   *  (so continuous development doesn't restart the job forever, never updating). */
  private bPending: { grid: Grid; cityMood: number; months: number } | null = null;
  /** One Group containing per-kind city building Mesh objects. Rebuilt on change. */
  private readonly cityBuildingsGroup = new Group();
  private heatmapMesh: Mesh | null = null;
  /** Day/night cycle (Alpha 2.14) — mutated by applyTimeOfDay each frame. */
  private skyTexture!: CanvasTexture;
  /** Beta 1.7 — last warped day-phase the sky CanvasTexture was painted
   *  at. NaN forces a repaint (init + theme change). Gates the per-frame
   *  sky repaint so it only re-uploads when the gradient visibly moves. */
  private lastSkyPhase = NaN;
  private ambientLight!: AmbientLight;
  private hemisphereLight!: HemisphereLight;
  private sunLight!: DirectionalLight;
  private carsMesh: InstancedMesh;
  /** Vehicle window/light overlays (Alpha 4.4). Sibling InstancedMeshes
   *  that mirror their parent's per-instance matrix every frame —
   *  fixed-colour materials so the per-instance body tint doesn't
   *  wash out window glass / headlights / taillights. */
  private carWindowsMesh!: InstancedMesh;
  private carHeadlightsMesh!: InstancedMesh;
  private carTaillightsMesh!: InstancedMesh;
  /** Police-car accessory overlay (Alpha 4.15.2). Light bar + black
   *  side stripe baked in. Only police-kind cars (patrol, motorcade
   *  lead/tail) get an instance — the mesh's `count` is set per-frame
   *  to match. Vertex-coloured so the bar/blue-dome/red-dome render
   *  in their fixed colours regardless of body tint. */
  private policeAccessoriesMesh!: InstancedMesh;
  /** Fire-truck accessory overlay (Alpha 4.15.2). Yellow ladder running
   *  lengthwise on top + red light bar in front. Only `fire_response`
   *  cars get an instance. Plus the per-instance body matrix is scaled
   *  up (taller, longer) so fire trucks visibly read as trucks vs
   *  sedans. */
  private fireAccessoriesMesh!: InstancedMesh;
  /** Transport-truck meshes (Beta 1.5). Trucks share the per-frame
   *  segment-following loop with cars but render through their own
   *  InstancedMeshes because their silhouette is fundamentally bigger
   *  (semi-truck: dark chassis + light cab + cargo box + windshield +
   *  headlights + taillights). Four sibling meshes: body (per-instance
   *  colour for cab+cargo, baked-dark chassis), glass (fixed dark),
   *  headlights (fixed yellow), taillights (fixed red). */
  private truckBodyMesh!: InstancedMesh;
  private truckGlassMesh!: InstancedMesh;
  private truckHeadlightsMesh!: InstancedMesh;
  private truckTaillightsMesh!: InstancedMesh;
  /** Farm tractor mesh (Alpha 4.19). One animated tractor per farm
   *  cluster ≥ FARM_TRACTOR_MIN_CLUSTER tiles. Chassis + cabin +
   *  exhaust + 4 wheels + headlights + rear hitch baked into the
   *  body geometry. Per-instance colour tint (red default). Sibling
   *  windows mesh for the cabin glass. Animated via
   *  `updateTractors(dt)` along a per-cluster snake path. */
  private tractorsMesh!: InstancedMesh;
  private tractorWindowsMesh!: InstancedMesh;
  /** Cluster registry for the active tractors. Rebuilt whenever
   *  `drawCityBuildings` runs (placement / bulldoze events). Each
   *  entry stores the sorted snake path + position accumulator so
   *  the animation is stateful across frames. */
  private farmClusters: Array<{
    path: Array<{ x: number; y: number }>;
    progress: number;   // position along path, [0, path.length)
  }> = [];
  /** Animated stadium players (Beta 1.10.x). One InstancedMesh of tiny
   *  jersey-coloured figures that run around the pitch of every Grand
   *  Stadium AT NIGHT (when the floodlights are on). Registry = one entry
   *  per stadium with its field centre + pitch radii; `updateStadiumPlayers`
   *  advances a shared time accumulator each frame. */
  private stadiumPlayersMesh!: InstancedMesh;
  private stadiumFields: Array<{ cx: number; cz: number; fx: number; fz: number; elev: number }> = [];
  private stadiumPlayerT = 0;
  private busesMesh: InstancedMesh;
  private busWindowsMesh!: InstancedMesh;
  private busHeadlightsMesh!: InstancedMesh;
  private ferriesMesh!: InstancedMesh;
  private pedestriansMesh: InstancedMesh;
  /** Shopper bodies / heads (Beta 1.3.4 — Phase 2.1). Visible while a
   *  parked-car shopper is on the outbound or return leg between the
   *  stall and the destination tile. Hidden during the "shopping"
   *  phase (inside the store). Same humanoid geometry as pedestrians;
   *  separate InstancedMesh so the count tallies are independent. */
  private shopperBodiesMesh!: InstancedMesh;
  private shopperHeadsMesh!: InstancedMesh;
  /** Sibling head mesh for pedestrians (Alpha 3.2.2). Its matrices are
   *  kept identical to pedestriansMesh; the head + hair geometry sits
   *  above the body via baked-in y offsets. Separate material so skin
   *  tone is independent of per-instance clothing colour. */
  private pedestriansHeadsMesh!: InstancedMesh;
  private selectionMesh: Mesh;
  // Reusable scratch objects for per-frame car updates — avoid GC churn.
  private readonly tmpObj = new Object3D();
  private readonly tmpColor = new Color();

  constructor(canvas: HTMLCanvasElement) {
    this.three = new WebGLRenderer({
      canvas,
      antialias: true,
      // Cap DPR at 2 — beyond that mobile fragment shading explodes for no
      // visual gain at the chunky aesthetic we're going for.
      powerPreference: 'high-performance'
    });
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.three.setClearColor(THEME().terrain.clearColor);

    this.scene.add(this.worldGroup);
    this.worldGroup.add(this.cityBuildingsGroup);
    // Sky gradient (Alpha 2.6 visual pass) — vertical gradient texture so
    // the canvas backdrop reads as sky instead of a flat dark colour.
    // Three.js doesn't support a true vertical gradient on Scene.background
    // directly, but a 1×N CanvasTexture works perfectly and is essentially
    // free at runtime (one tiny upload at init, no per-frame cost).
    // Sky gradient is a 1×N CanvasTexture we mutate over the day/night
    // cycle (Alpha 2.14). Stored so applyTimeOfDay() can repaint it.
    this.skyTexture = makeSkyGradient();
    this.scene.background = this.skyTexture;
    // A few stylized clouds far above the world. Static — added to the
    // scene root so they don't pan with worldGroup.
    this.scene.add(makeClouds());
    // Initial light setup — `applyTimeOfDay` re-derives all of this
    // from the active theme's atmosphere on every sim frame.
    const _atm0 = THEME().atmosphere;
    this.ambientLight = new AmbientLight(0xffffff, _atm0.ambientIntensityDay);
    this.scene.add(this.ambientLight);
    this.hemisphereLight = new HemisphereLight(_atm0.hemiSkyDay, _atm0.hemiGroundDay, 0.45);
    this.scene.add(this.hemisphereLight);
    this.sunLight = new DirectionalLight(_atm0.sunColorNoon, _atm0.sunIntensityDay);
    this.sunLight.position.set(40, 80, 30);
    this.scene.add(this.sunLight);
    // The directional light needs a target object in the scene to aim at;
    // updateSunShadow re-points it at the camera target each frame so the
    // shadow frustum tracks the player's view.
    this.scene.add(this.sunLight.target);
    // Real shadow maps (Beta 1.9 "looks" pass). Gated on the same boot-time
    // FX flag as post-processing, so `?fx=0` is BOTH the exact pre-1.9 look
    // and the guaranteed WebGL2 fallback. Three compiles shadow support into
    // the materials only when shadowMap.enabled is set at construction, so
    // shadows are boot-decided (the runtime setFxEnabled toggle drives
    // post-processing alone).
    this.shadowsActive = this.fxEnabled;
    if (this.shadowsActive) {
      this.three.shadowMap.enabled = true;
      this.three.shadowMap.type = PCFSoftShadowMap;
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(2048, 2048);
      // Constant depth bias only — our flat-shaded meshes carry no normal
      // attribute (Alpha 2.6 perf pass) for normalBias to offset along.
      // Tuned to kill acne on big ground faces without peter-panning the
      // chunky low-poly buildings off their footprints.
      this.sunLight.shadow.bias = -0.0006;
      // Frustum bounds + a TIGHT near/far are derived per-frame from the zoom
      // in updateSunShadow (tight range = the depth precision this small world
      // needs). Nothing to set here.
    }
    // Optional fog — gentle Mediterranean haze on Coastal Pastel,
    // none on Stock. Exponential falloff so distant tiles soften
    // toward the theme's fog colour without a hard cutoff.
    if (_atm0.fog) {
      this.scene.fog = new FogExp2(_atm0.fog.color, _atm0.fog.density);
    }

    // Selection square — a wireframe plane that we move to the picked tile.
    const sel = new Mesh(
      new PlaneGeometry(TILE_SIZE * 1.02, TILE_SIZE * 1.02).rotateX(-Math.PI / 2),
      new MeshLambertMaterial({
        color: SELECTION_COLOR,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: DoubleSide
      })
    );
    sel.visible = false;
    sel.position.y = ROAD_LIFT * 1.5;
    const outline = new LineSegments(
      new EdgesGeometry(new PlaneGeometry(TILE_SIZE * 1.02, TILE_SIZE * 1.02).rotateX(-Math.PI / 2)),
      new LineBasicMaterial({ color: SELECTION_COLOR })
    );
    sel.add(outline);
    this.scene.add(sel);
    this.selectionMesh = sel;

    // Cars: a fixed-capacity InstancedMesh that we reuse, varying its
    // `count` to match active cars. Per-instance colour + matrix updated
    // each render frame in `updateCars`.
    // Car silhouette (Alpha 2.1) — chassis + cabin merged into one
    // geometry so each instance reads as a recognisable sedan rather than
    // a flat slab. Per-instance color (set in updateCars) tints the whole
    // body uniformly; that's the right look for low-poly cars.
    const chassis = new BoxGeometry(0.20, 0.07, 0.34);
    chassis.translate(0, 0.035, 0);
    const cabin = new BoxGeometry(0.16, 0.07, 0.18);
    cabin.translate(0, 0.07 + 0.035, -0.02);
    const carGeom = mergeGeoms([chassis, cabin], [0xffffff, 0xffffff]);
    // vertexColors: false so the merged white vertex colours don't fight
    // the per-instance color tint set by updateCars.
    const carMat = new MeshLambertMaterial({ flatShading: true });
    // InstancedMesh capacity (Alpha 4.14) — covers resident cars +
    // tourists (above the resident cap) + emergency vehicles + the
    // 3-car motorcade convoy. Total ~325. Capacity is a fixed
    // allocation; per-frame `count` is what controls actual draw count.
    const CAR_CAPACITY = MAX_VEHICLES + MAX_TOURIST_VEHICLES + MAX_SERVICE_VEHICLES + 3;
    this.carsMesh = new InstancedMesh(carGeom, carMat, CAR_CAPACITY);
    this.carsMesh.count = 0;
    this.carsMesh.frustumCulled = false;
    this.worldGroup.add(this.carsMesh);
    // Car windows (Alpha 4.4) — sibling InstancedMesh that mirrors the
    // body's per-instance matrix. Fixed dark-tint material so windows
    // don't pick up the car's body colour. Two thin slabs: a flat
    // windshield strip on top of the cabin face and a side-window strip
    // along the cabin's flanks.
    const winRect = new BoxGeometry(0.10, 0.05, 0.005);
    winRect.translate(0, 0.10 + 0.035, -0.02 + 0.09);
    // Side windows (Alpha 4.4.1 fix) — cabin body spans y=0.07 to
    // y=0.14. Pre-fix these were centred at y=0.14 (cabin's TOP) so
    // their top edge sat at y=0.1625 — ~22mm above the roof, read as
    // floating slabs hovering over the car. Re-centre at y=0.115 so
    // the glass sits inside the cabin face (top y=0.1375, bottom
    // y=0.0925) with a slim ~5mm of cabin showing above like a real
    // car's roofline.
    const sideWinL = new BoxGeometry(0.005, 0.045, 0.14);
    sideWinL.translate(-0.080, 0.115, -0.02);
    const sideWinR = new BoxGeometry(0.005, 0.045, 0.14);
    sideWinR.translate(0.080, 0.115, -0.02);
    const carWindowsGeom = mergeGeoms([winRect, sideWinL, sideWinR], [0xffffff, 0xffffff, 0xffffff]);
    const carWindowsMat = new MeshBasicMaterial({ color: THEME().vehicles.windows });
    this.carWindowsMesh = new InstancedMesh(carWindowsGeom, carWindowsMat, CAR_CAPACITY);
    this.carWindowsMesh.count = 0;
    this.carWindowsMesh.frustumCulled = false;
    this.worldGroup.add(this.carWindowsMesh);
    // Headlights — two small bright dots on the front face.
    // Local front is -Z (forward-facing geometry was built with cabin
    // pulled back at z=-0.02, so the chassis front is at z = +0.17).
    const hlL = new BoxGeometry(0.030, 0.020, 0.012);
    hlL.translate(-0.066, 0.040, 0.170);
    const hlR = new BoxGeometry(0.030, 0.020, 0.012);
    hlR.translate(0.066, 0.040, 0.170);
    const carHeadlightsGeom = mergeGeoms([hlL, hlR], [0xffffff, 0xffffff]);
    const carHeadlightsMat = new MeshBasicMaterial({ color: THEME().vehicles.headlights });
    this.carHeadlightsMesh = new InstancedMesh(carHeadlightsGeom, carHeadlightsMat, CAR_CAPACITY);
    this.carHeadlightsMesh.count = 0;
    this.carHeadlightsMesh.frustumCulled = false;
    this.worldGroup.add(this.carHeadlightsMesh);
    // Taillights — two small red dots on the rear face (z = -0.17).
    const tlL = new BoxGeometry(0.024, 0.018, 0.010);
    tlL.translate(-0.066, 0.040, -0.170);
    const tlR = new BoxGeometry(0.024, 0.018, 0.010);
    tlR.translate(0.066, 0.040, -0.170);
    const carTailGeom = mergeGeoms([tlL, tlR], [0xffffff, 0xffffff]);
    const carTailMat = new MeshBasicMaterial({ color: THEME().vehicles.taillights });
    this.carTaillightsMesh = new InstancedMesh(carTailGeom, carTailMat, CAR_CAPACITY);
    this.carTaillightsMesh.count = 0;
    this.carTaillightsMesh.frustumCulled = false;
    this.worldGroup.add(this.carTaillightsMesh);

    // Police-car accessory overlay (Alpha 4.15.2). Cabin top is at
    // y ≈ 0.14 (cabin body 0.07 thick centred at y = 0.105). The light
    // bar sits on top — black base + flanking blue (left) + red (right)
    // dome lights so the car reads instantly as a police cruiser. Plus
    // a thin black side stripe along each flank for the "Crown Vic"
    // silhouette.
    {
      const POLICE_BAR = 0x101418;
      const POLICE_BLUE = 0x2c6df0;
      const POLICE_RED = 0xe22d2d;
      const POLICE_STRIPE = 0x0a1014;
      // Light-bar base — flat dark slab spanning the cabin width.
      const barBase = new BoxGeometry(0.13, 0.020, 0.060);
      barBase.translate(0, 0.155, -0.020);
      // Blue dome light (left side of bar).
      const blueDome = new BoxGeometry(0.045, 0.030, 0.040);
      blueDome.translate(-0.035, 0.180, -0.020);
      // Red dome light (right side of bar).
      const redDome = new BoxGeometry(0.045, 0.030, 0.040);
      redDome.translate(0.035, 0.180, -0.020);
      // Centre divider so the colours read as distinct domes, not one bar.
      const barCentre = new BoxGeometry(0.012, 0.030, 0.040);
      barCentre.translate(0, 0.180, -0.020);
      // Side stripes — thin black box just below the windows on each
      // flank, classic police cruiser visual.
      const stripeL = new BoxGeometry(0.005, 0.015, 0.30);
      stripeL.translate(-0.103, 0.080, 0);
      const stripeR = new BoxGeometry(0.005, 0.015, 0.30);
      stripeR.translate(0.103, 0.080, 0);
      // Front + rear black bumper trim for extra silhouette read.
      const bumperF = new BoxGeometry(0.20, 0.018, 0.020);
      bumperF.translate(0, 0.018, 0.170);
      const bumperR = new BoxGeometry(0.20, 0.018, 0.020);
      bumperR.translate(0, 0.018, -0.170);
      const policeGeom = mergeGeoms(
        [barBase, blueDome, redDome, barCentre, stripeL, stripeR, bumperF, bumperR],
        [POLICE_BAR, POLICE_BLUE, POLICE_RED, POLICE_BAR, POLICE_STRIPE, POLICE_STRIPE, POLICE_STRIPE, POLICE_STRIPE]
      );
      // vertexColors true so the bar/blue/red colours come from the
      // baked-in vertex attributes; no per-instance tint applied.
      const policeMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
      // Cap = max patrol cars (60% of MAX_SERVICE_VEHICLES) + 2 motorcade
      // escorts. Round generously to handle worst-case spawn timing.
      const POLICE_CAPACITY = MAX_SERVICE_VEHICLES + 4;
      this.policeAccessoriesMesh = new InstancedMesh(policeGeom, policeMat, POLICE_CAPACITY);
      this.policeAccessoriesMesh.count = 0;
      this.policeAccessoriesMesh.frustumCulled = false;
      this.worldGroup.add(this.policeAccessoriesMesh);
    }

    // Fire-truck accessory overlay (Alpha 4.15.2). Yellow ladder running
    // lengthwise on top of the cabin + red light bar in front + chrome
    // grille bumper. Plus the per-instance body matrix is scaled UP for
    // fire instances so the truck visibly reads as a truck, not a sedan
    // — see updateCars below. The accessory mesh inherits the same
    // matrix so the ladder + bar scale with the body.
    {
      const FIRE_LADDER = 0xe9c84a;       // golden yellow extension ladder
      const FIRE_LADDER_RAIL = 0xb8964a;  // darker rail tone for contrast
      const FIRE_LIGHT_RED = 0xff4040;    // bright red light bar
      const FIRE_CHROME = 0xc8c8d0;       // chrome grille / bumper
      const FIRE_WHITE = 0xf0eeea;        // white side stripe
      // Ladder — long thin box with a row of perpendicular rungs.
      const ladderRailL = new BoxGeometry(0.014, 0.014, 0.42);
      ladderRailL.translate(-0.035, 0.180, 0);
      const ladderRailR = new BoxGeometry(0.014, 0.014, 0.42);
      ladderRailR.translate(0.035, 0.180, 0);
      // 6 rungs across the ladder length.
      const rungs: BoxGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const rung = new BoxGeometry(0.075, 0.008, 0.012);
        rung.translate(0, 0.180, -0.18 + i * 0.072);
        rungs.push(rung);
      }
      // Light bar on top, in front of the ladder.
      const fireBar = new BoxGeometry(0.10, 0.020, 0.045);
      fireBar.translate(0, 0.155, 0.10);
      const fireDomeL = new BoxGeometry(0.030, 0.025, 0.030);
      fireDomeL.translate(-0.030, 0.180, 0.10);
      const fireDomeR = new BoxGeometry(0.030, 0.025, 0.030);
      fireDomeR.translate(0.030, 0.180, 0.10);
      // White side stripes (classic fire truck reflective stripes).
      const fireStripeL = new BoxGeometry(0.005, 0.020, 0.32);
      fireStripeL.translate(-0.103, 0.060, 0);
      const fireStripeR = new BoxGeometry(0.005, 0.020, 0.32);
      fireStripeR.translate(0.103, 0.060, 0);
      // Chrome front grille / bumper.
      const grille = new BoxGeometry(0.18, 0.030, 0.012);
      grille.translate(0, 0.045, 0.175);
      const bumper = new BoxGeometry(0.22, 0.020, 0.025);
      bumper.translate(0, 0.020, 0.170);
      // (Tank removed — was clipping with the ladder above the rear
      // deck. The ladder + light bar + grille + reflective stripes
      // already read clearly as a fire truck.)
      const allGeoms: BufferGeometry[] = [
        ladderRailL, ladderRailR, ...rungs,
        fireBar, fireDomeL, fireDomeR,
        fireStripeL, fireStripeR,
        grille, bumper
      ];
      const allColors: number[] = [
        FIRE_LADDER, FIRE_LADDER, ...rungs.map(() => FIRE_LADDER_RAIL),
        FIRE_LIGHT_RED, FIRE_LIGHT_RED, FIRE_LIGHT_RED,
        FIRE_WHITE, FIRE_WHITE,
        FIRE_CHROME, FIRE_CHROME
      ];
      const fireGeom = mergeGeoms(allGeoms, allColors);
      const fireMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
      // Cap = max fire trucks (40% of MAX_SERVICE_VEHICLES). Round generously.
      const FIRE_CAPACITY = MAX_SERVICE_VEHICLES;
      this.fireAccessoriesMesh = new InstancedMesh(fireGeom, fireMat, FIRE_CAPACITY);
      this.fireAccessoriesMesh.count = 0;
      this.fireAccessoriesMesh.frustumCulled = false;
      this.worldGroup.add(this.fireAccessoriesMesh);
    }

    // Transport trucks (Beta 1.5). Semi-truck silhouette = dark chassis
    // (full-length base frame) + light-coloured cab (front) + light-
    // coloured cargo box (rear, slightly taller). Layout in local frame
    // matches the car convention: +Z is forward, headlights at cab
    // front, taillights at cargo box rear. The cab + cargo box have
    // vertex color WHITE so per-instance color tints them; the chassis
    // is baked as DARK GREY in the vertex color stream so the per-
    // instance color tints it minimally (white × 0.15 = 0.15) — the
    // frame stays dark regardless of truck fleet colour.
    {
      const TRUCK_CHASSIS = 0x2a2a2a;        // dark grey frame
      const TRUCK_LIGHT = 0xffffff;          // cab + cargo (per-instance tint)
      // Chassis: full-length base frame.
      const truckChassis = new BoxGeometry(0.22, 0.04, 0.50);
      truckChassis.translate(0, 0.020, 0);
      // Cab: 0.16 long, sits front (z>0), starts at z=0.09, ends z=0.25.
      const truckCab = new BoxGeometry(0.22, 0.10, 0.16);
      truckCab.translate(0, 0.040 + 0.050, 0.170);
      // Cargo box: 0.28 long, sits rear (z<0). Slightly TALLER than cab
      // for a real box-truck silhouette (cab ends y=0.14, cargo
      // ends y=0.19).
      const truckCargo = new BoxGeometry(0.22, 0.15, 0.28);
      truckCargo.translate(0, 0.040 + 0.075, -0.090);
      // Small cab-to-cargo step is the 0.04 gap from z=0.05 (cargo
      // front) to z=0.09 (cab back) — left as chassis frame only.
      const truckBodyGeom = mergeGeoms(
        [truckChassis, truckCab, truckCargo],
        [TRUCK_CHASSIS, TRUCK_LIGHT, TRUCK_LIGHT]
      );
      // Material: vertexColors true so the chassis grey + cab/cargo
      // white are read from the vertex stream; per-instance color
      // multiplies onto each (chassis stays dark because 0.15 × any
      // tint is still dark).
      const truckBodyMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
      this.truckBodyMesh = new InstancedMesh(truckBodyGeom, truckBodyMat, MAX_TRUCKS);
      this.truckBodyMesh.count = 0;
      this.truckBodyMesh.frustumCulled = false;
      this.worldGroup.add(this.truckBodyMesh);
      // Glass: dark windshield on the cab front face + side windows
      // along the cab flanks (matches the car windows convention).
      const truckWindshield = new BoxGeometry(0.18, 0.06, 0.005);
      truckWindshield.translate(0, 0.115, 0.25 - 0.003);
      const truckSideWinL = new BoxGeometry(0.005, 0.05, 0.13);
      truckSideWinL.translate(-0.110, 0.110, 0.170);
      const truckSideWinR = new BoxGeometry(0.005, 0.05, 0.13);
      truckSideWinR.translate(0.110, 0.110, 0.170);
      const truckGlassGeom = mergeGeoms(
        [truckWindshield, truckSideWinL, truckSideWinR],
        [0xffffff, 0xffffff, 0xffffff]
      );
      const truckGlassMat = new MeshBasicMaterial({ color: THEME().vehicles.windows });
      this.truckGlassMesh = new InstancedMesh(truckGlassGeom, truckGlassMat, MAX_TRUCKS);
      this.truckGlassMesh.count = 0;
      this.truckGlassMesh.frustumCulled = false;
      this.worldGroup.add(this.truckGlassMesh);
      // Headlights — two bright dots low on the cab front face.
      const truckHlL = new BoxGeometry(0.030, 0.020, 0.012);
      truckHlL.translate(-0.072, 0.060, 0.252);
      const truckHlR = new BoxGeometry(0.030, 0.020, 0.012);
      truckHlR.translate(0.072, 0.060, 0.252);
      const truckHlGeom = mergeGeoms([truckHlL, truckHlR], [0xffffff, 0xffffff]);
      const truckHlMat = new MeshBasicMaterial({ color: THEME().vehicles.headlights });
      this.truckHeadlightsMesh = new InstancedMesh(truckHlGeom, truckHlMat, MAX_TRUCKS);
      this.truckHeadlightsMesh.count = 0;
      this.truckHeadlightsMesh.frustumCulled = false;
      this.worldGroup.add(this.truckHeadlightsMesh);
      // Taillights — two red dots on the cargo box rear face (z = -0.23).
      const truckTlL = new BoxGeometry(0.028, 0.020, 0.010);
      truckTlL.translate(-0.075, 0.080, -0.232);
      const truckTlR = new BoxGeometry(0.028, 0.020, 0.010);
      truckTlR.translate(0.075, 0.080, -0.232);
      const truckTlGeom = mergeGeoms([truckTlL, truckTlR], [0xffffff, 0xffffff]);
      const truckTlMat = new MeshBasicMaterial({ color: THEME().vehicles.taillights });
      this.truckTaillightsMesh = new InstancedMesh(truckTlGeom, truckTlMat, MAX_TRUCKS);
      this.truckTaillightsMesh.count = 0;
      this.truckTaillightsMesh.frustumCulled = false;
      this.worldGroup.add(this.truckTaillightsMesh);
    }

    // Farm tractor (Alpha 4.19). One detailed tractor per large farm
    // cluster: chassis + cabin + roof + hood + exhaust stack + 4
    // wheels (2 small front + 2 big rear) + headlights + rear hitch.
    // Per-instance colour tint paints the body red by default. The
    // local +Z is the tractor's forward direction; its yaw is set
    // per-frame in `updateTractors` from the path-tangent vector.
    {
      const TRACTOR_RED = 0xffffff;       // body geometry stays white; tint applied per-instance
      const TRACTOR_DARK = 0x2a2a2a;      // wheels, exhaust, hitch
      const TRACTOR_HEADLIGHT = 0xfff4c0;
      const TRACTOR_HOOD = 0xc8c8c8;      // chrome accents
      // Chassis — main red body box. Forward face at +Z (engine side).
      const chassis = new BoxGeometry(0.16, 0.045, 0.30);
      chassis.translate(0, 0.075, 0);
      // Hood — narrower lower front section (engine compartment).
      const hood = new BoxGeometry(0.12, 0.060, 0.13);
      hood.translate(0, 0.065, 0.115);
      // Cabin — taller box behind the hood.
      const cabin = new BoxGeometry(0.14, 0.085, 0.13);
      cabin.translate(0, 0.140, -0.07);
      // Cabin roof — slightly wider flat slab on top so the cabin reads as boxy.
      const roof = new BoxGeometry(0.18, 0.015, 0.16);
      roof.translate(0, 0.190, -0.07);
      // Exhaust stack — vertical chrome pipe on the left of the hood.
      const exhaust = new CylinderGeometry(0.014, 0.014, 0.16, 6);
      exhaust.translate(-0.060, 0.180, 0.090);
      // Small front wheels — left + right. Axis horizontal (rotateZ).
      const wheelFL = new CylinderGeometry(0.040, 0.040, 0.022, 12);
      wheelFL.rotateZ(Math.PI / 2);
      wheelFL.translate(-0.080, 0.040, 0.110);
      const wheelFR = new CylinderGeometry(0.040, 0.040, 0.022, 12);
      wheelFR.rotateZ(Math.PI / 2);
      wheelFR.translate(0.080, 0.040, 0.110);
      // Big rear wheels — significantly larger than fronts (the
      // classic farm-tractor silhouette).
      const wheelRL = new CylinderGeometry(0.075, 0.075, 0.030, 14);
      wheelRL.rotateZ(Math.PI / 2);
      wheelRL.translate(-0.090, 0.075, -0.110);
      const wheelRR = new CylinderGeometry(0.075, 0.075, 0.030, 14);
      wheelRR.rotateZ(Math.PI / 2);
      wheelRR.translate(0.090, 0.075, -0.110);
      // Two headlights on the front face of the hood.
      const headlightL = new BoxGeometry(0.022, 0.022, 0.008);
      headlightL.translate(-0.040, 0.075, 0.180);
      const headlightR = new BoxGeometry(0.022, 0.022, 0.008);
      headlightR.translate(0.040, 0.075, 0.180);
      // Rear hitch / 3-point linkage stub at the back.
      const hitch = new BoxGeometry(0.045, 0.025, 0.040);
      hitch.translate(0, 0.060, -0.170);
      const tractorGeom = mergeGeoms(
        [chassis, hood, cabin, roof, exhaust, wheelFL, wheelFR, wheelRL, wheelRR, headlightL, headlightR, hitch],
        [
          TRACTOR_RED, TRACTOR_RED, TRACTOR_RED, TRACTOR_HOOD,
          TRACTOR_DARK,
          TRACTOR_DARK, TRACTOR_DARK, TRACTOR_DARK, TRACTOR_DARK,
          TRACTOR_HEADLIGHT, TRACTOR_HEADLIGHT,
          TRACTOR_DARK
        ]
      );
      // vertexColors: true so the wheel/exhaust/headlight colours come
      // from vertex attributes; per-instance tint colours the red body.
      const tractorMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
      this.tractorsMesh = new InstancedMesh(tractorGeom, tractorMat, MAX_TRACTORS);
      this.tractorsMesh.count = 0;
      this.tractorsMesh.frustumCulled = false;
      this.worldGroup.add(this.tractorsMesh);
      // Cabin windows — sibling mesh with dark-tint material, mirrors
      // the body matrix per frame. Front + back + 2 sides.
      const winFront = new BoxGeometry(0.10, 0.060, 0.005);
      winFront.translate(0, 0.150, -0.005);
      const winBack = new BoxGeometry(0.10, 0.060, 0.005);
      winBack.translate(0, 0.150, -0.135);
      const winSideL = new BoxGeometry(0.005, 0.060, 0.10);
      winSideL.translate(-0.070, 0.150, -0.070);
      const winSideR = new BoxGeometry(0.005, 0.060, 0.10);
      winSideR.translate(0.070, 0.150, -0.070);
      const winGeom = mergeGeoms(
        [winFront, winBack, winSideL, winSideR],
        [0xffffff, 0xffffff, 0xffffff, 0xffffff]
      );
      const winMat = new MeshBasicMaterial({ color: THEME().vehicles.windows });
      this.tractorWindowsMesh = new InstancedMesh(winGeom, winMat, MAX_TRACTORS);
      this.tractorWindowsMesh.count = 0;
      this.tractorWindowsMesh.frustumCulled = false;
      this.worldGroup.add(this.tractorWindowsMesh);
    }

    // Stadium players (Beta 1.10.x) — tiny humanoid figures that run around
    // the pitch of a Grand Stadium at night. One merged white geometry
    // (body + head + 2 legs); per-instance colour paints the jersey. The
    // local +Z is forward; yaw is set per-frame in updateStadiumPlayers.
    {
      const pBody = new BoxGeometry(0.035, 0.06, 0.025); pBody.translate(0, 0.045, 0);
      const pHead = new BoxGeometry(0.028, 0.028, 0.028); pHead.translate(0, 0.090, 0);
      const pLegL = new BoxGeometry(0.012, 0.03, 0.012); pLegL.translate(-0.010, 0.015, 0);
      const pLegR = new BoxGeometry(0.012, 0.03, 0.012); pLegR.translate(0.010, 0.015, 0);
      const playerGeom = mergeGeoms(
        [pBody, pHead, pLegL, pLegR],
        [0xffffff, 0xffffff, 0xffffff, 0xffffff]
      );
      // Unlit (MeshBasicMaterial) so the jerseys read at full brightness
      // against the floodlit pitch — players only ever render at night.
      const playerMat = new MeshBasicMaterial({ vertexColors: true });
      this.stadiumPlayersMesh = new InstancedMesh(playerGeom, playerMat, MAX_STADIUM_PLAYERS);
      this.stadiumPlayersMesh.count = 0;
      this.stadiumPlayersMesh.frustumCulled = false;
      this.worldGroup.add(this.stadiumPlayersMesh);
    }

    // Buses — bigger silhouette so they read as transit, separate from cars.
    // Bus silhouette (Alpha 2.1) — chunky body with a slight cab notch
    // and a low roofline, so it reads as a transit bus rather than a slab.
    const busBody = new BoxGeometry(0.24, 0.15, 0.55);
    busBody.translate(0, 0.075, 0);
    const busRoof = new BoxGeometry(0.20, 0.025, 0.50);
    busRoof.translate(0, 0.16, 0);
    const busGeom = mergeGeoms([busBody, busRoof], [0xffffff, 0xffffff]);
    const busMat = new MeshLambertMaterial({ flatShading: true });
    this.busesMesh = new InstancedMesh(busGeom, busMat, 16);
    this.busesMesh.count = 0;
    this.busesMesh.frustumCulled = false;
    this.worldGroup.add(this.busesMesh);
    // Bus windows (Alpha 4.4) — long row of dark-tinted side windows +
    // a front windshield. Same shared-matrix pattern as cars.
    const busWinL = new BoxGeometry(0.005, 0.070, 0.42);
    busWinL.translate(-0.122, 0.110, 0);
    const busWinR = new BoxGeometry(0.005, 0.070, 0.42);
    busWinR.translate(0.122, 0.110, 0);
    const busWindshield = new BoxGeometry(0.14, 0.065, 0.005);
    busWindshield.translate(0, 0.110, 0.277);
    const busWindowsGeom = mergeGeoms([busWinL, busWinR, busWindshield], [0xffffff, 0xffffff, 0xffffff]);
    const busWindowsMat = new MeshBasicMaterial({ color: THEME().vehicles.windows });
    this.busWindowsMesh = new InstancedMesh(busWindowsGeom, busWindowsMat, 16);
    this.busWindowsMesh.count = 0;
    this.busWindowsMesh.frustumCulled = false;
    this.worldGroup.add(this.busWindowsMesh);
    // Bus headlights — two on the front, slightly larger than car
    // headlights because buses are bigger.
    const bhlL = new BoxGeometry(0.040, 0.030, 0.012);
    bhlL.translate(-0.085, 0.060, 0.277);
    const bhlR = new BoxGeometry(0.040, 0.030, 0.012);
    bhlR.translate(0.085, 0.060, 0.277);
    const busHeadlightsGeom = mergeGeoms([bhlL, bhlR], [0xffffff, 0xffffff]);
    const busHeadlightsMat = new MeshBasicMaterial({ color: THEME().vehicles.headlights });
    this.busHeadlightsMesh = new InstancedMesh(busHeadlightsGeom, busHeadlightsMat, 16);
    this.busHeadlightsMesh.count = 0;
    this.busHeadlightsMesh.frustumCulled = false;
    this.worldGroup.add(this.busHeadlightsMesh);

    // Pedestrians (Alpha 3.2.2): small humanoid silhouette built from
    // two legs + a torso + arms, sitting under a separate head mesh
    // with a fixed skin-tone material. Two instanced meshes per frame
    // (body + head) — still cheap, but reads as people instead of
    // pawns. Per-instance colour on the body tints the clothing;
    // the head keeps a uniform skin tone across the population.
    const legL = new BoxGeometry(0.022, 0.06, 0.022);
    legL.translate(-0.020, 0.030, 0);
    const legR = new BoxGeometry(0.022, 0.06, 0.022);
    legR.translate(0.020, 0.030, 0);
    const torso = new BoxGeometry(0.070, 0.075, 0.045);
    torso.translate(0, 0.060 + 0.0375, 0);
    // Slim arms hang at the torso's sides.
    const armL = new BoxGeometry(0.018, 0.070, 0.020);
    armL.translate(-0.045, 0.075, 0);
    const armR = new BoxGeometry(0.018, 0.070, 0.020);
    armR.translate(0.045, 0.075, 0);
    // Body parts merge into one geometry that takes per-instance colour.
    const bodyGeom = mergeGeoms(
      [legL, legR, torso, armL, armR],
      // Legs slightly darker than the rest (reads as pants); torso +
      // arms tint to the per-instance clothing colour. Arms are a hair
      // duller than the torso for subtle definition without being noisy.
      [0xffffff * 0.55, 0xffffff * 0.55, 0xffffff, 0xffffff * 0.85, 0xffffff * 0.85]
    );
    const pedMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.pedestriansMesh = new InstancedMesh(bodyGeom, pedMat, MAX_PEDESTRIANS);
    this.pedestriansMesh.count = 0;
    this.pedestriansMesh.frustumCulled = false;
    this.worldGroup.add(this.pedestriansMesh);

    // Heads — separate mesh so the skin tone is independent of the
    // clothing colour. Single warm beige material, no per-instance tint.
    const headGeom = new BoxGeometry(0.050, 0.050, 0.045);
    headGeom.translate(0, 0.180, 0);
    // Optional hair tuft on top — slim flat slab a touch wider than the
    // head, in a darker neutral so it reads as hair without picking
    // a single hair-colour for the population.
    const hair = new BoxGeometry(0.052, 0.012, 0.047);
    hair.translate(0, 0.211, 0);
    const headPlusHairGeom = mergeGeoms([headGeom, hair], [0xf2d4b0, 0x3a2618]);
    const headMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.pedestriansHeadsMesh = new InstancedMesh(headPlusHairGeom, headMat, MAX_PEDESTRIANS);
    this.pedestriansHeadsMesh.count = 0;
    this.pedestriansHeadsMesh.frustumCulled = false;
    this.worldGroup.add(this.pedestriansHeadsMesh);

    // Shopper InstancedMeshes (Beta 1.3.4 — Phase 2.1). Reuse the same
    // humanoid geometries built above for pedestrians — same body shape
    // + head + hair tint. Sized at MAX_SHOPPERS capacity. Separate mesh
    // objects so the per-frame count + matrices don't fight with the
    // pedestrian counts.
    const SHOPPER_CAP = 300;  // MAX_SHOPPERS from Shoppers.ts
    this.shopperBodiesMesh = new InstancedMesh(bodyGeom, pedMat, SHOPPER_CAP);
    this.shopperBodiesMesh.count = 0;
    this.shopperBodiesMesh.frustumCulled = false;
    this.worldGroup.add(this.shopperBodiesMesh);
    this.shopperHeadsMesh = new InstancedMesh(headPlusHairGeom, headMat, SHOPPER_CAP);
    this.shopperHeadsMesh.count = 0;
    this.shopperHeadsMesh.frustumCulled = false;
    this.worldGroup.add(this.shopperHeadsMesh);

    // Ferries (Alpha 2.19) — small low-poly boat. Hull below the waterline,
    // cabin above. Same instanced-mesh pattern as cars/buses.
    const hull = new BoxGeometry(0.20, 0.07, 0.40);
    hull.translate(0, 0.03, 0);
    const ferryCabin = new BoxGeometry(0.16, 0.06, 0.18);
    ferryCabin.translate(0, 0.10, -0.04);
    const ferryGeom = mergeGeoms([hull, ferryCabin], [0xfff0d4, 0xb04444]);
    const ferryMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.ferriesMesh = new InstancedMesh(ferryGeom, ferryMat, 8);
    this.ferriesMesh.count = 0;
    this.ferriesMesh.frustumCulled = false;
    this.worldGroup.add(this.ferriesMesh);

  }

  setSize(width: number, height: number): void {
    this.three.setSize(width, height, false);
    this.viewW = width;
    this.viewH = height;
    this.postfx?.setSize(width, height);
  }

  /** Build (or rebuild) the static terrain mesh + tree instances. */
  drawWorld(grid: Grid): void {
    this.disposeMesh(this.terrainMesh);
    this.terrainMesh = buildTerrainMesh(grid);
    this.worldGroup.add(this.terrainMesh);
    this.markShadows(this.terrainMesh, false, true); // ground receives only

    if (this.treesMesh) {
      this.worldGroup.remove(this.treesMesh);
      this.treesMesh.geometry.dispose();
      (this.treesMesh.material as MeshLambertMaterial).dispose?.();
    }
    this.treesMesh = buildTreesMesh(grid);
    if (this.treesMesh) {
      this.worldGroup.add(this.treesMesh);
      this.markShadows(this.treesMesh, true, true);
    }
  }

  /** Rebuild the zone overlay from current tile zones. Also rebuilds
   *  the unowned-land overlay (Alpha 3.1.3) since both are land-state
   *  layers and a typical caller wants them in sync. */
  drawZones(grid: Grid): void {
    if (this.zoneMesh) {
      this.worldGroup.remove(this.zoneMesh);
      this.zoneMesh.geometry.dispose();
      (this.zoneMesh.material as MeshLambertMaterial).dispose();
      this.zoneMesh = null;
    }
    const built = buildZoneMesh(grid);
    if (built) {
      this.zoneMesh = built;
      this.worldGroup.add(this.zoneMesh);
    }
    this.drawUnownedLand(grid);
  }

  /** "For sale" overlay (Alpha 3.1.3): translucent grey on every tile
   *  that's not yet owned. Mesh is rebuilt whenever zones rebuild.
   *  Also rebuilds the four "+" expansion buttons sitting just outside
   *  the city bounds (Alpha 3.2.1). */
  private unownedMesh: Mesh | null = null;
  private expandButtonsGroup: Group | null = null;
  /** World positions of the four "+" buttons, indexed N/E/S/W. Updated
   *  every drawUnownedLand call. Game.handleTap hit-tests against these
   *  to detect a tap on a button. Null entries mean the button isn't
   *  currently rendered (city already at the grid edge in that direction). */
  expandButtonPositions: Record<'N' | 'S' | 'E' | 'W', { x: number; z: number; r: number } | null> = {
    N: null, S: null, E: null, W: null
  };
  drawUnownedLand(grid: Grid): void {
    if (this.unownedMesh) {
      this.worldGroup.remove(this.unownedMesh);
      this.unownedMesh.geometry.dispose();
      (this.unownedMesh.material as MeshLambertMaterial).dispose();
      this.unownedMesh = null;
    }
    if (this.expandButtonsGroup) {
      this.worldGroup.remove(this.expandButtonsGroup);
      for (const child of this.expandButtonsGroup.children) {
        if (child instanceof Mesh) {
          child.geometry.dispose();
          (child.material as MeshBasicMaterial).dispose();
        }
      }
      this.expandButtonsGroup = null;
    }
    const built = buildUnownedLandMesh(grid);
    if (built) {
      this.unownedMesh = built;
      this.worldGroup.add(this.unownedMesh);
    }
    // Build + buttons (Alpha 3.2.3) — one per direction, sitting just
    // PAST the grid edge in world space (not on a tile). Tapping a
    // button grows the grid by EXPANSION_BLOCK_SIZE tiles in that
    // direction. The buttons are intentionally off-grid, sitting over
    // the sky so they're always visible regardless of how tall the
    // edge buildings are.
    this.expandButtonsGroup = new Group();
    if (!this.plusButtonTexture) this.plusButtonTexture = makePlusButtonTexture();
    const directions: Array<'N' | 'S' | 'E' | 'W'> = ['N', 'S', 'E', 'W'];
    const midX = grid.width / 2;
    const midY = grid.height / 2;
    const padding = 2.5; // world units past the grid edge
    for (const dir of directions) {
      this.expandButtonPositions[dir] = null;
      let bx: number, bz: number;
      if (dir === 'N') { bx = midX; bz = -padding; }
      else if (dir === 'S') { bx = midX; bz = grid.height + padding; }
      else if (dir === 'W') { bx = -padding; bz = midY; }
      else { bx = grid.width + padding; bz = midY; }
      const yLift = 0.04;
      const size = 3.0;
      const plane = new PlaneGeometry(size, size);
      plane.rotateX(-Math.PI / 2);
      plane.translate(bx * TILE_SIZE, yLift, bz * TILE_SIZE);
      const mat = new MeshBasicMaterial({
        map: this.plusButtonTexture,
        transparent: true,
        depthWrite: false
      });
      const mesh = new Mesh(plane, mat);
      this.expandButtonsGroup.add(mesh);
      this.expandButtonPositions[dir] = { x: bx, z: bz, r: size * 0.6 };
    }
    if (this.expandButtonsGroup.children.length > 0) {
      this.worldGroup.add(this.expandButtonsGroup);
    }
  }
  /** Lazy-initialised + button glyph texture. */
  private plusButtonTexture: import('three').Texture | null = null;

  /**
   * Rebuild the city-building meshes (power plants, water towers, parks,
   * bus stops, bus depots). Each kind has a distinctive low-poly silhouette.
   * One Group, one Mesh per kind, vertex-coloured so flat shading still
   * gives subtle face shading.
   */
  drawCityBuildings(grid: Grid, forestryHealth = 1.0, farmHealth = 1.0): void {
    // Wipe and recreate. Cheap — even a busy city has a couple dozen.
    while (this.cityBuildingsGroup.children.length > 0) {
      const child = this.cityBuildingsGroup.children[0]!;
      this.cityBuildingsGroup.remove(child);
      if (child instanceof Mesh) {
        child.geometry.dispose();
        const mat = child.material;
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else (mat as MeshLambertMaterial).dispose();
      }
    }
    const built = buildCityBuildingsMesh(grid, forestryHealth, farmHealth);
    if (built) {
      this.cityBuildingsGroup.add(built);
      this.markShadows(built, true, true);
    }
    // Refresh night-lights — park lamps depend on park placements.
    this.drawNightLights(grid);
    // Farm-tractor cluster detection (Alpha 4.19). Cheap one-pass
    // flood-fill that finds farm clusters ≥ FARM_TRACTOR_MIN_CLUSTER
    // tiles and stores a snake-path per cluster for the per-frame
    // tractor animation. Re-runs on every drawCityBuildings (i.e.
    // whenever the player places/bulldozes a farm) so the set stays
    // in sync.
    this.refreshFarmClusters(grid);
    this.refreshStadiumFields(grid);
  }

  /** Detect Grand Stadiums and register each one's pitch centre + radii so
   *  updateStadiumPlayers can run figures on the field. Cheap O(grid); re-run
   *  on every drawCityBuildings (placement / bulldoze keeps the set in sync). */
  private refreshStadiumFields(grid: Grid): void {
    this.stadiumFields.length = 0;
    for (const t of grid.iter()) {
      if (t.building !== 'grand_stadium') continue;
      // Anchor at (t.x, t.y); the 5×4 stadium's pitch centre is +2.5, +2.
      this.stadiumFields.push({ cx: t.x + 2.5, cz: t.y + 2, fx: 0.92, fz: 0.60, elev: t.elevation });
    }
  }

  /** Detect large farm clusters + build the snake path for each
   *  tractor. Called from `drawCityBuildings` whenever the city-
   *  buildings mesh rebuilds, which is the right cadence — farm
   *  layout only changes when the player paints / bulldozes. */
  private refreshFarmClusters(grid: Grid): void {
    this.farmClusters.length = 0;
    const visited = new Set<number>();
    for (const t of grid.iter()) {
      if (t.building !== 'farm') continue;
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      const cluster = floodBuilding(grid, t.x, t.y, 'farm', visited);
      if (cluster.length < FARM_TRACTOR_MIN_CLUSTER) continue;
      if (this.farmClusters.length >= MAX_TRACTORS) break;
      // Build boustrophedon (snake) path: sort by y ascending; within
      // each row sort by x, alternating direction so the tractor's
      // path is one continuous strip — east on even rows, west on odd
      // rows, with a single tile-step transition at row boundaries.
      const byRow = new Map<number, Array<{ x: number; y: number }>>();
      for (const tile of cluster) {
        let row = byRow.get(tile.y);
        if (!row) { row = []; byRow.set(tile.y, row); }
        row.push(tile);
      }
      const ys = [...byRow.keys()].sort((a, b) => a - b);
      const path: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < ys.length; i++) {
        const y = ys[i]!;
        const row = byRow.get(y)!.slice().sort((a, b) => a.x - b.x);
        if (i % 2 === 1) row.reverse();
        path.push(...row);
      }
      this.farmClusters.push({ path, progress: Math.random() * path.length });
    }
  }

  /** Per-frame tractor animation (Alpha 4.19). Advances each tractor
   *  along its cluster's snake path at TRACTOR_SPEED tiles/sec and
   *  writes the instance matrix to `tractorsMesh` + the sibling
   *  windows mesh. `dt` is the same render-rate delta used by the
   *  vehicle update. */
  updateTractors(dt: number, grid: Grid): void {
    if (this.farmClusters.length === 0) {
      this.tractorsMesh.count = 0;
      this.tractorWindowsMesh.count = 0;
      return;
    }
    const TRACTOR_SPEED = 0.55;    // tiles per real-time second
    const obj = this.tmpObj;
    const c = this.tmpColor;
    c.setHex(0xc04030);   // body-paint red — applied per-instance below
    for (let i = 0; i < this.farmClusters.length; i++) {
      const cl = this.farmClusters[i]!;
      const N = cl.path.length;
      if (N < 2) continue;
      // Advance along path.
      cl.progress = (cl.progress + dt * TRACTOR_SPEED) % N;
      const idx = Math.floor(cl.progress);
      const subT = cl.progress - idx;
      const a = cl.path[idx]!;
      const b = cl.path[(idx + 1) % N]!;
      const ax = a.x + 0.5;
      const az = a.y + 0.5;
      const bx = b.x + 0.5;
      const bz = b.y + 0.5;
      // Position in world coords.
      const wx = (ax + (bx - ax) * subT) * TILE_SIZE;
      const wz = (az + (bz - az) * subT) * TILE_SIZE;
      // Height — lift to terrain elevation of the current tile.
      const aTile = grid.get(a.x, a.y);
      const elev = aTile?.elevation ?? 0;
      const wy = elev + 0.018;
      obj.position.set(wx, wy, wz);
      // Yaw — face the direction of motion. atan2(x, z) so +Z is yaw=0.
      const dxSeg = bx - ax;
      const dzSeg = bz - az;
      if (dxSeg !== 0 || dzSeg !== 0) {
        obj.rotation.set(0, Math.atan2(dxSeg, dzSeg), 0);
      }
      obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      this.tractorsMesh.setMatrixAt(i, obj.matrix);
      this.tractorWindowsMesh.setMatrixAt(i, obj.matrix);
      this.tractorsMesh.setColorAt(i, c);
    }
    this.tractorsMesh.count = this.farmClusters.length;
    this.tractorWindowsMesh.count = this.farmClusters.length;
    this.tractorsMesh.instanceMatrix.needsUpdate = true;
    this.tractorWindowsMesh.instanceMatrix.needsUpdate = true;
    if (this.tractorsMesh.instanceColor) this.tractorsMesh.instanceColor.needsUpdate = true;
  }

  /** Animate "a game in progress" — jersey-coloured figures running around
   *  the pitch of every Grand Stadium, AT NIGHT only (when the floodlights
   *  are on). Mirrors the tractor pattern: a shared time accumulator drives
   *  each player along a drifting elliptical path within the field, facing
   *  the direction of motion with a slight running bob. `timeOfDay` 0=peak
   *  night … 0.5=midday … 1=midnight, so night ≈ <0.22 or >0.78. */
  updateStadiumPlayers(dt: number, timeOfDay: number): void {
    const isNight = timeOfDay < 0.22 || timeOfDay > 0.78;
    if (!isNight || this.stadiumFields.length === 0) {
      this.stadiumPlayersMesh.count = 0;
      return;
    }
    this.stadiumPlayerT += dt;
    const t = this.stadiumPlayerT;
    const obj = this.tmpObj;
    const c = this.tmpColor;
    const PER = 12;                          // figures per stadium (two teams)
    const team = [0xe23b3b, 0x3a6ed0];       // red vs blue jerseys (pop on the lit pitch)
    let inst = 0;
    for (let s = 0; s < this.stadiumFields.length; s++) {
      const f = this.stadiumFields[s]!;
      for (let p = 0; p < PER; p++) {
        if (inst >= MAX_STADIUM_PLAYERS) break;
        const spd = 0.55 + (p % 4) * 0.14;
        const ang = (p / PER) * Math.PI * 2 + t * spd + s * 1.3;
        const rf = 0.28 + 0.62 * (0.5 + 0.5 * Math.sin(p * 2.1 + t * 0.6));
        const px = f.cx + f.fx * rf * Math.cos(ang);
        const pz = f.cz + f.fz * rf * Math.sin(ang);
        // Sample slightly ahead for the facing yaw.
        const ang2 = ang + 0.06;
        const rf2 = 0.28 + 0.62 * (0.5 + 0.5 * Math.sin(p * 2.1 + (t + 0.06) * 0.6));
        const nx = f.cx + f.fx * rf2 * Math.cos(ang2);
        const nz = f.cz + f.fz * rf2 * Math.sin(ang2);
        const bob = Math.abs(Math.sin(t * 9 + p)) * 0.016;
        // Feet on the pitch, body above the lit-field overlay so they're not
        // washed out by the floodlit-grass glow.
        obj.position.set(px * TILE_SIZE, f.elev + 0.055 + bob, pz * TILE_SIZE);
        obj.rotation.set(0, Math.atan2(nx - px, nz - pz), 0);
        obj.scale.set(1, 1, 1);
        obj.updateMatrix();
        this.stadiumPlayersMesh.setMatrixAt(inst, obj.matrix);
        c.setHex(team[p % 2]!);
        this.stadiumPlayersMesh.setColorAt(inst, c);
        inst++;
      }
    }
    this.stadiumPlayersMesh.count = inst;
    this.stadiumPlayersMesh.instanceMatrix.needsUpdate = true;
    if (this.stadiumPlayersMesh.instanceColor) this.stadiumPlayersMesh.instanceColor.needsUpdate = true;
  }

  /** Districts overlay (Alpha 2.22). One translucent quad per tile that
   *  has a districtId, tinted by the district's color. Subtle (alpha 0.30)
   *  so it reads as "neighbourhood tint" rather than a full wash. */
  private districtsMesh: Mesh | null = null;
  /** Night-lights overlay (Alpha 3.0.1). Glowing yellow lamps on
   *  avenues, walking paths, and parks; opacity ramps in at night. */
  private nightLightsMesh: Mesh | null = null;
  /** Smooth radial-gradient pools of light around each lamp (Alpha 3.1.6).
   *  Built alongside `nightLightsMesh` but uses a CanvasTexture with a
   *  radial gradient so the falloff is continuous instead of steppy. */
  private lampGlowMesh: Mesh | null = null;
  /** Lit-window overlay (Alpha 3.1.6): bright rectangles on medium+
   *  commercial / mixed-use / skyscraper buildings that always render
   *  at full brightness via MeshBasicMaterial, fading in at night. */
  private litWindowsMesh: Mesh | null = null;
  /** Skyscrapers live in their own mesh (Alpha 3.1.7) so opacity can fade
   *  on zoom-in, letting the player see what's behind a tall tower when
   *  the camera comes in close. */
  private skyscrapersMesh: Mesh | null = null;
  /** Current camera ortho size — pushed in via applyCameraZoom each frame
   *  to drive skyscraper opacity (and any future zoom-aware effects). */
  private currentOrthoSize = 16;
  /** Shared radial-gradient texture used by every lamp glow. Generated
   *  once at Renderer init via Canvas2D. */
  private lampGlowTexture: import('three').Texture | null = null;
  drawDistricts(grid: Grid, districts: import('../simulation/Districts').Districts): void {
    if (this.districtsMesh) {
      this.worldGroup.remove(this.districtsMesh);
      this.districtsMesh.geometry.dispose();
      (this.districtsMesh.material as MeshLambertMaterial).dispose();
      this.districtsMesh = null;
    }
    const built = buildDistrictsMesh(grid, districts);
    if (built) {
      this.districtsMesh = built;
      this.worldGroup.add(this.districtsMesh);
    }
  }

  /** (Re)build the night-lights overlay (Alpha 3.0.1). Walks the grid for
   *  avenue road tiles, walking-path tiles, and park tiles; emits the
   *  visible lamp fixtures (poles + bulbs) AND the smooth radial-gradient
   *  glow pools (Alpha 3.1.6) that actually illuminate the surrounding
   *  ground. Opacity is driven by applyTimeOfDay.
   */
  drawNightLights(grid: Grid): void {
    if (this.nightLightsMesh) {
      this.worldGroup.remove(this.nightLightsMesh);
      this.nightLightsMesh.geometry.dispose();
      (this.nightLightsMesh.material as MeshBasicMaterial).dispose();
      this.nightLightsMesh = null;
    }
    if (this.lampGlowMesh) {
      this.worldGroup.remove(this.lampGlowMesh);
      this.lampGlowMesh.geometry.dispose();
      (this.lampGlowMesh.material as MeshBasicMaterial).dispose();
      this.lampGlowMesh = null;
    }
    const built = buildNightLightsMesh(grid);
    if (built) {
      this.nightLightsMesh = built;
      this.worldGroup.add(this.nightLightsMesh);
    }
    if (!this.lampGlowTexture) this.lampGlowTexture = makeRadialGlowTexture();
    const glow = buildLampGlowMesh(grid, this.lampGlowTexture);
    if (glow) {
      this.lampGlowMesh = glow;
      this.worldGroup.add(this.lampGlowMesh);
    }
  }

  /** (Re)build the lit-windows overlay (Alpha 3.1.6). Bright rectangles
   *  on medium+ commercial / mixed-use / skyscraper buildings that
   *  brighten at night, making the city visibly come alive after dark. */
  drawLitWindows(grid: Grid): void {
    if (this.litWindowsMesh) {
      this.worldGroup.remove(this.litWindowsMesh);
      this.litWindowsMesh.geometry.dispose();
      (this.litWindowsMesh.material as MeshBasicMaterial).dispose();
      this.litWindowsMesh = null;
    }
    const built = buildLitWindowsMesh(grid);
    if (built) {
      this.litWindowsMesh = built;
      this.worldGroup.add(this.litWindowsMesh);
    }
  }

  /** Beautification streetscape mesh (Alpha 4.0 — council-controlled).
   *  One merged mesh of decorative props attached to developed C / MU
   *  tiles, scaled by the current `BeautificationTier`. Rebuilt by
   *  `drawBeautification`; defunding wipes it back to null. */
  private beautificationMesh: Mesh | null = null;
  /** Currently-rendered beautification tier — used to skip a no-op
   *  rebuild when neither the tier nor the C/MU set has changed. */
  private lastBeautTier: import('../types').BeautificationTier = 'none';

  /**
   * Rebuild the streetscape beautification overlay (Alpha 4.0). Emits
   * per-tile decorations on developed Commercial / Mixed-Use tiles
   * (and L3 Residential at the top tier) — planters, café tables,
   * banners, public art, etc. — scaled by the council-set tier.
   *
   * **Tier 'none'** wipes the mesh entirely (the bill defunded or no
   * council yet). **Tier 'opulent'** adds the most aggressive flair
   * to every developed downtown tile.
   *
   * Cheap to rebuild — single merged Mesh, only walks developed C/MU
   * tiles. Caller should debounce: only call when tier OR the C/MU
   * tile set changed.
   */
  drawBeautification(grid: Grid, tier: import('../types').BeautificationTier): void {
    if (this.beautificationMesh) {
      this.worldGroup.remove(this.beautificationMesh);
      this.beautificationMesh.geometry.dispose();
      (this.beautificationMesh.material as MeshLambertMaterial).dispose();
      this.beautificationMesh = null;
    }
    this.lastBeautTier = tier;
    if (tier === 'none') return;
    const built = buildBeautificationMesh(grid, tier);
    if (built) {
      this.beautificationMesh = built;
      this.worldGroup.add(this.beautificationMesh);
    }
  }

  /** Currently-rendered beautification tier. Used by Game to skip
   *  redundant `drawBeautification` calls. */
  getBeautificationTier(): import('../types').BeautificationTier {
    return this.lastBeautTier;
  }

  /** Optional supplier of the council's currently-effective beautification
   *  tier. Set once by Game.init; if present, every `drawBuildings`
   *  rebuild auto-refreshes the beautification overlay too — saves
   *  every paint site from having to remember to pair the calls. */
  private beautificationProvider: (() => import('../types').BeautificationTier) | null = null;
  setBeautificationProvider(fn: () => import('../types').BeautificationTier): void {
    this.beautificationProvider = fn;
  }

  /** Replace the zoned-buildings mesh: dispose the old, add the new (or clear),
   *  flag shadow cast/receive. Shared by the sync + incremental builders. */
  private swapBuildingsMesh(mesh: Mesh | null): void {
    if (this.buildingsMesh) {
      this.worldGroup.remove(this.buildingsMesh);
      this.buildingsMesh.geometry.dispose();
      (this.buildingsMesh.material as MeshLambertMaterial).dispose();
      this.buildingsMesh = null;
    }
    if (mesh) {
      this.buildingsMesh = mesh;
      this.worldGroup.add(mesh);
      this.markShadows(mesh, true, true);
    }
  }

  /** Rebuild the sibling layers that share the buildings' dirty cadence:
   *  skyscrapers (own mesh for zoom-fade), the lit-window overlay, and the
   *  beautification streetscape. A fraction of the zoned-buildings cost, so
   *  these stay synchronous even on the incremental path. */
  private rebuildBuildingSiblings(grid: Grid): void {
    if (this.skyscrapersMesh) {
      this.worldGroup.remove(this.skyscrapersMesh);
      this.skyscrapersMesh.geometry.dispose();
      (this.skyscrapersMesh.material as MeshLambertMaterial).dispose();
      this.skyscrapersMesh = null;
    }
    const sky = buildSkyscrapersMesh(grid);
    if (sky) {
      this.skyscrapersMesh = sky;
      this.worldGroup.add(this.skyscrapersMesh);
      this.markShadows(this.skyscrapersMesh, true, true);
      this.applyCameraZoom(this.currentOrthoSize);
    }
    // Lit-window overlay (Alpha 3.1.6) + beautification streetscape (Alpha 4.0)
    // share the buildings' dirty triggers. Beautification provider injected by
    // Game; skipped when absent (e.g. an early test harness).
    this.drawLitWindows(grid);
    if (this.beautificationProvider) {
      this.drawBeautification(grid, this.beautificationProvider());
    }
  }

  /** Rebuild the buildings mesh from current tile densities. SYNCHRONOUS — a
   *  one-shot full rebuild for direct/user-driven callers (init, undo, theme
   *  swap, placement) that want the result immediately. The autonomous sim
   *  loop uses drawBuildingsIncremental so a large city doesn't freeze.
   *  `monthsElapsed` drives the Alpha 2.16 patina pass. */
  drawBuildings(grid: Grid, cityMood = 0, monthsElapsed = 0): void {
    this.cancelBuildingsJob(); // a direct rebuild supersedes any in-flight one
    this.bPending = null;
    this.swapBuildingsMesh(buildBuildingsMesh(grid, cityMood, monthsElapsed));
    this.rebuildBuildingSiblings(grid);
  }

  /** Incremental zoned-buildings rebuild (Beta 1.9). Snapshots the tiles and
   *  builds them across frames via pumpBuildings, leaving the current mesh on
   *  screen until the new one is ready — so a large city's ~1.5s rebuild never
   *  freezes the frame. If a rebuild is already running, the latest request is
   *  queued and applied when it finishes, so continuous development can't keep
   *  restarting the job and leave it never updating. */
  drawBuildingsIncremental(grid: Grid, cityMood = 0, monthsElapsed = 0): void {
    if (this.bJob) {
      this.bPending = { grid, cityMood, months: monthsElapsed };
      return;
    }
    this.startBuildingsJob(grid, cityMood, monthsElapsed);
    // Sibling layers (skyscrapers / lit-windows / beautification) are rebuilt
    // ONCE when the job completes (see pumpBuildings), NOT on every trigger —
    // the lit-window overlay is ~244ms on a big city, and during active growth
    // buildingsDirty can fire every tick, which would re-incur that repeatedly.
    // They hold their previous state until the job lands (lit windows are
    // invisible by day anyway, so the brief staleness is unnoticeable).
  }

  private startBuildingsJob(grid: Grid, cityMood: number, monthsElapsed: number): void {
    this.bJob = {
      grid,
      tiles: [...grid.iter()],
      i: 0,
      geoms: [],
      colours: [],
      moodBase: (cityMood + 1) * 0.5,
      months: monthsElapsed
    };
  }

  /** Advance the in-flight incremental rebuild by one frame's time budget.
   *  Called every frame from the game loop; a no-op when idle. On completion
   *  it merges the accumulated geometry and swaps it in (then starts a queued
   *  follow-up if one was requested mid-build). */
  pumpBuildings(): void {
    const job = this.bJob;
    if (!job) return;
    const start = performance.now();
    const n = job.tiles.length;
    while (job.i < n) {
      emitZonedBuildingTile(job.grid, job.tiles[job.i]!, job.moodBase, job.months, job.geoms, job.colours);
      job.i++;
      // Check the clock every 8 tiles. Developed tiles cost ~0.65ms each, so a
      // coarser check (every 64) let a run of them blow ~40ms past the budget;
      // every 8 caps the overshoot to a few ms. (performance.now isn't free, but
      // the overhead is negligible — most tiles are instant skips.)
      if ((job.i & 7) === 0 && performance.now() - start > BUILDINGS_REBUILD_BUDGET_MS) break;
    }
    if (job.i >= n) {
      this.swapBuildingsMesh(mergeZonedBuildings(job.geoms, job.colours));
      this.bJob = null;
      if (this.bPending) {
        // Development is still churning — start the next buildings pass and
        // DEFER the sibling rebuild. Rebuilding the (~244ms) lit-windows on
        // every back-to-back job would re-hitch constantly during growth.
        const p = this.bPending;
        this.bPending = null;
        this.startBuildingsJob(p.grid, p.cityMood, p.months);
      } else {
        // Growth has settled — rebuild the sibling layers once so skyscrapers /
        // lit-windows / beautification catch up to the now-current buildings.
        this.rebuildBuildingSiblings(job.grid);
      }
    }
  }

  /** Drop any in-flight incremental rebuild, freeing its accumulated geometry. */
  private cancelBuildingsJob(): void {
    if (!this.bJob) return;
    for (const g of this.bJob.geoms) g.dispose();
    this.bJob = null;
  }

  /** Update skyscraper material opacity based on current camera ortho
   *  size (Alpha 3.1.7). Closer zoom (smaller orthoSize) → more
   *  translucent so the player can see ground-level activity behind
   *  the towers. */
  applyCameraZoom(orthoSize: number): void {
    this.currentOrthoSize = orthoSize;
    if (!this.skyscrapersMesh) return;
    // Linear ramp: orthoSize >= 12 → fully opaque; orthoSize <= 5 → 0.45.
    const t = Math.max(0, Math.min(1, (orthoSize - 5) / (12 - 5)));
    const opacity = 0.45 + t * 0.55;
    const mat = this.skyscrapersMesh.material as MeshLambertMaterial;
    mat.opacity = opacity;
  }

  /** Rebuild the road mesh from current grid edges + stubs. Sidewalks AND
   *  paths rebuild alongside roads — both have stub-extensions that depend
   *  on which neighbouring tiles are roads. */
  drawRoads(grid: Grid): void {
    if (this.roadMesh) {
      this.worldGroup.remove(this.roadMesh);
      this.roadMesh.geometry.dispose();
      (this.roadMesh.material as MeshLambertMaterial).dispose?.();
      this.roadMesh = null;
    }
    if (this.roadLanes) {
      this.worldGroup.remove(this.roadLanes);
      this.roadLanes.geometry.dispose();
      (this.roadLanes.material as LineBasicMaterial).dispose();
      this.roadLanes = null;
    }
    if (this.roadOrnaments) {
      this.disposeGroup(this.roadOrnaments);
      this.worldGroup.remove(this.roadOrnaments);
      this.roadOrnaments = null;
    }
    if (this.bridgeRoadMesh) {
      this.disposeGroup(this.bridgeRoadMesh);
      this.worldGroup.remove(this.bridgeRoadMesh);
      this.bridgeRoadMesh = null;
    }
    this.rebuildSidewalks(grid);
    this.rebuildPaths(grid);
    const built = buildRoadMesh(grid);
    if (built) {
      this.roadMesh = built.mesh;
      this.worldGroup.add(this.roadMesh);
      this.markShadows(this.roadMesh, false, true); // streets catch building shadows
      if (built.lanes) {
        this.roadLanes = built.lanes;
        this.worldGroup.add(this.roadLanes);
      }
    }
    // Upper-layer (Bridge Mode) overpasses (Alpha 2.12).
    const bridgeRoads = buildBridgeRoadMesh(grid);
    if (bridgeRoads) {
      this.bridgeRoadMesh = bridgeRoads;
      this.worldGroup.add(this.bridgeRoadMesh);
      this.markShadows(this.bridgeRoadMesh, true, true);
    }
    const ornaments = buildRoadOrnamentsGroup(grid);
    if (ornaments) {
      this.roadOrnaments = ornaments;
      this.worldGroup.add(ornaments);
    }
    // Refresh night-lights — avenue lamps depend on the road state.
    this.drawNightLights(grid);
  }

  /** Rebuild the walking-path mesh from current path tiles. Sidewalks
   *  rebuild too because their per-side extension depends on which
   *  neighbours are paths. */
  drawPaths(grid: Grid): void {
    this.rebuildPaths(grid);
    this.rebuildSidewalks(grid);
    // Refresh night-lights — path lamps depend on path state.
    this.drawNightLights(grid);
  }

  private rebuildPaths(grid: Grid): void {
    if (this.pathMesh) {
      this.worldGroup.remove(this.pathMesh);
      this.pathMesh.geometry.dispose();
      (this.pathMesh.material as MeshLambertMaterial).dispose();
      this.pathMesh = null;
    }
    const built = buildPathMesh(grid);
    if (built) {
      this.pathMesh = built;
      this.worldGroup.add(this.pathMesh);
    }
  }

  private rebuildSidewalks(grid: Grid): void {
    if (this.sidewalkMesh) {
      this.worldGroup.remove(this.sidewalkMesh);
      this.sidewalkMesh.geometry.dispose();
      (this.sidewalkMesh.material as MeshLambertMaterial).dispose();
      this.sidewalkMesh = null;
    }
    const built = buildSidewalkMesh(grid);
    if (built) {
      this.sidewalkMesh = built;
      this.worldGroup.add(this.sidewalkMesh);
      this.markShadows(this.sidewalkMesh, false, true);
    }
  }

  /**
   * Recursively tear down a Group: dispose the geometry + material(s) of
   * every geometry-bearing descendant (Mesh, LineSegments, Line, Points),
   * not just direct Mesh children. Beta 1.7 — the old version only handled
   * direct `instanceof Mesh` children, so a Group containing a nested
   * sub-Group or a LineSegments leaked their GPU buffers on every rebuild.
   * Road ornaments + bridge decks rebuild on every road edit, so that was
   * a steady leak. Now uses Three's traverse() so depth doesn't matter.
   */
  private disposeGroup(g: Group): void {
    g.traverse((obj) => {
      const withGeom = obj as { geometry?: BufferGeometry; material?: unknown };
      if (withGeom.geometry) withGeom.geometry.dispose();
      const mat = withGeom.material;
      if (Array.isArray(mat)) {
        for (const m of mat) (m as { dispose?: () => void }).dispose?.();
      } else if (mat) {
        (mat as { dispose?: () => void }).dispose?.();
      }
    });
    while (g.children.length > 0) g.remove(g.children[0]!);
  }

  /**
   * Per-frame car positions. Reads each car's path + segmentT, computes
   * world position via lerp between the segment's endpoints, and orients
   * the box along the segment direction. Sets `count` to the active count
   * so the InstancedMesh renders only live cars.
   */
  updateCars(vehicles: Vehicles, grid: Grid): void {
    const obj = this.tmpObj;
    const c = this.tmpColor;
    const gridWidth = grid.width;
    // Per-frame counters. Cars and trucks live in vehicles.cars together
    // but render to separate InstancedMeshes — `carIdx` tracks the car
    // instance slot, `truckIdx` tracks truck instance slot. Police and
    // fire accessory overlays count separately.
    let carIdx = 0;
    let truckIdx = 0;
    let policeIdx = 0;
    let fireIdx = 0;
    for (let i = 0; i < vehicles.cars.length; i++) {
      const car = vehicles.cars[i]!;
      const kind = car.kind ?? 'resident';
      const isTruck = kind === 'truck';
      // Beta 1.3 Phase 2 — parked-state render. Position at the stall
      // (x, z, yaw) baked into the reservation. Skip all the segment
      // interpolation / lane-offset / road-surface-Y math below.
      // Trucks don't park in lots (they're freight, not cars) so they
      // never hit this branch.
      if (car.isParked && car.parking) {
        const stall = car.parking;
        const tile = grid.get(stall.tileX, stall.tileY);
        const parkY = roadSurfaceY(grid, stall.tileX, stall.tileY) + 0.05;
        obj.position.set(stall.worldX, parkY, stall.worldZ);
        obj.rotation.set(0, stall.yaw, 0);
        obj.scale.set(1, 1, 1);
        obj.updateMatrix();
        this.carsMesh.setMatrixAt(carIdx, obj.matrix);
        this.carWindowsMesh.setMatrixAt(carIdx, obj.matrix);
        this.carHeadlightsMesh.setMatrixAt(carIdx, obj.matrix);
        this.carTaillightsMesh.setMatrixAt(carIdx, obj.matrix);
        c.setHex(car.color);
        this.carsMesh.setColorAt(carIdx, c);
        carIdx++;
        void tile;
        continue;
      }
      const a = car.pathTiles[car.segmentIdx]!;
      const b = car.pathTiles[car.segmentIdx + 1]!;
      const aTileX = a % gridWidth;
      const aTileY = Math.floor(a / gridWidth);
      const bTileX = b % gridWidth;
      const bTileY = Math.floor(b / gridWidth);
      const ax = aTileX + 0.5;
      const az = aTileY + 0.5;
      const bx = bTileX + 0.5;
      const bz = bTileY + 0.5;
      const t = car.segmentT;
      // Lerp y between the two tile elevations (Alpha 2.4) so cars climb
      // hills and dip into valleys instead of clipping through them. Bridge
      // tiles override to the absolute deck height.
      const yA = roadSurfaceY(grid, aTileX, aTileY);
      const yB = roadSurfaceY(grid, bTileX, bTileY);
      // Right-lane offset (Alpha 2.13.2) — drive on the right of the
      // centreline so opposing traffic passes on the left. Right
      // perpendicular = (dz, -dx) when looking down +Y.
      const dxSeg = bx - ax;
      const dzSeg = bz - az;
      const segLen = Math.hypot(dxSeg, dzSeg) || 1;
      const ta = grid.get(aTileX, aTileY);
      const tier = ta?.roadType ?? 'local';
      const laneOffset = ROAD_TIER[tier].width * 0.22; // ≈ centre of right lane
      const rightX = (dzSeg / segLen) * laneOffset;
      const rightZ = (-dxSeg / segLen) * laneOffset;
      obj.position.set(
        (ax + dxSeg * t) * TILE_SIZE + rightX * TILE_SIZE,
        yA + (yB - yA) * t + 0.05,
        (az + dzSeg * t) * TILE_SIZE + rightZ * TILE_SIZE
      );
      // atan2(x, z) so +Z (south) is yaw=0, +X (east) is yaw=π/2.
      obj.rotation.set(0, Math.atan2(dxSeg, dzSeg), 0);
      // Per-kind scale (Alpha 4.14, expanded 4.15.2; Beta 1.5):
      //  - motorcade_limo → 1.6× length (stretched limousine)
      //  - fire_response → 1.10× wide × 1.50× tall × 1.40× long
      //  - truck → unit scale (truck geometry is pre-sized larger)
      // Everything else uses unit scale.
      if (kind === 'motorcade_limo') obj.scale.set(1, 1, 1.6);
      else if (kind === 'fire_response') obj.scale.set(1.10, 1.50, 1.40);
      else obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      if (isTruck) {
        // Trucks write to their own dedicated InstancedMesh group.
        this.truckBodyMesh.setMatrixAt(truckIdx, obj.matrix);
        this.truckGlassMesh.setMatrixAt(truckIdx, obj.matrix);
        this.truckHeadlightsMesh.setMatrixAt(truckIdx, obj.matrix);
        this.truckTaillightsMesh.setMatrixAt(truckIdx, obj.matrix);
        c.setHex(car.color);
        this.truckBodyMesh.setColorAt(truckIdx, c);
        truckIdx++;
      } else {
        this.carsMesh.setMatrixAt(carIdx, obj.matrix);
        // Sibling overlays mirror the body's matrix (Alpha 4.4).
        this.carWindowsMesh.setMatrixAt(carIdx, obj.matrix);
        this.carHeadlightsMesh.setMatrixAt(carIdx, obj.matrix);
        this.carTaillightsMesh.setMatrixAt(carIdx, obj.matrix);
        c.setHex(car.color);
        this.carsMesh.setColorAt(carIdx, c);
        carIdx++;
        // Police accessory overlay (Alpha 4.15.2).
        if (kind === 'patrol' || kind === 'motorcade_lead' || kind === 'motorcade_tail') {
          this.policeAccessoriesMesh.setMatrixAt(policeIdx, obj.matrix);
          policeIdx++;
        }
        // Fire-truck accessory overlay (Alpha 4.15.2).
        if (kind === 'fire_response') {
          this.fireAccessoriesMesh.setMatrixAt(fireIdx, obj.matrix);
          fireIdx++;
        }
      }
    }
    this.carsMesh.count = carIdx;
    this.carWindowsMesh.count = carIdx;
    this.carHeadlightsMesh.count = carIdx;
    this.carTaillightsMesh.count = carIdx;
    this.truckBodyMesh.count = truckIdx;
    this.truckGlassMesh.count = truckIdx;
    this.truckHeadlightsMesh.count = truckIdx;
    this.truckTaillightsMesh.count = truckIdx;
    this.policeAccessoriesMesh.count = policeIdx;
    this.fireAccessoriesMesh.count = fireIdx;
    if (carIdx > 0) {
      this.carsMesh.instanceMatrix.needsUpdate = true;
      if (this.carsMesh.instanceColor) this.carsMesh.instanceColor.needsUpdate = true;
      this.carWindowsMesh.instanceMatrix.needsUpdate = true;
      this.carHeadlightsMesh.instanceMatrix.needsUpdate = true;
      this.carTaillightsMesh.instanceMatrix.needsUpdate = true;
    }
    if (truckIdx > 0) {
      this.truckBodyMesh.instanceMatrix.needsUpdate = true;
      if (this.truckBodyMesh.instanceColor) this.truckBodyMesh.instanceColor.needsUpdate = true;
      this.truckGlassMesh.instanceMatrix.needsUpdate = true;
      this.truckHeadlightsMesh.instanceMatrix.needsUpdate = true;
      this.truckTaillightsMesh.instanceMatrix.needsUpdate = true;
    }
    if (policeIdx > 0) this.policeAccessoriesMesh.instanceMatrix.needsUpdate = true;
    if (fireIdx > 0) this.fireAccessoriesMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * (Re)build the heatmap overlay. `kind` selects:
   *  - 'traffic': road tiles coloured by sustained-load EMA (green→red).
   *  - 'crime':   zoned tiles coloured by Crime.scoreAt (Alpha 2.21).
   * Called every render frame while a toggle is on; cleared via
   * `clearHeatmap` when the player turns it off.
   */
  drawHeatmap(grid: Grid, kind: 'traffic' | 'crime' = 'traffic', crime?: import('../simulation/Crime').Crime): void {
    if (this.heatmapMesh) {
      this.worldGroup.remove(this.heatmapMesh);
      this.heatmapMesh.geometry.dispose();
      (this.heatmapMesh.material as MeshLambertMaterial).dispose();
      this.heatmapMesh = null;
    }
    const built = kind === 'crime' && crime
      ? buildCrimeHeatmapMesh(grid, crime)
      : buildHeatmapMesh(grid);
    if (built) {
      this.heatmapMesh = built;
      this.worldGroup.add(this.heatmapMesh);
    }
  }

  clearHeatmap(): void {
    if (!this.heatmapMesh) return;
    this.worldGroup.remove(this.heatmapMesh);
    this.heatmapMesh.geometry.dispose();
    (this.heatmapMesh.material as MeshLambertMaterial).dispose();
    this.heatmapMesh = null;
  }

  /**
   * Per-frame pedestrian positions. Walkers travel along sidewalks of
   * road tiles or along walking-path tiles. The perpendicular offset is
   * resolved per-frame from the *current* tile's type and width:
   *
   *  - Non-highway road tile: offset = side × (roadHalf + SIDEWALK_PAD/2),
   *    placing the walker on the sidewalk strip outside the road surface.
   *  - Path tile: offset = side × small spread (path is narrow, both
   *    sides walkable but kept near centre).
   *  - Anything else (shouldn't happen for a planned path, but defensive):
   *    offset 0.
   *
   * Lerping the offset between the from-tile value and the to-tile value
   * gives a smooth sidewalk-to-path transition instead of a snap.
   */
  updatePedestrians(pedestrians: Pedestrians, grid: Grid): void {
    const obj = this.tmpObj;
    const c = this.tmpColor;
    const gridWidth = grid.width;
    let visible = 0;
    // Subtle walk-cycle clock (Alpha 3.2.4): a global "now" plus a per-
    // walker phase offset gives every figure its own bob phase so the
    // crowd doesn't synchronise. Frequency tuned to ~1.4 Hz so steps
    // read at the prototype's orthographic scale.
    const now = performance.now() * 0.001;
    for (let i = 0; i < pedestrians.walkers.length; i++) {
      const w = pedestrians.walkers[i]!;
      if (w.pathTiles.length < 2) continue;
      const a = w.pathTiles[w.segmentIdx]!;
      const b = w.pathTiles[w.segmentIdx + 1]!;
      const aTileX = a % gridWidth;
      const aTileY = Math.floor(a / gridWidth);
      const bTileX = b % gridWidth;
      const bTileY = Math.floor(b / gridWidth);
      const ax = aTileX + 0.5;
      const az = aTileY + 0.5;
      const bx = bTileX + 0.5;
      const bz = bTileY + 0.5;
      const t = w.segmentT;
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      // Perpendicular unit vector — `+side` puts the walker to the right
      // of travel direction, `-side` to the left.
      const px = -dz / len;
      const pz = dx / len;
      // Resolve per-tile offset and lerp between the from and to tiles.
      const offA = pedestrianOffsetForTile(grid, aTileX, aTileY) * w.side;
      const offB = pedestrianOffsetForTile(grid, bTileX, bTileY) * w.side;
      const off = offA + (offB - offA) * t;
      // Lerp y between the two tile surface heights so walkers follow the
      // ground (Alpha 2.4). Bridge tiles use the bridge deck height; path
      // tiles use PATH_LIFT + elevation; everything else uses sidewalk.
      const yA = walkerSurfaceY(grid, aTileX, aTileY);
      const yB = walkerSurfaceY(grid, bTileX, bTileY);
      // Walk-cycle bob — vertical oscillation + a tiny side-to-side
      // sway. Per-walker phase via the index so the crowd stays out of
      // sync. Bob amplitude is small enough to read as a stride at
      // ortho zoom without making the figure look like it's hopping.
      const phase = i * 0.7;
      const cycle = now * 8.8 + phase;
      const bob = Math.abs(Math.sin(cycle)) * 0.018;
      const sway = Math.sin(cycle) * 0.04;
      const yaw = Math.atan2(dx, dz);
      obj.position.set(
        (ax + dx * t + px * off) * TILE_SIZE,
        yA + (yB - yA) * t + 0.005 + bob,
        (az + dz * t + pz * off) * TILE_SIZE
      );
      obj.rotation.set(0, yaw, sway);
      obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      this.pedestriansMesh.setMatrixAt(visible, obj.matrix);
      // Same matrix on the heads mesh so the head + hair sit above the
      // body. The y offset is baked into the head geometry already.
      this.pedestriansHeadsMesh.setMatrixAt(visible, obj.matrix);
      c.setHex(w.color);
      this.pedestriansMesh.setColorAt(visible, c);
      visible++;
    }
    this.pedestriansMesh.count = visible;
    this.pedestriansHeadsMesh.count = visible;
    if (visible > 0) {
      this.pedestriansMesh.instanceMatrix.needsUpdate = true;
      this.pedestriansHeadsMesh.instanceMatrix.needsUpdate = true;
      if (this.pedestriansMesh.instanceColor) this.pedestriansMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Render shoppers walking from parked cars to their destination
   * (Beta 1.3.4 — Phase 2.1). Each shopper is interpolated point-to-
   * point between its stall and the destination tile center;
   * `resolve()` returns the current world (x, z, yaw, visible). Shoppers
   * in the "shopping" phase (inside the store) report visible=false
   * and are skipped from the render count.
   *
   * Same humanoid body + head geometry as the pedestrian mesh. The
   * walking bob animation is re-derived here from per-shopper index +
   * a global clock so each figure moves out of phase with neighbours.
   */
  updateShoppers(shoppers: import('../simulation/Shoppers').Shoppers, grid: Grid): void {
    const obj = this.tmpObj;
    const c = this.tmpColor;
    let visible = 0;
    const now = performance.now() * 0.001;
    for (let i = 0; i < shoppers.list.length; i++) {
      const s = shoppers.list[i]!;
      const r = shoppers.resolve(s);
      if (!r.visible) continue;
      // Surface y from the parking-lot floor — we don't have a tile
      // index easily here so use the stored yLift. Walkers are short
      // figures so a small bob is plenty to read as walking.
      const phase = i * 0.7;
      const cycle = now * 8.8 + phase;
      const bob = Math.abs(Math.sin(cycle)) * 0.018;
      const sway = Math.sin(cycle) * 0.04;
      obj.position.set(r.x, s.yLift + 0.005 + bob, r.z);
      obj.rotation.set(0, r.yaw, sway);
      obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      this.shopperBodiesMesh.setMatrixAt(visible, obj.matrix);
      this.shopperHeadsMesh.setMatrixAt(visible, obj.matrix);
      c.setHex(s.color);
      this.shopperBodiesMesh.setColorAt(visible, c);
      visible++;
    }
    this.shopperBodiesMesh.count = visible;
    this.shopperHeadsMesh.count = visible;
    if (visible > 0) {
      this.shopperBodiesMesh.instanceMatrix.needsUpdate = true;
      this.shopperHeadsMesh.instanceMatrix.needsUpdate = true;
      if (this.shopperBodiesMesh.instanceColor) this.shopperBodiesMesh.instanceColor.needsUpdate = true;
    }
    void grid;
  }

  /** Per-frame bus positions, mirror of `updateCars`. */
  updateBuses(buses: Buses, grid: Grid): void {
    const obj = this.tmpObj;
    const c = this.tmpColor;
    const gridWidth = grid.width;
    let visible = 0;
    for (let i = 0; i < buses.buses.length; i++) {
      const bus = buses.buses[i]!;
      // Buses without a current path leg are between stops — skip drawing.
      if (bus.pathTiles.length < 2) continue;
      const a = bus.pathTiles[bus.segmentIdx]!;
      const b = bus.pathTiles[bus.segmentIdx + 1]!;
      const aTileX = a % gridWidth;
      const aTileY = Math.floor(a / gridWidth);
      const bTileX = b % gridWidth;
      const bTileY = Math.floor(b / gridWidth);
      const ax = aTileX + 0.5;
      const az = aTileY + 0.5;
      const bx = bTileX + 0.5;
      const bz = bTileY + 0.5;
      const t = bus.segmentT;
      // Right-lane offset (Alpha 2.13.2) + pull-over offset on dwell.
      // Right perpendicular = (dz, -dx) when looking down +Y so cars and
      // buses keep to the right of the centreline. Pull-over adds extra
      // rightward shift so the bus tucks into the sidewalk for boarding.
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const ta = grid.get(aTileX, aTileY);
      const tier = ta?.roadType ?? 'local';
      const baseLane = ROAD_TIER[tier].width * 0.22;
      const dwellExtra = bus.dwellRemaining > 0 ? 0.18 : 0;
      const lateral = baseLane + dwellExtra;
      const px = (dz / len) * lateral;
      const pz = (-dx / len) * lateral;
      const yA = roadSurfaceY(grid, aTileX, aTileY);
      const yB = roadSurfaceY(grid, bTileX, bTileY);
      obj.position.set(
        (ax + dx * t + px) * TILE_SIZE,
        yA + (yB - yA) * t + 0.07,
        (az + dz * t + pz) * TILE_SIZE
      );
      obj.rotation.set(0, Math.atan2(dx, dz), 0);
      obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      this.busesMesh.setMatrixAt(visible, obj.matrix);
      // Sibling overlays mirror the body's matrix (Alpha 4.4).
      this.busWindowsMesh.setMatrixAt(visible, obj.matrix);
      this.busHeadlightsMesh.setMatrixAt(visible, obj.matrix);
      c.setHex(bus.color);
      this.busesMesh.setColorAt(visible, c);
      visible++;
    }
    this.busesMesh.count = visible;
    this.busWindowsMesh.count = visible;
    this.busHeadlightsMesh.count = visible;
    if (visible > 0) {
      this.busesMesh.instanceMatrix.needsUpdate = true;
      if (this.busesMesh.instanceColor) this.busesMesh.instanceColor.needsUpdate = true;
      this.busWindowsMesh.instanceMatrix.needsUpdate = true;
      this.busHeadlightsMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Per-frame ferry positions (Alpha 2.19). Boats interpolate across
   *  water between paired docks at the ferry's current `t`. */
  updateFerries(ferries: import('../simulation/Ferries').Ferries, _grid: Grid): void {
    const obj = this.tmpObj;
    let visible = 0;
    for (const f of ferries.active) {
      const fx = f.ax + (f.bx - f.ax) * f.t;
      const fz = f.ay + (f.by - f.ay) * f.t;
      // Sit just above the water surface — y = 0.06 is above the water
      // shimmer plane and below most bridge clearances.
      obj.position.set((fx + 0.5) * TILE_SIZE, 0.06, (fz + 0.5) * TILE_SIZE);
      obj.rotation.set(0, f.headingRadians, 0);
      obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      this.ferriesMesh.setMatrixAt(visible, obj.matrix);
      visible++;
    }
    this.ferriesMesh.count = visible;
    if (visible > 0) this.ferriesMesh.instanceMatrix.needsUpdate = true;
  }

  drawSelection(gx: number, gy: number): void {
    this.selectionMesh.visible = true;
    this.selectionMesh.position.x = (gx + 0.5) * TILE_SIZE;
    this.selectionMesh.position.z = (gy + 0.5) * TILE_SIZE;
  }

  clearSelection(): void {
    this.selectionMesh.visible = false;
  }

  /**
   * Service-radius preview disc (Alpha 4.5). Shown when the player
   * selects a service tool (park / school / hospital / fire / police)
   * — translucent gold circle around the currently-selected tile at
   * the radius the building will actually cover. Hides on tool deselect
   * or when no tile is selected.
   */
  private radiusPreviewMesh: Mesh | null = null;
  /** Beta 1.6.33 — group holding existing-building radius discs.
   *  Drawn whenever a service tool is active so the player can see
   *  their current coverage and where the gaps are at a glance.
   *  Separate from radiusPreviewMesh (the gold cursor preview) so
   *  the two can coexist. */
  private radiusExistingGroup: Group | null = null;

  showServiceRadiusPreview(gx: number, gy: number, radius: number, elevation: number): void {
    if (this.radiusPreviewMesh) {
      this.worldGroup.remove(this.radiusPreviewMesh);
      this.radiusPreviewMesh.geometry.dispose();
      (this.radiusPreviewMesh.material as MeshBasicMaterial).dispose();
      this.radiusPreviewMesh = null;
    }
    if (radius <= 0 || !isFinite(radius)) return;
    const r = radius * TILE_SIZE;
    const geom = new CylinderGeometry(r, r, 0.012, 48);
    const mat = new MeshBasicMaterial({
      color: 0xffd84d,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    const mesh = new Mesh(geom, mat);
    mesh.position.set(
      (gx + 0.5) * TILE_SIZE,
      elevation + 0.020,
      (gy + 0.5) * TILE_SIZE
    );
    this.radiusPreviewMesh = mesh;
    this.worldGroup.add(mesh);
  }
  clearServiceRadiusPreview(): void {
    if (this.radiusPreviewMesh) {
      this.worldGroup.remove(this.radiusPreviewMesh);
      this.radiusPreviewMesh.geometry.dispose();
      (this.radiusPreviewMesh.material as MeshBasicMaterial).dispose();
      this.radiusPreviewMesh = null;
    }
  }

  /** Beta 1.6.33 — draw a disc for every existing service of a given
   *  kind so the player sees their current coverage map. Discs are
   *  rendered in a cooler colour at lower opacity than the gold
   *  cursor preview so the two layers read as distinct: "already
   *  placed" vs "would place here". */
  showExistingServiceRadii(
    discs: ReadonlyArray<{ x: number; y: number; radius: number; elevation: number }>
  ): void {
    this.clearExistingServiceRadii();
    if (discs.length === 0) return;
    const group = new Group();
    for (const d of discs) {
      if (d.radius <= 0 || !isFinite(d.radius)) continue;
      const r = d.radius * TILE_SIZE;
      const geom = new CylinderGeometry(r, r, 0.010, 36);
      const mat = new MeshBasicMaterial({
        color: 0x6cb0ff,         // cyan — readable on grass + road + sand alike
        transparent: true,
        opacity: 0.12,
        depthWrite: false
      });
      const mesh = new Mesh(geom, mat);
      mesh.position.set(
        (d.x + 0.5) * TILE_SIZE,
        d.elevation + 0.016,
        (d.y + 0.5) * TILE_SIZE
      );
      group.add(mesh);
    }
    this.radiusExistingGroup = group;
    this.worldGroup.add(group);
  }
  clearExistingServiceRadii(): void {
    if (this.radiusExistingGroup) {
      this.worldGroup.remove(this.radiusExistingGroup);
      for (const child of this.radiusExistingGroup.children) {
        const mesh = child as Mesh;
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      }
      this.radiusExistingGroup = null;
    }
  }

  /**
   * Footprint preview ghost (Alpha 4.13). Shows the player exactly which
   * tiles a multi-tile civic monument will occupy BEFORE they commit. The
   * mesh is a translucent rectangle covering the W×H footprint anchored at
   * (ax, ay), plus a slightly inset outline strip so the player can see
   * the boundary clearly.
   *
   * Colour swaps green/red based on `valid`: green = ready to commit,
   * red = cannot place (off-map, occupied, can't afford, banned, etc.).
   * Game.armMonumentPreview decides the colour and calls this.
   *
   * The ghost lives in worldGroup and follows the elevation passed in so
   * the preview hugs the ground.
   */
  private footprintPreviewGroup: Group | null = null;
  showFootprintPreview(ax: number, ay: number, w: number, h: number, valid: boolean, elevation: number): void {
    this.clearFootprintPreview();
    const colour = valid ? 0x6dd06a : 0xff6e6e;
    const fillOpacity = valid ? 0.22 : 0.30;
    const outlineOpacity = valid ? 0.85 : 0.95;
    // Translucent fill covering the full W×H rectangle.
    const fill = new BoxGeometry(w * TILE_SIZE, 0.005, h * TILE_SIZE);
    const fillMat = new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: fillOpacity,
      depthWrite: false
    });
    const fillMesh = new Mesh(fill, fillMat);
    fillMesh.position.set(
      (ax + w / 2) * TILE_SIZE,
      elevation + 0.020,
      (ay + h / 2) * TILE_SIZE
    );
    // Border strips — four thin boxes around the footprint perimeter so
    // the boundary reads clearly even at a steep camera angle.
    const borderMat = new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: outlineOpacity,
      depthWrite: false
    });
    const bt = 0.04;   // border thickness in tile units
    const group = new Group();
    group.add(fillMesh);
    // North edge
    {
      const g = new BoxGeometry(w * TILE_SIZE + bt, 0.008, bt);
      const m = new Mesh(g, borderMat);
      m.position.set((ax + w / 2) * TILE_SIZE, elevation + 0.022, ay * TILE_SIZE);
      group.add(m);
    }
    // South edge
    {
      const g = new BoxGeometry(w * TILE_SIZE + bt, 0.008, bt);
      const m = new Mesh(g, borderMat);
      m.position.set((ax + w / 2) * TILE_SIZE, elevation + 0.022, (ay + h) * TILE_SIZE);
      group.add(m);
    }
    // West edge
    {
      const g = new BoxGeometry(bt, 0.008, h * TILE_SIZE);
      const m = new Mesh(g, borderMat);
      m.position.set(ax * TILE_SIZE, elevation + 0.022, (ay + h / 2) * TILE_SIZE);
      group.add(m);
    }
    // East edge
    {
      const g = new BoxGeometry(bt, 0.008, h * TILE_SIZE);
      const m = new Mesh(g, borderMat);
      m.position.set((ax + w) * TILE_SIZE, elevation + 0.022, (ay + h / 2) * TILE_SIZE);
      group.add(m);
    }
    this.footprintPreviewGroup = group;
    this.worldGroup.add(group);
  }
  clearFootprintPreview(): void {
    if (!this.footprintPreviewGroup) return;
    this.worldGroup.remove(this.footprintPreviewGroup);
    for (const child of this.footprintPreviewGroup.children) {
      const mesh = child as Mesh;
      mesh.geometry.dispose();
      const mat = mesh.material as MeshBasicMaterial | MeshBasicMaterial[];
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    }
    this.footprintPreviewGroup = null;
  }

  /**
   * Monument ghost-web (Alpha 4.15). Per-block placement requires the
   * player to see WHICH tiles are still unpaid in their current
   * reservation — otherwise they're tapping blind. When a big-build
   * tool is active and a reservation of the matching kind exists, this
   * renders a soft gold outline on every unpaid tile of that
   * reservation. The web shrinks one tile at a time as the player
   * pays. Lives in `worldGroup` so it follows camera + elevation.
   */
  private ghostWebGroup: Group | null = null;
  showMonumentGhostWeb(
    grid: Grid,
    kind: 'mayor_mansion' | 'city_hall' | 'provincial_capital' | 'national_capital' | 'cloverleaf' | 'grand_stadium'
  ): void {
    this.clearMonumentGhostWeb();
    const group = new Group();
    // Pulsing gold so the web reads as a placement target across both
    // day + night. Two materials shared by every tile in the web so we
    // only dispose two materials on clear.
    const fillMat = new MeshBasicMaterial({
      color: 0xffd84d, transparent: true, opacity: 0.20, depthWrite: false
    });
    const borderMat = new MeshBasicMaterial({
      color: 0xffd84d, transparent: true, opacity: 0.85, depthWrite: false
    });
    let any = false;
    for (const t of grid.iter()) {
      if (!readKind(t, kind)) continue;
      if (t.bigBuildBlockPaid) continue;   // already paid; renders construction site
      any = true;
      const cx = (t.x + 0.5) * TILE_SIZE;
      const cz = (t.y + 0.5) * TILE_SIZE;
      const y = t.elevation + 0.022;
      // Translucent fill across the tile
      const fill = new Mesh(new BoxGeometry(0.92 * TILE_SIZE, 0.005, 0.92 * TILE_SIZE), fillMat);
      fill.position.set(cx, y, cz);
      group.add(fill);
      // Four border strips for a clear boundary
      const bt = 0.04;
      const w = TILE_SIZE * 0.96;
      // North
      const n = new Mesh(new BoxGeometry(w, 0.008, bt), borderMat);
      n.position.set(cx, y + 0.003, cz - 0.48 * TILE_SIZE);
      group.add(n);
      // South
      const s = new Mesh(new BoxGeometry(w, 0.008, bt), borderMat);
      s.position.set(cx, y + 0.003, cz + 0.48 * TILE_SIZE);
      group.add(s);
      // West
      const ws = new Mesh(new BoxGeometry(bt, 0.008, w), borderMat);
      ws.position.set(cx - 0.48 * TILE_SIZE, y + 0.003, cz);
      group.add(ws);
      // East
      const e = new Mesh(new BoxGeometry(bt, 0.008, w), borderMat);
      e.position.set(cx + 0.48 * TILE_SIZE, y + 0.003, cz);
      group.add(e);
    }
    if (!any) {
      // No web to show — dispose the unused materials and bail.
      fillMat.dispose();
      borderMat.dispose();
      return;
    }
    this.ghostWebGroup = group;
    this.worldGroup.add(group);
  }
  clearMonumentGhostWeb(): void {
    if (!this.ghostWebGroup) return;
    this.worldGroup.remove(this.ghostWebGroup);
    // Materials are shared across every Mesh in the group — collect the
    // unique set for disposal so we don't double-dispose.
    const mats = new Set<MeshBasicMaterial>();
    for (const child of this.ghostWebGroup.children) {
      const mesh = child as Mesh;
      mesh.geometry.dispose();
      mats.add(mesh.material as MeshBasicMaterial);
    }
    for (const m of mats) m.dispose();
    this.ghostWebGroup = null;
  }

  /**
   * Re-anchor the shadow-casting sun above the camera target each frame.
   * `applyTimeOfDay` set sun.position to the absolute arc point (relative to
   * origin); we reuse that as a pure DIRECTION and translate the light to sit
   * over the player's view, sizing the ortho shadow frustum to the current
   * zoom. Directional lighting depends only on direction, so scene shading is
   * unchanged — only the shadow-map origin + coverage move.
   */
  private updateSunShadow(camera: Camera): void {
    if (!this.shadowsActive) return;
    // Re-derive the sun DIRECTION from the arc position applyTimeOfDay set,
    // then floor its elevation so the shadow caster stays high enough to keep
    // the depth range tight (the VISUAL sun colour/intensity still follows the
    // full day arc — only the shadow position is clamped, which is invisible).
    this.sunDir.copy(this.sunLight.position).normalize();
    // Clamp the shadow caster into a fixed elevation band so cast shadows are
    // a consistent, visible length all day (a near-overhead noon sun would
    // otherwise hide them; a near-horizon dawn sun would wreck precision).
    if (this.sunDir.y < SUN_SHADOW_MIN_ELEV || this.sunDir.y > SUN_SHADOW_MAX_ELEV) {
      this.sunDir.y = Math.max(SUN_SHADOW_MIN_ELEV, Math.min(SUN_SHADOW_MAX_ELEV, this.sunDir.y));
      this.sunDir.normalize();
    }
    const t = camera.target;
    this.sunLight.position.set(
      t.x + this.sunDir.x * SUN_SHADOW_DIST,
      t.y + this.sunDir.y * SUN_SHADOW_DIST,
      t.z + this.sunDir.z * SUN_SHADOW_DIST
    );
    this.sunLight.target.position.copy(t);
    this.sunLight.target.updateMatrixWorld();
    // Frustum half-extent tracks the zoom (capped), and near/far bracket the
    // scene TIGHTLY — the packed-depth shadow map only holds the shadow when
    // that range stays small. Re-derive only when the zoom changes.
    const r = Math.min(camera.orthoSize, SUN_SHADOW_MAX_ORTHO) * 1.6;
    if (r !== this.lastShadowR) {
      this.lastShadowR = r;
      const sc = this.sunLight.shadow.camera;
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r;
      // Scene depth spreads ~0.7·r along the sun (its horizontal projection)
      // plus the ~3-unit building height; bracket exactly that.
      const depthHalf = r * 0.7 + 4;
      sc.near = Math.max(1, SUN_SHADOW_DIST - depthHalf);
      sc.far = SUN_SHADOW_DIST + depthHalf;
      sc.updateProjectionMatrix();
    }
  }

  /** Set shadow cast/receive flags on a mesh or every Mesh under a group.
   *  No-op visually when shadowMap.enabled is false, so it's safe to call
   *  unconditionally at build sites. */
  private markShadows(obj: Object3D, cast: boolean, receive: boolean): void {
    obj.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = cast;
        o.receiveShadow = receive;
      }
    });
  }

  render(camera: Camera): void {
    this.updateSunShadow(camera);
    if (this.fxEnabled) {
      // Lazy-build the composer the first time we render with FX on — we
      // need the camera, which only arrives here. Sized to the last known
      // viewport.
      if (!this.postfx) {
        this.postfx = new PostFX(this.three, this.scene, camera.three, this.fxConfig);
        this.postfx.setSize(this.viewW, this.viewH);
      }
      this.postfx.render();
    } else {
      this.three.render(this.scene, camera.three);
    }
  }

  /** Toggle the post-processing pipeline (Beta 1.9). Off = the exact
   *  pre-1.9 direct-render path. The composer is kept once built so
   *  flipping back on is instant. */
  setFxEnabled(on: boolean): void {
    this.fxEnabled = on;
  }

  isFxEnabled(): boolean {
    return this.fxEnabled;
  }

  /** Live-tune the FX config from the dev console, e.g.
   *  `game.renderer.tuneFx({ bloomStrength: 0.6, tiltShiftBlurPixels: 9 })`.
   *  Builds the composer on demand so tuning works even before first paint. */
  tuneFx(partial: Partial<PostFXConfig>): void {
    Object.assign(this.fxConfig, partial);
    this.postfx?.tune(partial);
  }

  getFxConfig(): Readonly<PostFXConfig> {
    return this.fxConfig;
  }

  /**
   * Beta 1.7 — live GPU-resource accounting for the dev overlay (?dev=1).
   * `this.three.info` is maintained by Three.js itself: `memory.geometries`
   * and `memory.textures` are the authoritative count of GPU resources
   * currently alive (they go UP on upload, DOWN on .dispose()). Watching
   * `geometries` for monotonic growth across a play session is the
   * disposal-audit canary — a healthy renderer holds steady after the
   * scene stabilises. `render.calls` / `render.triangles` are the last
   * frame's draw cost. Zero allocation; just reads counters. */
  perfInfo(): { geometries: number; textures: number; calls: number; triangles: number } {
    const info = this.three.info;
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      calls: info.render.calls,
      triangles: info.render.triangles
    };
  }

  /**
   * Apply day/night phase (Alpha 2.14, retuned in 3.0.1). `phase` ∈ [0, 1]:
   *   0 / 1 = midnight, 0.5 = noon. Day runs ~70% of the cycle, night ~30%.
   * The input phase is warped through a piecewise-linear map before the sun
   * arc math so dawn lands at p ≈ 0.15 and dusk at p ≈ 0.85 — without
   * changing the underlying sin-based sun position formula.
   */
  applyTimeOfDay(phase: number): void {
    const p = ((phase % 1) + 1) % 1;
    // Phase warp (Alpha 3.0.1): stretch the [0.15, 0.85] day-window so it
    // covers 70% of the input cycle and the [0, 0.15] ∪ [0.85, 1] night
    // bands cover 30%. The warped value flows directly into the existing
    // sin-based sun arc, so dawn/dusk transitions stay smooth.
    const warped = warpDayPhase(p);
    // Sun arc: rotates around the world over a day. Project onto a
    // tilted axis so dawn/dusk hit a low angle and noon goes overhead.
    const angle = (warped - 0.25) * Math.PI * 2; // -π/2 at midnight, 0 at dawn, π/2 at noon, π at dusk
    const radius = 80;
    const sunX = Math.cos(angle) * radius;
    const sunY = Math.sin(angle) * radius;
    const sunZ = 30;
    this.sunLight.position.set(sunX, Math.max(-30, sunY), sunZ);
    // Day = 0.25..0.75 (sun above horizon).
    const dayMix = sunY > 0 ? Math.min(1, sunY / 50) : 0;
    // Theme-driven sky + lighting (Beta 1.2). Stock = original constants;
    // Coastal Pastel ships warmer sun colours + brighter day intensity +
    // pastel hemisphere tones + gentle haze fog.
    const atm = THEME().atmosphere;
    // Sun colour: warm at dawn/dusk, white at noon, cool dim at night.
    const sunColor = lerpHexColor(
      atm.sunColorNight,
      lerpHexColor(atm.sunColorWarm, atm.sunColorNoon, dayMix),
      Math.min(1, Math.max(0, sunY / 40))
    );
    this.sunLight.color.setHex(sunColor);
    // Shadow-aware key/fill rebalance (Beta 1.9): real cast shadows only read
    // if the ambient/hemisphere fill doesn't drown them. When shadows are
    // active we shift ~30% of the fill into the directional key — but ONLY in
    // proportion to how much sun there is (scaled by dayMix), so the carefully
    // tuned night look is untouched and `?fx=0` is a perfect no-op.
    // Shift a big chunk of the ambient/hemisphere FILL into the directional
    // KEY when shadows are active, scaled by how much sun there is (dayMix).
    // This is what makes the cast shadows actually READ: a shadowed face
    // loses the (now-dominant) sun term and drops to ~45% brightness instead
    // of blending into the soft fill. Night (dayMix→0) is untouched.
    const shadowStrength = this.shadowsActive ? dayMix : 0;
    const fillMul = 1 - 0.50 * shadowStrength;
    const keyMul = 1 + 0.50 * shadowStrength;
    this.sunLight.intensity = (atm.sunIntensityNight + dayMix * (atm.sunIntensityDay - atm.sunIntensityNight)) * keyMul;
    this.ambientLight.intensity = (atm.ambientIntensityNight + dayMix * (atm.ambientIntensityDay - atm.ambientIntensityNight)) * fillMul;
    this.hemisphereLight.intensity = (0.20 + dayMix * 0.40) * fillMul;
    // Hemisphere sky/ground tint: shift cooler at night.
    if (dayMix < 0.05) {
      this.hemisphereLight.color.setHex(atm.hemiSkyNight);
      this.hemisphereLight.groundColor.setHex(atm.hemiGroundNight);
    } else {
      this.hemisphereLight.color.setHex(atm.hemiSkyDay);
      this.hemisphereLight.groundColor.setHex(atm.hemiGroundDay);
    }
    // Repaint sky gradient. Use the WARPED phase too so the sky shifts
    // in lockstep with the sun (otherwise night sky would show during a
    // mid-day visual). Beta 1.7 — gate the repaint on a phase-change
    // epsilon. applyTimeOfDay runs every frame, but a full day cycle is
    // ~8 min real-time, so the warped phase barely moves frame-to-frame.
    // Repainting unconditionally forced a GPU re-upload of the sky
    // CanvasTexture 60×/sec for no visible benefit; gating drops that to
    // ~1-2 Hz (still smoother than the eye can track on a slow gradient).
    // lastSkyPhase is reset to NaN on theme change so the new palette
    // always repaints on the next frame.
    if (Number.isNaN(this.lastSkyPhase) || Math.abs(warped - this.lastSkyPhase) >= 0.0006) {
      repaintSkyGradient(this.skyTexture, warped, atm);
      this.lastSkyPhase = warped;
    }
    // Update night-overlay opacity based on darkness amount. Three
    // independently-controllable overlays (Alpha 3.1.6):
    //  - nightLightsMesh: visible lamp fixtures (poles + bulbs).
    //  - lampGlowMesh: smooth radial glow pools spilling onto the ground.
    //  - litWindowsMesh: lit windows on developed buildings.
    const nightOpacity = Math.max(0, Math.min(1, 1 - dayMix * 2.5));
    if (this.nightLightsMesh) {
      const mat = this.nightLightsMesh.material as MeshBasicMaterial;
      mat.opacity = nightOpacity * 0.85;
      this.nightLightsMesh.visible = nightOpacity > 0.01;
    }
    if (this.lampGlowMesh) {
      const mat = this.lampGlowMesh.material as MeshBasicMaterial;
      // Slightly dim overall (Alpha 3.1.8) so overlapping lamp pools
      // don't wash out the road surface they sit on.
      mat.opacity = nightOpacity * 0.75;
      this.lampGlowMesh.visible = nightOpacity > 0.01;
    }
    if (this.litWindowsMesh) {
      const mat = this.litWindowsMesh.material as MeshBasicMaterial;
      // Lit windows are subtle in twilight, full at deep night.
      // Beta 1.6.8: bumped 0.85 → 0.95 so the high-density skyline
      // reads as alive from across the map.
      mat.opacity = nightOpacity * 0.95;
      this.litWindowsMesh.visible = nightOpacity > 0.01;
    }
  }

  private disposeMesh(m: Mesh | null): void {
    if (!m) return;
    this.worldGroup.remove(m);
    m.geometry.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) for (const x of mat) x.dispose();
    else mat.dispose();
  }

  /**
   * Full theme repaint (Beta 1.2). Called when the active theme changes
   * mid-game — drops every cached mesh, re-derives global atmosphere
   * (clear colour, fog, sky), and rebuilds the world from scratch with
   * the new palette.
   *
   * Cheap-ish: each rebuild path is the same one we run on a paint
   * action, just all together. Even on a Capital-tier city the full
   * sweep is comfortably under 200 ms on a mid-range device.
   */
  refreshTheme(grid: Grid, cityMood = 0, monthsElapsed = 0, forestryHealth = 1, farmHealth = 1): void {
    const _atm = THEME().atmosphere;
    this.three.setClearColor(THEME().terrain.clearColor);
    // Re-derive fog: install / update / clear based on the active theme.
    if (_atm.fog) {
      const existing = this.scene.fog;
      if (existing instanceof FogExp2) {
        existing.color.setHex(_atm.fog.color);
        existing.density = _atm.fog.density;
      } else {
        this.scene.fog = new FogExp2(_atm.fog.color, _atm.fog.density);
      }
    } else if (this.scene.fog) {
      this.scene.fog = null;
    }
    // Force a sky repaint at the current phase so the gradient picks up
    // the new keyframes immediately rather than waiting for the next
    // applyTimeOfDay tick.
    repaintSkyGradient(this.skyTexture, 0.5, _atm);
    // Beta 1.7 — invalidate the sky-phase cache so the next applyTimeOfDay
    // frame repaints with the new theme's keyframes at the true phase
    // (this 0.5 paint is just a placeholder until then).
    this.lastSkyPhase = NaN;
    // Rebuild every world mesh — terrain, zones, paths, roads, buildings,
    // services, beautification. Order matches Game.init's first draw
    // pass so the worldGroup ends up in the same state.
    this.drawWorld(grid);
    this.drawZones(grid);
    this.drawPaths(grid);
    this.drawRoads(grid);
    this.drawBuildings(grid, cityMood, monthsElapsed);
    this.drawCityBuildings(grid, forestryHealth, farmHealth);
    if (this.beautificationProvider) {
      this.drawBeautification(grid, this.beautificationProvider());
    }
  }
}
