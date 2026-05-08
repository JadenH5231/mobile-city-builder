# Handing this project off to Claude Code

This folder lives in iCloud Drive at:

```
~/Library/Mobile Documents/com~apple~CloudDocs/Documents/City Builder Parent Folder/Mobile City Builder - Latest Version
```

It's ready to open with Claude Code as-is.

## One-time setup on your computer

Install Node 20+ if you don't have it: https://nodejs.org

Install Claude Code if you haven't:

```sh
npm install -g @anthropic-ai/claude-code
```

## Optional: move out of iCloud

iCloud sometimes evicts files (you'll see ☁️ icons in Finder) and that can confuse build tools when files aren't materialized. If you hit weird behavior, copy the project to a non-synced location:

```sh
cp -R ~/Library/Mobile\ Documents/com~apple~CloudDocs/Documents/City\ Builder\ Parent\ Folder/Mobile\ City\ Builder\ -\ Latest\ Version ~/Projects/city-builder
cd ~/Projects/city-builder
```

Otherwise just `cd` into the iCloud folder directly:

```sh
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/Documents/City\ Builder\ Parent\ Folder/Mobile\ City\ Builder\ -\ Latest\ Version
```

## Initialize git so Claude Code can commit per build-step

```sh
git init
git add -A
git commit -m "Steps 1-2: bootstrap + iso grid with camera"
```

## Install dependencies

```sh
npm install
```

This will create `node_modules/`. The `.gitignore` already excludes it.

## Open in Claude Code

From inside the project folder:

```sh
claude
```

Claude Code automatically reads `CLAUDE.md` from the project root, which contains the full project context, conventions, anti-goals, and current build state. You don't need to re-explain the project.

## First message to send Claude Code

Something like:

> Read CLAUDE.md and docs/PROGRESS.md. We're at the end of Step 2. I've tested the build on my phone — pan and pinch-zoom both work cleanly. Please proceed to Step 3 (tile selection: tap to highlight, long-press for tile info). Do not skip ahead to Step 4. After Step 3 works, stop and tell me what to test on my phone.

## Phone testing while using Claude Code

In a separate terminal (so Claude Code keeps running), start the dev server:

```sh
npm run dev
```

Vite prints a Local and Network URL. Open the **Network** URL on your phone (same Wi-Fi). Vite hot-reloads on file changes, so as Claude Code edits files your phone view updates automatically.

## Tips for working with Claude Code on this project

- **One step at a time.** The spec's build order is intentional — each step is independently testable. Don't ask Claude Code to "do steps 3 through 5" in one shot.
- **Test on the actual phone after every step.** Desktop browsers lie about touch. The whole point is mobile-first.
- **Commit per step.** `git commit -m "Step N: <feature>"` after each step makes it easy to roll back if something breaks.
- **Prod the spec when in doubt.** If Claude Code suggests something that smells like creep — extra complexity, gating mechanics, content beyond the prototype — point it at `docs/SPEC.md` and the anti-goals.
- **Keep PROGRESS.md current.** Ask Claude Code to update it at the end of each step. It becomes the running log of what's done and why.

## What's already in the box

- Working Steps 1 and 2 (Vite + TS + PixiJS, 64×64 iso grid, pan + pinch zoom, FPS counter)
- `CLAUDE.md` — project context Claude Code auto-reads
- `docs/SPEC.md` — canonical product spec, preserved verbatim
- `docs/PROGRESS.md` — current status with notes per completed step + plan for Step 3
- `README.md` — phone-LAN setup, scripts, project structure
- TypeScript strict mode, Vite dev server bound to `0.0.0.0` for LAN testing

You're ready to go.
