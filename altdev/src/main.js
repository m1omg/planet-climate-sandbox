import { Simulation } from './sim/clock.js';
import { carbonBudget, FOSSIL_TOTAL } from './physics/volatiles.js';
import { EARTH, PRESETS } from './game/presets.js';
import { SCENARIOS } from './game/scenarios.js';
import { SLOTS, buildSaveFile, parseSaveFile, planImport } from './game/saves.js';
import { RESTORE_CAP, pushRestore, findRestore, truncateAfter } from './game/timeline.js';
import { captureWorld, applyWorld } from './game/snapshot.js';
import { classify, reasonText, STATES } from './physics/classify.js';
import { derive } from './physics/planet.js';
import { runawayLimit, iceFraction } from './physics/radiation.js';
import { NBANDS, lockFactor, X as BAND_X } from './physics/climate.js';
import { clamp } from './physics/constants.js';
import { PlanetView, MIN_ZOOM, MAX_ZOOM, BODY_MAPS } from './render/planet.js';
import { DEFAULT_PAN_SPEED, PAN_SPEEDS, wheelZoomFactor, panRadiansPerPixel } from './render/camera.js';
import { SoftwareView } from './render/software.js';
import { drawHistory, drawProfile, drawWater, drawPhase, historyTimeAtX, profileBandAtX } from './render/charts.js';
import { loadDiscovered, saveDiscovered, buildLogUI, markFound } from './game/log.js';
import { NS } from './game/storage.js';
import { SLIDERS, INTERIOR_BODIES, parseValue, toSlider, fromSlider, snapToDisplay } from './game/controls.js';
import { t, tp, tx, applyStatic, setLang, currentLang, nextLang, onLang, LANGS } from './game/i18n.js';

const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------------------
// Slider definitions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
// The `earth` preset, not the bare EARTH constant. They differ in one field:
// the preset has us on it. Booting from the constant meant a fresh load gave a
// planet that looked exactly like the Earth chip and quietly behaved like a
// pre-industrial one -- 427 ppm sitting still instead of climbing. The warming
// is real; hiding it in the default is worse than showing it.
const params = { ...PRESETS.earth.params, ...paramsFromHash() };
const sim = new Simulation(params);
// A do-nothing renderer until start() picks a real one. Creating a WebGL context
// here only to throw it away wasted one of the handful a browser will grant, and
// the frame loop is running before start() finishes either way.
function nullView() {
  return {
    failed: false, ready: false, software: false, api: null, quality: 'high',
    wantTextures: false, texturesLoaded: false,
    yaw: 0, pitch: 0, spin: 0, spinVel: 0, spinPaused: false, simPaused: false,
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
// The namespace every key in this build hangs off. See game/storage.js for
// what it is for and what happened without it.

// Rendering detail. High everywhere by default; Low is a manual choice for
// hardware that still struggles, and it is remembered between visits.
const QUALITY_KEY = `${NS}.quality.v1`;
const ATMO_KEY = `${NS}.atmosphere.v1`;
const PAN_KEY = `${NS}.panSpeed.v1`;
const CLOUD_KEY = `${NS}.showClouds.v1`;

function panSpeedPref() {
  try {
    const value = Number(localStorage.getItem(PAN_KEY));
    return PAN_SPEEDS.includes(value) ? value : DEFAULT_PAN_SPEED;
  } catch { return DEFAULT_PAN_SPEED; }
}
let panSpeed = panSpeedPref();

function updatePanSelect() {
  const select = $('#pan-speed');
  if (!select) return;
  select.value = String(panSpeed);
  select.title = t(`Panning speed: ${panSpeed}×`);
  select.setAttribute('aria-label', select.title);
}

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

// Whether Reset leaves the clock stopped. On by default: a reset is usually the
// start of setting something up, and at a year a second the first decades of a
// world you have not finished building are wasted ones. Remembered, because it
// is a working habit rather than a property of any particular planet.
// Fast physics, remembered between sessions the way the detail setting is.
//
// What it buys and what it costs are both written out on the button. The short
// version: it stops re-deriving the eighteen-band radiative state in the middle
// of a step, so the reservoirs -- weathering, escape, where the water is -- read
// the temperature the step started from rather than the one it ended at. Every
// rate in the step is then evaluated at one consistent state, which is a
// perfectly ordinary explicit scheme; the default is a mixed one that is a
// little more accurate and costs a whole extra radiative transfer.
//
// It is about 1.4x, it holds all 23 calibration anchors, and every world in
// tools/convergence.mjs still converges under it. It is not free: the answers
// move in the third or fourth digit, which is why it is a switch and not the
// default.
const FAST_KEY = `${NS}.fastPhysics.v1`;
const EASE_KEY = `${NS}.autoEase.v1`;
function easePref() {
  try { return localStorage.getItem(EASE_KEY) === 'on'; } catch { return false; }
}
function fastPref() {
  try { return localStorage.getItem(FAST_KEY) === 'on'; } catch { return false; }
}

const RESET_PAUSED_KEY = `${NS}.resetPaused.v1`;
function resetPausedPref() {
  try { return localStorage.getItem(RESET_PAUSED_KEY) !== 'run'; } catch { return true; }
}
let resetPaused = resetPausedPref();

function updateAtmoButton() {
  const b = $('#btn-atmo');
  if (!b) return;
  const real = !!view.realistic;
  b.setAttribute('aria-pressed', String(real));
  b.textContent = real ? '◉' : '◍';
  b.title = t(real
    ? 'Atmosphere: realistic — true scale height, and an opaque one hides the ground'
    : 'Atmosphere: stylised — the shell is exaggerated so you can see it change');
}
// Clouds off is a VIEW, not a climate. The deck still reflects its sunlight and
// still cools the planet -- the readout's cloud cover does not move and neither
// does the temperature. It is simply not drawn, so the surface underneath can
// be looked at: which continents are flooded, where the ice actually reaches,
// what a real body's map looks like without its own weather on top of it.
function updateCloudButton() {
  const b = $('#btn-clouds');
  if (!b) return;
  const on = view.showClouds !== false;
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? '\u2601' : '\u26f0';
  b.title = t(on
    ? 'Clouds: shown — click to see the surface underneath'
    : 'Clouds: hidden — a view only; they still cool the planet');
}
function cloudPref() {
  try { return localStorage.getItem(CLOUD_KEY) !== 'off'; } catch { return true; }
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
  view.simPaused = sim.paused;
  view.spinVel = old.spinVel ?? 0;
  view.zoom = old.zoom ?? 1;
  if (activeBody) view.setBody?.(activeBody);
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
    $('#btn-gfx').title = t('Surface maps need WebGL2');
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
let recovering = false, recoveries = 0, healthySince = null;
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
      toast(t('The GPU dropped out — drawing on the CPU instead. The simulation is unaffected.'), 7000);
    }
  } finally {
    recovering = false;
  }
}

// The context has been gone this long, with the page in front of the user, before
// we stop waiting for the browser to make good on restoring it.
const LOST_GRACE_MS = 4000;

// A GPU that has behaved for this long is not the flaky GPU the recovery
// counter is meant to give up on.
const HEALTHY_RESET_MS = 60000;

