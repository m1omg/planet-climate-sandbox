import { EARTH } from './presets.js';

// Broad physical domains, not slider limits: evolved worlds can legitimately
// leave the sliders' display ranges. Reject malformed values rather than clamp
// an imported world to a physically different one.
const domains = {
  mass: [0.0001, 100], water: [0, 1e7], insolation: [0, 1e5],
  starTemp: [100, 1e6], rotationHours: [0.001, 1e9], startT: [1, 5000],
  landFraction: [0, 1], landAlbedo: [0, 1], heliumFrac: [0, 1],
  fossilUsed: [0, 1], obliquity: [0, 180], xuvFraction: [0, 1],
  salinity: [0, 300], startAge: [0, 1e6], resurfacingSpan: [0.000001, 1e9],
};
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const bag = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function sanitizeParams(p) {
  const out = {};
  if (!bag(p)) return out;
  for (const [k, v] of Object.entries(p)) {
    if (!own(EARTH, k)) continue;
    const reference = EARTH[k];
    if (typeof reference === 'boolean') { if (typeof v === 'boolean') out[k] = v; continue; }
    if (typeof reference !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi] = domains[k] || [0, 1e12];
    if (v >= lo && v <= hi) out[k] = v;
  }
  return out;
}
export const NUMERIC_FIELDS = ['time','waterInitial','iceSheet','hotLayer','coldT',
  'landIceMass','co2Frozen','otherGHG','aerosol','carbonDeep','bio','fossil',
  'industrial','co2','n2','o2','ch4','h2','he','euk','eukReady','ch4Escape','h2Rate','dtPrev'];
const runtimeScalars = new Set(['dtPrev','trustOver','ringing','lastMove','insolationTarget',
  'insolationRate','weathering','o2Rate','ch4Source','ch4Tau','iceDeep','iceRate',
  'liquidRate','vapourRate','lifeRoom','landIceTarget','trapActive','emitting']);
const runtimeBags = new Set(['escape','o2Flux','iceMark','liquidMark','vapourMark']);
const finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e100;
const safeKey = k => !['__proto__','constructor','prototype'].includes(k);
function numbers(v, signed = true) {
  if (!bag(v)) return undefined;
  return Object.fromEntries(Object.entries(v).filter(([k,x]) =>
    safeKey(k) && finite(x) && (signed || x >= 0)));
}
function runtime(v) {
  if (!bag(v)) return undefined;
  const out = {};
  for (const [k,x] of Object.entries(v)) {
    if (runtimeBags.has(k)) { if (x === null) out[k] = null; else if (numbers(x)) out[k] = numbers(x); }
    else if (runtimeScalars.has(k)) {
      if (x === null) out[k] = null;
      else if (['trapActive','emitting'].includes(k) && typeof x === 'boolean') out[k] = x;
      else if (finite(x) && (k !== 'insolationTarget' || (x >= 0 && x <= 1e5))
        && (!['dtPrev','insolationRate','trustOver','ringing','ch4Tau'].includes(k) || x >= 0)) out[k] = x;
    }
  }
  return out;
}
export function sanitizeWorld(w) {
  if (!bag(w) || !bag(w.params)) return null;
  const out = {};
  for (const [k,v] of Object.entries(w)) {
    if (!safeKey(k) || k === 'params') continue;
    if (NUMERIC_FIELDS.includes(k)) {
      if (v === null) out[k] = null;
      else if (finite(v) && (k === 'h2Rate' || v >= 0)
        && (k !== 'time' || v <= 1e15)) out[k] = v;
    } else if (k === 'T') {
      if (Array.isArray(v) && v.length > 0 && v.length <= 18 && v.every(t => finite(t) && t >= 1 && t <= 5000)) out[k] = v;
    } else if (['water','life','evolve0'].includes(k)) {
      const n = numbers(v, false); if (n) out[k] = k === 'evolve0' ? sanitizeParams(n) : n;
    } else if (k === 'runtime') { const r = runtime(v); if (r) out[k] = r; }
    else if (k === 'seed') { if (finite(v)) out[k] = v; }
    else out[k] = v;
  }
  out.params = sanitizeParams(w.params);
  return out;
}
