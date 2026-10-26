// Marble physics: rigid glass spheres with mass, linear velocity and spin,
// rolling/sliding on an uneven dirt surface under gravity.
//
// Per fixed substep (1/480 s):
//   1. forces      – gravity, air drag (quadratic), rolling resistance
//   2. collisions  – swept sphere/sphere test, impulse with restitution + friction
//   3. ground      – project onto the marble's offset surface; bounce on hard
//                    impacts (restitution + impact friction + dirt plowing),
//                    otherwise roll: slip -> kinetic friction spins the marble
//                    up until it rolls without slipping; pure rolling on a
//                    slope accelerates at 5/7 g sin(theta) (solid sphere)
//   4. walls       – the brick border around the yard
//   5. sleep       – a slow marble on a slope flatter than the static friction
//                    angle (or wedged against something) comes to rest
//
// Everything is deterministic so the computer player can plan by simulating
// the exact same code.

import { FIELD, GLASS_DENSITY, PHYSICS } from './config.js';

export function marbleMass(r) {
  return (4 / 3) * Math.PI * r * r * r * GLASS_DENSITY;
}

/** Quadratic air drag coefficient (1/m) for a glass sphere of radius r. */
export function airDragCoefficient(r) {
  const rhoAir = 1.2;
  const cd = 0.47;
  return (0.5 * rhoAir * cd * 3) / (4 * r * GLASS_DENSITY);
}

let nextMarbleId = 1;

export function createMarble({ id, radius, x = 0, y = 0, z = 0 } = {}) {
  const r = radius;
  const m = marbleMass(r);
  return {
    id: id ?? nextMarbleId++,
    r,
    m,
    inertia: 0.4 * m * r * r,
    drag: airDragCoefficient(r),
    x, y, z,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,
    grounded: false,
    asleep: true,
    /** false while the marble is in a player's hand or broken. */
    active: true,
    lowSpeedTime: 0,
    airTime: 0,
    /** Contact normal from the last ground contact (for sound/visuals). */
    nx: 0, ny: 1, nz: 0,
    slip: 0,
  };
}

export class World {
  constructor(terrain, params = {}) {
    this.terrain = terrain;
    this.params = { ...PHYSICS, ...params };
    this.marbles = [];
    this.time = 0;
    this._acc = 0;
    this._s = { h: 0, gx: 0, gz: 0 };
  }

  addMarble(m) {
    this.marbles.push(m);
    return m;
  }

  removeMarble(m) {
    const i = this.marbles.indexOf(m);
    if (i >= 0) this.marbles.splice(i, 1);
  }

  /** Put a marble at rest on the ground at (x, z). */
  placeOnGround(m, x, z) {
    this.terrain.surfaceForRadius(x, z, m.r, this._s);
    m.x = x;
    m.z = z;
    m.y = this._s.h;
    m.vx = m.vy = m.vz = 0;
    m.wx = m.wy = m.wz = 0;
    m.grounded = true;
    m.asleep = true;
    m.active = true;
    m.lowSpeedTime = 0;
    m.airTime = 0;
    this.wakeNear(x, z, 0.06, m);
  }

  /** Give a marble a velocity (and optionally a position in the air). */
  launch(m, vx, vy, vz, pos = null) {
    if (pos) {
      m.x = pos.x;
      m.y = pos.y;
      m.z = pos.z;
    }
    m.vx = vx;
    m.vy = vy;
    m.vz = vz;
    m.wx = m.wy = m.wz = 0;
    m.active = true;
    m.asleep = false;
    m.lowSpeedTime = 0;
    m.grounded = vy <= 0 && pos === null ? m.grounded : false;
  }

  wake(m) {
    if (!m.active) return;
    m.asleep = false;
    m.lowSpeedTime = 0;
  }

  /** Wake sleeping marbles near a point (something next to them moved). */
  wakeNear(x, z, dist, except = null) {
    for (const o of this.marbles) {
      if (o === except || !o.active) continue;
      const dx = o.x - x;
      const dz = o.z - z;
      if (dx * dx + dz * dz < dist * dist) this.wake(o);
    }
  }

  allAtRest() {
    for (const m of this.marbles) if (m.active && !m.asleep) return false;
    return true;
  }