function checkRendererHealth() {
  if (recovering || view.software || view.failed) return;
  if (document.visibilityState !== 'visible') return;
  const lost = view.contextLost || (view.gl && view.gl.isContextLost());
  if (!lost) {
    view.lostSince = null;
    // `recoveries` used to count every loss for the whole visit, so the third
    // app switch of a session dropped to the CPU and stayed there no matter how
    // healthy the GPU was in between. Losing the context on suspend is normal
    // mobile behaviour, not evidence of a bad driver: once a rebuild has held
    // for a minute, forget it happened.
    healthySince = healthySince ?? performance.now();
    if (recoveries > 0 && performance.now() - healthySince > HEALTHY_RESET_MS) {
      recoveries = 0;
      console.warn('renderer healthy again; recovery counter reset');
    }
    return;
  }
  healthySince = null;
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
      ${d.note ? `<div class="ctl-note">${d.note}</div>` : ''}
      ${d.extra || ''}`;
    host.appendChild(wrap);
    const input = wrap.querySelector('input[type=range]'), out = wrap.querySelector('input.val');
    els[d.key] = { input, out, def: d, editing: false, dragging: false };

    // Values worth landing on exactly, as buttons.
    //
    // Every one of these sliders is logarithmic across four to nine decades,
    // because that is the only way one control can cover Mars's six millibars
    // and Venus's ninety-two bar. The cost is that a millimetre of thumb is a
    // factor of ten, and on a phone the difference between Earth's sunlight and
    // Venus's is a few pixels. So the values that mean something get a button
    // and the slider is left for what lies between them.
    //
    // Named for the world or the epoch rather than the number, because "Archean"
    // is what you are actually looking for when you reach for 0.1 bar of CO2.
    if (d.stops) {
      const row = document.createElement('div');
      row.className = 'ctl-stops';
      for (const st of d.stops) {
        const c = document.createElement('button');
        c.type = 'button'; c.className = 'stop';
        c.textContent = st.n;
        c.dataset.v = String(st.v);
        c.title = `${t(d.label)}: ${d.fmt(st.v)}`;
        c.addEventListener('click', () => {
          params[d.key] = st.v;
          syncSliders();
          applyParams(d.key);
          markTouched();
          toast(`${t(d.label)} — ${t(st.n)}, ${d.fmt(st.v)}`);
        });
        row.appendChild(c);
      }
      wrap.appendChild(row);
      els[d.key].stopRow = row;
    }

    // Real interiors, as one-click pairs. These set the heat *and* the
    // volcanism, because on an actual body the two are not independent -- see
    // INTERIOR_BODIES for where each number comes from and what `total` means.
    if (d.bodies) {
      const row = document.createElement('div');
      row.className = 'chip-row body-heat';
      for (const b of INTERIOR_BODIES) {
        const c = document.createElement('button');
        c.className = 'chip'; c.dataset.body = b.id;
        c.textContent = b.name;
        const heat = b.heat < 1 ? `${(b.heat * 1e3).toFixed(0)} mW/m²` : `${b.heat} W/m²`;
        const volc = b.total === 0 ? t('no carbon outgassing')
          : tp('{0}× Earth’s outgassing',
               b.total < 1 ? b.total : b.total.toFixed(b.total < 10 ? 1 : 0));
        c.title = `${heat} · ${volc}\n${t(b.note)}`;
        c.addEventListener('click', () => {
          params.internalHeat = b.heat;
          params.outgassing = b.outgassing;
          syncSliders();
          applyParams('internalHeat');
          applyParams('outgassing');
          markBody();
          toast(`${t(b.name)} — ${heat}, ${volc}`);
        });
        row.appendChild(c);
      }
      wrap.appendChild(row);
      els._bodyRow = row;
    }

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
  const wrap = document.createElement('div');
  wrap.className = 'toggle';
  wrap.innerHTML = `<label for="lock">Tidally locked</label>
    <button id="lock" class="switch" role="switch" aria-pressed="false"></button>`;
  host.appendChild(wrap);
  const btn = wrap.querySelector('#lock');
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
    toast(tp('{0} limited to {1}', t(d.label), d.fmt(clamped)));
  }
  applyParams(d.key);
}

// Which interior preset, if any, the two controls are currently sitting on.
// Both have to match: half of a pair is not that body.
function markBody() {
  if (!els._bodyRow) return;
  const near = (a, b) => Math.abs(a - b) <= Math.abs(b) * 1e-6 + 1e-12;
  for (const c of els._bodyRow.children) {
    const b = INTERIOR_BODIES.find((x) => x.id === c.dataset.body);
    c.classList.toggle('active',
      !!b && near(params.internalHeat ?? 0, b.heat) && near(params.outgassing ?? 0, b.outgassing));
  }
}

// Light up whichever stop the control is currently sitting on.
//
// Compared as a fraction rather than as a difference, because these span nine
// decades: an absolute tolerance that suits 92 bar of CO2 would light up every
// stop below a millibar at once. A tenth of a percent is tight enough that two
// neighbouring stops can never both match and loose enough to survive a value
// that has been through a slider position and back.
function markStops(d) {
  const row = els[d.key]?.stopRow;
  if (!row) return;
  const v = params[d.key];
  for (const b of row.children) {
    const stopV = +b.dataset.v;
    b.classList.toggle('active',
      stopV === 0 ? Math.abs(v) < 1e-12 : Math.abs(v - stopV) <= Math.abs(stopV) * 1e-3);
  }
}

function syncSliders() {
  for (const d of SLIDERS) {
    const e = els[d.key];
    const s = clamp(toSlider(d, params[d.key]), 0, 1000);
    e.input.value = String(s);
    e.input.style.setProperty('--fill', `${s / 10}%`);
    e.out.value = d.fmt(params[d.key]);
    markStops(d);
  }
  els._lock.setAttribute('aria-pressed', String(!!params.tidallyLocked));
  // The two evolution modes are checkboxes rather than sliders, so they are not
  // covered by the loop above and have to be put back by hand -- on load, on a
  // preset, and on anything restored from a slot or from the world's own past.
  const br = $('#chk-brightening'); if (br) br.checked = params.brightening > 0;
  const gl = $('#chk-geology'); if (gl) gl.checked = !!params.realisticGeology;
  const sm = $('#chk-smooth-sun'); if (sm) sm.checked = !!params.smoothInsolation;
  const rs = $('#chk-resurface'); if (rs) rs.checked = params.resurfacingAge > 0 && params.resurfacingBoost > 1;
  markBody();
}

// Reading the live value of a control the simulation evolves on its own.
const LIVE_READERS = {
  co2: (w) => w.co2 * w.diag.g / 1e5,
  n2: (w) => w.n2 * w.diag.g / 1e5,
  o2: (w) => w.o2 * w.diag.g / 1e5,
  ch4: (w) => w.ch4 * w.diag.g / 1e5,
  water: (w) => w.water.ocean + w.water.seaIce + w.water.landIce + w.water.vapour,
  // Not reservoirs, but evolved by the clock all the same when their modes are
  // on. With the modes off these return the value the control already holds and
  // the guard below skips them, so they cost nothing.
  // While a smooth change is walking, the control shows where you asked the
  // star to go, not where it has got to. Reading the current value here put the
  // handle back where it started the moment the readout refreshed -- drag it to
  // 2 S(+) with smoothing on and it snapped to 1 and looked broken, while the
  // star was in fact walking there perfectly well underneath. Where the star
  // actually is has its own readout in the diagnostics.
  insolation: (w) => w.insolationTarget ?? w.params.insolation,
  internalHeat: (w) => w.params.internalHeat,
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
    markStops(d);
  }
}

// Changing a *composition* slider rewrites the reservoir; changing an external
// forcing just changes the forcing and lets the planet respond.
const RESERVOIR_KEYS = new Set(['n2Bar', 'o2Bar', 'co2Bar', 'ch4Bar', 'water', 'mass']);
function applyParams(key) {
  const w = sim.world;
  sim.setParams({ [key]: params[key] });
  if (RESERVOIR_KEYS.has(key)) {
    const d = derive(w.params);
    if (key === 'n2Bar') w.n2 = params.n2Bar * 1e5 / d.g;
    if (key === 'o2Bar') w.o2 = params.o2Bar * 1e5 / d.g;
    if (key === 'co2Bar') { w.co2 = params.co2Bar * 1e5 / d.g; w.co2Frozen = 0; }
    if (key === 'ch4Bar') w.ch4 = params.ch4Bar * 1e5 / d.g;
    if (key === 'mass') {
      w.n2 = params.n2Bar * 1e5 / d.g; w.co2 = params.co2Bar * 1e5 / d.g;
      w.o2 = params.o2Bar * 1e5 / d.g;
      w.ch4 = params.ch4Bar * 1e5 / d.g;
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
  markBody();
  markTouched();
  writeHash();
}

// ---------------------------------------------------------------------------
function buildPresets() {
  const host = $('#presets');
  host.innerHTML = '';
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.preset = id;
    b.innerHTML = `<span>${p.icon}</span>${tx('presets', id) || p.name}`;
    b.addEventListener('click', () => loadPreset(id));
    host.appendChild(b);
  }
}
function setPresetActive(id) {
  activePreset = id;
  document.querySelectorAll('[data-preset]').forEach((b) =>
    b.classList.toggle('active', b.dataset.preset === id));
}

// ---------------------------------------------------------------------------
// What this world is called.
//
// Null means "whatever the preset is called", so loading Venus shows Venus in
// the slots without anyone having typed anything, and a world built from
// nothing is a Custom world. Type into the field and the name sticks to the
// world instead: it goes into the slot, into the export file, and into the line
// that says which world you just loaded. Loading a preset hands the naming back
// to the preset, because that is a different planet.
let worldName = null;
function currentName() {
  const typed = (worldName ?? '').trim();
  return typed || PRESETS[activePreset]?.name || 'Custom world';
}
function setWorldName(v, { toField = true } = {}) {
  worldName = v == null ? null : String(v).slice(0, 40);
  const el = $('#world-name');
  if (el && toField) el.value = worldName ?? '';
  if (el) el.placeholder = PRESETS[activePreset]?.name || 'Custom world';
  syncSlots();
}
// Which real world, if any, this preset is. Geography is not a function of
// climate: warming Earth does not move its continents, so the map stays put
// while every slider is dragged and only changes when you load a different
// world. That is why nothing has to cross-fade as the climate runs.
let activeBody = null;
function applyBody(id) {
  const want = id && BODY_MAPS[id] ? id : null;
  if (want === activeBody) return;
  activeBody = want;
  view.setBody?.(want);
}

function loadPreset(id) {
  Object.assign(params, PRESETS[id].params);
  // A real world keeps its own geography; only invented ones get a new seed.
  if (!BODY_MAPS[id]) renderState.seed = Math.random() * 100;
  sim.reset(params);
  applyBody(id);
  syncSliders(); setPresetActive(id); setWorldName(null); writeHash();
  markTouched();
  rememberStart();
  closeScenario();
  const pname = tx('presets', id) || PRESETS[id].name;
  toast(BODY_MAPS[id] && view.bodyCapable
    ? `${PRESETS[id].icon} ${pname} — ${t('real surface map')}`
    : `${PRESETS[id].icon} ${pname}`);
}

function buildScenarios() {
  const host = $('#scenarios');
  host.innerHTML = '';
  for (const s of SCENARIOS) {
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.scenario = s.id;
    const nm = tx('scenarios', s.id, 'name') || s.name;
    const br = tx('scenarios', s.id, 'brief') || s.brief;
    b.innerHTML = `<span>${s.icon}</span><span><b>${nm}</b><span>${br.slice(0, 78)}…</span></span>`;
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
  rememberStart(); markTouched();
  document.querySelectorAll('[data-scenario]').forEach((b) => b.classList.toggle('active', b.dataset.scenario === id));
  const banner = $('#scenario-banner');
  banner.hidden = false;
  banner.querySelector('.sc-icon').textContent = s.icon;
  banner.querySelector('.sc-name').textContent = tx('scenarios', s.id, 'name') || s.name;
  banner.querySelector('.sc-brief').textContent = tx('scenarios', s.id, 'brief') || s.brief;
  toast(`${s.icon} ${tx('scenarios', s.id, 'name') || s.name} — ` +
    `${tx('scenarios', s.id, 'hint') || s.hint}`, 7000);
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
  // The starlight control holds the *destination* while a smooth change is
  // walking, which is right for the handle and wrong for the URL: the address
  // bar is meant to be the world you are looking at, and writing the target
  // there meant a reload arrived at the far end instantly. Someone who dragged
  // to 100 S(+) with smoothing on, watched the star begin its walk, and then
  // reloaded came back to a planet already at sixteen times Earth's sunlight --
  // with the smoothing that was supposed to prevent exactly that jump switched
  // on the whole time. What the world actually has is what gets shared.
  if ('insolation' in keep) keep.insolation = sim.world.params.insolation;
  if (keep.insolation === EARTH.insolation) delete keep.insolation;
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
// Splitting a rate into a number and a unit, so the field can hold "250" and
// the menu beside it "Myr / s". The unit is the largest that leaves a number at
// least 1, which is how anyone would say it out loud. Module scope rather than
// inside the setup closure because the ten-a-second readout writes through it
// too -- it lived in the closure for one commit and the frame loop threw.
const RATE_UNIT_STEPS = [[1e9, 'Gyr'], [1e6, 'Myr'], [1e3, 'kyr'], [1, 'yr']];
function splitRate(v) {
  const [mult] = RATE_UNIT_STEPS.find(([m]) => v >= m) || [1];
  const n = v / mult;
  // Enough digits to be exact where it matters and no trailing noise: 250, 1.5,
  // 2.5 and 12.5 all print as themselves.
  const dp = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return { mult, n: parseFloat(n.toFixed(dp)) };
}
function showRate(v) {
  const out = $('#rate-out'), unit = $('#rate-unit');
  if (!out || !unit) return;
  const { mult, n } = splitRate(v);
  out.value = String(n);
  unit.value = String(mult);
}

function fmtTime(y) {
  if (y < 1e3) return `${y.toFixed(y < 10 ? 1 : 0)} yr`;
  if (y < 1e6) return `${(y / 1e3).toFixed(y < 1e5 ? 1 : 0)} kyr`;
  if (y < 1e9) return `${(y / 1e6).toFixed(y < 1e8 ? 1 : 0)} Myr`;
  return `${(y / 1e9).toFixed(2)} Gyr`;
}
// What the air is made of, by volume -- which for an ideal gas is just the
// partial pressures over the total. Water vapour is in it, because on a warm
// world it stops being a trace gas and becomes most of the atmosphere, and a
// composition readout that hid that would be misleading exactly where it
// matters most.
function composition(dg) {
  const pH2O = dg.pH2O.reduce((a, b) => a + b, 0) / dg.pH2O.length;
  const parts = [
    // The background reservoir is every gas that neither condenses nor absorbs
    // much -- nitrogen, oxygen and argon together -- so it is labelled for what
    // it is rather than pretending Earth's is pure nitrogen.
    ['N₂', dg.pN2, '#7f9ccc', t('nitrogen and argon: the gas that neither condenses nor absorbs')],
    ['CO₂', dg.pCO2, '#e0894a', t('carbon dioxide')],
    ['H₂O', pH2O * (1 - (dg.superFrac || 0)), '#4fa8d8', t('water vapour')],
    ['H₂O·sc', pH2O * (dg.superFrac || 0), '#c98ad0', t('water past its critical point: neither liquid nor gas')],
    ['O₂', dg.pO2, '#6fc7a0', t('free oxygen: made by life, or left behind when a lost ocean\u2019s hydrogen escaped')],
    ['CH₄', dg.pCH4, '#c9b04a', t('methane')],
  ];
  const total = parts.reduce((a, p) => a + Math.max(p[1], 0), 0);
  if (!(total > 0)) return `<span class="comp-none">${t('no atmosphere')}</span>`;

  // A share as a percentage, kept honest at the small end: 0.04% CO₂ is the
  // whole of the modern greenhouse and rounding it to 0% would be absurd.
  const pct = (f) => {
    const v = f * 100;
    if (v >= 99.95) return '100';
    if (v >= 10) return v.toFixed(0);
    if (v >= 1) return v.toFixed(1);
    if (v >= 0.01) return v.toFixed(2);
    if (v > 0) return v.toExponential(0).replace('e-', '\u00d710⁻');
    return '0';
  };
  const shown = parts.map(([n, p, c, t]) => ({ n, c, t, f: Math.max(p, 0) / total }))
                     .filter((e) => e.f >= 1e-6)
                     .sort((a, b) => b.f - a.f);
  const bar = shown.filter((e) => e.f > 0.004)
    .map((e) => `<i style="width:${(e.f * 100).toFixed(2)}%;background:${e.c}"></i>`).join('');
  const text = shown.map((e) =>
    `<span title="${e.t}"><b style="color:${e.c}">${e.n}</b> ${pct(e.f)}%</span>`).join('');
  return `<div class="comp-bar">${bar}</div><div class="comp-list">${text}</div>`;
}

// The two populations, as bars, because the interesting thing about them is the
// ratio and not either number. `room` is what the climate could support and the
// filled part is what is actually there, so a world that has just become
// habitable shows the gap it has yet to close -- which on the eukaryote line is
// most of a billion years wide.
function lifeText(w) {
  const L = w.life || { pro: 0, euk: 0 };
  const room = w.lifeRoom || { pro: 0, euk: 0 };
  const row = (label, have, could, colour, title) => {
    const pct = have <= 0 ? t('none')
      : have < 0.01 ? t('traces')
      : tp('{0}% of the surface', (have * 100).toFixed(0));
    const behind = could - have > 0.02 && have < 0.995
      ? `<i class="life-room" style="width:${(could * 100).toFixed(1)}%"></i>` : '';
    return `<div class="life-row" title="${title}">` +
      `<span class="life-k">${label}</span>` +
      `<span class="life-bar">${behind}` +
      `<i class="life-fill" style="width:${(Math.max(have, 0) * 100).toFixed(1)}%;background:${colour}"></i>` +
      `</span><span class="life-v">${pct}</span></div>`;
  };
  return row(t('prokaryotes'), L.pro, room.pro, '#6fc7a0',
      t('Cells without a nucleus. Liquid water and an electron donor is the whole requirement: −20 °C to 122 °C, no oxygen needed, no light needed.')) +
    row(t('eukaryotes'), L.euk, room.euk, '#c9a0e0',
      t('Cells with a nucleus and mitochondria, so: aerobes. They need free oxygen — a percent or so of Earth\u2019s is enough — and they give out around 60 °C, far short of what a bacterium will take.'));
}

// `tip` exists because a 136px tile cannot hold every language's name for a
// quantity. The label is what fits; the tooltip is what it means.
function stat(k, v, cls = '', tip = '') {
  const title = tip ? ` title="${tip.replace(/"/g, '&quot;')}"` : '';
  return `<div class="stat ${cls}"${title}><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

function updateReadout() {
  const w = sim.world, dg = w.diag, d = dg.d;
  const st = classify(w);

  const banner = $('#state-banner');
  banner.querySelector('.swatch').style.background = st.color;
  banner.querySelector('.swatch').style.color = st.color;
  banner.querySelector('.txt').textContent = tx('states', st.id, 'name') || st.name;
  banner.querySelector('.state-reason').textContent = reasonText(w, st, tp);

  if (!discovered.has(st.id)) {
    discovered.add(st.id); saveDiscovered(discovered);
    if (markFound($('#statelog'), st.id)) {
      toast(tp('New climate discovered — {0}', tx('states', st.id, 'name') || st.name), 4200);
    }
    $('#found-count').textContent = String(discovered.size);
  }

  const lossGyr = (w.escape?.water ?? 0) * 1e9 / d.eoColumn;
  const rl = runawayLimit(dg.pCO2, dg.pN2 + dg.pCH4);
  // Sunlight *and* the planet's own heat. A tidally heated world can be past the
  // Simpson-Nakajima limit on its interior alone, and a margin computed from
  // insolation would read comfortable while the ocean boiled.
  const margin = rl.flux - (dg.absorbed + dg.Fint);

  $('#stats').innerHTML =
    stat(t('Mean surface'), `${(dg.Tmean - 273.15).toFixed(1)}<small> °C</small>`) +
    // On a locked world the mean is a number no part of the planet has. It sits
    // between a day side that never sets and a night side that never sees the
    // star, and on TRAPPIST-1b those are 237 °C and −186 °C -- so a mean of
    // −1.5 °C reads as temperate and describes nowhere. Day and night side get
    // their own readouts there, and Range keeps its place on a rotating world
    // where it means the pole-to-equator spread instead.
    //
    // Both are the four-band averages classify() already uses to decide between
    // eyeball, lobster and twilight states, so the readout and the label cannot
    // disagree about which side is which.
    (dg.lam > 0.5
      ? stat(t('Day side'), `${(st.Tsub - 273.15).toFixed(0)}<small> °C</small>`) +
        stat(t('Night side'), `${(st.Tanti - 273.15).toFixed(0)}<small> °C</small>`,
          st.Tanti < 195 && dg.pCO2 > 0 ? 'warn' : '')
      : stat(t('Range'), `${(dg.Tmin - 273.15).toFixed(0)} → ${(dg.Tmax - 273.15).toFixed(0)}<small> °C</small>`)) +
    // "Ocean" is the basin, ice included, which is right for Earth -- the poles
    // are frozen and it is still the sea. Below the triple point it is not: no
    // liquid water exists at any temperature under 611.7 Pa, so what is down
    // there is an ice field and calling it ocean is the one thing the phase
    // limit is in the model to rule out.
    stat((dg.liquidAllowed ?? 1) < 0.5 ? t('Land / ice') : t('Land / ocean'),
      `${(dg.landFrac * 100).toFixed(0)}<small> %</small> / ${(dg.flooded * 100).toFixed(0)}<small> %</small>`,
      dg.landFrac > 0.98 && w.water.lost > 0.02 ? 'warn' : '') +
    stat(t('Sea ice / land ice'), `${(dg.seaIceFrac * 100).toFixed(0)}<small> %</small> / ${(dg.landIceFrac * 100).toFixed(0)}<small> %</small>`) +
    // iceArea, not iceMean. They are two different questions and this label is
    // the second one: iceMean is how much of the surface is BELOW FREEZING,
    // iceArea is how much of it is actually under ice. On Mars those are 100%
    // and 1.9%, and the honest one -- which was already being computed one line
    // below the other and shown to nobody -- is the one that matches the caps
    // the planet really has, about a percent of its surface.
    stat(t('Ice cover'), `${(dg.iceArea * 100).toFixed(dg.iceArea < 0.1 ? 1 : 0)}<small> %</small>`) +
    stat(t('Cloud cover'), `${(dg.cloud.reduce((a, b) => a + b, 0) / NBANDS * 100).toFixed(0)}<small> %</small>`) +
    stat(t('Surface pressure'), `${dg.pTotMean >= 1 ? dg.pTotMean.toFixed(2) : (dg.pTotMean * 1e3).toFixed(1)}<small> ${dg.pTotMean >= 1 ? 'bar' : 'mbar'}</small>`) +
    stat(t('CO₂'), dg.pCO2 >= 0.01 ? `${dg.pCO2.toFixed(2)}<small> bar</small>` : `${(dg.pCO2 * 1e6).toFixed(0)}<small> ppm</small>`) +
    stat(t('Composition'), composition(dg), 'wide') +
    // What is left in the mantle and crust. Worth showing once a world has
    // started seriously outgassing -- it is what stops the CO2.
    (w.carbonDeep != null && w.carbonDeep < 0.97 * carbonBudget(w.params.mass)
      ? stat(t('Carbon left below'),
          `${(w.carbonDeep / carbonBudget(w.params.mass) * 100).toFixed(0)}<small> %</small>`,
          w.carbonDeep < 0.02 * carbonBudget(w.params.mass) ? 'warn' : '')
      : '') +
    // Only worth the line while there is anyone burning anything.
    // `w.fossil` is null until the first step has run, and reading it raw showed
    // a brand-new world as "exhausted" -- null fails every > comparison. The
    // reserve it is about to be given is what should be shown.
    (() => {
      const start = FOSSIL_TOTAL * (1 - (w.params.fossilUsed ?? 0));
      const left = w.fossil ?? start;
      if (w.params.fossilInfinite) return stat(t('Fossil carbon left'), 'unlimited', 'warn');
      if (!((w.params.emissions ?? 0) > 0 || left < FOSSIL_TOTAL - 1e-6)) return '';
      return stat(t('Fossil carbon left'),
        left > 1e-6 ? `${(left / FOSSIL_TOTAL * 100).toFixed(0)}<small> %</small>` : 'exhausted',
        left <= 1e-6 ? 'warn' : '');
    })() +
    // Where the star actually is. Only worth a line when it is not where the
    // control says -- which is exactly while a smooth change is walking, and is
    // the thing that made the control look broken when nothing showed it.
    (w.insolationTarget != null
      ? stat(t('Starlight now'), `${w.params.insolation.toFixed(3)}<small> → ${(+w.insolationTarget.toPrecision(4))} S⊕</small>`, 'warn')
      : '') +
    // How old this planet is, which is the age at start plus however far the
    // clock has run. Worth its own line whenever anything is keyed to it: the
    // radiogenic curve, the dynamo, and above all the resurfacing event, whose
    // control is set in ages and not in elapsed time.
    ((w.params.realisticGeology || w.params.resurfacingAge > 0
      || (w.params.startAge ?? 4.567) !== 4.567)
      ? stat(t('Planet age'), `${((w.params.startAge ?? 4.567) + w.time / 1e9).toFixed(3)}<small> Gyr</small>`)
      : '') +
    // Who lives here. Only shown once there is something to say -- a bare rock
    // does not need a line telling it that it is sterile.
    ((w.life && (w.life.pro > 1e-3 || w.lifeRoom?.pro > 1e-3))
      ? stat(t('Life'), lifeText(w), 'wide')
      : '') +
    stat(t('Absorbed'), `${dg.absorbed.toFixed(1)}<small> W/m²</small>`) +
    stat(t('Emitted'), `${dg.emitted.toFixed(1)}<small> W/m²</small>`) +
    // Shown against Earth's, because the absolute number means little on its
    // own: 2 W/m2 sounds negligible next to 240 of sunlight and is twenty times
    // Earth's interior, enough to keep Io permanently molten.
    stat(t('Internal heat'), (() => {
      const f = dg.Fint, rel = f / 0.092;
      const mag = f <= 0 ? 'none'
        : f >= 1 ? `${f.toFixed(f < 10 ? 2 : 0)}<small> W/m²</small>`
        : `${(f * 1e3).toFixed(f * 1e3 < 10 ? 1 : 0)}<small> mW/m²</small>`;
      if (f <= 0) return mag;
      return `${mag}<small> · ${rel < 10 ? rel.toFixed(1) : rel.toFixed(0)}× Earth</small>`;
    })(), dg.Fint > 20 ? 'warn' : '') +
    stat(t('Runaway margin'), `${margin > 0 ? '+' : ''}${margin.toFixed(1)}<small> W/m²</small>`,
      margin < 0 ? 'bad' : margin < 15 ? 'warn' : '',
      t('How far below the Simpson–Nakajima limit this world is running. Past it, no temperature balances and the runaway greenhouse begins.')) +
    stat(t('Water left'), `${(dg.totalWater).toFixed(dg.totalWater < 1 ? 3 : 2)}<small> EO</small>`,
      w.water.lost > 0.02 ? 'warn' : '') +
    stat(t('Water loss'), lossGyr > 1e-4 ? `${lossGyr.toFixed(3)}<small> EO/Gyr</small>` : t('negligible'),
      lossGyr > 0.05 ? 'bad' : lossGyr > 1e-3 ? 'warn' : '') +
    stat(t('Stratospheric H₂O'), `${(w.escape?.fStrat ?? 0).toExponential(1)}`,
      (w.escape?.fStrat ?? 0) > 1e-3 ? 'bad' : '');

  $('#derived').innerHTML =
    `<div>gravity <b>${d.g.toFixed(2)} m/s²</b></div>` +
    `<div>radius <b>${(d.R / 6.371e6).toFixed(2)} R⊕</b></div>` +
    `<div>escape v <b>${(d.vesc / 1000).toFixed(1)} km/s</b></div>` +
    `<div>ocean <b>${(w.water.ocean * 2750).toFixed(0)} m</b></div>`;

  syncLiveControls();
  $('#simtime').textContent = fmtTime(w.time);
  syncClocks(w);

  // When the planet is in a stiff transition the integrator cannot keep up with
  // the requested acceleration. Say so, rather than letting it look frozen.
  const rateOut = $('#rate-out');
  const achieved = sim.actualRate / 0.1;   // readout runs ten times a second
  // It is a text field now, so it is written to with `value` -- and never while
  // it has the caret in it, because overwriting what someone is halfway through
  // typing ten times a second makes it impossible to type at all.
  const typeAhead = t('Type a rate: 500 yr, 2 Myr, 1.5 Gyr. Per second is assumed.');
  if (rateOut.editing) {
    /* leave it alone */
  } else if (!sim.paused && !settling && sim.autoEase && sim.easeFactor < 0.9) {
    // Auto-ease is deliberately holding the clock back. Show what the world is
    // actually advancing at, not what was asked for -- a field reading
    // "10 Myr / s" while the planet crawls through a tipping is the readout
    // lying about the one moment the player is watching most closely.
    showRate(Math.max(achieved, 0));
    rateOut.classList.add('eased');
    rateOut.classList.remove('throttled');
    rateOut.title = tp('Auto-ease is holding the clock back so this tipping can be watched — '
      + '{0} / s was asked for. Turn off "ease" to run at full speed.', fmtTime(sim.rate));
  } else if (!sim.paused && !settling && sim.throttled && achieved < sim.rate * 0.5) {
    showRate(Math.max(achieved, 0));
    rateOut.classList.remove('eased');
    rateOut.classList.add('throttled');
    rateOut.title = t('The climate is changing too fast to skip over — the simulation is running as quickly as it accurately can.');
  } else {
    showRate(sim.rate);
    rateOut.classList.remove('throttled');
    rateOut.classList.remove('eased');
    rateOut.title = typeAhead;
  }

  // Say when the ease is actually holding the clock back, rather than only that
  // it is armed -- otherwise a slow patch looks like the simulation stalling.
  const slowBtn = $('#btn-slow');
  if (slowBtn) slowBtn.classList.toggle('easing',
    !!sim.autoEase && !sim.paused && sim.easeFactor < 0.9);

  syncFossil();
  syncMantle();
  syncBio();

  // scenario progress
  if (activeScenario) {
    // Some scenarios move a control on their own. The Great Oxidation is one:
    // the cyanobacteria are not waiting for permission, and a player who does
    // nothing has to watch it happen rather than being left with a stable world.
    // Driven off simulated time so the rate does not depend on the frame rate or
    // on how fast the clock is running.
    if (activeScenario.evolve && !scenarioResult) {
      const e = els.biosphere;
      if (!e.editing && !e.dragging) {
        const v = activeScenario.evolve(w);
        if (Math.abs(v - params.biosphere) > 1e-4) {
          params.biosphere = v;
          applyParams('biosphere');
          const pos = clamp(toSlider(e.def, v), 0, 1000);
          e.input.value = String(pos);
          e.input.style.setProperty('--fill', `${pos / 10}%`);
          e.out.value = e.def.fmt(v);
        }
      }
    }
    const el = $('#scenario-banner .sc-status');
    if (!scenarioResult) {
      if (activeScenario.fail && activeScenario.fail(w)) scenarioResult = 'lose';
      else if (activeScenario.check(w)) scenarioResult = 'win';
      else if (w.time > activeScenario.limit) scenarioResult = 'lose';
      // Winning stops the clock, but only on the frame it is won. This used to
      // live in the banner branch below, which runs ten times a second for as
      // long as the win stands -- so pressing play un-paused the world for a
      // tenth of a second and then it snapped back, and the button looked
      // broken. Once you have won you are allowed to keep playing.
      if (scenarioResult === 'win') { sim.paused = true; endSettle(); syncPlay(); }
    }
    el.className = 'sc-status' + (scenarioResult ? ' ' + scenarioResult : '');
    if (scenarioResult === 'win') { el.textContent = tp('✓ Complete — {0} elapsed', fmtTime(w.time)); }
    else if (scenarioResult === 'lose') {
      el.textContent = tp('✕ Failed — {0} elapsed. Reset to try again.', fmtTime(w.time));
    } else {
      el.textContent = tp('{0} / {1} — in progress', fmtTime(w.time), fmtTime(activeScenario.limit));
    }
  }
}

let toastTimer;
function toast(msg, ms = 2600) {
  const box = $('#toast');
  box.textContent = msg; box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), ms);
}

// ---------------------------------------------------------------------------
// Controls
// The reserve, drawn under the Industrial CO2 slider. Cheap enough to do every
// frame, and it is the one number that explains why the CO2 stops climbing.
// ---------------------------------------------------------------------------
// Save slots.
//
// Five of them, in localStorage. A slot holds the whole world rather than just
// the controls: the clock, the band temperatures, where the water is, how much
// of the ice sheet has grown, what is left of the fossil reserve and the carbon
// below. Saving only the sliders would have given you a world that looked right
// and had forgotten everything it had been through, which for a model whose
// whole subject is history would be the wrong thing to keep.
const slotKey = (i) => `${NS}.slot${i}.v1`;
let armedToSave = false;

function readSlot(i) {
  try { return JSON.parse(localStorage.getItem(slotKey(i)) || 'null'); } catch { return null; }
}

// The three clocks. `age` counts from the world's formation and therefore
// includes everything that happened before t=0 -- an Archean preset is already
// 1.15 Gyr old at the moment it starts, and a timebar that only ever said
// "elapsed 2 Gyr" was quietly hiding that this planet was 3.15 billion years
// old. `elapsed` is the run. `since` is time from the last mark, and it is
// absent rather than zeroed when there is none.
function syncClocks(w) {
  const age = (w.params.startAge ?? 0) * 1e9 + w.time;
  const el = $('#worldage');
  if (el) el.textContent = age >= 1e8 ? `${(age / 1e9).toFixed(2)} Gyr` : fmtTime(age);
  const row = $('#since-row'), last = marks[marks.length - 1];
  if (!row) return;
  row.hidden = !last;
  if (last) {
    $('#since-label').textContent = last.name;
    $('#since-label').title = tp('Marked at {0} elapsed', fmtTime(last.t));
    $('#sincetime').textContent = fmtTime(Math.max(0, w.time - last.t));
  }
  const btn = $('#btn-mark');
  if (btn) btn.classList.toggle('has-mark', !!last);
}

// The list, where there is room to rename and to remove. The gap column is the
// point of it: how long the world spent between the two things you marked.
function renderMarks() {
  const box = $('#marks-list'), group = $('#marks-group');
  if (!box || !group) return;
  group.hidden = marks.length === 0;
  box.innerHTML = '';
  marks.forEach((m, i) => {
    const row = document.createElement('div');
    row.className = 'mark-row';

    const name = document.createElement('input');
    name.type = 'text'; name.value = m.name; name.spellcheck = false;
    name.setAttribute('aria-label', 'Milestone name');
    const rename = () => {
      m.name = name.value.trim() || 'mark';
      name.value = m.name;
      syncClocks(sim.world);
    };
    name.addEventListener('blur', rename);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

    const when = document.createElement('span');
    when.className = 'mark-when';
    when.textContent = fmtTime(m.t);
    when.title = t('Elapsed time when this was marked');

    const gap = document.createElement('span');
    gap.className = 'mark-gap';
    if (i > 0) {
      gap.textContent = `+${fmtTime(m.t - marks[i - 1].t)}`;
      gap.title = tp('after “{0}”', marks[i - 1].name);
    }

    const drop = document.createElement('button');
    drop.type = 'button'; drop.className = 'mark-drop';
    drop.textContent = '\u00d7';
    drop.title = t('Remove this milestone');
    drop.addEventListener('click', () => {
      marks.splice(i, 1);
      renderMarks(); syncClocks(sim.world);
    });

    row.append(name, when, gap, drop);
    box.appendChild(row);
  });
}

function snapshot() {
  // The world itself comes from captureWorld, so the slots, the export file and
  // the history scrubber cannot drift apart about what a world is. What is
  // added here is the part that is not physics: which world this is called, and
  // which set of continents was drawn for it.
  return {
    v: 1, at: Date.now(),
    name: currentName(),
    seed: renderState.seed,
    marks: marks.map((m) => ({ t: m.t, name: m.name })),
    ...captureWorld(sim.world),
  };
}

// ---------------------------------------------------------------------------
// Standing somewhere in a world's own past.
//
// The temperature chart has always drawn where a planet has been. This makes
// that history somewhere you can go: whole world states are kept as it runs,
// and dragging on the chart puts the simulation back into one of them. From
// there, move a slider and the world takes a different route -- which is the
// only way to ask the question this model is really for, "what would it have
// taken for this not to happen".
//
// Declared here rather than lower down because applyWorldState() below touches
// them: a `let` used before its declaration line has run is a temporal dead
// zone, which is a crash and not a warning, and this project has shipped one.
// Milestones. A mark is a moment the player said mattered, and its whole job is
// to give the clock a second origin: "the ice started advancing HERE, how long
// has it been going". Three clocks then run at once -- the object's age, the
// run, and the time since the last mark -- because those are three different
// questions and the timebar was only answering one of them.
//
// Kept here rather than on the world because they are not physics. They travel
// in a save because they are part of what happened; they are dropped by a reset
// because that world has not happened yet; and a rewind drops the ones that are
// now in the future, which is the same rule the temperature history follows.
let marks = [];               // { t, name }, oldest first

let restorePoints = [];       // whole worlds, oldest first
let suspendCapture = false;   // no snapshots of a half-written world
let scrubMark = null;         // where the handle is while dragging, else null

// The physics half: put a saved world state back into the simulation.
//
// Split out from restore() because going back along a world's own history is
// not the same act as loading a save slot, and wants none of the rest of it --
// a rewind must not drop Earth's surface map, must not move what Reset goes
// back to, and must not stop calling this planet Earth. It is the same physics
// either way, which is exactly the part that should not be written twice.
function applyWorldState(s) {
  suspendCapture = true;
  // Going back along a world's own history un-happens everything after where
  // you land, milestones included: a mark on an event that this branch has not
  // reached yet would be a note about a future that was just dropped.
  const when = s.world?.time ?? s.time;
  if (isFinite(when)) {
    const kept = marks.filter((m) => m.t <= when + 1);
    if (kept.length !== marks.length) { marks = kept; renderMarks(); }
  }
  // The live params object is handed through rather than replaced: the sliders
  // read and write it, and it is what makes a change made after a rewind reach
  // the simulation at all.
  Object.assign(params, s.params);
  renderState.seed = s.seed ?? renderState.seed;
  applyWorld(sim, s, params);
  suspendCapture = false;
}

function restore(s) {
  applyWorldState(s);
  marks = Array.isArray(s.marks)
    ? s.marks.filter((m) => m && isFinite(m.t)).map((m) => ({ t: +m.t, name: String(m.name || 'mark') }))
    : [];
  renderMarks();
  // A loaded world has no past in this session yet: the run it came from
  // happened before, and its history did not travel in the slot.
  restorePoints = [snapshot()];
  scrubMark = null;
  applyBody(null);
  syncSliders(); setPresetActive(null);
  // A saved world carries its own name back. `s.name` may be a preset's name
  // rather than a typed one, which is fine: from here it is this world's name
  // until a preset is loaded over it.
  setWorldName(s.name ?? null);
  writeHash(); rememberStart();
  sim.paused = resetPaused; syncPlay();
}

function buildSlots() {
  const host = $('#slots');
  host.innerHTML = '';
  for (let i = 1; i <= SLOTS; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'slot'; b.dataset.slot = String(i);
    host.appendChild(b);
    b.addEventListener('click', () => {
      if (armedToSave) {
        try { localStorage.setItem(slotKey(i), JSON.stringify(snapshot())); }
        catch { toast(t('Could not save — storage is full or blocked')); return; }
        armedToSave = false;
        if (i === AUTOSAVE_SLOT) { dirty = false; lastAutosave = Date.now(); }
        syncSlots();
        toast(tp('Saved to slot {0}', i));
        return;
      }
      const s = readSlot(i);
      if (!s) { toast(tp('Slot {0} is empty — press Save… first', i)); return; }
      restore(s);
      // Freshly loaded and unchanged: nothing to write back yet, and the clock
      // has not moved. Marking it clean here is what stops loading slot 3 from
      // copying itself into slot 1 a moment later.
      dirty = false; lastAutosave = Date.now();
      toast(tp('Loaded slot {0} — {1}, {2} in', i, s.name, fmtTime(s.time || 0)));
    });
  }
  syncSlots();
}

function syncSlots() {
  for (let i = 1; i <= SLOTS; i++) {
    const b = $(`.slot[data-slot="${i}"]`);
    if (!b) continue;
    const s = readSlot(i);
    b.classList.toggle('empty', !s);
    b.classList.toggle('armed', armedToSave);
    // Slot 1 says what it is. Saving into it by hand still works and is not
    // fought over: what you would be saving is the world that is running, which
    // is the same world the next autosave writes.
    // The badge span is emitted on every slot, empty where it does not apply, so
    // all five keep the same four grid columns and the elapsed time stays in
    // line down the row.
    const auto = `<span class="slot-auto">${i === AUTOSAVE_SLOT ? t('auto') : ''}</span>`;
    b.innerHTML = `<span class="slot-n">${i}</span>` + (s
      ? `<span class="slot-name">${s.name}</span>${auto}` +
        `<span class="slot-sub">${fmtTime(s.time || 0)}</span>`
      : `<span class="slot-name">${t('empty')}</span>${auto}<span class="slot-sub">—</span>`);
    const note = i === AUTOSAVE_SLOT
      ? '\n' + t('Kept up to date on its own, every 30 s and when you leave the page.') : '';
    b.title = (s ? tp('{0} — {1} elapsed, saved {2}', s.name, fmtTime(s.time || 0),
                      new Date(s.at).toLocaleString())
                 : tp('Slot {0} is empty', i)) + note;
  }
  const btn = $('#btn-slot-save');
  if (btn) { btn.textContent = armedToSave ? 'pick a slot' : 'Save…'; btn.classList.toggle('busy', armedToSave); }
}

// ---------------------------------------------------------------------------
// Autosave, into slot 1.
//
// The rule that matters is the one that stops it being a hazard: it will not
// write until the world has actually been touched. Open the page, look at it,
// close it again, and the autosave from last session is still there. Without
// that guard the first tick of a fresh page would overwrite whatever you had
// with a default Earth you never asked for -- which is precisely the way an
// autosave turns from a convenience into a way of losing things.
//
// Thirty seconds. A snapshot is about 1.1 kB and the whole set of five is 5.4,
// so the cost is nothing; the interval is about how much work you would rather
// not repeat, not about the write.
const AUTOSAVE_SLOT = 1;
const AUTOSAVE_MS = 30000;
let dirty = false;            // has the world moved since the last write?
let touched = false;          // has anyone actually done anything this session?
let lastAutosave = 0;

// Two flags, and the second one is the whole safety of this.
//
// A fresh page starts *running* -- the clock moves from the first frame -- so
// "the world has changed" is true within milliseconds of opening the tab. On
// that alone, opening the page and walking away for half a minute would write a
// default Earth over the world you left there yesterday. Which is exactly how
// an autosave stops being a convenience.
//
// So the clock moving makes the world dirty, but only a deliberate act -- a
// slider, a preset, a scenario, a reset, a settle -- makes the session count as
// touched, and nothing is written until both are true. Open it, look at it,
// close it: your autosave is still yesterday's.
function markDirty() { dirty = true; }
function markTouched() { dirty = true; touched = true; }

function autosave(force = false) {
  if (!dirty || !touched) return false;
  const now = Date.now();
  if (!force && now - lastAutosave < AUTOSAVE_MS) return false;
  try { localStorage.setItem(slotKey(AUTOSAVE_SLOT), JSON.stringify(snapshot())); }
  catch { return false; }      // full or blocked: stay quiet, this is a background job
  lastAutosave = now; dirty = false;
  syncSlots();
  return true;
}

// Closing the tab, switching apps, locking the phone. This is the one that
// actually catches most sessions, because few of them end on a round thirty
// seconds. `visibilitychange` is the reliable one on mobile -- `beforeunload`
// is not fired at all by iOS Safari when an app is swiped away.
addEventListener('visibilitychange', () => { if (document.hidden) autosave(true); });
addEventListener('pagehide', () => autosave(true));

// ---------------------------------------------------------------------------
// Export and import: every save in one file.
//
// The address bar already carries one world, and it stays the way to send
// somebody a single planet -- it needs no file and no download. This is the
// other thing: handing over a whole set at once, or keeping one somewhere that
// is not this browser's localStorage, which is a place saves go to die when a
// browser clears site data.
function exportSaves() {
  const worlds = [];
  for (let i = 1; i <= SLOTS; i++) {
    const s = readSlot(i);
    if (s) worlds.push({ slot: i, ...s });
  }
  if (!worlds.length) { toast(t('Nothing to export — every slot is empty')); return; }
  const doc = buildSaveFile(worlds, Date.now());
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `planet-climate-saves-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  // Revoked on the next turn of the event loop: revoking synchronously can
  // race the download on some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${worlds.length} world${worlds.length === 1 ? '' : 's'}`);
}

