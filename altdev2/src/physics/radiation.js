import { SIGMA, G_EARTH, psatH2O, clamp, smoothstep } from './constants.js';

// ---------------------------------------------------------------------------
// Semi-grey two-stream longwave:   OLR = sigma T^4 / (1 + 0.75 tau)
//
// Band optical depths take the form  tau = k * p_gas^m * p_total^0.3, the
// second factor being pressure broadening by the background air. The three
// coefficients were fitted simultaneously to three independent anchors:
//
//   * modern Earth        240 W/m^2 at 288 K, 280 ppm CO2, 1 bar   (observed)
//   * Venus               161 W/m^2 at 737 K under 92 bar CO2      (observed)
//   * the runaway limit   283 W/m^2 at 351 K for a saturated ocean
//
// The third is not imposed anywhere in the code: hold water at saturation and
// this expression *peaks* at 283 W/m^2, which is the Simpson-Nakajima limit
// (282 W/m^2, Goldblatt et al. 2013). Push absorbed sunlight past that peak and
// no equilibrium exists at any temperature -- the runaway greenhouse emerges
// from the radiative physics instead of being triggered by a threshold test.
// ---------------------------------------------------------------------------

// CO2's 15 um band is already saturated at its centre at Earth-like amounts, so
// adding more only widens the wings: the forcing grows with the *logarithm* of
// the amount, about 3.9 W/m^2 per doubling (Myhre et al. 1998, 5.35 ln(C/C0);
// IPCC AR6 Table 7.SM.1). A single power law reproduced Venus and got Earth
// badly wrong -- it made every doubling hit harder than the last, so a couple of
// percent of CO2 tipped the planet into a runaway that the literature puts at a
// hundred times pre-industrial or beyond (Ramirez et al. 2014; Goldblatt 2013).
//
// A_CO2 sets the forcing per doubling, P_CO2 the amount at which the band core
// saturates and the logarithm takes over. The second term is the
// pressure-induced continuum: utterly negligible below a few percent of a bar,
// and what carries Venus's 92 bar to an optical depth of 35.
const A_CO2 = 0.0514, P_CO2 = 5.46e-6, C_CO2 = 0.6735, D_CO2 = 0.87;
// Refitted when methane's opacity was corrected. The old value was propping up
// Earth's greenhouse alongside a methane term that was contributing 6.7 W/m^2
// where it should have been 0.7 -- take that away and Earth settled at 4 C. The
// water term is the only one that can absorb the difference without disturbing
// Venus (no methane) or the runaway limit (a saturated ocean, no methane), and
// as it happens the fit is better on both counts than it was: the
// Simpson-Nakajima limit lands at 282 W/m^2, which is the literature value
// exactly, where before it was 287.
//
// The exponent had to move too, and it is the exponent that made the refit
// possible at all. Earth sits at 0.011 bar of water vapour and the runaway peak
// at 0.43, so the coefficient alone could only trade one against the other --
// warming Earth pushed the runaway limit down to 263. Lowering the exponent
// puts relatively more opacity at Earth's end of that range than at the
// runaway's, which is what let both land at once.
const K_H2O = 2.989,  M_H2O = 0.34;

// Methane's bands are narrow and saturate early, so like CO2 its forcing goes
// as the logarithm of the amount, not as a power of it. The power law here was
// never anchored to anything and was four to ten times too strong: it gave the
// 1.8 ppm in modern air 6.7 W/m^2 where the accepted figure is about 0.7, and it
// made one millibar of methane a bigger greenhouse than twenty millibars of
// CO2. That is why an Archean world tipped into a runaway the moment the Sun
// brightened. Fitted to Myhre et al. 1998 at present-day amounts and to Byrne &
// Goldblatt 2014 at Archean ones.
const A_CH4 = 0.0293, P_CH4 = 6.9e-6;
// Collision-induced absorption: pairs of molecules absorbing during a collision,
// which needs no dipole and so has no bands to saturate. It is what actually
// keeps Titan warm, and being a two-body process it goes as the square of the
// density -- which is why it is nothing at a few parts per million and dominant
// under a bar and a half of cold nitrogen.
//
// Standing in for the CH4-N2 and N2-N2 continuum together, and fitted to Titan.
//
// The continuum lives in the far infrared, beyond about 16 um, which is where a
// 94 K surface does nearly all of its radiating and where a 288 K one does very
// little -- and on any wet planet that region is closed by the water vapour
// rotation band before methane gets a look in. The quadratic in pCH4 used to
// carry that job on its own, on the argument that no wet world holds enough
// methane for it to matter. It does not hold: fifteen millibars of methane over
// a temperate ocean is a perfectly reachable state, and there the Titan-fitted
// continuum was worth a quarter of an optical depth in front of the *whole*
// Planck function. That is what turned an anoxic world into a runaway.
//
// So the masking is now written down as what it actually is. Water vapour
// closes the far infrared at a few kilograms a square metre -- millimetres of
// precipitable water, a hundredth of what Earth carries -- and Titan, at 1e-14
// bar of vapour, keeps its continuum untouched. A cold dry world keeps it too,
// which is right: that is exactly where the far infrared is both open and where
// the surface is radiating.
const CIA_CH4 = 867.0, CIA_H2O_MASK = 1.0e-3;   // bar of vapour

