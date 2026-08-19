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

const mkEl = (tag = 'div') => ({
  tagName: String(tag).toUpperCase(), children: [], style: { setProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  dataset: {}, value: '', textContent: '', innerHTML: '', title: '', hidden: false,
  min: '0', max: '1000', clientWidth: 800, clientHeight: 600, width: 800, height: 600,
  appendChild(c) { this.children.push(c); return c; },
  insertAdjacentHTML() {}, setAttribute() {}, getAttribute: () => null,
  addEventListener() {}, removeEventListener() {}, select() {}, blur() {}, focus() {},
  setPointerCapture() {},
  getContext: (kind) => (kind === '2d' ? stub2d() : null),
  querySelector: () => mkEl(), querySelectorAll: () => [],
  getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
});

globalThis.window = globalThis;
globalThis.document = {
  documentElement: mkEl(), body: mkEl(),
  querySelector: () => mkEl(), querySelectorAll: () => [],
  createElement: (t) => mkEl(t), addEventListener() {},
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { hash: '', search: '', pathname: '/' };
globalThis.history = { replaceState() {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.addEventListener = () => {};
globalThis.devicePixelRatio = 1;

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
const app = globalThis.window.__app;
if (app && app.tick && app.view) {
  const v = app.view;
  v.ready = true;                    // no GL here; pretend init succeeded
  v.render = () => { v._renders = (v._renders || 0) + 1; };
  v.wantTextures = false;
  v.spin = 0.5; v.yaw = 0.25; v.pitch = 0.1;
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

console.log(`\n${files.length - 1} modules loaded, ${failed} failed`);
process.exit(failed ? 1 : 0);
