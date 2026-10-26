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
    this.desired.pitch = clamp(pitch, MIN_PITCH, MAX_PITCH);
    this.desired.dist = clamp(dist, MIN_DIST, MAX_DIST);
    this.desired.target.set(origin.x, origin.y, origin.z);
    this.followTarget = null;
    if (immediate) this.snap();
  }

  follow(obj) {
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
    if (this.followTarget) {
      this.desired.target.set(this.followTarget.x, this.followTarget.y, this.followTarget.z);
    }
    this.target.lerp(this.desired.target, k);
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
    // Stay inside the yard (never behind a wall) and above the ground; when
    // pressed against a wall, rise enough to look over it.
    const margin = 0.03;
    const nearWall =
      px < FIELD.xMin + margin || px > FIELD.xMax - margin || pz < FIELD.zMin + margin || pz > FIELD.zMax - margin;
    px = clamp(px, FIELD.xMin + margin, FIELD.xMax - margin);
    pz = clamp(pz, FIELD.zMin + margin, FIELD.zMax - margin);
    const ground = this.terrain.height(px, pz);
    if (y < ground + 0.03) y = ground + 0.03;
    if (nearWall && y < FIELD.wallHeight + 0.08) y = FIELD.wallHeight + 0.08;
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
