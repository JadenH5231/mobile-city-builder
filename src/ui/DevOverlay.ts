/**
 * Dev profiling overlay (Beta 1.7). Mounted ONLY when the page is loaded
 * with `?dev=1`. Shows FPS, sim-cost ms, render-cost ms, and the live
 * GPU-resource counts (geometries / textures / draw calls / triangles)
 * so playtesters can report numbers, not vibes — and so the disposal
 * audit has a visible canary for live-geometry growth.
 *
 * Deliberately isolated: a normal player never loads this module's DOM,
 * and the only always-on cost in the hot loop is the two perf timers in
 * Game (a few performance.now() calls per frame). The overlay itself
 * samples at 2 Hz off requestAnimationFrame, not the sim loop.
 */

import type { Game } from '../engine/Game';

/** True when the dev overlay should mount (URL has ?dev=1). */
export function isDevMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('dev') === '1';
  } catch {
    return false;
  }
}

export function mountDevOverlay(game: Game): void {
  const el = document.createElement('div');
  el.id = 'dev-overlay';
  el.style.cssText = [
    'position:fixed',
    'top:8px',
    'right:8px',
    'z-index:99999',
    'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#9effa0',
    'background:rgba(8,12,16,0.82)',
    'border:1px solid rgba(158,255,160,0.35)',
    'border-radius:8px',
    'padding:8px 10px',
    'min-width:188px',
    'pointer-events:none',
    'white-space:pre',
    'text-shadow:0 1px 2px rgba(0,0,0,0.6)'
  ].join(';');
  document.body.appendChild(el);

  // FPS is measured here (independent of Game's own hud-fps counter) so
  // the overlay is self-contained — count frames between samples.
  let frames = 0;
  let lastSample = performance.now();
  let fps = 0;
  // Track the peak live-geometry count so a transient spike during a
  // rebuild is distinguishable from steady-state growth.
  let geomPeak = 0;

  const sample = (): void => {
    frames++;
    const now = performance.now();
    if (now - lastSample >= 500) {
      fps = (frames * 1000) / (now - lastSample);
      frames = 0;
      lastSample = now;

      const info = game.renderer.perfInfo();
      if (info.geometries > geomPeak) geomPeak = info.geometries;
      const p = game.perf;
      const fmt = (ms: number): string => ms.toFixed(1).padStart(5);
      el.textContent = [
        `fps      ${fps.toFixed(0).padStart(5)}`,
        `frame    ${fmt(p.frameMs)} ms`,
        `sim      ${fmt(p.simMs)} ms  x${p.simSteps}`,
        `render   ${fmt(p.renderMs)} ms`,
        `─────────────────`,
        `geom     ${String(info.geometries).padStart(5)}  (peak ${geomPeak})`,
        `textures ${String(info.textures).padStart(5)}`,
        `draws    ${String(info.calls).padStart(5)}`,
        `tris   ${String(info.triangles).padStart(7)}`
      ].join('\n');
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}