  /** Advance by a variable frame time using fixed substeps. */
  step(dt, events = []) {
    const h = this.params.substep;
    this._acc += dt;
    let n = 0;
    while (this._acc >= h && n < 64) {
      this.substep(h, events);
      this._acc -= h;
      n++;
    }
    if (n === 64) this._acc = 0;
    return events;
  }

  substep(dt, events) {
    const ms = this.marbles;
    const g = this.params.gravity;

    // 1. forces -> velocities
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (!m.active || m.asleep) continue;
      m.vy -= g * dt;
      const sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy + m.vz * m.vz);
      if (sp > 1e-6) {
        const k = m.drag * sp * dt;
        m.vx -= m.vx * k;
        m.vy -= m.vy * k;
        m.vz -= m.vz * k;
      }
    }

    // 2. swept marble/marble collisions, then move
    let remaining = dt;
    for (let iter = 0; iter < 4 && remaining > 0; iter++) {
      let bestT = remaining;
      let ia = -1;
      let ib = -1;
      for (let i = 0; i < ms.length; i++) {
        const a = ms[i];
        if (!a.active) continue;
        for (let j = i + 1; j < ms.length; j++) {
          const b = ms[j];
          if (!b.active || (a.asleep && b.asleep)) continue;
          const t = timeOfImpact(a, b, bestT);
          if (t >= 0 && t < bestT) {
            bestT = t;
            ia = i;
            ib = j;
          }
        }
      }
      this._move(bestT);
      remaining -= bestT;
      if (ia < 0) break;
      this._resolveMarbleCollision(ms[ia], ms[ib], events);
    }

    // 3-5. ground, walls, sleep
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (!m.active || m.asleep) continue;
      this._walls(m, events);
      this._groundContact(m, dt, events);
      this._sleepCheck(m, dt);
    }
    this.time += dt;
  }

  _move(t) {
    if (t <= 0) return;
    const ms = this.marbles;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i];
      if (!m.active || m.asleep) continue;
      m.x += m.vx * t;
      m.y += m.vy * t;
      m.z += m.vz * t;
    }
  }

  _resolveMarbleCollision(a, b, events) {
    const P = this.params;
    let nx = b.x - a.x;
    let ny = b.y - a.y;
    let nz = b.z - a.z;
    let dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (dist < 1e-9) {
      nx = 1; ny = 0; nz = 0; dist = 1e-9;
    }
    nx /= dist; ny /= dist; nz /= dist;

    // Separate any residual overlap (weighted by inverse mass).
    const overlap = a.r + b.r - dist;
    if (overlap > 0) {
      const invA = 1 / a.m;
      const invB = 1 / b.m;
      const s = overlap / (invA + invB);
      a.x -= nx * s * invA; a.y -= ny * s * invA; a.z -= nz * s * invA;
      b.x += nx * s * invB; b.y += ny * s * invB; b.z += nz * s * invB;
    }

    const rvx = a.vx - b.vx;
    const rvy = a.vy - b.vy;
    const rvz = a.vz - b.vz;
    const vn = rvx * nx + rvy * ny + rvz * nz; // > 0 : approaching
    if (vn <= 0) return;

    const e = vn < 0.05 ? 0 : P.marbleRestitution;
    const invMass = 1 / a.m + 1 / b.m;
    const j = ((1 + e) * vn) / invMass;
    a.vx -= (j / a.m) * nx; a.vy -= (j / a.m) * ny; a.vz -= (j / a.m) * nz;
    b.vx += (j / b.m) * nx; b.vy += (j / b.m) * ny; b.vz += (j / b.m) * nz;

    // Tangential friction impulse (glass on glass is slippery) including spin.
    // Contact point velocity: v + w x r_vec, r_vec = n*r for a, -n*r for b.
    const cax = a.vx + (a.wy * nz - a.wz * ny) * a.r;
    const cay = a.vy + (a.wz * nx - a.wx * nz) * a.r;
    const caz = a.vz + (a.wx * ny - a.wy * nx) * a.r;
    const cbx = b.vx - (b.wy * nz - b.wz * ny) * b.r;
    const cby = b.vy - (b.wz * nx - b.wx * nz) * b.r;
    const cbz = b.vz - (b.wx * ny - b.wy * nx) * b.r;
    let tx = cax - cbx;
    let ty = cay - cby;
    let tz = caz - cbz;
    const tn = tx * nx + ty * ny + tz * nz;
    tx -= tn * nx; ty -= tn * ny; tz -= tn * nz;
    const slip = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (slip > 1e-6) {
      tx /= slip; ty /= slip; tz /= slip;
      // Effective mass for a tangential impulse at the contact of two spheres.
      const kt = invMass + (a.r * a.r) / a.inertia + (b.r * b.r) / b.inertia;
      const jt = Math.min(P.marbleFriction * j, slip / kt);
      a.vx -= (jt / a.m) * tx; a.vy -= (jt / a.m) * ty; a.vz -= (jt / a.m) * tz;
      b.vx += (jt / b.m) * tx; b.vy += (jt / b.m) * ty; b.vz += (jt / b.m) * tz;
      // torque: r_vec x (-jt t) for a, (-r n) x (jt t) for b
      const ra = (a.r * jt) / a.inertia;
      a.wx -= ra * (ny * tz - nz * ty);
      a.wy -= ra * (nz * tx - nx * tz);
      a.wz -= ra * (nx * ty - ny * tx);
      const rb = (b.r * jt) / b.inertia;
      b.wx -= rb * (ny * tz - nz * ty);
      b.wy -= rb * (nz * tx - nx * tz);
      b.wz -= rb * (nx * ty - ny * tx);
    }

    // Resting contact (two marbles leaning on each other in the cave) must
    // not keep resetting the sleep timers, or they never come to rest.
    if (vn > 0.02) {
      this.wake(a);
      this.wake(b);
    } else {
      a.asleep = false;
      b.asleep = false;
      return;
    }
    events.push({
      type: 'hit',
      a, b,
      speed: vn,
      impulse: j,
      x: a.x + nx * a.r,
      y: a.y + ny * a.r,
      z: a.z + nz * a.r,
      time: this.time,
    });
  }

  _groundContact(m, dt, events) {
    const P = this.params;
    const g = P.gravity;
    const s = this.terrain.surfaceForRadius(m.x, m.z, m.r, this._s);
    // Surface normal from the gradient.
    let nx = -s.gx;
    let ny = 1;
    let nz = -s.gz;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= nl; ny /= nl; nz /= nl;

    if (m.y > s.h + 1e-5) {
      // Airborne.
      m.grounded = false;
      m.airTime += dt;
      m.slip = 0;
      return;
    }

    m.y = s.h;
    m.nx = nx; m.ny = ny; m.nz = nz;
    const vn = m.vx * nx + m.vy * ny + m.vz * nz;

    if (vn < -P.bounceThreshold) {
      // Hard impact: bounce with restitution, impact friction, dirt plowing.
      const jn = -(1 + P.groundRestitution) * vn * m.m;
      m.vx += (jn / m.m) * nx; m.vy += (jn / m.m) * ny; m.vz += (jn / m.m) * nz;
      this._contactFriction(m, nx, ny, nz, P.impactFriction * jn);
      // Plowing: the marble digs into the dirt and loses tangential speed.
      const loss = 1 / (1 + P.plowFactor * -vn);
      const tvx = m.vx - (m.vx * nx + m.vy * ny + m.vz * nz) * nx;
      const tvy = m.vy - (m.vx * nx + m.vy * ny + m.vz * nz) * ny;
      const tvz = m.vz - (m.vx * nx + m.vy * ny + m.vz * nz) * nz;
      m.vx -= tvx * (1 - loss); m.vy -= tvy * (1 - loss); m.vz -= tvz * (1 - loss);
      m.grounded = false;
      events.push({ type: 'land', marble: m, speed: -vn, airTime: m.airTime, x: m.x, y: m.y, z: m.z, time: this.time });
      m.airTime = 0;
      return;
    }

    // Rolling/sliding contact: remove the inward normal velocity.
    if (vn < 0) {
      m.vx -= vn * nx; m.vy -= vn * ny; m.vz -= vn * nz;
    }
    if (!m.grounded && m.airTime > 0.05) {
      events.push({ type: 'land', marble: m, speed: -vn, airTime: m.airTime, x: m.x, y: m.y, z: m.z, soft: true, time: this.time });
    }
    m.grounded = true;
    m.airTime = 0;

    // Gravity component along the surface (already applied in full to v):
    // pure rolling of a solid sphere accelerates at 5/7 of it.
    const gn = -g * ny; // (0,-g,0) . n
    const gtx = -gn * nx;
    const gty = -g - gn * ny;
    const gtz = -gn * nz;

    // Friction at the contact point: slip = v + w x (-r n)
    const normalForce = m.m * g * ny;
    const rolling = this._contactFriction(m, nx, ny, nz, P.rollingFriction * normalForce * dt);
    if (rolling) {
      m.vx -= (2 / 7) * gtx * dt;
      m.vy -= (2 / 7) * gty * dt;
      m.vz -= (2 / 7) * gtz * dt;
      // Rolling resistance: constant part + a speed-dependent part (the marble
      // hops over grains of dirt at speed).
      const sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy + m.vz * m.vz);
      if (sp > 1e-9) {
        const dec = (P.rollingResistance * g * ny + P.rollingDragQuad * sp * sp) * dt;
        const f = Math.max(0, 1 - dec / sp);
        m.vx *= f; m.vy *= f; m.vz *= f;
      }
      // Rolling without slipping: w = (n x v) / r
      m.wx = (ny * m.vz - nz * m.vy) / m.r;
      m.wy = (nz * m.vx - nx * m.vz) / m.r;
      m.wz = (nx * m.vy - ny * m.vx) / m.r;
    }
  }

  /**
   * Apply a Coulomb friction impulse of at most `maxImpulse` at the ground
   * contact, acting on both the velocity and the spin. Returns true when the
   * marble rolls without slipping afterwards.
   */
  _contactFriction(m, nx, ny, nz, maxImpulse) {
    // contact point velocity: v + w x (-r n) = v - r (w x n)
    let cx = m.vx - m.r * (m.wy * nz - m.wz * ny);
    let cy = m.vy - m.r * (m.wz * nx - m.wx * nz);
    let cz = m.vz - m.r * (m.wx * ny - m.wy * nx);
    const cn = cx * nx + cy * ny + cz * nz;
    cx -= cn * nx; cy -= cn * ny; cz -= cn * nz;
    const slip = Math.sqrt(cx * cx + cy * cy + cz * cz);
    m.slip = slip;
    if (slip < 1e-5) return true;
    // Impulse that stops the slip: dv_contact = J (1/m + r^2/I) = J * 7/(2m)
    const jStop = slip / (1 / m.m + (m.r * m.r) / m.inertia);
    const j = Math.min(maxImpulse, jStop);
    const tx = -cx / slip;
    const ty = -cy / slip;
    const tz = -cz / slip;
    m.vx += (j / m.m) * tx; m.vy += (j / m.m) * ty; m.vz += (j / m.m) * tz;
    // torque = (-r n) x (j t)
    const k = (m.r * j) / m.inertia;
    m.wx -= k * (ny * tz - nz * ty);
    m.wy -= k * (nz * tx - nx * tz);
    m.wz -= k * (nx * ty - ny * tx);
    if (j >= jStop - 1e-12) {
      m.slip = 0;
      return true;
    }
    return false;
  }

  _walls(m, events) {
    const P = this.params;
    const e = P.wallRestitution;
    const f = 1 - P.wallFriction;
    let hit = 0;
    if (m.x - m.r < FIELD.xMin) {
      m.x = FIELD.xMin + m.r;
      if (m.vx < 0) { hit = -m.vx; m.vx = -m.vx * e; m.vz *= f; m.vy *= f; }
    } else if (m.x + m.r > FIELD.xMax) {
      m.x = FIELD.xMax - m.r;
      if (m.vx > 0) { hit = m.vx; m.vx = -m.vx * e; m.vz *= f; m.vy *= f; }
    }
    if (m.z - m.r < FIELD.zMin) {
      m.z = FIELD.zMin + m.r;
      if (m.vz < 0) { hit = Math.max(hit, -m.vz); m.vz = -m.vz * e; m.vx *= f; m.vy *= f; }
    } else if (m.z + m.r > FIELD.zMax) {
      m.z = FIELD.zMax - m.r;
      if (m.vz > 0) { hit = Math.max(hit, m.vz); m.vz = -m.vz * e; m.vx *= f; m.vy *= f; }
    }
    if (hit > 0.03) {
      events.push({ type: 'wall', marble: m, speed: hit, x: m.x, y: m.y, z: m.z, time: this.time });
    }
  }

  _sleepCheck(m, dt) {
    const P = this.params;
    const sp = Math.sqrt(m.vx * m.vx + m.vy * m.vy + m.vz * m.vz);
    if (!m.grounded) {
      m.lowSpeedTime = 0;
      return;
    }
    if (sp < P.sleepSpeed * 3) m.lowSpeedTime += dt;
    else m.lowSpeedTime = 0;
    if (sp >= P.sleepSpeed && m.lowSpeedTime < P.wedgeSleepTime) return;
    // Slope test: tangential gravity vs static friction.
    const slope = Math.sqrt(1 - m.ny * m.ny) / Math.max(1e-9, m.ny); // tan(theta)
    if (slope <= P.staticFriction || m.lowSpeedTime >= P.wedgeSleepTime) {
      m.vx = m.vy = m.vz = 0;
      m.wx = m.wy = m.wz = 0;
      m.asleep = true;
      m.lowSpeedTime = 0;
      m.slip = 0;
    }
  }

  /** An independent copy of this world (same terrain) for planning shots. */
  clone() {
    const w = new World(this.terrain, this.params);
    w.time = this.time;
    for (const m of this.marbles) {
      const c = createMarble({ id: m.id, radius: m.r });
      Object.assign(c, m);
      w.marbles.push(c);
    }
    return w;
  }

  /** Copy of the dynamic state of every marble (for planning). */
  snapshot() {
    return {
      time: this.time,
      acc: this._acc,
      marbles: this.marbles.map((m) => ({
        id: m.id, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz,
        wx: m.wx, wy: m.wy, wz: m.wz, grounded: m.grounded, asleep: m.asleep,
        active: m.active, lowSpeedTime: m.lowSpeedTime, airTime: m.airTime,
        nx: m.nx, ny: m.ny, nz: m.nz, slip: m.slip,
      })),
    };
  }

  restore(snap) {
    this.time = snap.time;
    this._acc = snap.acc;
    for (const sm of snap.marbles) {
      const m = this.marbles.find((o) => o.id === sm.id);
      if (!m) continue;
      Object.assign(m, sm);
    }
  }

  /**
   * Run the world forward (from its current state) until every marble rests
   * or maxTime elapses. Returns the events that occurred. Mutates the world,
   * so callers planning shots should snapshot()/restore() around it.
   */
  runToRest(maxTime = PHYSICS.maxShotTime) {
    const events = [];
    const h = this.params.substep;
    const steps = Math.ceil(maxTime / h);
    for (let i = 0; i < steps; i++) {
      this.substep(h, events);
      if (this.allAtRest()) break;
    }
    return events;
  }
}

