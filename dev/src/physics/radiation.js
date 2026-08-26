import { SIGMA, psatH2O, frostPointCO2, clamp, smoothstep } from './constants.js';

// ---------------------------------------------------------------------------
// Four-band longwave radiative transfer, with spectral overlap.
//
// Each band is a two-stream semi-grey problem in its own right, and what is
// emitted into it is the true Planck share of that band at the surface
// temperature:
//
//     OLR = SUM_i f_i(T) sigma T^4 [ (1-C)/(1+3/4 tau_i) + C/(1+3/4(tau_i+tc)) ]
//
// The bands are 0-8, 8-12 (the atmospheric window), 12-18 (CO2's 15 um band)
// and >18 um (water's rotation band). The shares are the entire point, because
// they move enormously with temperature:
//
//   |            | 0-8  | 8-12 | 12-18 | >18  |
//   | Titan 95 K |  0.0 |  0.1 |   2.8 | 97.0 |
//   | snowball   |  4.4 | 17.5 |  28.7 | 49.4 |
//   | Earth 288  | 12.1 | 25.3 |  28.2 | 34.4 |
//   | Venus 737  | 72.9 | 15.7 |   7.2 |  4.3 |
//
// On a snowball two thirds of the emission is in the window and the far
// infrared, where there is no water vapour and CO2 has almost no grip; on Earth
// water closes the far infrared so CO2's own band carries proportionally more.
// That is what a single grey optical depth provably cannot do: it has to decide
// how well CO2 works at 230 K and at 288 K with one number, and the two answers
// differ by a factor of three.
//
// Two things are new here and they are the reason four separate known gaps
// closed at once.
//
// FIRST: water's opacity now has its own exponent in every band, fitted rather
// than shared. What that buys is *overlap*. The complaint the calibration file
// had been carrying was exact -- "CO2's optical depth is added to water's in
// each band rather than overlapping it" -- and its symptom was that the
// Simpson-Nakajima limit moved by 43 W/m^2 between 0.4 ppm of CO2 and 280,
// where the literature has it very nearly independent of CO2. At the runaway
// peak the atmosphere is steam and water is supposed to carry the opacity; here
// water's grip in band 2 grew only as pH2O^0.48, so stripping the CO2 out
// bought real transparency that a steam atmosphere does not have. Fixing that
// meant a full refit, because the exponent that closes band 2 in a steam
// atmosphere is not the one that leaves it open on a snowball. The spread is
// 6.2 W/m^2 now, inside its 0-10 target, and Earth's inner edge came in from
// 1.38 to 1.25 S(+) with it -- because a thermostat that draws CO2 down as a
// star brightens was also, absurdly, raising the cliff the planet was walking
// towards.
//
// SECOND: spectral coverage. A band model that gives a gas one optical depth
// across a whole band is saying its lines are spread evenly over it, and for a
// narrow line complex in a wide band that is badly wrong in a specific
// direction: it lets a feature that occupies a twentieth of the band black out
// all of it. `tauEff` below is a one-point k-distribution -- a fraction phi of
// the band carries all the opacity and the rest is clear -- which puts a
// ceiling on what a line complex can do, exactly as saturation does in reality.
// The fit was offered it for every line term in every band and kept three:
// CO2's 15 um band, water's 6.3 um band, and methane's 7.7 um band. It is
// written as an effective optical depth rather than a transmission so that
// gases still *sum*, which is what random overlap says uncorrelated line
// spectra should do, and so that phi = 1 gives back the previous scheme
// unchanged.
//
// Worth recording what did NOT pay for itself: pinning every coverage at 1 and
// refitting reaches almost the same score (2.9 against 2.5 on the same
// objective). Coverage is not what fixed the runaway limit -- water's exponents
// are -- and the honest reading is that it earns its place on three line bands
// and nowhere else.
//
// A degeneracy worth recording too, because it cost an earlier attempt an
// afternoon: Venus cannot tell "opaque" from "absurdly opaque". At 92 bar the
// band-2 term is saturated for any coefficient above about ten, so the fit is
// free to leave it at thousands -- identical on Venus, catastrophic on a world
// carrying one bar of CO2. Every coefficient here is bounded for that reason.
// ---------------------------------------------------------------------------

