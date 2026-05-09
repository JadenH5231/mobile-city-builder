# City Builder — prototype

Premium mobile-first low-poly 3D city builder. Three.js + TypeScript + Vite. No backend; runs entirely in the browser.

**Status: Alpha 2.0.** Big pedestrian/transit/traffic overhaul plus UX polish on top of Alpha 1.6. Highlights:

- **Mixed-use C+R zoning** with its own MU low/med/high paint tools. Each tile contributes residents AND commercial jobs. YIMBYs love it, Hometown hates it.
- **Adaptive traffic lights** — a two-phase controller that measures queue length and allocates green time proportionally. Costs more than a stop sign ($1500 vs $250) but moves ~2-3× the cars at busy junctions because green-direction cars never sit still.
- **Sidewalk-side bus stops** — bus stops attach to road tiles' sidewalks rather than taking their own tile. Buses pull over for 1.6 s, cars pass freely.
- **Pedestrians 2.5×** — cap raised 200 → 500, spawn rate 2.7×.
- **Crosswalks** auto-render at walkable intersections.
- **QOL:** pause + 2× / 3× sim speed, photo mode (HUD hide), skippable tutorial, per-cell residents/jobs in the tile-info panel, "Bulldozed N tiles · Undo" toast for big strokes.
- **Save schema v6** — persists `trafficLight` and `busStop` per tile.

Alpha 1.5 + 1.6 baselines still hold: walking paths, returning cars, 10 named-leader factions, yearly elections, 4-seat council, four civic actions powered by Political Capital. Saves on a 30 s auto-cadence.

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

Open the Network URL and try (Alpha 2.0 highlights marked):

1. **Tutorial (Alpha 2.0):** first launch shows a 4-step welcome — skip or step through, then tap "Show tutorial again" in the budget panel to re-read.
2. **Camera:** pinch + pan should feel locked-on, no drift, no jitter. FPS pill solid 60.
3. **Roads:** drag from one side to another — you should get clean diagonal segments, not stair-step. Drag back to retract.
4. **Zoning + mixed-use (Alpha 2.0):** paint R/C/I next to a road; try the new **MU** group (mixed-use) — those tiles contribute residents AND commercial jobs.
5. **Cars + return trips:** cars appear, route to C/I, sit at destination 8–22 sec, drive back. Traffic should read two-way.
6. **Adaptive traffic lights (Alpha 2.0):** place a stop sign at one intersection and a Light at another. Watch which one moves more cars per minute — the light should win cleanly. The light's green stays longer on the busier axis.
7. **Bus stops on the sidewalk (Alpha 2.0):** pick the **BusStop** tool and tap a non-highway road tile. The stop renders on the sidewalk; buses pull over and cars pass freely.
8. **Pedestrians (Alpha 2.0):** with R + C built up you should see lots of walkers on sidewalks and paths.
9. **Walking paths:** Roads popover → **Path**, drag between R and C. Cars on covered routes should thin out.
10. **Sim speed (Alpha 2.0):** the new HUD pill cycles ▶ / ▶▶ / ▶▶▶ / ⏸. Try fast-forwarding the city to 3× to watch growth, then pause to plan.
11. **Photo mode (Alpha 2.0):** tap the Photo pill, all HUD chrome hides for screenshots. Tap again to bring it back.
12. **Per-cell info (Alpha 2.0):** long-press a developed tile — info card now shows residents/jobs that specific cell contributes.
13. **Bulldoze big stroke (Alpha 2.0):** drag the bulldozer over many tiles. A toast appears with an Undo button.
14. **Heatmap:** toggle on with congested traffic — green→yellow→red overlay on roads.
15. **Budget:** tap the treasury pill, slide R tax to 0% and watch demand spike (and revenue tank).
16. **Save:** reload the page — your city should come back exactly.

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
    Renderer.ts      Three.js scene (terrain, roads, sidewalks, crosswalks, paths, trees, buildings, cars, buses, pedestrians, traffic-lights, heatmap)
  world/
    Grid.ts          tile container + road-edge graph + walking-path bit
    Tile.ts          single-tile struct (terrain, road, path, …)
  simulation/
    Population.ts    residents/jobs aggregation, RCI demand
    Development.ts   demand-driven density growth, service gates
    RoadGraph.ts     car adjacency rebuilt on road changes
    PathGraph.ts     pedestrian adjacency: paths + non-highway road tiles
    Pathfinding.ts   A* over any PathfindGraph, reusable buffers
    Vehicles.ts      cars + park-then-return + path-coverage suppression
    Pedestrians.ts   walker spawn + motion on the pedestrian graph
    Buses.ts         per-depot buses + sidewalk pull-over dwell
    TrafficLights.ts adaptive 2-phase queue-aware signal controller
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
