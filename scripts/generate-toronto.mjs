#!/usr/bin/env node
/**
 * Toronto preset generator.
 *
 * Builds a 128×128 SaveData representing a stylised Toronto: Lake Ontario
 * at the south, downtown financial district + skyscraper cluster, the
 * major arterial grid (Yonge / Bloor / 401 / Gardiner / DVP), Queen's
 * Park as the Provincial Capital, Nathan Phillips Square as City Hall,
 * Forest Hill as the Mayor's Mansion, and parks for the major green
 * spaces (High Park, Tommy Thompson, Rouge Park, Don Valley ravine).
 *
 * Landmarks the game has no model for (CN Tower, Rogers Centre, Union
 * Station, Casa Loma, Pearson Airport runways, Royal Ontario Museum)
 * are left BLANK as the user requested — the surrounding tiles are
 * developed, but the landmark footprint itself stays empty grass.
 *
 * Output: base64 portable-save code printed to stdout. Paste into
 * Settings → Backup & Sync → Import.
 */

const SCHEMA = 27;
const HEADER = 'MQCITYv1.';
const W = 128, H = 128;

// ---------- Tile factory ------------------------------------------------

function makeTile() {
  return {
    terrain: 'grass',
    road: false,
    roadType: 'local',
    highwayDir: -1,
    stopSign: false,
    trafficLight: false,
    busStop: false,
    elevation: 0,
    bridge: false,
    zone: 'none',
    zoneCap: 0,
    luxury: false,
    density: 0,
    pressure: 0,
    developedAt: 0,
    building: 'none',
    path: false,
    bridgeRoad: false,
    bridgeRoadType: 'local',
    bridgeHighwayDir: -1,
    districtId: 0,
    skyscraper: false,
    skyscraperStage: 0,
    skyscraperVariant: 0,
    owned: true,
    mayorMansion: false,
    cityHall: false,
    provincialCapital: false,
    nationalCapital: false,
    bigBuildBlockPaid: false,
    ramp: false,
    cloverleaf: false,
    bigBuildRotation: 0,
  };
}

const tiles = Array.from({ length: W * H }, makeTile);
const get = (x, y) => (x >= 0 && x < W && y >= 0 && y < H) ? tiles[y * W + x] : null;
const inBounds = (x, y) => x >= 0 && x < W && y >= 0 && y < H;

// ---------- Terrain: lake + islands ------------------------------------

// Lake Ontario at the south. y >= 110 is open water with a slightly
// uneven shoreline.
for (let y = 110; y < H; y++) {
  for (let x = 0; x < W; x++) {
    get(x, y).terrain = 'water';
  }
}
// Slight shoreline irregularity (small bays and points).
for (let x = 8; x < W - 8; x++) {
  // Wavy shoreline using a small sine.
  const wave = Math.round(Math.sin(x * 0.18) * 1.2);
  for (let y = 109; y <= 110 + wave; y++) {
    if (y >= 110 && get(x, y)) {
      // Carve the bay: this tile, which would have been water, becomes water (already is).
    } else if (get(x, y)) {
      get(x, y).terrain = 'water';
    }
  }
}

// Toronto Islands — small grass strip in the lake.
for (let y = 113; y <= 115; y++) {
  for (let x = 56; x <= 78; x++) {
    if (get(x, y)) get(x, y).terrain = 'grass';
  }
}
// Tommy Thompson Park (the Spit) — narrow grass arm extending SE from the
// port lands into the lake.
for (let i = 0; i <= 8; i++) {
  const sx = 80 + i;
  const sy = 110 + Math.floor(i / 2);
  if (get(sx, sy)) get(sx, sy).terrain = 'grass';
  if (get(sx, sy + 1)) get(sx, sy + 1).terrain = 'grass';
}

// Don River + Don Valley — narrow water channel + wide forest corridor.
// Goes from the north (around y=22) south to the lake, weaving slightly.
for (let y = 22; y < 109; y++) {
  // Channel: 1-2 tiles wide, weaving around a central x.
  const cx = 86 + Math.round(Math.sin(y * 0.10) * 1.5);
  for (let dx = -1; dx <= 1; dx++) {
    const t = get(cx + dx, y);
    if (!t) continue;
    if (dx === 0) {
      // The channel itself is water (small river).
      // Skip if it'd cut a major arterial — we'll bridge the road later.
      t.terrain = 'water';
    } else {
      // Bank of forest on either side.
      if (t.terrain === 'grass') t.terrain = 'forest';
    }
  }
  // Wider forest band along the valley.
  for (let dx of [-3, -2, 2, 3]) {
    const t = get(cx + dx, y);
    if (!t) continue;
    if (t.terrain === 'grass' && Math.random() < 0.45) t.terrain = 'forest';
  }
}

