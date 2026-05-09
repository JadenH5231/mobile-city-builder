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
  /** Road tier when `road` is true. Undefined-behaviour to read otherwise. */
  roadType: RoadType;
  /** Highway flow direction (0..7 from `Dir` enum) or -1. */
  highwayDir: number;
  /** Player-placed stop sign on this road tile. */
  stopSign: boolean;
  /** Player-placed traffic light on this road tile (Alpha 2.0). */
  trafficLight: boolean;
  zone: Zone;
  /** Player-set density cap (0..3). 0 means unzoned. */
  zoneCap: 0 | 1 | 2 | 3;
  density: number;
  building: Building;
  /** Walking-path bit (Alpha 1.6). Mutually exclusive with road and zone. */
  path: boolean;
  hasPower: boolean;
  hasWater: boolean;
  hasPark: boolean;
}

const DIR_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * Bottom-sheet style info panel. Slides up on long-press, dismissible via the
 * close button or by clearing the selection. Pure DOM — kept off the WebGL
 * canvas so that hit-testing and accessibility just work.
 */
export class TileInfoPanel {
  private readonly el: HTMLElement;
  private readonly coordsEl: HTMLElement;
  private readonly terrainEl: HTMLElement;
  private readonly closeBtn: HTMLElement;
  /** Fired when the user explicitly closes the panel (not on programmatic hide). */
  onClose?: () => void;

  constructor() {
    this.el = mustGet('tile-info');
    this.coordsEl = mustGet('tile-info-coords');
    this.terrainEl = mustGet('tile-info-terrain');
    this.closeBtn = mustGet('tile-info-close');

    this.closeBtn.addEventListener('click', () => {
      this.hide();
      this.onClose?.();
    });
  }

  show(info: TileInfo): void {
    this.coordsEl.textContent = `${info.x}, ${info.y}`;
    const parts: string[] = [info.terrain];
    if (info.road) {
      let label = info.roadType;
      if (info.roadType === 'highway' && info.highwayDir >= 0 && info.highwayDir < 8) {
        label += ` →${DIR_LABELS[info.highwayDir]}`;
      }
      if (info.stopSign) label += ' · stop';
      if (info.trafficLight) label += ' · light';
      parts.push(label);
    }
    if (info.building !== 'none') parts.push(info.building.replace(/_/g, ' '));
    if (info.path) parts.push('walking path');
    if (info.zone !== 'none') {
      const tierLabel = info.zoneCap === 1 ? 'low' : info.zoneCap === 2 ? 'med' : info.zoneCap === 3 ? 'high' : '';
      const zoneLabel = tierLabel ? `${info.zone}·${tierLabel}` : info.zone;
      parts.push(info.density > 0 ? `${zoneLabel} L${info.density}` : zoneLabel);
    }
    const services: string[] = [];
    if (info.hasPower) services.push('power');
    if (info.hasWater) services.push('water');
    if (info.hasPark) services.push('park');
    if (services.length > 0) parts.push(services.join('+'));
    // Per-cell capacity readout (Alpha 2.0). Shows residents and jobs the
    // built tile contributes — zero for undeveloped or unzoned cells.
    const cap = capacityFor(info.zone, info.density);
    if (cap.residents > 0 || cap.jobs > 0) {
      const bits: string[] = [];
      if (cap.residents > 0) bits.push(`${cap.residents} residents`);
      if (cap.jobs > 0) bits.push(`${cap.jobs} jobs`);
      parts.push(bits.join(' · '));
    }
    this.terrainEl.textContent = parts.join(' · ');
    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
  }
}

/**
 * Per-cell residents + jobs derived from zone × density. Mirrors the math
 * Population.tick uses, so the readout matches what the cell actually
 * contributes to the citywide aggregates.
 */
function capacityFor(zone: Zone, density: number): { residents: number; jobs: number } {
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

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`TileInfoPanel: missing #${id}`);
  return el;
}
