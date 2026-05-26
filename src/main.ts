/// <reference types="vite/client" />
import { Game } from './engine/Game';
import { Settings, bindSettingsPanel, DIFFICULTY_EFFECTS } from './ui/SettingsPanel';
import { FactionDetailPanel } from './ui/FactionDetailPanel';
import { MAP_SIZES } from './types';
import { formatCurrency } from './ui/BudgetPanel';
import { initAuth, onAuthChange } from './auth/AuthState';
import { isCloudEnabled, getSupabase } from './auth/SupabaseClient';
import { AuthModal } from './ui/AuthModal';
import { initThemes } from './themes/registry';
import { bindThemePicker } from './ui/ThemePicker';
import './styles.css';

// Theme pack init (Beta 1.2). Restores the player's active theme from
// localStorage BEFORE Game.init so the very first renderer pass uses
// the correct palette. No-op when no theme is saved (stays on Stock).
initThemes();

// Auth init (Alpha 4.25). Restores any persisted session BEFORE Game.init
// so the first saveGame.load() inside Game.init can pull from the cloud
// when a user is already signed in. No-op when Supabase isn't configured
// (the auth pill stays hidden, save flow falls back to IndexedDB only).
await initAuth();

const appEl = document.getElementById('app');
if (!appEl) throw new Error('Missing #app element');

const fpsEl = document.getElementById('hud-fps');
const popEl = document.getElementById('hud-pop');
const popLabelEl = document.getElementById('hud-pop-label');
const popTrendEl = document.getElementById('hud-pop-trend');
const treasuryEl = document.getElementById('hud-treasury');
const treasuryLabelEl = document.getElementById('hud-treasury-label');
const treasuryTrendEl = document.getElementById('hud-treasury-trend');
const timeEl = document.getElementById('hud-time');
const rciFills: Record<'r' | 'c' | 'i', HTMLElement | null> = {
  r: document.querySelector('.rci__bar[data-zone="r"] .rci__fill'),
  c: document.querySelector('.rci__bar[data-zone="c"] .rci__fill'),
  i: document.querySelector('.rci__bar[data-zone="i"] .rci__fill')
};

// Active save slot (Alpha 2.20). Persists across reloads in localStorage;
// defaults to the legacy 'main' slot so a single-slot save from before
// 2.20 keeps loading on the same slot it was always on.
const ACTIVE_SLOT_KEY = 'city-builder-active-slot';
const activeSlot = (() => {
  try { return localStorage.getItem(ACTIVE_SLOT_KEY) || 'main'; } catch { return 'main'; }
})();

// Settings (Alpha 4.8) — load BEFORE game init so the CSS side effects
// (UI scale, palette) apply during render, and so the default sim
// speed is known. Difficulty applies on city reset / fresh slot.
const settings = new Settings();
settings.load();

const game = new Game();
await game.init(appEl, MAP_SIZES.small, activeSlot);

// If the just-loaded slot was empty (treasury still at the default
// pre-load Economy seed of $15K) and a non-Normal difficulty was
// picked in settings, seed the treasury to the difficulty's starting
// value. Skips when an existing save was restored (the restore wrote
// the saved treasury and that's what we want to preserve).
if (game.economy.monthsElapsed === 0 && settings.data.difficulty !== 'normal') {
  game.economy.treasury = DIFFICULTY_EFFECTS[settings.data.difficulty].startingTreasury;
}

// Apply default sim speed preference (only if not paused before — we
// don't override the player's explicit pause state from a restore).
if (game.simSpeed === 1 && settings.data.defaultSimSpeed !== 1) {
  game.simSpeed = settings.data.defaultSimSpeed;
}
// Reduce motion (Alpha 4.8) — slows the day/night sun arc.
game.reduceMotion = settings.data.reduceMotion;
// Beta 1.3.5 (Phase 3) — sync parking-management strictness from
// Settings to Game on boot, and again whenever the player changes the
// Settings panel select. The change handler is attached via a small
// DOM listener since SettingsPanel.ts doesn't expose a callback API.
// Read from `select.value` directly (NOT settings.data) because
// listener registration order means my handler can fire before
// SettingsPanel's bindSelect has called settings.set().
game.parkingStrictness = settings.data.parkingStrictness;
const parkingStrictnessSelect = document.getElementById('setting-parking-strictness') as HTMLSelectElement | null;
parkingStrictnessSelect?.addEventListener('change', () => {
  game.parkingStrictness = parkingStrictnessSelect.value as typeof game.parkingStrictness;
});

// Active-tool cost preview pill (Alpha 4.5). Game updates it via
// refreshToolCostPill whenever the active tool, the treasury, or
// the council's cost multipliers change.
game.toolCostPillEl = document.getElementById('hud-tool-cost');
game.refreshToolCostPill();

// City-name input on the budget panel (Alpha 2.20). Live binding into
// game.cityName so the next autosave persists it.
const cityNameInput = document.getElementById('budget-city-name') as HTMLInputElement | null;
if (cityNameInput) {
  cityNameInput.value = game.cityName;
  cityNameInput.addEventListener('input', () => {
    game.cityName = cityNameInput.value;
  });
}

// Playtest cheats (Alpha 3.2.4; moved to Settings in Alpha 4.10.1).
// When either cheat is enabled, Achievements stops awarding new unlocks
// for the rest of the session. Existing unlocks are kept.
const cheatMoneyEl = document.getElementById('setting-cheat-unlimited-money') as HTMLInputElement | null;
const cheatDemandEl = document.getElementById('setting-cheat-unlimited-demand') as HTMLInputElement | null;
const cheatsActiveEl = document.getElementById('setting-cheats-active');
const refreshCheatsActiveLabel = (): void => {
  const active = game.cheatUnlimitedMoney || game.cheatUnlimitedDemand;
  game.achievements.cheatsActive = active;
  if (cheatsActiveEl) cheatsActiveEl.classList.toggle('hidden', !active);
};
if (cheatMoneyEl) {
  cheatMoneyEl.checked = game.cheatUnlimitedMoney;
  cheatMoneyEl.addEventListener('change', () => {
    game.cheatUnlimitedMoney = cheatMoneyEl.checked;
    refreshCheatsActiveLabel();
  });
}
if (cheatDemandEl) {
  cheatDemandEl.checked = game.cheatUnlimitedDemand;
  cheatDemandEl.addEventListener('change', () => {
    game.cheatUnlimitedDemand = cheatDemandEl.checked;
    refreshCheatsActiveLabel();
  });
}
refreshCheatsActiveLabel();

