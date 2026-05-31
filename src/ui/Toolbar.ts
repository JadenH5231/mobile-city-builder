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
  /** Short label that fits on the tiny toolbar pill (e.g. "R", "MU"). */
  readonly label: string;
  /** Optional full-name label shown in the popover header (e.g.
   *  "Residential", "Mixed-Use"). Defaults to `label`. Useful for
   *  groups with cryptic 1-2-letter pill labels — when the toolbar
   *  goes icon-only on a portrait phone the player needs the popover
   *  header to spell things out. */
  readonly headerLabel?: string;
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
// (ICON_RAMP + ICON_CLOVERLEAF removed in Alpha 4.18.1 with their
//  toolbar entries — kept the underlying Tools / dispatch / renderer
//  for backwards-compat but the SVGs are unused.)
// Beta 1.4 — ICON_HIGHWAY_FLIP and ICON_HIGHWAY_ONEWAY removed
// alongside the corresponding toolbar entries. Highways are now a
// single bidirectional tool. The legacy Tool values stay in the union
// for save back-compat but no toolbar pill renders them.
const ICON_PATH = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M5 20c2-3 0-5 2-8s5-2 6-5 0-4 2-5"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  <circle cx="6" cy="20" r="0.9" fill="currentColor"/>
  <circle cx="9" cy="14" r="0.9" fill="currentColor"/>
  <circle cx="13" cy="9" r="0.9" fill="currentColor"/>
  <circle cx="17" cy="4" r="0.9" fill="currentColor"/>
</svg>`;
// Roundabout (Beta 1.8) — a circular arrow with four stub roads off the
// compass points, reading instantly as "ring road, exits all directions".
const ICON_ROUNDABOUT = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 2v4 M12 18v4 M2 12h4 M18 12h4"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  <path d="M16.5 8.5a6 6 0 1 1-4.5-2"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  <path d="M12 3.2l1.8 2.4-3 .6z" fill="currentColor"/>
  <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
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
/** Tier-Max icon (Alpha 4.18) — bigger filled rect with a horizontal
 *  divider line, suggesting a mid-rise mass divided into floors. */
const ICON_TIER_MAX = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="3" y="2" width="18" height="20" stroke="currentColor"
        stroke-width="2" fill="none"/>
  <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="1.4"/>
  <line x1="3" y1="15" x2="21" y2="15" stroke="currentColor" stroke-width="1.4"/>
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

/* ---------------------------------------------------------------------- *
 * Architect Mode (Alpha 4.0) — premium / end-game tools.
 *
 * The toolbar swaps between two ITEM arrays via a leading mode-toggle
 * pill (🏗 Build / 🎨 Architect). Build mode shows the existing roster
 * (zones, roads, services, transit, etc.). Architect mode replaces it
 * with terraforming + decorative monuments — the late-game money sink
 * for cash-rich cities.
 *
 * Pan + Bulldoze stay pinned in BOTH modes so navigation + cleanup
 * never disappear behind a mode switch.
 * ---------------------------------------------------------------------- */

const ICON_TREE = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 2l5 8h-3l4 6h-4v3h-4v-3H6l4-6H7z"
        stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
</svg>`;
const ICON_MEADOW = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 20h16 M7 20c0-3 1-5 1-7 M12 20c0-4 1-6 1-9 M17 20c0-3 1-5 1-7"
        stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  <circle cx="8" cy="13" r="0.9" fill="currentColor"/>
  <circle cx="13" cy="11" r="0.9" fill="currentColor"/>
  <circle cx="18" cy="13" r="0.9" fill="currentColor"/>
</svg>`;
const ICON_POND = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <ellipse cx="12" cy="14" rx="8" ry="5"
        stroke="currentColor" stroke-width="1.6" fill="none"/>
  <path d="M5 12c2 1 4-1 6 0s4-1 7 0"
        stroke="currentColor" stroke-width="1.4" fill="none"/>
</svg>`;
const ICON_SMOOTH = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 16q3-4 9-4t9 4"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  <path d="M3 19h18"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;
const ICON_PLAZA = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="4" y="4" width="16" height="16"
        stroke="currentColor" stroke-width="1.6" fill="none"/>
  <path d="M4 12h16 M12 4v16 M8 8h2v2H8z M14 14h2v2h-2z"
        stroke="currentColor" stroke-width="1.4" fill="none"/>
