// Synthesised sound effects (WebAudio, no audio files).
//   - glass clicks for marble hits: pitch by marble size, loudness and timbre
//     by how hard the hit was (soft tick -> bright crack with a low 'thock')
//   - dirt thuds for landings, brick knocks for the walls
//   - a continuous rolling rumble per marble that follows its speed
//   - cave plunk, glass shatter, throw whoosh, UI blips

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.voices = new Map(); // marble id -> rolling voice
    this._noise = null;
    try {
      this.muted = localStorage.getItem('marbel.muted') === '1';
    } catch {
      /* ignore */
    }
  }

  /** Must be called from a user gesture at least once. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      this._noise = this._makeNoiseBuffer();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('marbel.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  _makeNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseBurst({ duration = 0.05, gain = 0.3, type = 'bandpass', freq = 3000, q = 1, attack = 0.002, at = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    src.loopStart = Math.random() * 1.5;
    src.loopEnd = src.loopStart + 0.5;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + duration);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  _tone({ freq, duration = 0.05, gain = 0.2, type = 'sine', decay = null, at = 0, slideTo = null }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + (decay || duration));
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + (decay || duration) + 0.02);
  }

  /**
   * Marble-on-marble click. `speed` is the closing speed (m/s); radius is the
   * smaller marble's radius (smaller marbles ring higher).
   */
  hit(speed, radius = 0.008) {
    if (!this.ready) return;
    const hard = clamp(speed / 2.6, 0, 1);
    const sizeK = Math.sqrt(0.008 / radius);
    const detune = 0.96 + Math.random() * 0.08;
    const f1 = 2700 * sizeK * detune;
    const loud = 0.08 + 0.55 * Math.pow(hard, 0.8);
    // glassy ring
    this._tone({ freq: f1, duration: 0.03 + 0.06 * hard, gain: loud * 0.5 });
    this._tone({ freq: f1 * 1.62, duration: 0.02 + 0.04 * hard, gain: loud * 0.25 });
    this._tone({ freq: f1 * 2.41, duration: 0.015 + 0.02 * hard, gain: loud * 0.12 });
    // the 'tick' transient
    this._noiseBurst({ duration: 0.012 + 0.02 * hard, gain: loud * 0.6, freq: 4500 * sizeK, q: 0.9 });
    // a hard hit adds a low 'thock' body and a longer bright tail
    if (hard > 0.35) {
      this._tone({ freq: 620 * sizeK, duration: 0.05 + 0.05 * hard, gain: (hard - 0.35) * 0.5, type: 'triangle' });
      this._noiseBurst({ duration: 0.08 + 0.1 * hard, gain: (hard - 0.35) * 0.3, freq: 7000, q: 0.5, type: 'highpass' });
    }
  }

  /** Marble landing on dirt (impact speed m/s). */
  thud(speed, radius = 0.008) {
    if (!this.ready) return;
    const k = clamp(speed / 5, 0, 1);
    if (k < 0.03) return;
    const sizeK = radius / 0.008;
    this._noiseBurst({ duration: 0.04 + 0.05 * k, gain: 0.05 + 0.5 * k, type: 'lowpass', freq: 500 + 900 * k, q: 0.7 });
    this._tone({ freq: 160 * Math.sqrt(1 / sizeK), duration: 0.05 + 0.04 * k, gain: 0.05 + 0.3 * k * sizeK, type: 'sine', slideTo: 70 });
    // faint grit
    this._noiseBurst({ duration: 0.08, gain: 0.08 * k, freq: 3000, q: 0.6 });
  }

  /** Marble knocking the brick border. */
  wall(speed) {
    if (!this.ready) return;
    const k = clamp(speed / 3, 0, 1);
    if (k < 0.03) return;
    this._noiseBurst({ duration: 0.03 + 0.04 * k, gain: 0.1 + 0.5 * k, freq: 1200, q: 1.2 });
    this._tone({ freq: 420, duration: 0.06, gain: 0.08 + 0.25 * k, type: 'triangle' });
  }

  /** Dropping into the cave. */
  plunk() {
    if (!this.ready) return;
    this._tone({ freq: 480, slideTo: 170, duration: 0.14, gain: 0.3, type: 'sine' });
    this._noiseBurst({ duration: 0.09, gain: 0.25, type: 'lowpass', freq: 700, q: 0.8, at: 0.01 });
    this._tone({ freq: 2200, duration: 0.03, gain: 0.08 });
  }

  shatter() {
    if (!this.ready) return;
    this._noiseBurst({ duration: 0.35, gain: 0.7, type: 'highpass', freq: 2500, q: 0.4 });
    this._tone({ freq: 900, slideTo: 300, duration: 0.12, gain: 0.3, type: 'square' });
    for (let i = 0; i < 9; i++) {
      const at = 0.02 + Math.random() * 0.25;
      const f = 3000 + Math.random() * 5000;
      this._tone({ freq: f, duration: 0.03, gain: 0.12, at });
      this._noiseBurst({ duration: 0.02, gain: 0.2, freq: f, q: 2, at });
    }
  }

  whoosh() {
    if (!this.ready) return;
    this._noiseBurst({ duration: 0.3, gain: 0.12, type: 'bandpass', freq: 900, q: 0.5, attack: 0.12 });
  }

  blip(high = false) {
    if (!this.ready) return;
    this._tone({ freq: high ? 1320 : 880, duration: 0.06, gain: 0.08, type: 'sine' });
  }

  fanfare() {
    if (!this.ready) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this._tone({ freq: f, duration: 0.25, gain: 0.12, type: 'triangle', at: i * 0.12 }));
  }

  sad() {
    if (!this.ready) return;
    const notes = [392, 349, 311];
    notes.forEach((f, i) => this._tone({ freq: f, duration: 0.3, gain: 0.1, type: 'triangle', at: i * 0.18 }));
  }

  /** Create/update the rolling rumble for a marble. speed in m/s. */
  roll(id, speed, radius = 0.008) {
    if (!this.ready) return;
    let v = this.voices.get(id);
    if (!v) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 900;
      band.Q.value = 0.7;
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(band).connect(low).connect(g).connect(this.master);
      src.start();
      v = { src, band, low, g };
      this.voices.set(id, v);
    }
    const k = clamp(speed / 2.2, 0, 1);
    const sizeK = Math.sqrt(0.008 / radius);
    const gain = Math.pow(k, 0.75) * 0.28 * (1 / Math.sqrt(sizeK));
    const t = this.ctx.currentTime;
    v.g.gain.setTargetAtTime(gain, t, 0.04);
    v.band.frequency.setTargetAtTime((450 + 1600 * k) * sizeK, t, 0.05);
  }

  stopRoll(id) {
    const v = this.voices.get(id);
    if (v) v.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
