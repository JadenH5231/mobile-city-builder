import { Application } from 'pixi.js';
import { Camera } from './Camera';
import { Input } from './Input';
import { Renderer } from './Renderer';
import { Grid } from '../world/Grid';
import { MAP_SIZES, TILE_HEIGHT, TILE_WIDTH, type MapSize } from '../types';

/**
 * Game owns the Pixi Application and the top-level systems. For Step 2 it
 * just wires Renderer + Camera + Input together and drives the camera each
 * frame. Later steps will mount a fixed-rate simulation loop here.
 */
export class Game {
  readonly app = new Application();
  readonly camera = new Camera();
  readonly renderer = new Renderer();

  grid!: Grid;
  input!: Input;

  async init(host: HTMLElement, mapSize: MapSize = MAP_SIZES.small): Promise<void> {
    await this.app.init({
      resizeTo: window,
      background: '#0a1410',
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      // Reduce wasted GPU work in the background tab.
      preference: 'webgl'
    });

    host.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = 'none';

    this.grid = new Grid(mapSize.width, mapSize.height);
    this.app.stage.addChild(this.renderer.worldContainer);
    this.input = new Input(this.app.canvas, this.camera);

    this.renderer.drawGrid(this.grid);
    this.fitCameraToGrid();

    this.app.ticker.add(this.tick);
    window.addEventListener('resize', this.onResize);
  }

  /** Choose a starting zoom + pan that comfortably fits the whole map. */
  private fitCameraToGrid(): void {
    const gridPxWidth = (this.grid.width + this.grid.height) * (TILE_WIDTH / 2);
    const gridPxHeight = (this.grid.width + this.grid.height) * (TILE_HEIGHT / 2);

    const fitX = (window.innerWidth * 0.92) / gridPxWidth;
    const fitY = (window.innerHeight * 0.82) / gridPxHeight;
    const fit = Math.min(fitX, fitY);

    this.camera.minZoom = Math.min(0.18, fit * 0.5);
    this.camera.zoom = Math.max(this.camera.minZoom, Math.min(1.5, fit));

    // Anchor: place world-origin so the grid is roughly centered.
    // The iso grid's vertical center sits at world-y = gridPxHeight/2,
    // and horizontally at world-x = 0 (top tile is at 0).
    this.camera.x = window.innerWidth / 2;
    this.camera.y = window.innerHeight / 2 - (gridPxHeight / 2) * this.camera.zoom;
  }

  private tick = (): void => {
    this.renderer.applyCamera(this.camera);
  };

  private onResize = (): void => {
    // resizeTo:window handles the canvas surface; keep camera pan reasonable.
    // No-op for now — the camera lives in screen-space and will stay where
    // the user left it.
  };
}