// ---- the cumulative Planck function ---------------------------------------
// The share of a blackbody's emission below a wavelength depends only on the
// product lambda*T, so one table in log(lambda T) serves every temperature and a
// band share is the difference of two lookups. Built once at module load;
// checked against the published blackbody radiation functions to 5e-5.
const C2 = 1.4387768775e-2;              // m K, second radiation constant
const NPL = 2048, PL_LO = Math.log(2e-5), PL_HI = Math.log(2e-1);
const PL_SCALE = (NPL - 1) / (PL_HI - PL_LO);
const PLANCK = new Float64Array(NPL);
{
  const pi4 = Math.pow(Math.PI, 4);
  for (let i = 0; i < NPL; i++) {
    const x = C2 / Math.exp(PL_LO + (PL_HI - PL_LO) * i / (NPL - 1));
    let sum = 0;
    for (let n = 1; n <= 40; n++) {
      const nx = n * x;
      if (nx > 80) break;
      sum += Math.exp(-nx) / n * (x * x * x + 3 * x * x / n + 6 * x / (n * n) + 6 / (n * n * n));
    }
    PLANCK[i] = 15 / pi4 * sum;
  }
}
function planckBelow(lambdaT) {
  if (lambdaT <= 2e-5) return 0;
  if (lambdaT >= 2e-1) return 1;
  const f = (Math.log(lambdaT) - PL_LO) * PL_SCALE;
  const i = f | 0;
  return PLANCK[i] + (PLANCK[i + 1] - PLANCK[i]) * (f - i);
}
const EDGE1 = 8e-6, EDGE2 = 12e-6, EDGE3 = 18e-6;   // m
const FR = new Float64Array(4);
export function bandFractions(T, out = FR) {
  const b1 = planckBelow(EDGE1 * T), b2 = planckBelow(EDGE2 * T), b3 = planckBelow(EDGE3 * T);
  out[0] = b1; out[1] = b2 - b1; out[2] = b3 - b2; out[3] = 1 - b3;
  return out;
}

// ---- band optical depths ---------------------------------------------------
// Fitted by Nelder-Mead against every literature target calibrate.mjs checks
// plus the shape constraints a stable hot branch, a real runaway limit and a
// snowball that is hard to leave all require, with each coefficient bounded and
// regularised toward the previous fit so the change is the smallest one that
// works. Twenty-four free numbers against twenty-two targets; the ones that
// moved most are water's four band exponents, which is the whole point.
const A1L = 0.101699, A1U = 0.999601, A1W = 14.3337, A1WL = 7.44879,
      A1WC = 0.000885543, A1G = 1.99995;
const A2W = 0.500001, A2C = 0.00259381;
const A3L = 0.257460, A3U = 10.1459, A3W = 59.8579, A3WC = 0.412834;
const A4W = 11.6448, A4U = 0.000100859;
const P_CO2 = 0.00000546000, P_CH4 = 0.00000690000, P_H2O = 0.00891768;
const D_CO2 = 1.44915;
const N_BROADEN = 0.300000;
// One exponent per band per gas. Water's four are the reason the runaway limit
// stopped moving with CO2: its opacity now grows steeply enough with vapour that
// a steam atmosphere closes CO2's own bands from underneath.
const EW0 = 0.922385, EW1 = 1.20380, EW2 = 1.35370, EW3 = 0.495225;
const EC0 = 1.80009, EC2 = 1.93957;
// Spectral coverage: the fraction of a band a line complex actually occupies.
const FC2 = 0.922333, FW0 = 0.620161, FG0 = 0.711622, QC = 0.205908;
const CIA_CH4 = 232.873;
export const TAU_CLOUD = 0.1;

// The effective grey optical depth of a band whose absorber occupies only a
// fraction phi of it. phi = 1 returns tau unchanged and everything adds as
// before; phi < 1 imposes a ceiling, because a line complex cannot black out
// more of a band than it covers however much gas you pile on. Re-expressed as an
// optical depth rather than a transmission so that gases still sum, which is
// what random overlap says they should do.
function tauEff(tau, phi) {
  if (!(tau > 0)) return 0;
  if (phi >= 1) return tau;
  const t = (1 - phi) + phi / (1 + 0.75 * tau / phi);
  return (1 / t - 1) / 0.75;
}

const TAU = new Float64Array(4);