// Backup & Sync — portable city codes (Alpha 4.11). Lets the player move
// a city between devices via copy-paste of a base64-gzipped snapshot.
// Always overwrites the active slot on import — there's no merge.
import { exportSaveCode, importSaveCode } from './persistence/PortableSave';
import { serialize as serializeSave } from './persistence/SaveGame';

const exportBtn = document.getElementById('setting-export-city');
const importBtn = document.getElementById('setting-import-city');
const exportDrawer = document.getElementById('setting-export-drawer');
const importDrawer = document.getElementById('setting-import-drawer');
const exportCodeEl = document.getElementById('setting-export-code') as HTMLTextAreaElement | null;
const exportSizeEl = document.getElementById('setting-export-size');
const exportCopyBtn = document.getElementById('setting-export-copy');
const exportCloseBtn = document.getElementById('setting-export-close');
const importCodeEl = document.getElementById('setting-import-code') as HTMLTextAreaElement | null;
const importApplyBtn = document.getElementById('setting-import-apply');
const importCloseBtn = document.getElementById('setting-import-close');
const syncStatusEl = document.getElementById('setting-sync-status');

const setSyncStatus = (msg: string, kind: 'ok' | 'err' | 'info'): void => {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = msg;
  syncStatusEl.classList.remove('hidden', 'settings__sync-status--ok', 'settings__sync-status--err');
  if (kind === 'ok') syncStatusEl.classList.add('settings__sync-status--ok');
  else if (kind === 'err') syncStatusEl.classList.add('settings__sync-status--err');
};
const clearSyncStatus = (): void => syncStatusEl?.classList.add('hidden');

// Track armed state on the danger button so the click confirms before
// actually overwriting (matches the inline two-tap arm pattern used by
// the Reset City button).
let importArmed = false;
let importDisarmTimer: number | undefined;
const disarmImport = (): void => {
  importArmed = false;
  if (importApplyBtn) importApplyBtn.textContent = 'Overwrite active slot';
  if (importDisarmTimer !== undefined) {
    clearTimeout(importDisarmTimer);
    importDisarmTimer = undefined;
  }
};

exportBtn?.addEventListener('click', () => {
  // Build a SaveData straight from live state — same shape that gets
  // written to IDB on the autosave tick. We piggy-back on the existing
  // serialize() so any future field additions flow through automatically.
  const data = serializeSave(
    game.grid, game.economy, game.council, game.milestones, game.events,
    game.stats, game.achievements, game.bonds, game.districts
  );
  if (game.cityName) data.cityName = game.cityName;
  data.cheatUnlimitedMoney = game.cheatUnlimitedMoney;
  data.cheatUnlimitedDemand = game.cheatUnlimitedDemand;
  exportSaveCode(data).then((code) => {
    if (exportCodeEl) exportCodeEl.value = code;
    if (exportSizeEl) exportSizeEl.textContent = `${(code.length / 1024).toFixed(1)} KB · ${code.length.toLocaleString()} chars`;
    exportDrawer?.classList.remove('hidden');
    importDrawer?.classList.add('hidden');
    disarmImport();
    clearSyncStatus();
    // Auto-select the textarea so a single Cmd/Ctrl+C grabs it.
    exportCodeEl?.focus();
    exportCodeEl?.select();
  }).catch((err: Error) => setSyncStatus(`Export failed: ${err.message}`, 'err'));
});

exportCopyBtn?.addEventListener('click', () => {
  if (!exportCodeEl) return;
  const code = exportCodeEl.value;
  // navigator.clipboard is the modern path; fall back to execCommand for
  // older browsers / non-secure contexts.
  const fallback = (): void => {
    exportCodeEl.focus();
    exportCodeEl.select();
    try { document.execCommand('copy'); setSyncStatus('Copied to clipboard.', 'ok'); }
    catch { setSyncStatus('Could not copy — select and copy manually.', 'err'); }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(code)
      .then(() => setSyncStatus('Copied to clipboard.', 'ok'))
      .catch(fallback);
  } else fallback();
});

exportCloseBtn?.addEventListener('click', () => {
  exportDrawer?.classList.add('hidden');
  clearSyncStatus();
});

importBtn?.addEventListener('click', () => {
  importDrawer?.classList.remove('hidden');
  exportDrawer?.classList.add('hidden');
  disarmImport();
  clearSyncStatus();
  importCodeEl?.focus();
});

importCloseBtn?.addEventListener('click', () => {
  importDrawer?.classList.add('hidden');
  disarmImport();
  clearSyncStatus();
});

importCodeEl?.addEventListener('input', () => {
  // Disarm if the player edits the code mid-confirmation — they may
  // have been about to commit and then changed their mind.
  if (importArmed) disarmImport();
});

