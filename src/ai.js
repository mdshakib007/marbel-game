// The computer opponent. It plans by simulating candidate shots with the very
// same physics (on a private copy of the world), scores each outcome, picks
// the best and then executes it with a little human error that depends on
// the difficulty level. Planning is a generator so the UI can time-slice it
// across frames and keep animating.

import { AI_LEVELS, CAVE, PHYSICS, SHOT, hitPoints } from './config.js';

const SIM_TIME = 10;

/**
 * @param {import('./game.js').Game} game
 * @param {object} player  the game player object the AI controls
 * @param {{rng?: () => number, level?: object}} [opts]
 * @returns {Generator<number, {dirX:number,dirZ:number,power:number,elevation:number}>}
 */
export function* planShot(game, player, { rng = Math.random, level = null } = {}) {
  level = level || AI_LEVELS[player.aiLevel] || AI_LEVELS.medium;
  const terrain = game.terrain;
  const world = game.world.clone();
  const me = world.marbles.find((m) => m.id === player.marble.id);
  const oppPlayer = game.opponentOf(player);
  const opp = world.marbles.find((m) => m.id === oppPlayer.marble.id);
  const kind = game.shotKind(player);
  const maxSpeed = game.maxSpeed(player);
  const origin = game.shotOrigin(player);
  const oppInCaveBefore = game.isInCave(oppPlayer.marble);
  const snapshot = world.snapshot();

  let candidates = buildCandidates({ kind, player, oppPlayer, me, opp, origin, maxSpeed });
  if (level.candidates < 1) {
    // Weaker players consider fewer options (keep at least a dozen).
    const keep = Math.max(12, Math.round(candidates.length * level.candidates));
    candidates = shuffle(candidates, rng).slice(0, keep);
  }

  const results = [];
  let last = now();
  for (const c of candidates) {
    world.restore(snapshot);
    const speed = c.power * maxSpeed;
    if (kind === 'throw') {
      const el = (c.elevation * Math.PI) / 180;
      world.launch(me, c.dirX * speed * Math.cos(el), speed * Math.sin(el), c.dirZ * speed * Math.cos(el), origin);
    } else {
      world.wake(me);
      world.launch(me, c.dirX * speed * 0.998, speed * 0.06, c.dirZ * speed * 0.998);
    }
    world.wakeNear(me.x, me.z, 0.05, me);
    const events = world.runToRest(SIM_TIME);
    const firstHit = events.find((e) => e.type === 'hit') || null;
    const outcome = {
      firstHit,
      meInCave: me.active && terrain.isInCave(me.x, me.z),
      oppInCave: opp.active && terrain.isInCave(opp.x, opp.z),
      dMeCave: Math.hypot(me.x - CAVE.x, me.z - CAVE.z),
      dOppCave: opp.active ? Math.hypot(opp.x - CAVE.x, opp.z - CAVE.z) : 9,
      dMeOpp: opp.active ? Math.hypot(me.x - opp.x, me.z - opp.z) : 9,
      meEnd: { x: me.x, z: me.z },
      oppEnd: { x: opp.x, z: opp.z },
    };
    const score = evaluate(kind, player, oppPlayer, outcome, oppInCaveBefore) + rng() * 0.3;
    results.push({ ...c, score, outcome });
    if (now() - last > 6) {
      yield results.length / candidates.length;
      last = now();
    }
  }

  results.sort((a, b) => b.score - a.score);
  let pick = results[0];
  if (level.blunder > 0 && rng() < level.blunder && results.length > 3) {
    const pool = Math.max(2, Math.floor(results.length * 0.35));
    pick = results[1 + Math.floor(rng() * (pool - 1))];
  }

  // Execution error: a human finger is not a robot, and a hard flick is
  // harder to aim than a gentle nudge.
  const effort = 0.45 + 0.75 * pick.power;
  const ang = gaussian(rng) * ((level.dirNoise * effort * Math.PI) / 180);
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const dirX = pick.dirX * cs - pick.dirZ * sn;
  const dirZ = pick.dirX * sn + pick.dirZ * cs;
  const power = clamp(pick.power * (1 + gaussian(rng) * level.powerNoise), SHOT.minPower, 1);
  return {
    dirX,
    dirZ,
    power,
    elevation: pick.elevation,
    planned: pick,
    considered: results.length,
    best: results[0],
  };
}

