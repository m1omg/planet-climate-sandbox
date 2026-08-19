import { SIGMA, clamp, smoothstep, psatH2O, EO_COLUMN, YEAR, G_EARTH, CO2_EARTH_COL } from './constants.js';
import { olr, planetaryAlbedo, iceFraction } from './radiation.js';
import { derive } from './planet.js';

export const NBANDS = 18;

// Equal-area grid in x. For a fast rotator x = sin(latitude); for a tidally
// locked world x = cos(angle from the substellar point), which turns the same
// solver into a substellar-to-antistellar model and produces eyeball states.
export const X = new Float64Array(NBANDS);
export const DX = 2 / NBANDS;
for (let i = 0; i < NBANDS; i++) X[i] = -1 + DX * (i + 0.5);

const CP_WATER = 4200, RHO_WATER = 1000;
const C_LAND = 6.0e6;          // J/m^2/K, a few metres of rock
const L_VAP = 2.4e6;           // J/kg
const MIXED_LAYER = 60;        // m

// Fraction of the surface under dry descending air, and how humid that air is.
export const FIN_FRACTION = 0.18, RH_DRY = 0.20;

export function createWorld(params) {
  const w = {
    params: { ...params },
    T: new Float64Array(NBANDS),
    time: 0,                    // years
    co2: 0, n2: 0, ch4: 0, o2: 0,   // column masses, kg/m^2
    co2Frozen: 0,
    water: { ocean: 0, ice: 0, vapour: 0, lost: 0 },  // Earth oceans
    diag: null,
    history: [],
  };
  resetWorld(w, params);
  return w;
}

export function resetWorld(w, params) {
  w.params = { ...params };
  const d = derive(w.params);
  w.time = 0;
  w.n2 = params.n2Bar * 1e5 / d.g;
  w.co2 = params.co2Bar * 1e5 / d.g;
  w.ch4 = params.ch4Bar * 1e5 / d.g;
  w.o2 = 0;
  w.co2Frozen = 0;
  w.water = { ocean: params.water, ice: 0, vapour: 0, lost: 0 };
  // The inventory the world started with. The `water` control tracks what is
  // left, so charts and classification need this as a fixed reference.
  w.waterInitial = params.water;
  const T0 = params.startT ?? 288;
  for (let i = 0; i < NBANDS; i++) w.T[i] = T0;
  w.history = [];
  update(w, 0);
}

// How synchronised the world is: 0 = fast rotator, 1 = tidally locked.
export function lockFactor(p) {
  if (p.tidallyLocked) return 1;
  return smoothstep(240, 4000, p.rotationHours);
}

// Annual-mean insolation shape. s2 = -0.477 at Earth's 23.5 deg obliquity.
function s2Coefficient(obliquityDeg) {
  const s = Math.sin(obliquityDeg * Math.PI / 180);
  return clamp(0.912 * (3 * s * s - 1), -0.95, 1.9);
}

export function insolationProfile(p) {
  const F = p.insolation * 1361;
  const lam = lockFactor(p);
  const s2 = s2Coefficient(p.obliquity);
  const out = new Float64Array(NBANDS);
  for (let i = 0; i < NBANDS; i++) {
    const x = X[i];
    const fast = F / 4 * (1 + s2 * 0.5 * (3 * x * x - 1));
    const locked = F * Math.max(0, x);
    out[i] = Math.max(0, (1 - lam) * fast + lam * locked);
  }
  return out;
}

// Meridional (or day-night) heat transport. Thicker air moves more heat, slower
// rotation widens the circulation cells, and -- the big one near the inner edge
// -- a humid atmosphere carries enormous latent heat poleward. That is the
// long-standing "equable climate" result: warm worlds have weak equator-to-pole
// gradients, so the whole planet approaches the runaway limit together instead
// of the tropics tipping over on their own.
export function diffusionCoefficient(p, pTot, pH2O = 0) {
  const rot = clamp(Math.pow(p.rotationHours / 24, 0.25), 0.55, 3.5);
  const latent = 1 + 4 * Math.max(0, Math.tanh((pH2O - 0.02) / 0.15));
  return 0.58 * clamp(Math.pow(pTot, 0.9), 0.02, 12) * rot * latent;
}

