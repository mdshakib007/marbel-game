// Game rules and turn flow. Pure logic: no DOM, no three.js. The presentation
// layer listens to events and reads state; it never changes the rules.
//
// Flow
//   opening  : each player lobs their marble from the start line at the cave.
//              Whoever ends closest (or inside) moves first.
//   turn     : the current player flicks (weak without the power, hard with it)
//   shot     : physics runs until everything rests, then the shot is resolved:
//                - first marble-to-marble contact scores for the shooter
//                  (points by closing speed); a powered victim loses the power
//                  and 1 point; a successful hit earns another turn
//                - a marble resting in the cave grants its owner the power
//                - a tiny chance that a hit shatters one of the marbles; the
//                  owner lobs a new one from the start line (power lost)
//   placing  : a marble that entered the cave is lifted to the rim at the
//              start of its owner's turn (facing the opponent)
//   over     : someone reached the target score (or the game was ended)

import {
  BREAK_CHANCE, CAVE, HAND_HEIGHT, MARBLE_SIZES, PHYSICS, SHOT, START_LINE,
  hitPoints, sizeSpeedFactor,
} from './config.js';
import { World, createMarble } from './physics.js';

const SETTLE_DELAY = 0.8; // seconds to let the result sink in before resolving
const LIFT_DURATION = 0.9;
const STALL_TIME = 1.5; // seconds of barely-moving marbles before forcing rest

export class Emitter {
  constructor() {
    this._l = new Map();
  }
  on(type, fn) {
    if (!this._l.has(type)) this._l.set(type, new Set());
    this._l.get(type).add(fn);
    return () => this._l.get(type).delete(fn);
  }
  emit(type, data = {}) {
    const set = this._l.get(type);
    if (set) for (const fn of [...set]) fn(data);
    const all = this._l.get('*');
    if (all) for (const fn of [...all]) fn({ type, ...data });
  }
}

export class Game extends Emitter {
  /**
   * @param {object} opts
   * @param {import('./terrain.js').Terrain} opts.terrain
   * @param {Array<{name:string,isAI:boolean,size:string,style:string,color:string,aiLevel?:string}>} opts.players
   * @param {number|null} opts.targetScore  null = just for fun
   * @param {() => number} [opts.rng]
   * @param {number} [opts.scatter]  flick launch scatter, 1 = as configured, 0 = exact shots (tests)
   */
  constructor({ terrain, players, targetScore = null, rng = Math.random, world = null, scatter = 1 }) {
    super();
    this.terrain = terrain;
    this.world = world || new World(terrain);
    this.rng = rng;
    this.scatter = scatter;
    this.targetScore = targetScore;
    this.phase = 'setup';
    this.current = 0;
    this.openingIndex = 0;
    this.turnNumber = 0;
    this.shot = null;
    this.placing = null;
    this.winner = null;
    this.forceBreakNext = false; // debug hook
    this.lastResult = null;
    this.history = [];

    this.players = players.map((p, i) => {
      const size = MARBLE_SIZES[p.size] || MARBLE_SIZES.medium;
      const marble = this.world.addMarble(createMarble({ id: i + 1, radius: size.radius }));
      marble.active = false;
      return {
        index: i,
        name: p.name,
        isAI: !!p.isAI,
        aiLevel: p.aiLevel || 'medium',
        size: size.key,
        style: p.style,
        color: p.color,
        marble,
        score: 0,
        powered: false,
        inHand: true,
        handX: p.handX ?? (i === 0 ? -0.12 : 0.12),
        caveEntries: 0,
        hits: 0,
        marblesLost: 0,
        marblesBroken: 0,
      };
    });
  }

  // ---------------------------------------------------------------- queries

  get activePlayer() {
    return this.players[this.current];
  }

  opponentOf(player) {
    return this.players[(player.index + 1) % this.players.length];
  }

  /** 'throw' (lob from the line) or 'flick' (finger shot where the marble lies). */
  shotKind(player = this.activePlayer) {
    return player.inHand ? 'throw' : 'flick';
  }

