// Particle effects: dust puffs, hit sparks, glass shards, cave dust.

import * as THREE from 'three';
import { makeSoftCircleTexture } from './textures.js';

const MAX_DUST = 800;

const dustVert = `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (600.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const dustFrag = `
  uniform sampler2D map;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vTint, t.a * vAlpha);
  }
`;

export class Effects {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.time = 0;

    // dust (points)
    this.dustPos = new Float32Array(MAX_DUST * 3);
    this.dustSize = new Float32Array(MAX_DUST);
    this.dustAlpha = new Float32Array(MAX_DUST);
    this.dustTint = new Float32Array(MAX_DUST * 3);
    this.dust = [];
    for (let i = 0; i < MAX_DUST; i++) this.dust.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0.01 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.dustSize, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.dustAlpha, 1));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.dustTint, 3));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeSoftCircleTexture() } },
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.dustPoints = new THREE.Points(geo, this.dustMat);
    this.dustPoints.frustumCulled = false;
    scene.add(this.dustPoints);

    // rings
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 32);

    // shards
    this.shards = [];
    this.shardGeo = new THREE.TetrahedronGeometry(1, 0);
  }

  _spawnDust(x, y, z, vx, vy, vz, life, size, tint) {
    const p = this.dust.find((d) => !d.alive);
    if (!p) return;
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = 0;
    p.maxLife = life;
    p.size = size;
    p.tint = tint;
  }

  /** Dirt kicked up by a landing or a hard roll. strength in [0,1]. */
  dustPuff(x, y, z, strength = 0.5, count = 14) {
    const n = Math.round(count * (0.4 + strength));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.04 + Math.random() * 0.22) * (0.4 + strength);
      this._spawnDust(
        x + (Math.random() - 0.5) * 0.006,
        y,
        z + (Math.random() - 0.5) * 0.006,
        Math.cos(a) * sp,
        (0.05 + Math.random() * 0.25) * (0.4 + strength),
        Math.sin(a) * sp,
        0.35 + Math.random() * 0.55,
        (0.008 + Math.random() * 0.018) * (0.6 + strength),
        [0.72 + Math.random() * 0.1, 0.6 + Math.random() * 0.08, 0.44 + Math.random() * 0.08],
      );
    }
  }

  /** A quick bright flash ring at a marble contact. */
  hitSpark(x, y, z, strength = 0.5) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(this.ringGeo, mat);
    ring.position.set(x, y, z);
    ring.rotation.x = -Math.PI / 2;
    const s0 = 0.004;
    ring.scale.setScalar(s0);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, dur: 0.22 + 0.15 * strength, s0, s1: 0.012 + 0.035 * strength });
    for (let i = 0; i < 6 + Math.round(10 * strength); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.1 + Math.random() * 0.3 * (0.5 + strength);
      this._spawnDust(x, y, z, Math.cos(a) * sp, 0.05 + Math.random() * 0.2, Math.sin(a) * sp, 0.2 + Math.random() * 0.25, 0.004 + Math.random() * 0.006, [1, 0.95, 0.8]);
    }
  }

  caveDust(x, y, z) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this._spawnDust(x + Math.cos(a) * 0.02, y, z + Math.sin(a) * 0.02, Math.cos(a) * 0.06, 0.08 + Math.random() * 0.1, Math.sin(a) * 0.06, 0.5 + Math.random() * 0.3, 0.012, [0.6, 0.5, 0.38]);
    }
  }

  /** The marble explodes into glass shards. */
  shatter(x, y, z, colorHex, radius) {
    const n = 22;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshPhysicalMaterial({
        color: colorHex,
        roughness: 0.1,
        clearcoat: 1,
        transparent: true,
        opacity: 0.95,
        transmission: 0.3,
      });
      const m = new THREE.Mesh(this.shardGeo, mat);
      const s = radius * (0.18 + Math.random() * 0.3);
      m.scale.set(s, s * (0.5 + Math.random()), s);
      m.position.set(x, y, z);
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      m.castShadow = true;
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * 1.2;
      const sp = 0.4 + Math.random() * 1.1;
      this.shards.push({
        mesh: m,
        vx: Math.cos(a) * Math.cos(el) * sp,
        vy: Math.sin(el) * sp + 0.3,
        vz: Math.sin(a) * Math.cos(el) * sp,
        rx: (Math.random() - 0.5) * 30,
        ry: (Math.random() - 0.5) * 30,
        t: 0,
        life: 1.6 + Math.random() * 0.8,
        bounced: 0,
      });
    }
    this.dustPuff(x, y, z, 1, 30);
    this.hitSpark(x, y, z, 1);
  }

  update(dt) {
    this.time += dt;
    // dust
    let any = false;
    for (let i = 0; i < MAX_DUST; i++) {
      const p = this.dust[i];
      if (!p.alive) {
        this.dustAlpha[i] = 0;
        continue;
      }
      any = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        this.dustAlpha[i] = 0;
        continue;
      }
      p.vy -= 1.2 * dt; // dust is light: falls slowly
      p.vx *= 1 - 2.5 * dt;
      p.vz *= 1 - 2.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const ground = this.terrain.height(p.x, p.z);
      if (p.y < ground + 0.001) {
        p.y = ground + 0.001;
        p.vy = 0;
      }
      const k = p.life / p.maxLife;
      this.dustPos[i * 3] = p.x;
      this.dustPos[i * 3 + 1] = p.y;
      this.dustPos[i * 3 + 2] = p.z;
      this.dustSize[i] = p.size * (1 + k * 1.5);
      this.dustAlpha[i] = (1 - k) * 0.75;
      this.dustTint[i * 3] = p.tint[0];
      this.dustTint[i * 3 + 1] = p.tint[1];
      this.dustTint[i * 3 + 2] = p.tint[2];
    }
    const g = this.dustPoints.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
    this.dustPoints.visible = any;

    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const s = r.s0 + (r.s1 - r.s0) * Math.sqrt(k);
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    // shards
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.t += dt;
      s.vy -= 9.81 * dt;
      const m = s.mesh;
      m.position.x += s.vx * dt;
      m.position.y += s.vy * dt;
      m.position.z += s.vz * dt;
      m.rotation.x += s.rx * dt;
      m.rotation.y += s.ry * dt;
      const ground = this.terrain.height(m.position.x, m.position.z) + m.scale.x * 0.5;
      if (m.position.y < ground) {
        m.position.y = ground;
        if (s.vy < 0) s.vy = -s.vy * 0.35;
        s.vx *= 0.6;
        s.vz *= 0.6;
        s.rx *= 0.5;
        s.ry *= 0.5;
        s.bounced++;
      }
      if (s.t > s.life - 0.5) m.material.opacity = Math.max(0, (s.life - s.t) / 0.5);
      if (s.t >= s.life) {
        this.scene.remove(m);
        m.material.dispose();
        this.shards.splice(i, 1);
      }
    }
  }
}
