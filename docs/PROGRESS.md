# Build progress

Update this file every time you complete (or partially complete) a build-order step. Keep it tight; long discussion belongs in commit messages or `docs/NOTES.md`.

## Status

| Step | Feature | Status | Notes |
| --- | --- | --- | --- |
| 1 | Vite + TS + PixiJS bootstrap | ✅ | Pixi v8 `Application.init()` async pattern. Resolution capped at 2× DPR. |
| 2 | 64×64 iso grid, pan + pinch zoom | ✅ | Whole grid drawn into a single `Graphics`. Camera anchors zoom on the gesture midpoint. |
| 3 | Tile selection (tap / long-press) | ⬜ | Next up. |
| 4 | Roads | ⬜ | |
| 5 | Zoning (R/C/I) | ⬜ | |
| 6 | Building spawning | ⬜ | |
| 7 | Population & demand (RCI) | ⬜ | |
| 8 | Vehicles + A* pathfinding | ⬜ | |
| 9 | Economy + tax sliders | ⬜ | |
| 10 | City buildings (radius services) | ⬜ | |
| 11 | Traffic congestion + heatmap | ⬜ | |
| 12 | Bus system | ⬜ | |
| 13 | Save/load (IndexedDB) | ⬜ | |
| 14 | Performance pass | ⬜ | |

## What's implemented

### Step 1 — Bootstrap
- `package.json` with `pixi.js@^8.2.0`, `vite@^5.2.11`, `typescript@^5.4.5`.
- TS strict mode, ES2022 target, bundler module resolution.
- Vite bound to `0.0.0.0:5173` for LAN phone testing.
- `index.html` with mobile-friendly viewport (no zoom, safe-area insets, theme color).
- Global CSS locks page scroll (`overflow:hidden`, `overscroll-behavior:none`, `touch-action:none`).
- `src/main.ts` does top-level `await game.init(...)`.

### Step 2 — Grid + camera
- `src/types.ts` defines `TILE_WIDTH = 64`, `TILE_HEIGHT = 32`, `MAP_SIZES`.
- `src/world/Grid.ts` generates a deterministic placeholder map: ~6% forest, rest grass.
- `src/engine/Renderer.ts` projects grid coords to iso world space via `(gx-gy)*hw, (gx+gy)*hh` and bakes all tile diamonds into a single `Graphics`. Per-terrain palette.
- `src/engine/Camera.ts` exposes `panBy`, `zoomAt`, `screenToWorld`. `zoomAt(factor, sx, sy)` keeps the world point under `(sx, sy)` fixed — required for pinch to feel right.
- `src/engine/Input.ts` uses Pointer Events. 1 pointer = pan; 2 pointers = pinch + two-finger pan; wheel = zoom (desktop). Pointer capture handles fingers drifting off-canvas.
- `src/engine/Game.ts` wires everything: creates `Application`, mounts canvas, fits camera to grid, ticks `applyCamera` each frame.
- HUD has a live FPS pill (sampled at 500ms).

## Known issues / things to watch

- Single `Graphics` for the whole grid is fine for Small (4 096 tiles) and Medium (16 384) but will hit a wall on Large (65 536). Plan: chunked `RenderTexture`s during Step 14's perf pass.
- No off-screen culling yet. Pixi's batched Graphics largely makes this a non-issue at current sizes.
- Camera position is in screen-space, so on viewport resize the camera doesn't auto-recenter. Acceptable for now.
- iOS Safari URL bar can shift `window.innerHeight` mid-session; `resizeTo: window` handles the canvas, camera stays where the user left it.

## Up next (Step 3 — Tile selection)

Required pieces:
1. **Inverse iso projection** — given a screen-space point and the camera transform, return the grid `(x, y)` of the tile under it. Add `Renderer.worldToGrid()` or similar.
2. **Selection layer** — a separate `Graphics` above the tile layer for the highlight outline. Avoid redrawing the tile layer.
3. **Tap vs drag detection** — in `Input`, distinguish a tap (pointer down → up within ~250ms and < ~10px movement) from a pan. Emit a `tap` event with screen coords.
4. **Long-press** — pointer held > ~500ms with < ~10px movement. Cancel on motion. Emit `longpress` event.
5. **Tile info panel** — vanilla DOM, slides up from the bottom on mobile, dismissible. Shows `terrain` and `(x, y)` for now (more fields appear in later steps).

Acceptance test: tap any tile and a yellow diamond outline appears on it. Long-press the same tile and an info panel slides up showing the terrain type and coordinates.
