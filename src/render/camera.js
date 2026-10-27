// Orbit camera rig with smooth transitions, marble following and a top view.

import * as THREE from 'three';
import { FIELD } from '../config.js';

const MIN_PITCH = 0.12;
const MAX_PITCH = 1.45;
const MIN_DIST = 0.12;
const MAX_DIST = 5;

export class CameraRig {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.target = new THREE.Vector3(0, 0, 1);
    this.yaw = 0;
    this.pitch = 0.55;
    this.dist = 0.6;
    this.desired = { target: new THREE.Vector3(0, 0, 1), yaw: 0, pitch: 0.55, dist: 0.6 };
    this.topView = false;
    this.followTarget = null; // {x,y,z}-like object to track
    this.smooth = 5.5;
    this._tmp = new THREE.Vector3();
  }

  /** Jump the camera to the desired state. */
  snap() {
    this.target.copy(this.desired.target);
    this.yaw = this.desired.yaw;
    this.pitch = this.desired.pitch;
    this.dist = this.desired.dist;
  }

  /**
   * Frame `origin` from behind, looking towards `toward`.
   */
  frame(origin, toward, { dist = 0.5, pitch = 0.5, immediate = false } = {}) {
    const dx = origin.x - toward.x;
    const dz = origin.z - toward.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) this.desired.yaw = Math.atan2(dx / len, dz / len);
    dist = clamp(dist, MIN_DIST, MAX_DIST);
    // Framing a marble that lies on the ground against a wall puts the
    // camera outside the yard: look down more steeply there, so the view is
    // the yard and not the bricks and the lawn. (A marble held up in the
    // hand for a lob is above the wall already.)
    const cp = Math.cos(pitch);
    const px = origin.x + Math.sin(this.desired.yaw) * cp * dist;
    const pz = origin.z + Math.cos(this.desired.yaw) * cp * dist;
    const out = FIELD.wallThickness;
    const low = origin.y < FIELD.wallHeight + 0.05;
    if (low && (px < FIELD.xMin - out || px > FIELD.xMax + out || pz < FIELD.zMin - out || pz > FIELD.zMax + out)) {
      pitch = Math.max(pitch, 0.85);
    }
    this.desired.pitch = clamp(pitch, MIN_PITCH, MAX_PITCH);
    this.desired.dist = dist;
    this.desired.target.set(origin.x, origin.y, origin.z);
    this.followTarget = null;
    if (immediate) this.snap();
  }

  /**
   * Track a moving marble. The camera looks a little ahead of it along its
   * velocity and backs off with speed, so a fast marble and whatever it is
   * about to hit stay in view instead of racing off the top of the screen.
   */
  follow(obj) {
    if (this.followTarget !== obj) this.followBaseDist = this.desired.dist;
    this.followTarget = obj;
  }

  orbit(dyaw, dpitch) {
    this.desired.yaw += dyaw;
    this.desired.pitch = clamp(this.desired.pitch + dpitch, MIN_PITCH, MAX_PITCH);
    // orbiting is immediate on the angles for a direct feel
    this.yaw = this.desired.yaw;
    this.pitch = this.desired.pitch;
  }

  zoom(factor) {
    this.desired.dist = clamp(this.desired.dist * factor, MIN_DIST, MAX_DIST);
  }

  setTopView(on) {
    this.topView = on;
  }

  update(dt, aspect) {
    const k = 1 - Math.exp(-this.smooth * dt);
    let kt = k;
    const f = this.followTarget;
    if (f) {
      const vx = f.vx || 0;
      const vz = f.vz || 0;
      const speed = Math.hypot(vx, vz);
      const ahead = 0.12;
      this.desired.target.set(f.x + vx * ahead, f.y, f.z + vz * ahead);
      this.desired.dist = clamp((this.followBaseDist || this.desired.dist) + 0.1 * speed, MIN_DIST, MAX_DIST);
      kt = 1 - Math.exp(-11 * dt); // tighter tracking while something moves
    }
    this.target.lerp(this.desired.target, kt);
    this.yaw += shortestAngle(this.yaw, this.desired.yaw) * k;
    this.pitch += (this.desired.pitch - this.pitch) * k;
    this.dist += (this.desired.dist - this.dist) * k;

    const cam = this.camera;
    if (this.topView) {
      // Fit the whole yard, shifted up a little so the start line clears the
      // HUD at the bottom of the screen.
      const fov = (cam.fov * Math.PI) / 180;
      const lenZ = FIELD.zMax - FIELD.zMin + 1.0;
      const lenX = FIELD.xMax - FIELD.xMin + 0.3;
      const hZ = lenZ / 2 / Math.tan(fov / 2);
      const hX = lenX / 2 / Math.tan(fov / 2) / aspect;
      const h = Math.max(hZ, hX);
      const cz = (FIELD.zMin + FIELD.zMax) / 2 + 0.3;
      this._tmp.set(0, h, cz);
      cam.position.lerp(this._tmp, k);
      cam.up.set(0, 0, -1);
      cam.lookAt(0, 0, cz);
      return;
    }
    cam.up.set(0, 1, 0);
    const cp = Math.cos(this.pitch);
    let px = this.target.x + Math.sin(this.yaw) * cp * this.dist;
    const py = this.target.y + Math.sin(this.pitch) * this.dist;
    let pz = this.target.z + Math.cos(this.yaw) * cp * this.dist;
    let y = py;
    // The camera may leave the yard (the walls are only ankle high): a marble
    // lying against a wall is still framed from behind. Stay above the ground
    // and, near or beyond a wall, above the wall's top. If the line of sight
    // still crosses a wall, lift the camera so it clears the brick where the
    // crossing is not too close to the marble; the wall in the way is faded
    // by the scene for the rest (see fadeWalls in scene.js).
    const ground = this.terrain.height(px, pz);
    if (y < ground + 0.03) y = ground + 0.03;
    const wallTop = FIELD.wallHeight;
    const near = FIELD.wallThickness + 0.05;
    const nearWall = px < FIELD.xMin + near || px > FIELD.xMax - near || pz < FIELD.zMin + near || pz > FIELD.zMax - near;
    if (nearWall && y < wallTop + 0.05) y = wallTop + 0.05;
    const t = this.target;
    const crossings = [
      px < FIELD.xMin ? (FIELD.xMin - t.x) / (px - t.x) : 0,
      px > FIELD.xMax ? (FIELD.xMax - t.x) / (px - t.x) : 0,
      pz < FIELD.zMin ? (FIELD.zMin - t.z) / (pz - t.z) : 0,
      pz > FIELD.zMax ? (FIELD.zMax - t.z) / (pz - t.z) : 0,
    ];
    for (const f of crossings) {
      // f: fraction of the way from the target to the camera where the
      // sight line crosses the wall plane. Clearing it would need a
      // very high camera when f is tiny, so only lift for f >= 0.3.
      if (f > 0 && f < 1) {
        const need = t.y + (wallTop + 0.02 - t.y) / Math.max(f, 0.3);
        if (y < need) y = need;
      }
    }
    cam.position.set(px, y, pz);
    cam.lookAt(this.target);
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
