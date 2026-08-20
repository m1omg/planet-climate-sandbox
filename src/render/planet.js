import { loadShaders, toES100, bakeES100 } from './shaders.js';
import { NBANDS } from '../physics/climate.js';
import { clamp } from '../physics/constants.js';

// Raw WebGL2: one full-screen quad, the planet ray-traced analytically in the
// fragment shader. No geometry, no dependencies, and complete control over the
// atmosphere, the terminator and the steam envelope.
// The generated albedo maps, in the order the shader expects them.
export const TEXTURE_SET = ['rock', 'desert', 'vegetation', 'ice', 'ocean', 'lava'];
const TEX_UNIFORMS = ['uTexRock', 'uTexDesert', 'uTexVeg', 'uTexIce', 'uTexOcean', 'uTexLava'];

// Quality settings. High is the default everywhere; Low is a manual choice for
// hardware that still struggles.
export const QUALITY = {
  high: { bake: 512, cloudBake: 256, relief: 1, cloudDetail: 1, scale: 1.0, maxDpr: 2 },
  low:  { bake: 256, cloudBake: 128, relief: 0, cloudDetail: 0, scale: 0.6, maxDpr: 1 },
};

// Cube-map faces in GL order; the bake shader's faceDir() matches this exactly.
const FACES = [
  'TEXTURE_CUBE_MAP_POSITIVE_X', 'TEXTURE_CUBE_MAP_NEGATIVE_X',
  'TEXTURE_CUBE_MAP_POSITIVE_Y', 'TEXTURE_CUBE_MAP_NEGATIVE_Y',
  'TEXTURE_CUBE_MAP_POSITIVE_Z', 'TEXTURE_CUBE_MAP_NEGATIVE_Z',
];

