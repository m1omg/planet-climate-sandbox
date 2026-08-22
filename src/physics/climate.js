import { SIGMA, clamp, smoothstep, psatH2O, EO_COLUMN, YEAR, G_EARTH, CO2_EARTH_COL,
         P_TRIPLE_H2O, T_CRIT_H2O, P_CRIT_H2O } from './constants.js';
import { olr, planetaryAlbedo, iceFraction, landIceFraction, ALB_SEABED,
         hazeOpacity, hazeShortwave } from './radiation.js';
import { derive } from './planet.js';
import { floodedFraction } from './hypsometry.js';

export const NBANDS = 18;

// Water currently in the air, as a fraction of an Earth ocean.
function vapourShare(w, d) {
  return (w.water.vapour || 0);
}

// Water-vapour partial pressure in Pa, from the reservoir rather than from
// saturation, so it is defined before the humidity calculation has run.
function vapourPa(w, g) {
  const d = derive(w.params);
  return (w.water.vapour || 0) * d.eoColumn * g;
}

// Equal-area grid in x. For a fast rotator x = sin(latitude); for a tidally
// locked world x = cos(angle from the substellar point), which turns the same
// solver into a substellar-to-antistellar model and produces eyeball states.
export const X = new Float64Array(NBANDS);
export const DX = 2 / NBANDS;
for (let i = 0; i < NBANDS; i++) X[i] = -1 + DX * (i + 0.5);

