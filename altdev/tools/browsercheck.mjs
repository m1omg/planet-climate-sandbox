// Exercise the controls that only exist in browser event handlers. This talks
// to a fresh headless Chrome over its DevTools pipe, without adding a test
// framework (or another dependency) to the sandbox.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const url = process.argv[2] || 'http://127.0.0.1:8765/altdev/';
const chromePath = process.env.CHROME || '/usr/bin/google-chrome';
const profile = mkdtempSync(join(tmpdir(), 'planet-browsercheck-'));
const screenshot = join(tmpdir(), 'altdev-browsercheck.png');
const drownedScreenshot = join(tmpdir(), 'altdev-browsercheck-drowned.png');
const chrome = spawn(chromePath, [
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  `--user-data-dir=${profile}`,
  '--remote-debugging-pipe',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });

let nextId = 1;
let wire = '';
let chromeStderr = '';
const pending = new Map();
const browserErrors = [];

chrome.stderr.setEncoding('utf8');
chrome.stderr.on('data', (chunk) => { chromeStderr += chunk; });
for (const pipe of [chrome.stdio[3], chrome.stdio[4]]) pipe.on('error', () => {});
chrome.on('exit', (code, signal) => {
  if (pending.size === 0) return;
  const reason = new Error(`Chrome exited ${signal || code}\n${chromeStderr.trim()}`);
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(reason); }
  pending.clear();
});

chrome.stdio[4].setEncoding('utf8');
chrome.stdio[4].on('data', (chunk) => {
  wire += chunk;
  let end;
  while ((end = wire.indexOf('\0')) >= 0) {
    const raw = wire.slice(0, end);
    wire = wire.slice(end + 1);
    if (!raw) continue;
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      pending.delete(msg.id); clearTimeout(timer);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result || {});
      continue;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      browserErrors.push(msg.params?.exceptionDetails?.text || 'uncaught exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      browserErrors.push((msg.params.args || []).map((x) => x.value || x.description || '').join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
      browserErrors.push(msg.params.entry.text);
    }
  }
});

function call(method, params = {}, sessionId = undefined, timeout = 20_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ok = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
};

let sessionId;
async function evaluate(expression) {
  const out = await call('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (out.exceptionDetails) {
    throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
  }
  return out.result?.value;
}

async function waitFor(expression, timeout = 20_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await evaluate(expression)) return; } catch { }
    await delay(100);
  }
  throw new Error(`browser condition timed out: ${expression}`);
}

async function drag(rect, dx) {
  const x = rect.x + rect.width * 0.5;
  const y = rect.y + rect.height * 0.5;
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  await call('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
  }, sessionId);
  await call('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: x + dx, y, button: 'left', buttons: 1,
  }, sessionId);
  const yaw = await evaluate('__app.view.yaw');
  await call('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x + dx, y, button: 'left', buttons: 0, clickCount: 1,
  }, sessionId);
  return yaw;
}

