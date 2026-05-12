import type { Economy } from './Economy';
import type { Population } from './Population';
import type { Happiness, FactionId } from './Happiness';
import type { Council } from './Council';
import type { Grid } from '../world/Grid';
import type { Milestones } from './Milestones';

/**
 * Achievements (Alpha 2.15). Lifetime trackers for noteworthy milestones
 * outside the population unlock ladder — long-haul stuff like surviving
 * 20 years, paying off a million-dollar treasury, resolving 25 crises, or
 * keeping a city happy through 10 elections.
 *
 * Distinct from Milestones (which gate tools by population): Achievements
 * are pure flair + bragging rights, no game-mechanic consequences. They
 * persist across the save and unlock with a corner-toast + a dedicated
 * panel grid that shows progress.
 *
 * Design tenets:
 *  - One pure `evaluate(state)` step per monthly tick. No per-frame work.
 *  - Counters survive save/load (schema 13+).
 *  - Unlock condition is a closure over a precomputed Snapshot — lets the
 *    same eval handle "instant" checks (pop>X) and "trend" checks
 *    (treasury positive 12 months in a row) the same way.
 *  - Adding an achievement = one entry in ACHIEVEMENT_DEFS plus, if needed,
 *    one new counter on the AchievementsState.
 */

export type AchievementId =
  | 'first_steps'
  | 'town_hall'
  | 'big_city'
  | 'survivor_5y'
  | 'survivor_10y'
  | 'survivor_20y'
  | 'in_the_green'
  | 'treasury_tycoon'
  | 'civic_war_chest'
  | 'reelected'
  | 'career_politician'
  | 'people_person'
  | 'crisis_manager'
  | 'crisis_veteran'
  | 'builder'
  | 'megalopolis_builder'
  | 'roadworks'
  | 'walkable_city'
  | 'public_transit'
  | 'density_pioneer'
  | 'mixed_visionary'
  | 'service_to_all'
  | 'green_giant'
  | 'export_economy'
  | 'override_used'
  | 'big_tent'
  | 'cultural_capital'
  | 'tourist_trap'
  | 'bond_issuer'
  | 'debt_free'
  | 'multimodal'
  | 'underground'
  | 'safe_streets';

export interface Achievement {
  readonly id: AchievementId;
  readonly name: string;
  /** One-line player-facing description shown both locked + unlocked. */
  readonly description: string;
  /** Single-glyph badge for the grid + toast. */
  readonly icon: string;
  /** Pure check; runs once per monthly evaluate. Returns true to unlock. */
  readonly check: (s: Snapshot) => boolean;
}

/**
 * Snapshot of city state assembled once per `evaluate` call. Each
 * achievement reads the slots it cares about. No achievement should reach
 * back through to the live grid / economy — keeps eval cost flat regardless
 * of achievement count.
 */
export interface Snapshot {
  // Aggregate live state
  population: number;
  treasury: number;
  monthsElapsed: number;
  // Lifetime counters (post-tick)
  monthsRun: number;
  electionsWon: number;
  consecutivePositiveMonths: number;
  peakPop: number;
  peakTreasury: number;
  eventsResolved: number;
  pcSpentLifetime: number;
  endorsementsLifetime: number;
  uniqueFactionsEndorsed: number;
  overrideActivations: number;
  developedBuildings: number;
  exportRevenueLifetime: number;
  /** Lifetime tourism revenue (Alpha 2.17). Read straight off Economy. */
  tourismRevenueLifetime: number;
  // Live tile counters
  l3Buildings: number;
  muTiles: number;
  forestTiles: number;
  walkingPathTiles: number;
  busDepots: number;
  /** Distinct landmark kinds currently standing (museum / stadium /
   *  observatory). 0..3 — used by the Tourist Trap achievement. */
  uniqueLandmarkKinds: number;
  /** Active ferry docks (Alpha 2.19). Need ≥2 for the Multimodal
   *  achievement (route requires a pair). */
  ferryDocks: number;
  /** Active subway entrances (Alpha 2.19). */
  subwayEntrances: number;
  /** Current city-wide crime score [0..1] (Alpha 2.21). */
  cityCrime: number;
  /** Lifetime bonds issued (Alpha 2.18). */
  bondsIssuedLifetime: number;
  /** True if the player has ever issued a bond AND has zero outstanding
   *  bonds right now. Used for Debt Free (paid off all debt). */
  hasPaidOffAllDebt: boolean;
  highwayEdges: number;
  totalRoadEdges: number;
  zonedTiles: number;
  fullyServicedTiles: number;
  averageMood: number;
  goodMoodMonthsRun: number;
}

