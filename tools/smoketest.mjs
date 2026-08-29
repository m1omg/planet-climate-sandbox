// Loads every module the page loads, against a stub DOM, and reports the first
// failure. `node --check` parses as CommonJS and therefore misses ESM-only
// errors such as a duplicate declaration inside an exported function, so this
// exists to catch what that cannot.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Enough of a 2D context that the charts draw without throwing, so the frame
// loop under test is the real one rather than an exception-swallowing stub.
const stub2d = () => new Proxy({}, {
  get: (_, k) => {
    if (k === 'canvas') return { width: 800, height: 600 };
    if (k === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set: () => true,
});

// Enough of a WebGL2 context for the renderer's constructor, which only stores
// it and attaches event handlers.
// Enough of a WebGL2 context that init() actually completes -- compiles, links
// and bakes -- so start() settles on the GPU path and that path gets exercised.
const stubGl = () => new Proxy({
  isContextLost: () => false,
  getShaderParameter: () => !globalThis.__glRefuses, getProgramParameter: () => !globalThis.__glRefuses,
  getShaderInfoLog: () => '', getProgramInfoLog: () => '',
  getUniformLocation: () => ({}), getParameter: () => 16, getExtension: () => null,
  createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
  createTexture: () => ({}), createFramebuffer: () => ({}), createVertexArray: () => ({}),
  isTexture: () => true,
  checkFramebufferStatus: () => 0x8CD5, FRAMEBUFFER_COMPLETE: 0x8CD5,
  getError: () => 0, NO_ERROR: 0,
}, {
  get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k.toUpperCase() === k ? 1 : () => {}),
});

const mkEl = (tag = 'div') => ({
  tagName: String(tag).toUpperCase(), children: [], style: { setProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  dataset: {}, value: '', textContent: '', innerHTML: '', title: '', hidden: false,
  min: '0', max: '1000', clientWidth: 800, clientHeight: 600, width: 800, height: 600,
  listeners: {},
  appendChild(c) { this.children.push(c); return c; },
  insertAdjacentHTML() {}, setAttribute() {}, getAttribute: () => null,
  // useRenderer swaps the canvas element, because a canvas keeps its context
  // type for life. Without these the swap threw and start() died silently.
  cloneNode() { return mkEl(this.tagName); }, replaceWith() {}, remove() {},
  addEventListener(type) { (this.listeners[type] = this.listeners[type] || []).push(1); },
  removeEventListener() {}, select() {}, blur() {}, focus() {},
  setPointerCapture() {},
  // A canvas that records its listeners and hands out a token WebGL context, so
  // the renderer really constructs and its context-loss wiring can be checked.
  getContext: (kind) => (kind === '2d' ? stub2d() : kind === 'webgl2' ? stubGl() : null),
  querySelector: () => mkEl(), querySelectorAll: () => [],
  getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
});

globalThis.window = globalThis;
globalThis.document = {
  documentElement: mkEl(), body: mkEl(), visibilityState: 'visible',
  querySelector: () => mkEl(), querySelectorAll: () => [],
  createElement: (t) => mkEl(t), addEventListener() {},
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { href: 'https://example.test/', hash: '', search: '', pathname: '/' };
globalThis.history = { replaceState() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.addEventListener = () => {};
globalThis.devicePixelRatio = 1;
// Real shader sources off disk, so start() reaches the GPU path rather than
// falling straight through to software and leaving that path untested.
{
  const { readFile } = await import('node:fs/promises');
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop();
    try {
      const text = await readFile(new URL(`../src/render/glsl/${name}`, import.meta.url), 'utf8');
      return { ok: true, text: async () => text };
    } catch { return { ok: false, status: 404 }; }
  };
}
globalThis.Image = class { set src(v) { queueMicrotask(() => this.onerror && this.onerror()); } };

// count what the app builds, so a UI that silently constructs nothing is a failure
let created = 0;
const origCreate = globalThis.document.createElement;
globalThis.document.createElement = (t) => { created++; return origCreate(t); };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

let failed = 0;
const files = walk(join(root, 'src')).sort();
for (const file of files) {
  const rel = relative(root, file);
  if (rel.endsWith('selftest.js')) continue;   // has its own entry point
  try {
    await import(pathToFileURL(file).href);
    console.log(`\x1b[32mPASS\x1b[0m  ${rel}`);
  } catch (e) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  ${rel}\n        ${e.constructor.name}: ${e.message}`);
  }
}
// ---------------------------------------------------------------------------
// Drive the frame loop and check it behaves. A stray start() call inside the
// render loop once re-initialised the renderer on every frame, which reset the
// planet's rotation and the camera 60 times a second and made the surface
// flicker; nothing in the module-load checks noticed. These assertions would
// have.
// ---------------------------------------------------------------------------
// tick() swallows its own exceptions -- deliberately, so that one bad frame
// cannot kill the loop in front of a user -- and reports them through
// console.error exactly once. That means a readout throwing on every single
// frame used to run the whole 120-frame loop below and still pass this file.
// It is precisely the failure this project has shipped twice (a readout reading
// null before the first step, a shader uniform never passed), so watch for it.
const frameErrors = [];
{
  const realError = console.error;
  console.error = (...a) => {
    if (String(a[0] ?? '').includes('frame failed')) frameErrors.push(a.map(String).join(' '));
    realError.apply(console, a);
  };
}

const app = globalThis.window.__app;
if (app && app.tick && app.view) {
  const v = app.view;
  v.ready = true;                    // no GL here; pretend init succeeded
  v.render = () => { v._renders = (v._renders || 0) + 1; };
  v.wantTextures = false;
  v.spin = 0.5; v.yaw = 0.25; v.pitch = 0.1; v.zoom = 1;
  let initCalls = 0;
  const realInit = v.init.bind(v);
  v.init = () => { initCalls++; return realInit(); };

  // Drive frame() -- not tick() -- because that is the function the browser
  // actually calls, and the bug this guards against lived between the two.
  let t = 1000;
  for (let i = 0; i < 120; i++) { t += 1000 / 60; app.frame(t); }

  if (initCalls > 0) {
    console.log(`\x1b[31mFAIL\x1b[0m  renderer re-initialised ${initCalls}x inside the frame loop`);
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  frame loop does not re-initialise the renderer');
  }
  if (v.zoom !== 1) {
    console.log(`\x1b[31mFAIL\x1b[0m  frame loop moved the zoom on its own (${v.zoom})`);
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  zoom stays put when nothing is pinching it');
  }
  if (v.yaw !== 0.25 || v.pitch !== 0.1) {
    console.log(`\x1b[31mFAIL\x1b[0m  frame loop moved the camera on its own (yaw ${v.yaw}, pitch ${v.pitch})`);
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  camera stays put when nothing is dragging it');
  }
  if (v.wantTextures !== false) {
    console.log('\x1b[31mFAIL\x1b[0m  frame loop overwrote the surface-style choice');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  surface-style choice survives the frame loop');
  }
  if (!v._renders) {
    console.log('\x1b[31mFAIL\x1b[0m  frame loop never rendered');
    failed++;
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  frame loop rendered ${v._renders} frames`);
  }
}

// A GPU context can be taken away and never handed back — switching apps on an
// Android tablet is the usual way. The browser is supposed to fire
// webglcontextrestored; when it does not, the page used to sit on a black canvas
// for the rest of the visit, because nothing was watching.
await new Promise((r) => setTimeout(r, 50));   // let start() settle on a renderer
if (app && app.frame && app.view && !app.view.software) {
  // The watchdog measures against the wall clock, so the wall clock has to move.
  const realNow = performance.now.bind(performance);
  let clock = realNow();
  let t = 1e6;                                  // monotonic across both phases
  const spin = async (n) => {
    performance.now = () => clock;
    for (let i = 0; i < n; i++) { clock += 1000 / 60; t += 1000 / 60; app.frame(t); }
    performance.now = realNow;
    await new Promise((r) => setTimeout(r, 50));
  };
  const strand = () => {
    const v = app.view;
    v.failed = false; v.ready = true; v.api = 'WebGL2';
    v.render = () => {};
    v.contextLost = true; v.lostSince = null;
  };

  strand();
  await spin(900);
  if (app.view.contextLost || !app.view.ready) {
    console.log('\x1b[31mFAIL\x1b[0m  a context that is never restored leaves the canvas black forever');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  a context that is never restored is recovered by rebuilding');
  }

  // And when rebuilding does not help either -- a GPU that has stopped
  // cooperating altogether -- it must end up somewhere that still draws.
  globalThis.__glRefuses = true;
  strand();
  await spin(900);
  globalThis.__glRefuses = false;
  if (!app.view.software) {
    console.log('\x1b[31mFAIL\x1b[0m  a GPU that keeps failing never falls back to software');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  a GPU that keeps failing falls back to software');
  }
}

// The renderer must survive a mobile browser throwing the GPU context away.
// Checked on a real PlanetView rather than whichever view happens to be live,
// since start() picks that asynchronously and may not have finished.
{
  const { PlanetView } = await import(new URL('../src/render/planet.js', import.meta.url).href);
  const canvas = mkEl('canvas');
  const v = new PlanetView(canvas);
  const hasHandler = typeof v.forgetGpuState === 'function'
                  && typeof v.restore === 'function'
                  && typeof v.refreshAfterResume === 'function';
  if (!hasHandler) {
    console.log('\x1b[31mFAIL\x1b[0m  renderer has no context-loss recovery');
    failed++;
  } else {
    // Losing the context must invalidate the baked terrain, or the planet comes
    // back drawing from cube maps that no longer exist.
    v.bakedSeed = 7; v.texturesLoaded = true; v.ready = true;
    v.forgetGpuState();
    if (v.bakedSeed !== null || v.ready || v.texturesLoaded) {
      console.log('\x1b[31mFAIL\x1b[0m  losing the context left stale GPU state behind');
      failed++;
    } else {
      console.log('\x1b[32mPASS\x1b[0m  context loss clears the baked terrain and forces a rebuild');
    }
    // ...and the browser events that signal it must actually be subscribed to.
    const L = (v.canvas && v.canvas.listeners) || {};
    if (!L.webglcontextlost || !L.webglcontextrestored) {
      console.log('\x1b[31mFAIL\x1b[0m  canvas does not listen for webglcontextlost/restored');
      failed++;
    } else {
      console.log('\x1b[32mPASS\x1b[0m  canvas subscribes to context lost and restored');
    }
  }
}

// Forcing a lesser renderer is a diagnostic. If it were remembered between
// visits, one curious click would leave the planet drawn on the CPU for good --
// which is exactly what happened.
if (app && app.graphicsFromUrl) {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function rendererFromUrl'), src.indexOf('function graphicsFromUrl'));
  const persists = /localStorage/.test(fn);
  if (persists) {
    console.log('\x1b[31mFAIL\x1b[0m  the forced-renderer override is remembered between visits');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  the forced-renderer override does not outlive the page');
  }
  // and the quality preference, which is a real preference, still does
  const qf = src.slice(src.indexOf('function qualityFromUrl'), src.indexOf('function updateRendererButton'));
  if (!/localStorage/.test(qf)) {
    console.log('\x1b[31mFAIL\x1b[0m  the detail preference is no longer remembered');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  the detail preference is still remembered');
  }
}

// The autosave must not be able to eat a save.
//
// A fresh page starts with the clock running, so "the world has changed" is
// true within a frame of opening the tab. On that alone, opening the page and
// walking away for half a minute would write a default Earth over the world
// left there yesterday -- which is the one way an autosave turns from a
// convenience into a way of losing things. It writes only once somebody has
// actually done something, and this pins that.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  if (!/if \(!dirty \|\| !touched\) return false;/.test(src)) {
    console.log('\x1b[31mFAIL\x1b[0m  the autosave can fire on an untouched session');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  the autosave will not write until the session has been touched');
  }
  // And the clock alone must not count as being touched, or the guard is moot.
  if (/if \(!sim\.paused\) markTouched\(\)/.test(src)) {
    console.log('\x1b[31mFAIL\x1b[0m  a running clock marks the session touched, which defeats the guard');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  a running clock makes the world dirty but not the session touched');
  }
  // Leaving the page has to catch the session that did not end on a round 30 s.
  if (!/visibilitychange[\s\S]{0,120}autosave\(true\)/.test(src)) {
    console.log('\x1b[31mFAIL\x1b[0m  nothing autosaves when the page is hidden or closed');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  hiding or leaving the page forces an autosave');
  }
}

// The play button has to be the truth about whether time is moving. Settling
// used to run the world straight past a paused clock, so the button read
// "Play" while the simulation raced; and stopping a settle returned early,
// leaving the settle button stuck reading "Stop" for the rest of the session.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  if (!/if \(settling && !sim\.paused\) advanceSettle\(\)/.test(src)) {
    console.log('\x1b[31mFAIL\x1b[0m  settling runs even while the clock is paused');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  a paused clock stops the settle too');
  }
  const end = src.slice(src.indexOf('function endSettle'), src.indexOf('function endSettle') + 260);
  const restores = /classList\.remove\('busy'\)/.test(end) && /textContent = 'Settle'/.test(end);
  if (!restores || /\{ settling = false; return; \}/.test(src)) {
    console.log('\x1b[31mFAIL\x1b[0m  stopping a settle leaves the button reading "Stop"');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  every exit from a settle puts the button back');
  }
}

// Winning a scenario stops the clock once, on the frame it is won. When that
// lived in the banner branch -- which runs ten times a second for as long as
// the win stands -- pressing play un-paused the world for a single frame and
// then it snapped back, so the button could never be used again.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const banner = src.slice(src.indexOf("=== 'win') { el.textContent"));
  const line = banner.slice(0, banner.indexOf('\n'));
  if (/sim\.paused/.test(line)) {
    console.log('\x1b[31mFAIL\x1b[0m  a won scenario re-pauses every frame, so play cannot resume it');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  a won scenario pauses once, and play resumes it');
  }
}

// Every map BODY_MAPS names has to be a file that is really there, at the path
// the page will really ask for.
//
// Nothing else catches this. bodycheck loads maps through a stub that happily
// invents one for any URL, and a missing texture in the browser is a silent
// fallback to procedural terrain -- the planet still draws, just as the wrong
// world. Mars's new DEM was generated one directory too high on the first try,
// into an altdev/assets/ that nothing reads, and every other check passed.
{
  const { readFileSync, existsSync } = await import('node:fs');
  const { BODY_MAPS } = await import('../src/render/planet.js');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const base = (html.match(/__assetBase\s*=\s*["']([^"']+)["']/) || [, 'assets/'])[1];
  const missing = [];
  for (const [world, maps] of Object.entries(BODY_MAPS)) {
    for (const file of Object.values(maps)) {
      const url = new URL(`${base}bodies/${file}`, import.meta.url.replace('/tools/', '/'));
      if (!existsSync(url)) missing.push(`${world}:${file}`);
    }
  }
  if (missing.length) {
    console.log(`\x1b[31mFAIL\x1b[0m  BODY_MAPS names files that are not at ${base}bodies/: `
      + [...new Set(missing)].join(', '));
    failed++;
  } else {
    const files = new Set(Object.values(BODY_MAPS).flatMap((m) => Object.values(m)));
    console.log(`\x1b[32mPASS\x1b[0m  every surface map exists where the page asks for it `
      + `(${files.size} files across ${Object.keys(BODY_MAPS).length} worlds)`);
  }
}

// The picture and the physics have to agree about how frosted a world is.
//
// This is the check that was missing, and its absence is how the bug shipped.
// Everything already tested asked whether the map LOADS: BODY_MAPS names it,
// the file exists, setBody uploads it, bodycheck renders a frame with it. All
// of it passed while modern Mars drew as a featureless grey-pink ball, because
// the shader then washed 98% of the disc 55% of the way to grey and buried it.
//
// bodycheck could not have caught it for a sharper reason than "it only tests
// warm worlds": both worlds it builds have band ice identically 0.000, so the
// frost path has never executed in any frame that tool has ever rendered -- and
// its metric is a count of pixels that CHANGED when the map was switched on,
// which reads the same 18% whether the map is shown at full strength or at 45%.
// The missing measurement is amplitude, not presence.
//
// So this compares the two directly, and needs no GL. radiation.js has always
// graded frost by how much water there is to deposit; the renderers did not.
// Both are asked how far toward frost they take the ground, and their answers
// have to move together.
{
  const { Simulation } = await import('../src/sim/clock.js');
  const { PRESETS } = await import('../src/game/presets.js');
  const { surfaceAlbedo, iceFraction } = await import('../src/physics/radiation.js');
  const { readFileSync } = await import('node:fs');
  const cl = (x, a, b) => Math.max(a, Math.min(b, x));
  const ss = (a, b, x) => { const t = cl((x - a) / (b - a || 1e-12), 0, 1); return t * t * (3 - 2 * t); };

  const fragSrc = readFileSync(new URL('../src/render/glsl/planet.frag', import.meta.url), 'utf8');
  const frostStrength = (fragSrc.match(/vec3\(0\.66,0\.66,0\.68\),\s*([^)]*)\)/) || [, ''])[1];

  const off = [], rows = [];
  for (const key of Object.keys(PRESETS)) {
    const w = new Simulation({ ...PRESETS[key].params }).world, d = w.diag;
    const la = PRESETS[key].params.landAlbedo ?? 0.25;
    const g = d.glaciatedShare ?? 0, wc = d.waterCap ?? 0;
    // How far the PHYSICS moves the ground toward frost, as a fraction of the
    // way it would go on a world with water to spare.
    const albAt = (cap) => surfaceAlbedo(d.Tmean, d.flooded, la, d.hasWater, g, cap);
    const dry = albAt(0), wet = albAt(1), span = wet - dry;
    if (Math.abs(span) < 1e-6) continue;             // no frost either way
    const physFrac = (albAt(wc) - dry) / span;
    // ...and how far the RENDERER does, from the expression in planet.frag and
    // its two ports. Written out rather than imported because it lives in GLSL.
    const ice = d.hasWater ? cl(1 - (d.Tmean - 253) / 25, 0, 1) : 0;
    const land = 1 - d.flooded;
    const sheetAmt = cl(ice * 0.70, 0, 1) * g;
    const frostMask = cl(ice, 0, 1) * land * (1 - ss(0.06, 0.52, sheetAmt));
    if (frostMask < 0.02) continue;                  // nothing painted, nothing to compare
    // ...read out of the shader itself, so this measures the renderer rather
    // than restating what it is supposed to do. If the water term goes missing
    // the renderer frosts every world all the way, and Mars's two answers come
    // apart by the factor of nineteen that started this.
    const rendFrac = /uWaterCap/.test(frostStrength) ? wc : 1;
    rows.push(`${key} ${(physFrac * 100).toFixed(0)}/${(rendFrac * 100).toFixed(0)}`);
    if (Math.abs(physFrac - rendFrac) > 0.05) {
      off.push(`${key}: physics frosts ${(physFrac * 100).toFixed(0)}% of the way, `
        + `the renderer ${(rendFrac * 100).toFixed(0)}% (waterCap ${wc.toFixed(3)}, `
        + `${(frostMask * 100).toFixed(0)}% of the disc)`);
    }
  }
  if (off.length) {
    console.log(`\x1b[31mFAIL\x1b[0m  the picture and the physics disagree about frost: ${off.join('; ')}`);
    failed++;
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  every frosted world is frosted the same amount in the physics `
      + `and in the picture  \u2014  ${rows.join(', ')}`);
  }

  // ...and the term that makes that true has to survive in all three renderers.
  // The mask arithmetic is written out four times with no shared constant, so a
  // runtime check on one of them cannot notice another losing it.
  const cpu = readFileSync(new URL('../src/render/cpushade.js', import.meta.url), 'utf8');
  const fragSites = (fragSrc.match(/vec3\(0\.66,0\.66,0\.68\), 0\.55 \* uWaterCap\)/g) || []).length;
  const cpuGated = /const frostM = [^;]*\* s\.waterCap;/.test(cpu);
  if (fragSites !== 2 || !cpuGated) {
    console.log(`\x1b[31mFAIL\x1b[0m  frost lost its water gate in a renderer `
      + `(planet.frag ${fragSites}/2 sites, cpushade ${cpuGated})`);
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  frost keeps its water gate in both shader paths and the CPU port');
  }
}

// A milestone the player dropped has to travel in the save. It is not physics,
// so captureWorld knows nothing about it, and a save format that silently drops
// half a feature is the kind of thing that only shows up weeks later when
// someone loads a world back and wonders where their marks went.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const saved = /marks: marks\.map\(/.test(src);
  const loaded = /marks = Array\.isArray\(s\.marks\)/.test(src);
  const cleared = /marks = \[\]; renderMarks\(\)/.test(src);
  if (!saved || !loaded || !cleared) {
    console.log('\x1b[31mFAIL\x1b[0m  milestones do not survive a save/load/reset round trip'
      + ` (save ${saved}, load ${loaded}, reset ${cleared})`);
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  milestones are saved, restored and cleared by a reset');
  }
}

// Every element main.js binds a listener to has to actually exist. The DOM stub
// here cannot catch this -- querySelector returns a fresh element for any
// selector, so a typo'd or missing id looks exactly like a present one -- and
// in a browser it is an immediate TypeError at start-up that takes the whole
// page with it. So check the ids against the markup that is supposed to carry
// them: index.html, or a control's `extra` block.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ctrls = readFileSync(new URL('../src/game/controls.js', import.meta.url), 'utf8');
  // EVERY lookup, not just the ones with .addEventListener chained straight
  // onto them. The narrow form missed `const b = $('#btn-mark'); b.addEvent...`
  // -- which is how most of them are written -- and it missed every plain read
  // as well, so a renamed id in the readout would have sailed through here and
  // thrown ten times a second in the browser instead.
  const bound = new Set();
  for (const m of src.matchAll(/\$\('#([\w-]+)'\)/g)) bound.add(m[1]);
  const missing = [...bound].filter((id) =>
    !html.includes(`id="${id}"`) && !ctrls.includes(`id="${id}"`));
  if (missing.length) {
    console.log(`\x1b[31mFAIL\x1b[0m  main.js binds ids that no markup defines: ${missing.join(', ')}`);
    failed++;
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  every id main.js binds to exists in the markup (${bound.size} checked)`);
  }
}

if (frameErrors.length) {
  console.log(`\x1b[31mFAIL\x1b[0m  the frame loop threw: ${frameErrors[0].slice(0, 160)}`);
  failed++;
} else {
  console.log('\x1b[32mPASS\x1b[0m  no frame threw during the loop');
}

// main.js should have wired up an app handle and built its controls
if (!globalThis.window.__app || !globalThis.window.__app.sim) {
  console.log('\x1b[31mFAIL\x1b[0m  main.js did not expose a running app');
  failed++;
} else {
  console.log(`\x1b[32mPASS\x1b[0m  app built (${created} elements created)`);
}
if (created < 20) {
  console.log(`\x1b[31mFAIL\x1b[0m  only ${created} elements built - the panel is probably empty`);
  failed++;
}

// ---------------------------------------------------------------------------
// Nothing may write an unnamespaced localStorage key.
//
// localStorage is scoped to the ORIGIN and not to the path, so /, /dev/ and
// /altdev/ share one store. main.js was namespaced when that was discovered and
// two things were missed, because they were not in main.js: game/log.js kept its
// own key, so the discovery log was one shared set between the stable build and
// this one, and the dev banner's dismissal flag had no prefix at all -- it would
// have collided with any other project on the same github.io account.
//
// A source scan rather than a runtime check, because the failure is silent by
// construction: the wrong key works perfectly, it just works on somebody else's
// data. Every string literal handed to localStorage has to start with the
// namespace, and there is exactly one legitimate exception -- the one-time
// adoption in storage.js, which reads the stable build's old bare key on purpose
// so that namespacing it did not throw anyone's log away.
{
  const { readFileSync } = await import('node:fs');
  const offenders = [];
  const sources = [...files.map((f) => join(root, 'src', relative(join(root, 'src'), f))),
                   join(root, 'index.html')];
  for (const f of sources) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const rel = relative(root, f);
    // Skip storage.js's deliberate bare-key adoption, which names itself.
    for (const m of src.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*'([^']+)'/g)) {
      if (m[1].startsWith('planetclimate.altdev.')) continue;
      if (rel.endsWith('game/storage.js')) continue;
      offenders.push(`${rel}: '${m[1]}'`);
    }
  }
  if (offenders.length) {
    console.log(`\x1b[31mFAIL\x1b[0m  unnamespaced storage key: ${offenders.join(', ')}`);
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  every storage key is namespaced to this build');
  }
}

console.log(`\n${files.length - 1} modules loaded, ${failed} failed`);
process.exit(failed ? 1 : 0);