importApplyBtn?.addEventListener('click', () => {
  const raw = importCodeEl?.value ?? '';
  if (!raw.trim()) {
    setSyncStatus('Paste a city code first.', 'err');
    return;
  }
  if (!importArmed) {
    // First tap arms; second tap (within 5s) commits. Mirrors the
    // Reset City "tap to confirm" flow.
    importArmed = true;
    if (importApplyBtn) importApplyBtn.textContent = 'Tap again to overwrite';
    setSyncStatus('This will replace the active slot. Tap again within 5 seconds to confirm.', 'info');
    importDisarmTimer = window.setTimeout(disarmImport, 5000);
    return;
  }
  // Armed → decode + write + reload.
  importSaveCode(raw)
    .then(async (data) => {
      // Bug fix (Alpha 4.14.1): suspend autosaves BEFORE writing so a
      // 30-second-pending autosave can't fire mid-await and overwrite
      // our freshly-imported slot with the stale in-memory OLD city.
      // Without this gate the import appears to succeed but the next
      // reload reads the auto-saved-old data instead of the import,
      // and the player loses both their changes AND the import.
      game.suspendAutosavesForReload();
      await game.saveGame.writeRaw(data);
      setSyncStatus('Imported. Reloading…', 'ok');
      // Tiny delay so the player sees the success line before the page
      // tears down.
      window.setTimeout(() => location.reload(), 350);
    })
    .catch((err: Error) => {
      setSyncStatus(err.message, 'err');
      disarmImport();
    });
});

// Slot picker — accessible via the 🏙 HUD pill. Picking a different slot
// writes to localStorage and reloads so the chosen slot's save is the
// only one in memory.
import { SlotPicker } from './ui/SlotPicker';
const slotPicker = new SlotPicker(game.saveGame);
slotPicker.onPick = (slotKey) => {
  if (slotKey === game.saveGame.currentSlot()) {
    slotPicker.hide();
    return;
  }
  try { localStorage.setItem(ACTIVE_SLOT_KEY, slotKey); } catch { /* private mode */ }
  // Force a reload — keeps the swap surgical: brand-new init with the
  // freshly-selected slot. No need to teardown half the game state.
  location.reload();
};
const citiesBtn = document.getElementById('hud-cities');
if (citiesBtn) {
  citiesBtn.addEventListener('click', () => {
    if (slotPicker.isOpen()) slotPicker.hide();
    else void slotPicker.show();
  });
}

if (treasuryEl) {
  treasuryEl.addEventListener('click', () => game.toggleBudget());
}

if (popEl) {
  popEl.addEventListener('click', () => game.toggleHappiness());
}

// HUD "More" popover (Alpha 3.1.1). Click the trigger to toggle; click
// outside (or any item inside) auto-closes. Items live in the popover
// so their own click handlers can still fire.
const moreBtn = document.getElementById('hud-more');
const morePopover = document.getElementById('hud-more-popover');
if (moreBtn && morePopover) {
  const setOpen = (open: boolean): void => {
    morePopover.classList.toggle('hidden', !open);
    morePopover.setAttribute('aria-hidden', String(!open));
    moreBtn.setAttribute('aria-expanded', String(open));
  };
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(morePopover.classList.contains('hidden'));
  });
  // Tapping any item inside the popover dismisses it after the action
  // fires (the action's own listener still runs first).
  morePopover.addEventListener('click', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.closest('.pill')) setOpen(false);
  });
  // Outside-tap closes.
  document.addEventListener('pointerdown', (e) => {
    if (morePopover.classList.contains('hidden')) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('#hud-more-popover') || t === moreBtn)) return;
    setOpen(false);
  });
}

const heatmapBtn = document.getElementById('hud-heatmap');
const crimeBtn = document.getElementById('hud-crime');
const setHeatmapMode = (mode: 'none' | 'traffic' | 'crime'): void => {
  game.heatmapVisible = mode === 'traffic';
  game.crimeHeatmapVisible = mode === 'crime';
  heatmapBtn?.setAttribute('aria-pressed', String(mode === 'traffic'));
  crimeBtn?.setAttribute('aria-pressed', String(mode === 'crime'));
  if (mode === 'none') game.renderer.clearHeatmap();
};
if (heatmapBtn) {
  heatmapBtn.addEventListener('click', () => {
    setHeatmapMode(game.heatmapVisible ? 'none' : 'traffic');
  });
}
if (crimeBtn) {
  crimeBtn.addEventListener('click', () => {
    setHeatmapMode(game.crimeHeatmapVisible ? 'none' : 'crime');
  });
}

// Bridge Mode (Beta 1.6.23, re-homed from Alpha 2.12). Pre-1.6.23 the
// Bridge pill lived in the More-popover Layers group, where it looked
// like a heatmap toggle and players couldn't find it. Now it's a
// contextual floating pill that only appears while a road tool is
// armed — same affordance pattern as the Rotate-monument button.
// Selecting a non-road tool auto-drops bridge mode (Game.setTool
// handles this) so the next paint stroke doesn't accidentally land
// on the upper layer.
const bridgeBtn = document.getElementById('bridge-toggle-btn');
if (bridgeBtn) {
  bridgeBtn.addEventListener('click', () => {
    const next = !game.bridgeMode;
    game.bridgeMode = next;
    bridgeBtn.setAttribute('aria-pressed', String(next));
  });
}
const refreshBridgePill = (tool: import('./types').Tool): void => {
  if (!bridgeBtn) return;
  const visible = game.isRoadTool(tool);
  bridgeBtn.classList.toggle('hidden', !visible);
  bridgeBtn.setAttribute('aria-pressed', String(game.bridgeMode));
};
game.onToolChange = (tool) => refreshBridgePill(tool);
// Set initial visibility based on current tool (defaults to 'pan').
refreshBridgePill(game.tool);

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

