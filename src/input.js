// Pointer, wheel and keyboard handling.
//   - press on (or near) your marble and drag back: slingshot aim; release to shoot
//   - drag anywhere else / right-drag: orbit the camera; wheel or pinch: zoom
//   - while aiming a lob, the wheel or Up/Down keys change the lob angle

import * as THREE from 'three';
import { SHOT } from './config.js';

export class InputController {
  constructor({ canvas, camera, rig, audio }) {
    this.canvas = canvas;
    this.camera = camera;
    this.rig = rig;
    this.audio = audio;
    this.enabled = false;
    this.context = null; // { origin, radius, kind, maxSpeed }
    this.elevation = SHOT.throwAngleDefault;
    this.onAim = null;
    this.onShoot = null;
    this.onKey = null;
    this.onInteract = null;
    this.aim = null;
    this.orbitDrag = null;
    this.pointers = new Map();
    this._pinchDist = 0;
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._lastPointer = { x: 0, y: 0 };

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('wheel', (e) => this._wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._key(e));
  }

  setContext(ctx) {
    this.context = ctx;
  }

  setEnabled(v) {
    if (!v) this.cancel();
    this.enabled = v;
  }

  get aiming() {
    return !!this.aim;
  }

  cancel() {
    if (this.aim) {
      this.aim = null;
      this.onAim && this.onAim(null);
    }
  }

  /** Screen position (CSS px) of a world point. */
  screenPos(p) {
    this._v.set(p.x, p.y, p.z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return {
      x: r.left + ((this._v.x + 1) / 2) * r.width,
      y: r.top + ((1 - this._v.y) / 2) * r.height,
      behind: this._v.z > 1,
    };
  }

  _groundPoint(clientX, clientY, planeY) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    this._raycaster.setFromCamera(this._ndc, this.camera);
    this._plane.constant = -planeY;
    const hit = this._raycaster.ray.intersectPlane(this._plane, this._hit);
    return hit ? { x: hit.x, y: hit.y, z: hit.z } : null;
  }

  _down(e) {
    this.audio && this.audio.unlock();
    this.onInteract && this.onInteract();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.canvas.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) {
      // pinch starts: cancel aim/orbit
      this.cancel();
      this.orbitDrag = null;
      const [a, b] = [...this.pointers.values()];
      this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    const wantsOrbit = e.button === 2 || e.button === 1;
    if (!wantsOrbit && this.enabled && this.context && !this.aim) {
      const sp = this.screenPos(this.context.origin);
      const d = Math.hypot(e.clientX - sp.x, e.clientY - sp.y);
      const grab = e.pointerType === 'touch' ? 70 : 54;
      if (!sp.behind && d < grab) {
        this.aim = { pointerId: e.pointerId, dirX: 0, dirZ: -1, power: 0, pull: null };
        this._lastPointer = { x: e.clientX, y: e.clientY };
        this._updateAim(e.clientX, e.clientY);
        return;
      }
    }
    this.orbitDrag = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinchDist > 0 && d > 0) this.rig.zoom(this._pinchDist / d);
      this._pinchDist = d;
      return;
    }
    if (this.aim && this.aim.pointerId === e.pointerId) {
      this._lastPointer = { x: e.clientX, y: e.clientY };
      this._updateAim(e.clientX, e.clientY);
      return;
    }
    if (this.orbitDrag && this.orbitDrag.pointerId === e.pointerId) {
      const dx = e.clientX - this.orbitDrag.lastX;
      const dy = e.clientY - this.orbitDrag.lastY;
      this.orbitDrag.lastX = e.clientX;
      this.orbitDrag.lastY = e.clientY;
      if (!this.rig.topView) this.rig.orbit(-dx * 0.006, dy * 0.005);
    }
  }

  _up(e) {
    this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.aim && this.aim.pointerId === e.pointerId) {
      const a = this.aim;
      this.aim = null;
      if (a.power >= SHOT.minPower && this.enabled) {
        this.onShoot && this.onShoot({ dirX: a.dirX, dirZ: a.dirZ, power: a.power, elevation: this.elevation });
      }
      this.onAim && this.onAim(null);
      return;
    }
    if (this.orbitDrag && this.orbitDrag.pointerId === e.pointerId) this.orbitDrag = null;
  }

  /** Recompute the aim from the current pointer (also when the camera moves). */
  refresh() {
    if (this.aim) this._updateAim(this._lastPointer.x, this._lastPointer.y);
  }

  _updateAim(clientX, clientY) {
    const ctx = this.context;
    if (!ctx || !this.aim) return;
    const origin = ctx.origin;
    const sp = this.screenPos(origin);
    const dxPx = clientX - sp.x;
    const dyPx = clientY - sp.y;
    const distPx = Math.hypot(dxPx, dyPx);
    const power = Math.min(1, distPx / SHOT.fullPowerPixels);
    let dirX = 0;
    let dirZ = 0;
    const pull = this._groundPoint(clientX, clientY, origin.y);
    if (pull && distPx > 2) {
      dirX = origin.x - pull.x;
      dirZ = origin.z - pull.z;
    }
    const len = Math.hypot(dirX, dirZ);
    if (len > 1e-6) {
      dirX /= len;
      dirZ /= len;
    } else {
      // fallback: screen axes mapped onto the ground
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x).negate();
      dirX = -right.x * dxPx + fwd.x * dyPx;
      dirZ = -right.z * dxPx + fwd.z * dyPx;
      const l2 = Math.hypot(dirX, dirZ) || 1;
      dirX /= l2;
      dirZ /= l2;
    }
    this.aim.dirX = dirX;
    this.aim.dirZ = dirZ;
    this.aim.power = distPx < 4 ? 0 : power;
    this.aim.pull = pull;
    this.onAim && this.onAim(this.aim);
  }

  _wheel(e) {
    e.preventDefault();
    if (this.aim && this.context && this.context.kind === 'throw') {
      this.setElevation(this.elevation - Math.sign(e.deltaY) * 2);
      this.refresh();
      return;
    }
    this.rig.zoom(Math.exp(e.deltaY * 0.0012));
  }

  setElevation(deg) {
    this.elevation = Math.max(SHOT.throwAngleMin, Math.min(SHOT.throwAngleMax, Math.round(deg)));
    this.onKey && this.onKey('elevation', this.elevation);
  }

  _key(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    switch (e.key) {
      case 'Escape':
        if (this.aim) {
          this.cancel();
          return;
        }
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        if (this.context && this.context.kind === 'throw') {
          this.setElevation(this.elevation + 1);
          this.refresh();
          e.preventDefault();
          return;
        }
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        if (this.context && this.context.kind === 'throw') {
          this.setElevation(this.elevation - 1);
          this.refresh();
          e.preventDefault();
          return;
        }
        break;
      case 'ArrowLeft':
      case 'q':
      case 'Q':
        if (!this.rig.topView) this.rig.orbit(0.08, 0);
        this.refresh();
        return;
      case 'ArrowRight':
      case 'e':
      case 'E':
        if (!this.rig.topView) this.rig.orbit(-0.08, 0);
        this.refresh();
        return;
      case '+':
      case '=':
        this.rig.zoom(0.85);
        return;
      case '-':
      case '_':
        this.rig.zoom(1.18);
        return;
      default:
        break;
    }
    this.onKey && this.onKey(e.key, e);
  }
}
