import { Simulation } from './sim/clock.js';
import { EARTH, PRESETS } from './game/presets.js';
import { SCENARIOS } from './game/scenarios.js';
import { classify, reasonText, STATES } from './physics/classify.js';
import { derive } from './physics/planet.js';
import { runawayLimit } from './physics/radiation.js';
import { NBANDS, lockFactor } from './physics/climate.js';
import { clamp } from './physics/constants.js';
import { PlanetView, MIN_ZOOM, MAX_ZOOM } from './render/planet.js';
import { SoftwareView } from './render/software.js';
import { drawHistory, drawProfile, drawWater, drawPhase } from './render/charts.js';
import { loadDiscovered, saveDiscovered, buildLogUI, markFound } from './game/log.js';
import { SLIDERS, parseValue, toSlider, fromSlider, snapToDisplay } from './game/controls.js';

const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------------------
// Slider definitions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const params = { ...EARTH, ...paramsFromHash() };
const sim = new Simulation(params);
// A do-nothing renderer until start() picks a real one. Creating a WebGL context
// here only to throw it away wasted one of the handful a browser will grant, and
// the frame loop is running before start() finishes either way.
function nullView() {
  return {
    failed: false, ready: false, software: false, api: null, quality: 'high',
    wantTextures: false, texturesLoaded: false,
    yaw: 0, pitch: 0, spin: 0, spinVel: 0, spinPaused: false,
    async init() { return false; }, async loadTextures() { return false; },
    render() {}, setQuality() {}, refreshAfterResume() {}, forgetGpuState() {},
    async restore() {},
  };
}
let view = nullView();
const renderState = { time: 0, seed: Math.random() * 100 };
const discovered = loadDiscovered();

// Surface style. Generated albedo maps are the default; ?graphics=procedural
// (or ?graphics=proc) selects the fully procedural look instead, and the button
// in the view controls switches between them at any time.
// Rendering detail. High everywhere by default; Low is a manual choice for
// hardware that still struggles, and it is remembered between visits.
const QUALITY_KEY = 'planetclimate.quality.v1';
const ATMO_KEY = 'planetclimate.atmosphere.v1';

// Stylised by default. A real atmosphere is a hairline -- Earth's is 0.7% of its
// radius -- and the whole point of the app is watching one change, so the
// exaggerated shell is a deliberate and useful diagram. The realistic mode is
// there for when you want to know what it would actually look like: a thin
// bright rim, and no seeing the ground through ninety bar of gas.
function atmosphereFromUrl() {
  const a = (new URLSearchParams(location.search).get('atmosphere') || '').toLowerCase();
  if (a === 'real' || a === 'realistic') return true;
  if (a === 'stylised' || a === 'stylized') return false;
  try { return localStorage.getItem(ATMO_KEY) === 'realistic'; } catch { return false; }
}

function updateAtmoButton() {
  const b = $('#btn-atmo');
  if (!b) return;
  const real = !!view.realistic;
  b.setAttribute('aria-pressed', String(real));
  b.textContent = real ? '◉' : '◍';
  b.title = real
    ? 'Atmosphere: realistic — true scale height, and an opaque one hides the ground'
    : 'Atmosphere: stylised — the shell is exaggerated so you can see it change';
}
function qualityFromUrl() {
  const q = (new URLSearchParams(location.search).get('quality') || '').toLowerCase();
  if (q === 'low') return 'low';
  if (q === 'high') return 'high';
  try { const v = localStorage.getItem(QUALITY_KEY); if (v === 'low' || v === 'high') return v; } catch { }
  return 'high';
}

// Which renderer to use. Software is chosen automatically when WebGL2 is
// missing, and can be chosen deliberately from the button or ?renderer=software
// — useful for seeing what someone else is getting.
// Why each renderer was rejected during start-up.
const rendererLog = [];

// Deliberately NOT remembered between visits. Forcing a lesser renderer is a
// diagnostic — for looking at what someone else's machine gets — and making it
// stick meant one curious click left the planet drawn on the CPU for good, hard
// refresh included. The URL parameter covers the case where someone really does
// want it every time.
function rendererFromUrl() {
  const r = (new URLSearchParams(location.search).get('renderer') || '').toLowerCase();
  if (r === 'software' || r === 'sw' || r === 'cpu') return 'software';
  if (r === 'webgl1' || r === 'gl1') return 'gl1';
  return 'gl2';
}