// Achievements panel + corner toast (Alpha 2.15).
import { AchievementsPanel } from './ui/AchievementsPanel';
const achievementsPanel = new AchievementsPanel(game.achievements);
const achievementsBtn = document.getElementById('hud-achievements');
if (achievementsBtn) {
  achievementsBtn.addEventListener('click', () => {
    if (achievementsPanel.isOpen()) achievementsPanel.hide();
    else achievementsPanel.show();
  });
}
const achToast = document.getElementById('achievement-toast');
const achToastIcon = document.getElementById('achievement-toast-icon');
const achToastName = document.getElementById('achievement-toast-name');
const achToastDesc = document.getElementById('achievement-toast-desc');
if (achToast && achToastIcon && achToastName && achToastDesc) {
  // Coalesce multiple unlocks into a queue so they appear sequentially
  // rather than overlapping. Each toast displays for 4.5s.
  const queue: Array<{ icon: string; name: string; desc: string }> = [];
  let active = false;
  let timer: number | undefined;
  const showNext = (): void => {
    const next = queue.shift();
    if (!next) {
      active = false;
      achToast.classList.add('hidden');
      achToast.setAttribute('aria-hidden', 'true');
      return;
    }
    active = true;
    achToastIcon.textContent = next.icon;
    achToastName.textContent = next.name;
    achToastDesc.textContent = next.desc;
    achToast.classList.remove('hidden');
    achToast.setAttribute('aria-hidden', 'false');
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      showNext();
    }, 4500);
  };
  game.onAchievementUnlocked = (a) => {
    queue.push({ icon: a.icon, name: a.name, desc: a.description });
    if (!active) showNext();
  };
}

// Leader bio modal — first time each council leader appears.
import { LeaderBioModal } from './ui/LeaderBioModal';
const leaderBio = new LeaderBioModal();
game.onNewLeader = (id) => leaderBio.enqueue(id);

// Districts panel (Alpha 2.22).
import { DistrictsPanel } from './ui/DistrictsPanel';
const districtsPanel = new DistrictsPanel(game.districts);
districtsPanel.onSetActive = (id) => { game.activeDistrictId = id; };
districtsPanel.onNewDistrict = () => { game.activeDistrictId = 0; };
districtsPanel.onChange = () => { game.renderer.drawDistricts(game.grid, game.districts); };
const districtsBtn = document.getElementById('hud-districts');
if (districtsBtn) {
  districtsBtn.addEventListener('click', () => {
    if (districtsPanel.isOpen()) districtsPanel.hide();
    else districtsPanel.show(game.activeDistrictId);
  });
}

// Sim speed cycler — 1× → 2× → 3× → ⏸ → 1×.
// Glyphs read at-a-glance even in a 12px pill: triangle for play, double
// for 2x, triple for 3x, the standard pause bars for 0.
const speedBtn = document.getElementById('hud-speed') as HTMLButtonElement | null;
// Hoisted to module scope (Beta 1.6.9) so keyboard shortcuts that mutate
// game.simSpeed (Space / 0 / 1 / 2 / 3) can refresh the HUD pill glyph
// in lock-step. The local `renderSpeed` closure used to live inside the
// `if (speedBtn)` block; pulling it out costs nothing and avoids three
// duplicated SPEED_GLYPHS tables across handlers.
const SPEED_GLYPHS: Record<0 | 1 | 2 | 3, string> = {
  0: '⏸',
  1: '▶',
  2: '▶▶',
  3: '▶▶▶'
};
const renderSpeedHud = (): void => {
  if (!speedBtn) return;
  speedBtn.textContent = SPEED_GLYPHS[game.simSpeed];
  speedBtn.setAttribute('aria-label',
    game.simSpeed === 0 ? 'Resume simulation' : `Sim speed ${game.simSpeed}× — tap to cycle`);
  speedBtn.classList.toggle('speed--paused', game.simSpeed === 0);
};
if (speedBtn) {
  renderSpeedHud();
  speedBtn.addEventListener('click', () => {
    const next = game.simSpeed === 1 ? 2 : game.simSpeed === 2 ? 3 : game.simSpeed === 3 ? 0 : 1;
    game.simSpeed = next as 0 | 1 | 2 | 3;
    renderSpeedHud();
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

// Floating Rotate button (Alpha 4.21). Visible only while a big civic
// build is armed (preview ghost is showing). Tap → cycle the footprint
// rotation 0 → 1 → 2 → 3 → 0 and re-render the preview. R key works on
// desktop. The Game fires onPendingMonumentChange whenever the armed
// state changes — we show/hide the button accordingly.
const rotateMonumentBtn = document.getElementById('rotate-monument-btn');
if (rotateMonumentBtn) {
  rotateMonumentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    game.cyclePendingRotation();
  });
}
game.onPendingMonumentChange = (state) => {
  if (!rotateMonumentBtn) return;
  if (state) rotateMonumentBtn.classList.remove('hidden');
  else rotateMonumentBtn.classList.add('hidden');
};
// Beta 1.6.9 — desktop keyboard shortcuts.
//
// Pan with WASD / Arrows, zoom with Q / E (continuous while held).
// One-shot shortcuts:
//   Space — pause / resume
//   1 / 2 / 3 — set sim speed (1× / 2× / 3×); 0 — pause
//   Z — undo (also accepts Ctrl+Z / Cmd+Z)
//   R — rotate armed monument (Alpha 4.21 — preserved)
//   Esc — exit paint tool (back to Pan)
//
// We don't gate on sim speed — pan and zoom work even when paused, so
// the player can compose photo-mode shots without resuming sim.
// All shortcuts are skipped when an input/textarea/contenteditable is
// focused so typing into the city-name field or import-code textarea
// isn't hijacked.

const pressedNavKeys = new Set<string>();
const isTypingInInput = (): boolean => {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return false;
  if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') return true;
  if (a.isContentEditable) return true;
  return false;
};
const NAV_KEYS = new Set([
  'w', 'a', 's', 'd', 'q', 'e',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright'
]);

window.addEventListener('keydown', (e) => {
  if (isTypingInInput()) return;
  const k = e.key.toLowerCase();
  // Continuous-movement keys — record and let the rAF loop drive motion.
  // We add to the set on every event (even auto-repeat) so a stuck-down
  // state stays stuck even if browser key-repeat fires extra keydowns.
  if (NAV_KEYS.has(k)) {
    pressedNavKeys.add(k);
    e.preventDefault();
    return;
  }
  // Below: one-shot keys. Ignore auto-repeat so holding Space doesn't
  // toggle pause every frame.
  if (e.repeat) return;
  // Pause / resume (Space). Toggles sim speed between 0 and the last
  // non-zero value the player had. We don't try to remember "what was
  // the speed before pause" — most players want plain 1× after resume.
  if (k === ' ' || k === 'spacebar') {
    e.preventDefault();
    game.simSpeed = game.simSpeed === 0 ? 1 : 0;
    renderSpeedHud();
    return;
  }
  // Direct sim speed select: 0 pause, 1 / 2 / 3 = speed multiplier.
  if (k === '0') { e.preventDefault(); game.simSpeed = 0; renderSpeedHud(); return; }
  if (k === '1') { e.preventDefault(); game.simSpeed = 1; renderSpeedHud(); return; }
  if (k === '2') { e.preventDefault(); game.simSpeed = 2; renderSpeedHud(); return; }
  if (k === '3') { e.preventDefault(); game.simSpeed = 3; renderSpeedHud(); return; }
  // Undo. Plain Z or Cmd/Ctrl+Z; Shift+Z reserved for future redo.
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (game.canUndo()) game.undo();
    return;
  }
  // Escape — drop back to Pan tool so the player can navigate without
  // a paint stroke triggering. (Panels handle their own close affordances.)
  if (k === 'escape') {
    e.preventDefault();
    game.setTool('pan');
    return;
  }
  // R — rotate the armed monument (Alpha 4.21).
  if (k === 'r') {
    e.preventDefault();
    game.cyclePendingRotation();
    return;
  }
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (NAV_KEYS.has(k)) {
    pressedNavKeys.delete(k);
  }
});