// Rouge Park (NE corner) — large forest patch.
for (let y = 14; y <= 50; y++) {
  for (let x = 108; x < W; x++) {
    const t = get(x, y);
    if (!t || t.terrain !== 'grass') continue;
    if (Math.random() < 0.65) t.terrain = 'forest';
  }
}

// High Park — small wooded area in the west.
for (let y = 84; y <= 96; y++) {
  for (let x = 30; x <= 40; x++) {
    const t = get(x, y);
    if (!t || t.terrain !== 'grass') continue;
    if (Math.random() < 0.55) t.terrain = 'forest';
  }
}

// Humber River — small water + forest corridor on the west side.
for (let y = 22; y < 109; y++) {
  const cx = 26 + Math.round(Math.sin(y * 0.12) * 1.0);
  const t = get(cx, y);
  if (!t) continue;
  // Thin water channel.
  if (Math.random() < 0.45) t.terrain = 'water';
  for (let dx of [-2, -1, 1, 2]) {
    const tt = get(cx + dx, y);
    if (!tt || tt.terrain !== 'grass') continue;
    if (Math.random() < 0.30) tt.terrain = 'forest';
  }
}

// ---------- Roads ------------------------------------------------------

const edgeKeys = new Set();
function addEdgeKey(ax, ay, bx, by) {
  // Canonicalize so reversed pair maps to the same key.
  let p1 = `${ax},${ay}`;
  let p2 = `${bx},${by}`;
  if (ax > bx || (ax === bx && ay > by)) [p1, p2] = [p2, p1];
  edgeKeys.add(`${p1}|${p2}`);
}

function paintRoadLine(x1, y1, x2, y2, tier) {
  // Bresenham-ish line painter. Walks tile-by-tile in 8 directions.
  let x = x1, y = y1;
  const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const t = get(x, y);
    if (t) {
      if (t.terrain === 'water') {
        t.road = true;
        t.roadType = tier;
        t.bridge = true;
      } else if (t.terrain === 'forest') {
        t.terrain = 'grass';
        t.road = true;
        t.roadType = tier;
      } else {
        t.road = true;
        t.roadType = tier;
        // Wipe zone if any (re-paint over zoned tile is fine — we control
        // the order, zones come after roads).
        t.zone = 'none';
        t.zoneCap = 0;
      }
    }
    if (prev) {
      addEdgeKey(prev.x, prev.y, x, y);
    }
    prev = { x, y };
    if (x === x2 && y === y2) break;
    x += dx; y += dy;
  }
}

// Highways always run as dual carriageways — paint a parallel reverse lane.
function paintDualHighway(x1, y1, x2, y2) {
  paintRoadLine(x1, y1, x2, y2, 'highway');
  // Perpendicular offset of overall direction (right side).
  const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
  const px = -dy, py = dx;
  paintRoadLine(x1 + px, y1 + py, x2 + px, y2 + py, 'highway');
}

// --- Highways (with dual carriageway) ---
// Highway 401 — across the entire north of the city.
paintDualHighway(0, 28, 127, 28);
// Highway 400 — north-south in the west, connecting to 401.
paintDualHighway(38, 0, 38, 28);
// Highway 404 / Don Valley Parkway — NE corner connecting to 401.
paintDualHighway(98, 0, 98, 28);
// DVP continues south from 401 down toward the lake (east of downtown).
paintDualHighway(98, 30, 98, 108);
// Gardiner Expressway — east-west along the lake.
paintDualHighway(20, 107, 110, 107);
// QEW — extends Gardiner west-southwest.
paintDualHighway(20, 109, 0, 109);
// Allen Road — short N-S spur connecting 401 to Eglinton.
paintDualHighway(50, 30, 50, 56);

