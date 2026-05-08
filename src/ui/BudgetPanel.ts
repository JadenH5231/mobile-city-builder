import type { Economy } from '../simulation/Economy';

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

  constructor(private readonly economy: Economy) {
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
  }
}

function setNegative(el: HTMLElement, negative: boolean): void {
  el.classList.toggle('budget__value--negative', negative);
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`BudgetPanel: missing #${id}`);
  return el;
}