export function bandTau(pCO2, pH2O, pCH4, pTot, pH2 = 0, out = TAU) {
  const br = Math.pow(clamp(pTot, 1e-6, 400), N_BROADEN);
  const pw = pH2O > 0 ? pH2O : 0;
  // One logarithm, six powers. Math.pow with a fractional exponent is a log and
  // an exp underneath, and water alone needs six exponents here; doing it this
  // way is worth a third of the cost of this function, on the hot path of an
  // eighteen-band solve.
  const lw = pw > 0 ? Math.log(pw) : 0;
  const pw0 = pw > 0 ? Math.exp(EW0 * lw) : 0;
  const pw1 = pw > 0 ? Math.exp(EW1 * lw) : 0;
  const pw2 = pw > 0 ? Math.exp(EW2 * lw) : 0;
  const pw3 = pw > 0 ? Math.exp(EW3 * lw) : 0;
  const pwc0 = pw > 0 ? Math.exp(EC0 * lw) : 0;
  const pwc2 = pw > 0 ? Math.exp(EC2 * lw) : 0;
  const u = pCO2 > 0 ? Math.pow(pCO2, D_CO2) : 0;
  const L = pCO2 > 0 ? Math.log(1 + pCO2 / P_CO2) : 0;
  const Lw = pw > 0 ? Math.log(1 + pw / P_H2O) : 0;
  const g = pCH4 > 0 ? Math.log(1 + pCH4 / P_CH4) : 0;
  const ciaC = pCH4 > 0 ? CIA_CH4 * pCH4 * pCH4 * Math.max(pTot, 0) : 0;
  const h2 = h2Cia(pH2, pTot);
  // Line bands broaden with pressure, so what they cover grows with it. CO2's
  // 15 um band and methane's 7.7 um band share one exponent; water's 6.3 um band
  // came out pressure-independent, which is what a band whose width is set by
  // its rotational envelope rather than by collisions should do.
  const qc = Math.pow(Math.max(pTot, 1e-6), QC);
  out[0] = A1L * L * br + A1U * u * br
         + tauEff(A1WL * Lw * br, FW0) + A1W * pw0 * br + A1WC * pwc0
         + tauEff(A1G * g * br, Math.min(1, FG0 * qc)) + H2_B1 * h2;
  out[1] = A2C * pCO2 * pCO2 + A2W * pw1 + ciaC + H2_B2 * h2;
  out[2] = tauEff(A3L * L * br, Math.min(1, FC2 * qc)) + A3U * u * br
         + A3W * pw2 * br + A3WC * pwc2 + H2_B3 * h2;
  out[3] = A4U * u * u * br + A4W * pw3 * br + ciaC + H2_B4 * h2;
  return out;
}

// ---------------------------------------------------------------------------
// Hydrogen, and why a trace gas that is not even a dipole matters.
//
// H2 has no permanent dipole moment and therefore no absorption bands at all on
// its own. What it has is collision-induced absorption: during a collision with
// another molecule the pair briefly acquires one, which lets H2 absorb while it
// climbs from one rotational state to the next. Being a two-body process it goes
// as the product of the two densities, so it is nothing in trace amounts and
// dominant at percent level under a thick atmosphere.
//
// What makes it matter for climate is *where* it absorbs. At room temperature
// the H2 CIA spectrum runs straight through the 8-12 um window (Wordsworth &
// Pierrehumbert 2013), which is precisely the part of the spectrum a CO2-H2O
// atmosphere leaves open. So hydrogen plugs the hole that everything else
// misses, and a few percent of it is worth more than doubling the CO2.
//
// Ramirez et al. (2014) is the anchor: 1.3-4 bar of CO2 with 5-20% H2 lifts
// early Mars above freezing where CO2 alone cannot reach 230 K at any pressure.
// They assume H2-CO2 CIA is as strong as H2-N2, for which cross sections are
// calculated, and note that if anything CO2 broadens harder. The coefficient
// here is fitted to their three published thresholds -- 273 K at ~3 bar with 5%
// H2, ~2.5 bar with 10%, ~1.6 bar with 20%.
// Fitted to Ramirez's three published thresholds and it lands on two of them
// exactly: 273 K at 3.0 bar with 5% H2 (he has 3), 2.2 bar with 10% (2.5) and
// 1.6 bar with 20% (1.6). With no hydrogen at all this model, like his, cannot
// get early Mars anywhere near freezing at any CO2 pressure whatever.
const K_H2 = 5.0;
const H2_B1 = 0.15, H2_B2 = 1.0, H2_B3 = 0.55, H2_B4 = 0.85;
export function h2Cia(pH2, pTot) {
  if (!(pH2 > 0)) return 0;
  return K_H2 * pH2 * Math.max(pTot, 0);
}