  /** Max launch speed for the player's next shot (m/s). */
  maxSpeed(player = this.activePlayer) {
    const f = sizeSpeedFactor(player.marble.r);
    if (player.inHand) return SHOT.throwMax * f;
    return (player.powered ? SHOT.flickPowerMax : SHOT.flickWeakMax) * f;
  }

  /** Where the marble sits while in the player's hand on the start line. */
  handPosition(player = this.activePlayer) {
    const x = clamp(player.handX, START_LINE.xMin, START_LINE.xMax);
    return { x, y: this.terrain.height(x, START_LINE.z) + HAND_HEIGHT, z: START_LINE.z };
  }

  setHandX(player, x) {
    player.handX = clamp(x, START_LINE.xMin, START_LINE.xMax);
  }

  /** Position the shot starts from (hand or where the marble rests). */
  shotOrigin(player = this.activePlayer) {
    if (player.inHand) return this.handPosition(player);
    const m = player.marble;
    return { x: m.x, y: m.y, z: m.z };
  }

  canShoot() {
    return (this.phase === 'opening' || this.phase === 'turn') && !this.placing;
  }

  isInCave(marble) {
    return marble.active && this.terrain.isInCave(marble.x, marble.z);
  }

  distanceToCave(marble) {
    return Math.hypot(marble.x - CAVE.x, marble.z - CAVE.z);
  }

  // ---------------------------------------------------------------- flow

  start() {
    this.phase = 'opening';
    this.openingIndex = 0;
    this.current = 0;
    for (const p of this.players) {
      p.marble.active = false;
      p.inHand = true;
    }
    this.emit('phase', { phase: this.phase });
    this.emit('turn', { player: this.activePlayer, kind: 'throw', opening: true });
  }

  /**
   * Fire the current player's shot.
   * @param {{dirX:number, dirZ:number, power:number, elevation?:number}} s
   *   dir: horizontal unit vector, power in [0,1], elevation in degrees (throws)
   */
  shoot({ dirX, dirZ, power, elevation = SHOT.throwAngleDefault }) {
    if (!this.canShoot()) return false;
    const player = this.activePlayer;
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-9) return false;
    dirX /= len;
    dirZ /= len;
    power = clamp(power, 0, 1);
    if (power < SHOT.minPower) return false;
    const speed = power * this.maxSpeed(player);
    const kind = this.shotKind(player);
    const m = player.marble;
    const origin = this.shotOrigin(player);

    if (kind === 'throw') {
      const el = (clamp(elevation, SHOT.throwAngleMin, SHOT.throwAngleMax) * Math.PI) / 180;
      const horiz = speed * Math.cos(el);
      this.world.launch(m, dirX * horiz, speed * Math.sin(el), dirZ * horiz, origin);
      player.inHand = false;
    } else {
      // Launch scatter: a finger flick never leaves exactly along the aim.
      const sigma = (this.scatter * (SHOT.scatterBase + SHOT.scatterPerPower * power) * Math.PI) / 180;
      const ang = sigma > 0 ? gaussian(this.rng) * sigma : 0;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const fx = dirX * cs - dirZ * sn;
      const fz = dirX * sn + dirZ * cs;
      // A finger strikes slightly below the marble's centre line: a small hop.
      this.world.wake(m);
      this.world.launch(m, fx * speed * 0.998, speed * 0.06, fz * speed * 0.998);
    }
    this.world.wakeNear(m.x, m.z, 0.05, m);

