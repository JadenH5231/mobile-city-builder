import type { Happiness, FactionId } from './Happiness';
import type { Population } from './Population';
import type { ZoneTier } from '../types';

/**
 * Council — the governance layer that turns Happiness from "vibes" into
 * concrete game-mechanics pressure. Every 3 sim months an election fires:
 *
 * - Mayor (the player) always wins, ≥ 50.0001%, with the actual % scaled by
 *   overall city happiness so close races feel tense.
 * - Opponent = leader of the 2nd-most-angry faction. They don't get a council
 *   seat that term (they ran against the mayor and lost).
 * - 4 of the remaining 9 factions take council seats, ranked by votes
 *   (factionPop × turnout). Turnout climbs with anger, so neglected groups
 *   get over-represented.
 *
 * Councillors do three things while in office:
 *
 * 1. Cost multiplier: every buildable's price is multiplied by
 *    `1 − sumStances × 0.25`, clamped [0.20, 2.5]. If every councillor
 *    strongly opposes a thing (all stances ≤ −0.4), it's BANNED for the term.
 * 2. Zoning-change gate: re-zoning an already-zoned tile needs ≥ 2 councillors
 *    with stance ≥ 0 for the new (zone, tier). Fresh paint on grass is always
 *    fine — only zone CHANGES need approval.
 * 3. Population boost: each councillor's faction gets +10% to its natural
 *    share. Population.tick reads this when computing per-faction targets.
 *
 * This module is the **executive arm** of the keystone Happiness system —
 * future governance features (policies, executive orders, ballot measures)
 * should plug in here.
 */

/**
 * Per-faction stance toward each thing the player can place / paint / zone.
 * Range [-1, +1]: -1 = strongly opposed, 0 = indifferent, +1 = strongly for.
 *
 * Cost multiplier sums councillors' stances for the relevant key. Zone
 * approval reads the matching (zone, tier) key.
 */
export interface FactionStances {
  road_local: number;
  road_avenue: number;
  road_highway: number;
  // Residential / Commercial / Industrial × Low / Medium / High.
  r_low: number;     r_medium: number;  r_high: number;
  c_low: number;     c_medium: number;  c_high: number;
  i_low: number;     i_medium: number;  i_high: number;
  power_plant: number;
  water_tower: number;
  park: number;
  bus_stop: number;
  bus_depot: number;
  stop_sign: number;
}

export type StanceKey = keyof FactionStances;

/**
 * The political stance matrix. Each faction's row reflects their
 * declared values from Happiness.ts compute functions. Tune carefully —
 * the cost multiplier and zoning gate both read from here.
 */
