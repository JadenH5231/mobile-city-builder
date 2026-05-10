import type { Economy } from '../simulation/Economy';
import { BOND_SPECS, MAX_ACTIVE_BONDS, type BondId, type Bonds } from '../simulation/Bonds';

const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

export function formatCurrency(value: number): string {
  return fmt.format(value);
}

/**
 * Slide-up budget sheet. Shows current treasury, last month's income and
 * expenses, and three R/C/I tax sliders. Sliders write directly into the
 * Economy on `input` so demand reacts in real time as the player drags.
 *
 * Open it by clicking the treasury pill in the HUD; close with the × or by
 * opening another panel (handled in main.ts / Game).
 */
export class BudgetPanel {
  private readonly el: HTMLElement;
  private readonly closeBtn: HTMLElement;

  private readonly treasuryEl: HTMLElement;
  private readonly incomeEl: HTMLElement;
  private readonly expensesEl: HTMLElement;
  private readonly netEl: HTMLElement;
  private readonly monthEl: HTMLElement;

  private readonly sliderR: HTMLInputElement;
  private readonly sliderC: HTMLInputElement;
  private readonly sliderI: HTMLInputElement;
  private readonly valueR: HTMLElement;
  private readonly valueC: HTMLElement;
  private readonly valueI: HTMLElement;

  /** Fired when the user closes via the close button. */
  onClose?: () => void;
  /** Fired when the player taps an "Issue bond" button. Game wires it to
   *  Game.issueBond which credits the principal + adds to active bonds. */
  onIssueBond?: (id: BondId) => void;

