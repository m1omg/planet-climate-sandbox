// Exercise the controls that only exist in browser event handlers. This talks
// to a fresh headless Chrome over its DevTools pipe, without adding a test
// framework (or another dependency) to the sandbox.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const url = process.argv[2] || 'http://127.0.0.1:8765/altdev2/';
const chromePath = process.env.CHROME || '/usr/bin/google-chrome';
const profile = mkdtempSync(join(tmpdir(), 'planet-browsercheck-'));
const screenshot = join(tmpdir(), 'altdev2-browsercheck.png');
const slovakScreenshot = join(tmpdir(), 'altdev2-browsercheck-sk.png');
const cloudyShot = join(tmpdir(), 'altdev2-clouds-on.png');
const clearShot = join(tmpdir(), 'altdev2-clouds-off.png');
const volcanoScreenshot = join(tmpdir(), 'altdev2-volcanism.png');
const epochScreenshot = join(tmpdir(), 'altdev2-epochs.png');
const drownedScreenshot = join(tmpdir(), 'altdev2-browsercheck-drowned.png');
// Chrome refuses to start its sandbox as root, which is every container this
// is likely to run in -- CI, and the remote sandboxes this project is developed
// in. Passing --no-sandbox unconditionally would weaken it for a developer
// running the check on their own machine, so it is passed only when there is no
// sandbox to be had anyway. Nothing changes for a normal user.
//
// One thing to know before diagnosing a hang here. On a machine with no GPU,
// Chrome falls back to SwiftShader and every frame is rendered on the CPU. The
// epoch-clock check below drives 360 frames inside a single Runtime.evaluate,
// and the CDP call has a 20 s timeout: on software rendering that is not enough
// and the check dies with `CDP timeout: Runtime.evaluate` after sixteen passes.
// It is the renderer, not the model -- the same 360 ticks take 0.16 s in node
// with no canvas, and a build predating the work being tested times out in
// exactly the same place. Raising the timeout for everyone to accommodate a
// GPU-less container would blunt a real deadlock detector, so this is written
// down rather than fixed.
const rootless = typeof process.getuid === 'function' && process.getuid() === 0
  ? ['--no-sandbox'] : [];
