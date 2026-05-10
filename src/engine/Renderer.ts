import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer
} from 'three';
import type { Camera } from './Camera';
import type { Grid } from '../world/Grid';
import { buildLuxuryParts, buildSkyscraperParts, buildVariantParts, getSkyscraperDesign } from './BuildingVariants';
import {
  DIR_OFFSETS,
  MAX_PEDESTRIANS,
  MAX_VEHICLES,
  PATH_COLOR,
  PATH_LIFT,
  PATH_WIDTH,
  BRIDGE_LIFT,
  ROAD_LIFT,
  ROAD_TIER,
  SIDEWALK_COLOR,
  SIDEWALK_LIFT,
  SIDEWALK_PAD,
  TILE_SIZE,
  ZONE_COLORS,
  ZONE_LIFT,
  type TerrainType,
  type Zone
} from '../types';
import type { Buses } from '../simulation/Buses';
import type { Pedestrians } from '../simulation/Pedestrians';
import type { Vehicles } from '../simulation/Vehicles';

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
 */
const TERRAIN_COLORS: Record<TerrainType, number> = {
  // Slight ground-tone variation by terrain. Grass is the alpha-1 colour.
  // Forest is darker green so cone-trees pop. Water is a richer blue
  // (Alpha 2.3 — the old 0x3a7ec2 felt washed out next to land). Sand
  // is the alpha-1 dune colour.
  grass: 0x6aa84f,
  forest: 0x4d8442,
  water: 0x2c6fa8,
  sand: 0xddc174
};

/** Slight tint applied to elevated tiles so hills aren't pure flat colour. */
const HILL_HIGHLIGHT = 0x7bb558;
/** Darker shade for valley floors / shaded grass. */
const VALLEY_TINT = 0x5d9744;

const ROAD_LANE = 0xf2cd5c;
const SELECTION_COLOR = 0xffd84d;
const TREE_TRUNK = 0x6e3e1d;
const TREE_LEAF = 0x2f6a2d;
/** Subtle dark green shadow disc under each tree (Alpha 2.6). */
const TREE_SHADOW = 0x2a3a22;
const HIGHWAY_ARROW_COLOR = 0xf2cd5c;
const STOP_SIGN_COLOR = 0xc83838;
const STOP_SIGN_TEXT = 0xffffff;

export class Renderer {
  readonly scene = new Scene();
  readonly three: WebGLRenderer;

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
  /** One Group containing per-kind city building Mesh objects. Rebuilt on change. */
  private readonly cityBuildingsGroup = new Group();
  private heatmapMesh: Mesh | null = null;
  /** Day/night cycle (Alpha 2.14) — mutated by applyTimeOfDay each frame. */
  private skyTexture!: CanvasTexture;
  private ambientLight!: AmbientLight;
  private hemisphereLight!: HemisphereLight;
  private sunLight!: DirectionalLight;
  private carsMesh: InstancedMesh;
  private busesMesh: InstancedMesh;
  private ferriesMesh!: InstancedMesh;
  private pedestriansMesh: InstancedMesh;
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
    this.three.setClearColor(0x1a2722);

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
    this.ambientLight = new AmbientLight(0xffffff, 0.55);
    this.scene.add(this.ambientLight);
    this.hemisphereLight = new HemisphereLight(0xbcd9ff, 0x223322, 0.45);
    this.scene.add(this.hemisphereLight);
    this.sunLight = new DirectionalLight(0xffffff, 0.85);
    this.sunLight.position.set(40, 80, 30);
    this.scene.add(this.sunLight);

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
    this.carsMesh = new InstancedMesh(carGeom, carMat, MAX_VEHICLES);
    this.carsMesh.count = 0;
    this.carsMesh.frustumCulled = false;
    this.worldGroup.add(this.carsMesh);

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

    // Pedestrians — tiny vertical box (a "pawn") sized to read at the
    // 3/4 ortho zoom without dominating the road. Per-instance colour set
    // each frame from PEDESTRIAN_PALETTE.
    const pedGeom = new BoxGeometry(0.09, 0.16, 0.09);
    pedGeom.translate(0, 0.08, 0);
    const pedMat = new MeshLambertMaterial({ flatShading: true });
    this.pedestriansMesh = new InstancedMesh(pedGeom, pedMat, MAX_PEDESTRIANS);
    this.pedestriansMesh.count = 0;
    this.pedestriansMesh.frustumCulled = false;
    this.worldGroup.add(this.pedestriansMesh);

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
  }

  /** Build (or rebuild) the static terrain mesh + tree instances. */
  drawWorld(grid: Grid): void {
    this.disposeMesh(this.terrainMesh);
    this.terrainMesh = buildTerrainMesh(grid);
    this.worldGroup.add(this.terrainMesh);

    if (this.treesMesh) {
      this.worldGroup.remove(this.treesMesh);
      this.treesMesh.geometry.dispose();
      (this.treesMesh.material as MeshLambertMaterial).dispose?.();
    }
    this.treesMesh = buildTreesMesh(grid);
    if (this.treesMesh) this.worldGroup.add(this.treesMesh);
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
   *  that's not yet owned. Mesh is rebuilt whenever zones rebuild. */
  private unownedMesh: Mesh | null = null;
  drawUnownedLand(grid: Grid): void {
    if (this.unownedMesh) {
      this.worldGroup.remove(this.unownedMesh);
      this.unownedMesh.geometry.dispose();
      (this.unownedMesh.material as MeshLambertMaterial).dispose();
      this.unownedMesh = null;
    }
    const built = buildUnownedLandMesh(grid);
    if (built) {
      this.unownedMesh = built;
      this.worldGroup.add(this.unownedMesh);
    }
  }

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
    if (built) this.cityBuildingsGroup.add(built);
    // Refresh night-lights — park lamps depend on park placements.
    this.drawNightLights(grid);
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

  /** Rebuild the buildings InstancedMesh from current tile densities.
   *  `monthsElapsed` drives the Alpha 2.16 patina pass — older buildings
   *  read darker. Defaults to 0 (pre-history; everything looks new). */
  drawBuildings(grid: Grid, cityMood = 0, monthsElapsed = 0): void {
    if (this.buildingsMesh) {
      this.worldGroup.remove(this.buildingsMesh);
      this.buildingsMesh.geometry.dispose();
      (this.buildingsMesh.material as MeshLambertMaterial).dispose();
      this.buildingsMesh = null;
    }
    const built = buildBuildingsMesh(grid, cityMood, monthsElapsed);
    if (built) {
      this.buildingsMesh = built;
      this.worldGroup.add(this.buildingsMesh);
    }
    // Skyscrapers — separate mesh (Alpha 3.1.7) so opacity can be faded
    // on zoom. Same rebuild cadence as the main buildings layer.
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
      this.applyCameraZoom(this.currentOrthoSize);
    }
    // Lit-window overlay (Alpha 3.1.6) is a sibling layer of the buildings
    // mesh — same dirty triggers, same rebuild cadence.
    this.drawLitWindows(grid);
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
    }
  }

  private disposeGroup(g: Group): void {
    while (g.children.length > 0) {
      const c = g.children[0]!;
      g.remove(c);
      if (c instanceof Mesh) {
        c.geometry.dispose();
        const mat = c.material;
        if (Array.isArray(mat)) for (const m of mat) m.dispose();
        else (mat as MeshLambertMaterial).dispose();
      }
    }
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
    for (let i = 0; i < vehicles.cars.length; i++) {
      const car = vehicles.cars[i]!;
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
      obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      this.carsMesh.setMatrixAt(i, obj.matrix);
      c.setHex(car.color);
      this.carsMesh.setColorAt(i, c);
    }
    this.carsMesh.count = vehicles.cars.length;
    if (vehicles.cars.length > 0) {
      this.carsMesh.instanceMatrix.needsUpdate = true;
      if (this.carsMesh.instanceColor) this.carsMesh.instanceColor.needsUpdate = true;
    }
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
      obj.position.set(
        (ax + dx * t + px * off) * TILE_SIZE,
        yA + (yB - yA) * t + 0.005,
        (az + dz * t + pz * off) * TILE_SIZE
      );
      obj.rotation.set(0, Math.atan2(dx, dz), 0);
      obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      this.pedestriansMesh.setMatrixAt(visible, obj.matrix);
      c.setHex(w.color);
      this.pedestriansMesh.setColorAt(visible, c);
      visible++;
    }
    this.pedestriansMesh.count = visible;
    if (visible > 0) {
      this.pedestriansMesh.instanceMatrix.needsUpdate = true;
      if (this.pedestriansMesh.instanceColor) this.pedestriansMesh.instanceColor.needsUpdate = true;
    }
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
      c.setHex(bus.color);
      this.busesMesh.setColorAt(visible, c);
      visible++;
    }
    this.busesMesh.count = visible;
    if (visible > 0) {
      this.busesMesh.instanceMatrix.needsUpdate = true;
      if (this.busesMesh.instanceColor) this.busesMesh.instanceColor.needsUpdate = true;
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

  render(camera: Camera): void {
    this.three.render(this.scene, camera.three);
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
    // Sun colour: warm at dawn/dusk, white at noon, cool dim at night.
    const sunColor = lerpHexColor(
      0x4060c0,                         // night
      lerpHexColor(0xf0a060, 0xffffff, dayMix), // dawn/dusk → noon
      Math.min(1, Math.max(0, sunY / 40))
    );
    this.sunLight.color.setHex(sunColor);
    this.sunLight.intensity = 0.18 + dayMix * 0.85;
    this.ambientLight.intensity = 0.20 + dayMix * 0.45;
    this.hemisphereLight.intensity = 0.20 + dayMix * 0.40;
    // Hemisphere sky/ground tint: shift cooler at night.
    if (dayMix < 0.05) {
      this.hemisphereLight.color.setHex(0x303860);
      this.hemisphereLight.groundColor.setHex(0x101820);
    } else {
      this.hemisphereLight.color.setHex(0xbcd9ff);
      this.hemisphereLight.groundColor.setHex(0x223322);
    }
    // Repaint sky gradient. Use the WARPED phase too so the sky shifts
    // in lockstep with the sun (otherwise night sky would show during a
    // mid-day visual).
    repaintSkyGradient(this.skyTexture, warped);
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
      mat.opacity = nightOpacity * 0.85;
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
}

// --- Terrain ------------------------------------------------------------

function buildTerrainMesh(grid: Grid): Mesh {
  // Vertex-coloured plane covering the whole grid (Alpha 2.3 — corner
  // vertices average elevation across the up-to-4 tiles meeting there
  // so hills slope smoothly instead of stair-stepping). Each tile is
  // still 4 unique vertices so per-tile colour can vary, but Y values
  // are derived from the shared corner average, giving the visual of
  // shared corners without losing per-tile colour control.
  const totalTiles = grid.width * grid.height;
  const positions = new Float32Array(totalTiles * 4 * 3);
  const colours = new Float32Array(totalTiles * 4 * 3);
  const indices = new Uint32Array(totalTiles * 6);
  const c = new Color();

  // Pre-compute corner elevations: corner (cx, cy) sits at the meeting
  // of tiles (cx-1, cy-1), (cx, cy-1), (cx-1, cy), (cx, cy). Average
  // their elevations (treating off-map as 0).
  const cornerElev = (cx: number, cy: number): number => {
    let sum = 0;
    let n = 0;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      sum += grid.get(nx, ny)!.elevation;
      n++;
    }
    return n === 0 ? 0 : sum / n;
  };

  let vi = 0;
  let ii = 0;
  let v = 0;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const tile = grid.get(x, y)!;
      // Tint by elevation: brighten hilltops, darken valleys for grass
      // so terrain reads as 3D even on flat-shaded vertex colours.
      const baseHex = TERRAIN_COLORS[tile.terrain] ?? TERRAIN_COLORS.grass;
      if (tile.terrain === 'grass' && tile.elevation > 0.10) {
        c.setHex(HILL_HIGHLIGHT);
      } else if (tile.terrain === 'grass' && tile.elevation < -0.02) {
        c.setHex(VALLEY_TINT);
      } else {
        c.setHex(baseHex);
      }

      const x0 = x * TILE_SIZE;
      const x1 = (x + 1) * TILE_SIZE;
      const z0 = y * TILE_SIZE;
      const z1 = (y + 1) * TILE_SIZE;
      // Four corner elevations (averaged across neighbours).
      const yNW = cornerElev(x,     y);
      const yNE = cornerElev(x + 1, y);
      const ySE = cornerElev(x + 1, y + 1);
      const ySW = cornerElev(x,     y + 1);

      positions[vi++] = x0; positions[vi++] = yNW; positions[vi++] = z0;
      positions[vi++] = x1; positions[vi++] = yNE; positions[vi++] = z0;
      positions[vi++] = x1; positions[vi++] = ySE; positions[vi++] = z1;
      positions[vi++] = x0; positions[vi++] = ySW; positions[vi++] = z1;

      for (let i = 0; i < 4; i++) {
        colours[v * 3 + i * 3 + 0] = c.r;
        colours[v * 3 + i * 3 + 1] = c.g;
        colours[v * 3 + i * 3 + 2] = c.b;
      }

      // CCW from above so normals point +Y (up) and the face survives
      // back-face culling against the camera that's looking down.
      indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
      indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
      v += 4;
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normal computation (Alpha 2.5 perf pass).

  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(geom, mat);
}

// --- Trees --------------------------------------------------------------

function buildTreesMesh(grid: Grid): Mesh | null {
  // Tree variety (Alpha 2.2). Each forest tile deterministically picks
  // one of three silhouettes:
  //   0 — cone tree: broad single cone on a stout trunk (the original)
  //   1 — pine tree: narrow tall cone with a stacked smaller cone
  //   2 — round tree: low sphere-ish foliage on a short trunk
  // Plus subtle per-tile variation in trunk height, leaf scale, and
  // foliage tint so a forest reads as woodland rather than a uniform
  // stamp pattern.
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];
  for (const t of grid.iter()) {
    if (t.terrain !== 'forest') continue;
    const r = Math.abs(((t.x * 374761393) ^ (t.y * 668265263)) | 0);
    const ox = ((r % 1000) / 1000 - 0.5) * 0.4;
    const oz = (((r >> 10) % 1000) / 1000 - 0.5) * 0.4;
    const rot = ((r >> 20) % 1000) / 1000 * Math.PI * 2;
    const variant = (r >> 8) % 3;
    // Scale wobble: 0.85..1.15 — keeps the forest visually loose.
    const scale = 0.85 + ((r >> 14) & 0xFF) / 255 * 0.30;
    // Leaf tint variation — three closely related greens.
    const leafTints = [TREE_LEAF, 0x3a7a3a, 0x4a8e3a];
    const leafColor = leafTints[(r >> 22) % leafTints.length]!;
    const cx = (t.x + 0.5) * TILE_SIZE + ox;
    const cz = (t.y + 0.5) * TILE_SIZE + oz;

    // Shadow disc (Alpha 2.6 visual pass) — slim dark octagonal pad
    // under each tree at the terrain surface. Reads as a soft cast
    // shadow without the cost of a real shadow map. Sits 0.005 above
    // tile elevation to avoid z-fighting with the terrain mesh.
    const shadowR = 0.32 * scale;
    const shadow = new CylinderGeometry(shadowR, shadowR * 0.92, 0.005, 8);
    shadow.translate(cx, t.elevation + 0.0035, cz);
    geoms.push(shadow); colours.push(TREE_SHADOW);

    if (variant === 0) {
      // Cone tree
      const trunkH = 0.18 * scale;
      const leafH = 0.55 * scale;
      const trunk = new CylinderGeometry(0.055 * scale, 0.06 * scale, trunkH, 6);
      trunk.translate(0, trunkH / 2, 0);
      trunk.rotateY(rot);
      trunk.translate(cx, 0, cz);
      geoms.push(trunk); colours.push(TREE_TRUNK);
      const leaves = new ConeGeometry(0.28 * scale, leafH, 8);
      leaves.translate(0, trunkH + leafH / 2, 0);
      leaves.rotateY(rot);
      leaves.translate(cx, 0, cz);
      geoms.push(leaves); colours.push(leafColor);
    } else if (variant === 1) {
      // Pine — taller, narrower, two stacked cones for a layered look.
      const trunkH = 0.16 * scale;
      const trunk = new CylinderGeometry(0.04 * scale, 0.05 * scale, trunkH, 6);
      trunk.translate(0, trunkH / 2, 0);
      trunk.rotateY(rot);
      trunk.translate(cx, 0, cz);
      geoms.push(trunk); colours.push(TREE_TRUNK);
      const lowerH = 0.40 * scale;
      const lower = new ConeGeometry(0.22 * scale, lowerH, 8);
      lower.translate(0, trunkH + lowerH / 2, 0);
      lower.rotateY(rot);
      lower.translate(cx, 0, cz);
      geoms.push(lower); colours.push(leafColor);
      const upperH = 0.30 * scale;
      const upper = new ConeGeometry(0.15 * scale, upperH, 8);
      upper.translate(0, trunkH + lowerH * 0.7 + upperH / 2, 0);
      upper.rotateY(rot);
      upper.translate(cx, 0, cz);
      geoms.push(upper); colours.push(leafColor);
    } else {
      // Round / oak-style tree — short trunk, octahedral foliage.
      const trunkH = 0.14 * scale;
      const trunk = new CylinderGeometry(0.06 * scale, 0.07 * scale, trunkH, 6);
      trunk.translate(0, trunkH / 2, 0);
      trunk.rotateY(rot);
      trunk.translate(cx, 0, cz);
      geoms.push(trunk); colours.push(TREE_TRUNK);
      // Octahedron — sphere-ish low-poly leaf cluster.
      const leafR = 0.30 * scale;
      const leaves = new ConeGeometry(leafR, leafR * 1.6, 6);
      leaves.translate(0, trunkH + leafR * 0.8, 0);
      leaves.rotateY(rot);
      leaves.translate(cx, 0, cz);
      geoms.push(leaves); colours.push(leafColor);
      // Second offset blob for a fuller crown.
      const blob = new ConeGeometry(leafR * 0.7, leafR * 1.2, 6);
      blob.translate(leafR * 0.3, trunkH + leafR * 0.8, leafR * 0.2);
      blob.rotateY(rot);
      blob.translate(cx, 0, cz);
      geoms.push(blob); colours.push(leafColor);
    }
  }
  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(merged, mat);
}

/**
 * Merge a batch of source geometries into one BufferGeometry, vertex-
 * painting each source with its colour from `colours[]`. All consumers of
 * this function attach a `flatShading: true` material, so we deliberately
 * skip the normal attribute and `computeVertexNormals` — Three.js's flat-
 * shading fragment shader derives the face normal via dFdx/dFdy of the
 * view-space position, leaving any precomputed normals unread. Skipping
 * them saves CPU per rebuild AND GPU memory + upload bandwidth per draw.
 */
function mergeGeoms(geoms: BufferGeometry[], colours: number[]): BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geoms) {
    totalVerts += g.getAttribute('position').count;
    const idx = g.getIndex();
    totalIndices += idx ? idx.count : g.getAttribute('position').count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const cols = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vOff = 0;
  let iOff = 0;
  const c = new Color();
  for (let gi = 0; gi < geoms.length; gi++) {
    const g = geoms[gi]!;
    const p = g.getAttribute('position');
    const idx = g.getIndex();
    c.setHex(colours[gi]!);

    for (let i = 0; i < p.count; i++) {
      positions[(vOff + i) * 3 + 0] = p.getX(i);
      positions[(vOff + i) * 3 + 1] = p.getY(i);
      positions[(vOff + i) * 3 + 2] = p.getZ(i);
      cols[(vOff + i) * 3 + 0] = c.r;
      cols[(vOff + i) * 3 + 1] = c.g;
      cols[(vOff + i) * 3 + 2] = c.b;
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[iOff + i] = idx.getX(i) + vOff;
      }
      iOff += idx.count;
    } else {
      for (let i = 0; i < p.count; i++) indices[iOff + i] = vOff + i;
      iOff += p.count;
    }
    vOff += p.count;
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(positions, 3));
  out.setAttribute('color', new BufferAttribute(cols, 3));
  out.setIndex(new BufferAttribute(indices, 1));
  // Dispose source geometries — their buffers are now copied into `out`.
  for (const g of geoms) g.dispose();
  return out;
}

// --- Buildings ----------------------------------------------------------

/**
 * Build the merged buildings mesh from the variant catalogue (Alpha 2.1).
 *
 * Each developed tile picks one of three variants per (zone, density)
 * deterministically from its (x, y) hash, so the mix is consistent
 * across reloads. {@link buildVariantParts} returns world-positioned
 * BufferGeometry parts (already scaled, rotated, and translated to the
 * tile centre); we accumulate every part across every developed tile and
 * fuse them into a single vertex-coloured Mesh.
 *
 * Why merge instead of per-variant InstancedMesh: variants compose 1-5
 * primitives each, so a city of ~1000 tiles produces ~3000 primitives.
 * One merged mesh is a single draw call versus 36 InstancedMeshes that
 * each do small-N batches. Rebuild cost is comparable to the previous
 * single-InstancedMesh approach (sub-millisecond on Small/Medium).
 */
function buildBuildingsMesh(grid: Grid, cityMood: number, monthsElapsed: number): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];
  // Per-tile lift = ROAD_LIFT/2 (avoid z-fighting with zone overlay)
  // PLUS the tile's terrain elevation (Alpha 2.3) so buildings sit on
  // the actual hill rather than buried in it.
  const baseLift = ROAD_LIFT * 0.5;
  // City mood is in [-1, +1]; lift to [0, 1] base.
  const moodBase = (cityMood + 1) * 0.5;
  for (const t of grid.iter()) {
    if (t.zone === 'none' || t.road) continue;
    // Luxury (Alpha 2.5): a 2-tile pair renders as one mansion. Emit only
    // from the lex-smaller tile of the pair (lower x, then lower y) so we
    // don't double-render. The mansion body extends into the partner.
    // Luxury homes are NEVER modulated by happiness — they always look
    // pristine per spec (Alpha 2.7).
    if (t.luxury && t.zone === 'residential') {
      const partner = findLuxuryPartner(grid, t.x, t.y);
      if (!partner) continue; // orphan — render nothing
      // Lex order: lower x wins; tie → lower y wins.
      if (t.x > partner.x || (t.x === partner.x && t.y > partner.y)) continue;
      const parts = buildLuxuryParts(t.x, t.y, partner.x, partner.y);
      const yLift = baseLift + t.elevation;
      for (const p of parts) {
        if (TILE_SIZE !== 1) p.geom.scale(TILE_SIZE, TILE_SIZE, TILE_SIZE);
        if (yLift !== 0) p.geom.translate(0, yLift, 0);
        geoms.push(p.geom);
        colours.push(p.color);
      }
      continue;
    }
    // Skyscrapers (Alpha 3.1.2) live in their own mesh now (Alpha 3.1.7)
    // so we can fade them when the camera zooms in. Skip them in the
    // main building mesh — `buildSkyscrapersMesh` handles them.
    if (t.skyscraper) continue;
    if (t.density === 0) continue;
    // Per-tile happiness (Alpha 2.7): city mood, nudged by services. Tiles
    // with park coverage feel better; tiles missing power/water feel worse.
    let happy = moodBase;
    if (t.hasPark) happy += 0.10;
    if (!t.hasPower) happy -= 0.20;
    if (!t.hasWater) happy -= 0.15;
    happy = Math.max(0, Math.min(1, happy));
    // Patina (Alpha 2.16): newer buildings stay vibrant, older ones
    // dim toward a weathered tone over the first decade. The factor is
    // sampled once per tile and applied to every part's color so a single
    // building reads consistently weathered (rather than a roof aging
    // faster than its walls).
    const ageMonths = Math.max(0, monthsElapsed - t.developedAt);
    const patina = patinaFactor(ageMonths);
    const parts = buildVariantParts(t.zone, t.density, t.x, t.y, happy);
    const yLift = baseLift + t.elevation;
    for (const p of parts) {
      if (TILE_SIZE !== 1) p.geom.scale(TILE_SIZE, TILE_SIZE, TILE_SIZE);
      if (yLift !== 0) p.geom.translate(0, yLift, 0);
      geoms.push(p.geom);
      colours.push(patina < 1 ? darkenHex(p.color, patina) : p.color);
    }
  }
  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(merged, mat);
}

