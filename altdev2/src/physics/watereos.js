// Water's density at any temperature and pressure the column reaches, and the
// boiling point at a pressure.
//
// Until the cross-section drew the boundary layer under a lid, water only ever
// needed an ocean's density: cold liquid, compressed by depth, which is what
// `waterDensity` in ocean.js is. That boundary runs from supercritical fluid at
// 1500 °C to liquid at 40 °C, and the cold law gave all of it 1000 kg/m^3 --
// on a hot top a tenth as dense, so the drawn pressure across it was out by as
// much as the layer itself weighs.
//
// The numbers are IAPWS-95, tabulated by tools/watereos.py on a grid measured
// from the boiling curve so a liquid lookup never interpolates against steam.
// Held to within 0.8% for liquid and steam, 4% near the critical point.
import { T_CRIT_H2O, P_CRIT_H2O, psatH2O, clamp } from './constants.js';
import { EOS_T_LIQUID, EOS_T_FLUID, EOS_X_LIQUID, EOS_X_FLUID, EOS_LIQUID, EOS_FLUID }
  from './watereos-table.js';

const LOG_PC = Math.log10(P_CRIT_H2O);

// First index i with xs[i] <= v < xs[i+1], clamped to the table.
function cell(xs, v) {
  let lo = 0, hi = xs.length - 2;
  if (v <= xs[0]) return 0;
  if (v >= xs[hi + 1]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid] <= v) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function bilinear(ts, xs, tab, T, x) {
  const i = cell(ts, T), j = cell(xs, x);
  const u = clamp((T - ts[i]) / (ts[i + 1] - ts[i]), 0, 1);
  const v = clamp((x - xs[j]) / (xs[j + 1] - xs[j]), 0, 1);
  return (1 - u) * (1 - v) * tab[i][j] + u * (1 - v) * tab[i + 1][j]
    + (1 - u) * v * tab[i][j + 1] + u * v * tab[i + 1][j + 1];
}

// Density in kg/m^3. `phase` is 'liquid' or 'fluid' (steam, or supercritical
// above the critical temperature, where the two are the same thing). A phase
// asked for where it cannot exist -- liquid above its boiling point, steam
// below it -- reads the saturated value at the boundary: the nearest state
// that is that phase. Past the table's 4000 K the fluid is taken as ideal in
// temperature, which it very nearly is there.
export function waterDensityAt(T, P, phase = 'liquid') {
  if (!(P > 0) || !(T > 0)) return 1000;
  const Tq = Math.max(T, EOS_T_LIQUID[0]);
  const x = Math.log10(P) - (Tq < T_CRIT_H2O ? Math.log10(psatH2O(Tq)) : LOG_PC);
  if (phase === 'liquid' && Tq < T_CRIT_H2O) {
    return 10 ** bilinear(EOS_T_LIQUID, EOS_X_LIQUID, EOS_LIQUID, Tq, Math.max(x, 0));
  }
  const top = EOS_T_FLUID[EOS_T_FLUID.length - 1];
  const xf = Tq < T_CRIT_H2O ? Math.min(x, 0) : x;
  const r = 10 ** bilinear(EOS_T_FLUID, EOS_X_FLUID, EOS_FLUID, Math.min(Tq, top), xf);
  return Tq > top ? r * top / Tq : r;
}

// The boiling point at pressure P (Pa): the inverse of psatH2O, by bisection,
// so the two can never disagree. The critical temperature at and above the
// critical pressure, where there is no boiling left to have a point.
export function boilingPoint(P) {
  if (!(P > 0)) return 273.16;
  if (P >= P_CRIT_H2O) return T_CRIT_H2O;
  let lo = 273.16, hi = T_CRIT_H2O;
  if (psatH2O(lo) >= P) return lo;
  for (let k = 0; k < 50; k++) {
    const mid = 0.5 * (lo + hi);
    if (psatH2O(mid) < P) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// Thermal conductivity of steam and supercritical water, W/m/K: a dilute-gas
// part rising with temperature plus a part carried by density. Within ~20% of
// the IAPWS 2011 formulation from 400 to 1500 K and 0.5 to 700 kg/m^3; it
// misses the critical enhancement, which is a spike a few kelvin wide.
export function steamConductivity(T, rho) {
  return Math.max(1e-4 * T - 0.013, 0.01) + 7e-4 * Math.max(rho, 0);
}
