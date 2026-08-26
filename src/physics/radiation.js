import { SIGMA, psatH2O, frostPointCO2, clamp, smoothstep } from './constants.js';

// ---------------------------------------------------------------------------
// Four-band longwave radiative transfer.
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
// differ by a factor of three. The semi-grey scheme this replaces put snowball
// deglaciation thirty times too low for exactly that reason, and no refit could
// move it -- driving CO2's snowball leverage down to the published value dragged
// the 280->560 ppm forcing below its floor at the same time.
//
// This is the fourth attempt at spectral bands here. The first two were
// atmospheric-window schemes and were reverted; the third worked and was not
// shipped, because a steam atmosphere radiated too freely through band 1 and
// pushed the habitable zone's inner edge out to 1.4 S(+). That was diagnosed at
// the time as a band-1 water-opacity problem and it was: band 1 had water as a
// single weak power law, w^0.48, which grows by a factor of two while the column
// grows by a factor of seventy. Two things were missing from it, and both are
// ordinary spectroscopy --
//
//   * the 6.3 um vibration-rotation band sits inside band 1 and saturates, so it
//     belongs in a logarithm, exactly like CO2's 15 um band; and
//   * the self-broadened continuum, which goes as the square of the vapour
//     pressure and is what actually closes the near infrared in a steam
//     atmosphere. Without it the dry subsiding fin kept radiating through band 1
//     at 450 K and the effective OLR curve never turned over at all -- no
//     runaway limit, just a hotter equilibrium.
//
// Band assignment is enforced rather than fitted: CO2's logarithmic term is
// large in band 3 and small in band 1 (where CO2 has only the weak 2.7 and
// 4.3 um pair), methane's 7.7 um band is in band 1, water's rotation band is in
// band 4, and band 2 is the window where only continua live.
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
// Fitted simultaneously to eleven published targets by Nelder-Mead, regularised
// toward the third attempt's coefficients so the fit makes the smallest change
// that fixes band 1 rather than wandering off to a different corner. The targets
// and their tolerances are the ones calibrate.mjs checks, plus the shape
// constraints that a stable hot branch and a real runaway limit both require.
//
// A1G is the exception to "fitted simultaneously": it is methane's 7.7 um band
// in band 0, and it is set on its own against Byrne & Goldblatt (2014) and
// Eager-Nash et al. (2023) rather than left where the joint fit put it. At 0.417
// the *net* methane forcing -- longwave less the shortwave absorbed aloft --
// peaked at 5.1 W/m^2 against their 8.5, which made methane worth about one
// kelvin on an Archean world. At 0.75 the peak is 7.4 W/m^2 near 100 Pa.
//
// It stops at 87 per cent of the published forcing rather than 100 because Earth
// pays for the rest: this term warms the pre-industrial world 0.14 K per 0.2 of
// coefficient, and that anchor was already 0.03 K over its ceiling. 0.75 costs it
// 0.26 K; 1.00 would buy the last 13 per cent for another 0.17, and Earth is the
// anchor that matters more.
//
// Titan does not move by a tenth of a kelvin across the whole range -- its
// greenhouse is haze and collision-induced absorption, not this band -- so
// nothing that anchored this coefficient before had any grip on it.
//
// A degeneracy worth recording, because it cost the third attempt an afternoon:
// Venus cannot tell "opaque" from "absurdly opaque". At 92 bar the band-3 term
// is saturated for any coefficient above about ten, so the fit is free to leave
// it at thousands -- identical on Venus, catastrophic on a world carrying one
// bar of CO2. Every coefficient here is bounded for that reason.
const A1L = 0.292930, A1U = 0.993371, A1W = 0.0446001, A1WL = 0.271230,
      A1WC = 20.0000, A1G = 0.75;
