import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/terrain.js';
import { World, createMarble, marbleMass } from '../src/physics.js';
import { CAVE, FIELD, MARBLE_SIZES, PHYSICS, START_LINE, HAND_HEIGHT } from '../src/config.js';

const R = MARBLE_SIZES.medium.radius;
const terrain = new Terrain({ seed: 1234 });

function makeWorld() {
  return new World(terrain);
}

function surfaceY(x, z, r = R) {
  const out = { h: 0, gx: 0, gz: 0 };
  terrain.surfaceForRadius(x, z, r, out);
  return out.h;
}

function run(world, seconds, onStep) {
  const events = [];
  const h = PHYSICS.substep;
  const n = Math.round(seconds / h);
  for (let i = 0; i < n; i++) {
    world.substep(h, events);
    if (onStep) onStep(i * h);
  }
  return events;
}

test('terrain: bumps are gentler than the static friction angle', () => {
  const slope = terrain.maxBaseSlope();
  assert.ok(slope < PHYSICS.staticFriction, `max slope ${slope.toFixed(4)} >= ${PHYSICS.staticFriction}`);
  assert.ok(slope > 0.01, 'surface should not be flat');
});

test('terrain: cave bowl depth and continuity', () => {
  assert.ok(Math.abs(terrain.caveDepth(CAVE.x, CAVE.z) - CAVE.depth) < 1e-9);
  assert.equal(terrain.caveDepth(CAVE.x + CAVE.radius, CAVE.z), 0);
  // continuity across the rim
  const a = terrain.height(CAVE.radius - 1e-6, 0);
  const b = terrain.height(CAVE.radius + 1e-6, 0);
  assert.ok(Math.abs(a - b) < 1e-5);
  // a big marble sits higher in the bowl than a small one
  const big = surfaceY(0, 0, MARBLE_SIZES.big.radius) - MARBLE_SIZES.big.radius;
  const small = surfaceY(0, 0, MARBLE_SIZES.small.radius) - MARBLE_SIZES.small.radius;
  assert.ok(big > small, 'big marble bottom should be above small marble bottom');
  // a marble on the cave wall has its centre above the contact height
  const onWall = surfaceY(0.02, 0, R);
  assert.ok(onWall > terrain.height(0.02, 0) + R - 1e-9);
});

test('a marble placed on the ground stays put', () => {
  const w = makeWorld();
  const m = w.addMarble(createMarble({ radius: R }));
  w.placeOnGround(m, 0.4, 1.2);
  const x0 = m.x, z0 = m.z, y0 = m.y;
  w.wake(m); // even if woken it must settle again
  run(w, 3);
  assert.ok(m.asleep, 'should be asleep');
  assert.ok(Math.hypot(m.x - x0, m.z - z0) < 0.002, `drifted ${Math.hypot(m.x - x0, m.z - z0)}`);
  assert.ok(Math.abs(m.y - y0) < 1e-4);
});

test('a dropped marble falls, lands, bounces and settles on the surface', () => {
  const w = makeWorld();
  const m = w.addMarble(createMarble({ radius: R }));
  w.placeOnGround(m, 0.3, 1.5);
  const groundY = m.y;
  w.launch(m, 0, 0, 0, { x: 0.3, y: groundY + 0.3, z: 1.5 });
  let maxPen = 0;
  const events = run(w, 4, () => {
    const pen = surfaceY(m.x, m.z) - m.y;
    if (pen > maxPen) maxPen = pen;
  });
  const lands = events.filter((e) => e.type === 'land');
  assert.ok(lands.length >= 1, 'should produce a land event');
  assert.ok(lands[0].speed > 2.2 && lands[0].speed < 2.5, `impact speed ${lands[0].speed}`);
  assert.ok(m.asleep, 'should come to rest');
  assert.ok(Math.abs(m.y - surfaceY(m.x, m.z)) < 1e-6, 'rests on surface');
  assert.ok(maxPen < 1e-6, `penetrated ${maxPen}`);
});