/** Earliest time in [0, maxT] at which two moving spheres touch, or -1. */
function timeOfImpact(a, b, maxT) {
  const avx = a.asleep ? 0 : a.vx;
  const avy = a.asleep ? 0 : a.vy;
  const avz = a.asleep ? 0 : a.vz;
  const bvx = b.asleep ? 0 : b.vx;
  const bvy = b.asleep ? 0 : b.vy;
  const bvz = b.asleep ? 0 : b.vz;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const vx = bvx - avx;
  const vy = bvy - avy;
  const vz = bvz - avz;
  const R = a.r + b.r;
  const c = dx * dx + dy * dy + dz * dz - R * R;
  if (c <= 0) {
    // Already overlapping: collide now only if approaching.
    return dx * vx + dy * vy + dz * vz < 0 ? 0 : -1;
  }
  const qa = vx * vx + vy * vy + vz * vz;
  if (qa < 1e-12) return -1;
  const qb = 2 * (dx * vx + dy * vy + dz * vz);
  if (qb >= 0) return -1; // moving apart
  const disc = qb * qb - 4 * qa * c;
  if (disc < 0) return -1;
  const t = (-qb - Math.sqrt(disc)) / (2 * qa);
  if (t < 0 || t > maxT) return -1;
  return t;
}
