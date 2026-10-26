// Marble visuals: a glass shell (MeshPhysicalMaterial with transmission for
// the see-through styles) plus style-specific innards, and a mini-map marker.

import * as THREE from 'three';
import { MARBLE_COLORS } from '../config.js';
import { makeGalaxyTexture, makeOpalTexture, makeSwirlTexture } from './textures.js';
import { makeMinimapMarker } from './scene.js';

const textureCache = new Map();

function cachedTexture(key, make) {
  if (!textureCache.has(key)) textureCache.set(key, make());
  return textureCache.get(key);
}

export class MarbleView {
  constructor({ radius, style = 'catseye', color = 'blue', seed = 1 }) {
    this.radius = radius;
    this.style = style;
    this.colorKey = color;
    this.colorHex = (MARBLE_COLORS[color] || MARBLE_COLORS.blue).hex;
    this.group = new THREE.Group();
    this.group.name = `marble-${style}-${color}`;
    this._axis = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.visible = true;

    const r = radius;
    const geo = new THREE.SphereGeometry(r, 48, 32);
    const col = new THREE.Color(this.colorHex);
    let mat;
    switch (style) {
      case 'clear': {
        mat = new THREE.MeshPhysicalMaterial({
          color: col.clone().lerp(new THREE.Color(0xffffff), 0.55),
          transmission: 1,
          thickness: r * 1.2,
          roughness: 0.03,
          ior: 1.5,
          attenuationColor: col.clone().lerp(new THREE.Color(0xffffff), 0.25),
          attenuationDistance: r * 5,
          specularIntensity: 1,
          envMapIntensity: 1.2,
        });
        break;
      }
      case 'swirl': {
        const tex = cachedTexture(`swirl-${color}`, () => makeSwirlTexture(this.colorHex, seed));
        mat = new THREE.MeshPhysicalMaterial({
          map: tex,
          roughness: 0.28,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          envMapIntensity: 1.1,
        });
        break;
      }
      case 'galaxy': {
        const tex = cachedTexture(`galaxy-${color}`, () => makeGalaxyTexture(this.colorHex, seed + 2));
        mat = new THREE.MeshPhysicalMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: new THREE.Color(0x404040),
          roughness: 0.12,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          envMapIntensity: 1.2,
        });
        break;
      }
      case 'opal': {
        const tex = cachedTexture(`opal-${color}`, () => makeOpalTexture(this.colorHex, seed + 4));
        mat = new THREE.MeshPhysicalMaterial({
          map: tex,
          roughness: 0.22,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
          iridescence: 1,
          iridescenceIOR: 1.45,
          iridescenceThicknessRange: [200, 700],
          sheen: 0.5,
          sheenColor: new THREE.Color(this.colorHex),
          envMapIntensity: 1.1,
        });
        break;
      }
      case 'catseye':
      default: {
        mat = new THREE.MeshPhysicalMaterial({
          color: 0xffffff,
          transmission: 1,
          thickness: r * 1.0,
          roughness: 0.02,
          ior: 1.5,
          attenuationColor: new THREE.Color(0xf6f9ff),
          attenuationDistance: r * 12,
          specularIntensity: 1,
          envMapIntensity: 1.2,
        });
        // three thin coloured vanes meeting along one axis: the 'eye'
        const vaneMat = new THREE.MeshPhysicalMaterial({
          color: col,
          emissive: col.clone().multiplyScalar(0.15),
          roughness: 0.45,
          clearcoat: 0.6,
        });
        const vaneGeo = new THREE.SphereGeometry(1, 24, 12);
        const eye = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const vane = new THREE.Mesh(vaneGeo, vaneMat);
          vane.scale.set(r * 0.68, r * 0.62, r * 0.085);
          vane.rotation.y = (i * Math.PI) / 3;
          eye.add(vane);
        }
        eye.rotation.z = 0.5;
        eye.rotation.x = 0.3;
        this.group.add(eye);
        break;
      }
    }
    this.shell = new THREE.Mesh(geo, mat);
    this.shell.castShadow = true;
    this.shell.receiveShadow = false;
    this.group.add(this.shell);

    // A fake contact shadow helps the marble read as 'on the ground' under
    // soft lighting (the real shadow map adds the directional one).
    this.marker = makeMinimapMarker(this.colorHex);
  }

  addTo(scene) {
    scene.add(this.group);
    scene.add(this.marker);
  }

  removeFrom(scene) {
    scene.remove(this.group);
    scene.remove(this.marker);
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
    this.marker.visible = v;
  }

  /** Follow the physics marble: position and rolling rotation. */
  syncFromPhysics(m, dt) {
    this.group.position.set(m.x, m.y, m.z);
    const w = Math.hypot(m.wx, m.wy, m.wz);
    if (w > 1e-6 && dt > 0) {
      this._axis.set(m.wx / w, m.wy / w, m.wz / w);
      this._q.setFromAxisAngle(this._axis, w * dt);
      this.group.quaternion.premultiply(this._q);
    }
    this.marker.position.set(m.x, 0.3, m.z);
  }

  setPosition(x, y, z) {
    this.group.position.set(x, y, z);
    this.marker.position.set(x, 0.3, z);
  }

  spin(dt, rate = 1.2) {
    this.group.rotation.y += rate * dt;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