// Ceiling on the band-0 water self-continuum. That term goes as pH2O^2 with no
// pressure broadening -- 1.5e-7 at Earth's vapour, thousands in steam -- and its
// quadratic growth is what sets the runaway threshold. But band 0 spans 0-8 um,
// and a surface hot enough to be in a runaway radiates most of band 0 below 3 um
// where the continuum does not act at all. Left unbounded the term blacks out a
// spectral range that is physically clear, and the model climbs to its 4000 K
// clamp and integrates at a few years a step. The saturating form below leaves
// the term alone where it matters -- the saturated limit stays at 282 W/m^2 and
// the runaway threshold at 344 W/m^2 near 334 K, both to within 0.2 W/m^2 -- and
// gives band 0 a residual transmission once it is deep, so a runaway settles on
// a hot steam branch instead of pinning at the clamp.
//
// The value is set by two things it must not break, not by taste. Too low and
// the ceiling invents an equilibrium while the ocean is still there: at 10 a
// world at 1.6 S(+) settles at 410 C holding thirteen per cent of its water as
// liquid, three hundred kelvin above the critical point, and never boils. Any
// value from about 20 up boils it on schedule; 50 is chosen because it puts a
// settled runaway at 580 C, which is where the scheme this replaced put it, so
// nothing downstream of a runaway world moved.
const CONT_MAX = 50;
const A2W = 4.22658, A2C = 0.00260231;
const A3L = 0.217910, A3U = 13.5626, A3W = 6.72949, A3WC = 0.226336;
const A4W = 9.70414, A4U = 0.0000918162;
const P_CO2 = 5.46e-6, P_CH4 = 6.9e-6, P_H2O = 0.00891768;
const M_H2O = 0.482077, D_CO2 = 1.44915;
const N_BROADEN = 0.30;
// Methane collision-induced absorption, in the window and the far infrared.
// Refitted for the band scheme against Titan, which is the one world with a
// measured anti-greenhouse and the only thing anchoring it.
const CIA_CH4 = 232.873;
// Extra optical depth under cloud, and the reason every caller has to pass a
// cloud fraction: leave it out and the window sits spuriously wide open.
export const TAU_CLOUD = 0.1;

const TAU = new Float64Array(4);

