// Entry point: wires the rules (game.js) and physics to the renderer, the
// computer player, input, audio, effects and the HUD.

import * as THREE from 'three';
import { AI_LEVELS, CAVE, MARBLE_COLORS, MARBLE_SIZES, MARBLE_STYLES, SHOT, START_LINE } from './config.js';
import { Terrain } from './terrain.js';
import { Game } from './game.js';
import { planShot } from './ai.js';
import { LAYER_MINIMAP, buildScene, createRenderer } from './render/scene.js';
import { MarbleView } from './render/marbles.js';
import { Effects } from './render/effects.js';
import { AimGuide } from './render/aim.js';
import { CameraRig } from './render/camera.js';
import { AudioEngine } from './audio.js';
import { InputController } from './input.js';
import { UI } from './ui.js';

const DEBUG = new URLSearchParams(location.search).has('debug');

class App {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.renderer = createRenderer(this.canvas);
    this.renderer.shadowMap.autoUpdate = false;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.004, 90);
    this.ui = new UI();
    this.audio = new AudioEngine();
    this.clock = new THREE.Clock();
    this.state = 'setup';
    this.paused = false;
    this.game = null;
    this.views = [];
    this.previewView = null;
    this.ai = null;
    this.slowMo = false;
    this.autoplay = false;
    this.seed = null;
    this.lastSetup = null;
    this.rollSmoothing = new Map();

    this._buildWorld(this.ui.setupValues().seed);
    this.rig = new CameraRig(this.camera, this.terrain);
    this.input = new InputController({ canvas: this.canvas, camera: this.camera, rig: this.rig, audio: this.audio });
    this._wireUI();
    this._wireInput();

    window.addEventListener('resize', () => this._resize());
    this._resize();
    this.ui.setSoundMuted(this.audio.muted);
    this.ui.showDebug(DEBUG);
    this._showSetup();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ------------------------------------------------------------ world

  _buildWorld(seed) {
    if (this.scene) {
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose();
            m.dispose();
          }
        }
      });
    }
    this.seed = seed;
    this.terrain = new Terrain({ seed });
    const parts = buildScene(this.renderer, this.terrain);
    this.scene = parts.scene;
    this.minimap = parts.minimap;
    this.effects = new Effects(this.scene, this.terrain);
    this.aim = new AimGuide(this.scene, this.terrain);
    if (this.rig) this.rig.terrain = this.terrain;
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ setup

  _showSetup() {
    this.state = 'setup';
    this.paused = false;
    this.ai = null;
    this.input.setEnabled(false);
    this.aim.hide();
    this.aim.clearHighlight();
    for (const v of this.views) v.removeFrom(this.scene);
    this.views = [];
    this.game = null;
    this.ui.showHud(false);
    this.ui.showSetup();
    this.ui.setDebugText('');
    this._updatePreview(this.ui.setupValues(), true);
  }

  _updatePreview(values, immediate = false) {
    if (values.seed !== this.seed) {
      this._buildWorld(values.seed);
      if (this.previewView) this.previewView = null;
    }
    const size = MARBLE_SIZES[values.size] || MARBLE_SIZES.medium;
    const key = `${values.size}-${values.style}-${values.color}`;
    if (!this.previewView || this.previewView.key !== key) {
      if (this.previewView) {
        this.previewView.removeFrom(this.scene);
        this.previewView.dispose();
      }
      this.previewView = new MarbleView({ radius: size.radius, style: values.style, color: values.color, seed: 3 });
      this.previewView.key = key;
      this.previewView.addTo(this.scene);
    }
    const x = 0.35;
    const z = START_LINE.z - 0.15;
    const y = this.terrain.surfaceForRadius(x, z, size.radius, { h: 0 }).h;
    this.previewView.setPosition(x, y, z);
    this.rig.setTopView(false);
    this.rig.frame({ x, y, z }, { x: x - 0.4, z: z - 1.2 }, { dist: size.radius * 9 + 0.03, pitch: 0.32, immediate });
  }

  _startGame(values) {
    this.lastSetup = values;
    if (values.seed !== this.seed) this._buildWorld(values.seed);
    if (this.previewView) {
      this.previewView.removeFrom(this.scene);
      this.previewView.dispose();
      this.previewView = null;
    }
    // The computer picks its own marble: a different colour and (usually) a
    // different style, mostly the popular medium size.
    const colors = Object.keys(MARBLE_COLORS).filter((c) => c !== values.color);
    const styles = Object.keys(MARBLE_STYLES).filter((s) => s !== values.style);
    const r = Math.random();
    const aiSize = r < 0.65 ? 'medium' : r < 0.85 ? 'small' : 'big';
    const players = [
      { name: values.name, isAI: false, size: values.size, style: values.style, color: values.color, handX: -0.12 },
      {
        name: 'Computer',
        isAI: true,
        aiLevel: values.level,
        size: aiSize,
        style: styles[Math.floor(Math.random() * styles.length)],
        color: colors[Math.floor(Math.random() * colors.length)],
        handX: 0.12 + (Math.random() - 0.5) * 0.4,
      },
    ];
    this.game = new Game({ terrain: this.terrain, players, targetScore: values.targetScore, rng: Math.random });
    this.views = this.game.players.map(
      (p, i) => new MarbleView({ radius: p.marble.r, style: p.style, color: p.color, seed: 3 + i }),
    );
    for (const v of this.views) {
      v.addTo(this.scene);
      v.setVisible(false);
    }
    this._subscribe();
    this.ui.setPlayers(this.game.players);
    this.ui.hideSetup();
    this.ui.hideOver();
    this.ui.hideMenu();
    this.ui.showHud(true);
    this.ui.updateHud(this.game);
    this.ui.setPower(0, '');
    this.state = 'playing';
    this.paused = false;
    this.rig.setTopView(false);
    this.ui.setTopOn(false);
    this.input.setElevation(SHOT.throwAngleDefault);
    this.game.start();
  }

  // ------------------------------------------------------------ wiring

  _wireUI() {
    const ui = this.ui;
    ui.on('preview', (v) => this.state === 'setup' && this._updatePreview(v));
    ui.on('start', (v) => {
      this.audio.unlock();
      this._startGame(v);
    });
    ui.on('resume', () => this._togglePause(false));
    ui.on('endGame', () => {
      ui.hideMenu();
      this.paused = false;
      if (this.game) this.game.endGame();
    });
    ui.on('newGame', () => this._showSetup());
    ui.on('rematch', () => this._startGame(this.lastSetup || ui.setupValues()));
    ui.on('toggleTop', () => this._toggleTop());
    ui.on('toggleSound', () => this._toggleSound());
    ui.on('menu', () => this._togglePause());
    ui.on('elevation', (deg) => {
      this.input.setElevation(deg);
      this.input.refresh();
    });
    ui.on('handX', (x) => {
      if (!this.game || !this.game.canShoot()) return;
      const p = this.game.activePlayer;
      if (p.isAI || !p.inHand) return;
      this.game.setHandX(p, x);
      this._refreshHumanContext();
      if (!this.rig.topView) this.rig.frame(this.game.shotOrigin(p), CAVE, { dist: 0.7, pitch: 0.46 });
    });
    ui.on('debug', (what) => this._debug(what));
  }

  _wireInput() {
    const input = this.input;
    input.onAim = (aim) => this._onAim(aim);
    input.onShoot = (s) => {
      if (!this.game || !this.game.canShoot() || this.game.activePlayer.isAI) return;
      this.game.shoot(s);
    };
    input.onKey = (key, e) => {
      if (key === 'elevation') {
        this.ui.setElevation(e);
        return;
      }
      if (this.state !== 'playing') return;
      if (key === 't' || key === 'T') this._toggleTop();
      else if (key === 'm' || key === 'M') this._toggleSound();
      else if (key === 'Escape') this._togglePause();
    };
  }

  _toggleTop() {
    this.rig.setTopView(!this.rig.topView);
    this.ui.setTopOn(this.rig.topView);
    // From high above the marbles are a couple of pixels: show the big
    // mini-map markers in the main view too.
    if (this.rig.topView) this.camera.layers.enable(LAYER_MINIMAP);
    else this.camera.layers.disable(LAYER_MINIMAP);
    this.input.refresh();
  }

  _toggleSound() {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
    this.ui.setSoundMuted(this.audio.muted);
  }

  /** Open (true) / close (false) the pause menu; no argument toggles it. */
  _togglePause(wantPaused) {
    if (this.state !== 'playing') return;
    const open = wantPaused != null ? wantPaused : !this.ui.menuOpen;
    if (open) {
      this.input.cancel();
      this.input.setEnabled(false);
      this.ui.showMenu();
      this.paused = true;
    } else {
      this.ui.hideMenu();
      this.paused = false;
      this.clock.getDelta();
      this._updateInputEnabled();
    }
  }

  /** The human may aim only on their own turn, unpaused, not in autoplay. */
  _updateInputEnabled() {
    const g = this.game;
    const ok = !!g && !this.paused && g.canShoot() && !g.activePlayer.isAI && !this.autoplay && !this.ai;
    this.input.setEnabled(ok);
  }

  _subscribe() {
    const g = this.game;
    g.on('turn', (e) => this._onTurn(e));
    g.on('shot', (e) => this._onShot(e));
    g.on('physics', (e) => this._onPhysics(e));
    g.on('resolved', (r) => this._onResolved(r));
    g.on('opening-done', (e) => {
      const first = e.order[0];
      const text = first === g.players[0] ? "You're closest to the cave — you move first" : `${first.name} is closest to the cave and moves first`;
      this.ui.toast(text, { kind: first === g.players[0] ? 'good' : 'bad', life: 3 });
    });
    g.on('lift', (e) => {
      this.audio.blip(true);
      this.ui.toast(`${e.player.name}'s marble is lifted out of the cave to the rim`, { life: 2.4 });
      this.ui.setHint('Lifting the marble out of the cave…');
    });
    g.on('over', (e) => this._onOver(e));
  }

  // ------------------------------------------------------------ game events

  _humanHint(player, kind) {
    if (kind === 'throw') {
      return 'Drag back from your marble and release to lob it at the cave. Wheel / ↑↓ changes the angle.';
    }
    if (player.powered) return "You have the POWER: pull back hard and knock the computer's marble away from the cave!";
    return 'No power yet: pull back from your marble for a gentle flick. Get into the cave to earn the power.';
  }

  _onTurn({ player, kind, opening, extra }) {
    const game = this.game;
    this.ui.updateHud(game);
    this.aim.hide();
    this.rollSmoothing.clear();
    const origin = game.shotOrigin(player);
    const opp = game.opponentOf(player);
    const toward = player.powered && kind === 'flick' && opp.marble.active ? opp.marble : CAVE;
    const dist = kind === 'throw' ? 0.7 : 0.38;
    const pitch = kind === 'throw' ? 0.46 : 0.5;
    this.rig.frame(origin, toward, { dist, pitch });

    if (player.isAI) {
      this.input.setEnabled(false);
      this.input.setContext(null);
      this.aim.clearHighlight();
      this.ui.setTurnText(opening ? `${player.name}'s throw` : extra ? `${player.name} shoots again` : `${player.name}'s turn`);
      this.ui.setHint(kind === 'throw' ? 'The computer lobs its marble from the line…' : 'The computer is lining up its flick…');
      this.ui.showElevation(false);
      this.ui.showHandX(false);
      this.ui.setPower(0, '');
      if (kind === 'throw') game.setHandX(player, 0.1 + (Math.random() - 0.5) * 0.5);
      this._startAI(player, AI_LEVELS[player.aiLevel]);
      return;
    }

    this.ui.setTurnText(opening ? 'Your throw' : extra ? 'Hit! Your turn again' : 'Your turn');
    this.ui.setHint(this._humanHint(player, kind));
    this.ui.showElevation(kind === 'throw');
    this.ui.showHandX(kind === 'throw');
    this.ui.setHandX(player.handX);
    this.ui.setElevation(this.input.elevation);
    this.ui.setPower(0, kind === 'throw' ? 'Lob' : player.powered ? 'POWER flick' : 'Weak flick');
    this._refreshHumanContext();
    if (this.autoplay) this._startAI(player, AI_LEVELS.medium);
    else this._updateInputEnabled();
  }

  _refreshHumanContext() {
    const game = this.game;
    const player = game.activePlayer;
    const origin = game.shotOrigin(player);
    this.input.setContext({
      origin,
      radius: player.marble.r,
      kind: game.shotKind(player),
      maxSpeed: game.maxSpeed(player),
    });
    this.aim.setHighlight(origin, player.marble.r, MARBLE_COLORS[player.color].hex);
    this.input.refresh();
  }

  _onShot({ player, kind }) {
    this.input.setEnabled(false);
    this.input.setContext(null);
    this.aim.hide();
    this.aim.clearHighlight();
    this.ui.showElevation(false);
    this.ui.showHandX(false);
    this.ui.setHint(kind === 'throw' ? 'Flying…' : 'Rolling…');
    this.ui.setThinking(false);
    if (kind === 'throw') this.audio.whoosh();
    this.rig.follow(player.marble);
  }

  _onPhysics({ events }) {
    for (const e of events) {
      if (e.type === 'hit') {
        const r = Math.min(e.a.r, e.b.r);
        this.audio.hit(e.speed, r);
        this.effects.hitSpark(e.x, e.y, e.z, Math.min(1, e.speed / 2.6));
      } else if (e.type === 'land') {
        if (e.soft) continue;
        this.audio.thud(e.speed, e.marble.r);
        if (e.speed > 0.35) this.effects.dustPuff(e.x, e.y - e.marble.r + 0.002, e.z, Math.min(1, e.speed / 4));
      } else if (e.type === 'wall') {
        this.audio.wall(e.speed);
        if (e.speed > 0.5) this.effects.dustPuff(e.x, e.y, e.z, Math.min(1, e.speed / 3), 6);
      }
    }
  }

  _onResolved(r) {
    const ui = this.ui;
    const you = this.game.players[0];
    if (r.hit && r.safeHit) {
      ui.toast(`${r.victim === you ? 'Your' : `${r.victim.name}'s`} marble is safe inside the cave — no points`, { life: 3 });
    } else if (r.hit) {
      const mine = r.shooter === you;
      ui.toast(`${mine ? 'You' : r.shooter.name} hit ${mine ? "the computer's" : 'your'} marble: ${r.hit.tier.label} (${r.hit.speed.toFixed(1)} m/s) +${r.points}`, {
        kind: mine ? 'good' : 'bad',
        life: 3,
        big: r.points >= 3,
      });
      if (r.powerStripped) {
        ui.toast(`${r.victim.name} lost the POWER${r.pointStripped ? ' and 1 point' : ''}`, { kind: r.victim === you ? 'bad' : 'good', life: 3 });
      }
    }
    for (const c of r.caveEntries) {
      if (c.gained) {
        this.audio.plunk();
        this.effects.caveDust(CAVE.x, this.terrain.caveRimHeight() + 0.003, CAVE.z);
        ui.toast(`${c.player.name} entered the cave — ${c.player === you ? 'you have' : 'it has'} the POWER!`, { kind: c.player === you ? 'good' : 'bad', life: 3.2, big: true });
      } else {
        this.audio.plunk();
        ui.toast(`${c.player.name} is in the cave again`, { life: 2 });
      }
    }
    if (r.broken) {
      const p = r.broken.player;
      const w = r.broken.where;
      this.audio.shatter();
      this.effects.shatter(w.x, w.y, w.z, MARBLE_COLORS[p.color].hex, p.marble.r);
      this.views[p.index].setVisible(false);
      const whose = p === you ? 'Your' : `${p.name}'s`;
      ui.toast(`${whose} marble SHATTERED! A new one must be thrown from the line.`, { kind: 'bad', life: 4.5, big: true });
    }
    if (r.extraTurn && !r.winner) {
      ui.toast(`${r.shooter === you ? 'You shoot' : `${r.shooter.name} shoots`} again`, { life: 2 });
    }
    ui.updateHud(this.game);
  }

  _onOver({ winner, players, ended }) {
    this.input.setEnabled(false);
    this.input.setContext(null);
    this.aim.hide();
    this.aim.clearHighlight();
    this.ai = null;
    this.ui.setThinking(false);
    this.ui.updateHud(this.game);
    this.ui.setTurnText('Game over');
    this.ui.setHint('');
    if (winner === players[0]) this.audio.fanfare();
    else if (winner) this.audio.sad();
    setTimeout(() => this.ui.showOver({ winner, players, ended }), 600);
  }

  // ------------------------------------------------------------ AI

  _startAI(player, level) {
    this.input.setEnabled(false);
    this.ai = {
      player,
      planner: planShot(this.game, player, { level }),
      delay: 1.0,
      result: null,
      shown: false,
      showTimer: 0,
      thinking: false,
    };
  }

  _advanceAI(dt) {
    const ai = this.ai;
    if (!ai || !this.game || !this.game.canShoot()) return;
    ai.delay -= dt;
    if (ai.delay > 0) return;
    if (!ai.result) {
      if (!ai.thinking) {
        ai.thinking = true;
        this.ui.setThinking(true);
      }
      const t0 = performance.now();
      while (performance.now() - t0 < 7) {
        const r = ai.planner.next();
        if (r.done) {
          ai.result = r.value;
          break;
        }
      }
      if (!ai.result) return;
      this.ui.setThinking(false);
    }
    if (!ai.shown) {
      ai.shown = true;
      ai.showTimer = 1.2;
      const origin = this.game.shotOrigin(ai.player);
      const radius = ai.player.marble.r;
      const kind = this.game.shotKind(ai.player);
      this.aim.setHighlight(origin, radius, MARBLE_COLORS[ai.player.color].hex);
      if (kind === 'throw') {
        this.aim.showThrow({ origin, dirX: ai.result.dirX, dirZ: ai.result.dirZ, power: ai.result.power, maxSpeed: this.game.maxSpeed(ai.player), elevation: ai.result.elevation, radius });
      } else {
        this.aim.showFlick({ origin, dirX: ai.result.dirX, dirZ: ai.result.dirZ, power: ai.result.power, radius });
      }
      this.ui.setPower(ai.result.power, `${(ai.result.power * this.game.maxSpeed(ai.player)).toFixed(1)} m/s`);
      return;
    }
    ai.showTimer -= dt;
    if (ai.showTimer <= 0) {
      const res = ai.result;
      this.ai = null;
      this.game.shoot(res);
    }
  }

  // ------------------------------------------------------------ aiming

  _onAim(aim) {
    const ctx = this.input.context;
    if (!aim || !ctx) {
      this.aim.hide();
      this.ui.setPower(0, null);
      return;
    }
    const player = this.game.activePlayer;
    if (ctx.kind === 'throw') {
      this.aim.showThrow({ origin: ctx.origin, dirX: aim.dirX, dirZ: aim.dirZ, power: aim.power, maxSpeed: ctx.maxSpeed, elevation: this.input.elevation, radius: ctx.radius });
    } else {
      this.aim.showFlick({ origin: ctx.origin, dirX: aim.dirX, dirZ: aim.dirZ, power: aim.power, radius: ctx.radius });
    }
    if (aim.pull) this.aim.showPull(ctx.origin, aim.pull);
    const label = ctx.kind === 'throw' ? 'Lob' : player.powered ? 'POWER flick' : 'Weak flick';
    this.ui.setPower(aim.power, `${label} · ${(aim.power * ctx.maxSpeed).toFixed(1)} m/s`);
  }

  // ------------------------------------------------------------ frame

  _frame() {
    let dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.slowMo) dt *= 0.2;
    const aspect = this.camera.aspect;

    if (this.state === 'playing' && this.game && !this.paused) {
      this.game.update(dt);
      this._advanceAI(dt);
      this._syncViews(dt);
      this._rollingSounds();
      if (DEBUG) this._debugText();
    } else if (this.state === 'setup' && this.previewView) {
      this.previewView.spin(dt, 0.7);
    }

    this.input.refresh();
    this.aim.update(dt);
    this.effects.update(dt);
    this.rig.update(dt, aspect);
    this._render();
  }

  _syncViews(dt) {
    const game = this.game;
    for (const p of game.players) {
      const v = this.views[p.index];
      const m = p.marble;
      if (m.active) {
        v.setVisible(true);
        if (game.placing && game.placing.player === p) {
          const pl = game.placing;
          const t = Math.min(1, pl.t / pl.duration);
          const k = t * t * (3 - 2 * t);
          const toY = this.terrain.surfaceForRadius(pl.to.x, pl.to.z, m.r, { h: 0 }).h;
          const x = pl.from.x + (pl.to.x - pl.from.x) * k;
          const z = pl.from.z + (pl.to.z - pl.from.z) * k;
          const y = pl.from.y + (toY - pl.from.y) * k + Math.sin(Math.PI * t) * 0.06;
          v.setPosition(x, y, z);
        } else {
          v.syncFromPhysics(m, dt);
        }
      } else if (p.inHand && game.activePlayer === p && game.canShoot()) {
        const h = game.handPosition(p);
        const bob = Math.sin(performance.now() * 0.002) * 0.004;
        v.setVisible(true);
        v.setPosition(h.x, h.y + bob, h.z);
        v.spin(dt, 0.8);
      } else {
        v.setVisible(false);
      }
    }
  }

  _rollingSounds() {
    for (const p of this.game.players) {
      const m = p.marble;
      const moving = m.active && !m.asleep && m.grounded;
      const speed = moving ? Math.hypot(m.vx, m.vy, m.vz) : 0;
      const prev = this.rollSmoothing.get(m.id) || 0;
      const s = prev + (speed - prev) * 0.3;
      this.rollSmoothing.set(m.id, s);
      if (s > 0.01) this.audio.roll(m.id, s, m.r);
      else this.audio.stopRoll(m.id);
    }
  }

  _render() {
    const r = this.renderer;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    r.shadowMap.needsUpdate = true;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.render(this.scene, this.camera);

    if (this.state === 'playing' && this.game) {
      const mm = this.minimap;
      const narrow = w < 720;
      const mw = Math.round(Math.min(150, w * (narrow ? 0.17 : 0.2)));
      const mh = Math.round(mw * (mm.height / mm.width));
      // bottom-right normally; top-left under the score card on phones so it
      // does not sit on the hint and the sliders
      const mx = narrow ? 12 : w - mw - 14;
      const my = narrow ? h - 70 - mh : 30;
      r.setScissorTest(true);
      r.setViewport(mx, my, mw, mh);
      r.setScissor(mx, my, mw, mh);
      r.render(this.scene, mm.camera);
      r.setScissorTest(false);
      r.setViewport(0, 0, w, h);
    }
  }

  // ------------------------------------------------------------ debug

  _debug(what) {
    const g = this.game;
    if (!g) return;
    if (what === 'break') {
      g.forceBreakNext = true;
      this.ui.toast('debug: next hit breaks a marble', { life: 2 });
    } else if (what === 'near' && g.canShoot()) {
      for (const [p, pos] of [[g.players[0], { x: 0.05, z: 0.26 }], [g.players[1], { x: -0.12, z: 0.2 }]]) {
        p.inHand = false;
        g.world.placeOnGround(p.marble, pos.x, pos.z);
      }
      if (g.phase === 'opening') {
        g.phase = 'turn';
        g.openingIndex = 2;
      }
      this._onTurn({ player: g.activePlayer, kind: g.shotKind(), opening: false });
    } else if (what === 'power' && g.canShoot()) {
      g.players[0].powered = true;
      this.ui.updateHud(g);
      if (g.activePlayer === g.players[0]) this._refreshHumanContext();
    } else if (what === 'autoplay') {
      this.autoplay = !this.autoplay;
      this.ui.toast(`debug: autoplay ${this.autoplay ? 'on' : 'off'}`, { life: 1.5 });
      if (this.autoplay && g.canShoot() && !g.activePlayer.isAI && !this.ai) this._startAI(g.activePlayer, AI_LEVELS.medium);
    } else if (what === 'slow') {
      this.slowMo = !this.slowMo;
      this.ui.toast(`debug: slow-mo ${this.slowMo ? 'on' : 'off'}`, { life: 1.5 });
    }
  }

  _debugText() {
    const g = this.game;
    const lines = [`phase ${g.phase} turn ${g.turnNumber} current ${g.current} shotT ${g.shot ? g.shot.time.toFixed(2) : '-'}`];
    for (const p of g.players) {
      const m = p.marble;
      lines.push(
        `${p.name.padEnd(9)} ${m.active ? 'act' : 'hand'} ${m.asleep ? 'zz' : 'go'} ${m.grounded ? 'gnd' : 'air'} p(${m.x.toFixed(3)},${m.y.toFixed(4)},${m.z.toFixed(3)}) v${Math.hypot(m.vx, m.vy, m.vz).toFixed(3)} slip${m.slip.toFixed(3)} cave:${g.isInCave(m)} pow:${p.powered} sc:${p.score}`,
      );
    }
    if (this.ai) lines.push(`ai: ${this.ai.result ? 'planned ' + JSON.stringify({ p: +this.ai.result.power.toFixed(2), el: this.ai.result.elevation, n: this.ai.result.considered, tag: this.ai.result.planned.tag, best: +this.ai.result.best.score.toFixed(1) }) : 'thinking'}`);
    lines.push(`cam yaw ${this.rig.yaw.toFixed(2)} pitch ${this.rig.pitch.toFixed(2)} dist ${this.rig.dist.toFixed(2)} top ${this.rig.topView}`);
    this.ui.setDebugText(lines.join('\n'));
  }
}

window.app = new App();
