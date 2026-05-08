import type { Camera } from './Camera';

/**
 * Pointer-event based gesture handler.
 *
 * - 1 pointer: pan (drag)
 * - 2 pointers: pinch-zoom + two-finger pan, anchored on the pinch midpoint
 * - mouse wheel: zoom (for desktop testing)
 *
 * We use Pointer Events instead of Touch Events so the same code path covers
 * mouse, pen, and touch — and so we get capture semantics for free, which
 * matters when a finger drifts off the canvas mid-drag.
 */
export class Input {
  private readonly element: HTMLElement;
  private readonly camera: Camera;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist: number | null = null;
  private lastPinchCenter: { x: number; y: number } | null = null;

  constructor(element: HTMLElement, camera: Camera) {
    this.element = element;
    this.camera = camera;
    this.attach();
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
    // Prevent browser context menu on long-press / right-click — we'll add
    // our own long-press menu in Step 3.
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.element.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Reset pinch tracking — it'll re-establish on the next move with 2 fingers.
    this.lastPinchDist = null;
    this.lastPinchCenter = null;
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;

    if (this.pointers.size >= 2) {
      // Update *before* computing — the moved pointer's new position is
      // part of this frame's gesture state.
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.handlePinch();
      return;
    }

    // Single-finger pan
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.camera.panBy(dx, dy);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  private handlePinch(): void {
    const pts = Array.from(this.pointers.values()).slice(0, 2);
    if (pts.length < 2) return;
    const a = pts[0]!;
    const b = pts[1]!;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;

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
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) {
      this.lastPinchDist = null;
      this.lastPinchCenter = null;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // ~10% per wheel notch feels right on a trackpad.
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.camera.zoomAt(factor, e.clientX, e.clientY);
  };
}