// Window-blur / page-hidden — clear all held keys so the camera doesn't
// keep drifting if the user Cmd-Tabs away mid-pan and never sends the
// keyup that would otherwise stop it.
// Beta 1.6.22 — also flush an immediate save when the page is hidden
// or backgrounded. Pre-1.6.22 the only save trigger was the 30s
// autosave timer, so a player who paused at midnight and refreshed
// within 30s lost their time-of-day position (which is the user-
// reported "pause doesn't persist" bug from the same release).
window.addEventListener('blur', () => pressedNavKeys.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pressedNavKeys.clear();
    game.flushSave();
  }
});
window.addEventListener('pagehide', () => game.flushSave());

// Continuous-motion rAF loop. Polls pressedNavKeys each frame and
// applies camera deltas. dt clamped to 50ms so a stutter doesn't
// produce a giant pan jump on the next frame.
const PAN_PIXELS_PER_SEC = 700;
const ZOOM_FACTOR_PER_SEC = 1.8; // continuous zoom (Q out / E in)
let lastKeyboardCameraT = performance.now();
function keyboardCameraLoop(): void {
  const now = performance.now();
  const dt = Math.min(50, now - lastKeyboardCameraT) / 1000;
  lastKeyboardCameraT = now;
  // Translation. Diagonal motion intentionally not normalised — the
  // small speed-up on WD/SD diagonals feels right because the camera
  // is isometric (diagonals trace shorter map distance per pixel).
  //
  // Beta 1.6.11 — sign convention is "press direction → camera moves
  // that direction" (genre-standard for desktop builders: Cities:
  // Skylines, SimCity, Civilization). The underlying `panBy(dx, dy)`
  // method models a finger-drag — passing positive dx moves the
  // camera target LEFT (because dragging finger right slides the
  // world right, which is the camera looking further left).
  //
  // So for the keyboard's movement model we pass the NEGATIVE of the
  // intuitive pixel delta: D / Right means "camera goes right", so
  // we pass dx < 0 to panBy. Same logic for the vertical axis.
  // Mouse-drag panning is unchanged — it still uses the natural
  // drag direction via Input.ts.
  let dx = 0;
  let dy = 0;
  if (pressedNavKeys.has('a') || pressedNavKeys.has('arrowleft')) dx += PAN_PIXELS_PER_SEC * dt;
  if (pressedNavKeys.has('d') || pressedNavKeys.has('arrowright')) dx -= PAN_PIXELS_PER_SEC * dt;
  if (pressedNavKeys.has('w') || pressedNavKeys.has('arrowup')) dy += PAN_PIXELS_PER_SEC * dt;
  if (pressedNavKeys.has('s') || pressedNavKeys.has('arrowdown')) dy -= PAN_PIXELS_PER_SEC * dt;
  if (dx !== 0 || dy !== 0) {
    game.camera.panBy(dx, dy);
  }
  // Zoom — anchored on the viewport centre (we don't have a cursor
  // position for keyboard zoom). Q zooms out, E zooms in — matches
  // the "Q is back / E is forward" convention from many isometric
  // builders. Wheel-zoom keeps its cursor-anchored behaviour.
  if (pressedNavKeys.has('q') || pressedNavKeys.has('e')) {
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;
    if (pressedNavKeys.has('q')) {
      game.camera.zoomAt(Math.pow(1 / ZOOM_FACTOR_PER_SEC, dt), halfW, halfH);
    }
    if (pressedNavKeys.has('e')) {
      game.camera.zoomAt(Math.pow(ZOOM_FACTOR_PER_SEC, dt), halfW, halfH);
    }
  }
  requestAnimationFrame(keyboardCameraLoop);
}
requestAnimationFrame(keyboardCameraLoop);

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
    place_big_box: 'Big Box',
    place_parking_lot: 'Parking Lot',
    place_school: 'School',
    place_hospital: 'Hospital',
    place_fire_station: 'Fire station',
    place_police_station: 'Police station',
    place_bus_stop: 'Bus stop',
    place_bus_depot: 'Bus depot',
    place_stop_sign: 'Stop sign',
    place_traffic_light: 'Traffic light',
    place_museum: 'Museum',
    place_stadium: 'Stadium',
    place_observatory: 'Observatory',
    place_ferry_dock: 'Ferry dock',
    place_subway_entrance: 'Subway entrance',
    paint_district: 'Paint district',
    erase_district: 'Erase district',
    residential_skyscraper: 'R · Skyscraper',
    commercial_skyscraper: 'C · Skyscraper',
    mixed_skyscraper: 'MU · Skyscraper',
    buy_land: 'Land'
  };
  return map[tool] ?? tool;
}