/** Persisted shape — counters + unlocked set. Schema 13+. */
export interface AchievementsSnapshot {
  unlocked: AchievementId[];
  unlockMonth: Record<string, number>;
  // Counters
  monthsRun: number;
  electionsWon: number;
  consecutivePositiveMonths: number;
  peakPop: number;
  peakTreasury: number;
  eventsResolved: number;
  pcSpentLifetime: number;
  endorsementsLifetime: number;
  uniqueFactionsEndorsed: string[];
  overrideActivations: number;
  developedBuildings: number;
  exportRevenueLifetime: number;
  goodMoodMonthsRun: number;
  /** Council leaders the player has met (FactionId[]). Drives the
   *  one-time bio popup. Lives in the same blob since they're peer
   *  "meta-progression" state. */
  metLeaders: string[];
}

/**
 * Achievement definitions. Order is the display order in the grid.
 * Tuning: thresholds picked so an unhurried first session unlocks
 * 5–8 over its first 30 minutes; the long-haul ones reward 10+ hour
 * cities.
 */
export const ACHIEVEMENT_DEFS: readonly Achievement[] = [
  {
    id: 'first_steps',
    name: 'First Steps',
    description: 'Reach 50 residents — your first milestone earned.',
    icon: '🏁',
    check: (s) => s.peakPop >= 50
  },
  {
    id: 'town_hall',
    name: 'Town Hall',
    description: 'Grow the city to 500 residents.',
    icon: '🏛️',
    check: (s) => s.peakPop >= 500
  },
  {
    id: 'big_city',
    name: 'Big City Energy',
    description: 'Reach 5,000 residents.',
    icon: '🌆',
    check: (s) => s.peakPop >= 5000
  },
  {
    id: 'survivor_5y',
    name: 'Five-Year Plan',
    description: 'Run a city for 60 months without resetting.',
    icon: '📅',
    check: (s) => s.monthsRun >= 60
  },
  {
    id: 'survivor_10y',
    name: 'Decade Mayor',
    description: 'Run a city for 120 months.',
    icon: '🗓️',
    check: (s) => s.monthsRun >= 120
  },
  {
    id: 'survivor_20y',
    name: 'Civic Lifer',
    description: 'Run a city for a full 240 months.',
    icon: '🏆',
    check: (s) => s.monthsRun >= 240
  },
  {
    id: 'in_the_green',
    name: 'In the Green',
    description: '12 consecutive months of positive net income.',
    icon: '💚',
    check: (s) => s.consecutivePositiveMonths >= 12
  },
  {
    id: 'treasury_tycoon',
    name: 'Treasury Tycoon',
    description: 'Hold $50,000 in the treasury.',
    icon: '💰',
    check: (s) => s.peakTreasury >= 50000
  },
  {
    id: 'civic_war_chest',
    name: 'Civic War Chest',
    description: 'Hold $250,000 in the treasury.',
    icon: '💎',
    check: (s) => s.peakTreasury >= 250000
  },
  {
    id: 'reelected',
    name: 'Re-elected',
    description: 'Win three elections.',
    icon: '🗳️',
    check: (s) => s.electionsWon >= 3
  },
  {
    id: 'career_politician',
    name: 'Career Politician',
    description: 'Win ten elections.',
    icon: '👔',
    check: (s) => s.electionsWon >= 10
  },
  {
    id: 'people_person',
    name: 'People Person',
    description: 'Hold city-wide mood above +0.4 for six months.',
    icon: '😊',
    check: (s) => s.goodMoodMonthsRun >= 6
  },
  {
    id: 'crisis_manager',
    name: 'Crisis Manager',
    description: 'Resolve five random events.',
    icon: '🚨',
    check: (s) => s.eventsResolved >= 5
  },
  {
    id: 'crisis_veteran',
    name: 'Crisis Veteran',
    description: 'Resolve twenty-five random events.',
    icon: '🎖️',
    check: (s) => s.eventsResolved >= 25
  },
  {
    id: 'builder',
    name: 'Builder',
    description: 'Develop 100 buildings on zoned land.',
    icon: '🏗️',
    check: (s) => s.developedBuildings >= 100
  },
  {
    id: 'megalopolis_builder',
    name: 'Megalopolis Architect',
    description: 'Develop 500 buildings.',
    icon: '🏙️',
    check: (s) => s.developedBuildings >= 500
  },
  {
    id: 'roadworks',
    name: 'Roadworks',
    description: 'Lay 200 road edges of any tier.',
    icon: '🛣️',
    check: (s) => s.totalRoadEdges >= 200
  },
  {
    id: 'walkable_city',
    name: 'Walkable City',
    description: 'Paint 80 walking-path tiles.',
    icon: '🚶',
    check: (s) => s.walkingPathTiles >= 80
  },
  {
    id: 'public_transit',
    name: 'Public Transit Ready',
    description: 'Operate three bus depots simultaneously.',
    icon: '🚌',
    check: (s) => s.busDepots >= 3
  },
  {
    id: 'density_pioneer',
    name: 'Density Pioneer',
    description: 'Develop 30 high-density (L3) buildings.',
    icon: '🏢',
    check: (s) => s.l3Buildings >= 30
  },
  {
    id: 'mixed_visionary',
    name: 'Mixed-Use Visionary',
    description: 'Zone 25 mixed-use tiles.',
    icon: '🏘️',
    check: (s) => s.muTiles >= 25
  },
  {
    id: 'service_to_all',
    name: 'Service To All',
    description: 'Serve 90% of zoned tiles with all utilities at 1,000+ pop.',
    icon: '🤝',
    check: (s) =>
      s.population >= 1000 &&
      s.zonedTiles > 0 &&
      s.fullyServicedTiles / s.zonedTiles >= 0.9
  },
  {
    id: 'green_giant',
    name: 'Green Giant',
    description: 'Preserve 100 forest tiles in a city of 1,500+.',
    icon: '🌲',
    check: (s) => s.forestTiles >= 100 && s.population >= 1500
  },
  {
    id: 'export_economy',
    name: 'Export Economy',
    description: 'Earn $50,000 lifetime from forestry + farm exports.',
    icon: '📦',
    check: (s) => s.exportRevenueLifetime >= 50000
  },
  {
    id: 'override_used',
    name: 'Bypass the Council',
    description: 'Activate Mayoral Override at least once.',
    icon: '⚖️',
    check: (s) => s.overrideActivations >= 1
  },
  {
    id: 'big_tent',
    name: 'Big Tent',
    description: 'Endorse five different factions across your career.',
    icon: '🎪',
    check: (s) => s.uniqueFactionsEndorsed >= 5
  },
  {
    id: 'cultural_capital',
    name: 'Cultural Capital',
    description: 'Earn $25,000 in lifetime tourism revenue from landmarks.',
    icon: '🎭',
    check: (s) => s.tourismRevenueLifetime >= 25000
  },
  {
    id: 'tourist_trap',
    name: 'Tourist Trap',
    description: 'Operate a museum, a stadium, and an observatory at once.',
    icon: '🗺️',
    check: (s) => s.uniqueLandmarkKinds >= 3
  },
  {
    id: 'bond_issuer',
    name: 'Bond Issuer',
    description: 'Issue your first municipal bond.',
    icon: '📜',
    check: (s) => s.bondsIssuedLifetime >= 1
  },
  {
    id: 'debt_free',
    name: 'Debt-Free',
    description: 'Pay off every outstanding bond after taking at least one.',
    icon: '🪙',
    check: (s) => s.hasPaidOffAllDebt
  },
  {
    id: 'multimodal',
    name: 'Multimodal',
    description: 'Operate buses, ferries, and a subway entrance simultaneously.',
    icon: '🚇',
    check: (s) => s.busDepots >= 1 && s.ferryDocks >= 2 && s.subwayEntrances >= 1
  },
  {
    id: 'underground',
    name: 'Underground',
    description: 'Place three subway entrances.',
    icon: 'Ⓜ️',
    check: (s) => s.subwayEntrances >= 3
  },
  {
    id: 'safe_streets',
    name: 'Safe Streets',
    description: 'Hold city crime under 0.10 with population ≥ 1,500.',
    icon: '🛡',
    check: (s) => s.population >= 1500 && s.cityCrime > 0 && s.cityCrime < 0.10
  }
];