// ---------------------------------------------------------------------------
// CO2 condensation, and the maximum greenhouse it creates.
//
// Kasting et al. (1993) put the outer edge of the habitable zone at 0.36 S(+),
// and what sets it is not a shortage of greenhouse gas but a ceiling on how much
// good any amount of it can do. Pile CO2 onto a cold world and the upper
// atmosphere saturates: above the condensation level the profile follows CO2's
// own vapour-pressure curve rather than a dry adiabat, and along that curve
// temperature falls only logarithmically with pressure. The level the planet
// radiates from therefore stops getting colder however much CO2 is added, and
// the outgoing flux stops falling with it. Past that point more CO2 buys nothing
// and its Rayleigh scattering keeps costing, so the planet cools.
//
// Without this the greenhouse grew without limit and the outer edge did not
// exist: a world at 0.35 S(+) could be forced to +18 C under thirty bar of CO2,
// where every published treatment says no amount of CO2 gets it above freezing.
//
// The saturation curve is the one already in constants.js -- sublimation below
// the triple point, a two-point Clausius-Clapeyron fit over liquid above it,
// good to better than a per cent from Mars's 610 Pa frost point to the 73.77 bar
// critical point.
// ---------------------------------------------------------------------------
// The saturation curve itself already existed, in constants.js, accurate to
// better than a per cent from Mars's frost point to the critical point. Building
// a second one here was a waste and it is not here any more; frostPointCO2 takes
// pascals and is closed-form on both branches.

// CO2's own optical depth in each band -- the condensation floor is about where
// *CO2* goes opaque, not where the atmosphere as a whole does. A world whose far
// infrared is closed by hydrogen has no CO2 emission level there to pin.
const TAU_C = new Float64Array(4);
function bandTauCO2(pCO2, pTot, out = TAU_C) {
  if (!(pCO2 > 0)) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
  const br = Math.pow(clamp(pTot, 1e-6, 400), N_BROADEN);
  const u = Math.pow(pCO2, D_CO2);
  const L = Math.log(1 + pCO2 / P_CO2);
  const qc = Math.pow(Math.max(pTot, 1e-6), QC);
  out[0] = A1L * L * br + A1U * u * br;
  out[1] = A2C * pCO2 * pCO2;
  out[2] = tauEff(A3L * L * br, Math.min(1, FC2 * qc)) + A3U * u * br;
  out[3] = A4U * u * u * br;
  return out;
}

// Below this there is no CO2 emission level worth speaking of and the floor is
// skipped outright, which keeps it off Earth, Mars and everything Earth-like.
const CO2_COND_MIN = 0.05;                   // bar
// R/cp: 0.286 for air, 0.223 for CO2. What the dry adiabat is worth here is only
// whether it gets *below* the frost point, so the blend is enough.
const KAPPA_AIR = 0.286, KAPPA_CO2 = 0.223;
// Kelvins of supersaturation over which the floor comes fully on. A hard switch
// would put a kink in OLR(T) and the implicit solver differentiates through it.
const COND_BLEND = 12;
const FR_C = new Float64Array(4);

// How much of the outgoing flux is held up by CO2 condensing aloft.
function condensationFloor(T, pCO2, pTot, tau, fr, sT4, dry) {
  // The skin temperature: an atmosphere in radiative equilibrium does not get
  // colder than this, however far a dry adiabat extrapolated from the ground
  // says it should. Leaving it out had CO2 condensing in the stratosphere of a
  // 350 K hot-ocean world, which has a 217 K skin and condenses nothing.
  const Tskin = Math.pow(Math.max(dry, 1e-6) / SIGMA, 0.25) * 0.840896;
  // Nothing can condense anywhere if even the coldest level the atmosphere
  // reaches is above the frost point at the *highest* pressure in the column.
  // One closed-form call, and it is what keeps this off every warm thick-CO2
  // world without walking the bands.
  if (Tskin >= frostPointCO2(pCO2 * 1e5)) return dry;
  const kappa = KAPPA_AIR + (KAPPA_CO2 - KAPPA_AIR) * clamp(pCO2 / Math.max(pTot, 1e-9), 0, 1);
  const tc = bandTauCO2(pCO2, pTot);
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const opaque = 1 - 1 / (1 + 0.75 * tc[i]);
    const band = fr[i] * sT4 * ((1 - 0) / (1 + 0.75 * tau[i]));
    if (opaque < 0.02) { total += band; continue; }
    // Where CO2's own column reaches unit optical depth. Pressure broadening
    // makes tau grow as p^(1+n) down the column, so the level is p*tau^-1/(1+n).
    const pEmit = pCO2 * Math.pow(Math.max(tc[i], 1), -1 / (1 + N_BROADEN));
    const Tad = Math.max(T * Math.pow(pEmit / Math.max(pTot, 1e-9), kappa), Tskin);
    const Tcond = frostPointCO2(pEmit * 1e5);
    const sat = smoothstep(0, COND_BLEND, Tcond - Tad);
    if (sat <= 0) { total += band; continue; }
    const frc = bandFractions(Tcond, FR_C);
    const floor = frc[i] * SIGMA * Tcond * Tcond * Tcond * Tcond * opaque;
    total += band + sat * Math.max(0, floor - band);
  }
  return total;
}

