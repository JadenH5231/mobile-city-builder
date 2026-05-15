# MQ City Builder

Premium mobile-first low-poly 3D city builder. Three.js + TypeScript + Vite. **Optional** Supabase cloud-saves for cross-device sync (see [`docs/CLOUD_SETUP.md`](docs/CLOUD_SETUP.md)) — without it, runs entirely in the browser as before.

**Status: Beta 1.0** — live at https://mqcity.app. Save schema v27. Bundle ~980 KB raw / ~256 KB gzipped.

## Alpha 4.x highlights

### Architect Mode + Council Beautification Budget (4.0)
- **Toolbar mode toggle** — leading pinned pill cycles 🏗 Build ↔ 🎨 Architect. Build mode is the existing simulation toolbar; Architect mode is terraforming + decorative monuments (the late-game money sink). Pan + Bulldoze stay pinned in both modes.
- **Architect tools** — milestone-locked through Capital:
  - Terraforming (cheap paint): Tree $200/tile · Meadow $400 · Pond $1.5K · Smooth $50
  - Plazas: Plaza $5K · Pergola $6K · Reflecting Pool $20K · Pier $3K
  - Gardens: Flower Bed $2K · Topiary $8K · Memorial Garden $30K
  - Monuments: Statue $15K · Fountain $25K · Clock Tower $50K · Triumphal Arch $75K
- **Council Beautification Budget** — first lever where the council acts independently of the mayor. Each election picks a tier (None / Light $500/mo / Standard $2K / Grand $5K / Opulent $12K) based on the sum of councillors' beautification stances. Drives procedural streetscape flair on developed Commercial / Mixed-Use blocks: planters, café tables, decorative streetlamps, banners, public-art pedestals. Defunds to "none" for any month the treasury can't cover; renderer wipes the streetscape mesh city-wide when defunded.
- **Architectural night lights** (4.2.1) — every plaza / fountain / statue / clock tower / arch / memorial garden / pergola / mansion gets lit-overlay geometry that fades in at night, plus a glow halo disc so monuments read as beacons at mid-zoom.
- **Mayoral Override extends to Beautification** (4.2.2) — when Override is active, the mayor can directly pick the tier via a 5-pill picker in the budget panel.

### The Mayor's Mansion (4.2)
Single-instance 4×2 footprint showpiece — the most detailed build in the game. Capital-tier unlock, **$500K** up-front + $1.5K/mo upkeep. The mansion is part — the lavish formal estate grounds are the rest:
- 5-block mansion: 2 outer wings + 2 inner blocks + grand 3-storey central block with copper-green dome, spire, gold ball finial, pedimented portico with 6 columns + 4-piece classical pediment (4.2.2 cleanup), ~30 individually-shuttered windows, parapet balustrade, 4 chimneys, gold escutcheon, grand arched door
- Formal grounds: central flagstone driveway, 2 reflecting pools with bronze statues, 2 parterre gardens with hedge crosses + 4-quadrant flower dots + topiary cones, 3-step grand entrance, 2 wrought-iron lampposts, 2 ornamental urns, 2 ornamental trees in back corners, low limestone perimeter wall with gold-finial corner posts and gate opening
- ~140 BufferGeometry parts merged into one mesh. Bulldozing any of the 8 tiles tears down the whole showpiece (anchor pattern same as skyscrapers).

### Toolbar QoL for portrait phones (4.1)
- **21 → 13 top-level entries.** Loose Place tools consolidated into 3 new groups: **Services** (Power/Water/Park/School/Hospital/Fire/Police), **Industry** (Forestry/Farm), **Transit** (Bus Stop/Depot/Stop Sign/Traffic Light/Ferry/Subway).
- **Popover header + flex-wrap grid** — every popover opens with a small uppercase category label. Items tile cleanly into 4-then-3 wraps for big groups.
- **Viewport-clamped popovers** — `Toolbar.toggleGroup` measures rendered width and clamps the centre into the viewport so popovers near screen edges never spill off.
- **Narrow-viewport CSS** (`max-width: 480px`) — group pills go icon-only at 40px wide; the active group restores its label. **All 10 build groups + 3 pinned items fit in a single non-scrolling row** on a 390-420px portrait phone.
- **Full-word popover headers** (4.2.1) — R → "Residential", C → "Commercial", I → "Industrial", MU → "Mixed-Use", Mon → "Monuments" so icon-only pills still tell you what you opened.

