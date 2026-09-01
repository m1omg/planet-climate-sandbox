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
const slovakScreenshot = join(tmpdir(), 'altdev-browsercheck-sk.png');
const cloudyShot = join(tmpdir(), 'altdev-clouds-on.png');
const clearShot = join(tmpdir(), 'altdev-clouds-off.png');
const volcanoScreenshot = join(tmpdir(), 'altdev-volcanism.png');
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

// Driving this through CDP one round-trip at a time let animation frames run
// between the move and the read, so the drag's own momentum coasted into the
// number and the measured ratio wandered by a tenth or more. Dispatching the
// whole gesture inside one synchronous evaluate is exact: JS is single-threaded,
// so no rAF can land between the pointermove and reading the yaw it produced.
async function drag(rect, dx) {
  return evaluate(`(() => {
    const cv = document.querySelector('#planet');
    const x = ${rect.x + rect.width * 0.5}, y = ${rect.y + rect.height * 0.5};
    const ev = (type, px, buttons) => new PointerEvent(type, {
      clientX: px, clientY: y, buttons, button: buttons ? 0 : -1,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true,
    });
    try { cv.setPointerCapture = () => {}; } catch { }
    __app.view.yaw = 0; __app.view.spinVel = 0;
    cv.dispatchEvent(ev('pointerdown', x, 1));
    cv.dispatchEvent(ev('pointermove', x + ${dx}, 1));
    const yaw = __app.view.yaw;
    cv.dispatchEvent(ev('pointerup', x + ${dx}, 0));
    __app.view.spinVel = 0;
    return yaw;
  })()`);
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

  const pauseRotation = await evaluate(`(() => {
    const play = document.querySelector('#btn-play');
    const spin = document.querySelector('#btn-spin');
    if (__app.sim.paused) play.click();
    if (__app.view.spinPaused) spin.click();
    __app.view.spin = 0;
    play.click();
    const disabledWhilePaused = spin.disabled;
    const before = __app.view.spin;
    __app.tick(1);
    const whilePaused = __app.view.spin;
    play.click();
    __app.tick(1);
    const afterResume = __app.view.spin;
    spin.click();
    const manualBefore = __app.view.spin;
    play.click(); play.click();
    __app.tick(1);
    const manualAfter = __app.view.spin;
    spin.click();
    return { disabledWhilePaused, before, whilePaused, afterResume, manualBefore, manualAfter };
  })()`);
  ok(pauseRotation.disabledWhilePaused
    && pauseRotation.whilePaused === pauseRotation.before
    && pauseRotation.afterResume !== pauseRotation.whilePaused,
    'Main Pause freezes visual rotation and Play resumes it');
  ok(pauseRotation.manualAfter === pauseRotation.manualBefore,
    'Main Pause preserves a manual rotation pause');

  const panMenu = await evaluate(`(() => {
    const s = document.querySelector('#pan-speed');
    return s && { tag: s.tagName, value: s.value,
      options: [...s.options].map((o) => o.value) };
  })()`);
  ok(panMenu?.tag === 'SELECT' && panMenu.value === '1'
    && panMenu.options.join(',') === '0.5,1,2',
    'Panning uses a directly selectable menu and defaults to normal',
    panMenu ? `${panMenu.options.join('× · ')}×` : 'menu missing');
  const slowPan = await evaluate(`(() => {
    const s = document.querySelector('#pan-speed');
    s.value = '0.5'; s.dispatchEvent(new Event('change', { bubbles: true }));
    return s.value;
  })()`);
  ok(slowPan === '0.5', 'Slow panning can be selected directly', `${slowPan}×`);
  await call('Page.reload', { ignoreCache: true }, sessionId);
  await waitFor("document.readyState === 'complete' && !!window.__app?.view");
  await waitFor('window.__app.view.ready || window.__app.view.software', 30_000);
  const persistedPan = await evaluate("document.querySelector('#pan-speed').value");
  ok(persistedPan === '0.5', 'Panning speed survives a reload', `${persistedPan}×`);

  // Chrome paints the native <select> popup itself, above the page, so no
  // screenshot can show it. The resolved colour can be read, though, and a
  // translucent one is exactly the bug: the options were being composited over
  // the planet behind them.
  const menuPaint = await evaluate(`(() => {
    const opt = document.querySelector('#pan-speed option');
    const cs = getComputedStyle(opt);
    const m = cs.backgroundColor.match(/[\d.]+/g) || [];
    return { bg: cs.backgroundColor, color: cs.color, alpha: m.length > 3 ? Number(m[3]) : 1 };
  })()`);
  ok(menuPaint.alpha === 1, 'The open pan-speed menu has an opaque background',
    `${menuPaint.bg} on ${menuPaint.color}`);

  // Slovak, end to end: the button, the runtime-composed banner line under the
  // state name, the canvas-drawn chart furniture and the menu's decimal comma.
  const slovak = await evaluate(`(async () => {
    const btn = document.querySelector('#btn-lang');
    for (let i = 0; i < 4 && document.documentElement.lang !== 'sk'; i++) {
      btn.click();
      await new Promise((r) => setTimeout(r, 60));
    }
    __app.tick(0);
    return {
      lang: document.documentElement.lang,
      reason: document.querySelector('.state-reason').textContent,
      state: document.querySelector('.state-name')?.textContent || '',
      option: document.querySelector('#pan-speed option').textContent,
      title: document.querySelector('#pan-speed').getAttribute('aria-label'),
    };
  })()`);
  ok(slovak.lang === 'sk' && !/mean surface|equator|poles|imbalance/.test(slovak.reason)
    && /priemer na povrchu/.test(slovak.reason),
    'The state banner’s subtitle is translated, not just its title', slovak.reason);
  ok(slovak.option === '0,5×' && /0,5×/.test(slovak.title || ''),
    'The pan-speed menu uses a Slovak decimal comma', `${slovak.option} · ${slovak.title}`);
  // A label the panel cannot show is a label that names nothing. Slovak is
  // routinely longer than the English it replaces, so measure the tiles in the
  // language that stresses them rather than in the one they were designed for.
  const clipped = await evaluate(`(() => {
    const bad = [];
    for (const k of document.querySelectorAll('#readout .stat .k')) {
      if (k.scrollHeight > k.clientHeight + 1) bad.push(k.textContent.trim());
    }
    return bad;
  })()`);
  ok(clipped.length === 0, 'No readout label is truncated in Slovak',
    clipped.length ? clipped.join(' · ') : 'all tiles show their full label');

  // The discovered-climates list is a two-column grid, so each name gets about
  // half the panel. Rather than measure only what this session unlocked, put
  // every Slovak name into a real card and let the browser lay it out.
  const longNames = await evaluate(`(async () => {
    const { SK } = await import('./src/game/sk.js');
    const cards = [...document.querySelectorAll('#statelog .state-card')];
    if (!cards.length) return { skipped: true };
    const names = Object.values(SK.states).map((e) => e.name);
    const over = [];
    for (const n of names) {
      const c = cards[0], nm = c.querySelector('.nm');
      const before = nm.textContent;
      nm.textContent = n;
      if (nm.scrollHeight > nm.clientHeight + 1 || nm.scrollWidth > nm.clientWidth + 1) {
        over.push(n + ' (' + nm.scrollWidth + 'x' + nm.scrollHeight
          + ' in ' + nm.clientWidth + 'x' + nm.clientHeight + ')');
      }
      nm.textContent = before;
    }
    return { over, count: names.length };
  })()`);
  if (longNames.skipped) {
    ok(true, 'No climate card was present to measure', 'skipped');
  } else {
    ok(longNames.over.length === 0, 'Every Slovak climate name fits its card',
      longNames.over.length ? longNames.over.join(' · ') : `all ${longNames.count} fit`);
  }

  // Clouds off is a view, so what has to be proved is that the renderer stopped
  // drawing them and the model did not notice. Screenshots are no good here:
  // the deck drifts on wall-clock time so no two frames match, and the drawing
  // buffer is not preserved so the canvas cannot be read back. The uniforms the
  // shader actually received can be, and they are the thing that decides.
  const cloudTest = await evaluate(`(async () => {
    __app.loadPreset('earth');
    for (let i = 0; i < 80 && __app.view.body !== 'earth'; i++) {
      await new Promise((r) => setTimeout(r, 30));
    }
    const v = __app.view;
    const read = () => {
      __app.tick(0);
      if (v.software) return { cloud: v.lastCloud, steam: v.lastSteam };
      return { cloud: v.gl.getUniform(v.prog, v.u.uCloud),
               steam: v.gl.getUniform(v.prog, v.u.uSteam) };
    };
    const clim = () => ({ cover: __app.sim.world.diag.cloud.reduce((a, b) => a + b, 0) / 18,
                          T: __app.sim.world.diag.Tmean });
    if (v.showClouds === false) document.querySelector('#btn-clouds').click();
    const on = read(), climOn = clim();
    document.querySelector('#btn-clouds').click();
    const off = read(), climOff = clim();
    const pressed = document.querySelector('#btn-clouds').getAttribute('aria-pressed');
    document.querySelector('#btn-clouds').click();
    const back = read();
    return { on, off, back, pressed, climOn, climOff, software: !!v.software,
      backPressed: document.querySelector('#btn-clouds').getAttribute('aria-pressed') };
  })()`);
  // The shader clamps cover from uCloud, so anything negative draws no deck at
  // all -- including a locked world's substellar pile-up, which is added to it.
  ok(cloudTest.on.cloud > 0 && cloudTest.off.cloud < 0 && cloudTest.off.steam === 0
    && cloudTest.pressed === 'false',
    'Hiding the clouds stops the renderer drawing them',
    `cover uniform ${cloudTest.on.cloud.toFixed(2)} → ${cloudTest.off.cloud.toFixed(2)}, steam → 0`);
  ok(Math.abs(cloudTest.climOff.cover - cloudTest.climOn.cover) < 1e-12
    && Math.abs(cloudTest.climOff.T - cloudTest.climOn.T) < 1e-12,
    'Hiding the clouds does not touch the climate',
    `cover ${(cloudTest.climOff.cover * 100).toFixed(1)}% and `
    + `${cloudTest.climOff.T.toFixed(2)} K, both unmoved`);
  ok(cloudTest.backPressed === 'true' && cloudTest.back.cloud > 0,
    'Turning them back on restores the deck',
    `cover uniform back to ${cloudTest.back.cloud.toFixed(2)}`);
  const cloudPersist = await evaluate(`(() => {
    document.querySelector('#btn-clouds').click();
    return document.querySelector('#btn-clouds').getAttribute('aria-pressed');
  })()`);
  await call('Page.reload', { ignoreCache: true }, sessionId);
  await waitFor("document.readyState === 'complete' && !!window.__app?.view");
  await waitFor('window.__app.view.ready || window.__app.view.software', 30_000);
  const cloudAfter = await evaluate("document.querySelector('#btn-clouds').getAttribute('aria-pressed')");
  ok(cloudPersist === 'false' && cloudAfter === 'false', 'A cloudless view survives a reload');
  await evaluate("document.querySelector('#btn-clouds').click()");

  // Strong volcanism has to reach the shader, and a quiet world must not get
  // any. Read off the uniform the fragment stage actually received, because a
  // number computed and never passed to a shader is a bug that has shipped
  // here twice.
  const volc = await evaluate(`(async () => {
    const v = __app.view;
    const read = async (id) => {
      __app.loadPreset(id);
      for (let i = 0; i < 80 && __app.view.body !== id && __app.sim.world.params.outgassing == null; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      await new Promise((r) => setTimeout(r, 60));
      __app.tick(0);
      const u = v.software ? [v.lastVolcano, v.lastAsh]
                           : [v.gl.getUniform(v.prog, v.u.uVolcano)[0],
                              v.gl.getUniform(v.prog, v.u.uVolcano)[1]];
      return { vents: u[0], ash: u[1], volcanism: __app.sim.world.diag.volcanism };
    };
    const mars = await read('mars');
    const earth = await read('earth');
    const gj = await read('gj1132b');
    // ...and the slider, not just the presets.
    __app.loadPreset('earth');
    await new Promise((r) => setTimeout(r, 120));
    __app.params.outgassing = 20;
    __app.sim.reset(__app.params);
    __app.tick(0);
    const cranked = v.software ? [v.lastVolcano, v.lastAsh]
                               : [v.gl.getUniform(v.prog, v.u.uVolcano)[0],
                                  v.gl.getUniform(v.prog, v.u.uVolcano)[1]];
    return { mars, earth, gj, cranked: { vents: cranked[0], ash: cranked[1] } };
  })()`);
  ok(volc.mars.vents < volc.earth.vents && volc.earth.vents < volc.gj.vents
    && volc.gj.vents > 0.9 && volc.mars.vents < 0.05,
    'Volcanism reaches the shader, and a dead world gets none',
    `Mars ${volc.mars.vents.toFixed(3)} · Earth ${volc.earth.vents.toFixed(3)} · `
    + `GJ 1132 b ${volc.gj.vents.toFixed(3)}`);
  ok(volc.cranked.vents > volc.earth.vents * 2 && volc.cranked.ash > 0.15,
    'Cranking the volcanism slider is visible from orbit',
    `20x outgassing: vents ${volc.cranked.vents.toFixed(3)}, ash ${volc.cranked.ash.toFixed(3)}`);
  // Io-like: all the heat, no air. Ash needs an atmosphere to hang in.
  ok(volc.gj.ash <= 0.35 && volc.mars.ash < 0.05,
    'Ash needs an atmosphere to hang in',
    `Mars ${volc.mars.ash.toFixed(3)} at 6 mbar · GJ 1132 b ${volc.gj.ash.toFixed(3)}`);
  // Turned so the terminator is across the middle: the vents only read on the
  // unlit half, so a screenshot of the day side proves nothing about them.
  await evaluate(`(() => { __app.view.yaw = 2.2; __app.view.pitch = 0.15; __app.tick(0); })()`);
  const volcShot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(volcanoScreenshot, Buffer.from(volcShot.data, 'base64'));

  // Two artefacts of the cloud-free view, which is the one change here that can
  // only be judged by looking: Earth with its weather on and with it taken off.
  await evaluate(`(async () => {
    __app.loadPreset('earth');
    for (let i = 0; i < 80 && __app.view.body !== 'earth'; i++) {
      await new Promise((r) => setTimeout(r, 30));
    }
    if (__app.view.showClouds === false) document.querySelector('#btn-clouds').click();
    __app.tick(0);
  })()`);
  const withCloud = await call('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(cloudyShot, Buffer.from(withCloud.data, 'base64'));
  await evaluate("document.querySelector('#btn-clouds').click(); __app.view.skyKey = ''; __app.tick(0);");
  const noCloud = await call('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(clearShot, Buffer.from(noCloud.data, 'base64'));
  await evaluate("document.querySelector('#btn-clouds').click();");

  // Kept as an artefact: the chart furniture is drawn to a canvas, so a picture
  // is the only way anyone can check it reads properly in the other language.
  // Venus, because it carries the longest state name in the dictionary and so
  // stresses the banner and the climate card harder than Earth does.
  await evaluate(`(async () => {
    __app.loadPreset('venus');
    for (let i = 0; i < 60 && __app.view.body !== 'venus'; i++) {
      await new Promise((r) => setTimeout(r, 30));
    }
    __app.tick(0);
  })()`);
  const skShot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(slovakScreenshot, Buffer.from(skShot.data, 'base64'));

  const backToEn = await evaluate(`(async () => {
    const btn = document.querySelector('#btn-lang');
    for (let i = 0; i < 4 && document.documentElement.lang !== 'en'; i++) {
      btn.click();
      await new Promise((r) => setTimeout(r, 60));
    }
    __app.tick(0);
    return { lang: document.documentElement.lang,
      reason: document.querySelector('.state-reason').textContent,
      option: document.querySelector('#pan-speed option').textContent };
  })()`);
  ok(backToEn.lang === 'en' && /mean surface/.test(backToEn.reason) && backToEn.option === '0.5×',
    'Switching back restores the English banner and menu', backToEn.reason);

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

  await evaluate(`(() => {
    const s = document.querySelector('#pan-speed');
    s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true }));
    __app.view.yaw = 0; __app.view.spinVel = 0;
  })()`);
  const yawFast = await drag(rect, 50);
  await evaluate(`(() => {
    const s = document.querySelector('#pan-speed');
    s.value = '0.5'; s.dispatchEvent(new Event('change', { bubbles: true }));
    __app.view.yaw = 0; __app.view.spinVel = 0;
  })()`);
  const yawSlow = await drag(rect, 50);
  const panRatio = Math.abs(yawFast / yawSlow);
  // The gesture is dispatched synchronously now, so this is the exact ratio of
  // the two multipliers and not a measurement with slack in it.
  ok(panRatio > 3.99 && panRatio < 4.01, 'The pan multiplier changes the actual drag response', `${panRatio.toFixed(2)}×`);

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
  console.log(`Slovak screenshot: ${slovakScreenshot}`);
  console.log(`Clouds on/off: ${cloudyShot} · ${clearShot}`);
  console.log(`Volcanism: ${volcanoScreenshot}`);
} finally {
  try { await call('Browser.close', {}, undefined, 2000); } catch { chrome.kill('SIGTERM'); }
  await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), delay(2000)]);
  rmSync(profile, { recursive: true, force: true });
}