export function tauCH4(pCH4, pTot, pH2O = 0) {
  if (!(pCH4 > 0)) return 0;
  const open = pH2O > 0 ? Math.exp(-pH2O / CIA_H2O_MASK) : 1;
  return A_CH4 * Math.log(1 + pCH4 / P_CH4)
       + CIA_CH4 * pCH4 * pCH4 * Math.max(pTot, 0) * open;
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
// ---------------------------------------------------------------------------
// Hydrogen, which absorbs by colliding rather than by having a band.
//
// H2 is symmetric and has no permanent dipole, so on its own it has no
// rotational-vibrational spectrum to speak of and ought to be transparent. It
// is not, because during a collision the pair briefly does have a dipole, and
// the resulting continuum has no line structure and therefore nothing to
// saturate. That is what makes it a greenhouse gas that keeps getting stronger
// the more of it there is, long after CO2 has gone logarithmic -- and it is why
// forty bar of it can hold a surface at 280 K ten astronomical units from a
// Sun-like star, where the sunlight is a hundredth of Earth's.
//
// Being a two-body process the absorption goes as the product of the two
// densities, and integrating that down a hydrostatic column gives
//
//     tau  ~  x_H2 * P_surf^2 / g        i.e.   p_H2 * p_tot / g
//
// which is the form used here. The 1/g is not decoration: these are worlds of
// three to ten Earth masses, and at twice Earth's gravity the same surface
// pressure stands over half the molecules. Every other opacity term in this
// file is written in pressures alone with g folded into a constant fitted at
// Earth's gravity, which is fine for a term anchored on Earth and wrong by a
// factor of two for one anchored on a super-Earth.
//
// Added AFTER the pressure-broadening factor rather than inside it, unlike the
// methane continuum above. That term is inside because it was fitted there, to
// Titan, and moving it would move Titan. This one is quadratic in pressure
// because the physics says quadratic; multiplying it by p^0.3 as well would
// make it p^2.3 for no reason anyone could defend.
//
// CIA_H2 is fitted to Pierrehumbert & Gaidos 2011 (ApJ 734, L13): 40 bar of
// pure H2 on a three Earth-mass planet holds 280 K at 10 AU from a G star.
// That is the ONLY anchor behind it, and it deserves saying plainly -- every
// other opacity constant in this file was fitted against two or three
// independent observations, and several of them against a measured planet.
// This one is fitted against one number from one 1-D model of a planet nobody
// has ever seen. It is the least constrained number in the model.
//
// The fit is a bisection on that single anchor, run on a LIFELESS world because
// that is the world they modelled -- an Earth biosphere on it darkens the
// ground enough to be worth six kelvin, which is more than the anchor's whole
// tolerance. It lands on 280.007 K. `tools/calibrate.mjs` re-runs the same
// world under the same conditions every time it is called, so the two cannot
// drift apart quietly.
const CIA_H2 = 0.3826;
// Helium collides too, and about ten times less effectively per collision than
// hydrogen does: it is lighter, smaller, and its interaction with H2 induces a
// weaker dipole than an H2-H2 encounter. So it is a correction to the
// collision partner, not a second mechanism -- a hydrogen envelope diluted
// with helium is slightly less opaque than the same pressure of pure H2.
const CIA_HE_REL = 0.1;

// Optical depth of a hydrogen envelope. `pHe` is subtracted out of the
// collision partner and added back at its own reduced weight.
export function tauH2(pH2, pTot, g = G_EARTH, pHe = 0) {
  if (!(pH2 > 0)) return 0;
  const partner = Math.max(pTot - pHe * (1 - CIA_HE_REL), 0);
  return CIA_H2 * pH2 * partner * (G_EARTH / Math.max(g, 0.01));
}

const N_BROADEN = 0.30;

// Optical depth of CO2 alone, before pressure broadening.
// One-entry memo, and it is not a micro-optimisation: CO2 is well mixed, so
// every band in a call to update() or radiativeDamping() passes the SAME pCO2,
// and this was recomputing an identical log and an identical fractional power
// seventy-odd times a step. The cache is exact -- same argument, same answer --
// and a single slot is all that is needed because the calls come in runs.
let tauCO2p = -1, tauCO2v = 0;
export function tauCO2(pCO2) {
  if (!(pCO2 > 0)) return 0;
  if (pCO2 === tauCO2p) return tauCO2v;
  tauCO2p = pCO2;
  return (tauCO2v = A_CO2 * Math.log(1 + pCO2 / P_CO2) + C_CO2 * Math.pow(pCO2, D_CO2));
}

// The pressure-broadening factor, memoised on one slot for the same reason
// tauCO2 is: every band asks for the moist and the dry optical depth at the
// SAME total pressure, so the calls arrive in identical pairs, and inside
// radiativeDamping in identical runs.
let brP = -1, brV = 0;
function broadening(pTot) {
  if (pTot === brP) return brV;
  brP = pTot;
  return (brV = Math.pow(clamp(pTot, 1e-6, 400), N_BROADEN));
}

// The hydrogen arguments are optional and default to nothing, which is what
// makes this safe to add to a model that has had four gases in it for its whole
// life: a world with no envelope takes the `pH2 > 0` branch never, so not one
// floating-point operation in its optical depth changes.
export function opticalDepth(pCO2, pH2O, pCH4, pTot, pH2 = 0, g = G_EARTH, pHe = 0) {
  const br = broadening(pTot);
  let t = tauCO2(pCO2);
  if (pH2O > 0) t += K_H2O * Math.pow(pH2O, M_H2O);
  if (pCH4 > 0) t += tauCH4(pCH4, pTot, pH2O);
  t *= br;
  if (pH2 > 0) t += tauH2(pH2, pTot, g, pHe);
  return t;
}

// ---------------------------------------------------------------------------
// Convective inhibition: why a hydrogen world runs away so much sooner.
//
// Convection needs a parcel that rises to stay buoyant. Lift moist air and it
// cools, water condenses, latent heat is released, and on Earth that release is
// what keeps it rising -- moist convection is self-sustaining. In a HYDROGEN
// background the same process works against itself, because water is nine times
// heavier than the air it is condensing out of. A parcel that has given up its
// water is left lighter, yes, but the parcel it rose from was made heavier by
// keeping it, and above a critical abundance the composition gradient wins:
// the atmosphere is stably stratified even though it is superadiabatic, and
// convection simply stops.
//
// The criterion is Leconte, Selsis, Hersant & Guillot 2017 (A&A 598, A98),
// following Guillot 1995. In mass mixing ratio,
//
//     q_inh = R·T / ((mu_v − mu_d)·L)
//
// which for water in hydrogen at 300 K is 6.9% by mass -- 0.82% by MOLE. That
// is a very small number, and it is the point: essentially any humid hydrogen
// atmosphere is inhibited. It is also consistent with the ~1.2% quoted for
// Uranus and Neptune, which are the two places in this solar system where the
// same physics is thought to operate.
const R_UNIV = 8.314;            // J/(mol K)
const MU_H2O_KG = 0.018015, MU_H2_KG = 0.002016;   // kg/mol
const L_VAP = 2.26e6;            // J/kg

export function inhibitionMoleFraction(T) {
  const q = R_UNIV * Math.max(T, 1) / ((MU_H2O_KG - MU_H2_KG) * L_VAP);
  if (!(q > 0) || q >= 1) return 1;
  return (q / 18.015) / (q / 18.015 + (1 - q) / 2.016);
}

// ...and what this model can honestly do about it.
//
// It cannot represent a superadiabatic layer. This is a semi-grey scheme with a
// single optical depth and no vertical coordinate at all; there is nowhere to
// put one, and drawing a temperature profile it does not solve would be a lie
// told in a comment. What it can carry is the CONSEQUENCE. An inhibited layer
// means the surface sits further below the radiating level than a moist adiabat
// would put it, so at a given outgoing flux the surface is hotter -- which is
// exactly what more optical depth does. So the parameterisation is a multiplier
// on tau, and it is a parameterisation of vertical structure this model does not
// resolve, stated as such here and in the README rather than buried.
//
// Gated three ways so it cannot reach any world that predates it: there must be
// hydrogen, it must be the background rather than a trace, and the air must be
// wetter than the criterion. Every world this model shipped with fails the
// first test, so the multiplier is exactly 1 and tau is untouched.
// One number, and it is NOT fitted to the inner edge, because the inner edge
// cannot be reached from here and finding that out is the most useful thing
// this phase produced.
//
// Innes, Tsai & Pierrehumbert 2023 put the 1 bar Hycean inner edge at 1.6 AU
// from a G star -- 0.391 S(+) -- where this model, with hydrogen but without
// inhibition, said 1.04. Turning the multiplier up closes that gap at a rate of
// about fourteen percent per doubling: 2.0 gives 0.70, 4.0 gives 0.60. Reaching
// 0.391 would take a multiplier near THIRTY-TWO on the total optical depth.
//
// That is not a parameterisation any more, it is a different model. A factor of
// thirty-two would make this term larger than every other opacity in the file
// put together, on a world where the only thing constraining it is the number
// it was bent to reproduce. So it is not done. The strength below is chosen on
// physical grounds -- superadiabatic layers in the Uranus and Neptune
// literature enhance the surface-to-radiating-level contrast by tens of
// percent, not by thirty-fold -- and the residual is reported as a GAP.
//
// The honest reading is the one the phase was designed to test: a semi-grey
// scheme with a single optical depth and no vertical coordinate cannot
// represent a superadiabatic layer, and multiplying tau is a shadow of one, not
// a substitute. It closes about forty percent of the gap. The rest of the gap
// is the missing vertical structure, and it stays visible.
//
// It was briefly two numbers. A second constant scaled the strength with
// envelope pressure, to reach for their 10 bar edge at 3.85 AU as well -- and
// it did nothing whatever, across a range of values that should have changed
// the answer threefold. The reason is in the criterion rather than in the code:
// q_inh is a MOLE FRACTION, so ten bar of hydrogen dilutes the same water ten
// times over and the threshold is simply not reached at the temperatures where
// that world's runaway peak sits. The criterion says a thick dry envelope is
// not inhibited, and it means it.
//
// So the knob came out. Shipping a fitted parameter that provably does not
// affect the thing it was fitted to is worse than not having it: it looks like
// the 10 bar case has been accounted for. It has not, and there is a GAP row
// saying so.
const INH_STRENGTH = 4.0;
const INH_DOMINANCE = 0.5;       // below this H2 share it is not the background

export function inhibitionFactor(pH2O, pH2, pTot, T) {
  if (!(pH2 > 0) || !(pTot > 0)) return 1;
  // Hydrogen's share of the DRY air, not of everything. Measured against the
  // total it looked right and was not: past about 380 K the water vapour over a
  // one-bar envelope exceeds a bar itself, hydrogen's share of the column falls
  // under a half, and the gate closed -- switching the effect off at 373 K,
  // which is precisely where the runaway threshold for that envelope sits. The
  // criterion is about a heavy condensable in a light background, and the
  // condensation happens aloft where the water is a trace and the hydrogen is
  // unambiguously the background. What the gate is for is telling a hydrogen
  // world from a nitrogen one; water's own abundance is the OTHER test, below.
  const dry = Math.max(pTot - pH2O, 1e-12);
  const fH2 = Math.min(pH2 / dry, 1);
  if (fH2 < INH_DOMINANCE) return 1;
  const x = pH2O / pTot;
  const xInh = inhibitionMoleFraction(T);
  if (!(x > xInh)) return 1;
  // Smoothed, but only just, and the width matters more than it looks. A
  // discontinuity in optical depth at the moment a planet is deciding whether
  // to run away is a step-size trap and this model has been bitten by that
  // before -- so it is smoothed. But the criterion is a THRESHOLD, not a
  // gradient: past q_inh convection stops, and how far past makes no
  // difference to whether it has stopped.
  //
  // Getting the width wrong is instructive in both directions. Smoothed across
  // a factor of two in the excess, the strength depended on how wet the air
  // was, and the runaway peak migrated to the coldest, driest end of the scan
  // where the effect was worth 8% of itself. Narrowed to twenty percent either
  // side of the threshold, it became a CLIFF: outgoing flux fell from 204 to 56
  // W/m2 across five kelvin, runawayLimit()'s peak-finder latched onto the last
  // uninhibited point, and raising the strength stopped moving the answer at
  // all -- it only deepened the cliff. That is the non-monotonicity that showed
  // up while fitting, and it is worth naming: with a discontinuity in the
  // curve, "the peak of the saturated OLR" stops meaning the Simpson-Nakajima
  // limit and starts meaning "wherever the scan last stood before the drop".
  //
  // A factor of three, which spreads the transition over roughly fifteen
  // kelvin. That is not derived from anything -- the criterion is a threshold
  // and the real transition happens over an inhibited layer growing downward
  // from the condensation level, which this model has no coordinate for. It is
  // chosen to be wide enough that the flux curve stays a curve.
  const engaged = smoothstep(xInh, 3 * xInh, x);
  return 1 + INH_STRENGTH * fH2 * engaged;
}

export function olr(T, pCO2, pH2O, pCH4, pTot, pH2 = 0, g = G_EARTH, pHe = 0) {
  let tau = opticalDepth(pCO2, pH2O, pCH4, pTot, pH2, g, pHe);
  // Applied here rather than inside opticalDepth() because the criterion needs
  // a temperature and that function does not have one -- and giving it one
  // would change a signature four other things depend on for no gain.
  if (pH2 > 0) tau *= inhibitionFactor(pH2O, pH2, pTot, T);
  return SIGMA * T * T * T * T / (1 + 0.75 * tau);
}

// The peak of the saturated OLR curve: the runaway threshold for this planet.
// Reported in the UI so the player can see how close they are sailing.
// The scan used to stop at 520 K, which was comfortably past the peak for any
// world this model could build: a saturated Earth peaks at 351 K and the curve
// only falls after it. A hydrogen envelope moves the peak, and the states this
// branch exists to reach are stable at 350-550 K, so a ceiling inside that band
// would report the edge of the scan as if it were the physics. 700 K is past
// the critical point, where there is no saturated branch left to walk.
export function runawayLimit(pCO2, pN2, pH2 = 0, g = G_EARTH, pHe = 0) {
  let best = 0, bestT = 0;
  for (let T = 275; T < 700; T += 1) {
    const p = psatH2O(T) / 1e5;
    const F = olr(T, pCO2, p, 0, pN2 + pCO2 + p + pH2 + pHe, pH2, g, pHe);
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
// Cloud on a slow rotator is not the same cloud. 0.310 is Earth's mixture --
// mostly thin stratus and cirrus, spread about by a fast circulation that never
// lets convection sit still. A world whose solar day is months long parks its
// convection over the substellar point instead, and what grows there is a deep
// tower with an anvil on top: optically thick, and far brighter than the
// planetary average this model was tuned to.
//
// That is the mechanism behind Yang, Boue, Fabrycky & Abbot (2014), who found
// slowly rotating planets stay habitable out to nearly twice Earth's flux, and
// behind Way et al. (2016), whose paleo-Venus sits at 11 C under 1.40 S(+) with
// a 243-day rotation and whose dayside is at 100% high cloud in individual
// cells. Spin the same planet up to a 16-day day and it is 45 K hotter.
export const ALB_CLOUD_DEEP = 0.62;

// How white a cloud is depends on what colour the star is.
//
// Cloud droplets and water ice are excellent reflectors in the visible and
// poor ones past about 1.4 um, where water absorbs. A G star puts 88% of its
// flux shortward of that; TRAPPIST-1, at 2566 K, puts 46% there and the rest
// into a near infrared that clouds and snow largely swallow. This is the same
// reason the ice-albedo feedback is weak around M dwarfs (Joshi & Haberle 2012;
// Shields et al. 2013) -- a planet round a red star is simply darker than the
// same planet round the Sun, whatever it is made of.
//
// Returned relative to the Sun, so a solar-type star is 1 by construction and
// nothing calibrated against Earth moves.
//
// NOT applied to the ice and snow albedos, which is where Joshi and Shields put
// most of the effect. Doing that proprly means refitting ALB_ICE and ALB_SNOW,
// which Earth's calibration is resting on; this term covers only the deep-cloud
// enhancement below, which is new here and has nothing resting on it yet.
const WIEN_C2 = 1.4388e-2;          // m*K
const CLOUD_CUTOFF = 1.4e-6;        // m, where water stops reflecting

// Fraction of a blackbody's radiant flux shortward of `lambda`. The standard
// series for the fractional emissive power; six terms is far past convergence
// for the range of x that matters here.
export function fluxBelow(lambda, T) {
  if (!(T > 0)) return 0;
  const x = WIEN_C2 / (lambda * T);
  let sum = 0;
  for (let n = 1; n <= 6; n++) {
    sum += Math.exp(-n * x) * (x * x * x / n + 3 * x * x / (n * n)
         + 6 * x / (n * n * n) + 6 / (n * n * n * n));
  }
  return clamp(15 / Math.pow(Math.PI, 4) * sum, 0, 1);
}

const SOLAR_WHITE = fluxBelow(CLOUD_CUTOFF, 5772);
export function cloudWhiteness(starTemp) {
  const T = starTemp > 0 ? starTemp : 5772;
  return clamp(fluxBelow(CLOUD_CUTOFF, T) / SOLAR_WHITE, 0, 1.15);
}
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
  // tanh saturates to 1 within double precision by an argument of about 20, and
  // most worlds here sit far past that -- Earth's 11 mbar is already 3.7 and
  // anything wetter is off the end. Skipping the call there is exact, not an
  // approximation.
  const x = pH2O / 0.0030;
  return Math.min(0.88, x > 20 ? c0 : c0 * Math.tanh(x));
}

let rayP = -1, rayV = 0;
function rayleighOf(pDry) {
  if (pDry === rayP) return rayV;
  rayP = pDry;
  return (rayV = Math.min(0.75, 0.06 * Math.pow(clamp(pDry, 0, 300), 0.545)));
}

// Writes into `out` instead of allocating, because this is called some fifty
// times a step -- once per band in update() and twice per band inside the
// Jacobian -- and a short-lived object per call is real garbage.
//
// planetaryAlbedo() below keeps allocating, and has to: callers in selftest.js
// and calibrate.mjs hold two results side by side to difference them, which a
// shared scratch object would silently break.
export function planetaryAlbedoInto(T, o, out) {
  const surf = surfaceAlbedo(T, o.oceanFrac, o.landAlbedo, o.hasWater, o.glaciated, o.waterCap);
  const C = clamp(cloudCover(o.pH2O, o.slowness, o.subStellar) * (o.cloudBoost ?? 1), 0, 0.9);
  // How bright that cloud is, which depends on how long it has been standing in
  // one place. `slowness` is already the blend of solar-day length and full
  // synchronisation that the rest of the model uses, so Earth at 24 h gets
  // exactly the 0.310 it was calibrated with and nothing here moves.
  // ...and on there being a sea to build it out of. A deep convective tower is
  // fed by a moist boundary layer over open water; Way's paleo-Venus grows its
  // 100% dayside deck over a 60%-flooded ocean. A world whose water is all
  // frozen onto the night side has nothing to lift, and gating on `slowness`
  // alone gave it the bright deck anyway -- which cooled the sunlit face below
  // the temperature that makes it a desert and removed the night-side cold trap
  // (Menou 2013, Leconte 2013) from the reachable parameter space entirely. Not
  // a subtle loss: a sweep of thirty-six configurations across water, nitrogen
  // and insolation found the trapped state at none of them.
  const moist = clamp((o.oceanFrac ?? 0) / 0.25, 0, 1);
  const albCloud = ALB_CLOUD + (ALB_CLOUD_DEEP - ALB_CLOUD)
    * clamp(o.slowness ?? 0, 0, 1) * (o.cloudWhite ?? 1) * moist;
  const withClouds = albCloud * C + surf * (1 - C);
  // Rayleigh + haze from the *dry* gas. Exponent set so a 92 bar CO2 atmosphere
  // reaches Venus's bright scattering (~0.7) while 1 bar stays at Earth's 0.06.
  // pDry is the same number for every band -- pTot is the dry gases plus that
  // band's vapour, so subtracting the vapour leaves the dry gases, which are
  // well mixed. So this was one fractional power recomputed with an identical
  // argument fifty-odd times a step. One slot, same reason as tauCO2.
  const pDry = Math.max(0, o.pTot - o.pH2O);
  const rayleigh = rayleighOf(pDry);
  let a = rayleigh + (1 - rayleigh) * withClouds;
  // A thick steam envelope is dark, not bright: water vapour absorbs strongly in
  // the near infrared, so a runaway greenhouse soaks up sunlight rather than
  // reflecting it. Negligible at Earth's 0.01 bar of vapour, decisive above 1 bar.
  a *= 1 / (1 + 1.2 * o.pH2O / (1 + o.pH2O));
  out.albedo = clamp(a, 0.02, 0.92);
  out.cloud = C;
  return out;
}

export function planetaryAlbedo(T, o) {
  return planetaryAlbedoInto(T, o, { albedo: 0, cloud: 0 });
}
