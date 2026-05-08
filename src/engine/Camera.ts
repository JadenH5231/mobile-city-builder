import { OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

/**
 * Fixed-angle orthographic camera for the 3D world.
 *
 * The view angle (yaw + pitch) is locked so the player never has to think
 * about orbit gestures — pan and zoom is all that matters on mobile. Yaw
 * sits at 45° and pitch at ~35° to land on the same "3/4 isometric" feel
 * Step 2's 2D iso had, but with proper 3D perspective for road meshes.
 *
 * Public API kept narrow on purpose so Input.ts stays renderer-agnostic:
 * - `panBy(dx, dy)`: shift target by a screen-space pixel delta
 * - `zoomAt(factor, sx, sy)`: zoom while keeping the world point under
 *   `(sx, sy)` visually pinned (essential for pinch feel)
 * - `screenToWorld(sx, sy)`: ray-cast the screen point onto the y=0 plane
 */
export class Camera {
  /** Where the camera is looking on the y=0 plane. */
  readonly target = new Vector3(0, 0, 0);
  /** Half-height of the visible world frustum, in world units. */
  orthoSize = 16;
  minOrthoSize = 2;
  maxOrthoSize = 80;

  readonly three = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

  private readonly yaw = Math.PI / 4; // 45° → looks NE/SW
  private readonly pitch = (35 * Math.PI) / 180; // 35° down from horizontal
  private readonly camDistance = 200;

  private viewportWidth = 1;
  private viewportHeight = 1;

  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly raycaster = new Raycaster();
  private readonly tmpVec3 = new Vector3();
  private readonly tmpRight = new Vector3();
  private readonly tmpForward = new Vector3();

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.update();
  }

  /** Recompute the Three camera's projection + view matrices. */
  update(): void {
    const aspect = this.viewportWidth / this.viewportHeight;
    this.three.left = -this.orthoSize * aspect;
    this.three.right = this.orthoSize * aspect;
    this.three.top = this.orthoSize;
    this.three.bottom = -this.orthoSize;
    this.three.updateProjectionMatrix();

    // Position the camera at a fixed offset relative to its target.
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    const ox = this.camDistance * cosP * sinY;
    const oy = this.camDistance * sinP;
    const oz = this.camDistance * cosP * cosY;
    this.three.position.set(this.target.x + ox, oy, this.target.z + oz);
    this.three.lookAt(this.target);
    this.three.updateMatrixWorld(true);
  }

  /**
   * Convert a screen-pixel delta into a world XZ pan and apply it. The
   * camera's `right` and `up` axes (projected onto the ground plane) are
   * what "screen right / down" actually mean once tilted.
   */
  panBy(dx: number, dy: number): void {
    const pxToWorld = (2 * this.orthoSize) / this.viewportHeight;

    this.tmpRight.setFromMatrixColumn(this.three.matrixWorld, 0);
    this.tmpRight.y = 0;
    this.tmpRight.normalize();

    // "Up on screen" projected onto the ground plane is the camera's
    // forward direction with sign flipped (since the camera is tilted
    // looking down). Easier: use forward.
    this.tmpForward.set(0, 0, -1).applyQuaternion(this.three.quaternion);
    this.tmpForward.y = 0;
    this.tmpForward.normalize();

    this.target.x -= this.tmpRight.x * dx * pxToWorld;
    this.target.z -= this.tmpRight.z * dx * pxToWorld;
    // dy>0 means the finger went down; world should move up-on-screen, which
    // is camera-forward in the XZ plane.
    this.target.x -= this.tmpForward.x * -dy * pxToWorld;
    this.target.z -= this.tmpForward.z * -dy * pxToWorld;

    this.update();
  }

  /**
   * Zoom by `factor`, anchored on the world point under `(screenX, screenY)`.
   * factor > 1 zooms in (orthoSize shrinks).
   */
  zoomAt(factor: number, screenX: number, screenY: number): void {
    const newSize = clamp(this.orthoSize / factor, this.minOrthoSize, this.maxOrthoSize);
    if (newSize === this.orthoSize) return;
    const before = this.screenToWorld(screenX, screenY);
    if (!before) {
      this.orthoSize = newSize;
      this.update();
      return;
    }
    this.orthoSize = newSize;
    this.update();
    const after = this.screenToWorld(screenX, screenY);
    if (!after) return;
    this.target.x += before.x - after.x;
    this.target.z += before.z - after.z;
    this.update();
  }

  /** Screen pixel → ground-plane world point. Returns null if no hit. */
  screenToWorld(sx: number, sy: number): Vector3 | null {
    const ndc = new Vector2(
      (sx / this.viewportWidth) * 2 - 1,
      -(sy / this.viewportHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.three);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmpVec3);
    return hit ? this.tmpVec3.clone() : null;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