// ---------------------------------------------------------------------------
// Diagnostics: everything the temperature tendency and the UI need.
// ---------------------------------------------------------------------------
export function update(w, dt) {
  const p = w.params;
  const d = derive(w.params);
  const g = d.g;

  const pN2 = w.n2 * g / 1e5;
  const pCO2 = w.co2 * g / 1e5;
  const pCH4 = w.ch4 * g / 1e5;
  const pO2 = w.o2 * g / 1e5;

  // Water available to evaporate, as a column and then as pressure
  const totalWater = w.water.ocean + w.water.ice + w.water.vapour;
  const availCol = totalWater * d.eoColumn;

  // How much of the surface is sea. A nearly dry world has scattered seas, and
  // that alone keeps its air unsaturated -- the Abe et al. (2011) dune world.
  const oceanFrac = clamp((1 - p.landFraction) * smoothstep(0, 0.12, w.water.ocean + w.water.vapour), 0, 1);
  const RH = clamp(0.34 + 0.44 * oceanFrac, 0.15, 0.85);

  // Demanded vapour per band, then rescaled if the planet hasn't got the water
  const demand = new Float64Array(NBANDS);
  let totalDemand = 0;
  for (let i = 0; i < NBANDS; i++) {
    demand[i] = RH * psatH2O(w.T[i]) / g;   // kg/m^2
    totalDemand += demand[i] / NBANDS;
  }
  const supply = clamp(availCol, 0, 1e12);
  const scale = totalDemand > supply ? supply / Math.max(totalDemand, 1e-30) : 1;

  const pH2O = new Float64Array(NBANDS);
  const pH2Odry = new Float64Array(NBANDS);
  let vapCol = 0;
  for (let i = 0; i < NBANDS; i++) {
    const col = demand[i] * scale;
    pH2O[i] = col * g / 1e5;
    // The dry, subsiding half of the Hadley circulation. Its unsaturated air
    // radiates straight to space above the classical runaway limit, which is
    // exactly why 3-D models push the inner edge outward relative to 1-D ones
    // (Leconte et al. 2013; Wolf & Toon 2014).
    pH2Odry[i] = pH2O[i] * (RH_DRY / RH);
    vapCol += col / NBANDS;
  }

  const S = insolationProfile(p);
  const lam = lockFactor(p);
  const slowness = clamp(smoothstep(24, 1500, p.rotationHours), 0, 1) * 0.5 + lam * 0.5;

  const alb = new Float64Array(NBANDS), out = new Float64Array(NBANDS);
  const cloud = new Float64Array(NBANDS), pTotArr = new Float64Array(NBANDS);
  const hasWater = totalWater > 1e-5;
  const waterCap = smoothstep(0.004, 0.12, totalWater);
  let Tmean = 0, iceMean = 0, absorbed = 0, emitted = 0, pTotMean = 0;

  for (let i = 0; i < NBANDS; i++) {
    const pTot = pN2 + pCO2 + pCH4 + pO2 + pH2O[i];
    pTotArr[i] = pTot;
    const subStellar = lam > 0.01 ? clamp(X[i], 0, 1) : 0.35;
    const a = planetaryAlbedo(w.T[i], {
      oceanFrac, landAlbedo: p.landAlbedo, hasWater, waterCap,
      pH2O: pH2O[i], pTot, slowness, subStellar,
    });
    alb[i] = a.albedo; cloud[i] = a.cloud;
    const moistOLR = olr(w.T[i], pCO2, pH2O[i], pCH4, pTot);
    const dryOLR = olr(w.T[i], pCO2, pH2Odry[i], pCH4, pTot);
    out[i] = (1 - FIN_FRACTION) * moistOLR + FIN_FRACTION * dryOLR;
    Tmean += w.T[i] / NBANDS;
    iceMean += (hasWater ? iceFraction(w.T[i]) : 0) / NBANDS;
    absorbed += S[i] * (1 - alb[i]) / NBANDS;
    emitted += out[i] / NBANDS;
    pTotMean += pTot / NBANDS;
  }

  // Effective heat capacity. Three pieces, and the last two are why a runaway
  // greenhouse takes ~10^5 years instead of happening on screen instantly:
  //   1. mixed layer (or the *whole* ocean once it starts boiling through)
  //   2. the atmosphere itself, which is enormous in a thick steam envelope
  //   3. latent heat: every extra kelvin evaporates more sea, and near the
  //      runaway that dwarfs everything else.
  const C = new Float64Array(NBANDS);
  const oceanDepth = w.water.ocean * d.eoColumn / RHO_WATER;
  for (let i = 0; i < NBANDS; i++) {
    const deep = MIXED_LAYER + Math.max(0, oceanDepth - MIXED_LAYER) * smoothstep(315, 350, w.T[i]);
    const cOcean = deep * RHO_WATER * CP_WATER * (1 - 0.9 * (hasWater ? iceFraction(w.T[i]) : 0));
    const cAtm = pTotArr[i] * 1e5 / g * 1000;
    let cLat = 0;
    if (hasWater && scale > 0.999) {
      const T = w.T[i];
      const dps = (psatH2O(T + 0.5) - psatH2O(T - 0.5));  // Pa/K
      cLat = L_VAP * RH * dps / g;
    }
    C[i] = clamp(oceanFrac * cOcean + (1 - oceanFrac) * C_LAND + cAtm + cLat, 1e5, 1e14);
  }

  w.diag = {
    g, d, pN2, pCO2, pCH4, pO2, pH2O, pTot: pTotArr, pTotMean,
    S, alb, olr: out, cloud, C, oceanFrac, RH, humidityScale: scale, waterCap, pH2Odry,
    Tmean, iceMean, absorbed, emitted, imbalance: absorbed - emitted,
    hasWater, vapourCol: vapCol, lam, slowness, totalWater,
    Tmax: Math.max(...w.T), Tmin: Math.min(...w.T),
  };
  return w.diag;
}