/** Build the skyscraper mesh separately (Alpha 3.1.7) so we can fade
 *  its material when the camera zooms in. Walks anchors and emits their
 *  parts the same way the main builder used to. Returns null if no
 *  skyscrapers. */
function buildSkyscrapersMesh(grid: Grid): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];
  const baseLift = ROAD_LIFT * 0.5;
  for (const t of grid.iter()) {
    if (!t.skyscraper) continue;
    if (!isSkyscraperAnchor(grid, t.x, t.y)) continue;
    const parts = buildSkyscraperParts(
      t.x, t.y, t.zone as 'residential' | 'commercial' | 'mixed',
      t.skyscraperVariant, t.skyscraperStage
    );
    const yLift = baseLift + t.elevation;
    for (const p of parts) {
      if (TILE_SIZE !== 1) p.geom.scale(TILE_SIZE, TILE_SIZE, TILE_SIZE);
      if (yLift !== 0) p.geom.translate(0, yLift, 0);
      geoms.push(p.geom);
      colours.push(p.color);
    }
  }
  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: 1.0
  });
  return new Mesh(merged, mat);
}

/**
 * Patina ramp (Alpha 2.16). Returns a 0..1 multiplier applied to building
 * vertex colors so older buildings read as weathered.
 *
 * - 0 months   → 1.00 (pristine)
 * - 12 months  → ~0.95
 * - 60 months  → ~0.85
 * - 180 months → 0.72 (asymptote)
 *
 * Cap at 0.72 so even a 50-year city still reads as a city, not a ruin.
 * Single ramp covers low / medium / high density; the visual delta is
 * subtle on L1 cottages and meaningful on L3 towers because the high
 * density palettes start brighter.
 */
function patinaFactor(ageMonths: number): number {
  const FLOOR = 0.72;
  const RAMP_MONTHS = 180;
  if (ageMonths <= 0) return 1.0;
  if (ageMonths >= RAMP_MONTHS) return FLOOR;
  return 1.0 - (1.0 - FLOOR) * (ageMonths / RAMP_MONTHS);
}

/** Multiply each RGB channel of a packed 0xRRGGBB by `factor`, return a new
 *  packed colour. Channels are clamped at 0; factor < 1 darkens. */
function darkenHex(hex: number, factor: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 0xff) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 0xff) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 0xff) * factor)));
  return (r << 16) | (g << 8) | b;
}

/** First 4-neighbour with `luxury && zone==='residential'`, else null. */
function findLuxuryPartner(grid: Grid, x: number, y: number): { x: number; y: number } | null {
  const dirs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [dx, dy] of dirs) {
    const n = grid.get(x + dx, y + dy);
    if (n && n.luxury && n.zone === 'residential') return { x: n.x, y: n.y };
  }
  return null;
}

/** Anchor check for skyscraper 2×2 footprint (Alpha 3.1.2). The anchor
 *  is the lex-smallest of the four — same logic as Skyscrapers.isAnchor
 *  but inlined so the renderer doesn't need the simulation import. */
function isSkyscraperAnchor(grid: Grid, x: number, y: number): boolean {
  const t = grid.get(x, y);
  if (!t || !t.skyscraper) return false;
  const cmp = (px: number, py: number): boolean => {
    const p = grid.get(px, py);
    return !!(p && p.skyscraper && p.zone === t.zone && p.skyscraperVariant === t.skyscraperVariant);
  };
  if (cmp(x - 1, y)) return false;
  if (cmp(x, y - 1)) return false;
  if (cmp(x - 1, y - 1)) return false;
  if (!cmp(x + 1, y) || !cmp(x, y + 1) || !cmp(x + 1, y + 1)) return false;
  return true;
}

// --- Traffic heatmap ----------------------------------------------------

function buildHeatmapMesh(grid: Grid): Mesh | null {
  let count = 0;
  for (const t of grid.iter()) if (t.road) count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color();
  const inset = 0.05;
  const baseY = ROAD_LIFT + 0.04;

  let vi = 0;
  let ci = 0;
  let ii = 0;
  let v = 0;

  for (const t of grid.iter()) {
    if (!t.road) continue;
    // Heat colour: green (0) → yellow (1.0) → red (2.5+).
    heatColor(t.trafficLoadAvg, c);

    const x0 = t.x * TILE_SIZE + inset;
    const x1 = (t.x + 1) * TILE_SIZE - inset;
    const z0 = t.y * TILE_SIZE + inset;
    const z1 = (t.y + 1) * TILE_SIZE - inset;
    // Lift heatmap by tile elevation so it follows the road surface
    // (Alpha 2.4); bridges sit absolute at BRIDGE_LIFT + tiny offset.
    const y = t.bridge ? BRIDGE_LIFT + 0.04 : baseY + t.elevation;

    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normals.
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    flatShading: true
  });
  return new Mesh(geom, mat);
}

function heatColor(load: number, out: Color): void {
  // Two-stop gradient: 0 → 1 maps green → yellow; 1 → 2.5+ maps yellow → red.
  const lo = 0x4ad06d; // green
  const mid = 0xf2cd5c; // yellow
  const hi = 0xd03a3a;  // red
  if (load <= 1) {
    const t = Math.max(0, Math.min(1, load));
    out.setHex(lo).lerp(new Color(mid), t);
  } else {
    const t = Math.max(0, Math.min(1, (load - 1) / 1.5));
    out.setHex(mid).lerp(new Color(hi), t);
  }
}

/** Night-lights overlay (Alpha 3.0.1). One small geometry cluster per
 *  light-emitting tile — a thin pole + a glowing emissive cap + a soft
 *  ground-glow disc. Rendered with an unlit MeshBasicMaterial so the
 *  light reads "lit" even when the directional sun is at midnight
 *  intensity. Opacity is driven by Renderer.applyTimeOfDay so the
 *  overlay fades in at dusk + out at dawn.
 *
 *  Sources of lights:
 *  - Avenue road tiles → 2 lamp posts (one per sidewalk side).
 *  - Walking-path tiles → 1 lamp post.
 *  - Park tiles → 1 ornate lamp.
 *
 *  All in one merged mesh = a single draw call. Build cost is one grid
 *  sweep; rebuild when roads / paths / parks change. */
function buildNightLightsMesh(grid: Grid): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];

  const LAMP_GLOW = 0xfff0a8;       // warm yellow lamp glow
  const PARK_LAMP_GLOW = 0xffe4b0;  // softer warm tone
  const LAMP_POLE = 0x3a3a3a;       // dark pole
  const GROUND_GLOW = 0xfff0a8;     // ground-disc colour matches the bulb
  const PARK_GROUND_GLOW = 0xffe4b0;

  /** Lamp fixture (Alpha 3.1.6): emits ONLY the visible pole + bulb.
   *  The smooth ground-glow is now a separate `lampGlowMesh` rendered
   *  with a radial-gradient texture for proper falloff. */
  const dim = (hex: number, factor: number): number => {
    const r = Math.round(((hex >> 16) & 0xff) * factor);
    const g = Math.round(((hex >> 8) & 0xff) * factor);
    const b = Math.round((hex & 0xff) * factor);
    return (r << 16) | (g << 8) | b;
  };
  const addLamp = (
    cx: number, cz: number, baseY: number, glowHex: number, scale = 1
  ): void => {
    // Pole (thin dark cylinder).
    const pole = new CylinderGeometry(0.018 * scale, 0.018 * scale, 0.34 * scale, 6);
    pole.translate(cx, baseY + 0.17 * scale, cz);
    geoms.push(pole); colours.push(LAMP_POLE);
    // Bulb — small emissive sphere.
    const bulb = new IcosahedronGeometry(0.05 * scale, 0);
    bulb.translate(cx, baseY + 0.36 * scale, cz);
    geoms.push(bulb); colours.push(dim(glowHex, 0.95));
    void GROUND_GLOW;
  };

  for (const t of grid.iter()) {
    const cx = t.x + 0.5;
    const cz = t.y + 0.5;
    if (t.road && t.roadType === 'avenue' && !t.bridge) {
      // Two sidewalk-side lamps along the long-ish axis. Use the
      // sidewalk lift so the lamp base sits on the sidewalk surface.
      const baseY = SIDEWALK_LIFT + t.elevation;
      addLamp(cx, cz - 0.36, baseY, LAMP_GLOW);
      addLamp(cx, cz + 0.36, baseY, LAMP_GLOW);
    }
    if (t.path && !t.road) {
      // Single small lamp at the centre of each path tile.
      const baseY = PATH_LIFT + t.elevation;
      addLamp(cx, cz, baseY, LAMP_GLOW, 0.85);
    }
    if (t.building === 'park') {
      // Ornate park lamp in the centre.
      const baseY = SIDEWALK_LIFT + t.elevation;
      addLamp(cx, cz, baseY, PARK_LAMP_GLOW, 1.1);
      // Suppress unused-variable lint
      void PARK_GROUND_GLOW;
    }
  }

  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  // Unlit material so the lights read as "lit" even at deep midnight when
  // the directional sun light is dim.  Transparent + depthWrite:false so
  // the ground-glow doesn't z-fight with the road/path surface beneath
  // and so the overlay can fade out at dawn.
  const mat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const mesh = new Mesh(merged, mat);
  // Off by default — applyTimeOfDay will toggle visibility based on time.
  mesh.visible = false;
  return mesh;
}

/** Generate the radial-gradient texture used by every lamp glow pool.
 *  Single CanvasTexture is shared across all lamps — built once per
 *  Renderer lifetime. Smooth bell-curve falloff via Canvas2D
 *  radialGradient gives lamps a natural-looking light spill. */
function makeRadialGlowTexture(): import('three').Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Bright warm centre → soft warm mid → fully transparent edge.
  // Softer falloff (Alpha 3.1.8) — the previous gradient was washing
  // out everything under the lamp. Lower centre alpha + earlier
  // taper keeps the glow readable without flattening the road texture.
  grad.addColorStop(0, 'rgba(255, 240, 168, 0.65)');
  grad.addColorStop(0.25, 'rgba(255, 220, 150, 0.38)');
  grad.addColorStop(0.55, 'rgba(255, 200, 130, 0.12)');
  grad.addColorStop(1, 'rgba(255, 200, 130, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Build one flat textured plane per lamp — the smooth radial glow that
 *  spills onto the ground around the fixture (Alpha 3.1.6). Each plane
 *  is ~2.4 tiles wide and lies flat just above the surface, with the
 *  shared radial-gradient texture providing the soft falloff. */
function buildLampGlowMesh(grid: Grid, texture: import('three').Texture): Mesh | null {
  // Count lamp positions first so we can size buffers exactly.
  type LampSpec = { cx: number; cz: number; y: number; r: number };
  const lamps: LampSpec[] = [];
  for (const t of grid.iter()) {
    const cx = t.x + 0.5;
    const cz = t.y + 0.5;
    if (t.road && t.roadType === 'avenue' && !t.bridge) {
      const baseY = SIDEWALK_LIFT + t.elevation + 0.01;
      lamps.push({ cx, cz: cz - 0.36, y: baseY, r: 1.20 });
      lamps.push({ cx, cz: cz + 0.36, y: baseY, r: 1.20 });
    }
    if (t.path && !t.road) {
      const baseY = PATH_LIFT + t.elevation + 0.01;
      lamps.push({ cx, cz, y: baseY, r: 1.10 });
    }
    if (t.building === 'park') {
      const baseY = SIDEWALK_LIFT + t.elevation + 0.01;
      lamps.push({ cx, cz, y: baseY, r: 1.50 });
    }
  }
  if (lamps.length === 0) return null;

  const positions = new Float32Array(lamps.length * 4 * 3);
  const uvs = new Float32Array(lamps.length * 4 * 2);
  const indices = new Uint32Array(lamps.length * 6);

  let vi = 0, ui = 0, ii = 0, v = 0;
  for (const l of lamps) {
    const x0 = l.cx - l.r;
    const x1 = l.cx + l.r;
    const z0 = l.cz - l.r;
    const z1 = l.cz + l.r;
    const y = l.y;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;
    uvs[ui++] = 0; uvs[ui++] = 0;
    uvs[ui++] = 1; uvs[ui++] = 0;
    uvs[ui++] = 1; uvs[ui++] = 1;
    uvs[ui++] = 0; uvs[ui++] = 1;
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('uv', new BufferAttribute(uvs, 2));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Additive blending so overlapping lamps make the area properly
  // brighter, mimicking real light. depthWrite off so we don't z-fight
  // with the ground geometry below.
  const mat = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending
  });
  const mesh = new Mesh(geom, mat);
  mesh.visible = false;
  return mesh;
}

/** Build the lit-windows overlay (Alpha 3.1.6). Walks every developed
 *  building tile (medium+ R/C/MU, all skyscrapers at stage 4) and
 *  emits a small bright rectangle per window position. The whole mesh
 *  uses MeshBasicMaterial so windows always read at full brightness
 *  regardless of scene lighting; opacity is driven by applyTimeOfDay. */
function buildLitWindowsMesh(grid: Grid): Mesh | null {
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  let v = 0;

  // Window palette — slightly varied warm yellows so windows don't look
  // identical. Each tile picks a deterministic colour from this list.
  const PALETTE = [0xfff0a8, 0xffe8a0, 0xf8d088, 0xffd8a8, 0xffe8c0];

  const addWindow = (x: number, y: number, z: number, w: number, h: number, dir: 'X' | 'Z', hex: number): void => {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    let p0x = 0, p0z = 0, p1x = 0, p1z = 0;
    if (dir === 'X') {
      // Window on a face perpendicular to z-axis; w extends in x.
      p0x = x - w / 2; p0z = z;
      p1x = x + w / 2; p1z = z;
    } else {
      // Face perpendicular to x-axis; w extends in z.
      p0x = x; p0z = z - w / 2;
      p1x = x; p1z = z + w / 2;
    }
    positions.push(p0x, y - h / 2, p0z);
    positions.push(p1x, y - h / 2, p1z);
    positions.push(p1x, y + h / 2, p1z);
    positions.push(p0x, y + h / 2, p0z);
    for (let i = 0; i < 4; i++) { colours.push(r, g, b); }
    indices.push(v, v + 2, v + 1);
    indices.push(v, v + 3, v + 2);
    v += 4;
  };

  for (const t of grid.iter()) {
    const cx = t.x + 0.5;
    const cz = t.y + 0.5;
    const palIdx = (Math.abs(t.x * 73856093) ^ Math.abs(t.y * 19349663)) % PALETTE.length;
    const litColor = PALETTE[palIdx]!;
    // Skyscrapers — emit lit windows up the height of the tower at the
    // anchor tile only (we let the renderer's anchor check exclude
    // duplicates by skipping non-anchors).
    if (t.skyscraper && t.skyscraperStage >= 4) {
      // Re-use anchor logic inline — same lex-smaller check.
      const cmp = (px: number, py: number): boolean => {
        const p = grid.get(px, py);
        return !!(p && p.skyscraper && p.zone === t.zone && p.skyscraperVariant === t.skyscraperVariant);
      };
      const isAnchor = !cmp(t.x - 1, t.y) && !cmp(t.x, t.y - 1) && !cmp(t.x - 1, t.y - 1)
        && cmp(t.x + 1, t.y) && cmp(t.x, t.y + 1) && cmp(t.x + 1, t.y + 1);
      if (!isAnchor) continue;
      // Anchor centre is at (anchor + 1.0). Read the actual design so
      // window placement matches the body geometry instead of guessing.
      // Without this, designs with high `inset` or low `setbackAtFrac`
      // showed windows floating in the air outside the body.
      const acx = t.x + 1.0;
      const acz = t.y + 1.0;
      const design = getSkyscraperDesign(t.zone as 'residential' | 'commercial' | 'mixed', t.skyscraperVariant);
      // The base body width is `2.0 - inset*2` and the setback (if any)
      // narrows to that × setbackInsetFactor. Windows live on whichever
      // body section they're inside.
      const baseHalfW = (2.0 - design.inset * 2) / 2;
      const towerHalfW = baseHalfW * (design.setbackInsetFactor || 1.0);
      const setbackY = design.setbackAtFrac > 0 && design.setbackAtFrac < 1
        ? design.height * design.setbackAtFrac
        : design.height; // no setback → never narrows
      // Skip the ground-level zone where podium glass already paints a
      // dark band (avoids overlap that washes out the glass).
      const startY = design.hasPodiumGlass ? 0.65 : 0.30;
      // Window pitch matches the building band spacing (0.55) so windows
      // sit cleanly between the dark glass bands rather than crashing
      // into them. End just below the crown band.
      const pitch = 0.55;
      const cols = 3;
      for (let row = 0; ; row++) {
        const wy = startY + row * pitch;
        if (wy > design.height - 0.45) break;
        const halfW = wy < setbackY ? baseHalfW : towerHalfW;
        if (halfW < 0.20) continue; // tower too narrow for windows at this height
        for (let col = 0; col < cols; col++) {
          // Deterministic dim pattern — about half the windows lit at a time.
          if (((row * 7 + col + palIdx) & 1) === 0) continue;
          const t01 = (col + 0.5) / cols;
          const offset = -halfW * 0.85 + t01 * halfW * 1.7;
          // Inset windows just outside the body face so they don't
          // z-fight with the dark glass band geometry. The body face is
          // at ±halfW; windows sit at ±(halfW + 0.008).
          const surfaceOffset = halfW + 0.008;
          addWindow(acx + offset, wy, acz - surfaceOffset, 0.10, 0.18, 'X', litColor);
          addWindow(acx + offset, wy, acz + surfaceOffset, 0.10, 0.18, 'X', litColor);
          addWindow(acx + surfaceOffset, wy, acz + offset, 0.10, 0.18, 'Z', litColor);
          addWindow(acx - surfaceOffset, wy, acz + offset, 0.10, 0.18, 'Z', litColor);
        }
        // Second tower (twin designs) — emit windows on it too.
        if (design.secondTower) {
          const s = design.secondTower;
          if (wy > s.h - 0.45) continue;
          const sHalf = s.w / 2;
          const sx = acx + s.offsetX;
          const sz = acz + s.offsetZ;
          for (let col = 0; col < cols; col++) {
            if (((row * 11 + col + palIdx + 3) & 1) === 0) continue;
            const t01 = (col + 0.5) / cols;
            const offset = -sHalf * 0.85 + t01 * sHalf * 1.7;
            const surfaceOffset = sHalf + 0.008;
            addWindow(sx + offset, wy, sz - surfaceOffset, 0.10, 0.18, 'X', litColor);
            addWindow(sx + offset, wy, sz + surfaceOffset, 0.10, 0.18, 'X', litColor);
            addWindow(sx + surfaceOffset, wy, sz + offset, 0.10, 0.18, 'Z', litColor);
            addWindow(sx - surfaceOffset, wy, sz + offset, 0.10, 0.18, 'Z', litColor);
          }
        }
      }
      continue;
    }
    // Medium+ commercial / mixed-use — lit windows on the front face only.
    if (t.density >= 2 && (t.zone === 'commercial' || t.zone === 'mixed')) {
      // Approximate body height + width per density.
      const h = t.density === 2 ? 0.78 : 1.35;
      const halfW = 0.30;
      // Two rows of windows on the south face.
      const rows = t.density === 2 ? 2 : 4;
      for (let row = 0; row < rows; row++) {
        const wy = 0.30 + row * 0.30;
        if (wy > h - 0.10) break;
        for (let col = 0; col < 3; col++) {
          if (((row * 5 + col + palIdx) & 2) === 0) continue;
          const offset = -halfW * 0.7 + col * (halfW * 0.7);
          addWindow(cx + offset, wy, cz + halfW + 0.005, 0.08, 0.14, 'X', litColor);
        }
      }
    }
  }

  if (positions.length === 0) return null;
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geom.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3));
  geom.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  const mat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const mesh = new Mesh(geom, mat);
  mesh.visible = false;
  return mesh;
}

/** Districts overlay mesh (Alpha 2.22). Translucent tint per district. */
function buildDistrictsMesh(grid: Grid, districts: import('../simulation/Districts').Districts): Mesh | null {
  let count = 0;
  for (const t of grid.iter()) if (t.districtId > 0) count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color();
  const baseY = ROAD_LIFT * 0.15;

  let vi = 0, ci = 0, ii = 0, v = 0;
  for (const t of grid.iter()) {
    if (t.districtId === 0) continue;
    const d = districts.get(t.districtId);
    if (!d) continue;
    c.setHex(d.color);
    const x0 = t.x * TILE_SIZE;
    const x1 = (t.x + 1) * TILE_SIZE;
    const z0 = t.y * TILE_SIZE;
    const z1 = (t.y + 1) * TILE_SIZE;
    const y = baseY + t.elevation;

    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.30,
    depthWrite: false
  });
  return new Mesh(geom, mat);
}

/** Crime heatmap (Alpha 2.21): one quad per zoned tile coloured by Crime
 *  score [0, 1]. Distinct purple-tinted gradient so it doesn't visually
 *  compete with the green→red traffic heatmap. */
function buildCrimeHeatmapMesh(grid: Grid, crime: import('../simulation/Crime').Crime): Mesh | null {
  let count = 0;
  for (const t of grid.iter()) if (t.zone !== 'none' && t.density > 0) count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color();
  const inset = 0.06;
  const baseY = ROAD_LIFT * 0.3;

  let vi = 0, ci = 0, ii = 0, v = 0;
  for (const t of grid.iter()) {
    if (t.zone === 'none' || t.density === 0) continue;
    crimeColor(crime.scoreAt(grid, t.x, t.y), c);
    const x0 = t.x * TILE_SIZE + inset;
    const x1 = (t.x + 1) * TILE_SIZE - inset;
    const z0 = t.y * TILE_SIZE + inset;
    const z1 = (t.y + 1) * TILE_SIZE - inset;
    const y = baseY + t.elevation;

    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  const mat = new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55 });
  return new Mesh(geom, mat);
}

function crimeColor(score: number, out: Color): void {
  // Calm pale-green at 0 → muted purple at 0.5 → magenta-red at 1.
  const lo = 0xb6e0bb;
  const mid = 0x9c5a9e;
  const hi = 0xc73a52;
  if (score <= 0.5) {
    const t = Math.max(0, Math.min(1, score / 0.5));
    out.setHex(lo).lerp(new Color(mid), t);
  } else {
    const t = Math.max(0, Math.min(1, (score - 0.5) / 0.5));
    out.setHex(mid).lerp(new Color(hi), t);
  }
}

// --- City buildings -----------------------------------------------------

/**
 * Build a single merged Mesh containing all placed city buildings. Each
 * building kind contributes a distinctive low-poly geometry with its own
 * colour via vertex colours. Result is one draw call regardless of count.
 *
 * Geometry choices:
 * - power_plant: dark grey box + red chimney cylinder
 * - water_tower: blue cylinder on a thinner support
 * - park: flat green pad + a tiny cone tree
 * - bus_stop: thin yellow pole + a small canopy
 * - bus_depot: orange box (bigger than bus_stop)
 */
