import {
  COMMERCIAL_JOBS,
  INDUSTRIAL_JOBS,
  MIXED_COMMERCIAL_JOBS,
  MIXED_RESIDENT_CAPACITY,
  RESIDENT_CAPACITY,
  type Building,
  type RoadType,
  type TerrainType,
  type Zone
} from '../types';

export interface TileInfo {
  x: number;
  y: number;
  terrain: TerrainType;
  road: boolean;
  roadType: RoadType;
  highwayDir: number;
  stopSign: boolean;
  trafficLight: boolean;
  zone: Zone;
  zoneCap: 0 | 1 | 2 | 3;
  density: number;
  /** Building age in months (Alpha 2.16). 0 means brand new or unbuilt. */
  ageMonths: number;
  /** Per-tile crime score (Alpha 2.21). 0..1. */
  crimeScore: number;
  building: Building;
  path: boolean;
  hasPower: boolean;
  hasWater: boolean;
  hasPark: boolean;
  /** Public services pack flags (Alpha 2.10). */
  hasSchool: boolean;
  hasHospital: boolean;
  hasFireProtection: boolean;
  hasPolice: boolean;
  /** Luxury low-density bit (Alpha 2.5). */
  luxury: boolean;
  /** Bridge bit (Alpha 2.3) — at-grade water bridge. */
  bridge: boolean;
  /** Upper-layer overpass (Alpha 2.12). */
  bridgeRoad: boolean;
  /** Tile has a road-adjacent neighbour (4-connected). */
  hasRoadAdjacent: boolean;
  /** Faction snapshot — current city demand for this zone, [-1, +1]. */
  zoneDemand: number;
  /** Diagnostic reasons (Alpha 2.13). Bullet points explaining why the
   *  tile is or isn't progressing — e.g. "Awaiting power coverage" or
   *  "Capped at low density by zoning". Each entry has a sentiment
   *  ('good' | 'warn' | 'block' | 'info') for colour. */
  reasons: ReadonlyArray<{ kind: 'good' | 'warn' | 'block' | 'info'; text: string }>;
}

const DIR_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * Bottom-sheet info + diagnostic panel (Alpha 2.13). Shows the tile's
 * current state as labeled chips and a bullet list of reasons explaining
 * why the tile is or isn't growing — turning frustration into puzzle-
 * solving (the lever the player should pull is one tap away).
 */
export class TileInfoPanel {
  private readonly el: HTMLElement;
  private readonly coordsEl: HTMLElement;
  private readonly terrainEl: HTMLElement;
  private readonly chipsEl: HTMLElement;
  private readonly capsEl: HTMLElement;
  private readonly diagEl: HTMLElement;
  private readonly closeBtn: HTMLElement;
  onClose?: () => void;

  constructor() {
    this.el = mustGet('tile-info');
    this.coordsEl = mustGet('tile-info-coords');
    this.terrainEl = mustGet('tile-info-terrain');
    this.chipsEl = mustGet('tile-info-chips');
    this.capsEl = mustGet('tile-info-caps');
    this.diagEl = mustGet('tile-info-diag');
    this.closeBtn = mustGet('tile-info-close');

    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });
  }

  show(info: TileInfo): void {
    this.coordsEl.textContent = `${info.x}, ${info.y}`;
    // Header line — terrain + headline label (zone or building or road).
    const headline = headlineFor(info);
    this.terrainEl.textContent = headline;

    // Chips row — current state pills.
    this.chipsEl.innerHTML = '';
    for (const chip of chipsFor(info)) {
      const span = document.createElement('span');
      span.className = `tile-info__chip tile-info__chip--${chip.tone}`;
      span.textContent = chip.text;
      this.chipsEl.appendChild(span);
    }

    // Capacity readout (residents / jobs).
    this.capsEl.innerHTML = '';
    const cap = capacityFor(info.zone, info.density, info.luxury);
    if (cap.residents > 0 || cap.jobs > 0) {
      const html: string[] = [];
      if (cap.residents > 0) {
        html.push(`<span class="tile-info__cap"><strong>${cap.residents}</strong> residents</span>`);
      }
      if (cap.jobs > 0) {
        html.push(`<span class="tile-info__cap"><strong>${cap.jobs}</strong> jobs</span>`);
      }
      this.capsEl.innerHTML = html.join('');
    }

    // Diagnostic reasons.
    this.diagEl.innerHTML = '';
    if (info.reasons.length === 0) {
      const li = document.createElement('div');
      li.className = 'tile-info__reason tile-info__reason--info';
      li.textContent = '✓ All systems nominal';
      this.diagEl.appendChild(li);
    } else {
      for (const r of info.reasons) {
        const li = document.createElement('div');
        li.className = `tile-info__reason tile-info__reason--${r.kind}`;
        li.textContent = r.text;
        this.diagEl.appendChild(li);
      }
    }

    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
  }
}

