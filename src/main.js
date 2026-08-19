import { Simulation } from './sim/clock.js';
import { EARTH, PRESETS } from './game/presets.js';
import { SCENARIOS } from './game/scenarios.js';
import { classify, reasonText, STATES } from './physics/classify.js';
import { derive } from './physics/planet.js';
import { runawayLimit } from './physics/radiation.js';
import { NBANDS, lockFactor } from './physics/climate.js';
import { clamp } from './physics/constants.js';
import { PlanetView } from './render/planet.js';
import { drawHistory, drawProfile, drawWater, drawPhase } from './render/charts.js';
import { loadDiscovered, saveDiscovered, buildLogUI, markFound } from './game/log.js';
import { SLIDERS, parseValue, toSlider, fromSlider } from './game/controls.js';

const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------------------
// Slider definitions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const params = { ...EARTH, ...paramsFromHash() };
const sim = new Simulation(params);
const view = new PlanetView($('#planet'));
const renderState = { time: 0, seed: Math.random() * 100 };
const discovered = loadDiscovered();

// Surface style. Generated albedo maps are the default; ?graphics=procedural
// (or ?graphics=proc) selects the fully procedural look instead, and the button
// in the view controls switches between them at any time.
function graphicsFromUrl() {
  const q = (new URLSearchParams(location.search).get('graphics') || '').toLowerCase();
  if (q === 'procedural' || q === 'proc') return false;
  if (q === 'textured' || q === 'tex') return true;
  return true;   // default
}
let activeScenario = null, scenarioResult = null, settling = false, activePreset = 'earth';

const els = {};
function buildSliders() {
  for (const d of SLIDERS) {
    const host = $(`#sliders-${d.g}`);
    const wrap = document.createElement('div');
    wrap.className = 'ctl' + (d.live ? ' live' : '');
    wrap.innerHTML = `
      <div class="ctl-top">
        <label for="s-${d.key}"${d.live ? ' title="The simulation moves this one on its own"' : ''}>${d.label}</label>
        <input class="val" id="o-${d.key}" type="text" inputmode="decimal" spellcheck="false"
               aria-label="${d.label} value, type to set exactly">
      </div>
      <input id="s-${d.key}" type="range" min="0" max="1000" step="1"
             aria-label="${d.label}">
      ${d.note ? `<div class="ctl-note">${d.note}</div>` : ''}`;
    host.appendChild(wrap);
    const input = wrap.querySelector('input[type=range]'), out = wrap.querySelector('input.val');
    els[d.key] = { input, out, def: d, editing: false, dragging: false };

    input.addEventListener('input', () => {
      const v = fromSlider(d, +input.value);
      params[d.key] = v;
      if (!els[d.key].editing) out.value = d.fmt(v);
      input.style.setProperty('--fill', `${input.value / 10}%`);
      applyParams(d.key);
    });
    input.addEventListener('pointerdown', () => { els[d.key].dragging = true; });
    addEventListener('pointerup', () => { els[d.key].dragging = false; });

    // typing an exact value
    out.addEventListener('focus', () => { els[d.key].editing = true; out.select(); });
    out.addEventListener('blur', () => { els[d.key].editing = false; commitTyped(d); });
    out.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); out.blur(); }
      if (e.key === 'Escape') { els[d.key].editing = false; out.value = d.fmt(params[d.key]); out.blur(); }
    });
  }

  // tidal locking toggle
  const host = $('#sliders-star');
  const t = document.createElement('div');
  t.className = 'toggle';
  t.innerHTML = `<label for="lock">Tidally locked</label>
    <button id="lock" class="switch" role="switch" aria-pressed="false"></button>`;
  host.appendChild(t);
  const btn = t.querySelector('#lock');
  btn.addEventListener('click', () => {
    params.tidallyLocked = !params.tidallyLocked;
    btn.setAttribute('aria-pressed', String(params.tidallyLocked));
    applyParams('tidallyLocked');
  });
  els._lock = btn;
}