// --- Avenues (4-lane bidirectional) ---
function paintAvenue(x1, y1, x2, y2) { paintRoadLine(x1, y1, x2, y2, 'avenue'); }
// Yonge Street (the spine)
paintAvenue(64, 30, 64, 105);
// Bloor Street (E-W midtown)
paintAvenue(8, 72, 120, 72);
// Eglinton Avenue (E-W)
paintAvenue(8, 56, 120, 56);
// Sheppard Avenue (E-W, north)
paintAvenue(20, 38, 110, 38);
// Finch Avenue (E-W, far north)
paintAvenue(20, 32, 110, 32);
// St. Clair Avenue (E-W, between Bloor and Eglinton)
paintAvenue(20, 64, 110, 64);
// Dundas Street (E-W, downtown north)
paintAvenue(40, 96, 110, 96);
// Queen Street (E-W, downtown)
paintAvenue(28, 100, 110, 100);
// King Street (E-W, downtown south)
paintAvenue(28, 103, 110, 103);
// Lakeshore Boulevard
paintAvenue(20, 108, 110, 108);
// University Avenue (N-S, downtown spine — west of the financial district
// skyscraper cluster so it doesn't cut through them).
paintAvenue(54, 80, 54, 104);
// Bayview Avenue (N-S east side, east of skyscrapers)
paintAvenue(80, 38, 80, 105);
// Bathurst Street (N-S west side)
paintAvenue(46, 38, 46, 105);
// Dufferin Street (N-S west side)
paintAvenue(32, 38, 32, 105);
// Don Mills Road (N-S east)
paintAvenue(90, 38, 90, 96);
// Victoria Park (N-S far east)
paintAvenue(104, 32, 104, 105);

// --- Local road grid in residential neighborhoods ---
// Reserved no-local-road zones (where monuments + skyscrapers go).
// Locals would cut through those footprints otherwise.
const RESERVED = [
  // Financial district + downtown core (skyscrapers + city hall)
  { x0: 44, y0: 78, x1: 78, y1: 96 },
  // Provincial Capital (Queen's Park)
  { x0: 50, y0: 73, x1: 60, y1: 80 },
  // Mayor's Mansion (Forest Hill)
  { x0: 40, y0: 64, x1: 48, y1: 70 },
  // Yorkville skyscrapers
  { x0: 58, y0: 65, x1: 74, y1: 73 },
  // Midtown skyscrapers (Yonge-Eglinton)
  { x0: 58, y0: 50, x1: 70, y1: 58 },
  // North York skyscrapers
  { x0: 58, y0: 32, x1: 72, y1: 44 },
];

function inReserved(x, y) {
  for (const r of RESERVED) {
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
  }
  return false;
}

function paintLocal(x1, y1, x2, y2) {
  // Honour reserved zones — split the line and skip tiles inside any
  // reserved rect.
  const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  let x = x1, y = y1;
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    if (inReserved(x, y)) {
      prev = null; // break the segment
    } else {
      const t = get(x, y);
      if (t) {
        if (t.terrain === 'water') {
          t.road = true; t.roadType = 'local'; t.bridge = true;
        } else if (t.terrain === 'forest') {
          t.terrain = 'grass'; t.road = true; t.roadType = 'local';
        } else {
          t.road = true; t.roadType = 'local';
          t.zone = 'none'; t.zoneCap = 0;
        }
      }
      if (prev) addEdgeKey(prev.x, prev.y, x, y);
      prev = { x, y };
    }
    if (x === x2 && y === y2) break;
    x += dx; y += dy;
  }
}

// East York / The Beaches
for (let y = 78; y <= 105; y += 4) {
  paintLocal(78, y, 105, y);
}
for (let x = 80; x <= 105; x += 5) {
  paintLocal(x, 76, x, 107);
}

// West End (High Park / Junction)
for (let y = 76; y <= 105; y += 4) {
  paintLocal(28, y, 50, y);
}
for (let x = 30; x <= 48; x += 5) {
  paintLocal(x, 76, x, 105);
}

// Midtown (between Bloor and Eglinton, but skip Yonge corridor)
for (let y = 60; y <= 70; y += 4) {
  paintLocal(36, y, 90, y);
}
for (let x = 40; x <= 88; x += 5) {
  paintLocal(x, 56, x, 72);
}

// North York (around Yonge & Sheppard)
for (let y = 34; y <= 50; y += 4) {
  paintLocal(40, y, 90, y);
}
for (let x = 44; x <= 86; x += 5) {
  paintLocal(x, 32, x, 54);
}

// Etobicoke (west)
for (let y = 60; y <= 90; y += 5) {
  paintLocal(8, y, 32, y);
}
for (let x = 10; x <= 32; x += 5) {
  paintLocal(x, 56, x, 95);
}

// Scarborough (east)
for (let y = 38; y <= 70; y += 4) {
  paintLocal(98, y, 124, y);
}
for (let x = 100; x <= 124; x += 5) {
  paintLocal(x, 32, x, 75);
}

