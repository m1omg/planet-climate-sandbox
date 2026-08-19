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

const K_CO2 = 6.0585, M_CO2 = 0.3897;
const K_H2O = 2.959,  M_H2O = 0.36;
const K_CH4 = 12.0,   M_CH4 = 0.40;
const N_BROADEN = 0.30;

export function opticalDepth(pCO2, pH2O, pCH4, pTot) {
  const br = Math.pow(clamp(pTot, 1e-6, 400), N_BROADEN);
  let t = 0;
  if (pCO2 > 0) t += K_CO2 * Math.pow(pCO2, M_CO2);
  if (pH2O > 0) t += K_H2O * Math.pow(pH2O, M_H2O);
  if (pCH4 > 0) t += K_CH4 * Math.pow(pCH4, M_CH4);
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
// Shortwave: surface + cloud + Rayleigh, tuned to Earth's 0.30 planetary albedo
// ---------------------------------------------------------------------------
export const ALB_OCEAN = 0.07, ALB_ICE = 0.60, ALB_SNOW = 0.68, ALB_CLOUD = 0.375;

// Fractional ice cover: smooth over a 25 K window so nothing ever snaps.
export function iceFraction(T) { return 1 - smoothstep(253, 278, T); }

// waterCap: a planet with only a film of water cannot build a bright snowfield.
// Mars has frozen water and still reflects like dust, not like a snowball.
export function surfaceAlbedo(T, oceanFrac, landAlbedo, hasWater, waterCap = 1) {
  const bare = ALB_OCEAN * oceanFrac + landAlbedo * (1 - oceanFrac);
  if (!hasWater) return bare;
  const fi = iceFraction(T);
  const snow = landAlbedo + (ALB_SNOW - landAlbedo) * clamp(waterCap, 0, 1);
  return bare * (1 - fi) + (ALB_ICE * oceanFrac + snow * (1 - oceanFrac)) * fi;
}

// Cloud cover grows with the water-vapour column. Slow rotators and tidally
// locked worlds pile a thick reflective deck over the substellar point, which
// is what lets them stay habitable out to ~2x Earth's insolation (Yang+ 2014).
export function cloudCover(pH2O, slowness, subStellar) {
  const c0 = 0.67 * (1 + 0.6 * slowness * subStellar);
  return Math.min(0.88, c0 * Math.tanh(pH2O / 0.0110));
}

export function planetaryAlbedo(T, o) {
  const surf = surfaceAlbedo(T, o.oceanFrac, o.landAlbedo, o.hasWater, o.waterCap);
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