function importSaves(text) {
  const worlds = parseSaveFile(text);
  if (!worlds) { toast(t('That file has no worlds in it')); return; }
  const { writes, skipped } = planImport(worlds, (i) => !readSlot(i), SLOTS);
  for (const { slot, world } of writes) {
    try { localStorage.setItem(slotKey(slot), JSON.stringify(world)); }
    catch { toast(t('Could not import — storage is full or blocked')); syncSlots(); return; }
  }
  // An imported slot 1 is not the running world, so do not let the autosave
  // write over it a moment later.
  if (writes.some((wr) => wr.slot === AUTOSAVE_SLOT)) { dirty = false; lastAutosave = Date.now(); }
  syncSlots();
  toast(writes.length
    ? `Imported ${writes.length} world${writes.length === 1 ? '' : 's'}` +
      (skipped ? `, ${skipped} did not fit` : '')
    : 'Nothing imported — every slot is full and the file named none of them');
}

// Capture, on the sampler the clock already runs -- so restore points land on
// the same geometric schedule as the chart's own points, and every one of them
// is a moment the chart actually draws.
sim.onSample = (w) => {
  if (suspendCapture) return;
  // A reset, a preset, a scenario or a loaded slot all clear the history and
  // take one fresh sample. That is the signal that this is a different world
  // and the old restore points are not its past.
  if (w.history.length <= 1) restorePoints.length = 0;
  pushRestore(restorePoints, snapshot(), RESTORE_CAP);
};

