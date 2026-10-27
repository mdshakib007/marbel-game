// HUD, setup screen, pause menu, results and toasts (plain DOM), in the
// player's language (see i18n.js).

import { AI_LEVELS, MARBLE_COLORS, MARBLE_SIZES, MARBLE_STYLES } from './config.js';
import { applyDom, getLang, isDefaultName, setLang, t } from './i18n.js';

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
      menuMode: $('menu-mode'),
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
    this._applyLanguage();
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  _emit(name, ...args) {
    const fn = this.handlers[name];
    if (fn) fn(...args);
  }

  // ------------------------------------------------------------ language

  /** The name shown for a player: the computer's (and a default name) is translated. */
  nameOf(player) {
    if (player.isAI) return t('hud.computer');
    return isDefaultName(player.name) ? t('setup.nameDefault') : player.name;
  }

  /** Switch the UI language; `remember` stores it as the player's choice. */
  setLanguage(lang, remember = false) {
    if (lang === getLang() && !remember) return;
    setLang(lang, remember);
    this._applyLanguage();
    this._emit('lang', lang);
  }

  _applyLanguage() {
    applyDom(document);
    this._buildChoices();
    if (isDefaultName(this.el.name.value.trim()) || !this.el.name.value.trim()) this.el.name.value = t('setup.nameDefault');
    for (const b of document.querySelectorAll('[data-lang-switch] button')) b.classList.toggle('on', b.dataset.lang === getLang());
  }

  /** (Re)build the setup choice lists in the current language, keeping the selection. */
  _buildChoices() {
    const setup = this.el.setup;
    const picked = (n, fallback) => setup.querySelector(`input[name="${n}"]:checked`)?.value || fallback;
    const size = picked('size', 'medium');
    const style = picked('style', 'catseye');
    const level = picked('level', 'medium');
    const color = setup.querySelector('.swatch.on')?.dataset.color || 'blue';

    const sizes = $('size-choices');
    sizes.innerHTML = '';
    for (const s of Object.values(MARBLE_SIZES)) {
      sizes.insertAdjacentHTML(
        'beforeend',
        `<label class="choice"><input type="radio" name="size" value="${s.key}" ${s.key === size ? 'checked' : ''}/> <span>${t(`size.${s.key}`)}</span></label>`,
      );
    }
    const styles = $('style-choices');
    styles.innerHTML = '';
    for (const s of Object.values(MARBLE_STYLES)) {
      styles.insertAdjacentHTML(
        'beforeend',
        `<label class="choice"><input type="radio" name="style" value="${s.key}" ${s.key === style ? 'checked' : ''}/> <span>${t(`style.${s.key}`)}</span></label>`,
      );
    }
    const colors = $('color-choices');
    colors.innerHTML = '';
    for (const c of Object.values(MARBLE_COLORS)) {
      if (c.hidden) continue;
      colors.insertAdjacentHTML(
        'beforeend',
        `<button type="button" class="swatch ${c.key === color ? 'on' : ''}" data-color="${c.key}" title="${t(`color.${c.key}`)}" style="--c:${hexCss(c.hex)}"></button>`,
      );
    }
    const levels = $('level-choices');
    levels.innerHTML = '';
    for (const l of Object.values(AI_LEVELS)) {
      levels.insertAdjacentHTML(
        'beforeend',
        `<label class="choice"><input type="radio" name="level" value="${l.key}" ${l.key === level ? 'checked' : ''}/> <span>${t(`level.${l.key}`)}</span></label>`,
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
    for (const b of document.querySelectorAll('[data-lang-switch] button')) {
      b.addEventListener('click', () => this.setLanguage(b.dataset.lang, true));
    }
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
    const typed = this.el.name.value.trim().slice(0, 14);
    return {
      name: !typed || isDefaultName(typed) ? t('setup.nameDefault') : typed,
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
    this.el.overTitle.textContent = !winner ? t('over.draw') : winner === you ? t('over.win') : t('over.lose', { name: this.nameOf(winner) });
    this.el.overSub.textContent = ended ? t('over.ended') : winner ? t('over.reached', { name: this.nameOf(winner), n: winner.score }) : '';
    const rows = players
      .map(
        (p) => `<tr class="${p === winner ? 'winner' : ''}">
          <td><span class="marble-icon ${p.style === 'bot' ? 'bot' : ''}" style="--c:${hexCss(MARBLE_COLORS[p.color].hex)}; display:inline-block; width:14px; height:14px; border-radius:50%; margin-right:6px; vertical-align:-2px"></span>${escapeHtml(this.nameOf(p))}</td>
          <td><b>${p.score}</b></td><td>${p.hits}</td><td>${p.caveEntries}</td><td>${p.marblesBroken}</td></tr>`,
      )
      .join('');
    this.el.overTable.innerHTML = `<tr><th>${t('over.player')}</th><th>${t('over.points')}</th><th>${t('over.hits')}</th><th>${t('over.caves')}</th><th>${t('over.broken')}</th></tr>${rows}`;
    this.el.over.classList.remove('hidden');
  }

  hideOver() {
    this.el.over.classList.add('hidden');
  }

  // ------------------------------------------------------------ HUD

  setPlayers(players) {
    players.forEach((p, i) => {
      const card = this.el.cards[i];
      card.querySelector('.name').textContent = this.nameOf(p);
      const icon = card.querySelector('.marble-icon');
      icon.style.setProperty('--c', hexCss(MARBLE_COLORS[p.color].hex));
      icon.classList.toggle('bot', p.style === 'bot');
    });
  }

  /** Scores, power badges, status lines and the highlight on whose turn it is. */
  updateHud(game) {
    game.players.forEach((p, i) => {
      const card = this.el.cards[i];
      card.querySelector('.score').textContent = String(p.score);
      card.querySelector('.badge').classList.toggle('on', p.powered);
      card.classList.toggle('active', game.phase !== 'over' && game.current === i);
      const size = t(`size.${p.size}`).toLowerCase();
      card.querySelector('.status').textContent = p.inHand ? t('hud.inHand') : p.powered ? t('hud.hasPower', { size }) : t('hud.needsCave', { size });
    });
    this.el.menuMode.textContent = game.targetScore ? t('menu.modeTarget', { n: game.targetScore }) : t('menu.modeFun');
  }

  setHint(text) {
    this.el.hint.textContent = text;
    this.el.hint.classList.toggle('hidden', !text);
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

  setDebugText(text) {
    this.el.dbgOut.textContent = text;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