export const FACTION_STANCES: Record<FactionId, FactionStances> = {
  nimbys: {
    road_local: 0.0, road_avenue: -0.3, road_highway: -0.7,
    r_low: 0.4, r_medium: -0.5, r_high: -1.0,
    c_low: -0.4, c_medium: -0.6, c_high: -0.8,
    i_low: -0.7, i_medium: -0.9, i_high: -1.0,
    power_plant: -0.7, water_tower: 0.0, park: 0.6,
    bus_stop: -0.3, bus_depot: -0.5, stop_sign: 0.4
  },
  yimbys: {
    road_local: -0.1, road_avenue: 0.3, road_highway: 0.0,
    r_low: -0.5, r_medium: 0.4, r_high: 0.8,
    c_low: 0.0, c_medium: 0.4, c_high: 0.7,
    i_low: 0.0, i_medium: 0.2, i_high: 0.3,
    power_plant: 0.0, water_tower: 0.2, park: 0.3,
    bus_stop: 0.7, bus_depot: 0.8, stop_sign: 0.2
  },
  environmentalists: {
    road_local: -0.2, road_avenue: -0.4, road_highway: -0.8,
    r_low: 0.0, r_medium: 0.0, r_high: 0.1,
    c_low: 0.0, c_medium: 0.0, c_high: 0.0,
    i_low: -0.5, i_medium: -0.7, i_high: -1.0,
    power_plant: -0.9, water_tower: 0.2, park: 1.0,
    bus_stop: 0.8, bus_depot: 0.8, stop_sign: 0.1
  },
  hometown: {
    road_local: 0.1, road_avenue: -0.3, road_highway: -0.6,
    r_low: 0.4, r_medium: -0.2, r_high: -0.9,
    c_low: 0.2, c_medium: -0.3, c_high: -0.7,
    i_low: -0.3, i_medium: -0.5, i_high: -0.8,
    power_plant: -0.4, water_tower: 0.0, park: 0.5,
    bus_stop: -0.2, bus_depot: -0.3, stop_sign: 0.2
  },
  chamber: {
    road_local: 0.1, road_avenue: 0.3, road_highway: 0.4,
    r_low: 0.0, r_medium: 0.2, r_high: 0.3,
    c_low: 0.5, c_medium: 0.7, c_high: 0.9,
    i_low: 0.6, i_medium: 0.7, i_high: 0.8,
    power_plant: 0.4, water_tower: 0.3, park: 0.1,
    bus_stop: 0.1, bus_depot: 0.2, stop_sign: -0.1
  },
  transit: {
    road_local: -0.1, road_avenue: 0.3, road_highway: -0.5,
    r_low: -0.2, r_medium: 0.4, r_high: 0.6,
    c_low: 0.0, c_medium: 0.3, c_high: 0.5,
    i_low: 0.0, i_medium: 0.0, i_high: 0.0,
    power_plant: -0.3, water_tower: 0.1, park: 0.4,
    bus_stop: 1.0, bus_depot: 1.0, stop_sign: 0.3
  },
  drivers: {
    road_local: 0.5, road_avenue: 0.8, road_highway: 1.0,
    r_low: 0.0, r_medium: 0.0, r_high: -0.1,
    c_low: 0.3, c_medium: 0.4, c_high: 0.4,
    i_low: 0.2, i_medium: 0.2, i_high: 0.2,
    power_plant: 0.1, water_tower: 0.0, park: 0.0,
    bus_stop: -0.7, bus_depot: -0.8, stop_sign: -0.4
  },
  taxpayers: {
    road_local: -0.2, road_avenue: -0.3, road_highway: -0.5,
    r_low: 0.2, r_medium: 0.3, r_high: 0.4,
    c_low: 0.4, c_medium: 0.5, c_high: 0.5,
    i_low: 0.4, i_medium: 0.4, i_high: 0.5,
    power_plant: -0.4, water_tower: -0.2, park: -0.2,
    bus_stop: -0.2, bus_depot: -0.4, stop_sign: -0.2
  },
  safer_streets: {
    road_local: 0.1, road_avenue: 0.0, road_highway: -0.4,
    r_low: 0.2, r_medium: 0.2, r_high: 0.2,
    c_low: 0.2, c_medium: 0.2, c_high: 0.2,
    i_low: -0.2, i_medium: -0.3, i_high: -0.4,
    power_plant: -0.3, water_tower: 0.4, park: 0.7,
    bus_stop: 0.3, bus_depot: 0.3, stop_sign: 1.0
  },
  working_families: {
    road_local: 0.1, road_avenue: 0.2, road_highway: 0.1,
    r_low: 0.4, r_medium: 0.5, r_high: 0.4,
    c_low: 0.5, c_medium: 0.6, c_high: 0.5,
    i_low: 0.7, i_medium: 0.7, i_high: 0.6,
    power_plant: 0.2, water_tower: 0.3, park: 0.4,
    bus_stop: 0.4, bus_depot: 0.4, stop_sign: 0.3
  }
};

const ALL_FACTION_IDS: readonly FactionId[] = [
  'nimbys', 'yimbys', 'environmentalists', 'hometown', 'chamber',
  'transit', 'drivers', 'taxpayers', 'safer_streets', 'working_families'
];

/**
 * Per-faction natural enemies — used by the Coalition mechanic. When the
 * player allies with a faction, that faction's rivals take a happiness hit.
 * The pairs reflect real urban-political fault lines:
 *  - NIMBYs vs YIMBYs (zoning fight)
 *  - Environmentalists vs Chamber (industry fight)
 *  - Hometown vs YIMBYs (growth fight)
 *  - Drivers vs Transit (mode fight)
 *  - Drivers vs Safer Streets (speed-vs-safety fight)
 *  - Taxpayers vs Working Families (tax fight)
 */
export const FACTION_RIVALS: Record<FactionId, readonly FactionId[]> = {
  nimbys:           ['yimbys'],
  yimbys:           ['nimbys', 'hometown'],
  environmentalists: ['chamber'],
  hometown:         ['yimbys'],
  chamber:          ['environmentalists'],
  transit:          ['drivers'],
  drivers:          ['transit', 'safer_streets'],
  taxpayers:        ['working_families'],
  safer_streets:    ['drivers'],
  working_families: ['taxpayers']
};