### Curb-appeal pass (4.3 + 4.3.1)
- **Ground accents on every zoned tile** (commit `313b61e`) — per-zone ground pad (R green, C paved, I dirt, MU garden), front walkway, zone-specific accents (R shrubs/hedges, C planter boxes, I chain-link, MU bike racks).
- **Premium bus stops** (commit `313b61e`) — proper transit shelter: concrete pad, wooden bench on iron legs, tinted glass back + side panels, cantilevered canopy with yellow drip-edge, route placard, flag pole, trash bin.
- **Halved random-event frequency** (commit `313b61e`) — every per-month event roll halved (fires, outages, audits, recessions, booms, trade deals, lawsuits, referendums).
- **Buildings face the road** (commit `252c770`) — `computeRoadFacingYaw` orients every zoned building toward its nearest road. Preference: non-highway cardinal → any cardinal → diagonal quantised to nearest cardinal.
- **Service buildings rotate** (4.3) — school / hospital / fire station / police station / museum / bus stop / bus depot all rotate so their asymmetric front faces (clock tower, red cross, bay doors, porch, colonnade, bench/canopy, garage door) point at the nearest road. Each gets a paved walkway connecting front to road.
- **Luxury mansion walkway aims at the road** (4.3.1) — pair-aware `computeLuxuryRoadYaw` checks 4-adjacent tiles of both pair tiles.

### Vehicle + tree polish (4.4)
- **Cars + buses gain window + light sibling meshes** — sibling InstancedMeshes mirror each vehicle body's per-instance matrix every frame. Body keeps the per-instance colour tint; windows use a fixed dark blue, headlights a warm amber, taillights red. Buses get longer side-window strips and bigger front headlights.
- **Tree shadow discs extended to ALL trees** — forest tiles already had them since Alpha 2.6; now park-cluster trees and the Mayor's Mansion's ornamental trees also get the slim dark-green disc at the base. Park trees use a post-process pass that scans for trunk-coloured parts and injects shadows automatically.

## Save schema

