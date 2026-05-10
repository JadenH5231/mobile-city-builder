import { Game } from './engine/Game';
import { MAP_SIZES } from './types';
import { formatCurrency } from './ui/BudgetPanel';
import './styles.css';

const appEl = document.getElementById('app');
if (!appEl) throw new Error('Missing #app element');

const fpsEl = document.getElementById('hud-fps');
const popEl = document.getElementById('hud-pop');
const treasuryEl = document.getElementById('hud-treasury');
const rciFills: Record<'r' | 'c' | 'i', HTMLElement | null> = {
  r: document.querySelector('.rci__bar[data-zone="r"] .rci__fill'),
  c: document.querySelector('.rci__bar[data-zone="c"] .rci__fill'),
  i: document.querySelector('.rci__bar[data-zone="i"] .rci__fill')
};

const game = new Game();
await game.init(appEl, MAP_SIZES.small);

if (treasuryEl) {
  treasuryEl.addEventListener('click', () => game.toggleBudget());
}

if (popEl) {
  popEl.addEventListener('click', () => game.toggleHappiness());
}

const heatmapBtn = document.getElementById('hud-heatmap');
if (heatmapBtn) {
  heatmapBtn.addEventListener('click', () => {
    const next = !game.heatmapVisible;
    game.heatmapVisible = next;
    heatmapBtn.setAttribute('aria-pressed', String(next));
    if (!next) game.renderer.clearHeatmap();
  });
}

const undoBtn = document.getElementById('hud-undo') as HTMLButtonElement | null;
if (undoBtn) {
  undoBtn.addEventListener('click', () => {
    if (game.canUndo()) game.undo();
  });
}

// Stats panel HUD pill (Alpha 2.11) — opens the line-graph history.
import { StatsPanel } from './ui/StatsPanel';
const statsPanel = new StatsPanel(game.stats);
const statsBtn = document.getElementById('hud-stats');
if (statsBtn) {
  statsBtn.addEventListener('click', () => {
    if (statsPanel.isOpen()) statsPanel.hide();
    else statsPanel.show();
  });
}

// Sim speed cycler — 1× → 2× → 3× → ⏸ → 1×.
// Glyphs read at-a-glance even in a 12px pill: triangle for play, double
// for 2x, triple for 3x, the standard pause bars for 0.
const speedBtn = document.getElementById('hud-speed') as HTMLButtonElement | null;
if (speedBtn) {
  const SPEED_GLYPHS: Record<0 | 1 | 2 | 3, string> = {
    0: '⏸',
    1: '▶',
    2: '▶▶',
    3: '▶▶▶'
  };
  const renderSpeed = (): void => {
    speedBtn.textContent = SPEED_GLYPHS[game.simSpeed];
    speedBtn.setAttribute('aria-label',
      game.simSpeed === 0 ? 'Resume simulation' : `Sim speed ${game.simSpeed}× — tap to cycle`);
    speedBtn.classList.toggle('speed--paused', game.simSpeed === 0);
  };
  renderSpeed();
  speedBtn.addEventListener('click', () => {
    const next = game.simSpeed === 1 ? 2 : game.simSpeed === 2 ? 3 : game.simSpeed === 3 ? 0 : 1;
    game.simSpeed = next as 0 | 1 | 2 | 3;
    renderSpeed();
  });
}

// Bulldoze toast: when a stroke wipes > 5 tiles, surface a one-shot
// "Bulldozed N tiles · Undo" pill near the top of the screen for 5 sec.
// Game emits onBigBulldoze; we own the DOM bits.
const bulldozeToast = document.getElementById('bulldoze-toast');
const bulldozeText = document.getElementById('bulldoze-toast-text');
const bulldozeUndo = document.getElementById('bulldoze-toast-undo');
if (bulldozeToast && bulldozeText && bulldozeUndo) {
  let toastTimer: number | undefined;
  const hideToast = (): void => {
    bulldozeToast.classList.add('hidden');
    bulldozeToast.setAttribute('aria-hidden', 'true');
    if (toastTimer !== undefined) {
      clearTimeout(toastTimer);
      toastTimer = undefined;
    }
  };
  game.onBigBulldoze = (count) => {
    bulldozeText.textContent = `Bulldozed ${count} tiles`;
    bulldozeToast.classList.remove('hidden');
    bulldozeToast.setAttribute('aria-hidden', 'false');
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(hideToast, 5000);
  };
  bulldozeUndo.addEventListener('click', () => {
    if (game.canUndo()) game.undo();
    hideToast();
  });
}