/** Civic-action costs in Political Capital and treasury. */
export const COSTS = {
  endorse_pc: 5,
  photo_op_pc: 2,
  photo_op_cash: 200,
  coalition_pc: 10,
  override_pc: 40
} as const;

/** Hard ceiling on Political Capital so it can't be hoarded indefinitely. */
export const PC_CAP = 50;

export interface Coalition {
  readonly a: FactionId;
  readonly b: FactionId;
}

/** Per-faction "city hall mode" comment shown when they're on council. */
export const COUNCIL_COMMENTS: Record<FactionId, string> = {
  nimbys:
    "On the floor at council today: I introduced a motion to STRENGTHEN setback requirements 💪 " +
    "Filed comments on EVERY pending project. The neighbors are with me 🏡✨",
  yimbys:
    "voted YES on upzoning the corridor today. tiny win but momentum 📈 thread incoming on the " +
    "floor debate. council watch is the BEST sport 🏛️🔥",
  environmentalists:
    "Convened the council's environmental review subcommittee today 🌳 Pushing for tree-canopy " +
    "targets, parkland goals, and a moratorium on heavy industry. The bees are counting on us 🐝",
  hometown:
    "Spoke at council today. Reminded 'em what this town USED to be. Some listened. Some didn't. " +
    "We'll see at the next vote 🇺🇸",
  chamber:
    "Met with three small-biz owners between hearings today!! 📈 Council, the Chamber is at the " +
    "table. Pro-jobs agenda front and center 💼 ribbon cutting Friday — be THERE",
  transit:
    "moved to advance the BRT corridor study at council today 🚌 four-of-four committee approval. " +
    "tag a transit advocate — this is HISTORY ⚡",
  drivers:
    "Council meeting today. I voted NO on every bus-stop expansion they tried to slip through. " +
    "Eyes on these so-called planners. Standing up for drivers 🚗🇺🇸",
  taxpayers:
    "The Alliance is proud to report: I voted AGAINST every spending increase on the docket today. " +
    "Common sense WORKS, Greenmeadow 📊🏛️",
  safer_streets:
    "Today on council I introduced a motion for stop signs at three more intersections 🛑 " +
    "The data is the data. Lives are on the line. 🩺✊",
  working_families:
    "On council today, I fought for working families. R tax stays at 9. Period. " +
    "Tag a working family that has my back ❤️🏛️"
};

export interface VoteShare {
  readonly id: FactionId;
  readonly pct: number;
}

export interface ElectionResult {
  readonly term: number;
  readonly mayorPct: number;
  readonly opponentId: FactionId;
  readonly opponentPct: number;
  readonly councillors: readonly FactionId[];
  /** All 10 factions ranked by vote share, for the popup display. */
  readonly voteSorted: readonly VoteShare[];
}

/**
 * Council state — current term's councillors, opponent, and election result
 * (cleared when the popup is dismissed by the UI).
 *
 * Not currently saved across reloads; first reload-after-election starts
 * fresh and triggers the next election in 3 months. Acceptable for prototype.
 */
export class Council {
  councillors: readonly FactionId[] = [];
  opponent: FactionId | null = null;
  term = 0;
  /** Set when an election just fired; the popup picks it up and clears it. */
  pendingResult: ElectionResult | null = null;
  /** Months elapsed when the last election ran. Prevents double-firing. */
  private lastElectionMonth = -1;

  // ---- Civic action state -----------------------------------------------
  /** Slow-accumulating resource. Earned monthly based on faction happiness. */
  politicalCapital = 0;
  /** Faction the player has endorsed for the *upcoming* election. Cleared
   *  when that election fires. The endorsed faction can't be picked as
   *  opponent (you've publicly aligned with them). */
  endorsedFaction: FactionId | null = null;
  /** Two factions in a player-declared alliance. Cleared at next election. */
  coalition: Coalition | null = null;
  /** Per-term cap so a player can't photo-op the same faction repeatedly. */
  private readonly photoOpsThisTerm = new Set<FactionId>();
  /** Per-faction multiplier applied to vote scores at the next election.
   *  Photo-ops boost this; cleared after each election. */
  private readonly campaignBoost = new Map<FactionId, number>();
  /** Per-faction one-off happiness adjustments from civic actions
   *  (e.g. opposition factions take -0.05 when the player photo-ops a
   *  building they hate). Cleared at election. Read by Happiness via
   *  the CivicModifiers struct. */
  readonly campaignHappinessDelta = new Map<FactionId, number>();
  /** True when the player has paid for override but the next term hasn't
   *  started yet. Becomes false (and `overrideTerm` is set) at the next
   *  election. */
  private overridePending = false;
  /** Term number during which Mayoral Override is active. -1 = inactive. */
  private overrideTerm = -1;