function commitTyped(d) {
  const e = els[d.key];
  const v = parseValue(d, e.out.value, params[d.key]);
  if (v === null || !isFinite(v)) { e.out.value = d.fmt(params[d.key]); e.out.classList.remove('bad'); return; }
  const clamped = clamp(v, d.zero ? 0 : d.min, d.max);
  params[d.key] = clamped;
  const sPos = clamp(toSlider(d, clamped), 0, 1000);
  e.input.value = String(sPos);
  e.input.style.setProperty('--fill', `${sPos / 10}%`);
  e.out.value = d.fmt(clamped);
  if (Math.abs(clamped - v) > Math.abs(v) * 1e-6) {
    e.out.classList.add('bad');
    setTimeout(() => e.out.classList.remove('bad'), 900);
    toast(`${d.label} limited to ${d.fmt(clamped)}`);
  }
  applyParams(d.key);
}

function syncSliders() {
  for (const d of SLIDERS) {
    const e = els[d.key];
    const s = clamp(toSlider(d, params[d.key]), 0, 1000);
    e.input.value = String(s);
    e.input.style.setProperty('--fill', `${s / 10}%`);
    e.out.value = d.fmt(params[d.key]);
  }
  els._lock.setAttribute('aria-pressed', String(!!params.tidallyLocked));
}

// Reading the live value of a control the simulation evolves on its own.
const LIVE_READERS = {
  co2: (w) => w.co2 * w.diag.g / 1e5,
  n2: (w) => w.n2 * w.diag.g / 1e5,
  ch4: (w) => w.ch4 * w.diag.g / 1e5,
  water: (w) => w.water.ocean + w.water.ice + w.water.vapour,
};

// The four reservoirs above are *outputs* as much as inputs: volcanoes, weathering,
// cold traps and escape to space all move them while the clock runs. Their controls
// follow the planet, except while you are touching them.
function syncLiveControls() {
  const w = sim.world;
  for (const d of SLIDERS) {
    if (!d.live) continue;
    const e = els[d.key];
    if (e.editing || e.dragging) continue;
    const v = LIVE_READERS[d.live](w);
    if (Math.abs(v - params[d.key]) <= Math.abs(params[d.key]) * 1e-4) continue;
    params[d.key] = v;
    const pos = clamp(toSlider(d, v), 0, 1000);
    e.input.value = String(pos);
    e.input.style.setProperty('--fill', `${pos / 10}%`);
    e.out.value = d.fmt(v);
  }
}

// Changing a *composition* slider rewrites the reservoir; changing an external
// forcing just changes the forcing and lets the planet respond.
const RESERVOIR_KEYS = new Set(['n2Bar', 'co2Bar', 'ch4Bar', 'water', 'mass']);
function applyParams(key) {
  const w = sim.world;
  sim.setParams({ [key]: params[key] });
  if (RESERVOIR_KEYS.has(key)) {
    const d = derive(w.params);
    if (key === 'n2Bar') w.n2 = params.n2Bar * 1e5 / d.g;
    if (key === 'co2Bar') { w.co2 = params.co2Bar * 1e5 / d.g; w.co2Frozen = 0; }
    if (key === 'ch4Bar') w.ch4 = params.ch4Bar * 1e5 / d.g;
    if (key === 'mass') {
      w.n2 = params.n2Bar * 1e5 / d.g; w.co2 = params.co2Bar * 1e5 / d.g; w.ch4 = params.ch4Bar * 1e5 / d.g;
    }
    if (key === 'water') {
      // The control shows the water still present, so set that directly and
      // leave the record of what has already been lost to space intact.
      const cur = w.water.ocean + w.water.ice + w.water.vapour;
      const target = Math.max(0, params.water);
      if (cur > 1e-9) {
        const f = target / cur;
        w.water.ocean *= f; w.water.ice *= f; w.water.vapour *= f;
      } else { w.water.ocean = target; }
      w.waterInitial = Math.max(w.waterInitial ?? 0, target + w.water.lost);
    }
    sim.setParams({});
  }
  setPresetActive(null);
  writeHash();
}