function updateRendererButton() {
  const b = $('#btn-renderer');
  if (!b) return;
  const sw = !!view.software;
  const api = sw ? 'CPU' : (view.api === 'WebGL1' ? 'GL1' : 'GL2');
  b.textContent = api;
  b.dataset.kind = sw ? 'software' : 'gpu';
  b.title = sw
    ? 'Drawn on the CPU — no WebGL needed. Click to try the GPU.'
    : `Drawn on the GPU via ${view.api}. Click to switch to software rendering.`;
}

// Swap renderer. A canvas keeps its context type for life, so the element
// itself has to be replaced rather than re-used.
async function useRenderer(kind) {
  const old = view;
  // Hand the old context back before taking another: a browser grants only a
  // handful, and cycling renderers would otherwise exhaust them.
  try { old.gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { }
  const canvas = $('#planet');
  const fresh = canvas.cloneNode(false);
  canvas.replaceWith(fresh);
  view = kind === 'software' ? new SoftwareView(fresh)
       : new PlanetView(fresh, kind === 'gl1' ? 'webgl1' : 'webgl2');
  // carry the viewpoint across so the swap is not disorienting
  view.yaw = old.yaw ?? 0; view.pitch = old.pitch ?? 0;
  view.spin = old.spin ?? 0; view.spinPaused = old.spinPaused ?? false;
  view.spinVel = old.spinVel ?? 0;
  view.zoom = old.zoom ?? 1;
  window.__app.view = view;
  const ok = await view.init();
  bindPlanetDrag();
  document.body.classList.toggle('software-render', !!view.software);
  if (ok && !view.software) {
    view.setQuality(qualityFromUrl());
    view.wantTextures = graphicsFromUrl();
    await view.loadTextures();
    updateGfxButton();
    $('#btn-gfx').disabled = !view.texturesLoaded;
  } else if (view.software) {
    view.setQuality(qualityFromUrl());
    $('#btn-gfx').disabled = true;
    $('#btn-gfx').title = 'Surface maps need WebGL2';
  }
  view.realistic = atmosphereFromUrl();
  updateRendererButton();
  updateQualityButton();
  updateAtmoButton();
  // From here on the view is live, so a later collapse — a driver that gives up
  // mid-session — has somewhere to report to. During start-up the loop below
  // handles failure itself, which is why this is wired only after init().
  view.onFatal = (why) => { recoverRenderer(why); };
  return ok;
}

// ---------------------------------------------------------------------------
// Recovery. A WebGL context can be taken away at any moment — switching apps on
// a tablet is the usual way — and the browser is supposed to hand it back. When
// it does not, the canvas is simply black for the rest of the visit, which is
// what people were seeing. A canvas cannot be given a second context, so the
// only way back is to build a fresh one; failing that, drop to the CPU.
// ---------------------------------------------------------------------------
let recovering = false, recoveries = 0;
async function recoverRenderer(why) {
  if (recovering) return;
  recovering = true;
  try {
    const wasSoftware = !!view.software;
    const kind = wasSoftware ? 'software' : (view.api === 'WebGL1' ? 'gl1' : 'gl2');
    // Rebuild the same renderer twice; if the GPU keeps dropping out, stop
    // fighting it and use the path that cannot be taken away.
    const next = (!wasSoftware && recoveries < 2) ? kind : 'software';
    recoveries++;
    console.warn(`renderer recovery after ${why} → ${next}`);
    let ok = await useRenderer(next);
    if ((!ok || view.failed) && next !== 'software') ok = await useRenderer('software');
    if (view.software) {
      toast('The GPU dropped out — drawing on the CPU instead. The simulation is unaffected.', 7000);
    }
  } finally {
    recovering = false;
  }
}

// The context has been gone this long, with the page in front of the user, before
// we stop waiting for the browser to make good on restoring it.
const LOST_GRACE_MS = 4000;

function checkRendererHealth() {
  if (recovering || view.software || view.failed) return;
  if (document.visibilityState !== 'visible') return;
  const lost = view.contextLost || (view.gl && view.gl.isContextLost());
  if (!lost) { view.lostSince = null; return; }
  if (view.lostSince == null) { view.lostSince = performance.now(); return; }
  if (performance.now() - view.lostSince > LOST_GRACE_MS) recoverRenderer('the context was never restored');
}

function graphicsFromUrl() {
  const q = (new URLSearchParams(location.search).get('graphics') || '').toLowerCase();
  if (q === 'procedural' || q === 'proc') return false;
  if (q === 'textured' || q === 'tex') return true;
  return true;   // default
}
let activeScenario = null, scenarioResult = null, settling = false, activePreset = 'earth';

// The world as it was handed to you. Reset restores exactly this, because the
// composition controls drift on their own as the simulation runs them and
// "reset" that kept the drifted values would not put anything back.
let initialParams = { ...params };
let initialSeed = renderState.seed;
function rememberStart() {
  initialParams = { ...params };
  initialSeed = renderState.seed;
}

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
      const v = snapToDisplay(d, fromSlider(d, +input.value));
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
  water: (w) => w.water.ocean + w.water.seaIce + w.water.landIce + w.water.vapour,
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
      const cur = w.water.ocean + w.water.seaIce + w.water.landIce + w.water.vapour;
      const target = Math.max(0, params.water);
      if (cur > 1e-9) {
        const f = target / cur;
        w.water.ocean *= f; w.water.seaIce *= f; w.water.landIce *= f; w.water.vapour *= f;
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
  rememberStart();
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
  rememberStart();
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
  // Keep the query string. It carries ?renderer= and ?quality=, and writing
  // location.pathname alone silently erased them the moment anything changed --
  // so a forced renderer never survived to the next reload.
  history.replaceState(null, '', `${location.pathname}${location.search}${s ? `#${s}` : ''}`);
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
    stat('Land / ocean', `${(dg.landFrac * 100).toFixed(0)}<small> %</small> / ${(dg.flooded * 100).toFixed(0)}<small> %</small>`,
      dg.landFrac > 0.98 && w.water.lost > 0.02 ? 'warn' : '') +
    stat('Sea ice / land ice', `${(dg.seaIceFrac * 100).toFixed(0)}<small> %</small> / ${(dg.landIceFrac * 100).toFixed(0)}<small> %</small>`) +
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

function updateQualityButton() {
  const b = $('#btn-quality');
  const low = view.quality === 'low';
  b.textContent = low ? '◇' : '◆';
  b.setAttribute('aria-pressed', String(low));
  b.title = low ? 'Detail: low — click for high' : 'Detail: high — click for low';
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
    // Same world, same starting parameters, clock back to zero -- including the
    // continents, so it really is the planet you began with.
    Object.assign(params, initialParams);
    renderState.seed = initialSeed;
    sim.reset(params);
    syncSliders();
    scenarioResult = null; settling = false; sim.paused = false; syncPlay();
    $('#btn-settle').classList.remove('busy'); $('#btn-settle').textContent = 'Settle';
    writeHash();
    toast('Reset to the starting world');
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
    view.yaw = 0; view.pitch = 0; view.spinVel = 0; view.zoom = 1;
    if (view.software) view.skyKey = '';
  });
  // Cycle through every renderer, so each can be seen on any machine.
  const RENDER_ORDER = ['gl2', 'gl1', 'software'];
  const LABELS = {
    gl2: 'WebGL2 — full detail',
    gl1: 'WebGL1 — the fallback for machines that refuse WebGL2, same shaders',
    software: 'Software — drawn on the CPU, no WebGL at all. Simulation unaffected.',
  };
  $('#btn-renderer').addEventListener('click', async () => {
    const b = $('#btn-renderer');
    const current = view.software ? 'software' : (view.api === 'WebGL1' ? 'gl1' : 'gl2');
    b.disabled = true;
    // Step through the list, skipping anything this machine cannot give us.
    let next = current, ok = false, skipped = [];
    for (let i = 1; i <= RENDER_ORDER.length; i++) {
      next = RENDER_ORDER[(RENDER_ORDER.indexOf(current) + i) % RENDER_ORDER.length];
      ok = await useRenderer(next);
      if (ok && !view.failed) break;
      skipped.push(`${next}: ${view.diagnostic || 'not available'}`);
    }
    if (skipped.length) console.warn('skipped renderers —', skipped.join(' · '));
    b.disabled = false;
    if (!ok || view.failed) {
      await useRenderer('software');
      toast('No GPU rendering available here — staying in software');
    } else {
      const why = skipped.length ? `  ·  skipped ${skipped[0]}` : '';
      toast(LABELS[next] + why + '  ·  reload returns to the best available');
    }
  });
  $('#btn-quality').addEventListener('click', () => {
    const next = view.quality === 'high' ? 'low' : 'high';
    view.setQuality(next);
    try { localStorage.setItem(QUALITY_KEY, next); } catch { }
    updateQualityButton();
    toast(next === 'low'
      ? 'Low detail — smaller render, no relief shading, simpler clouds'
      : 'High detail');
  });
  $('#btn-atmo').addEventListener('click', () => {
    view.realistic = !view.realistic;
    try { localStorage.setItem(ATMO_KEY, view.realistic ? 'realistic' : 'stylised'); } catch { }
    if (view.software) view.skyKey = '';      // the CPU path caches its sky
    updateAtmoButton();
    toast(view.realistic
      ? 'Realistic atmosphere — true scale height. Earth\u2019s air is 0.7% of its radius, and Venus shows only cloud tops.'
      : 'Stylised atmosphere — the shell is exaggerated so you can watch it change.', 6000);
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

  // Coming back from another app: the GPU context may have been thrown away
  // while we were gone, and the wall clock has run on without us.
  const resumed = () => {
    last = performance.now();       // do not bill the time spent away to the sim
    view.refreshAfterResume();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumed();
  });
  // Android Chromium can freeze a backgrounded page outright and bring it back
  // from the back/forward cache, where visibilitychange alone is not a reliable
  // signal that anything survived.
  addEventListener('pageshow', resumed);

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
  if (!cv || cv._dragBound) return;
  cv._dragBound = true;
  // Every pointer currently down, so a two-finger pinch can be told from a drag.
  const down = new Map();
  let lastX = 0, lastY = 0, lastT = 0, moved = 0, pinch = 0;

  const applyZoom = (factor, why) => {
    const before = view.zoom ?? 1;
    view.zoom = clamp(before * factor, MIN_ZOOM, MAX_ZOOM);
    if (view.software && view.zoom !== before) view.skyKey = '';   // the CPU path caches its sky
    if (why && (view.zoom === MIN_ZOOM || view.zoom === MAX_ZOOM) && view.zoom !== before) {
      toast(view.zoom === MIN_ZOOM ? 'As close as the view goes' : 'As far out as the view goes', 1400);
    }
  };

  const centre = () => {
    let x = 0, y = 0;
    for (const p of down.values()) { x += p.x; y += p.y; }
    return { x: x / down.size, y: y / down.size };
  };
  const spread = () => {
    const [a, b] = [...down.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  cv.addEventListener('pointerdown', (e) => {
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = centre();
    lastX = c.x; lastY = c.y;
    lastT = performance.now(); moved = 0;
    view.spinVel = 0;
    if (down.size === 2) pinch = spread();
    cv.setPointerCapture(e.pointerId);
    cv.classList.add('dragging');
  });

  cv.addEventListener('pointermove', (e) => {
    if (!down.has(e.pointerId)) return;
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers: pinch to zoom. The midpoint still drags, so you can move and
    // scale in one gesture the way every map does.
    if (down.size === 2) {
      const now = spread();
      if (pinch > 4 && now > 4) applyZoom(now / pinch);
      pinch = now;
    }

    const c = centre();
    const dx = c.x - lastX, dy = c.y - lastY;
    lastX = c.x; lastY = c.y;
    moved += Math.abs(dx) + Math.abs(dy);
    // Dragging should move the planet the same distance under the finger
    // whatever the zoom, so the sensitivity scales with how close you are.
    const k = 0.0075 * clamp(view.zoom ?? 1, MIN_ZOOM, MAX_ZOOM);
    view.yaw += dx * k;
    view.pitch = clamp(view.pitch + dy * k, -1.45, 1.45);   // keep the poles reachable, not flippable
    const now = performance.now();
    const dt = Math.max(now - lastT, 1) / 1000;
    if (down.size === 1) view.spinVel = clamp((dx * k) / dt, -6, 6);
    lastT = now;
  });

  const end = (e) => {
    if (!down.has(e.pointerId)) return;
    down.delete(e.pointerId);
    if (down.size === 0) {
      cv.classList.remove('dragging');
      if (moved < 3) view.spinVel = 0;   // a tap should not fling the planet
    } else {
      const c = centre();
      lastX = c.x; lastY = c.y;
      if (down.size === 2) pinch = spread();
    }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  // The wheel zooms. passive:false because the page must not scroll instead.
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Normalise the three deltaMode units so a trackpad and a mouse behave.
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    applyZoom(Math.exp(-clamp(px, -240, 240) * 0.0016), true);
  }, { passive: false });

  cv.addEventListener('dblclick', () => { view.zoom = 1; if (view.software) view.skyKey = ''; });
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

let healthClock = 0;

function frame(now) {
  // Clamped at both ends. A rAF timestamp is the start of the frame, which can
  // predate a performance.now() taken in the visibilitychange handler that just
  // fired -- and a negative delta would run the render clock backwards.
  const dtReal = Math.min(Math.max((now - last) / 1000, 0), 0.25);
  last = now;
  tick(dtReal);
  healthClock += dtReal;
  if (healthClock > 0.5) { healthClock = 0; try { checkRendererHealth(); } catch { } }
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

let started = false;
async function start() {
  if (started) return;
  started = true;

  // Try renderers in order, best first, stepping down past anything this
  // machine will not give us. A forced choice simply starts the list there.
  const wanted = rendererFromUrl();
  const order = wanted === 'software' ? ['software']
              : wanted === 'gl1' ? ['gl1', 'software']
              : ['gl2', 'gl1', 'software'];

  // Why each renderer was turned down, so a silent downgrade can be explained
  // rather than guessed at. Readable from the console as __app.rendererLog.
  rendererLog.length = 0;
  for (const kind of order) {
    const ok = await useRenderer(kind);
    if (ok && !view.failed) {
      if (kind !== 'gl2') {
        // Do not claim WebGL2 is missing when it was simply not asked for.
        const forced = wanted === kind;
        const why = rendererLog.length ? `  (${rendererLog[0].reason})` : '';
        toast(kind === 'software'
          ? `Software rendering — drawn on the CPU. The simulation is unaffected.${forced ? '' : why}`
          : forced
            ? 'WebGL1, as requested — the same shaders at full detail.'
            : `WebGL2 unavailable — drawing with WebGL1, at full detail.${why}`, 8000);
      }
      return;
    }
    rendererLog.push({ kind, reason: view.diagnostic || 'context refused by the browser' });
    console.warn(`renderer ${kind} unavailable: ${rendererLog[rendererLog.length - 1].reason}`);
  }

  $('#planet').insertAdjacentHTML('afterend',
    '<div style="position:absolute;inset:0;display:grid;place-items:center;color:#8e9ab5;padding:32px;text-align:center">' +
    'This browser could not draw the planet at all.<br>The simulation and charts still work.</div>');
}

// Handy from the console, and used by the browser self-test.
try { localStorage.removeItem('planetclimate.renderer.v1'); } catch { }

window.__app = {
  sim, view, tick, frame, params, loadPreset, startScenario, graphicsFromUrl, useRenderer,
  rendererLog,
  // Paste __app.diagnose() into the console to see what this machine offers.
  diagnose() {
    const probe = (kind) => {
      const c = document.createElement('canvas');
      const gl = c.getContext(kind);
      if (!gl) return { available: false };
      return {
        available: true,
        renderer: gl.getExtension('WEBGL_debug_renderer_info')
          ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        textureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        fragUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
        varyings: gl.getParameter(gl.MAX_VARYING_VECTORS),
        maxCubeSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
      };
    };
    return {
      active: view.software ? 'software' : view.api,
      rejected: rendererLog,
      webgl2: probe('webgl2'),
      webgl1: probe('webgl'),
    };
  },
};

if (new URLSearchParams(location.search).has('selftest')) {
  import('./selftest.js').then((m) => m.run());
}

start();
requestAnimationFrame(frame);
