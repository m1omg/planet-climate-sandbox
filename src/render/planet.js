import { loadShaders, toES100, bakeES100 } from './shaders.js';
import { NBANDS } from '../physics/climate.js';
import { clamp, smoothstep, steamOpacity } from '../physics/constants.js';
import { atmosphereLook, cloudLook } from './atmosphere.js';
import { seaLevelForLand } from './terrain.js';

// Raw WebGL2: one full-screen quad, the planet ray-traced analytically in the
// fragment shader. No geometry, no dependencies, and complete control over the
// atmosphere, the terminator and the steam envelope.
// The generated albedo maps, in the order the shader expects them.
export const TEXTURE_SET = ['rock', 'desert', 'vegetation', 'ice', 'ocean', 'lava'];

// Real worlds, and which of them has topography to go with its photograph.
// Only Earth: it is the one body with a clean public-domain grayscale DEM at a
// usable size, and a wrong Mars is worse than a procedural one.
// Where the surface maps and textures live, relative to the page.
//
// Normally alongside index.html, which is what the plain 'assets/' means. The
// override exists so a second copy of the site can be served from a
// subdirectory -- /altdev/ on the Pages site -- without a second 23 MB copy of
// the JPEGs to go with it. That copy sets window.__assetBase to '../assets/'
// and shares the ones at the root.
function assetBase() {
  const b = (typeof window !== 'undefined' && window.__assetBase) || 'assets/';
  return b.endsWith('/') ? b : `${b}/`;
}

export const BODY_MAPS = {
  earth: { colour: 'earth.jpg', height: 'earth_height.png' },
  preindustrial: { colour: 'earth.jpg', height: 'earth_height.png' },
  futureEarth: { colour: 'earth.jpg', height: 'earth_height.png' },
  mars: { colour: 'mars.jpg', height: 'mars_height.png' },
  // Noachian Mars is Mars. Almost everything on that map is older than the
  // epoch this preset is set in -- the crustal dichotomy, Hellas, Argyre and
  // the whole cratered southern highlands are Noachian-aged -- so the shape of
  // the planet is right, and it was rendering as an invented world with a
  // random seed. The colour is the caveat: that rust is billions of years of
  // oxidation this world has not had yet, and a wet Noachian Mars would have
  // been darker and greyer. Shape right, palette anachronistic, and that is a
  // better trade than a procedural planet that is not Mars at all.
  earlyMars: { colour: 'mars.jpg', height: 'mars_height.png' },
  venus: { colour: 'venus.jpg' },
  titan: { colour: 'titan.jpg' },
  // Early Venus and the Archean deliberately get NO map, and it is the same
  // reason in both cases: the real surface is younger than the preset. Every
  // feature on the Magellan map post-dates Venus's global resurfacing 715 Myr
  // ago, which this world has not reached yet and may never; and the Archean
  // had perhaps a tenth of today's continental area, nowhere near where the
  // coastlines are now. A procedural world is honest about not knowing. Earth's
  // map on an Archean planet would be a claim, and a false one.
};
const TEX_UNIFORMS = ['uTexRock', 'uTexDesert', 'uTexVeg', 'uTexIce', 'uTexOcean', 'uTexLava'];

// Quality settings. High is the default everywhere; Low is a manual choice for
// hardware that still struggles.
// How close and how far the camera may get. Closer than 0.42 and the near
// plane clips the sphere; further than 3 and the planet is a dot.
export const MIN_ZOOM = 0.42, MAX_ZOOM = 3.0;

export const QUALITY = {
  high: { bake: 512, cloudBake: 256, relief: 1, cloudDetail: 1, scale: 1.0, maxDpr: 2 },
  low:  { bake: 256, cloudBake: 128, relief: 0, cloudDetail: 0, scale: 0.6, maxDpr: 1 },
};