// Temperature tendency in K/s, including transport.
export function tendency(w) {
  const dg = w.diag, p = w.params;
  const pH2Omean = dg.pH2O.reduce((a, b) => a + b, 0) / NBANDS;
  const D = diffusionCoefficient(p, dg.pTotMean, pH2Omean);
  const dT = new Float64Array(NBANDS);
  const flux = new Float64Array(NBANDS + 1);
  for (let j = 1; j < NBANDS; j++) {
    const xe = -1 + DX * j;
    flux[j] = D * (1 - xe * xe) * (w.T[j] - w.T[j - 1]) / DX;
  }
  for (let i = 0; i < NBANDS; i++) {
    const transport = (flux[i + 1] - flux[i]) / DX;
    dT[i] = (dg.S[i] * (1 - dg.alb[i]) - dg.olr[i] + transport) / dg.C[i];
  }
  return { dT, D };
}

// Largest step we may take: bounded by how fast anything is actually moving,
// never by the frame rate. Returned in years.
export function maxStep(w, maxDeltaT = 1.0) {
  const { dT, D } = tendency(w);
  const dg = w.diag;
  const k = dampingRates(w, D);

  let worst = 0, eqDistance = 0, minDamping = Infinity;
  for (let i = 0; i < NBANDS; i++) {
    minDamping = Math.min(minDamping, k.raw[i]);
    // Allow a slightly coarser step on a very hot planet: one kelvin out of 900
    // is not a resolvable change, and it keeps a runaway affordable to watch.
    const allow = Math.max(maxDeltaT, 0.004 * w.T[i]);
    worst = Math.max(worst, Math.abs(dT[i]) / allow);
    // How far this band still is from the equilibrium it is relaxing towards,
    // in kelvin: rate of change times the local relaxation time.
    eqDistance = Math.max(eqDistance, Math.abs(dT[i]) * dg.C[i] / k[i]);
  }
  if (worst < 1e-18) return 5e6;
  let dt = clamp(1 / worst / YEAR, 2e-3, 5e6);

  // Quasi-static shortcut. Once every band sits within a kelvin or two of its
  // equilibrium, the temperatures are slaved to the slow reservoirs and the
  // unconditionally stable solver can stride over millennia at a time without
  // changing the answer. This is what makes a billion-year run affordable.
  //
  // It must not engage where the radiative damping has gone weak or negative:
  // that is precisely a runaway greenhouse, the equilibrium the linearisation
  // would relax towards does not exist, and striding over it would invent a
  // stable climate that the real planet does not have.
  const quasi = smoothstep(6, 1, eqDistance) * smoothstep(0.10, 0.45, minDamping);
  if (quasi > 0) dt = Math.min(dt * (1 + quasi * 4000), 5e6);

  // ...but never step so far that a slow reservoir jumps discontinuously.
  const esc = w.escape;
  if (esc && esc.water > 0 && dg.totalWater > 0) {
    dt = Math.min(dt, Math.max(0.05 * dg.totalWater * dg.d.eoColumn / esc.water, 1.0));
  }
  // The CO2 reservoir is integrated semi-implicitly, so it needs only a loose
  // bound -- and that bound is measured against a floor, because a planet whose
  // CO2 has been weathered away to nothing must not drag the clock down with it.
  if (w.weathering) {
    const net = Math.abs(w.weathering.V - w.weathering.W) / Math.max(w.weathering.kappa, 1);
    const floor = 0.02 * CO2_EARTH_COL;
    if (net > 0) dt = Math.min(dt, Math.max(0.25 * (w.co2 + floor) / net, 1.0));
  }
  return dt;
}