Currently v21 (Mayor's Mansion bit added in 4.2). Backwards-compat with v12+. New `Building` enum values (plaza, fountain, statue, mayor_mansion, etc.) round-trip via the existing per-tile `building` field. Council Beautification Budget (elected + effective tier) persists per term.

> **Note**: Alpha 3.2.5 (Max density tier — cluster of L4 tiles → Mega → Twin → Skyscraper) was attempted but **reverted** after a freeze report. The work lives on branch `claude/max-density`. See `CLAUDE.md` for the root-cause hypothesis and re-roll plan.

## Alpha 3.x baseline

- **Skyscrapers** (3.1.2) — 2×2 footprint, 4-stage construction over 12 sim months, 18 visual variants across R/C/MU. Translucent on zoom-in (3.1.7). Lit windows at night (3.1.6).
- **Grid expansion** (3.2.3) — `+` buttons on each map edge grow the world by one starter region for $1M each. Genuine reallocation: tile array shifts, new strip gets fresh terrain.
- **Buy land** (3.1.3) — tap-to-buy individual unowned tiles for $5K to grow into the wilderness gradually.
- **Services rework** (3.1.4) — power + water are city-wide whenever any plant exists; park radius bumped 4 → 6 tiles.
- **Humanoid pedestrians** (3.2.2) with subtle walking animation (3.2.4).
- **Settings cheats** (3.2.4) — unlimited money / unlimited demand toggles for playtesting.
- **More-menu HUD popover** (3.1.1) keeps the primary HUD focused on Pop / RCI / Treasury / Undo / Speed.
- **8 park variations** (3.1.9), **5 building variants per (zone, density)** (3.0.x → 3.2.0).

**Alpha 3.0 feature-complete baseline** — the single autonomous build session that landed Alpha 3.0 added 16 PRs of systems + content on top of the Alpha 2.6 visual baseline:

- **Forestry + farms** (Alpha 2.7) export industries with oscillating global markets and connection-to-edge bonus.
- **Population milestones** (2.8) gate the toolbar — Hamlet → Capital with celebration banners and herald-voiced congratulations.
- **Random events + crisis modal** (2.9) — recessions, fires, lawsuits, referendums shift faction mood + market modifiers + demand. Severity-tinted, queueable.
- **Public services** (2.10) — schools, hospitals, fire stations, police stations with coverage radii.
- **Stats panel** (2.11) — 240-month canvas line graphs, no chart library.
- **Bridge mode** (2.12) — overpasses on a separate upper road layer + smooth ramp-down to ground (2.13.1).
- **Tile diagnostic** (2.13) — long-press info card explains every tile state.
- **Right-lane driving** (2.13.2) — cars + buses + walkers offset onto the right side of the road centreline.
- **Day/night cycle** (2.14) — 4-min real-time sun arc with sky gradient repaint.
- **Achievements** (2.15) — 28 lifetime, 🏆 panel + corner toast on unlock. **Leader bio popups** the first time each council member appears.
- **Building patina** (2.16) — buildings dim with age over a 15-year ramp.
- **Tourism + landmarks** (2.17) — museum / stadium / observatory generate monthly tourism revenue scaled by city pop.
- **Bonds + wealth surtax** (2.18) — 3 bond tiers with default penalty + a surtax slider on L3 / luxury.
- **Ferries + subway** (2.19) — boats sail between paired docks; subway entrances suppress car spawns within radius.
- **3 save slots** (2.20) — 🏙 picker pill, city naming, slot persisted in localStorage.
- **Crime + heatmap** (2.21) — per-tile crime score recomputed monthly, drives commercial revenue penalty + faction reactions.
- **Districts** (2.22) — paint districts, name / recolor them, set per-zone surtax sliders that stack on base R/C/I rates.

Save schema is now v18 (was v8 at Alpha 2.6, v17 at Alpha 3.0); skyscrapers added v18 in Alpha 3.1.2. v12+ saves load with sensible defaults for missing fields. Build size: 805 KB raw / 215 KB gzipped.

**Status: Alpha 2.6 (carryover)** — visual overhaul + perf pass. Bridges now have side rails and a yellow deck stripe; trees cast soft shadow discs; the toolbar shows banned-by-council tools struck-through with 🚫; place-tool taps on a budget-short treasury surface a "Not enough money — need $X,XXX" pill; the sky background is a real vertical gradient with stylized cloud clusters drifting above the world; commercial sidewalks scatter hydrants / parking meters / bike racks deterministically; and **modular parks** flood-fill: 1 tile renders a cottage park, 2 a community park with playground + pond, 3 a neighbourhood park with pavilion + fountain, 4+ a grand park with bandstand + ring paths. Renderer dropped precomputed normals on all flat-shaded meshes — pure CPU/GPU win, no visual change.

**Alpha 2.5** — luxury low-density residential. New `Lux` paint tool under the R popover places one grand mansion across a 2-tile pair (auto-finds an adjacent road-adjacent partner). Pays 2.5× the regular R tax rate, draws NIMBYs / hometown / taxpayers way over their natural share, costs $800 up-front. Save schema bumped to v8.

**Alpha 2.4.1** — disabled the rolling-hills visual via a `FLAT_TERRAIN` flag in `TerrainGenerator`. Lakes / rivers / forests / sand still generate normally, all elevation-aware renderer code stays put, but every tile renders flat. Flip the flag to re-enable.

**Alpha 2.4** — terrain-aware overlays. Roads, sidewalks, walking paths, zone overlays, the heatmap, all road furniture (stop signs, traffic lights, bus stops, highway arrows, crosswalks), and moving cars / buses / pedestrians ride per-tile elevation. Zoning on water tiles or on bridges is blocked at the grid level.

**Alpha 2.3** — natural terrain. Each fresh map gets procedural geography: lakes carved out of low-elevation pockets, a 70%-chance meandering river edge-to-edge, forest clusters on mid-elevation grass, sand at every shoreline. Painting a road across a water tile auto-bridges it. Save schema v7.

**Alpha 2.2** — second visual polish pass: every R / C / MU building now wears window bands and a ground-floor door or lit shopfront; trees come in three silhouettes (cone, layered pine, round oak); avenues have a solid double-yellow median; highways have white shoulder stripes; intersections show proper zebra crosswalks; the power plant grew a hyperboloid cooling tower with a vapour puff; the water tower has cross-bracing, a dome cap, and a drain pipe; bus depots got a marked apron with bay stripes and signage. Industrial stays windowless to keep the warehouse genre cue.

**Alpha 2.1** — visual polish pass. The placeholder colored boxes for buildings are gone; the city now renders **36 distinct building silhouettes** (3 variants per zone × density tier across R / C / I / Mixed-use × low / med / high). Parks have paths, ponds, benches, and three trees of varying sizes. Cars and buses got real chassis-plus-cabin silhouettes. A street of identical-density tiles now reads as a streetscape.

Below is the rolling Alpha 2.0 baseline:

**Alpha 2.0:** Big pedestrian/transit/traffic overhaul plus UX polish on top of Alpha 1.6. Highlights:

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
  main.ts                entry point, FPS counter, HUD wiring
  styles.css             HUD pills, toolbar, info panels, popovers
  types.ts               shared constants + enums (Tools, Buildings, milestones, tiers)
  engine/
    Game.ts              owns loop, paint logic, undo stack, all dispatch
    Camera.ts            3D ortho camera (panBy / zoomAt / screenToWorld)
    Input.ts             pointer-events gesture handler (navigate / paint modes)
    Renderer.ts          Three.js scene (terrain, roads, sidewalks, crosswalks, paths, trees, buildings, skyscrapers, vehicles + window/light overlays, pedestrians, traffic-lights, heatmap, beautification streetscape, architectural night lights)
    BuildingVariants.ts  per-(zone, density) variant catalogue + buildLuxuryParts (2-tile mansion) + buildSkyscraperParts (2×2) + buildMayorMansionParts (4×2 showpiece)
  world/
    Grid.ts              tile container + road-edge graph + bridge edges
    Tile.ts              single-tile struct (terrain, road, path, zone, density, services, luxury, skyscraper, mayorMansion, owned, …)
    TerrainGenerator.ts  noise-based lakes/rivers/forests/sand/elevation
  simulation/
    Population.ts        residents/jobs aggregation, RCI demand, per-faction shares
    Development.ts       demand-driven density growth, service gates
    RoadGraph.ts         car adjacency rebuilt on road changes
    PathGraph.ts         pedestrian adjacency: paths + non-highway road tiles
    Pathfinding.ts       A* over any PathfindGraph, reusable buffers
    Vehicles.ts          cars + park-then-return + path-coverage suppression
    Pedestrians.ts       walker spawn + motion on the pedestrian graph
    Buses.ts             per-depot buses + sidewalk pull-over dwell
    Ferries.ts           boat routes between paired docks (Alpha 2.19)
    TrafficLights.ts     adaptive 2-phase queue-aware signal controller
    Economy.ts           treasury, monthly settlement, tax demand penalty, beautification deduction
    Services.ts          radius-sweep coverage flags (city-wide power/water in 3.1.4+)
    Traffic.ts           per-tile EMA + city-wide stress
    Happiness.ts         10-faction mood + comments + Community Sentiment data
    Council.ts           yearly elections, cost multipliers, civic actions, Beautification Budget tier, Mayoral Override
    Milestones.ts        pop-threshold milestones + tool unlocks
    Events.ts            random events + crisis modal queue
    Stats.ts             240-month ring buffer (line graphs)
    GlobalMarket.ts      lumber + produce price oscillation + connection check
    Achievements.ts      28 lifetime achievements + leader-met set
    Bonds.ts             municipal bond catalog + active loan tracker
    Crime.ts             per-tile crime score + commercial revenue penalty
    Districts.ts         district registry + per-zone surtax
    Skyscrapers.ts       2×2 footprint, 12-month construction lifecycle
  ui/
    TileInfoPanel.ts     long-press info card with diagnostic chips
    BudgetPanel.ts       treasury + tax sliders + surtax + bonds + Beautification Budget readout/picker
    HappinessPanel.ts    Community Sentiment + Civic Actions (Endorse / Coalition / Override)
    CouncilPanel.ts      election-results modal
    EventModal.ts        queued severity-tinted event modal
    StatsPanel.ts        canvas line graphs
    AchievementsPanel.ts grid of badges
    LeaderBioModal.ts    one-time leader meet popup
    SlotPicker.ts        3-up save slot picker
    DistrictsPanel.ts    district registry editor
    PhotoOpBanner.ts     opportunistic photo-op banner
    Toolbar.ts           Build/Architect mode toggle + grouped popover toolbar
  persistence/
    SaveGame.ts          IndexedDB multi-slot auto-save (3 slots since Alpha 2.20)
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
