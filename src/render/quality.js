// Rendering quality: a preset picked for the device (phones and weak GPUs
// get the 'low' tier) plus a resolution that adapts to the measured frame
// rate, so the game stays smooth on a 3 GB phone and crisp on a gaming PC.
// Force a tier with ?quality=low or ?quality=high.

export const PRESETS = {
  high: {
    key: 'high',
    maxPixelRatio: 2,
    minPixelRatio: 1,
    antialias: true,
    shadowMapSize: 2048,
    softShadows: true,
    /** real refraction for the see-through glass (an extra scene pass) */
    transmission: true,
    cheapShading: false,
    terrainNX: 320,
    terrainNZ: 400,
    sphereSegments: [48, 32],
    /** redraw the mini-map every N frames */
    minimapEvery: 2,
    particles: 1,
  },
  low: {
    key: 'low',
    // Phones have sharp screens and tile-based GPUs where MSAA is nearly
    // free: keep the picture crisp and save on shading instead.
    maxPixelRatio: 2,
    minPixelRatio: 1,
    antialias: true,
    shadowMapSize: 1024,
    softShadows: false,
    transmission: false,
    /** plain Lambert dirt, walls and lawn: no per-pixel environment lighting */
    cheapShading: true,
    terrainNX: 320,
    terrainNZ: 400,
    sphereSegments: [32, 20],
    minimapEvery: 4,
    particles: 0.75,
  },
};

/** Pick the tier for this device. */
export function detectQuality() {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced && PRESETS[forced]) return PRESETS[forced];
  const ua = navigator.userAgent || '';
  const touchScreen = (navigator.maxTouchPoints || 0) > 1;
  const smallScreen = Math.min(screen.width, screen.height) < 900;
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) || (touchScreen && smallScreen);
  const memory = navigator.deviceMemory; // GB, Chrome only
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile || (memory && memory <= 4) || cores <= 4) return PRESETS.low;
  if (/SwiftShader|llvmpipe|Mali|Adreno|PowerVR|Intel\(R\) (HD|UHD)/i.test(gpuName())) return PRESETS.low;
  return PRESETS.high;
}

function gpuName() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  } catch {
    return '';
  }
}

/**
 * Lowers the render resolution when frames take too long and raises it
 * again when there is headroom. Call update() once per frame.
 */
export class AdaptiveResolution {
  constructor(renderer, preset) {
    this.renderer = renderer;
    this.preset = preset;
    this.ratio = Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio);
    this.max = this.ratio;
    this.min = Math.min(preset.minPixelRatio, this.ratio);
    this._last = 0;
    this._ema = 1 / 60;
    this._slowFor = 0;
    this._fastFor = 0;
    this._cooldown = 0;
    this._start = 0;
    this.apply();
  }

  apply() {
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  update(now) {
    if (!this._start) this._start = now;
    if (this._last) {
      const dt = (now - this._last) / 1000;
      // Ignore the first seconds (textures and the yard are still being
      // built) and one-off stalls: only a steady slow frame rate counts.
      if (now - this._start < 4000 || dt > 0.12) {
        this._last = now;
        return;
      }
      this._ema += (dt - this._ema) * 0.08;
      this._cooldown -= dt;
      if (this._ema > 1 / 38) {
        this._slowFor += dt;
        this._fastFor = 0;
      } else if (this._ema < 1 / 57) {
        this._fastFor += dt;
        this._slowFor = 0;
      } else {
        this._slowFor = this._fastFor = 0;
      }
      if (this._cooldown <= 0 && this._slowFor > 1.2 && this.ratio > this.min + 1e-3) {
        this.ratio = Math.max(this.min, this.ratio * 0.85);
        this.apply();
        this._slowFor = 0;
        this._cooldown = 2;
      } else if (this._cooldown <= 0 && this._fastFor > 6 && this.ratio < this.max - 1e-3) {
        this.ratio = Math.min(this.max, this.ratio * 1.1);
        this.apply();
        this._fastFor = 0;
        this._cooldown = 4;
      }
    }
    this._last = now;
  }

  get fps() {
    return 1 / this._ema;
  }
}