// Status toast: short pill for "Not enough money" and similar silent-fail
// reasons. Shares .toast styling with the bulldoze toast but no Undo button.
const statusToast = document.getElementById('status-toast');
const statusText = document.getElementById('status-toast-text');
if (statusToast && statusText) {
  let statusTimer: number | undefined;
  game.onStatusMessage = (msg) => {
    statusText.textContent = msg;
    statusToast.classList.remove('hidden');
    statusToast.setAttribute('aria-hidden', 'false');
    if (statusTimer !== undefined) clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      statusToast.classList.add('hidden');
      statusToast.setAttribute('aria-hidden', 'true');
      statusTimer = undefined;
    }, 2500);
  };
}

// Random / crisis events modal (Alpha 2.9). Game queues events;
// EventModal handles display, severity styling, queue ordering, and
// calls back into Game.resolveEventChoice for choice-events.
import { EventModal } from './ui/EventModal';
const eventModal = new EventModal();
eventModal.onChoice = (e, choiceId) => game.resolveEventChoice(e, choiceId);
game.onEvent = (e) => eventModal.enqueue(e);

// Milestone celebration banner (Alpha 2.8). Game.onMilestoneEarned
// fires per milestone the city crosses; we render the gold-trim banner
// with the herald leader's name + the unlocks + the cash/PC reward.
// Auto-dismiss in 8 s, manual dismiss via the close button.
import { FACTIONS } from './simulation/Happiness';
const milestoneBanner = document.getElementById('milestone-banner');
const milestoneAvatar = document.getElementById('milestone-banner-avatar');
const milestoneTitle = document.getElementById('milestone-banner-title');
const milestoneSubtitle = document.getElementById('milestone-banner-subtitle');
const milestoneBlurb = document.getElementById('milestone-banner-blurb');
const milestoneCash = document.getElementById('milestone-banner-cash');
const milestonePC = document.getElementById('milestone-banner-pc');
const milestoneUnlocks = document.getElementById('milestone-banner-unlocks');
const milestoneClose = document.getElementById('milestone-banner-close');
if (
  milestoneBanner && milestoneAvatar && milestoneTitle && milestoneSubtitle &&
  milestoneBlurb && milestoneCash && milestonePC && milestoneUnlocks && milestoneClose
) {
  let milestoneTimer: number | undefined;
  const hide = (): void => {
    milestoneBanner.classList.add('hidden');
    milestoneBanner.setAttribute('aria-hidden', 'true');
    if (milestoneTimer !== undefined) {
      clearTimeout(milestoneTimer);
      milestoneTimer = undefined;
    }
  };
  milestoneClose.addEventListener('click', hide);
  game.onMilestoneEarned = (m) => {
    const herald = FACTIONS.find((f) => f.id === m.herald);
    const initials = herald?.leaderName
      ? herald.leaderName.split(/\s+/).map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase()
      : '★';
    milestoneAvatar.textContent = initials;
    if (herald) {
      milestoneAvatar.style.background = `#${herald.color.toString(16).padStart(6, '0')}33`;
      milestoneAvatar.style.borderColor = `#${herald.color.toString(16).padStart(6, '0')}aa`;
    }
    milestoneTitle.textContent = m.name;
    milestoneSubtitle.textContent = `${m.popThreshold.toLocaleString()} residents · ${m.subtitle}`;
    milestoneBlurb.textContent = `"${m.blurb}" — ${herald?.leaderName ?? m.herald}`;
    milestoneCash.textContent = `+$${m.rewardCash.toLocaleString()}`;
    milestonePC.textContent = `+${m.rewardPC} PC`;
    milestoneUnlocks.innerHTML = '';
    if (m.unlocks.length === 0) {
      const span = document.createElement('span');
      span.className = 'milestone-banner__unlock';
      span.textContent = 'Legacy bonus';
      milestoneUnlocks.appendChild(span);
    } else {
      for (const u of m.unlocks) {
        const span = document.createElement('span');
        span.className = 'milestone-banner__unlock';
        span.textContent = unlockLabel(u);
        milestoneUnlocks.appendChild(span);
      }
    }
    milestoneBanner.classList.remove('hidden');
    milestoneBanner.setAttribute('aria-hidden', 'false');
    if (milestoneTimer !== undefined) clearTimeout(milestoneTimer);
    milestoneTimer = window.setTimeout(hide, 8000);
  };
}