</svg>`;
const ICON_FOUNTAIN = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <ellipse cx="12" cy="18" rx="8" ry="2.5"
        stroke="currentColor" stroke-width="1.5" fill="none"/>
  <path d="M12 18V8 M9 11c1-1 2-3 3-5 1 2 2 4 3 5 M7 14c1-1 1-2 2-3 M17 14c-1-1-1-2-2-3"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>
</svg>`;
const ICON_STATUE = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="8" y="18" width="8" height="3" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <path d="M12 18V11 M10 11h4 M11 11l-1-3h4l-1 3 M12 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"
        stroke="currentColor" stroke-width="1.4" fill="none"/>
</svg>`;
const ICON_FLOWER = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="9" r="2" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <circle cx="8" cy="11" r="2" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <circle cx="16" cy="11" r="2" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <circle cx="10" cy="14" r="2" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <circle cx="14" cy="14" r="2" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <path d="M12 16v5" stroke="currentColor" stroke-width="1.4"/>
</svg>`;
const ICON_TOPIARY = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M5 18V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10z M5 12h14 M9 6v12 M15 6v12"
        stroke="currentColor" stroke-width="1.5" fill="none"/>
</svg>`;
const ICON_PERGOLA = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 6h16 M5 6v14 M19 6v14 M4 6q4-4 8-4t8 4 M8 10h8 M8 14h8"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>
</svg>`;
const ICON_REFLECT = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="3" y="9" width="18" height="6" rx="1"
        stroke="currentColor" stroke-width="1.6" fill="none"/>
  <path d="M5 12h14"
        stroke="currentColor" stroke-width="1" stroke-dasharray="2 2"/>
</svg>`;
const ICON_MEMORIAL = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 3l3 4-3 4-3-4z M12 11v9 M5 20h14"
        stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>
  <path d="M7 17q1 2 5 1t5-1"
        stroke="currentColor" stroke-width="1.2" fill="none"/>
</svg>`;
const ICON_CLOCK_TOWER = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M9 21V8h6v13 M9 8l3-5 3 5 M11 21v-3h2v3"
        stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>
  <circle cx="12" cy="13" r="2.2" stroke="currentColor" stroke-width="1.2" fill="none"/>
  <path d="M12 12v1.5l1 0.5" stroke="currentColor" stroke-width="1.1"/>
</svg>`;
const ICON_ARCH = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M4 21V11a8 8 0 0 1 16 0v10 M8 21V13a4 4 0 0 1 8 0v8 M4 21h16"
        stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>
</svg>`;
const ICON_PIER = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 13h18 M5 13v8 M9 13v8 M13 13v8 M17 13v8 M21 13v8 M3 13l2-3h12l2 3"
        stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
</svg>`;
const ICON_TERRA = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 18l5-7 4 4 4-6 5 9z M3 21h18"
        stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
</svg>`;
const ICON_GARDEN = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <circle cx="16" cy="9" r="2.5" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <circle cx="11" cy="14" r="3" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <path d="M3 21h18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;
const ICON_MONUMENT = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M9 21V7l3-4 3 4v14 M5 21h14"
        stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" fill="none"/>
</svg>`;
/** Mayor's Mansion icon (Alpha 4.2) — colonnaded grand house with a
 *  pediment, reads instantly as "civic estate". */
const ICON_MANSION = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 21h18 M3 21V11l9-7 9 7v10 M6 21V14h3v7 M11 21v-5h2v5 M15 21v-7h3v7"
        stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
  <circle cx="12" cy="3" r="0.6" fill="currentColor"/>
</svg>`;
/** City Hall icon (Alpha 4.12) — domed rotunda with portico columns. */
const ICON_CITY_HALL = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 21h18 M5 21V13 M9 21V13 M15 21V13 M19 21V13 M4 13h16 M5 13l7-5 7 5"
        stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
  <path d="M8 8a4 4 0 0 1 8 0" stroke="currentColor" stroke-width="1.5" fill="none"/>
  <line x1="12" y1="2" x2="12" y2="4.5" stroke="currentColor" stroke-width="1.5"/>
