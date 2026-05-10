import type { Economy } from './Economy';

/**
 * Municipal bonds (Alpha 2.18). The player can issue up to MAX_ACTIVE_BONDS
 * concurrent bonds at the budget panel. Each bond has:
 *
 *  - A one-shot principal credited to the treasury at issuance.
 *  - A fixed monthly payment auto-deducted from Economy.runMonth.
 *  - A fixed term in months. Bond auto-retires once paid in full.
 *
 * Total payback exceeds the principal — that delta is the interest the
 * municipal bond market charges. Smaller bonds are more expensive (higher
 * effective APR) so the system rewards a few big issues over many small
 * ones; the player who borrows wisely pays less.
 *
 * Default behaviour: if treasury can't cover a bond payment when the month
 * settles, the bond is marked `defaulted` and the system logs a $0 payment
 * for that month. The Game wires defaulted bonds to a happiness hit on
 * taxpayers + a one-time PC penalty so default isn't a free skip.
 */

export type BondId = 'small' | 'medium' | 'large';

export interface BondSpec {
  readonly id: BondId;
  readonly label: string;
  readonly principal: number;
  readonly monthlyPayment: number;
  readonly termMonths: number;
}

/**
 * Bond catalog. Tuned so:
 *  - Small ($5k) is the panic-button bond — ~20% premium over principal.
 *    Easy to take, expensive over time.
 *  - Medium ($15k) is the workhorse — ~12% premium. Reasonable for
 *    funding a service expansion.
 *  - Large ($40k) is the long-term build bond — ~8% premium. Still net
 *    positive interest, but the bond market gives you a discount because
 *    you're a credible borrower.
 */
export const BOND_SPECS: readonly BondSpec[] = [
  { id: 'small',  label: 'Small bond',  principal: 5000,  monthlyPayment: 250,  termMonths: 24 },
  { id: 'medium', label: 'Medium bond', principal: 15000, monthlyPayment: 700,  termMonths: 24 },
  { id: 'large',  label: 'Large bond',  principal: 40000, monthlyPayment: 1800, termMonths: 24 }
];

/** Hard cap on simultaneous outstanding bonds. */
export const MAX_ACTIVE_BONDS = 3;

export interface ActiveBond {
  readonly specId: BondId;
  /** Sim month the bond was issued (for budget-panel display). */
  readonly issuedMonth: number;
  /** Monthly payment in $ (cached from spec for display). */
  readonly monthlyPayment: number;
  /** Months still owed at month-rollover. Counts down to 0. */
  monthsRemaining: number;
  /** Lifetime missed-payments flag — drives the default happiness hit. */
  hasDefaulted: boolean;
}

/** Persisted shape — array of active bonds + lifetime tally. */
export interface BondsSnapshot {
  active: ActiveBond[];
  lifetimeIssued: number;
  lifetimeDefaults: number;
}

export class Bonds {
  /** Active bonds in issuance order. Cleared one at a time as terms expire. */
  readonly active: ActiveBond[] = [];
  /** Lifetime number of bonds issued (achievements + flavour). */
  lifetimeIssued = 0;
  /** Lifetime months a bond payment defaulted. */
  lifetimeDefaults = 0;
  /** Did a bond default this month? Set by tickMonth, read + cleared by Game. */
  defaultedThisMonth = false;

  /**
   * Try to issue a bond of the given spec id. Returns the credited principal
   * on success, or 0 if the issuance was rejected (cap reached, unknown id).
   * Caller is expected to add the principal to the treasury.
   */
  issue(specId: BondId, currentMonth: number): number {
    if (this.active.length >= MAX_ACTIVE_BONDS) return 0;
    const spec = BOND_SPECS.find((s) => s.id === specId);
    if (!spec) return 0;
    this.active.push({
      specId: spec.id,
      issuedMonth: currentMonth,
      monthlyPayment: spec.monthlyPayment,
      monthsRemaining: spec.termMonths,
      hasDefaulted: false
    });
    this.lifetimeIssued++;
    return spec.principal;
  }

  /**
   * Run the monthly debt service. Mutates `economy.treasury` directly.
   * Returns the total debt-service expense for budget-panel display.
   *
   * Default rule: if treasury cannot cover ALL bond payments this month,
   * deduct what we can and mark every unpaid bond as defaulted. Term
   * counter still ticks (defaulting doesn't extend the loan), but the
   * bond record carries a stigma the Game can read.
   */
  tickMonth(economy: Economy): number {
    if (this.active.length === 0) return 0;
    let totalDue = 0;
    for (const b of this.active) totalDue += b.monthlyPayment;
    let paid: number;
    if (economy.treasury >= totalDue) {
      paid = totalDue;
      economy.treasury -= totalDue;
    } else {
      paid = Math.max(0, economy.treasury);
      economy.treasury = Math.max(0, economy.treasury) - paid;
      this.defaultedThisMonth = true;
      this.lifetimeDefaults++;
      for (const b of this.active) b.hasDefaulted = true;
    }
    for (const b of this.active) b.monthsRemaining--;
    // Drop any bond that has fully amortised.
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i]!.monthsRemaining <= 0) this.active.splice(i, 1);
    }
    return paid;
  }

  /** Total monthly outflow on debt service — read by the budget panel. */
  totalMonthlyDebtService(): number {
    let sum = 0;
    for (const b of this.active) sum += b.monthlyPayment;
    return sum;
  }

  serialize(): BondsSnapshot {
    return {
      active: this.active.map((b) => ({ ...b })),
      lifetimeIssued: this.lifetimeIssued,
      lifetimeDefaults: this.lifetimeDefaults
    };
  }
  restore(snap?: BondsSnapshot): void {
    this.active.length = 0;
    this.lifetimeIssued = 0;
    this.lifetimeDefaults = 0;
    this.defaultedThisMonth = false;
    if (!snap) return;
    for (const b of snap.active) this.active.push({ ...b });
    this.lifetimeIssued = snap.lifetimeIssued ?? 0;
    this.lifetimeDefaults = snap.lifetimeDefaults ?? 0;
  }
}