function unlockLabel(tool: string): string {
  const map: Record<string, string> = {
    road_local: 'Local road',
    road_avenue: 'Avenue',
    road_highway: 'Highway',
    place_path: 'Path',
    residential_low: 'R · Low',
    residential_medium: 'R · Med',
    residential_high: 'R · High',
    residential_luxury_low: 'R · Lux',
    commercial_low: 'C · Low',
    commercial_medium: 'C · Med',
    commercial_high: 'C · High',
    industrial_low: 'I · Low',
    industrial_medium: 'I · Med',
    industrial_high: 'I · High',
    mixed_low: 'MU · Low',
    mixed_medium: 'MU · Med',
    mixed_high: 'MU · High',
    place_power: 'Power plant',
    place_water: 'Water tower',
    place_park: 'Park',
    place_forestry: 'Forestry',
    place_farm: 'Farm',
    place_school: 'School',
    place_hospital: 'Hospital',
    place_fire_station: 'Fire station',
    place_police_station: 'Police station',
    place_bus_stop: 'Bus stop',
    place_bus_depot: 'Bus depot',
    place_stop_sign: 'Stop sign',
    place_traffic_light: 'Traffic light'
  };
  return map[tool] ?? tool;
}

// "Show tutorial again" link in the budget panel.
const showTutorialBtn = document.getElementById('budget-show-tutorial');
if (showTutorialBtn) {
  showTutorialBtn.addEventListener('click', () => {
    const f = (window as unknown as { showTutorial?: () => void }).showTutorial;
    if (f) f();
  });
}

// Tutorial — 4-step welcome shown once on first launch. Skipped or
// completed both write a localStorage flag so we never auto-show again.
// Player can re-open via the budget panel's "Show tutorial" link.
const TUTORIAL_SEEN_KEY = 'city-builder-tutorial-seen';
const tutorial = document.getElementById('tutorial');
if (tutorial) {
  const stepEls = Array.from(tutorial.querySelectorAll<HTMLElement>('.tutorial__step'));
  const prevBtn = document.getElementById('tutorial-prev') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('tutorial-next') as HTMLButtonElement | null;
  const skipBtn = document.getElementById('tutorial-skip');
  let cur = 0;
  const showStep = (i: number): void => {
    cur = Math.max(0, Math.min(stepEls.length - 1, i));
    for (let k = 0; k < stepEls.length; k++) stepEls[k]!.classList.toggle('hidden', k !== cur);
    if (prevBtn) prevBtn.disabled = cur === 0;
    if (nextBtn) nextBtn.textContent = cur === stepEls.length - 1 ? "Got it" : 'Next';
  };
  const dismiss = (): void => {
    tutorial.classList.add('hidden');
    tutorial.setAttribute('aria-hidden', 'true');
    try { localStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch { /* private mode etc. */ }
  };
  prevBtn?.addEventListener('click', () => showStep(cur - 1));
  nextBtn?.addEventListener('click', () => {
    if (cur === stepEls.length - 1) dismiss();
    else showStep(cur + 1);
  });
  skipBtn?.addEventListener('click', dismiss);
  // Show on first launch only.
  let seen = false;
  try { seen = localStorage.getItem(TUTORIAL_SEEN_KEY) === '1'; } catch { seen = false; }
  if (!seen) {
    showStep(0);
    tutorial.classList.remove('hidden');
    tutorial.setAttribute('aria-hidden', 'false');
  }
  // Expose a re-opener so the budget panel can wire a "Show tutorial" link.
  (window as unknown as { showTutorial?: () => void }).showTutorial = () => {
    showStep(0);
    tutorial.classList.remove('hidden');
    tutorial.setAttribute('aria-hidden', 'false');
  };
}

// Photo mode — hide all HUD chrome via a body-level CSS class so panels
// and the toolbar disappear together. Tap anywhere on the canvas to exit
// (the canvas listener is wired further down).
const photoBtn = document.getElementById('hud-photo') as HTMLButtonElement | null;
if (photoBtn) {
  const renderPhoto = (): void => {
    photoBtn.setAttribute('aria-pressed', String(game.photoMode));
    document.body.classList.toggle('photo-mode', game.photoMode);
  };
  renderPhoto();
  photoBtn.addEventListener('click', () => {
    game.photoMode = !game.photoMode;
    renderPhoto();
  });
}

// Reset button uses an inline two-tap confirmation rather than confirm().
// Reason: iOS Safari standalone mode (page added to home screen via the
// apple-mobile-web-app-capable meta tag) silently no-ops confirm/alert/prompt,
// so the previous flow looked broken on a phone-installed copy of the game.
const resetBtn = document.getElementById('budget-reset') as HTMLButtonElement | null;
if (resetBtn) {
  const RESET_LABEL = 'Reset city';
  const ARMED_LABEL = 'Tap again to RESET — wipes your save';
  const ARMED_CLASS = 'budget__reset--armed';
  const ARM_WINDOW_MS = 3000;
  let armed = false;
  let armTimer: number | undefined;
  const disarm = (): void => {
    armed = false;
    resetBtn.textContent = RESET_LABEL;
    resetBtn.classList.remove(ARMED_CLASS);
    if (armTimer !== undefined) {
      clearTimeout(armTimer);
      armTimer = undefined;
    }
  };
  resetBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      resetBtn.textContent = ARMED_LABEL;
      resetBtn.classList.add(ARMED_CLASS);
      armTimer = window.setTimeout(disarm, ARM_WINDOW_MS);
      return;
    }
    disarm();
    void game.resetCity();
  });
}

