# Build a Premium Mobile City Builder — Web Prototype

> This is the canonical product specification. Treat it as the source of truth. If you (Claude Code) ever feel uncertain about scope, conventions, or what to build next, re-read this file before acting.
>
> **Note on the 3D pivot:** the original spec called for 2.5D isometric / PixiJS. Mid-Step-4 the renderer was rewritten as low-poly 3D / Three.js because tile-based 2D paint produced unavoidable zig-zag on diagonals. The simulation layer (`Tile`, `Grid`, `Tool`, demand model, save format) is renderer-agnostic and survived the pivot. Vision and anti-goals below are unchanged.

## Project Vision

Build a **low-poly 3D city builder** (orthographic camera at a fixed 3/4 angle, so it reads like a 2.5D iso game) that plays like a premium Steam title (think Cities: Skylines / classic SimCity) but is designed mobile-first for browsers. This is a **prototype to prove the core loop is fun** — no monetization, no timers, no energy systems, no paywalls. The end-state product will be a one-time-purchase premium game; the prototype should feel like that experience from day one.

## Anti-Goals (What This Game Is NOT)

- ❌ No microtransactions, IAPs, or premium currency
- ❌ No "wait 4 hours for your factory" timers
- ❌ No energy/stamina systems gating play
- ❌ No artificial complexity (e.g., elaborate power grids that exist purely to be a chore)
- ❌ No tap-to-build individual houses — use **zoning**, like Cities: Skylines

## Tech Stack (locked)

- **Renderer:** Three.js (WebGL2). Orthographic camera at fixed 45° yaw / 35° pitch — no orbit gestures.
- **Language:** TypeScript (strict mode)
- **Build tool:** Vite 5
- **State management:** Plain TypeScript classes / a lightweight ECS pattern. No React, no heavy frameworks. UI overlay is vanilla DOM/CSS.
- **Touch input:** Custom Pointer Events handler — same code path covers mouse, pen, and touch.
- **Persistence:** IndexedDB (no `idb` library — kept the dep list short).
- **No backend.** Fully client-side. Should work offline once loaded.

## Target Devices

- Primary test target: modern mid-range phones (iPhone 13+, Pixel 7+, equivalent Android)
- Should scale gracefully: a low-end Android from 2021 should run a small map smoothly; a high-end device should handle the largest map.

## Core Features (all delivered in alpha)

### 1. Map & Rendering
- Tile-based grid in a 3D scene. Vertex-coloured terrain, instanced cone-trees, instanced low-poly building meshes.
- **Three map sizes:** Small 64×64, Medium 128×128, Large 256×256. (Currently hard-coded to Small in `main.ts` — UI selector is a polish item.)
- Smooth pinch-to-zoom (anchored on the gesture midpoint), one-finger pan, two-finger pan.
- Single-finger tap to select; long-press for context info.

### 2. Zoning (priority — delivered)
Three zone types, drag-painted across grass tiles adjacent to roads:
- **Residential** (densities 1–3, L3 service-gated)
- **Commercial**
- **Industrial**

Zoned tiles develop buildings over time on a fixed-rate sim tick. Demand is driven by population, jobs, and commercial supply, modulated by tax rates and traffic stress. RCI demand bars in the HUD show the live signal.

### 3. City-Owned Buildings (delivered)
Single-tile, mutually exclusive with road and zone:
- Power plant
- Water tower
- Park
- Bus stop + bus depot

Power and water are **simple radius checks** (radius 8). Park is radius 3. A tile must have all three to unlock L3. No pipes/wires, no substations.

### 4. Traffic & Transit (priority — delivered)
- Cars spawn from developed Residential, route via A* on the road graph to a developed Commercial or Industrial tile, render at 60 Hz on smooth segment lerp.
- **Cars return** (Alpha 1.6). Outbound trips queue a `PendingReturn` with a randomised 8–22 sec visit timer; the return car spawns at the destination and drives back to the origin road tile. Traffic now reads as two-way.
- Per-tile traffic load propagates upstream slowdowns; sustained EMA pressure drags down R/C/I demand.
- **Traffic heatmap toggle** in the HUD (green→yellow→red overlay, rebuilt at 5 Hz when visible).
- Buses: each `bus_depot` keeps one bus alive, auto-cycling through every `bus_stop` on the map. Bus stops suppress 70% of nearby car spawns. (Player-drawn routes were a stretch goal — auto-cycle was deemed enough to demonstrate transit pressure for the prototype.)
- **Walking paths + sidewalks + pedestrians** (Alpha 1.6). Walking paths are a player-placed per-tile surface in the Roads popover, visibly narrower than any road. Paths cannot remove roads (silently skipped on a road tile) and visually terminate where they meet a road; they CAN remove zoning. Local + avenue road tiles auto-render concrete sidewalks (highways do not). Pedestrians spawn from developed R, walk the path/sidewalk graph to developed C/I, and despawn on arrival. When both ends of a trip are adjacent to a path, the corresponding car spawn is dropped with probability 0.55 — paths reduce traffic. Walking distance capped at 18 tiles so paths are for neighborhood mobility, not cross-city journeys.

### 5. Economy (priority — delivered)
- Treasury, three tax sliders (R/C/I, 0–25%, defaults 9/10/11). Tax rate scales monthly revenue and shifts demand (sweet spot at the default = zero penalty).
- Monthly settlement: revenue from residents+jobs minus road maintenance ($12/edge) and per-building upkeep.
- Going broke is a soft fail — treasury can go negative with no game-over.
- Budget panel slides up from the bottom; sliders bind to the Economy in real time.

### 6. Citizens
Aggregate population, jobs, and three demand values — **not** individual citizen agents (v2 feature). Citizens "leave" implicitly when high-density buildings revert as demand falls.

