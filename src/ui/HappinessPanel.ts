import type { Economy } from '../simulation/Economy';
import type { Population } from '../simulation/Population';
import type { Traffic } from '../simulation/Traffic';
import type { Grid } from '../world/Grid';
import {
  FACTIONS,
  bucketOf,
  overallLabel,
  pickComment,
  type Faction,
  type Happiness
} from '../simulation/Happiness';

interface Deps {
  readonly happiness: Happiness;
  readonly grid: () => Grid;
  readonly economy: Economy;
  readonly population: Population;
  readonly traffic: Traffic;
}

/**
 * Bottom-sheet "City Sentiment" feed. Each faction is rendered as a
 * Facebook-style post — leader avatar (initials in the faction's accent
 * colour), name + title, the comment for their current mood, and a small
 * happiness bar.
 *
 * The DOM is built once; refresh() updates the comment text and the bar.
 * The leader's avatar / name / title don't change so we don't touch them.
 */
export class HappinessPanel {
  private readonly el: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly overallEl: HTMLElement;
  private readonly rows = new Map<string, FactionRow>();
  onClose?: () => void;

  constructor(private readonly deps: Deps) {
    this.el = mustGet('happiness-panel');
    this.closeBtn = mustGet('happiness-close');
    this.listEl = mustGet('happiness-list');
    this.overallEl = mustGet('happiness-overall');

    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });

    this.buildRows();
  }

  private buildRows(): void {
    this.listEl.innerHTML = '';
    for (const f of FACTIONS) {
      const row = makeFactionRow(f);
      this.listEl.appendChild(row.el);
      this.rows.set(f.id, row);
    }
  }

  show(): void {
    this.refresh();
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

  /**
   * Recompute all faction happiness from current state and refresh visible
   * comment + bar for every leader. Cheap — one grid sweep + 10 small
   * scoring calls. Safe to call at HUD refresh rate.
   */
  refresh(): void {
    this.deps.happiness.computeAll(
      this.deps.grid(),
      this.deps.economy,
      this.deps.population,
      this.deps.traffic
    );
    const overall = this.deps.happiness.overall();
    this.overallEl.textContent = `City mood: ${overallLabel(overall)}`;
    this.overallEl.dataset.bucket = bucketOf(overall);

    // Salt the comment-picker by months-elapsed × bucket so the message
    // stays stable but rotates when the player's situation actually moves.
    const months = this.deps.economy.monthsElapsed;

    for (const f of FACTIONS) {
      const h = this.deps.happiness.get(f.id);
      const row = this.rows.get(f.id);
      if (!row) continue;
      const bucket = bucketOf(h);
      const salt = months + bucketToSalt(bucket) * 7;
      row.commentEl.textContent = pickComment(f, h, salt);
      row.barFill.style.width = `${happinessToPct(h)}%`;
      row.barFill.style.background = barColor(h);
      row.el.dataset.bucket = bucket;
      row.moodEl.textContent = bucketLabel(bucket);
    }
  }
}

interface FactionRow {
  el: HTMLElement;
  commentEl: HTMLElement;
  barFill: HTMLElement;
  moodEl: HTMLElement;
}

function makeFactionRow(f: Faction): FactionRow {
  const wrap = document.createElement('article');
  wrap.className = 'happiness__row';
  wrap.dataset.faction = f.id;
  wrap.innerHTML = `
    <div class="happiness__avatar" style="background:#${f.color.toString(16).padStart(6, '0')}">${avatarInitials(f.leaderName)}</div>
    <div class="happiness__body">
      <div class="happiness__head">
        <span class="happiness__name">${escapeHtml(f.leaderName)}</span>
        <span class="happiness__mood"></span>
      </div>
      <div class="happiness__title">${escapeHtml(f.leaderTitle)} — ${escapeHtml(f.name)}</div>
      <div class="happiness__comment"></div>
      <div class="happiness__cares">${escapeHtml(f.cares)}</div>
      <div class="happiness__bar"><div class="happiness__bar-fill"></div></div>
    </div>
  `;
  const commentEl = wrap.querySelector('.happiness__comment') as HTMLElement;
  const barFill = wrap.querySelector('.happiness__bar-fill') as HTMLElement;
  const moodEl = wrap.querySelector('.happiness__mood') as HTMLElement;
  return { el: wrap, commentEl, barFill, moodEl };
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function happinessToPct(h: number): number {
  // Map [-1, 1] to [0, 100]. Centre is 50%.
  return Math.round(((h + 1) / 2) * 100);
}

function barColor(h: number): string {
  if (h >= 0.4) return '#6dd06a';
  if (h >= 0.0) return '#a8c97f';
  if (h >= -0.4) return '#eec453';
  return '#d06a8a';
}

function bucketLabel(b: ReturnType<typeof bucketOf>): string {
  switch (b) {
    case 'elated': return 'elated 💚';
    case 'happy': return 'happy';
    case 'neutral': return 'mixed';
    case 'unhappy': return 'restless';
    case 'furious': return 'furious 😡';
  }
}

function bucketToSalt(b: ReturnType<typeof bucketOf>): number {
  switch (b) {
    case 'elated': return 0;
    case 'happy': return 1;
    case 'neutral': return 2;
    case 'unhappy': return 3;
    case 'furious': return 4;
  }
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
  if (!el) throw new Error(`HappinessPanel: missing #${id}`);
  return el;
}
