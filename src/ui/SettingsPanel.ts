/**
 * Settings panel (Alpha 4.8) — modal owning every cross-cutting
 * preference: difficulty, audio volumes, UI scale, colourblind palette,
 * reduce-motion, default sim speed, reset-confirmation toggle.
 *
 * Persistence: each setting writes to `localStorage` under a stable
 * key (`mq-city-settings`) on every change. On boot, `Settings.load()`
 * reads the dict and applies side effects (UI scale class on <html>,
 * palette class on <body>).
 *
 * Difficulty is a player-facing axis that affects NEW cities only —
 * applied on reset / fresh slot. Mid-game changes don't retroactively
 * resize the treasury; that would feel like cheating.
 */

export type Difficulty = 'easy' | 'normal' | 'hard' | 'sandbox';
export type UIScale = 'small' | 'normal' | 'large' | 'xlarge';
export type Palette = 'none' | 'deuteranopia' | 'protanopia' | 'tritanopia';
/** Parking-management strictness (Beta 1.3.5 — Phase 3). Determines
 *  how much the player has to think about parking.
 *  - 'off': parking lots are decorative. No reservations, no penalty.
 *  - 'lenient': cars use parking when available, no penalty if missing.
 *    Current default — what Phase 2 + 2.1 already do.
 *  - 'realistic': under-parked commercial tiles (no 4-adjacent
 *    parking_lot) take a -15% revenue penalty each month.
 *  - 'strict': under-parked commercial tiles take a -30% penalty.
 *    Same routing as Realistic.
 */
export type ParkingStrictness = 'off' | 'lenient' | 'realistic' | 'strict';

export interface SettingsData {
  difficulty: Difficulty;
  volumeMaster: number;  // 0–100
  volumeMusic: number;
  volumeSfx: number;
  uiScale: UIScale;
  palette: Palette;
  reduceMotion: boolean;
  defaultSimSpeed: 0 | 1 | 2 | 3;
  confirmReset: boolean;
  /** Show the FPS counter pill in the HUD (Beta 1.2.3). Off by default
   *  — most players don't care about framerate; it's debug noise. Power
   *  users can toggle it from Settings → Display. */
  showFps: boolean;
  /** Parking-management strictness (Beta 1.3.5). See `ParkingStrictness`. */
  parkingStrictness: ParkingStrictness;
}

const STORAGE_KEY = 'mq-city-settings';

const DEFAULTS: SettingsData = {
  difficulty: 'normal',
  volumeMaster: 80,
  volumeMusic: 60,
  volumeSfx: 80,
  uiScale: 'normal',
  palette: 'none',
  reduceMotion: false,
  // Default to paused (Beta 1.2.3) — matches city-builder convention
  // (Cities: Skylines / SimCity start paused) so new players don't bleed
  // treasury while they're reading the tutorial / exploring menus. The
  // player taps ▶ on the HUD speed pill when they're ready to start
  // the sim. Existing users with a saved setting keep their preference.
  defaultSimSpeed: 0,
  confirmReset: true,
  showFps: false,
  // Lenient = current behaviour (cars use parking when available, no
  // penalty if missing). The default lets new players experience the
  // visible parking + walker without managing it as a mechanic.
  parkingStrictness: 'lenient'
};

/** Difficulty effects table — single source of truth for downstream
 *  systems (Economy.treasury seed, Population demand modifier,
 *  Events frequency multiplier). */
export const DIFFICULTY_EFFECTS: Record<Difficulty, {
  startingTreasury: number;
  demandMod: number;        // additive on RCI demand
  eventFrequencyMult: number;
  label: string;
}> = {
  easy:    { startingTreasury: 30_000, demandMod:  0.15, eventFrequencyMult: 0.5, label: 'Easy' },
  normal:  { startingTreasury: 15_000, demandMod:  0.00, eventFrequencyMult: 1.0, label: 'Normal' },
  hard:    { startingTreasury:  8_000, demandMod: -0.10, eventFrequencyMult: 1.5, label: 'Hard' },
  sandbox: { startingTreasury: 1_000_000, demandMod: 0.30, eventFrequencyMult: 0.0, label: 'Sandbox' }
};

export class Settings {
  data: SettingsData = { ...DEFAULTS };

  /** Read from localStorage, fill in any missing fields with defaults. */
  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SettingsData>;
      this.data = { ...DEFAULTS, ...parsed };
    } catch {
      // Quota / private-mode / corrupt JSON — fall back to defaults.
    }
    this.applyCssSideEffects();
  }

  /** Write to localStorage. Called automatically after every setter. */
  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Quota / private-mode — silently ignore; in-memory state is the
      // source of truth this session.
    }
  }

  /** Apply UI scale + palette classes to <html> + <body>. Called on
   *  load + after any setter that touches those fields. */
  private applyCssSideEffects(): void {
    const html = document.documentElement;
    html.classList.remove('ui-scale-small', 'ui-scale-large', 'ui-scale-xlarge');
    if (this.data.uiScale === 'small')  html.classList.add('ui-scale-small');
    if (this.data.uiScale === 'large')  html.classList.add('ui-scale-large');
    if (this.data.uiScale === 'xlarge') html.classList.add('ui-scale-xlarge');

    const body = document.body;
    body.classList.remove('palette-deuteranopia', 'palette-protanopia', 'palette-tritanopia');
    if (this.data.palette !== 'none') body.classList.add(`palette-${this.data.palette}`);
    // FPS counter visibility (Beta 1.2.3). Hidden by default; the CSS
    // reveals #hud-fps only when this attribute is present.
    if (this.data.showFps) body.dataset.showFps = 'true';
    else delete body.dataset.showFps;
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    this.data[key] = value;
    this.save();
    if (key === 'uiScale' || key === 'palette' || key === 'showFps') this.applyCssSideEffects();
  }

  resetToDefaults(): void {
    this.data = { ...DEFAULTS };
    this.save();
    this.applyCssSideEffects();
  }
}

