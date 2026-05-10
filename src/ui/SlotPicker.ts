import { SaveGame, SLOT_KEYS, type SlotSummary } from '../persistence/SaveGame';
import { formatCurrency } from './BudgetPanel';

/**
 * Slot picker (Alpha 2.20). 3-up modal that lists each save slot's
 * summary (city name, pop, treasury, last played) and lets the player
 * pick one. Selected slot is written to localStorage; the caller
 * (main.ts) re-init's the game with that slot.
 *
 * The first slot remains the legacy 'main' key so a single-slot save
 * from before 2.20 lands on Slot 1.
 */
export class SlotPicker {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly closeBtn: HTMLElement;

  /** Called with the chosen slot key. The caller commits to localStorage
   *  and triggers a reload (or game-state swap). */
  onPick?: (slotKey: string) => void;

  constructor(private readonly saveGame: SaveGame) {
    this.el = mustGet('slot-picker');
    this.listEl = mustGet('slot-picker-list');
    this.closeBtn = mustGet('slot-picker-close');
    this.closeBtn.addEventListener('click', () => this.hide());
  }

  async show(): Promise<void> {
    await this.refresh();
    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
  }
  hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
  }
  isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  private async refresh(): Promise<void> {
    this.listEl.innerHTML = '';
    const summaries = await Promise.all(SLOT_KEYS.map((k) => this.saveGame.loadSummary(k)));
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const slot = SLOT_KEYS[i]!;
      const summary = summaries[i];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'slot-card' + (summary ? ' slot-card--filled' : ' slot-card--empty');
      card.dataset.slot = slot;
      const isCurrent = slot === this.saveGame.currentSlot();
      if (isCurrent) card.classList.add('slot-card--current');
      card.innerHTML = renderSlotCard(i + 1, slot, summary, isCurrent);
      card.addEventListener('click', () => {
        this.onPick?.(slot);
      });
      this.listEl.appendChild(card);
    }
  }
}

function renderSlotCard(slotNumber: number, slotKey: string, summary: SlotSummary | undefined, isCurrent: boolean): string {
  const head = summary?.cityName?.trim() || `City ${slotNumber}`;
  if (!summary) {
    return `
      <div class="slot-card__head">
        <div class="slot-card__title">Slot ${slotNumber}</div>
        <div class="slot-card__badge">Empty</div>
      </div>
      <div class="slot-card__body">Tap to start a new city here.</div>
    `;
  }
  const lastPlayed = summary.lastPlayedISO ? formatRelative(new Date(summary.lastPlayedISO)) : '';
  return `
    <div class="slot-card__head">
      <div class="slot-card__title">${escapeHtml(head)}</div>
      <div class="slot-card__badge">${isCurrent ? 'Active' : `Slot ${slotNumber}`}</div>
    </div>
    <div class="slot-card__body">
      <div class="slot-card__row"><span>Population</span><span class="mono">${summary.highestPop.toLocaleString()}</span></div>
      <div class="slot-card__row"><span>Treasury</span><span class="mono">${formatCurrency(summary.treasury)}</span></div>
      <div class="slot-card__row"><span>Months</span><span class="mono">${summary.monthsElapsed.toLocaleString()}</span></div>
      ${lastPlayed ? `<div class="slot-card__time">Last played ${escapeHtml(lastPlayed)}</div>` : ''}
    </div>
    <div class="slot-card__hint">${slotKey === 'main' && slotNumber === 1 ? 'Pre-2.20 saves live here' : ''}</div>
  `;
}

function formatRelative(d: Date): string {
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}
