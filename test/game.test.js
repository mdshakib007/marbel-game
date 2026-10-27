import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/terrain.js';
import { Game } from '../src/game.js';
import { planShotSync } from '../src/ai.js';
import { createRng } from '../src/noise.js';
import { AI_LEVELS, CAVE, START_LINE, hitPoints } from '../src/config.js';

/** A flawless computer: no aiming error, no blunders (deterministic tests). */
const PERFECT = { ...AI_LEVELS.hard, dirNoise: 0, powerNoise: 0, blunder: 0 };

const terrain = new Terrain({ seed: 42 });

function makeGame({ targetScore = null, rng = createRng(1), scatter = 0 } = {}) {
  const game = new Game({
    terrain,
    rng,
    targetScore,
    scatter, // exact shots by default so the rules tests are deterministic
    players: [
      { name: 'You', isAI: false, size: 'medium', style: 'catseye', color: 'blue' },
      { name: 'Computer', isAI: true, size: 'medium', style: 'swirl', color: 'red', aiLevel: 'hard' },
    ],
  });
  return game;
}

/** Step the game until the shot (and any lift animation) is finished. */
function settle(game, maxSeconds = 40) {
  let t = 0;
  while ((game.phase === 'shot' || game.placing) && t < maxSeconds) {
    game.update(1 / 60);
    t += 1 / 60;
  }
  assert.ok(t < maxSeconds, 'shot should finish');
}

/** Skip the opening: put both marbles on the ground and start normal turns. */
function midGame(game, p0, p1, current = 0) {
  game.phase = 'turn';
  for (const [p, pos] of [[game.players[0], p0], [game.players[1], p1]]) {
    p.inHand = false;
    game.world.placeOnGround(p.marble, pos.x, pos.z);
  }
  game.current = current;
}

test('opening: both players lob, closest to the cave moves first', () => {
  const game = makeGame();
  const log = [];
  game.on('*', (e) => log.push(e.type));
  game.start();
  assert.equal(game.phase, 'opening');
  assert.equal(game.current, 0);
  assert.equal(game.shotKind(), 'throw');
  const origin = game.shotOrigin();
  assert.ok(Math.abs(origin.z - START_LINE.z) < 1e-9 && origin.y > 0.2, 'throws from the hand on the line');

  // Player 0: a decent lob aimed at the cave (lands just short and rolls on)
  const aim = { dirX: CAVE.x - origin.x, dirZ: CAVE.z - origin.z };
  assert.ok(game.shoot({ ...aim, power: 4.35 / game.maxSpeed(), elevation: 45 }));
  assert.equal(game.phase, 'shot');
  settle(game);
  assert.equal(game.phase, 'opening');
  assert.equal(game.current, 1, 'second player throws next');
  // Player 1: a weak lob that lands well short
  const o2 = game.shotOrigin();
  assert.ok(game.shoot({ dirX: CAVE.x - o2.x, dirZ: CAVE.z - o2.z, power: 3.0 / game.maxSpeed(), elevation: 45 }));
  settle(game);
  assert.ok(game.phase === 'turn' || game.phase === 'placing');
  settle(game);
  const d0 = game.distanceToCave(game.players[0].marble);
  const d1 = game.distanceToCave(game.players[1].marble);
  assert.ok(d0 < d1, `player 0 should be closer (${d0} vs ${d1})`);
  assert.equal(game.current, 0, 'closest player starts');
  assert.equal(game.shotKind(), 'flick');
  assert.ok(log.includes('opening-done'));
  assert.ok(game.maxSpeed() < 1.5, 'without the power the flick is weak');
});

