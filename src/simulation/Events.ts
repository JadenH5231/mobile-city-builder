import type { Grid } from '../world/Grid';
import type { Economy } from './Economy';
import type { Population } from './Population';
import type { Council } from './Council';
import type { Happiness, FactionId } from './Happiness';
import { FACTIONS } from './Happiness';
import { FIRE_PROTECTION_MULT, type Zone } from '../types';

/**
 * Random-events + crises engine (Alpha 2.9). Per-month dice rolls
 * driven by city state — fires, recessions, audits, trade deals, plus
 * RARE lawsuits and referendums that interrupt with player decisions.
 *
 * Design tenets:
 *  - State-driven: events fire only when their conditions hold
 *    (industrial fires need industrial tiles, audits need a treasury,
 *    lawsuits need a furious faction).
 *  - Rare by default: most categories cap at ~5% per month per
 *    qualifying object. Lawsuits + referendums are deliberately rare
 *    per player request — single-digit annual chance.
 *  - Composable modifiers: events apply MarketShock / FactionMood /
 *    DemandShift modifiers that decay over months. Economy and
 *    Population read these every settlement.
 *  - Choice-based when meaningful: lawsuits + referendums interrupt
 *    with a modal; everything else fires-and-forgets with a notice.
 *
 * Modifiers persist across sim ticks and across save/load (Alpha 2.9
 * schema v10).
 */

export type EventSeverity = 'info' | 'warning' | 'danger' | 'choice';

export interface EventChoice {
  readonly id: string;
  readonly label: string;
  /** One-line tooltip explaining the consequence. */
  readonly hint: string;
}

export interface GameEvent {
  readonly id: string;
  readonly kind:
    | 'fire' | 'power_outage' | 'recession' | 'boom' | 'audit'
    | 'trade_deal' | 'lawsuit' | 'referendum' | 'industrial_accident';
  readonly severity: EventSeverity;
  readonly title: string;
  readonly body: string;
  /** Faction whose leader narrates this. Used for the avatar in the modal. */
  readonly herald?: FactionId;
  /** When non-empty, this event blocks until the player picks one. */
  readonly choices?: readonly EventChoice[];
  /** Tiles to highlight (fires, accidents). World coords. */
  readonly highlight?: { readonly x: number; readonly y: number };
}

/**
 * Active multi-month modifiers. Each one decays by 1 month per
 * `decayMonths` call until monthsLeft hits 0, at which point it's
 * dropped from the active list.
 */
export interface MarketShock {
  kind: 'market_shock';
  /** Lumber-price multiplier this period overrides the base oscillation. */
  lumberMult: number;
  /** Produce-price multiplier. */
  produceMult: number;
  monthsLeft: number;
}
export interface FactionMood {
  kind: 'faction_mood';
  faction: FactionId;
  delta: number;
  monthsLeft: number;
}
export interface DemandShift {
  kind: 'demand_shift';
  zone: Zone;
  delta: number;
  monthsLeft: number;
}
export type ActiveModifier = MarketShock | FactionMood | DemandShift;

/** Snapshot for save/restore. */
export interface EventsSnapshot {
  readonly modifiers: readonly ActiveModifier[];
  readonly monthsSinceLastBigEvent: number;
}

export class Events {
  /** Currently in-flight modifiers (recession, audit aftermath, etc.). */
  readonly modifiers: ActiveModifier[] = [];
  /** Counter to space out the "big" events (recessions, lawsuits, referendums). */
  private monthsSinceBigEvent = 12;
  /** Pending events not yet shown to the player. */
  private readonly pending: GameEvent[] = [];

  hasPending(): boolean {
    return this.pending.length > 0;
  }
  shiftPending(): GameEvent | undefined {
    return this.pending.shift();
  }

