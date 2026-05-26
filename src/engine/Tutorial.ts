import type { Game } from './Game';

/**
 * Tutorial (Alpha 4.10). Play-as-you-learn guided onboarding that runs
 * over a fresh slot. Replaces the old read-cards Welcome modal.
 *
 * A linear list of steps; each one has an objective string and a
 * `check(game)` predicate. Tutorial advances when the predicate flips
 * true on a sim/render tick. Skip + Restart are first-class — the
 * player can dismiss the banner at any time or re-launch the whole
 * sequence from Settings.
 *
 * Persistence lives in localStorage:
 *   `mq-tutorial-state` → { phase, step, completedAt? }
 * - phase `'prompt'` means we haven't yet asked the player whether to
 *   start the tutorial (first launch, fresh install).
 * - phase `'active'` means we're currently running it.
 * - phase `'skipped'` / `'completed'` are terminal until the player
 *   restarts it from Settings.
 *
 * The check predicates are deliberately fuzzy — "any road exists"
 * rather than "this exact tile is paved" — so the player can build
 * however they like and still progress. We're teaching the loop, not
 * a specific layout.
 */
export interface TutorialStep {
  /** Short title for the banner. */
  readonly title: string;
  /** One-sentence objective shown under the title. */
  readonly hint: string;
  /** True once the player has satisfied this step. */
  check(game: Game): boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // Beta 1.6.28 rewrite: hints reference only the tools the player can
  // currently see (other tools are visually locked while tutorial
  // active — see Game.isTutorialActive gating). Milestone celebrations
  // and elections are suppressed during the tutorial so surprise
  // unlocks + popups don't crowd the screen mid-step. Each step's
  // predicate is fuzzy on purpose — "any road exists" — so the player
  // builds however they want and still progresses.
  {
    title: 'Paint your first road',
    hint:
      'Open the Roads group, tap Local, then drag on grass. Diagonals work — try a curve.',
    check: (g) => g.grid.roadEdgeCount > 0
  },
  {
    title: 'Zone next to your road',
    hint:
      'Pick R Low (residential) and drag on grass touching the road. Small homes will sprout in a few seconds.',
    check: (g) => anyTileWithZone(g, 'residential')
  },
  {
    title: 'Drop a Park nearby',
    hint:
      'Tap the Park tool, place one within 4 tiles of your homes — parks broadcast their mood boost in a radius, no path required.',
    check: (g) => anyBuilding(g, 'park')
  },
  {
    title: 'Meet your factions',
    hint:
      'Tap the Population pill at the top. Ten factions watch every move you make — their mood drives everything from voting to growth.',
    check: (g) => g.happinessPanelOpenedOnce
  },
  {
    title: 'Check the Treasury',
    hint:
      'Tap the $ pill. Watch your cash — services and roads cost money up-front. The tax sliders drive both income AND demand.',
    check: (g) => g.budgetPanelOpenedOnce
  },
  {
    title: 'Grow to 200 residents',
    hint:
      'Keep paving + R-zoning. Watch the Pop pill climb. Hitting 200 reaches Village — unlocks Power, Water, Avenues, Stop signs.',
    check: (g) => g.population.totalResidents >= 200
  },
  {
    title: 'Place a Power Plant',
    hint:
      'Open Services → Power. Glance at $ before tapping — it costs a chunk of your treasury. Drop it on grass; coverage is city-wide.',
    check: (g) => anyBuilding(g, 'power_plant')
  },
  {
    title: 'Place a Water Tower',
    hint:
      'Services → Water. Power + Water + a Park together unlock Medium density. Your homes can now grow taller.',
    check: (g) => anyBuilding(g, 'water_tower')
  },
  {
    title: "You're ready — build a city",
    hint:
      'Tutorial complete. Now mix in C zones along roads, add bus stops, paint Avenues for higher capacity, watch the milestones unlock more tools.',
    // Last step never auto-completes — player taps Got It to finish.
    check: () => false
  }
];

type TutorialPhase = 'prompt' | 'active' | 'skipped' | 'completed';
interface TutorialState {
  phase: TutorialPhase;
  step: number;
  completedAt?: number;
}
const STORAGE_KEY = 'mq-tutorial-state';

export class Tutorial {
  private state: TutorialState = { phase: 'prompt', step: 0 };
  /** Subscribers refreshed when phase or step changes — main.ts re-renders. */
  private listeners: Array<() => void> = [];

  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<TutorialState>;
      if (parsed.phase === 'prompt' || parsed.phase === 'active'
          || parsed.phase === 'skipped' || parsed.phase === 'completed') {
        this.state.phase = parsed.phase;
      }
      if (typeof parsed.step === 'number' && Number.isFinite(parsed.step)) {
        this.state.step = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, parsed.step | 0));
      }
      if (typeof parsed.completedAt === 'number') {
        this.state.completedAt = parsed.completedAt;
      }
    } catch {
      // private mode / parse failure — keep defaults.
    }
  }
  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch { /* private mode */ }
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }
  private notify(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* swallow */ }
    }
  }

  get phase(): TutorialPhase { return this.state.phase; }
  get stepIndex(): number { return this.state.step; }
  get currentStep(): TutorialStep | undefined { return TUTORIAL_STEPS[this.state.step]; }
  get totalSteps(): number { return TUTORIAL_STEPS.length; }

  /** Player accepted the "want a guided playthrough?" prompt. */
  start(): void {
    this.state.phase = 'active';
    this.state.step = 0;
    this.persist();
    this.notify();
  }
  /** Player declined the prompt or skipped mid-tutorial. */
  skip(): void {
    this.state.phase = 'skipped';
    this.persist();
    this.notify();
  }
  /** Re-launch from Settings. */
  restart(): void {
    this.state.phase = 'active';
    this.state.step = 0;
    this.state.completedAt = undefined;
    this.persist();
    this.notify();
  }
  /** Final step — player tapped "Got it." */
  finish(): void {
    this.state.phase = 'completed';
    this.state.completedAt = Date.now();
    this.persist();
    this.notify();
  }
  /** Advance one step on the user's request (the banner's "Skip step" button
   *  surfaces this for steps the player has already done off-tutorial). */
  advance(): void {
    if (this.state.phase !== 'active') return;
    if (this.state.step >= TUTORIAL_STEPS.length - 1) {
      this.finish();
      return;
    }
    this.state.step += 1;
    this.persist();
    this.notify();
  }

  /** Called from the game's tick loop. Cheap: just runs the current step's
   *  predicate against `game` and advances if true. */
  tick(game: Game): void {
    if (this.state.phase !== 'active') return;
    const step = this.currentStep;
    if (!step) return;
    if (step.check(game)) this.advance();
  }
}

function anyTileWithZone(game: Game, zone: 'residential' | 'commercial' | 'industrial' | 'mixed'): boolean {
  const g = game.grid;
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const t = g.get(x, y);
      if (t && t.zone === zone) return true;
    }
  }
  return false;
}

function anyBuilding(game: Game, kind: string): boolean {
  const g = game.grid;
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const t = g.get(x, y);
      if (t && t.building === kind) return true;
    }
  }
  return false;
}
