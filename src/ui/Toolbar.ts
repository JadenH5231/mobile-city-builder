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
const ICON_PATH = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M5 20c2-3 0-5 2-8s5-2 6-5 0-4 2-5"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  <circle cx="6" cy="20" r="0.9" fill="currentColor"/>
  <circle cx="9" cy="14" r="0.9" fill="currentColor"/>
  <circle cx="13" cy="9" r="0.9" fill="currentColor"/>
  <circle cx="17" cy="4" r="0.9" fill="currentColor"/>
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
const ICON_MU = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M5 11l7-6 7 6v9H5z"
        stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
  <path d="M9 20v-4h6v4 M5 14h14"
        stroke="currentColor" stroke-width="1.6" fill="none"/>
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
const ICON_TIER_LUX = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="3" y="14" width="6" height="6" stroke="currentColor"
        stroke-width="1.8" fill="none"/>
  <rect x="15" y="14" width="6" height="6" stroke="currentColor"
        stroke-width="1.8" fill="none"/>
  <path d="M12 4l2 4 4 .6-3 2.8.7 4-3.7-2-3.7 2 .7-4-3-2.8 4-.6z"
        stroke="currentColor" stroke-width="1.4" fill="none"/>
</svg>`;
/** Skyscraper tier icon (Alpha 3.1.2) — tall slim tower silhouette. */
const ICON_TIER_SKY = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="9" y="3" width="6" height="18" stroke="currentColor"
        stroke-width="1.6" fill="none"/>
  <path d="M11 3v-1 M13 3v-1 M9 8h6 M9 13h6 M9 18h6"
        stroke="currentColor" stroke-width="1.4"/>
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
      { kind: 'tool', tool: 'road_highway', label: 'Highway', icon: ICON_HIGHWAY },
      { kind: 'tool', tool: 'place_path',   label: 'Path',    icon: ICON_PATH }
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
      { kind: 'tool', tool: 'residential_high',   label: 'High', icon: ICON_TIER_HIGH },
      { kind: 'tool', tool: 'residential_luxury_low', label: 'Lux',  icon: ICON_TIER_LUX },
      { kind: 'tool', tool: 'residential_skyscraper', label: 'Sky',  icon: ICON_TIER_SKY }
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
      { kind: 'tool', tool: 'commercial_high',   label: 'High', icon: ICON_TIER_HIGH },
      { kind: 'tool', tool: 'commercial_skyscraper', label: 'Sky',  icon: ICON_TIER_SKY }
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
  {
    kind: 'group',
    id: 'mixed',
    label: 'MU',
    icon: ICON_MU,
    members: [
      { kind: 'tool', tool: 'mixed_low',    label: 'Low',  icon: ICON_TIER_LOW },
      { kind: 'tool', tool: 'mixed_medium', label: 'Med',  icon: ICON_TIER_MED },
      { kind: 'tool', tool: 'mixed_high',   label: 'High', icon: ICON_TIER_HIGH },
      { kind: 'tool', tool: 'mixed_skyscraper', label: 'Sky',  icon: ICON_TIER_SKY }
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
  { kind: 'tool', tool: 'place_forestry', label: 'Forestry', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2l4 7h-2.5l3 5H14v3h-4v-3H7.5l3-5H8z"
          stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    <path d="M5 19h14 M7 22h10"
          stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>` },
  { kind: 'tool', tool: 'place_farm', label: 'Farm', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 18l4-7 4 4 3-5 4 6 3-3v5z"
          stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    <path d="M3 21h18 M6 12v-3 M9 8v-2 M14 9v-3 M19 11v-2"
          stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>` },
  { kind: 'tool', tool: 'place_school', label: 'School', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3l9 4-9 4-9-4z"
          stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    <path d="M5 9v5c0 1 3 3 7 3s7-2 7-3V9"
          stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    <path d="M21 7v6"
          stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>` },
  { kind: 'tool', tool: 'place_hospital', label: 'Hospital', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="5" width="16" height="15" rx="1.5"
          stroke="currentColor" stroke-width="1.6" fill="none"/>
    <path d="M12 9v7 M9 12.5h6"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>` },
  { kind: 'tool', tool: 'place_fire_station', label: 'Fire', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3c1 3-2 4 0 7 1.5 2 4 1 4 4a4 4 0 1 1-8 0c0-2 1-3 1-5 1 1 2 1 3-1z"
          stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
  </svg>` },
  { kind: 'tool', tool: 'place_police_station', label: 'Police', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"
          stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    <path d="M9 11l2 2 4-4"
          stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
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
  { kind: 'tool', tool: 'place_traffic_light', label: 'Light', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="9" y="3" width="6" height="18" rx="1.5"
          stroke="currentColor" stroke-width="1.6" fill="none"/>
    <circle cx="12" cy="7"  r="1.4" fill="currentColor"/>
    <circle cx="12" cy="12" r="1.4" fill="currentColor"/>
    <circle cx="12" cy="17" r="1.4" fill="currentColor"/>
  </svg>` },
  // Landmarks (Alpha 2.17). Grouped popover so the toolbar stays scannable.
  // Each one generates monthly tourism revenue scaled by city pop.
  {
    kind: 'group',
    id: 'landmarks',
    label: 'Land',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 20l9-15 9 15z M9 20v-5h6v5"
            stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    </svg>`,
    members: [
      { kind: 'tool', tool: 'place_museum', label: 'Museum', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9l9-5 9 5 M5 9v10 M19 9v10 M9 19v-7 M15 19v-7 M3 21h18"
              stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
      </svg>` },
      { kind: 'tool', tool: 'place_stadium', label: 'Stadium', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <ellipse cx="12" cy="12" rx="9" ry="5"
              stroke="currentColor" stroke-width="1.6" fill="none"/>
        <path d="M3 12c0 3 4 5 9 5s9-2 9-5"
              stroke="currentColor" stroke-width="1.4" fill="none"/>
        <path d="M12 7v10"
              stroke="currentColor" stroke-width="1.2" fill="none"/>
      </svg>` },
      { kind: 'tool', tool: 'place_observatory', label: 'Obs.', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 18a7 7 0 0 1 14 0z M3 21h18"
              stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
        <circle cx="12" cy="11" r="3.5"
              stroke="currentColor" stroke-width="1.4" fill="none"/>
        <path d="M12 7l1 1.5"
              stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>` }
    ]
  },
  // Districts (Alpha 2.22). Paint adds tiles to the active district;
  // erase clears them.
  {
    kind: 'group',
    id: 'districts',
    label: 'Dist',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3v18h18V3z M3 11h18 M11 3v18"
            stroke="currentColor" stroke-width="1.6" fill="none"/>
    </svg>`,
    members: [
      { kind: 'tool', tool: 'paint_district', label: 'Paint', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 4h14v8h-7l-2 2H7l-2 6z M9 14l3-3"
              stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
      </svg>` },
      { kind: 'tool', tool: 'erase_district', label: 'Erase', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 18l12-12 M6 18h12"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <rect x="4" y="14" width="9" height="7" transform="rotate(-45 8.5 17.5)"
              stroke="currentColor" stroke-width="1.6" fill="none"/>
      </svg>` }
    ]
  },
  // Transit pack (Alpha 2.19). Ferry dock + subway entrance live in their
  // own group below the bus tools — both are "alternative transit modes"
  // that aren't roads.
  {
    kind: 'group',
    id: 'transit-modes',
    label: 'Trnst',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 17l5-2 4 2 4-2 5 2 M3 21l5-2 4 2 4-2 5 2"
            stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    </svg>`,
    members: [
      { kind: 'tool', tool: 'place_ferry_dock', label: 'Ferry', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 16l3-7h12l3 7z M5 20q3-1 7 0 t7 0"
              stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
        <path d="M11 9v-3h2v3"
              stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>` },
      { kind: 'tool', tool: 'place_subway_entrance', label: 'Subway', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="6" y="4" width="12" height="14" rx="3"
              stroke="currentColor" stroke-width="1.6" fill="none"/>
        <path d="M9 9l3 6 3-6 M9 18v3 M15 18v3"
              stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>` }
    ]
  },
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
  private bannedTools: Set<Tool> = new Set();
  /** Tools gated behind a milestone (Alpha 2.8). */
  private lockedTools: Set<Tool> = new Set();
  onChange?: (tool: Tool) => void;
  /** Fired when the user taps a locked tool — Game wires this to a toast. */
  onLocked?: (tool: Tool) => void;

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
      if (!target) return;
      // Don't close if the tap was inside the toolbar itself, or inside the
      // currently-open popover (which now lives at body level).
      if (this.el.contains(target)) return;
      const openPop = this.groupPopovers.get(this.openPopoverId);
      if (openPop && openPop.contains(target)) return;
      this.closePopovers();
    });

    // Horizontal scroll on the toolbar moves the anchor under the popover —
    // close it so the visual relationship doesn't drift. Same for window
    // resize, which would offset the body-positioned popover.
    this.el.addEventListener('scroll', () => this.closePopovers(), { passive: true });
    window.addEventListener('resize', () => this.closePopovers());
  }

  /** Programmatic tool change. Used by Game when entering paint vs navigate
   *  mode and on app boot. */
  setTool(tool: Tool): void {
    if (tool === this.current) return;
    this.current = tool;
    this.closePopovers();
    this.refreshActive();
  }

  /**
   * Mark a set of tools as banned-by-council (Alpha 2.6). Banned tools
   * render with a strikethrough + reduced opacity + a 🚫 tooltip via the
   * `data-banned="true"` attribute (styled in styles.css). Game.ts calls
   * this after every council change.
   */
  setBannedTools(banned: ReadonlySet<Tool>): void {
    this.bannedTools = new Set(banned);
    for (const [tool, btn] of this.toolButtons) {
      const isBanned = this.bannedTools.has(tool);
      btn.dataset.banned = isBanned ? 'true' : 'false';
      if (isBanned) {
        btn.setAttribute('title', 'Banned by council this term');
      } else {
        btn.removeAttribute('title');
      }
    }
    // Group buttons get a 'partial' or 'all' ban indicator depending on
    // how many of their members are banned. Anything ≥ 1 banned member
    // gets the visual cue so the player notices before opening the popover.
    for (const item of ITEMS) {
      if (item.kind !== 'group') continue;
      const btn = this.groupButtons.get(item.id);
      if (!btn) continue;
      const total = item.members.length;
      const bannedCount = item.members.filter((m) => this.bannedTools.has(m.tool)).length;
      const allBanned = bannedCount === total && total > 0;
      const someBanned = bannedCount > 0 && !allBanned;
      btn.dataset.banned = allBanned ? 'true' : someBanned ? 'partial' : 'false';
      if (bannedCount > 0) {
        btn.setAttribute('title', `${bannedCount} of ${total} variant${total > 1 ? 's' : ''} banned by council`);
      } else {
        btn.removeAttribute('title');
      }
    }
  }

  private render(): void {
    this.el.innerHTML = '';
    // Two sections (Alpha 2.7.3): Pan + Bulldoze pin to the left as a
    // fixed-width "always visible" cluster; everything else lives in a
    // horizontally scrollable strip on the right. Pan and Bulldoze are
    // the two most-used tools and were getting buried behind a long
    // scroll once we added forestry / farm / luxury.
    const pinned = document.createElement('div');
    pinned.className = 'toolbar__pinned';
    const scroll = document.createElement('div');
    scroll.className = 'toolbar__scroll';
    // Re-close popovers when the scroll strip is panned (used to live
    // on `this.el` directly).
    scroll.addEventListener('scroll', () => this.closePopovers(), { passive: true });
    this.el.appendChild(pinned);
    this.el.appendChild(scroll);

    const PINNED_TOOLS = new Set<Tool>(['pan', 'bulldoze']);
    for (const item of ITEMS) {
      if (item.kind === 'tool') {
        const btn = this.makeToolButton(item);
        if (PINNED_TOOLS.has(item.tool)) pinned.appendChild(btn);
        else scroll.appendChild(btn);
      } else {
        scroll.appendChild(this.makeGroup(item));
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

    // Popover is appended to <body>, NOT to the toolbar. The toolbar uses
    // overflow-x:auto for horizontal scrolling, which forces overflow-y to
    // a clipping value too (per CSS spec) and would clip a popover anchored
    // inside it. Body-level + position:fixed dodges all ancestor clipping.
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
      // Register popover sub-buttons in toolButtons too so setBannedTools
      // can flip their data-banned attribute alongside the top-level ones.
      this.toolButtons.set(m.tool, memBtn);
      memBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activate(m.tool);
        this.closePopovers();
      });
      pop.appendChild(memBtn);
      this.toolButtons.set(m.tool, memBtn);
    }
    document.body.appendChild(pop);
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
    const btn = this.groupButtons.get(id);
    if (!pop || !btn) return;
    // Position the popover above the group button, centred horizontally.
    // bottom-anchored so it sits just above the pill regardless of its
    // own height.
    const rect = btn.getBoundingClientRect();
    pop.style.left = `${rect.left + rect.width / 2}px`;
    pop.style.bottom = `${Math.max(0, window.innerHeight - rect.top + 6)}px`;
    pop.classList.remove('hidden');
    this.openPopoverId = id;
  }

  private closePopovers(): void {
    if (this.openPopoverId === null) return;
    for (const pop of this.groupPopovers.values()) pop.classList.add('hidden');
    this.openPopoverId = null;
  }

  private activate(tool: Tool): void {
    // Locked-by-milestone tools refuse activation and surface a toast
    // ("Unlocks at <Milestone> · NNN pop") via onLocked (Alpha 2.8).
    if (this.lockedTools.has(tool)) {
      this.onLocked?.(tool);
      return;
    }
    if (tool === this.current) return;
    this.current = tool;
    this.refreshActive();
    this.onChange?.(tool);
  }

  /**
   * Mark a set of tools as locked-by-milestone (Alpha 2.8). `hints` maps
   * tool → human label like "Town · 500 pop" used for the lock tooltip.
   * The toolbar applies `data-locked="true"` on the matching buttons,
   * which CSS uses to dim them + render a 🔒 marker. Activation is
   * refused; tapping fires `onLocked(tool)` for the toast.
   */
  setLockedTools(locked: ReadonlySet<Tool>, hints?: ReadonlyMap<Tool, string>): void {
    this.lockedTools = new Set(locked);
    for (const [tool, btn] of this.toolButtons) {
      const isLocked = this.lockedTools.has(tool);
      btn.dataset.locked = isLocked ? 'true' : 'false';
      if (isLocked) {
        const hint = hints?.get(tool);
        btn.setAttribute('title', hint ? `Locked — Unlocks at ${hint}` : 'Locked');
      } else if (!this.bannedTools.has(tool)) {
        // Don't blow away a ban-tooltip when un-locking.
        btn.removeAttribute('title');
      }
    }
    // Group buttons get a 'partial' / 'all' lock state so a player sees
    // at-a-glance which whole groups (e.g. Roads) are still gated.
    for (const item of ITEMS) {
      if (item.kind !== 'group') continue;
      const btn = this.groupButtons.get(item.id);
      if (!btn) continue;
      const total = item.members.length;
      const lockedCount = item.members.filter((m) => this.lockedTools.has(m.tool)).length;
      const allLocked = lockedCount === total && total > 0;
      const someLocked = lockedCount > 0 && !allLocked;
      btn.dataset.locked = allLocked ? 'true' : someLocked ? 'partial' : 'false';
    }
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