// Tutorial — play-as-you-learn guided onboarding (Alpha 4.10). Replaces
// the old 4-step reading-cards modal. The player sees a one-time
// "Welcome — try the tutorial?" prompt on first launch; accepting
// activates a top-center banner that updates as they progress. Each
// step's completion predicate runs every tick.
import { Tutorial } from './engine/Tutorial';
const tutorial = new Tutorial();
tutorial.load();

const tutorialPrompt = document.getElementById('tutorial-prompt');
const tutorialPromptStart = document.getElementById('tutorial-prompt-start');
const tutorialPromptSkip = document.getElementById('tutorial-prompt-skip');
const tutorialBanner = document.getElementById('tutorial-banner');
const tutorialBannerStep = document.getElementById('tutorial-banner-step');
const tutorialBannerTitle = document.getElementById('tutorial-banner-title');
const tutorialBannerHint = document.getElementById('tutorial-banner-hint');
const tutorialBannerSkip = document.getElementById('tutorial-banner-skip');
const tutorialBannerAdvance = document.getElementById('tutorial-banner-advance');
const tutorialBannerDone = document.getElementById('tutorial-banner-done');

const showPrompt = (visible: boolean): void => {
  if (!tutorialPrompt) return;
  tutorialPrompt.classList.toggle('hidden', !visible);
  tutorialPrompt.setAttribute('aria-hidden', String(!visible));
};

const renderBanner = (): void => {
  if (!tutorialBanner) return;
  const visible = tutorial.phase === 'active';
  tutorialBanner.classList.toggle('hidden', !visible);
  tutorialBanner.setAttribute('aria-hidden', String(!visible));
  if (!visible) return;
  const step = tutorial.currentStep;
  const isFinal = tutorial.stepIndex >= tutorial.totalSteps - 1;
  if (tutorialBannerStep) {
    tutorialBannerStep.textContent = `Step ${tutorial.stepIndex + 1} of ${tutorial.totalSteps}`;
  }
  if (tutorialBannerTitle) tutorialBannerTitle.textContent = step?.title ?? '';
  if (tutorialBannerHint) tutorialBannerHint.textContent = step?.hint ?? '';
  // Final step swaps the "Already did this" Advance button for the
  // terminal "Got it" button so the player has a clean way to dismiss.
  if (tutorialBannerAdvance) tutorialBannerAdvance.classList.toggle('hidden', isFinal);
  if (tutorialBannerDone) tutorialBannerDone.classList.toggle('hidden', !isFinal);
};
tutorial.onChange(renderBanner);
renderBanner();

// First-launch prompt — only when the player has never made a choice.
if (tutorial.phase === 'prompt') {
  showPrompt(true);
}

tutorialPromptStart?.addEventListener('click', () => {
  showPrompt(false);
  tutorial.start();
});
tutorialPromptSkip?.addEventListener('click', () => {
  showPrompt(false);
  tutorial.skip();
});
tutorialBannerSkip?.addEventListener('click', () => tutorial.skip());
tutorialBannerAdvance?.addEventListener('click', () => tutorial.advance());
tutorialBannerDone?.addEventListener('click', () => tutorial.finish());

// Run the per-step predicate every render frame. Cheap — each predicate
// is O(grid) at worst and only runs while phase === 'active'.
game.tickCallbacks.push(() => tutorial.tick(game));

// Settings + budget-panel "Show tutorial again" entry points.
const showTutorialBtn = document.getElementById('budget-show-tutorial');
showTutorialBtn?.addEventListener('click', () => tutorial.restart());
// (Settings panel binds its show-tutorial via the hooks param below.)

// Photo mode — hide all HUD chrome via a body-level CSS class so panels
// and the toolbar disappear together. The dedicated #photo-exit floating
// button (Beta 1.2.2) is the visible exit affordance — it's the only
// way out of photo mode now that the More popover is hidden too.
const photoBtn = document.getElementById('hud-photo') as HTMLButtonElement | null;
const photoExitBtn = document.getElementById('photo-exit') as HTMLButtonElement | null;
const setPhotoMode = (on: boolean): void => {
  game.photoMode = on;
  document.body.classList.toggle('photo-mode', on);
  if (photoBtn) photoBtn.setAttribute('aria-pressed', String(on));
};
if (photoBtn) {
  // Sync initial state in case photoMode was restored from a save.
  setPhotoMode(game.photoMode);
  photoBtn.addEventListener('click', () => setPhotoMode(!game.photoMode));
}
if (photoExitBtn) {
  // Dedicated exit chip — fires immediately, no toggle ambiguity.
  photoExitBtn.addEventListener('click', () => setPhotoMode(false));
}

// Faction Detail panel (Alpha 4.9 — B3 from production audit).
// Opens when the player taps a leader row in the Community Sentiment
// panel. Shows the leader's bio + what their faction supports /
// opposes most strongly + current mood + population share.
const factionDetailPanel = new FactionDetailPanel({
  happiness: game.happiness,
  council: game.council,
  population: game.population
});
game.happinessPanel.onLeaderTap = (factionId) => {
  // Hide the Community Sentiment panel while the drill-in is open so
  // the player isn't looking at two overlapping modals. Re-show on
  // close. Wire that hide-on-close via the existing happinessPanel
  // toggle so it re-binds clean.
  game.happinessPanel.hide();
  factionDetailPanel.show(factionId);
};
// When the FactionDetail close button fires, re-open Community Sentiment
// so the player doesn't get dumped back to the map.
const fdCloseBtn = document.getElementById('faction-detail-close');
if (fdCloseBtn) {
  fdCloseBtn.addEventListener('click', () => {
    // Defer so FactionDetailPanel's own close handler runs first.
    setTimeout(() => game.happinessPanel.show(), 0);
  });
}

