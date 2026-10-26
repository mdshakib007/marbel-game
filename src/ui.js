// HUD, setup screen, pause menu, results and toasts (plain DOM).

import { AI_LEVELS, MARBLE_COLORS, MARBLE_SIZES, MARBLE_STYLES } from './config.js';

const $ = (id) => document.getElementById(id);

function hexCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export class UI {
  constructor() {
    this.handlers = {};
    this.el = {
      hud: $('hud'),
      setup: $('setup'),
      menu: $('menu'),
      over: $('over'),
      debug: $('debug'),
      turnText: $('turn-text'),
      targetText: $('target-text'),
      hint: $('hint'),
      powerFill: $('power-fill'),
      powerLabel: $('power-label'),
      elevWrap: $('elevation-wrap'),
      elev: $('elev'),
      elevVal: $('elev-val'),
      handxWrap: $('handx-wrap'),
      handx: $('handx'),
      toasts: $('toasts'),
      thinking: $('thinking'),
      cards: [$('card-0'), $('card-1')],
      btnTop: $('btn-top'),
      btnSound: $('btn-sound'),
      iconOn: $('icon-sound-on'),
      iconOff: $('icon-sound-off'),
      name: $('name'),
      target: $('target'),
      seed: $('seed'),
      overTitle: $('over-title'),
      overSub: $('over-sub'),
      overTable: $('over-table'),
      dbgOut: $('dbg-out'),
    };
    this._buildChoices();
    this._wire();
    this._loadSetup();
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  _emit(name, ...args) {
    const fn = this.handlers[name];
    if (fn) fn(...args);
  }

  _buildChoices() {
    const sizes = $('size-choices');
    for (const s of Object.values(MARBLE_SIZES)) {
      sizes.insertAdjacentHTML(
        'beforeend',
        `<label class="choice"><input type="radio" name="size" value="${s.key}" ${s.key === 'medium' ? 'checked' : ''}/> <span>${s.label}<small>${s.note}</small></span></label>`,
      );
    }
    const styles = $('style-choices');
    for (const s of Object.values(MARBLE_STYLES)) {
      styles.insertAdjacentHTML(
        'beforeend',
        `<label class="choice"><input type="radio" name="style" value="${s.key}" ${s.key === 'catseye' ? 'checked' : ''}/> <span>${s.label}<small>${s.note}</small></span></label>`,
      );
    }
    const colors = $('color-choices');
    for (const c of Object.values(MARBLE_COLORS)) {
      colors.insertAdjacentHTML(
        'beforeend',
        `<button type="button" class="swatch ${c.key === 'blue' ? 'on' : ''}" data-color="${c.key}" title="${c.label}" style="--c:${hexCss(c.hex)}"></button>`,
      );
    }
    const levels = $('level-choices');
    for (const l of Object.values(AI_LEVELS)) {
      levels.insertAdjacentHTML(
        'beforeend',
        `<label class="choice"><input type="radio" name="level" value="${l.key}" ${l.key === 'medium' ? 'checked' : ''}/> <span>${l.label}</span></label>`,
      );
    }
  }

  _wire() {
    const setup = this.el.setup;
    setup.addEventListener('change', () => {
      this._saveSetup();
      this._emit('preview', this.setupValues());
    });
    setup.addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (sw) {
        setup.querySelectorAll('.swatch').forEach((b) => b.classList.remove('on'));
        sw.classList.add('on');
        this._saveSetup();
        this._emit('preview', this.setupValues());
      }
    });
    $('seed-random').addEventListener('click', () => {
      this.el.seed.value = String(1 + Math.floor(Math.random() * 99999));
      this._saveSetup();
      this._emit('preview', this.setupValues());
    });
    $('btn-start').addEventListener('click', () => {
      this._saveSetup();
      this._emit('start', this.setupValues());
    });
    $('btn-resume').addEventListener('click', () => this._emit('resume'));
    $('btn-endgame').addEventListener('click', () => this._emit('endGame'));
    $('btn-newgame').addEventListener('click', () => this._emit('newGame'));
    $('btn-rematch').addEventListener('click', () => this._emit('rematch'));
    $('btn-over-new').addEventListener('click', () => this._emit('newGame'));
    this.el.btnTop.addEventListener('click', () => this._emit('toggleTop'));
    this.el.btnSound.addEventListener('click', () => this._emit('toggleSound'));
    $('btn-menu').addEventListener('click', () => this._emit('menu'));
    this.el.elev.addEventListener('input', () => {
      this.el.elevVal.textContent = `${this.el.elev.value}°`;
      this._emit('elevation', Number(this.el.elev.value));
    });
    this.el.handx.addEventListener('input', () => this._emit('handX', Number(this.el.handx.value)));
    for (const b of this.el.debug.querySelectorAll('button')) {
      b.addEventListener('click', () => this._emit('debug', b.id.replace('dbg-', '')));
    }
  }

  // ------------------------------------------------------------ setup

  setupValues() {
    const setup = this.el.setup;
    const radio = (n) => setup.querySelector(`input[name="${n}"]:checked`)?.value;
    const color = setup.querySelector('.swatch.on')?.dataset.color || 'blue';
    const mode = radio('mode');
    const target = Math.max(1, Math.min(99, Number(this.el.target.value) || 10));
    return {
      name: (this.el.name.value || 'You').trim().slice(0, 14) || 'You',
      size: radio('size') || 'medium',
      style: radio('style') || 'catseye',
      color,
      level: radio('level') || 'medium',
      targetScore: mode === 'target' ? target : null,
      seed: Math.max(1, Math.min(99999, Number(this.el.seed.value) || 7)),
    };
  }

  _saveSetup() {
    try {
      localStorage.setItem('marbel.setup', JSON.stringify(this.setupValues()));
    } catch {
      /* ignore */
    }
  }

  _loadSetup() {
    let v = null;
    try {
      v = JSON.parse(localStorage.getItem('marbel.setup') || 'null');
    } catch {
      v = null;
    }
    if (!v) return;
    const setup = this.el.setup;
    const check = (n, val) => {
      const i = setup.querySelector(`input[name="${n}"][value="${val}"]`);
      if (i) i.checked = true;
    };
    if (v.name) this.el.name.value = v.name;
    check('size', v.size);
    check('style', v.style);
    check('level', v.level);
    check('mode', v.targetScore == null ? 'fun' : 'target');
    if (v.targetScore != null) this.el.target.value = String(v.targetScore);
    if (v.seed) this.el.seed.value = String(v.seed);
    setup.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === v.color));
  }

  showSetup() {
    this.el.setup.classList.remove('hidden');
    this.el.menu.classList.add('hidden');
    this.el.over.classList.add('hidden');
  }

  hideSetup() {
    this.el.setup.classList.add('hidden');
  }

  showMenu() {
    this.el.menu.classList.remove('hidden');
  }

  hideMenu() {
    this.el.menu.classList.add('hidden');
  }

  get menuOpen() {
    return !this.el.menu.classList.contains('hidden');
  }

  showHud(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  showOver({ winner, players, ended }) {
    const you = players[0];
    const title = !winner ? 'Draw!' : winner === you ? 'You win!' : `${winner.name} wins!`;
    this.el.overTitle.textContent = title;
    this.el.overSub.textContent = ended
      ? 'Game ended.'
      : winner
        ? `${winner.name} reached ${winner.score} points first.`
        : '';
    const rows = players
      .map(
        (p) => `<tr class="${p === winner ? 'winner' : ''}">
          <td><span class="marble-icon" style="--c:${hexCss(MARBLE_COLORS[p.color].hex)}; display:inline-block; width:14px; height:14px; border-radius:50%; margin-right:6px; vertical-align:-2px"></span>${p.name}</td>
          <td><b>${p.score}</b></td><td>${p.hits}</td><td>${p.caveEntries}</td><td>${p.marblesBroken}</td></tr>`,
      )
      .join('');
    this.el.overTable.innerHTML = `<tr><th>Player</th><th>Points</th><th>Hits</th><th>Caves</th><th>Broken</th></tr>${rows}`;
    this.el.over.classList.remove('hidden');
  }

  hideOver() {
    this.el.over.classList.add('hidden');
  }

  // ------------------------------------------------------------ HUD

  setPlayers(players) {
    players.forEach((p, i) => {
      const card = this.el.cards[i];
      card.querySelector('.name').textContent = p.name;
      card.querySelector('.marble-icon').style.setProperty('--c', hexCss(MARBLE_COLORS[p.color].hex));
    });
  }

  updateHud(game) {
    game.players.forEach((p, i) => {
      const card = this.el.cards[i];
      card.querySelector('.score').textContent = String(p.score);
      card.querySelector('.badge').classList.toggle('on', p.powered);
      card.classList.toggle('active', game.phase !== 'over' && game.current === i);
      const size = MARBLE_SIZES[p.size].label.toLowerCase();
      const st = p.inHand ? 'marble in hand' : p.powered ? `${size} · has the power` : `${size} · needs the cave`;
      card.querySelector('.status').textContent = st;
    });
    this.el.targetText.textContent = game.targetScore ? `first to ${game.targetScore} points` : 'just for fun';
  }

  setTurnText(t) {
    this.el.turnText.textContent = t;
  }

  setHint(t) {
    this.el.hint.textContent = t;
    this.el.hint.classList.toggle('hidden', !t);
  }

  setPower(power, label) {
    this.el.powerFill.style.width = `${Math.round(power * 100)}%`;
    if (label != null) this.el.powerLabel.textContent = label;
  }

  showElevation(on) {
    this.el.elevWrap.classList.toggle('hidden', !on);
  }

  setElevation(deg) {
    this.el.elev.value = String(deg);
    this.el.elevVal.textContent = `${deg}°`;
  }

  showHandX(on) {
    this.el.handxWrap.classList.toggle('hidden', !on);
  }

  setHandX(x) {
    this.el.handx.value = String(x);
  }

  toast(text, { kind = '', life = 2.6, big = false } = {}) {
    const d = document.createElement('div');
    d.className = `toast ${kind} ${big ? 'big' : ''}`;
    d.style.setProperty('--life', `${life}s`);
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), (life + 0.5) * 1000);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  setThinking(on) {
    this.el.thinking.classList.toggle('hidden', !on);
  }

  setSoundMuted(m) {
    this.el.iconOn.classList.toggle('hidden', m);
    this.el.iconOff.classList.toggle('hidden', !m);
  }

  setTopOn(on) {
    this.el.btnTop.classList.toggle('on', on);
  }

  showDebug(on) {
    this.el.debug.classList.toggle('hidden', !on);
  }

  setDebugText(t) {
    this.el.dbgOut.textContent = t;
  }
}