const CP_WATER = 4200, RHO_WATER = 1000;
const C_LAND = 6.0e6;          // J/m^2/K, a few metres of rock
const L_VAP = 2.4e6;           // J/kg
const L_FUS = 3.34e5;          // J/kg, latent heat of fusion
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
  w.o2 = (params.o2Bar ?? 0) * 1e5 / d.g;
  w.co2Frozen = 0;
  w.water = { ocean: params.water, seaIce: 0, landIce: 0, vapour: 0, lost: 0 };
  // The inventory the world started with. The `water` control tracks what is
  // left, so charts and classification need this as a fixed reference.
  w.waterInitial = params.water;
  const T0 = params.startT ?? 288;
  for (let i = 0; i < NBANDS; i++) w.T[i] = T0;
  w.history = [];
  w.dtPrev = 0;
  w.iceSheet = null;   // rebuilt from the fresh state on the next update
  w.ch4Source = null;  // the methane the slider asks for becomes the level it holds
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
  // 0.44 W/m^2/K for Earth. Set by the observed equator-to-pole gradient: the
  // annual, zonal mean runs from about +26 C at the equator to -19 C averaged
  // over the two polar caps, and across eighteen equal-area bands that is a
  // spread of roughly 40 K. The old 0.58 flattened it to 24 K, which left the
  // poles too warm to grow ice and gutted the ice-albedo feedback -- an ice age
  // barely registered.
  return 0.44 * clamp(Math.pow(pTot, 0.9), 0.02, 12) * rot * latent;
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
  const totalWater = w.water.ocean + w.water.seaIce + w.water.landIce + w.water.vapour;
  const availCol = totalWater * d.eoColumn;

  // How much of the planet is under water. This is derived, not chosen: it
  // follows from the water actually sitting in the basins and from the basin
  // geometry. Water that has evaporated into the air no longer covers
  // anything, so boiling an ocean uncovers its floor; sea ice floats and still
  // fills its basin, so freezing one does not.
  const basinW = w.water.ocean + w.water.seaIce;
  const flooded = floodedFraction(basinW * d.eoColumn, p.landFraction, d.eoColumn);

  // Frozen share of the flooded area, and what is left open to the sky.
  let frozenShare = 0;
  for (let i = 0; i < NBANDS; i++) frozenShare += iceFraction(w.T[i]) / NBANDS;
  const seaIceFrac = clamp(flooded * frozenShare, 0, flooded);
  const openOcean = clamp(flooded - seaIceFrac, 0, 1);

  // Below the triple point there is no liquid water at any temperature: ice
  // sublimates straight to vapour and standing water boils away. Mars sits just
  // under that line, which is why it has ice and frost but no lakes.
  const pSurfPa = (w.n2 + w.co2 + w.ch4 + w.o2) * g + vapourPa(w, g);
  const liquidAllowed = smoothstep(0.75 * P_TRIPLE_H2O, 1.15 * P_TRIPLE_H2O, pSurfPa);

  // Evaporation comes from open water only. A sea sealed under ice supplies
  // almost nothing, which is what makes a hard snowball genuinely arid -- and
  // what keeps a dry world's air unsaturated, the Abe et al. (2011) dune world.
  const oceanFrac = flooded;
  // Water already in the air is a moisture source under the whole sky, so an
  // ocean that has evaporated completely does not leave an arid planet: the
  // atmosphere *is* the ocean.
  //
  // Counting only the open sea made humidity collapse at the instant the last
  // basin dried. That cut the vapour demand, which condensed the sea straight
  // back, which raised the humidity again -- a period-two flip-flop between 43%
  // flooded and bone dry, worth +-16 W/m^2, that never settled. It is why a wet
  // runaway crawled: the step controller kept seeing a climate lurching by
  // sixteen watts a step and shortening the step to tens of years to resolve it.
  const airborne = clamp((w.water.vapour || 0) / Math.max(totalWater, 1e-12), 0, 1);
  const wetSky = clamp(openOcean * liquidAllowed + airborne, 0, 1);
  const RH = clamp(0.34 + 0.44 * wetSky, 0.15, 0.85);

  // Land uncovered by a sea that has retreated or boiled away is bare ocean
  // floor -- dark basalt, not weathered continental rock -- so a drying world
  // darkens rather than brightens as its basins empty.
  const basinShare = clamp(1 - p.landFraction, 0, 1);
  const exposedBasin = clamp(basinShare - flooded, 0, 1);
  const landTotal = clamp(1 - flooded, 1e-6, 1);
  const effLandAlbedo = (p.landAlbedo * clamp(landTotal - exposedBasin, 0, 1)
                       + ALB_SEABED * exposedBasin) / landTotal;

  // Share of land carrying an ice sheet.
  //
  // Two things gate it. Glaciers need snowfall, so it tracks how much moisture
  // the planet can actually move onto the continents; and they need somewhere
  // cold enough for that snow to survive the summer, which is a good deal colder
  // than the point at which the sea freezes.
  //
  // And it is not instantaneous. An ice sheet is kilometres of ice: it takes
  // tens of thousands of years to build and rather less to collapse, which is
  // the asymmetry behind the sawtooth of the glacial cycles -- slow descent into
  // a glacial, abrupt termination. Painting it on the moment a continent drops
  // below freezing gave the albedo a hair trigger and put the model within a
  // whisker of a runaway snowball. `iceSheet` is a real state variable, advanced
  // once per step in stepVolatiles.
  const moisture = smoothstep(0, 0.05, openOcean + vapourShare(w, d));
  let sheetShare = 0;
  for (let i = 0; i < NBANDS; i++) sheetShare += landIceFraction(w.T[i]) / NBANDS;
  const iceSheetTarget = clamp(sheetShare * moisture, 0, 1);
  if (w.iceSheet == null || !isFinite(w.iceSheet)) w.iceSheet = iceSheetTarget;
  const glaciatedShare = clamp(w.iceSheet, 0, 1);

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

  // Photochemical haze absorbs sunlight high up and lets the surface's own heat
  // straight out, so it cools the ground rather than warming it. `hazeSW` is
  // what is left of the sunlight by the time it gets down there.
  const hazeTau = hazeOpacity(pCH4, pCO2, pO2, p.xuvFraction / 3.4e-6);
  const hazeSW = 1 - hazeShortwave(hazeTau);

  const S = insolationProfile(p);
  const lam = lockFactor(p);
  const slowness = clamp(smoothstep(24, 1500, p.rotationHours), 0, 1) * 0.5 + lam * 0.5;

  const alb = new Float64Array(NBANDS), out = new Float64Array(NBANDS);
  const cloud = new Float64Array(NBANDS), pTotArr = new Float64Array(NBANDS);
  const hasWater = totalWater > 1e-5;
  const waterCap = smoothstep(0.004, 0.12, totalWater);
  let Tmean = 0, iceMean = 0, iceArea = 0, absorbed = 0, emitted = 0, pTotMean = 0;

  for (let i = 0; i < NBANDS; i++) {
    const pTot = pN2 + pCO2 + pCH4 + pO2 + pH2O[i];
    pTotArr[i] = pTot;
    const subStellar = lam > 0.01 ? clamp(X[i], 0, 1) : 0.35;
    const a = planetaryAlbedo(w.T[i], {
      oceanFrac: flooded, landAlbedo: effLandAlbedo, hasWater, waterCap,
      glaciated: glaciatedShare,
      pH2O: pH2O[i], pTot, slowness, subStellar,
    });
    alb[i] = a.albedo; cloud[i] = a.cloud;
    const moistOLR = olr(w.T[i], pCO2, pH2O[i], pCH4, pTot);
    const dryOLR = olr(w.T[i], pCO2, pH2Odry[i], pCH4, pTot);
    out[i] = (1 - FIN_FRACTION) * moistOLR + FIN_FRACTION * dryOLR;
    Tmean += w.T[i] / NBANDS;
    // Two different questions, so two numbers. `iceMean` is how much of the
    // planet is frozen, which is what decides whether this is a snowball.
    // `iceArea` is how much of it is actually *covered* in ice, which is what
    // the albedo sees -- and on a snowball those differ, because continents
    // with no water cycle stay bare frozen rock rather than growing a sheet.
    iceMean += (hasWater ? iceFraction(w.T[i]) : 0) / NBANDS;
    iceArea += (hasWater ? flooded * iceFraction(w.T[i]) + (1 - flooded) * glaciatedShare : 0) / NBANDS;
    absorbed += S[i] * (1 - alb[i]) * hazeSW / NBANDS;
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
  const oceanDepth = (w.water.ocean + w.water.seaIce) * d.eoColumn / RHO_WATER;
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
    // Melting ice absorbs heat without warming anything: 334 kJ/kg, and a
    // snowball is carrying an ocean's worth of it. Leaving it out let a frozen
    // planet deglaciate in eleven years -- fast enough to sail past its own
    // equilibrium and tip into a runaway greenhouse it had no business
    // reaching. With it, breaking a snowball takes a couple of thousand years,
    // which is what the modelling literature finds (Hyde et al. 2000).
    const iceCol = (w.water.seaIce + w.water.landIce) * d.eoColumn;   // kg/m^2
    const cFus = hasWater
      ? L_FUS * iceCol * Math.max(0, iceFraction(w.T[i] - 0.5) - iceFraction(w.T[i] + 0.5))
      : 0;
    // Sea ice decouples the water below from the air above, so a frozen ocean
    // behaves far more like land than like a mixed layer.
    const seal = hasWater ? iceFraction(w.T[i]) : 0;
    const cSea = cOcean * (1 - 0.92 * seal) + C_LAND * 0.92 * seal;
    C[i] = clamp(flooded * cSea + (1 - flooded) * C_LAND + cAtm + cLat + cFus, 1e5, 1e14);
  }

  // Above 647 K and 220.6 bar the liquid and the vapour stop being different
  // things: what is in the air is one supercritical fluid, with no surface and
  // no boiling. It behaves as the atmosphere does and the model treats it as
  // such, which is right -- but calling it "vapour" in the inventory hides the
  // most dramatic thing that has happened to the planet, so track the share.
  // P_CRIT_H2O is in pascals and pTotMean is in bar; mixing them silently gave a
  // threshold ten thousand times too high, so nothing was ever supercritical.
  const pCritBar = P_CRIT_H2O / 1e5;
  const superFrac = clamp(smoothstep(T_CRIT_H2O - 25, T_CRIT_H2O + 25, Tmean)
                        * smoothstep(0.80 * pCritBar, 1.05 * pCritBar, pTotMean), 0, 1);

  w.diag = {
    g, d, pN2, pCO2, pCH4, pO2, pH2O, pTot: pTotArr, pTotMean,
    S, alb, olr: out, cloud, C, oceanFrac, RH, humidityScale: scale, waterCap, pH2Odry,
    flooded, openOcean: openOcean * liquidAllowed, seaIceFrac, frozenShare,
    exposedBasin, effLandAlbedo, liquidAllowed, pSurfPa,
    landFrac: clamp(1 - flooded, 0, 1),
    landIceFrac: clamp((1 - flooded) * glaciatedShare, 0, 1),
    iceSheetTarget,
    glaciatedShare,
    Tmean, iceMean, iceArea, absorbed, emitted, imbalance: absorbed - emitted,
    hasWater, vapourCol: vapCol, lam, slowness, totalWater, superFrac,
    hazeTau, hazeSW,
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
    dT[i] = (dg.S[i] * (1 - dg.alb[i]) * dg.hazeSW - dg.olr[i] + transport) / dg.C[i];
  }
  return { dT, D };
}

