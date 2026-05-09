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