// Going back. `commit` is false while the pointer is still down -- the world
// moves, so you can see what it was, but nothing is thrown away until you let
// go somewhere.
let scrubAt = null;           // the point currently applied, to avoid redoing it

function scrubTo(t, commit) {
  const p = findRestore(restorePoints, t);
  if (!p) return;
  // A drag crosses many pixels per restore point. Rebuilding the world for a
  // point it is already standing in would be pure waste, and this is what makes
  // the drag cost the number of points passed rather than the number of pointer
  // events -- a few dozen instead of a few hundred.
  if (p !== scrubAt) {
    const w = sim.world;
    const past = w.history.filter((h) => h.t <= p.time);
    const future = w.history;            // kept whole until the pointer lifts
    applyWorldState(p);
    // sim.reset() inside applyWorldState empties the history and takes one
    // sample. Put the run back, because the chart is the thing being dragged on
    // and it must not collapse to a single point under the pointer.
    sim.world.history = commit ? past : future;
    scrubAt = p;
    syncSliders();
  }
  if (!commit) { scrubMark = p.time; return; }

  // Letting go is what actually costs the future.
  const w = sim.world;
  sim.world.history = w.history.filter((h) => h.t <= p.time);
  truncateAfter(restorePoints, p.time);
  scrubMark = null; scrubAt = null;
  markTouched();
  // Only on release. writeHash() goes through history.replaceState, which
  // browsers rate-limit -- Safari at around a hundred calls per thirty seconds
  // -- and a drag across a chart generates far more pointer events than that.
  // Calling it per move would silently stop updating the URL, or throw.
  writeHash();
}

