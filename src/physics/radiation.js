import { SIGMA, psatH2O, clamp, smoothstep } from './constants.js';

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
// A semi-grey scheme cannot represent the reason the same continuum is
// irrelevant on Earth -- water vapour has already closed the window it absorbs
// in -- so the quadratic dependence carries that job instead, keeping it out of
// the way at any methane fraction a wet planet would have.
const CIA_CH4 = 867.0;

export function tauCH4(pCH4, pTot) {
  if (!(pCH4 > 0)) return 0;
  return A_CH4 * Math.log(1 + pCH4 / P_CH4) + CIA_CH4 * pCH4 * pCH4 * Math.max(pTot, 0);
}
const N_BROADEN = 0.30;

// Optical depth of CO2 alone, before pressure broadening.
export function tauCO2(pCO2) {
  if (!(pCO2 > 0)) return 0;
  return A_CO2 * Math.log(1 + pCO2 / P_CO2) + C_CO2 * Math.pow(pCO2, D_CO2);
}

export function opticalDepth(pCO2, pH2O, pCH4, pTot) {
  const br = Math.pow(clamp(pTot, 1e-6, 400), N_BROADEN);
  let t = tauCO2(pCO2);
  if (pH2O > 0) t += K_H2O * Math.pow(pH2O, M_H2O);
  if (pCH4 > 0) t += tauCH4(pCH4, pTot);
  return t * br;
}

export function olr(T, pCO2, pH2O, pCH4, pTot) {
  const tau = opticalDepth(pCO2, pH2O, pCH4, pTot);
  return SIGMA * T * T * T * T / (1 + 0.75 * tau);
}

// The peak of the saturated OLR curve: the runaway threshold for this planet.
// Reported in the UI so the player can see how close they are sailing.
export function runawayLimit(pCO2, pN2) {
  let best = 0, bestT = 0;
  for (let T = 275; T < 520; T += 1) {
    const p = psatH2O(T) / 1e5;
    const F = olr(T, pCO2, p, 0, pN2 + pCO2 + p);
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

export function planetaryAlbedo(T, o) {
  const surf = surfaceAlbedo(T, o.oceanFrac, o.landAlbedo, o.hasWater, o.glaciated, o.waterCap);
  const C = clamp(cloudCover(o.pH2O, o.slowness, o.subStellar) * (o.cloudBoost ?? 1), 0, 0.9);
  const withClouds = ALB_CLOUD * C + surf * (1 - C);
  // Rayleigh + haze from the *dry* gas. Exponent set so a 92 bar CO2 atmosphere
  // reaches Venus's bright scattering (~0.7) while 1 bar stays at Earth's 0.06.
  const pDry = Math.max(0, o.pTot - o.pH2O);
  const rayleigh = Math.min(0.75, 0.06 * Math.pow(clamp(pDry, 0, 300), 0.545));
  let a = rayleigh + (1 - rayleigh) * withClouds;
  // A thick steam envelope is dark, not bright: water vapour absorbs strongly in
  // the near infrared, so a runaway greenhouse soaks up sunlight rather than
  // reflecting it. Negligible at Earth's 0.01 bar of vapour, decisive above 1 bar.
  a *= 1 / (1 + 1.2 * o.pH2O / (1 + o.pH2O));
  return { albedo: clamp(a, 0.02, 0.92), cloud: C };
}
