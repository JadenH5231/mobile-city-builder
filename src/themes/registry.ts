/**
 * Theme registry (Beta 1.2). Single source of truth for the active
 * theme + change notifications. Persisted in localStorage under
 * `mqcity-active-theme` (Settings-class preference, not save data).
 *
 * Consumers:
 *  - Renderer reads palettes via `getActiveTheme()`.
 *  - Long-tail colour constants pass through `tint(stockHex)` so the
 *    theme's mood tint reaches everything we haven't explicitly
 *    re-authored. Stock theme = identity tint.
 *  - UI (Settings panel) subscribes via `onThemeChange()` to repaint
 *    the picker; main.ts subscribes to trigger a full renderer refresh.
 */

import type { ThemePack } from './types';
import { STOCK_THEME } from './stock';
import { COASTAL_PASTEL_THEME } from './coastalPastel';

const STORAGE_KEY = 'mqcity-active-theme';

const REGISTRY: ReadonlyArray<ThemePack> = [
  STOCK_THEME,
  COASTAL_PASTEL_THEME
];

let active: ThemePack = STOCK_THEME;
const listeners = new Set<(t: ThemePack) => void>();

/** Initialise from localStorage. Called once at app boot, before the
 *  renderer takes its first scene snapshot. Safe to call when storage
 *  isn't available (private mode) — falls back to stock. */
export function initThemes(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const found = REGISTRY.find((t) => t.id === saved);
    if (found) active = found;
  } catch {
    // private mode / quota — stay on stock.
  }
}

export function listThemes(): ReadonlyArray<ThemePack> {
  return REGISTRY;
}

export function getActiveTheme(): ThemePack {
  return active;
}

export function setActiveTheme(id: string): void {
  const next = REGISTRY.find((t) => t.id === id);
  if (!next || next.id === active.id) return;
  active = next;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode */ }
  for (const fn of listeners) fn(active);
}

export function onThemeChange(handler: (t: ThemePack) => void): () => void {
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}

/* ---- The tint() function — the secret sauce ------------------------- */

/**
 * Apply the active theme's mood tint to a colour.
 *
 * Stock theme: identity (returns input unchanged).
 * Coastal Pastel: desaturate slightly + lift lightness + blend toward
 * warm cream. Result: even unmigrated colour literals (skyscraper
 * accents, service-building detail colours, etc.) read as if they
 * belong in the same scene as the explicitly themed surfaces.
 *
 * Cheap — ~10 arithmetic ops, no allocations. Safe to call inside
 * hot build paths.
 */
export function tint(hex: number): number {
  const m = active.moodTint;
  // Fast path for stock / identity-tint themes.
  if (m.strength === 0 && m.saturationMul === 1 && m.lightnessMul === 1) return hex;

  // RGB → HSL
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l0 = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }

  // Adjust saturation and lightness.
  s = Math.max(0, Math.min(1, s * m.saturationMul));
  const l = Math.max(0, Math.min(1, l0 * m.lightnessMul));

  // HSL → RGB
  let r1: number, g1: number, b1: number;
  if (s === 0) { r1 = g1 = b1 = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r1 = hue2rgb(p, q, h + 1 / 3);
    g1 = hue2rgb(p, q, h);
    b1 = hue2rgb(p, q, h - 1 / 3);
  }

  // Blend toward the mood tone.
  const tr = ((m.toward >> 16) & 0xff) / 255;
  const tg = ((m.toward >> 8) & 0xff) / 255;
  const tb = (m.toward & 0xff) / 255;
  const k = m.strength;
  r1 = r1 * (1 - k) + tr * k;
  g1 = g1 * (1 - k) + tg * k;
  b1 = b1 * (1 - k) + tb * k;

  return (
    (Math.round(r1 * 255) << 16) |
    (Math.round(g1 * 255) << 8) |
    Math.round(b1 * 255)
  );
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/* ---- Convenience accessors ------------------------------------------ */

/** Return a building-zone body palette for the active theme, tinted by
 *  the long-tail fallback (no-op for stock). Always returns a 5-tuple
 *  so callers can index by density 0..4 safely. */
export function getBuildingPalette(zone: 'residential' | 'commercial' | 'industrial' | 'mixed'): readonly [number, number, number, number, number] {
  return active.buildings[zone].body;
}