export function olr(T, pCO2, pH2O, pCH4, pTot, pH2 = 0, cloud = 0) {
  const tau = bandTau(pCO2, pH2O, pCH4, pTot, pH2);
  const fr = bandFractions(T);
  const C = clamp(cloud, 0, 1);
  const sT4 = SIGMA * T * T * T * T;
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const t = tau[i];
    s += fr[i] * ((1 - C) / (1 + 0.75 * t) + C / (1 + 0.75 * (t + TAU_CLOUD)));
  }
  const F = sT4 * s;
  if (!(pCO2 > CO2_COND_MIN)) return F;
  // Clear-sky flux is what the floor is compared against; the cloud channel is
  // then scaled by the same ratio, because a cloud deck sits far below CO2's
  // emission level and does not change where that level is.
  let clear = 0;
  for (let i = 0; i < 4; i++) clear += fr[i] * sT4 / (1 + 0.75 * tau[i]);
  const lifted = condensationFloor(T, pCO2, pTot, tau, fr, sT4, clear);
  return lifted > clear ? F * (lifted / clear) : F;
}

// Total band-averaged optical depth, for readouts only. The physics never uses
// it -- there is no single optical depth any more, which is the whole point.
export function opticalDepth(pCO2, pH2O, pCH4, pTot, pH2 = 0) {
  const tau = bandTau(pCO2, pH2O, pCH4, pTot, pH2);
  const fr = bandFractions(288);
  let s = 0;
  for (let i = 0; i < 4; i++) s += fr[i] * tau[i];
  return s;
}

// ---------------------------------------------------------------------------
// Methane absorbs sunlight as well, and that is what caps its greenhouse.
//
// The near-infrared bands at 1.7, 2.3 and 3.3 um take solar energy and deposit
// it high in the atmosphere, where it is radiated back out rather than reaching
// the ground -- the same anti-greenhouse geometry as the haze, from the gas
// itself. Below about 10 Pa it is nothing. Above that it grows until it is
// comparable with the longwave warming, and the *total* forcing turns over:
//
//   "the shortwave absorption becomes significant for pCH4 > 10 Pa, with the
//    total (longwave plus shortwave) methane radiative forcing ... having a
//    maximum of approximately 8.5 W/m^2, compared to 9 W/m^2 in Byrne and
//    Goldblatt (2014)"        -- Eager-Nash et al. 2023, JGR 2022JD037544
//
// Past the peak more methane makes a planet *colder*, and at pCO2 below 1000 Pa
// a hazy-enough Archean can end up cooler than it would be with no methane at
// all. Eager-Nash put the peak warming at 3.5-7 K, between pCH4 of 30 and 300
// Pa, and the fall past it at up to 8 K by 3500 Pa. None of that existed here:
// methane was longwave-only, so its forcing simply grew, reaching 178 W/m^2 at
// 0.1 bar where the literature ceiling is nine. That is a twentyfold error and
// it is what let a world that lost its oxygen flash into a wet runaway.
//
// Weak-line absorption is linear in the column and saturates once the bands
// fill, so a plain exponential approach to a ceiling is the right shape. The
// ceiling is the share of the solar spectrum those bands can reach at all.
// SW_MAX and P_SW are fitted below to put the peak of the *net* forcing on
// Eager-Nash's 8.5 W/m^2 at their pCO2 = 1000 Pa; at modern Earth's 1.8 ppm the
// term is worth 4 mW/m^2, so nothing in the present-day calibration moves.
const SW_CH4_MAX = 0.081, P_SW_CH4 = 2.9e-3;   // bar

// The share of incoming sunlight methane absorbs before it reaches the ground.
export function ch4Shortwave(pCH4) {
  if (!(pCH4 > 0)) return 0;
  return SW_CH4_MAX * (1 - Math.exp(-pCH4 / P_SW_CH4));
}

// The peak of the saturated OLR curve: the runaway threshold for this planet.
// Clear-sky, because that is how the literature defines it. Reported in the UI
// so the player can see how close they are sailing.
export function runawayLimit(pCO2, pN2, pH2 = 0) {
  let best = 0, bestT = 0;
  for (let T = 275; T < 600; T += 1) {
    const p = psatH2O(T) / 1e5;
    const F = olr(T, pCO2, p, 0, pN2 + pCO2 + p + pH2, pH2, 0);
    if (F > best) { best = F; bestT = T; }
  }
  return { flux: best, T: bestT };
}

