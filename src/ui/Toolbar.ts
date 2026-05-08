import type { Tool } from '../types';

interface ToolButton {
  tool: Tool;
  label: string;
  /** Inline SVG keeps us free of asset loading for now. */
  icon: string;
}

const BUTTONS: readonly ToolButton[] = [
  {
    tool: 'pan',
    label: 'Pan',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2v6M12 22v-6M2 12h6M22 12h-6"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
      <circle cx="12" cy="12" r="3" fill="currentColor"/>
    </svg>`
  },
  {
    tool: 'road_local',
    label: 'Local',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 3l-2 18M19 3l2 18M9 3l-1 5M9 13l-1 5M15 3l1 5M15 13l1 5"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'road_avenue',
    label: 'Avenue',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l-1 18M9 3l-1 18M15 3l1 18M21 3l1 18"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'road_highway',
    label: 'Highway',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3l-2 18M18 3l2 18M11 6l4 6-4 6"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'residential',
    label: 'R',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11l8-7 8 7v9H4z M10 20v-5h4v5"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'commercial',
    label: 'C',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="6" width="16" height="14" stroke="currentColor"
            stroke-width="1.8" fill="none" stroke-linejoin="round"/>
      <path d="M4 10h16 M9 6V4h6v2 M10 14h4"
            stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    </svg>`
  },
  {
    tool: 'industrial',
    label: 'I',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 20V10l5 4V10l5 4V8l8 4v8z"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'place_power',
    label: 'Power',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2L4 14h7l-1 8 9-12h-7z"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'place_water',
    label: 'Water',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3c-4 5-6 8-6 11a6 6 0 0 0 12 0c0-3-2-6-6-11z"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'place_park',
    label: 'Park',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l5 8h-3l4 6H6l4-6H7z M11 17v4h2v-4"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'place_bus_stop',
    label: 'Stop',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="4" width="12" height="14" rx="2"
            stroke="currentColor" stroke-width="1.8" fill="none"/>
      <path d="M6 12h12 M9 18v2 M15 18v2"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'place_bus_depot',
    label: 'Depot',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10l3-5h12l3 5v9H3z M6 14h12 M7 19v2 M17 19v2"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
    </svg>`
  },
  {
    tool: 'place_stop_sign',
    label: 'Stop',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
      <path d="M8 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`
  },
  {
    tool: 'bulldoze',
    label: 'Bulldoze',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 17h7l4-3h5M9 17v3h7v-3M4 12h6l1-3h7l1 3"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
            stroke-linejoin="round" fill="none"/>
    </svg>`
  }
];

/**
 * Bottom-of-screen tool selector. Vanilla DOM. Buttons are 44pt-tall pills,
 * tap-friendly. The active tool gets a brighter pill background.
 */
export class Toolbar {
  private readonly el: HTMLElement;
  private readonly buttons = new Map<Tool, HTMLButtonElement>();
  private current: Tool = 'pan';
  onChange?: (tool: Tool) => void;

  constructor() {
    const el = document.getElementById('toolbar');
    if (!el) throw new Error('Toolbar: missing #toolbar');
    this.el = el;
    this.render();
  }

  /** Programmatic tool change (used to start in pan, etc.). */
  setTool(tool: Tool): void {
    if (tool === this.current) return;
    this.current = tool;
    this.refreshActive();
  }

  private render(): void {
    this.el.innerHTML = '';
    for (const b of BUTTONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toolbar__btn';
      btn.dataset.tool = b.tool;
      btn.setAttribute('aria-label', b.label);
      btn.setAttribute('aria-pressed', String(b.tool === this.current));
      btn.innerHTML = `<span class="toolbar__icon" aria-hidden="true">${b.icon}</span><span class="toolbar__label">${b.label}</span>`;
      btn.addEventListener('click', () => this.handleClick(b.tool));
      this.el.appendChild(btn);
      this.buttons.set(b.tool, btn);
    }
  }

  private handleClick(tool: Tool): void {
    if (tool === this.current) return;
    this.current = tool;
    this.refreshActive();
    this.onChange?.(tool);
  }

  private refreshActive(): void {
    for (const [tool, btn] of this.buttons) {
      const isActive = tool === this.current;
      btn.setAttribute('aria-pressed', String(isActive));
      if (isActive) {
        // Centre the active tool in the scroll container so a freshly-picked
        // tool isn't half off-screen when the user comes back to the toolbar.
        btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }
}