try {
  const version = await call('Browser.getVersion');
  const target = await call('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
  await call('Page.enable', {}, sessionId);
  await call('Runtime.enable', {}, sessionId);
  await call('Log.enable', {}, sessionId);
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
  }, sessionId);
  await call('Page.navigate', { url }, sessionId);
  await waitFor("document.readyState === 'complete' && !!window.__app?.view");
  await waitFor('window.__app.view.ready || window.__app.view.software', 30_000);

  const renderer = await evaluate('({ api: __app.view.api, software: __app.view.software, failed: __app.view.failed, diagnose: __app.diagnose() })');
  ok(!renderer.failed, 'Chrome has a live planet renderer', `${renderer.software ? 'CPU' : renderer.api} · ${version.product}`);

  const initialPan = await evaluate("document.querySelector('#btn-pan').textContent.trim()");
  ok(initialPan === '1×', 'Panning starts at the normal speed', initialPan);
  const fastPan = await evaluate("document.querySelector('#btn-pan').click(); document.querySelector('#btn-pan').textContent.trim()");
  ok(fastPan === '2×', 'The panning control cycles to fast', fastPan);
  await call('Page.reload', { ignoreCache: true }, sessionId);
  await waitFor("document.readyState === 'complete' && !!window.__app?.view");
  await waitFor('window.__app.view.ready || window.__app.view.software', 30_000);
  const persistedPan = await evaluate("document.querySelector('#btn-pan').textContent.trim()");
  ok(persistedPan === '2×', 'Panning speed survives a reload', persistedPan);

  const rect = await evaluate("(() => { const r = document.querySelector('#planet').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()");
  await evaluate('__app.view.zoom = 1');
  await call('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
    deltaX: 0, deltaY: 120,
  }, sessionId);
  const wheelOut = await evaluate('__app.view.zoom');
  await evaluate('__app.view.zoom = 1');
  await call('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
    deltaX: 0, deltaY: -120,
  }, sessionId);
  const wheelIn = await evaluate('__app.view.zoom');
  ok(wheelOut > 1 && wheelIn < 1, 'Mouse-wheel direction matches maps and browsers', `out ${wheelOut.toFixed(3)}× · in ${wheelIn.toFixed(3)}×`);

  await evaluate('__app.view.yaw = 0; __app.view.spinVel = 0');
  const yawFast = await drag(rect, 50);
  await evaluate("document.querySelector('#btn-pan').click(); __app.view.yaw = 0; __app.view.spinVel = 0");
  const yawSlow = await drag(rect, 50);
  const panRatio = Math.abs(yawFast / yawSlow);
  // One animation frame may coast the fast drag before CDP reads it back, so
  // allow that few-percent scheduling jitter around the exact 4x multiplier.
  ok(panRatio > 3.5 && panRatio < 4.5, 'The pan multiplier changes the actual drag response', `${panRatio.toFixed(2)}×`);

  const presets = await evaluate(`(async () => {
    const take = (id) => {
      __app.loadPreset(id); __app.tick(0);
      const w = __app.sim.world;
      return { id, T: w.diag.Tmean, flooded: w.diag.flooded, land: w.params.landFraction,
        p: w.diag.pTotMean, water: w.params.water };
    };
    const hotCarbon = take('hotCarbon');
    const hotStar = take('hotStar');
    const dryVenus = take('dryVenus');
    __app.loadPreset('earlyMoon');
    for (let i = 0; i < 100 && __app.view.body !== 'earlyMoon'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    __app.tick(0);
    const w = __app.sim.world;
    return { hotCarbon, hotStar, dryVenus,
      earlyMoon: { p: w.diag.pTotMean, water: w.params.water, body: __app.view.body || null },
      presetCount: document.querySelectorAll('[data-preset]').length };
  })()`);
  ok(presets.hotCarbon.T > 320 && presets.hotStar.T > 320
    && presets.hotCarbon.land === 0 && presets.hotStar.land === 0,
    'Both Hot Ocean presets are hot, global oceans',
    `${(presets.hotCarbon.T - 273.15).toFixed(1)} °C · ${(presets.hotStar.T - 273.15).toFixed(1)} °C`);
  ok(presets.dryVenus.T > 600 && presets.dryVenus.flooded === 0,
    'Never-Wet Venus loads on its steam branch', `${(presets.dryVenus.T - 273.15).toFixed(0)} °C · no ocean`);
  ok(Math.abs(presets.earlyMoon.p - 0.01) < 0.001 && presets.earlyMoon.water < 2e-7,
    'Ancient Moon loads with thin air and trace water', `${(presets.earlyMoon.p * 1000).toFixed(1)} mbar`);
  if (!renderer.software) ok(presets.earlyMoon.body === 'earlyMoon', 'Ancient Moon loads the real lunar map', presets.earlyMoon.body);
  ok(presets.presetCount === 24, 'All presets are present in the live DOM', `${presets.presetCount}`);

  const drownedEarth = await evaluate(`(async () => {
    __app.loadPreset('earth');
    for (let i = 0; i < 100 && __app.view.body !== 'earth'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    Object.assign(__app.params, { water: 12, landFraction: 1 });
    __app.sim.reset(__app.params);
    __app.tick(0);
    return {
      flooded: __app.sim.world.diag.flooded,
      land: __app.sim.world.diag.landFrac,
      oceanUniform: __app.view.software ? null
        : __app.view.gl.getUniform(__app.view.prog, __app.view.u.uOceanFrac),
    };
  })()`);
  ok(drownedEarth.flooded > 0.999 && drownedEarth.land < 0.001,
    'Twelve oceans drown even maximal Earth basin geometry in Chrome',
    `${(drownedEarth.flooded * 100).toFixed(1)}% ocean`);
  if (!renderer.software) ok(drownedEarth.oceanUniform > 0.999,
    'The full-ocean render gate receives the drowned fraction',
    drownedEarth.oceanUniform.toFixed(3));
  const drownedShot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(drownedScreenshot, Buffer.from(drownedShot.data, 'base64'));

  await evaluate(`(async () => {
    __app.loadPreset('earth');
    for (let i = 0; i < 100 && __app.view.body !== 'earth'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    for (let i = 0; i < 90; i++) __app.tick(1 / 60);
  })()`);
  const shot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  ok(browserErrors.length === 0, 'No browser exceptions or error-level console messages');
  console.log(`Screenshot: ${screenshot}`);
  console.log(`Drowned screenshot: ${drownedScreenshot}`);
} finally {
  try { await call('Browser.close', {}, undefined, 2000); } catch { chrome.kill('SIGTERM'); }
  await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), delay(2000)]);
  rmSync(profile, { recursive: true, force: true });
}
