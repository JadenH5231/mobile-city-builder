# Project context for Claude Code

You are working on a **premium mobile-first 2.5D isometric city-builder prototype**. This file is the canonical context — read it first every session.

## What this project is

A browser-based isometric city builder that plays like a premium Steam title (Cities: Skylines / classic SimCity) but is mobile-first. Single-purchase premium game model — **no monetization, no timers, no energy systems, no paywalls**. The prototype's job is to prove the core loop is fun.

The full product spec lives at [`docs/SPEC.md`](docs/SPEC.md). **Always read SPEC.md before starting non-trivial work** — it has the build order, performance budget, anti-goals, and project structure. Do not deviate from it without checking with the user.

Current progress lives at [`docs/PROGRESS.md`](docs/PROGRESS.md). Update it after completing each build step.

## Anti-goals (what this game is NOT)

- No microtransactions, IAPs, or premium currency
- No "wait 4 hours for your factory" timers
- No energy/stamina systems gating play
- No artificial complexity (e.g. elaborate power grids that exist purely to be a chore)
- No tap-to-build individual houses — use **zoning**, like Cities: Skylines

## Tech stack (locked)

- **Renderer:** PixiJS v8 (WebGL2)
- **Language:** TypeScript, strict mode
- **Build:** Vite 5
- **Touch input:** Custom Pointer Events handler (no Hammer.js needed for the gestures we're doing)
- **Persistence:** IndexedDB via `idb` (added in Step 13)
- **State:** Plain TS classes / lightweight ECS. **No React, no heavy frameworks.** UI overlay is vanilla DOM/CSS.

No backend. Fully client-side. Should work offline once loaded.

## Build order (do these in sequence, do not skip)

1. ✅ **Bootstrap:** Vite + TS + PixiJS, render a single isometric tile
2. ✅ **Grid:** Render a 64×64 isometric grid with placeholder tile colors. Camera pan + pinch zoom
3. ⬜ **Tile selection:** Tap a tile, highlight it. Long-press shows tile info
4. ⬜ **Roads:** Drag-to-place road tool. Roads connect to form a graph
5. ⬜ **Zoning:** Drag-paint R/C/I zones on tiles adjacent to roads
6. ⬜ **Building spawning:** Zoned tiles develop buildings over time
7. ⬜ **Population & demand:** Buildings spawn population. RCI demand bars
8. ⬜ **Vehicles:** Cars path from R to C/I along road graph using A*
9. ⬜ **Economy:** Tax sliders, monthly budget tick, treasury
10. ⬜ **City buildings:** Power plant, water tower, etc. Radius-based service coverage
11. ⬜ **Traffic congestion:** Road capacity, slowdowns, heatmap overlay
12. ⬜ **Bus system:** Stops, route drawing, bus pathing
13. ⬜ **Save/load:** IndexedDB persistence
14. ⬜ **Performance pass:** Profile on a real mid-range phone

After each step, **stop** and tell the user what to test on their phone before moving on. Do not chain steps without confirmation.

## Performance budget (non-negotiable)

- 60fps on Pixel 7 / iPhone 13 with a fully developed Medium map
- 30fps minimum on a 2021 mid-range Android with a Small map
- Simulation tick decoupled from render tick — sim at ~10Hz, rendering at 60Hz
- Spatial hashing for proximity queries
- Sprite atlas everything; never load individual PNGs at runtime

## Code conventions

- TypeScript strict mode is on. **No `any` without a justifying comment.**
- One class per file (with rare exceptions like internal helpers).
- Each simulation system in its own module with a clean interface.
- Game state must be **serializable** — no circular references, no functions stored in state. Save games depend on this.
- Comments explain *why*, not *what*.
- Existing code uses Pointer Events (not Touch Events) and PixiJS v8's new Graphics API (`g.poly().fill().stroke()`). Match the established style.
- Module layout follows the spec exactly: `engine/`, `world/`, `simulation/`, `ui/`, `persistence/`. Don't restructure.

## Project structure

```
src/
  main.ts             entry point + FPS counter
  styles.css          global CSS (HUD pills, body lock)
  types.ts            shared constants + types
  engine/
    Game.ts           bootstraps Pixi App + wires systems
    Camera.ts         pan/zoom math (zoomAt anchors on screen point)
    Input.ts          pointer-events gesture handler
    Renderer.ts       iso grid drawing
  world/
    Grid.ts           tile container + placeholder generator
    Tile.ts           single-tile struct
```

`simulation/`, `ui/`, `persistence/` will be added in later steps as the spec dictates.

## How to run

```sh
npm install
npm run dev          # binds to 0.0.0.0, exposes a Network URL for phone testing
npm run typecheck    # tsc --noEmit
npm run build        # type-check + production build → dist/
```

## Working style for this project

- **Read `docs/SPEC.md` and `docs/PROGRESS.md` at the start of any non-trivial task.**
- Keep commits scoped to a single build-order step where possible.
- After implementing a step, write a short "what to test on your phone" note for the user and **wait** for them to confirm before starting the next step.
- Update `docs/PROGRESS.md` to flip a step from ⬜ to ✅ when it's done.
- If the user asks for something that conflicts with the spec or anti-goals (e.g. "add a stamina bar"), surface the conflict and ask before doing it.
- Placeholder art is fine throughout. Polish comes after the simulation is fun.

## What's already built (Steps 1–2)

Render a 64×64 iso diamond grid (mostly grass, sprinkled forest tiles). Camera centers and fits the map on load. One-finger drag pans; two-finger pinch zooms anchored on the gesture midpoint. Mouse wheel zoom on desktop. FPS counter pill in the top-right.

The grid is drawn into a single batched `Graphics` object — fine through Medium maps. Step 14's perf pass is when we'll likely refactor to chunked `RenderTexture`s for the Large map.

## Next up

**Step 3 — Tile selection.** Tap a tile to highlight it. Long-press shows a tile info panel. Need to:
- Inverse iso projection: screen → grid coordinates (account for camera transform)
- Selection overlay (separate Graphics layer above the tile layer)
- Long-press detection (~500ms, no significant pointer movement)
- A simple info panel UI — vanilla DOM, slides up from bottom on mobile