// Optical depth in each band. `pH2` is the hydrogen partial pressure; its
// collision-induced absorption is handled in h2Cia() below.
export function bandTau(pCO2, pH2O, pCH4, pTot, pH2 = 0, out = TAU) {
  const br = Math.pow(clamp(pTot, 1e-6, 400), N_BROADEN);
  const w = pH2O > 0 ? Math.pow(pH2O, M_H2O) : 0;
  const wc = pH2O > 0 ? pH2O * pH2O : 0;
  const u = pCO2 > 0 ? Math.pow(pCO2, D_CO2) : 0;
  const L = pCO2 > 0 ? Math.log(1 + pCO2 / P_CO2) : 0;
  const Lw = pH2O > 0 ? Math.log(1 + pH2O / P_H2O) : 0;
  const g = pCH4 > 0 ? Math.log(1 + pCH4 / P_CH4) : 0;
  const ciaC = pCH4 > 0 ? CIA_CH4 * pCH4 * pCH4 * Math.max(pTot, 0) : 0;
  const h2 = h2Cia(pH2, pTot);
  const wcap = A1WC * wc;
  out[0] = (A1L * L + A1U * u + A1W * w + A1WL * Lw + A1G * g) * br
         + wcap / (1 + wcap / CONT_MAX) + H2_B1 * h2;
  out[1] = A2W * w * w * w + A2C * pCO2 * pCO2 + ciaC + H2_B2 * h2;
  out[2] = (A3L * L + A3U * u + A3W * w) * br + A3WC * wc + H2_B3 * h2;
  out[3] = (A4W * w + A4U * u * u) * br + ciaC + H2_B4 * h2;
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
// exist: a world at 0.35 S(+) could be forced to +15 C under thirty bar of CO2,
// where every published treatment says no amount of CO2 gets such a world above
// freezing. The old note here blamed Rayleigh scattering, and that turned out to
// be wrong -- measured against tau_R proportional to column with CO2's 2.2x
// cross-section, this model's CO2 Rayleigh is close to right (0.19 at 8 bar,
// 0.72 at 92, against ~0.22 and ~0.76). Condensation is what was missing.
//
// The saturation curve is the one already in constants.js -- sublimation below
// the triple point, a two-point Clausius-Clapeyron fit over liquid above it,
// good to better than a per cent from Mars's 610 Pa frost point to the 73.77 bar
// critical point.
// ---------------------------------------------------------------------------

// CO2's own optical depth in each band. The floor is about where *CO2* goes
// opaque, not where the atmosphere as a whole does: a world whose far infrared
// is closed by hydrogen has no CO2 emission level there to pin.
const TAU_C = new Float64Array(4);
function bandTauCO2(pCO2, pTot, out = TAU_C) {
  if (!(pCO2 > 0)) { out[0] = out[1] = out[2] = out[3] = 0; return out; }
  const br = Math.pow(clamp(pTot, 1e-6, 400), N_BROADEN);
  const u = Math.pow(pCO2, D_CO2);
  const L = Math.log(1 + pCO2 / P_CO2);
  out[0] = (A1L * L + A1U * u) * br;
  out[1] = A2C * pCO2 * pCO2;
  out[2] = (A3L * L + A3U * u) * br;
  out[3] = A4U * u * u * br;
  return out;
}

// Below this there is no CO2 emission level worth speaking of and the floor is
// skipped outright, which keeps it off Earth, Mars and everything Earth-like.
const CO2_COND_MIN = 0.05;                   // bar
// R/cp: 0.286 for air, 0.223 for CO2. All this adiabat has to decide is whether
// the level gets *below* the frost point, so the blend is enough.
const KAPPA_AIR = 0.286, KAPPA_CO2 = 0.223;
// Kelvins of supersaturation over which the floor comes fully on. A hard switch
// would put a kink in OLR(T) and the implicit solver differentiates through it.
const COND_BLEND = 12;
const FR_C = new Float64Array(4);

// How much of the outgoing flux is held up by CO2 condensing aloft.
//
// Applied band by band and *additively*. It was written as a ratio first --
// work out the clear-sky flux with and without the floor and scale the all-sky
// flux by it -- and that is fine until the surface emission goes to nothing, at
// which point the ratio goes to infinity. A world at 0.30 S(+) under a thousand
// times Earth's volcanism found it: the ratio drove the outgoing flux up without
// bound, the planet cooled without bound with it, and it settled at two kelvin
// with three tonnes per square metre of CO2 frost on the ground. Additively
// there is nothing to blow up, and each band's floor is capped at that band's
// own blackbody flux at the surface temperature, so the atmosphere can never be
// made to radiate more than the ground it sits on.
function condensationFloor(T, pCO2, pTot, tau, fr, sT4, dry, C) {
  // The skin temperature: an atmosphere in radiative equilibrium does not get
  // colder than this, however far a dry adiabat extrapolated from the ground
  // says it should. Leaving it out had CO2 condensing in the stratosphere of a
  // 350 K hot-ocean world, which has a 217 K skin and condenses nothing.
  const Tskin = Math.pow(Math.max(dry, 1e-6) / SIGMA, 0.25) * 0.840896;
  // Nothing condenses anywhere if even the coldest level the atmosphere reaches
  // is above the frost point at the *highest* pressure in the column. One
  // closed-form call, and it is what keeps this off every warm thick-CO2 world
  // without walking the bands.
  if (Tskin >= frostPointCO2(pCO2 * 1e5)) return dry;
  const kappa = KAPPA_AIR + (KAPPA_CO2 - KAPPA_AIR) * clamp(pCO2 / Math.max(pTot, 1e-9), 0, 1);
  const tc = bandTauCO2(pCO2, pTot);
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const t = tau[i];
    const band = fr[i] * sT4 * ((1 - C) / (1 + 0.75 * t) + C / (1 + 0.75 * (t + TAU_CLOUD)));
    const opaque = 1 - 1 / (1 + 0.75 * tc[i]);
    if (opaque < 0.02) { total += band; continue; }
    // Where CO2's own column reaches unit optical depth. Pressure broadening
    // makes tau grow as p^(1+n) down the column, so the level is p*tau^-1/(1+n).
    const pEmit = pCO2 * Math.pow(Math.max(tc[i], 1), -1 / (1 + N_BROADEN));
    const Tad = Math.max(T * Math.pow(pEmit / Math.max(pTot, 1e-9), kappa), Tskin);
    const Tcond = frostPointCO2(pEmit * 1e5);
    const sat = smoothstep(0, COND_BLEND, Tcond - Tad);
    if (sat <= 0) { total += band; continue; }
    const frc = bandFractions(Tcond, FR_C);
    const floor = Math.min(frc[i] * SIGMA * Tcond * Tcond * Tcond * Tcond * opaque, fr[i] * sT4);
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
  return condensationFloor(T, pCO2, pTot, tau, fr, sT4, F, C);
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
// SW_MAX and P_SW put the *turnover* where Eager-Nash put it, and the scale used
// to be seven times smaller than that. At 2.9e-3 bar the shortwave term became
// significant at 3 Pa, where the paper says 10, and it took the net forcing
// negative at 50 Pa -- inside the 30-300 Pa window where the same paper has the
// net forcing at its maximum. So methane was an anti-greenhouse gas across the
// whole Archean range: 300 Pa froze a world that 39 Pa held at +13 C.
//
// That was not a quiet error. The Great Oxidation self-tests passed their
// headline assertion -- "losing that greenhouse freezes the planet" -- for the
// exact opposite of the stated reason: the greenhouse was never lost, the
// biosphere drove methane from 404 to 3295 ppm, and 330 Pa of it froze the world
// by absorbing sunlight three scale heights up. The test was reading the bug as
// the physics. At 2.0e-2 the peak warming is +3.5 K near 100 Pa and methane is
// still warming at a millibar, which is the published shape, and that chain had
// to be rebuilt around a mechanism the model actually has.
//
// At modern Earth's 1.8 ppm the term is worth 0.4 mW/m^2, so nothing in the
// present-day calibration turns on it.
const SW_CH4_MAX = 0.081, P_SW_CH4 = 2.0e-2;   // bar

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
