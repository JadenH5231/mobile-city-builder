/**
 * Theme picker (Beta 1.2). Renders a card grid into `#setting-theme-grid`
 * from the registry. Each card shows the theme's hero swatch, name,
 * tagline, and an Active / Apply / price chip. Tapping Apply swaps the
 * active theme and triggers a full renderer repaint via the hook
 * provided by main.ts.
 *
 * Vanilla DOM (matches the rest of the project's no-framework rule).
 * Cards re-paint themselves on `onThemeChange` so two pickers in
 * different views stay in sync.
 */

import { getActiveTheme, listThemes, setActiveTheme, onThemeChange } from '../themes/registry';
import type { ThemePack } from '../themes/types';

export function bindThemePicker(hooks: { onApply: () => void }): void {
  const grid = document.getElementById('setting-theme-grid');
  if (!grid) return;

  const render = (): void => {
    const active = getActiveTheme();
    const cards = listThemes().map((t) => renderCard(t, t.id === active.id));
    grid.replaceChildren(...cards);
  };

  grid.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-theme-id]');
    if (!card) return;
    const id = card.dataset.themeId!;
    if (id === getActiveTheme().id) return;
    setActiveTheme(id);
    hooks.onApply();
  });

  // Repaint cards on any theme change (catches programmatic swaps).
  onThemeChange(() => render());

  render();
}

function renderCard(t: ThemePack, isActive: boolean): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'settings__theme-card' + (isActive ? ' is-active' : '');
  card.dataset.themeId = t.id;
  card.setAttribute('aria-pressed', String(isActive));

  // Hero swatch — a tiny gradient pill so the card has visual weight.
  const swatch = document.createElement('div');
  swatch.className = 'settings__theme-swatch';
  const { primary, secondary, accent, mid } = t.heroSwatch;
  const midColor = mid !== undefined ? mid : blendHex(primary, secondary, 0.5);
  swatch.style.background =
    `linear-gradient(135deg, ${hex(primary)} 0%, ${hex(midColor)} 50%, ${hex(secondary)} 100%)`;
  // Accent dot in the corner for the highlight colour.
  const dot = document.createElement('span');
  dot.className = 'settings__theme-swatch-dot';
  dot.style.background = hex(accent);
  swatch.appendChild(dot);
  card.appendChild(swatch);

  // Title row — name + status pill (Active / Apply).
  const titleRow = document.createElement('div');
  titleRow.className = 'settings__theme-title-row';
  const title = document.createElement('div');
  title.className = 'settings__theme-name';
  title.textContent = t.name;
  titleRow.appendChild(title);
  const status = document.createElement('span');
  status.className = 'settings__theme-status';
  if (isActive) {
    status.textContent = 'Active';
    status.classList.add('settings__theme-status--active');
  } else if (t.priceUsd === 'free') {
    status.textContent = 'Free';
    status.classList.add('settings__theme-status--free');
  } else {
    status.textContent = `$${t.priceUsd.toFixed(2)}`;
    status.classList.add('settings__theme-status--price');
  }
  titleRow.appendChild(status);
  card.appendChild(titleRow);

  // Tagline.
  const tag = document.createElement('div');
  tag.className = 'settings__theme-tagline';
  tag.textContent = t.tagline;
  card.appendChild(tag);

  return card;
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function blendHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}
