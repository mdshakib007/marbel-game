// The playing surface: a gently uneven patch of packed dirt with a round
// cave scooped into it. The base bumps are baked into a fine grid at start-up
// (cheap bilinear lookups during simulation); the cave bowl is analytic so
// its steep walls are exact.
//
// Marbles are not points: a marble of radius r rolls on the "offset surface"
// S_r(x,z) = max over the disc |p-c|<=r of h(p) + sqrt(r^2 - |p-c|^2).
// We approximate that maximum with 17 samples (centre + two rings). On gentle
// ground the centre sample wins and S_r = h + r exactly; inside the cave the
// ring samples keep a big marble from sinking into a hole narrower than itself.

import { CAVE, FIELD } from './config.js';
import { fbm2 } from './noise.js';

const GRID_MARGIN = 0.12;
const RING_DIRS = 8;
const RING_COS = [];
const RING_SIN = [];
for (let i = 0; i < RING_DIRS; i++) {
  const a = (i / RING_DIRS) * Math.PI * 2;
  RING_COS.push(Math.cos(a));
  RING_SIN.push(Math.sin(a));
}
const RING_RADII = [0.72, 0.97];

export class Terrain {
  /**
   * @param {object} opts
   * @param {number} opts.seed   integer seed for the bumps
   * @param {number} [opts.cell] grid cell size in metres
   * @param {number} [opts.bumpAmplitude]
   * @param {number} [opts.grainAmplitude]
   */
  constructor({ seed = 1, cell = 0.004, bumpAmplitude = 0.0055, grainAmplitude = 0.0005 } = {}) {
    this.seed = seed >>> 0;
    this.cell = cell;
    this.bumpAmplitude = bumpAmplitude;
    this.grainAmplitude = grainAmplitude;
    this.cave = CAVE;
    this.field = FIELD;

    this.x0 = FIELD.xMin - GRID_MARGIN;
    this.z0 = FIELD.zMin - GRID_MARGIN;
    this.nx = Math.ceil((FIELD.xMax - FIELD.xMin + 2 * GRID_MARGIN) / cell) + 1;
    this.nz = Math.ceil((FIELD.zMax - FIELD.zMin + 2 * GRID_MARGIN) / cell) + 1;
    this.grid = new Float32Array(this.nx * this.nz);
    this._bake();
    this._tmp = { h: 0, gx: 0, gz: 0 };
  }

  /** The smooth base surface (bumps + wear dish), without the cave hole. */
  rawBase(x, z) {
    const seed = this.seed;
    const dx = x - CAVE.x;
    const dz = z - CAVE.z;
    const d = Math.sqrt(dx * dx + dz * dz);

    // Broad undulations of the yard.
    let bumps = this.bumpAmplitude * fbm2(x / 0.75, z / 0.75, seed, 3, 2.0, 0.45);
    // Fine grain: pebbles and footprints.
    const grain = this.grainAmplitude * fbm2(x / 0.07, z / 0.07, seed + 7, 2, 2.0, 0.5);
    // The ground near the cave is worn smoother by years of play.
    const wear = smoothstep(Math.min(1, d / 0.35));
    bumps *= 0.45 + 0.55 * wear;

    // Shallow dish around the cave.
    const t = Math.min(1, d / CAVE.dishRadius);
    const dish = -CAVE.dishDepth * (1 - t) * (1 - t) * (1 + 2 * t);

    return bumps + grain + dish;
  }

  _bake() {
    const { nx, nz, cell, x0, z0, grid } = this;
    for (let j = 0; j < nz; j++) {
      const z = z0 + j * cell;
      for (let i = 0; i < nx; i++) {
        grid[j * nx + i] = this.rawBase(x0 + i * cell, z);
      }
    }
  }