function buildCityBuildingsMesh(grid: Grid, forestryHealth: number, farmHealth: number): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];

  // Modular parks (Alpha 2.6) and modular forestry (Alpha 2.7) both
  // flood-fill: instead of rendering each tile of the same kind in
  // isolation, group adjacent ones into clusters and emit ONE bigger
  // structure scaled / themed by cluster size. Non-clustered city
  // buildings still render per-tile.
  const visited = new Set<number>();
  for (const t of grid.iter()) {
    if (t.building === 'none') continue;
    if (t.building === 'park') {
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      const cluster = floodBuilding(grid, t.x, t.y, 'park', visited);
      const parts = parkClusterParts(cluster);
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(p.dx, p.dy, p.dz);
        geoms.push(g);
        colours.push(p.color);
      }
      continue;
    }
    if (t.building === 'forestry') {
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      const cluster = floodBuilding(grid, t.x, t.y, 'forestry', visited);
      const parts = forestryClusterParts(cluster, forestryHealth);
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(p.dx, p.dy, p.dz);
        geoms.push(g);
        colours.push(p.color);
      }
      continue;
    }
    if (t.building === 'farm') {
      const key = t.y * grid.width + t.x;
      if (visited.has(key)) continue;
      const cluster = floodBuilding(grid, t.x, t.y, 'farm', visited);
      const parts = farmClusterParts(cluster, farmHealth);
      for (const p of parts) {
        const g = p.makeGeom();
        g.translate(p.dx, p.dy, p.dz);
        geoms.push(g);
        colours.push(p.color);
      }
      continue;
    }
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    const parts = cityBuildingParts(t.building);
    for (const p of parts) {
      const g = p.makeGeom();
      g.translate(cx + p.dx, p.dy, cz + p.dz);
      geoms.push(g);
      colours.push(p.color);
    }
  }

  if (geoms.length === 0) return null;
  const merged = mergeGeoms(geoms, colours);
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(merged, mat);
}

/**
 * 4-connected flood-fill of tiles whose `building === kind`, starting at
 * (sx,sy). Marks each visited tile in `visited` (packed y*w+x) so the
 * outer loop doesn't revisit the cluster.
 */
function floodBuilding(
  grid: Grid, sx: number, sy: number, kind: string, visited: Set<number>
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const stack: Array<[number, number]> = [[sx, sy]];
  const w = grid.width;
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const key = y * w + x;
    if (visited.has(key)) continue;
    const t = grid.get(x, y);
    if (!t || t.building !== kind) continue;
    visited.add(key);
    out.push({ x, y });
    stack.push([x + 1, y]);
    stack.push([x - 1, y]);
    stack.push([x, y + 1]);
    stack.push([x, y - 1]);
  }
  return out;
}

/**
 * Modular park renderer. Cluster size determines the size class:
 *   1 tile  → small park (2 layouts)
 *   2 tiles → community park (2 layouts)
 *   3 tiles → neighbourhood park (2 layouts)
 *   4+ tiles → grand park (2 layouts)
 *
 * Within each size class, a deterministic hash of the cluster's anchor
 * tile picks between two layouts (Alpha 3.1.9), giving 8 visually
 * distinct park designs total. The lex-smallest tile of the cluster
 * supplies the hash so the same physical park always picks the same
 * layout across renders / saves.
 *
 * The cluster's "centroid" anchors central features; lawns and trees
 * are emitted per-tile so the cluster shape stays organic.
 */
function parkClusterParts(cluster: Array<{ x: number; y: number }>): CityBuildingPart[] {
  if (cluster.length === 0) return [];
  const out: CityBuildingPart[] = [];
  // Centroid in world space.
  let sumX = 0, sumZ = 0;
  for (const c of cluster) {
    sumX += (c.x + 0.5) * TILE_SIZE;
    sumZ += (c.y + 0.5) * TILE_SIZE;
  }
  const centerX = sumX / cluster.length;
  const centerZ = sumZ / cluster.length;
  const size = cluster.length;

  // Lawn pad on every tile — the green base regardless of cluster size.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => box(0.92, 0.04, 0.92), color: 0x4a8c3a, dx: cx, dy: 0.02, dz: cz });
  }

  // Pick a sub-variant within each size class from the lex-smallest tile.
  // Two layouts per class × four classes = 8 total designs.
  let anchor = cluster[0]!;
  for (const c of cluster) {
    if (c.x < anchor.x || (c.x === anchor.x && c.y < anchor.y)) anchor = c;
  }
  const subVariant = (Math.abs(anchor.x * 73856093) ^ Math.abs(anchor.y * 19349663)) & 1;

  if (size === 1) {
    if (subVariant === 1) {
      addSculpturePlaza(cluster[0]!, centerX, centerZ, out);
      return out;
    }
    // === 1-tile cottage park ===
    const c = cluster[0]!;
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    // Diagonal stone path strip.
    out.push({ makeGeom: () => box(0.18, 0.05, 0.85), color: 0xc7c2b3, dx: cx, dy: 0.025, dz: cz });
    // Round pond.
    out.push({ makeGeom: () => cyl(0.18, 0.06, 12), color: 0x4d8eb9, dx: cx - 0.20, dy: 0.025, dz: cz - 0.18 });
    // Two benches.
    out.push({ makeGeom: () => box(0.18, 0.025, 0.04), color: 0x6b4f3a, dx: cx + 0.22, dy: 0.07, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: cx + 0.30, dy: 0.045, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: cx + 0.14, dy: 0.045, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.18, 0.025, 0.04), color: 0x6b4f3a, dx: cx - 0.22, dy: 0.07, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: cx - 0.14, dy: 0.045, dz: cz + 0.18 });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: cx - 0.30, dy: 0.045, dz: cz + 0.18 });
    // Three trees.
    out.push({ makeGeom: () => cyl(0.04, 0.16, 6), color: 0x6b3f1f, dx: cx + 0.22, dy: 0.11, dz: cz - 0.22 });
    out.push({ makeGeom: () => cone(0.20, 0.34, 8), color: 0x2f6a2d, dx: cx + 0.22, dy: 0.36, dz: cz - 0.22 });
    out.push({ makeGeom: () => cyl(0.035, 0.13, 6), color: 0x6b3f1f, dx: cx - 0.32, dy: 0.095, dz: cz - 0.05 });
    out.push({ makeGeom: () => cone(0.16, 0.26, 8), color: 0x3a7a3a, dx: cx - 0.32, dy: 0.30, dz: cz - 0.05 });
    out.push({ makeGeom: () => cyl(0.028, 0.10, 6), color: 0x6b3f1f, dx: cx + 0.32, dy: 0.08, dz: cz + 0.05 });
    out.push({ makeGeom: () => cone(0.13, 0.20, 8), color: 0x4a8e44, dx: cx + 0.32, dy: 0.25, dz: cz + 0.05 });
    return out;
  }

  if (size === 2) {
    if (subVariant === 1) {
      addTennisCourt(cluster, centerX, centerZ, out);
      return out;
    }
    // === 2-tile community park: playground + pond + paths ===
    // Determine axis: tiles share an x or share a y.
    const a = cluster[0]!;
    const b = cluster[1]!;
    const horizontal = a.y === b.y;
    // Centre between the two tiles.
    const cx = centerX;
    const cz = centerZ;
    // Long paved path connecting both tile centers.
    if (horizontal) {
      out.push({ makeGeom: () => box(1.85, 0.05, 0.18), color: 0xc7c2b3, dx: cx, dy: 0.025, dz: cz });
    } else {
      out.push({ makeGeom: () => box(0.18, 0.05, 1.85), color: 0xc7c2b3, dx: cx, dy: 0.025, dz: cz });
    }
    // Playground: slide (angled box) + swing frame on the lex-smaller tile.
    const pgX = (a.x + 0.5) * TILE_SIZE + (horizontal ? -0.05 : 0);
    const pgZ = (a.y + 0.5) * TILE_SIZE + (horizontal ? 0 : -0.05);
    // Swing frame (A-shape).
    out.push({ makeGeom: () => box(0.30, 0.022, 0.022), color: 0xb14a4a, dx: pgX, dy: 0.22, dz: pgZ - 0.20 });
    out.push({ makeGeom: () => box(0.022, 0.22, 0.022), color: 0xb14a4a, dx: pgX - 0.13, dy: 0.11, dz: pgZ - 0.20 });
    out.push({ makeGeom: () => box(0.022, 0.22, 0.022), color: 0xb14a4a, dx: pgX + 0.13, dy: 0.11, dz: pgZ - 0.20 });
    // Two swing seats.
    out.push({ makeGeom: () => box(0.05, 0.018, 0.04), color: 0x3a2a20, dx: pgX - 0.05, dy: 0.10, dz: pgZ - 0.20 });
    out.push({ makeGeom: () => box(0.05, 0.018, 0.04), color: 0x3a2a20, dx: pgX + 0.05, dy: 0.10, dz: pgZ - 0.20 });
    // Slide — sloped box.
    out.push({ makeGeom: () => box(0.10, 0.18, 0.30), color: 0x4d8eb9, dx: pgX + 0.18, dy: 0.09, dz: pgZ + 0.05 });
    out.push({ makeGeom: () => box(0.06, 0.06, 0.06), color: 0xb14a4a, dx: pgX + 0.18, dy: 0.21, dz: pgZ - 0.05 });
    // Pond on the partner tile.
    const pondX = (b.x + 0.5) * TILE_SIZE;
    const pondZ = (b.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => cyl(0.22, 0.06, 12), color: 0x4d8eb9, dx: pondX, dy: 0.025, dz: pondZ + 0.10 });
    // Trees scattered.
    out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx + 0.30, dy: 0.10, dz: cz + 0.30 });
    out.push({ makeGeom: () => cone(0.18, 0.30, 8), color: 0x2f6a2d, dx: cx + 0.30, dy: 0.32, dz: cz + 0.30 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx - 0.35, dy: 0.09, dz: cz + 0.30 });
    out.push({ makeGeom: () => cone(0.15, 0.24, 8), color: 0x3a7a3a, dx: cx - 0.35, dy: 0.28, dz: cz + 0.30 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: pondX - 0.30, dy: 0.09, dz: pondZ - 0.30 });
    out.push({ makeGeom: () => cone(0.15, 0.24, 8), color: 0x4a8e44, dx: pondX - 0.30, dy: 0.28, dz: pondZ - 0.30 });
    return out;
  }

  if (size === 3) {
    if (subVariant === 1) {
      addRoseGarden(cluster, centerX, centerZ, out);
      return out;
    }
    // === 3-tile neighbourhood park: pavilion + central pond + path ===
    // Pavilion (open-air shelter) at centroid.
    out.push({ makeGeom: () => box(0.50, 0.025, 0.40), color: 0x6f4a2c, dx: centerX, dy: 0.32, dz: centerZ });
    // Roof (pyramid).
    out.push({ makeGeom: () => cone(0.34, 0.18, 4), color: 0x4a3020, dx: centerX, dy: 0.40, dz: centerZ });
    // Four pavilion posts.
    out.push({ makeGeom: () => box(0.025, 0.30, 0.025), color: 0x4a3a2a, dx: centerX - 0.22, dy: 0.15, dz: centerZ - 0.18 });
    out.push({ makeGeom: () => box(0.025, 0.30, 0.025), color: 0x4a3a2a, dx: centerX + 0.22, dy: 0.15, dz: centerZ - 0.18 });
    out.push({ makeGeom: () => box(0.025, 0.30, 0.025), color: 0x4a3a2a, dx: centerX - 0.22, dy: 0.15, dz: centerZ + 0.18 });
    out.push({ makeGeom: () => box(0.025, 0.30, 0.025), color: 0x4a3a2a, dx: centerX + 0.22, dy: 0.15, dz: centerZ + 0.18 });
    // Central round pond near the pavilion.
    out.push({ makeGeom: () => cyl(0.30, 0.06, 16), color: 0x4d8eb9, dx: centerX + 0.5, dy: 0.025, dz: centerZ });
    // Small fountain post in the middle of the pond.
    out.push({ makeGeom: () => cyl(0.05, 0.18, 8), color: 0x9a9a9a, dx: centerX + 0.5, dy: 0.09, dz: centerZ });
    out.push({ makeGeom: () => sphereLite(0.08), color: 0xe0e6ec, dx: centerX + 0.5, dy: 0.22, dz: centerZ });
    // Connecting paths from each tile center to centroid.
    for (const c of cluster) {
      const cx = (c.x + 0.5) * TILE_SIZE;
      const cz = (c.y + 0.5) * TILE_SIZE;
      const dx = centerX - cx;
      const dz = centerZ - cz;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      // Approximate a path quad oriented along the (cx,cz)→centroid axis.
      // Just lay short axis-aligned pads — the cluster is rectilinear so
      // this looks fine without rotation math.
      const horiz = Math.abs(dx) > Math.abs(dz);
      if (horiz) {
        out.push({ makeGeom: () => box(len, 0.05, 0.16), color: 0xc7c2b3, dx: (cx + centerX) / 2, dy: 0.026, dz: cz });
      } else {
        out.push({ makeGeom: () => box(0.16, 0.05, len), color: 0xc7c2b3, dx: cx, dy: 0.026, dz: (cz + centerZ) / 2 });
      }
    }
    // Trees scattered around.
    for (let i = 0; i < cluster.length; i++) {
      const c = cluster[i]!;
      const cx = (c.x + 0.5) * TILE_SIZE;
      const cz = (c.y + 0.5) * TILE_SIZE;
      out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx - 0.32, dy: 0.10, dz: cz + 0.32 });
      out.push({ makeGeom: () => cone(0.18, 0.30, 8), color: i === 0 ? 0x2f6a2d : 0x3a7a3a, dx: cx - 0.32, dy: 0.32, dz: cz + 0.32 });
      out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx + 0.32, dy: 0.09, dz: cz - 0.32 });
      out.push({ makeGeom: () => cone(0.15, 0.24, 8), color: 0x4a8e44, dx: cx + 0.32, dy: 0.28, dz: cz - 0.32 });
    }
    return out;
  }

  if (subVariant === 1) {
    addBotanicalGarden(cluster, centerX, centerZ, out);
    return out;
  }

  // === 4+ tile grand park: bandstand centerpiece + ring + dense trees ===
  // Bandstand: octagonal raised platform with a tiered roof.
  out.push({ makeGeom: () => cyl(0.42, 0.06, 8), color: 0xc4a684, dx: centerX, dy: 0.05, dz: centerZ });
  out.push({ makeGeom: () => cyl(0.34, 0.15, 8), color: 0xd9c08a, dx: centerX, dy: 0.13, dz: centerZ });
  // Bandstand posts.
  for (let p = 0; p < 8; p++) {
    const ang = (p / 8) * Math.PI * 2;
    const px = centerX + Math.cos(ang) * 0.30;
    const pz = centerZ + Math.sin(ang) * 0.30;
    out.push({ makeGeom: () => box(0.025, 0.28, 0.025), color: 0x4a3020, dx: px, dy: 0.20 + 0.14, dz: pz });
  }
  // Bandstand roof — wide cone.
  out.push({ makeGeom: () => cone(0.45, 0.18, 8), color: 0xb14a4a, dx: centerX, dy: 0.20 + 0.30, dz: centerZ });
  // Roof finial.
  out.push({ makeGeom: () => cone(0.06, 0.10, 6), color: 0xe5c25a, dx: centerX, dy: 0.20 + 0.45, dz: centerZ });
  // Per-tile decoration: bench on each tile facing the bandstand.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    // Skip the centroid tile (covered by bandstand).
    if (Math.hypot(cx - centerX, cz - centerZ) < 0.5) continue;
    // Bench facing centroid.
    const dx = centerX - cx;
    const dz = centerZ - cz;
    const len = Math.hypot(dx, dz) || 1;
    const off = 0.30;
    const bx = cx + (dx / len) * off;
    const bz = cz + (dz / len) * off;
    out.push({ makeGeom: () => box(0.20, 0.025, 0.05), color: 0x6b4f3a, dx: bx, dy: 0.07, dz: bz });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.05), color: 0x3a2a20, dx: bx - 0.08, dy: 0.045, dz: bz });
    out.push({ makeGeom: () => box(0.018, 0.05, 0.05), color: 0x3a2a20, dx: bx + 0.08, dy: 0.045, dz: bz });
    // Two trees per tile in opposite corners.
    out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx - 0.36, dy: 0.10, dz: cz - 0.36 });
    out.push({ makeGeom: () => cone(0.18, 0.32, 8), color: 0x2f6a2d, dx: cx - 0.36, dy: 0.34, dz: cz - 0.36 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx + 0.36, dy: 0.09, dz: cz + 0.36 });
    out.push({ makeGeom: () => cone(0.15, 0.26, 8), color: 0x4a8e44, dx: cx + 0.36, dy: 0.30, dz: cz + 0.36 });
  }
  // Connecting paved paths from each non-centroid tile to centroid.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const dx = centerX - cx;
    const dz = centerZ - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const horiz = Math.abs(dx) > Math.abs(dz);
    if (horiz) {
      out.push({ makeGeom: () => box(len, 0.05, 0.16), color: 0xc7c2b3, dx: (cx + centerX) / 2, dy: 0.026, dz: cz });
    } else {
      out.push({ makeGeom: () => box(0.16, 0.05, len), color: 0xc7c2b3, dx: cx, dy: 0.026, dz: (cz + centerZ) / 2 });
    }
  }
  return out;
}

// --- Park sub-variant layouts (Alpha 3.1.9) ---------------------------

/** 1-tile sculpture plaza: paved circle + central abstract sculpture +
 *  4 perimeter benches facing inward. No pond, no trees on the tile —
 *  contrast to the cottage garden's organic look. */
function addSculpturePlaza(
  c: { x: number; y: number }, _centerX: number, _centerZ: number, out: CityBuildingPart[]
): void {
  const cx = (c.x + 0.5) * TILE_SIZE;
  const cz = (c.y + 0.5) * TILE_SIZE;
  // Paved circular plaza.
  out.push({ makeGeom: () => cyl(0.42, 0.04, 24), color: 0xb8b3a4, dx: cx, dy: 0.026, dz: cz });
  // Inner accent ring.
  out.push({ makeGeom: () => cyl(0.28, 0.045, 24), color: 0x9a948a, dx: cx, dy: 0.030, dz: cz });
  // Sculpture base.
  out.push({ makeGeom: () => cyl(0.12, 0.10, 16), color: 0x4a4f56, dx: cx, dy: 0.075, dz: cz });
  // Sculpture itself — three stacked rotated boxes for an abstract feel.
  out.push({ makeGeom: () => box(0.18, 0.16, 0.12), color: 0xc83838, dx: cx, dy: 0.20, dz: cz });
  out.push({ makeGeom: () => box(0.12, 0.18, 0.16), color: 0xeec453, dx: cx, dy: 0.36, dz: cz });
  out.push({ makeGeom: () => box(0.10, 0.12, 0.10), color: 0x4d8eb9, dx: cx, dy: 0.50, dz: cz });
  // Four perimeter benches facing the plaza.
  const benchOffsets: Array<[number, number, number, number]> = [
    [0.34, 0, 1, 0], [-0.34, 0, 1, 0], [0, 0.34, 0, 1], [0, -0.34, 0, 1]
  ];
  for (const [bx, bz, ax, az] of benchOffsets) {
    const w = ax === 1 ? 0.04 : 0.20;
    const d = az === 1 ? 0.04 : 0.20;
    out.push({ makeGeom: () => box(w, 0.025, d), color: 0x6b4f3a, dx: cx + bx, dy: 0.07, dz: cz + bz });
  }
  // Four corner shrubs to soften the paved look.
  for (const [bx, bz] of [[0.36, 0.36], [-0.36, 0.36], [0.36, -0.36], [-0.36, -0.36]] as Array<[number, number]>) {
    out.push({ makeGeom: () => sphereLite(0.10), color: 0x4a8e44, dx: cx + bx, dy: 0.10, dz: cz + bz });
  }
}

/** 2-tile tennis court: paved court + net + line markings + 2 perimeter
 *  benches + corner trees. */
function addTennisCourt(
  cluster: Array<{ x: number; y: number }>, centerX: number, centerZ: number, out: CityBuildingPart[]
): void {
  const a = cluster[0]!;
  const b = cluster[1]!;
  const horizontal = a.y === b.y;
  // Court — clay-orange surface spans both tiles.
  if (horizontal) {
    out.push({ makeGeom: () => box(1.65, 0.03, 0.65), color: 0xc46c34, dx: centerX, dy: 0.030, dz: centerZ });
    // Centre net (low slim box).
    out.push({ makeGeom: () => box(0.025, 0.10, 0.65), color: 0xeae0c4, dx: centerX, dy: 0.080, dz: centerZ });
    // Court lines — white edge stripes.
    out.push({ makeGeom: () => box(1.65, 0.035, 0.025), color: 0xece4cf, dx: centerX, dy: 0.035, dz: centerZ - 0.30 });
    out.push({ makeGeom: () => box(1.65, 0.035, 0.025), color: 0xece4cf, dx: centerX, dy: 0.035, dz: centerZ + 0.30 });
  } else {
    out.push({ makeGeom: () => box(0.65, 0.03, 1.65), color: 0xc46c34, dx: centerX, dy: 0.030, dz: centerZ });
    out.push({ makeGeom: () => box(0.65, 0.10, 0.025), color: 0xeae0c4, dx: centerX, dy: 0.080, dz: centerZ });
    out.push({ makeGeom: () => box(0.025, 0.035, 1.65), color: 0xece4cf, dx: centerX - 0.30, dy: 0.035, dz: centerZ });
    out.push({ makeGeom: () => box(0.025, 0.035, 1.65), color: 0xece4cf, dx: centerX + 0.30, dy: 0.035, dz: centerZ });
  }
  // Perimeter benches off the court endlines.
  if (horizontal) {
    out.push({ makeGeom: () => box(0.20, 0.025, 0.04), color: 0x6b4f3a, dx: centerX - 0.92, dy: 0.07, dz: centerZ });
    out.push({ makeGeom: () => box(0.20, 0.025, 0.04), color: 0x6b4f3a, dx: centerX + 0.92, dy: 0.07, dz: centerZ });
  } else {
    out.push({ makeGeom: () => box(0.04, 0.025, 0.20), color: 0x6b4f3a, dx: centerX, dy: 0.07, dz: centerZ - 0.92 });
    out.push({ makeGeom: () => box(0.04, 0.025, 0.20), color: 0x6b4f3a, dx: centerX, dy: 0.07, dz: centerZ + 0.92 });
  }
  // 4 corner trees.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx + 0.36, dy: 0.10, dz: cz + 0.36 });
    out.push({ makeGeom: () => cone(0.18, 0.30, 8), color: 0x2f6a2d, dx: cx + 0.36, dy: 0.32, dz: cz + 0.36 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx - 0.36, dy: 0.09, dz: cz - 0.36 });
    out.push({ makeGeom: () => cone(0.15, 0.24, 8), color: 0x4a8e44, dx: cx - 0.36, dy: 0.28, dz: cz - 0.36 });
  }
}

/** 3-tile rose garden: geometric flower beds + central fountain +
 *  perimeter hedges + perimeter benches. Formal layout. */