// ---------------------------------------------------------------------------
// Organic ("tholin") haze, and the anti-greenhouse effect.
//
// Ultraviolet light breaks methane into radicals that polymerise into a
// photochemical smog. It only happens in a *reducing* atmosphere: the haze
// switches on once CH4/CO2 climbs past roughly 0.1 and is destroyed outright by
// free oxygen (Trainer et al. 2006; Zerkle et al. 2012). That threshold is why
// the Archean could flip in and out of a haze while the modern Earth cannot,
// and why Titan is permanently shrouded.
//
// What makes it an *anti*-greenhouse is where the absorption happens. The haze
// soaks up sunlight high in the atmosphere and is nearly transparent in the
// thermal infrared, so the energy is radiated straight back to space from above
// instead of reaching the ground -- it cools the surface without trapping
// anything in return. On Titan it is worth about -9 K against a +21 K
// greenhouse, which is why the surface sits at 94 K and not 106
// (McKay, Pollack & Courtin 1991).
// ---------------------------------------------------------------------------
// HAZE_K is set by Titan and nothing else: it is the one world with a measured
// anti-greenhouse. At 1.27 the model lands on 93.9 K against an observed 94 K,
// having been 105.8 K without any haze at all -- so the effect is worth -11.9 K
// here against McKay et al.'s -9 K, close enough given that their split is
// against a different greenhouse baseline.
//
// Note this is the *absorbing* optical depth, not Titan's total extinction,
// which is several times larger. Most of that is scattering, which sends much
// of the light onward to the ground rather than removing it from the budget.
const HAZE_K = 1.27, HAZE_M = 0.33;

// Optical depth of the haze in the visible.
export function hazeOpacity(pCH4, pCO2, pO2 = 0, xuvRel = 1) {
  if (!(pCH4 > 0)) return 0;
  const ratio = pCH4 / Math.max(pCO2, 1e-12);
  const reducing = smoothstep(0.1, 0.6, ratio);
  if (reducing <= 0) return 0;
  // Free oxygen oxidises the precursors before they can polymerise.
  const survives = 1 - smoothstep(1e-4, 3e-3, pO2);
  // More ultraviolet, more photochemistry -- but with a strongly diminishing
  // return, because the haze shields the methane underneath it.
  const uv = Math.pow(clamp(xuvRel, 0.02, 300), 0.25);
  return HAZE_K * reducing * survives * uv * Math.pow(pCH4, HAZE_M);
}

// The share of incoming sunlight the haze intercepts before it can reach the
// ground. This is absorbed aloft, not reflected, so it does not belong in the
// planet's albedo -- it is subtracted from what heats the surface.
export function hazeShortwave(tau) {
  return tau > 0 ? 1 - Math.exp(-tau) : 0;
}

// ---------------------------------------------------------------------------
// Shortwave: surface + cloud + Rayleigh, tuned to Earth's 0.30 planetary albedo
// ---------------------------------------------------------------------------
export const ALB_OCEAN = 0.07, ALB_ICE = 0.60, ALB_SNOW = 0.68, ALB_CLOUD = 0.310;
// Frozen ground that carries no ice sheet is still frosted, and nothing like as
// dark as the same rock in summer -- but only if the world has water to frost
// it with. Mars is frozen solid and still reflects like dust.
export const ALB_FROST = 0.45;
// Ocean floor uncovered by a retreating or boiling sea: dark basalt and
// sediment, far darker than weathered continental surface.
export const ALB_SEABED = 0.12;

// Fractional sea-ice cover. Sea water freezes at about -2 C; the band is an
// annual, zonal mean over a whole latitude belt, so the transition is smeared
// across the seasonal swing rather than snapping at one temperature.
export function iceFraction(T) { return 1 - smoothstep(252, 276, T); }

// Ice *sheets* are a different thing and need a colder threshold. Snow has to
// survive the summer for a sheet to grow, which in the annual mean means
// roughly -8 C and below; that is why Siberia and northern Canada are frozen
// most of the year and carry no ice sheet, while Greenland does.
//
// Using the sea-ice curve for both put a bright ice sheet on any land that
// froze at all, including ground sitting at 0 C. That made the ice-albedo
// feedback far too strong -- the model sat a thousandth of a unit of cloud
// albedo away from a snowball, with an implied climate sensitivity of 5-7 K
// where the observed value is 3.
export function landIceFraction(T) { return 1 - smoothstep(243, 265, T); }