const chrome = spawn(chromePath, [
  ...rootless,
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

// Two minutes, not twenty seconds. The twenty was a guess and it was wrong: on a
// machine without a GPU -- this repo's own CI container, xvfb and software GL --
// the two evaluates that call `loadPreset` take 26 and 34 seconds, because each
// one rebakes a cube map on the CPU. The run died at check 27 of 51 and the
// failure was read as an environment ceiling for long enough to ship a check
// nobody had ever seen pass. It is a hang-catcher, so it only has to be shorter
// than giving up: two minutes still catches a wedged browser, and clears the
// slowest real call by 3.5x.
function call(method, params = {}, sessionId = undefined, timeout = 120_000) {
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

  // The Worlds and Saves menus. Everything here lives in a click handler, so a
  // Node test can only look at the source; whether the menu actually opens,
  // covers the panel and gets out of the way again is a browser question.
  const menu0 = await evaluate(`(() => {
    const hidden = document.querySelector('#menu-worlds').hidden;
    document.querySelector('#btn-worlds').click();
    const m = document.querySelector('#menu-worlds');
    const r = m.getBoundingClientRect();
    const chip = m.querySelector('[data-preset]').getBoundingClientRect();
    return { hidden, open: !m.hidden, top: Math.round(r.top), width: Math.round(r.width),
      expanded: document.querySelector('#btn-worlds').getAttribute('aria-expanded'),
      chipVisible: chip.width > 0 && chip.height > 0,
      shelfBottom: Math.round(document.querySelector('.shelf').getBoundingClientRect().bottom) };
  })()`);
  ok(menu0.hidden && menu0.open && menu0.expanded === 'true' && menu0.chipVisible
    && menu0.top >= menu0.shelfBottom,
    'The Worlds button opens a menu of presets under the shelf',
    `${menu0.width}px wide at y=${menu0.top}, shelf ends at ${menu0.shelfBottom}`);

  // Only one at a time, or the second opens underneath the first.
  const swap = await evaluate(`(() => {
    document.querySelector('#btn-saves').click();
    return { worlds: !document.querySelector('#menu-worlds').hidden,
             saves: !document.querySelector('#menu-saves').hidden,
             slots: !!document.querySelector('#menu-saves #slots') };
  })()`);
  ok(!swap.worlds && swap.saves && swap.slots,
    'Opening Saves puts Worlds away, and the slots are in it',
    `worlds ${swap.worlds}, saves ${swap.saves}`);

  const away = await evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const afterEsc = document.querySelector('#menu-saves').hidden;
    document.querySelector('#btn-worlds').click();
    document.querySelector('#menu-scrim').click();
    const afterScrim = document.querySelector('#menu-worlds').hidden;
    return { afterEsc, afterScrim, scrim: document.querySelector('#menu-scrim').hidden };
  })()`);
  ok(away.afterEsc && away.afterScrim && away.scrim,
    'Escape and a click outside both put the menu away');

  // Choosing a world closes the menu and leaves its name on the button, which
  // is the whole reason the list can be folded away without costing anything.
  const chose = await evaluate(`(async () => {
    document.querySelector('#btn-worlds').click();
    document.querySelector('[data-preset="venus"]').click();
    await new Promise((r) => setTimeout(r, 120));
    return { hidden: document.querySelector('#menu-worlds').hidden,
             shelf: document.querySelector('#shelf-world').textContent,
             body: __app.sim.world.params.insolation };
  })()`);
  ok(chose.hidden && /Venus/i.test(chose.shelf),
    'Picking a world loads it and puts the menu away', `the button now reads "${chose.shelf}"`);

  // And the point of the whole arrangement: the sliders start above the fold
  // instead of below 782px of world list.
  const fold = await evaluate(`(() => {
    const r = document.querySelector('#sliders-body').getBoundingClientRect();
    return { top: Math.round(r.top), h: window.innerHeight };
  })()`);
  ok(fold.top < fold.h * 0.5, 'The first climate slider is above the fold',
    `at ${fold.top}px of ${fold.h}`);

  // The cross-section, and the state it was getting wrong. A Buried Ocean is a
  // hot lid on cold liquid water; the readout drew the lid, then rock, and left
  // out the ocean the state is named for. Driven here rather than in Node
  // because it is the rendered stack that was wrong, not the numbers behind it.
  //
  // The clock is advanced in two evaluates rather than one: a hundred million
  // years of this world is fifteen seconds of physics, and the CDP call gives up
  // at twenty. Nothing is rendered in between -- runYears is the model alone.
  // From a fresh page. Loading a preset merges its parameters onto whatever is
  // already set rather than replacing them, so a world loaded after Venus is
  // not the world the preset describes -- it inherits every field Venus set and
  // this one does not mention.
  await call('Page.reload', { ignoreCache: true }, sessionId);
  await waitFor("document.readyState === 'complete' && !!window.__app?.view");
  await waitFor('window.__app.view.ready || window.__app.view.software', 30_000);
  //
  // Loading the world and running it have to be separate evaluates. loadPreset
  // finishes asynchronously -- the real surface map arrives later and resets the
  // simulation when it does -- so fifty million years run in the same call as
  // the load are thrown away by that reset, and the check then reads a world
  // fifty million years younger than it thinks. It reported a temperate Hycean
  // and was right about the world it was looking at.
  await evaluate(`(async () => {
    __app.loadPreset('coldStart');
    await new Promise((r) => setTimeout(r, 400));
    return __app.sim.world.time;
  })()`);
  await evaluate('__app.sim.runYears(5e7)');
  const stack = await evaluate(`(() => {
    __app.sim.runYears(5e7);
    const age = __app.sim.world.time;
    // The readout redraws on a clock of its own -- a tenth of a second of REAL
    // time, so that a running model does not rebuild forty tiles a frame -- and
    // tick(0) advances that clock by nothing. Asking for the state after a
    // hundred million years and reading a panel drawn before them is how this
    // check first "found" a temperate Hycean sitting on a 1949 K supercritical
    // atmosphere. Pause first, so the quarter second buys a redraw and not a
    // different world.
    __app.sim.paused = true;
    __app.tick(0.25);
    const rows = [...document.querySelectorAll('#structure .layer')].map((el) => ({
      name: el.querySelector('.layer-name').textContent,
      size: el.querySelector('.layer-size').textContent,
    }));
    return { rows, age, state: document.querySelector('.state-name .txt').textContent };
  })()`);
  ok(stack.age > 9.9e7, 'The cold-start world really did run its hundred million years',
    `${(stack.age / 1e6).toFixed(0)} Myr`);
  const kinds = stack.rows.map((r) => r.name);
  // Water under the lid, in whatever phase it is in: a liquid band down to the
  // critical temperature and a supercritical one below it. What the state is
  // named for is that the water is there, not that all of it is liquid.
  const sea = stack.rows.find((r) => /liquid ocean|tekutý oceán/i.test(r.name));
  const under = stack.rows.slice(1, -1).filter((r) => /ocean|oceán|supercrit|nadkrit/i.test(r.name));
  // Metres or kilometres: the liquid part of this pool is 700 m thick, because
  // the water it closed over was already at the critical temperature.
  //
  // The water starts immediately under the lid, with nothing between the two but
  // the conductive boundary that carries the flux across the jump -- this was
  // pinned at index 1, which was right until that boundary existed and became a
  // failure about a band that is supposed to be there.
  // The water starts under the lid with nothing between the two but the
  // conductive boundary. How many bands the SKY takes is not this check's
  // business -- it was one, then two once the cool steam above the supercritical
  // part was drawn -- so this walks up from the sea rather than counting down
  // from the top: boundary immediately above it, supercritical above that.
  const seaAt = kinds.indexOf(sea ? sea.name : '\u0000');
  const rightUnder = seaAt > 0
    && (/thermal boundary|tepeln/i.test(kinds[seaAt - 1] ?? '')
      ? /supercrit|nadkrit/i.test(kinds[seaAt - 2] ?? '')
      : /supercrit|nadkrit/i.test(kinds[seaAt - 1] ?? ''));
  ok(/buried|pochovan/i.test(stack.state) && !!sea && under.length >= 1
    && under.every((r) => /\d\s*k?m\b/.test(r.size)) && rightUnder,
    'A Buried Ocean draws the water it is named for, under the lid',
    `${stack.state}: ${kinds.join(' → ')}  ·  ${under.map((r) => r.size).join(' + ')}`);
  ok(stack.rows.every((r) => /rock|hornina/i.test(r.name) || /°C/.test(r.size)),
    'Every band of the cross-section says how hot it is',
    stack.rows.map((r) => `${r.name}: ${r.size}`).join(' | '));

  // ...and the planet in the middle of the screen agrees with the panel. This
  // world was drawn as a lava ball with cracks glowing through, on a planet
  // whose own cross-section has 260 km of liquid water over that rock, and
  // switching the clouds off took the envelope away and showed the ground.
  const look = await evaluate(`(() => {
    const v = __app.view;
    const read = () => (v.software
      ? { bare: v.lastBareRock, steam: v.lastSteam, sea: v.lastOceanFrac }
      : { bare: v.gl.getUniform(v.prog, v.u.uBareRock),
          steam: v.gl.getUniform(v.prog, v.u.uSteam),
          sea: v.gl.getUniform(v.prog, v.u.uOceanFrac) });
    __app.tick(0.25);
    const on = read();
    v.showClouds = false; __app.tick(0.25);
    const off = read();
    v.showClouds = true; __app.tick(0.25);
    return { on, off, T: __app.sim.world.diag.Tmean };
  })()`);
  ok(look.on.bare === 0 && look.T > 1150,
    'A buried ocean is not painted as molten rock',
    `${look.T.toFixed(0)} K, bare-rock gate ${look.on.bare}`);
  // Switching the shroud off shows you the water it was hiding. This used to
  // assert the opposite -- the envelope stayed, because taking it away revealed
  // bare rock on a world carrying five hundred oceans -- but the answer to that
  // was to draw the ocean, not to refuse to open the curtain. So: the steam goes,
  // and what is underneath is sea rather than the ground the sea stands on.
  ok(look.off.steam === 0 && look.off.sea > 0.5 && look.on.sea === 0,
    'and hiding the clouds shows the ocean a buried world is named for',
    `steam ${look.on.steam} → ${look.off.steam}, sea ${look.on.sea} → ${look.off.sea}`);

  // The water control after a hundred million years of a world that has been
  // evolving its own inventory. The box carries the share of the planet's mass
  // and the line under the slider carries the inventory, and BOTH have to be
  // the water the world has now: the live path writes this control every frame,
  // and when it wrote only the box the line under it kept whatever value a
  // slider had last been touched at.
  const wctl = await evaluate(`(() => {
    __app.tick(0.25);
    return { box: document.querySelector('#o-water').value,
             sub: document.querySelector('#sub-water').textContent,
             water: __app.sim.world.params.water,
             mass: __app.sim.world.params.mass };
  })()`);
  const subEO = parseFloat(wctl.sub) * (/k EO/.test(wctl.sub) ? 1000 : 1);
  const boxPct = parseFloat(wctl.box);
  const wantPct = wctl.water * 1.4e21 / (wctl.mass * 5.972e24) * 100;
  ok(Math.abs(subEO - wctl.water) / wctl.water < 0.01
    && Math.abs(boxPct - wantPct) / wantPct < 0.02,
    'The water control shows the water the world has now, in both numbers',
    `box "${wctl.box}" over "${wctl.sub}" against ${wctl.water.toFixed(2)} EO `
      + `on ${wctl.mass} M⊕ (${wantPct.toFixed(3)}%)`);

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
  // Any of the openings, because which one the line takes is a fact about the
  // world this check happens to be looking at: a planet with water describes the
  // descent through it ("atmosféra … oceán v priemere …"), a dry one reads
  // "priemer na povrchu", and one whose sea has finished boiling reads
  // "obloha … voda …". What is being checked is that none of them is in English.
  ok(slovak.lang === 'sk'
    && !/mean surface|sky \d|water \d|atmosphere \d|envelope \d|fluid \d/.test(slovak.reason)
    && !/boundary|ocean averages|equator|poles|imbalance/.test(slovak.reason)
    && /priemer na povrchu|obloha .* voda |atmosféra |obal |tekutina |oceán v priemere /
      .test(slovak.reason),
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

  // The open epoch's duration has to count up. It is the only row on that list
  // whose number is still moving, and the list is only rebuilt when the climate
  // CHANGES -- so it was written once, at the instant the epoch began, when it
  // is zero by construction, and left there. Every finished epoch read
  // correctly and the one you were living through read 0.0 yr for as long as it
  // lasted.
  const epochClock = await evaluate(`(async () => {
    __app.loadPreset('earth');
    for (let i = 0; i < 80 && __app.view.body !== 'earth'; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    // Drive it into a second climate so the panel is showing at all.
    __app.params.insolation = 1.9;
    __app.sim.reset(__app.params);
    __app.sim.rate = 1e6;
    __app.sim.autoEase = false;
    if (__app.sim.paused) document.querySelector('#btn-play').click();
    // Driven through tick() with real time on it, the way the page drives it:
    // the readout runs on a 10 Hz clock of its own and tick(0) never turns it.
    // Kept short -- each tick of a runaway is real physics and this call has a
    // round trip to come back inside.
    for (let i = 0; i < 300 && __app.epochs().length < 2; i++) __app.tick(1 / 60);
    const row = () => document.querySelector('#epochs-list .epoch-row.current .epoch-span').textContent;
    const first = row();
    const t0 = __app.sim.world.time;
    for (let i = 0; i < 60; i++) __app.tick(1 / 60);
    const out = { first, later: row(), elapsed: __app.sim.world.time - t0,
      open: __app.epochs()[__app.epochs().length - 1] };
    // Put the clock down and the world back before leaving. This check drives a
    // planet into a runaway by writing insolation straight into the shared
    // params object, and a 270 bar supercritical envelope is expensive to step:
    // left running, it starved whatever ran next of its own round trip.
    if (!__app.sim.paused) document.querySelector('#btn-play').click();
    __app.loadPreset('earth');
    await new Promise((r) => setTimeout(r, 150));
    return out;
  })()`);
  ok(epochClock.first !== epochClock.later && epochClock.elapsed > 0
    && epochClock.open.to === null,
    'The epoch you are living through counts up as it happens',
    `"${epochClock.first}" → "${epochClock.later}" over `
    + `${epochClock.elapsed.toExponential(1)} simulated years`);

  // The spin-down switch: present, checked on a red dwarf, off on a sandbox
  // world, and it has to survive the address bar or a shared link would arrive
  // at a different star from the one that was shared.
  const xuv = await evaluate(`(async () => {
    const load = async (id) => {
      __app.loadPreset(id);
      for (let i = 0; i < 80 && __app.view.body !== id; i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      await new Promise((r) => setTimeout(r, 80));
      __app.tick(0);
      return { checked: document.querySelector('#chk-xuv-decay').checked,
               param: !!__app.sim.world.params.xuvDecay };
    };
    const dwarf = await load('trappist1e');
    const sandbox = await load('waterworld');
    // Flip it on the sandbox world and read the address bar.
    const box = document.querySelector('#chk-xuv-decay');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    __app.tick(0);
    return { dwarf, sandbox, hash: location.hash,
             after: !!__app.sim.world.params.xuvDecay };
  })()`);
  ok(xuv.dwarf.checked && xuv.dwarf.param && !xuv.sandbox.checked && !xuv.sandbox.param,
    'The spin-down switch ships on for a red dwarf and off for a sandbox world',
    `TRAPPIST-1e ${xuv.dwarf.checked} · ocean world ${xuv.sandbox.checked}`);
  ok(xuv.after && /xuvDecay=true/.test(xuv.hash),
    'Turning it on reaches the model and the address bar',
    xuv.hash.slice(0, 60));
  const xuvBack = await evaluate(`(async () => {
    __app.loadPreset('waterworld');
    await new Promise((r) => setTimeout(r, 120));
    return !!__app.sim.world.params.xuvDecay;
  })()`);
  ok(xuvBack === false, 'Loading a preset puts its own answer back', `back to ${xuvBack}`);

  // The timeline, the milestones and the epoch record. All three live in click
  // handlers, so none of them is visible to a Node test.
  const timeline = await evaluate(`(async () => {
    __app.loadPreset('earth');
    for (let i = 0; i < 80 && __app.view.body !== 'earth'; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (__app.sim.paused) document.querySelector('#btn-play').click();
    // Run a world far enough to have a history worth scrubbing.
    __app.sim.rate = 1e7;
    for (let i = 0; i < 400; i++) { __app.sim.advance(1 / 60); }
    __app.tick(0);
    const cv = document.querySelector('#chart-history');
    const r = cv.getBoundingClientRect();
    const mid = { clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.5 };
    const { historyTimeAtX } = await import('./src/render/charts.js');
    const tMax = Math.max(__app.sim.world.time, 10);
    // A pixel is worth this many years at full zoom...
    const before = historyTimeAtX(r.width * 0.9 + 1, tMax, r.width)
                 - historyTimeAtX(r.width * 0.9, tMax, r.width);
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true, ...mid }));
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true, ...mid }));
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true, ...mid }));
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true, ...mid }));
    __app.tick(0);
    const z = __app.timeline();
    const after = historyTimeAtX(r.width * 0.9 + 1, tMax, r.width, z.zoom, z.pan)
                - historyTimeAtX(r.width * 0.9, tMax, r.width, z.zoom, z.pan);
    cv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    __app.tick(0);
    const reset = __app.timeline();

    // Milestones: drop three, remove one, and land on another.
    const flag = document.querySelector('#btn-mark');
    flag.click();
    for (let i = 0; i < 60; i++) __app.sim.advance(1 / 60);
    flag.click();
    for (let i = 0; i < 60; i++) __app.sim.advance(1 / 60);
    flag.click();
    __app.tick(0);
    const dropped = document.querySelectorAll('#marks-list .mark-row').length;
    document.querySelectorAll('#marks-list .mark-drop')[1].click();
    const afterDrop = document.querySelectorAll('#marks-list .mark-row').length;
    const groupShown = !document.querySelector('#marks-group').hidden;
    const clearable = !!document.querySelector('#marks-clear');

    return { before, after, zoom: z.zoom, reset,
      dropped, afterDrop, groupShown, clearable,
      epochs: __app.epochs().map((e) => ({ id: e.id, from: e.from, to: e.to })),
      shown: document.querySelectorAll('#epochs-list .epoch-row').length,
      epochsHidden: document.querySelector('#epochs-group').hidden };
  })()`);
  ok(timeline.zoom > 3 && timeline.after < timeline.before / 3
    && timeline.reset.zoom === 1,
    'The timeline zooms in, and a pixel is worth less time when it does',
    `${(timeline.before / 1e6).toFixed(1)} Myr per pixel → `
    + `${(timeline.after / 1e6).toFixed(2)} Myr at ${timeline.zoom.toFixed(1)}×, `
    + `double-click restores the whole run`);
  ok(timeline.dropped === 3 && timeline.afterDrop === 2
    && timeline.groupShown && timeline.clearable,
    'Milestones stack up, and any one of them can be removed',
    `${timeline.dropped} dropped, ${timeline.afterDrop} after removing the middle one`);
  ok(timeline.epochs.length >= 1
    && timeline.epochs.every((e, i) => i === 0 || e.from >= timeline.epochs[i - 1].from)
    && timeline.epochs[timeline.epochs.length - 1].to === null,
    'The world keeps a record of every climate it has been through',
    timeline.epochs.map((e) => `${e.id}@${e.from.toExponential(1)}`
      + (e.to == null ? '(open)' : `→${e.to.toExponential(1)}`)).join(' · '));

  // A world that has been through more than one climate shows the list, and
  // going back to an epoch's start actually moves the clock.
  const epochJump = await evaluate(`(async () => {
    __app.loadPreset('earth');
    for (let i = 0; i < 80 && __app.view.body !== 'earth'; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    // Far enough over the limit that the world has to leave temperate. The
    // epoch record is written by the readout, which runs on tick() rather than
    // on advance(), so the clock has to be driven the way the page drives it.
    __app.params.insolation = 1.9;
    __app.sim.reset(__app.params);
    __app.sim.rate = 1e5;
    __app.sim.autoEase = false;
    if (__app.sim.paused) document.querySelector('#btn-play').click();
    for (let i = 0; i < 1200 && __app.epochs().length < 2; i++) {
      __app.sim.advance(1 / 60);
      __app.tick(0);
    }
    // ...and well past it, so going back to the epoch's start is a real move
    // rather than a rounding error on top of the transition itself.
    for (let i = 0; i < 300; i++) { __app.sim.advance(1 / 60); __app.tick(0); }
    const list = __app.epochs();
    const rows = document.querySelectorAll('#epochs-list .epoch-row').length;
    const hidden = document.querySelector('#epochs-group').hidden;
    const before = __app.sim.world.time;
    const back = document.querySelectorAll('#epochs-list .epoch-back');
    let jumped = null;
    for (const b of back) { if (!b.disabled) { b.click(); jumped = __app.sim.world.time; break; } }
    return { n: list.length, rows, hidden, before, jumped,
      ids: list.map((e) => e.id),
      S: __app.sim.world.params.insolation, T: __app.sim.world.diag.Tmean,
      t: __app.sim.world.time, paused: __app.sim.paused };
  })()`);
  ok(epochJump.n >= 2 && !epochJump.hidden && epochJump.rows === epochJump.n,
    'A world that changes climate lists every epoch it passed through',
    `${epochJump.ids.join(' → ')} — ${epochJump.rows} rows`);
  ok(epochJump.jumped != null && epochJump.jumped < epochJump.before * 0.9,
    'Clicking an epoch takes the world back to where that epoch began',
    `${epochJump.before.toExponential(2)} yr → ${epochJump.jumped.toExponential(2)} yr`);

  await evaluate(`(() => {
    // Drop three milestones so the picture shows both panels, and put them on
    // screen -- they live below the fold in the readout column.
    const flag = document.querySelector('#btn-mark');
    __app.sim.rate = 1e6;
    for (let k = 0; k < 3; k++) {
      flag.click();
      for (let i = 0; i < 40; i++) { __app.sim.advance(1 / 60); __app.tick(0); }
    }
    document.querySelector('#marks-group').scrollIntoView({ block: 'center' });
  })()`);
  // A milestone auto-named from the climate has to follow the language switch,
  // because the name it was given belongs to whatever was on when it was
  // dropped -- and the panel is the one place that name is read.
  const markLang = await evaluate(`(() => {
    const read = () => document.querySelector('#marks-list input').value;
    const btn = document.querySelector('#btn-lang');
    const a = read();
    btn.click();
    const b = read();
    // ...and a name the user typed is theirs, and must survive the switch.
    const input = document.querySelector('#marks-list input');
    input.value = 'my own name';
    input.dispatchEvent(new Event('blur'));
    btn.click();
    const kept = document.querySelector('#marks-list input').value;
    return { a, b, kept, lang: document.documentElement.lang };
  })()`);
  ok(markLang.a !== markLang.b && markLang.kept === 'my own name',
    'An auto-named milestone follows the language, a renamed one does not',
    `"${markLang.a}" → "${markLang.b}", renamed stays "${markLang.kept}"`);
  const epochShot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
  writeFileSync(epochScreenshot, Buffer.from(epochShot.data, 'base64'));

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

  // Open a climate card BEFORE switching back, because that panel is written on
  // click and nowhere else -- which is how a Slovak blurb came to be sitting
  // under an English heading on an English page. Reported from play, and no
  // headless test could ever have seen it: the DOM stub does not click.
  const backToEn = await evaluate(`(async () => {
    const card = document.querySelector('#statelog .state-card.found')
      || document.querySelector('#statelog .state-card');
    if (card) { card.click(); await new Promise((r) => setTimeout(r, 40)); }
    const btn = document.querySelector('#btn-lang');
    for (let i = 0; i < 4 && document.documentElement.lang !== 'en'; i++) {
      btn.click();
      await new Promise((r) => setTimeout(r, 60));
    }
    __app.tick(0);
    // Every option in the rate menu, since the "custom" one is built once at
    // boot and used to keep whatever language it was born in.
    const rate = [...document.querySelectorAll('#rate-menu option')]
      .map((o) => o.textContent).join(' | ');
    return { lang: document.documentElement.lang,
      reason: document.querySelector('.state-reason').textContent,
      detail: (document.querySelector('#state-detail') || {}).textContent || '',
      rate,
      option: document.querySelector('#pan-speed option').textContent };
  })()`);
  // Slovak has letters English does not, so "is any Slovak left on an English
  // page" is one regex rather than a list of strings to keep up to date.
  const SLOVAK = /[áäčďéíĺľňóôŕšťúýžÁČĎÉÍĽŇÓŠŤÚÝŽ]/;
  ok(!SLOVAK.test(backToEn.detail) && !SLOVAK.test(backToEn.rate)
    && !SLOVAK.test(backToEn.reason),
    'Switching back to English leaves no Slovak behind, panels and menus included',
    `detail "${backToEn.detail.slice(0, 40)}" · rate "${backToEn.rate.slice(0, 40)}"`);
  ok(backToEn.lang === 'en'
    && /mean surface|atmosphere [-\d.]+ °C|ocean averages/.test(backToEn.reason)
    && backToEn.option === '0.5×',
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
  // Counted against the module rather than against a number written here, which
  // went stale the first time a preset was added and failed for no reason worth
  // anyone's attention.
  const presetTotal = await evaluate(
    `import('./src/game/presets.js').then((m) => Object.keys(m.PRESETS).length)`);
  ok(presets.presetCount === presetTotal,
    'Every preset in the module has a button in the live DOM',
    `${presets.presetCount} of ${presetTotal}`);

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
  console.log(`Epochs/timeline: ${epochScreenshot}`);
} finally {
  try { await call('Browser.close', {}, undefined, 2000); } catch { chrome.kill('SIGTERM'); }
  await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), delay(2000)]);
  rmSync(profile, { recursive: true, force: true });
}