  /**
   * Run once per sim month (caller decides). Decays modifiers, then
   * rolls each event category.
   */
  tickMonth(
    grid: Grid,
    economy: Economy,
    population: Population,
    council: Council,
    happiness: Happiness,
    rng: () => number = Math.random
  ): void {
    this.decayMonth();
    this.monthsSinceBigEvent++;

    // Tile-driven random hazards. Iterate the grid once and roll on
    // each qualifying tile so the chance is proportional to your
    // industrial / power-plant footprint.
    // Fire-weighted industrial sweep (Alpha 2.10): each industrial tile
    // contributes a per-tile fire chance × FIRE_PROTECTION_MULT if it
    // sits inside a fire-station radius. Sum the chances; if the rng
    // crosses, pick a random qualifying tile (weighted by individual
    // chance) for the actual fire.
    let weightedFireChance = 0;
    let powerPlantCount = 0;
    let pickedFireTile: { x: number; y: number } | null = null;
    for (const t of grid.iter()) {
      if (t.zone === 'industrial' && t.density >= 2) {
        const tileChance = 0.012 * (t.hasFireProtection ? FIRE_PROTECTION_MULT : 1);
        weightedFireChance += tileChance;
        // Reservoir-sample the tile to be set on fire if a roll later succeeds.
        if (!pickedFireTile || rng() * weightedFireChance < tileChance) {
          pickedFireTile = { x: t.x, y: t.y };
        }
      }
      if (t.building === 'power_plant') powerPlantCount++;
    }

    // Industrial fire — chance scales with weighted industrial footprint.
    // Per-roll chance halved again per playtest feedback — notifications
    // were still firing too often even after the Alpha 2.12.1 cut.
    // Fire-station damping still multiplies on top via FIRE_PROTECTION_MULT.
    if (pickedFireTile && rng() < weightedFireChance * 0.275) {
      this.queueFire(grid, economy, pickedFireTile);
    }
    // Power plant outage — rare per plant.
    if (powerPlantCount > 0 && rng() < 0.007 * powerPlantCount) {
      this.queuePowerOutage(economy);
    }
    // Tax audit — only when the treasury has notable cash.
    if (economy.treasury > 100_000 && rng() < 0.007) {
      this.queueAudit(economy);
    }

    // Big events space themselves out — minimum 14-month gap so a
    // player isn't constantly reacting. Per-roll chances also halved
    // in the same pass that halved the hazard rolls above.
    if (this.monthsSinceBigEvent >= 14) {
      // Recession or boom — mutually exclusive, low odds.
      const econRoll = rng();
      if (econRoll < 0.0035) {
        this.queueRecession();
        this.monthsSinceBigEvent = 0;
        return;
      } else if (econRoll < 0.007) {
        this.queueBoom();
        this.monthsSinceBigEvent = 0;
        return;
      }

      // Trade deal — only if connected (city has a road touching the edge).
      // This is checked by GlobalMarket externally; we keep it simple here.
      if (rng() < 0.0045) {
        this.queueTradeDeal();
        this.monthsSinceBigEvent = 0;
        return;
      }

      // Lawsuit — RARE per user spec.
      if (rng() < 0.0025) {
        const furious = this.findFurious(happiness);
        if (furious) {
          this.queueLawsuit(furious);
          this.monthsSinceBigEvent = 0;
          return;
        }
      }
      // Referendum — RARE. Population gate, plus a faction with notable share.
      if (population.totalResidents > 800 && rng() < 0.002) {
        const proposer = this.pickReferendumProposer(population, council);
        if (proposer) {
          this.queueReferendum(proposer);
          this.monthsSinceBigEvent = 0;
          return;
        }
      }
    }
  }