// Four distinct surfaces, because they reflect very differently and a planet
// can have any mixture of them:
//
//   open ocean    0.07   dark, absorbs nearly everything
//   sea ice       0.60   bright, and the reason ice-albedo feedback runs away
//   bare land    ~0.25   whatever the ground is made of
//   frozen land   0.45   frosted, but carrying no ice sheet
//   land ice      0.68   brightest of all, and it needs snowfall to exist
//
// `glaciated` is the share of frozen *land* carrying a real ice sheet, which is
// not the same as the frozen share: a world whose water cycle has shut down
// leaves its continents frosted but unglaciated (Snowball Earth; the Antarctic
// Dry Valleys). Such continents are markedly darker than an ice sheet, which is
// why a snowball with bare land is easier to escape than one buried in ice.
export function surfaceAlbedo(T, floodedFrac, landAlbedo, hasWater, glaciated = 0, waterCap = 1) {
  const flooded = clamp(floodedFrac, 0, 1);
  const land = 1 - flooded;
  if (!hasWater) return ALB_OCEAN * flooded + landAlbedo * land;
  const fi = iceFraction(T);
  const sea = ALB_OCEAN * (1 - fi) + ALB_ICE * fi;
  // `glaciated` is now the share of land actually under an ice sheet, worked out
  // with its own temperature threshold and its own multi-millennial response
  // time, rather than being read off the current temperature.
  const g = clamp(glaciated, 0, 1);
  // Frost needs water to deposit; a bone-dry frozen world stays the colour of
  // its dust.
  const frost = landAlbedo + (ALB_FROST - landAlbedo) * clamp(waterCap, 0, 1);
  const frosted = clamp(fi * (1 - g), 0, 1 - g);     // frozen ground, no sheet
  const ground = ALB_SNOW * g + frost * frosted + landAlbedo * (1 - g - frosted);
  return flooded * sea + land * ground;
}

// Cloud cover grows with the water-vapour column. Slow rotators and tidally
// locked worlds pile a thick reflective deck over the substellar point, which
// is what lets them stay habitable out to ~2x Earth's insolation (Yang+ 2014).
// Cloud *cover* on Earth is about 0.67 and barely moves: warming thins low cloud
// and lifts high cloud rather than changing how much of the sky is covered, and
// the observed total cloud feedback is small and slightly positive (+0.42
// W/m^2/K, IPCC AR6 7.4.2). Scaling cover linearly through Earth's vapour
// content made it grow by 2% per kelvin, and since cloud is brighter than ocean
// that came out as a cloud feedback of -1.5 W/m^2/K -- large, and the wrong
// sign. The deck now saturates well below Earth's vapour, so it is flat where
// Earth sits and still thickens into the steam regime, which is what keeps a
// slow rotator habitable out to ~2 S (Yang et al. 2014).
export function cloudCover(pH2O, slowness, subStellar) {
  const c0 = 0.67 * (1 + 0.6 * slowness * subStellar);
  return Math.min(0.88, c0 * Math.tanh(pH2O / 0.0030));
}

// How bright the cloud deck itself is, which is not a constant.
//
// Cloud *cover* saturates around Earth's value and stays there (above), so on
// its own it says a warming planet reflects no more than it used to. Cloud
// optical depth does not behave that way. A much moister column condenses more
// water per updraught and convects deeper, and the deck thickens and rises;
// 3-D models of planets driven toward the inner edge all find the hot branch is
// held up by clouds reflecting more, not by radiation alone (Wolf & Toon 2015;
// Popp et al. 2016; Leconte et al. 2013 for the same effect on the threshold).
//
// Without it this model had no hot branch at all. Water vapour's near-infrared
// absorption darkens a steam atmosphere -- the term at the end of
// planetaryAlbedo, which is real -- and with nothing opposing it the albedo
// *fell* from 0.285 at 300 K to 0.206 at 363 K. That is a positive feedback
// with no damper, and it broke the energy balance 23 K below the point where
// the OLR curve actually peaks: the planet went from 342 K straight to 560 °C,
// where Wolf & Toon hold a stable ocean at 362.8 K.
//
// It switches on above Earth-like humidity and is exactly zero at and below it,
// which is deliberate. Earth's cloud albedo is observed, the anchors pin it,
// and the AR6 cloud feedback is a *longwave* altitude effect that brightening
// the deck would move the wrong way. This is the shortwave behaviour of a much
// wetter atmosphere than any Earth anchor covers, so it is confined there:
// P_THICK_LO sits well above the 0.028 bar the modern tropics reach, and the
// deck tops out at an albedo of 0.43 -- thick, but well short of the 0.5-0.7 of
// a real deep convective deck, let alone Venus's 0.75.
const CLOUD_THICKEN = 0.40, P_THICK_LO = 0.10, P_THICK_HI = 0.45;   // bar of vapour

