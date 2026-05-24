import type { Camera } from './Camera';

/**
 * Pointer-event based gesture handler.
 *
 * Two operating modes:
 * - **navigate** (default): single-finger drag pans the camera; tap/long-press
 *   fire after a release within thresholds.
 * - **paint**: single-finger drag paints. `onPaintStart` fires after a brief
 *   intent-detection window (PAINT_INTENT_DELAY_MS) so a pinch gesture's
 *   second finger has time to arrive before we commit a tile. If the
 *   pointer moves past PAINT_INTENT_MOVE_PX during the window, the paint
 *   commits immediately as a confirmed drag-paint. If the pointer lifts
 *   before the window expires, `onPaintStart` + `onPaintEnd` fire back-
 *   to-back (fast tap-to-place). `onPaintMove` on each subsequent move,
 *   `onPaintEnd` on release. Tap and long-press are suppressed.
 *
 * In **either** mode, two pointers always pinch-zoom + two-finger-pan the
 * camera, so the player can navigate without leaving the active tool. A
 * pinch arriving during the paint-intent window cancels the paint
 * entirely — no orphan tile gets placed where the first finger landed.
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
/** Paint-intent detection window (Beta 1.3.1 — pinch-vs-paint bug fix).
 *  When a paint tool is active, we wait this long after pointer-down
 *  before committing `onPaintStart`. If a second pointer lands during
 *  the window, the gesture is reclassified as a pinch and no paint
 *  fires. If the pointer moves more than PAINT_INTENT_MOVE_PX in the
 *  window, the paint commits immediately as a confirmed drag-paint.
 *  If the pointer lifts before the window expires, the paint commits
 *  + ends back-to-back (a fast tap-to-place). 110ms is generous for
 *  natural multi-touch (typical pinch lands the second finger within
 *  ~30-50ms) while staying below the system's perceptible-latency
 *  threshold (~150ms).
 */
const PAINT_INTENT_DELAY_MS = 110;
const PAINT_INTENT_MOVE_PX = 6;

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
  /** Pending paint-intent timer (Beta 1.3.1). Set by `onPointerDown` in
   *  paint mode and cleared by any disambiguator: second pointer down
   *  (pinch), pointer moved past threshold (confirmed drag-paint),
   *  pointer up (fast tap), or mode change. While the timer is live no
   *  paint has been committed yet — that's the whole point of the
   *  window. */
  private paintIntentTimer: number | null = null;
  /** Screen position where the deferred paint will commit if the
   *  intent window expires or the pointer lifts. */
  private paintIntentStart: { x: number; y: number } | null = null;

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
    // Any pending paint-intent is invalidated by a mode swap.
    this.cancelPaintIntent();
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
    // and any active paint stroke (including a still-pending paint intent
    // that hasn't committed a tile yet). Pinch always wins over single-
    // finger work.
    if (this.pointers.size >= 2) {
      this.cancelLongPress();
      this.cancelPaintIntent();
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
      // Beta 1.3.1 — DEFER the paint commit by PAINT_INTENT_DELAY_MS so
      // a pinch gesture (whose second finger lands a few ms after the
      // first) doesn't accidentally drop a tile. The timer fires
      // `onPaintStart` IF: (a) the window expires with one finger still
      // down + no significant move; OR (b) the pointer moves > PAINT_
      // INTENT_MOVE_PX (handled in onPointerMove); OR (c) the pointer
      // lifts before the window expires (handled in onPointerUp).
      this.paintIntentStart = { x: e.clientX, y: e.clientY };
      this.paintIntentTimer = window.setTimeout(() => {
        this.paintIntentTimer = null;
        if (this.paintIntentStart && this.pointers.size === 1 && !this.painting) {
          this.painting = true;
          this.callbacks.onPaintStart?.(this.paintIntentStart.x, this.paintIntentStart.y);
          this.paintIntentStart = null;
        }
      }, PAINT_INTENT_DELAY_MS);
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

    // Beta 1.3.1 — if there's a deferred paint intent and the pointer
    // has moved past the move-confirms-drag threshold, commit the paint
    // now (it's a drag-paint, not a pinch). The first tile lands at the
    // original touch-down position so the stroke geometry stays
    // coherent.
    if (this.paintIntentTimer !== null && this.paintIntentStart) {
      const distFromIntent = Math.hypot(
        e.clientX - this.paintIntentStart.x,
        e.clientY - this.paintIntentStart.y
      );
      if (distFromIntent > PAINT_INTENT_MOVE_PX) {
        clearTimeout(this.paintIntentTimer);
        this.paintIntentTimer = null;
        this.painting = true;
        this.callbacks.onPaintStart?.(this.paintIntentStart.x, this.paintIntentStart.y);
        this.paintIntentStart = null;
        // Fall through to the onPaintMove branch below.
      }
    }

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

      // Beta 1.3.1 — fast-tap path: pointer lifted before the intent
      // window expired. Commit the deferred paint (start + end back-to-
      // back) so single quick taps in paint mode still place a tile
      // with no perceptible latency relative to the system tap delay.
      if (this.paintIntentTimer !== null && this.paintIntentStart) {
        clearTimeout(this.paintIntentTimer);
        this.paintIntentTimer = null;
        this.callbacks.onPaintStart?.(this.paintIntentStart.x, this.paintIntentStart.y);
        this.callbacks.onPaintEnd?.();
        this.paintIntentStart = null;
        this.gestureCommitted = false;
        return;
      }

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

  /** Drop any pending paint-intent timer + reset the stored start
   *  position. Called when a pinch arrives, the mode changes, or the
   *  gesture otherwise becomes invalid. Beta 1.3.1. */
  private cancelPaintIntent(): void {
    if (this.paintIntentTimer !== null) {
      clearTimeout(this.paintIntentTimer);
      this.paintIntentTimer = null;
    }
    this.paintIntentStart = null;
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // ~10% per wheel notch feels right on a trackpad.
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.camera.zoomAt(factor, e.clientX, e.clientY);
  };
}
