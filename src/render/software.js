import { bakeTerrain, bakeClouds, renderPlanet, renderSky } from './cpushade.js';
import { NBANDS } from '../physics/climate.js';
import { clamp, steamOpacity } from '../physics/constants.js';
import { atmosphereLook, cloudLook } from './atmosphere.js';
import { seaLevelForLand } from './terrain.js';

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
    this.realistic = false;
    this.spin = 0; this.yaw = 0; this.pitch = 0; this.spinVel = 0; this.zoom = 1;
    this.spinPaused = false;
    this.bakedSeed = null;
    this.terrain = null;
    this.accum = 0;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) { this.failed = true; return; }
    // Two layers. The planet is shaded small and scaled up; the sky is drawn
    // once at full resolution and cached, because stars magnified four times
    // stop looking like stars.
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d');
    this.sky = document.createElement('canvas');
    this.sctx = this.sky.getContext('2d');
    this.skyKey = '';
  }

  async init() { this.ready = !this.failed; return this.ready; }
  async loadTextures() { return false; }
  forgetGpuState() { this.bakedSeed = null; }
  async restore() { }
  // The terrain is plain JavaScript arrays and survives; what does not
  // necessarily survive is the offscreen canvases' backing store, which a
  // browser may discard while the page is in the background. Forcing a full
  // repaint costs one frame and avoids coming back to a blank disc.
  refreshAfterResume() {
    this.skyKey = '';
    this.drawn = false;
    this.accum = Infinity;
  }

  setQuality(name) {
    if (name !== 'high' && name !== 'low') return;
    this.quality = name;
    this.bakedSeed = null;
  }

  // Sized by a pixel budget rather than a fixed width, so the resolution follows
  // the shape of the window instead of the planet being squashed into whatever
  // a square buffer happened to give. The budget is set from measured
  // throughput -- about 7.8 Mpx/s -- against the refresh interval, and a climate
  // that moves over millions of years does not need sixty frames a second.
  settings() {
    // Budgets set from measurement, not guesswork: the disc costs about 570 ns
    // a pixel and covers 24% of the frame, so 340k frame pixels is ~44 ms. The
    // sky is drawn separately at full resolution and cached, so it is not in
    // this budget at all.
    return this.quality === 'low'
      ? { budget: 130000, bake: [128, 64], interval: 1 / 10, relief: 0 }
      : { budget: 340000, bake: [224, 112], interval: 1 / 18, relief: 1 };
  }

  render(world, state, dtReal) {
    if (this.failed || !this.ready) return;
    const cfg = this.settings();
    const c = this.canvas;
    // Match the device's real pixels, as the GPU path does. Ignoring this meant
    // the small buffer was stretched twice over on any HiDPI screen.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(c.clientWidth * dpr));
    const ch = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; this.skyKey = ''; }

    if (this.bakedSeed !== state.seed) {
      this.terrain = bakeTerrain(state.seed, cfg.bake[0], cfg.bake[1]);
      this.clouds = bakeClouds(state.seed, Math.round(cfg.bake[0] * 0.6), Math.round(cfg.bake[1] * 0.6));
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

    // The buffer must have the canvas's aspect ratio, or scaling it up turns
    // the planet into an ellipse.
    // Fit the budget to the canvas's aspect ratio, and never render larger than
    // the canvas itself -- upscaling is free, rendering pixels nobody sees is not.
    const aspect = cw / ch;
    const scale = Math.min(1, Math.sqrt(cfg.budget / (cw * ch)));
    const W = Math.max(64, Math.round(cw * scale));
    const H = Math.max(48, Math.round(ch * scale));
    if (this.buffer.width !== W || this.buffer.height !== H) {
      this.buffer.width = W; this.buffer.height = H;
      this.image = this.bctx.createImageData(W, H);
    }

    // The sky only changes when the camera or the atmosphere does.
    const pH2Oq = dg.pH2O.reduce((a, b) => a + b, 0) / NBANDS;
    const steamQ = steamOpacity(pH2Oq);
    const skyKey = [cw, ch, this.yaw.toFixed(3), this.pitch.toFixed(3),
                    dg.pTotMean.toFixed(3), steamQ.toFixed(2), p.starTemp, this.realistic ? 'r' : 's', this.zoom.toFixed(3)].join('|');
    if (skyKey !== this.skyKey) {
      if (this.sky.width !== cw || this.sky.height !== ch) { this.sky.width = cw; this.sky.height = ch; }
      const img = this.sctx.createImageData(cw, ch);
      const skyAtmo = atmosphereLook(world, steamQ, this.realistic);
      renderSky(img.data, cw, ch, {
        atmoThick: skyAtmo.thickness, veil: skyAtmo.veil, haze: skyAtmo.haze,
        yaw: this.yaw, pitch: this.pitch, zoom: this.zoom, sun: [0.62, 0.28, 0.73],
        starColor: SoftwareView.starColor(p.starTemp),
        pTot: dg.pTotMean, steam: steamQ,
        co2: clamp(dg.pCO2 / Math.max(dg.pTotMean, 1e-6), 0, 1),
        time: state.time,
      });
      this.sctx.putImageData(img, 0, 0);
      this.skyKey = skyKey;
    }

    const bandT = new Float32Array(NBANDS), bandIce = new Float32Array(NBANDS);
    for (let i = 0; i < NBANDS; i++) {
      bandT[i] = world.T[i];
      bandIce[i] = dg.hasWater ? clamp(1 - (world.T[i] - 253) / 25, 0, 1) : 0;
    }
    const pH2O = dg.pH2O.reduce((a, b) => a + b, 0) / NBANDS;
    const cloud = cloudLook(dg.cloud.reduce((a, b) => a + b, 0) / NBANDS, pH2O);
    const sc = SoftwareView.starColor(p.starTemp);

    const atmo = atmosphereLook(world, clamp(steamOpacity(pH2O), 0, 1), this.realistic);
    renderPlanet(this.image.data, W, H, {
      atmoThick: atmo.thickness, veil: atmo.veil, haze: atmo.haze,
      yaw: this.yaw, pitch: this.pitch, spin: this.spin, zoom: this.zoom,
      tilt: (1 - lam) * (p.obliquity || 0) * Math.PI / 180,
      sun: [0.62, 0.28, 0.73], starColor: sc,
      terrain: this.terrain, bandT, bandIce,
      oceanFrac: dg.flooded ?? dg.oceanFrac,
      seaLevel: seaLevelForLand(1 - (dg.flooded ?? dg.oceanFrac)),
      waterCap: dg.waterCap, glaciated: dg.glaciatedShare ?? 1,
      locked: lam, cloud,
      steam: steamOpacity(pH2O),
      pTot: dg.pTotMean, co2: clamp(dg.pCO2 / Math.max(dg.pTotMean, 1e-6), 0, 1),
      nightGlow: clamp((dg.Tmean - 700) / 700, 0, 1),
      time: state.time, relief: cfg.relief, clouds: this.clouds,
    });
    this.bctx.putImageData(this.image, 0, 0);
    this.drawn = true;
    this.blit();
  }

  blit() {
    const ctx = this.ctx, c = this.canvas;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Full-resolution sky underneath, upscaled planet over it.
    if (this.sky.width) ctx.drawImage(this.sky, 0, 0);
    else ctx.clearRect(0, 0, c.width, c.height);
    if (this.drawn) ctx.drawImage(this.buffer, 0, 0, c.width, c.height);
  }

  static starColor(Teff) {
    const t = clamp((Teff - 2600) / (9000 - 2600), 0, 1);
    const r = 1, g = 0.52 + 0.44 * t, b = 0.24 + 0.76 * Math.pow(t, 0.85);
    const m = Math.max(r, g, b);
    return [r / m, g / m, b / m];
  }
}
