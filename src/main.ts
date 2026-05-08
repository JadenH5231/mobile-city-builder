import { Game } from './engine/Game';
import { MAP_SIZES } from './types';
import './styles.css';

const appEl = document.getElementById('app');
if (!appEl) throw new Error('Missing #app element');

const fpsEl = document.getElementById('hud-fps');

const game = new Game();
await game.init(appEl, MAP_SIZES.small);

// Lightweight FPS counter, sampled every ~500ms to avoid jitter.
if (fpsEl) {
  let frames = 0;
  let last = performance.now();
  game.app.ticker.add(() => {
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

// Expose for ad-hoc debugging from the device's remote inspector.
// Justified `any`: this is a deliberate global escape hatch only used in dev.
(window as unknown as { game: Game }).game = game;
