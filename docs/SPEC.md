# Build a Premium Mobile City Builder — Web Prototype

> This is the canonical product specification. Treat it as the source of truth. If you (Claude Code) ever feel uncertain about scope, conventions, or what to build next, re-read this file before acting.

## Project Vision

Build a **2.5D isometric city builder** that plays like a premium Steam title (think Cities: Skylines / classic SimCity) but is designed mobile-first for browsers. This is a **prototype to prove the core loop is fun** — no monetization, no timers, no energy systems, no paywalls. The end-state product will be a one-time-purchase premium game; the prototype should feel like that experience from day one.

## Anti-Goals (What This Game Is NOT)

- ❌ No microtransactions, IAPs, or premium currency
- ❌ No "wait 4 hours for your factory" timers
- ❌ No energy/stamina systems gating play
- ❌ No artificial complexity (e.g., elaborate power grids that exist purely to be a chore)
- ❌ No tap-to-build individual houses — use **zoning**, like Cities: Skylines

## Tech Stack

- **Renderer:** PixiJS v8 (WebGL2, fast sprite batching, proven for thousands of entities at 60fps on mobile)
- **Language:** TypeScript (strict mode)
- **Build tool:** Vite
- **State management:** Plain TypeScript classes / a lightweight ECS pattern — no React, no heavy frameworks. The UI overlay can be vanilla DOM/CSS for HUD elements.
- **Touch input:** Hammer.js or a small custom gesture handler (pinch-zoom, pan, tap, long-press)
- **Persistence:** IndexedDB for save games (via `idb` library)
- **No backend.** Fully client-side. Should work offline once loaded.

## Target Devices

- Primary test target: modern mid-range phones (iPhone 13+, Pixel 7+, equivalent Android)
- Should scale gracefully: a low-end Android from 2021 should run a small map smoothly; a high-end device should handle the largest map.
- Use `navigator.deviceMemory` and a quick FPS benchmark on first load to **suggest** (not enforce) a map size to the player.

## Core Features for the Prototype

### 1. Map & Rendering
- Isometric grid, tile-based.
- **Three selectable map sizes** at game start:
  - Small: 64×64 tiles (low-end friendly)
  - Medium: 128×128
  - Large: 256×256 (recommend only if device benchmark passes)
- Smooth pinch-to-zoom (min zoom shows full map, max zoom shows ~10 tiles across).
- Two-finger pan, single-finger tap to select, long-press for context menu.
- Day/night cycle is a stretch goal — skip for prototype.

### 2. Zoning System (priority)
Three zone types, painted by dragging across tiles:
- **Residential** (low/medium/high density — density unlocked by population thresholds)
- **Commercial**
- **Industrial**

Zoned tiles auto-develop buildings over time based on demand. Demand is driven by population, jobs, and commercial supply — keep this simulation transparent and visible in a Demand HUD bar (like Cities: Skylines RCI).