// Largest step we may take: bounded by how fast anything is actually moving,
// never by the frame rate. Returned in years.
export function maxStep(w, maxDeltaT = 2.5) {
  const dg = w.diag;
  // maxStep and the step that follows it need the same tendency and the same
  // damping, and both cost eighteen radiative-transfer evaluations. Compute
  // once and hand the result on; the cache is discarded the moment the world
  // state moves.
  const tend = tendency(w);
  const k = radiativeDamping(w);
  const { dT } = tend;
  w._solve = { diag: dg, tend, k };

  let worst = 0, eqDistance = 0, meanDamping = 0;
  for (let i = 0; i < NBANDS; i++) {
    meanDamping += k[i] / NBANDS;
    // Allow a slightly coarser step on a very hot planet: one kelvin out of 900
    // is not a resolvable change, and it keeps a runaway affordable to watch.
    const allow = Math.max(maxDeltaT, 0.004 * w.T[i]);
    worst = Math.max(worst, Math.abs(dT[i]) / allow);
    // How far this band still is from the equilibrium it is relaxing towards,
    // in kelvin: rate of change times the local relaxation time.
    eqDistance = Math.max(eqDistance, Math.abs(dT[i]) * dg.C[i] / Math.max(k[i], 0.05));
  }
  if (worst < 1e-18) return 5e6;
  let dt = clamp(1 / worst / YEAR, 2e-3, 5e6);

  // Quasi-static shortcut. Once every band sits within a kelvin or two of its
  // equilibrium, the temperatures are slaved to the slow reservoirs and the
  // unconditionally stable solver can stride over millennia at a time without
  // changing the answer. This is what makes a billion-year run affordable.
  //
  // It must not engage where the radiative feedback has gone weak or negative:
  // that is precisely a runaway greenhouse, the equilibrium the linearisation
  // would relax towards does not exist, and striding over it would invent a
  // stable climate that the real planet does not have.
  //
  // The test is on the planet as a whole, not on its worst band. Around a
  // retreating ice edge a few latitudes always have locally negative feedback
  // -- melting ice darkens them -- while transport from everywhere else holds
  // them stable, and judging by the worst band alone made the solver crawl
  // through exactly the epoch a player most wants to watch.
  const quasi = smoothstep(6, 1, eqDistance) * smoothstep(0.10, 0.45, meanDamping);
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

  // ...and never step so far that the ice sheet jumps straight to where it is
  // heading. It moves on a fifteen-thousand-year timescale and it is what
  // decides which of two stable states a locked world falls into -- trapped
  // desert or twilight world -- so a step long enough to skip that relaxation
  // makes the outcome depend on the step size instead of on the physics. The
  // escape and carbon reservoirs are already bounded this way; this one was
  // not, and a world near the boundary landed in whichever basin the step
  // sequence happened to steer it to.
  if (w.iceSheet != null && dg.iceSheetTarget != null) {
    if (Math.abs(dg.iceSheetTarget - w.iceSheet) > 0.02) dt = Math.min(dt, 3500);
  }

  // Smooth the step size. Near a tipping point -- the ice edge, above all --
  // the instantaneous tendency of a single band flickers between values from
  // one step to the next, and reading the step size straight off it made the
  // solver crawl for millions of simulated years while the climate itself was
  // barely moving. Backward Euler is unconditionally stable here, so the step
  // may be grown steadily and is only cut sharply when something really is
  // changing fast.
  // Low-pass the step size. Backward Euler is unconditionally stable here, so
  // the step is chosen for accuracy rather than stability -- and near a tipping
  // point, above all the ice edge, the instantaneous tendency of a single band
  // flickers from one step to the next, making that accuracy estimate noisy.
  // Reading the step straight off it made the solver crawl for millions of
  // simulated years while the climate itself was barely moving. Smoothing in
  // the log, bounded to a factor of four either way, follows genuine changes
  // while ignoring the flicker.
  //
  // This function must stay free of side effects: the clock asks it what the
  // next step would be before deciding whether it can afford to take one, so
  // recording the answer here would make the sequence depend on where frame
  // boundaries happened to fall. `dtPrev` is advanced in stepOnce instead, once
  // per step actually taken.
  const prev = w.dtPrev;
  if (prev > 0) {
    const smoothed = Math.exp(0.7 * Math.log(dt) + 0.3 * Math.log(prev));
    dt = clamp(smoothed, dt * 0.25, dt * 4);
  }
  return dt;
}

