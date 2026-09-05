import { NBANDS, X, lockFactor, insolationProfile } from '../physics/climate.js';
import { olr, planetaryAlbedo, iceFraction } from '../physics/radiation.js';
import { psatH2O, clamp } from '../physics/constants.js';
// Chart furniture is prose too: axis ends, the legend and the two empty-state
// lines were the last English left on a Slovak page.
import { t } from '../game/i18n.js';

const CSS = getComputedStyle(document.documentElement);
const col = (n, fb) => (CSS.getPropertyValue(n) || fb).trim() || fb;

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function axes(ctx, w, h, pad) {
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
}

function label(ctx, text, x, y, align = 'left', color = 'rgba(233,240,255,0.55)', size = 10) {
  ctx.fillStyle = color;
  ctx.font = `${size}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// Temperature vs time, log axis, with the band between coldest and warmest
// latitude shaded.
// ---------------------------------------------------------------------------
// The time axis of the temperature chart, in both directions.
//
// Exported because the chart is a scrubber now: a click has to be turned back
// into a year, and the only way for the marker to land under the pointer is for
// the two mappings to be the same one written once. Log time, because this
// model's runs span a kiloyear to ten billion years and a linear axis would put
// the whole Archean in the first pixel.
export const HISTORY_PAD = { l: 38, r: 8, t: 10, b: 18 };

// The time axis is LINEAR: a timeline, where equal distances are equal spans of
// history and a pixel is worth the same everywhere.
//
// It used to be logarithmic, and as a picture that was defensible -- the early
// part of a run is where the fast things happen. As a control it was not. On a
// 4.567 Gyr world the log axis gave the first half-billion years nine tenths of
// the width and squeezed the remaining four billion into the last tenth, so
// five millimetres near the right-hand end was about two billion years and
// there was no way to land on anything. What the scrubber is for is finding the
// moment before a world went wrong, and it could not be aimed.
//
// `zoom` and `pan` narrow the axis to a window of the run, which is how the
// resolution lost by going linear is given back where it is wanted: at full
// zoom a pixel on a 4.567 Gyr world is 9 Myr, and at 64x it is 140 kyr.
// Years, in as few characters as an axis end can spare.
function fmtSpan(yr) {
  const a = Math.abs(yr);
  if (a >= 1e9) return `${(yr / 1e9).toFixed(2)} Gyr`;
  if (a >= 1e6) return `${(yr / 1e6).toFixed(a >= 1e7 ? 0 : 1)} Myr`;
  if (a >= 1e3) return `${(yr / 1e3).toFixed(0)} kyr`;
  return `${yr.toFixed(0)} yr`;
}

export function historyWindow(tMax, zoom = 1, pan = 1) {
  const span = Math.max(tMax, 10) / Math.max(zoom, 1);
  const end = Math.max(span, Math.min(Math.max(tMax, 10), pan * Math.max(tMax, 10)));
  return { t0: Math.max(0, end - span), t1: end };
}

export function historyX(t, tMax, w, zoom = 1, pan = 1) {
  const { l, r } = HISTORY_PAD;
  const { t0, t1 } = historyWindow(tMax, zoom, pan);
  return l + ((t - t0) / Math.max(t1 - t0, 1e-9)) * (w - l - r);
}

export function historyTimeAtX(x, tMax, w, zoom = 1, pan = 1) {
  const { l, r } = HISTORY_PAD;
  const span = Math.max(w - l - r, 1);
  const f = Math.min(Math.max((x - l) / span, 0), 1);
  const { t0, t1 } = historyWindow(tMax, zoom, pan);
  return t0 + f * (t1 - t0);
}

// `markT` draws the scrub handle: where in its own history the world is
// currently standing. Absent on a world running normally, which is every world
// until somebody goes back.
export function drawHistory(canvas, world, markT = null, opts = {}) {
  const { ctx, w, h } = setup(canvas);
  const pad = HISTORY_PAD;
  const H = world.history;
  axes(ctx, w, h, pad);
  if (H.length < 2) { label(ctx, t('collecting…'), w / 2, h / 2, 'center'); return; }

  const tMax = Math.max(world.time, 10);
  const zoom = Math.max(opts.zoom || 1, 1), pan = opts.pan == null ? 1 : opts.pan;
  const win = historyWindow(tMax, zoom, pan);
  const lx = (t) => historyX(t, tMax, w, zoom, pan);
  let tlo = 1e9, thi = -1e9;
  for (const p of H) { tlo = Math.min(tlo, p.Tmin); thi = Math.max(thi, p.Tmax); }
  tlo = Math.min(tlo, 240); thi = Math.max(thi, 320);
  const pad2 = (thi - tlo) * 0.08;
  tlo -= pad2; thi += pad2;
  const ly = (T) => h - pad.b - ((T - tlo) / (thi - tlo)) * (h - pad.t - pad.b);

  // freezing and boiling references
  for (const [T, lab, c] of [[273.15, '0°C', 'rgba(120,190,255,0.35)'], [373.15, '100°C', 'rgba(255,150,110,0.30)']]) {
    if (T > tlo && T < thi) {
      ctx.strokeStyle = c; ctx.setLineDash([3, 4]); ctx.beginPath();
      ctx.moveTo(pad.l, ly(T)); ctx.lineTo(w - pad.r, ly(T)); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, lab, w - pad.r - 2, ly(T) - 3, 'right', c, 9);
    }
  }

  // Climate epochs, as a band along the bottom. This is the run's own history
  // of itself: which climate the world was in, and for how long. Drawn under
  // the trace rather than over it, because it is context for the temperature
  // and not a thing in front of it.
  const epochs = opts.epochs || [];
  const bandTop = h - pad.b + 1, bandH = 5;
  for (const e of epochs) {
    const a = Math.max(lx(e.from), pad.l), b = Math.min(lx(e.to ?? tMax), w - pad.r);
    if (!(b > a)) continue;
    ctx.fillStyle = e.color;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(a, bandTop, Math.max(b - a, 1), bandH);
    ctx.globalAlpha = 1;
  }

  ctx.beginPath();
  for (let i = 0; i < H.length; i++) ctx[i ? 'lineTo' : 'moveTo'](lx(H[i].t), ly(H[i].Tmax));
  for (let i = H.length - 1; i >= 0; i--) ctx.lineTo(lx(H[i].t), ly(H[i].Tmin));
  ctx.closePath();
  ctx.fillStyle = 'rgba(120,200,255,0.14)'; ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < H.length; i++) ctx[i ? 'lineTo' : 'moveTo'](lx(H[i].t), ly(H[i].T));
  ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 1.8; ctx.stroke();

  label(ctx, `${(thi - 273.15).toFixed(0)}°C`, pad.l - 4, pad.t + 8, 'right');
  label(ctx, `${(tlo - 273.15).toFixed(0)}°C`, pad.l - 4, h - pad.b, 'right');
  // Milestones, as flags standing on the timeline. A checkpoint you cannot see
  // is one you have to remember the time of, which is the opposite of the point.
  for (const m of (opts.marks || [])) {
    const mx = lx(m.t);
    if (mx < pad.l - 1 || mx > w - pad.r + 1) continue;
    ctx.strokeStyle = 'rgba(255,196,107,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx, pad.t); ctx.lineTo(mx, h - pad.b); ctx.stroke();
    ctx.fillStyle = 'rgba(255,196,107,0.9)';
    ctx.beginPath();
    ctx.moveTo(mx, pad.t); ctx.lineTo(mx + 7, pad.t + 3); ctx.lineTo(mx, pad.t + 6);
    ctx.closePath(); ctx.fill();
  }

  // What the window is showing, when it is not showing all of it. Without this
  // a zoomed axis is a chart with no scale, and the reading is a guess.
  if (win.t0 > 0 || zoom > 1) {
    label(ctx, fmtSpan(win.t0), pad.l + 2, h - 5, 'left', 'rgba(233,240,255,0.45)', 9);
  }
  label(ctx, zoom > 1 ? `${fmtSpan(win.t1)} →` : t('time →'), w - pad.r, h - 5, 'right');
  label(ctx, t('surface temperature'), pad.l + 4, pad.t + 8, 'left', 'rgba(233,240,255,0.4)');

  // The scrub handle, drawn last so it sits over the trace. Everything to the
  // right of it is the future being abandoned, dimmed to say so.
  if (markT != null) {
    const mx = lx(markT);
    ctx.fillStyle = 'rgba(8,12,20,0.55)';
    ctx.fillRect(mx, pad.t, Math.max(0, w - pad.r - mx), h - pad.t - pad.b);
    ctx.strokeStyle = '#f0d9b8'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mx, pad.t); ctx.lineTo(mx, h - pad.b); ctx.stroke();
    ctx.fillStyle = '#f0d9b8';
    ctx.beginPath(); ctx.arc(mx, pad.t + 3, 3, 0, Math.PI * 2); ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Zonal temperature profile.
// ---------------------------------------------------------------------------
// The x geometry of the zonal profile, in one place, because the hover readout
// has to agree with the drawing to the pixel or it reads the wrong band.
const PROFILE_PAD = { l: 38, r: 8, t: 10, b: 20 };

// Which of the eighteen bands a pointer at `x` css-pixels is over.
export function profileBandAtX(x, width) {
  const span = Math.max(width - PROFILE_PAD.l - PROFILE_PAD.r, 1);
  const f = (x - PROFILE_PAD.l) / span;
  return clamp(Math.round(f * (NBANDS - 1)), 0, NBANDS - 1);
}

export function drawProfile(canvas, world, hover = null) {
  const { ctx, w, h } = setup(canvas);
  const pad = PROFILE_PAD;
  axes(ctx, w, h, pad);
  const lam = lockFactor(world.params);
  const T = world.T;
  let lo = Math.min(...T), hi = Math.max(...T);
  lo = Math.min(lo, 250); hi = Math.max(hi, 300);
  const m = (hi - lo) * 0.1; lo -= m; hi += m;
  const px = (i) => pad.l + (i / (NBANDS - 1)) * (w - pad.l - pad.r);
  const py = (t) => h - pad.b - ((t - lo) / (hi - lo)) * (h - pad.t - pad.b);

  if (273.15 > lo && 273.15 < hi) {
    ctx.strokeStyle = 'rgba(120,190,255,0.3)'; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, py(273.15)); ctx.lineTo(w - pad.r, py(273.15)); ctx.stroke();
    ctx.setLineDash([]);
  }

  // shade the frozen fraction of each band
  for (let i = 0; i < NBANDS; i++) {
    const f = iceFraction(T[i]) * (world.diag.hasWater ? world.diag.waterCap * 0.7 + 0.3 : 0);
    if (f > 0.02) {
      ctx.fillStyle = `rgba(200,232,255,${0.05 + 0.20 * f})`;
      const x0 = pad.l + ((i - 0.5) / (NBANDS - 1)) * (w - pad.l - pad.r);
      ctx.fillRect(x0, pad.t, (w - pad.l - pad.r) / (NBANDS - 1), h - pad.t - pad.b);
    }
  }

  ctx.beginPath();
  for (let i = 0; i < NBANDS; i++) ctx[i ? 'lineTo' : 'moveTo'](px(i), py(T[i]));
  ctx.strokeStyle = '#ffc46b'; ctx.lineWidth = 2; ctx.stroke();
  for (let i = 0; i < NBANDS; i++) {
    ctx.beginPath(); ctx.arc(px(i), py(T[i]), 2, 0, 7); ctx.fillStyle = '#ffc46b'; ctx.fill();
  }

  // The band under the pointer, marked so that the number in the tooltip has a
  // place on the curve rather than being a figure beside a picture.
  if (hover != null && hover >= 0 && hover < NBANDS) {
    ctx.strokeStyle = 'rgba(255,196,107,0.35)';
    ctx.beginPath(); ctx.moveTo(px(hover), pad.t); ctx.lineTo(px(hover), h - pad.b); ctx.stroke();
    ctx.beginPath(); ctx.arc(px(hover), py(T[hover]), 4.5, 0, 7);
    ctx.fillStyle = '#fff'; ctx.fill();
  }

  label(ctx, `${(hi - 273.15).toFixed(0)}°C`, pad.l - 4, pad.t + 8, 'right');
  label(ctx, `${(lo - 273.15).toFixed(0)}°C`, pad.l - 4, h - pad.b, 'right');
  if (lam > 0.5) {
    label(ctx, t('anti-stellar'), pad.l, h - 6, 'left');
    label(ctx, t('substellar'), w - pad.r, h - 6, 'right');
  } else {
    label(ctx, t('S pole'), pad.l, h - 6, 'left');
    label(ctx, t('equator'), (pad.l + w - pad.r) / 2, h - 6, 'center');
    label(ctx, t('N pole'), w - pad.r, h - 6, 'right');
  }
}

// ---------------------------------------------------------------------------
// Water inventory over time: ocean / ice / vapour / lost to space.
// ---------------------------------------------------------------------------
export function drawWater(canvas, world) {
  const { ctx, w, h } = setup(canvas);
  // Room above the plot for the legend. It used to sit inside the plot at 55%
  // opacity in 9px type, over the data, which made it unreadable against the
  // pale ice bands it was drawn on top of.
  const pad = { l: 38, r: 8, t: 26, b: 18 };
  const H = world.history;
  axes(ctx, w, h, pad);
  const inv = world.water;
  const total = Math.max(world.waterInitial ?? world.params.water,
                         inv.ocean + inv.seaIce + inv.landIce + inv.vapour + inv.lost);
  if (total <= 0 || H.length < 2) {
    label(ctx, t(total <= 0 ? 'no water on this world' : 'collecting…'), w / 2, h / 2, 'center');
    return;
  }
  const tMax = Math.max(world.time, 10);
  const lx = (t) => pad.l + (Math.log10(Math.max(t, 1) + 1) / Math.log10(tMax + 1)) * (w - pad.l - pad.r);
  const ly = (v) => h - pad.b - (v / total) * (h - pad.t - pad.b);

  // Cumulative bands, bottom to top. `sup` is the airborne water that has
  // crossed the critical point: physically the same fluid as the vapour below
  // it, but a state worth seeing separately.
  const layers = [
    ['ocean',         '#2f8fd6', (p) => p.ocean],
    ['sea ice',       '#9fd4ec', (p) => p.ocean + (p.seaIce || 0)],
    ['land ice',      '#e6f3fb', (p) => p.ocean + (p.seaIce || 0) + (p.landIce || 0)],
    ['vapour',        '#e8c07a', (p) => p.ocean + (p.seaIce || 0) + (p.landIce || 0) + (p.vap || 0)],
    ['supercritical', '#c98ad0', (p) => p.ocean + (p.seaIce || 0) + (p.landIce || 0) + (p.vap || 0) + (p.sup || 0)],
    ['lost',          'rgba(255,90,60,0.55)',
      (p) => p.ocean + (p.seaIce || 0) + (p.landIce || 0) + (p.vap || 0) + (p.sup || 0) + p.lost],
  ];
  for (let k = layers.length - 1; k >= 0; k--) {
    const [, c, fn] = layers[k];
    ctx.beginPath();
    ctx.moveTo(lx(H[0].t), h - pad.b);
    for (const p of H) ctx.lineTo(lx(p.t), ly(Math.min(fn(p), total)));
    ctx.lineTo(lx(H[H.length - 1].t), h - pad.b);
    ctx.closePath(); ctx.fillStyle = c; ctx.fill();
  }
  label(ctx, `${total.toFixed(2)} EO`, pad.l - 4, pad.t + 8, 'right');
  label(ctx, '0', pad.l - 4, h - pad.b, 'right');

  // Legend, with where the water actually is right now. Reading a stacked area
  // chart to the nearest percent is not possible, and the number is the thing
  // most worth knowing.
  const now = H[H.length - 1];
  const share = [now.ocean, now.seaIce || 0, now.landIce || 0,
                 now.vap || 0, now.sup || 0, now.lost];
  const swatch = ['#2f8fd6', '#9fd4ec', '#e6f3fb', '#e8c07a', '#c98ad0', '#ff5a3c'];
  // Drop reservoirs that are empty and staying empty, so the row does not run
  // off the end of a narrow panel with five zeroes on it.
  const shown = layers.map((l, i) => ({ name: t(l[0]), c: swatch[i], v: share[i] }))
                      .filter((e) => e.v / total >= 5e-4);
  ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
  const wOf = (e) => 9 + 4 + ctx.measureText(`${e.name} ${pct(e.v / total)}`).width + 10;
  let need = shown.reduce((a, e) => a + wOf(e), 0);
  // If it will not fit, show the largest few rather than truncating mid-word.
  const room = w - pad.l - pad.r;
  const list = shown.slice();
  while (need > room && list.length > 1) {
    let smallest = 0;
    for (let i = 1; i < list.length; i++) if (list[i].v < list[smallest].v) smallest = i;
    need -= wOf(list[smallest]);
    list.splice(smallest, 1);
  }
  let x = pad.l + 2;
  for (const e of list) {
    ctx.fillStyle = e.c; ctx.fillRect(x, 6, 9, 9);
    label(ctx, `${e.name} ${pct(e.v / total)}`, x + 13, 14, 'left', 'rgba(233,240,255,0.92)', 10);
    x += wOf(e);
  }
}

// A share as a percentage, with enough precision near zero to show that a
// reservoir is draining rather than already empty.
function pct(f) {
  const p = f * 100;
  if (p >= 99.95) return '100%';
  if (p >= 10) return `${p.toFixed(0)}%`;
  if (p >= 1) return `${p.toFixed(1)}%`;
  if (p > 0) return `${p.toFixed(2)}%`;
  return '0%';
}

// ---------------------------------------------------------------------------
// The phase diagram: absorbed sunlight against outgoing longwave, as functions
// of temperature. Where they cross is an equilibrium. The flat top of the OLR
// curve is the Simpson-Nakajima limit -- lift the absorbed curve above it and
// the crossings vanish, which *is* the runaway greenhouse.
// ---------------------------------------------------------------------------
export function drawPhase(canvas, world) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 40, r: 10, t: 12, b: 22 };
  axes(ctx, w, h, pad);
  const p = world.params, dg = world.diag;
  const T0 = 240, T1 = 420;
  const px = (T) => pad.l + ((T - T0) / (T1 - T0)) * (w - pad.l - pad.r);

  const Sglobal = dg.S.reduce((a, b) => a + b, 0) / NBANDS;
  const pts = [];
  let fmax = 0;
  for (let T = T0; T <= T1; T += 2) {
    const pw = Math.min(dg.RH * psatH2O(T) / 1e5, dg.totalWater * dg.d.eoColumn * dg.g / 1e5);
    const pTot = dg.pN2 + dg.pCO2 + dg.pCH4 + (dg.pH2 ?? 0) + (dg.pHe ?? 0) + pw;
    const O = olr(T, dg.pCO2, pw, dg.pCH4, pTot, dg.pH2 ?? 0, dg.g, dg.pHe ?? 0);
    const a = planetaryAlbedo(T, {
      oceanFrac: dg.oceanFrac, landAlbedo: p.landAlbedo, hasWater: dg.hasWater,
      waterCap: dg.waterCap, pH2O: pw, pTot, slowness: dg.slowness, subStellar: 0.4,
    });
    // Interior heat counts here too. The caption under this chart promises that
    // where the curves cross is where the climate rests, and on a tidally
    // heated world a sunlight-only curve crosses somewhere the planet is not.
    const A = Sglobal * (1 - a.albedo) + (dg.Fint ?? 0);
    pts.push([T, O, A]);
    fmax = Math.max(fmax, O, A);
  }
  fmax = Math.max(fmax, 60) * 1.08;
  const py = (F) => h - pad.b - (F / fmax) * (h - pad.t - pad.b);

  const line = (idx, color, width) => {
    ctx.beginPath();
    pts.forEach((q, i) => ctx[i ? 'lineTo' : 'moveTo'](px(q[0]), py(q[idx])));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  line(1, '#ff9d5c', 2);   // OLR
  line(2, '#7fd4ff', 2);   // absorbed

  // equilibria
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1][2] - pts[i - 1][1], b = pts[i][2] - pts[i][1];
    if (a === 0 || (a > 0) !== (b > 0)) {
      const t = a / (a - b);
      const T = pts[i - 1][0] + t * 2;
      const F = pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]);
      const stable = a > 0;
      ctx.beginPath(); ctx.arc(px(T), py(F), 4, 0, 7);
      ctx.fillStyle = stable ? '#4ec98a' : 'rgba(255,255,255,0.25)';
      ctx.fill();
      ctx.strokeStyle = stable ? '#4ec98a' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
  }

  // current state
  ctx.beginPath(); ctx.arc(px(clamp(dg.Tmean, T0, T1)), py(clamp(dg.emitted, 0, fmax)), 3.5, 0, 7);
  ctx.fillStyle = '#fff'; ctx.fill();

  label(ctx, t('OLR'), px(T1) - 4, py(pts[pts.length - 1][1]) - 6, 'right', '#ff9d5c', 10);
  label(ctx, t('absorbed'), px(T0) + 6, py(pts[0][2]) - 6, 'left', '#7fd4ff', 10);
  label(ctx, `${fmax.toFixed(0)} W/m²`, pad.l - 4, pad.t + 8, 'right');
  label(ctx, '-30°C', px(243), h - 6, 'center');
  label(ctx, '60°C', px(333), h - 6, 'center');
  label(ctx, '145°C', px(418), h - 6, 'center');
}