### 3. City-Owned Buildings (placed individually)
A small starting set:
- Road (multiple types: small road, avenue, one-way)
- Power plant (one type for now — coal — and that's it; do NOT build out an elaborate power grid system)
- Water tower
- Park
- Bus stop + bus depot
- City hall (starting building)

Power and water should be **simple radius checks**, not pipe/wire networks. Buildings within range of a power plant + water tower function. That's it. No micromanaging substations.

### 4. Traffic & Transit (priority)
This is where simulation depth lives. Get this right.
- Cars spawn from residential zones, route to commercial/industrial via roads using A* pathfinding on the road graph.
- Visible vehicles on roads (sprite-based, batched).
- Congestion model: roads have capacity; over-capacity slows traffic and triggers "traffic" complaints from citizens.
- Bus lines: player can draw a route between bus stops; buses reduce car volume on overlapping routes.
- Show a **traffic heatmap overlay** as a toggle.

### 5. Economy (priority)
- City budget: tax revenue (residential, commercial, industrial — adjustable rates) minus expenses (road maintenance, services).
- Going broke is a fail state but recoverable (loans available, no game over for prototype).
- Show a clean budget panel: monthly income/expenses, treasury, tax sliders.
- Avoid spreadsheet hell — surface only what's actionable.

### 6. Citizens (lightweight for prototype)
- Aggregate population, not individual citizen agents (that's a v2 feature).
- Track aggregated happiness, employment, education level.
- Citizens leave the city if happiness drops too low.

### 7. UI / HUD
- Bottom toolbar: zoning tools, road tool, building catalog, bulldoze.
- Top bar: date, treasury, population, demand bars (RCI).
- Side panel (slides out): budget, statistics, overlays toggle.
- All buttons sized for **fingertips** (minimum 44×44pt), with generous spacing.
- One-handed playability is a goal — keep critical controls reachable from the bottom of the screen.

## Project Structure

```
city-builder/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/
│   └── assets/
│       ├── tiles/      (placeholder isometric tile sprites — generate simple colored ones for now)
│       └── buildings/  (placeholder building sprites)
├── src/
│   ├── main.ts          (entry point, PixiJS app bootstrap)
│   ├── engine/
│   │   ├── Game.ts      (main game loop, ticks)
│   │   ├── Camera.ts    (pan/zoom)
│   │   ├── Input.ts     (touch + gesture handling)
│   │   └── Renderer.ts  (isometric projection, sprite batching)
│   ├── world/
│   │   ├── Grid.ts      (tile data structure)
│   │   ├── Tile.ts
│   │   └── MapGenerator.ts
│   ├── simulation/
│   │   ├── Zoning.ts
│   │   ├── Traffic.ts
│   │   ├── Pathfinding.ts (A* on road graph)
│   │   ├── Economy.ts
│   │   ├── Demand.ts      (RCI calculation)
│   │   └── Population.ts
│   ├── ui/
│   │   ├── HUD.ts         (vanilla DOM overlay)
│   │   ├── Toolbar.ts
│   │   └── Panels.ts
│   ├── persistence/
│   │   └── SaveGame.ts    (IndexedDB)
│   └── types.ts
└── README.md
```

## Build Order (do these in sequence — get each working before moving on)

1. **Bootstrap:** Vite + TS + PixiJS, render a single isometric tile.
2. **Grid:** Render a 64×64 isometric grid with placeholder tile colors. Implement camera pan + pinch zoom on touch.
3. **Tile selection:** Tap a tile, highlight it. Long-press shows tile info.
4. **Roads:** Drag-to-place road tool. Roads connect to form a graph.
5. **Zoning:** Drag-paint R/C/I zones on tiles adjacent to roads.
6. **Building spawning:** Zoned tiles develop buildings over time (placeholder sprites scaled by density).
7. **Population & demand:** Buildings spawn population. Show RCI demand bars.
8. **Vehicles:** Spawn cars that path from residential to commercial/industrial along the road graph using A*.
9. **Economy:** Tax sliders, monthly budget tick, treasury display.
10. **City buildings:** Place power plant, water tower, etc. Implement radius-based service coverage.
11. **Traffic congestion:** Road capacity, slowdowns, heatmap overlay.
12. **Bus system:** Stops, route drawing, bus pathing.
13. **Save/load:** IndexedDB persistence.
14. **Performance pass:** Profile on a real mid-range phone. Optimize sprite batching, simulation tick rate, off-screen culling.

## Performance Budget (non-negotiable)

- 60fps on a Pixel 7 / iPhone 13 with a fully developed Medium map.
- 30fps minimum on a 2021 mid-range Android with a Small map.
- Simulation tick decoupled from render tick — sim runs at ~10Hz, rendering at 60Hz.
- Use spatial hashing for proximity queries (service coverage, traffic).
- Sprite atlas everything; never load individual PNGs at runtime.

## Code Quality Standards

- TypeScript strict mode on. No `any` without justification.
- Each simulation system in its own module with a clean interface.
- Game state should be serializable (for save games) — no circular references, no functions stored in state.
- Comments explain *why*, not *what*.
- One class per file, generally.

## What to Deliver

1. A running Vite dev server I can open on my phone over LAN.
2. A README with setup instructions and current feature status.
3. Clean commit history — one commit per build-order step, ideally.
4. After each step, briefly tell me what to test on my phone before moving to the next step.

## Start Here

Begin with **Step 1 (Bootstrap)** and **Step 2 (Grid + camera)**. Do not skip ahead. After Step 2 works, stop and let me test it on my phone. Then we'll proceed.

Use placeholder art throughout — colored geometric tiles and simple building shapes are fine. Polish comes after the simulation is fun.
