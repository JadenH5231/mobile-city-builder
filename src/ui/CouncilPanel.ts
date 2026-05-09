import type { Council, ElectionResult } from '../simulation/Council';
import { FACTIONS } from '../simulation/Happiness';

/**
 * Modal popup that auto-opens after each election. Shows mayor / opponent
 * vote split, the four winning council seats, and a sortable vote-share
 * table for context. Dismissed with the close button.
 *
 * Future: tap a councillor row to expand their bio / current platform.
 */
export class CouncilPanel {
  private readonly el: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private readonly mayorPctEl: HTMLElement;
  private readonly opponentNameEl: HTMLElement;
  private readonly opponentPctEl: HTMLElement;
  private readonly councilListEl: HTMLElement;
  private readonly voteListEl: HTMLElement;
  private readonly termEl: HTMLElement;

  constructor(private readonly council: Council) {
    this.el = mustGet('council-panel');
    this.closeBtn = mustGet('council-close');
    this.mayorPctEl = mustGet('council-mayor-pct');
    this.opponentNameEl = mustGet('council-opponent-name');
    this.opponentPctEl = mustGet('council-opponent-pct');
    this.councilListEl = mustGet('council-list');
    this.voteListEl = mustGet('council-vote-list');
    this.termEl = mustGet('council-term');

    this.closeBtn.addEventListener('click', () => this.hide());
    const dismissBtn = document.getElementById('council-dismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', () => this.hide());
  }

  show(): void {
    const r = this.council.pendingResult;
    if (!r) return;
    this.render(r);
    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
    this.council.acknowledgeResult();
  }

  isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  private render(r: ElectionResult): void {
    this.termEl.textContent = `Term ${r.term} — Greenmeadow Election Results`;
    this.mayorPctEl.textContent = `${r.mayorPct.toFixed(4)}%`;

    const opponentFaction = FACTIONS.find((f) => f.id === r.opponentId);
    this.opponentNameEl.textContent = opponentFaction?.leaderName ?? r.opponentId;
    this.opponentPctEl.textContent = `${r.opponentPct.toFixed(4)}%`;

    // New council members.
    this.councilListEl.innerHTML = '';
    for (const id of r.councillors) {
      const f = FACTIONS.find((x) => x.id === id);
      if (!f) continue;
      const li = document.createElement('li');
      li.className = 'council__member';
      li.style.borderLeftColor = `#${f.color.toString(16).padStart(6, '0')}`;
      li.innerHTML = `
        <div class="council__member-avatar" style="background:#${f.color.toString(16).padStart(6, '0')}">${avatarInitials(f.leaderName)}</div>
        <div>
          <div class="council__member-name">${escapeHtml(f.leaderName)}</div>
          <div class="council__member-title">${escapeHtml(f.leaderTitle)} — ${escapeHtml(f.name)}</div>
        </div>
      `;
      this.councilListEl.appendChild(li);
    }

    // Full vote share table.
    this.voteListEl.innerHTML = '';
    for (const v of r.voteSorted) {
      const f = FACTIONS.find((x) => x.id === v.id);
      if (!f) continue;
      const isOpponent = v.id === r.opponentId;
      const isCouncil = r.councillors.includes(v.id);
      const tag = isOpponent ? 'opponent' : isCouncil ? 'council' : '';
      const row = document.createElement('div');
      row.className = 'council__vote-row';
      if (tag) row.dataset.tag = tag;
      row.innerHTML = `
        <span class="council__vote-faction">${escapeHtml(f.name)}</span>
        <span class="council__vote-pct">${v.pct.toFixed(1)}%</span>
        ${tag ? `<span class="council__vote-tag">${tag}</span>` : ''}
      `;
      this.voteListEl.appendChild(row);
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
  if (!el) throw new Error(`CouncilPanel: missing #${id}`);
  return el;
}
