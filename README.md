# City Builder — prototype

Premium mobile-first 2.5D isometric city builder. PixiJS v8 + TypeScript + Vite. No backend; runs entirely in the browser.

This repo is being built incrementally per a fixed build order. **You are currently at the end of Step 2.**

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
| 1 | Vite + TS + PixiJS bootstrap | ✅ |
| 2 | 64×64 iso grid, pan + pinch zoom | ✅ |
| 3 | Tile selection (tap / long-press) | ⬜ |
| 4 | Roads | ⬜ |
| 5 | Zoning (R/C/I) | ⬜ |
| 6 | Building spawning | ⬜ |
| 7 | Population & demand (RCI) | ⬜ |
| 8 | Vehicles + A* pathfinding | ⬜ |
| 9 | Economy + tax sliders | ⬜ |
| 10 | City buildings (radius services) | ⬜ |
| 11 | Traffic congestion + heatmap | ⬜ |
| 12 | Bus system | ⬜ |
| 13 | Save/load (IndexedDB) | ⬜ |
| 14 | Performance pass | ⬜ |

## Test on your phone (after Step 2)

Open the Network URL on your phone and check:

1. The screen shows a green isometric diamond grid centered in view, with a few darker forest tiles sprinkled in.
2. **One-finger drag** pans the map smoothly.
3. **Pinch with two fingers** zooms in/out, and the zoom is anchored on the spot between your fingers (the world point under your fingers shouldn't drift).
4. The FPS pill in the top-right shows ~60.
5. There's no page scroll, no rubber-banding, no double-tap zoom of the page itself.
6. Rotating the phone (or resizing on desktop) keeps the map visible.

If anything's off — jitter, slow zoom, accidental page scroll on iOS, sub-60fps — tell me what device + OS version and I'll fix it before we move on.

## Project structure

```
src/
  main.ts             entry point
  styles.css          global CSS (HUD pills, body lock)
  types.ts            shared constants + types
  engine/
    Game.ts           bootstraps Pixi App + wires systems
    Camera.ts         pan/zoom math
    Input.ts          pointer-events gesture handler
    Renderer.ts       iso grid drawing
  world/
    Grid.ts           tile container + placeholder generator
    Tile.ts           single-tile struct
```

(`simulation/`, `ui/`, `persistence/` folders will appear in later steps.)

## Tech notes

- **PixiJS v8** for WebGL2 batched rendering. We draw the whole grid into one `Graphics` object (one draw call) for now; we'll switch to chunked `RenderTexture`s when the largest map sizes need it.
- **Pointer Events**, not Touch Events. Same code path covers mouse, pen, and touch. Pointer capture handles the case where a finger drifts off the canvas mid-drag.
- `touch-action: none` on body + canvas to disable iOS double-tap zoom and Android pull-to-refresh during gameplay.
- Resolution capped at `2x` devicePixelRatio — past that you're paying for pixels nobody can see.
- TypeScript strict mode on. No `any` except one justified debug global.

## Scripts

```sh
npm run dev         # Vite dev server, LAN-exposed
npm run typecheck   # tsc --noEmit
npm run build       # type-check, then production build → dist/
npm run preview     # serve dist/ locally
```