test('a hit scores by speed, strips a powered victim, and earns another turn', () => {
  const game = makeGame();
  midGame(game, { x: 0.3, z: 1.0 }, { x: 0.3, z: 0.85 });
  const [p0, p1] = game.players;
  p0.powered = true;
  p1.powered = true;
  p1.score = 3;
  assert.ok(game.maxSpeed(p0) > 2.5, 'powered flick is hard');
  assert.ok(game.shoot({ dirX: 0, dirZ: -1, power: 1 }));
  settle(game);
  const r = game.lastResult;
  assert.ok(r.hit, 'should hit');
  assert.ok(r.hit.speed > 1.7, `smash expected, got ${r.hit.speed}`);
  assert.equal(r.points, 4);
  assert.equal(p0.score, 4);
  assert.equal(r.powerStripped, true);
  assert.equal(p1.powered, false);
  assert.equal(p1.score, 2, 'victim loses one point');
  assert.equal(r.extraTurn, true);
  assert.equal(game.current, 0, 'hitter shoots again');
  assert.equal(game.phase, 'turn');
});

test('a victim with zero points cannot go negative; a miss passes the turn', () => {
  const game = makeGame();
  midGame(game, { x: -0.4, z: 1.2 }, { x: -0.4, z: 1.0 });
  const [p0, p1] = game.players;
  p0.powered = true;
  p1.powered = true;
  p1.score = 0;
  game.shoot({ dirX: 0, dirZ: -1, power: 0.5 });
  settle(game);
  assert.ok(game.lastResult.hit);
  assert.equal(p1.score, 0);
  assert.equal(p1.powered, false);
  assert.equal(game.current, 0);
  // now miss on purpose (shoot away)
  game.shoot({ dirX: 1, dirZ: 0, power: 0.3 });
  settle(game);
  assert.equal(game.lastResult.hit, null);
  assert.equal(game.current, 1, 'turn passes after a miss');
});

test('a weak (un-powered) touch still scores and strips the power', () => {
  const game = makeGame();
  midGame(game, { x: 0.5, z: 0.9 }, { x: 0.5, z: 0.78 });
  const [p0, p1] = game.players;
  p1.powered = true;
  p1.score = 1;
  game.shoot({ dirX: 0, dirZ: -1, power: 1 });
  settle(game);
  assert.ok(game.lastResult.hit, 'weak flick reaches a marble 12 cm away');
  const tier = hitPoints(game.lastResult.hit.speed);
  assert.equal(game.lastResult.points, tier.points, `points follow the speed tier (speed ${game.lastResult.hit.speed})`);
  assert.ok(tier.points <= 2, 'a weak flick cannot smash');
  assert.equal(p1.powered, false);
  assert.equal(p1.score, 0);
  assert.equal(p0.score, tier.points);
});

test('entering the cave grants the power; the marble is lifted to the rim next turn', () => {
  const game = makeGame();
  midGame(game, { x: 0, z: 0.22 }, { x: 0.6, z: -0.5 });
  const [p0, p1] = game.players;
  const events = [];
  game.on('*', (e) => events.push(e));
  game.shoot({ dirX: 0, dirZ: -1, power: 0.95 });
  settle(game);
  assert.ok(game.lastResult.caveEntries.some((c) => c.player === p0 && c.gained), 'cave entry recorded');
  assert.equal(p0.powered, true);
  assert.ok(game.isInCave(p0.marble), 'marble still rests in the cave');
  assert.equal(game.current, 1, 'turn passes');
  // Opponent misses; back to p0 whose marble must be lifted out of the hole.
  game.shoot({ dirX: 0, dirZ: -1, power: 0.2 });
  settle(game);
  assert.ok(events.some((e) => e.type === 'lift' && e.player === p0), 'lift event');
  assert.equal(game.phase, 'turn');
  assert.equal(game.current, 0);
  assert.ok(!game.isInCave(p0.marble), 'marble out of the cave');
  const d = game.distanceToCave(p0.marble);
  assert.ok(Math.abs(d - (CAVE.radius + p0.marble.r + 0.01)) < 1e-6, `on the rim (${d})`);
  // facing the opponent
  const ax = p0.marble.x - CAVE.x, az = p0.marble.z - CAVE.z;
  const ox = p1.marble.x - CAVE.x, oz = p1.marble.z - CAVE.z;
  assert.ok(ax * ox + az * oz > 0, 'rim spot faces the opponent');
  assert.ok(game.maxSpeed(p0) > 2.5, 'now flicks with power');
});

