// Coming back from another app is the hardest thing the renderer does, and it
// is the one thing none of the other tools tested. A phone browser may hand the
// page back with its GPU context destroyed, with its textures quietly evicted,
// with no network, or -- worst -- with a context that it never restores at all.
// Every one of those used to end at a permanently black canvas, because a
// transient failure was recorded as a permanent one and nothing ever retried.
//
// This drives those paths against a scriptable fake GL, so the resume behaviour
// is checked rather than assumed. It needs no browser, which is the point.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

let fails = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`\x1b[32mPASS\x1b[0m  ${name}${detail ? '  —  ' + detail : ''}`);
  else { fails++; console.log(`\x1b[31mFAIL\x1b[0m  ${name}${detail ? '  —  ' + detail : ''}`); }
}

// --------------------------------------------------------------------------
// A GL context we can break on demand.
// --------------------------------------------------------------------------
const stats = { fetches: 0, decodes: 0, textures: 0, draws: 0,
                bakeDraws: 0, unscissored: 0, worstDraw: 0 };

function makeGl(opts = {}) {
  const g = {
    lost: false,
    linkOk: opts.linkOk ?? true,
    fbComplete: opts.fbComplete ?? true,
    isContextLost: () => g.lost,
    getParameter: (p) => (p === 0x8872 ? 16 : p === 0x8DFD ? 224 : 4096),
    getExtension: () => null,
    createShader: () => ({}), shaderSource() {}, compileShader() {},
    getShaderParameter: () => g.linkOk, getShaderInfoLog: () => 'compile refused',
    createProgram: () => ({}), attachShader() {}, bindAttribLocation() {}, linkProgram() {},
    getProgramParameter: () => g.linkOk, getProgramInfoLog: () => 'link refused',
    getUniformLocation: () => ({}),
    createBuffer: () => ({}), bindBuffer() {}, bufferData() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {},
    createVertexArray: () => ({}), bindVertexArray() {},
    createTexture: () => { stats.textures++; return { live: true }; },
    deleteTexture: (t) => { if (t) t.live = false; },
    isTexture: (t) => !!(t && t.live && !g.lost),
    bindTexture() {}, activeTexture() {}, texImage2D() {}, texParameteri() {},
    pixelStorei() {}, generateMipmap() {},
    createFramebuffer: () => ({}), framebufferTexture2D() {},
    bindFramebuffer: (target, fb) => { g.offscreen = !!fb; },
    drawBuffers() {}, useProgram() {},
    // Enough state tracking to measure how much a single draw call rasterises,
    // which is the thing that was killing Android drivers.
    viewport: (x, y, w, h) => { g.vp = w * h; },
    scissor: (x, y, w, h) => { g.sc = w * h; },
    enable: (c) => { if (c === 0x0C11) g.scissorOn = true; },
    disable: (c) => { if (c === 0x0C11) g.scissorOn = false; },
    checkFramebufferStatus: () => (g.fbComplete ? 0x8CD5 : 0x8CD6),
    getError: () => 0,
    drawArrays: () => {
      stats.draws++;
      // Only draws into an offscreen framebuffer are bake work. The one that
      // paints the canvas covers the whole canvas by definition, and costs a
      // few texture fetches a pixel rather than hundreds of noise evaluations.
      if (!g.offscreen) return;
      stats.bakeDraws++;
      if (!g.scissorOn) { stats.unscissored++; return; }
      stats.worstDraw = Math.max(stats.worstDraw, g.sc ?? 0);
    },
    FRAMEBUFFER_COMPLETE: 0x8CD5, NO_ERROR: 0, SCISSOR_TEST: 0x0C11,
  };
  // Everything else the renderer touches is a GL enum or a no-op.
  return new Proxy(g, {
    get: (t, k) => (k in t ? t[k]
      : typeof k === 'string' && k.toUpperCase() === k ? 0x1000 : () => {}),
  });
}

function makeCanvas(gl) {
  const listeners = {};
  return {
    clientWidth: 800, clientHeight: 600, width: 800, height: 600,
    style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {}, setPointerCapture() {},
    dispatch(type, ev = { preventDefault() {} }) { for (const f of listeners[type] || []) f(ev); },
    getContext: (kind) => (kind === '2d' ? null : gl),
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    cloneNode: () => makeCanvas(gl), replaceWith() {},
  };
}