// Suburbs north of 401
for (let y = 8; y <= 24; y += 4) {
  paintLocal(8, y, 124, y);
}
for (let x = 10; x <= 124; x += 6) {
  paintLocal(x, 8, x, 24);
}

// ---------- Civic monuments (BEFORE zones, so they win the spot) -------

function placeBigBuild(ax, ay, kind, footprintW, footprintH, rotation = 0) {
  const w = (rotation % 2 === 0) ? footprintW : footprintH;
  const h = (rotation % 2 === 0) ? footprintH : footprintW;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const t = get(ax + dx, ay + dy);
      if (!t) return false;
      if (t.road || t.terrain !== 'grass') return false;
      if (t.zone !== 'none' || t.building !== 'none') return false;
      if (t.skyscraper || t.mayorMansion || t.cityHall || t.provincialCapital || t.nationalCapital) return false;
    }
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const t = get(ax + dx, ay + dy);
      switch (kind) {
        case 'mayor_mansion': t.mayorMansion = true; break;
        case 'city_hall': t.cityHall = true; break;
        case 'provincial_capital': t.provincialCapital = true; break;
        case 'national_capital': t.nationalCapital = true; break;
      }
      t.bigBuildBlockPaid = true;
    }
  }
  const anchor = get(ax, ay);
  anchor.building = kind;
  anchor.bigBuildRotation = rotation;
  return true;
}

// Provincial Capital — Queen's Park
const provPlaced = placeBigBuild(52, 75, 'provincial_capital', 6, 4);
// City Hall — Nathan Phillips Square. Placed between Dundas (y=96)
// and Queen (y=100) but the 3-row footprint (y=92-94) avoids both.
const cityHallPlaced = placeBigBuild(48, 91, 'city_hall', 5, 3);
// Mayor's Mansion — Forest Hill
const mansionPlaced = placeBigBuild(42, 66, 'mayor_mansion', 4, 2);

// ---------- Skyscrapers (Financial District, BEFORE zones) -------------

function placeSkyscraper(ax, ay, zone, variant = 0) {
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const t = get(ax + dx, ay + dy);
      if (!t) return false;
      if (t.road || t.terrain !== 'grass') return false;
      if (t.skyscraper || t.mayorMansion || t.cityHall || t.provincialCapital || t.nationalCapital) return false;
      if (t.zone !== 'none') return false;
    }
  }
  let hasRoad = false;
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -1; dx <= 2; dx++) {
      if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue;
      const t = get(ax + dx, ay + dy);
      if (t?.road) { hasRoad = true; break; }
    }
    if (hasRoad) break;
  }
  if (!hasRoad) return false;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const t = get(ax + dx, ay + dy);
      t.zone = zone;
      t.zoneCap = 4;
      t.density = 0;
      t.skyscraper = true;
      t.skyscraperStage = 4;
      t.skyscraperVariant = variant;
      t.developedAt = 1;
    }
  }
  return true;
}

// Scan a rectangular region for valid 2×2 skyscraper anchor spots.
// Walks left-to-right, top-to-bottom in steps of 3 (so neighbouring
// skyscrapers leave at least 1 tile between footprints), placing up
// to `maxCount` skyscrapers from the given zone+variant cycle.
function scanAndPlaceSkyscrapers(x0, y0, x1, y1, maxCount, zonesCycle) {
  let placed = 0;
  let cycleIdx = 0;
  for (let y = y0; y <= y1 - 1 && placed < maxCount; y += 3) {
    for (let x = x0; x <= x1 - 1 && placed < maxCount; x += 3) {
      const z = zonesCycle[cycleIdx % zonesCycle.length];
      const v = cycleIdx % 8;
      if (placeSkyscraper(x, y, z, v)) {
        placed++;
      }
      cycleIdx++;
    }
  }
  return placed;
}

let skyPlaced = 0;
// Financial District — south of Queen, dense commercial + mixed
skyPlaced += scanAndPlaceSkyscrapers(58, 80, 76, 95, 30, ['commercial', 'commercial', 'mixed', 'commercial', 'mixed']);
// Yorkville / Bloor-Yonge — high-density residential + mixed
skyPlaced += scanAndPlaceSkyscrapers(58, 65, 76, 73, 8, ['residential', 'mixed', 'residential']);
// Yonge-Eglinton midtown
skyPlaced += scanAndPlaceSkyscrapers(58, 50, 72, 56, 6, ['residential', 'mixed', 'residential']);
// North York Centre
skyPlaced += scanAndPlaceSkyscrapers(58, 32, 72, 46, 8, ['residential', 'mixed', 'commercial', 'residential']);