### 7. UI / HUD
- **Top:** population pill, RCI demand bars, treasury (clickable → budget panel), Undo button, Heatmap toggle, FPS counter.
- **Bottom:** scrollable tool selector pill — Pan, Road, R, C, I, Power, Water, Park, Bus stop, Bus depot, Bulldoze.
- All buttons sized for fingertips (≥44×44pt). One-handed playability is a goal.
- **Undo:** ring-buffer of full state snapshots, capped at 20. Each paint stroke / placement pushes one entry; sliders don't.

### 8. Save/Load (delivered)
- Single-slot IndexedDB save under key `main`, schema v5 as of Alpha 1.6.
- Saved: per-tile `terrain/road/roadType/highwayDir/stopSign/zone/zoneCap/density/pressure/building/path`, road-edge list, treasury, three tax rates, months elapsed, lifetime accidents, Political Capital.
- Auto-saves every 30 s real-time (fire-and-forget); auto-restores on init.
- Reset button at the bottom of the budget panel clears the slot and reloads.
- Schema migration: v2 → v5 saves all load with sensible defaults for fields added later (zoneCap defaults to 3 for any zoned tile; PC defaults to 0; path defaults to false). v1 is silently dropped.

## Performance Budget (non-negotiable)

- 60fps on a Pixel 7 / iPhone 13 with a fully developed Medium map.
- 30fps minimum on a 2021 mid-range Android with a Small map.
- Simulation tick decoupled from render tick — sim runs at ~10Hz, rendering at 60Hz.
- InstancedMesh for repeating geometry (trees, buildings, cars, buses); never one Mesh per entity at scale.
- Use spatial hashing for proximity queries if/when service-coverage sweeps become a hotspot.

## Code Quality Standards

- TypeScript strict mode on. No `any` without a justifying comment.
- Each simulation system in its own module with a clean interface.
- Game state must be **serializable** — no circular references, no functions stored in state. Save games depend on this.
- Comments explain *why*, not *what*.
- One class per file (rare exceptions for internal helpers like the path8 function in `Game.ts`).

## Project Structure

```
city-builder/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── src/
│   ├── main.ts          (entry point, FPS counter, HUD updates)
│   ├── styles.css       (HUD pills, toolbar, info panel)
│   ├── types.ts         (shared constants + enums)
│   ├── engine/
│   │   ├── Game.ts      (owns the loop, paint logic, undo stack)
│   │   ├── Camera.ts    (3D ortho camera, pan/zoom math)
│   │   ├── Input.ts     (pointer-events gesture handler — navigate / paint modes)
│   │   └── Renderer.ts  (Three.js scene: terrain, roads, trees, buildings, cars, heatmap)
│   ├── world/
│   │   ├── Grid.ts      (tile container + road-edge graph + zone/building rules)
│   │   └── Tile.ts      (single-tile struct, all serializable)
│   ├── simulation/
│   │   ├── Population.ts    (residents/jobs aggregation, RCI demand)
│   │   ├── Development.ts   (demand-driven density growth, service gates)
│   │   ├── RoadGraph.ts     (adjacency list rebuilt on road changes)
│   │   ├── Pathfinding.ts   (A* with reusable buffers)
│   │   ├── Vehicles.ts      (car spawn at sim rate, motion at render rate)
│   │   ├── Buses.ts         (per-depot buses; nearBusStop spawn suppression)
│   │   ├── Economy.ts       (treasury, monthly settlement, tax demand penalty)
│   │   ├── Services.ts      (radius-sweep coverage flags)
│   │   └── Traffic.ts       (per-tile EMA + city-wide stress)
│   ├── ui/
│   │   ├── TileInfoPanel.ts (long-press info card)
│   │   ├── BudgetPanel.ts   (treasury + tax sliders sheet)
│   │   └── Toolbar.ts       (scrollable bottom tool selector)
│   └── persistence/
│       └── SaveGame.ts      (IndexedDB single-slot auto-save)
└── README.md
```

## Build Order (history — all delivered)

1. ✅ **Bootstrap:** Vite + TS, single tile rendered.
2. ✅ **Grid:** 64×64 grid, camera pan + pinch zoom.
3. ✅ **Tile selection:** Tap to highlight, long-press for info.
4. ✅ **Roads:** drag-paint with diagonal-first 8-connected rubber band. (Triggered the 2D→3D pivot.)
5. ✅ **Zoning:** drag-paint R/C/I on grass adjacent to roads.
6. ✅ **Building spawning:** density 0–3 InstancedMesh, fixed-rate dev sim.
7. ✅ **Population & demand:** aggregate pop + jobs, RCI demand bars.
8. ✅ **Vehicles + A*:** RoadGraph, A* pathfinding, render-rate motion.
9. ✅ **Economy:** treasury, tax sliders, monthly settlement.
10. ✅ **City buildings:** power, water, park, bus stop/depot. L3 service gate.
11. ✅ **Traffic congestion + heatmap:** per-tile load slows traffic; EMA drags demand.
12. ✅ **Bus system:** spawn suppression near stops; depots run visible buses.
13. ✅ **Save/load:** IndexedDB auto-save + restore + reset.
14. ✅ **Performance pass:** heatmap throttled to 5 Hz; 528 KB / 135 KB gzipped.

After alpha, a tuning pass tightened money + traffic and added Undo.

See [`PROGRESS.md`](PROGRESS.md) for per-step detail and known issues.

## What to Deliver (alpha is in)

1. ✅ A running Vite dev server you can open on your phone over LAN.
2. ✅ A README with setup instructions and current feature status.
3. ✅ Clean commit history.
4. ✅ After each step, a "what to test on your phone" note.