function addRoseGarden(
  cluster: Array<{ x: number; y: number }>, centerX: number, centerZ: number, out: CityBuildingPart[]
): void {
  // Central round fountain.
  out.push({ makeGeom: () => cyl(0.30, 0.06, 16), color: 0xc8c4be, dx: centerX, dy: 0.05, dz: centerZ });
  out.push({ makeGeom: () => cyl(0.22, 0.08, 16), color: 0x4d8eb9, dx: centerX, dy: 0.07, dz: centerZ });
  out.push({ makeGeom: () => cyl(0.06, 0.20, 8), color: 0x9a9a9a, dx: centerX, dy: 0.10, dz: centerZ });
  out.push({ makeGeom: () => sphereLite(0.10), color: 0xe0e6ec, dx: centerX, dy: 0.24, dz: centerZ });
  // Geometric flower beds — 4 small rectangles + 4 round patches around centre.
  // Outer red roses.
  const beds: Array<[number, number, number]> = [
    [0.45, 0.0, 0xc83838],   // east
    [-0.45, 0.0, 0xc83838],  // west
    [0.0, 0.45, 0xeec453],   // north - yellow
    [0.0, -0.45, 0xeec453],  // south - yellow
    [0.32, 0.32, 0xd06ab8],  // pink corner
    [-0.32, 0.32, 0xd06ab8],
    [0.32, -0.32, 0xd06ab8],
    [-0.32, -0.32, 0xd06ab8]
  ];
  for (const [bx, bz, color] of beds) {
    out.push({ makeGeom: () => box(0.18, 0.04, 0.18), color: 0x5c3e2a, dx: centerX + bx, dy: 0.030, dz: centerZ + bz });
    out.push({ makeGeom: () => box(0.14, 0.05, 0.14), color, dx: centerX + bx, dy: 0.045, dz: centerZ + bz });
  }
  // Hedge perimeter on each tile (low green strip on the outward side).
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    // Skip if this tile contains the fountain (centroid).
    if (Math.hypot(cx - centerX, cz - centerZ) < 0.5) continue;
    // Hedge facing away from centroid.
    const dx = cx - centerX;
    const dz = cz - centerZ;
    const len = Math.hypot(dx, dz) || 1;
    const hx = cx + (dx / len) * 0.32;
    const hz = cz + (dz / len) * 0.32;
    out.push({ makeGeom: () => box(0.45, 0.10, 0.10), color: 0x4a8e44, dx: hx, dy: 0.08, dz: hz });
    // Bench in front of the hedge facing the fountain.
    const bx = cx + (dx / len) * 0.18;
    const bz = cz + (dz / len) * 0.18;
    out.push({ makeGeom: () => box(0.20, 0.025, 0.05), color: 0x6b4f3a, dx: bx, dy: 0.07, dz: bz });
  }
  // Connecting paved paths from each tile to centroid.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const dx = centerX - cx;
    const dz = centerZ - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const horiz = Math.abs(dx) > Math.abs(dz);
    if (horiz) {
      out.push({ makeGeom: () => box(len, 0.04, 0.14), color: 0xc7c2b3, dx: (cx + centerX) / 2, dy: 0.028, dz: cz });
    } else {
      out.push({ makeGeom: () => box(0.14, 0.04, len), color: 0xc7c2b3, dx: cx, dy: 0.028, dz: (cz + centerZ) / 2 });
    }
  }
}

/** 4+ tile botanical garden: greenhouse pavilion + winding pond chain
 *  + dense exotic-tree mix + perimeter hedge maze segments. */
function addBotanicalGarden(
  cluster: Array<{ x: number; y: number }>, centerX: number, centerZ: number, out: CityBuildingPart[]
): void {
  // Central greenhouse — long glass-walled pavilion with a peaked roof.
  out.push({ makeGeom: () => box(0.85, 0.05, 0.55), color: 0xc8c4be, dx: centerX, dy: 0.025, dz: centerZ });
  // Glass walls (pale teal).
  out.push({ makeGeom: () => box(0.82, 0.32, 0.52), color: 0xa8d4cc, dx: centerX, dy: 0.21, dz: centerZ });
  // Slightly darker glass band at the top.
  out.push({ makeGeom: () => box(0.85, 0.04, 0.55), color: 0x6c9a90, dx: centerX, dy: 0.39, dz: centerZ });
  // Pitched roof.
  out.push({ makeGeom: () => cone(0.45, 0.20, 4), color: 0x4a3020, dx: centerX, dy: 0.50, dz: centerZ });
  // Roof finial.
  out.push({ makeGeom: () => cone(0.04, 0.08, 6), color: 0xe5c25a, dx: centerX, dy: 0.60, dz: centerZ });
  // Pond chain — three small connected ponds curving around the greenhouse.
  out.push({ makeGeom: () => cyl(0.20, 0.06, 12), color: 0x4d8eb9, dx: centerX + 0.85, dy: 0.030, dz: centerZ - 0.30 });
  out.push({ makeGeom: () => cyl(0.16, 0.06, 12), color: 0x4d8eb9, dx: centerX + 0.62, dy: 0.030, dz: centerZ + 0.40 });
  out.push({ makeGeom: () => cyl(0.18, 0.06, 12), color: 0x4d8eb9, dx: centerX - 0.78, dy: 0.030, dz: centerZ + 0.20 });
  // Hedge maze segments — a few short hedges per tile (skip the greenhouse tile).
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    if (Math.hypot(cx - centerX, cz - centerZ) < 0.5) continue;
    // Two perpendicular short hedges.
    out.push({ makeGeom: () => box(0.30, 0.10, 0.06), color: 0x3a6a3a, dx: cx + 0.10, dy: 0.07, dz: cz - 0.20 });
    out.push({ makeGeom: () => box(0.06, 0.10, 0.30), color: 0x3a6a3a, dx: cx - 0.20, dy: 0.07, dz: cz + 0.10 });
  }
  // Dense exotic tree mix — each non-centroid tile gets 3 trees of
  // varied colours (palm-green, deep teal-green, autumn red-orange).
  const palette = [0x2f6a2d, 0x4a8e44, 0x3a7a3a, 0xc46c34, 0x6a9a4a];
  for (let i = 0; i < cluster.length; i++) {
    const c = cluster[i]!;
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    if (Math.hypot(cx - centerX, cz - centerZ) < 0.5) continue;
    out.push({ makeGeom: () => cyl(0.04, 0.14, 6), color: 0x6b3f1f, dx: cx - 0.36, dy: 0.10, dz: cz - 0.36 });
    out.push({ makeGeom: () => cone(0.18, 0.32, 8), color: palette[i % palette.length]!, dx: cx - 0.36, dy: 0.34, dz: cz - 0.36 });
    out.push({ makeGeom: () => cyl(0.035, 0.12, 6), color: 0x6b3f1f, dx: cx + 0.36, dy: 0.09, dz: cz + 0.36 });
    out.push({ makeGeom: () => sphereLite(0.16), color: palette[(i + 2) % palette.length]!, dx: cx + 0.36, dy: 0.30, dz: cz + 0.36 });
    out.push({ makeGeom: () => cyl(0.035, 0.10, 6), color: 0x6b3f1f, dx: cx - 0.30, dy: 0.08, dz: cz + 0.30 });
    out.push({ makeGeom: () => cone(0.13, 0.20, 8), color: palette[(i + 1) % palette.length]!, dx: cx - 0.30, dy: 0.25, dz: cz + 0.30 });
  }
  // Connecting paths (gravel) — same as bandstand layout for navigability.
  for (const c of cluster) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const dx = centerX - cx;
    const dz = centerZ - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const horiz = Math.abs(dx) > Math.abs(dz);
    if (horiz) {
      out.push({ makeGeom: () => box(len, 0.04, 0.14), color: 0xc4b894, dx: (cx + centerX) / 2, dy: 0.028, dz: cz });
    } else {
      out.push({ makeGeom: () => box(0.14, 0.04, len), color: 0xc4b894, dx: cx, dy: 0.028, dz: (cz + centerZ) / 2 });
    }
  }
}

/**
 * Modular forestry renderer (Alpha 2.7.1). A cluster of forestry tiles
 * renders as ONE cohesive timber operation rather than N independent
 * sheds. The cluster gets:
 *
 *  1. A continuous gravel yard pad spanning every tile (overlapping at
 *     edges so adjacent tile pads visibly merge).
 *  2. A perimeter rail fence — sweeps each tile's 4-edges and emits a
 *     fence segment only on edges that face out (no forestry neighbour).
 *  3. Internal connector paths between every pair of 4-adjacent tiles —
 *     paved beige strips so the operation reads as linked.
 *  4. Per-tile roles assigned from a fixed sequence (hut → sawmill →
 *     orchard → log_pile → drying_yard → orchard → log_truck → crane →
 *     orchard → kiln → fuel_tank → office → orchard → conveyor →
 *     rail). Orchard tiles render rows of small spruce saplings —
 *     a sustainable tree farm to make the cluster read as renewable.
 *
 * `health` ∈ [0, 1] modulates colour saturation, paint vibrancy, weed
 * tufts when struggling, and steam puffs when thriving.
 */
function forestryClusterParts(
  cluster: Array<{ x: number; y: number }>,
  health: number
): CityBuildingPart[] {
  if (cluster.length === 0) return [];
  const out: CityBuildingPart[] = [];
  // Sort cluster deterministically (lex by x, then y) so role assignment
  // is stable across renders.
  const sorted = cluster.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  // O(1) lookup whether a tile is part of the cluster.
  const member = new Set<string>();
  for (const c of sorted) member.add(c.x + ',' + c.y);
  const isMember = (x: number, y: number) => member.has(x + ',' + y);

  // Health-tinted colours.
  const dirt = lerpColor(0x4a3a26, 0x6a5a40, health);
  const woodMain = lerpColor(0x6e4d2c, 0x8a5e34, health);
  const woodPale = lerpColor(0xb18a5a, 0xd6a868, health);
  const tinRoof = lerpColor(0x4a4a44, 0x707064, health);
  const log = lerpColor(0x6a4830, 0x8a5d3c, health);
  const path = lerpColor(0x9c9080, 0xc7baa8, health);
  const struggling = health < 0.45;
  const thriving = health > 0.85;

  // 1. Continuous yard pad. Slightly wider than 1.0 so adjacent pads
  // overlap by a sliver — the cluster reads as one big gravel yard
  // rather than 9 squares with seams.
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => box(1.04, 0.025, 1.04), color: dirt, dx: cx, dy: 0.013, dz: cz });
    if (struggling) {
      const h = (Math.abs(c.x * 374761393) ^ Math.abs(c.y * 668265263)) | 0;
      const tx = ((h % 100) / 100 - 0.5) * 0.7;
      const tz = (((h >> 7) % 100) / 100 - 0.5) * 0.7;
      out.push({ makeGeom: () => cone(0.04, 0.08, 5), color: 0xc8b04a, dx: cx + tx, dy: 0.04, dz: cz + tz });
    }
  }

  // 2. Internal connector paths. For each pair of 4-adjacent forestry
  // tiles, lay a long paved strip from the lower tile center to the
  // higher one. We only emit one strip per pair (lex-smaller→larger).
  const dirs: Array<[number, number]> = [[1, 0], [0, 1]];
  for (const c of sorted) {
    for (const [dx, dy] of dirs) {
      if (!isMember(c.x + dx, c.y + dy)) continue;
      const cx0 = (c.x + 0.5) * TILE_SIZE;
      const cz0 = (c.y + 0.5) * TILE_SIZE;
      const cx1 = (c.x + dx + 0.5) * TILE_SIZE;
      const cz1 = (c.y + dy + 0.5) * TILE_SIZE;
      const midX = (cx0 + cx1) / 2;
      const midZ = (cz0 + cz1) / 2;
      // Strip dimension: thin perpendicular, wide along the connection axis.
      const w = dx !== 0 ? 1.10 : 0.18;
      const d = dy !== 0 ? 1.10 : 0.18;
      out.push({ makeGeom: () => box(w, 0.012, d), color: path, dx: midX, dy: 0.027, dz: midZ });
    }
  }

  // 3. Perimeter rail fence. For each tile, look at the 4 cardinal
  // edges; if the neighbour isn't a forestry tile, emit a fence
  // segment running along that edge. Two posts + a top rail.
  const fenceColor = lerpColor(0x4a3a28, 0x6e5a3a, health);
  const fenceLen = 0.85;
  const fencePostH = 0.10;
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const sides: Array<[number, number, [number, number]]> = [
      [0, -1, [0, -0.50]],   // N edge
      [1, 0, [0.50, 0]],     // E edge
      [0, 1, [0, 0.50]],     // S edge
      [-1, 0, [-0.50, 0]]    // W edge
    ];
    for (const [ndx, ndy, [ex, ez]] of sides) {
      if (isMember(c.x + ndx, c.y + ndy)) continue;
      const horizontal = ndy !== 0;
      const railW = horizontal ? fenceLen : 0.018;
      const railD = horizontal ? 0.018 : fenceLen;
      // Top rail.
      out.push({ makeGeom: () => box(railW, 0.018, railD), color: fenceColor, dx: cx + ex, dy: 0.085, dz: cz + ez });
      // Two posts.
      const postOff = horizontal ? [(-fenceLen / 2 + 0.04), (fenceLen / 2 - 0.04)] : [];
      const postOffZ = !horizontal ? [(-fenceLen / 2 + 0.04), (fenceLen / 2 - 0.04)] : [];
      if (horizontal) {
        for (const po of postOff) {
          out.push({ makeGeom: () => box(0.022, fencePostH, 0.022), color: fenceColor, dx: cx + ex + po, dy: 0.05, dz: cz + ez });
        }
      } else {
        for (const po of postOffZ) {
          out.push({ makeGeom: () => box(0.022, fencePostH, 0.022), color: fenceColor, dx: cx + ex, dy: 0.05, dz: cz + ez + po });
        }
      }
    }
  }

  // 4. Per-tile roles. Sequence weaves orchards in between primary
  // features so even a small cluster shows the tree-farm side, and a
  // big cluster reads as a real industrial complex.
  const ROLES: ForestryRole[] = [
    'hut', 'sawmill', 'orchard', 'log_pile', 'drying_yard',
    'orchard', 'log_truck', 'crane', 'orchard', 'kiln',
    'fuel_tank', 'office', 'orchard', 'conveyor', 'rail'
  ];
  // For clusters bigger than ROLES.length, repeat orchards at the end.
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const role: ForestryRole = i < ROLES.length ? ROLES[i]! : 'orchard';
    emitForestryFeature(out, role, cx, cz, woodMain, woodPale, tinRoof, log, thriving);
  }

  return out;
}

type ForestryRole =
  | 'hut' | 'sawmill' | 'orchard' | 'log_pile' | 'drying_yard'
  | 'log_truck' | 'crane' | 'kiln' | 'fuel_tank' | 'office'
  | 'conveyor' | 'rail';

function emitForestryFeature(
  out: CityBuildingPart[], role: ForestryRole,
  cx: number, cz: number,
  woodMain: number, woodPale: number, tinRoof: number, log: number,
  thriving: boolean
): void {
  switch (role) {
    case 'hut': {
      // Logger's hut: small wood box + gabled tin roof + door.
      out.push({ makeGeom: () => box(0.42, 0.30, 0.42), color: woodMain, dx: cx, dy: 0.165, dz: cz });
      out.push({ makeGeom: () => cone(0.32, 0.18, 4), color: tinRoof, dx: cx, dy: 0.30 + 0.09, dz: cz });
      out.push({ makeGeom: () => box(0.10, 0.18, 0.018), color: 0x3a2a18, dx: cx, dy: 0.09, dz: cz + 0.21 + 0.009 });
      // Smokestack on the hut when thriving.
      if (thriving) {
        out.push({ makeGeom: () => cyl(0.04, 0.16, 6), color: 0x2a2a2a, dx: cx + 0.16, dy: 0.30 + 0.08, dz: cz - 0.10 });
        out.push({ makeGeom: () => sphereLite(0.07), color: 0xe0e6ec, dx: cx + 0.16, dy: 0.30 + 0.20, dz: cz - 0.10 });
      }
      break;
    }
    case 'sawmill': {
      // Sawmill — bigger gabled barn with a tin roof + tall chimney.
      out.push({ makeGeom: () => box(0.62, 0.42, 0.50), color: woodMain, dx: cx, dy: 0.21, dz: cz });
      out.push({ makeGeom: () => cone(0.42, 0.22, 4), color: tinRoof, dx: cx, dy: 0.42 + 0.11, dz: cz });
      // Chimney + smoke when thriving.
      out.push({ makeGeom: () => cyl(0.05, 0.32, 6), color: 0x3a3a3a, dx: cx + 0.18, dy: 0.42 + 0.16, dz: cz });
      if (thriving) {
        out.push({ makeGeom: () => sphereLite(0.10), color: 0xe0e6ec, dx: cx + 0.18, dy: 0.42 + 0.36, dz: cz });
      }
      break;
    }
    case 'orchard': {
      // Tree farm — 3 rows × 4 small spruce saplings on the dirt pad.
      // The orchard is what makes the operation feel sustainable / real.
      const greens = [0x2f6a2d, 0x3a7a3a, 0x4a8e3a];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          const ox = -0.30 + col * 0.20;
          const oz = -0.30 + row * 0.30;
          // Small trunk + cone foliage. Skip the trunk for distance —
          // at this size it's barely visible anyway.
          out.push({ makeGeom: () => cone(0.06, 0.20, 5), color: greens[(row + col) % 3]!, dx: cx + ox, dy: 0.13, dz: cz + oz });
        }
      }
      break;
    }
    case 'log_pile': {
      // Log pile — three logs stacked + cross-row.
      for (let k = 0; k < 3; k++) {
        const g = new CylinderGeometry(0.06, 0.06, 0.55, 7);
        g.rotateZ(Math.PI / 2);
        out.push({ makeGeom: () => g, color: log, dx: cx, dy: 0.06 + k * 0.10, dz: cz - 0.18 });
      }
      for (let k = 0; k < 2; k++) {
        const g = new CylinderGeometry(0.06, 0.06, 0.55, 7);
        g.rotateZ(Math.PI / 2);
        out.push({ makeGeom: () => g, color: log, dx: cx, dy: 0.16 + k * 0.10, dz: cz + 0.05 });
      }
      break;
    }
    case 'drying_yard': {
      // Three log racks: parallel rails carrying logs.
      for (let r = 0; r < 3; r++) {
        const off = (r - 1) * 0.18;
        out.push({ makeGeom: () => box(0.50, 0.04, 0.04), color: 0x4a3020, dx: cx, dy: 0.05, dz: cz + off });
        const g = new CylinderGeometry(0.045, 0.045, 0.50, 7);
        g.rotateZ(Math.PI / 2);
        out.push({ makeGeom: () => g, color: log, dx: cx, dy: 0.115, dz: cz + off });
      }
      break;
    }
    case 'log_truck': {
      // Chassis box + cab + log payload.
      out.push({ makeGeom: () => box(0.60, 0.06, 0.20), color: 0x4a4a4a, dx: cx, dy: 0.04, dz: cz });
      out.push({ makeGeom: () => box(0.18, 0.16, 0.20), color: 0xb14a4a, dx: cx - 0.20, dy: 0.14, dz: cz });
      for (let k = 0; k < 3; k++) {
        const g = new CylinderGeometry(0.05, 0.05, 0.32, 7);
        g.rotateZ(Math.PI / 2);
        out.push({ makeGeom: () => g, color: log, dx: cx + 0.10, dy: 0.13 + k * 0.06, dz: cz });
      }
      break;
    }
    case 'crane': {
      out.push({ makeGeom: () => box(0.06, 0.55, 0.06), color: 0xc9a437, dx: cx, dy: 0.275, dz: cz });
      out.push({ makeGeom: () => box(0.42, 0.04, 0.04), color: 0xc9a437, dx: cx + 0.18, dy: 0.55, dz: cz });
      out.push({ makeGeom: () => box(0.012, 0.20, 0.012), color: 0x222222, dx: cx + 0.34, dy: 0.45, dz: cz });
      out.push({ makeGeom: () => box(0.05, 0.05, 0.05), color: 0x4a4a4a, dx: cx + 0.34, dy: 0.32, dz: cz });
      break;
    }
    case 'kiln': {
      out.push({ makeGeom: () => cyl(0.18, 0.40, 10), color: 0xa68260, dx: cx, dy: 0.20, dz: cz });
      out.push({ makeGeom: () => cone(0.18, 0.10, 10), color: 0x6e4a30, dx: cx, dy: 0.40 + 0.05, dz: cz });
      if (thriving) {
        out.push({ makeGeom: () => sphereLite(0.13), color: 0xe0e6ec, dx: cx, dy: 0.40 + 0.18, dz: cz });
      }
      break;
    }
    case 'fuel_tank': {
      const g = new CylinderGeometry(0.16, 0.16, 0.52, 10);
      g.rotateZ(Math.PI / 2);
      out.push({ makeGeom: () => g, color: 0xb14a3a, dx: cx, dy: 0.20, dz: cz });
      out.push({ makeGeom: () => box(0.06, 0.06, 0.10), color: 0x222222, dx: cx - 0.20, dy: 0.06, dz: cz });
      out.push({ makeGeom: () => box(0.06, 0.06, 0.10), color: 0x222222, dx: cx + 0.20, dy: 0.06, dz: cz });
      break;
    }
    case 'office': {
      out.push({ makeGeom: () => box(0.65, 0.22, 0.35), color: woodPale, dx: cx, dy: 0.16, dz: cz });
      out.push({ makeGeom: () => box(0.66, 0.02, 0.36), color: 0x4a4a44, dx: cx, dy: 0.28, dz: cz });
      out.push({ makeGeom: () => box(0.50, 0.06, 0.018), color: 0x2a3a4a, dx: cx, dy: 0.20, dz: cz - 0.18 });
      out.push({ makeGeom: () => box(0.10, 0.14, 0.018), color: 0x3a2a18, dx: cx + 0.18, dy: 0.13, dz: cz + 0.18 });
      break;
    }
    case 'conveyor': {
      const belt = new BoxGeometry(0.55, 0.04, 0.16);
      belt.rotateZ(-Math.PI / 8);
      out.push({ makeGeom: () => belt, color: 0x222222, dx: cx, dy: 0.18, dz: cz });
      out.push({ makeGeom: () => box(0.06, 0.04, 0.18), color: 0x4a4a4a, dx: cx - 0.24, dy: 0.10, dz: cz });
      out.push({ makeGeom: () => box(0.06, 0.04, 0.18), color: 0x4a4a4a, dx: cx + 0.24, dy: 0.26, dz: cz });
      break;
    }
    case 'rail': {
      out.push({ makeGeom: () => box(0.85, 0.018, 0.04), color: 0x6a6a6a, dx: cx, dy: 0.012, dz: cz - 0.10 });
      out.push({ makeGeom: () => box(0.85, 0.018, 0.04), color: 0x6a6a6a, dx: cx, dy: 0.012, dz: cz + 0.10 });
      for (let k = 0; k < 5; k++) {
        const off = -0.30 + k * 0.16;
        out.push({ makeGeom: () => box(0.10, 0.014, 0.30), color: 0x4a3020, dx: cx + off, dy: 0.008, dz: cz });
      }
      break;
    }
  }
}

/**
 * Linearly interpolate between two hex RGB colours by t ∈ [0,1].
 * Used by both the forestry health palette and (Alpha 2.7) the
 * happiness-based building tinting.
 */
/**
 * Modular farm renderer (Alpha 2.7.1). Same cohesive-cluster approach as
 * forestry: continuous green pad, perimeter rail fence, paved connector
 * paths between adjacent tiles, and per-tile roles drawn from a sequence
 * that weaves crop fields between primary structures so even a small
 * farm reads as fields-plus-buildings.
 *
 * Roles (tile order in lex-sorted cluster):
 *  hut (farmhouse) → barn → crops → silo → crops → animal_pen → tractor
 *  → crops → greenhouse → water_tank → crops → orchard → windmill →
 *  compost
 *
 * `health` ∈ [0, 1] modulates colour saturation, crop fullness, paint
 * vibrancy, and whether the windmill blades are healthy white vs faded.
 */