if (fpsEl) {
  let frames = 0;
  let last = performance.now();
  game.tickCallbacks.push(() => {
    frames++;
    const now = performance.now();
    if (now - last >= 500) {
      const fps = (frames * 1000) / (now - last);
      fpsEl.textContent = `${fps.toFixed(0)} fps`;
      frames = 0;
      last = now;
    }
  });
}

// HUD updates: throttle to 4 Hz so DOM doesn't thrash on every render frame.
let lastUiUpdate = 0;
game.tickCallbacks.push(() => {
  const now = performance.now();
  if (now - lastUiUpdate < 250) return;
  lastUiUpdate = now;

  if (popEl) {
    // totalResidents is a float (faction populations lerp through fractions).
    // Round for display — there is no such thing as 0.4 of a person.
    popEl.textContent = `Pop · ${Math.round(game.population.totalResidents).toLocaleString()}`;
  }

  if (treasuryEl) {
    treasuryEl.textContent = formatCurrency(game.economy.treasury);
    treasuryEl.classList.toggle('treasury--negative', game.economy.treasury < 0);
  }

  // Keep the budget / happiness panel numbers fresh while either is open.
  if (game.budgetPanel.isOpen()) game.budgetPanel.refresh();
  if (game.happinessPanel.isOpen()) game.happinessPanel.refresh();

  if (undoBtn) {
    const enabled = game.canUndo();
    if (undoBtn.disabled === enabled) undoBtn.disabled = !enabled;
  }

  setBar(rciFills.r, game.population.demandR);
  setBar(rciFills.c, game.population.demandC);
  setBar(rciFills.i, game.population.demandI);
});

/**
 * Position an RCI fill div around the centre baseline. Demand in [-1, 1];
 * positive fills upward from the midpoint, negative fills downward.
 */
function setBar(el: HTMLElement | null, demand: number): void {
  if (!el) return;
  const mag = Math.min(1, Math.abs(demand)) * 50; // % of the bar's height
  if (demand >= 0) {
    el.style.top = `${50 - mag}%`;
    el.style.bottom = '50%';
  } else {
    el.style.top = '50%';
    el.style.bottom = `${50 - mag}%`;
  }
}

// Expose for ad-hoc debugging from the device's remote inspector.
// Justified `any`: this is a deliberate global escape hatch only used in dev.
(window as unknown as { game: Game }).game = game;