// ---------------------------------------------------------------------------
function buildPresets() {
  const host = $('#presets');
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.preset = id;
    b.innerHTML = `<span>${p.icon}</span>${p.name}`;
    b.addEventListener('click', () => loadPreset(id));
    host.appendChild(b);
  }
}
function setPresetActive(id) {
  activePreset = id;
  document.querySelectorAll('[data-preset]').forEach((b) =>
    b.classList.toggle('active', b.dataset.preset === id));
}
function loadPreset(id) {
  Object.assign(params, PRESETS[id].params);
  renderState.seed = Math.random() * 100;
  sim.reset(params);
  syncSliders(); setPresetActive(id); writeHash();
  closeScenario();
  toast(`${PRESETS[id].icon} ${PRESETS[id].name}`);
}

function buildScenarios() {
  const host = $('#scenarios');
  for (const s of SCENARIOS) {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.scenario = s.id;
    b.innerHTML = `<span>${s.icon}</span><span><b>${s.name}</b><span>${s.brief.slice(0, 78)}…</span></span>`;
    b.addEventListener('click', () => startScenario(s.id));
    host.appendChild(b);
  }
}
function startScenario(id) {
  const s = SCENARIOS.find((x) => x.id === id);
  activeScenario = s; scenarioResult = null;
  Object.assign(params, s.params);
  renderState.seed = Math.random() * 100;
  sim.reset(params);
  syncSliders(); setPresetActive(null);
  document.querySelectorAll('[data-scenario]').forEach((b) => b.classList.toggle('active', b.dataset.scenario === id));
  const banner = $('#scenario-banner');
  banner.hidden = false;
  banner.querySelector('.sc-icon').textContent = s.icon;
  banner.querySelector('.sc-name').textContent = s.name;
  banner.querySelector('.sc-brief').textContent = s.brief;
  toast(`${s.icon} ${s.name} — ${s.hint}`, 7000);
}
function closeScenario() {
  activeScenario = null; scenarioResult = null;
  $('#scenario-banner').hidden = true;
  document.querySelectorAll('[data-scenario]').forEach((b) => b.classList.remove('active'));
}