function farmClusterParts(
  cluster: Array<{ x: number; y: number }>,
  health: number
): CityBuildingPart[] {
  if (cluster.length === 0) return [];
  const out: CityBuildingPart[] = [];
  const sorted = cluster.slice().sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const member = new Set<string>();
  for (const c of sorted) member.add(c.x + ',' + c.y);
  const isMember = (x: number, y: number) => member.has(x + ',' + y);

  const grass = lerpColor(0x4a6f3a, 0x6a9054, health);
  const dirt = lerpColor(0x5a4830, 0x7a6240, health);
  const woodMain = lerpColor(0x9a4a3a, 0xc06750, health);   // barn-red, faded → vivid
  const woodPale = lerpColor(0xc0a87a, 0xe8d4a4, health);
  const tinRoof = lerpColor(0x4a4a44, 0x707064, health);
  const cropMature = lerpColor(0x9aa838, 0xd6c64a, health);
  const cropYoung = lerpColor(0x6a8a30, 0x9ab644, health);
  const struggling = health < 0.45;
  const thriving = health > 0.85;

  // 1. Continuous green pad — like a managed pasture under everything.
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    out.push({ makeGeom: () => box(1.04, 0.025, 1.04), color: grass, dx: cx, dy: 0.013, dz: cz });
  }

  // 2. Internal connector paths — dirt strips so adjacent farm tiles
  // visibly link into one operation.
  const dirs: Array<[number, number]> = [[1, 0], [0, 1]];
  for (const c of sorted) {
    for (const [dx, dy] of dirs) {
      if (!isMember(c.x + dx, c.y + dy)) continue;
      const cx0 = (c.x + 0.5) * TILE_SIZE;
      const cz0 = (c.y + 0.5) * TILE_SIZE;
      const cx1 = (c.x + dx + 0.5) * TILE_SIZE;
      const cz1 = (c.y + dy + 0.5) * TILE_SIZE;
      const midX = (cx0 + cx1) / 2;
      const midZ = (cz0 + cz1) / 2;
      const w = dx !== 0 ? 1.10 : 0.16;
      const d = dy !== 0 ? 1.10 : 0.16;
      out.push({ makeGeom: () => box(w, 0.012, d), color: dirt, dx: midX, dy: 0.027, dz: midZ });
    }
  }

  // 3. Perimeter rail fence (white) — classic country farm look.
  const fenceColor = lerpColor(0xb0a890, 0xe8e2cc, health);
  const fenceLen = 0.85;
  const fencePostH = 0.10;
  for (const c of sorted) {
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const sides: Array<[number, number, [number, number]]> = [
      [0, -1, [0, -0.50]],
      [1, 0, [0.50, 0]],
      [0, 1, [0, 0.50]],
      [-1, 0, [-0.50, 0]]
    ];
    for (const [ndx, ndy, [ex, ez]] of sides) {
      if (isMember(c.x + ndx, c.y + ndy)) continue;
      const horizontal = ndy !== 0;
      // Two parallel rails (looks like classic 3-board farm fence).
      for (const railY of [0.06, 0.105]) {
        const railW = horizontal ? fenceLen : 0.018;
        const railD = horizontal ? 0.018 : fenceLen;
        out.push({ makeGeom: () => box(railW, 0.014, railD), color: fenceColor, dx: cx + ex, dy: railY, dz: cz + ez });
      }
      const postOff = horizontal ? [(-fenceLen / 2 + 0.04), 0, (fenceLen / 2 - 0.04)] : [];
      const postOffZ = !horizontal ? [(-fenceLen / 2 + 0.04), 0, (fenceLen / 2 - 0.04)] : [];
      if (horizontal) {
        for (const po of postOff) {
          out.push({ makeGeom: () => box(0.022, fencePostH, 0.022), color: fenceColor, dx: cx + ex + po, dy: 0.05, dz: cz + ez });
        }
      } else {
        for (const po of postOffZ) {
          out.push({ makeGeom: () => box(0.022, fencePostH, 0.022), color: fenceColor, dx: cx + ex, dy: 0.05, dz: cz + ez + po });
        }
      }
    }
  }

  // 4. Per-tile roles. Crops fill in between primary buildings.
  const ROLES: FarmRole[] = [
    'farmhouse', 'barn', 'crops', 'silo', 'crops',
    'animal_pen', 'tractor', 'crops', 'greenhouse', 'water_tank',
    'crops', 'orchard', 'windmill', 'compost'
  ];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    const cx = (c.x + 0.5) * TILE_SIZE;
    const cz = (c.y + 0.5) * TILE_SIZE;
    const role: FarmRole = i < ROLES.length ? ROLES[i]! : 'crops';
    emitFarmFeature(out, role, cx, cz, woodMain, woodPale, tinRoof, dirt, cropMature, cropYoung, thriving, struggling);
  }

  return out;
}

type FarmRole =
  | 'farmhouse' | 'barn' | 'crops' | 'silo' | 'animal_pen'
  | 'tractor' | 'greenhouse' | 'water_tank' | 'orchard'
  | 'windmill' | 'compost';

function emitFarmFeature(
  out: CityBuildingPart[], role: FarmRole,
  cx: number, cz: number,
  woodMain: number, woodPale: number, tinRoof: number, dirt: number,
  cropMature: number, cropYoung: number,
  thriving: boolean, struggling: boolean
): void {
  switch (role) {
    case 'farmhouse': {
      // Two-storey farmhouse: cream body + red gable roof + chimney.
      out.push({ makeGeom: () => box(0.48, 0.36, 0.40), color: woodPale, dx: cx, dy: 0.18, dz: cz });
      out.push({ makeGeom: () => cone(0.35, 0.20, 4), color: woodMain, dx: cx, dy: 0.36 + 0.10, dz: cz });
      out.push({ makeGeom: () => box(0.07, 0.18, 0.07), color: 0x6e4a3a, dx: cx + 0.16, dy: 0.36 + 0.09, dz: cz - 0.08 });
      // Front door + window.
      out.push({ makeGeom: () => box(0.10, 0.18, 0.018), color: 0x3a2a18, dx: cx, dy: 0.09, dz: cz + 0.20 + 0.009 });
      out.push({ makeGeom: () => box(0.08, 0.06, 0.018), color: 0x2a3a4a, dx: cx + 0.14, dy: 0.22, dz: cz + 0.20 + 0.009 });
      if (thriving) {
        out.push({ makeGeom: () => sphereLite(0.06), color: 0xe0e6ec, dx: cx + 0.16, dy: 0.36 + 0.22, dz: cz - 0.08 });
      }
      break;
    }
    case 'barn': {
      // Big red barn — wider gable + tall roof + hayloft door.
      out.push({ makeGeom: () => box(0.65, 0.42, 0.55), color: woodMain, dx: cx, dy: 0.21, dz: cz });
      out.push({ makeGeom: () => cone(0.46, 0.24, 4), color: 0x4a3020, dx: cx, dy: 0.42 + 0.12, dz: cz });
      // White trim on the doors.
      out.push({ makeGeom: () => box(0.30, 0.32, 0.018), color: woodPale, dx: cx, dy: 0.16, dz: cz + 0.275 + 0.009 });
      // X-brace on the doors.
      out.push({ makeGeom: () => box(0.30, 0.022, 0.020), color: woodMain, dx: cx, dy: 0.16, dz: cz + 0.275 + 0.018 });
      out.push({ makeGeom: () => box(0.022, 0.32, 0.020), color: woodMain, dx: cx, dy: 0.16, dz: cz + 0.275 + 0.018 });
      // Hayloft door.
      out.push({ makeGeom: () => box(0.10, 0.08, 0.020), color: 0x3a2a18, dx: cx, dy: 0.40, dz: cz + 0.275 + 0.020 });
      break;
    }
    case 'crops': {
      // Crop field — 5 rows × 6 short rectangular crop strips. Mature
      // when thriving (taller, golden), young when struggling.
      const rows = 5;
      const cols = 6;
      const stripW = 0.10;
      const stripD = 0.13;
      const stripH = thriving ? 0.10 : (struggling ? 0.04 : 0.07);
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const ox = -0.36 + col * 0.144;
          const oz = -0.30 + r * 0.15;
          const c = (r + col) % 2 === 0 ? cropMature : cropYoung;
          out.push({ makeGeom: () => box(stripW, stripH, stripD * 0.5), color: c, dx: cx + ox, dy: stripH / 2, dz: cz + oz });
        }
      }
      // Furrow lines between rows.
      for (let r = 0; r <= rows; r++) {
        out.push({ makeGeom: () => box(0.86, 0.012, 0.020), color: dirt, dx: cx, dy: 0.026, dz: cz - 0.36 + r * 0.15 });
      }
      break;
    }
    case 'silo': {
      // Tall metal silo + dome cap + ladder strip.
      out.push({ makeGeom: () => cyl(0.18, 0.70, 12), color: 0xb8b8b0, dx: cx, dy: 0.35, dz: cz });
      out.push({ makeGeom: () => cone(0.18, 0.10, 12), color: 0x707064, dx: cx, dy: 0.70 + 0.05, dz: cz });
      // Ladder.
      for (let k = 0; k < 5; k++) {
        out.push({ makeGeom: () => box(0.05, 0.018, 0.014), color: 0x3a3a3a, dx: cx + 0.18 + 0.012, dy: 0.10 + k * 0.13, dz: cz });
      }
      // Conveyor pipe dropping from silo to barn-side.
      out.push({ makeGeom: () => box(0.18, 0.05, 0.06), color: 0x707064, dx: cx + 0.10, dy: 0.50, dz: cz });
      break;
    }
    case 'animal_pen': {
      // Small open shelter + 4 sheep / cows (just colored cubes for the
      // low-poly aesthetic).
      out.push({ makeGeom: () => box(0.50, 0.18, 0.30), color: woodMain, dx: cx - 0.18, dy: 0.09, dz: cz });
      out.push({ makeGeom: () => cone(0.35, 0.10, 4), color: tinRoof, dx: cx - 0.18, dy: 0.18 + 0.05, dz: cz });
      // Animals — small white (sheep) + brown (cow) blobs.
      const animals = [
        { x: 0.10, z: -0.18, c: 0xeae3d0 },
        { x: 0.22, z: 0.10, c: 0xeae3d0 },
        { x: 0.28, z: -0.05, c: 0x6a4a3a },
        { x: 0.05, z: 0.20, c: 0xeae3d0 }
      ];
      for (const a of animals) {
        out.push({ makeGeom: () => box(0.10, 0.07, 0.07), color: a.c, dx: cx + a.x, dy: 0.04, dz: cz + a.z });
      }
      break;
    }
    case 'tractor': {
      // Small green tractor — body + cab + 4 wheels.
      out.push({ makeGeom: () => box(0.32, 0.10, 0.18), color: 0x5e8e3a, dx: cx, dy: 0.07, dz: cz });
      out.push({ makeGeom: () => box(0.12, 0.10, 0.16), color: 0x5e8e3a, dx: cx + 0.04, dy: 0.16, dz: cz });
      // Wheels (large rear, small front).
      for (const w of [
        { x: -0.10, z: -0.12, r: 0.07 },
        { x: -0.10, z:  0.12, r: 0.07 },
        { x:  0.12, z: -0.10, r: 0.045 },
        { x:  0.12, z:  0.10, r: 0.045 }
      ]) {
        const g = new CylinderGeometry(w.r, w.r, 0.04, 8);
        g.rotateX(Math.PI / 2);
        out.push({ makeGeom: () => g, color: 0x222222, dx: cx + w.x, dy: w.r, dz: cz + w.z });
      }
      // Exhaust stack.
      out.push({ makeGeom: () => cyl(0.018, 0.12, 6), color: 0x222222, dx: cx + 0.10, dy: 0.27, dz: cz - 0.06 });
      break;
    }
    case 'greenhouse': {
      // Glass A-frame: pale frame body + light-blue gable roof.
      out.push({ makeGeom: () => box(0.55, 0.16, 0.40), color: woodPale, dx: cx, dy: 0.08, dz: cz });
      // Glass roof — gable. Build positions in tile-local space so the
      // outer translate(p.dx, p.dy, p.dz) works correctly.
      out.push({
        makeGeom: () => {
          const positions = new Float32Array([
            -0.275, 0.16, -0.20,
             0.275, 0.16, -0.20,
             0.275, 0.16,  0.20,
            -0.275, 0.16,  0.20,
                 0, 0.36, -0.20,
                 0, 0.36,  0.20
          ]);
          const indices = new Uint32Array([
            0, 1, 4, 4, 1, 5,
            3, 5, 2, 5, 1, 2,
            0, 4, 3, 3, 4, 5,
            1, 5, 4
          ]);
          const g = new BufferGeometry();
          g.setAttribute('position', new BufferAttribute(positions, 3));
          g.setIndex(new BufferAttribute(indices, 1));
          return g;
        },
        color: 0xa6c8d4,
        dx: cx, dy: 0, dz: cz
      });
      // Door on the south face.
      out.push({ makeGeom: () => box(0.08, 0.10, 0.018), color: woodPale, dx: cx, dy: 0.05, dz: cz + 0.20 + 0.009 });
      break;
    }
    case 'water_tank': {
      // Round blue water tank on stilts.
      for (const dx of [-0.16, 0.16]) for (const dz of [-0.16, 0.16]) {
        out.push({ makeGeom: () => box(0.04, 0.30, 0.04), color: 0x2f3f4a, dx: cx + dx, dy: 0.15, dz: cz + dz });
      }
      out.push({ makeGeom: () => cyl(0.22, 0.22, 12), color: 0x4d8eb9, dx: cx, dy: 0.30 + 0.11, dz: cz });
      out.push({ makeGeom: () => cone(0.22, 0.10, 12), color: 0x3e7aa0, dx: cx, dy: 0.30 + 0.22 + 0.05, dz: cz });
      // Spigot pipe.
      out.push({ makeGeom: () => cyl(0.018, 0.30, 6), color: 0x707880, dx: cx + 0.16, dy: 0.15, dz: cz });
      break;
    }
    case 'orchard': {
      // 9 small fruit trees in a 3x3 grid.
      for (let r = 0; r < 3; r++) {
        for (let col = 0; col < 3; col++) {
          const ox = -0.30 + col * 0.30;
          const oz = -0.30 + r * 0.30;
          out.push({ makeGeom: () => cyl(0.025, 0.10, 5), color: 0x6e4a30, dx: cx + ox, dy: 0.05, dz: cz + oz });
          out.push({ makeGeom: () => sphereLite(0.10), color: 0x3a7a3a, dx: cx + ox, dy: 0.16, dz: cz + oz });
          // Fruit dots when thriving.
          if (thriving) {
            out.push({ makeGeom: () => sphereLite(0.022), color: 0xb14a3a, dx: cx + ox + 0.05, dy: 0.18, dz: cz + oz });
          }
        }
      }
      break;
    }
    case 'windmill': {
      // Tower + blades.
      out.push({ makeGeom: () => box(0.10, 0.55, 0.10), color: woodPale, dx: cx, dy: 0.275, dz: cz });
      // Hub.
      out.push({ makeGeom: () => cyl(0.05, 0.05, 8), color: 0x4a4a4a, dx: cx, dy: 0.55, dz: cz - 0.05 });
      // Four blades — long thin boxes radiating from the hub.
      const bladeColor = thriving ? 0xfafbfc : 0xc8bdac;
      const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      for (const a of angles) {
        const blade = new BoxGeometry(0.30, 0.04, 0.012);
        blade.translate(0.15, 0, 0);
        blade.rotateZ(a);
        blade.translate(cx, 0.55, cz - 0.05);
        out.push({ makeGeom: () => blade, color: bladeColor, dx: 0, dy: 0, dz: 0 });
      }
      break;
    }
    case 'compost': {
      // Three covered compost bins side by side.
      for (let k = -1; k <= 1; k++) {
        const ox = k * 0.20;
        out.push({ makeGeom: () => box(0.16, 0.10, 0.20), color: 0x4a3a28, dx: cx + ox, dy: 0.05, dz: cz });
        out.push({ makeGeom: () => box(0.18, 0.018, 0.22), color: 0x6a5a40, dx: cx + ox, dy: 0.10 + 0.009, dz: cz });
        // Crumbly visible top.
        out.push({ makeGeom: () => box(0.10, 0.04, 0.16), color: 0x3a2a1a, dx: cx + ox, dy: 0.07, dz: cz });
      }
      break;
    }
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const c = Math.round(ab + (bb - ab) * u);
  return (r << 16) | (g << 8) | c;
}

interface CityBuildingPart {
  makeGeom: () => BufferGeometry;
  color: number;
  dx: number;
  dy: number;
  dz: number;
}