test('a marble resting in the cave is safe: a touch that leaves it there scores nothing', () => {
  const game = makeGame();
  midGame(game, { x: 0, z: 0.22 }, { x: 0.5, z: 0.5 });
  const [p0, p1] = game.players;
  // p0 rolls into the cave and gets the power
  game.shoot({ dirX: 0, dirZ: -1, power: 0.95 });
  settle(game);
  assert.equal(p0.powered, true);
  assert.ok(game.isInCave(p0.marble));
  assert.equal(game.current, 1);
  // p1 (given the power for a hard flick) taps p0's marble inside the cave from the rim
  p1.powered = true;
  p1.score = 2;
  game.world.placeOnGround(p1.marble, 0, CAVE.radius + p1.marble.r + 0.01);
  game.shoot({ dirX: 0, dirZ: -1, power: 0.2 });
  settle(game);
  const r = game.lastResult;
  assert.ok(r.hit, 'the marbles touched');
  assert.equal(r.safeHit, true, 'victim stayed in the cave');
  assert.equal(r.points, 0);
  assert.equal(p1.score, 2, 'no points for a safe hit');
  assert.equal(p0.powered, true, 'power not stripped');
  assert.equal(r.extraTurn, false, 'no extra turn');
  assert.equal(game.current, 0, 'turn passes');
});

test('knocking a marble out of the cave counts fully', () => {
  const game = makeGame();
  midGame(game, { x: 0, z: 0.22 }, { x: 0.5, z: 0.5 });
  const [p0, p1] = game.players;
  game.shoot({ dirX: 0, dirZ: -1, power: 0.95 });
  settle(game);
  assert.ok(game.isInCave(p0.marble) && p0.powered);
  p0.score = 2;
  p1.powered = true;
  game.world.placeOnGround(p1.marble, 0, 0.35);
  game.shoot({ dirX: 0, dirZ: -1, power: 0.45 });
  assert.equal(game.shot.victimInCaveBefore, true);
  // Drive the physics ourselves, then stage the outcome of a successful
  // knock-out: the victim ends up outside the cave.
  let t = 0;
  while (!game.shot.firstHit && t < 10) {
    game.update(1 / 60);
    t += 1 / 60;
  }
  assert.ok(game.shot.firstHit, 'the marbles collided');
  game.world.placeOnGround(p0.marble, 0.3, -0.2);
  game.world.placeOnGround(p1.marble, 0.02, 0.02);
  settle(game);
  const r = game.lastResult;
  assert.equal(r.safeHit, false, 'victim left the cave: the hit counts');
  assert.ok(r.points > 0, 'scored');
  assert.equal(p0.powered, false, 'knocked out: power stripped');
  assert.equal(p0.score, 1, 'and a point taken');
  assert.equal(r.extraTurn, true, 'shooter goes again');
});

test('a shattered marble is replaced from the start line without the power', () => {
  const game = makeGame();
  midGame(game, { x: 0.3, z: 1.0 }, { x: 0.3, z: 0.9 });
  const [p0, p1] = game.players;
  p0.powered = true;
  p1.powered = true;
  game.forceBreakNext = true;
  game.shoot({ dirX: 0, dirZ: -1, power: 1 });
  settle(game);
  const r = game.lastResult;
  assert.ok(r.hit && r.broken, 'hit and break');
  const loser = r.broken.player;
  assert.equal(loser.marble.active, false);
  assert.equal(loser.inHand, true);
  assert.equal(loser.powered, false);
  assert.equal(loser.marblesBroken, 1);
  if (loser === p0) {
    assert.equal(game.current, 1, 'shooter lost the marble: no extra turn');
  } else {
    assert.equal(game.current, 0, 'shooter still gets the extra turn');
  }
  // The loser's next shot is a throw from the line.
  assert.equal(game.shotKind(loser), 'throw');
  assert.ok(game.handPosition(loser).z === START_LINE.z);
});