  /**
   * Run an election if it's due (every 12 months on the boundary). Returns
   * the new ElectionResult if one fired, else null.
   */
  maybeRunElection(monthsElapsed: number, happiness: Happiness, population: Population): ElectionResult | null {
    if (monthsElapsed === 0) return null;
    if (monthsElapsed % 12 !== 0) return null;
    if (this.lastElectionMonth === monthsElapsed) return null;
    this.lastElectionMonth = monthsElapsed;
    return this.runElection(happiness, population);
  }

  private runElection(happiness: Happiness, population: Population): ElectionResult {
    // Expire override that was active in the term that's now ending.
    if (this.overrideTerm === this.term) this.overrideTerm = -1;

    // Anger ranking — most-angry first. Endorsed faction can't be opponent
    // (you've publicly aligned with them, so they don't run against you).
    const byAnger = [...ALL_FACTION_IDS].sort((a, b) => happiness.get(a) - happiness.get(b));
    const opponentCandidates = this.endorsedFaction
      ? byAnger.filter((id) => id !== this.endorsedFaction)
      : byAnger;
    const opponentId = opponentCandidates[1] ?? opponentCandidates[0]!;

    // Vote score per faction = pop × turnout × campaignBoost × endorsementBoost.
    const voteScores = new Map<FactionId, number>();
    let totalVotes = 0;
    for (const id of ALL_FACTION_IDS) {
      const h = happiness.get(id);
      const turnout = 0.4 + 0.5 * Math.max(0, -h);
      const pop = population.factionPopulation.get(id) ?? 0;
      const photoBoost = this.campaignBoost.get(id) ?? 1;
      const endorseBoost = this.endorsedFaction === id ? 1.20 : 1;
      const v = pop * turnout * photoBoost * endorseBoost;
      voteScores.set(id, v);
      totalVotes += v;
    }

    // Council = top 4 by vote score among non-opponent factions.
    const councillors = ALL_FACTION_IDS
      .filter((id) => id !== opponentId)
      .sort((a, b) => (voteScores.get(b) ?? 0) - (voteScores.get(a) ?? 0))
      .slice(0, 4);

    // Mayor's % derived from overall mood. Always wins, never higher than 85.
    const overall = happiness.overall();
    const mayorPct = Math.max(50.0001, Math.min(85, 50 + overall * 25));
    const opponentPct = 100 - mayorPct;

    // Vote share table for the popup.
    const voteSorted: VoteShare[] = ALL_FACTION_IDS
      .map((id) => ({
        id,
        pct: totalVotes > 0 ? ((voteScores.get(id) ?? 0) / totalVotes) * 100 : 0
      }))
      .sort((a, b) => b.pct - a.pct);

    this.term++;
    this.councillors = councillors;
    this.opponent = opponentId;

    // Civic actions consumed at election: endorsement, coalition, photo-ops.
    this.endorsedFaction = null;
    this.coalition = null;
    this.photoOpsThisTerm.clear();
    this.campaignBoost.clear();
    this.campaignHappinessDelta.clear();

    // Pending override activates for this new term.
    if (this.overridePending) {
      this.overrideTerm = this.term;
      this.overridePending = false;
    }

    const result: ElectionResult = {
      term: this.term,
      mayorPct,
      opponentId,
      opponentPct,
      councillors,
      voteSorted
    };
    this.pendingResult = result;
    return result;
  }

  // ---- Civic actions ----------------------------------------------------

  /** Award PC for the month based on faction happiness. Capped at PC_CAP. */
  awardMonthlyPC(happiness: Happiness): number {
    let earned = 1; // base
    for (const id of ALL_FACTION_IDS) {
      if (happiness.get(id) >= 0.5) earned += 0.5;
    }
    const next = Math.min(PC_CAP, this.politicalCapital + earned);
    const actually = next - this.politicalCapital;
    this.politicalCapital = next;
    return actually;
  }

  private spendPC(amount: number): boolean {
    if (this.politicalCapital < amount) return false;
    this.politicalCapital -= amount;
    return true;
  }

