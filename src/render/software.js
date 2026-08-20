import { bakeTerrain, renderPlanet } from './cpushade.js';
import { NBANDS } from '../physics/climate.js';
import { clamp } from '../physics/constants.js';

// A software renderer, used when the machine cannot give us WebGL2.
//
// That happens more often on Linux than it should -- a graphics blocklist entry
// or a failed driver probe is enough, with nothing wrong with the card -- and
// the honest response is a planet that still draws, not a page telling someone
// to go and edit their browser configuration.
//
// It shares its shading with the GPU path's CPU port in cpushade.js, so this is
// the same terrain, biomes, ice and lighting, just evaluated in JavaScript at a
// lower resolution and refresh rate. The simulation is completely unaffected.
export class SoftwareView {
  constructor(canvas) {
    this.canvas = canvas;
    this.software = true;
    this.failed = false;
    this.ready = false;
    this.texturesLoaded = false;   // the generated albedo maps are GPU-only
    this.wantTextures = false;
    this.useTextures = 0;
    this.quality = 'high';
    this.spin = 0; this.yaw = 0; this.pitch = 0; this.spinVel = 0;
    this.spinPaused = false;
    this.bakedSeed = null;
    this.terrain = null;
    this.accum = 0;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) { this.failed = true; return; }
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d');
  }

  async init() { this.ready = !this.failed; return this.ready; }
  async loadTextures() { return false; }
  forgetGpuState() { this.bakedSeed = null; }
  async restore() { }
  refreshAfterResume() { this.bakedSeed = null; }

  setQuality(name) {
    if (name !== 'high' && name !== 'low') return;
    this.quality = name;
    this.bakedSeed = null;
  }

  // Resolution and refresh are what make this affordable. The planet is small
  // on screen anyway, and a climate that moves over millions of years does not
  // need sixty frames a second.
  settings() {
    return this.quality === 'low'
      ? { side: 120, bake: [96, 48], interval: 1 / 10 }
      : { side: 190, bake: [160, 80], interval: 1 / 20 };
  }

  render(world, state, dtReal) {
    if (this.failed || !this.ready) return;
    const cfg = this.settings();
    const c = this.canvas;
    const cw = Math.max(1, c.clientWidth), ch = Math.max(1, c.clientHeight);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }

    if (this.bakedSeed !== state.seed) {
      this.terrain = bakeTerrain(state.seed, cfg.bake[0], cfg.bake[1]);
      this.bakedSeed = state.seed;
    }

    const p = world.params, dg = world.diag;
    const lam = dg.lam;
    const spinRate = this.spinPaused ? 0
      : (1 - lam) * clamp(0.245 * Math.pow(24 / Math.max(p.rotationHours, 0.5), 0.35), 0.014, 0.63);
    this.spin = (this.spin + spinRate * dtReal) % (Math.PI * 2);

    // Redraw on a slower clock than the simulation; the last frame stays up in
    // between, so dragging still feels continuous without burning the CPU.
    this.accum += dtReal;
    if (this.accum < cfg.interval && this.drawn) { this.blit(); return; }
    this.accum = 0;

    const aspect = cw / ch;
    const W = Math.max(32, Math.round(cfg.side * Math.min(aspect, 1.6)));
    const H = Math.max(32, Math.round(cfg.side / Math.max(1 / aspect, 0.625)));
    if (this.buffer.width !== W || this.buffer.height !== H) {
      this.buffer.width = W; this.buffer.height = H;
      this.image = this.bctx.createImageData(W, H);
    }

    const bandT = new Float32Array(NBANDS), bandIce = new Float32Array(NBANDS);
    for (let i = 0; i < NBANDS; i++) {
      bandT[i] = world.T[i];
      bandIce[i] = dg.hasWater ? clamp(1 - (world.T[i] - 253) / 25, 0, 1) : 0;
    }
    const pH2O = dg.pH2O.reduce((a, b) => a + b, 0) / NBANDS;
    const cloud = dg.cloud.reduce((a, b) => a + b, 0) / NBANDS;
    const sc = SoftwareView.starColor(p.starTemp);

    renderPlanet(this.image.data, W, H, {
      yaw: this.yaw, pitch: this.pitch, spin: this.spin,
      sun: [0.62, 0.28, 0.73], starColor: sc,
      terrain: this.terrain, bandT, bandIce,
      oceanFrac: dg.flooded ?? dg.oceanFrac,
      waterCap: dg.waterCap, glaciated: dg.glaciatedShare ?? 1,
      locked: lam, cloud,
      steam: clamp((pH2O - 0.05) / 3, 0, 1),
      pTot: dg.pTotMean, co2: clamp(dg.pCO2 / Math.max(dg.pTotMean, 1e-6), 0, 1),
      nightGlow: clamp((dg.Tmean - 700) / 700, 0, 1),
      time: state.time,
    });
    this.bctx.putImageData(this.image, 0, 0);
    this.drawn = true;
    this.blit();
  }

  blit() {
    const ctx = this.ctx, c = this.canvas;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this.buffer, 0, 0, c.width, c.height);
  }

  static starColor(Teff) {
    const t = clamp((Teff - 2600) / (9000 - 2600), 0, 1);
    const r = 1, g = 0.52 + 0.44 * t, b = 0.24 + 0.76 * Math.pow(t, 0.85);
    const m = Math.max(r, g, b);
    return [r / m, g / m, b / m];
  }
}