test('reaching the target score ends the game', () => {
  const game = makeGame({ targetScore: 3 });
  midGame(game, { x: 0.3, z: 1.0 }, { x: 0.3, z: 0.88 });
  const [p0] = game.players;
  p0.powered = true;
  let over = null;
  game.on('over', (e) => (over = e));
  game.shoot({ dirX: 0, dirZ: -1, power: 1 });
  settle(game);
  assert.ok(p0.score >= 3);
  assert.equal(game.phase, 'over');
  assert.equal(over.winner, p0);
  assert.equal(game.canShoot(), false);
});

test('just-for-fun mode never ends by itself but can be ended', () => {
  const game = makeGame({ targetScore: null });
  midGame(game, { x: 0.3, z: 1.0 }, { x: 0.3, z: 0.88 });
  game.players[0].powered = true;
  game.shoot({ dirX: 0, dirZ: -1, power: 1 });
  settle(game);
  assert.notEqual(game.phase, 'over');
  game.endGame();
  assert.equal(game.phase, 'over');
  assert.equal(game.winner, game.players[0]);
});

test('AI (hard): un-powered near the cave plans a shot that drops in', () => {
  const game = makeGame();
  midGame(game, { x: 0.7, z: 0.9 }, { x: -0.06, z: 0.24 }, 1);
  const ai = game.players[1];
  const plan = planShotSync(game, ai, { rng: createRng(5), level: PERFECT });
  assert.ok(plan.best.outcome.meInCave, 'best candidate ends in the cave');
  game.shoot(plan);
  settle(game);
  assert.equal(ai.powered, true, 'AI entered the cave');
});

test('AI (hard): powered player plans a hit on the opponent', () => {
  const game = makeGame();
  midGame(game, { x: 0.2, z: 0.6 }, { x: 0.2, z: 1.3 }, 1);
  const ai = game.players[1];
  ai.powered = true;
  const plan = planShotSync(game, ai, { rng: createRng(9), level: PERFECT });
  assert.ok(plan.best.outcome.firstHit, 'best candidate hits');
  game.shoot(plan);
  settle(game);
  assert.ok(game.lastResult.hit, 'AI hit the opponent');
  assert.ok(ai.score > 0);
});

test('AI: opening throw lands near the cave', () => {
  const game = makeGame();
  game.start();
  game.current = 1; // let the AI throw first for the test
  const ai = game.players[1];
  const plan = planShotSync(game, ai, { rng: createRng(3), level: PERFECT });
  assert.equal(plan.elevation > 0, true);
  assert.ok(plan.best.outcome.dMeCave < 0.15, `best planned landing ${plan.best.outcome.dMeCave}`);
  game.shoot(plan);
  settle(game);
  assert.ok(game.distanceToCave(ai.marble) < 0.3, `AI throw ended ${game.distanceToCave(ai.marble)} from the cave`);
});

test('flicks scatter a little (more for a hard flick), lobs do not', () => {
  const angles = [];
  for (let seed = 1; seed <= 40; seed++) {
    const game = makeGame({ rng: createRng(seed), scatter: 1 });
    midGame(game, { x: 0, z: 1.6 }, { x: 0.5, z: 0.4 }, 0);
    game.players[0].powered = true;
    game.shoot({ dirX: 0, dirZ: -1, power: 1 });
    const m = game.players[0].marble;
    angles.push(Math.atan2(m.vx, -m.vz));
  }
  const rms = Math.sqrt(angles.reduce((s, a) => s + a * a, 0) / angles.length) * (180 / Math.PI);
  assert.ok(rms > 0.8 && rms < 4, `full-power scatter rms ${rms.toFixed(2)} deg`);
  const game = makeGame({ rng: createRng(1), scatter: 1 });
  game.start();
  game.shoot({ dirX: 0, dirZ: -1, power: 0.8, elevation: 45 });
  assert.equal(game.players[0].marble.vx, 0, 'a lob is not scattered');
});
