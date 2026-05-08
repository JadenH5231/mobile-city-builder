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
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
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
import {
  BUILDING_COLORS,
  BUILDING_DIMS,
  DIR_OFFSETS,
  MAX_VEHICLES,
  ROAD_LIFT,
  ROAD_TIER,
  TILE_SIZE,
  ZONE_COLORS,
  ZONE_LIFT,
  type TerrainType,
  type Zone
} from '../types';
import type { Buses } from '../simulation/Buses';
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
  grass: 0x6aa84f,
  forest: 0x4d8442,
  water: 0x3a7ec2,
  sand: 0xddc174
};

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
  private roadMesh: Mesh | null = null;
  private roadLanes: LineSegments | null = null;
  /** Highway flow arrows + stop signs — rebuilt with the road mesh. */
  private roadOrnaments: Group | null = null;
  private treesMesh: InstancedMesh | null = null;
  private buildingsMesh: InstancedMesh | null = null;
  /** One Group containing per-kind city building Mesh objects. Rebuilt on change. */
  private readonly cityBuildingsGroup = new Group();
  private heatmapMesh: Mesh | null = null;
  private carsMesh: InstancedMesh;
  private busesMesh: InstancedMesh;
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
    const carGeom = new BoxGeometry(0.18, 0.10, 0.30);
    carGeom.translate(0, 0.05, 0);
    const carMat = new MeshLambertMaterial({ flatShading: true });
    this.carsMesh = new InstancedMesh(carGeom, carMat, MAX_VEHICLES);
    this.carsMesh.count = 0;
    this.carsMesh.frustumCulled = false;
    this.worldGroup.add(this.carsMesh);

    // Buses — bigger silhouette so they read as transit, separate from cars.
    const busGeom = new BoxGeometry(0.24, 0.15, 0.55);
    busGeom.translate(0, 0.075, 0);
    const busMat = new MeshLambertMaterial({ flatShading: true });
    this.busesMesh = new InstancedMesh(busGeom, busMat, 16);
    this.busesMesh.count = 0;
    this.busesMesh.frustumCulled = false;
    this.worldGroup.add(this.busesMesh);
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

  /** Rebuild the road mesh from current grid edges + stubs. */
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
  updateCars(vehicles: Vehicles, gridWidth: number): void {
    const obj = this.tmpObj;
    const c = this.tmpColor;
    for (let i = 0; i < vehicles.cars.length; i++) {
      const car = vehicles.cars[i]!;
      const a = car.pathTiles[car.segmentIdx]!;
      const b = car.pathTiles[car.segmentIdx + 1]!;
      const ax = (a % gridWidth) + 0.5;
      const az = Math.floor(a / gridWidth) + 0.5;
      const bx = (b % gridWidth) + 0.5;
      const bz = Math.floor(b / gridWidth) + 0.5;
      const t = car.segmentT;
      obj.position.set(
        (ax + (bx - ax) * t) * TILE_SIZE,
        ROAD_LIFT + 0.05,
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

  /** Per-frame bus positions, mirror of `updateCars`. */
  updateBuses(buses: Buses, gridWidth: number): void {
    const obj = this.tmpObj;
    const c = this.tmpColor;
    let visible = 0;
    for (let i = 0; i < buses.buses.length; i++) {
      const bus = buses.buses[i]!;
      // Buses without a current path leg are between stops — skip drawing.
      if (bus.pathTiles.length < 2) continue;
      const a = bus.pathTiles[bus.segmentIdx]!;
      const b = bus.pathTiles[bus.segmentIdx + 1]!;
      const ax = (a % gridWidth) + 0.5;
      const az = Math.floor(a / gridWidth) + 0.5;
      const bx = (b % gridWidth) + 0.5;
      const bz = Math.floor(b / gridWidth) + 0.5;
      const t = bus.segmentT;
      obj.position.set(
        (ax + (bx - ax) * t) * TILE_SIZE,
        ROAD_LIFT + 0.07,
        (az + (bz - az) * t) * TILE_SIZE
      );
      obj.rotation.set(0, Math.atan2(bx - ax, bz - az), 0);
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
  // One vertex-coloured plane covering the whole grid. We split it into
  // (width × height) quads so each tile can have its own colour. Two
  // triangles per tile, vertex-coloured.
  const totalTiles = grid.width * grid.height;
  const positions = new Float32Array(totalTiles * 4 * 3);
  const colours = new Float32Array(totalTiles * 4 * 3);
  const indices = new Uint32Array(totalTiles * 6);
  const c = new Color();

  let vi = 0;
  let ii = 0;
  let v = 0;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const tile = grid.get(x, y)!;
      c.setHex(TERRAIN_COLORS[tile.terrain] ?? TERRAIN_COLORS.grass);

      const x0 = x * TILE_SIZE;
      const x1 = (x + 1) * TILE_SIZE;
      const z0 = y * TILE_SIZE;
      const z1 = (y + 1) * TILE_SIZE;

      // Four corners (y=0, the ground plane).
      positions[vi++] = x0; positions[vi++] = 0; positions[vi++] = z0;
      positions[vi++] = x1; positions[vi++] = 0; positions[vi++] = z0;
      positions[vi++] = x1; positions[vi++] = 0; positions[vi++] = z1;
      positions[vi++] = x0; positions[vi++] = 0; positions[vi++] = z1;

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

function buildTreesMesh(grid: Grid): InstancedMesh | null {
  // Count forest tiles first to size the InstancedMesh exactly.
  let count = 0;
  for (const t of grid.iter()) if (t.terrain === 'forest') count++;
  if (count === 0) return null;

  // A simple stylized tree: cone leaves on a stubby cylinder trunk, merged
  // into one geometry so each instance is one draw.
  const trunkH = 0.18;
  const leafH = 0.55;
  const trunk = new CylinderGeometry(0.06, 0.06, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  const leaves = new ConeGeometry(0.28, leafH, 8);
  leaves.translate(0, trunkH + leafH / 2, 0);

  // Merge into one geometry by hand (avoids importing addons).
  const tg = mergeGeoms([trunk, leaves], [TREE_TRUNK, TREE_LEAF]);

  const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const im = new InstancedMesh(tg, mat, count);
  const m = new Matrix4();
  const tmp = new Object3D();

  let i = 0;
  for (const t of grid.iter()) {
    if (t.terrain !== 'forest') continue;
    // Slight per-tile pseudo-random offset & rotation so the forest looks
    // less gridded. Deterministic from coords.
    const r = Math.abs(((t.x * 374761393) ^ (t.y * 668265263)) | 0);
    const ox = ((r % 1000) / 1000 - 0.5) * 0.4;
    const oz = (((r >> 10) % 1000) / 1000 - 0.5) * 0.4;
    const rot = ((r >> 20) % 1000) / 1000 * Math.PI * 2;
    tmp.position.set((t.x + 0.5) * TILE_SIZE + ox, 0, (t.y + 0.5) * TILE_SIZE + oz);
    tmp.rotation.y = rot;
    tmp.updateMatrix();
    m.copy(tmp.matrix);
    im.setMatrixAt(i++, m);
  }
  im.instanceMatrix.needsUpdate = true;
  return im;
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

function buildBuildingsMesh(grid: Grid): InstancedMesh | null {
  let count = 0;
  for (const t of grid.iter()) {
    if (t.zone !== 'none' && !t.road && t.density > 0) count++;
  }
  if (count === 0) return null;

  // Unit box, anchored at its base so per-instance scale grows upward.
  const geom = new BoxGeometry(1, 1, 1);
  geom.translate(0, 0.5, 0);
  // flatShading + Lambert gives the chunky low-poly look without textures.
  const mat = new MeshLambertMaterial({ flatShading: true });
  const im = new InstancedMesh(geom, mat, count);

  const obj = new Object3D();
  const c = new Color();
  let i = 0;

  for (const t of grid.iter()) {
    if (t.zone === 'none' || t.road || t.density === 0) continue;
    const dims = BUILDING_DIMS[t.density]!;

    // Tiny per-tile jitter so a row of identical density-1 cottages doesn't
    // line up like graph paper. Deterministic from the cell coords.
    const r = Math.abs(((t.x * 374761393) ^ (t.y * 668265263)) | 0);
    const ox = ((r % 1000) / 1000 - 0.5) * 0.08;
    const oz = (((r >> 10) % 1000) / 1000 - 0.5) * 0.08;
    const yaw = ((r >> 20) & 3) * (Math.PI / 2); // 0/90/180/270

    obj.position.set(
      (t.x + 0.5) * TILE_SIZE + ox,
      ROAD_LIFT * 0.5,
      (t.y + 0.5) * TILE_SIZE + oz
    );
    obj.rotation.set(0, yaw, 0);
    obj.scale.set(dims.w * TILE_SIZE, dims.h * TILE_SIZE, dims.w * TILE_SIZE);
    obj.updateMatrix();
    im.setMatrixAt(i, obj.matrix);

    const palette = BUILDING_COLORS[t.zone as Exclude<Zone, 'none'>];
    c.setHex(palette[t.density]!);
    im.setColorAt(i, c);
    i++;
  }
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  return im;
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
  const y = ROAD_LIFT + 0.04;

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
      return [
        { makeGeom: () => box(0.65, 0.5, 0.65), color: 0x484848, dx: 0, dy: 0.25, dz: 0 },
        { makeGeom: () => cyl(0.10, 0.75, 8), color: 0x6e6e6e, dx: 0.18, dy: 0.5 + 0.375, dz: 0 },
        { makeGeom: () => cyl(0.10, 0.10, 8), color: 0xb14a4a, dx: 0.18, dy: 0.5 + 0.75 + 0.05, dz: 0 }
      ];
    case 'water_tower':
      return [
        { makeGeom: () => box(0.10, 0.55, 0.10), color: 0x2f3f4a, dx: -0.15, dy: 0.275, dz: -0.15 },
        { makeGeom: () => box(0.10, 0.55, 0.10), color: 0x2f3f4a, dx: 0.15, dy: 0.275, dz: -0.15 },
        { makeGeom: () => box(0.10, 0.55, 0.10), color: 0x2f3f4a, dx: -0.15, dy: 0.275, dz: 0.15 },
        { makeGeom: () => box(0.10, 0.55, 0.10), color: 0x2f3f4a, dx: 0.15, dy: 0.275, dz: 0.15 },
        { makeGeom: () => cyl(0.32, 0.40, 12), color: 0x4d8eb9, dx: 0, dy: 0.55 + 0.20, dz: 0 }
      ];
    case 'park':
      return [
        { makeGeom: () => box(0.85, 0.04, 0.85), color: 0x4a8c3a, dx: 0, dy: 0.02, dz: 0 },
        { makeGeom: () => cyl(0.06, 0.18, 6), color: 0x6b3f1f, dx: 0, dy: 0.04 + 0.09, dz: 0 },
        { makeGeom: () => cone(0.22, 0.36, 8), color: 0x2f6a2d, dx: 0, dy: 0.04 + 0.18 + 0.18, dz: 0 }
      ];
    case 'bus_stop':
      return [
        { makeGeom: () => box(0.06, 0.45, 0.06), color: 0xc9a437, dx: 0, dy: 0.225, dz: 0 },
        { makeGeom: () => box(0.30, 0.04, 0.18), color: 0xe5c25a, dx: 0, dy: 0.45 + 0.02, dz: 0 }
      ];
    case 'bus_depot':
      return [
        { makeGeom: () => box(0.85, 0.45, 0.65), color: 0xc77a2a, dx: 0, dy: 0.225, dz: 0 },
        { makeGeom: () => box(0.85, 0.06, 0.65), color: 0x854f1c, dx: 0, dy: 0.48, dz: 0 }
      ];
    default:
      return [];
  }
}

function box(w: number, h: number, d: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  return g;
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

    const x0 = t.x * TILE_SIZE + inset;
    const x1 = (t.x + 1) * TILE_SIZE - inset;
    const z0 = t.y * TILE_SIZE + inset;
    const z1 = (t.y + 1) * TILE_SIZE - inset;

    positions[vi++] = x0; positions[vi++] = ZONE_LIFT; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = ZONE_LIFT; positions[vi++] = z0;
    positions[vi++] = x1; positions[vi++] = ZONE_LIFT; positions[vi++] = z1;
    positions[vi++] = x0; positions[vi++] = ZONE_LIFT; positions[vi++] = z1;

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
  const lanePositions: number[] = [];
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

    positions[vi++] = ax + px; positions[vi++] = yLift; positions[vi++] = az + pz;
    positions[vi++] = bx + px; positions[vi++] = yLift; positions[vi++] = bz + pz;
    positions[vi++] = bx - px; positions[vi++] = yLift; positions[vi++] = bz - pz;
    positions[vi++] = ax - px; positions[vi++] = yLift; positions[vi++] = az - pz;
    for (let k = 0; k < 4; k++) {
      colours[ci++] = c.r; colours[ci++] = c.g; colours[ci++] = c.b;
    }
    indices[ii++] = v; indices[ii++] = v + 1; indices[ii++] = v + 2;
    indices[ii++] = v; indices[ii++] = v + 2; indices[ii++] = v + 3;
    v += 4;

    // Centre-line stripe — drawn for local + avenue. Highway gets directional
    // arrows instead (see buildRoadOrnamentsGroup).
    if (tier !== 'highway') {
      const yStripe = yLift + 0.001;
      lanePositions.push(
        ax + dx * 0.18, yStripe, az + dz * 0.18,
        ax + dx * 0.42, yStripe, az + dz * 0.42,
        ax + dx * 0.58, yStripe, az + dz * 0.58,
        ax + dx * 0.82, yStripe, az + dz * 0.82
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
    positions[vi++] = cx - half; positions[vi++] = yLift; positions[vi++] = cz - half;
    positions[vi++] = cx + half; positions[vi++] = yLift; positions[vi++] = cz - half;
    positions[vi++] = cx + half; positions[vi++] = yLift; positions[vi++] = cz + half;
    positions[vi++] = cx - half; positions[vi++] = yLift; positions[vi++] = cz + half;
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

  let lanes: LineSegments | null = null;
  if (lanePositions.length > 0) {
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(lanePositions), 3));
    lanes = new LineSegments(lg, new LineBasicMaterial({ color: ROAD_LANE }));
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
    if (t.roadType === 'highway' && t.highwayDir >= 0 && t.highwayDir < 8) {
      const cx = (t.x + 0.5) * TILE_SIZE;
      const cz = (t.y + 0.5) * TILE_SIZE;
      const offset = DIR_OFFSETS[t.highwayDir]!;
      // Build a flat triangle pointing in the flow direction. y just above
      // the road surface so it's visible without z-fighting.
      const arrow = makeArrowGeom(0.18, 0.22);
      const yaw = Math.atan2(offset[0], offset[1]);
      arrow.rotateY(-yaw);
      arrow.translate(cx, ROAD_LIFT + 0.003, cz);
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
        post.translate(px, ROAD_LIFT + 0.05, pz);
        stops.push(post);
        stopColours.push(0x666666);

        const sign = new CylinderGeometry(0.05, 0.05, 0.02, 8);
        sign.rotateX(Math.PI / 2);
        sign.translate(px, ROAD_LIFT + 0.10, pz);
        stops.push(sign);
        stopColours.push(STOP_SIGN_COLOR);

        // White face hint for the silhouette of a stop sign.
        const face = new CylinderGeometry(0.035, 0.035, 0.003, 8);
        face.rotateX(Math.PI / 2);
        face.translate(px, ROAD_LIFT + 0.111, pz);
        stops.push(face);
        stopColours.push(STOP_SIGN_TEXT);
      }
    }
  }

  if (arrows.length === 0 && stops.length === 0) return null;
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
  return group;
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