export class Achievements {
  // ---- Lifetime counters --------------------------------------------------
  /** Sim months elapsed since this city was created — survives reloads. */
  monthsRun = 0;
  /** Total elections concluded. Mayor always wins, so this is just term count. */
  electionsWon = 0;
  /** Streak of months with positive net income; resets on any non-positive. */
  consecutivePositiveMonths = 0;
  /** Streak of months with mean faction mood >= +0.4. */
  goodMoodMonthsRun = 0;
  peakPop = 0;
  peakTreasury = 0;
  eventsResolved = 0;
  pcSpentLifetime = 0;
  endorsementsLifetime = 0;
  /** Faction IDs the player has ever endorsed — the set's size feeds Big Tent. */
  readonly uniqueFactionsEndorsed = new Set<FactionId>();
  overrideActivations = 0;
  developedBuildings = 0;
  exportRevenueLifetime = 0;
  /** Council faction IDs the player has met (one-time leader bio gate). */
  readonly metLeaders = new Set<FactionId>();

  // ---- Unlock state -------------------------------------------------------
  readonly unlocked = new Set<AchievementId>();
  /** Month the achievement was earned, for the panel timestamp. */
  readonly unlockMonth = new Map<AchievementId, number>();
  /** Pending toast queue — main.ts pulls + clears one per frame. */
  private readonly pending: Achievement[] = [];

