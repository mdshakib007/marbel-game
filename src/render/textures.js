// Procedural textures drawn on canvases at start-up: no image assets needed.

import * as THREE from 'three';
import { createRng, fbm2, valueNoise2 } from '../noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { color = true, repeat = null } = {}) {
  const tex = new THREE.CanvasTexture(c);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (repeat) tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Packed dirt: warm brown with grain, pebbles and darker damp patches. */
export function makeDirtTexture(size = 512, seed = 3) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rng = createRng(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // tileable by sampling noise on a torus-ish trick: use wrapped coords
      const n1 = fbm2(u * 8, v * 8, seed, 4, 2, 0.5);
      const n2 = fbm2(u * 32 + 5, v * 32 + 5, seed + 11, 3, 2, 0.55);
      const grain = (rng() - 0.5) * 0.18;
      const r = 0.58 + n1 * 0.05 + n2 * 0.04 + grain;
      const g = 0.44 + n1 * 0.045 + n2 * 0.035 + grain * 0.9;
      const b = 0.30 + n1 * 0.03 + n2 * 0.025 + grain * 0.7;
      const i = (y * size + x) * 4;
      d[i] = clamp01(r) * 255;
      d[i + 1] = clamp01(g) * 255;
      d[i + 2] = clamp01(b) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // pebbles
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < size * 0.22; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const rad = 0.6 + rng() * 1.8;
    const shade = 95 + rng() * 75;
    ctx.fillStyle = `rgb(${shade + 10},${shade - 5},${shade - 25})`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return finish(c);
}

/** Tangent-space normal map for the dirt grain (fine, subtle). */
export function makeDirtNormalMap(size = 512, seed = 3, strength = 1.6) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const h = new Float32Array(size * size);
  const rng = createRng(seed + 99);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      h[y * size + x] = fbm2(u * 40, v * 40, seed + 5, 4, 2, 0.5) * 0.6 + (rng() - 0.5) * 0.25;
    }
  }
  // pebble bumps
  for (let i = 0; i < size * 0.35; i++) {
    const cx = rng() * size;
    const cy = rng() * size;
    const rad = 1 + rng() * 2.5;
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dd = dx * dx + dy * dy;
        if (dd < rad * rad) {
          const xx = ((x % size) + size) % size;
          const yy = ((y % size) + size) % size;
          h[yy * size + xx] += Math.sqrt(1 - dd / (rad * rad)) * 0.9;
        }
      }
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const dn = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (u - dn) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, { color: false });
}

/** Old red bricks with pale mortar. */
export function makeBrickTexture(size = 512, seed = 8) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const rng = createRng(seed);
  ctx.fillStyle = '#b9ab93';
  ctx.fillRect(0, 0, size, size);
  const rows = 8;
  const cols = 4;
  const bh = size / rows;
  const bw = size / cols;
  const gap = size * 0.012;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? bw / 2 : 0;
    for (let k = -1; k <= cols; k++) {
      const x = k * bw + off;
      const y = r * bh;
      const tone = 0.85 + rng() * 0.3;
      const rr = Math.round(160 * tone);
      const gg = Math.round(78 * tone);
      const bb = Math.round(58 * tone);
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.fillRect(x + gap, y + gap, bw - gap * 2, bh - gap * 2);
      // weathering speckles
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 25; i++) {
        ctx.fillRect(x + gap + rng() * (bw - gap * 2), y + gap + rng() * (bh - gap * 2), 1.5, 1.5);
      }
    }
  }
  return finish(c);
}

