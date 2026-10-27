// Entry point: wires the rules (game.js) and physics to the renderer, the
// computer player, input, audio, effects and the HUD.

import * as THREE from 'three';
import { AI_LEVELS, BOT_MARBLE, CAVE, MARBLE_COLORS, MARBLE_SIZES, SHOT, START_LINE } from './config.js';
import { Terrain } from './terrain.js';
import { Game } from './game.js';
import { planShot } from './ai.js';
import { LAYER_MINIMAP, buildScene, createRenderer, fadeWalls, fitShadowToPoints } from './render/scene.js';
import { MARBLE_RENDER, MarbleView } from './render/marbles.js';
import { AdaptiveResolution, detectQuality } from './render/quality.js';
import { Effects } from './render/effects.js';
import { AimGuide } from './render/aim.js';
import { CameraRig } from './render/camera.js';
import { AudioEngine } from './audio.js';
import { InputController } from './input.js';
import { UI } from './ui.js';
import { detectLang, t } from './i18n.js';

const DEBUG = new URLSearchParams(location.search).has('debug');

class App {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.quality = detectQuality();
    MARBLE_RENDER.transmission = this.quality.transmission;
    MARBLE_RENDER.segments = this.quality.sphereSegments;
    Effects.particleScale = this.quality.particles;
    this.renderer = createRenderer(this.canvas, this.quality);
    // Shadows are redrawn only when something that casts one has moved.
    this.renderer.shadowMap.autoUpdate = false;
    this.shadowDirty = true;
    this.shadowTimer = 0;
    this.frameNo = 0;
    this.minimapRT = null;
    this.minimapQuad = null;
    this.lastPositions = new Map();
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
    this.lastTurn = null;
    this.rollSmoothing = new Map();

    this._buildWorld(this.ui.setupValues().seed);
    this.rig = new CameraRig(this.camera, this.terrain);
    this.input = new InputController({ canvas: this.canvas, camera: this.camera, rig: this.rig, audio: this.audio });
    this._wireUI();
    this._wireInput();