  /** Cheat-mode kill switch (Alpha 4.10.1). When true, evaluateMonth
   *  bails before unlocking and record* methods become no-ops so the
   *  player can't farm achievements via unlimited money / demand.
   *  Existing unlocks stay; only new unlocks + counter bumps freeze. */
  cheatsActive = false;

  /**
   * Run once per monthly tick. Updates streak counters, snapshots state,
   * runs every achievement check that hasn't yet unlocked.
   *
   * Note on side effects: this method MUTATES the streak counters using
   * the freshly-passed-in monthly numbers, then does the read-only checks.
   * Counters that are externally mutated (eventsResolved, electionsWon,
   * etc.) are bumped through their dedicated record* methods.
   */
  evaluateMonth(args: {
    monthsElapsed: number;
    economy: Economy;
    population: Population;
    happiness: Happiness;
    council: Council;
    grid: Grid;
    milestones: Milestones;
    /** Optional Bonds — Achievements need lifetime issuance + active count
     *  for the Bond Issuer / Debt Free pair. Defaults to no-bond inputs. */
    bonds?: { lifetimeIssued: number; activeCount: number };
    /** Optional Crime — current city-wide score for Safe Streets. */
    cityCrime?: number;
  }): boolean {
    // Cheat-mode kill switch (Alpha 4.10.1). Skip the entire monthly
    // evaluation so streak counters + peak-pop/peak-treasury don't get
    // bumped past honest values either. Without this you could enable
    // unlimited money for one month and unlock "Mogul" for free.
    if (this.cheatsActive) return false;
    const { economy, population, happiness, grid } = args;

    // Streak math first. monthsRun is the per-city absolute count; we let it
    // run forward only — never rewinds even if monthsElapsed jitters.
    if (args.monthsElapsed > this.monthsRun) {
      this.monthsRun = args.monthsElapsed;
    }

    const net = economy.lastRevenue - economy.lastExpenses;
    if (net > 0) this.consecutivePositiveMonths++;
    else this.consecutivePositiveMonths = 0;

    const mood = happiness.overall();
    if (mood >= 0.4) this.goodMoodMonthsRun++;
    else this.goodMoodMonthsRun = 0;

    if (population.totalResidents > this.peakPop) this.peakPop = population.totalResidents;
    if (economy.treasury > this.peakTreasury) this.peakTreasury = economy.treasury;

    this.exportRevenueLifetime +=
      (economy.lastForestryRevenue ?? 0) + (economy.lastFarmRevenue ?? 0);

    // Live tile counters from one grid pass — shared across all checks.
    let muTiles = 0;
    let forestTiles = 0;
    let walkingPathTiles = 0;
    let busDepots = 0;
    let zonedTiles = 0;
    let fullyServicedTiles = 0;
    let l3Buildings = 0;
    let developedBuildings = 0;
    let hasMuseum = false;
    let hasStadium = false;
    let hasObservatory = false;
    let ferryDocks = 0;
    let subwayEntrances = 0;
    for (const t of grid.iter()) {
      if (t.terrain === 'forest') forestTiles++;
      if (t.zone !== 'none') {
        zonedTiles++;
        if (t.density > 0) developedBuildings++;
        if (t.density === 3) l3Buildings++;
        if (t.zone === 'mixed') muTiles++;
        if (t.hasPower && t.hasWater && t.hasPark) fullyServicedTiles++;
      }
      if (t.path) walkingPathTiles++;
      if (t.building === 'bus_depot') busDepots++;
      else if (t.building === 'museum') hasMuseum = true;
      else if (t.building === 'stadium') hasStadium = true;
      else if (t.building === 'observatory') hasObservatory = true;
      else if (t.building === 'ferry_dock') ferryDocks++;
      else if (t.building === 'subway_entrance') subwayEntrances++;
    }
    const uniqueLandmarkKinds =
      (hasMuseum ? 1 : 0) + (hasStadium ? 1 : 0) + (hasObservatory ? 1 : 0);
    let highwayEdges = 0;
    let totalRoadEdges = 0;
    for (const e of grid.iterRoadEdges()) {
      totalRoadEdges++;
      const ta = grid.get(e.ax, e.ay);
      const tb = grid.get(e.bx, e.by);
      const tier = ta?.roadType ?? tb?.roadType ?? 'local';
      if (tier === 'highway') highwayEdges++;
    }
    // The L3-Buildings count derived above is "currently developed" rather
    // than lifetime; that's fine for an achievement that wants you to
    // currently HAVE 30 standing. developedBuildings (lifetime) is bumped
    // by the dedicated recordBuildingDeveloped path so demolitions don't
    // erode progress.
    if (developedBuildings > this.developedBuildings) {
      this.developedBuildings = developedBuildings;
    }

    const snap: Snapshot = {
      population: population.totalResidents,
      treasury: economy.treasury,
      monthsElapsed: args.monthsElapsed,
      monthsRun: this.monthsRun,
      electionsWon: this.electionsWon,
      consecutivePositiveMonths: this.consecutivePositiveMonths,
      peakPop: this.peakPop,
      peakTreasury: this.peakTreasury,
      eventsResolved: this.eventsResolved,
      pcSpentLifetime: this.pcSpentLifetime,
      endorsementsLifetime: this.endorsementsLifetime,
      uniqueFactionsEndorsed: this.uniqueFactionsEndorsed.size,
      overrideActivations: this.overrideActivations,
      developedBuildings: this.developedBuildings,
      exportRevenueLifetime: this.exportRevenueLifetime,
      tourismRevenueLifetime: economy.lifetimeTourismRevenue ?? 0,
      l3Buildings,
      muTiles,
      forestTiles,
      walkingPathTiles,
      busDepots,
      uniqueLandmarkKinds,
      ferryDocks,
      subwayEntrances,
      cityCrime: args.cityCrime ?? 0,
      bondsIssuedLifetime: args.bonds?.lifetimeIssued ?? 0,
      hasPaidOffAllDebt: (args.bonds?.lifetimeIssued ?? 0) > 0 && (args.bonds?.activeCount ?? 0) === 0,
      highwayEdges,
      totalRoadEdges,
      zonedTiles,
      fullyServicedTiles,
      averageMood: mood,
      goodMoodMonthsRun: this.goodMoodMonthsRun
    };

    let any = false;
    for (const a of ACHIEVEMENT_DEFS) {
      if (this.unlocked.has(a.id)) continue;
      if (a.check(snap)) {
        this.unlocked.add(a.id);
        this.unlockMonth.set(a.id, args.monthsElapsed);
        this.pending.push(a);
        any = true;
      }
    }
    return any;
  }

