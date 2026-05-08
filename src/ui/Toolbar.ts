import type { Tool } from '../types';

/**
 * Bottom-of-screen tool selector.
 *
 * Direct buttons (Pan, Power, Bulldoze, …) activate a tool on tap. Group
 * buttons (Roads, R/C/I) open a popover above with the variations — tap a
 * variation to activate it. Tapping a group whose popover is already open
 * closes it. Tapping anywhere outside an open popover closes it.
 */
interface ToolButton {
  readonly kind: 'tool';
  readonly tool: Tool;
  readonly label: string;
  readonly icon: string;
}

interface ToolGroup {
  readonly kind: 'group';
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly members: readonly ToolButton[];
}

type ToolbarItem = ToolButton | ToolGroup;

const ICON_LOCAL = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M5 3l-2 18M19 3l2 18M9 3l-1 5M9 13l-1 5M15 3l1 5M15 13l1 5"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
</svg>`;
const ICON_AVENUE = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 3l-1 18M9 3l-1 18M15 3l1 18M21 3l1 18"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
</svg>`;
const ICON_HIGHWAY = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6 3l-2 18M18 3l2 18M11 6l4 6-4 6"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" fill="none"/>
</svg>`;
const ICON_R = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 11l8-7 8 7v9H4z M10 20v-5h4v5"
        stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
</svg>`;
const ICON_C = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="4" y="6" width="16" height="14" stroke="currentColor"
        stroke-width="1.8" fill="none" stroke-linejoin="round"/>
  <path d="M4 10h16 M9 6V4h6v2 M10 14h4"
        stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
</svg>`;
const ICON_I = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 20V10l5 4V10l5 4V8l8 4v8z"
        stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
</svg>`;
/** Tier glyph — same shape, the size hint reads at-a-glance. */
const ICON_TIER_LOW = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="9" y="14" width="6" height="6" stroke="currentColor"
        stroke-width="1.8" fill="none"/>
</svg>`;
const ICON_TIER_MED = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="6" y="10" width="12" height="10" stroke="currentColor"
        stroke-width="1.8" fill="none"/>
</svg>`;
const ICON_TIER_HIGH = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="4" y="4" width="16" height="16" stroke="currentColor"
        stroke-width="1.8" fill="none"/>