// ---------------------------------------------------------------------------
// URL hash so a world can be shared
function writeHash() {
  const keep = {};
  for (const k of Object.keys(EARTH)) if (params[k] !== EARTH[k]) keep[k] = params[k];
  const s = Object.entries(keep).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(6) : v}`).join('&');
  history.replaceState(null, '', s ? `#${s}` : location.pathname);
}
function paramsFromHash() {
  const out = {};
  const h = location.hash.replace(/^#/, '');
  if (!h) return out;
  for (const kv of h.split('&')) {
    const [k, v] = kv.split('=');
    if (!(k in EARTH)) continue;
    out[k] = v === 'true' ? true : v === 'false' ? false : parseFloat(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Readout
function fmtTime(y) {
  if (y < 1e3) return `${y.toFixed(y < 10 ? 1 : 0)} yr`;
  if (y < 1e6) return `${(y / 1e3).toFixed(y < 1e5 ? 1 : 0)} kyr`;
  if (y < 1e9) return `${(y / 1e6).toFixed(y < 1e8 ? 1 : 0)} Myr`;
  return `${(y / 1e9).toFixed(2)} Gyr`;
}
function stat(k, v, cls = '') { return `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`; }

function updateReadout() {
  const w = sim.world, dg = w.diag, d = dg.d;
  const st = classify(w);

  const banner = $('#state-banner');
  banner.querySelector('.swatch').style.background = st.color;
  banner.querySelector('.swatch').style.color = st.color;
  banner.querySelector('.txt').textContent = st.name;
  banner.querySelector('.state-reason').textContent = reasonText(w, st);

  if (!discovered.has(st.id)) {
    discovered.add(st.id); saveDiscovered(discovered);
    if (markFound($('#statelog'), st.id)) toast(`New climate discovered — ${st.name}`, 4200);
    $('#found-count').textContent = String(discovered.size);
  }

  const lossGyr = (w.escape?.water ?? 0) * 1e9 / d.eoColumn;
  const rl = runawayLimit(dg.pCO2, dg.pN2 + dg.pCH4);
  const margin = rl.flux - dg.absorbed;

  $('#stats').innerHTML =
    stat('Mean surface', `${(dg.Tmean - 273.15).toFixed(1)}<small> °C</small>`) +
    stat('Range', `${(dg.Tmin - 273.15).toFixed(0)} → ${(dg.Tmax - 273.15).toFixed(0)}<small> °C</small>`) +
    stat('Ice cover', `${(dg.iceMean * 100).toFixed(0)}<small> %</small>`) +
    stat('Cloud cover', `${(dg.cloud.reduce((a, b) => a + b, 0) / NBANDS * 100).toFixed(0)}<small> %</small>`) +
    stat('Surface pressure', `${dg.pTotMean >= 1 ? dg.pTotMean.toFixed(2) : (dg.pTotMean * 1e3).toFixed(1)}<small> ${dg.pTotMean >= 1 ? 'bar' : 'mbar'}</small>`) +
    stat('CO₂', dg.pCO2 >= 0.01 ? `${dg.pCO2.toFixed(2)}<small> bar</small>` : `${(dg.pCO2 * 1e6).toFixed(0)}<small> ppm</small>`) +
    stat('Absorbed', `${dg.absorbed.toFixed(1)}<small> W/m²</small>`) +
    stat('Emitted', `${dg.emitted.toFixed(1)}<small> W/m²</small>`) +
    stat('Runaway margin', `${margin > 0 ? '+' : ''}${margin.toFixed(1)}<small> W/m²</small>`,
      margin < 0 ? 'bad' : margin < 15 ? 'warn' : '') +
    stat('Water left', `${(dg.totalWater).toFixed(dg.totalWater < 1 ? 3 : 2)}<small> EO</small>`,
      w.water.lost > 0.02 ? 'warn' : '') +
    stat('Water loss', lossGyr > 1e-4 ? `${lossGyr.toFixed(3)}<small> EO/Gyr</small>` : 'negligible',
      lossGyr > 0.05 ? 'bad' : lossGyr > 1e-3 ? 'warn' : '') +
    stat('Stratospheric H₂O', `${(w.escape?.fStrat ?? 0).toExponential(1)}`,
      (w.escape?.fStrat ?? 0) > 1e-3 ? 'bad' : '');

  $('#derived').innerHTML =
    `<div>gravity <b>${d.g.toFixed(2)} m/s²</b></div>` +
    `<div>radius <b>${(d.R / 6.371e6).toFixed(2)} R⊕</b></div>` +
    `<div>escape v <b>${(d.vesc / 1000).toFixed(1)} km/s</b></div>` +
    `<div>ocean <b>${(w.water.ocean * 2750).toFixed(0)} m</b></div>`;

  syncLiveControls();
  $('#simtime').textContent = fmtTime(w.time);

  // When the planet is in a stiff transition the integrator cannot keep up with
  // the requested acceleration. Say so, rather than letting it look frozen.
  const rateOut = $('#rate-out');
  const achieved = sim.actualRate / 0.1;   // readout runs ten times a second
  if (!sim.paused && !settling && sim.throttled && achieved < sim.rate * 0.5) {
    rateOut.textContent = `${fmtTime(Math.max(achieved, 0))} / s`;
    rateOut.classList.add('throttled');
    rateOut.title = 'The climate is changing too fast to skip over — the simulation is running as quickly as it accurately can.';
  } else {
    rateOut.textContent = `${fmtTime(sim.rate)} / s`;
    rateOut.classList.remove('throttled');
    rateOut.title = '';
  }

  // scenario progress
  if (activeScenario) {
    const el = $('#scenario-banner .sc-status');
    if (!scenarioResult) {
      if (activeScenario.fail && activeScenario.fail(w)) scenarioResult = 'lose';
      else if (activeScenario.check(w)) scenarioResult = 'win';
      else if (w.time > activeScenario.limit) scenarioResult = 'lose';
    }
    el.className = 'sc-status' + (scenarioResult ? ' ' + scenarioResult : '');
    if (scenarioResult === 'win') { el.textContent = `✓ Complete — ${fmtTime(w.time)} elapsed`; sim.paused = true; syncPlay(); }
    else if (scenarioResult === 'lose') { el.textContent = `✕ Failed — ${fmtTime(w.time)} elapsed. Reset to try again.`; }
    else el.textContent = `${fmtTime(w.time)} / ${fmtTime(activeScenario.limit)} — in progress`;
  }
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------------
// Controls
function syncPlay() {
  const b = $('#btn-play');
  b.textContent = sim.paused ? '▶  Play' : '❚❚  Pause';
  b.classList.toggle('paused', sim.paused);
  b.title = sim.paused ? 'Resume the simulation (space)' : 'Pause the simulation (space)';
}

function updateGfxButton() {
  const b = $('#btn-gfx');
  const on = view.wantTextures && view.texturesLoaded;
  b.textContent = on ? '🛰' : '◍';
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Surface: generated maps — click for procedural'
               : 'Surface: procedural — click for generated maps';
}

function bindControls() {
  $('#btn-play').addEventListener('click', () => { sim.paused = !sim.paused; syncPlay(); });
  $('#btn-reset').addEventListener('click', () => {
    renderState.seed = Math.random() * 100;
    sim.reset(params); scenarioResult = null; sim.paused = false; syncPlay();
  });
  $('#btn-settle').addEventListener('click', () => {
    if (settling) { settling = false; return; }   // click again to stop
    settling = true;
    settleRounds = 0;
    $('#btn-settle').classList.add('busy');
    $('#btn-settle').textContent = 'Stop';
  });

  const rate = $('#rate'), rateOut = $('#rate-out');
  const applyRate = () => {
    sim.rate = Math.pow(10, +rate.value);
    rateOut.textContent = `${fmtTime(sim.rate)} / s`;
    const lo = +rate.min, hi = +rate.max;
    rate.style.setProperty('--fill', `${((+rate.value - lo) / (hi - lo)) * 100}%`);
  };
  rate.addEventListener('input', applyRate); applyRate();

  bindPlanetDrag();

  $('#btn-spin').addEventListener('click', () => {
    view.spinPaused = !view.spinPaused;
    $('#btn-spin').setAttribute('aria-pressed', String(view.spinPaused));
    $('#btn-spin').title = view.spinPaused ? "Resume the planet's rotation" : "Pause the planet's rotation";
  });
  $('#btn-view').addEventListener('click', () => {
    view.yaw = 0; view.pitch = 0; view.spinVel = 0;
  });
  $('#btn-gfx').addEventListener('click', () => {
    if (!view.texturesLoaded) { toast('Surface maps are not available in this build'); return; }
    view.wantTextures = !view.wantTextures;
    updateGfxButton();
    toast(view.wantTextures ? 'Generated surface maps' : 'Procedural graphics');
  });

  $('#scenario-banner .sc-close').addEventListener('click', closeScenario);
  $('#mobile-toggle').addEventListener('click', () => {
    if (document.body.classList.contains('show-left')) {
      document.body.classList.remove('show-left'); document.body.classList.add('show-right');
    } else if (document.body.classList.contains('show-right')) {
      document.body.classList.remove('show-right');
    } else document.body.classList.add('show-left');
  });

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); sim.paused = !sim.paused; syncPlay(); }
    if (e.key === 'r') $('#btn-reset').click();
  });
}

// ---------------------------------------------------------------------------
// Main loop. Real elapsed time in, simulated years out; the physics itself
// never sees a frame.
// ---------------------------------------------------------------------------
// Grab the planet and turn it, with a mouse or a finger. Dragging orbits the
// camera, so the star and the terminator stay put and you simply look from
// somewhere else. Flick it and it keeps going, with a little friction.
// ---------------------------------------------------------------------------
function bindPlanetDrag() {
  const cv = $('#planet');
  let active = null, lastX = 0, lastY = 0, lastT = 0, moved = 0;

  cv.addEventListener('pointerdown', (e) => {
    active = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    lastT = performance.now(); moved = 0;
    view.spinVel = 0;
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('dragging');
  });

  cv.addEventListener('pointermove', (e) => {
    if (e.pointerId !== active) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    const k = 0.0075;
    view.yaw += dx * k;
    view.pitch = clamp(view.pitch + dy * k, -1.45, 1.45);   // keep the poles reachable, not flippable
    const now = performance.now();
    const dt = Math.max(now - lastT, 1) / 1000;
    view.spinVel = clamp((dx * k) / dt, -6, 6);
    lastT = now;
  });

  const end = (e) => {
    if (e.pointerId !== active) return;
    active = null;
    cv.classList.remove('dragging');
    if (moved < 3) view.spinVel = 0;   // a tap should not fling the planet
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  // A two-finger pinch is the browser's job, not ours; we only take single drags.
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
}

let settleRounds = 0;

// "Settle" fast-forwards to equilibrium, but a slice per frame rather than in
// one blocking burst -- otherwise a stiff planet locks the interface for
// seconds at a time. It stops when nothing is moving any more, or on a second
// click, or after a generous cap.
function advanceSettle() {
  const w = sim.world;
  const before = w.diag.Tmean;
  sim.runYears(Math.max(2000, w.time * 0.08 + 2000), 2e6, 26);
  sim.sample();
  settleRounds++;
  const quiet = Math.abs(w.diag.Tmean - before) < 0.01 && Math.abs(w.diag.imbalance) < 0.05;
  if (quiet || settleRounds > 4000) {
    settling = false;
    $('#btn-settle').classList.remove('busy');
    $('#btn-settle').textContent = 'Settle';
    toast(`Settled at ${fmtTime(w.time)}`);
  }
}

let last = performance.now(), chartClock = 0, reportedError = false;

// One frame's worth of work, given how much real time has passed. Split out so
// it can be driven deterministically from a test harness as well as by rAF.
function tick(dtReal) {
  renderState.time += dtReal;
  try {
    // let a flick coast to a stop
    if (view.spinVel) {
      view.yaw += view.spinVel * dtReal;
      view.spinVel *= Math.pow(0.06, dtReal);
      if (Math.abs(view.spinVel) < 0.02) view.spinVel = 0;
    }
    if (settling) advanceSettle();
    else sim.advance(dtReal);
    view.render(sim.world, renderState, dtReal);

    chartClock += dtReal;
    if (chartClock > 0.1) {
      chartClock = 0;
      updateReadout();
      drawHistory($('#chart-history'), sim.world);
      drawPhase($('#chart-phase'), sim.world);
      drawProfile($('#chart-profile'), sim.world);
      drawWater($('#chart-water'), sim.world);
    }
  } catch (err) {
    if (!reportedError) { reportedError = true; console.error('frame failed:', err); }
  }
}

function frame(now) {
  const dtReal = Math.min((now - last) / 1000, 0.25);
  last = now;
  tick(dtReal);
  start();
requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
buildSliders();
buildPresets();
buildScenarios();
syncSliders();
bindControls();
buildLogUI($('#statelog'), discovered, (id) => {
  $('#state-detail').innerHTML = discovered.has(id)
    ? `<strong style="color:${STATES[id].color}">${STATES[id].name}</strong><br>${STATES[id].blurb}`
    : 'Not yet discovered — build a world that reaches this state.';
});
$('#found-count').textContent = String(discovered.size);
$('#total-count').textContent = String(Object.keys(STATES).length);
if (Object.keys(paramsFromHash()).length === 0) setPresetActive('earth');
syncPlay();

async function start() {
  const ok = await view.init();
  if (!ok || view.failed) {
    $('#planet').insertAdjacentHTML('afterend',
      '<div style="position:absolute;inset:0;display:grid;place-items:center;color:#8e9ab5;padding:32px;text-align:center">' +
      'This browser could not start WebGL2, so the planet cannot be drawn.<br>The simulation and charts still work.</div>');
    return;
  }
  view.wantTextures = graphicsFromUrl();
  const btn = $('#btn-gfx');
  btn.disabled = true;
  btn.title = 'Loading surface maps…';
  const loaded = await view.loadTextures();
  btn.disabled = false;
  updateGfxButton();
  if (!loaded && view.wantTextures) {
    view.wantTextures = false;
    updateGfxButton();
    toast('Surface maps unavailable — using procedural graphics', 4000);
  }
}

// Handy from the console, and used by the browser self-test.
window.__app = { sim, view, tick, params, loadPreset, startScenario };

if (new URLSearchParams(location.search).has('selftest')) {
  import('./selftest.js').then((m) => m.run());
}

start();
requestAnimationFrame(frame);
