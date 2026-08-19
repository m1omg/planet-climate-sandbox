import { loadShaders } from './shaders.js';
import { NBANDS } from '../physics/climate.js';
import { clamp } from '../physics/constants.js';

// Raw WebGL2: one full-screen quad, the planet ray-traced analytically in the
// fragment shader. No geometry, no dependencies, and complete control over the
// atmosphere, the terminator and the steam envelope.
// The generated albedo maps, in the order the shader expects them.
export const TEXTURE_SET = ['rock', 'desert', 'vegetation', 'ice', 'ocean', 'lava'];
const TEX_UNIFORMS = ['uTexRock', 'uTexDesert', 'uTexVeg', 'uTexIce', 'uTexOcean', 'uTexLava'];

export class PlanetView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this.texturesLoaded = false;
    this.useTextures = 0;      // fades 0 -> 1 as the maps arrive
    this.wantTextures = true;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) { this.failed = true; return; }
    this.gl = gl;
  }

  // Shaders live in real .glsl files now, so start-up is asynchronous.
  async init() {
    if (this.failed) return false;
    const gl = this.gl;
    let src;
    try { src = await loadShaders(); }
    catch (e) { console.error(e); this.failed = true; return false; }
    this.prog = this.link(src.vert, src.frag);
    if (!this.prog) { this.failed = true; return false; }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    this.u = {};
    for (const name of ['uRes', 'uTime', 'uSpin', 'uSunDir', 'uStarColor', 'uSeed', 'uLandFrac',
      'uOceanFrac', 'uWaterCap', 'uCloud', 'uSteam', 'uPTot', 'uCO2', 'uMagma', 'uLocked',
      'uNightGlow', 'uYaw', 'uPitch', 'uUseTex', 'uBandT', 'uBandIce']) {
      this.u[name] = gl.getUniformLocation(this.prog, name === 'uBandT' || name === 'uBandIce' ? name + '[0]' : name);
    }
    this.bandT = new Float32Array(NBANDS);
    this.bandIce = new Float32Array(NBANDS);
    this.spin = 0;
    this.yaw = 0; this.pitch = 0;      // camera orbit, driven by dragging
    this.spinVel = 0;                  // momentum after a flick
    this.spinPaused = false;
    this.ready = true;
    return true;
  }

  // Load the generated albedo maps. Failure is not fatal: the planet simply
  // stays on the procedural path, which is a complete look in its own right.
  async loadTextures(dir = 'assets/textures/') {
    if (this.failed || !this.ready) return false;
    const gl = this.gl;
    const base = new URL(dir, location.href);
    try {
      const imgs = await Promise.all(TEXTURE_SET.map((name) => new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error(`missing texture ${name}.jpg`));
        im.src = new URL(`${name}.jpg`, base).href;
      })));
      this.textures = imgs.map((im, i) => {
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        // Repeat horizontally (the maps tile in longitude), clamp vertically.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        return t;
      });
      gl.useProgram(this.prog);
      TEX_UNIFORMS.forEach((name, i) => {
        const loc = gl.getUniformLocation(this.prog, name);
        if (loc) gl.uniform1i(loc, i);
      });
      this.texturesLoaded = true;
      return true;
    } catch (e) {
      console.warn('generated textures unavailable, staying procedural:', e.message);
      this.texturesLoaded = false;
      return false;
    }
  }

  link(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('shader compile failed:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('program link failed:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(c.clientWidth * dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  // Blackbody-ish tint for the star
  static starColor(Teff) {
    const t = clamp((Teff - 2600) / (9000 - 2600), 0, 1);
    const r = 1.0;
    const g = 0.52 + 0.44 * t;
    const b = 0.24 + 0.76 * Math.pow(t, 0.85);
    const m = Math.max(r, g, b);
    return [r / m, g / m, b / m];
  }

  render(world, state, dtReal) {
    if (this.failed || !this.ready) return;
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);

    const p = world.params, dg = world.diag;
    // Spin visually, at a rate suggesting the rotation period but always
    // watchable: real time, not simulated time, and independent of frame rate.
    const lam = dg.lam;
    const spinRate = this.spinPaused ? 0
      : (1 - lam) * clamp(0.245 * Math.pow(24 / Math.max(p.rotationHours, 0.5), 0.35), 0.014, 0.63);
    this.spin = (this.spin + spinRate * dtReal) % (Math.PI * 2);

    for (let i = 0; i < NBANDS; i++) {
      this.bandT[i] = world.T[i];
      this.bandIce[i] = dg.hasWater ? (1 - Math.min(1, Math.max(0, (world.T[i] - 253) / 25))) : 0;
    }

    const pH2Omean = dg.pH2O.reduce((a, b) => a + b, 0) / NBANDS;
    const steam = clamp((pH2Omean - 0.05) / 3, 0, 1);
    const co2Frac = clamp(dg.pCO2 / Math.max(dg.pTotMean, 1e-6), 0, 1);
    const cloudMean = dg.cloud.reduce((a, b) => a + b, 0) / NBANDS;
    const glow = clamp((dg.Tmean - 700) / 700, 0, 1);
    const sc = PlanetView.starColor(p.starTemp);

    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uTime, state.time);
    gl.uniform1f(this.u.uSpin, this.spin);
    gl.uniform3f(this.u.uSunDir, 0.62, 0.28, 0.73);
    gl.uniform3f(this.u.uStarColor, sc[0], sc[1], sc[2]);
    gl.uniform1f(this.u.uSeed, state.seed);
    gl.uniform1f(this.u.uLandFrac, p.landFraction);
    gl.uniform1f(this.u.uOceanFrac, dg.oceanFrac);
    gl.uniform1f(this.u.uWaterCap, dg.waterCap);
    gl.uniform1f(this.u.uCloud, cloudMean);
    gl.uniform1f(this.u.uSteam, steam);
    gl.uniform1f(this.u.uPTot, dg.pTotMean);
    gl.uniform1f(this.u.uCO2, co2Frac);
    gl.uniform1f(this.u.uMagma, clamp((dg.Tmean - 1200) / 400, 0, 1));
    gl.uniform1f(this.u.uLocked, lam);
    gl.uniform1f(this.u.uNightGlow, glow);
    // Cross-fade rather than snap, so toggling the surface style is a dissolve.
    const target = (this.wantTextures && this.texturesLoaded) ? 1 : 0;
    this.useTextures += clamp(target - this.useTextures, -3 * dtReal, 3 * dtReal);
    if (this.textures) {
      for (let i = 0; i < this.textures.length; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
      }
    }
    gl.uniform1f(this.u.uUseTex, this.useTextures);
    gl.uniform1f(this.u.uYaw, this.yaw);
    gl.uniform1f(this.u.uPitch, this.pitch);
    gl.uniform1fv(this.u.uBandT, this.bandT);
    gl.uniform1fv(this.u.uBandIce, this.bandIce);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