// ---------- Zones -------------------------------------------------------

function paintZoneRect(x1, y1, x2, y2, zone, density, options = {}) {
  const { skipChance = 0, requireRoadAdj = true } = options;
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const t = get(x, y);
      if (!t) continue;
      if (t.road) continue;
      if (t.terrain !== 'grass') continue;
      if (t.zone !== 'none') continue;
      if (t.building !== 'none') continue;
      if (t.skyscraper || t.mayorMansion || t.cityHall || t.provincialCapital || t.nationalCapital || t.cloverleaf) continue;
      if (skipChance > 0 && Math.random() < skipChance) continue;
      // Require 4-adjacency to a road tile (developable rule).
      if (requireRoadAdj) {
        const adj =
          (get(x + 1, y)?.road) ||
          (get(x - 1, y)?.road) ||
          (get(x, y + 1)?.road) ||
          (get(x, y - 1)?.road);
        if (!adj) continue;
      }
      t.zone = zone;
      t.zoneCap = density;
      t.density = density;
      t.developedAt = 1;
    }
  }
}

// --- Downtown core: high-density commercial + mixed-use ---
paintZoneRect(40, 95, 90, 107, 'commercial', 3);
paintZoneRect(40, 95, 90, 107, 'mixed', 3, { skipChance: 0.3 });
paintZoneRect(40, 76, 90, 94, 'mixed', 3);
paintZoneRect(40, 76, 90, 94, 'residential', 3, { skipChance: 0.4 });

// --- Yorkville / Bloor-Yonge (medium density mixed + residential) ---
paintZoneRect(56, 66, 76, 78, 'mixed', 3);
paintZoneRect(56, 66, 76, 78, 'residential', 3, { skipChance: 0.3 });

// --- Midtown (Yonge-Eglinton): medium-high density ---
paintZoneRect(54, 50, 78, 65, 'residential', 3);
paintZoneRect(54, 50, 78, 65, 'mixed', 2, { skipChance: 0.6 });

// --- North York Centre: medium-high density ---
paintZoneRect(54, 32, 78, 50, 'residential', 3);
paintZoneRect(54, 32, 78, 50, 'commercial', 2, { skipChance: 0.7 });

// --- Scarborough: medium density residential + commercial ---
paintZoneRect(98, 38, 124, 70, 'residential', 2);
paintZoneRect(98, 56, 110, 64, 'commercial', 2, { skipChance: 0.5 });

// --- Etobicoke: medium-low density residential ---
paintZoneRect(8, 56, 32, 95, 'residential', 2);
paintZoneRect(20, 70, 32, 76, 'commercial', 2, { skipChance: 0.6 });

// --- East York / The Beaches: medium-low density residential ---
paintZoneRect(80, 78, 105, 105, 'residential', 2);
paintZoneRect(85, 95, 105, 105, 'commercial', 1, { skipChance: 0.7 });

// --- West End (High Park / Junction / Roncesvalles): medium R + small C ---
paintZoneRect(28, 76, 50, 94, 'residential', 2);

// --- North suburbs (above 401): low density residential ---
paintZoneRect(8, 6, 124, 22, 'residential', 1);

// --- Industrial port lands (between Gardiner and lake, east of downtown) ---
// Note: lake is at y=110, Gardiner at y=107. Narrow band y=108-109.
// Move industrial inland a bit, around y=105-108 east of the financial district.
paintZoneRect(72, 105, 96, 108, 'industrial', 3);

// --- Pearson Airport area: industrial cluster (NW) ---
paintZoneRect(8, 36, 30, 52, 'industrial', 2, { skipChance: 0.5 });

// --- Liberty Village / Junction area: medium I ---
paintZoneRect(34, 100, 50, 105, 'industrial', 2, { skipChance: 0.4 });

// ---------- Service buildings + parks ----------------------------------