  /**
   * Effective lumber-price multiplier this month after any active
   * MarketShock modifiers. Multiplicative on top of GlobalMarket's base.
   */
  lumberShockMult(): number {
    let m = 1;
    for (const mod of this.modifiers) if (mod.kind === 'market_shock') m *= mod.lumberMult;
    return m;
  }
  produceShockMult(): number {
    let m = 1;
    for (const mod of this.modifiers) if (mod.kind === 'market_shock') m *= mod.produceMult;
    return m;
  }
  /** Sum of active mood-modifier deltas for a faction. */
  factionMoodDelta(faction: FactionId): number {
    let d = 0;
    for (const mod of this.modifiers) {
      if (mod.kind === 'faction_mood' && mod.faction === faction) d += mod.delta;
    }
    return d;
  }
  demandShiftFor(zone: Zone): number {
    let d = 0;
    for (const mod of this.modifiers) {
      if (mod.kind === 'demand_shift' && mod.zone === zone) d += mod.delta;
    }
    return d;
  }

  // ---- Internal: queue specific events ----

  private queueFire(grid: Grid, economy: Economy, tile: { x: number; y: number }): void {
    // Apply damage immediately: the affected industrial tile loses one
    // density tier and the city pays $500 in emergency response.
    const t = grid.get(tile.x, tile.y);
    if (t && t.density > 0) {
      t.density = Math.max(0, t.density - 1) as 0 | 1 | 2 | 3;
      t.developmentPressure = 0;
    }
    economy.treasury -= 500;
    this.modifiers.push({ kind: 'faction_mood', faction: 'environmentalists', delta: -0.08, monthsLeft: 3 });
    this.modifiers.push({ kind: 'faction_mood', faction: 'safer_streets', delta: -0.10, monthsLeft: 3 });
    this.pending.push({
      id: 'fire-' + Date.now(),
      kind: 'fire',
      severity: 'danger',
      title: '🔥 Industrial fire',
      body: 'A blaze tore through one of your industrial blocks overnight. Operations halted, the building took damage, and the city paid $500 in emergency response. Environmentalists and safer-streets are watching closely.',
      herald: 'safer_streets',
      highlight: tile
    });
  }

  private queuePowerOutage(economy: Economy): void {
    economy.treasury -= 200;
    this.modifiers.push({ kind: 'faction_mood', faction: 'taxpayers', delta: -0.04, monthsLeft: 1 });
    this.modifiers.push({ kind: 'faction_mood', faction: 'working_families', delta: -0.04, monthsLeft: 1 });
    this.pending.push({
      id: 'outage-' + Date.now(),
      kind: 'power_outage',
      severity: 'warning',
      title: '⚡ Power plant fault',
      body: 'A transformer failed at one of the plants. Emergency crew dispatched — $200 for the repair. Residents in coverage area went without power for the rest of the month.',
      herald: 'taxpayers'
    });
  }

  private queueAudit(economy: Economy): void {
    economy.treasury -= 5000;
    this.modifiers.push({ kind: 'faction_mood', faction: 'taxpayers', delta: 0.10, monthsLeft: 1 });
    this.pending.push({
      id: 'audit-' + Date.now(),
      kind: 'audit',
      severity: 'warning',
      title: '🧾 Tax audit',
      body: 'State auditors flagged discrepancies in the books and assessed $5,000 in remediation. Eleanor Vance over at Taxpayers is delighted by the rigour.',
      herald: 'taxpayers'
    });
  }

  private queueRecession(): void {
    this.modifiers.push({ kind: 'market_shock', lumberMult: 0.55, produceMult: 0.55, monthsLeft: 6 });
    this.modifiers.push({ kind: 'demand_shift', zone: 'commercial', delta: -0.18, monthsLeft: 6 });
    this.modifiers.push({ kind: 'faction_mood', faction: 'working_families', delta: -0.10, monthsLeft: 6 });
    this.modifiers.push({ kind: 'faction_mood', faction: 'chamber', delta: 0.05, monthsLeft: 6 });
    this.pending.push({
      id: 'recession-' + Date.now(),
      kind: 'recession',
      severity: 'danger',
      title: '📉 Regional recession',
      body: 'The whole region just slid into recession. Lumber and produce prices crashed. Commercial demand is going to drag for half a year. Working families are bracing for layoffs; Chamber types are calling for "deregulation".',
      herald: 'working_families'
    });
  }

