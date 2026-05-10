import { FACTIONS, type FactionId } from '../simulation/Happiness';

/**
 * One-time popup shown when a council leader the player hasn't met yet
 * takes a seat. Each faction has a `bio` + `cares` blurb on its Faction
 * row; this surface puts a face to the name.
 *
 * Multiple new leaders in a single election are queued and shown one by
 * one — the player taps "Got it" to advance. Suppressed entirely on the
 * first election if the player already met those leaders in a prior
 * session (Achievements.metLeaders is the source of truth).
 */
export class LeaderBioModal {
  private readonly el: HTMLElement;
  private readonly avatarEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly factionEl: HTMLElement;
  private readonly bioEl: HTMLElement;
  private readonly caresEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly queue: FactionId[] = [];
  private current: FactionId | null = null;

  /** Optional callback fired once a leader has been shown + dismissed. */
  onDismiss?: (id: FactionId) => void;

  constructor() {
    this.el = mustGet('leader-bio-modal');
    this.avatarEl = mustGet('leader-bio-avatar');
    this.nameEl = mustGet('leader-bio-name');
    this.titleEl = mustGet('leader-bio-title');
    this.factionEl = mustGet('leader-bio-faction');
    this.bioEl = mustGet('leader-bio-bio');
    this.caresEl = mustGet('leader-bio-cares');
    this.closeBtn = mustGet('leader-bio-close') as HTMLButtonElement;
    this.closeBtn.addEventListener('click', () => this.advance());
  }

  enqueue(id: FactionId): void {
    this.queue.push(id);
    if (!this.current) this.showNext();
    else this.refreshButtonLabel();
  }

  private refreshButtonLabel(): void {
    this.closeBtn.textContent = this.queue.length > 0
      ? `Meet next leader (${this.queue.length} more)`
      : 'Got it';
  }

  private showNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.current = null;
      this.hide();
      return;
    }
    this.current = next;
    const f = FACTIONS.find((x) => x.id === next);
    if (!f) {
      // Stay defensive — skip unknowns rather than crash on a faction id
      // that's been retired from a future build.
      this.advance();
      return;
    }
    this.avatarEl.textContent = initialsFor(f.leaderName);
    const hex = `#${f.color.toString(16).padStart(6, '0')}`;
    this.avatarEl.style.background = `${hex}33`;
    this.avatarEl.style.borderColor = `${hex}aa`;
    this.avatarEl.style.color = hex;
    this.nameEl.textContent = f.leaderName;
    this.titleEl.textContent = f.leaderTitle;
    this.factionEl.textContent = `Now seated on the council — ${f.name}`;
    this.bioEl.textContent = f.bio;
    this.caresEl.textContent = `Issues they champion: ${f.cares}`;
    this.refreshButtonLabel();
    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
  }

  private advance(): void {
    const dismissed = this.current;
    this.current = null;
    if (dismissed) this.onDismiss?.(dismissed);
    this.showNext();
  }

  private hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
  }
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '★';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}