    const victim = this.opponentOf(player);
    this.shot = {
      player,
      kind,
      power,
      speed,
      dirX,
      dirZ,
      elevation,
      firstHit: null,
      hits: 0,
      events: [],
      time: 0,
      restTimer: 0,
      opening: this.phase === 'opening',
      origin,
      /** A marble resting in the cave is safe unless knocked out of it. */
      victimInCaveBefore: this.isInCave(victim.marble),
    };
    this.phase = 'shot';
    this.emit('phase', { phase: this.phase });
    this.emit('shot', { player, kind, power, speed });
    return true;
  }

  /** Advance the game by dt seconds (physics + timers). */
  update(dt) {
    if (this.placing) {
      this.placing.t += dt;
      if (this.placing.t >= this.placing.duration) this._finishPlacing();
      return;
    }
    if (this.phase !== 'shot') return;
    const shot = this.shot;
    const events = this.world.step(dt, []);
    shot.time += dt;
    for (const e of events) {
      if (e.type === 'hit') {
        shot.hits++;
        if (!shot.firstHit) shot.firstHit = e;
      }
      e.shot = shot;
    }
    if (events.length) this.emit('physics', { events, shot });

    // Stall guard: everything creeping below 2 cm/s for a while counts as rest.
    let crawling = true;
    for (const m of this.world.marbles) {
      if (m.active && !m.asleep && Math.hypot(m.vx, m.vy, m.vz) > 0.02) crawling = false;
    }
    shot.crawlTime = crawling ? (shot.crawlTime || 0) + dt : 0;

    if (this.world.allAtRest()) {
      shot.restTimer += dt;
      if (shot.restTimer >= SETTLE_DELAY) this._resolveShot();
    } else if (shot.time > PHYSICS.maxShotTime || shot.crawlTime > STALL_TIME) {
      for (const m of this.world.marbles) {
        if (m.active) {
          m.vx = m.vy = m.vz = 0;
          m.wx = m.wy = m.wz = 0;
          m.asleep = true;
        }
      }
      this._resolveShot();
    }
  }

  _resolveShot() {
    const shot = this.shot;
    const shooter = shot.player;
    const victim = this.opponentOf(shooter);
    const result = {
      shooter, victim,
      kind: shot.kind,
      opening: shot.opening,
      hit: null,
      safeHit: false,
      points: 0,
      powerStripped: false,
      pointStripped: false,
      caveEntries: [],
      broken: null,
      extraTurn: false,
      winner: null,
    };

    // 1. the hit (only the first contact of the shot counts). A marble that
    //    was resting in the cave and is still there afterwards is 'safe': the
    //    touch scores nothing. Knock it out of the cave and it counts fully.
    if (shot.firstHit) {
      const tier = hitPoints(shot.firstHit.speed);
      result.hit = { speed: shot.firstHit.speed, tier };
      result.safeHit = shot.victimInCaveBefore && this.isInCave(victim.marble);
      if (!result.safeHit) {
        result.points = tier.points;
        shooter.score += tier.points;
        shooter.hits++;
        if (victim.powered) {
          victim.powered = false;
          result.powerStripped = true;
          if (victim.score > 0) {
            victim.score -= 1;
            result.pointStripped = true;
          }
        }
      }
      // 2. breakage (glass does not care about the rules)
      const roll = this.rng();
      if (this.forceBreakNext || roll < BREAK_CHANCE) {
        this.forceBreakNext = false;
        const unlucky = this.rng() < 0.5 ? shooter : victim;
        result.broken = this._breakMarble(unlucky);
      }
    }

    // 3. cave entries (either marble may have ended up inside)
    for (const p of this.players) {
      if (this.isInCave(p.marble)) {
        if (!p.powered) {
          p.powered = true;
          p.caveEntries++;
          result.caveEntries.push({ player: p, gained: true });
        } else {
          result.caveEntries.push({ player: p, gained: false });
        }
      }
    }

    // 4. win check
    if (this.targetScore != null) {
      const leaders = this.players.filter((p) => p.score >= this.targetScore);
      if (leaders.length) {
        leaders.sort((a, b) => b.score - a.score);
        result.winner = leaders[0];
      }
    }

    // Extra turn after a scoring hit (unless the shooter's own marble shattered).
    if (!shot.opening && result.hit && !result.safeHit && shooter.marble.active && !result.winner) result.extraTurn = true;

    this.lastResult = result;
    this.history.push(summarise(result));
    this.shot = null;
    this.emit('resolved', result);

    if (result.winner) {
      this.winner = result.winner;
      this.phase = 'over';
      this.emit('phase', { phase: this.phase });
      this.emit('over', { winner: result.winner, players: this.players });
      return;
    }

    if (shot.opening) {
      this.openingIndex++;
      if (this.openingIndex < this.players.length) {
        this.current = this.openingIndex;
        this.phase = 'opening';
        this.emit('phase', { phase: this.phase });
        this.emit('turn', { player: this.activePlayer, kind: 'throw', opening: true });
        return;
      }
      // Both have thrown: closest to the cave starts.
      const order = this.players
        .map((p) => ({ p, d: this.isInCave(p.marble) ? -1 : p.marble.active ? this.distanceToCave(p.marble) : 99 }))
        .sort((a, b) => a.d - b.d || a.p.index - b.p.index);
      this.current = order[0].p.index;
      this.emit('opening-done', { order: order.map((o) => o.p), distances: order.map((o) => o.d) });
      this._beginTurn();
      return;
    }

    if (!result.extraTurn) this.current = victim.index;
    this._beginTurn();
  }

  _breakMarble(player) {
    const m = player.marble;
    const where = { x: m.x, y: m.y, z: m.z };
    m.active = false;
    m.asleep = true;
    m.vx = m.vy = m.vz = 0;
    player.inHand = true;
    player.powered = false;
    player.marblesBroken++;
    this.world.wakeNear(where.x, where.z, 0.06, m);
    return { player, where };
  }

  _beginTurn() {
    this.turnNumber++;
    const p = this.activePlayer;
    if (this.isInCave(p.marble)) {
      const m = p.marble;
      const to = this._rimSpotFor(p);
      this.placing = {
        player: p,
        from: { x: m.x, y: m.y, z: m.z },
        to,
        t: 0,
        duration: LIFT_DURATION,
      };
      this.phase = 'placing';
      this.emit('phase', { phase: this.phase });
      this.emit('lift', { player: p, from: this.placing.from, to });
      return;
    }
    this.phase = 'turn';
    this.emit('phase', { phase: this.phase });
    this.emit('turn', { player: p, kind: this.shotKind(p), opening: false, extra: this.lastResult?.extraTurn });
  }

  _finishPlacing() {
    const { player, to } = this.placing;
    this.placing = null;
    this.world.placeOnGround(player.marble, to.x, to.z);
    this.phase = 'turn';
    this.emit('phase', { phase: this.phase });
    this.emit('placed', { player });
    this.emit('turn', { player, kind: this.shotKind(player), opening: false, extra: this.lastResult?.extraTurn });
  }

  /** A free spot on the cave's rim, facing the opponent if possible. */
  _rimSpotFor(player) {
    const m = player.marble;
    const opp = this.opponentOf(player);
    let ax = 0;
    let az = 1; // default: face the start line
    if (opp.marble.active && !this.isInCave(opp.marble)) {
      ax = opp.marble.x - CAVE.x;
      az = opp.marble.z - CAVE.z;
      const l = Math.hypot(ax, az) || 1;
      ax /= l;
      az /= l;
    }
    const dist = CAVE.radius + m.r + 0.01;
    const base = Math.atan2(az, ax);
    for (let k = 0; k < 12; k++) {
      const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
      const x = CAVE.x + Math.cos(ang) * dist;
      const z = CAVE.z + Math.sin(ang) * dist;
      let free = true;
      for (const o of this.world.marbles) {
        if (o === m || !o.active) continue;
        if (Math.hypot(o.x - x, o.z - z) < o.r + m.r + 0.004) free = false;
      }
      if (free) return { x, z };
    }
    return { x: CAVE.x + ax * dist, z: CAVE.z + az * dist };
  }

  /** End the game early (no target, or the player gives up). */
  endGame() {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.shot = null;
    this.placing = null;
    const sorted = [...this.players].sort((a, b) => b.score - a.score);
    this.winner = sorted[0].score > sorted[1].score ? sorted[0] : null;
    this.emit('phase', { phase: this.phase });
    this.emit('over', { winner: this.winner, players: this.players, ended: true });
  }
}

function summarise(r) {
  return {
    shooter: r.shooter.index,
    kind: r.kind,
    opening: r.opening,
    hitSpeed: r.hit ? +r.hit.speed.toFixed(3) : null,
    safeHit: r.safeHit,
    points: r.points,
    powerStripped: r.powerStripped,
    caveEntries: r.caveEntries.map((c) => c.player.index),
    broken: r.broken ? r.broken.player.index : null,
    extraTurn: r.extraTurn,
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