function buildCandidates({ kind, player, oppPlayer, me, opp, origin, maxSpeed }) {
  const list = [];
  const push = (dirX, dirZ, power, elevation, tag) => {
    const l = Math.hypot(dirX, dirZ) || 1;
    list.push({ dirX: dirX / l, dirZ: dirZ / l, power: clamp(power, SHOT.minPower, 1), elevation, tag });
  };
  const toCave = { x: CAVE.x - origin.x, z: CAVE.z - origin.z };
  const toOpp = opp.active ? { x: opp.x - origin.x, z: opp.z - origin.z } : null;
  const dOpp = toOpp ? Math.hypot(toOpp.x, toOpp.z) : Infinity;

  if (kind === 'throw') {
    const dist = Math.hypot(toCave.x, toCave.z);
    const h0 = origin.y - (me.y || 0); // launch height above the ground, roughly
    for (const elevation of [38, 45, 52, 60]) {
      // Vacuum speed that lands `short` of the cave; drag and the landing hop
      // are then covered by the spread of multipliers.
      const vStar = vacuumSpeed(dist - 0.03, Math.max(0.05, h0), elevation);
      for (const mul of [0.9, 0.94, 0.97, 1.0, 1.03, 1.06]) {
        for (const da of [-1.2, 0, 1.2]) {
          const d = rotate(toCave, (da * Math.PI) / 180);
          push(d.x, d.z, (vStar * mul) / maxSpeed, elevation, 'cave');
        }
      }
    }
    return list;
  }

  if (!player.powered) {
    for (const da of [-8, -4, -1.5, 0, 1.5, 4, 8]) {
      const d = rotate(toCave, (da * Math.PI) / 180);
      for (const p of [0.12, 0.2, 0.3, 0.42, 0.55, 0.7, 0.85, 1.0]) push(d.x, d.z, p, 0, 'cave');
    }
    if (toOpp && dOpp < 0.5) {
      for (const da of [-3, -1, 0, 1, 3]) {
        const d = rotate(toOpp, (da * Math.PI) / 180);
        for (const p of [0.4, 0.55, 0.7, 0.85, 1.0]) push(d.x, d.z, p, 0, 'strip');
      }
    }
    return list;
  }

  // Powered: hunt the opponent.
  if (toOpp) {
    for (const da of [-5, -3, -1.5, -0.5, 0, 0.5, 1.5, 3, 5]) {
      const d = rotate(toOpp, (da * Math.PI) / 180);
      for (const p of [0.2, 0.3, 0.4, 0.55, 0.7, 0.85, 1.0]) push(d.x, d.z, p, 0, 'hit');
    }
  }
  // A few positional options: creep towards the opponent / the cave.
  for (const da of [-20, 0, 20]) {
    const base = toOpp || toCave;
    const d = rotate(base, (da * Math.PI) / 180);
    for (const p of [0.08, 0.14]) push(d.x, d.z, p, 0, 'position');
  }
  return list;
}

function evaluate(kind, player, oppPlayer, o, oppInCaveBefore) {
  let s = 0;
  const oppPowered = oppPlayer.powered;
  // A touch on a marble that stays in the cave is 'safe' and scores nothing.
  const countedHit = !!o.firstHit && !(oppInCaveBefore && o.oppInCave);
  const pts = countedHit ? hitPoints(player.powered, oppPowered) : 0;
  // Power after the shot follows the rules: a counted hit strips it, but a
  // marble resting in the cave at the end has (re)entered and holds it.
  const oppPoweredAfter = o.oppInCave || (oppPowered && !countedHit);
  const mePoweredAfter = player.powered || o.meInCave;
  const stripped = oppPowered && !oppPoweredAfter;
  const gaveAway = !oppPowered && oppPoweredAfter; // we knocked them in: they move next, with the power
  // Next move: whoever entered the cave; else the shooter after a counted hit.
  const extraTurn = kind === 'flick' && !gaveAway && (o.meInCave || countedHit);

  if (!player.powered) {
    // Goal: get the power. Being close to the cave is good; inside is best.
    if (mePoweredAfter) s += 120;
    else s -= 60 * o.dMeCave;
    if (countedHit) s += 40 * pts + (stripped ? 70 : 0);
    if (extraTurn) s += 30;
    if (gaveAway) s -= 100;
    if (oppPoweredAfter && !mePoweredAfter) s -= 20 * Math.max(0, 0.6 - o.dMeOpp);
  } else {
    if (countedHit) s += 60 * pts + (stripped ? 90 : 0) + 25 * Math.min(1.5, o.dOppCave);
    else s -= 15 * o.dMeOpp;
    if (extraTurn) s += 40;
    if (gaveAway) s -= 150;
    if (!oppPoweredAfter) s -= 40 * Math.max(0, 0.35 - o.dMeOpp); // they could nudge us and strip the power
  }
  return s;
}

/** Launch speed to land at horizontal distance d from height h at angle deg (no drag). */
function vacuumSpeed(d, h, deg) {
  const g = PHYSICS.gravity;
  const a = (deg * Math.PI) / 180;
  let lo = 0.5;
  let hi = 12;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2;
    const t = d / (v * Math.cos(a));
    const y = h + v * Math.sin(a) * t - 0.5 * g * t * t;
    if (y > 0) hi = v;
    else lo = v;
  }
  return (lo + hi) / 2;
}

function rotate(v, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}

function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Run a planner generator to completion synchronously (tests, fallbacks). */
export function planShotSync(game, player, opts) {
  const it = planShot(game, player, opts);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
