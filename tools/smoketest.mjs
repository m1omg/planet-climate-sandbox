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
  const bound = new Set();
  for (const m of src.matchAll(/\$\('#([\w-]+)'\)\s*\.addEventListener/g)) bound.add(m[1]);
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

// A slider the simulation moves on its own is read *back* out of the world ten
// times a second, so if setting it never reaches the reservoir the readout
// snaps it straight back and the control looks like it is being undone by
// physics. Hydrogen shipped that way: dragging it on a paused Earth set
// params.h2Bar and nothing else, and a tenth of a second later the live reader
// put it back to the reservoir's actual zero -- which reads exactly like
// hydrogen escaping from a world whose clock is not running.
//
// So: every live slider needs a write-back in applyParams, and the gate on that
// is RESERVOIR_KEYS. Checked against the slider table rather than a list
// written out here, so a live slider added later cannot miss it.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const { SLIDERS } = await import('../src/game/controls.js');
  const m = src.match(/const RESERVOIR_KEYS = new Set\(\[([^\]]*)\]\)/);
  const keys = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  const live = SLIDERS.filter((d) => d.live).map((d) => d.key);
  const missing = live.filter((k) => !keys.includes(k));
  // and the write itself has to be there, not just the key in the set
  const body = src.slice(src.indexOf('function applyParams'), src.indexOf('function applyParams') + 1600);
  const unwritten = live.filter((k) => !new RegExp(`key === '${k}'`).test(body) && k !== 'mass');
  if (missing.length || unwritten.length) {
    console.log(`\x1b[31mFAIL\x1b[0m  live sliders the world never hears about: ` +
      `${[...new Set([...missing, ...unwritten])].join(', ')} — setting one is undone by the next readout`);
    failed++;
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  every live slider writes through to its reservoir (${live.length} of them)`);
  }
}

// The name box is empty on a preset and saves as the preset's name -- that is
// what currentName() does. The placeholder has to say the same thing, or the
// field claims "Custom world" for a world the slot will file as "Earth".
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = src.indexOf('function setPresetActive');
  const fn = src.slice(start, src.indexOf('\n}', start));
  if (!/placeholder/.test(fn)) {
    console.log('\x1b[31mFAIL\x1b[0m  the name box says "Custom world" on a preset it would save as the preset');
    failed++;
  } else {
    console.log('\x1b[32mPASS\x1b[0m  the name box offers the preset\'s own name, as the save would');
  }
}

// Every gas the model carries a partial pressure for has to appear in the
// composition readout. Hydrogen did not: it was absent from `parts`, so it was
// missing from the bar, from the list, and -- worse -- from the total the
// percentages are taken over, so a world holding 255 mbar of it reported its
// remaining gases summing to 100.09%. The readout was quietly renormalising
// the atmosphere to exclude a quarter of a bar of it.
//
// Checked against the gases climate.js actually puts in the diag rather than a
// list written out here, so the next gas added cannot be left out of the panel.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const clim = readFileSync(new URL('../src/physics/climate.js', import.meta.url), 'utf8');
  const at = clim.indexOf('w.diag = {');
  const gases = [...new Set([...clim.slice(at, at + 300).matchAll(/\bp(N2|CO2|CH4|O2|H2|H2O)\b/g)]
    .map((m) => 'p' + m[1]))];
  const fn = src.slice(src.indexOf('function composition('), src.indexOf('const total = parts.reduce'));
  // \b matters: "dg.pH2O" contains "dg.pH2", and that is exactly the confusion
  // that would let hydrogen look present when only water is.
  const missing = gases.filter((g) => !new RegExp(`dg\\.${g}\\b`).test(fn));
  if (missing.length) {
    console.log(`\x1b[31mFAIL\x1b[0m  the composition readout leaves out ${missing.join(', ')} — ` +
      `absent from the bar and from the total the percentages divide by`);
    failed++;
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  the composition readout covers every gas the model tracks (${gases.length})`);
  }
}

console.log(`\n${files.length - 1} modules loaded, ${failed} failed`);
process.exit(failed ? 1 : 0);