test('a slow marble rolling at the cave drops in and settles at the bottom', () => {
  const w = makeWorld();
  const m = w.addMarble(createMarble({ radius: R }));
  w.placeOnGround(m, 0, 0.25);
  w.launch(m, 0, 0, -0.9);
  run(w, 8);
  assert.ok(m.asleep, 'should rest');
  assert.ok(terrain.isInCave(m.x, m.z), `not in cave: ${m.x.toFixed(3)}, ${m.z.toFixed(3)}`);
  assert.ok(Math.hypot(m.x, m.z) < 0.004, 'should rest near the bottom');
  assert.ok(m.y < terrain.caveRimHeight(), 'centre below rim');
});

test('two marbles rolled into the cave settle against each other and sleep', () => {
  const w = makeWorld();
  const a = w.addMarble(createMarble({ id: 1, radius: R }));
  const b = w.addMarble(createMarble({ id: 2, radius: MARBLE_SIZES.small.radius }));
  w.placeOnGround(a, 0, 0.22);
  w.launch(a, 0, 0, -0.9);
  run(w, 6);
  assert.ok(a.asleep && terrain.isInCave(a.x, a.z), 'first marble rests in the cave');
  w.placeOnGround(b, 0.15, 0.18);
  const dx = -b.x, dz = -b.z, l = Math.hypot(dx, dz);
  w.launch(b, (dx / l) * 1.0, 0, (dz / l) * 1.0);
  const t0 = w.time;
  let restAt = null;
  const h = PHYSICS.substep;
  for (let i = 0; i < 8 / h; i++) {
    w.substep(h, []);
    if (w.allAtRest()) {
      restAt = w.time - t0;
      break;
    }
  }
  assert.ok(restAt !== null, 'both marbles must come to rest');
  assert.ok(restAt < 5, `took ${restAt}s to rest`);
  assert.ok(terrain.isInCave(a.x, a.z) && terrain.isInCave(b.x, b.z), 'both in the cave');
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  assert.ok(d >= (a.r + b.r) * 0.98, `not interpenetrating (${d})`);
});

test('a fast marble skips across the cave', () => {
  const w = makeWorld();
  const m = w.addMarble(createMarble({ radius: R }));
  w.placeOnGround(m, 0, 0.3);
  w.launch(m, 0, 0, -3.2);
  run(w, 10);
  assert.ok(m.asleep);
  assert.ok(!terrain.isInCave(m.x, m.z), 'should not be in the cave');
  assert.ok(m.z < -0.15, `should have crossed the cave, z=${m.z}`);
});

test('head-on collision conserves momentum and reports closing speed', () => {
  const w = makeWorld();
  const a = w.addMarble(createMarble({ radius: R }));
  const b = w.addMarble(createMarble({ radius: R }));
  // Mid-air, so only gravity (vertical) and tiny drag act besides the impact.
  w.launch(a, 0, 0, -1.5, { x: 0.2, y: 1.0, z: 1.4 });
  w.launch(b, 0, 0, 0, { x: 0.2, y: 1.0, z: 1.2 });
  const events = [];
  const h = PHYSICS.substep;
  let hit = null;
  for (let i = 0; i < 200 && !hit; i++) {
    const before = a.m * a.vz + b.m * b.vz;
    w.substep(h, events);
    hit = events.find((e) => e.type === 'hit');
    if (hit) {
      const after = a.m * a.vz + b.m * b.vz;
      assert.ok(Math.abs(before - after) < 1e-3 * Math.abs(before), `momentum ${before} -> ${after}`);
      // Equal masses: the striker hands over (1+e)/2 of the closing speed.
      const expected = ((1 + PHYSICS.marbleRestitution) * hit.speed) / 2;
      assert.ok(Math.abs(-b.vz - expected) < 1e-3, `struck marble ${b.vz}, expected ${-expected}`);
      assert.ok(Math.abs(-a.vz - (hit.speed - expected)) < 1e-3, `striker ${a.vz}`);
    }
  }
  assert.ok(hit, 'collision expected');
  assert.ok(hit.speed > 1.49 && hit.speed <= 1.5, `closing speed ${hit.speed}`);
});

