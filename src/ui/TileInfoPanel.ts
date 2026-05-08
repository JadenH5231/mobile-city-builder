import type { Building, TerrainType, Zone } from '../types';

export interface TileInfo {
  x: number;
  y: number;
  terrain: TerrainType;
  road: boolean;
  zone: Zone;
  density: number;
  building: Building;
  hasPower: boolean;
  hasWater: boolean;
  hasPark: boolean;
}

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
    if (info.road) parts.push('road');
    if (info.building !== 'none') parts.push(info.building.replace(/_/g, ' '));
    if (info.zone !== 'none') {
      parts.push(info.density > 0 ? `${info.zone} L${info.density}` : info.zone);
    }
    const services: string[] = [];
    if (info.hasPower) services.push('power');
    if (info.hasWater) services.push('water');
    if (info.hasPark) services.push('park');
    if (services.length > 0) parts.push(services.join('+'));
    this.terrainEl.textContent = parts.join(' · ');
    this.el.classList.remove('hidden');
    this.el.setAttribute('aria-hidden', 'false');
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-hidden', 'true');
  }
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`TileInfoPanel: missing #${id}`);
  return el;
}
