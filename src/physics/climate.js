import { SIGMA, clamp, smoothstep, psatH2O, EO_COLUMN, YEAR, G_EARTH, CO2_EARTH_COL,
         P_TRIPLE_H2O, T_CRIT_H2O, P_CRIT_H2O } from './constants.js';
import { olr, planetaryAlbedo, planetaryAlbedoInto, iceFraction, landIceFraction, ALB_SEABED,
         hazeOpacity, hazeShortwave, ch4Shortwave, cloudWhiteness } from './radiation.js';
import { derive } from './planet.js';
import { floodedFraction } from './hypsometry.js';

import { EARTH_INTERNAL_FLUX, OTHER_GHG_FULL, AEROSOL_FULL } from './volatiles.js';

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

// Scratch space, one set per world, reused for the life of it.
//
// update() alone used to allocate ten typed arrays every call and it is called
// twice a step; tendency(), radiativeDamping() and stepTemperature() allocated
// another dozen between them. Thirty short-lived allocations per step, at tens
// of thousands of steps a second, is a lot of garbage to make and collect for
// arrays whose contents are overwritten from scratch every time anyway.
//
// The seven arrays that end up inside `diag` are shared with it deliberately:
// the diag OBJECT is still new on every call, which is what `w._solve`'s
// identity check depends on, but its arrays are the same storage each time.
// Nothing outside a single step holds a diag long enough to notice -- the
// history keeps scalars, the snapshot keeps none of it, and the charts read it
// between steps.
function scratch(w) {
  let b = w._buf;
  if (!b) {
    b = w._buf = {};
    for (const key of ['S', 'demand', 'pH2O', 'pH2Odry', 'alb', 'out', 'cloud',
                       'pTot', 'C', 'k', 'dT', 'lo', 'di', 'up', 'rhs', 'cp',
                       'dp', 'dTn']) {
      b[key] = new Float64Array(NBANDS);
    }
    b.flux = new Float64Array(NBANDS + 1);
    b.wgt = new Float64Array(NBANDS + 1);
    // The options object handed to planetaryAlbedo, and the result it writes
    // into. Both are consumed inside the loop that fills them.
    b.aOpt = { oceanFrac: 0, landAlbedo: 0, hasWater: false, waterCap: 0,
               glaciated: 0, pH2O: 0, pTot: 0, slowness: 0, subStellar: 0,
               cloudWhite: 1 };
    b.aOut = { albedo: 0, cloud: 0 };
  }
  return b;
}

