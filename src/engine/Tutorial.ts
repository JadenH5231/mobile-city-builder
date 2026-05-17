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
  // Steps 1-5 use ONLY tools available in STARTING_TOOLS (types.ts).
  // Power / water / avenue / stop sign all unlock at Village (200 pop)
  // and the tutorial reaches them via the Village milestone in step 6.
  {
    title: 'Paint your first road',
    hint:
      'Tap the Roads tool, pick Local, then drag on grass. Diagonals work — try a curve.',
    check: (g) => g.grid.roadEdgeCount > 0
  },
  {
    title: 'Zone next to that road',
    hint:
      'Pick R Zoning (low density) and drag on grass that touches a road. Buildings will sprout in a few seconds.',
    check: (g) => anyTileWithZone(g, 'residential')
  },
  {
    title: 'Add a Park',
    hint:
      'Tap the Park tool, drop one inside your neighborhood. Parks lift the mood + help your zones grow.',
    check: (g) => anyBuilding(g, 'park')
  },
  {
    title: 'Meet the factions',
    hint:
      'Tap the Population pill at the top. Ten factions watch every move you make — see their mood here.',
    check: (g) => g.happinessPanelOpenedOnce
  },
  {
    title: 'Open the Budget',
    hint:
      'Tap the $ Treasury pill. R/C/I tax sliders drive both your income AND demand — find the sweet spot.',
    check: (g) => g.budgetPanelOpenedOnce
  },
  {
    title: 'Grow to 200 residents',
    hint:
      'Paint more roads + R zones until population hits 200. At 200 you reach Village — unlocking power, water, avenues, and stop signs.',
    check: (g) => g.population.totalResidents >= 200
  },
  {
    title: 'Place a Power Plant',
    hint:
      'Services → Power (just unlocked). Tap a free grass tile. Power lifts your density cap above Low.',
    check: (g) => anyBuilding(g, 'power_plant')
  },
  {
    title: 'Place a Water Tower',
    hint:
      'Services → Water. Power + Water + a Park nearby together unlock Medium density on your zones.',
    check: (g) => anyBuilding(g, 'water_tower')
  },
  {
    title: 'Build a real city',
    hint:
      'You know the loop. Mix in commercial near roads, add bus stops, hit milestones to unlock more.',
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