function cityBuildingParts(b: string): CityBuildingPart[] {
  switch (b) {
    case 'power_plant':
      // Polished power plant (Alpha 2.2) — main hall, hyperboloid-ish
      // cooling tower (cylinder narrowing to a smaller top), exhaust
      // stack with red cap, plus a vapour puff above the cooling tower.
      return [
        // Main hall.
        { makeGeom: () => box(0.65, 0.45, 0.55), color: 0x484848, dx: 0, dy: 0.225, dz: 0 },
        // Roof banding to break up the slab.
        { makeGeom: () => box(0.66, 0.04, 0.56), color: 0x2e2e2e, dx: 0, dy: 0.46, dz: 0 },
        // Cooling tower base (wide cylinder).
        { makeGeom: () => cyl(0.18, 0.25, 12), color: 0x9a9a9a, dx: -0.20, dy: 0.125, dz: 0.18 },
        // Cooling tower waist (narrower).
        { makeGeom: () => cyl(0.13, 0.45, 12), color: 0xb0b0b0, dx: -0.20, dy: 0.25 + 0.225, dz: 0.18 },
        // Cooling tower lip.
        { makeGeom: () => cyl(0.16, 0.04, 12), color: 0x808080, dx: -0.20, dy: 0.25 + 0.45 + 0.02, dz: 0.18 },
        // Vapour puff above the cooling tower.
        { makeGeom: () => sphereLite(0.18), color: 0xe0e6ec, dx: -0.20, dy: 0.25 + 0.45 + 0.20, dz: 0.18 },
        // Exhaust stack on the hall roof.
        { makeGeom: () => cyl(0.08, 0.55, 8), color: 0x6e6e6e, dx: 0.20, dy: 0.45 + 0.275, dz: -0.10 },
        // Stack red top band.
        { makeGeom: () => cyl(0.085, 0.06, 8), color: 0xb14a4a, dx: 0.20, dy: 0.45 + 0.55 + 0.03, dz: -0.10 }
      ];
    case 'water_tower':
      // Polished water tower (Alpha 2.2) — cross-braced legs, ladder
      // strip up one side, dome top, drain pipe.
      return [
        // Four corner legs.
        { makeGeom: () => box(0.07, 0.55, 0.07), color: 0x2f3f4a, dx: -0.18, dy: 0.275, dz: -0.18 },
        { makeGeom: () => box(0.07, 0.55, 0.07), color: 0x2f3f4a, dx:  0.18, dy: 0.275, dz: -0.18 },
        { makeGeom: () => box(0.07, 0.55, 0.07), color: 0x2f3f4a, dx: -0.18, dy: 0.275, dz:  0.18 },
        { makeGeom: () => box(0.07, 0.55, 0.07), color: 0x2f3f4a, dx:  0.18, dy: 0.275, dz:  0.18 },
        // Cross-braces (X pattern on the south face).
        { makeGeom: () => box(0.42, 0.022, 0.022), color: 0x222a32, dx: 0, dy: 0.32, dz: -0.18 },
        { makeGeom: () => box(0.42, 0.022, 0.022), color: 0x222a32, dx: 0, dy: 0.20, dz:  0.18 },
        // Tank — fatter cylinder.
        { makeGeom: () => cyl(0.32, 0.40, 12), color: 0x4d8eb9, dx: 0, dy: 0.55 + 0.20, dz: 0 },
        // Cap dome (cone) on top.
        { makeGeom: () => cone(0.32, 0.14, 12), color: 0x3e7aa0, dx: 0, dy: 0.55 + 0.40 + 0.07, dz: 0 },
        // Drain pipe down one leg to the ground.
        { makeGeom: () => cyl(0.018, 0.55, 6), color: 0x707880, dx: 0.20, dy: 0.275, dz: 0 }
      ];
    case 'park':
      // Polished park (Alpha 2.1) — green pad, central pond, two
      // benches flanking a paved path, and three trees in different
      // sizes for visual variety. Reads as a real city park rather
      // than a single tree on a green dot.
      return [
        // Lawn pad.
        { makeGeom: () => box(0.85, 0.04, 0.85), color: 0x4a8c3a, dx: 0, dy: 0.02, dz: 0 },
        // Diagonal stone path strip.
        { makeGeom: () => box(0.18, 0.05, 0.85), color: 0xc7c2b3, dx: 0, dy: 0.025, dz: 0 },
        // Round pond.
        { makeGeom: () => cyl(0.18, 0.06, 12), color: 0x4d8eb9, dx: -0.20, dy: 0.025, dz: -0.18 },
        // Bench 1 — slats + 2 legs.
        { makeGeom: () => box(0.18, 0.025, 0.04), color: 0x6b4f3a, dx: 0.22, dy: 0.07, dz: 0.18 },
        { makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: 0.30, dy: 0.045, dz: 0.18 },
        { makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: 0.14, dy: 0.045, dz: 0.18 },
        // Bench 2 — opposite side.
        { makeGeom: () => box(0.18, 0.025, 0.04), color: 0x6b4f3a, dx: -0.22, dy: 0.07, dz: 0.18 },
        { makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: -0.14, dy: 0.045, dz: 0.18 },
        { makeGeom: () => box(0.018, 0.05, 0.04), color: 0x3a2a20, dx: -0.30, dy: 0.045, dz: 0.18 },
        // Tree A — large central-back.
        { makeGeom: () => cyl(0.04, 0.16, 6), color: 0x6b3f1f, dx: 0.22, dy: 0.11, dz: -0.22 },
        { makeGeom: () => cone(0.20, 0.34, 8), color: 0x2f6a2d, dx: 0.22, dy: 0.36, dz: -0.22 },
        // Tree B — medium left.
        { makeGeom: () => cyl(0.035, 0.13, 6), color: 0x6b3f1f, dx: -0.32, dy: 0.095, dz: -0.05 },
        { makeGeom: () => cone(0.16, 0.26, 8), color: 0x3a7a3a, dx: -0.32, dy: 0.30, dz: -0.05 },
        // Tree C — small right.
        { makeGeom: () => cyl(0.028, 0.10, 6), color: 0x6b3f1f, dx: 0.32, dy: 0.08, dz: 0.05 },
        { makeGeom: () => cone(0.13, 0.20, 8), color: 0x4a8e44, dx: 0.32, dy: 0.25, dz: 0.05 }
      ];
    case 'school': {
      // Brick schoolhouse + clock tower + flagpole. Reads as a small
      // K-8 building. Cream stucco walls, terracotta roof.
      return [
        // Lawn pad.
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0x4a8c3a, dx: 0, dy: 0.013, dz: 0 },
        // Main wing.
        { makeGeom: () => box(0.78, 0.36, 0.46), color: 0xd6c9a8, dx: 0, dy: 0.18, dz: -0.02 },
        // Hipped roof.
        { makeGeom: () => cone(0.50, 0.18, 4), color: 0x8a3d2a, dx: 0, dy: 0.36 + 0.09, dz: -0.02 },
        // Clock tower.
        { makeGeom: () => box(0.18, 0.40, 0.18), color: 0xc7b08a, dx: 0.24, dy: 0.20, dz: 0.18 },
        { makeGeom: () => cyl(0.10, 0.04, 12), color: 0xe6d8b8, dx: 0.24, dy: 0.42, dz: 0.18 },
        { makeGeom: () => cone(0.13, 0.16, 6), color: 0x6a3422, dx: 0.24, dy: 0.50, dz: 0.18 },
        // Flagpole + flag.
        { makeGeom: () => cyl(0.012, 0.55, 5), color: 0x9c9c9c, dx: -0.30, dy: 0.275, dz: 0.30 },
        { makeGeom: () => box(0.10, 0.07, 0.012), color: 0xb14a3a, dx: -0.30 + 0.05, dy: 0.50, dz: 0.30 },
        // Door.
        { makeGeom: () => box(0.10, 0.18, 0.018), color: 0x4a3a18, dx: 0, dy: 0.09, dz: -0.02 + 0.23 + 0.009 },
        // Window strip on the front face.
        { makeGeom: () => box(0.50, 0.06, 0.018), color: 0x2a3a4a, dx: 0, dy: 0.22, dz: -0.02 + 0.23 + 0.009 }
      ];
    }
    case 'hospital': {
      // White building, red cross sign, ambulance bay.
      return [
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0xc8c4be, dx: 0, dy: 0.013, dz: 0 },
        // Main tower (taller).
        { makeGeom: () => box(0.62, 0.62, 0.50), color: 0xeae3d0, dx: 0, dy: 0.31, dz: -0.06 },
        // Top trim.
        { makeGeom: () => box(0.64, 0.04, 0.52), color: 0xc7c2b3, dx: 0, dy: 0.62 + 0.02, dz: -0.06 },
        // Red cross sign — vertical + horizontal bars on the front face.
        { makeGeom: () => box(0.06, 0.18, 0.018), color: 0xb14a3a, dx: 0, dy: 0.42, dz: -0.06 + 0.25 + 0.009 },
        { makeGeom: () => box(0.18, 0.06, 0.018), color: 0xb14a3a, dx: 0, dy: 0.42, dz: -0.06 + 0.25 + 0.009 },
        // Ambulance bay (lower wing).
        { makeGeom: () => box(0.40, 0.22, 0.32), color: 0xc7c2b3, dx: 0.30, dy: 0.11, dz: 0.20 },
        { makeGeom: () => box(0.40, 0.025, 0.32), color: 0x4a4a44, dx: 0.30, dy: 0.22 + 0.013, dz: 0.20 },
        { makeGeom: () => box(0.30, 0.16, 0.018), color: 0x3a3a3a, dx: 0.30, dy: 0.08, dz: 0.20 + 0.16 + 0.009 },
        // Window grid suggestion.
        { makeGeom: () => box(0.50, 0.08, 0.018), color: 0x6a8eb0, dx: 0, dy: 0.20, dz: -0.06 + 0.25 + 0.010 },
        { makeGeom: () => box(0.50, 0.08, 0.018), color: 0x6a8eb0, dx: 0, dy: 0.55, dz: -0.06 + 0.25 + 0.010 }
      ];
    }
    case 'fire_station': {
      // Red brick station with a tall hose-drying tower + ladder + sign.
      return [
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0x6a6a6a, dx: 0, dy: 0.013, dz: 0 },
        // Main hall.
        { makeGeom: () => box(0.72, 0.40, 0.52), color: 0xb14a3a, dx: 0, dy: 0.20, dz: -0.04 },
        // White trim band.
        { makeGeom: () => box(0.74, 0.04, 0.54), color: 0xeae3d0, dx: 0, dy: 0.40 + 0.02, dz: -0.04 },
        // Hose-drying tower.
        { makeGeom: () => box(0.22, 0.62, 0.22), color: 0x9c4030, dx: 0.22, dy: 0.31, dz: 0.18 },
        { makeGeom: () => cone(0.18, 0.10, 4), color: 0x4a3a2a, dx: 0.22, dy: 0.62 + 0.05, dz: 0.18 },
        // Bay door.
        { makeGeom: () => box(0.40, 0.32, 0.018), color: 0x2a2a2a, dx: -0.10, dy: 0.16, dz: -0.04 + 0.26 + 0.009 },
        // White cross-bar on the bay door.
        { makeGeom: () => box(0.40, 0.022, 0.020), color: 0xeae3d0, dx: -0.10, dy: 0.16, dz: -0.04 + 0.26 + 0.018 },
        // Sign panel above the bay.
        { makeGeom: () => box(0.40, 0.07, 0.018), color: 0xeae3d0, dx: -0.10, dy: 0.34, dz: -0.04 + 0.26 + 0.012 }
      ];
    }
    case 'police_station': {
      // Stone-grey precinct with blue lights + a small porch.
      return [
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0x6a6a6a, dx: 0, dy: 0.013, dz: 0 },
        // Main building.
        { makeGeom: () => box(0.72, 0.40, 0.52), color: 0x4a5a6a, dx: 0, dy: 0.20, dz: -0.04 },
        // Trim band.
        { makeGeom: () => box(0.74, 0.04, 0.54), color: 0x2a3a4a, dx: 0, dy: 0.40 + 0.02, dz: -0.04 },
        // Roof.
        { makeGeom: () => box(0.72, 0.05, 0.52), color: 0x2a2a2a, dx: 0, dy: 0.40 + 0.07, dz: -0.04 },
        // Porch.
        { makeGeom: () => box(0.36, 0.04, 0.18), color: 0x3a3a3a, dx: 0, dy: 0.04, dz: 0.30 },
        // Two columns on the porch.
        { makeGeom: () => box(0.04, 0.20, 0.04), color: 0xc8c4be, dx: -0.14, dy: 0.10, dz: 0.36 },
        { makeGeom: () => box(0.04, 0.20, 0.04), color: 0xc8c4be, dx:  0.14, dy: 0.10, dz: 0.36 },
        // Door.
        { makeGeom: () => box(0.10, 0.18, 0.018), color: 0x222222, dx: 0, dy: 0.09, dz: -0.04 + 0.26 + 0.009 },
        // "POLICE" sign band.
        { makeGeom: () => box(0.50, 0.06, 0.018), color: 0xeae3d0, dx: 0, dy: 0.30, dz: -0.04 + 0.26 + 0.010 },
        // Two blue light bars on the roof.
        { makeGeom: () => box(0.06, 0.04, 0.06), color: 0x4d8eb9, dx: -0.10, dy: 0.40 + 0.10, dz: -0.04 },
        { makeGeom: () => box(0.06, 0.04, 0.06), color: 0xb14a3a, dx:  0.10, dy: 0.40 + 0.10, dz: -0.04 }
      ];
    }
    case 'bus_stop':
      return [
        { makeGeom: () => box(0.06, 0.45, 0.06), color: 0xc9a437, dx: 0, dy: 0.225, dz: 0 },
        { makeGeom: () => box(0.30, 0.04, 0.18), color: 0xe5c25a, dx: 0, dy: 0.45 + 0.02, dz: 0 }
      ];
    case 'museum': {
      // Neoclassical: stone podium + columned colonnade + pedimented roof.
      // Pure facade: keeps the silhouette readable on a single tile.
      const cols: ReturnType<() => CityBuildingPart[]> = [];
      const colY = 0.04 + 0.32 / 2; // sit half-depth above the podium top
      for (let i = 0; i < 6; i++) {
        const dx = -0.30 + i * 0.12;
        cols.push({ makeGeom: () => cyl(0.025, 0.32, 8), color: 0xece4cf, dx, dy: 0.04 + 0.16, dz: 0.30 });
        // Suppress unused-variable lint
        void colY;
      }
      return [
        { makeGeom: () => box(0.92, 0.05, 0.78), color: 0xc7bfa9, dx: 0, dy: 0.025, dz: 0 },
        // Stone body (sits behind the colonnade).
        { makeGeom: () => box(0.85, 0.42, 0.55), color: 0xddd2b7, dx: 0, dy: 0.04 + 0.21, dz: -0.10 },
        // Pediment — triangular roof gestured with a thin slab.
        { makeGeom: () => box(0.85, 0.06, 0.55), color: 0xb19f7f, dx: 0, dy: 0.04 + 0.42 + 0.03, dz: -0.10 },
        // Apex block.
        { makeGeom: () => box(0.20, 0.10, 0.20), color: 0xb19f7f, dx: 0, dy: 0.04 + 0.42 + 0.10, dz: -0.10 },
        ...cols,
        // Colonnade entablature.
        { makeGeom: () => box(0.85, 0.04, 0.10), color: 0xb6ac8e, dx: 0, dy: 0.04 + 0.34, dz: 0.30 },
        // Steps.
        { makeGeom: () => box(0.55, 0.025, 0.06), color: 0xc7bfa9, dx: 0, dy: 0.04 + 0.013, dz: 0.36 }
      ];
    }
    case 'stadium': {
      // Oval bowl: low base ring + raised seating + interior field.
      // Crisp silhouette on a single tile thanks to the elliptical body.
      // Cylinder approximated by a hex prism + interior field box; reads
      // unambiguously as a stadium at this art scale.
      return [
        // Field interior (green).
        { makeGeom: () => box(0.55, 0.025, 0.40), color: 0x4d8442, dx: 0, dy: 0.013, dz: 0 },
        // Outer concrete ring as 4 sweeping wedges of a hex prism.
        { makeGeom: () => cyl(0.46, 0.18, 18), color: 0xc4c0b6, dx: 0, dy: 0.09, dz: 0 },
        // Cut the field out by laying a green inner cylinder on top —
        // creates the bowl reveal.
        { makeGeom: () => cyl(0.34, 0.04, 18), color: 0x4d8442, dx: 0, dy: 0.18 + 0.02, dz: 0 },
        // Stadium lights — 4 corner pylons.
        { makeGeom: () => box(0.025, 0.30, 0.025), color: 0xb0b0b0, dx: -0.32, dy: 0.30, dz: -0.18 },
        { makeGeom: () => box(0.025, 0.30, 0.025), color: 0xb0b0b0, dx:  0.32, dy: 0.30, dz: -0.18 },
        { makeGeom: () => box(0.025, 0.30, 0.025), color: 0xb0b0b0, dx: -0.32, dy: 0.30, dz:  0.18 },
        { makeGeom: () => box(0.025, 0.30, 0.025), color: 0xb0b0b0, dx:  0.32, dy: 0.30, dz:  0.18 },
        // Light fixtures atop pylons.
        { makeGeom: () => box(0.10, 0.04, 0.04), color: 0xfff7d0, dx: -0.32, dy: 0.46, dz: -0.18 },
        { makeGeom: () => box(0.10, 0.04, 0.04), color: 0xfff7d0, dx:  0.32, dy: 0.46, dz: -0.18 },
        { makeGeom: () => box(0.10, 0.04, 0.04), color: 0xfff7d0, dx: -0.32, dy: 0.46, dz:  0.18 },
        { makeGeom: () => box(0.10, 0.04, 0.04), color: 0xfff7d0, dx:  0.32, dy: 0.46, dz:  0.18 }
      ];
    }
    case 'ferry_dock': {
      // Wooden pier on land + a short jetty extending toward water. Bright
      // red flag pole reads at any zoom level.
      return [
        // Land pad.
        { makeGeom: () => box(0.45, 0.04, 0.30), color: 0x6c4f2c, dx: -0.10, dy: 0.02, dz: 0 },
        // Jetty extending out (toward what we hope is water — the player
        // chose this tile because of the water adjacency).
        { makeGeom: () => box(0.20, 0.04, 0.85), color: 0x5a3f22, dx: 0.18, dy: 0.02, dz: 0 },
        // Cleat / bollard.
        { makeGeom: () => cyl(0.04, 0.10, 8), color: 0x444444, dx: 0.18, dy: 0.07, dz: 0.36 },
        { makeGeom: () => cyl(0.04, 0.10, 8), color: 0x444444, dx: 0.18, dy: 0.07, dz: -0.30 },
        // Sign + flagpole.
        { makeGeom: () => box(0.025, 0.40, 0.025), color: 0xb0a89b, dx: -0.18, dy: 0.20, dz: -0.06 },
        { makeGeom: () => box(0.18, 0.10, 0.012), color: 0xc94038, dx: -0.10, dy: 0.36, dz: -0.06 }
      ];
    }
    case 'subway_entrance': {
      // Compact stair-down pad: low pavement square with a recessed dark
      // pit + a green entry-sign post and a pair of bright handrails.
      return [
        // Pavement pad.
        { makeGeom: () => box(0.92, 0.025, 0.92), color: 0x9a9690, dx: 0, dy: 0.013, dz: 0 },
        // Recessed pit (the stairs going down).
        { makeGeom: () => box(0.36, 0.04, 0.50), color: 0x18181a, dx: 0, dy: 0.005, dz: -0.05 },
        // Stair tread suggestions — three bright rectangles across the pit.
        { makeGeom: () => box(0.32, 0.005, 0.06), color: 0x78b878, dx: 0, dy: 0.030, dz: 0.06 },
        { makeGeom: () => box(0.32, 0.005, 0.06), color: 0x78b878, dx: 0, dy: 0.030, dz: -0.04 },
        { makeGeom: () => box(0.32, 0.005, 0.06), color: 0x78b878, dx: 0, dy: 0.030, dz: -0.14 },
        // Handrails.
        { makeGeom: () => box(0.025, 0.10, 0.55), color: 0x5b6f78, dx: -0.20, dy: 0.06, dz: -0.05 },
        { makeGeom: () => box(0.025, 0.10, 0.55), color: 0x5b6f78, dx:  0.20, dy: 0.06, dz: -0.05 },
        // Sign post + green M placard.
        { makeGeom: () => box(0.030, 0.50, 0.030), color: 0xb0b0b0, dx: 0, dy: 0.25, dz: 0.36 },
        { makeGeom: () => box(0.20, 0.18, 0.018), color: 0x4d8442, dx: 0, dy: 0.40, dz: 0.36 }
      ];
    }
    case 'observatory': {
      // Conical building base + dome top + telescope slit. Reads instantly
      // because of the dome — no other building uses a hemisphere primitive.
      return [
        // Concrete pad.
        { makeGeom: () => box(0.92, 0.04, 0.92), color: 0x9a9690, dx: 0, dy: 0.02, dz: 0 },
        // Tapered conical body (bottom radius wider than the dome).
        { makeGeom: () => cone(0.40, 0.20, 18), color: 0xe7e4dc, dx: 0, dy: 0.04 + 0.10, dz: 0 },
        // Slim cylinder linking the body to the dome.
        { makeGeom: () => cyl(0.30, 0.18, 18), color: 0xe7e4dc, dx: 0, dy: 0.04 + 0.20 + 0.09, dz: 0 },
        // Dome cap — half-sphere via icosahedron, scaled flat by a thin box.
        { makeGeom: () => sphereLite(0.30), color: 0xc4c0b6, dx: 0, dy: 0.04 + 0.20 + 0.18, dz: 0 },
        // Telescope slit — dark thin slab cutting across the dome face.
        { makeGeom: () => box(0.06, 0.32, 0.04), color: 0x222222, dx: 0, dy: 0.04 + 0.20 + 0.18, dz: 0 },
        // Side door / entry.
        { makeGeom: () => box(0.10, 0.16, 0.018), color: 0x2a2a2a, dx: 0, dy: 0.04 + 0.08, dz: 0.30 + 0.005 }
      ];
    }
    case 'bus_depot':
      // Polished depot (Alpha 2.2) — main building + 3 yellow bay-marker
      // strips on the apron + a roof sign so it reads as a transit depot.
      return [
        // Apron base.
        { makeGeom: () => box(0.85, 0.04, 0.85), color: 0x6a6a6a, dx: 0, dy: 0.02, dz: 0 },
        // Bay markers — three yellow stripes on the apron.
        { makeGeom: () => box(0.04, 0.05, 0.30), color: 0xeec453, dx: -0.20, dy: 0.025, dz: 0.22 },
        { makeGeom: () => box(0.04, 0.05, 0.30), color: 0xeec453, dx:  0.00, dy: 0.025, dz: 0.22 },
        { makeGeom: () => box(0.04, 0.05, 0.30), color: 0xeec453, dx:  0.20, dy: 0.025, dz: 0.22 },
        // Main depot building (set back from the apron).
        { makeGeom: () => box(0.85, 0.42, 0.45), color: 0xc77a2a, dx: 0, dy: 0.04 + 0.21, dz: -0.18 },
        // Roof line.
        { makeGeom: () => box(0.85, 0.05, 0.45), color: 0x854f1c, dx: 0, dy: 0.04 + 0.42 + 0.025, dz: -0.18 },
        // Garage door — wide darker panel on the apron-facing wall.
        { makeGeom: () => box(0.55, 0.32, 0.012), color: 0x6a3818, dx: 0, dy: 0.04 + 0.16, dz: -0.18 + 0.225 + 0.005 },
        // Yellow sign at the roofline.
        { makeGeom: () => box(0.30, 0.10, 0.014), color: 0xeec453, dx: 0, dy: 0.04 + 0.42 + 0.05, dz: -0.18 + 0.225 + 0.008 }
      ];
    default:
      return [];
  }
}

function box(w: number, h: number, d: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  return g;
}
function sphereLite(r: number): BufferGeometry {
  // Detail 0 = octahedron, detail 1 = 42 verts. Detail 1 reads as a
  // believable cloud puff or rounded cap without the smooth-sphere cost.
  return new IcosahedronGeometry(r, 1);
}
function cyl(r: number, h: number, segs: number): BufferGeometry {
  const g = new CylinderGeometry(r, r, h, segs);
  return g;
}
function cone(r: number, h: number, segs: number): BufferGeometry {
  const g = new ConeGeometry(r, h, segs);
  return g;
}

/**
 * Vertical sky-gradient texture (Alpha 2.6 visual pass). 1 px wide,
 * 256 px tall, painted with a CanvasGradient from horizon (warm pale) up
 * to zenith (saturated blue). Used as `scene.background` so the canvas
 * reads as sky instead of a flat dark colour. One-time cost at init.
 */
function makeSkyGradient(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  // Initial paint at noon (Alpha 2.14 day/night will repaint each frame).
  repaintSkyGradient(tex, 0.5);
  return tex;
}

/**
 * Repaint the sky gradient texture for the current time of day (Alpha
 * 2.14). Three keyframe ramps — night → dawn → noon → dusk → night —
 * lerped together so the sky shifts smoothly across the day cycle.
 */
function repaintSkyGradient(tex: CanvasTexture, phase: number): void {
  const canvas = tex.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  // Keyframe palette: zenith / mid / horizon at four phases.
  const KF = [
    { p: 0.00, zenith: 0x141a35, mid: 0x2a2c4a, horizon: 0x4a3a5a },  // midnight
    { p: 0.22, zenith: 0x4a4f8a, mid: 0xc6886a, horizon: 0xe8a060 },  // dawn
    { p: 0.50, zenith: 0x5d96d4, mid: 0xa4caea, horizon: 0xe6d8be },  // noon
    { p: 0.78, zenith: 0x3a4a8a, mid: 0xa66a8a, horizon: 0xe06850 },  // dusk
    { p: 1.00, zenith: 0x141a35, mid: 0x2a2c4a, horizon: 0x4a3a5a }   // midnight wrap
  ];
  let lo = KF[0]!, hi = KF[1]!;
  for (let i = 0; i < KF.length - 1; i++) {
    if (phase >= KF[i]!.p && phase <= KF[i + 1]!.p) { lo = KF[i]!; hi = KF[i + 1]!; break; }
  }
  const t = (phase - lo.p) / Math.max(1e-6, hi.p - lo.p);
  const zenith = lerpHexColor(lo.zenith, hi.zenith, t);
  const mid    = lerpHexColor(lo.mid, hi.mid, t);
  const horizon = lerpHexColor(lo.horizon, hi.horizon, t);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.00, '#' + zenith.toString(16).padStart(6, '0'));
  grad.addColorStop(0.55, '#' + mid.toString(16).padStart(6, '0'));
  grad.addColorStop(1.00, '#' + horizon.toString(16).padStart(6, '0'));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1, 256);
  tex.needsUpdate = true;
}

/** Phase warp (Alpha 3.0.1): map an unwarped phase ∈ [0, 1] through a
 *  piecewise-linear function so the [0.15, 0.85] day-window covers 70%
 *  of the cycle and the night bands cover 30% combined. The warp
 *  preserves the midnight (p=0/1) and noon (p=0.5) anchor points so
 *  the rest of the renderer math stays unchanged. */
function warpDayPhase(p: number): number {
  if (p <= 0.15) return p * (0.25 / 0.15);
  if (p <= 0.85) return 0.25 + (p - 0.15) * (0.50 / 0.70);
  return 0.75 + (p - 0.85) * (0.25 / 0.15);
}

function lerpHexColor(a: number, b: number, t: number): number {
  const u = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const c = Math.round(ab + (bb - ab) * u);
  return (r << 16) | (g << 8) | c;
}

/**
 * A small Group of stylized clouds floating high above the world (Alpha
 * 2.6). Each cloud is a cluster of 3-5 IcosahedronGeometry "puffs" merged
 * into a single mesh, no transparency (low-poly aesthetic), unlit
 * MeshBasicMaterial so they read uniformly white regardless of scene
 * lighting changes. Static — added once at init.
 */
function makeClouds(): Group {
  const group = new Group();
  // Five cloud blobs scattered across the sky at varying heights/sizes.
  const cloudSpecs: Array<{ x: number; y: number; z: number; scale: number }> = [
    { x: -22, y: 18, z: -18, scale: 1.0 },
    { x:  20, y: 22, z: -25, scale: 1.4 },
    { x:  35, y: 16, z:  10, scale: 0.9 },
    { x: -30, y: 20, z:  20, scale: 1.2 },
    { x:   5, y: 24, z:  35, scale: 1.1 }
  ];
  for (const spec of cloudSpecs) {
    const puffs: BufferGeometry[] = [];
    // Each cloud = 4 puffs in an asymmetric cluster.
    const offsets: Array<[number, number, number, number]> = [
      [ 0.0, 0.0,  0.0, 1.0 * spec.scale],
      [ 1.0, 0.1, -0.2, 0.85 * spec.scale],
      [-0.9, 0.0,  0.1, 0.80 * spec.scale],
      [ 0.3, 0.4,  0.5, 0.65 * spec.scale]
    ];
    for (const [ox, oy, oz, r] of offsets) {
      const puff = new IcosahedronGeometry(r, 1);
      puff.translate(ox, oy, oz);
      puffs.push(puff);
    }
    // Manual merge — concatenate position + index attrs across the puffs.
    let totalVerts = 0, totalIndices = 0;
    for (const p of puffs) {
      totalVerts += p.getAttribute('position').count;
      const idx = p.getIndex();
      totalIndices += idx ? idx.count : p.getAttribute('position').count;
    }
    const positions = new Float32Array(totalVerts * 3);
    const indices = new Uint32Array(totalIndices);
    let vOff = 0, iOff = 0;
    for (const p of puffs) {
      const pos = p.getAttribute('position');
      const idx = p.getIndex();
      for (let i = 0; i < pos.count; i++) {
        positions[(vOff + i) * 3 + 0] = pos.getX(i);
        positions[(vOff + i) * 3 + 1] = pos.getY(i);
        positions[(vOff + i) * 3 + 2] = pos.getZ(i);
      }
      if (idx) {
        for (let i = 0; i < idx.count; i++) indices[iOff + i] = idx.getX(i) + vOff;
        iOff += idx.count;
      } else {
        for (let i = 0; i < pos.count; i++) indices[iOff + i] = vOff + i;
        iOff += pos.count;
      }
      vOff += pos.count;
      p.dispose();
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setIndex(new BufferAttribute(indices, 1));
    const mesh = new Mesh(
      geom,
      new MeshBasicMaterial({ color: 0xfafbfc })
    );
    mesh.position.set(spec.x, spec.y, spec.z);
    group.add(mesh);
  }
  return group;
}

// --- Unowned land overlay (Alpha 3.1.3) -------------------------------

/** Translucent grey overlay covering every tile that the player hasn't
 *  yet purchased. Sits just above the terrain — like a thin "for sale"
 *  sticker on the land. Zoned tiles never appear unowned (the gate
 *  inside Grid.setZone refuses), so this overlay never overlaps zone
 *  colour. */
function buildUnownedLandMesh(grid: Grid): Mesh | null {
  let count = 0;
  for (const t of grid.iter()) if (!t.owned) count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color(0x1a1a1a);
  const inset = 0;
  const baseY = ROAD_LIFT * 0.10;

  let vi = 0, ci = 0, ii = 0, v = 0;
  for (const t of grid.iter()) {
    if (t.owned) continue;
    const x0 = t.x * TILE_SIZE + inset;
    const x1 = (t.x + 1) * TILE_SIZE - inset;
    const z0 = t.y * TILE_SIZE + inset;
    const z1 = (t.y + 1) * TILE_SIZE - inset;
    const y = baseY + t.elevation;

    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = y; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = y; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false
  });
  return new Mesh(geom, mat);
}