export function createWorld(params) {
  const w = {
    // Off unless asked for.
    //
    // Two hooks, because the tools need to be able to grade the fast path and
    // threading a flag through every construction site would be worse than
    // this: `globalThis.__pcFast` for the browser and for a tool that can be
    // imported, and PC_FAST in the environment for the ones whose entry point
    // is guarded and cannot be. `PC_FAST=1 node tools/convergence.mjs` sweeps
    // the fast path.
    fastPhysics: !!(globalThis.__pcFast
      || (typeof process !== 'undefined' && process.env && process.env.PC_FAST)),
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
  w.landIceMass = null;  // and so is the mass the cold trap has moved
  w.life = null;       // seeded on the first step, from whether this world has a biosphere
  // A world that starts with industry running has been running it for a while:
  // modern Earth is a tenth of the way through its fossil carbon, not at the
  // first day of it. Both reservoirs therefore start where that activity would
  // already have put them, the same argument that gives that preset its
  // `fossilUsed`. A world with the emissions control at zero starts clean.
  w.industrial = clamp(params.emissions ?? 0, 0, 100);
  w.otherGHG = OTHER_GHG_FULL * w.industrial;
  w.aerosol = AEROSOL_FULL * w.industrial;
  w.fossil = null;     // a fresh world has its fossil carbon still in the ground
  w.carbonDeep = null; // rebuilt from the planet's mass on the first step
  w.bio = null;        // the living biosphere, grown from the conditions
  // Where the evolving controls stood when the clock started. The star's
  // brightness and the interior's heat are absolute functions of age rather
  // than rates to integrate, so they are computed from here every step instead
  // of being stepped forward -- which is what keeps them independent of the
  // step sequence.
  w.evolve0 = { insolation: params.insolation, internalHeat: params.internalHeat,
                xuvFraction: params.xuvFraction, magneticField: params.magneticField,
                outgassing: params.outgassing };
  w.insolationTarget = null;   // no walk in progress on a fresh world
  update(w, 0);
}

// How synchronised the world is: 0 = fast rotator, 1 = tidally locked.
// Whether the world has a permanent day side and a permanent night side.
//
// This used to be inferred from the rotation period -- anything slower than a
// few hundred days was treated as synchronous. Rotation period cannot tell you
// that, and this model's own worlds prove it: the Locked Eyeball is synchronous
// at 264 h while Venus turns far slower, once every 5832 h, and is not locked
// at all. Every point on Venus sees the sun; its solar day is 117 Earth days.
//
// The cost of getting this wrong was invisible under a thick atmosphere, which
// smears the contrast away, and brutal without one: a stripped Venus was handed
// a hemisphere that is never illuminated, it fell to 82 K, and it swallowed
// every molecule of CO2 the volcanoes produced from then on. Rotating, the same
// world's coldest band sits at 332 K.
export function lockFactor(p) {
  return p.tidallyLocked ? 1 : 0;
}

// How sluggish the circulation is, which *is* a question about rotation rate:
// slow rotators have wide Hadley cells, move heat freely and grow a thick cloud
// deck, synchronous or not. Kept separate from the geometry above.
export function slowRotation(p) {
  if (p.tidallyLocked) return 1;
  return smoothstep(240, 4000, p.rotationHours);
}

// Annual-mean insolation shape. s2 = -0.477 at Earth's 23.5 deg obliquity.
function s2Coefficient(obliquityDeg) {
  const s = Math.sin(obliquityDeg * Math.PI / 180);
  return clamp(0.912 * (3 * s * s - 1), -0.95, 1.9);
}

export function insolationProfile(p, into = null) {
  const F = p.insolation * 1361;
  const lam = lockFactor(p);
  const s2 = s2Coefficient(p.obliquity);
  const out = into || new Float64Array(NBANDS);
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
  const B = scratch(w);
  const demand = B.demand;
  let totalDemand = 0;
  for (let i = 0; i < NBANDS; i++) {
    demand[i] = RH * psatH2O(w.T[i]) / g;   // kg/m^2
    totalDemand += demand[i] / NBANDS;
  }
  const supply = clamp(availCol, 0, 1e12);
  const scale = totalDemand > supply ? supply / Math.max(totalDemand, 1e-30) : 1;

  const pH2O = B.pH2O, pH2Odry = B.pH2Odry;
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
  // Methane does the same thing on its own account, without needing to
  // polymerise into anything: its near-infrared bands take sunlight and deposit
  // it high up. This is what puts a ceiling on the methane greenhouse -- past
  // about a hundred pascals more methane cools a planet rather than warming it
  // (Byrne & Goldblatt 2015; Eager-Nash et al. 2023). `swTrans` is what is left
  // of the sunlight after both, and it is what actually heats the ground;
  // `hazeSW` stays the haze's own share so the Titan readout still means what
  // it says.
  const ch4SW = 1 - ch4Shortwave(pCH4);
  const swTrans = hazeSW * ch4SW;

  const S = insolationProfile(p, B.S);
  const lam = lockFactor(p);
  const slowness = clamp(smoothstep(24, 1500, p.rotationHours), 0, 1) * 0.5 + slowRotation(p) * 0.5;
  // How well cloud reflects this particular star's light. 1 for a G star, and
  // about half that for TRAPPIST-1, whose output is mostly in the near infrared
  // that water absorbs rather than scatters.
  const cloudWhite = cloudWhiteness(p.starTemp);

  // What an industrial civilisation adds that is not CO2. Both are computed in
  // volatiles.js, which knows whether anyone is still burning anything; here
  // they are only applied.
  //
  // The gases come off the longwave, which is what a greenhouse forcing is. The
  // aerosol comes off the shortwave, because that is what it is -- sulphate
  // scatters sunlight -- and it is applied as a uniform addition to the band
  // albedo rather than as a flat watt off the total. That puts the cooling
  // where the sunlight is, which on a rotating world is the tropics and on a
  // locked world is the day side, and stops it from cooling ground the star
  // never reaches.
  const ghgForce = Math.max(w.otherGHG ?? 0, 0);
  let sMean = 0;
  for (let i = 0; i < NBANDS; i++) sMean += S[i] / NBANDS;
  const aerAlb = clamp(Math.max(w.aerosol ?? 0, 0)
    / Math.max(sMean * swTrans, 1e-6), 0, 0.5);

  const alb = B.alb, out = B.out, cloud = B.cloud, pTotArr = B.pTot;
  const hasWater = totalWater > 1e-5;
  const waterCap = smoothstep(0.004, 0.12, totalWater);
  let Tmean = 0, iceMean = 0, iceArea = 0, absorbed = 0, emitted = 0, pTotMean = 0;

  for (let i = 0; i < NBANDS; i++) {
    const pTot = pN2 + pCO2 + pCH4 + pO2 + pH2O[i];
    pTotArr[i] = pTot;
    const subStellar = lam > 0.01 ? clamp(X[i], 0, 1) : 0.35;
    const ao = B.aOpt;
    ao.oceanFrac = flooded; ao.landAlbedo = effLandAlbedo; ao.hasWater = hasWater;
    ao.waterCap = waterCap; ao.glaciated = glaciatedShare;
    ao.pH2O = pH2O[i]; ao.pTot = pTot; ao.slowness = slowness;
    ao.subStellar = subStellar; ao.cloudWhite = cloudWhite;
    const a = planetaryAlbedoInto(w.T[i], ao, B.aOut);
    alb[i] = clamp(a.albedo + aerAlb, 0, 0.95); cloud[i] = a.cloud;
    const moistOLR = olr(w.T[i], pCO2, pH2O[i], pCH4, pTot);
    const dryOLR = olr(w.T[i], pCO2, pH2Odry[i], pCH4, pTot);
    // Floored rather than merely subtracted: a lumped forcing that could drive
    // the outgoing flux to nothing would be a runaway with no physics behind it.
    out[i] = Math.max((1 - FIN_FRACTION) * moistOLR + FIN_FRACTION * dryOLR - ghgForce,
                      1e-3);
    Tmean += w.T[i] / NBANDS;
    // Two different questions, so two numbers. `iceMean` is how much of the
    // planet is frozen, which is what decides whether this is a snowball.
    // `iceArea` is how much of it is actually *covered* in ice, which is what
    // the albedo sees -- and on a snowball those differ, because continents
    // with no water cycle stay bare frozen rock rather than growing a sheet.
    iceMean += (hasWater ? iceFraction(w.T[i]) : 0) / NBANDS;
    iceArea += (hasWater ? flooded * iceFraction(w.T[i]) + (1 - flooded) * glaciatedShare : 0) / NBANDS;
    absorbed += S[i] * (1 - alb[i]) * swTrans / NBANDS;
    emitted += out[i] / NBANDS;
    pTotMean += pTot / NBANDS;
  }

  // Effective heat capacity. Three pieces, and the last two are why a runaway
  // greenhouse takes ~10^5 years instead of happening on screen instantly:
  //   1. mixed layer (or the *whole* ocean once it starts boiling through)
  //   2. the atmosphere itself, which is enormous in a thick steam envelope
  //   3. latent heat: every extra kelvin evaporates more sea, and near the
  //      runaway that dwarfs everything else.
  const C = B.C;
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

  // Heat coming out of the planet itself: radiogenic, primordial and -- the one
  // that can dominate -- tidal. Uniform over the globe, which is how both
  // Barnes et al. 2013 and Barr et al. 2018 treat it when they compare it
  // against the runaway limit.
  //
  // The default is Earth's own measured 0.092 W/m2 rather than zero, so that a
  // world saved, linked or scripted before this existed keeps an interior
  // instead of quietly becoming geologically dead -- outgassing is tied to this
  // now, and a zero here would stop the volcanoes.
  const Fint = Math.max(p.internalHeat ?? EARTH_INTERNAL_FLUX, 0);

  w.diag = {
    g, d, pN2, pCO2, pCH4, pO2, pH2O, pTot: pTotArr, pTotMean, Fint,
    S, alb, olr: out, cloud, C, oceanFrac, RH, humidityScale: scale, waterCap, pH2Odry,
    flooded, openOcean: openOcean * liquidAllowed, seaIceFrac, frozenShare,
    exposedBasin, effLandAlbedo, liquidAllowed, pSurfPa,
    bio: w.bio ?? 0,
    landFrac: clamp(1 - flooded, 0, 1),
    landIceFrac: clamp((1 - flooded) * glaciatedShare, 0, 1),
    iceSheetTarget,
    glaciatedShare,
    // `absorbed` stays absorbed *sunlight*; the interior is reported separately.
    // The imbalance, though, is the whole energy budget -- Settle stops when it
    // reaches zero, so leaving the interior out of it would park a tidally
    // heated world at a permanent false imbalance it could never settle out of.
    Tmean, iceMean, iceArea, absorbed, emitted, imbalance: absorbed + Fint - emitted,
    hasWater, vapourCol: vapCol, lam, slowness, cloudWhite, totalWater, superFrac,
    hazeTau, hazeSW, ch4SW, swTrans,
    Tmax: Math.max(...w.T), Tmin: Math.min(...w.T),
  };
  return w.diag;
}

// Temperature tendency in K/s, including transport.
export function tendency(w) {
  const dg = w.diag, p = w.params;
  const pH2Omean = dg.pH2O.reduce((a, b) => a + b, 0) / NBANDS;
  const D = diffusionCoefficient(p, dg.pTotMean, pH2Omean);
  const B = scratch(w);
  const dT = B.dT, flux = B.flux;
  for (let j = 1; j < NBANDS; j++) {
    const xe = -1 + DX * j;
    flux[j] = D * (1 - xe * xe) * (w.T[j] - w.T[j - 1]) / DX;
  }
  for (let i = 0; i < NBANDS; i++) {
    const transport = (flux[i + 1] - flux[i]) / DX;
    // Interior heat enters exactly as sunlight does, so the greenhouse
    // amplifies it identically -- which is the point, and is why a flux far
    // below the runaway limit still moves the surface a long way.
    dT[i] = (dg.S[i] * (1 - dg.alb[i]) * dg.swTrans + dg.Fint - dg.olr[i] + transport) / dg.C[i];
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
  const { dT, D } = tend;
  w._solve = { diag: dg, tend, k };

  let worst = 0, meanDamping = 0;
  for (let i = 0; i < NBANDS; i++) {
    meanDamping += k[i] / NBANDS;
    // Allow a slightly coarser step on a very hot planet: one kelvin out of 900
    // is not a resolvable change, and it keeps a runaway affordable to watch.
    const allow = Math.max(maxDeltaT, 0.004 * w.T[i]);
    worst = Math.max(worst, Math.abs(dT[i]) / allow);
  }
  if (worst < 1e-18) return 5e6;
  let dt = clamp(1 / worst / YEAR, 2e-3, 5e6);

  // How far the coupled climate is from the equilibrium of this linearisation.
  // This is the infinite-step limit of the same tridiagonal system used by
  // stepTemperature below. Using only its diagonal counts lateral transport as
  // a local sink while silently holding the neighbours fixed. They are not
  // fixed in the solve: transport cancels for a coherent warming mode, so the
  // diagonal approximation can call a climate quasi-static while its whole
  // temperature field is still moving together.
  const B = scratch(w), wgt = B.wgt;
  wgt[0] = wgt[NBANDS] = 0;
  for (let j = 1; j < NBANDS; j++) {
    const xe = -1 + DX * j;
    wgt[j] = D * (1 - xe * xe) / (DX * DX);
  }
  const lo = B.lo, di = B.di, up = B.up, rhs = B.rhs;
  for (let i = 0; i < NBANDS; i++) {
    const wsum = wgt[i] + wgt[i + 1];
    lo[i] = -wgt[i];
    up[i] = -wgt[i + 1];
    di[i] = Math.max(k[i], -0.4 * wsum - 0.05) + wsum;
    rhs[i] = dg.C[i] * dT[i];
  }
  const cp = B.cp, dp = B.dp;
  let regular = Math.abs(di[0]) > 1e-12 && isFinite(di[0]);
  if (regular) { cp[0] = up[0] / di[0]; dp[0] = rhs[0] / di[0]; }
  for (let i = 1; i < NBANDS && regular; i++) {
    const m = di[i] - lo[i] * cp[i - 1];
    regular = Math.abs(m) > 1e-12 && isFinite(m);
    if (regular) {
      cp[i] = up[i] / m;
      dp[i] = (rhs[i] - lo[i] * dp[i - 1]) / m;
    }
  }
  let eqDistance = Infinity;
  if (regular) {
    const dTeq = B.dTn;
    dTeq[NBANDS - 1] = dp[NBANDS - 1];
    eqDistance = Math.abs(dTeq[NBANDS - 1]);
    for (let i = NBANDS - 2; i >= 0; i--) {
      dTeq[i] = dp[i] - cp[i] * dTeq[i + 1];
      eqDistance = Math.max(eqDistance, Math.abs(dTeq[i]));
    }
    if (!isFinite(eqDistance)) eqDistance = Infinity;
  }

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

  // The other half of the trust region in stepTemperature. If the last step's
  // solve wanted to move a band further than it was allowed to, the step it was
  // given was too long for the linearisation it was built from -- so shorten it
  // in proportion and try again from a state that linearisation does describe.
  // The implicit change is very nearly linear in dt while C/dt dominates the
  // diagonal, so one pass usually lands it; where it does not the reduction
  // repeats and converges geometrically. On every world where the region never
  // binds -- which is all of them except during a tipping -- this does nothing.
  if (w.trustOver > 1 && w.dtPrev > 0) {
    dt = Math.min(dt, Math.max(w.dtPrev / w.trustOver, 2e-3));
  }

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

  // Oxygen, and this is the important one. Methane's lifetime pivots on pO2 from
  // twelve thousand years to ten across the four decades between 3e-7 and 2e-4
  // bar, and the methane step is integrated against the oxygen the *previous*
  // step computed. A single stride across that crossover integrates methane for
  // fifty thousand years at a lifetime that stopped being true early in it, and
  // the world arrives with thousands of ppm it should never have accumulated.
  // That put a super-Earth at 74 C on fine steps and 579 C on coarse ones.
  //
  // The floor is the column at the bottom of the sensitive band, so the bound
  // tightens only while the crossing is actually happening: it costs about
  // twenty steps per decade of pO2 and nothing at all on a world that is firmly
  // oxic or firmly anoxic.
  // The one exemption is a world whose oxygen is pinned at zero with a negative
  // tendency -- the volcanoes permanently outrunning the biosphere, which is
  // every anoxic world in the game. Nothing is happening there, and bounding on
  // that rate held the clock at three-year steps for ever: the Archean went from
  // 19 000 Myr/s to a standstill.
  //
  // Everywhere else the bound is unconditional, and it has to be. It is
  // tempting to apply it only near the crossover, but the step that does the
  // damage is taken while pO2 is still comfortably oxidising: a single stride of
  // 123 000 years starting at 6.5 mbar emptied the whole reservoir and landed
  // anoxic. Ten percent of the reservoir per step costs about 135 steps to take
  // a world from Earth's oxygen to none, which is nothing.
  if (w.o2Rate) {
    const pinned = w.o2 <= 0 && w.o2Rate < 0;
    if (!pinned) {
      const floor = 3e-7 * 1e5 / dg.d.g;
      dt = Math.min(dt, Math.max(0.1 * (w.o2 + floor) / Math.abs(w.o2Rate), 1.0));
    }
  }

  // The methane reservoir needs the same bound, and for the same reason the ice
  // sheet does. It is semi-implicit, so it is stable at any step -- but its
  // source and its lifetime both depend on state that is moving underneath it
  // (oxygen, haze, temperature), and a hazy world sits at the meeting point of
  // two stable climates: a cool methane-shaded one and a CO2 runaway. Stride
  // over the transition and the answer becomes a property of the step sequence.
  // Unbounded, a super-Earth here settled at 74 C on fine steps and 579 C on
  // coarse ones.
  //
  // The floor is about ten ppm of methane at Earth gravity: below that the
  // reservoir cannot decide anything radiatively, and bounding on it would drag
  // the clock down on every world that has almost none.
  if (w.ch4Tau != null) {
    const net = Math.abs((w.ch4Source ?? 0) - w.ch4 / Math.max(w.ch4Tau, 1e-6));
    if (net > 0) dt = Math.min(dt, Math.max(0.1 * (w.ch4 + 0.1) / net, 1.0));
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
  const B = scratch(w);
  const k = B.k;
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
    const albAt = (t, pwx, ptx) => {
      const ao = B.aOpt;
      ao.oceanFrac = dg.flooded; ao.landAlbedo = dg.effLandAlbedo;
      ao.hasWater = dg.hasWater; ao.waterCap = dg.waterCap;
      ao.glaciated = dg.glaciatedShare * iceFraction(t);
      ao.pH2O = pwx; ao.pTot = ptx; ao.slowness = dg.slowness;
      ao.cloudWhite = dg.cloudWhite;
      ao.subStellar = dg.lam > 0.01 ? clamp(X[i], 0, 1) : 0.35;
      return planetaryAlbedoInto(t, ao, B.aOut).albedo;
    };
    const dABS = dg.S[i] * dg.swTrans * (albAt(T - h, pwLo, ptLo) - albAt(T + h, pwHi, ptHi)) / (2 * h);
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

  const B = scratch(w);
  const wgt = B.wgt;              // edge conductances
  for (let j = 1; j < NBANDS; j++) {
    const xe = -1 + DX * j;
    wgt[j] = D * (1 - xe * xe) / (DX * DX);
  }

  const lo = B.lo, di = B.di, up = B.up, rhs = B.rhs;
  for (let i = 0; i < NBANDS; i++) {
    lo[i] = -wgt[i];
    up[i] = -wgt[i + 1];
    di[i] = dg.C[i] / dt + Math.max(r[i], -0.4 * (wgt[i] + wgt[i + 1]) - 0.05) + wgt[i] + wgt[i + 1];
    rhs[i] = dg.C[i] * dT[i];
  }

  // Thomas algorithm
  const cp = B.cp, dp = B.dp;
  cp[0] = up[0] / di[0];
  dp[0] = rhs[0] / di[0];
  for (let i = 1; i < NBANDS; i++) {
    const m = di[i] - lo[i] * cp[i - 1];
    cp[i] = up[i] / m;
    dp[i] = (rhs[i] - lo[i] * dp[i - 1]) / m;
  }
  const dTn = B.dTn;
  dTn[NBANDS - 1] = dp[NBANDS - 1];
  for (let i = NBANDS - 2; i >= 0; i--) dTn[i] = dp[i] - cp[i] * dTn[i + 1];

  // A solve that leaves the state used to linearise it is not a usable Newton
  // step. Keep it inside a deliberately generous trust region, then tell the
  // controller how far the raw solve overshot so the following step is
  // shortened in proportion instead of repeatedly clipping the same move.
  w.trustOver = 1;
  for (let i = 0; i < NBANDS; i++) {
    const allow = Math.max(25, 0.05 * w.T[i]);
    w.trustOver = Math.max(w.trustOver, Math.abs(dTn[i]) / allow);
    w.T[i] = clamp(w.T[i] + clamp(dTn[i], -allow, allow), 2, 4000);
  }
}

// Largest step we may take: bounded by how fast anything is actually moving,
// never by the frame rate. Returned in years.
