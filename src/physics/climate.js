import { SIGMA, clamp, smoothstep, psatH2O, EO_COLUMN, YEAR, G_EARTH, CO2_EARTH_COL,
         P_TRIPLE_H2O, T_CRIT_H2O, P_CRIT_H2O } from './constants.js';
import { olr, planetaryAlbedo, iceFraction, landIceFraction, ALB_SEABED,
         hazeOpacity, hazeShortwave, ch4Shortwave } from './radiation.js';
import { derive } from './planet.js';
import { floodedFraction } from './hypsometry.js';

import { EARTH_INTERNAL_FLUX } from './volatiles.js';
import { stepBiology } from './biology.js';

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
// ...and where it stops being one.
//
// The dry fin and the sub-saturated moist column together let this model radiate
// above its own Simpson-Nakajima limit indefinitely: on the hot branch at 330 K
// the fin is worth 19 W/m^2 and the RH cap another 17, so an Earth walked up the
// insolation slider sat 31 W/m^2 over the saturated limit at 1.46 S(+) and only
// ran away at 1.48. Every published inner edge is below 1.25.
//
// The limit is computed saturated for a reason. Subsidence dries air by
// compressing it along a *dry* adiabat while the rising branch follows a moist
// one, and that separation is what leaves the subtropics arid. As water becomes
// a major constituent the two adiabats converge, the circulation that maintains
// the contrast weakens, and the troposphere approaches the saturated profile the
// limit assumes -- which is why Goldblatt (2013), Kasting (1988) and Leconte
// (2013) all compute it that way.
//
// The variable is water's *mixing ratio*, not its partial pressure, and that is
// what makes this safe for the worlds that have to survive it: Earth runs at
// 1.1%, a waterworld at 2.4%, the Hot Ocean preset at 3.5% under ten bar and the
// Sunbaked Ocean at 3.6% under four, while an Earth at the top of its hot branch
// is at 11.7%. A thick background keeps a hot ocean's air ordinary; it is being
// mostly steam that closes the fin.
const SAT_LO = 0.05, SAT_HI = 0.16;

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
  w.h2 = (params.h2Bar ?? 0) * 1e5 / d.g;
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
  w.fossil = null;     // a fresh world has its fossil carbon still in the ground
  w.carbonDeep = null; // rebuilt from the planet's mass on the first step
  w.bio = null;        // the living biosphere, grown from the conditions
  w.euk = null;        // how much of it has a nucleus
  w.eukReady = null;   // whether this world has evolved one at all yet
  update(w, 0);
  // Seed the split from the world as built rather than leaving it to the first
  // step. Pause-on-reset is the default, so a world that waits for a step is a
  // world that can sit there indefinitely reporting 0% eukaryote and "the oxygen
  // is new" -- on a paused, fully oxygenated Earth. A dtYears of 0 makes this
  // the initialisation and nothing else: every relaxation inside it multiplies
  // by 1 - exp(0), and on a world that already has the fields it does nothing.
  //
  // It has to run BETWEEN two update() calls, which is the whole awkwardness
  // here: it reads the oxygen and the temperatures out of the diag, and the diag
  // is what publishes its answer. Seeding before the first one has nothing to
  // read; seeding after the last one is not read. Twice at a reset costs
  // nothing -- this is not the step loop.
  stepBiology(w, 0);
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
  const pH2 = (w.h2 ?? 0) * g / 1e5;

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
  const pSurfPa = (w.n2 + w.co2 + w.ch4 + w.o2 + (w.h2 ?? 0)) * g + vapourPa(w, g);
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
  const pH2Osat = new Float64Array(NBANDS);
  const satShare = new Float64Array(NBANDS);
  let vapCol = 0;
  for (let i = 0; i < NBANDS; i++) {
    const col = demand[i] * scale;
    pH2O[i] = col * g / 1e5;
    // The dry, subsiding half of the Hadley circulation. Its unsaturated air
    // radiates straight to space above the classical runaway limit, which is
    // exactly why 3-D models push the inner edge outward relative to 1-D ones
    // (Leconte et al. 2013; Wolf & Toon 2014).
    // How far this band has gone toward the saturated profile.
    const x = pH2O[i] / Math.max(pN2 + pCO2 + pCH4 + pO2 + pH2 + pH2O[i], 1e-12);
    satShare[i] = smoothstep(SAT_LO, SAT_HI, x);
    // Both halves close together: the fin's air moistens toward the moist
    // column's humidity, and the moist column itself goes to saturation.
    const rhDry = RH_DRY + (RH - RH_DRY) * satShare[i];
    pH2Odry[i] = pH2O[i] * (rhDry / RH);
    pH2Osat[i] = pH2O[i] / RH;
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

  const S = insolationProfile(p);
  const lam = lockFactor(p);
  const slowness = clamp(smoothstep(24, 1500, p.rotationHours), 0, 1) * 0.5 + slowRotation(p) * 0.5;

  const alb = new Float64Array(NBANDS), out = new Float64Array(NBANDS);
  const cloud = new Float64Array(NBANDS), pTotArr = new Float64Array(NBANDS);
  const hasWater = totalWater > 1e-5;
  const waterCap = smoothstep(0.004, 0.12, totalWater);
  let Tmean = 0, iceMean = 0, iceArea = 0, absorbed = 0, emitted = 0, pTotMean = 0;

  for (let i = 0; i < NBANDS; i++) {
    const pTot = pN2 + pCO2 + pCH4 + pO2 + pH2 + pH2O[i];
    pTotArr[i] = pTot;
    const subStellar = lam > 0.01 ? clamp(X[i], 0, 1) : 0.35;
    const a = planetaryAlbedo(w.T[i], {
      oceanFrac: flooded, landAlbedo: effLandAlbedo, hasWater, waterCap,
      glaciated: glaciatedShare,
      pH2O: pH2O[i], pTot, slowness, subStellar, locked: lam,
    });
    alb[i] = a.albedo; cloud[i] = a.cloud;
    // The cloud fraction is passed, and has to be: with four bands the window is
    // a band of its own, and leaving cloud out of it lets a planet radiate
    // straight to space through a hole that its own cloud deck is covering.
    // The moist column, blended toward saturation by the same share that closes
    // the fin. Both are the one statement: a mostly-steam troposphere is the
    // saturated one the runaway limit is defined on.
    const sat = satShare[i];
    const moistOLR = olr(w.T[i], pCO2, pH2O[i] + (pH2Osat[i] - pH2O[i]) * sat,
                         pCH4, pTot, pH2, a.cloud);
    const dryOLR = olr(w.T[i], pCO2, pH2Odry[i], pCH4, pTot, pH2, a.cloud);
    const fin = FIN_FRACTION * (1 - sat);
    out[i] = (1 - fin) * moistOLR + fin * dryOLR;
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
    g, d, pN2, pCO2, pCH4, pO2, pH2, pH2O, pTot: pTotArr, pTotMean, Fint,
    S, alb, olr: out, cloud, C, oceanFrac, RH, humidityScale: scale, waterCap, pH2Odry,
    flooded, openOcean: openOcean * liquidAllowed, seaIceFrac, frozenShare,
    exposedBasin, effLandAlbedo, liquidAllowed, pSurfPa,
    bio: w.bio ?? 0,
    // The two kinds of life, in the same "x Earth" currency as bio. Derived
    // rather than stored on the prokaryote side: what is not eukaryotic is what
    // is left, and storing both would let them drift out of agreeing with bio.
    euk: w.euk ?? 0, prok: Math.max((w.bio ?? 0) - (w.euk ?? 0), 0),
    eukReady: w.eukReady ?? 0,
    landFrac: clamp(1 - flooded, 0, 1),
    landIceFrac: clamp((1 - flooded) * glaciatedShare, 0, 1),
    iceSheetTarget,
    glaciatedShare,
    // `absorbed` stays absorbed *sunlight*; the interior is reported separately.
    // The imbalance, though, is the whole energy budget -- Settle stops when it
    // reaches zero, so leaving the interior out of it would park a tidally
    // heated world at a permanent false imbalance it could never settle out of.
    Tmean, iceMean, iceArea, absorbed, emitted, imbalance: absorbed + Fint - emitted,
    hasWater, vapourCol: vapCol, lam, slowness, totalWater, superFrac,
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
  const dT = new Float64Array(NBANDS);
  const flux = new Float64Array(NBANDS + 1);
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
  //
  // Most of these evaluations are discarded. The clock has to ask how big the
  // next step would be before it can know whether it has the credit to pay for
  // one, and at a year a second it can afford one frame in eighteen -- so 95%
  // of this work is computed and thrown away, and it is thrown away on exactly
  // the machines with the least to spare. Reuse is safe on the same test
  // `stepTemperature` already trusts: `update()` builds a *fresh* w.diag every
  // time anything moves, on the step, parameter, reset, scrub and save-load
  // paths alike, so matching identity means the world has not moved and the
  // same solve still stands. A hit returns bit-identical numbers; it is the
  // same pure function of the same state.
  const hit = w._solve && w._solve.diag === dg ? w._solve : null;
  const tend = hit ? hit.tend : tendency(w);
  const k = hit ? hit.k : radiativeDamping(w);
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
  //
  // ...and it must be *off*, not merely turned down, while the planet is sitting
  // on the ice-albedo bifurcation.
  //
  // Between roughly a fifth and a half of the surface frozen, an Earth-like
  // world is on the steep part of the albedo curve, where a temperate branch and
  // a snowball branch both exist and a small nudge decides which one it is on.
  // The two tests above do not see that: at the moment the Great Oxidation
  // scenario tipped, every band was within 0.8 K of its equilibrium and the mean
  // damping was a healthy 0.63, so the shortcut struck a 21 kyr stride -- and
  // that stride carried the planet across the bifurcation. It went pole-to-pole
  // frozen, spent 140 Myr piling 11 bar of CO2 behind the ice, and deglaciated
  // into a 128 C hothouse. Reported from the live site.
  //
  // The equilibrium the linearisation points at is a real one; what it does not
  // know is that a saddle sits between here and there. Nothing local can know
  // that, which is why this is a gate rather than a tolerance.
  //
  // Turning the stride *down* is not enough and the measurement says so
  // plainly: at a tenth of it the scenario survives, at a twentieth it tips
  // again. That non-monotonicity is the signature of perturbing a trajectory
  // across a basin boundary rather than resolving it, and it is exactly the kind
  // of fix that looks fine until the next preset. Off, the answer converges --
  // peak ice 34% at -4.1 C from a 2 kyr cap to a 5 Myr cap, three and a half
  // decades of step size agreeing to a point.
  //
  // What it costs: nothing on a world that is not part-glaciated. Earth over a
  // gigayear is 1358 steps either way, the Archean 729, a 1.4 S(+) runaway 618,
  // a hard snowball 6883 against 6663. The scenario itself gets *cheaper* --
  // 150 000 steps against 206 000 -- because it no longer has a snowball to
  // integrate. The one world that pays is one that genuinely parks
  // mid-glaciated: Earth at 0.95 S(+) sits at 30% ice and goes from 752 steps a
  // gigayear to 2285. That is the bill for being in the band where this model
  // was demonstrably getting the answer wrong, and it is the right way round.
  //
  // The band is wide -- a twelfth of the surface frozen to nine tenths -- because
  // a global mean is a crude way to ask "is the ice edge moving?", and it has to
  // be crude in the safe direction. A fast rotator sits on its bifurcation
  // around a third; a tidally locked world carries a permanently frozen night
  // side, so the same question about its day-side edge is being asked at 68%
  // global ice. Keyed at 0.22-0.45 the Locked Eyeball with its carbon weathered
  // away fell outside the band and stayed unconverged -- frozen at two step caps
  // and a 422 C boiled ocean at the other two, off one starting state. Widened,
  // it lands on 68% ice and an 89.6 C substellar point at every cap, to a tenth
  // of a degree. That world was never converged: before this it agreed about
  // being frozen while disagreeing by 40 K about how warm its day side was, and
  // nothing any test asserted on could see the difference.
  const onEdge = smoothstep(0.08, 0.18, dg.iceMean) * smoothstep(0.90, 0.72, dg.iceMean);
  const quasi = smoothstep(6, 1, eqDistance) * smoothstep(0.10, 0.45, meanDamping) * (1 - onEdge);
  if (quasi > 0) dt = Math.min(dt * (1 + quasi * 4000), 5e6);

  // ...but never step so far that a slow reservoir jumps discontinuously.
  const esc = w.escape;
  if (esc && esc.water > 0 && dg.totalWater > 0) {
    dt = Math.min(dt, Math.max(0.05 * dg.totalWater * dg.d.eoColumn / esc.water, 1.0));
  }
  // The CO2 reservoir is integrated semi-implicitly, so it needs only a loose
  // bound -- and that bound is measured against a floor, because a planet whose
  // CO2 has been weathered away to nothing must not drag the clock down with it.
  //
  // With the same exemption the oxygen bound below needs, and for the same
  // reason: a reservoir pinned at exactly zero with the sink still beating the
  // source is not going anywhere, and bounding on the imbalance there costs
  // everything. A runaway greenhouse is where this bites -- weathering at 370 C
  // outruns the volcanoes by two orders of magnitude for ever, the reservoir sits
  // at zero, and the bound held a settled steam world at twenty-three-year steps
  // through a million years of nothing happening.
  if (w.weathering) {
    const pinned = w.co2 <= 0 && w.weathering.W > w.weathering.V;
    const net = Math.abs(w.weathering.V - w.weathering.W) / Math.max(w.weathering.kappa, 1);
    const floor = 0.02 * CO2_EARTH_COL;
    if (net > 0 && !pinned) dt = Math.min(dt, Math.max(0.25 * (w.co2 + floor) / net, 1.0));
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
  //
  // How *tightly* it has to be resolved follows the methane, because methane is
  // what the bound is for. There is no other reader of pO2 that a tenth of a
  // reservoir per step protects: the hydrogen burn reads it too, but that is
  // capped by what the oxygen can afford and cannot overshoot however long the
  // step. So a tenth where there is methane to ruin, and a whole reservoir where
  // there is none.
  //
  // The measurement that decided it: a far-future Earth crossing from oxic to
  // anoxic on a magma ocean, pO2 sweeping four decades in 140 Myr with no
  // methane anywhere. Run to 3.4 Gyr, a tenth of the reservoir per step takes
  // 1 785 117 steps; a whole reservoir takes 26 276, and ten reservoirs 26 082.
  // All three agree on 2891.4 C, 399.60 bar of CO2 and 0.7718 oceans. Sixty-eight
  // times the work for the fourth decimal place. Reported from the live site as
  // 36.6 kyr/s on an 1812 C world.
  //
  // The floor is about a part per million of methane at Earth gravity, below
  // which its band is worth nothing whatever pO2 does.
  if (w.o2Rate) {
    const pinned = w.o2 <= 0 && w.o2Rate < 0;
    if (!pinned) {
      const floor = 3e-7 * 1e5 / dg.d.g;
      const frac = 1 - 0.9 * smoothstep(0, 0.01, w.ch4);
      dt = Math.min(dt, Math.max(frac * (w.o2 + floor) / Math.abs(w.o2Rate), 1.0));
    }
  }

  // Hydrogen, bounded on its *net* rate rather than its escape flux -- the same
  // shape as the CO2 bound above and for the same reason. The reservoir is
  // integrated semi-implicitly now, so it is stable at any step; what this
  // protects is the escape flux that credits the oxygen budget, which must not
  // become a property of the step sequence while hydrogen is still moving. On a
  // world sitting at its steady state the net rate is zero and this costs
  // nothing, which is what keeps the Archean affordable to watch.
  if (w.h2Rate) {
    const floor = 1e-6 * 1e5 / dg.d.g;
    dt = Math.min(dt, Math.max(0.25 * ((w.h2 ?? 0) + floor) / Math.abs(w.h2Rate), 1.0));
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
  // This function must record nothing that the *step sequence* depends on: the
  // clock asks it what the next step would be before deciding whether it can
  // afford to take one, so remembering the answer here would make the sequence
  // depend on where frame boundaries happened to fall. `dtPrev` is advanced in
  // stepOnce instead, once per step actually taken. (It is not side-effect
  // free, and never was -- it fills the `_solve` cache above. That cache is
  // keyed on state identity and returns the same numbers either way, so it
  // cannot move the sequence; `dtPrev` would.)
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
    const dOLR = (olr(T + h, dg.pCO2, pwHi, dg.pCH4, ptHi, dg.pH2, dg.cloud[i])
                - olr(T - h, dg.pCO2, pwLo, dg.pCH4, ptLo, dg.pH2, dg.cloud[i])) / (2 * h);
    const albAt = (t, pwx, ptx) => planetaryAlbedo(t, {
      oceanFrac: dg.flooded, landAlbedo: dg.effLandAlbedo, hasWater: dg.hasWater,
      waterCap: dg.waterCap, glaciated: dg.glaciatedShare * iceFraction(t),
      pH2O: pwx, pTot: ptx, slowness: dg.slowness, locked: dg.lam,
      subStellar: dg.lam > 0.01 ? clamp(X[i], 0, 1) : 0.35,
    }).albedo;
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