test('small marble hitting a big one below its equator is pressed into the dirt', () => {
  const w = makeWorld();
  const a = w.addMarble(createMarble({ radius: MARBLE_SIZES.small.radius }));
  const b = w.addMarble(createMarble({ radius: MARBLE_SIZES.big.radius }));
  w.placeOnGround(a, -0.3, 1.4);
  w.placeOnGround(b, -0.3, 1.2);
  w.launch(a, 0, 0, -1.5);
  const events = [];
  const h = PHYSICS.substep;
  let hit = null;
  for (let i = 0; i < 300 && !hit; i++) {
    w.substep(h, events);
    hit = events.find((e) => e.type === 'hit');
  }
  assert.ok(hit, 'collision expected');
  // The contact normal tilts upward (big marble's centre is higher), so the
  // small marble gets a downward kick and lands hard in the same instant.
  const land = events.find((e) => e.type === 'land' && e.marble === a);
  assert.ok(land && land.speed > 0.2, 'small marble slammed into the ground');
  assert.ok(a.vz > 0, `small marble rebounds (${a.vz})`);
  assert.ok(b.vy > 0, 'big marble is lifted slightly');
});

test('small marble hitting a big one mid-air: big one barely moves', () => {
  const w = makeWorld();
  const a = w.addMarble(createMarble({ radius: MARBLE_SIZES.small.radius }));
  const b = w.addMarble(createMarble({ radius: MARBLE_SIZES.big.radius }));
  w.launch(a, 0, 0, -1.5, { x: -0.3, y: 1.0, z: 1.4 });
  w.launch(b, 0, 0, 0, { x: -0.3, y: 1.0, z: 1.2 });
  const events = [];
  const h = PHYSICS.substep;
  let hit = null;
  for (let i = 0; i < 300 && !hit; i++) {
    w.substep(h, events);
    hit = events.find((e) => e.type === 'hit');
  }
  assert.ok(hit, 'collision expected');
  assert.ok(marbleMass(b.r) / marbleMass(a.r) > 6);
  // Big marble takes (1+e) * m_a/(m_a+m_b) of the closing speed; small one rebounds.
  const expected = ((1 + PHYSICS.marbleRestitution) * hit.speed * a.m) / (a.m + b.m);
  assert.ok(Math.abs(-b.vz - expected) < 1e-3, `big marble speed ${b.vz}, expected ${-expected}`);
  assert.ok(a.vz > 0.5, `small marble should bounce back (${a.vz})`);
});