</svg>`;
/** Provincial Capital icon — central pyramidal-roofed tower with two wings. */
const ICON_PROVINCIAL = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 21h18 M5 21V14 M10 21V11 M14 21V11 M19 21V14 M5 14l3-3v0l0 0 M19 14l-3-3 M10 11l2-3 2 3"
        stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
  <line x1="12" y1="3" x2="12" y2="8" stroke="currentColor" stroke-width="1.5"/>
</svg>`;
/** National Capital icon — tall central clock tower with wings + spire. */
const ICON_NATIONAL = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M3 21h18 M5 21V14 M10 21V8 M14 21V8 M19 21V14 M5 14h5 M14 14h5"
        stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
  <path d="M10 8l2-2 2 2" stroke="currentColor" stroke-width="1.4" fill="none"/>
  <line x1="12" y1="6" x2="12" y2="2" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="12" cy="11.5" r="1.2" stroke="currentColor" stroke-width="1.1" fill="none"/>
</svg>`;

const BUILD_ITEMS: readonly ToolbarItem[] = [
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
      // Beta 1.4 — `road_highway_oneway` (1-Way variant) and
      // `highway_flip` (direction flip) were retired with the one-way
      // highway model. Highways are now bidirectional divided multi-
      // lane roads on a single tile; no companion tools needed. The
      // Tool values + dispatcher remain for legacy state but the
      // toolbar surface is simpler.
      //
      // Ramp + Cloverleaf were scrapped from the UI in Alpha 4.18.1 per
      // playtest feedback ("didn't like the merge lane or the
      // cloverleafs"). The Tools, dispatch, faction stances, and
      // renderer code are intentionally LEFT IN PLACE so existing
      // saves with ramp / cloverleaf tiles still display correctly —
      // the player can bulldoze them but can't make new ones.
      { kind: 'tool', tool: 'place_path',   label: 'Path',    icon: ICON_PATH },
      // Roundabouts (Beta 1.8) — tap-to-place ring-road prefabs. Small =
      // 2×2, large = 3×3 with a bigger central island/monument.
      { kind: 'tool', tool: 'place_roundabout_small', label: 'Roundabout', icon: ICON_ROUNDABOUT },
      { kind: 'tool', tool: 'place_roundabout_large', label: 'Big Roundabout', icon: ICON_ROUNDABOUT }
    ]
  },
  {
    kind: 'group',
    id: 'residential',
    label: 'R',
    headerLabel: 'Residential',
    icon: ICON_R,
    members: [
      { kind: 'tool', tool: 'residential_low',    label: 'Low',  icon: ICON_TIER_LOW },
      { kind: 'tool', tool: 'residential_medium', label: 'Med',  icon: ICON_TIER_MED },
      { kind: 'tool', tool: 'residential_high',   label: 'High', icon: ICON_TIER_HIGH },
      // Level 4 / Max density (Alpha 4.18). Sits between High and Sky.
      { kind: 'tool', tool: 'residential_max',    label: 'Max',  icon: ICON_TIER_MAX },
      { kind: 'tool', tool: 'residential_luxury_low', label: 'Lux',  icon: ICON_TIER_LUX },
      { kind: 'tool', tool: 'residential_skyscraper', label: 'Sky',  icon: ICON_TIER_SKY }
    ]
  },
  {
    kind: 'group',
    id: 'commercial',
    label: 'C',
    headerLabel: 'Commercial',
    icon: ICON_C,
    members: [
      { kind: 'tool', tool: 'commercial_low',    label: 'Low',  icon: ICON_TIER_LOW },
      { kind: 'tool', tool: 'commercial_medium', label: 'Med',  icon: ICON_TIER_MED },
      { kind: 'tool', tool: 'commercial_high',   label: 'High', icon: ICON_TIER_HIGH },
      { kind: 'tool', tool: 'commercial_max',    label: 'Max',  icon: ICON_TIER_MAX },
      { kind: 'tool', tool: 'commercial_skyscraper', label: 'Sky',  icon: ICON_TIER_SKY }
    ]
  },
  {
    kind: 'group',
    id: 'industrial',
    label: 'I',
    headerLabel: 'Industrial',
    icon: ICON_I,
    members: [
      { kind: 'tool', tool: 'industrial_low',    label: 'Low',  icon: ICON_TIER_LOW },
      { kind: 'tool', tool: 'industrial_medium', label: 'Med',  icon: ICON_TIER_MED },
      { kind: 'tool', tool: 'industrial_high',   label: 'High', icon: ICON_TIER_HIGH },
      { kind: 'tool', tool: 'industrial_max',    label: 'Max',  icon: ICON_TIER_MAX }
    ]
  },
  {
    kind: 'group',
    id: 'mixed',
    label: 'MU',
    headerLabel: 'Mixed-Use',
    icon: ICON_MU,
    members: [
      { kind: 'tool', tool: 'mixed_low',    label: 'Low',  icon: ICON_TIER_LOW },
      { kind: 'tool', tool: 'mixed_medium', label: 'Med',  icon: ICON_TIER_MED },
      { kind: 'tool', tool: 'mixed_high',   label: 'High', icon: ICON_TIER_HIGH },
      { kind: 'tool', tool: 'mixed_max',    label: 'Max',  icon: ICON_TIER_MAX },
      { kind: 'tool', tool: 'mixed_skyscraper', label: 'Sky',  icon: ICON_TIER_SKY }
    ]
  },
  // Services group (Alpha 4.1 toolbar rework) — utilities + parks +
  // public services consolidated. Pre-4.1 these were 7 individual
  // top-level toolbar buttons (Power, Water, Park, School, Hospital,
  // Fire, Police), which buried the toolbar behind a long horizontal
  // scroll on portrait phones. Same Tools, just one expandable pill
  // instead of seven.
  {
    kind: 'group',
    id: 'services',
    label: 'Services',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7z M9 12.5h6 M12 9.5v6"
            stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"
            stroke-linecap="round" fill="none"/>
    </svg>`,
    members: [
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
      </svg>` }
    ]
  },
  // Industry group (Alpha 4.1) — export industries.
  {
    kind: 'group',
    id: 'industry',
    label: 'Industry',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 18V11l5 4V11l5 4V8l8 4v6z M3 21h18"
            stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    </svg>`,
    members: [
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
      // Big Box store (Beta 1.3). Wide, low retail box icon — square
      // outline with a fascia stripe + entry doors hint.
      { kind: 'tool', tool: 'place_big_box', label: 'Big Box', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9h18v11H3z M3 9l2-4h14l2 4 M10 14h4v6h-4z"
              stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
      </svg>` },
      // Warehouse (Beta 1.6). Long low building with a row of loading-dock
      // doors along the bottom — the iconic warehouse silhouette.
      { kind: 'tool', tool: 'place_warehouse', label: 'Warehouse', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 10h18v10H3z M3 10l9-5 9 5"
              stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
        <path d="M6 16h2v4H6z M11 16h2v4h-2z M16 16h2v4h-2z"
              stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" fill="none"/>
      </svg>` },
      // Parking Lot (Beta 1.3). 2x3-stall grid hint — pure geometric.
      { kind: 'tool', tool: 'place_parking_lot', label: 'Parking', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 4h18v16H3z M7 4v16 M13 4v16 M19 4v16 M3 12h18"
              stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
      </svg>` }
    ]
  },
  // Transit group (Alpha 4.1) — every transit-related tool consolidated:
  // bus stop / depot, traffic control (stop sign + traffic light), and
  // alternative modes (ferry + subway). Pre-4.1 these were split across
  // 4 individual top-level buttons + a 2-item "Trnst" group.
  {
    kind: 'group',
    id: 'transit',
    label: 'Transit',
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="4" width="12" height="14" rx="2"
            stroke="currentColor" stroke-width="1.6" fill="none"/>
      <path d="M6 12h12 M9 18v2 M15 18v2"
            stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    </svg>`,
    members: [
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
  // Landmarks (Alpha 2.17). Grouped popover so the toolbar stays scannable.
  // Each one generates monthly tourism revenue scaled by city pop.
  {
    kind: 'group',
    id: 'landmarks',
    label: 'Landmarks',
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
    label: 'Districts',
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
  { kind: 'tool', tool: 'bulldoze', label: 'Bulldoze', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <!-- Wrecking-ball crane (Beta 1.5.4) — base + vertical mast + horizontal boom
         in the heavy stroke; diagonal truss brace + hoist cable in the thin
         stroke; solid wrecking ball at the end. Reads as a demolition tool at
         a glance, more "destruction" than the prior bulldozer silhouette. -->
    <path d="M3 21h6M6 21V4M6 4h13"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" fill="none"/>
    <path d="M6 11L17 4M19 4v9"
          stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <circle cx="19" cy="16" r="3" fill="currentColor"/>
  </svg>` },
  // Land tool retired Alpha 3.2.1 — replaced by tap-on-+-button city
  // expansion. The buy_land tool stays in the type union so existing
  // saves with the tool selected don't crash; it's just no longer in
  // the toolbar.
];

const ARCHITECT_ITEMS: readonly ToolbarItem[] = [
  { kind: 'tool', tool: 'pan', label: 'Pan', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2v6M12 22v-6M2 12h6M22 12h-6"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
    <circle cx="12" cy="12" r="3" fill="currentColor"/>
  </svg>` },
  // Bulldoze is pinned in BOTH modes — terraforming + decorative
  // placements still need a way to undo a misplaced item.
  { kind: 'tool', tool: 'bulldoze', label: 'Bulldoze', icon: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <!-- Wrecking-ball crane (Beta 1.5.4) — base + vertical mast + horizontal boom
         in the heavy stroke; diagonal truss brace + hoist cable in the thin
         stroke; solid wrecking ball at the end. Reads as a demolition tool at
         a glance, more "destruction" than the prior bulldozer silhouette. -->
    <path d="M3 21h6M6 21V4M6 4h13"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" fill="none"/>
    <path d="M6 11L17 4M19 4v9"
          stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <circle cx="19" cy="16" r="3" fill="currentColor"/>
  </svg>` },
  // Terraforming — landscape sculpting (cheap basics).
  {
    kind: 'group',
    id: 'terra',
    label: 'Terra',
    icon: ICON_TERRA,
    members: [
      { kind: 'tool', tool: 'terra_tree',   label: 'Tree',     icon: ICON_TREE },
      { kind: 'tool', tool: 'terra_meadow', label: 'Meadow',   icon: ICON_MEADOW },
      { kind: 'tool', tool: 'terra_pond',   label: 'Pond',     icon: ICON_POND },
      { kind: 'tool', tool: 'terra_smooth', label: 'Smooth',   icon: ICON_SMOOTH }
    ]
  },
  // Plazas — paved public realm. Mid-tier prestige.
  {
    kind: 'group',
    id: 'plazas',
    label: 'Plaza',
    icon: ICON_PLAZA,
    members: [
      { kind: 'tool', tool: 'place_plaza',          label: 'Plaza',   icon: ICON_PLAZA },
      { kind: 'tool', tool: 'place_pergola',        label: 'Pergola', icon: ICON_PERGOLA },
      { kind: 'tool', tool: 'place_reflecting_pool',label: 'Pool',    icon: ICON_REFLECT },
      { kind: 'tool', tool: 'place_pier',           label: 'Pier',    icon: ICON_PIER }
    ]
  },
  // Gardens — soft landscape features.
  {
    kind: 'group',
    id: 'gardens',
    label: 'Garden',
    icon: ICON_GARDEN,
    members: [
      { kind: 'tool', tool: 'place_flower_bed',     label: 'Bed',     icon: ICON_FLOWER },
      { kind: 'tool', tool: 'place_topiary',        label: 'Topiary', icon: ICON_TOPIARY },
      { kind: 'tool', tool: 'place_memorial_garden',label: 'Memorial',icon: ICON_MEMORIAL }
    ]
  },
  // Monuments — premium end-game money sinks.
  {
    kind: 'group',
    id: 'monuments',
    label: 'Mon',
    headerLabel: 'Monuments',
    icon: ICON_MONUMENT,
    members: [
      { kind: 'tool', tool: 'place_statue',          label: 'Statue',   icon: ICON_STATUE },
      { kind: 'tool', tool: 'place_fountain',        label: 'Fountain', icon: ICON_FOUNTAIN },
      { kind: 'tool', tool: 'place_clock_tower',     label: 'Tower',    icon: ICON_CLOCK_TOWER },
      { kind: 'tool', tool: 'place_triumphal_arch',  label: 'Arch',     icon: ICON_ARCH },
      // The Mayor's Mansion (Alpha 4.2) — single-instance 4×2
      // showpiece. Sits in the Mon group as the original apex prestige
      // build.
      { kind: 'tool', tool: 'place_mayor_mansion',   label: 'Mansion',  icon: ICON_MANSION },
      // Civic monuments (Alpha 4.12) — three escalating one-per-city
      // builds, each providing a 35-tile L3 service field. Listed at
      // the END of the Mon group so they read as the new apex tier.
      { kind: 'tool', tool: 'place_city_hall',          label: 'City Hall',   icon: ICON_CITY_HALL },
      { kind: 'tool', tool: 'place_provincial_capital', label: 'Provincial', icon: ICON_PROVINCIAL },
      { kind: 'tool', tool: 'place_national_capital',   label: 'National',   icon: ICON_NATIONAL }
    ]
  }
];

/** Toolbar mode (Alpha 4.0). 'build' = the simulation toolbar; 'architect'
 *  = the terraforming + monuments toolbar. The mode-toggle pill at the
 *  far left swaps between them. Pan + Bulldoze stay pinned in both modes
 *  so navigation + cleanup never disappear. */
export type ToolbarMode = 'build' | 'architect';

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
  /** Lock tooltip hints — last passed via setLockedTools. Kept around
   *  so a mode-swap re-render can re-apply them without Game having
   *  to re-broadcast (Alpha 4.0). */
  private lockedHints: ReadonlyMap<Tool, string> | undefined;
  /** Active mode (Alpha 4.0). 'build' = simulation toolbar (default),
   *  'architect' = terraforming + monuments toolbar. The leading
   *  mode-toggle pill swaps between them. */
  private mode: ToolbarMode = 'build';
  /** The scrollable strip inside the toolbar. Held so we can read its
   *  scrollLeft / scrollWidth / clientWidth in updateScrollState (Beta
   *  1.2.1 — iPhone-mini overflow affordance). */
  private scrollEl: HTMLElement | null = null;
  onChange?: (tool: Tool) => void;
  /** Fired when the user taps a locked tool — Game wires this to a toast. */
  onLocked?: (tool: Tool) => void;
  /** Fired when the player toggles between Build / Architect modes
   *  (Alpha 4.0). Game wires this so it can pre-select Pan on the swap
   *  (no orphan paint state across modes). */
  onModeChange?: (mode: ToolbarMode) => void;

  /** Currently-active items array. Driven by `mode`. */
  private get items(): readonly ToolbarItem[] {
    return this.mode === 'architect' ? ARCHITECT_ITEMS : BUILD_ITEMS;
  }

  constructor() {
    const el = document.getElementById('toolbar');
    if (!el) throw new Error('Toolbar: missing #toolbar');
    this.el = el;
    this.render();

    // Re-evaluate overflow state on viewport changes (rotation, keyboard
    // pop, browser-chrome show/hide) so the fade-edges / chevrons stay
    // correct. Beta 1.2.1 — part of the iPhone-mini overflow fix.
    window.addEventListener('resize', () => this.updateScrollState(), { passive: true });

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
    for (const item of this.items) {
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
    // Tear down any popovers from a previous render — they live on
    // <body>, not in `this.el`, so emptying `el.innerHTML` won't reach
    // them and they'd leak as the toolbar is re-rendered (e.g. when
    // swapping modes). Free each one explicitly first.
    for (const pop of this.groupPopovers.values()) {
      pop.parentElement?.removeChild(pop);
    }
    this.groupPopovers.clear();
    this.groupButtons.clear();
    this.toolButtons.clear();

    this.el.innerHTML = '';
    // Three sections (Alpha 4.0): the leading mode-toggle pill swaps
    // Build ↔ Architect; pinned cluster (Pan + Bulldoze) is always
    // visible regardless of mode; scroll strip carries everything else.
    const modeWrap = document.createElement('div');
    modeWrap.className = 'toolbar__mode';
    const pinned = document.createElement('div');
    pinned.className = 'toolbar__pinned';
    const scroll = document.createElement('div');
    scroll.className = 'toolbar__scroll';
    // Re-close popovers when the scroll strip is panned + update the
    // overflow indicators so the fade-edges / chevrons reflect whether
    // there's more content past either side. Beta 1.2.1 — bug fix for
    // iPhone mini (375px) where users couldn't tell the toolbar
    // scrolled past Bulldoze.
    scroll.addEventListener('scroll', () => {
      this.closePopovers();
      this.updateScrollState();
    }, { passive: true });
    // Beta 1.6.20 — desktop wheel scrolling. Mac trackpads emit deltaX
    // on a two-finger horizontal swipe and the browser auto-scrolls the
    // overflow:auto container, so trackpad users were fine. A standard
    // mouse wheel only emits deltaY, which the browser tries to apply
    // to the page (no effect — body isn't scrollable) instead of the
    // toolbar — desktop-mouse users saw the chevron hint but had no way
    // to actually pan the strip. Fix: when there's horizontal overflow
    // AND the input is wheel-only (no horizontal component), translate
    // deltaY into scrollLeft. Shift+wheel still works because it already
    // produces deltaX in browsers, so we skip our handler in that case
    // and let the native behaviour win.
    scroll.addEventListener('wheel', (e) => {
      if (scroll.scrollWidth <= scroll.clientWidth) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      scroll.scrollLeft += e.deltaY;
    }, { passive: false });
    this.el.appendChild(modeWrap);
    this.el.appendChild(pinned);
    this.el.appendChild(scroll);
    // Chevron hints — small text glyphs absolutely positioned over the
    // toolbar edges. CSS shows/hides each based on data-scroll-state.
    const hintLeft = document.createElement('span');
    hintLeft.className = 'toolbar__scroll-hint toolbar__scroll-hint--left';
    hintLeft.setAttribute('aria-hidden', 'true');
    hintLeft.textContent = '‹';
    const hintRight = document.createElement('span');
    hintRight.className = 'toolbar__scroll-hint toolbar__scroll-hint--right';
    hintRight.setAttribute('aria-hidden', 'true');
    hintRight.textContent = '›';
    this.el.appendChild(hintLeft);
    this.el.appendChild(hintRight);
    this.scrollEl = scroll;

    // Mode-toggle pill (Alpha 4.0). Cycles Build → Architect → Build.
    // Renders as a single pill with a dynamic label/icon so the player
    // can always see which mode they're in at a glance.
    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'toolbar__btn toolbar__btn--mode';
    modeBtn.dataset.mode = this.mode;
    modeBtn.setAttribute('aria-label',
      this.mode === 'architect' ? 'Switch to Build mode' : 'Switch to Architect mode'
    );
    const isArchitect = this.mode === 'architect';
    const modeIcon = isArchitect
      ? `<svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 19l4-1 9-9-3-3-9 9z M14 6l3 3"
                stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" fill="none"/>
        </svg>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 11l9-7 9 7v9H3z M9 20v-6h6v6"
                stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
        </svg>`;
    modeBtn.innerHTML = `<span class="toolbar__icon" aria-hidden="true">${modeIcon}</span><span class="toolbar__label">${isArchitect ? 'Architect' : 'Build'}</span>`;
    modeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMode();
    });
    modeWrap.appendChild(modeBtn);

    const PINNED_TOOLS = new Set<Tool>(['pan', 'bulldoze']);
    for (const item of this.items) {
      if (item.kind === 'tool') {
        const btn = this.makeToolButton(item);
        if (PINNED_TOOLS.has(item.tool)) pinned.appendChild(btn);
        else scroll.appendChild(btn);
      } else {
        scroll.appendChild(this.makeGroup(item));
      }
    }
    // Initial overflow-state paint + one-time scroll-teach animation
    // for first-time players on narrow viewports (Beta 1.2.1). The
    // setTimeout lets the layout settle so scrollWidth is correct.
    setTimeout(() => {
      this.updateScrollState();
      this.maybeRunFirstLaunchScrollHint();
    }, 0);
  }

  /**
   * Update the toolbar's data-scroll-state attribute based on whether
   * the scroll strip has more content past either end. CSS uses this
   * to fade the appropriate edge and reveal the chevron hint.
   *
   * States: 'none' (no overflow) | 'start' (at scrollLeft 0, more to right)
   *       | 'middle' (more on both sides) | 'end' (scrolled to rightmost).
   *
   * Beta 1.2.1 — fixes iPhone-mini bug where users couldn't tell the
   * toolbar scrolled past Bulldoze.
   */
  private updateScrollState(): void {
    const scroll = this.scrollEl;
    if (!scroll) return;
    const overflow = scroll.scrollWidth - scroll.clientWidth;
    let state: 'none' | 'start' | 'middle' | 'end';
    if (overflow <= 2) {
      state = 'none';
    } else {
      const sl = scroll.scrollLeft;
      const atStart = sl <= 1;
      const atEnd = sl >= overflow - 1;
      state = atStart ? 'start' : atEnd ? 'end' : 'middle';
    }
    this.el.dataset.scrollState = state;
  }

  /**
   * One-time scroll-teach animation on first launch (Beta 1.2.1). When
   * the toolbar has overflow and the player hasn't been hinted before,
   * we briefly scroll right ~30px and back so the gesture is shown.
   * Tracked via localStorage; safe in private mode (the catch swallows
   * a denied write and the hint just doesn't replay).
   */
  private maybeRunFirstLaunchScrollHint(): void {
    const KEY = 'mqcity-toolbar-scroll-hinted';
    try {
      if (localStorage.getItem(KEY) === '1') return;
    } catch { /* private mode — fall through and animate once per session */ }
    const scroll = this.scrollEl;
    if (!scroll) return;
    const overflow = scroll.scrollWidth - scroll.clientWidth;
    if (overflow <= 2) return; // no overflow → nothing to teach
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    // Add the pulse class so the right chevron also bobs in sync with
    // the scroll, then animate scrollLeft 0 → 36 → 0 over ~1.2s.
    this.el.classList.add('is-scroll-hinting');
    const target = Math.min(40, overflow);
    const start = performance.now();
    const dur = 1100;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / dur);
      // Ease in-out then back: 0 → 1 → 0 across t ∈ [0, 1].
      const phase = t < 0.5 ? t * 2 : (1 - t) * 2;
      const ease = phase * phase * (3 - 2 * phase); // smoothstep
      scroll.scrollLeft = target * ease;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        scroll.scrollLeft = 0;
        this.el.classList.remove('is-scroll-hinting');
      }
    };
    requestAnimationFrame(tick);
  }

  /**
   * Swap Build ↔ Architect mode (Alpha 4.0). Re-renders the toolbar
   * with the new ITEMS array and resets the active tool to Pan so the
   * player doesn't keep painting under a tool that no longer exists in
   * the new mode. Re-applies banned + locked state so visual gating
   * carries across mode switches.
   */
  private toggleMode(): void {
    this.mode = this.mode === 'architect' ? 'build' : 'architect';
    this.closePopovers();
    this.current = 'pan';
    this.render();
    // Re-apply gating since render() rebuilt every button. Maps stay
    // intact across the swap (banned / locked sets are the same).
    this.setBannedTools(this.bannedTools);
    this.setLockedTools(this.lockedTools);
    this.refreshActive();
    this.onModeChange?.(this.mode);
    this.onChange?.(this.current);
  }

  /** Public mode getter for Game (e.g. status messages, tool-info hints). */
  getMode(): ToolbarMode {
    return this.mode;
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
    //
    // Alpha 4.1 toolbar rework: popovers now have a small header showing
    // the category name (helps the player keep their place when they
    // open a category by accident), and a flex-wrap grid body that lets
    // 6-7-item categories like Services / Transit display tidily on a
    // narrow phone instead of overflowing horizontally.
    const pop = document.createElement('div');
    pop.className = 'toolbar__popover hidden';
    pop.dataset.group = group.id;
    pop.setAttribute('role', 'menu');
    const header = document.createElement('div');
    header.className = 'toolbar__popover-header';
    // Prefer `headerLabel` (full word like "Residential") over the
    // short pill `label` ("R") so a player tapping an icon-only pill
    // on a portrait phone sees what they actually opened.
    header.textContent = group.headerLabel ?? group.label;
    pop.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'toolbar__popover-grid';
    pop.appendChild(grid);
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
      grid.appendChild(memBtn);
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
    // Show first so we can measure the popover's actual rendered size
    // (transform/translateX trick needs the post-layout width to clamp
    // correctly inside the viewport on portrait phones — Alpha 4.1).
    pop.classList.remove('hidden');
    const btnRect = btn.getBoundingClientRect();
    const desiredCenter = btnRect.left + btnRect.width / 2;
    // Clamp the popover so it never spills off-screen on a narrow
    // phone. CSS uses translateX(-50%) so we anchor the centre line.
    const popWidth = pop.offsetWidth || 280;
    const margin = 12;
    const halfPop = popWidth / 2;
    const minCentre = margin + halfPop;
    const maxCentre = window.innerWidth - margin - halfPop;
    const clampedCentre = Math.max(minCentre, Math.min(maxCentre, desiredCenter));
    pop.style.left = `${clampedCentre}px`;
    pop.style.bottom = `${Math.max(0, window.innerHeight - btnRect.top + 6)}px`;
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
    if (hints) this.lockedHints = hints;
    for (const [tool, btn] of this.toolButtons) {
      const isLocked = this.lockedTools.has(tool);
      btn.dataset.locked = isLocked ? 'true' : 'false';
      if (isLocked) {
        const hint = (hints ?? this.lockedHints)?.get(tool);
        btn.setAttribute('title', hint ? `Locked — Unlocks at ${hint}` : 'Locked');
      } else if (!this.bannedTools.has(tool)) {
        // Don't blow away a ban-tooltip when un-locking.
        btn.removeAttribute('title');
      }
    }
    // Group buttons get a 'partial' / 'all' lock state so a player sees
    // at-a-glance which whole groups (e.g. Roads) are still gated.
    for (const item of this.items) {
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
    for (const item of this.items) {
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
