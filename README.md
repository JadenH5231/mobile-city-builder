# City Builder — prototype

Premium mobile-first low-poly 3D city builder. Three.js + TypeScript + Vite. No backend; runs entirely in the browser.

**Status: alpha.** All 14 build steps shipped. Plays end-to-end: paint roads + zones, watch buildings grow, manage taxes against road + service upkeep, place power/water/parks to unlock L3, deal with traffic via bus stops + depots. Saves on a 30 s auto-cadence.

## Setup

Requires Node 18+ (Node 20 recommended).

```sh
npm install
npm run dev
```

Vite binds to `0.0.0.0`, so it'll print two URLs — a Local one and a Network one (e.g. `http://192.168.1.42:5173`). Open the **Network** URL on your phone.

If your computer's firewall blocks 5173, allow the connection (macOS will prompt; on Windows allow Node.js through Windows Defender Firewall).

### Finding your LAN IP manually

- macOS: `ipconfig getifaddr en0` (Wi-Fi) or `en1`
- Windows: `ipconfig` → look for IPv4 on your Wi-Fi adapter
- Linux: `hostname -I`

Phone and computer must be on the **same Wi-Fi network**. If you're on a corporate or guest network with client isolation, it won't work — use a personal hotspot or home network.

## Current feature status

| Step | Feature | Status |
| --- | --- | --- |
| 1 | Vite + TS bootstrap | ✅ |
| 2 | 64×64 grid, pan + pinch zoom | ✅ |
| 3 | Tile selection (tap / long-press) | ✅ |
| 4 | Roads (3D mesh; 2.5D→3D pivot) | ✅ |
| 5 | Zoning (R/C/I) | ✅ |
| 6 | Building spawning | ✅ |
| 7 | Population & demand (RCI) | ✅ |
| 8 | Vehicles + A* pathfinding | ✅ |
| 9 | Economy + tax sliders | ✅ |
| 10 | City buildings (radius services) | ✅ |
| 11 | Traffic congestion + heatmap | ✅ |
| 12 | Bus system | ✅ |
| 13 | Save/load (IndexedDB) | ✅ |
| 14 | Performance pass | ✅ |

Plus a post-alpha tuning pass: tighter money, sharper traffic penalties, and a 20-deep Undo stack.

## Controls

- **Pan:** one-finger drag (any tool).
- **Pinch:** two-finger zoom, anchored on midpoint. Two-finger pan also works.
- **Tap (Pan tool):** highlight a tile.
- **Long-press (Pan tool):** open the tile-info card with terrain / zone / density / services.
- **Drag with R/C/I/Road/Bulldoze tools:** rubber-band paint. Drag back along your path to undo within the stroke.
- **Tap with Power/Water/Park/Stop/Depot tools:** place one building per tap. Cost is deducted from treasury.
- **Treasury pill:** opens the budget panel (tax sliders + last month's totals + Reset city).
- **Undo pill:** reverts the last paint stroke or building placement.
- **Heat pill:** toggles the traffic heatmap overlay.

## What to test on your phone

Open the Network URL and try:

1. **Camera:** pinch + pan should feel locked-on, no drift, no jitter. FPS pill solid 60.
2. **Roads:** drag from one side to another — you should get clean diagonal segments, not stair-step. Drag back to retract.
3. **Zoning:** paint R/C/I next to a road, watch low-poly buildings sprout over a few seconds.
4. **Demand:** RCI bars should react when you have lots of houses but no commercial, etc.
5. **Cars:** once you have some R + C, cars appear and route along your roads.
6. **Services:** drop a power plant + water tower + park near zones; tiles within radius unlock L3 (taller buildings) over time.
7. **Buses:** place a depot + a few stops; a yellow bus should auto-cycle the stops, and nearby R should spawn fewer cars.
8. **Heatmap:** toggle on with congested traffic — green→yellow→red overlay on roads.
9. **Budget:** tap the treasury pill, slide R tax to 0% and watch demand spike (and revenue tank).
10. **Save:** reload the page — your city should come back exactly.

If anything's off — jitter, slow zoom, mis-aligned roads, sub-30fps on a mid-range phone — tell me what device + OS version and I'll fix it.

## Project structure

```
src/
  main.ts            entry point, FPS counter, HUD wiring
  styles.css         HUD pills, toolbar, info panels
  types.ts           shared constants + enums
  engine/
    Game.ts          owns loop, paint logic, undo stack
    Camera.ts        3D ortho camera (panBy / zoomAt / screenToWorld)
    Input.ts         pointer-events gesture handler (navigate / paint modes)
    Renderer.ts      Three.js scene (terrain, roads, trees, buildings, cars, heatmap)
  world/
    Grid.ts          tile container + road-edge graph
    Tile.ts          single-tile struct
  simulation/
    Population.ts    residents/jobs aggregation, RCI demand
    Development.ts   demand-driven density growth, service gates
    RoadGraph.ts     adjacency list rebuilt on road changes
    Pathfinding.ts   A* with reusable buffers
    Vehicles.ts      car spawn (sim) + motion (render)
    Buses.ts         per-depot buses; nearBusStop spawn suppression
    Economy.ts       treasury, monthly settlement, tax demand penalty
    Services.ts      radius-sweep coverage flags
    Traffic.ts       per-tile EMA + city-wide stress
  ui/
    TileInfoPanel.ts long-press info card
    BudgetPanel.ts   treasury + tax sliders
    Toolbar.ts       scrollable bottom tool selector
  persistence/
    SaveGame.ts      IndexedDB single-slot auto-save
```

## Tech notes

- **Three.js** for low-poly 3D. Orthographic camera at fixed 45° yaw / 35° pitch. Vertex-coloured terrain mesh + InstancedMesh for trees, buildings, cars, buses keeps the whole map at a handful of draw calls.
- **Pointer Events**, not Touch Events. Same code path covers mouse, pen, and touch. Pointer capture handles fingers drifting off the canvas mid-drag.
- **Sim tick decoupled from render tick.** Sim runs in 100 ms fixed steps; rendering at 60 Hz. Backgrounded tabs cap catch-up at 5 steps/frame so they don't death-spiral.
- `touch-action: none` on body + canvas to disable iOS double-tap zoom and Android pull-to-refresh during gameplay.
- Resolution capped at 2× DPR — past that you're paying for fragment shading nobody can see.
- TypeScript strict mode on. No `any` except one justified debug global (`window.game` for ad-hoc inspection).

## Scripts

```sh
npm run dev         # Vite dev server, LAN-exposed on 0.0.0.0:5173
npm run typecheck   # tsc --noEmit
npm run build       # type-check, then production build → dist/
npm run preview     # serve dist/ locally
```