    this.resolution = new AdaptiveResolution(this.renderer, this.quality);
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
    const parts = buildScene(this.renderer, this.terrain, this.quality);
    this.scene = parts.scene;
    this.minimap = parts.minimap;
    this.walls = parts.walls;
    this.sun = parts.sun;
    this.shadowDirty = true;
    this.minimapDirty = true;
    this.effects = new Effects(this.scene, this.terrain);
    this.aim = new AimGuide(this.scene, this.terrain);
    if (this.rig) this.rig.terrain = this.terrain;
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.resolution) this.resolution.apply();
    else this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.shadowDirty = true;
    this.minimapDirty = true;
    if (this.state === 'setup') this._updatePreview(this.ui.setupValues(), true);
  }

  /** Phones held upright: the setup panel sits at the bottom, the marble above it. */
  get portrait() {
    return window.innerHeight > window.innerWidth && window.innerWidth < 720;
  }

  // ------------------------------------------------------------ setup

  _showSetup() {
    this.state = 'setup';
    this.paused = false;
    this.ai = null;
    this.input.setEnabled(false);
    this.aim.hide();
    this.aim.clearHighlight();
    this._clearViews();
    this.game = null;
    this.ui.showHud(false);
    this.ui.showSetup();
    this.ui.setDebugText('');
    this._updatePreview(this.ui.setupValues(), true);
  }

  _clearViews() {
    for (const v of this.views) {
      v.removeFrom(this.scene);
      v.dispose();
    }
    this.views = [];
    this.lastPositions.clear();
    this.shadowDirty = true;
    this.minimapDirty = true;
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
    const x = this.portrait ? 0.1 : 0.35;
    const z = START_LINE.z - 0.15;
    const y = this.terrain.surfaceForRadius(x, z, size.radius, { h: 0 }).h;
    this.previewView.setPosition(x, y, z);
    this.rig.setTopView(false);
    const dist = size.radius * 9 + 0.03;
    // In portrait the panel covers the lower part of the screen: aim the
    // camera a little below the marble so the marble sits in the top third.
    const look = this.portrait ? { x, y: y - dist * 0.42, z } : { x, y, z };
    this.rig.frame(look, { x: look.x - (this.portrait ? 0 : 0.4), z: z - 1.2 }, { dist, pitch: 0.32, immediate });
    this.shadowDirty = true;
  }

  _startGame(values) {
    this.lastSetup = values;
    if (values.seed !== this.seed) this._buildWorld(values.seed);
    // A rematch starts here without passing through the setup screen: take
    // the previous game's marbles off the yard first.
    this._clearViews();
    if (this.previewView) {
      this.previewView.removeFrom(this.scene);
      this.previewView.dispose();
      this.previewView = null;
    }
    // The computer plays a marble of the same size as yours (a fair match)
    // but always its own black-and-white one, so the two never look alike.
    const aiSize = values.size;
    const players = [
      { name: values.name, isAI: false, size: values.size, style: values.style, color: values.color, handX: -0.12 },
      {
        name: t('hud.computer'),
        isAI: true,
        aiLevel: values.level,
        size: aiSize,
        style: BOT_MARBLE.style,
        color: BOT_MARBLE.color,
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
    ui.on('lang', () => this._onLang());
  }

  /** The language changed: redo every piece of text that is not static markup. */
  _onLang() {
    const g = this.game;
    if (!g) return;
    g.players[1].name = t('hud.computer');
    this.ui.setPlayers(g.players);
    this.ui.updateHud(g);
    if (this.lastTurn && g.canShoot() && g.activePlayer === this.lastTurn.player) this._turnTexts(this.lastTurn);
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
      const text = first === g.players[0] ? t('toast.youFirst') : t('toast.theyFirst', { name: this.ui.nameOf(first) });
      this.ui.toast(text, { kind: first === g.players[0] ? 'good' : 'bad', life: 3 });
    });
    g.on('lift', () => {
      this.audio.blip(true);
      this.ui.setHint(t('hint.lifting'));
    });
    g.on('over', (e) => this._onOver(e));
  }

  // ------------------------------------------------------------ game events

  _humanHint(player, kind, extra, caveTurn) {
    if (kind === 'throw') return t('hint.throw');
    const lead = caveTurn ? `${t('hint.caveTurn')} ` : extra ? `${t('hint.extra')} ` : '';
    return lead + (player.powered ? t('hint.powered') : t('hint.weak'));
  }

  _flickLabel(player, kind) {
    return kind === 'throw' ? t('hud.lob') : player.powered ? t('hud.powerFlick') : t('hud.weakFlick');
  }

  /** Hint and power label for the turn (also redone when the language changes). */
  _turnTexts({ player, kind, opening, extra, caveTurn }) {
    if (player.isAI) {
      this.ui.setHint(kind === 'throw' ? t('hint.aiThrow') : extra && !opening ? t('hint.aiAgain') : t('hint.aiFlick'));
      this.ui.setPower(0, '');
      return;
    }
    this.ui.setHint(this._humanHint(player, kind, extra, caveTurn));
    this.ui.setPower(0, this._flickLabel(player, kind));
  }

  _onTurn(e) {
    const { player, kind, opening } = e;
    const game = this.game;
    this.lastTurn = e;
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
      this._turnTexts(e);
      this.ui.showElevation(false);
      this.ui.showHandX(false);
      if (kind === 'throw') game.setHandX(player, 0.1 + (Math.random() - 0.5) * 0.5);
      this._startAI(player, AI_LEVELS[player.aiLevel]);
      return;
    }

    this._turnTexts(e);
    this.ui.showElevation(kind === 'throw');
    this.ui.showHandX(kind === 'throw');
    this.ui.setHandX(player.handX);
    this.ui.setElevation(this.input.elevation);
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
    this.ui.setHint(kind === 'throw' ? t('hint.flying') : t('hint.rolling'));
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
    // Scores, power badges and the turn highlight tell the story on the
    // cards; no pop-up notifications for hits or cave entries.
    const ui = this.ui;
    const you = this.game.players[0];
    for (const c of r.caveEntries) {
      this.audio.plunk();
      if (c.gained) this.effects.caveDust(CAVE.x, this.terrain.caveRimHeight() + 0.003, CAVE.z);
    }
    if (r.broken) {
      const p = r.broken.player;
      const w = r.broken.where;
      this.audio.shatter();
      this.effects.shatter(w.x, w.y, w.z, MARBLE_COLORS[p.color].hex, p.marble.r);
      this.views[p.index].setVisible(false);
      ui.toast(p === you ? t('toast.shatterYou') : t('toast.shatterThey', { name: ui.nameOf(p) }), { kind: 'bad', life: 4.5, big: true });
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
      this.ui.setPower(ai.result.power, t('hud.speed', { label: this._flickLabel(ai.player, kind), v: (ai.result.power * this.game.maxSpeed(ai.player)).toFixed(1) }));
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
    this.ui.setPower(aim.power, t('hud.speed', { label: this._flickLabel(player, ctx.kind), v: (aim.power * ctx.maxSpeed).toFixed(1) }));
  }

  // ------------------------------------------------------------ frame

  /** Nothing moves: no shot, no lift, no aiming, no AI, camera settled, no particles. */
  _isIdle() {
    const g = this.game;
    if (this.input.aiming || this.ai || this.effects.active) return false;
    if (g && (g.phase === 'shot' || g.phase === 'placing')) return false;
    if (g && g.canShoot() && g.activePlayer.inHand) return false; // the hand bobs
    const r = this.rig;
    const far = r.target.distanceTo(r.desired.target) > 2e-4 || Math.abs(r.dist - r.desired.dist) > 2e-4 || Math.abs(r.pitch - r.desired.pitch) > 1e-3 || Math.abs(r.yaw - r.desired.yaw) > 1e-3;
    return !far;
  }

  _frame() {
    // Power saving: with nothing moving, draw every other frame (the
    // pulsing ring and the spinning preview marble do not need 60 fps).
    this.frameNo++;
    if (this._isIdle() && this.frameNo % 2) return;
    let dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.slowMo) dt *= 0.2;
    const aspect = this.camera.aspect;

    if (this.state === 'playing' && this.game && !this.paused) {
      this.game.update(dt);
      this._advanceAI(dt);
      this._syncViews(dt);
      this._rollingSounds();
      this._followAction();
      if (DEBUG) this._debugText();
    } else if (this.state === 'setup' && this.previewView) {
      this.previewView.spin(dt, 0.7);
    }

    this.input.refresh();
    this.aim.update(dt);
    this.effects.update(dt);
    this.rig.update(dt, aspect);
    if (fadeWalls(this.walls, this.camera.position, this.rig.target, dt)) this.shadowDirty = true;
    if (fitShadowToPoints(this.sun, this._shadowPoints())) this.shadowDirty = true;
    if (this.effects.active) this.shadowDirty = true;
    this.shadowTimer += dt;
    if (this.shadowTimer > 1) {
      this.shadowDirty = true;
      this.shadowTimer = 0;
    }
    this.resolution.update(performance.now());
    this._render();
  }

  _syncViews(dt) {
    const game = this.game;
    for (const p of game.players) {
      const v = this.views[p.index];
      const m = p.marble;
      if (m.active) {
        v.setVisible(true);
        this._noteMoved(p.index, m.x, m.y, m.z);
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
        this._noteMoved(p.index, h.x, h.y + bob, h.z);
      } else {
        if (this.lastPositions.has(p.index)) {
          this.lastPositions.delete(p.index);
          this.shadowDirty = true;
          this.minimapDirty = true;
        }
        v.setVisible(false);
      }
    }
  }

  /** Where the shadow map should look: every visible marble (or the preview one). */
  _shadowPoints() {
    const pts = [];
    if (this.state === 'setup' && this.previewView) pts.push(this.previewView.group.position);
    else for (const v of this.views) if (v.visible) pts.push(v.group.position);
    return pts;
  }

  /** Mark shadows and the mini-map stale when a marble has actually moved. */
  _noteMoved(key, x, y, z) {
    const last = this.lastPositions.get(key);
    if (last && Math.abs(last.x - x) < 1e-5 && Math.abs(last.y - y) < 1e-5 && Math.abs(last.z - z) < 1e-5) return;
    this.lastPositions.set(key, { x, y, z });
    this.shadowDirty = true;
    this.minimapDirty = true;
  }

  /** While marbles move, keep the camera on the fastest one (the action). */
  _followAction() {
    const g = this.game;
    if (g.phase !== 'shot' || !this.rig.followTarget) return;
    let best = null;
    let bestSpeed = 0;
    for (const p of g.players) {
      const m = p.marble;
      if (!m.active || m.asleep) continue;
      const sp = Math.hypot(m.vx, m.vz);
      if (sp > bestSpeed) {
        best = m;
        bestSpeed = sp;
      }
    }
    const cur = this.rig.followTarget;
    const curSpeed = cur.asleep ? 0 : Math.hypot(cur.vx, cur.vz);
    if (best && best !== cur && bestSpeed > curSpeed * 1.3 + 0.05) this.rig.follow(best);
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
    r.shadowMap.needsUpdate = this.shadowDirty;
    this.shadowDirty = false;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    r.render(this.scene, this.camera);
    if (this.state === 'playing' && this.game) this._renderMinimap(w, h);
  }

  /**
   * The mini-map is drawn into a small texture only when a marble has moved
   * (and at most every few frames), then blitted each frame: far cheaper
   * than rendering the whole yard a second time per frame.
   */
  _renderMinimap(w, h) {
    const r = this.renderer;
    const mm = this.minimap;
    const narrow = w < 720;
    const mw = Math.round(Math.min(150, w * (narrow ? 0.2 : 0.2)));
    const mh = Math.round(mw * (mm.height / mm.width));
    const mx = narrow ? 10 : w - mw - 14;
    const my = narrow ? h - 150 - mh : 30;
    const scale = Math.min(2, this.resolution.ratio);
    const tw = Math.round(mw * scale);
    const th = Math.round(mh * scale);
    if (!this.minimapRT || this.minimapRT.width !== tw || this.minimapRT.height !== th) {
      if (this.minimapRT) this.minimapRT.dispose();
      this.minimapRT = new THREE.WebGLRenderTarget(tw, th, { depthBuffer: true });
      this.minimapRT.texture.colorSpace = THREE.SRGBColorSpace;
      if (!this.minimapQuad) {
        this.minimapQuad = {
          scene: new THREE.Scene(),
          camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
          mesh: new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.minimapRT.texture, toneMapped: false })),
        };
        this.minimapQuad.scene.add(this.minimapQuad.mesh);
      } else {
        this.minimapQuad.mesh.material.map = this.minimapRT.texture;
      }
      this.minimapDirty = true;
    }
    if (this.minimapDirty && this.frameNo % this.quality.minimapEvery === 0) {
      this.minimapDirty = false;
      r.setRenderTarget(this.minimapRT);
      r.render(this.scene, mm.camera);
      r.setRenderTarget(null);
    }
    r.setScissorTest(true);
    r.setViewport(mx, my, mw, mh);
    r.setScissor(mx, my, mw, mh);
    r.render(this.minimapQuad.scene, this.minimapQuad.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
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
    lines.push(`quality ${this.quality.key} dpr ${this.resolution.ratio.toFixed(2)} fps ${this.resolution.fps.toFixed(0)} shadow ${this.quality.shadowMapSize}`);
    this.ui.setDebugText(lines.join('\n'));
  }
}

window.app = new App();
// Pick the language (saved choice, Bangla browser, or a connection from
// Bangladesh) once the page is up; until then the UI is in English.
detectLang().then((lang) => window.app.ui.setLanguage(lang, false));