// The chart is the control. Pointer events rather than click, so it can be
// dragged: the whole point is moving back and forth along the run to find the
// moment before it went wrong, and a single click cannot do that.
function bindScrub() {
  const cv = $('#chart-history');
  if (!cv) return;
  let dragging = false;
  const timeAt = (e) => {
    const r = cv.getBoundingClientRect();
    return historyTimeAtX(e.clientX - r.left, Math.max(sim.world.time, 10), r.width);
  };
  cv.addEventListener('pointerdown', (e) => {
    if (sim.world.history.length < 2 || restorePoints.length < 2) return;
    dragging = true;
    // Paused while scrubbing, or the clock would run the world forward out
    // from under the handle.
    sim.paused = true; syncPlay();
    cv.setPointerCapture(e.pointerId);
    scrubTo(timeAt(e), false);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    scrubTo(timeAt(e), false);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    scrubTo(timeAt(e), true);
    toast(tp('Back to {0} — change something, then press play', fmtTime(sim.world.time)));
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------------------
// The zonal profile reads one band at a time.
//
// The chart plots eighteen equal-area bands and can label none of them, so the
// hover does it: which latitude (or which angle from the substellar point, on a
// locked world), what the ground there is doing, and how much of it is frozen.
// The bands are the model's actual resolution, so this is not an interpolation
// of a curve -- it is the number the solver holds.
let profileHover = null;

function bandLabel(w, i) {
  const x = BAND_X[i];
  if (w.diag.lam > 0.5) {
    // On a locked world x is the cosine of the angle from the substellar point,
    // not a latitude: +1 is noon for ever and -1 is the middle of the night.
    const ang = Math.acos(clamp(x, -1, 1)) * 180 / Math.PI;
    return ang < 1 ? 'substellar point'
      : ang > 179 ? 'antistellar point'
      : `${ang.toFixed(0)}° from substellar`;
  }
  const lat = Math.asin(clamp(x, -1, 1)) * 180 / Math.PI;
  if (Math.abs(lat) < 2) return 'equator';
  return `${Math.abs(lat).toFixed(0)}° ${lat > 0 ? 'N' : 'S'}`;
}

function bindWorldName() {
  const el = $('#world-name');
  if (!el) return;
  el.placeholder = PRESETS[activePreset]?.name || 'Custom world';
  el.addEventListener('input', () => {
    setWorldName(el.value, { toField: false });
    markTouched();
  });
}

function bindProfile() {
  const cv = $('#chart-profile'), tip = $('#profile-tip');
  if (!cv || !tip) return;
  const show = (e) => {
    const r = cv.getBoundingClientRect();
    const i = profileBandAtX(e.clientX - r.left, r.width);
    profileHover = i;
    const w = sim.world, dg = w.diag;
    const T = w.T[i];
    const frozen = dg.hasWater ? iceFraction(T) : 0;
    const sun = dg.S ? dg.S[i] : 0;
    tip.innerHTML =
      `<b>${(T - 273.15).toFixed(1)} °C</b> · ${bandLabel(w, i)}` +
      `<span class="tip-sub">${sun.toFixed(0)} W/m² down` +
      (dg.hasWater ? ` · ${(frozen * 100).toFixed(0)}% frozen` : ' · no water') +
      ` · cloud ${(dg.cloud[i] * 100).toFixed(0)}%</span>`;
    tip.hidden = false;
    // Kept inside the chart: at the right-hand end the box would otherwise hang
    // off the panel and be clipped.
    const wTip = tip.offsetWidth || 150;
    tip.style.left = `${clamp(e.clientX - r.left - wTip / 2, 2, Math.max(2, r.width - wTip - 2))}px`;
  };
  cv.addEventListener('pointermove', show);
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture?.(e.pointerId); show(e); });
  const hide = () => { profileHover = null; tip.hidden = true; };
  cv.addEventListener('pointerleave', hide);
  cv.addEventListener('pointercancel', hide);
}

// The living biosphere, under the control that asks for one.
function syncBio() {
  const fill = $('#bio-fill'), left = $('#bio-left');
  if (!fill) return;
  const want = Math.max(params.biosphere ?? 0, 0);
  const alive = sim.world.diag?.bio ?? want;
  const f = want > 0 ? Math.max(0, Math.min(1, alive / want)) : 0;
  fill.style.width = `${f * 100}%`;
  const dead = want > 0 && f < 0.005;
  fill.classList.toggle('spent', dead);
  left.classList.toggle('spent', dead);
  left.textContent = want <= 0 ? 'none'
    : dead ? 'dead'
    : `${(alive).toFixed(alive < 0.1 ? 3 : 2)}× alive`;
}

// What is still dissolved in the mantle and crust, shown the same way the
// fossil reserve is. The bar is against the planet's own endowment, which
// scales with its mass; the label is in bar of CO2, because that is the number
// that says what the world could still become. Earth's is about four hundred.
function syncMantle() {
  const fill = $('#mantle-fill'), left = $('#mantle-left'), inf = $('#chk-mantle-inf');
  if (!fill) return;
  if (inf) inf.checked = !!params.mantleInfinite;
  if (params.mantleInfinite) {
    fill.style.width = '100%';
    fill.classList.remove('spent');
    left.textContent = '\u221e';
    left.classList.remove('spent');
    return;
  }
  const w = sim.world;
  const total = carbonBudget(w.params.mass);
  // Null until the first step has run, exactly as the fossil reserve is, and
  // reading it raw showed a fresh world as an exhausted one.
  const col = w.carbonDeep ?? total;
  const f = Math.max(0, Math.min(1, col / Math.max(total, 1e-12)));
  fill.style.width = `${f * 100}%`;
  const spent = f <= 1e-4;
  fill.classList.toggle('spent', spent);
  left.classList.toggle('spent', spent);
  // kg/m^2 of CO2 into bar, through the planet's own gravity.
  const bar = col * (w.diag?.g ?? 9.81) / 1e5;
  left.textContent = spent ? 'exhausted'
    : bar >= 10 ? `${bar.toFixed(0)} bar`
    : bar >= 0.1 ? `${bar.toFixed(2)} bar`
    : `${(bar * 1e3).toFixed(bar * 1e3 < 10 ? 1 : 0)} mbar`;
}

function syncFossil() {
  const fill = $('#fossil-fill'), left = $('#fossil-left'), inf = $('#chk-fossil-inf');
  if (!fill) return;
  if (inf) inf.checked = !!params.fossilInfinite;
  if (params.fossilInfinite) {
    fill.style.width = '100%';
    fill.classList.remove('spent');
    left.textContent = '∞';
    left.classList.remove('spent');
    return;
  }
  const start = FOSSIL_TOTAL * (1 - (params.fossilUsed ?? 0));
  const f = Math.max(0, Math.min(1, (sim.world.fossil ?? start) / FOSSIL_TOTAL));
  fill.style.width = `${f * 100}%`;
  const spent = f <= 1e-6;
  fill.classList.toggle('spent', spent);
  left.textContent = spent ? 'exhausted' : `${(f * 100).toFixed(f > 0.1 ? 0 : 1)} %`;
  left.classList.toggle('spent', spent);
}

function syncPlay() {
  const b = $('#btn-play');
  b.textContent = sim.paused ? `▶  ${t('Play')}` : `❚❚  ${t('Pause')}`;
  b.classList.toggle('paused', sim.paused);
  b.title = t(sim.paused ? 'Resume the simulation (space)' : 'Pause the simulation (space)');
  syncSpin();
}

// The main clock pause freezes the globe too, but it is a temporary override:
// a user who separately paused rotation still has it paused after Play resumes.
function syncSpin() {
  view.simPaused = !!sim.paused;
  const b = $('#btn-spin');
  if (!b) return;
  b.disabled = !!sim.paused;
  b.setAttribute('aria-pressed', String(!!sim.paused || !!view.spinPaused));
  b.title = t(sim.paused
    ? 'Planet rotation is paused with the simulation'
    : view.spinPaused ? 'Resume the planet’s rotation' : "Pause the planet's rotation");
}

function updateQualityButton() {
  const b = $('#btn-quality');
  const low = view.quality === 'low';
  b.textContent = low ? '◇' : '◆';
  b.setAttribute('aria-pressed', String(low));
  b.title = t(low ? 'Detail: low — click for high' : 'Detail: high — click for low');
}

function updateGfxButton() {
  const b = $('#btn-gfx');
  const on = view.wantTextures && view.texturesLoaded;
  b.textContent = on ? '🛰' : '◍';
  b.setAttribute('aria-pressed', String(on));
  b.title = t(on ? 'Surface: generated maps — click for procedural'
                 : 'Surface: procedural — click for generated maps');
}

function bindControls() {
  $('#btn-play').addEventListener('click', () => { sim.paused = !sim.paused; syncPlay(); markTouched(); });
  $('#btn-reset').addEventListener('click', () => {
    // Same world, same starting parameters, clock back to zero -- including the
    // continents, so it really is the planet you began with.
    Object.assign(params, initialParams);
    renderState.seed = initialSeed;
    sim.reset(params);
    marks = []; renderMarks();
    syncSliders();
    scenarioResult = null; endSettle(); sim.paused = resetPaused; syncPlay();
    writeHash(); markTouched();
    toast(resetPaused ? 'Reset to the starting world — paused'
                      : 'Reset to the starting world');
  });
  const chkReset = $('#chk-reset-paused');
  chkReset.checked = resetPaused;
  chkReset.addEventListener('change', () => {
    resetPaused = chkReset.checked;
    try { localStorage.setItem(RESET_PAUSED_KEY, resetPaused ? 'pause' : 'run'); } catch { }
  });
  $('#btn-saves-export').addEventListener('click', exportSaves);
  $('#btn-saves-import').addEventListener('click', () => $('#saves-file').click());
  $('#saves-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    // Cleared either way, so picking the same file twice in a row still fires.
    e.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => importSaves(String(r.result || ''));
    r.onerror = () => toast(t('Could not read that file'));
    r.readAsText(f);
  });

  $('#btn-slot-save').addEventListener('click', () => {
    armedToSave = !armedToSave;
    syncSlots();
    if (armedToSave) toast(t('Pick a slot to save into'));
  });

  // --- the fossil reserve ---------------------------------------------------
  $('#btn-fossil-reset').addEventListener('click', () => {
    sim.world.fossil = FOSSIL_TOTAL;
    syncFossil();
    toast(t('Fossil carbon put back in the ground'));
  });
  $('#chk-fossil-inf').addEventListener('change', (e) => {
    params.fossilInfinite = e.target.checked;
    sim.setParams({ fossilInfinite: params.fossilInfinite });
    writeHash();
    syncFossil();
  });
  $('#chk-mantle-inf').addEventListener('change', (e) => {
    params.mantleInfinite = e.target.checked;
    sim.setParams({ mantleInfinite: params.mantleInfinite });
    writeHash(); markTouched();
  });

  // The star brightens as it burns. 10% per billion years, compounding, and the
  // control follows it -- see the note on the insolation slider for why ten and
  // not the Sun's own 7.4.
  $('#chk-brightening').addEventListener('change', (e) => {
    params.brightening = e.target.checked ? 1 : 0;
    sim.setParams({ brightening: params.brightening });
    writeHash(); markTouched();
    toast(e.target.checked
      ? 'The star now brightens by 10% every billion years'
      : 'The star holds steady');
  });

  // The interior runs down its radiogenic curve, and volcanism follows through
  // melt production without needing a switch of its own.
  // A resurfacing event is three numbers, and nobody wants to set three numbers
  // to ask "what if the mantle turned over". The checkbox places Venus's, which
  // is the one with a date on it; the sliders are there to move it afterwards.
  $('#chk-resurface').addEventListener('change', (e) => {
    if (e.target.checked) {
      // Venus's own date, expressed from wherever this world happens to start.
      // A world already older than that gets a round half a billion years
      // ahead of it instead: the event is meant to be watched, and one behind
      // the clock cannot be.
      if (!(params.resurfacingAge > 0)) {
        params.resurfacingAge = Math.max(3.852 - (params.startAge ?? 4.567), 0.5);
      }
      if (!(params.resurfacingBoost > 1)) params.resurfacingBoost = 60;
    } else {
      params.resurfacingAge = 0;
    }
    sim.setParams({ resurfacingAge: params.resurfacingAge,
                    resurfacingBoost: params.resurfacingBoost });
    syncSliders(); writeHash(); markTouched();
    toast(e.target.checked
      ? `Mantle turnover ${params.resurfacingAge.toFixed(2)} Gyr from now, ${params.resurfacingBoost.toFixed(0)}× volcanism`
      : 'No resurfacing event');
  });

  $('#chk-smooth-sun').addEventListener('change', (e) => {
    params.smoothInsolation = e.target.checked;
    sim.setParams({ smoothInsolation: params.smoothInsolation });
    writeHash(); markTouched();
    toast(e.target.checked
      ? 'Starlight changes now walk to the new value instead of jumping'
      : 'Starlight changes apply at once');
  });

  $('#chk-geology').addEventListener('change', (e) => {
    params.realisticGeology = e.target.checked;
    sim.setParams({ realisticGeology: params.realisticGeology });
    writeHash(); markTouched();
    toast(e.target.checked
      ? `Interior decaying from ${(params.startAge ?? 4.567).toFixed(2)} Gyr — volcanism follows it down`
      : 'Interior heat holds steady');
  });

  $('#btn-settle').addEventListener('click', () => {
    markTouched();
    if (settling) { endSettle(); return; }        // click again to stop
    settling = true;
    settleRounds = 0;
    // Settling *is* running the world, so it cannot happen behind a paused
    // clock: without this the play button would read "Play" while the
    // simulation raced ahead, which is the one state the button must never be
    // able to show.
    if (sim.paused) { sim.paused = false; syncPlay(); }
    $('#btn-settle').classList.add('busy');
    $('#btn-settle').textContent = t('Stop');
  });

  const rate = $('#rate'), rateOut = $('#rate-out');
  const rateMenu = $('#rate-menu');

  // The rates worth jumping straight to.
  //
  // The slider is logarithmic over nearly nine decades, which is the only way
  // one control covers "watch the industrial era" and "watch a star burn down"
  // -- and it means a millimetre of thumb is a factor of ten. On a tablet the
  // difference between half a million years a second and three hundred million
  // is a few pixels. A row of buttons was the first answer and it was worse: at
  // tablet width seven of them wrapped onto two lines and shoved the timebar up
  // over the planet. A menu is one line at any width, and every platform opens
  // it as a full-height list, which is the easiest thing there is to hit.
  //
  // Named for what the span is good for rather than for its number.
  const RATE_STOPS = [
    { v: 1, name: '1 yr / s', why: 'a year a second — watch the industrial era' },
    { v: 10, name: '10 yr / s', why: 'a decade a second' },
    { v: 1e2, name: '100 yr / s', why: 'a century a second — the whole fossil burn in a minute' },
    { v: 1e3, name: '1 kyr / s', why: 'a thousand years a second' },
    { v: 1e4, name: '10 kyr / s', why: 'glacial cycles, and the long thaw after a carbon spike' },
    { v: 1e5, name: '100 kyr / s', why: 'a hundred thousand a second' },
    { v: 5e5, name: '500 kyr / s', why: 'half a million a second' },
    { v: 1e6, name: '1 Myr / s', why: 'the carbonate-silicate thermostat works on this timescale' },
    { v: 5e6, name: '5 Myr / s', why: 'five million a second' },
    { v: 1e7, name: '10 Myr / s', why: 'ice sheets, cold traps, the slow drift of a climate' },
    { v: 2.5e7, name: '25 Myr / s', why: 'twenty-five million a second' },
    { v: 5e7, name: '50 Myr / s', why: 'a whole geological era every couple of seconds' },
    { v: 1e8, name: '100 Myr / s', why: 'a continent\u2019s worth of time per second' },
    { v: 2.5e8, name: '250 Myr / s', why: 'a galactic year a second' },
    { v: 5e8, name: '500 Myr / s', why: 'the fastest this goes — a planet\u2019s whole life in ten seconds' },
  ];

  {
    const custom = document.createElement('option');
    custom.value = ''; custom.textContent = t('custom'); custom.hidden = true;
    rateMenu.appendChild(custom);
    for (const st of RATE_STOPS) {
      const o = document.createElement('option');
      o.value = String(Math.log10(st.v));
      o.textContent = st.name;
      o.title = st.why;
      rateMenu.appendChild(o);
    }
  }

  const rateUnit = $('#rate-unit');
  const applyRate = () => {
    sim.rate = Math.pow(10, +rate.value);
    if (!rateOut.editing) showRate(sim.rate);
    const lo = +rate.min, hi = +rate.max;
    rate.style.setProperty('--fill', `${((+rate.value - lo) / (hi - lo)) * 100}%`);
    // Show the menu entry the clock is actually on, or "custom" when the slider
    // has been dragged somewhere between two of them.
    const hit = RATE_STOPS.find((st) => Math.abs(Math.log10(st.v) - +rate.value) < 0.005);
    rateMenu.value = hit ? String(Math.log10(hit.v)) : '';
  };
  rateMenu.addEventListener('change', () => {
    if (rateMenu.value === '') return;
    rate.value = rateMenu.value;
    applyRate();
  });

  // Typing a rate. Accepts what the readout prints, so whatever it shows can be
  // copied back in: "500 yr", "2 Myr", "1.5 Gyr / s". A bare number is years,
  // because that is the unit the control is named in.
  const RATE_UNITS = { yr: 1, y: 1, a: 1, kyr: 1e3, ky: 1e3, ka: 1e3,
                       myr: 1e6, my: 1e6, ma: 1e6, gyr: 1e9, gy: 1e9, ga: 1e9,
                       byr: 1e9, b: 1e9 };
  const parseRate = (raw) => {
    const txt = String(raw).trim().toLowerCase().replace(',', '.').replace(/\/\s*s(ec(ond)?s?)?$/, '').trim();
    const m = txt.match(/^([-+]?(?:[0-9]*\.)?[0-9]+(?:e[-+]?[0-9]+)?)\s*(.*)$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!isFinite(n) || n <= 0) return null;
    const unit = m[2].replace(/[\s.]/g, '');
    const mult = unit === '' ? 1 : RATE_UNITS[unit];
    if (!mult) return null;
    return n * mult;
  };
  const commitRate = () => {
    rateOut.editing = false;
    // A bare number means "this many of whatever the menu says". A number with
    // a unit in it overrides the menu, so anything the readout has ever printed
    // can be pasted straight back in.
    const typed = String(rateOut.value).trim();
    const bare = /^[-+]?(?:[0-9]*\.)?[0-9]+(?:e[-+]?[0-9]+)?$/.test(typed.replace(',', '.'));
    const v = bare ? parseFloat(typed.replace(',', '.')) * (+rateUnit.value || 1)
                   : parseRate(typed);
    if (v == null || !(v > 0)) { applyRate(); return; }
    const lo = +rate.min, hi = +rate.max;
    rate.value = String(clamp(Math.log10(v), lo, hi));
    applyRate();
    const got = Math.pow(10, +rate.value);
    // Say so rather than silently landing somewhere else, because the ends of
    // this range are a long way apart and a typo is easy.
    if (Math.abs(Math.log10(got / v)) > 0.01) {
      toast(`Time acceleration runs from ${fmtTime(Math.pow(10, lo))} to ` +
        `${fmtTime(Math.pow(10, hi))} a second — set to ${fmtTime(got)} / s`);
    }
  };
  // Changing the unit keeps the number and moves the decimal point: 250 kyr/s
  // becomes 250 Myr/s. That is what picking a unit off a menu should do, and it
  // is the whole reason the menu exists.
  rateUnit.addEventListener('change', () => {
    const n = parseFloat(String(rateOut.value).replace(',', '.'));
    if (!isFinite(n) || n <= 0) { applyRate(); return; }
    const lo = +rate.min, hi = +rate.max;
    rate.value = String(clamp(Math.log10(n * (+rateUnit.value || 1)), lo, hi));
    applyRate();
  });
  rateOut.addEventListener('focus', () => { rateOut.editing = true; rateOut.select(); });
  rateOut.addEventListener('blur', commitRate);
  rateOut.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { rateOut.blur(); }
    else if (e.key === 'Escape') { rateOut.editing = false; applyRate(); rateOut.blur(); }
  });

  // Dropping a mark. Named after whatever the planet is at that moment, because
  // that is almost always what the player is marking -- "the ice started here",
  // "this is where it ran away" -- and a name that writes itself is one fewer
  // dialog between seeing something and recording it. Rename them in the list.
  const markBtn = $('#btn-mark');
  markBtn.addEventListener('click', () => {
    const w = sim.world;
    const st = classify(w);
    marks.push({ t: w.time, name: st.name });
    syncClocks(w); renderMarks();
    toast(tp('Marked “{0}” at {1}', tx('states', st.id, 'name') || st.name, fmtTime(w.time)));
  });

  // Auto-ease. Off by default: it takes the clock off the player, and a control
  // that does that has to be asked for.
  const slowBtn = $('#btn-slow');
  const syncSlow = () => {
    slowBtn.classList.toggle('active', !!sim.autoEase);
    slowBtn.setAttribute('aria-pressed', String(!!sim.autoEase));
    slowBtn.title = sim.autoEase
      ? 'Auto-ease is ON: when the climate starts moving fast — a runaway, a '
        + 'glaciation, a collapse — the clock holds itself to about six degrees '
        + 'a second so the transition can be watched instead of skipped over. '
        + 'Click to turn off.'
      : 'Auto-ease is OFF: the clock runs at whatever the slider says, so a '
        + 'runaway or a glaciation can happen entirely inside one frame. Click '
        + 'to have it slow down through a tipping.';
  };
  slowBtn.addEventListener('click', () => {
    sim.autoEase = !sim.autoEase;
    try { localStorage.setItem(EASE_KEY, sim.autoEase ? 'on' : 'off'); } catch { }
    syncSlow();
    toast(sim.autoEase ? 'Auto-ease on — the clock slows through a tipping'
                       : 'Auto-ease off');
  });
  sim.autoEase = easePref();
  syncSlow();

  // The accuracy/speed switch, beside the menu, because it is the other control
  // over how fast this thing runs.
  const fastBtn = $('#btn-fast');
  const syncFast = () => {
    fastBtn.classList.toggle('active', !!sim.world.fastPhysics);
    fastBtn.setAttribute('aria-pressed', String(!!sim.world.fastPhysics));
    fastBtn.title = sim.world.fastPhysics
      ? 'Fast physics is ON: about 1.4x, and the reservoirs read the temperature '
        + 'each step started from rather than the one it ended at. Holds every '
        + 'calibration anchor; answers move in the third or fourth digit. Click to turn off.'
      : 'Fast physics is OFF: full accuracy. Click for about 1.4x, at the cost of '
        + 'the third or fourth digit — the same climates, slightly less exactly.';
  };
  fastBtn.addEventListener('click', () => {
    sim.world.fastPhysics = !sim.world.fastPhysics;
    try { localStorage.setItem(FAST_KEY, sim.world.fastPhysics ? 'on' : 'off'); } catch { }
    syncFast();
    toast(sim.world.fastPhysics
      ? 'Fast physics on — about 1.4×, third-digit accuracy'
      : 'Fast physics off — full accuracy');
  });
  sim.world.fastPhysics = fastPref();
  syncFast();

  rate.addEventListener('input', applyRate); applyRate();

  bindPlanetDrag();

  $('#btn-spin').addEventListener('click', () => {
    view.spinPaused = !view.spinPaused;
    syncSpin();
  });
  $('#btn-view').addEventListener('click', () => {
    view.yaw = 0; view.pitch = 0; view.spinVel = 0; view.zoom = 1;
    if (view.software) view.skyKey = '';
  });
  updatePanSelect();
  $('#pan-speed').addEventListener('change', (e) => {
    const selected = Number(e.currentTarget.value);
    if (!PAN_SPEEDS.includes(selected)) { updatePanSelect(); return; }
    panSpeed = selected;
    try { localStorage.setItem(PAN_KEY, String(panSpeed)); } catch { }
    updatePanSelect();
    toast(t(`Panning speed: ${panSpeed}×`));
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
      toast(t('No GPU rendering available here — staying in software'));
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
  view.showClouds = cloudPref();
  updateCloudButton();
  $('#btn-clouds').addEventListener('click', () => {
    view.showClouds = view.showClouds === false;
    try { localStorage.setItem(CLOUD_KEY, view.showClouds ? 'on' : 'off'); } catch { }
    if (view.software) view.skyKey = '';      // the CPU path caches its frame
    updateCloudButton();
    toast(view.showClouds
      ? t('Clouds shown again.')
      : t('Clouds hidden — a view only. They still reflect their sunlight and still cool the planet; the readout\u2019s cloud cover has not moved.'), 6000);
  });
  $('#btn-gfx').addEventListener('click', () => {
    if (!view.texturesLoaded) { toast(t('Surface maps are not available in this build')); return; }
    view.wantTextures = !view.wantTextures;
    updateGfxButton();
    toast(view.wantTextures ? 'Generated surface maps' : 'Procedural graphics');
  });

  $('#scenario-banner .sc-close').addEventListener('click', closeScenario);
  // One tab at each edge, each opening the panel it points at. This used to be a
  // single button that cycled left -> right -> closed, which gave no clue what
  // the next tap would do and needed three taps to put a panel away.
  const showPanel = (side) => {
    const b = document.body;
    const want = side && !b.classList.contains(`show-${side}`);
    b.classList.remove('show-left', 'show-right');
    if (want) b.classList.add(`show-${side}`);
    $('#panel-left').setAttribute('aria-pressed', String(b.classList.contains('show-left')));
    $('#panel-right').setAttribute('aria-pressed', String(b.classList.contains('show-right')));
  };
  $('#panel-left').addEventListener('click', () => showPanel('left'));
  $('#panel-right').addEventListener('click', () => showPanel('right'));
  $('#panel-scrim').addEventListener('click', () => showPanel(null));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') showPanel(null); });

  // The timebar wraps to two rows on a narrow screen, so how much room the view
  // controls have above it is not a constant. Measure it instead of guessing:
  // guessing is why the renderer button ended up clipped off the bottom.
  const bar = $('#timebar');
  if (bar) {
    const fit = () => document.documentElement.style.setProperty('--bar', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(bar);
    addEventListener('resize', fit);
    addEventListener('orientationchange', fit);
    fit();
  }

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
    const k = panRadiansPerPixel(view.zoom, panSpeed, MIN_ZOOM, MAX_ZOOM);
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
    applyZoom(wheelZoomFactor(e.deltaY, e.deltaMode), true);
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
    endSettle();
    toast(tp('Settled at {0}', fmtTime(w.time)));
  }
}

// Leaving the settle -- by arriving, by giving up, or because the player hit
// the button again -- has to put the button back the way it was. Stopping used
// to return early and leave it reading "Stop" for the rest of the session.
function endSettle() {
  settling = false;
  $('#btn-settle').classList.remove('busy');
  $('#btn-settle').textContent = t('Settle');
}

let last = performance.now(), chartClock = 0, reportedError = false;

// One frame's worth of work, given how much real time has passed. Split out so
// it can be driven deterministically from a test harness as well as by rAF.
let autosaveClock = 0;
function tick(dtReal) {
  renderState.time += dtReal;
  try {
    // let a flick coast to a stop
    if (view.spinVel) {
      view.yaw += view.spinVel * dtReal;
      view.spinVel *= Math.pow(0.06, dtReal);
      if (Math.abs(view.spinVel) < 0.02) view.spinVel = 0;
    }
    if (settling && !sim.paused) advanceSettle();
    else sim.advance(dtReal);
    // A running clock is itself a change worth keeping. Kept as a separate line
    // rather than folded into the branches above, because smoketest pins that
    // guard by its exact text -- it exists because settling once ran straight
    // past a paused clock, and it caught this edit when it was folded in.
    if (!sim.paused) markDirty();
    view.render(sim.world, renderState, dtReal);

    // Autosave rides the chart clock rather than a timer of its own: it is
    // rate-limited internally, so this is just somewhere to ask, and it cannot
    // fire while the tab is in the background with rAF frozen -- which is what
    // `visibilitychange` above is for.
    autosaveClock += dtReal;
    if (autosaveClock > 1) { autosaveClock = 0; autosave(); }

    chartClock += dtReal;
    if (chartClock > 0.1) {
      chartClock = 0;
      updateReadout();
      drawHistory($('#chart-history'), sim.world, scrubMark);
      drawPhase($('#chart-phase'), sim.world);
      drawProfile($('#chart-profile'), sim.world, profileHover);
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
buildSlots();
buildScenarios();
bindScrub();
bindProfile();
bindWorldName();
syncSliders();
bindControls();
function selectState(id) {
  $('#state-detail').innerHTML = discovered.has(id)
    ? `<strong style="color:${STATES[id].color}">${tx('states', id, 'name') || STATES[id].name}` +
      `</strong><br>${tx('states', id, 'blurb') || STATES[id].blurb}`
    : t('Not yet discovered — build a world that reaches this state.');
}
buildLogUI($('#statelog'), discovered, selectState);
$('#found-count').textContent = String(discovered.size);
$('#total-count').textContent = String(Object.keys(STATES).length);

// Language.
//
// Everything above is built in English and then translated in place, which is
// deliberate: the static markup, the slider labels and their notes all become
// ordinary text nodes, and i18n.js caches the English on each one before
// touching it. So a switch is a re-translate rather than a rebuild, nothing
// needs a data-i18n attribute, and a string with no entry keeps its English
// instead of going blank. What cannot work that way is anything assembled from
// data after boot -- preset and scenario chips, the climate log, every readout
// -- and that is what relabel() rebuilds.
function relabel() {
  const lang = currentLang();
  document.documentElement.lang = lang;
  const btn = $('#btn-lang');
  if (btn) {
    const next = LANGS.find((l) => l.id === nextLang());
    btn.textContent = (LANGS.find((l) => l.id === lang) || LANGS[0]).tag;
    btn.title = `${t('Language')}: ${next ? t(`Switch to ${next.name === 'Slovenčina' ? 'Slovak' : 'English'}`) : ''}`;
  }
  applyStatic();
  // Assembled attributes rather than markup: applyStatic can only restore what
  // was in the DOM as written, and these were built by string concatenation.
  for (const d of SLIDERS) {
    const e = els[d.key];
    if (!e) continue;
    e.out.setAttribute('aria-label', tp('{0} value, type to set exactly', t(d.label)));
    e.input.setAttribute('aria-label', t(d.label));
    if (e.stopRow) {
      [...e.stopRow.children].forEach((c, i) => {
        const st = d.stops[i];
        if (!st) return;
        c.textContent = t(st.n);
        c.title = `${t(d.label)}: ${d.fmt(st.v)}`;
      });
    }
  }
  updateAtmoButton();
  updateQualityButton();
  updateGfxButton();
  updateCloudButton();
  updatePanSelect();
  buildPresets();
  buildScenarios();
  setPresetActive(activePreset);
  if (activeScenario) {
    const b = $(`[data-scenario="${activeScenario.id}"]`);
    if (b) b.classList.add('active');
    const banner = $('#scenario-banner');
    banner.querySelector('.sc-name').textContent =
      tx('scenarios', activeScenario.id, 'name') || activeScenario.name;
    banner.querySelector('.sc-brief').textContent =
      tx('scenarios', activeScenario.id, 'brief') || activeScenario.brief;
  }
  buildLogUI($('#statelog'), discovered, selectState);
  syncSlots();
  syncPlay();
  updateReadout();
}
onLang(relabel);
$('#btn-lang').addEventListener('click', () => setLang(nextLang()));
relabel();
if (Object.keys(paramsFromHash()).length === 0) {
  setPresetActive('earth');
  activeBody = 'earth';       // the app opens on Earth, so it opens on Earth's map
}
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
      if (activeBody) view.setBody?.(activeBody);
      if (kind !== 'gl2') {
        // Do not claim WebGL2 is missing when it was simply not asked for.
        const forced = wanted === kind;
        const why = rendererLog.length ? `  (${rendererLog[0].reason})` : '';
        toast(kind === 'software'
          ? `${t('Software rendering — drawn on the CPU. The simulation is unaffected.')}${forced ? '' : why}`
          : forced
            ? t('WebGL1, as requested — the same shaders at full detail.')
            : `${t('WebGL2 unavailable — drawing with WebGL1, at full detail.')}${why}`, 8000);
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
try { localStorage.removeItem(`${NS}.renderer.v1`); } catch { }

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
