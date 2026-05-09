import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
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
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  WebGLRenderer
} from 'three';
import type { Camera } from './Camera';
import type { Grid } from '../world/Grid';
import { buildLuxuryParts, buildVariantParts } from './BuildingVariants';
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
  /** Trees mesh — merged variant geometry per forest tile (Alpha 2.2). */
  private treesMesh: Mesh | null = null;
  /** Merged buildings geometry (Alpha 2.1 — variant-driven). */
  private buildingsMesh: Mesh | null = null;
  /** One Group containing per-kind city building Mesh objects. Rebuilt on change. */
  private readonly cityBuildingsGroup = new Group();
  private heatmapMesh: Mesh | null = null;
  private carsMesh: InstancedMesh;
  private busesMesh: InstancedMesh;
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
    this.scene.add(new AmbientLight(0xffffff, 0.55));
    this.scene.add(new HemisphereLight(0xbcd9ff, 0x223322, 0.45));
    const sun = new DirectionalLight(0xffffff, 0.85);
    sun.position.set(40, 80, 30);
    this.scene.add(sun);

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

  /** Rebuild the zone overlay from current tile zones. */
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
  }

  /**
   * Rebuild the city-building meshes (power plants, water towers, parks,
   * bus stops, bus depots). Each kind has a distinctive low-poly silhouette.
   * One Group, one Mesh per kind, vertex-coloured so flat shading still
   * gives subtle face shading.
   */
  drawCityBuildings(grid: Grid): void {
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
    const built = buildCityBuildingsMesh(grid);
    if (built) this.cityBuildingsGroup.add(built);
  }

  /** Rebuild the buildings InstancedMesh from current tile densities. */
  drawBuildings(grid: Grid): void {
    if (this.buildingsMesh) {
      this.worldGroup.remove(this.buildingsMesh);
      this.buildingsMesh.geometry.dispose();
      (this.buildingsMesh.material as MeshLambertMaterial).dispose();
      this.buildingsMesh = null;
    }
    const built = buildBuildingsMesh(grid);
    if (built) {
      this.buildingsMesh = built;
      this.worldGroup.add(this.buildingsMesh);
    }
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
    const ornaments = buildRoadOrnamentsGroup(grid);
    if (ornaments) {
      this.roadOrnaments = ornaments;
      this.worldGroup.add(ornaments);
    }
  }

  /** Rebuild the walking-path mesh from current path tiles. Sidewalks
   *  rebuild too because their per-side extension depends on which
   *  neighbours are paths. */
  drawPaths(grid: Grid): void {
    this.rebuildPaths(grid);
    this.rebuildSidewalks(grid);
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
      obj.position.set(
        (ax + (bx - ax) * t) * TILE_SIZE,
        yA + (yB - yA) * t + 0.05,
        (az + (bz - az) * t) * TILE_SIZE
      );
      // atan2(x, z) so +Z (south) is yaw=0, +X (east) is yaw=π/2.
      obj.rotation.set(0, Math.atan2(bx - ax, bz - az), 0);
      obj.scale.set(1, 1, 1);
      obj.updateMatrix();
      this.carsMesh.setMatrixAt(i, obj.matrix);
      c.setHex(car.color);
      this.carsMesh.setColorAt(i, c);
    }
    this.carsMesh.count = vehicles.cars.length;
    this.carsMesh.instanceMatrix.needsUpdate = true;
    if (this.carsMesh.instanceColor) this.carsMesh.instanceColor.needsUpdate = true;
  }

  /**
   * (Re)build the traffic heatmap overlay from each road tile's
   * sustained-load EMA. Green at zero load, ramping through yellow to red.
   * Called every render frame while the toggle is on; cleared via
   * `clearHeatmap` when the player turns it off.
   */
  drawHeatmap(grid: Grid): void {
    if (this.heatmapMesh) {
      this.worldGroup.remove(this.heatmapMesh);
      this.heatmapMesh.geometry.dispose();
      (this.heatmapMesh.material as MeshLambertMaterial).dispose();
      this.heatmapMesh = null;
    }
    const built = buildHeatmapMesh(grid);
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
    this.pedestriansMesh.instanceMatrix.needsUpdate = true;
    if (this.pedestriansMesh.instanceColor) this.pedestriansMesh.instanceColor.needsUpdate = true;
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
      // Pull-over offset: when dwelling at a stop, slide the bus to the
      // sidewalk on the building-side (perpendicular to direction). The
      // road centreline stays clear so cars pass freely.
      let lateral = 0;
      if (bus.dwellRemaining > 0) {
        // Offset toward the right of travel — close enough to the bus bay
        // visual on a typical road tile.
        lateral = 0.22;
      }
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len * lateral;
      const pz = dx / len * lateral;
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
    this.busesMesh.instanceMatrix.needsUpdate = true;
    if (this.busesMesh.instanceColor) this.busesMesh.instanceColor.needsUpdate = true;
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
  geom.computeVertexNormals();

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

function mergeGeoms(geoms: BufferGeometry[], colours: number[]): BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const g of geoms) {
    totalVerts += g.getAttribute('position').count;
    const idx = g.getIndex();
    totalIndices += idx ? idx.count : g.getAttribute('position').count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const cols = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vOff = 0;
  let iOff = 0;
  const c = new Color();
  for (let gi = 0; gi < geoms.length; gi++) {
    const g = geoms[gi]!;
    g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const idx = g.getIndex();
    c.setHex(colours[gi]!);

    for (let i = 0; i < p.count; i++) {
      positions[(vOff + i) * 3 + 0] = p.getX(i);
      positions[(vOff + i) * 3 + 1] = p.getY(i);
      positions[(vOff + i) * 3 + 2] = p.getZ(i);
      normals[(vOff + i) * 3 + 0] = n.getX(i);
      normals[(vOff + i) * 3 + 1] = n.getY(i);
      normals[(vOff + i) * 3 + 2] = n.getZ(i);
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
  out.setAttribute('normal', new BufferAttribute(normals, 3));
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
function buildBuildingsMesh(grid: Grid): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];
  // Per-tile lift = ROAD_LIFT/2 (avoid z-fighting with zone overlay)
  // PLUS the tile's terrain elevation (Alpha 2.3) so buildings sit on
  // the actual hill rather than buried in it.
  const baseLift = ROAD_LIFT * 0.5;
  for (const t of grid.iter()) {
    if (t.zone === 'none' || t.road) continue;
    // Luxury (Alpha 2.5): a 2-tile pair renders as one mansion. Emit only
    // from the lex-smaller tile of the pair (lower x, then lower y) so we
    // don't double-render. The mansion body extends into the partner.
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
    if (t.density === 0) continue;
    const parts = buildVariantParts(t.zone, t.density, t.x, t.y);
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
  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new Mesh(merged, mat);
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
  geom.computeVertexNormals();
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
function buildCityBuildingsMesh(grid: Grid): Mesh | null {
  const geoms: BufferGeometry[] = [];
  const colours: number[] = [];

  for (const t of grid.iter()) {
    if (t.building === 'none') continue;
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
    case 'bus_stop':
      return [
        { makeGeom: () => box(0.06, 0.45, 0.06), color: 0xc9a437, dx: 0, dy: 0.225, dz: 0 },
        { makeGeom: () => box(0.30, 0.04, 0.18), color: 0xe5c25a, dx: 0, dy: 0.45 + 0.02, dz: 0 }
      ];
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
  geom.computeVertexNormals();

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
  geom.computeVertexNormals();
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
      const yaw = Math.atan2(offset[0], offset[1]);
      arrow.rotateY(-yaw);
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
  geom.computeVertexNormals();
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
  geom.computeVertexNormals();
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
  g.computeVertexNormals();
  return g;
}