  /** Bilinear base height and its gradient at (x, z). Writes into out. */
  baseAt(x, z, out) {
    const { nx, nz, cell, x0, z0, grid } = this;
    let fx = (x - x0) / cell;
    let fz = (z - z0) / cell;
    if (fx < 0) fx = 0;
    else if (fx > nx - 1.000001) fx = nx - 1.000001;
    if (fz < 0) fz = 0;
    else if (fz > nz - 1.000001) fz = nz - 1.000001;
    const i = fx | 0;
    const j = fz | 0;
    const u = fx - i;
    const w = fz - j;
    const idx = j * nx + i;
    const a = grid[idx];
    const b = grid[idx + 1];
    const c = grid[idx + nx];
    const d = grid[idx + nx + 1];
    out.h = (1 - u) * (1 - w) * a + u * (1 - w) * b + (1 - u) * w * c + u * w * d;
    out.gx = ((1 - w) * (b - a) + w * (d - c)) / cell;
    out.gz = ((1 - u) * (c - a) + u * (d - b)) / cell;
    return out;
  }

  /** Depth of the cave bowl (>= 0) at a point. 0 outside the cave. */
  caveDepth(x, z) {
    const dx = x - CAVE.x;
    const dz = z - CAVE.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= CAVE.radius) return 0;
    return CAVE.depth * 0.5 * (1 + Math.cos((Math.PI * d) / CAVE.radius));
  }

  /** Ground height (the visible surface) and gradient at (x, z). */
  heightAt(x, z, out = this._tmp) {
    this.baseAt(x, z, out);
    const dx = x - CAVE.x;
    const dz = z - CAVE.z;
    const d2 = dx * dx + dz * dz;
    const R = CAVE.radius;
    if (d2 < R * R) {
      const d = Math.sqrt(d2);
      const D = CAVE.depth;
      const depth = D * 0.5 * (1 + Math.cos((Math.PI * d) / R));
      out.h -= depth;
      if (d > 1e-9) {
        // d(depth)/dd = -(D*pi/(2R)) sin(pi d / R); h = base - depth
        const dd = ((D * Math.PI) / (2 * R)) * Math.sin((Math.PI * d) / R);
        out.gx += (dd * dx) / d;
        out.gz += (dd * dz) / d;
      }
    }
    return out;
  }

  height(x, z) {
    return this.heightAt(x, z, this._tmp).h;
  }

  /**
   * Height (and gradient) of the surface the CENTRE of a marble of radius r
   * rolls on. Writes {h, gx, gz} into out.
   */
  surfaceForRadius(x, z, r, out) {
    const tmp = this._tmp;
    this.heightAt(x, z, tmp);
    let best = tmp.h + r;
    let gx = tmp.gx;
    let gz = tmp.gz;
    // Only bother with the rings near the cave; elsewhere the centre wins.
    const dx = x - CAVE.x;
    const dz = z - CAVE.z;
    const reach = CAVE.radius + r;
    if (dx * dx + dz * dz < reach * reach) {
      for (let k = 0; k < RING_RADII.length; k++) {
        const rho = RING_RADII[k] * r;
        const lift = Math.sqrt(r * r - rho * rho);
        for (let i = 0; i < RING_DIRS; i++) {
          this.heightAt(x + rho * RING_COS[i], z + rho * RING_SIN[i], tmp);
          const s = tmp.h + lift;
          if (s > best) {
            best = s;
            gx = tmp.gx;
            gz = tmp.gz;
          }
        }
      }
    }
    out.h = best;
    out.gx = gx;
    out.gz = gz;
    return out;
  }

  /** True when a point lies inside the cave's bowl deeper than `fraction` of its depth. */
  isInCave(x, z, fraction = 0.3) {
    return this.caveDepth(x, z) > CAVE.depth * fraction;
  }

  /** Height of the ground at the cave centre if there were no hole (the rim level). */
  caveRimHeight() {
    return this.baseAt(CAVE.x, CAVE.z, this._tmp).h;
  }

  /** Largest base slope (|grad|) anywhere outside the cave – used by tests. */
  maxBaseSlope() {
    const out = { h: 0, gx: 0, gz: 0 };
    let worst = 0;
    const step = this.cell * 2;
    for (let z = FIELD.zMin; z <= FIELD.zMax; z += step) {
      for (let x = FIELD.xMin; x <= FIELD.xMax; x += step) {
        this.baseAt(x, z, out);
        const g = Math.hypot(out.gx, out.gz);
        if (g > worst) worst = g;
      }
    }
    return worst;
  }
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