export class PlanetView {
  // `prefer` may ask for WebGL1 even where WebGL2 is available, so the fallback
  // path can be exercised deliberately rather than only by people whose
  // machines force it.
  constructor(canvas, prefer = 'webgl2') {
    this.canvas = canvas;
    this.ready = false;
    this.texturesLoaded = false;
    this.quality = 'high';
    this.bakedSeed = null;
    this.useTextures = 0;      // fades 0 -> 1 as the maps arrive
    this.wantTextures = true;
    // WebGL2 first, then WebGL1. The second is refused far less often -- older,
    // and covered by looser graphics blocklists -- and it still draws the planet
    // at full speed and resolution, which the software path cannot.
    const opts = { antialias: true, alpha: false, powerPreference: 'high-performance' };
    let gl = prefer === 'webgl1' ? null : canvas.getContext('webgl2', opts);
    this.gl1 = false;
    if (!gl) {
      gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      this.gl1 = !!gl;
    }
    if (!gl) { this.failed = true; return; }
    this.gl = gl;
    this.api = this.gl1 ? 'WebGL1' : 'WebGL2';

    // Mobile browsers throw the GPU context away when the tab goes to the
    // background, and every program, buffer, texture and framebuffer dies with
    // it. Without this the canvas comes back black -- and stays that way,
    // because the terrain is only rebaked when the world changes, so nothing
    // would ever notice the cube maps had ceased to exist.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();          // required, or the browser never restores it
      this.forgetGpuState();
      console.warn('WebGL context lost; rebuilding when the browser restores it');
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('WebGL context restored; rebuilding');
      this.restore();
    }, false);
  }

  // Drop every handle: they are all invalid once the context has gone, and
  // holding them would only invite drawing with rubbish.
  forgetGpuState() {
    this.ready = false;
    this.texturesLoaded = false;
    this.bakedSeed = null;
    this.prog = this.bakeProg = this.cloudProg = null;
    this.vao = null; this.bakeFb = null;
    this.textures = null;
    this.terrainCube = this.detailCube = this.cloudCube = null;
  }

  // Called when the tab comes back to the foreground. Some drivers quietly
  // evict textures while a page is away without ever reporting a lost context,
  // which leaves the planet drawing from cube maps that are no longer there.
  // Rebaking costs a few milliseconds and removes the whole class of "came back
  // blank" bugs.
  refreshAfterResume() {
    if (this.failed || !this.gl) return;
    if (this.gl.isContextLost()) { this.forgetGpuState(); return; }
    this.bakedSeed = null;      // force a rebake on the next frame
    this.forceResize = true;    // and a fresh drawing buffer to paint it into
  }

  // Rebuild after a restore. init() and loadTextures() are both guarded by the
  // flags cleared above, so they run again from scratch; the bake follows on the
  // next frame because bakedSeed is null.
  async restore() {
    if (this.failed) return;
    const ok = await this.init();
    if (ok) await this.loadTextures();
  }

  // Shaders live in real .glsl files now, so start-up is asynchronous.
  async init() {
    if (this.failed) return false;
    // Idempotent on purpose: re-initialising would reset the camera and the
    // planet's rotation, so calling this twice must be harmless.
    if (this.ready) return true;
    const gl = this.gl;
    let src;
    try { src = await loadShaders(); }
    catch (e) { console.error(e); this.failed = true; return false; }
    const V = this.gl1 ? (x) => toES100(x, 'vert') : (x) => x;
    const F = this.gl1 ? (x) => toES100(x, 'frag') : (x) => x;
    this.prog = this.link(V(src.vert), F(src.frag));
    if (!this.prog) { this.failed = true; return false; }
    this.bakeProg = this.link(V(src.bakeVert), this.gl1 ? bakeES100(src.bakeFrag) : src.bakeFrag);
    this.cloudProg = this.link(V(src.bakeVert), F(src.cloudFrag));
    if (!this.bakeProg || !this.cloudProg) { this.failed = true; return false; }

    const buf = gl.createBuffer();
    this.quadBuf = buf;
    if (!this.gl1) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      this.vao = vao;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    for (const name of ['uRes', 'uTime', 'uSpin', 'uSunDir', 'uStarColor', 'uSeed', 'uLandFrac',
      'uOceanFrac', 'uWaterCap', 'uGlaciated', 'uCloud', 'uSteam', 'uPTot', 'uCO2', 'uMagma', 'uLocked',
      'uNightGlow', 'uYaw', 'uPitch', 'uUseTex', 'uRelief', 'uCloudDetail',
      'uTerrain', 'uDetailMap', 'uCloudMap', 'uBandT', 'uBandIce']) {
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

  // ---------------------------------------------------------------------
  // Bake the planet's time-invariant surface fields into cube maps.
  //
  // Every noise evaluation the runtime shader used to make depended only on
  // position on the sphere and on the seed, so all of it can be done once here.
  // Cube maps rather than an equirectangular map because these are functions of
  // a direction: no pole pinching, no wrap seam, even resolution everywhere.
  // ---------------------------------------------------------------------
  makeCube(size) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
    for (const f of FACES) {
      const internal = this.gl1 ? gl.RGBA : gl.RGBA8;
      gl.texImage2D(gl[f], 0, internal, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // WebGL1 has no vertex array objects, so the quad is bound before each draw.
  bindQuad() {
    const gl = this.gl;
    if (this.vao) { gl.bindVertexArray(this.vao); return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  bakeSurface(seed) {
    if (this.failed || !this.ready) return;
    const gl = this.gl;
    const q = QUALITY[this.quality] ?? QUALITY.high;

    if (this.terrainCube) { gl.deleteTexture(this.terrainCube); gl.deleteTexture(this.detailCube); }
    this.terrainCube = this.makeCube(q.bake);
    this.detailCube = this.makeCube(q.bake);

    const fb = this.bakeFb ?? (this.bakeFb = gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.useProgram(this.bakeProg);
    this.bindQuad();
    gl.viewport(0, 0, q.bake, q.bake);
    gl.uniform2f(gl.getUniformLocation(this.bakeProg, 'uSize'), q.bake, q.bake);
    gl.uniform1f(gl.getUniformLocation(this.bakeProg, 'uSeed'), seed);
    const faceLoc = gl.getUniformLocation(this.bakeProg, 'uFace');
    if (this.gl1) {
      // No multiple render targets: run the same shader twice, once per output.
      const targetLoc = gl.getUniformLocation(this.bakeProg, 'uTarget');
      for (const [t, tex] of [[0, this.terrainCube], [1, this.detailCube]]) {
        gl.uniform1i(targetLoc, t);
        for (let i = 0; i < 6; i++) {
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl[FACES[i]], tex, 0);
          gl.uniform1i(faceLoc, i);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }
    } else {
      // Two attachments written in one pass; WebGL2 core, no extension needed.
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      for (let i = 0; i < 6; i++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl[FACES[i]], this.terrainCube, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl[FACES[i]], this.detailCube, 0);
        gl.uniform1i(faceLoc, i);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    // Clouds, in their own single-attachment pass.
    if (this.cloudCube) gl.deleteTexture(this.cloudCube);
    this.cloudCube = this.makeCube(q.cloudBake);
    gl.useProgram(this.cloudProg);
    gl.viewport(0, 0, q.cloudBake, q.cloudBake);
    gl.uniform2f(gl.getUniformLocation(this.cloudProg, 'uSize'), q.cloudBake, q.cloudBake);
    const cFaceLoc = gl.getUniformLocation(this.cloudProg, 'uFace');
    if (!this.gl1) {
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
    }
    for (let i = 0; i < 6; i++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl[FACES[i]], this.cloudCube, 0);
      gl.uniform1i(cFaceLoc, i);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.bakedSeed = seed;
    this.bakedQuality = this.quality;
  }

  setQuality(name) {
    if (!QUALITY[name] || name === this.quality) return;
    this.quality = name;
    if (this.ready && this.bakedSeed !== null) this.bakeSurface(this.bakedSeed);
  }

  // Load the generated albedo maps. Failure is not fatal: the planet simply
  // stays on the procedural path, which is a complete look in its own right.
  async loadTextures(dir = 'assets/textures/') {
    if (this.failed || !this.ready) return false;
    if (this.texturesLoaded) return true;
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
    gl.attachShader(p, v); gl.attachShader(p, f);
    // One vertex array is shared by the runtime and the bake programs, so the
    // attribute must land at the same index in all of them. The driver is free
    // to choose otherwise unless told.
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('program link failed:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  resize() {
    const c = this.canvas;
    const q = QUALITY[this.quality] ?? QUALITY.high;
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * q.scale;
    const w = Math.max(1, Math.floor(c.clientWidth * dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h || this.forceResize) {
      c.width = w; c.height = h;
      this.forceResize = false;
    }
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
    // Some devices lose the context without ever firing the event. Notice, and
    // stop drawing until it comes back rather than painting garbage.
    if (gl.isContextLost()) { this.forgetGpuState(); return; }
    // The terrain is a function of the seed alone, so it is rebaked only when
    // the world itself changes -- never for a climate or slider change.
    if (this.bakedSeed !== state.seed) this.bakeSurface(state.seed);
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    this.bindQuad();

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
    gl.uniform1f(this.u.uOceanFrac, dg.flooded ?? dg.oceanFrac);
    gl.uniform1f(this.u.uGlaciated, dg.glaciatedShare ?? 1);
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
    // The baked fields live above the albedo maps' texture units.
    gl.activeTexture(gl.TEXTURE0 + 6); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.terrainCube);
    gl.activeTexture(gl.TEXTURE0 + 7); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.detailCube);
    gl.activeTexture(gl.TEXTURE0 + 8); gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cloudCube);
    gl.uniform1i(this.u.uTerrain, 6);
    gl.uniform1i(this.u.uDetailMap, 7);
    gl.uniform1i(this.u.uCloudMap, 8);
    const q = QUALITY[this.quality] ?? QUALITY.high;
    gl.uniform1f(this.u.uRelief, q.relief);
    gl.uniform1f(this.u.uCloudDetail, q.cloudDetail);
    gl.uniform1f(this.u.uUseTex, this.useTextures);
    gl.uniform1f(this.u.uYaw, this.yaw);
    gl.uniform1f(this.u.uPitch, this.pitch);
    gl.uniform1fv(this.u.uBandT, this.bandT);
    gl.uniform1fv(this.u.uBandIce, this.bandIce);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