  constructor(private readonly economy: Economy, private readonly bonds: Bonds) {
    this.el = mustGet('budget-panel');
    this.closeBtn = mustGet('budget-close');

    this.treasuryEl = mustGet('budget-treasury');
    this.incomeEl = mustGet('budget-income');
    this.expensesEl = mustGet('budget-expenses');
    this.netEl = mustGet('budget-net');
    this.monthEl = mustGet('budget-month');

    this.sliderR = mustGet('tax-r') as HTMLInputElement;
    this.sliderC = mustGet('tax-c') as HTMLInputElement;
    this.sliderI = mustGet('tax-i') as HTMLInputElement;
    this.valueR = mustGet('tax-r-val');
    this.valueC = mustGet('tax-c-val');
    this.valueI = mustGet('tax-i-val');

    // Sync sliders to current Economy state on construction.
    this.sliderR.value = String(economy.taxR);
    this.sliderC.value = String(economy.taxC);
    this.sliderI.value = String(economy.taxI);
    this.valueR.textContent = String(economy.taxR);
    this.valueC.textContent = String(economy.taxC);
    this.valueI.textContent = String(economy.taxI);

    // Live binding: each input event updates Economy + the percent display.
    this.sliderR.addEventListener('input', () => {
      const v = Number(this.sliderR.value);
      this.economy.taxR = v;
      this.valueR.textContent = String(v);
    });
    this.sliderC.addEventListener('input', () => {
      const v = Number(this.sliderC.value);
      this.economy.taxC = v;
      this.valueC.textContent = String(v);
    });
    this.sliderI.addEventListener('input', () => {
      const v = Number(this.sliderI.value);
      this.economy.taxI = v;
      this.valueI.textContent = String(v);
    });

    // Wealth surtax slider (Alpha 2.18). 0..30%. Lives in the optional
    // `tax-surtax` row — guarded so older builds without the slider in
    // index.html still load.
    const surtaxSlider = document.getElementById('tax-surtax') as HTMLInputElement | null;
    const surtaxVal = document.getElementById('tax-surtax-val');
    if (surtaxSlider && surtaxVal) {
      surtaxSlider.value = String(economy.wealthSurtax);
      surtaxVal.textContent = String(economy.wealthSurtax);
      surtaxSlider.addEventListener('input', () => {
        const v = Number(surtaxSlider.value);
        economy.wealthSurtax = v;
        surtaxVal.textContent = String(v);
      });
    }

    // Bond-issuance buttons. One per spec — disabled when at the cap or
    // when treasury can't make next month's payment plus this one.
    for (const spec of BOND_SPECS) {
      const btn = document.getElementById(`bond-issue-${spec.id}`) as HTMLButtonElement | null;
      if (!btn) continue;
      btn.addEventListener('click', () => this.onIssueBond?.(spec.id));
    }

    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });
  }

  show(): void {
    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
    this.refresh();
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
  }

  isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  /** Re-read Economy state and update the displayed numbers. */
  refresh(): void {
    this.treasuryEl.textContent = formatCurrency(this.economy.treasury);
    setNegative(this.treasuryEl, this.economy.treasury < 0);

    this.incomeEl.textContent = formatCurrency(this.economy.lastRevenue);
    this.expensesEl.textContent = formatCurrency(-this.economy.lastExpenses);

    const net = this.economy.lastRevenue - this.economy.lastExpenses;
    this.netEl.textContent = formatCurrency(net);
    setNegative(this.netEl, net < 0);

    this.monthEl.textContent = `Month ${this.economy.monthsElapsed}`;

    // Accident readout — last completed month's count + cost. Hidden if zero.
    const accidentsEl = document.getElementById('budget-accidents');
    const accidentsCostEl = document.getElementById('budget-accidents-cost');
    const accidentsRow = document.getElementById('budget-accidents-row');
    if (accidentsEl && accidentsCostEl && accidentsRow) {
      const cost = this.economy.lastAccidentCost;
      const total = this.economy.totalAccidents;
      if (total > 0 || cost > 0) {
        accidentsRow.classList.remove('hidden');
        accidentsEl.textContent = String(total);
        accidentsCostEl.textContent = formatCurrency(-cost);
        setNegative(accidentsCostEl, cost > 0);
      } else {
        accidentsRow.classList.add('hidden');
      }
    }
    this.refreshBondsUI();
  }

  private refreshBondsUI(): void {
    const activeListEl = document.getElementById('bonds-active-list');
    if (activeListEl) {
      activeListEl.innerHTML = '';
      if (this.bonds.active.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'bonds__empty';
        empty.textContent = 'No outstanding debt';
        activeListEl.appendChild(empty);
      } else {
        for (const b of this.bonds.active) {
          const row = document.createElement('div');
          row.className = 'bonds__active-row' + (b.hasDefaulted ? ' bonds__active-row--defaulted' : '');
          row.innerHTML = `
            <span class="bonds__active-name">${labelFor(b.specId)}</span>
            <span class="bonds__active-pay mono">${formatCurrency(b.monthlyPayment)}/mo</span>
            <span class="bonds__active-rem mono">${b.monthsRemaining}mo left</span>
          `;
          activeListEl.appendChild(row);
        }
      }
    }
    // Per-bond issue button — disabled when at the cap.
    const atCap = this.bonds.active.length >= MAX_ACTIVE_BONDS;
    for (const spec of BOND_SPECS) {
      const btn = document.getElementById(`bond-issue-${spec.id}`) as HTMLButtonElement | null;
      if (!btn) continue;
      btn.disabled = atCap;
      btn.title = atCap ? `At the bond limit (${MAX_ACTIVE_BONDS} active)` : '';
    }
    // Total monthly debt service.
    const debtEl = document.getElementById('bonds-monthly-debt');
    if (debtEl) {
      const total = this.bonds.totalMonthlyDebtService();
      debtEl.textContent = total > 0 ? `Monthly debt service: ${formatCurrency(total)}` : '';
    }
  }
}

function labelFor(id: BondId): string {
  const spec = BOND_SPECS.find((s) => s.id === id);
  return spec ? spec.label : id;
}

function setNegative(el: HTMLElement, negative: boolean): void {
  el.classList.toggle('budget__value--negative', negative);
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`BudgetPanel: missing #${id}`);
  return el;
}
