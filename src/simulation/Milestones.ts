import { MILESTONES, STARTING_TOOLS, type Milestone, type MilestoneId, type Tool } from '../types';

/**
 * City milestone tracker (Alpha 2.8). Watches population and earns the
 * Milestones in `MILESTONES` when their thresholds are crossed. Each
 * earned milestone unlocks a slice of the toolbar — fresh cities boot
 * with a starter set; everything else is gated.
 *
 * Persisted shape: `highestPop` (max of all sim ticks). On load, the
 * earned set is reconstructed deterministically from `highestPop` so
 * old v8 saves loaded after this update don't lose access to anything
 * they already had built.
 *
 * Also fires `onEarned(milestone)` for the celebration banner — the
 * call is queued in the next animation frame so it doesn't pile up
 * inside a sim tick.
 */
export class Milestones {
  /** Highest residents-count this city has ever reached. Survives dips. */
  highestPop = 0;
  /** Set of milestone ids the city has crossed. Derived from highestPop. */
  readonly earned = new Set<MilestoneId>();
  /** Tools unlocked above STARTING_TOOLS. Recomputed on every earn. */
  readonly unlockedTools = new Set<Tool>();
  /** Pending celebration banners — pulled by main.ts and shown one at a time. */
  private readonly pending: Milestone[] = [];
  /**
   * Flag set after restore from a save that lacked a `highestPop` (v8
   * and earlier). The next tick absorbs the population catchup silently
   * — existing players don't get a wave of "you earned Hamlet!" banners
   * for milestones they already met in a previous session.
   */
  private silentNextTick = false;

  constructor() {
    this.recomputeUnlockSet();
  }

  /**
   * Run from the sim loop. Updates highestPop and fires any newly-earned
   * milestones. Returns true iff at least one milestone was earned this
   * tick (caller may want to refresh toolbar / show banner).
   */
  tick(currentPop: number): boolean {
    const before = this.highestPop;
    if (currentPop > this.highestPop) this.highestPop = currentPop;
    if (this.highestPop === before) return false;
    let any = false;
    for (const m of MILESTONES) {
      if (this.highestPop >= m.popThreshold && !this.earned.has(m.id)) {
        this.earned.add(m.id);
        for (const t of m.unlocks) this.unlockedTools.add(t);
        if (!this.silentNextTick) this.pending.push(m);
        any = true;
      }
    }
    if (this.silentNextTick) this.silentNextTick = false;
    return any;
  }

  /** True if the tool is available right now (starter or earned). */
  isUnlocked(tool: Tool): boolean {
    return STARTING_TOOLS.has(tool) || this.unlockedTools.has(tool);
  }

  /** Returns + removes the next pending milestone for the banner. */
  shiftPending(): Milestone | undefined {
    return this.pending.shift();
  }
  hasPending(): boolean {
    return this.pending.length > 0;
  }

  /**
   * Walk the milestones list and return the first one that hasn't been
   * earned yet — i.e. the player's "next goal". Used in the toolbar
   * lock tooltip so a 🔒 button can show "Unlocks at Town · 500 pop".
   */
  nextMilestone(): Milestone | undefined {
    for (const m of MILESTONES) if (!this.earned.has(m.id)) return m;
    return undefined;
  }

  /** Find the milestone that gates a specific tool, if any. */
  milestoneForTool(tool: Tool): Milestone | undefined {
    for (const m of MILESTONES) if (m.unlocks.includes(tool)) return m;
    return undefined;
  }

  /**
   * Restore from save. Sets highestPop and re-derives the earned set +
   * unlock set. Does NOT push pending banners — restoring a save
   * shouldn't celebrate things the player earned in a previous session.
   */
  applyHighestPop(pop: number): void {
    this.highestPop = Math.max(0, pop | 0);
    this.earned.clear();
    this.pending.length = 0;
    for (const m of MILESTONES) {
      if (this.highestPop >= m.popThreshold) this.earned.add(m.id);
    }
    this.recomputeUnlockSet();
    // Suppress banners on the first tick after restore — that tick is
    // catchup from a save (especially v8 saves with no highestPop) and
    // shouldn't replay decade-old milestones at the player.
    this.silentNextTick = true;
  }

  private recomputeUnlockSet(): void {
    this.unlockedTools.clear();
    for (const m of MILESTONES) {
      if (this.earned.has(m.id)) {
        for (const t of m.unlocks) this.unlockedTools.add(t);
      }
    }
  }
}
