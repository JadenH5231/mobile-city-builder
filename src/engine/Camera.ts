/**
 * 2D camera for the isometric world.
 *
 * Convention: the world container's screen position is `(x, y)` and its
 * uniform scale is `zoom`. So a world-space point `wp` lands on screen at
 * `wp * zoom + (x, y)`. Renderer pushes these straight onto the container's
 * transform every frame.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  /** Hard zoom limits — overridable by Game once we know the map size. */
  minZoom = 0.18;
  maxZoom = 4;

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
  }

  /**
   * Multiply zoom by `factor`, clamped, while keeping the world point under
   * `(screenX, screenY)` visually fixed. This is what makes pinch-zoom feel
   * right — the spot between your fingers stays put.
   */
  zoomAt(factor: number, screenX: number, screenY: number): void {
    const newZoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    if (newZoom === this.zoom) return;
    const ratio = newZoom / this.zoom;
    this.x = screenX - (screenX - this.x) * ratio;
    this.y = screenY - (screenY - this.y) * ratio;
    this.zoom = newZoom;
  }

  /** Map a screen-space point back into world-space. */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.x) / this.zoom,
      y: (screenY - this.y) / this.zoom
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