// --- Zones --------------------------------------------------------------

function buildZoneMesh(grid: Grid): Mesh | null {
  // Count zoned tiles first to size buffers exactly. Cheap full-grid sweep.
  let count = 0;
  for (const t of grid.iter()) if (t.zone !== 'none') count++;
  if (count === 0) return null;

  const positions = new Float32Array(count * 4 * 3);
  const colours = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const c = new Color();

  let vi = 0;
  let ci = 0;
  let ii = 0;
  let v = 0;
  // Slight inset so a zoned tile reads as "this cell" rather than bleeding
  // into its neighbours' borders.
  const inset = 0.03;

  for (const t of grid.iter()) {
    if (t.zone === 'none') continue;
    c.setHex(ZONE_COLORS[t.zone as Exclude<Zone, 'none'>]);
    // Tier shading — low zones look slightly washed out, high zones more
    // saturated. Player can read intent from the overlay alone. Multiply
    // each channel by the tier factor (0.78 / 0.92 / 1.06) so the colour
    // family stays intact.
    const tierFactor = t.zoneCap === 1 ? 0.78 : t.zoneCap === 2 ? 0.92 : 1.06;
    c.r = Math.min(1, c.r * tierFactor);
    c.g = Math.min(1, c.g * tierFactor);
    c.b = Math.min(1, c.b * tierFactor);

    const x0 = t.x * TILE_SIZE + inset;
    const x1 = (t.x + 1) * TILE_SIZE - inset;
    const z0 = t.y * TILE_SIZE + inset;
    const z1 = (t.y + 1) * TILE_SIZE - inset;

    // Lift by tile elevation so zones drape over hilly terrain (Alpha 2.4).
    const yz = ZONE_LIFT + t.elevation;
    positions[vi++] = x0; positions[vi++] = yz; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = yz; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = yz; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = yz; positions[vi++] = z1;

    for (let i = 0; i < 4; i++) {
      colours[ci++] = c.r;
      colours[ci++] = c.g;
      colours[ci++] = c.b;
    }

    // CCW from above so the top face survives back-face culling.
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 1;
    indices[ii++] = v; indices[ii++] = v + 3; indices[ii++] = v + 2;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normals.

  const mat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    flatShading: true
  });
  return new Mesh(geom, mat);
}

// --- Roads --------------------------------------------------------------

interface BuiltRoads {
  mesh: Mesh;
  lanes: LineSegments | null;
}

function buildRoadMesh(grid: Grid): BuiltRoads | null {
  const edges = Array.from(grid.iterRoadEdges());
  // Stub tiles (road=true with no incident edge) get a small centre square.
  const stubs: { x: number; y: number }[] = [];
  for (const t of grid.iter()) {
    if (!t.road) continue;
    let hasEdge = false;
    for (const e of edges) {
      if ((e.ax === t.x && e.ay === t.y) || (e.bx === t.x && e.by === t.y)) {
        hasEdge = true; break;
      }
    }
    if (!hasEdge) stubs.push({ x: t.x, y: t.y });
  }

  if (edges.length === 0 && stubs.length === 0) return null;

  // Per-edge tier drives width + colour (post-alpha pass 4). Each edge gets
  // a vertex-coloured quad, all merged into one mesh / one draw call.
  const totalQuads = edges.length + stubs.length;
  const positions = new Float32Array(totalQuads * 4 * 3);
  const colours = new Float32Array(totalQuads * 4 * 3);
  const indices = new Uint32Array(totalQuads * 6);
  const c = new Color();

  let vi = 0;
  let ci = 0;
  let ii = 0;
  let v = 0;
  const yLift = ROAD_LIFT;

  // --- edge quads ---
  // Yellow stripes: local dashed centerline + avenue solid double-yellow.
  const yellowLanePositions: number[] = [];
  // White stripes: highway shoulder lines.
  const whiteLanePositions: number[] = [];
  for (const e of edges) {
    const ta = grid.get(e.ax, e.ay);
    const tb = grid.get(e.bx, e.by);
    // Use the wider/faster of the two endpoint tiers — visually consistent
    // when a highway abuts a local at a ramp.
    const tierA = ta?.roadType ?? 'local';
    const tierB = tb?.roadType ?? 'local';
    const tier = tierIndex(tierA) >= tierIndex(tierB) ? tierA : tierB;
    const tierProps = ROAD_TIER[tier];
    const half = tierProps.width / 2;
    c.setHex(tierProps.color);

    const ax = (e.ax + 0.5) * TILE_SIZE;
    const az = (e.ay + 0.5) * TILE_SIZE;
    const bx = (e.bx + 0.5) * TILE_SIZE;
    const bz = (e.by + 0.5) * TILE_SIZE;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const px = -dz / len * half;
    const pz = dx / len * half;

    // Per-endpoint elevation (Alpha 2.3+): bridge tiles lift the road
    // deck to BRIDGE_LIFT; land roads stay at ROAD_LIFT plus the tile's
    // terrain elevation so the road sits ON the hill instead of being
    // buried in it. A bridge tile next to a land tile naturally
    // produces a ramp because the two endpoint y values differ along
    // the segment, and a road climbing a hill ramps the same way.
    const yA = ta?.bridge ? BRIDGE_LIFT : (yLift + (ta?.elevation ?? 0));
    const yB = tb?.bridge ? BRIDGE_LIFT : (yLift + (tb?.elevation ?? 0));
    positions[vi++] = ax + px; positions[vi++] = yA; positions[vi++] = az + pz;
    positions[vi++] = bx + px; positions[vi++] = yB; positions[vi++] = bz + pz;
    positions[vi++] = bx - px; positions[vi++] = yB; positions[vi++] = bz - pz;
    positions[vi++] = ax - px; positions[vi++] = yA; positions[vi++] = az - pz;
    for (let k = 0; k < 4; k++) {
      colours[ci++] = c.r; colours[ci++] = c.g; colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 1; indices[ii++] = v + 2;
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 3;
    v += 4;

    // Lane stripes (Alpha 2.2 polish):
    //  - Local: dashed yellow centreline (two short dashes per edge).
    //  - Avenue: solid double-yellow centreline (two parallel solid lines).
    //  - Highway: white solid edge stripes near each shoulder.
    // Bridges keep stripes if both ends are land-level; if either end is
    // bridge we skip stripes (they'd float in mid-air on the ramp).
    // Lane stripes lift to slightly above the road deck per-endpoint
    // (Alpha 2.4 — was a single yStripe constant; now stripes follow
    // the road as it ramps over hills).
    const yStripeA = yA + 0.001;
    const yStripeB = yB + 0.001;
    if (ta?.bridge || tb?.bridge) {
      // Skip stripes on bridge segments; deck colour is enough.
    } else
    if (tier === 'local') {
      yellowLanePositions.push(
        ax + dx * 0.18, yStripeA + (yStripeB - yStripeA) * 0.18, az + dz * 0.18,
        ax + dx * 0.42, yStripeA + (yStripeB - yStripeA) * 0.42, az + dz * 0.42,
        ax + dx * 0.58, yStripeA + (yStripeB - yStripeA) * 0.58, az + dz * 0.58,
        ax + dx * 0.82, yStripeA + (yStripeB - yStripeA) * 0.82, az + dz * 0.82
      );
    } else if (tier === 'avenue') {
      // Two solid yellow lines straddling the centreline by ~0.04 tile.
      const off = 0.04;
      const opx = px / half * off;
      const opz = pz / half * off;
      yellowLanePositions.push(
        ax + opx, yStripeA, az + opz,
        bx + opx, yStripeB, bz + opz,
        ax - opx, yStripeA, az - opz,
        bx - opx, yStripeB, bz - opz
      );
    } else {
      // Highway — white edge stripes just inside the shoulder.
      const inset = 0.04; // pulled in slightly from the actual edge
      const sx = px - (px / half) * inset;
      const sz = pz - (pz / half) * inset;
      whiteLanePositions.push(
        ax + sx, yStripeA, az + sz,
        bx + sx, yStripeB, bz + sz,
        ax - sx, yStripeA, az - sz,
        bx - sx, yStripeB, bz - sz
      );
    }
  }

  // --- stub squares ---
  for (const s of stubs) {
    const t = grid.get(s.x, s.y);
    const tier = t?.roadType ?? 'local';
    const tierProps = ROAD_TIER[tier];
    const half = tierProps.width / 2;
    c.setHex(tierProps.color);
    const cx = (s.x + 0.5) * TILE_SIZE;
    const cz = (s.y + 0.5) * TILE_SIZE;
    const stubY = t?.bridge ? BRIDGE_LIFT : (yLift + (t?.elevation ?? 0));
    positions[vi++] = cx - half; positions[vi++] = stubY; positions[vi++] = cz - half;
    positions[vi++] = cx + half; positions[vi++] = stubY; positions[vi++] = cz - half;
    positions[vi++] = cx + half; positions[vi++] = stubY; positions[vi++] = cz + half;
    positions[vi++] = cx - half; positions[vi++] = stubY; positions[vi++] = cz + half;
    for (let k = 0; k < 4; k++) {
      colours[ci++] = c.r; colours[ci++] = c.g; colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 1; indices[ii++] = v + 2;
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 3;
    v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normals.
  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    flatShading: true
  });
  const mesh = new Mesh(geom, mat);

  // Two LineSegments objects — yellow (local + avenue centerlines) and
  // white (highway shoulder stripes). Returning the white set as part of
  // the mesh group is cleaner than a third return field; we tack it onto
  // the mesh as a child so worldGroup tracks both via the same root.
  let lanes: LineSegments | null = null;
  if (yellowLanePositions.length > 0) {
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(yellowLanePositions), 3));
    lanes = new LineSegments(lg, new LineBasicMaterial({ color: ROAD_LANE }));
  }
  if (whiteLanePositions.length > 0) {
    const wg = new BufferGeometry();
    wg.setAttribute('position', new BufferAttribute(new Float32Array(whiteLanePositions), 3));
    const whiteLines = new LineSegments(wg, new LineBasicMaterial({ color: 0xe8e8e8 }));
    if (lanes) lanes.add(whiteLines);
    else lanes = whiteLines;
  }

  return { mesh, lanes };
}

function tierIndex(t: 'local' | 'avenue' | 'highway'): number {
  return t === 'local' ? 0 : t === 'avenue' ? 1 : 2;
}

/**
 * Upper-layer (Bridge Mode) road mesh (Alpha 2.12). Each bridgeRoad
 * edge gets a road quad lifted to BRIDGE_LIFT, plus support pillars
 * sliced into pairs at every bridgeRoad tile. Returns null if no
 * upper-layer roads exist on the grid.
 */
function buildBridgeRoadMesh(grid: Grid): Group | null {
  const edges = Array.from(grid.iterBridgeRoadEdges());
  if (edges.length === 0) return null;

  const decks: BufferGeometry[] = [];
  const deckColours: number[] = [];
  const railColours: number[] = [];
  const rails: BufferGeometry[] = [];
  const pillars: BufferGeometry[] = [];
  const pillarColours: number[] = [];

  // Ramp logic (Alpha 2.13.1) — the FIRST and LAST tiles of an upper-
  // layer bridge segment ramp down to ground if a road exists there
  // too. A tile is a ramp if it has only ONE incident bridge edge AND
  // a ground road (so the bridge transitions to the ground network).
  const yAt = (tx: number, ty: number): number => {
    const t = grid.get(tx, ty);
    if (!t || !t.bridgeRoad) return ROAD_LIFT + (t?.elevation ?? 0);
    const incident = grid.incidentBridgeRoadEdgeCount(tx, ty);
    // Terminal + ground road → ramp down. Otherwise full deck height.
    if (incident <= 1 && t.road) return ROAD_LIFT + t.elevation;
    return BRIDGE_LIFT;
  };

  // Edge decks.
  for (const e of edges) {
    const ta = grid.get(e.ax, e.ay);
    const tb = grid.get(e.bx, e.by);
    const tierA = ta?.bridgeRoadType ?? 'local';
    const tierB = tb?.bridgeRoadType ?? 'local';
    const tier = tierIndex(tierA) >= tierIndex(tierB) ? tierA : tierB;
    const tierProps = ROAD_TIER[tier];
    const half = tierProps.width / 2;
    const ax = (e.ax + 0.5) * TILE_SIZE;
    const az = (e.ay + 0.5) * TILE_SIZE;
    const bx = (e.bx + 0.5) * TILE_SIZE;
    const bz = (e.by + 0.5) * TILE_SIZE;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const px = -dz / len * half;
    const pz = dx / len * half;
    const yA = yAt(e.ax, e.ay);
    const yB = yAt(e.bx, e.by);

    const deck = new BufferGeometry();
    const positions = new Float32Array([
      ax + px, yA, az + pz,
      bx + px, yB, bz + pz,
      bx - px, yB, bz - pz,
      ax - px, yA, az - pz
    ]);
    deck.setAttribute('position', new BufferAttribute(positions, 3));
    deck.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
    decks.push(deck);
    deckColours.push(tierProps.color);

    // Rail edges along both shoulders, sit slightly above the deck.
    // Build with explicit endpoint heights so the rail follows the ramp.
    const railH = 0.06;
    for (const sign of [1, -1]) {
      const sx = sign * px;
      const sz = sign * pz;
      const railPositions = new Float32Array([
        ax + sx - 0.0, yA + railH * 0.0, az + sz - 0.0,
        ax + sx,        yA + railH,       az + sz,
        bx + sx,        yB + railH,       bz + sz,
        bx + sx - 0.0, yB + railH * 0.0, bz + sz - 0.0
      ]);
      // Hoist the rail bar up to floor + railH; build as a thin twisted
      // strip. Easier: just pair lower + upper line and use them as a
      // strip via two triangles.
      const positionsRail = new Float32Array([
        // lower-left, upper-left, upper-right, lower-right (along axis)
        ax + sx, yA,         az + sz,
        ax + sx, yA + railH, az + sz,
        bx + sx, yB + railH, bz + sz,
        bx + sx, yB,         bz + sz
      ]);
      const railGeom = new BufferGeometry();
      railGeom.setAttribute('position', new BufferAttribute(positionsRail, 3));
      railGeom.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1));
      // Suppress unused railPositions array (was a previous prototype).
      void railPositions;
      // Add a mirror face so the rail isn't culled when viewed from the other side.
      const back = new BufferGeometry();
      back.setAttribute('position', new BufferAttribute(positionsRail, 3));
      back.setIndex(new BufferAttribute(new Uint32Array([0, 2, 1, 0, 3, 2]), 1));
      rails.push(railGeom);
      railColours.push(0xb6a98a);
      rails.push(back);
      railColours.push(0xb6a98a);
      // Add slight thickness — push a duplicated rail shifted inward a hair.
      const inset = 0.012;
      const insetX = sign * (px === 0 ? 0 : -Math.sign(px) * inset);
      const insetZ = sign * (pz === 0 ? 0 : -Math.sign(pz) * inset);
      const inner = new Float32Array([
        ax + sx + insetX, yA,         az + sz + insetZ,
        ax + sx + insetX, yA + railH, az + sz + insetZ,
        bx + sx + insetX, yB + railH, bz + sz + insetZ,
        bx + sx + insetX, yB,         bz + sz + insetZ
      ]);
      const innerGeom = new BufferGeometry();
      innerGeom.setAttribute('position', new BufferAttribute(inner, 3));
      innerGeom.setIndex(new BufferAttribute(new Uint32Array([0, 2, 1, 0, 3, 2]), 1));
      rails.push(innerGeom);
      railColours.push(0xa0937a);
    }
  }

  // Support pillars at each upper-layer tile that has a bridge edge but
  // is NOT also auto-bridged over water. Pillar height matches the deck
  // height at that tile (terminals have shorter pillars matching ramp).
  for (const t of grid.iter()) {
    if (!t.bridgeRoad) continue;
    if (t.bridge) continue; // ground-water bridge already pillared
    const tileY = yAt(t.x, t.y);
    // No pillars on a ramped-down terminal (the deck is at ground level
    // there — pillars would stick up above the road).
    if (tileY <= ROAD_LIFT + t.elevation + 0.02) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    let horizontal = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (grid.hasBridgeRoadEdge(t.x, t.y, t.x + dx, t.y + dy)) {
          if (Math.abs(dx) > Math.abs(dy)) horizontal = true;
        }
      }
    }
    const tierProps = ROAD_TIER[t.bridgeRoadType];
    const half = tierProps.width / 2;
    const pillarH = tileY + 0.05;
    const pillarYBase = -0.05;
    const pillarOffset = half + 0.04;
    const offsets: Array<[number, number]> = horizontal
      ? [[0, -pillarOffset], [0, pillarOffset]]
      : [[-pillarOffset, 0], [pillarOffset, 0]];
    for (const [ox, oz] of offsets) {
      const pillar = new BoxGeometry(0.06, pillarH, 0.06);
      pillar.translate(cx + ox, pillarYBase + pillarH / 2, cz + oz);
      pillars.push(pillar);
      pillarColours.push(0x6e6e6e);
    }
  }

  const group = new Group();
  if (decks.length > 0) {
    const merged = mergeGeoms(decks, deckColours);
    group.add(new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  }
  if (rails.length > 0) {
    const merged = mergeGeoms(rails, railColours);
    group.add(new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  }
  if (pillars.length > 0) {
    const merged = mergeGeoms(pillars, pillarColours);
    group.add(new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  }
  return group;
}

/**
 * Highway flow arrows + stop sign markers, batched into a single Group. Both
 * are visually small and rebuilt with the road mesh on every paint event.
 */
function buildRoadOrnamentsGroup(grid: Grid): Group | null {
  const arrows: BufferGeometry[] = [];
  const arrowColours: number[] = [];
  const stops: BufferGeometry[] = [];
  const stopColours: number[] = [];

  for (const t of grid.iter()) {
    if (!t.road) continue;
    // Bridge tiles override elevation: their deck floats over water at
    // BRIDGE_LIFT regardless of the (negative) underlying elevation.
    const tileY = t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
    if (t.roadType === 'highway' && t.highwayDir >= 0 && t.highwayDir < 8) {
      const cx = (t.x + 0.5) * TILE_SIZE;
      const cz = (t.y + 0.5) * TILE_SIZE;
      const offset = DIR_OFFSETS[t.highwayDir]!;
      // Build a flat triangle pointing in the flow direction. y just above
      // the road surface so it's visible without z-fighting.
      const arrow = makeArrowGeom(0.18, 0.22);
      // Default geometry points +Z. atan2(dx, dz) gives the yaw that
      // takes +Z → (dx, dz). Sign was previously flipped — arrows
      // pointed against traffic flow.
      const yaw = Math.atan2(offset[0], offset[1]);
      arrow.rotateY(yaw);
      arrow.translate(cx, tileY + 0.003, cz);
      arrows.push(arrow);
      arrowColours.push(HIGHWAY_ARROW_COLOR);
    }
    if (t.stopSign) {
      // Place one small stop sign per road approach, on the right shoulder
      // of incoming traffic — i.e. where a real stop sign goes (driver's
      // right as they arrive at the intersection). For a 4-way intersection
      // we get four signs around the corners.
      const cx = (t.x + 0.5) * TILE_SIZE;
      const cz = (t.y + 0.5) * TILE_SIZE;
      const EDGE = TILE_SIZE * 0.40;       // distance from tile centre to approach edge
      const SHOULDER = TILE_SIZE * 0.22;   // offset toward right shoulder of incoming car
      for (let d = 0; d < 8; d++) {
        const off = DIR_OFFSETS[d]!;
        const nx = t.x + off[0];
        const ny = t.y + off[1];
        // Only place a sign for this side if a road actually approaches
        // from there (an edge to that neighbour exists OR neighbour is road).
        if (!grid.hasRoadEdge(t.x, t.y, nx, ny)) continue;
        // Incoming motion vector = -off. Right shoulder is that rotated 90°
        // CW in XZ (top-down): (vx, vz) → (vz, -vx). With v = (-off[0], -off[1])
        // → right = (-off[1], off[0]).
        const px = cx + off[0] * EDGE - off[1] * SHOULDER;
        const pz = cz + off[1] * EDGE + off[0] * SHOULDER;

        // Smaller than before — these are roadside furniture, not landmarks.
        const post = new CylinderGeometry(0.012, 0.012, 0.10, 6);
        post.translate(px, tileY + 0.05, pz);
        stops.push(post);
        stopColours.push(0x666666);

        const sign = new CylinderGeometry(0.05, 0.05, 0.02, 8);
        sign.rotateX(Math.PI / 2);
        sign.translate(px, tileY + 0.10, pz);
        stops.push(sign);
        stopColours.push(STOP_SIGN_COLOR);

        // White face hint for the silhouette of a stop sign.
        const face = new CylinderGeometry(0.035, 0.035, 0.003, 8);
        face.rotateX(Math.PI / 2);
        face.translate(px, tileY + 0.111, pz);
        stops.push(face);
        stopColours.push(STOP_SIGN_TEXT);
      }
    }
  }

  // Zebra crosswalks (Alpha 2.2 — was a single pad in 2.0). Four cardinal
  // approaches at each walkable intersection get a striped pattern: 4
  // alternating white pads spanning the road width, perpendicular to the
  // approach direction. Reads unmistakably as a crosswalk.
  for (const t of grid.iter()) {
    if (!t.road || t.roadType === 'highway') continue;
    if (grid.incidentRoadEdgeCount(t.x, t.y) < 3) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    const tileY = t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
    const roadHalf = ROAD_TIER[t.roadType].width / 2;
    const sides: Array<[number, number]> = [
      [0, -1], [1, 0], [0, 1], [-1, 0]
    ];
    const STRIPE_COUNT = 4;
    const STRIPE_WIDTH = 0.04;
    const STRIPE_GAP = 0.02;
    const totalSpan = STRIPE_COUNT * STRIPE_WIDTH + (STRIPE_COUNT - 1) * STRIPE_GAP;
    for (const [dx, dz] of sides) {
      const nbr = grid.get(t.x + dx, t.y + dz);
      if (!nbr || !nbr.road) continue;
      // Lay stripes spanning the road width (perpendicular to approach).
      // For an N approach (dx=0, dz=-1), stripes are oriented E-W and
      // stacked along Z (the approach direction).
      for (let s = 0; s < STRIPE_COUNT; s++) {
        const stripeOffset = -totalSpan / 2 + s * (STRIPE_WIDTH + STRIPE_GAP) + STRIPE_WIDTH / 2;
        const stripe = new BoxGeometry(
          Math.abs(dz) > 0 ? roadHalf * 1.7 : STRIPE_WIDTH,
          0.005,
          Math.abs(dz) > 0 ? STRIPE_WIDTH : roadHalf * 1.7
        );
        stripe.translate(
          cx + dx * (roadHalf + 0.02) + (Math.abs(dz) > 0 ? 0 : stripeOffset),
          tileY + 0.005,
          cz + dz * (roadHalf + 0.02) + (Math.abs(dz) > 0 ? stripeOffset : 0)
        );
        stops.push(stripe);
        stopColours.push(0xf2efe5); // bright white
      }
    }
  }

  // Road-attached bus stops (Alpha 2.0). A small bench + sign rendered on
  // the sidewalk pad of the road tile. Choose the side facing the most
  // adjacent buildings/zones — that's where the riders are.
  for (const t of grid.iter()) {
    if (!t.road || t.roadType === 'highway' || !t.busStop) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    const tileY = t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
    const side = pickStopSide(grid, t.x, t.y);
    // Sidewalk-edge offset perpendicular to the road centre, on `side`.
    const off = TILE_SIZE * 0.35;
    const sx = cx + side[0] * off;
    const sz = cz + side[1] * off;
    // Bench: a low flat box.
    const bench = new BoxGeometry(0.18, 0.04, 0.07);
    bench.translate(sx, tileY + 0.04, sz);
    stops.push(bench);
    stopColours.push(0x6f5f43);
    // Sign post — yellow lollipop on a thin stem.
    const stem = new CylinderGeometry(0.013, 0.013, 0.18, 6);
    stem.translate(sx + side[0] * 0.06, tileY + 0.09, sz + side[1] * 0.06);
    stops.push(stem);
    stopColours.push(0x444444);
    const head = new BoxGeometry(0.07, 0.05, 0.02);
    head.translate(sx + side[0] * 0.06, tileY + 0.20, sz + side[1] * 0.06);
    stops.push(head);
    stopColours.push(0xe5c25a);
  }

  // Traffic lights — a tall pole at the centre of each lit intersection
  // with three small disc "lenses" (red/amber/green stack). Static, no
  // phase animation here; phase state lives in TrafficLights and a future
  // pass can light up the active lens via vertex colour swap.
  const lights: BufferGeometry[] = [];
  const lightColours: number[] = [];
  for (const t of grid.iter()) {
    if (!t.trafficLight) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    const tileY = t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
    // Pole.
    const pole = new CylinderGeometry(0.015, 0.015, 0.32, 6);
    pole.translate(cx, tileY + 0.16, cz);
    lights.push(pole);
    lightColours.push(0x444444);
    // Housing.
    const housing = new CylinderGeometry(0.05, 0.05, 0.18, 6);
    housing.translate(cx, tileY + 0.32 + 0.09, cz);
    lights.push(housing);
    lightColours.push(0x222222);
    // Three lenses — red, amber, green stack.
    const lensRadius = 0.025;
    const lensZ = tileY + 0.32;
    const lenses: Array<[number, number]> = [
      [lensZ + 0.045, 0xd03a3a], // red on top
      [lensZ + 0.090, 0xf2cd5c], // amber middle
      [lensZ + 0.135, 0x4ad06d]  // green bottom
    ];
    for (const [y, color] of lenses) {
      const lens = new CylinderGeometry(lensRadius, lensRadius, 0.012, 8);
      lens.rotateZ(Math.PI / 2);
      lens.translate(cx + 0.055, y, cz);
      lights.push(lens);
      lightColours.push(color);
    }
  }

  // Bridge pillars (Alpha 2.3) — for each bridge tile (road tile flagged
  // as bridge by Grid.setRoad), drop two short stone pillars from the
  // water surface up to the bridge deck, on either side of the road
  // perpendicular axis. Determines axis from the dominant incident-edge
  // direction so pillars stand sensibly under E-W or N-S spans alike.
  const pillars: BufferGeometry[] = [];
  const pillarColours: number[] = [];
  for (const t of grid.iter()) {
    if (!t.road || !t.bridge) continue;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    // Approximate axis: look at incident road edges; if any edge is
    // horizontal (dx != 0, dz == 0) treat the bridge as east-west, else
    // north-south. Pillars sit perpendicular to that axis so they're
    // under the edges of the road deck.
    let horizontal = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (grid.hasRoadEdge(t.x, t.y, t.x + dx, t.y + dy)) {
          if (Math.abs(dx) > Math.abs(dy)) horizontal = true;
        }
      }
    }
    const tierProps = ROAD_TIER[t.roadType];
    const half = tierProps.width / 2;
    const pillarH = BRIDGE_LIFT + 0.10; // span from below water to deck
    // Pillar ascends from y = -0.10 (below water) up to BRIDGE_LIFT.
    const pillarYBase = -0.10;
    const pillarOffset = half + 0.04;
    const offsets: Array<[number, number]> = horizontal
      ? [[0, -pillarOffset], [0, pillarOffset]]
      : [[-pillarOffset, 0], [pillarOffset, 0]];
    for (const [ox, oz] of offsets) {
      const pillar = new BoxGeometry(0.05, pillarH, 0.05);
      pillar.translate(cx + ox, pillarYBase + pillarH / 2, cz + oz);
      pillars.push(pillar);
      pillarColours.push(0x6e6e6e);
    }

    // Bridge railings (Alpha 2.6 visual pass) — slim parapet rails along
    // both shoulders + a thin "deck stripe" down the median so the deck
    // doesn't read as a flat slab. Rails span the full tile length on the
    // bridge's long axis.
    const railH = 0.08;
    const railThick = 0.03;
    const railSpan = TILE_SIZE * 0.95;
    if (horizontal) {
      // Rails run east-west, sit on north and south shoulders.
      const railNorth = new BoxGeometry(railSpan, railH, railThick);
      railNorth.translate(cx, BRIDGE_LIFT + railH / 2, cz - half - railThick / 2);
      pillars.push(railNorth);
      pillarColours.push(0xb6a98a);
      const railSouth = new BoxGeometry(railSpan, railH, railThick);
      railSouth.translate(cx, BRIDGE_LIFT + railH / 2, cz + half + railThick / 2);
      pillars.push(railSouth);
      pillarColours.push(0xb6a98a);
      // Median stripe on the deck — slim raised pad so the deck reads.
      const stripe = new BoxGeometry(railSpan, 0.012, 0.04);
      stripe.translate(cx, BRIDGE_LIFT + 0.006, cz);
      pillars.push(stripe);
      pillarColours.push(0xe8d96a);
    } else {
      const railWest = new BoxGeometry(railThick, railH, railSpan);
      railWest.translate(cx - half - railThick / 2, BRIDGE_LIFT + railH / 2, cz);
      pillars.push(railWest);
      pillarColours.push(0xb6a98a);
      const railEast = new BoxGeometry(railThick, railH, railSpan);
      railEast.translate(cx + half + railThick / 2, BRIDGE_LIFT + railH / 2, cz);
      pillars.push(railEast);
      pillarColours.push(0xb6a98a);
      const stripe = new BoxGeometry(0.04, 0.012, railSpan);
      stripe.translate(cx, BRIDGE_LIFT + 0.006, cz);
      pillars.push(stripe);
      pillarColours.push(0xe8d96a);
    }
  }

  // Sidewalk decorations (Alpha 2.6) — small street furniture on
  // non-highway road tiles next to a developed-commercial / mixed-use
  // tile. Distributes hydrants / parking meters / bike racks
  // deterministically by tile hash so the same block always shows the
  // same pieces. Only ~25% of eligible tiles get a piece — too many
  // would crowd the sidewalk visually.
  for (const t of grid.iter()) {
    if (!t.road || t.roadType === 'highway') continue;
    if (t.bridge) continue;
    if (t.busStop || t.stopSign || t.trafficLight) continue;
    // Find a commercial / mixed-use 4-neighbour with a developed building
    // (density > 0). No commercial neighbour = no street furniture.
    let side: [number, number] | null = null;
    const dirs: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dz] of dirs) {
      const n = grid.get(t.x + dx, t.y + dz);
      if (!n) continue;
      if ((n.zone === 'commercial' || n.zone === 'mixed') && n.density > 0) {
        side = [dx, dz];
        break;
      }
    }
    if (!side) continue;
    // Hash gates placement to ~30% of eligible tiles.
    const h = Math.abs(((t.x * 2654435761) ^ (t.y * 1597334677)) | 0);
    if ((h % 100) >= 30) continue;
    const tileY = ROAD_LIFT + t.elevation;
    const cx = (t.x + 0.5) * TILE_SIZE;
    const cz = (t.y + 0.5) * TILE_SIZE;
    // Sidewalk pad position: outside the road's half-width on the chosen side.
    const roadHalf = ROAD_TIER[t.roadType].width / 2;
    const padOff = roadHalf + 0.06;
    const sx = cx + side[0] * padOff;
    const sz = cz + side[1] * padOff;
    // Pick one of three pieces by a different hash slice.
    const piece = (h >> 7) % 3;
    if (piece === 0) {
      // Hydrant — short red-and-yellow squat cylinder with two side ports.
      const body = new CylinderGeometry(0.04, 0.045, 0.10, 8);
      body.translate(sx, tileY + 0.05, sz);
      stops.push(body);
      stopColours.push(0xc04a3a);
      const cap = new CylinderGeometry(0.045, 0.045, 0.022, 8);
      cap.translate(sx, tileY + 0.111, sz);
      stops.push(cap);
      stopColours.push(0xe5c25a);
    } else if (piece === 1) {
      // Parking meter — thin grey post + small head box.
      const post = new CylinderGeometry(0.013, 0.013, 0.18, 6);
      post.translate(sx, tileY + 0.09, sz);
      stops.push(post);
      stopColours.push(0x707070);
      const head = new BoxGeometry(0.05, 0.08, 0.04);
      head.translate(sx, tileY + 0.22, sz);
      stops.push(head);
      stopColours.push(0x4a4a4a);
      const screen = new BoxGeometry(0.04, 0.04, 0.005);
      screen.translate(sx + (Math.abs(side[0]) > 0 ? 0 : 0.025) - (side[0] === 0 ? 0 : side[0] * 0.026),
                       tileY + 0.23,
                       sz + (Math.abs(side[1]) > 0 ? 0 : 0.025) - (side[1] === 0 ? 0 : side[1] * 0.026));
      stops.push(screen);
      stopColours.push(0x9c9c9c);
    } else {
      // Bike rack — three vertical loops on a short crossbar. Approximate
      // a loop with a top box + two side stems for low-poly silhouette.
      const horizontal = side[1] !== 0; // axis perpendicular to road runs along x
      const rackLen = 0.18;
      const stems: Array<[number, number]> = [
        [-rackLen / 2, 0],
        [0, 0],
        [rackLen / 2, 0]
      ];
      // Cross bar.
      const cross = horizontal
        ? new BoxGeometry(rackLen, 0.018, 0.022)
        : new BoxGeometry(0.022, 0.018, rackLen);
      cross.translate(sx, tileY + 0.10, sz);
      stops.push(cross);
      stopColours.push(0x4d6a8e);
      // Three loops.
      for (const [ox, _] of stems) {
        const loopX = horizontal ? sx + ox : sx;
        const loopZ = horizontal ? sz : sz + ox;
        const top = horizontal
          ? new BoxGeometry(0.04, 0.022, 0.022)
          : new BoxGeometry(0.022, 0.022, 0.04);
        top.translate(loopX, tileY + 0.18, loopZ);
        stops.push(top);
        stopColours.push(0x4d6a8e);
        // Two thin stems forming the loop.
        const stemL = new BoxGeometry(0.012, 0.08, 0.012);
        stemL.translate(loopX - (horizontal ? 0.018 : 0), tileY + 0.14, loopZ - (horizontal ? 0 : 0.018));
        stops.push(stemL);
        stopColours.push(0x4d6a8e);
        const stemR = new BoxGeometry(0.012, 0.08, 0.012);
        stemR.translate(loopX + (horizontal ? 0.018 : 0), tileY + 0.14, loopZ + (horizontal ? 0 : 0.018));
        stops.push(stemR);
        stopColours.push(0x4d6a8e);
      }
    }
  }

  if (arrows.length === 0 && stops.length === 0 && lights.length === 0 && pillars.length === 0) return null;
  const group = new Group();
  if (arrows.length > 0) {
    const merged = mergeGeoms(arrows, arrowColours);
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(mesh);
  }
  if (stops.length > 0) {
    const merged = mergeGeoms(stops, stopColours);
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(mesh);
  }
  if (lights.length > 0) {
    const merged = mergeGeoms(lights, lightColours);
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(mesh);
  }
  if (pillars.length > 0) {
    const merged = mergeGeoms(pillars, pillarColours);
    const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(mesh);
  }
  return group;
}