// How stiffly each band resists a temperature change: dOLR/dT plus the
// diffusion diagonal. Shared by the implicit step and the step-size chooser.
export function dampingRates(w, D) {
  const dg = w.diag;
  const k = new Float64Array(NBANDS);
  const raw = new Float64Array(NBANDS);
  for (let i = 0; i < NBANDS; i++) {
    const T = w.T[i];
    // Local radiative damping dOLR/dT, plus the diffusion diagonal. The
    // derivative has to follow the humidity as well as the temperature: in a
    // steam atmosphere water vapour responds so violently to a kelvin that
    // holding it fixed here leaves the solver oscillating forever.
    const h = 0.5;
    const scale = dg.humidityScale;
    const pw = (t) => Math.min(dg.pH2O[i] * (psatH2O(t) / Math.max(psatH2O(T), 1e-12)),
                               scale < 0.999 ? dg.pH2O[i] : Infinity);
    const pwHi = pw(T + h), pwLo = pw(T - h);
    const ptHi = dg.pTot[i] - dg.pH2O[i] + pwHi, ptLo = dg.pTot[i] - dg.pH2O[i] + pwLo;
    const dOLR = (olr(T + h, dg.pCO2, pwHi, dg.pCH4, ptHi)
                - olr(T - h, dg.pCO2, pwLo, dg.pCH4, ptLo)) / (2 * h);
    // The shortwave side matters just as much, and it points the other way:
    // melting ice and darkening steam make a warming planet absorb *more*.
    // Leaving this out lets the solver believe in equilibria that do not exist.
    const albOpts = (t, pwx, ptx) => planetaryAlbedo(t, {
      oceanFrac: dg.oceanFrac, landAlbedo: w.params.landAlbedo, hasWater: dg.hasWater,
      waterCap: dg.waterCap, pH2O: pwx, pTot: ptx, slowness: dg.slowness,
      subStellar: dg.lam > 0.01 ? clamp(X[i], 0, 1) : 0.35,
    }).albedo;
    const dABS = dg.S[i] * (albOpts(T - h, pwLo, ptLo) - albOpts(T + h, pwHi, ptHi)) / (2 * h);
    const xl = -1 + DX * i, xr = -1 + DX * (i + 1);
    const diag = D * ((1 - xr * xr) + (1 - xl * xl)) / (DX * DX);
    raw[i] = dOLR - dABS + diag;
    k[i] = Math.max(0.05, raw[i]);
  }
  k.raw = raw;
  return k;
}

// Semi-implicit (linearised backward Euler) temperature step: unconditionally
// stable, so a quiet planet can be advanced in million-year strides while a
// planet in transition automatically drops to short steps.
export function stepTemperature(w, dtYears) {
  const dt = dtYears * YEAR;
  const dg = w.diag;
  const { dT, D } = tendency(w);
  const k = dampingRates(w, D);
  const Tn = new Float64Array(NBANDS);
  for (let i = 0; i < NBANDS; i++) {
    Tn[i] = w.T[i] + dt * dT[i] / (1 + dt * k[i] / dg.C[i]);
  }
  for (let i = 0; i < NBANDS; i++) w.T[i] = clamp(Tn[i], 2, 4000);
}