function placeBuildingExact(x, y, kind) {
  const t = get(x, y);
  if (!t) return false;
  if (t.road) return false;
  // Ferry docks need water adjacency (they sit on the shore).
  if (kind === 'ferry_dock') {
    if (t.terrain !== 'grass') return false;
    const nearWater =
      (get(x + 1, y)?.terrain === 'water') || (get(x - 1, y)?.terrain === 'water') ||
      (get(x, y + 1)?.terrain === 'water') || (get(x, y - 1)?.terrain === 'water');
    if (!nearWater) return false;
  } else if (t.terrain !== 'grass') {
    return false;
  }
  if (t.skyscraper || t.mayorMansion || t.cityHall || t.provincialCapital || t.nationalCapital) return false;
  // Need road adjacency for most service buildings.
  const adj =
    (get(x + 1, y)?.road) || (get(x - 1, y)?.road) ||
    (get(x, y + 1)?.road) || (get(x, y - 1)?.road);
  if (!adj && kind !== 'park' && kind !== 'forestry' && kind !== 'farm') return false;
  // Override any existing zone — service placement wins (this script is a
  // hand-crafted seed, so deliberate placements take precedence over the
  // bulk zone fill).
  t.zone = 'none';
  t.zoneCap = 0;
  t.density = 0;
  t.developedAt = 0;
  t.building = kind;
  return true;
}

// Spiral outward from (x, y) to find the first valid spot for this
// building kind. Used so the script can specify desired neighborhoods
// without each call having to know the exact road-adjacent tile.
function placeNear(x, y, kind, maxRadius = 8) {
  if (placeBuildingExact(x, y, kind)) return true;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (placeBuildingExact(x + dx, y + dy, kind)) return true;
      }
    }
  }
  return false;
}

// Power plants (city-wide as long as ANY exists per Alpha 3.1.4).
placeNear(18, 48, 'power_plant');   // Industrial NW (near Pearson)
placeNear(85, 105, 'power_plant');  // Port Lands

// Water towers
placeNear(50, 25, 'water_tower');
placeNear(95, 25, 'water_tower');

// Hospitals (cluster downtown + a few in outer areas)
placeNear(54, 92, 'hospital');   // Toronto General area
placeNear(56, 88, 'hospital');   // Sick Kids area
placeNear(60, 50, 'hospital');   // Sunnybrook area (north)
placeNear(100, 60, 'hospital');  // Scarborough Health Network
placeNear(22, 78, 'hospital');   // Etobicoke General
placeNear(82, 84, 'hospital');   // Michael Garron / East York

// Police stations
placeNear(44, 100, 'police_station');
placeNear(78, 100, 'police_station');
placeNear(60, 38, 'police_station');
placeNear(104, 56, 'police_station');
placeNear(22, 70, 'police_station');

// Fire stations
placeNear(50, 102, 'fire_station');
placeNear(80, 88, 'fire_station');
placeNear(66, 60, 'fire_station');
placeNear(108, 60, 'fire_station');
placeNear(22, 80, 'fire_station');

// Schools (a few)
placeNear(50, 78, 'school');     // U of T area
placeNear(70, 60, 'school');
placeNear(40, 80, 'school');
placeNear(90, 70, 'school');
placeNear(105, 50, 'school');
placeNear(20, 84, 'school');
placeNear(64, 30, 'school');     // North York

// Parks — High Park (cluster on the west)
for (let y = 84; y <= 92; y++) {
  for (let x = 32; x <= 38; x++) {
    const t = get(x, y);
    if (t && t.terrain === 'forest') t.terrain = 'grass'; // clear forest for park placement
    placeNear(x, y, 'park');
  }
}
// Trinity Bellwoods Park
for (let y = 96; y <= 100; y++) {
  for (let x = 44; x <= 48; x++) {
    placeNear(x, y, 'park');
  }
}
// Christie Pits
placeNear(48, 78, 'park');
placeNear(48, 79, 'park');
placeNear(49, 78, 'park');
// Allan Gardens
placeNear(70, 96, 'park');
placeNear(70, 97, 'park');
// Tommy Thompson Park (on the spit)
for (let i = 0; i <= 8; i++) {
  placeNear(80 + i, 110 + Math.floor(i / 2), 'park');
}
// Toronto Islands parks
for (let x = 60; x <= 76; x++) {
  placeNear(x, 114, 'park');
}
// Don Valley parkland (along the river corridor)
for (let y = 30; y <= 105; y += 3) {
  placeNear(85, y, 'park');
  placeNear(91, y, 'park');
}

// Forestry (lumber operations on the forest edge — Rouge area)
placeNear(118, 30, 'forestry');
placeNear(118, 36, 'forestry');

// Farms (north suburbs, low density)
placeNear(15, 12, 'farm');
placeNear(115, 14, 'farm');

