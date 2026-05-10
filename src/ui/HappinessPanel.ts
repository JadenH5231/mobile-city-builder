import type { Economy } from '../simulation/Economy';
import type { Population } from '../simulation/Population';
import type { Traffic } from '../simulation/Traffic';
import type { Grid } from '../world/Grid';
import {
  FACTIONS,
  bucketOf,
  overallLabel,
  pickComment,
  pickOppositionTweet,
  type Faction,
  type FactionId,
  type Happiness
} from '../simulation/Happiness';
import {
  COSTS,
  COUNCIL_COMMENTS,
  PC_CAP,
  type Council
} from '../simulation/Council';
import type { Achievements } from '../simulation/Achievements';

interface Deps {
  readonly happiness: Happiness;
  readonly council: Council;
  readonly grid: () => Grid;
  readonly economy: Economy;
  readonly population: Population;
  readonly traffic: Traffic;
  /** Optional — bump lifetime counters when civic actions succeed. */
  readonly achievements?: Achievements;
}

type CivicAction = 'endorse' | 'coalition' | 'override';

/**
 * Bottom-sheet "City Sentiment" feed.
 *
 * Top-of-panel layout:
 *  - City mood line (existing).
 *  - Council bar — current council members + opponent, prominently shown.
 *  - Civic actions — Political Capital, action buttons (Endorse, Coalition,
 *    Mayoral Override). Each button opens a faction-picker modal.
 *
 * Below is the per-faction feed where each row shows the leader's mood,
 * comment (or city-hall mode if on council), residents, and a happiness bar.
 */
export class HappinessPanel {
  private readonly el: HTMLElement;
  private readonly closeBtn: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly overallEl: HTMLElement;

  // Council bar
  private readonly councilBarTitleEl: HTMLElement;
  private readonly councilBarSeatsEl: HTMLElement;
  private readonly councilBarOppEl: HTMLElement;

  // Civic action elements
  private readonly civicPcFillEl: HTMLElement;
  private readonly civicPcNumEl: HTMLElement;
  private readonly civicActiveEl: HTMLElement;
  private readonly btnEndorse: HTMLButtonElement;
  private readonly btnCoalition: HTMLButtonElement;
  private readonly btnOverride: HTMLButtonElement;

  // Civic action modal
  private readonly modalEl: HTMLElement;
  private readonly modalTitleEl: HTMLElement;
  private readonly modalSubEl: HTMLElement;
  private readonly modalListEl: HTMLElement;
  private readonly modalConfirmEl: HTMLButtonElement;
  private readonly modalCloseEl: HTMLElement;

  private readonly rows = new Map<string, FactionRow>();
  private currentAction: CivicAction | null = null;
  private currentSelections: FactionId[] = [];

  onClose?: () => void;