function headlineFor(info: TileInfo): string {
  if (info.bridgeRoad) {
    return `Overpass · ${info.terrain}`;
  }
  if (info.road) {
    let label = info.roadType;
    if (info.roadType === 'highway' && info.highwayDir >= 0 && info.highwayDir < 8) {
      label += ` →${DIR_LABELS[info.highwayDir]}`;
    }
    if (info.bridge) label += ' (bridge)';
    return `${label} road · ${info.terrain}`;
  }
  if (info.path) return `Walking path · ${info.terrain}`;
  if (info.building !== 'none') {
    return `${info.building.replace(/_/g, ' ')} · ${info.terrain}`;
  }
  if (info.zone !== 'none') {
    const tierLabel =
      info.luxury ? 'luxury' :
      info.zoneCap === 1 ? 'low' : info.zoneCap === 2 ? 'medium' : info.zoneCap === 3 ? 'high' : '';
    const zoneLabel = tierLabel ? `${zoneShortName(info.zone)} ${tierLabel}` : zoneShortName(info.zone);
    return info.density > 0 ? `${zoneLabel} L${info.density} · ${info.terrain}` : `${zoneLabel} · ${info.terrain}`;
  }
  return info.terrain;
}

function chipsFor(info: TileInfo): Array<{ text: string; tone: 'good' | 'warn' | 'block' | 'info' }> {
  const out: Array<{ text: string; tone: 'good' | 'warn' | 'block' | 'info' }> = [];
  // Service flags as colour-coded chips.
  if (info.hasPower) out.push({ text: '⚡ Power', tone: 'good' });
  if (info.hasWater) out.push({ text: '💧 Water', tone: 'good' });
  if (info.hasPark) out.push({ text: '🌳 Park', tone: 'good' });
  if (info.hasSchool) out.push({ text: '🏫 School', tone: 'good' });
  if (info.hasHospital) out.push({ text: '🏥 Hospital', tone: 'good' });
  if (info.hasFireProtection) out.push({ text: '🚒 Fire', tone: 'good' });
  if (info.hasPolice) out.push({ text: '🚓 Police', tone: 'good' });
  if (info.stopSign) out.push({ text: '🛑 Stop sign', tone: 'info' });
  if (info.trafficLight) out.push({ text: '🚦 Light', tone: 'info' });
  if (info.luxury) out.push({ text: '⭐ Luxury', tone: 'info' });
  if (info.density > 0 && info.ageMonths > 0) {
    out.push({ text: `🕰 ${formatAge(info.ageMonths)}`, tone: 'info' });
  }
  if (info.density > 0 && info.crimeScore > 0) {
    const tone: 'good' | 'warn' | 'block' | 'info' =
      info.crimeScore < 0.10 ? 'good' :
      info.crimeScore < 0.30 ? 'info' :
      info.crimeScore < 0.55 ? 'warn' : 'block';
    out.push({ text: `🛡 Crime ${(info.crimeScore * 100).toFixed(0)}%`, tone });
  }
  return out;
}