// Settings panel entry (Alpha 4.8). Opens the modal in `index.html`
// with difficulty, audio, display, simulation tabs.
const settingsPanel = bindSettingsPanel(settings, {
  onShowTutorial: () => {
    // Re-launches the live, play-as-you-learn tutorial (Alpha 4.10).
    // The banner re-appears at step 1 and tracks the player from there.
    tutorial.restart();
  },
  onResetAll: () => {
    // After resetting settings to defaults, the CSS side effects have
    // already been applied by Settings.applyCssSideEffects. We don't
    // touch the game's sim state — defaults only affects future cities.
  },
  onClearGhosts: () => {
    // Beta 1.6.1 — Diagnostics "Clear visual ghosts" button. Triggers
    // the same full renderer-mesh rebuild path the theme picker uses:
    // drops every cached world mesh (terrain, zones, paths, roads
    // INCLUDING bridges, ornaments, buildings, services,
    // beautification) and re-derives them from the current grid
    // state. Cures the "bridge bulldozed but visual sticks around"
    // class of bug + similar orphan-mesh artifacts.
    game.renderer.refreshTheme(
      game.grid,
      game.cityMood(),
      game.economy.monthsElapsed,
      game.forestryHealth(),
      game.farmHealth()
    );
    game.onStatusMessage?.('Visual artifacts cleared');
  },
  onRestockSupplies: () => {
    // Beta 1.6.22 — debug button to refill every commercial / mixed /
    // big_box / warehouse tile to 100% supplies. Lets the player reset
    // the supply chain and observe where genuine backlogs reappear,
    // rather than living with a chronic 0% that may have been caused
    // by an earlier truck shortage that has since been fixed.
    let n = 0;
    for (const t of game.grid.iter()) {
      if (game.supplyChain.isCommercialConsumer(t) || t.building === 'warehouse') {
        t.supplies = 1;
        t.importSource = false;
        n++;
      }
    }
    game.onStatusMessage?.(`Restocked ${n} supply-chain tiles to 100%`);
  }
});
const settingsBtn = document.getElementById('hud-settings');
if (settingsBtn) settingsBtn.addEventListener('click', () => settingsPanel.show());

// Theme picker (Beta 1.2). Tapping a card swaps the active theme and
// fires a full renderer repaint so the world repaints in-place — no
// reload required.
bindThemePicker({
  onApply: () => {
    game.renderer.refreshTheme(
      game.grid,
      game.cityMood(),
      game.economy.monthsElapsed,
      game.forestryHealth(),
      game.farmHealth()
    );
  }
});

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

  if (popLabelEl) {
    // totalResidents is a float (faction populations lerp through fractions).
    // Round for display — there is no such thing as 0.4 of a person.
    popLabelEl.textContent = `Pop · ${Math.round(game.population.totalResidents).toLocaleString()}`;
  }
  if (treasuryLabelEl) {
    treasuryLabelEl.textContent = formatCurrency(game.economy.treasury);
  }
  if (treasuryEl) {
    treasuryEl.classList.toggle('treasury--negative', game.economy.treasury < 0);
  }

  // Trend arrows on Pop + Treasury (Alpha 4.6) — compare the latest
  // Stats sample against the one from 3 months ago. Cheap O(1) lookup.
  // Hidden / flat when there aren't enough samples yet.
  applyTrend(popTrendEl, latestVs(game.stats.samples, 'population', 3));
  applyTrend(treasuryTrendEl, latestVs(game.stats.samples, 'treasury', 3));

  // Time-of-day pill — refresh the icon + label to match current phase.
  if (timeEl) {
    const phase = game.timeOfDay;
    let icon = '☀'; let label = 'Day';
    if (phase < 0.15 || phase >= 0.85) { icon = '🌙'; label = 'Night'; }
    else if (phase < 0.30)              { icon = '🌅'; label = 'Dawn'; }
    else if (phase < 0.70)              { icon = '☀'; label = 'Day'; }
    else                                { icon = '🌇'; label = 'Dusk'; }
    timeEl.textContent = `${icon} ${label}`;
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

/**
 * Trend arrow helper (Alpha 4.6). Look up the value at the latest
 * Stats sample and the value `lookbackMonths` ago; return -1 / 0 / +1
 * based on the sign of the delta. Returns 0 (flat) until there are
 * enough samples to compute a trend.
 */
function latestVs(
  samples: ReadonlyArray<import('./simulation/Stats').StatsSample>,
  key: 'population' | 'treasury',
  lookbackMonths: number
): -1 | 0 | 1 {
  if (samples.length < lookbackMonths + 1) return 0;
  const latest = samples[samples.length - 1]![key];
  const past = samples[samples.length - 1 - lookbackMonths]![key];
  // Dead-zone: ignore tiny fluctuations so the arrow doesn't flicker.
  // 2% relative delta or 50 absolute (whichever is bigger).
  const delta = latest - past;
  const threshold = Math.max(50, Math.abs(past) * 0.02);
  if (Math.abs(delta) < threshold) return 0;
  return delta > 0 ? 1 : -1;
}

/** Update a trend-arrow span's class based on the trend direction. */
function applyTrend(el: HTMLElement | null, dir: -1 | 0 | 1): void {
  if (!el) return;
  el.classList.remove('trend--up', 'trend--down', 'trend--flat');
  if (dir > 0) el.classList.add('trend--up');
  else if (dir < 0) el.classList.add('trend--down');
  else el.classList.add('trend--flat');
}

// Camera rotation pill (Alpha 4.7). Tap rotates the orthographic
// camera 90° clockwise around its target, snapping to the four
// cardinal iso angles. Lets the player see behind tall buildings.
const rotateBtn = document.getElementById('hud-rotate');
if (rotateBtn) {
  rotateBtn.addEventListener('click', () => game.camera.rotateBy90(1));
}

// Time-of-day pill click handler (Alpha 4.6). Toggles between morning
// (timeOfDay = 0.25, ~7am — early sun) and peak night (timeOfDay =
// 0.00, midnight). The day/night cycle continues forward from
// whichever phase the player set; tap again to jump back.
if (timeEl) {
  timeEl.addEventListener('click', () => {
    // If we're currently in the night phase, jump to morning.
    // Otherwise jump to peak night.
    const cur = game.timeOfDay;
    const isNight = cur < 0.15 || cur >= 0.85;
    game.timeOfDay = isNight ? 0.25 : 0.0;
  });
}

// Service worker registration (Alpha 4.7). Enables PWA install +
// offline play once the player has loaded the game once. Only
// registers on production builds (Vite sets `import.meta.env.PROD`)
// so dev / HMR sessions don't get a stale cached shell.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      // SW registration failure is non-fatal — the game still works,
      // it just won't be installable / offline-capable.
      console.warn('Service worker registration failed:', err);
    });
  });
}