/** Patchy lawn beyond the walls. */
export function makeGrassTexture(size = 512, seed = 21) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rng = createRng(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm2(u * 6, v * 6, seed, 4, 2, 0.5);
      const n2 = valueNoise2(u * 90, v * 90, seed + 3);
      const grain = (rng() - 0.5) * 0.12;
      const dry = clamp01((fbm2(u * 2.5 + 3, v * 2.5 + 3, seed + 7, 3) - 0.1) * 1.5);
      let r = 0.30 + n * 0.08 + n2 * 0.05 + grain + dry * 0.22;
      let g = 0.47 + n * 0.1 + n2 * 0.06 + grain + dry * 0.1;
      let b = 0.18 + n * 0.04 + n2 * 0.02 + grain * 0.6;
      const i = (y * size + x) * 4;
      d[i] = clamp01(r) * 255;
      d[i + 1] = clamp01(g) * 255;
      d[i + 2] = clamp01(b) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c);
}

function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Twisted colour bands for an opaque swirl marble (equirectangular). */
export function makeSwirlTexture(hex, seed = 1, w = 512, h = 256) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const base = hexToRgb(hex);
  const white = [245, 240, 232];
  const dark = mix(base, [20, 15, 25], 0.55);
  const rng = createRng(seed);
  const phase = rng() * 6.28;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const twist = Math.sin(v * Math.PI) * 2.2;
      const band = Math.sin((u * 3 + twist * 0.6 + v * 1.3) * Math.PI * 2 + phase + fbm2(u * 4, v * 4, seed, 3) * 1.6);
      const t = band * 0.5 + 0.5;
      let col;
      if (t < 0.35) col = mix(dark, base, t / 0.35);
      else if (t < 0.7) col = mix(base, white, (t - 0.35) / 0.35);
      else col = mix(white, base, (t - 0.7) / 0.3);
      const i = (y * w + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finish(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/**
 * The computer's marble: deep black glass with two bold white bands that
 * wrap around it on a slant, so it reads as black-and-white from any side.
 */
export function makeBotTexture(seed = 5, w = 512, h = 256) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const black = [12, 12, 14];
  const white = [248, 248, 246];
  const rng = createRng(seed);
  const phase = rng() * 6.28;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      // two bands per turn, slanted, with a touch of wobble
      const band = Math.sin((u * 2 + v * 1.1) * Math.PI * 2 + phase + fbm2(u * 3, v * 3, seed, 2) * 0.5);
      const edge = 0.35;
      const t = Math.min(1, Math.max(0, (band - edge) / 0.12));
      const col = mix(black, white, t);
      const i = (y * w + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finish(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Dark glass with glitter specks and a faint nebula (equirectangular). */
export function makeGalaxyTexture(hex, seed = 2, w = 512, h = 256) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const base = hexToRgb(hex);
  const rng = createRng(seed);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const neb = clamp01(fbm2(u * 5, v * 5, seed, 4) * 0.8 + 0.2);
      const col = mix([8, 8, 18], mix(base, [60, 40, 90], 0.3), neb * 0.55);
      const i = (y * w + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // glitter
  for (let i = 0; i < 900; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = 0.5 + rng() * 1.8;
    const a = 0.5 + rng() * 0.5;
    const tint = rng();
    ctx.fillStyle = tint < 0.6 ? `rgba(255,250,220,${a})` : tint < 0.8 ? `rgba(${base[0]},${base[1]},${base[2]},${a})` : `rgba(200,230,255,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = finish(c);
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Milky white with soft pastel veins (equirectangular). */
export function makeOpalTexture(hex, seed = 4, w = 512, h = 256) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const base = hexToRgb(hex);
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const n = fbm2(u * 6, v * 6, seed, 4) * 0.5 + 0.5;
      const n2 = fbm2(u * 14 + 7, v * 14 + 7, seed + 9, 3) * 0.5 + 0.5;
      const veins = clamp01((n - 0.35) * 1.8) * 0.8 + clamp01((n2 - 0.55) * 3) * 0.5;
      const col = mix([248, 246, 242], mix(base, [255, 255, 255], 0.2), clamp01(veins));
      const i = (y * w + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = finish(c);
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Soft radial sprite for dust particles. */
export function makeSoftCircleTexture(size = 64) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