  constructor(private readonly deps: Deps) {
    this.el = mustGet('happiness-panel');
    this.closeBtn = mustGet('happiness-close');
    this.listEl = mustGet('happiness-list');
    this.overallEl = mustGet('happiness-overall');
    this.councilBarTitleEl = mustGet('council-bar-title');
    this.councilBarSeatsEl = mustGet('council-bar-seats');
    this.councilBarOppEl = mustGet('council-bar-opp');
    this.civicPcFillEl = mustGet('civic-pc-fill');
    this.civicPcNumEl = mustGet('civic-pc-num');
    this.civicActiveEl = mustGet('civic-active');
    this.btnEndorse = mustGet('civic-btn-endorse') as HTMLButtonElement;
    this.btnCoalition = mustGet('civic-btn-coalition') as HTMLButtonElement;
    this.btnOverride = mustGet('civic-btn-override') as HTMLButtonElement;

    this.modalEl = mustGet('civic-modal');
    this.modalTitleEl = mustGet('civic-modal-title');
    this.modalSubEl = mustGet('civic-modal-sub');
    this.modalListEl = mustGet('civic-modal-list');
    this.modalConfirmEl = mustGet('civic-modal-confirm') as HTMLButtonElement;
    this.modalCloseEl = mustGet('civic-modal-close');

    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });

    this.btnEndorse.addEventListener('click', () => this.openModal('endorse'));
    this.btnCoalition.addEventListener('click', () => this.openModal('coalition'));
    this.btnOverride.addEventListener('click', () => this.openModal('override'));
    this.modalCloseEl.addEventListener('click', () => this.closeModal());
    this.modalConfirmEl.addEventListener('click', () => this.confirmAction());

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
    this.closeModal();
  }

  isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  refresh(): void {
    const overall = this.deps.happiness.overall();
    this.overallEl.textContent = `City mood: ${overallLabel(overall)}`;
    this.overallEl.dataset.bucket = bucketOf(overall);

    this.refreshCouncilBar();
    this.refreshCivicSection();

    const months = this.deps.economy.monthsElapsed;
    const totalDisplayed = Math.round(this.deps.population.totalResidents);

    for (const f of FACTIONS) {
      const h = this.deps.happiness.get(f.id);
      const row = this.rows.get(f.id);
      if (!row) continue;
      const bucket = bucketOf(h);
      const salt = months + bucketToSalt(bucket) * 7;
      const onCouncil = this.deps.council.isCouncillor(f.id);
      const isOpponent = this.deps.council.isOpponent(f.id);
      // Opposition leader (Alpha 2.7.2) — replaces the regular mood
      // comment with a mean tweet attacking the mayor's leadership.
      // Council members keep their council-mode comment; everyone else
      // posts the regular bucketed faction comment.
      row.commentEl.textContent = onCouncil
        ? COUNCIL_COMMENTS[f.id]
        : isOpponent
        ? pickOppositionTweet(f.id, salt)
        : pickComment(f, h, salt);
      row.barFill.style.width = `${happinessToPct(h)}%`;
      row.barFill.style.background = barColor(h);
      row.el.dataset.bucket = bucket;
      row.moodEl.textContent = bucketLabel(bucket);

      const role = onCouncil ? 'council' : isOpponent ? 'opponent' : '';
      row.el.dataset.role = role;
      row.badgeEl.textContent = onCouncil ? '★ COUNCIL' : isOpponent ? '✕ RAN AGAINST' : '';
      row.badgeEl.style.display = role ? 'inline-block' : 'none';

      const factionPop = Math.round(this.deps.population.factionPopulation.get(f.id) ?? 0);
      const sharePct = totalDisplayed > 0 ? (factionPop / totalDisplayed) * 100 : 0;
      row.popEl.textContent = `${factionPop.toLocaleString()} residents · ${sharePct.toFixed(1)}%`;
      row.shareFill.style.width = `${Math.min(100, sharePct).toFixed(1)}%`;
      row.shareFill.style.background = `#${f.color.toString(16).padStart(6, '0')}`;
    }
  }

  private refreshCouncilBar(): void {
    const c = this.deps.council;
    if (c.term === 0) {
      // Months until next year boundary.
      const m = this.deps.economy.monthsElapsed;
      const monthsToElection = 12 - (m % 12);
      this.councilBarTitleEl.textContent =
        `★ Council — first election in ${monthsToElection} month${monthsToElection === 1 ? '' : 's'}`;
      this.councilBarSeatsEl.innerHTML = '<span class="council-bar__none">No seats yet — Mayor governs alone</span>';
      this.councilBarOppEl.textContent = '';
      return;
    }
    this.councilBarTitleEl.textContent = `★ Council · Term ${c.term}`;
    this.councilBarSeatsEl.innerHTML = '';
    for (const id of c.councillors) {
      const f = FACTIONS.find((x) => x.id === id);
      if (!f) continue;
      const seat = document.createElement('div');
      seat.className = 'council-bar__seat';
      seat.innerHTML = `
        <span class="council-bar__seat-avatar" style="background:#${f.color.toString(16).padStart(6, '0')}">${avatarInitials(f.leaderName)}</span>
        <span>${escapeHtml(shortName(f.leaderName))}</span>
      `;
      this.councilBarSeatsEl.appendChild(seat);
    }
    if (c.opponent) {
      const opp = FACTIONS.find((x) => x.id === c.opponent);
      this.councilBarOppEl.textContent = opp ? `✕ Defeated: ${opp.leaderName}` : '';
    } else {
      this.councilBarOppEl.textContent = '';
    }
  }

  private refreshCivicSection(): void {
    const c = this.deps.council;
    const pc = c.politicalCapital;
    this.civicPcNumEl.textContent = `${Math.floor(pc)} / ${PC_CAP}`;
    this.civicPcFillEl.style.width = `${(pc / PC_CAP) * 100}%`;

    // Endorse button state
    if (c.endorsedFaction) {
      const f = FACTIONS.find((x) => x.id === c.endorsedFaction);
      this.btnEndorse.textContent = `✓ ${shortName(f?.leaderName ?? c.endorsedFaction)}`;
      this.btnEndorse.title = `Endorsing ${f?.leaderName ?? c.endorsedFaction}`;
      this.btnEndorse.disabled = true;
    } else {
      this.btnEndorse.textContent = `Endorse · ${COSTS.endorse_pc}`;
      this.btnEndorse.title = `Endorse a leader (${COSTS.endorse_pc} PC)`;
      this.btnEndorse.disabled = pc < COSTS.endorse_pc;
    }

    // Coalition button state
    if (c.coalition) {
      const a = FACTIONS.find((x) => x.id === c.coalition!.a);
      const b = FACTIONS.find((x) => x.id === c.coalition!.b);
      this.btnCoalition.textContent = '✓ Coalition';
      this.btnCoalition.title = `Coalition: ${a?.leaderName ?? ''} + ${b?.leaderName ?? ''}`;
      this.btnCoalition.disabled = true;
    } else {
      this.btnCoalition.textContent = `Coalition · ${COSTS.coalition_pc}`;
      this.btnCoalition.title = `Form a coalition (${COSTS.coalition_pc} PC)`;
      this.btnCoalition.disabled = pc < COSTS.coalition_pc;
    }

    // Override button state
    if (c.isOverrideActive()) {
      this.btnOverride.textContent = '⚡ Override ON';
      this.btnOverride.title = 'Mayoral Override active for this term';
      this.btnOverride.disabled = true;
    } else if (c.isOverridePending()) {
      this.btnOverride.textContent = '⏳ Override';
      this.btnOverride.title = 'Override pending — kicks in next election';
      this.btnOverride.disabled = true;
    } else {
      this.btnOverride.textContent = `Override · ${COSTS.override_pc}`;
      this.btnOverride.title = `Mayoral Override (${COSTS.override_pc} PC)`;
      this.btnOverride.disabled = pc < COSTS.override_pc;
    }

    // Active summary — only surface what buttons can't convey on their own.
    // Override active uniquely means "no council restrictions this term", which
    // matters during play; the rest is already visible in the button labels.
    this.civicActiveEl.textContent = c.isOverrideActive()
      ? '⚡ Override term — no council limits'
      : '';
  }

  // -------------------------------------------------------------------
  // Civic action modal
  // -------------------------------------------------------------------

  private openModal(action: CivicAction): void {
    this.currentAction = action;
    this.currentSelections = [];

    if (action === 'override') {
      this.modalTitleEl.textContent = '⚡ Mayoral Override';
      this.modalSubEl.textContent =
        `Spend ${COSTS.override_pc} PC. Activates at the next election and lasts one full term. ` +
        `While active, no cost penalties, no zoning approval needed, no banned actions.`;
      this.modalListEl.innerHTML = '<div class="civic__option" style="cursor:default; pointer-events:none">Confirm to purchase.</div>';
      this.modalConfirmEl.textContent = `Buy Override (${COSTS.override_pc} PC)`;
      this.modalConfirmEl.classList.remove('hidden');
    } else if (action === 'endorse') {
      this.modalTitleEl.textContent = '👑 Endorse a Leader';
      this.modalSubEl.textContent =
        `Spend ${COSTS.endorse_pc} PC. Endorsed faction gets +20% vote share at the next election ` +
        `and can't be your opponent. Other factions take a small happiness hit.`;
      this.modalConfirmEl.classList.add('hidden');
      this.populateOptions(1);
    } else {
      this.modalTitleEl.textContent = '🤝 Form a Coalition';
      this.modalSubEl.textContent =
        `Spend ${COSTS.coalition_pc} PC. Pick TWO factions. Both gain happiness; their natural rivals ` +
        `lose happiness. Lasts until next election.`;
      this.modalConfirmEl.textContent = 'Form Coalition';
      this.modalConfirmEl.classList.remove('hidden');
      this.populateOptions(2);
    }

    this.modalEl.classList.remove('hidden');
    this.modalEl.setAttribute('aria-hidden', 'false');
  }

  private populateOptions(maxSelect: number): void {
    this.modalListEl.innerHTML = '';
    for (const f of FACTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'civic__option';
      btn.dataset.faction = f.id;
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = `
        <span class="civic__option-avatar" style="background:#${f.color.toString(16).padStart(6, '0')}">${avatarInitials(f.leaderName)}</span>
        <span class="civic__option-name">${escapeHtml(f.leaderName)}</span>
        <span class="civic__option-tag">${escapeHtml(f.name)}</span>
      `;
      btn.addEventListener('click', () => this.toggleSelection(f.id, maxSelect));
      this.modalListEl.appendChild(btn);
    }
  }

  private toggleSelection(id: FactionId, maxSelect: number): void {
    const idx = this.currentSelections.indexOf(id);
    if (idx >= 0) {
      this.currentSelections.splice(idx, 1);
    } else {
      if (this.currentSelections.length >= maxSelect) {
        // For single-select, replace; for multi-select, ignore.
        if (maxSelect === 1) this.currentSelections = [id];
        else return;
      } else {
        this.currentSelections.push(id);
      }
    }
    // Update aria-pressed on each button.
    for (const btn of this.modalListEl.querySelectorAll<HTMLButtonElement>('.civic__option[data-faction]')) {
      const fid = btn.dataset.faction as FactionId;
      btn.setAttribute('aria-pressed', String(this.currentSelections.includes(fid)));
    }
    // For endorse (single-select), confirm immediately on tap.
    if (maxSelect === 1 && this.currentSelections.length === 1) {
      this.confirmAction();
    }
  }

  private confirmAction(): void {
    if (!this.currentAction) return;
    const c = this.deps.council;
    let success = false;
    if (this.currentAction === 'override') {
      success = c.activateOverride();
      if (success) {
        this.deps.achievements?.recordPCSpent(COSTS.override_pc);
        this.deps.achievements?.recordOverrideActivation();
      }
    } else if (this.currentAction === 'endorse') {
      const f = this.currentSelections[0];
      if (f) {
        success = c.endorse(f);
        if (success) {
          this.deps.achievements?.recordPCSpent(COSTS.endorse_pc);
          this.deps.achievements?.recordEndorsement(f);
        }
      }
    } else if (this.currentAction === 'coalition') {
      if (this.currentSelections.length === 2) {
        success = c.declareCoalition(this.currentSelections[0]!, this.currentSelections[1]!);
        if (success) this.deps.achievements?.recordPCSpent(COSTS.coalition_pc);
      }
    }
    if (success) {
      this.closeModal();
      this.refresh();
    }
  }

  private closeModal(): void {
    this.modalEl.classList.add('hidden');
    this.modalEl.setAttribute('aria-hidden', 'true');
    this.currentAction = null;
    this.currentSelections = [];
  }
}