// Ferry docks — paired across Lake Ontario to Toronto Islands
placeNear(64, 109, 'ferry_dock');     // Mainland side (Jack Layton terminal)
placeNear(66, 113, 'ferry_dock');     // Centre Island side

// Subway entrances (suppress car spawns nearby — represents TTC subway)
placeNear(64, 90, 'subway_entrance');   // Union (adjacent area, no Union model)
placeNear(64, 84, 'subway_entrance');   // Queen
placeNear(64, 76, 'subway_entrance');   // Bloor-Yonge
placeNear(64, 64, 'subway_entrance');   // St. Clair
placeNear(64, 56, 'subway_entrance');   // Eglinton
placeNear(64, 38, 'subway_entrance');   // Sheppard
placeNear(64, 32, 'subway_entrance');   // Finch (TTC north terminus area)

// Bus depot (one on each side)
placeNear(40, 80, 'bus_depot');
placeNear(96, 80, 'bus_depot');

// Landmarks (museum / stadium / observatory) — game DOES have models for these,
// but for fidelity to "leave landmark blank if no model": since the game's
// generic museum/stadium isn't the actual landmark, leave the landmark spots
// blank.

// ---------- Toronto landmark Easter eggs (Alpha 4.24) ------------------
// Each landmark is a Building kind that exists ONLY for this preset —
// not in the toolbar, not in BUILDING_COSTS, not in faction stances.
// The renderer's cityBuildingParts switch dispatches geometry from
// src/engine/TorontoLandmarks.ts. Source-divers find these as the
// hint that the Toronto preset is the easter egg.
function stampLandmarkExact(x, y, kind) {
  const t = get(x, y);
  if (!t) return false;
  if (t.road) return false;
  if (t.skyscraper || t.mayorMansion || t.cityHall || t.provincialCapital || t.nationalCapital) return false;
  // Force the tile to grass (in case zone fill or forest got there).
  if (t.terrain !== 'grass') t.terrain = 'grass';
  t.zone = 'none';
  t.zoneCap = 0;
  t.density = 0;
  t.developedAt = 0;
  t.building = kind;
  return true;
}
function stampLandmark(x, y, kind) {
  if (stampLandmarkExact(x, y, kind)) return true;
  // If the spot is unusable (road/conflict), back off to a clear neighbour
  // within 2 tiles so the landmark still appears near where it should.
  for (let r = 1; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        if (stampLandmarkExact(x + dx, y + dy, kind)) return true;
      }
    }
  }
  return false;
}

// Iconic landmarks — coordinates roughly match each landmark's real-
// world position relative to the rest of the city.
const lmCN     = stampLandmark(56, 99, 'cn_tower');
const lmRogers = stampLandmark(53, 100, 'rogers_centre');
const lmACC    = stampLandmark(58, 100, 'scotiabank_arena');
const lmUnion  = stampLandmark(61, 100, 'union_station');
const lmCasa   = stampLandmark(50, 67, 'casa_loma');
const lmROM    = stampLandmark(62, 76, 'royal_ontario_museum');
const lmAGO    = stampLandmark(56, 92, 'art_gallery_ontario');
const lmDist   = stampLandmark(76, 102, 'distillery_district');

// Pearson Airport — terminal + runways.
const lmTerm   = stampLandmark(18, 44, 'pearson_terminal');
// Two runway strips (north and south of the terminal). 18 tiles each
// running E-W. Runway tiles look like asphalt with white centerline
// dashes when stamped in a row.
function stampRunway(x0, y, length) {
  for (let i = 0; i < length; i++) {
    stampLandmark(x0 + i, y, 'runway');
  }
}
stampRunway(8, 38, 18);   // North runway
stampRunway(8, 50, 18);   // South runway

// Pearson — clear everything ELSE inside the airport rect (no zones
// inside the apron, but keep the terminal + runways).
for (let y = 38; y <= 52; y++) {
  for (let x = 8; x <= 28; x++) {
    const t = get(x, y);
    if (!t) continue;
    if (t.road) continue;
    if (t.building !== 'none') continue;   // keep landmarks
    t.zone = 'none';
    t.zoneCap = 0;
    t.density = 0;
    t.developedAt = 0;
  }
}