  /** Endorse a faction for the next election. 5 PC. */
  endorse(faction: FactionId): boolean {
    if (this.endorsedFaction !== null) return false; // already endorsed
    if (!this.spendPC(COSTS.endorse_pc)) return false;
    this.endorsedFaction = faction;
    return true;
  }

  /** Declare a 2-faction coalition. 10 PC. Picks two distinct factions. */
  declareCoalition(a: FactionId, b: FactionId): boolean {
    if (a === b) return false;
    if (this.coalition !== null) return false;
    if (!this.spendPC(COSTS.coalition_pc)) return false;
    this.coalition = { a, b };
    return true;
  }

  /**
   * Activate Mayoral Override for the *next* full term. 40 PC. While active,
   * `costMultiplier` returns 1.0 and `canChangeZone` returns true regardless
   * of council composition.
   */
  activateOverride(): boolean {
    if (this.overridePending || this.isOverrideActive()) return false;
    if (!this.spendPC(COSTS.override_pc)) return false;
    this.overridePending = true;
    return true;
  }

  isOverrideActive(): boolean {
    return this.overrideTerm === this.term && this.term > 0;
  }

  isOverridePending(): boolean {
    return this.overridePending;
  }

  /**
   * Try to redeem a photo-op opportunity for the given faction. Returns true
   * if successful (PC + cash spent, faction recorded). Caller passes the
   * list of *opponents of the underlying building* so Council can apply a
   * small happiness penalty to them — the photo-op makes them mad.
   */
  tryPhotoOp(faction: FactionId, cashOk: boolean, opponents: readonly FactionId[] = []): boolean {
    if (this.photoOpsThisTerm.has(faction)) return false;
    if (!cashOk) return false;
    if (this.politicalCapital < COSTS.photo_op_pc) return false;
    this.spendPC(COSTS.photo_op_pc);
    this.photoOpsThisTerm.add(faction);
    const prev = this.campaignBoost.get(faction) ?? 1;
    this.campaignBoost.set(faction, prev * 1.25);
    for (const opp of opponents) {
      const cur = this.campaignHappinessDelta.get(opp) ?? 0;
      this.campaignHappinessDelta.set(opp, cur - 0.05);
    }
    return true;
  }

  hasPhotoOpThisTerm(faction: FactionId): boolean {
    return this.photoOpsThisTerm.has(faction);
  }

  /**
   * Multiplier on a placement / paint cost. Sums councillors' stances toward
   * `key` and converts to a multiplier. Returns Infinity when the council
   * has banned the action (every councillor strongly opposes).
   *
   * **Mayoral Override** completely bypasses this — returns 1.0 always.
   */
  costMultiplier(key: StanceKey): number {
    if (this.isOverrideActive()) return 1.0;
    if (this.councillors.length === 0) return 1.0;
    let sum = 0;
    let allStronglyOpposed = true;
    for (const id of this.councillors) {
      const stance = FACTION_STANCES[id][key];
      sum += stance;
      if (stance > -0.4) allStronglyOpposed = false;
    }
    if (allStronglyOpposed) return Infinity;
    // Each councillor's stance is worth 25% of cost.
    const mult = 1 - sum * 0.25;
    return Math.max(0.20, Math.min(2.5, mult));
  }

  /**
   * Zoning-change rule: at least two councillors must have a non-negative
   * stance toward the new (zone, tier). **Mayoral Override** bypasses
   * (always returns true).
   */
  canChangeZone(zoneKind: 'residential' | 'commercial' | 'industrial', tier: ZoneTier): boolean {
    if (this.isOverrideActive()) return true;
    if (this.councillors.length === 0) return true;
    const prefix = zoneKind === 'residential' ? 'r' : zoneKind === 'commercial' ? 'c' : 'i';
    const key = `${prefix}_${tier}` as StanceKey;
    let approvals = 0;
    for (const id of this.councillors) {
      if (FACTION_STANCES[id][key] >= 0) approvals++;
    }
    return approvals >= 2;
  }

  /** Population growth boost: 1.10 if on council, else 1.0. */
  populationBoost(id: FactionId): number {
    return this.councillors.includes(id) ? 1.10 : 1.0;
  }

  isCouncillor(id: FactionId): boolean {
    return this.councillors.includes(id);
  }

  isOpponent(id: FactionId): boolean {
    return this.opponent === id;
  }

  /** Clear the pending result (called by UI after the popup is dismissed). */
  acknowledgeResult(): void {
    this.pendingResult = null;
  }
}