/**
 * Wire up the settings modal DOM. Called once from main.ts after the
 * Settings instance is loaded. Reads the current settings, paints the
 * controls, and binds change handlers.
 *
 * The `onShowTutorial` and `onResetAll` callbacks are wired by main.ts
 * so this UI module doesn't need to know about Game.
 */
export function bindSettingsPanel(
  settings: Settings,
  hooks: { onShowTutorial: () => void; onResetAll: () => void; }
): { show(): void; hide(): void } {
  const panel = document.getElementById('settings-panel');
  if (!panel) return { show() {/* noop */}, hide() {/* noop */} };
  const closeBtn = document.getElementById('settings-close');
  closeBtn?.addEventListener('click', () => panel.classList.add('hidden'));

  // Difficulty grid — radio-style selection.
  const diffBtns = panel.querySelectorAll<HTMLButtonElement>('.settings__diff');
  const paintDiff = (): void => {
    diffBtns.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.value === settings.data.difficulty));
    });
  };
  diffBtns.forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.dataset.value as Difficulty | undefined;
      if (!v) return;
      settings.set('difficulty', v);
      paintDiff();
    });
  });

  // Generic slider wiring.
  const bindSlider = (id: string, key: 'volumeMaster' | 'volumeMusic' | 'volumeSfx'): void => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    const lbl = document.getElementById(id + '-val');
    if (!el) return;
    el.value = String(settings.data[key]);
    if (lbl) lbl.textContent = String(settings.data[key]);
    el.addEventListener('input', () => {
      const v = Number(el.value);
      settings.set(key, v);
      if (lbl) lbl.textContent = String(v);
    });
  };
  bindSlider('setting-vol-master', 'volumeMaster');
  bindSlider('setting-vol-music',  'volumeMusic');
  bindSlider('setting-vol-sfx',    'volumeSfx');

  // Selects (UI scale, palette, default sim speed).
  const bindSelect = <K extends keyof SettingsData>(id: string, key: K): void => {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (!el) return;
    el.value = String(settings.data[key]);
    el.addEventListener('change', () => {
      const v = el.value as SettingsData[K] extends string ? string : number;
      const cast = (key === 'defaultSimSpeed' ? Number(v) : v) as SettingsData[K];
      settings.set(key, cast);
    });
  };
  bindSelect('setting-ui-scale', 'uiScale');
  bindSelect('setting-palette', 'palette');
  bindSelect('setting-default-speed', 'defaultSimSpeed');
  bindSelect('setting-parking-strictness', 'parkingStrictness');

  // Checkboxes.
  const bindCheck = <K extends keyof SettingsData>(id: string, key: K): void => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.checked = Boolean(settings.data[key]);
    el.addEventListener('change', () => settings.set(key, el.checked as SettingsData[K]));
  };
  bindCheck('setting-reduce-motion', 'reduceMotion');
  bindCheck('setting-confirm-reset', 'confirmReset');
  bindCheck('setting-show-fps', 'showFps');

  document.getElementById('setting-show-tutorial')?.addEventListener('click', () => {
    hooks.onShowTutorial();
    panel.classList.add('hidden');
  });
  document.getElementById('setting-reset-all')?.addEventListener('click', () => {
    settings.resetToDefaults();
    hooks.onResetAll();
    // Re-paint controls from the now-default state.
    paintDiff();
    bindSlider('setting-vol-master', 'volumeMaster');
    bindSlider('setting-vol-music',  'volumeMusic');
    bindSlider('setting-vol-sfx',    'volumeSfx');
    bindSelect('setting-ui-scale', 'uiScale');
    bindSelect('setting-palette', 'palette');
    bindSelect('setting-default-speed', 'defaultSimSpeed');
    bindSelect('setting-parking-strictness', 'parkingStrictness');
    bindCheck('setting-reduce-motion', 'reduceMotion');
    bindCheck('setting-confirm-reset', 'confirmReset');
    bindCheck('setting-show-fps', 'showFps');
  });

  paintDiff();
  return {
    show(): void {
      panel.classList.remove('hidden');
      panel.setAttribute('aria-hidden', 'false');
    },
    hide(): void {
      panel.classList.add('hidden');
      panel.setAttribute('aria-hidden', 'true');
    }
  };
}