  /** Bump on each completed election. Drives Re-elected / Career Politician. */
  recordElection(): void {
    if (this.cheatsActive) return;
    this.electionsWon++;
  }

  /** Bump on each event resolved (resolveChoice or auto-resolve). */
  recordEventResolved(): void {
    if (this.cheatsActive) return;
    this.eventsResolved++;
  }

  /** Track a civic action's PC spend. Drives the (currently invisible)
   *  pcSpentLifetime counter. */
  recordPCSpent(amount: number): void {
    if (this.cheatsActive) return;
    this.pcSpentLifetime += amount;
  }

  /** Bump on every endorsement and remember the faction (Big Tent). */
  recordEndorsement(id: FactionId): void {
    if (this.cheatsActive) return;
    this.endorsementsLifetime++;
    this.uniqueFactionsEndorsed.add(id);
  }

  recordOverrideActivation(): void {
    if (this.cheatsActive) return;
    this.overrideActivations++;
  }

  /** Returns + removes the next pending achievement for the toast queue. */
  shiftPending(): Achievement | undefined {
    return this.pending.shift();
  }
  hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** True iff this faction's leader hasn't yet been met by the player. */
  shouldShowLeaderBio(id: FactionId): boolean {
    return !this.metLeaders.has(id);
  }
  markLeaderMet(id: FactionId): void {
    this.metLeaders.add(id);
  }

