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

// Decoded once per page load. loadTextures() runs again after every context
// restore, and decoding six full-size JPEGs there — on the main thread, at the
// moment the tab is coming back — cost a visible freeze and a spike of memory
// pressure that could lose the context all over again.
const decoded = new Map();
function decodeOnce(url) {
  let p = decoded.get(url);
  if (!p) {
    p = new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error(`missing texture ${url}`));
      im.src = url;
    }).catch((e) => { decoded.delete(url); throw e; });
    decoded.set(url, p);
  }
  return p;
}

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
    // Camera state belongs to the view, not to a GPU context: init() also runs
    // on restore() after a context loss, and zeroing these there threw the
    // viewpoint away every time the tab came back or the renderer was swapped.
    this.spin = 0; this.yaw = 0; this.pitch = 0;
    this.spinVel = 0; this.spinPaused = false;
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

    // The shader needs three cube maps plus the band texture no matter what;
    // the six albedo maps are the optional extra. WebGL1 only guarantees eight
    // texture units, so on a device at that floor the albedo path is compiled
    // out rather than left to fail at link time.
    this.maxTexUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) || 8;
    this.maxFragUniforms = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 16;
    this.albedoCapable = this.maxTexUnits >= 10;

    // Mobile browsers throw the GPU context away when the tab goes to the
    // background, and every program, buffer, texture and framebuffer dies with
    // it. Without this the canvas comes back black -- and stays that way,
    // because the terrain is only rebaked when the world changes, so nothing
    // would ever notice the cube maps had ceased to exist.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();          // required, or the browser never restores it
      this.contextLost = true;
      this.lostSince = performance.now();
      this.forgetGpuState();
      console.warn('WebGL context lost; rebuilding when the browser restores it');
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('WebGL context restored; rebuilding');
      this.contextLost = false;
      this.restore();
    }, false);
  }

  // A transient failure is one caused by the context being gone right now: the
  // hardware is fine and the browser will hand it back. Latching `failed` on one
  // of those is what turned a momentary loss into a permanently black canvas,
  // so failures are only made permanent when the context is actually alive to
  // have refused us.
  fail(reason) {
    if (!this.gl || this.gl.isContextLost()) {
      this.contextLost = true;
      this.lostSince = this.lostSince ?? performance.now();
      console.warn(`deferring "${reason}" — the context is gone; will rebuild`);
      return false;
    }
    this.diagnostic = this.diagnostic || reason;
    this.failed = true;
    this.onFatal?.(reason);
    return true;
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
    this.bandTex = null;
    this.terrainCube = this.detailCube = this.cloudCube = null;
  }

  // Called when the tab comes back to the foreground. Some drivers quietly
  // evict textures while a page is away without ever reporting a lost context,
  // which leaves the planet drawing from cube maps that are no longer there.
  // Rebaking costs a few milliseconds and removes the whole class of "came back
  // blank" bugs.
  refreshAfterResume() {
    if (this.failed || !this.gl) return;
    if (this.gl.isContextLost()) {
      this.contextLost = true;
      this.lostSince = this.lostSince ?? performance.now();
      this.forgetGpuState();
      return;
    }
    this.forceResize = true;    // a fresh drawing buffer to paint into
    // Rebake only if the cube maps really did go away. Unconditionally rebaking
    // meant every single app switch paid for eighteen full-resolution noise
    // passes at exactly the moment the compositor was busiest — a visible stall,
    // and enough sustained GPU work to trip Chromium's watchdog on a tablet,
    // which lost the context and turned a hitch into a black screen.
    const gone = !this.terrainCube || !this.gl.isTexture(this.terrainCube)
      || !this.detailCube || !this.gl.isTexture(this.detailCube)
      || !this.cloudCube || !this.gl.isTexture(this.cloudCube);
    if (gone) this.bakedSeed = null;
  }

  // Rebuild after a restore. init() and loadTextures() are both guarded by the
  // flags cleared above, so they run again from scratch; the bake follows on the
  // next frame because bakedSeed is null.
  async restore() {
    if (this.failed) return false;
    if (this.gl?.isContextLost()) return false;
    const ok = await this.init();
    if (!ok) return false;
    this.contextLost = false;
    this.lostSince = null;
    await this.loadTextures();
    return true;
  }

  // Shaders live in real .glsl files now, so start-up is asynchronous.
  init() {
    // Re-entrancy guard. init() awaits a fetch partway through, so a second
    // caller — a restore racing a resume, say — could sail past the `ready`
    // check and build a whole second set of programs over the first.
    if (!this._initing) {
      this._initing = this._init().finally(() => { this._initing = null; });
    }
    return this._initing;
  }

  async _init() {
    if (this.failed) return false;
    // Idempotent on purpose: re-initialising would reset the camera and the
    // planet's rotation, so calling this twice must be harmless.
    if (this.ready) return true;
    const gl = this.gl;
    let src;
    try { src = await loadShaders(); }
    catch (e) { console.error(e); this.fail(`shader sources unavailable: ${e.message}`); return false; }
    if (gl.isContextLost()) { this.fail('context lost during start-up'); return false; }
    const V = this.gl1 ? (x) => toES100(x, 'vert') : (x) => x;
    const defines = this.albedoCapable ? '' : '#define NO_ALBEDO 1\n';
    const withDefines = (x) => (defines
      ? x.replace(/^(#version[^\n]*\n)?/, (m) => m + defines)
      : x);
    const F = this.gl1 ? (x) => withDefines(toES100(x, 'frag')) : (x) => withDefines(x);
    this.prog = this.link(V(src.vert), F(src.frag));
    if (!this.prog) { this.fail('the planet program would not build'); return false; }
    this.bakeProg = this.link(V(src.bakeVert), this.gl1 ? bakeES100(src.bakeFrag) : src.bakeFrag);
    this.cloudProg = this.link(V(src.bakeVert), F(src.cloudFrag));
    if (!this.bakeProg || !this.cloudProg) { this.fail('the bake programs would not build'); return false; }

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
      'uTerrain', 'uDetailMap', 'uCloudMap', 'uBands']) {
      this.u[name] = gl.getUniformLocation(this.prog, name);
    }

    // Per-band temperature and ice travel to the shader as an 18x1 texture.
    // NEAREST, because the 16-bit temperature is packed across two channels and
    // filtering them separately would corrupt every boundary.
    this.bandBytes = new Uint8Array(NBANDS * 4);
    this.bandTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.bandTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NBANDS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.bandBytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.ready = true;

    // Prove the whole path works before claiming success. Compiling and linking
    // says nothing about whether this driver will render to a cube-map face, and
    // returning true from a renderer that cannot draw is what let a broken
    // WebGL1 path masquerade as a working one.
    this.bakeSurface(1.0);
    if (this.bakeFailed) {
      this.ready = false;
      this.fail(this.diagnostic || 'the trial bake did not draw');
      return false;
    }
    this.bakeFails = 0;
    this.bakedSeed = null;      // force a real bake with the true seed
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
    if (gl.isContextLost()) { this.contextLost = true; this.forgetGpuState(); return; }
    // A bake that fails leaves bakedSeed alone, so render() asks for another one
    // on the very next frame. Unthrottled, that deletes and reallocates three
    // cube maps sixty times a second — the GPU thrashes, the page stops
    // responding, and the real fault is never reported. Back off, then give up
    // and let the app fall back to a renderer that works.
    if (this.bakeFails) {
      const now = performance.now();
      if (now - this.lastBakeTry < Math.min(300 * (1 << this.bakeFails), 1500)) return;
      this.lastBakeTry = now;
    }
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

    // A framebuffer that is not complete draws nothing, silently, and rendering
    // to a cube-map face is exactly where a driver is most likely to object.
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      this.diagnostic = `${this.api} cannot render to a cube map (framebuffer status 0x${status.toString(16)})`;
      this.noteBakeFailure();
      return;
    }
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      this.diagnostic = `${this.api} bake raised GL error 0x${err.toString(16)}`;
      this.noteBakeFailure();
      return;
    }
    this.bakeFailed = false;
    this.bakeFails = 0;
    this.bakedSeed = seed;
    this.bakedQuality = this.quality;
  }

  noteBakeFailure() {
    this.bakeFailed = true;
    this.lastBakeTry = performance.now();
    // The context dying mid-bake is not the driver refusing us; that is the
    // restore path's business and must not count against the retry budget.
    if (this.gl.isContextLost()) {
      this.contextLost = true;
      this.lostSince = this.lostSince ?? performance.now();
      this.forgetGpuState();
      return;
    }
    this.bakeFails = (this.bakeFails || 0) + 1;
    if (this.bakeFails >= 4 && this.ready) {   // about four seconds of trying
      this.ready = false;
      this.fail(this.diagnostic || 'the surface bake kept failing');
    }
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
    if (!this.albedoCapable) return false;
    if (this.texturesLoaded) return true;
    const gl = this.gl;
    try {
      const base = new URL(dir, location.href);
      const imgs = await Promise.all(TEXTURE_SET.map((name) => decodeOnce(new URL(`${name}.jpg`, base).href)));
      if (gl.isContextLost()) { this.contextLost = true; return false; }
      // Power-of-two only in WebGL1: REPEAT wrapping and mipmaps are both
      // illegal on an NPOT texture there, and the result is not an error but a
      // texture that samples pure black. These maps are 1774x887.
      const pot = (n) => (n & (n - 1)) === 0;
      this.textures = imgs.map((im, i) => {
        const npot = this.gl1 && !(pot(im.naturalWidth) && pot(im.naturalHeight));
        const t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        // Repeat horizontally (the maps tile in longitude), clamp vertically.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, npot ? gl.CLAMP_TO_EDGE : gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
          npot ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (!npot) gl.generateMipmap(gl.TEXTURE_2D);
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
        const log = (gl.getShaderInfoLog(s) || '').trim();
        this.diagnostic = `${this.api} shader compile failed: ${log.split('\n')[0]}`;
        console.error('shader compile failed:', log);
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
      const log = (gl.getProgramInfoLog(p) || '').trim();
      this.diagnostic = `${this.api} program link failed: ${log.split('\n')[0]}`;
      console.error('program link failed:', log);
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
    // Binding a null cube map is legal and samples black, so drawing without the
    // baked fields produces a convincingly rendered black planet rather than an
    // error. Skip the frame instead; the last good one stays on screen.
    if (!this.ready || !this.terrainCube || !this.detailCube || !this.cloudCube) return;
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
      // Truncate rather than round the low byte: rounding lets the residual
      // reach 256, which a byte stores as 0, decoding ~16 K too cold and
      // painting a flickering stripe across that band.
      const t = Math.round(clamp(world.T[i] / 4000, 0, 1) * 65535);
      const hi = t >> 8;
      this.bandBytes[i * 4] = hi;
      this.bandBytes[i * 4 + 1] = t & 255;
      this.bandBytes[i * 4 + 2] = 255 * (dg.hasWater ? clamp(1 - (world.T[i] - 253) / 25, 0, 1) : 0);
      this.bandBytes[i * 4 + 3] = 255;
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
    gl.activeTexture(gl.TEXTURE0 + 9);
    gl.bindTexture(gl.TEXTURE_2D, this.bandTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NBANDS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.bandBytes);
    gl.uniform1i(this.u.uBands, 9);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
