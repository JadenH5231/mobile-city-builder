import { FACTIONS } from '../simulation/Happiness';
import type { FactionId } from '../simulation/Happiness';
import { COSTS } from '../simulation/Council';

/**
 * Transient top-of-screen prompt that appears after the player places a
 * building strongly favoured by some faction. The leader of that faction
 * "wants a ribbon cutting" — player can attend (spend PC + cash, gain a
 * turnout boost for that faction at the next election) or skip.
 *
 * Auto-dismisses after AUTO_DISMISS_MS without action. A new placement
 * replaces the prompt — only one banner is queued at a time.
 */
const AUTO_DISMISS_MS = 10_000;

export class PhotoOpBanner {
  private readonly el: HTMLElement;
  private readonly avatarEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly attendBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private timeout: number | null = null;
  private currentAccept: (() => void) | null = null;

  constructor() {
    this.el = mustGet('photo-op-banner');
    this.avatarEl = mustGet('photo-op-avatar');
    this.textEl = mustGet('photo-op-text');
    this.attendBtn = mustGet('photo-op-attend') as HTMLButtonElement;
    this.skipBtn = mustGet('photo-op-skip') as HTMLButtonElement;

    this.attendBtn.addEventListener('click', () => {
      const cb = this.currentAccept;
      this.hide();
      if (cb) cb();
    });
    this.skipBtn.addEventListener('click', () => this.hide());
  }

  show(factionId: FactionId, onAccept: () => void): void {
    const f = FACTIONS.find((x) => x.id === factionId);
    if (!f) return;
    this.avatarEl.textContent = avatarInitials(f.leaderName);
    this.avatarEl.style.background = `#${f.color.toString(16).padStart(6, '0')}`;
    this.textEl.innerHTML =
      `<strong>${escapeHtml(f.leaderName)}</strong> wants a ribbon cutting!` +
      ` <span class="photo-op__cost">(${COSTS.photo_op_pc} PC + $${COSTS.photo_op_cash})</span>`;
    this.currentAccept = onAccept;
    this.el.classList.remove('hidden');
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = window.setTimeout(() => this.hide(), AUTO_DISMISS_MS);
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.currentAccept = null;
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`PhotoOpBanner: missing #${id}`);
  return el;
}