console.error(`[gen] landmarks: CN=${lmCN ? 'OK' : 'FAIL'}, Rogers=${lmRogers ? 'OK' : 'FAIL'}, ACC=${lmACC ? 'OK' : 'FAIL'}, Union=${lmUnion ? 'OK' : 'FAIL'}, Casa=${lmCasa ? 'OK' : 'FAIL'}, ROM=${lmROM ? 'OK' : 'FAIL'}, AGO=${lmAGO ? 'OK' : 'FAIL'}, Dist=${lmDist ? 'OK' : 'FAIL'}, Pearson=${lmTerm ? 'OK' : 'FAIL'}`);

// ---------- Build edge list -------------------------------------------

const edges = [];
for (const k of edgeKeys) {
  const [p1, p2] = k.split('|');
  const [ax, ay] = p1.split(',').map(Number);
  const [bx, by] = p2.split(',').map(Number);
  // Sanity: only emit edges where BOTH endpoints are road tiles
  // (paint operations may have toggled some by zone-clearing).
  const ta = get(ax, ay), tb = get(bx, by);
  if (!ta?.road || !tb?.road) continue;
  edges.push(ax, ay, bx, by);
}

// ---------- City bounds -----------------------------------------------

// Player has bought all the land — full grid is owned (already true via
// makeTile). Set bounds to cover the whole grid.

// ---------- Compose SaveData ------------------------------------------

const data = {
  schemaVersion: SCHEMA,
  width: W,
  height: H,
  tiles,
  roadEdges: edges,
  treasury: 5_000_000,
  taxR: 9,
  taxC: 10,
  taxI: 11,
  monthsElapsed: 240, // 20 sim years
  totalAccidents: 0,
  politicalCapital: 50,
  highestPop: 250000,
  cityName: 'Toronto',
  bridgeRoadEdges: [],
  cityBoundsX0: 0,
  cityBoundsX1: W - 1,
  cityBoundsY0: 0,
  cityBoundsY1: H - 1,
  beautificationTier: 'standard',
  effectiveBeautificationTier: 'standard',
  wealthSurtax: 0,
  lifetimeTourismRevenue: 0,
};

// ---------- Encode ---------------------------------------------------

async function encode(data) {
  const json = JSON.stringify(data);
  const utf8 = new TextEncoder().encode(json);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(utf8);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const gz = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { gz.set(c, off); off += c.byteLength; }
  // base64 encode
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < gz.length; i += CHUNK) {
    s += String.fromCharCode(...gz.subarray(i, Math.min(i + CHUNK, gz.length)));
  }
  return HEADER + Buffer.from(s, 'binary').toString('base64');
}

const code = await encode(data);

// Diagnostics — count what landed.
let zoneCounts = { residential: 0, commercial: 0, industrial: 0, mixed: 0 };
let buildingCounts = {};
let waterCount = 0, forestCount = 0, roadCount = 0, parkCount = 0;
for (const t of tiles) {
  if (t.terrain === 'water') waterCount++;
  if (t.terrain === 'forest') forestCount++;
  if (t.road) roadCount++;
  if (t.zone in zoneCounts) zoneCounts[t.zone]++;
  if (t.building !== 'none') {
    buildingCounts[t.building] = (buildingCounts[t.building] || 0) + 1;
  }
  if (t.building === 'park') parkCount++;
}
console.error(`[gen] terrain: ${waterCount} water, ${forestCount} forest, ${roadCount} road`);
console.error(`[gen] zones: R=${zoneCounts.residential} C=${zoneCounts.commercial} I=${zoneCounts.industrial} MU=${zoneCounts.mixed}`);
console.error(`[gen] buildings:`, buildingCounts);
console.error(`[gen] skyscrapers: ${skyPlaced} placed`);
console.error(`[gen] monuments: mansion=${mansionPlaced ? 'OK' : 'FAIL'}, cityHall=${cityHallPlaced ? 'OK' : 'FAIL'}, prov=${provPlaced ? 'OK' : 'FAIL'}`);
console.error(`[gen] edges: ${edges.length / 4}`);
console.error(`[gen] code length: ${code.length} chars (${(code.length / 1024).toFixed(1)} KB)`);

// Round-trip check: decode the code and confirm shape.
async function decode(code) {
  if (!code.startsWith(HEADER)) throw new Error('bad header');
  const b64 = code.slice(HEADER.length);
  const gz = Buffer.from(b64, 'base64');
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(gz);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  const json = new TextDecoder().decode(buf);
  return JSON.parse(json);
}
const decoded = await decode(code);
console.error(`[gen] round-trip OK: schema=${decoded.schemaVersion}, tiles=${decoded.tiles.length}, edges=${decoded.roadEdges.length / 4}`);

console.log(code);