function formatAge(months: number): string {
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years}y` : `${years}y ${rem}mo`;
}

function zoneShortName(zone: Zone): string {
  if (zone === 'residential') return 'Residential';
  if (zone === 'commercial') return 'Commercial';
  if (zone === 'industrial') return 'Industrial';
  if (zone === 'mixed') return 'Mixed-use';
  return zone;
}

function capacityFor(zone: Zone, density: number, luxury: boolean): { residents: number; jobs: number } {
  if (luxury && zone === 'residential') {
    // Luxury tiles: 2 residents per tile at any density (placement is the
    // build, no growth). Mirrors LUXURY_RESIDENT_CAPACITY_PER_TILE.
    return { residents: 2, jobs: 0 };
  }
  if (density <= 0) return { residents: 0, jobs: 0 };
  switch (zone) {
    case 'residential': return { residents: RESIDENT_CAPACITY[density] ?? 0, jobs: 0 };
    case 'commercial': return { residents: 0, jobs: COMMERCIAL_JOBS[density] ?? 0 };
    case 'industrial': return { residents: 0, jobs: INDUSTRIAL_JOBS[density] ?? 0 };
    case 'mixed': return {
      residents: MIXED_RESIDENT_CAPACITY[density] ?? 0,
      jobs: MIXED_COMMERCIAL_JOBS[density] ?? 0
    };
    default: return { residents: 0, jobs: 0 };
  }
}

/**
 * Build the diagnostic-reasons array from raw tile state + city
 * snapshot. Caller (Game) sets `reasons` on the TileInfo before passing
 * to `panel.show()`. Exported so Game can call it without duplicating
 * the rules.
 */
export function diagnoseTile(info: Omit<TileInfo, 'reasons'>): TileInfo['reasons'] {
  const out: Array<{ kind: 'good' | 'warn' | 'block' | 'info'; text: string }> = [];

  // Empty grass / sand / forest / water — purely informational.
  if (!info.road && !info.path && info.zone === 'none' && info.building === 'none') {
    if (info.terrain === 'water') {
      out.push({ kind: 'info', text: 'Water — paint a road across it to bridge' });
    } else if (info.terrain === 'forest') {
      out.push({ kind: 'info', text: 'Forest — placeable: forestry industry, paths, roads' });
    } else if (info.terrain === 'sand') {
      out.push({ kind: 'info', text: 'Sand shoreline — most things buildable' });
    } else {
      out.push({ kind: 'info', text: 'Grass — ready for zoning, parks, farms, services' });
    }
    return out;
  }

  // Roads & bridges — structural info.
  if (info.road) {
    if (info.bridgeRoad) {
      out.push({ kind: 'info', text: 'Carries an overpass on the upper layer' });
    }
    if (info.bridge) {
      out.push({ kind: 'info', text: 'Bridge over water' });
    }
    if (info.stopSign && info.trafficLight) {
      out.push({ kind: 'warn', text: 'Stop sign + traffic light both placed (light wins)' });
    }
  }

  // City buildings — describe coverage state.
  if (info.building === 'park' || info.building === 'school' ||
      info.building === 'hospital' || info.building === 'fire_station' ||
      info.building === 'police_station' || info.building === 'power_plant' ||
      info.building === 'water_tower') {
    out.push({ kind: 'good', text: 'Service building — provides coverage to nearby tiles' });
    return out;
  }
  if (info.building === 'forestry' || info.building === 'farm') {
    out.push({ kind: 'good', text: 'Export industry — earns monthly via global market' });
    return out;
  }

  // Zoned tiles — the diagnostic-rich path.
  if (info.zone !== 'none') {
    if (info.luxury) {
      out.push({ kind: 'good', text: 'Luxury home — fixed capacity, premium tax, NIMBY draw' });
      return out;
    }
    // Pre-development blockers.
    if (!info.hasRoadAdjacent) {
      out.push({ kind: 'block', text: 'No road within 1 tile — zoning waits for a road' });
    }
    if (!info.hasPower) {
      out.push({ kind: 'block', text: 'No power coverage — drop a power plant within 8 tiles' });
    }
    if (!info.hasWater) {
      out.push({ kind: 'block', text: 'No water coverage — drop a water tower within 8 tiles' });
    }
    // Cap analysis.
    if (info.zoneCap === 1) {
      out.push({ kind: 'info', text: 'Capped at L1 — repaint as Med or High to allow growth' });
    } else if (info.zoneCap === 2) {
      out.push({ kind: 'info', text: 'Capped at L2 — repaint as High to allow tower-tier growth' });
    } else if (info.zoneCap === 3) {
      if (!info.hasPark) {
        out.push({ kind: 'warn', text: 'Park required for L3 — no park within 3 tiles' });
      }
    }
    // Demand readout.
    if (info.zoneDemand <= -0.4) {
      out.push({ kind: 'warn', text: `Demand for ${zoneShortName(info.zone).toLowerCase()} is very low (${info.zoneDemand.toFixed(2)})` });
    } else if (info.zoneDemand <= -0.05) {
      out.push({ kind: 'info', text: `${zoneShortName(info.zone)} demand is soft (${info.zoneDemand.toFixed(2)})` });
    } else if (info.zoneDemand >= 0.4) {
      out.push({ kind: 'good', text: `${zoneShortName(info.zone)} demand is hot (+${info.zoneDemand.toFixed(2)})` });
    }
    // If everything looks good and density is below cap.
    if (info.hasPower && info.hasWater && info.hasRoadAdjacent &&
        (info.zoneCap > 0 && info.density < info.zoneCap)) {
      out.push({ kind: 'good', text: 'Conditions met — growth pending demand' });
    }
    if (info.density === info.zoneCap && info.zoneCap > 0) {
      out.push({ kind: 'good', text: `Fully developed at L${info.density}` });
    }
    return out;
  }

  // Anything else.
  return out;
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`TileInfoPanel: missing #${id}`);
  return el;
}
