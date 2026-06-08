/**
 * Faction Detail Panel (Alpha 4.9 — B3 from the production audit).
 *
 * Pre-4.9 the Community Sentiment panel showed every faction's mood +
 * a single comment, but the player couldn't drill into "*why* does
 * Karen Whitfield hate me." This modal opens when the player taps a
 * leader's row in the Community Sentiment panel and surfaces:
 *
 * - Leader bio (name, title, one-line bio, accent colour)
 * - Cares: the faction's player-facing summary of values
 * - Current mood (bar + bucket label)
 * - Top 5 stances they LOVE — buildings / zones with stance ≥ +0.5
 *   sorted descending
 * - Top 5 stances they HATE — stance ≤ −0.5 sorted ascending
 * - Population share (current / natural target)
 * - Council status (★ Council member / ✕ Ran against you / —)
 *
 * Reads from `FACTION_STANCES` (Council.ts) + `FACTIONS` (Happiness.ts).
 * Everything is read-only. Closing returns the player to the Community
 * Sentiment panel which auto-refreshes on its own.
 */

import { FACTIONS, type FactionId } from '../simulation/Happiness';
import { FACTION_STANCES, type StanceKey } from '../simulation/Council';
import type { Council } from '../simulation/Council';
import type { Happiness } from '../simulation/Happiness';
import type { Population } from '../simulation/Population';

/** Human-readable label per stance key. Keeps the detail panel free
 *  of cryptic snake-cased identifiers like `mu_high` or `r_lux`. */
const STANCE_LABEL: Record<StanceKey, string> = {
  road_local: 'Local roads', road_avenue: 'Avenues', road_highway: 'Highways',
  r_low: 'Residential (low)',  r_medium: 'Residential (medium)',  r_high: 'Residential (high)', r_max: 'Residential (max)',
  c_low: 'Commercial (low)',   c_medium: 'Commercial (medium)',   c_high: 'Commercial (high)', c_max: 'Commercial (max)',
  i_low: 'Industrial (low)',   i_medium: 'Industrial (medium)',   i_high: 'Industrial (high)', i_max: 'Industrial (max)',
  mu_low: 'Mixed-use (low)',   mu_medium: 'Mixed-use (medium)',   mu_high: 'Mixed-use (high)', mu_max: 'Mixed-use (max)',
  r_lux: 'Luxury homes',
  power_plant: 'Power plants', water_tower: 'Water towers', park: 'Parks',
  bus_stop: 'Bus stops', bus_depot: 'Bus depots', stop_sign: 'Stop signs',
  ramp: 'Highway ramps',
  cloverleaf: 'Cloverleaf interchanges',
  forestry: 'Forestry', farm: 'Farms',
  big_box: 'Big Box stores', warehouse: 'Warehouses', parking_lot: 'Parking lots',
  resort: 'Resorts',
  hotel: 'Hotels & Motels',
  school: 'Schools', hospital: 'Hospitals',
  fire_station: 'Fire stations', police_station: 'Police stations',
  museum: 'Museums', stadium: 'Stadiums', observatory: 'Observatories',
  ferry_dock: 'Ferries', subway_entrance: 'Subway',
  plaza: 'Plazas', fountain: 'Fountains', statue: 'Statues',
  flower_bed: 'Flower beds', topiary: 'Topiary',
  pergola: 'Pergolas', reflecting_pool: 'Reflecting pools',
  memorial_garden: 'Memorial gardens',
  clock_tower: 'Clock towers', triumphal_arch: 'Triumphal arches',
  pier: 'Piers', mayor_mansion: "Mayor's Mansion",
  city_hall: 'City Hall',
  provincial_capital: 'Provincial Capital',
  national_capital: 'National Capital',
  grand_stadium: 'Grand Stadium',
  beautification: 'Beautification budget',
  apt_terminal: 'Airport'
};

export interface FactionDetailDeps {
  happiness: Happiness;
  council: Council;
  population: Population;
}

export class FactionDetailPanel {
  private readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly closeBtn: HTMLElement;

  constructor(private readonly deps: FactionDetailDeps) {
    const el = document.getElementById('faction-detail-panel');
    if (!el) throw new Error('FactionDetailPanel: missing #faction-detail-panel');
    this.el = el;
    this.bodyEl = mustGet('faction-detail-body');
    this.closeBtn = mustGet('faction-detail-close');
    this.closeBtn.addEventListener('click', () => this.hide());
  }

