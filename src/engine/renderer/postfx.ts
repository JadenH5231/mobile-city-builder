/**
 * Post-processing pipeline (Beta 1.9 — "looks" pass / Phase A).
 *
 * Wraps the single `Renderer.render()` seam with an EffectComposer. The
 * pipeline is deliberately minimal — just a soft bloom on genuinely bright
 * pixels so the city's night lights (lit windows, lamps, sun glints) glow,
 * without the heavy "filtered" look. (A tilt-shift / miniature depth-blur was
 * trialled and removed — the player didn't want it.) Order:
 *
 *   RenderPass  → base scene render into a 4× MSAA HalfFloat target
 *                 (MSAA so we keep the edge antialiasing the composer would
 *                  otherwise drop vs the canvas's native AA)
 *   UnrealBloom → soft glow on the brightest pixels only; threshold kept high
 *                 so the daytime palette doesn't wash out
 *   OutputPass  → tone-map + linear→sRGB conversion (final to screen)
 *
 * Everything is render-only and fully reversible: when disabled, the Renderer
 * falls straight back to `three.render(scene, camera)` — the exact pre-1.9
 * path — so the WebGL2 baseline is never at risk (memory:
 * principle_universal_device_compat).
 */
import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three';
import type { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface PostFXConfig {
  /** Soft glow on bright pixels. */
  bloom: boolean;
  bloomStrength: number;
  bloomRadius: number;
  /** Luminance above which a pixel blooms (0..1+). High → only the brightest. */
  bloomThreshold: number;
}

/**
 * Default look. Tuned conservatively: bloom only catches genuine highlights
 * (night windows / lamps / sun glints), so daytime stays true to the authored
 * palette. Live-tunable via `Renderer.tuneFx` for in-browser dialing.
 */
export const DEFAULT_POSTFX: PostFXConfig = {
  bloom: true,
  // Gentle: light surfaces (sidewalks / walking trails) under full sun were
  // blooming too hard, so the threshold is high (only the genuinely brightest
  // pixels — night lit-windows / lamps — pass) and the strength is low so the
  // glow is a soft halo, not a wash.
  bloomStrength: 0.22,
  bloomRadius: 0.40,
  bloomThreshold: 0.92
};

export class PostFX {
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly cfg: PostFXConfig;
  private cssW = 1;
  private cssH = 1;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: OrthographicCamera, cfg: PostFXConfig) {
    this.cfg = { ...cfg };

    // MSAA HalfFloat target: HalfFloat gives the bloom real HDR headroom,
    // samples:4 preserves the edge antialiasing the canvas had natively
    // (three clamps samples to the device's MAX_SAMPLES on WebGL2, and the
    // attribute is simply ignored on WebGL1 — safe everywhere).
    const size = renderer.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);

    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(
      new Vector2(size.x, size.y),
      cfg.bloomStrength,
      cfg.bloomRadius,
      cfg.bloomThreshold
    );
    this.composer.addPass(this.bloomPass);

    // OutputPass is always last + always enabled: it does tone mapping +
    // the linear→sRGB conversion that the direct render path does natively.
    this.composer.addPass(new OutputPass());

    this.applyConfig();
  }

  /** Resize in lockstep with the renderer. `cssW/cssH` are CSS pixels — the
   *  composer multiplies by the renderer's pixel ratio internally. */
  setSize(cssW: number, cssH: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.composer.setSize(this.cssW, this.cssH);
    this.bloomPass.setSize(this.cssW, this.cssH);
  }

  render(): void {
    this.composer.render();
  }

  /** Merge a partial config and re-apply. Used by `Renderer.tuneFx` for
   *  live in-browser tuning from the dev console. */
  tune(partial: Partial<PostFXConfig>): void {
    Object.assign(this.cfg, partial);
    this.applyConfig();
  }

  config(): Readonly<PostFXConfig> {
    return this.cfg;
  }

  dispose(): void {
    this.composer.dispose();
  }

  private applyConfig(): void {
    this.bloomPass.enabled = this.cfg.bloom;
    this.bloomPass.strength = this.cfg.bloomStrength;
    this.bloomPass.radius = this.cfg.bloomRadius;
    this.bloomPass.threshold = this.cfg.bloomThreshold;
  }
}