// ---- Auth UI wiring (Alpha 4.25) -------------------------------------
// Show the Account group in the More-menu only if Supabase is configured
// for this build. Wire the modal trigger + sign-out button + reactive
// pill labels via onAuthChange.
if (isCloudEnabled()) {
  const authGroup = document.getElementById('hud-account-group');
  const signinBtn = document.getElementById('hud-signin');
  const signoutBtn = document.getElementById('hud-signout');
  const nameEl = document.getElementById('hud-account-name');
  authGroup?.classList.remove('hidden');

  const authModal = new AuthModal();
  authModal.onSuccess = () => {
    // Reload so Game.init reads the cloud save for the active slot.
    window.setTimeout(() => location.reload(), 350);
  };
  signinBtn?.addEventListener('click', () => authModal.open('signin'));
  signoutBtn?.addEventListener('click', async () => {
    const supa = getSupabase();
    if (!supa) return;
    await supa.auth.signOut();
    // Reload so the local-only path takes over cleanly.
    location.reload();
  });

  // Reactive pill state — show "Sign in" or "alice@…" based on auth.
  // Settings → Account & data wiring (Beta 1.1.5). Show user email + UID
  // and the "Delete my account" mailto when signed in. Hides when
  // signed out so the section just reads "Sign in to manage…".
  const accountMetaEl = document.getElementById('setting-account-meta');
  const accountEmailEl = document.getElementById('setting-account-email');
  const accountIdEl = document.getElementById('setting-account-id');
  const deleteAccountEl = document.getElementById('setting-delete-account') as HTMLAnchorElement | null;

  onAuthChange((snap) => {
    const user = snap.user;
    if (signinBtn && signoutBtn && nameEl) {
      if (user) {
        signinBtn.style.display = 'none';
        signoutBtn.style.display = '';
        nameEl.style.display = '';
        // Truncate long emails so the pill doesn't overflow on phones.
        const label = user.email ?? user.id.slice(0, 8);
        nameEl.textContent = label.length > 24 ? label.slice(0, 22) + '…' : label;
      } else {
        signinBtn.style.display = '';
        signoutBtn.style.display = 'none';
        nameEl.style.display = 'none';
        nameEl.textContent = '';
      }
    }
    if (user) {
      if (accountMetaEl) accountMetaEl.classList.remove('hidden');
      if (accountEmailEl) accountEmailEl.textContent = user.email ?? '—';
      if (accountIdEl) accountIdEl.textContent = user.id;
      if (deleteAccountEl) {
        deleteAccountEl.classList.remove('hidden');
        // GDPR Article 17 beta-stage flow: open the user's mail client
        // with a prefilled request. The developer processes the request
        // manually within 30 days. The link uses mailto: directly so the
        // OS picks the user's preferred mail app on every platform.
        const subject = encodeURIComponent('Account deletion request — MQ City Builder');
        const body = encodeURIComponent(
          'I would like to delete my MQ City Builder account and all data associated with it.\n\n' +
          `Email: ${user.email ?? '(no email on account)'}\n` +
          `Account ID: ${user.id}\n\n` +
          'Please confirm once the deletion is complete.\n'
        );
        deleteAccountEl.href = `mailto:hello@mqcity.app?subject=${subject}&body=${body}`;
      }
    } else {
      if (accountMetaEl) accountMetaEl.classList.add('hidden');
      if (accountEmailEl) accountEmailEl.textContent = '—';
      if (accountIdEl) accountIdEl.textContent = '—';
      if (deleteAccountEl) {
        deleteAccountEl.classList.add('hidden');
        deleteAccountEl.removeAttribute('href');
      }
    }
  });

  // Auto-open the auth modal on first load when not signed in (Beta 1.0).
  // Player ask: "I would like the login to pop up to come up if the user
  // is not logged in so they know to log in." Tracked once via
  // localStorage so we don't re-prompt every refresh after the user has
  // already chosen "skip for now." First-launch prompt fires after a
  // small delay so it doesn't shove in front of the city-loading splash.
  const AUTH_PROMPTED_KEY = 'mqcity-auth-prompted';
  const alreadyPrompted = (() => {
    try { return localStorage.getItem(AUTH_PROMPTED_KEY) === '1'; } catch { return false; }
  })();
  // Recompute signed-in state at the moment we'd auto-open. The auth
  // session is restored asynchronously inside initAuth() so a fresh
  // device may not yet know the user has a saved session at this point;
  // a small delay covers that.
  setTimeout(() => {
    const supa = getSupabase();
    if (!supa) return;
    if (alreadyPrompted) return;
    if (!authModal) return;
    // Re-check via the live session (in case onAuthChange hasn't fired
    // yet for a freshly-loaded session).
    void supa.auth.getSession().then(({ data }) => {
      if (data.session) return; // already signed in
      authModal.open('signin');
      try { localStorage.setItem(AUTH_PROMPTED_KEY, '1'); } catch { /* private mode */ }
    });
  }, 800);
}

// Expose for ad-hoc debugging from the device's remote inspector.
// Justified `any`: this is a deliberate global escape hatch only used in dev.
(window as unknown as { game: Game }).game = game;
