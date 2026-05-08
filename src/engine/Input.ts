import type { Camera } from './Camera';

/**
 * Pointer-event based gesture handler.
 *
 * Two operating modes:
 * - **navigate** (default): single-finger drag pans the camera; tap/long-press
 *   fire after a release within thresholds.
 * - **paint**: single-finger drag paints — `onPaintStart` fires immediately on
 *   pointer down (so a stationary tap also paints one cell), `onPaintMove` on
 *   each move, and `onPaintEnd` on release. Tap and long-press are suppressed.
 *
 * In **either** mode, two pointers always pinch-zoom + two-finger-pan the
 * camera, so the player can navigate without leaving the active tool.
 *
 * We use Pointer Events (not Touch Events) so the same code path covers
 * mouse, pen, and touch — and we get pointer capture, which matters when a
 * finger drifts off the canvas mid-drag.
 */
export type InputMode = 'navigate' | 'paint';

export interface InputCallbacks {
  onTap?: (screenX: number, screenY: number) => void;
  onLongPress?: (screenX: number, screenY: number) => void;
  onPaintStart?: (screenX: number, screenY: number) => void;
  onPaintMove?: (screenX: number, screenY: number) => void;
  onPaintEnd?: () => void;
}

const TAP_MAX_MS = 250;
const TAP_MAX_PX = 10;
const LONG_PRESS_MS = 500;

interface PointerState {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
  maxDist: number;
  longPressFired: boolean;
}

export class Input {
  private readonly element: HTMLElement;
  private readonly camera: Camera;
  private readonly callbacks: InputCallbacks;
  private readonly pointers = new Map<number, PointerState>();
  private lastPinchDist: number | null = null;
  private lastPinchCenter: { x: number; y: number } | null = null;
  /** True once the active gesture has clearly committed to panning/pinching. */
  private gestureCommitted = false;
  private longPressTimer: number | null = null;
  private mode: InputMode = 'navigate';
  /** Active when a single-finger paint stroke is in progress. */
  private painting = false;

  constructor(element: HTMLElement, camera: Camera, callbacks: InputCallbacks = {}) {
    this.element = element;
    this.camera = camera;
    this.callbacks = callbacks;
    this.attach();
  }

  setMode(mode: InputMode): void {
    if (this.mode === mode) return;
    // If we were mid-stroke, terminate cleanly so consumers can finalize.
    if (this.painting) {
      this.painting = false;
      this.callbacks.onPaintEnd?.();
    }
    this.mode = mode;
  }

  private attach(): void {
    const el = this.element;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    // Block the OS context menu so our long-press feels native.
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.element.setPointerCapture(e.pointerId);
    const now = performance.now();
    const state: PointerState = {
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      startTime: now,
      maxDist: 0,
      longPressFired: false
    };
    this.pointers.set(e.pointerId, state);

    // A second finger turns this into a pinch — kill any in-flight tap/long-press
    // and any active paint stroke. Pinch always wins over single-finger work.
    if (this.pointers.size >= 2) {
      this.cancelLongPress();
      this.gestureCommitted = true;
      this.lastPinchDist = null;
      this.lastPinchCenter = null;
      if (this.painting) {
        this.painting = false;
        this.callbacks.onPaintEnd?.();
      }
      return;
    }

    if (this.mode === 'paint') {
      // Paint immediately on touch-down — a stationary tap should still mark
      // exactly one tile. Drag-extend handled in onPointerMove.
      this.painting = true;
      this.callbacks.onPaintStart?.(e.clientX, e.clientY);
      return;
    }

    // Navigate mode: arm a long-press timer. Fires only if the pointer hasn't
    // moved (gestureCommitted stays false) and we're still on one finger.
    this.cancelLongPress();
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      const s = this.pointers.get(e.pointerId);
      if (!s || this.gestureCommitted || this.pointers.size !== 1) return;
      s.longPressFired = true;
      this.callbacks.onLongPress?.(s.lastX, s.lastY);
    }, LONG_PRESS_MS);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const state = this.pointers.get(e.pointerId);
    if (!state) return;

    if (this.pointers.size >= 2) {
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      this.handlePinch();
      return;
    }

    const dx = e.clientX - state.lastX;
    const dy = e.clientY - state.lastY;
    state.lastX = e.clientX;
    state.lastY = e.clientY;

    if (this.painting) {
      this.callbacks.onPaintMove?.(e.clientX, e.clientY);
      return;
    }

    const distFromStart = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);
    if (distFromStart > state.maxDist) state.maxDist = distFromStart;

    // Hold the camera still until we're sure this isn't a tap. The TAP_MAX_PX
    // dead zone keeps shaky fingers from scrolling the world on a tap.
    if (!this.gestureCommitted && state.maxDist > TAP_MAX_PX) {
      this.gestureCommitted = true;
      this.cancelLongPress();
    }

    if (this.gestureCommitted) {
      this.camera.panBy(dx, dy);
    }
  };

  private handlePinch(): void {
    const states = Array.from(this.pointers.values()).slice(0, 2);
    if (states.length < 2) return;
    const a = states[0]!;
    const b = states[1]!;
    const dist = Math.hypot(a.lastX - b.lastX, a.lastY - b.lastY);
    const cx = (a.lastX + b.lastX) / 2;
    const cy = (a.lastY + b.lastY) / 2;

    if (this.lastPinchDist !== null && this.lastPinchCenter && this.lastPinchDist > 0) {
      const factor = dist / this.lastPinchDist;
      this.camera.zoomAt(factor, cx, cy);
      // Two-finger pan: translate by midpoint delta.
      this.camera.panBy(cx - this.lastPinchCenter.x, cy - this.lastPinchCenter.y);
    }
    this.lastPinchDist = dist;
    this.lastPinchCenter = { x: cx, y: cy };
  }

  private onPointerUp = (e: PointerEvent): void => {
    const state = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);

    if (this.pointers.size < 2) {
      this.lastPinchDist = null;
      this.lastPinchCenter = null;
    }

    if (!state) return;

    if (this.pointers.size === 0) {
      this.cancelLongPress();

      if (this.painting) {
        this.painting = false;
        this.callbacks.onPaintEnd?.();
      } else {
        // Tap fires only on the final lift, and only in navigate mode.
        const duration = performance.now() - state.startTime;
        const isTap =
          !this.gestureCommitted &&
          !state.longPressFired &&
          duration < TAP_MAX_MS &&
          state.maxDist < TAP_MAX_PX;
        if (isTap) this.callbacks.onTap?.(state.lastX, state.lastY);
      }

      this.gestureCommitted = false;
    }
  };

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // ~10% per wheel notch feels right on a trackpad.
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.camera.zoomAt(factor, e.clientX, e.clientY);
  };
}