// --------------------------------------------------------------------------
// Minimal environment: real shader files off disk, counted; images that never
// touch the network twice.
// --------------------------------------------------------------------------
globalThis.window = globalThis;
globalThis.devicePixelRatio = 2;
globalThis.document = {
  documentElement: {}, body: { classList: { toggle() {}, add() {}, remove() {} } },
  visibilityState: 'visible',
  querySelector: () => null, createElement: () => makeCanvas(makeGl()),
  addEventListener() {},
};
globalThis.fetch = async (url) => {
  stats.fetches++;
  const name = String(url).split('/').pop();
  try {
    const text = await readFile(join(root, 'src/render/glsl', name), 'utf8');
    return { ok: true, text: async () => text };
  } catch { return { ok: false, status: 404 }; }
};
globalThis.Image = class {
  set src(v) { stats.decodes++; queueMicrotask(() => this.onload && this.onload()); }
};
globalThis.location = { href: 'https://example.test/app/', search: '', hash: '', pathname: '/app/' };

const { PlanetView } = await import('../src/render/planet.js');

const world = {
  params: { landFraction: 0.3, rotationHours: 24, starTemp: 5772 },
  T: new Float32Array(18).fill(288),
  diag: {
    lam: 0, pH2O: new Float32Array(18), cloud: new Float32Array(18), S: new Float32Array(18).fill(340),
    pCO2: 0.4, pTotMean: 1013, Tmean: 288, hasWater: true, waterCap: 1,
    flooded: 0.7, glaciatedShare: 1, pN2: 1000, iceMean: 0.1, Tmax: 300, Tmin: 250,
    absorbed: 240,
  },
};
const state = { time: 0, seed: 7 };

// --------------------------------------------------------------------------
// 1. Shader sources are read once per page load, not once per context.
//    Re-fetching on restore is what killed the renderer on a device whose radio
//    was still asleep when the tab came back.
// --------------------------------------------------------------------------
{
  const gl = makeGl();
  const view = new PlanetView(makeCanvas(gl));
  await view.init();
  const afterFirst = stats.fetches;
  view.forgetGpuState();
  await view.restore();
  check('Shader sources are fetched once, not again on every restore',
    stats.fetches === afterFirst, `${afterFirst} fetches, still ${stats.fetches} after a restore`);
  check('A restore rebuilds the renderer', view.ready === true);
}

// --------------------------------------------------------------------------
// 2. Losing the context is transient. It must not be recorded as "this machine
//    cannot do WebGL", because that verdict is never revisited.
// --------------------------------------------------------------------------
{
  const gl = makeGl();
  const canvas = makeCanvas(gl);
  const view = new PlanetView(canvas);
  await view.init();
  gl.lost = true;
  gl.linkOk = false;                       // as a dead context reports everything
  canvas.dispatch('webglcontextlost');
  const rebuilt = await view.restore();
  check('A lost context is not mistaken for a broken GPU',
    !view.failed, `failed=${!!view.failed}`);
  check('Rebuilding is refused while the context is still gone', rebuilt === false);
  check('The loss is timestamped so the app can give up waiting',
    typeof view.lostSince === 'number');

  gl.lost = false; gl.linkOk = true;
  canvas.dispatch('webglcontextrestored');
  await new Promise((r) => setTimeout(r, 20));
  check('The restore event rebuilds and clears the loss',
    view.ready === true && !view.contextLost && view.lostSince === null);
}

// --------------------------------------------------------------------------
// 3. A driver that genuinely refuses is still fatal — and says so, once, to
//    somebody who can act on it.
// --------------------------------------------------------------------------
{
  const gl = makeGl({ linkOk: false });
  const view = new PlanetView(makeCanvas(gl));
  let told = null;
  view.onFatal = (why) => { told = why; };
  const ok = await view.init();
  check('A live context that refuses to link is a real failure',
    ok === false && view.failed === true);
  check('...and it is reported rather than left as a black canvas',
    typeof told === 'string' && told.length > 0, told || 'nothing reported');
}

// --------------------------------------------------------------------------
// 4. A bake that keeps failing must not be retried on every single frame. It
//    used to delete and reallocate three cube maps sixty times a second, which
//    is a hung tab, not a fallback.
// --------------------------------------------------------------------------
{
  const gl = makeGl();
  const view = new PlanetView(makeCanvas(gl));
  await view.init();
  gl.fbComplete = false;
  let told = null;
  view.onFatal = (why) => { told = why; };
  // The backoff is measured against the wall clock, so the clock has to move:
  // sixty spins of a for-loop take no time at all on a machine this size.
  const realNow = performance.now.bind(performance);
  let clock = realNow();
  performance.now = () => clock;
  const before = stats.textures;
  for (let i = 0; i < 600; i++) { clock += 1000 / 60; view.render(world, state, 1 / 60); }
  performance.now = realNow;
  const allocated = stats.textures - before;
  check('A failing bake backs off instead of thrashing the GPU',
    allocated <= 30, `${allocated} cube maps allocated over ten seconds`);
  check('...and eventually gives up so the app can fall back',
    view.failed === true && typeof told === 'string', told || 'never reported');
}