// And a slow rotator's substellar deck is a different object again.
//
// Yang, Cowan & Abbot (2014): a world that turns slowly convects hard and
// steadily at one fixed point, and what it builds there is not merely more cloud
// but far *brighter* cloud -- a deep, optically thick anvil sitting over the eye,
// exactly where all the sunlight arrives. It is a negative feedback with real
// force, because warming the dayside thickens the deck, and it is why slow
// rotators and tidally locked worlds stay habitable at insolations that would
// have boiled a fast rotator long before.
//
// This model used to get the direction of that and about a twentieth of the
// magnitude, through a cover term alone, with the deck no brighter than an
// ordinary cloud. The consequence was not a small error: a locked world tipped
// into a runaway at 0.54 S(+), where the literature has it habitable out past
// 1.4 -- Zhang & Yang (2020) put the runaway onset for a 60-day rotator at
// 1700-1950 W/m2, and worldbuildingpasta's survey of the same literature puts a
// locked world's inner edge near 0.66 au, which is 2.3 S(+).
//
// CLOUD_DECK is where the deck's albedo goes at the substellar point of a fully
// locked world. 0.72 is a thick convective anvil -- bright, but still below
// Venus's 0.75, and it is reached only where the rotation is slow, the point is
// under the star, and there is enough water to convect with.
const CLOUD_DECK = 0.72;
// How much of the vapour column sits above the cloud deck rather than below it.
const CLOUD_SHIELD = 0.30;

export function cloudAlbedo(pH2O, deck = 0) {
  const base = ALB_CLOUD * (1 + CLOUD_THICKEN * smoothstep(P_THICK_LO, P_THICK_HI, pH2O));
  const d = clamp(deck, 0, 1);
  return base + Math.max(0, CLOUD_DECK - base) * d;
}

export function planetaryAlbedo(T, o) {
  const surf = surfaceAlbedo(T, o.oceanFrac, o.landAlbedo, o.hasWater, o.glaciated, o.waterCap);
  const C = clamp(cloudCover(o.pH2O, o.slowness, o.subStellar) * (o.cloudBoost ?? 1), 0, 0.9);
  // The deck needs all three: a slow rotation to hold the convection in one
  // place, a point actually under the star, and water to build it out of.
  // Locking, not the period, is what anchors the deck. Yang's mechanism needs
  // the substellar point to stay in one place; a synchronous world has that by
  // definition however long its year is, so the deck is at full strength for any
  // locked world and only partial for a merely sluggish one. Blending the two
  // through `slowness` had a world locked at 264 h getting barely half a deck and
  // running away at 0.92 S(+), below a fast rotator -- backwards.
  const spin = Math.max(o.locked ?? 0, o.slowness ?? 0);
  const deck = spin * Math.pow(clamp(o.subStellar ?? 0, 0, 1), 1.5)
             * smoothstep(0.004, 0.05, o.pH2O);
  // Rayleigh + haze from the *dry* gas. Exponent set so a 92 bar CO2 atmosphere
  // reaches Venus's bright scattering (~0.7) while 1 bar stays at Earth's 0.06.
  const pDry = Math.max(0, o.pTot - o.pH2O);
  const rayleigh = Math.min(0.75, 0.06 * Math.pow(clamp(pDry, 0, 300), 0.545));
  // A thick steam envelope is dark, not bright: water vapour absorbs strongly in
  // the near infrared, so a runaway greenhouse soaks up sunlight rather than
  // reflecting it. Negligible at Earth's 0.01 bar of vapour, decisive above 1.
  //
  // But it does not apply equally to both paths, and treating it as if it did is
  // what kept a locked world's cloud deck from ever mattering. Sunlight that
  // reflects off the *top* of a deep convective deck turns round above most of
  // the column and never traverses it; only what goes through the gaps makes the
  // full journey. Attenuating the deck's own reflection by the whole vapour
  // column had a locked world's albedo falling as its eye got wetter -- the
  // opposite of the Yang, Cowan & Abbot mechanism, and the reason such a world
  // ran away at 0.54 S(+). CLOUD_SHIELD is the share of the column that still
  // sits above the deck.
  const dark = 1 / (1 + 1.2 * o.pH2O / (1 + o.pH2O));
  const darkAboveDeck = 1 / (1 + 1.2 * CLOUD_SHIELD * o.pH2O / (1 + o.pH2O));
  const cloudy = (rayleigh + (1 - rayleigh) * cloudAlbedo(o.pH2O, deck)) * darkAboveDeck;
  const clear = (rayleigh + (1 - rayleigh) * surf) * dark;
  const a = C * cloudy + (1 - C) * clear;
  return { albedo: clamp(a, 0.02, 0.92), cloud: C };
}