</svg>`;

const ITEMS: readonly ToolbarItem[] = [
  { kind: 'tool', tool: 'pan', label: 'Pan', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2v6M12 22v-6M2 12h6M22 12h-6"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
    <circle cx="12" cy="12" r="3" fill="currentColor"/>
  </svg>` },
  {
    kind: 'group',
    id: 'roads',
    label: 'Roads',
    icon: ICON_LOCAL,
    members: [
      { kind: 'tool', tool: 'road_local',   label: 'Local',   icon: ICON_LOCAL },
      { kind: 'tool', tool: 'road_avenue',  label: 'Avenue',  icon: ICON_AVENUE },
      { kind: 'tool', tool: 'road_highway', label: 'Highway', icon: ICON_HIGHWAY }
    ]
  },
  {
    kind: 'group',
    id: 'residential',
    label: 'R',
    icon: ICON_R,
    members: [
      { kind: 'tool', tool: 'residential_low',    label: 'Low',  icon: ICON_TIER_LOW },
      { kind: 'tool', tool: 'residential_medium', label: 'Med',  icon: ICON_TIER_MED },
      { kind: 'tool', tool: 'residential_high',   label: 'High', icon: ICON_TIER_HIGH }
    ]
  },
  {
    kind: 'group',
    id: 'commercial',
    label: 'C',
    icon: ICON_C,
    members: [
      { kind: 'tool', tool: 'commercial_low',    label: 'Low',  icon: ICON_TIER_LOW },
      { kind: 'tool', tool: 'commercial_medium', label: 'Med',  icon: ICON_TIER_MED },
      { kind: 'tool', tool: 'commercial_high',   label: 'High', icon: ICON_TIER_HIGH }
    ]
  },
  {
    kind: 'group',
    id: 'industrial',
    label: 'I',
    icon: ICON_I,
    members: [
      { kind: 'tool', tool: 'industrial_low',    label: 'Low',  icon: ICON_TIER_LOW },
      { kind: 'tool', tool: 'industrial_medium', label: 'Med',  icon: ICON_TIER_MED },
      { kind: 'tool', tool: 'industrial_high',   label: 'High', icon: ICON_TIER_HIGH }
    ]
  },
  { kind: 'tool', tool: 'place_power', label: 'Power', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M13 2L4 14h7l-1 8 9-12h-7z"
          stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
  </svg>` },
  { kind: 'tool', tool: 'place_water', label: 'Water', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3c-4 5-6 8-6 11a6 6 0 0 0 12 0c0-3-2-6-6-11z"
          stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
  </svg>` },
  { kind: 'tool', tool: 'place_park', label: 'Park', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3l5 8h-3l4 6H6l4-6H7z M11 17v4h2v-4"
          stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
  </svg>` },
  { kind: 'tool', tool: 'place_bus_stop', label: 'BusStop', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="4" width="12" height="14" rx="2"
          stroke="currentColor" stroke-width="1.8" fill="none"/>
    <path d="M6 12h12 M9 18v2 M15 18v2"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  </svg>` },
  { kind: 'tool', tool: 'place_bus_depot', label: 'Depot', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 10l3-5h12l3 5v9H3z M6 14h12 M7 19v2 M17 19v2"
          stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
  </svg>` },
  { kind: 'tool', tool: 'place_stop_sign', label: 'Stop', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"
          stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
    <path d="M8 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>` },
  { kind: 'tool', tool: 'bulldoze', label: 'Bulldoze', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 17h7l4-3h5M9 17v3h7v-3M4 12h6l1-3h7l1 3"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
          stroke-linejoin="round" fill="none"/>
  </svg>` }
];

export class Toolbar {
  private readonly el: HTMLElement;
  private readonly toolButtons = new Map<Tool, HTMLButtonElement>();
  private readonly groupButtons = new Map<string, HTMLButtonElement>();
  private readonly groupPopovers = new Map<string, HTMLElement>();
  private current: Tool = 'pan';
  private openPopoverId: string | null = null;
  onChange?: (tool: Tool) => void;

  constructor() {
    const el = document.getElementById('toolbar');
    if (!el) throw new Error('Toolbar: missing #toolbar');
    this.el = el;
    this.render();

    // Outside-tap closes any open popover. Use pointerdown so it fires on
    // touch start without waiting for the click to fully resolve.
    document.addEventListener('pointerdown', (e) => {
      if (this.openPopoverId === null) return;
      const target = e.target as Node | null;
      // Don't close if the tap was inside the toolbar itself — group / member
      // handlers manage their own state.
      if (target && this.el.contains(target)) return;
      this.closePopovers();
    });
  }

  /** Programmatic tool change. Used by Game when entering paint vs navigate
   *  mode and on app boot. */
  setTool(tool: Tool): void {
    if (tool === this.current) return;
    this.current = tool;
    this.closePopovers();
    this.refreshActive();
  }

  private render(): void {
    this.el.innerHTML = '';
    for (const item of ITEMS) {
      if (item.kind === 'tool') {
        this.el.appendChild(this.makeToolButton(item));
      } else {
        this.el.appendChild(this.makeGroup(item));
      }
    }
  }

  private makeToolButton(item: ToolButton): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toolbar__btn';
    btn.dataset.tool = item.tool;
    btn.setAttribute('aria-label', item.label);
    btn.setAttribute('aria-pressed', String(item.tool === this.current));
    btn.innerHTML = `<span class="toolbar__icon" aria-hidden="true">${item.icon}</span><span class="toolbar__label">${item.label}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePopovers();
      this.activate(item.tool);
    });
    this.toolButtons.set(item.tool, btn);
    return btn;
  }

  private makeGroup(group: ToolGroup): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'toolbar__group';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toolbar__btn toolbar__btn--group';
    btn.dataset.group = group.id;
    btn.setAttribute('aria-label', `${group.label} (variations)`);
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-haspopup', 'true');
    btn.innerHTML = `
      <span class="toolbar__icon" aria-hidden="true">${group.icon}</span>
      <span class="toolbar__label">${group.label}</span>
      <span class="toolbar__chevron" aria-hidden="true">▾</span>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleGroup(group.id);
    });
    wrap.appendChild(btn);
    this.groupButtons.set(group.id, btn);

    const pop = document.createElement('div');
    pop.className = 'toolbar__popover hidden';
    pop.dataset.group = group.id;
    pop.setAttribute('role', 'menu');
    for (const m of group.members) {
      const memBtn = document.createElement('button');
      memBtn.type = 'button';
      memBtn.className = 'toolbar__popover-btn';
      memBtn.dataset.tool = m.tool;
      memBtn.setAttribute('role', 'menuitem');
      memBtn.setAttribute('aria-label', m.label);
      memBtn.setAttribute('aria-pressed', String(m.tool === this.current));
      memBtn.innerHTML = `<span class="toolbar__icon" aria-hidden="true">${m.icon}</span><span class="toolbar__label">${m.label}</span>`;
      memBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activate(m.tool);
        this.closePopovers();
      });
      pop.appendChild(memBtn);
      this.toolButtons.set(m.tool, memBtn);
    }
    wrap.appendChild(pop);
    this.groupPopovers.set(group.id, pop);
    return wrap;
  }

  private toggleGroup(id: string): void {
    if (this.openPopoverId === id) {
      this.closePopovers();
      return;
    }
    this.closePopovers();
    const pop = this.groupPopovers.get(id);
    if (!pop) return;
    pop.classList.remove('hidden');
    this.openPopoverId = id;
  }

  private closePopovers(): void {
    if (this.openPopoverId === null) return;
    for (const pop of this.groupPopovers.values()) pop.classList.add('hidden');
    this.openPopoverId = null;
  }

  private activate(tool: Tool): void {
    if (tool === this.current) return;
    this.current = tool;
    this.refreshActive();
    this.onChange?.(tool);
  }

  private refreshActive(): void {
    for (const [tool, btn] of this.toolButtons) {
      const isActive = tool === this.current;
      btn.setAttribute('aria-pressed', String(isActive));
      if (isActive && btn.parentElement?.classList.contains('toolbar')) {
        // Direct tool button — centre it in the horizontal scroll.
        btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
    // Group highlights when any of its members is active. Also scroll the
    // group button into view if its member just got picked.
    for (const item of ITEMS) {
      if (item.kind !== 'group') continue;
      const isActive = item.members.some((m) => m.tool === this.current);
      const btn = this.groupButtons.get(item.id);
      if (!btn) continue;
      btn.setAttribute('aria-pressed', String(isActive));
      if (isActive) {
        btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }
}