// --------------------------------------------------------------------------
// 5. Nothing is drawn from cube maps that are not there. Binding a null cube
//    map is legal and samples black, so this failure mode renders a beautifully
//    lit black planet and reports no error at all.
// --------------------------------------------------------------------------
{
  const gl = makeGl();
  const view = new PlanetView(makeCanvas(gl));
  await view.init();
  view.terrainCube = null;
  view.bakedSeed = state.seed;             // pretend the bake is up to date
  const before = stats.draws;
  view.render(world, state, 1 / 60);
  check('A frame with no baked surface is skipped, not drawn black',
    stats.draws === before, `${stats.draws - before} draws`);
}

// --------------------------------------------------------------------------
// 6. The bake arrives in bounded pieces, and resuming does not redo it unless
//    the cube maps really went away.
//
//    The bake shader costs ~139 noise evaluations a texel. A whole 512x512 cube
//    face in one draw call is 1.6 billion sin() calls, and six of those back to
//    back is a multi-second GPU submit. Android's driver treats that as a hang
//    and resets the GPU, which loses the context, which makes this code rebake
//    -- the freeze and the black screen on a tablet that renders the finished
//    planet at sixty frames a second. Desktop drivers and Firefox just take the
//    stall, which is why it only showed up in Chromium on Android.
// --------------------------------------------------------------------------
{
  const gl = makeGl();
  const view = new PlanetView(makeCanvas(gl));
  await view.init();

  stats.worstDraw = 0; stats.bakeDraws = 0; stats.unscissored = 0;
  view.render(world, state, 1 / 60);
  check('One frame does not try to bake the whole planet',
    view.bakedSeed !== state.seed && !!view.bakeJob,
    `${view.bakeJob ? view.bakeJob.i : 0} of ${view.bakeJob ? view.bakeJob.tiles.length : 0} strips done`);

  let frames = 1;
  while (view.bakeJob && frames < 500) { view.render(world, state, 1 / 60); frames++; }
  check('...but a bake does finish, over a handful of frames',
    view.bakedSeed === state.seed && frames > 1 && frames < 200, `${frames} frames`);

  // The number that actually matters: how much one submit asks the driver for.
  const CAP = 20000;
  check('No single bake draw rasterises an unbounded number of texels',
    stats.worstDraw > 0 && stats.worstDraw <= CAP,
    `worst of ${stats.bakeDraws} bake draws covered ${stats.worstDraw} texels; ` +
    `a whole 512² face is ${512 * 512}, which at ~139 noise evaluations a texel ` +
    `is ${(512 * 512 * 139 * 24 / 1e9).toFixed(1)} billion sin() calls in one submit`);
  check('...and every bake draw is scissored, so none can grow back',
    stats.unscissored === 0, `${stats.unscissored} unscissored`);

  view.refreshAfterResume();
  check('Resuming with the surface intact does not rebake',
    view.bakedSeed === state.seed && !view.bakeJob);
  check('...but it does ask for a fresh drawing buffer', view.forceResize === true);

  gl.deleteTexture(view.detailCube);        // as a driver evicting it would
  view.refreshAfterResume();
  check('Resuming with the surface evicted does rebake', view.bakedSeed === null);
}

// --------------------------------------------------------------------------
// 7. The albedo maps are decoded once. Re-decoding six full-size JPEGs on the
//    main thread during a resume is both a freeze and a memory spike, and the
//    spike can lose the context all over again.
// --------------------------------------------------------------------------
{
  const gl = makeGl();
  const view = new PlanetView(makeCanvas(gl));
  await view.init();
  await view.loadTextures();
  const first = stats.decodes;
  view.forgetGpuState();
  await view.restore();
  check('The albedo maps are decoded once per page load, not once per restore',
    stats.decodes === first, `${first} decodes, still ${stats.decodes} after a restore`);
  check('Six maps were loaded', first === 6, `${first}`);
}

// --------------------------------------------------------------------------
// 8. WebGL1 cannot mipmap or REPEAT a non-power-of-two texture. It does not
//    report an error either; it just samples black.
// --------------------------------------------------------------------------
{
  const src = await readFile(join(root, 'src/render/planet.js'), 'utf8');
  check('The NPOT albedo maps are handled for WebGL1',
    /npot\s*\?\s*gl\.CLAMP_TO_EDGE/.test(src) && /if \(!npot\) gl\.generateMipmap/.test(src));
}

console.log(fails ? `\n\x1b[31m— ${fails} failed —\x1b[0m` : '\n\x1b[32m— all resume checks passed —\x1b[0m');
process.exit(fails ? 1 : 0);
