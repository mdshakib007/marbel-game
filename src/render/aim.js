// Visual aiming aids: the flick arrow, the slingshot pull band, the lob arc
// with its landing marker, and the pulsing ring under the marble to shoot.

import * as THREE from 'three';
import { FIELD, PHYSICS } from '../config.js';
import { airDragCoefficient } from '../physics.js';

const ARC_DOTS = 72;
const BAND_DOTS = 24;

export class AimGuide {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.time = 0;

    // flick arrow: shaft (box along +x) + a flat triangular head
    this.arrow = new THREE.Group();
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0x7be07b, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
    this.shaft = new THREE.Mesh(new THREE.BoxGeometry(1, 0.002, 0.008), this.arrowMat);
    const tri = new THREE.Shape();
    tri.moveTo(0, -0.016);
    tri.lineTo(0.034, 0);
    tri.lineTo(0, 0.016);
    tri.closePath();
    const headGeo = new THREE.ShapeGeometry(tri);
    headGeo.rotateX(-Math.PI / 2);
    this.head = new THREE.Mesh(headGeo, this.arrowMat);
    this.arrow.add(this.shaft);
    this.arrow.add(this.head);
    this.arrow.renderOrder = 10;
    this.arrow.visible = false;
    scene.add(this.arrow);

    // pull band: a row of small dots from the marble back to the finger
    this.bandDots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false }),
      BAND_DOTS,
    );
    this.bandDots.renderOrder = 10;
    this.bandDots.visible = false;
    this.bandDots.frustumCulled = false;
    scene.add(this.bandDots);

    // lob arc dots
    this.dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }),
      ARC_DOTS,
    );
    this.dots.renderOrder = 10;
    this.dots.visible = false;
    this.dots.frustumCulled = false;
    scene.add(this.dots);
    this._m = new THREE.Matrix4();

    // landing marker
    this.landing = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }),
    );
    this.landing.rotation.x = -Math.PI / 2;
    this.landing.renderOrder = 10;
    this.landing.visible = false;
    scene.add(this.landing);

    // highlight ring under the marble whose turn it is
    this.highlight = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false }),
    );
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.renderOrder = 9;
    this.highlight.visible = false;
    scene.add(this.highlight);
    this._highlightRadius = 0.01;
  }

  setHighlight(pos, radius, colorHex = 0xffffff) {
    this.highlight.visible = true;
    this.highlight.position.set(pos.x, pos.y - radius + 0.0015, pos.z);
    this.highlight.material.color.setHex(colorHex);
    this._highlightRadius = radius;
  }

  clearHighlight() {
    this.highlight.visible = false;
  }

  _powerColor(power) {
    // green -> yellow -> red
    const c = new THREE.Color();
    if (power < 0.5) c.setRGB(0.45 + power * 1.1, 0.88, 0.42);
    else c.setRGB(1, 0.9 - (power - 0.5) * 1.5, 0.35 - (power - 0.5) * 0.5);
    return c;
  }

  showFlick({ origin, dirX, dirZ, power, radius }) {
    const len = 0.035 + 0.3 * power;
    this.arrow.visible = true;
    this.arrow.position.set(origin.x, origin.y - radius + 0.004, origin.z);
    this.arrow.rotation.y = Math.atan2(-dirZ, dirX);
    this.shaft.scale.x = len;
    this.shaft.position.x = radius + len / 2;
    this.head.position.x = radius + len;
    this.arrowMat.color.copy(this._powerColor(power));
    this.dots.visible = false;
    this.landing.visible = false;
  }

  /**
   * Preview of the lob: the ballistic flight (with air drag) up to the first
   * contact with the ground. Returns the predicted landing point.
   */
  showThrow({ origin, dirX, dirZ, power, maxSpeed, elevation, radius }) {
    const speed = power * maxSpeed;
    const el = (elevation * Math.PI) / 180;
    let x = origin.x;
    let y = origin.y;
    let z = origin.z;
    let vx = dirX * speed * Math.cos(el);
    let vy = speed * Math.sin(el);
    let vz = dirZ * speed * Math.cos(el);
    const k = airDragCoefficient(radius);
    const dt = 1 / 240;
    let dist = 0;
    let dotI = 0;
    let nextDot = 0;
    const spacing = 0.05;
    const dotR = 0.0045;
    let landed = null;
    for (let i = 0; i < 2400; i++) {
      const sp = Math.hypot(vx, vy, vz);
      vy -= PHYSICS.gravity * dt;
      const dr = k * sp * dt;
      vx -= vx * dr; vy -= vy * dr; vz -= vz * dr;
      const nx = x + vx * dt;
      const ny = y + vy * dt;
      const nz = z + vz * dt;
      dist += Math.hypot(nx - x, ny - y, nz - z);
      x = nx; y = ny; z = nz;
      if (dist >= nextDot && dotI < ARC_DOTS) {
        this._m.makeScale(dotR, dotR, dotR);
        this._m.setPosition(x, y, z);
        this.dots.setMatrixAt(dotI++, this._m);
        nextDot += spacing;
      }
      const inField = x > FIELD.xMin && x < FIELD.xMax && z > FIELD.zMin && z < FIELD.zMax;
      if (!inField) {
        landed = { x, y, z, out: true };
        break;
      }
      if (y <= this.terrain.height(x, z) + radius) {
        landed = { x, y, z, out: false };
        break;
      }
    }
    for (let i = dotI; i < ARC_DOTS; i++) {
      this._m.makeScale(0, 0, 0);
      this.dots.setMatrixAt(i, this._m);
    }
    this.dots.instanceMatrix.needsUpdate = true;
    this.dots.visible = true;
    this.dots.material.color.copy(this._powerColor(power));
    if (landed) {
      this.landing.visible = true;
      this.landing.position.set(landed.x, this.terrain.height(landed.x, landed.z) + 0.002, landed.z);
      const s = 0.05;
      this.landing.scale.set(s, s, s);
      this.landing.material.color.setHex(landed.out ? 0xff6060 : 0xffe08a);
    } else {
      this.landing.visible = false;
    }
    this.arrow.visible = false;
    return landed;
  }

  showPull(origin, pull) {
    const dist = Math.hypot(pull.x - origin.x, pull.y - origin.y, pull.z - origin.z);
    const spacing = 0.02;
    const n = Math.min(BAND_DOTS, Math.floor(dist / spacing));
    const s = 0.0025;
    for (let i = 0; i < BAND_DOTS; i++) {
      if (i < n) {
        const t = ((i + 1) * spacing) / dist;
        this._m.makeScale(s, s, s);
        this._m.setPosition(origin.x + (pull.x - origin.x) * t, origin.y + (pull.y - origin.y) * t, origin.z + (pull.z - origin.z) * t);
      } else {
        this._m.makeScale(0, 0, 0);
      }
      this.bandDots.setMatrixAt(i, this._m);
    }
    this.bandDots.instanceMatrix.needsUpdate = true;
    this.bandDots.visible = n > 0;
  }

  hide() {
    this.arrow.visible = false;
    this.bandDots.visible = false;
    this.dots.visible = false;
    this.landing.visible = false;
  }

  update(dt) {
    this.time += dt;
    if (this.highlight.visible) {
      const pulse = 1 + 0.12 * Math.sin(this.time * 4);
      const s = this._highlightRadius * 1.9 * pulse;
      this.highlight.scale.set(s, s, s);
      this.highlight.material.opacity = 0.45 + 0.25 * Math.sin(this.time * 4);
    }
    if (this.landing.visible) {
      const s = 0.05 * (1 + 0.1 * Math.sin(this.time * 6));
      this.landing.scale.set(s, s, s);
    }
  }
}