test('no penetration and no escape during random shots', () => {
  const w = makeWorld();
  const a = w.addMarble(createMarble({ radius: MARBLE_SIZES.big.radius }));
  const b = w.addMarble(createMarble({ radius: MARBLE_SIZES.small.radius }));
  w.placeOnGround(a, 0.1, 0.5);
  w.placeOnGround(b, -0.1, 0.4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let maxPen = 0;
  for (let shot = 0; shot < 12; shot++) {
    const m = shot % 2 ? a : b;
    const ang = rnd() * Math.PI * 2;
    const sp = 0.5 + rnd() * 4.5;
    w.launch(m, Math.cos(ang) * sp, rnd() * 2.5, Math.sin(ang) * sp);
    run(w, 6, () => {
      for (const mm of [a, b]) {
        const pen = surfaceY(mm.x, mm.z, mm.r) - mm.y;
        if (pen > maxPen) maxPen = pen;
        assert.ok(mm.x >= FIELD.xMin + mm.r - 1e-6 && mm.x <= FIELD.xMax - mm.r + 1e-6, 'inside x');
        assert.ok(mm.z >= FIELD.zMin + mm.r - 1e-6 && mm.z <= FIELD.zMax - mm.r + 1e-6, 'inside z');
        assert.ok(Number.isFinite(mm.x + mm.y + mm.z + mm.vx + mm.vy + mm.vz), 'finite');
      }
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      assert.ok(d > (a.r + b.r) * 0.9, `marbles interpenetrate: ${d}`);
    });
    assert.ok(w.allAtRest(), `shot ${shot} did not come to rest`);
  }
  assert.ok(maxPen < 1e-4, `max penetration ${maxPen}`);
});

test('a sliding marble spins up and rolls without slipping', () => {
  const w = makeWorld();
  const m = w.addMarble(createMarble({ radius: R }));
  w.placeOnGround(m, 0.5, 1.8);
  w.launch(m, 0, 0, -1.2);
  // Spin-up time for a sliding sphere: (2/7) v / (mu g) ~ 0.07 s.
  run(w, 0.01);
  assert.ok(m.slip > 0, 'should still be sliding right after the flick');
  run(w, 0.09);
  assert.ok(m.slip === 0, 'slip should vanish quickly on dirt');
  const spin = Math.hypot(m.wx, m.wy, m.wz) * m.r;
  const speed = Math.hypot(m.vx, m.vy, m.vz);
  assert.ok(Math.abs(spin - speed) < 1e-6, `w*r=${spin} v=${speed}`);
  // Spin-up costs 2/7 of the initial speed, then rolling resistance nibbles.
  assert.ok(speed < 1.2 * (5 / 7) && speed > 1.2 * (5 / 7) - 0.1, `speed after spin-up ${speed}`);
});

test('simulation is deterministic', () => {
  const states = [];
  for (let k = 0; k < 2; k++) {
    const w = makeWorld();
    const a = w.addMarble(createMarble({ id: 1, radius: R }));
    const b = w.addMarble(createMarble({ id: 2, radius: MARBLE_SIZES.big.radius }));
    w.placeOnGround(a, 0.05, 0.6);
    w.placeOnGround(b, -0.02, 0.45);
    w.launch(a, 0.1, 0.3, -1.4);
    run(w, 5);
    states.push([a.x, a.y, a.z, b.x, b.y, b.z]);
  }
  assert.deepEqual(states[0], states[1]);
});

test('snapshot/restore + runToRest predicts the real outcome exactly', () => {
  const w = makeWorld();
  const a = w.addMarble(createMarble({ id: 1, radius: R }));
  const b = w.addMarble(createMarble({ id: 2, radius: R }));
  w.placeOnGround(a, 0.05, 0.6);
  w.placeOnGround(b, -0.02, 0.45);
  const snap = w.snapshot();
  // aim straight at b
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  const vx = (1.5 * dx) / len, vz = (1.5 * dz) / len;
  w.launch(a, vx, 0.0, vz);
  const predicted = w.runToRest();
  const predictedPos = [a.x, a.z, b.x, b.z];
  w.restore(snap);
  assert.ok(a.asleep && Math.abs(a.z - 0.6) < 1e-12, 'restored');
  w.launch(a, vx, 0.0, vz);
  run(w, PHYSICS.maxShotTime);
  assert.deepEqual([a.x, a.z, b.x, b.z], predictedPos);
  assert.ok(predicted.some((e) => e.type === 'hit'));
});

test('a 45 degree lob from the start line lands near the cave and rolls a bounded distance', () => {
  const w = makeWorld();
  const m = w.addMarble(createMarble({ radius: R }));
  const dist = START_LINE.z - CAVE.z;
  const h0 = terrain.height(0, START_LINE.z) + HAND_HEIGHT;
  // Solve the no-drag range for a 45 degree launch from height h0 to the cave.
  const g = PHYSICS.gravity;
  const ang = Math.PI / 4;
  // dist = v cos(a) t, 0 = h0 + v sin(a) t - g t^2 / 2  -> bisect on v
  let lo = 2, hi = 8;
  for (let i = 0; i < 50; i++) {
    const v = (lo + hi) / 2;
    const t = dist / (v * Math.cos(ang));
    const y = h0 + v * Math.sin(ang) * t - 0.5 * g * t * t;
    if (y > 0) hi = v; else lo = v;
  }
  const v = (lo + hi) / 2;
  assert.ok(v > 4 && v < 5.5, `launch speed ${v}`);
  w.launch(m, 0, v * Math.sin(ang), -v * Math.cos(ang), { x: 0, y: h0, z: START_LINE.z });
  const events = run(w, 10);
  const land = events.find((e) => e.type === 'land');
  assert.ok(land, 'lands');
  // Air drag makes it land a little short of the vacuum solution.
  assert.ok(land.z > -0.1 && land.z < 0.35, `landing z=${land.z.toFixed(3)} (expected near 0)`);
  assert.ok(m.asleep);
  const rollOut = Math.hypot(m.x - land.x, m.z - land.z);
  assert.ok(rollOut < 1.0, `rolled out ${rollOut.toFixed(2)} m after landing`);
});
