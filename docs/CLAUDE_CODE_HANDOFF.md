# Handing this project off to Claude Code

This folder lives in iCloud Drive at:

```
~/Library/Mobile Documents/com~apple~CloudDocs/Documents/City Builder Parent Folder/Mobile City Builder - Latest Version
```

It's ready to open with Claude Code as-is.

## Current state at handoff

**Alpha 3.2.4** is the latest shipped version on `main` (commit `c3234fb`,
live at https://JadenH5231.github.io/mobile-city-builder/).

The project is a **feature-complete** premium mobile city-builder
prototype. The original 14-step build order (see `docs/SPEC.md`) was
completed at Alpha 1.0. Since then, eight major releases have shipped:

- **Alpha 1.5** — Happiness & Factions keystone, yearly elections, council, Political Capital + civic actions.
- **Alpha 1.6** — pedestrians, walking paths, sidewalks.
- **Alpha 2.0** — mixed-use zoning, adaptive traffic lights, sidewalk-side bus stops, photo mode, sim-speed pill.
- **Alpha 2.1–2.6** — visual polish (36-variant building kit, facade detail, three tree silhouettes, road striping, modular parks, sky gradient, tree shadows, council ban visualisation).
- **Alpha 2.7–2.22** — depth + content (forestry/farms, milestones, events, public services, stats, bridges, achievements, patina, tourism/landmarks, bonds/surtax, ferries/subway, save slots, crime, districts).
- **Alpha 3.0** — feature-complete prototype.
- **Alpha 3.1.x** — skyscrapers (2×2 footprint, 4-stage build), translucency on zoom, lit night windows, services rework, more building variants, 8 park variations.
- **Alpha 3.2.x** — humanoid pedestrians, grid expansion (`+` buttons grow the world past the starter region), settings cheats, walking animation.

Save schema is now **v18** (skyscrapers added in 3.1.2). Backwards-compat
is preserved across the v12 minimum-loadable threshold. Build is
~805 KB raw / ~215 KB gzipped.

> ⚠️ **Recent reverted attempt**: Alpha 3.2.5 (a Max density tier where
> a cluster of L4 tiles grows into Mega → Twin → triggers skyscraper
> construction) was implemented and shipped as PR #63 but **reverted in
> PR #64 (commit `c3234fb`)** after a freeze report. The Max-tier work
> is preserved on branch `claude/max-density`. See the **"Failed
> attempt: Alpha 3.2.5"** section in `CLAUDE.md` for the root-cause
> hypothesis and re-roll plan before attempting it again.

## What to ask Claude Code first

```
Read CLAUDE.md and docs/PROGRESS.md. We're at Alpha 3.2.4. Tell me
what you understand about the current state of the project, what was
attempted in 3.2.5 and why it was reverted, and what the next reasonable
step would be.
```

Claude Code automatically loads `CLAUDE.md` on start, so it'll have the
full project context, conventions, anti-goals, and the failed-3.2.5 root
cause notes already in mind.

## One-time setup on your computer

Install Node 20+ if you don't have it: https://nodejs.org

Install Claude Code if you haven't:

```sh
npm install -g @anthropic-ai/claude-code
```

## iCloud caveat — important

iCloud's "Optimize Mac Storage" can evict files (you'll see ☁️ icons
in Finder), and that breaks `tsc --noEmit` (it hangs at 0% CPU on
file-system reads while iCloud fetches `.d.ts` files one at a time —
the 538-file `node_modules/@types/three/src/` tree is the worst
offender).

**Two ways to deal with it:**

1. **Toggle Optimize Mac Storage off** (System Settings → Apple ID →
   iCloud → iCloud Drive → uncheck "Optimize Mac Storage"). Lets the
   files stay materialized so tsc runs at normal speed.

2. **Move the project out of iCloud:**
   ```sh
   cp -R ~/Library/Mobile\ Documents/com~apple~CloudDocs/Documents/City\ Builder\ Parent\ Folder/Mobile\ City\ Builder\ -\ Latest\ Version ~/Projects/city-builder
   cd ~/Projects/city-builder
   ```

If you stay in iCloud, working from inside the folder directly is fine:

```sh
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/Documents/City\ Builder\ Parent\ Folder/Mobile\ City\ Builder\ -\ Latest\ Version
```

## Install dependencies

```sh
npm install
```

This creates `node_modules/`. The `.gitignore` already excludes it.

## Open in Claude Code

From inside the project folder:

```sh
claude
```

## Phone testing while using Claude Code

In a separate terminal (so Claude Code keeps running), start the dev
server:

```sh
npm run dev
```

Vite prints a Local and Network URL. Open the **Network** URL on your
phone (same Wi-Fi). Vite hot-reloads on file changes, so as Claude Code
edits files your phone view updates automatically.

You can also play the deployed version directly at
https://JadenH5231.github.io/mobile-city-builder/.

## Tips for working with Claude Code on this project

- **CLAUDE.md is the source of truth.** It's auto-loaded on session
  start. If something the assistant suggests conflicts with CLAUDE.md
  (e.g. adds a stamina bar, monetisation, timer mechanic), surface
  the conflict before it ships.
- **Keep docs in sync per the "Keep documentation in sync with code"
  rule in CLAUDE.md.** Every material change should also update the
  relevant doc (CLAUDE.md / docs/SPEC.md / docs/PROGRESS.md / README.md)
  in the same commit. Stale docs across iCloud-synced machines waste
  the next session's time figuring out what's real.
- **Test on actual phone after every shipped PR.** Headless Chrome
  perf metrics aren't always representative of mobile reality —
  Alpha 3.2.5 was reverted exactly because of this gap (passed all
  Chrome checks, froze on the user's phone).
- **Branch off `origin/main` per task, ship as PR, squash-merge.** The
  GitHub Actions workflow auto-deploys `main` to GitHub Pages.

## Build commands

```sh
npm run dev         # Vite dev server, LAN-exposed on 0.0.0.0:5173
npm run typecheck   # tsc --noEmit
npm run build       # type-check + production build → dist/
npm run preview     # serve dist/ locally
```

## Files Claude Code reads on startup

- **`CLAUDE.md`** — project context, conventions, anti-goals, current
  status with the 3.2.5 revert notes. Auto-loaded on session start.
- **`docs/SPEC.md`** — canonical product spec. Read on non-trivial work.
- **`docs/PROGRESS.md`** — chronological release log + per-step status
  table. Updated after every shipped PR.
- **`README.md`** — phone-LAN setup, scripts, feature-status table.

You're ready to go.