  private queueBoom(): void {
    this.modifiers.push({ kind: 'market_shock', lumberMult: 1.35, produceMult: 1.30, monthsLeft: 4 });
    for (const id of ['nimbys', 'yimbys', 'environmentalists', 'hometown', 'chamber',
                      'transit', 'drivers', 'taxpayers', 'safer_streets', 'working_families'] as FactionId[]) {
      this.modifiers.push({ kind: 'faction_mood', faction: id, delta: 0.04, monthsLeft: 4 });
    }
    this.pending.push({
      id: 'boom-' + Date.now(),
      kind: 'boom',
      severity: 'info',
      title: '📈 Regional boom',
      body: 'The regional economy is firing on all cylinders. Lumber and produce both selling at a premium for the next four months. Almost everyone\'s in a better mood.',
      herald: 'chamber'
    });
  }

  private queueTradeDeal(): void {
    this.modifiers.push({ kind: 'market_shock', lumberMult: 1.20, produceMult: 1.15, monthsLeft: 3 });
    this.modifiers.push({ kind: 'faction_mood', faction: 'chamber', delta: 0.08, monthsLeft: 3 });
    this.pending.push({
      id: 'trade-' + Date.now(),
      kind: 'trade_deal',
      severity: 'info',
      title: '🤝 Regional trade pact',
      body: 'Negotiators in the capital signed a three-month trade pact. Export prices for our commodities are up modestly; Chad over at Chamber is taking a victory lap.',
      herald: 'chamber'
    });
  }

  private queueLawsuit(faction: FactionId): void {
    const f = FACTIONS.find((x) => x.id === faction);
    const name = f?.leaderName ?? faction;
    this.pending.push({
      id: 'lawsuit-' + Date.now(),
      kind: 'lawsuit',
      severity: 'choice',
      title: `⚖️ ${name} v. The City`,
      body: `${name} filed a lawsuit alleging the administration's recent decisions caused harm to their community. You can settle out of court for $5,000, or fight the case in front of a judge — win and you owe nothing, lose and it'll cost $15,000 plus an apology that boosts ${name}\'s standing.`,
      herald: faction,
      choices: [
        { id: 'settle', label: 'Settle ($5,000)', hint: 'Pay the settlement; case closed.' },
        { id: 'fight', label: 'Fight in court', hint: '50/50: win = no cost; lose = $15,000 + appeasement.' }
      ]
    });
  }

  private queueReferendum(proposal: { faction: FactionId; kind: 'lower_r' | 'lower_c' | 'lower_i' | 'raise_r' }): void {
    const f = FACTIONS.find((x) => x.id === proposal.faction);
    const name = f?.leaderName ?? proposal.faction;
    const change =
      proposal.kind === 'lower_r' ? 'lower the residential tax by 2 points'
      : proposal.kind === 'lower_c' ? 'lower the commercial tax by 2 points'
      : proposal.kind === 'lower_i' ? 'lower the industrial tax by 2 points'
      : 'raise the residential tax by 2 points';
    this.pending.push({
      id: 'referendum-' + Date.now() + '-' + proposal.kind,
      kind: 'referendum',
      severity: 'choice',
      title: `🗳️ Referendum: ${name}`,
      body: `${name}\'s coalition gathered enough signatures to force a vote — the proposal: ${change}. Your office can sign it into law as written, or veto and let the question die.`,
      herald: proposal.faction,
      choices: [
        { id: 'sign-' + proposal.kind, label: 'Sign into law', hint: 'Apply the proposed tax change.' },
        { id: 'veto', label: 'Veto', hint: 'Decline; proposal dies, faction takes a small mood hit.' }
      ]
    });
  }

  // ---- Helpers ----

  private decayMonth(): void {
    for (let i = this.modifiers.length - 1; i >= 0; i--) {
      this.modifiers[i]!.monthsLeft--;
      if (this.modifiers[i]!.monthsLeft <= 0) this.modifiers.splice(i, 1);
    }
  }