// --- Walking paths ------------------------------------------------------

/**
 * One small flagstone-coloured quad per path tile, with extensions toward
 * each 4-connected path neighbour so a run of paths reads as a continuous
 * strip. Roads are NOT path neighbours visually — paths terminate at road
 * tiles per the spec ("the path does not cross the road visually").
 */
function buildPathMesh(grid: Grid): Mesh | null {
  const tiles: { x: number; y: number }[] = [];
  for (const t of grid.iter()) {
    if (t.path && !t.road) tiles.push({ x: t.x, y: t.y });
  }
  if (tiles.length === 0) return null;

  // Up to 5 quads per tile (centre + 4 stub extensions). Allocate worst case.
  const maxQuads = tiles.length * 5;
  const positions = new Float32Array(maxQuads * 4 * 3);
  const colours = new Float32Array(maxQuads * 4 * 3);
  const indices = new Uint32Array(maxQuads * 6);
  const c = new Color();
  c.setHex(PATH_COLOR);

  let vi = 0, ci = 0, ii = 0, v = 0;
  const half = PATH_WIDTH / 2;
  const stubLen = TILE_SIZE * 0.5; // half a tile, meets the neighbour's centre-stub

  for (const tile of tiles) {
    const cx = (tile.x + 0.5) * TILE_SIZE;
    const cz = (tile.y + 0.5) * TILE_SIZE;
    // Lift the path quad by terrain elevation (Alpha 2.4) so the path
    // sits on hilly ground instead of being buried in it.
    const t = grid.get(tile.x, tile.y);
    const yPath = PATH_LIFT + (t?.elevation ?? 0);

    // Centre quad — square, half-width on each side.
    pushQuad(
      positions, colours, indices,
      cx - half, cz - half, cx + half, cz + half,
      yPath, c, vi, ci, ii, v
    );
    vi += 12; ci += 12; ii += 6; v += 4;

    // Stub extensions toward each 4-neighbour that's another path tile OR a
    // walkable (non-highway) road tile. Extending toward roads is what makes
    // a path "feed into" the road's sidewalk visually — without this the
    // path would terminate one half-tile shy of the road and read as
    // disconnected.
    const connectN = grid.hasPath(tile.x, tile.y - 1) || isSidewalkTile(grid, tile.x, tile.y - 1);
    const connectE = grid.hasPath(tile.x + 1, tile.y) || isSidewalkTile(grid, tile.x + 1, tile.y);
    const connectS = grid.hasPath(tile.x, tile.y + 1) || isSidewalkTile(grid, tile.x, tile.y + 1);
    const connectW = grid.hasPath(tile.x - 1, tile.y) || isSidewalkTile(grid, tile.x - 1, tile.y);
    if (connectN) {
      pushQuad(positions, colours, indices,
        cx - half, cz - stubLen, cx + half, cz - half,
        yPath, c, vi, ci, ii, v);
      vi += 12; ci += 12; ii += 6; v += 4;
    }
    if (connectE) {
      pushQuad(positions, colours, indices,
        cx + half, cz - half, cx + stubLen, cz + half,
        yPath, c, vi, ci, ii, v);
      vi += 12; ci += 12; ii += 6; v += 4;
    }
    if (connectS) {
      pushQuad(positions, colours, indices,
        cx - half, cz + half, cx + half, cz + stubLen,
        yPath, c, vi, ci, ii, v);
      vi += 12; ci += 12; ii += 6; v += 4;
    }
    if (connectW) {
      pushQuad(positions, colours, indices,
        cx - stubLen, cz - half, cx - half, cz + half,
        yPath, c, vi, ci, ii, v);
      vi += 12; ci += 12; ii += 6; v += 4;
    }
  }

  // Trim to the actual used range so unused tail doesn't render zero-area tris.
  const usedQuads = ii / 6;
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions.slice(0, usedQuads * 4 * 3), 3));
  geom.setAttribute('color', new BufferAttribute(colours.slice(0, usedQuads * 4 * 3), 3));
  geom.setIndex(new BufferAttribute(indices.slice(0, usedQuads * 6), 1));
  // Flat-shaded: skip normals.
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(geom, mat);
}

/**
 * Sidewalk strips on every non-highway road tile. One pad per tile — the
 * road overlay sits on top, so what shows is the SIDEWALK_PAD border
 * around the road. Highway tiles are skipped (they're vehicle-only).
 *
 * Per-side extension: when a 4-neighbour is a walking-path tile, the pad
 * stretches all the way to the tile boundary on that side so the path's
 * stub meets it without a grass gap. Result: paths feed into sidewalks
 * cleanly even though paths and sidewalks live in different meshes.
 */
function buildSidewalkMesh(grid: Grid): Mesh | null {
  const tiles: { x: number; y: number; tier: 'local' | 'avenue'; elevation: number }[] = [];
  for (const t of grid.iter()) {
    if (!t.road) continue;
    if (t.roadType === 'highway') continue;
    // Bridges over water don't get a sidewalk pad — there's nothing
    // for it to sit on (it would float underwater) and the bridge
    // deck reads cleanly without one.
    if (t.bridge) continue;
    tiles.push({ x: t.x, y: t.y, tier: t.roadType, elevation: t.elevation });
  }
  if (tiles.length === 0) return null;

  const positions = new Float32Array(tiles.length * 4 * 3);
  const colours = new Float32Array(tiles.length * 4 * 3);
  const indices = new Uint32Array(tiles.length * 6);
  const c = new Color();
  c.setHex(SIDEWALK_COLOR);
  const halfTile = TILE_SIZE * 0.5;

  let vi = 0, ci = 0, ii = 0, v = 0;
  for (const tile of tiles) {
    const cx = (tile.x + 0.5) * TILE_SIZE;
    const cz = (tile.y + 0.5) * TILE_SIZE;
    const roadHalf = ROAD_TIER[tile.tier].width / 2;
    const baseHalf = roadHalf + SIDEWALK_PAD;

    // Asymmetric pad — extend toward each path-tile neighbour.
    const halfN = grid.hasPath(tile.x, tile.y - 1) ? halfTile : baseHalf;
    const halfE = grid.hasPath(tile.x + 1, tile.y) ? halfTile : baseHalf;
    const halfS = grid.hasPath(tile.x, tile.y + 1) ? halfTile : baseHalf;
    const halfW = grid.hasPath(tile.x - 1, tile.y) ? halfTile : baseHalf;

    pushQuad(
      positions, colours, indices,
      cx - halfW, cz - halfN, cx + halfE, cz + halfS,
      SIDEWALK_LIFT + tile.elevation, c, vi, ci, ii, v
    );
    vi += 12; ci += 12; ii += 6; v += 4;
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colours, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normals.
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(geom, mat);
}

/** True if the tile at (x, y) is a non-highway road — i.e. it has a sidewalk. */
/**
 * Perpendicular offset (in tile units, unsigned) where a pedestrian
 * should walk on this tile. Multiply by ±side to place them left or
 * right of travel direction.
 *
 * For a non-highway road the band sits squarely on the sidewalk pad
 * (just outside the road surface). For a path tile we use a small
 * spread so two-direction streams visibly split. Highways and grass
 * default to 0 — a planned route shouldn't put walkers there, but if
 * one slips through the renderer doesn't push them sideways into
 * nothing.
 */
/**
 * Y of the road driving surface at the given tile (Alpha 2.4). Bridges
 * sit at the absolute deck height; everything else rides the terrain.
 * Off-grid lookups fall back to the flat road lift so vehicles wrapping
 * the edge don't snap to y=0.
 */
function roadSurfaceY(grid: Grid, x: number, y: number): number {
  const t = grid.get(x, y);
  if (!t) return ROAD_LIFT;
  return t.bridge ? BRIDGE_LIFT : ROAD_LIFT + t.elevation;
}

/**
 * Y of the walking surface at the given tile (Alpha 2.4). Mirrors
 * roadSurfaceY but uses the slightly higher SIDEWALK_LIFT for road
 * tiles (walker is on the sidewalk pad) and PATH_LIFT for path tiles.
 * Bridges still override to the deck height — pedestrians cross
 * bridges at the same level as the road.
 */
function walkerSurfaceY(grid: Grid, x: number, y: number): number {
  const t = grid.get(x, y);
  if (!t) return SIDEWALK_LIFT;
  if (t.bridge) return BRIDGE_LIFT;
  if (t.path && !t.road) return PATH_LIFT + t.elevation;
  // Park tiles (Alpha 2.6.1) — walkers cut through parks at path height.
  if (t.building === 'park') return PATH_LIFT + t.elevation;
  return SIDEWALK_LIFT + t.elevation;
}

function pedestrianOffsetForTile(grid: Grid, x: number, y: number): number {
  const t = grid.get(x, y);
  if (!t) return 0;
  if (t.road && t.roadType !== 'highway') {
    // Place on the sidewalk pad: just outside the road's half-width,
    // halfway through the SIDEWALK_PAD strip.
    return ROAD_TIER[t.roadType].width / 2 + SIDEWALK_PAD * 0.5;
  }
  if (t.path) {
    return 0.05; // small spread on a narrow path
  }
  // Park tiles (Alpha 2.6.1) — wider spread so walkers stream across the
  // grass without all single-filing through the centre.
  if (t.building === 'park') return 0.18;
  return 0;
}

function isSidewalkTile(grid: Grid, x: number, y: number): boolean {
  const t = grid.get(x, y);
  if (!t) return false;
  return t.road && t.roadType !== 'highway';
}

/**
 * Pick which 4-neighbour side of a road tile to put the bus stop on. Prefers
 * the direction with a developed building (zone tile with density > 0); falls
 * back to whichever side isn't a road tile. Returns a unit-length direction
 * (dx, dz) in tile-space.
 */
function pickStopSide(grid: Grid, x: number, y: number): [number, number] {
  const candidates: Array<[number, number]> = [
    [0, -1], // N
    [1, 0],  // E
    [0, 1],  // S
    [-1, 0]  // W
  ];
  // Score each side by how built-up the neighbour is.
  let bestSide: [number, number] = candidates[0]!;
  let bestScore = -Infinity;
  for (const [dx, dz] of candidates) {
    const n = grid.get(x + dx, y + dz);
    let score = 0;
    if (!n) score = -100;
    else if (n.road) score = -10;            // can't sit a stop on a road tile
    else if (n.zone !== 'none' && n.density > 0) score = 5;
    else if (n.zone !== 'none') score = 2;   // zoned, undeveloped
    else if (n.building !== 'none') score = 4;
    else score = 0;                           // grass — fine, just not preferred
    if (score > bestScore) {
      bestScore = score;
      bestSide = [dx, dz];
    }
  }
  return bestSide;
}

/** Push a flat quad on the XZ plane at height `y`. Mutates the buffers in place. */
function pushQuad(
  positions: Float32Array, colours: Float32Array, indices: Uint32Array,
  x0: number, z0: number, x1: number, z1: number,
  y: number, c: Color, vi: number, ci: number, ii: number, v: number
): void {
  positions[vi + 0] = x0; positions[vi + 1] = y; positions[vi + 2] = z0;
  positions[vi + 3] = x1; positions[vi + 4] = y; positions[vi + 5] = z0;
  positions[vi + 6] = x1; positions[vi + 7] = y; positions[vi + 8] = z1;
  positions[vi + 9] = x0; positions[vi + 10] = y; positions[vi + 11] = z1;
  for (let k = 0; k < 4; k++) {
    colours[ci + k * 3 + 0] = c.r;
    colours[ci + k * 3 + 1] = c.g;
    colours[ci + k * 3 + 2] = c.b;
  }
  indices[ii + 0] = v;     indices[ii + 1] = v + 2; indices[ii + 2] = v + 1;
  indices[ii + 3] = v;     indices[ii + 4] = v + 3; indices[ii + 5] = v + 2;
}

/** Flat triangle pointing +Z (north → "up" in world space at default rotation). */
function makeArrowGeom(width: number, length: number): BufferGeometry {
  const positions = new Float32Array([
    -width / 2, 0, -length / 2,
     width / 2, 0, -length / 2,
              0, 0,  length / 2
  ]);
  const indices = new Uint32Array([0, 2, 1]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  // Flat-shaded: skip normals.
  return g;
}