// Radiative damping: how strongly each band's own energy balance resists a
// temperature change, in W/m^2/K. Longwave emission pushes back; the shortwave
// side (melting ice, darkening steam) pushes the other way and can make this
// negative, which is precisely what a runaway greenhouse is.
//
// Diffusion is deliberately NOT included here. It moves heat between bands but
// removes none from the planet, so it cannot damp a uniform warming -- treating
// it as damping was making the whole planet heat thousands of times too slowly.
// It enters the solver below as the off-diagonal terms it actually is.
export function radiativeDamping(w) {
  const dg = w.diag;
  const k = new Float64Array(NBANDS);
  for (let i = 0; i < NBANDS; i++) {
    const T = w.T[i];
    const h = 0.5;
    const scale = dg.humidityScale;
    // How the vapour column responds to a small temperature change. Where the
    // air is saturated it follows Clausius-Clapeyron. Where it is mass-limited
    // -- every drop of water the planet has is already airborne -- it does not
    // move at all, in either direction: there is no reservoir to draw on and
    // nothing for it to condense onto.
    //
    // Clamping only the upward side let cooling drain vapour that had nowhere
    // to go, which understated the damping by a factor of three or four. The
    // implicit solve then relaxed towards an equilibrium several kelvin past
    // the real one, overshot it, overshot back, and the step controller spent
    // the rest of the run alternating between thousand-year and quarter-year
    // steps. Only the path is affected, never the equilibrium: this is the
    // solver's Jacobian, and F = 0 is where it is regardless.
    const pw = scale < 0.999
      ? () => dg.pH2O[i]
      : (t) => dg.pH2O[i] * (psatH2O(t) / Math.max(psatH2O(T), 1e-12));
    const pwHi = pw(T + h), pwLo = pw(T - h);
    const ptHi = dg.pTot[i] - dg.pH2O[i] + pwHi, ptLo = dg.pTot[i] - dg.pH2O[i] + pwLo;
    const dOLR = (olr(T + h, dg.pCO2, pwHi, dg.pCH4, ptHi)
                - olr(T - h, dg.pCO2, pwLo, dg.pCH4, ptLo)) / (2 * h);
    const albAt = (t, pwx, ptx) => planetaryAlbedo(t, {
      oceanFrac: dg.flooded, landAlbedo: dg.effLandAlbedo, hasWater: dg.hasWater,
      waterCap: dg.waterCap, glaciated: dg.glaciatedShare * iceFraction(t),
      pH2O: pwx, pTot: ptx, slowness: dg.slowness,
      subStellar: dg.lam > 0.01 ? clamp(X[i], 0, 1) : 0.35,
    }).albedo;
    const dABS = dg.S[i] * dg.hazeSW * (albAt(T - h, pwLo, ptLo) - albAt(T + h, pwHi, ptHi)) / (2 * h);
    k[i] = dOLR - dABS;
  }
  return k;
}