  private findFurious(happiness: Happiness): FactionId | null {
    let worst: FactionId | null = null;
    let worstH = -0.6;
    for (const f of FACTIONS) {
      const h = happiness.get(f.id);
      if (h < worstH) { worst = f.id; worstH = h; }
    }
    return worst;
  }

  private pickReferendumProposer(
    population: Population, _council: Council
  ): { faction: FactionId; kind: 'lower_r' | 'lower_c' | 'lower_i' | 'raise_r' } | null {
    // Pick a faction with > 25% population share. They propose a tax
    // change that fits their vibe.
    const total = population.totalResidents;
    if (total <= 0) return null;
    let best: { faction: FactionId; share: number } | null = null;
    for (const f of FACTIONS) {
      const share = (population.factionPopulation.get(f.id) ?? 0) / total;
      if (share > 0.25 && (!best || share > best.share)) best = { faction: f.id, share };
    }
    if (!best) return null;
    const TAXY: Record<string, 'lower_r' | 'lower_c' | 'lower_i' | 'raise_r'> = {
      taxpayers: 'lower_r',
      working_families: 'lower_r',
      chamber: 'lower_c',
      drivers: 'lower_c',
      environmentalists: 'raise_r',
      transit: 'raise_r',
      nimbys: 'lower_r',
      yimbys: 'lower_c',
      hometown: 'lower_r',
      safer_streets: 'raise_r'
    };
    const kind = TAXY[best.faction] ?? 'lower_r';
    return { faction: best.faction, kind };
  }

  // ---- Save/restore ----

  serialize(): EventsSnapshot {
    return {
      modifiers: this.modifiers.map((m) => ({ ...m })),
      monthsSinceLastBigEvent: this.monthsSinceBigEvent
    };
  }
  restore(snap: EventsSnapshot | undefined): void {
    this.modifiers.length = 0;
    if (snap) {
      for (const m of snap.modifiers) this.modifiers.push({ ...m });
      this.monthsSinceBigEvent = snap.monthsSinceLastBigEvent;
    } else {
      this.monthsSinceBigEvent = 12;
    }
    this.pending.length = 0;
  }

  // ---- Choice resolution ----

  /**
   * Apply the consequences of a player choice on a choice-event.
   * Returns true if the choice was recognized.
   */
  resolveChoice(
    event: GameEvent, choiceId: string, economy: Economy, rng: () => number = Math.random
  ): boolean {
    if (event.kind === 'lawsuit') {
      if (choiceId === 'settle') {
        economy.treasury -= 5000;
        return true;
      }
      if (choiceId === 'fight') {
        if (rng() < 0.5) {
          // Win.
          this.modifiers.push({ kind: 'faction_mood', faction: event.herald ?? 'taxpayers', delta: -0.06, monthsLeft: 4 });
          return true;
        }
        economy.treasury -= 15000;
        this.modifiers.push({ kind: 'faction_mood', faction: event.herald ?? 'taxpayers', delta: 0.20, monthsLeft: 4 });
        return true;
      }
    }
    if (event.kind === 'referendum') {
      if (choiceId === 'veto') {
        if (event.herald) {
          this.modifiers.push({ kind: 'faction_mood', faction: event.herald, delta: -0.05, monthsLeft: 3 });
        }
        return true;
      }
      if (choiceId.startsWith('sign-')) {
        const kind = choiceId.slice(5);
        if (kind === 'lower_r') economy.taxR = Math.max(0, economy.taxR - 2);
        if (kind === 'lower_c') economy.taxC = Math.max(0, economy.taxC - 2);
        if (kind === 'lower_i') economy.taxI = Math.max(0, economy.taxI - 2);
        if (kind === 'raise_r') economy.taxR = Math.min(20, economy.taxR + 2);
        return true;
      }
    }
    return false;
  }
}