  serialize(): AchievementsSnapshot {
    return {
      unlocked: Array.from(this.unlocked),
      unlockMonth: Object.fromEntries(this.unlockMonth),
      monthsRun: this.monthsRun,
      electionsWon: this.electionsWon,
      consecutivePositiveMonths: this.consecutivePositiveMonths,
      peakPop: this.peakPop,
      peakTreasury: this.peakTreasury,
      eventsResolved: this.eventsResolved,
      pcSpentLifetime: this.pcSpentLifetime,
      endorsementsLifetime: this.endorsementsLifetime,
      uniqueFactionsEndorsed: Array.from(this.uniqueFactionsEndorsed),
      overrideActivations: this.overrideActivations,
      developedBuildings: this.developedBuildings,
      exportRevenueLifetime: this.exportRevenueLifetime,
      goodMoodMonthsRun: this.goodMoodMonthsRun,
      metLeaders: Array.from(this.metLeaders)
    };
  }

  restore(snap?: AchievementsSnapshot): void {
    this.unlocked.clear();
    this.unlockMonth.clear();
    this.uniqueFactionsEndorsed.clear();
    this.metLeaders.clear();
    this.pending.length = 0;
    if (!snap) return;
    for (const id of snap.unlocked) this.unlocked.add(id as AchievementId);
    for (const [id, month] of Object.entries(snap.unlockMonth)) {
      this.unlockMonth.set(id as AchievementId, month);
    }
    this.monthsRun = snap.monthsRun ?? 0;
    this.electionsWon = snap.electionsWon ?? 0;
    this.consecutivePositiveMonths = snap.consecutivePositiveMonths ?? 0;
    this.peakPop = snap.peakPop ?? 0;
    this.peakTreasury = snap.peakTreasury ?? 0;
    this.eventsResolved = snap.eventsResolved ?? 0;
    this.pcSpentLifetime = snap.pcSpentLifetime ?? 0;
    this.endorsementsLifetime = snap.endorsementsLifetime ?? 0;
    for (const id of snap.uniqueFactionsEndorsed ?? []) {
      this.uniqueFactionsEndorsed.add(id as FactionId);
    }
    this.overrideActivations = snap.overrideActivations ?? 0;
    this.developedBuildings = snap.developedBuildings ?? 0;
    this.exportRevenueLifetime = snap.exportRevenueLifetime ?? 0;
    this.goodMoodMonthsRun = snap.goodMoodMonthsRun ?? 0;
    for (const id of snap.metLeaders ?? []) {
      this.metLeaders.add(id as FactionId);
    }
  }
}