// How much of a cube-map face one draw call may cover. The bake shader costs
// ~139 noise evaluations a texel -- about 3300 sin() calls -- so a whole 512x512
// face in one submit is 1.6 billion of them, which Android's GPU watchdog treats
// as a hung driver and resets. Sixteen thousand texels is a few milliseconds on
// any GPU that can run this at all.
// How fast the drawn sea ice may change, per second of wall clock. 1.6 is a
// full swing from open water to frozen over in about two thirds of a second.
const ICE_EASE = 1.6;

const TILE_TEXELS = 16384;
const TILES_PER_FRAME = 4;

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
    this.realistic = false;   // stylised atmosphere by default
    this.bakedSeed = null;
    // Camera state belongs to the view, not to a GPU context: init() also runs
    // on restore() after a context loss, and zeroing these there threw the
    // viewpoint away every time the tab came back or the renderer was swapped.
    this.spin = 0; this.yaw = 0; this.pitch = 0; this.zoom = 1;
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
    // The real-world maps need two more units on top of the albedo set.
    this.bodyCapable = this.maxTexUnits >= 12;
    this.body = null; this.bodyMix = 0; this.bodyTarget = 0; this.bodyHasHeight = 0;

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
    this.bakeJob = null;
    this.bodyColourTex = this.bodyHeightTex = this.blankTex = null;
    const wasBody = this.body; this.body = null; this.bodyMix = 0;
    this.pendingBody = wasBody;   // reloaded once the context is back
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
      // Restamp, do not keep the old mark. The clock on "has the browser given
      // the context back yet" has to start when the page is in front of the
      // user, because that is when the browser starts trying. It used to be
      // stamped at the moment of loss -- which happens while the page is being
      // backgrounded -- so coming back after more than the grace period meant
      // the app declared the context unrecoverable on the very first frame,
      // before the browser had any chance to restore it. Switch away for five
      // seconds and you would be told the GPU had dropped out.
      this.lostSince = performance.now();
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
    if (this.pendingBody) { const b = this.pendingBody; this.pendingBody = null; await this.setBody(b); }
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
    let defines = this.albedoCapable ? '' : '#define NO_ALBEDO 1\n';
    if (this.bodyCapable) defines += '#define BODY_MAP 1\n';
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
      'uAtmoThick', 'uVeil', 'uHaze', 'uZoom', 'uTilt', 'uSeaLevel', 'uBio',
      'uBodyMap', 'uBodyHeight', 'uBodyMix', 'uBodyHasHeight',
      'uTerrain', 'uDetailMap', 'uCloudMap', 'uBands']) {
      this.u[name] = gl.getUniformLocation(this.prog, name);
    }

    // Per-band temperature and ice travel to the shader as an 18x1 texture.
    // NEAREST, because the 16-bit temperature is packed across two channels and
    // filtering them separately would corrupt every boundary.
    this.bandBytes = new Uint8Array(NBANDS * 4);
    // The eased sea-ice value the shader actually sees. `null` until the first
    // frame, which then seeds it with the true state instead of thawing the
    // world from zero -- a snowball must not fade in from open ocean.
    this.bandIce = new Float32Array(NBANDS);
    this.bandIceSeeded = false;
    this.iceSeed = null;
    this.bandTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.bandTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NBANDS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.bandBytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Something valid must be bound to the body samplers even when no real
    // world is loaded: the shader still samples them, it just weights the
    // result to nothing.
    if (this.bodyCapable) {
      this.blankTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.blankTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([128, 128, 128, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    this.ready = true;

    // Prove the whole path works before claiming success. Compiling and linking
    // says nothing about whether this driver will render to a cube-map face, and
    // returning true from a renderer that cannot draw is what let a broken
    // WebGL1 path masquerade as a working one.
    // Prove the whole path works before claiming success: compiling and linking
    // says nothing about whether this driver will render to a cube-map face,
    // and returning true from a renderer that cannot draw is what let a broken
    // WebGL1 path masquerade as a working one.
    //
    // One strip is enough to find that out. This used to run a complete bake
    // here and then throw it away by clearing bakedSeed, so start-up paid for
    // the most expensive operation in the program twice over.
    this.beginBake(1.0);
    this.advanceBake(1);
    if (this.bakeFailed) {
      this.ready = false;
      this.fail(this.diagnostic || 'the trial bake did not draw');
      return false;
    }
    this.bakeJob = null;
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

  // ---------------------------------------------------------------------
  // The bake, in bounded pieces.
  //
  // This used to be twelve draw calls, each covering a whole 512x512 cube face
  // at 139 noise evaluations a texel -- about 1.6 BILLION sin() calls in a
  // single submit, six times over. A desktop driver just takes the second or
  // two. Android does not: the driver's hang detector resets the GPU on a
  // submit that long, which loses the context, which makes this code rebake,
  // which hangs it again. That was the freeze and the black screen on a tablet
  // whose GPU is perfectly capable of drawing the planet at sixty frames a
  // second -- it was never the drawing, it was one enormous piece of work.
  //
  // So no submit is unbounded any more. Rasterisation is clipped to a strip
  // with the scissor box, a fixed number of texels at a time, a few strips per
  // frame. The total work is identical; it simply arrives in pieces the driver
  // will accept.
  // ---------------------------------------------------------------------
  beginBake(seed) {
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
    if (this.cloudCube) gl.deleteTexture(this.cloudCube);
    this.terrainCube = this.makeCube(q.bake);
    this.detailCube = this.makeCube(q.bake);
    this.cloudCube = this.makeCube(q.cloudBake);

    // Strip heights chosen so every draw covers the same number of texels
    // whatever the bake resolution, because it is the size of one submit that
    // the driver's watchdog cares about, not the size of the map.
    const tiles = [];
    const strip = (size) => Math.max(1, Math.min(size, Math.floor(TILE_TEXELS / size)));
    const sT = strip(q.bake), sC = strip(q.cloudBake);
    // WebGL1 has no multiple render targets, so the terrain shader runs twice,
    // once per output; WebGL2 writes both attachments in one pass.
    const targets = this.gl1 ? [0, 1] : [-1];
    for (const t of targets) {
      for (let f = 0; f < 6; f++) {
        for (let y = 0; y < q.bake; y += sT) {
          tiles.push({ cloud: 0, target: t, face: f, y, h: Math.min(sT, q.bake - y) });
        }
      }
    }
    for (let f = 0; f < 6; f++) {
      for (let y = 0; y < q.cloudBake; y += sC) {
        tiles.push({ cloud: 1, target: -1, face: f, y, h: Math.min(sC, q.cloudBake - y) });
      }
    }
    this.bakeJob = { seed, quality: this.quality, size: q.bake, cloudSize: q.cloudBake, tiles, i: 0 };
    if (!this.bakeFb) this.bakeFb = gl.createFramebuffer();
  }

  // Run a few strips. Returns true while there is still work to do.
  advanceBake(maxTiles = TILES_PER_FRAME) {
    const job = this.bakeJob;
    if (!job) return false;
    const gl = this.gl;
    if (gl.isContextLost()) {
      this.bakeJob = null;
      this.contextLost = true;
      this.lostSince = this.lostSince ?? performance.now();
      this.forgetGpuState();
      return false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bakeFb);
    gl.enable(gl.SCISSOR_TEST);
    let ran = 0;
    while (job.i < job.tiles.length && ran < maxTiles) {
      const t = job.tiles[job.i];
      const prog = t.cloud ? this.cloudProg : this.bakeProg;
      const size = t.cloud ? job.cloudSize : job.size;
      gl.useProgram(prog);
      this.bindQuad();
      gl.viewport(0, 0, size, size);
      gl.scissor(0, t.y, size, t.h);
      gl.uniform2f(gl.getUniformLocation(prog, 'uSize'), size, size);
      gl.uniform1f(gl.getUniformLocation(prog, 'uSeed'), job.seed);
      gl.uniform1i(gl.getUniformLocation(prog, 'uFace'), t.face);
      if (t.cloud) {
        if (!this.gl1) {
          gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0);
        }
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl[FACES[t.face]], this.cloudCube, 0);
      } else if (this.gl1) {
        gl.uniform1i(gl.getUniformLocation(prog, 'uTarget'), t.target);
        const tex = t.target === 0 ? this.terrainCube : this.detailCube;
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl[FACES[t.face]], tex, 0);
      } else {
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl[FACES[t.face]], this.terrainCube, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl[FACES[t.face]], this.detailCube, 0);
      }

      // A framebuffer that is not complete draws nothing, silently, and
      // rendering to a cube-map face is exactly where a driver objects. Check
      // on the first strip, before spending the rest of the budget on it.
      if (job.i === 0) {
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          gl.disable(gl.SCISSOR_TEST);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          this.bakeJob = null;
          this.diagnostic = `${this.api} cannot render to a cube map (framebuffer status 0x${status.toString(16)})`;
          this.noteBakeFailure();
          return false;
        }
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      job.i++; ran++;
    }
    gl.disable(gl.SCISSOR_TEST);

    const done = job.i >= job.tiles.length;
    if (done) {
      const err = gl.getError();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.bakeJob = null;
      if (err !== gl.NO_ERROR) {
        this.diagnostic = `${this.api} bake raised GL error 0x${err.toString(16)}`;
        this.noteBakeFailure();
        return false;
      }
      this.bakeFailed = false;
      this.bakeFails = 0;
      this.bakedSeed = job.seed;
      this.bakedQuality = job.quality;
      return false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  // Begin and finish in one go. Used by the start-up capability check and by
  // the test harnesses; the frame loop always goes through advanceBake.
  bakeSurface(seed) {
    this.beginBake(seed);
    let guard = 0;
    while (this.advanceBake(Infinity) && guard++ < 10000);
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
    if (this.ready && this.bakedSeed !== null) this.beginBake(this.bakedSeed);
  }

  // Load the generated albedo maps. Failure is not fatal: the planet simply
  // stays on the procedural path, which is a complete look in its own right.
  async loadTextures(dir = `${assetBase()}textures/`) {
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

  // Show a real world. `name` is a preset key, or null to go back to the
  // procedural terrain. The change is not instant: bodyMix is eased in render()
  // and the shader dissolves it region by region.
  async setBody(name) {
    if (!this.bodyCapable || this.failed) return false;
    const def = name ? BODY_MAPS[name] : null;
    if (!def) { this.body = null; this.bodyTarget = 0; return false; }
    if (this.body === name) { this.bodyTarget = 1; return true; }
    const gl = this.gl;
    const base = new URL(`${assetBase()}bodies/`, location.href);
    try {
      const [colour, height] = await Promise.all([
        decodeOnce(new URL(def.colour, base).href),
        def.height ? decodeOnce(new URL(def.height, base).href) : Promise.resolve(null),
      ]);
      if (gl.isContextLost() || !this.ready) return false;
      const upload = (img, unit, existing) => {
        const t = existing || gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        // Wrap in longitude, clamp at the poles, and no mipmaps: these are
        // 2048x1024, which is not a power of two in WebGL1's sense of the word.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return t;
      };
      this.bodyColourTex = upload(colour, 10, this.bodyColourTex);
      if (height) this.bodyHeightTex = upload(height, 11, this.bodyHeightTex);
      this.bodyHasHeight = height ? 1 : 0;
      this.body = name;
      this.bodyTarget = 1;
      return true;
    } catch (e) {
      console.warn('body map unavailable, staying procedural:', e.message);
      this.body = null; this.bodyTarget = 0;
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
    // Start a bake when the world changes, and push a few strips along every
    // frame until it is done. Never all of it at once -- see beginBake.
    if (!this.bakeJob && this.bakedSeed !== state.seed) this.beginBake(state.seed);
    if (this.bakeJob) this.advanceBake();
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

    // How frozen each band's sea is, eased over wall-clock time rather than
    // taken straight from the state.
    //
    // The number itself is a 25 K ramp and perfectly smooth in temperature.
    // What is not smooth is how fast a planet crosses it: measured at 100
    // kyr/s, a world at the ice edge goes from open water to fully frozen with
    // a per-frame jump of 0.96 -- the whole ramp inside a single frame, because
    // one frame is sixteen hundred simulated years. The planet really did
    // freeze that fast. The picture teleporting is still wrong, and it is the
    // same complaint as a runaway happening between two frames.
    //
    // So this eases at a fixed rate in SECONDS, not in simulated time: a full
    // swing takes about two thirds of a second however fast the clock is
    // running, and the readouts keep showing the true state throughout.
    //
    // Below the triple point it is pinned frozen whatever the temperature says.
    // There is no liquid water at any pressure under 611.7 Pa, so a basin down
    // there is an ice field, and drawing it as open blue sea was the one thing
    // the phase-limit physics exists to rule out.
    // Below the triple point the basin is ice rather than open water, whatever
    // its temperature -- but ONLY if it is cold enough to be ice at all. Above
    // freezing under a sub-triple-point sky that water is VAPOUR, and
    // partitionWater sends it there; flooring the drawn ice regardless put a
    // 14% grey wash on a +27 C thin-aired world for frost that cannot exist.
    // The gate is the same condition partitionWater itself uses, graded.
    let coldest = Infinity;
    for (let i = 0; i < NBANDS; i++) if (world.T[i] < coldest) coldest = world.T[i];
    const noLiquid = (1 - (dg.liquidAllowed ?? 1)) * clamp((273.16 - coldest) / 5, 0, 1);
    // A different world is not a transition, it is a cut. Loading a snowball
    // must show a snowball on its first frame rather than freezing over in
    // front of the player, so a change of seed -- which is what every preset,
    // save and reset does -- re-seeds the ease instead of easing across it.
    if (this.iceSeed !== state.seed) { this.bandIceSeeded = false; this.iceSeed = state.seed; }
    for (let i = 0; i < NBANDS; i++) {
      const target = dg.hasWater
        ? Math.max(clamp(1 - (world.T[i] - 253) / 25, 0, 1), noLiquid) : 0;
      if (!this.bandIceSeeded) this.bandIce[i] = target;   // see below
      const eased = this.bandIce[i];
      this.bandIce[i] = eased + clamp(target - eased, -ICE_EASE * dtReal, ICE_EASE * dtReal);
      // Truncate rather than round the low byte: rounding lets the residual
      // reach 256, which a byte stores as 0, decoding ~16 K too cold and
      // painting a flickering stripe across that band.
      const t = Math.round(clamp(world.T[i] / 4000, 0, 1) * 65535);
      const hi = t >> 8;
      this.bandBytes[i * 4] = hi;
      this.bandBytes[i * 4 + 1] = t & 255;
      this.bandBytes[i * 4 + 2] = 255 * this.bandIce[i];
      this.bandBytes[i * 4 + 3] = 255;
    }
    this.bandIceSeeded = true;

    const pH2Omean = dg.pH2O.reduce((a, b) => a + b, 0) / NBANDS;
    const steam = steamOpacity(pH2Omean);
    const co2Frac = clamp(dg.pCO2 / Math.max(dg.pTotMean, 1e-6), 0, 1);
    // What the deck hides, not what it covers -- see cloudLook().
    const cloudMean = cloudLook(dg.cloud.reduce((a, b) => a + b, 0) / NBANDS, pH2Omean);
    // Whether ANY band is hot enough to glow, not how hot the planet is on
    // average. The mean is not a temperature the ground ever has: on a locked
    // world it sits between a molten day side and a frozen night side, and
    // using it lit up ground at 692 K that emits nothing. Below 700 K nothing
    // anywhere can glow, and the curve is already 1e-6 there, so the gate's
    // edge is invisible.
    const glow = smoothstep(650, 750, dg.Tmax);
    const sc = PlanetView.starColor(p.starTemp);
    const atmo = atmosphereLook(world, steam, this.realistic);

    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uTime, state.time);
    gl.uniform1f(this.u.uSpin, this.spin);
    gl.uniform3f(this.u.uSunDir, 0.62, 0.28, 0.73);
    gl.uniform3f(this.u.uStarColor, sc[0], sc[1], sc[2]);
    gl.uniform1f(this.u.uSeed, state.seed);
    gl.uniform1f(this.u.uLandFrac, p.landFraction);
    const flooded = dg.flooded ?? dg.oceanFrac;
    gl.uniform1f(this.u.uOceanFrac, flooded);
    gl.uniform1f(this.u.uSeaLevel, seaLevelForLand(1 - flooded));
    // What the world is actually supporting, not what was asked for. A cooked
    // planet has none and is drawn with none.
    gl.uniform1f(this.u.uBio, dg.bio ?? p.biosphere ?? 0);
    if (this.bodyCapable) {
      // Ease across in about a second and a quarter -- long enough to read as a
      // world changing, short enough not to be a wait.
      this.bodyMix += clamp(this.bodyTarget - this.bodyMix, -0.8 * dtReal, 0.8 * dtReal);
      gl.activeTexture(gl.TEXTURE0 + 10);
      gl.bindTexture(gl.TEXTURE_2D, this.bodyColourTex || this.blankTex);
      gl.activeTexture(gl.TEXTURE0 + 11);
      gl.bindTexture(gl.TEXTURE_2D, this.bodyHeightTex || this.blankTex);
      gl.uniform1i(this.u.uBodyMap, 10);
      gl.uniform1i(this.u.uBodyHeight, 11);
      gl.uniform1f(this.u.uBodyMix, this.bodyMix);
      gl.uniform1f(this.u.uBodyHasHeight, this.bodyHasHeight);
    }
    gl.uniform1f(this.u.uGlaciated, dg.glaciatedShare ?? 1);
    gl.uniform1f(this.u.uWaterCap, dg.waterCap);
    gl.uniform1f(this.u.uCloud, cloudMean);
    gl.uniform1f(this.u.uSteam, steam);
    gl.uniform1f(this.u.uAtmoThick, atmo.thickness);
    gl.uniform1f(this.u.uVeil, atmo.veil);
    gl.uniform1f(this.u.uHaze, atmo.haze);
    gl.uniform1f(this.u.uPTot, dg.pTotMean);
    gl.uniform1f(this.u.uCO2, co2Frac);
    gl.uniform1f(this.u.uMagma, clamp((dg.Tmean - 1200) / 400, 0, 1));
    gl.uniform1f(this.u.uLocked, lam);
    // A gate, not a magnitude: the shader takes the brightness from the local
    // band temperature. See thermalGlow() in terrain.js.
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
    gl.uniform1f(this.u.uZoom, clamp(this.zoom, MIN_ZOOM, MAX_ZOOM));
    // A tidally locked world has no meaningful obliquity: its bands run from
    // the substellar point, not from a pole.
    gl.uniform1f(this.u.uTilt, (1 - lam) * (p.obliquity || 0) * Math.PI / 180);
    gl.uniform1f(this.u.uYaw, this.yaw);
    gl.uniform1f(this.u.uPitch, this.pitch);
    gl.activeTexture(gl.TEXTURE0 + 9);
    gl.bindTexture(gl.TEXTURE_2D, this.bandTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NBANDS, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.bandBytes);
    gl.uniform1i(this.u.uBands, 9);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