interface FactionRow {
  el: HTMLElement;
  commentEl: HTMLElement;
  barFill: HTMLElement;
  moodEl: HTMLElement;
  popEl: HTMLElement;
  shareFill: HTMLElement;
  badgeEl: HTMLElement;
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
        <span class="happiness__badge"></span>
        <span class="happiness__mood"></span>
      </div>
      <div class="happiness__title">${escapeHtml(f.leaderTitle)} — ${escapeHtml(f.name)}</div>
      <div class="happiness__comment"></div>
      <div class="happiness__cares">${escapeHtml(f.cares)}</div>
      <div class="happiness__pop"></div>
      <div class="happiness__share-bar"><div class="happiness__share-fill"></div></div>
      <div class="happiness__bar"><div class="happiness__bar-fill"></div></div>
    </div>
  `;
  const commentEl = wrap.querySelector('.happiness__comment') as HTMLElement;
  const barFill = wrap.querySelector('.happiness__bar-fill') as HTMLElement;
  const moodEl = wrap.querySelector('.happiness__mood') as HTMLElement;
  const popEl = wrap.querySelector('.happiness__pop') as HTMLElement;
  const shareFill = wrap.querySelector('.happiness__share-fill') as HTMLElement;
  const badgeEl = wrap.querySelector('.happiness__badge') as HTMLElement;
  return { el: wrap, commentEl, barFill, moodEl, popEl, shareFill, badgeEl };
}

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase();
}

function shortName(name: string): string {
  // "Karen Whitfield" → "Karen W." for the council bar (compact).
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]?.[0] ?? ''}.`;
}

function happinessToPct(h: number): number {
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
