import { NBANDS, X, lockFactor, insolationProfile } from '../physics/climate.js';
import { olr, planetaryAlbedo, iceFraction } from '../physics/radiation.js';
import { psatH2O, clamp } from '../physics/constants.js';

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
export function drawHistory(canvas, world) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 38, r: 8, t: 10, b: 18 };
  const H = world.history;
  axes(ctx, w, h, pad);
  if (H.length < 2) { label(ctx, 'collecting…', w / 2, h / 2, 'center'); return; }

  const tMax = Math.max(world.time, 10);
  const lx = (t) => pad.l + (Math.log10(Math.max(t, 1) + 1) / Math.log10(tMax + 1)) * (w - pad.l - pad.r);
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
  label(ctx, 'time →', w - pad.r, h - 5, 'right');
  label(ctx, 'surface temperature', pad.l + 4, pad.t + 8, 'left', 'rgba(233,240,255,0.4)');
}

// ---------------------------------------------------------------------------
// Zonal temperature profile.
// ---------------------------------------------------------------------------
export function drawProfile(canvas, world) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 38, r: 8, t: 10, b: 20 };
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

  label(ctx, `${(hi - 273.15).toFixed(0)}°C`, pad.l - 4, pad.t + 8, 'right');
  label(ctx, `${(lo - 273.15).toFixed(0)}°C`, pad.l - 4, h - pad.b, 'right');
  if (lam > 0.5) {
    label(ctx, 'anti-stellar', pad.l, h - 6, 'left');
    label(ctx, 'substellar', w - pad.r, h - 6, 'right');
  } else {
    label(ctx, 'S pole', pad.l, h - 6, 'left');
    label(ctx, 'equator', (pad.l + w - pad.r) / 2, h - 6, 'center');
    label(ctx, 'N pole', w - pad.r, h - 6, 'right');
  }
}

// ---------------------------------------------------------------------------
// Water inventory over time: ocean / ice / vapour / lost to space.
// ---------------------------------------------------------------------------
export function drawWater(canvas, world) {
  const { ctx, w, h } = setup(canvas);
  const pad = { l: 38, r: 8, t: 10, b: 18 };
  const H = world.history;
  axes(ctx, w, h, pad);
  const w = world.water;
  const total = Math.max(world.waterInitial ?? world.params.water,
                         w.ocean + w.ice + w.vapour + w.lost);
  if (total <= 0 || H.length < 2) {
    label(ctx, total <= 0 ? 'no water on this world' : 'collecting…', w / 2, h / 2, 'center');
    return;
  }
  const tMax = Math.max(world.time, 10);
  const lx = (t) => pad.l + (Math.log10(Math.max(t, 1) + 1) / Math.log10(tMax + 1)) * (w - pad.l - pad.r);
  const ly = (v) => h - pad.b - (v / total) * (h - pad.t - pad.b);

  const layers = [
    ['ocean', '#2f8fd6', (p) => p.ocean],
    ['iceW', '#bfe4f5', (p) => p.ocean + p.iceW],
    ['vap', '#e8c07a', (p) => p.ocean + p.iceW + p.vap],
    ['lost', 'rgba(255,90,60,0.55)', (p) => p.ocean + p.iceW + p.vap + p.lost],
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
  const lg = [['ocean', '#2f8fd6'], ['ice', '#bfe4f5'], ['vapour', '#e8c07a'], ['lost', '#ff5a3c']];
  let x = pad.l + 4;
  for (const [n, c] of lg) {
    ctx.fillStyle = c; ctx.fillRect(x, pad.t + 2, 7, 7);
    label(ctx, n, x + 10, pad.t + 9, 'left', 'rgba(233,240,255,0.6)', 9);
    x += 12 + ctx.measureText(n).width + 10;
  }
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
    const pTot = dg.pN2 + dg.pCO2 + dg.pCH4 + pw;
    const O = olr(T, dg.pCO2, pw, dg.pCH4, pTot);
    const a = planetaryAlbedo(T, {
      oceanFrac: dg.oceanFrac, landAlbedo: p.landAlbedo, hasWater: dg.hasWater,
      waterCap: dg.waterCap, pH2O: pw, pTot, slowness: dg.slowness, subStellar: 0.4,
    });
    const A = Sglobal * (1 - a.albedo);
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

  label(ctx, 'OLR', px(T1) - 4, py(pts[pts.length - 1][1]) - 6, 'right', '#ff9d5c', 10);
  label(ctx, 'absorbed', px(T0) + 6, py(pts[0][2]) - 6, 'left', '#7fd4ff', 10);
  label(ctx, `${fmax.toFixed(0)} W/m²`, pad.l - 4, pad.t + 8, 'right');
  label(ctx, '-30°C', px(243), h - 6, 'center');
  label(ctx, '60°C', px(333), h - 6, 'center');
  label(ctx, '145°C', px(418), h - 6, 'center');
}