  show(factionId: FactionId): void {
    const f = FACTIONS.find((x) => x.id === factionId);
    if (!f) return;
    this.render(factionId, f);
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

  private render(factionId: FactionId, f: typeof FACTIONS[number]): void {
    const stances = FACTION_STANCES[factionId];
    const happiness = this.deps.happiness.get(factionId);
    const onCouncil = this.deps.council.isCouncillor(factionId);
    const isOpponent = this.deps.council.isOpponent(factionId);

    // Sort stances into love (≥ +0.5) and hate (≤ −0.5) lists. The
    // 0.5 threshold filters out noise — neutral stances (-0.4..+0.4)
    // don't reveal a meaningful position to the player.
    const entries: Array<[StanceKey, number]> = Object.entries(stances) as Array<[StanceKey, number]>;
    const loves = entries
      .filter(([, v]) => v >= 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const hates = entries
      .filter(([, v]) => v <= -0.5)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5);

    const factionPop = Math.round(this.deps.population.factionPopulation.get(factionId) ?? 0);
    const totalPop = Math.max(1, Math.round(this.deps.population.totalResidents));
    const sharePct = (factionPop / totalPop) * 100;

    const colorHex = `#${f.color.toString(16).padStart(6, '0')}`;
    const role = onCouncil ? '★ COUNCIL MEMBER' : isOpponent ? '✕ RAN AGAINST YOU' : 'NOT IN OFFICE';
    const roleClass = onCouncil ? 'role--council' : isOpponent ? 'role--opponent' : 'role--none';

    const moodPct = ((happiness + 1) / 2) * 100;  // -1..1 → 0..100
    const moodLabel =
      happiness >= 0.5 ? 'ECSTATIC' :
      happiness >= 0.15 ? 'HAPPY' :
      happiness >= -0.15 ? 'NEUTRAL' :
      happiness >= -0.5 ? 'UPSET' : 'FURIOUS';

    this.bodyEl.innerHTML = `
      <div class="faction-detail__header" style="background:linear-gradient(135deg,${colorHex} 0%,${colorHex}88 100%)">
        <div class="faction-detail__avatar">${escapeHtml(initials(f.leaderName))}</div>
        <div class="faction-detail__hdr-text">
          <div class="faction-detail__leader">${escapeHtml(f.leaderName)}</div>
          <div class="faction-detail__title">${escapeHtml(f.leaderTitle)}</div>
          <div class="faction-detail__faction">${escapeHtml(f.name)}</div>
        </div>
      </div>
      <div class="faction-detail__role ${roleClass}">${role}</div>
      <div class="faction-detail__bio">${escapeHtml(f.bio)}</div>
      <div class="faction-detail__cares-block">
        <div class="faction-detail__cares-label">What they care about</div>
        <div class="faction-detail__cares">${escapeHtml(f.cares)}</div>
      </div>
      <div class="faction-detail__mood">
        <div class="faction-detail__mood-row">
          <span>Current mood</span>
          <span class="faction-detail__mood-label">${moodLabel} · ${happiness >= 0 ? '+' : ''}${happiness.toFixed(2)}</span>
        </div>
        <div class="faction-detail__mood-bar">
          <div class="faction-detail__mood-fill" style="width:${moodPct}%;background:${moodBarColor(happiness)}"></div>
        </div>
      </div>
      <div class="faction-detail__pop">
        <span>Residents who lean with them</span>
        <span class="mono">${factionPop.toLocaleString()} · ${sharePct.toFixed(1)}%</span>
      </div>
      <div class="faction-detail__stance-cols">
        <div class="faction-detail__stance-col faction-detail__stance-col--love">
          <div class="faction-detail__stance-label">❤ They support</div>
          ${loves.length === 0 ? '<div class="faction-detail__empty">No strong positives</div>' : loves.map(([k, v]) => `
            <div class="faction-detail__stance-row">
              <span class="faction-detail__stance-name">${escapeHtml(STANCE_LABEL[k])}</span>
              <span class="faction-detail__stance-val mono">+${v.toFixed(1)}</span>
            </div>
          `).join('')}
        </div>
        <div class="faction-detail__stance-col faction-detail__stance-col--hate">
          <div class="faction-detail__stance-label">✕ They oppose</div>
          ${hates.length === 0 ? '<div class="faction-detail__empty">No strong negatives</div>' : hates.map(([k, v]) => `
            <div class="faction-detail__stance-row">
              <span class="faction-detail__stance-name">${escapeHtml(STANCE_LABEL[k])}</span>
              <span class="faction-detail__stance-val mono">${v.toFixed(1)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}

function moodBarColor(h: number): string {
  if (h >= 0.5) return '#6dd06a';
  if (h >= 0.15) return '#9bd086';
  if (h >= -0.15) return '#cfcb7a';
  if (h >= -0.5) return '#e3a36e';
  return '#d84545';
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((s) => s[0] ?? '').join('').toUpperCase();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
    }
    return c;
  });
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`FactionDetailPanel: missing #${id}`);
  return el;
}