// Backward-Euler step on the full coupled system, solved as the tridiagonal
// problem it is (Thomas algorithm, 18 bands -- trivially cheap). Writing
//
//     (C_i/dt + r_i + w_i + w_{i+1}) T'_i  −  w_i T'_{i−1}  −  w_{i+1} T'_{i+1}
//        =  C_i · (dT_i/dt)
//
// keeps the scheme unconditionally stable while letting the whole planet warm
// together when it is genuinely running away, instead of each band being held
// back by neighbours the diagonal approximation assumed were staying put.
export function stepTemperature(w, dtYears) {
  const dt = dtYears * YEAR;
  const dg = w.diag;
  const cached = w._solve && w._solve.diag === dg ? w._solve : null;
  const { dT, D } = cached ? cached.tend : tendency(w);
  const r = cached ? cached.k : radiativeDamping(w);
  w._solve = null;

  const wgt = new Float64Array(NBANDS + 1);      // edge conductances
  for (let j = 1; j < NBANDS; j++) {
    const xe = -1 + DX * j;
    wgt[j] = D * (1 - xe * xe) / (DX * DX);
  }

  const lo = new Float64Array(NBANDS), di = new Float64Array(NBANDS);
  const up = new Float64Array(NBANDS), rhs = new Float64Array(NBANDS);
  for (let i = 0; i < NBANDS; i++) {
    lo[i] = -wgt[i];
    up[i] = -wgt[i + 1];
    di[i] = dg.C[i] / dt + Math.max(r[i], -0.4 * (wgt[i] + wgt[i + 1]) - 0.05) + wgt[i] + wgt[i + 1];
    rhs[i] = dg.C[i] * dT[i];
  }

  // Thomas algorithm
  const cp = new Float64Array(NBANDS), dp = new Float64Array(NBANDS);
  cp[0] = up[0] / di[0];
  dp[0] = rhs[0] / di[0];
  for (let i = 1; i < NBANDS; i++) {
    const m = di[i] - lo[i] * cp[i - 1];
    cp[i] = up[i] / m;
    dp[i] = (rhs[i] - lo[i] * dp[i - 1]) / m;
  }
  const dTn = new Float64Array(NBANDS);
  dTn[NBANDS - 1] = dp[NBANDS - 1];
  for (let i = NBANDS - 2; i >= 0; i--) dTn[i] = dp[i] - cp[i] * dTn[i + 1];

  for (let i = 0; i < NBANDS; i++) w.T[i] = clamp(w.T[i] + dTn[i], 2, 4000);
}

// Largest step we may take: bounded by how fast anything is actually moving,
// never by the frame rate. Returned in years.
