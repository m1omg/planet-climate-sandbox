// Physical constants and Earth reference values.
// Everything is SI unless a name says otherwise. Gas inventories are stored as
// *column masses* in kg/m^2, so partial pressure is simply column * g.

export const SIGMA = 5.670374419e-8;   // Stefan-Boltzmann, W/m^2/K^4
export const G_GRAV = 6.67430e-11;     // gravitational constant
export const YEAR = 3.155815e7;        // seconds in a year

export const M_EARTH = 5.9722e24;      // kg
export const R_EARTH = 6.371e6;        // m
export const G_EARTH = 9.807;          // m/s^2
export const S_EARTH = 1361.0;         // W/m^2 solar constant at 1 AU
export const P_EARTH = 1.0132e5;       // Pa

// 1 Earth Ocean = 1.4e21 kg spread over Earth's surface = 2.75e6 kg/m^2 (2750 m deep)
export const EO_COLUMN = 1.4e21 / (4 * Math.PI * R_EARTH * R_EARTH); // kg/m^2

// Earth's present atmosphere as column masses (kg/m^2)
export const N2_EARTH_COL = 0.78 * P_EARTH / G_EARTH;      // ~8060
export const CO2_EARTH_COL = 280e-6 * P_EARTH / G_EARTH;   // ~2.89  (280 ppm)
export const CH4_EARTH_COL = 1.8e-6 * P_EARTH / G_EARTH * 44 / 16; // ~0.0068

// Net volcanic CO2 outgassing, column kg/m^2 per year. Tuned so that a hard
// snowball takes millions of years to accumulate enough CO2 to break out,
// matching the observed durations (Marinoan 4-15 Myr, Sturtian ~56 Myr).
//
// Earth's own temperature is almost untouched by this number -- the
// carbonate-silicate thermostat absorbs it, holding 287.5-287.7 K across a
// threefold change -- so it can be set from the snowball record without
// disturbing the modern-Earth anchor.
export const OUTGAS_EARTH = 5.2e-4;

// Carbon held in ocean + reactive crust relative to the atmosphere. Makes the
// carbonate-silicate thermostat relax on ~1 Myr rather than ~5 kyr.
export const CARBON_RESERVOIR_FACTOR = 50;

// XUV flux as a fraction of bolometric, present-day Sun.
export const XUV_FRACTION_SUN = 3.4e-6;

export const T_FREEZE = 273.15;

// The triple point of water: 611.657 Pa at 273.16 K. Below this pressure liquid
// water is not merely unlikely, it is thermodynamically impossible -- ice
// sublimates straight to vapour and any liquid boils. It is the reason Mars,
// whose surface sits at about 610 Pa, has no standing water.
export const P_TRIPLE_H2O = 611.657;
export const T_TRIPLE_H2O = 273.16;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// --- Saturation vapour pressure of water (Pa) -------------------------------
// IAPWS-IF97 saturation line over 273-647 K; Buck over ice below; supercritical
// above the critical point (water can no longer condense at all).
const IAPWS = [-7.85951783, 1.84408259, -11.7866497, 22.6807411, -15.9618719, 1.80122502];
export const T_CRIT_H2O = 647.096;
export const P_CRIT_H2O = 22.064e6;      // Pa, not bar

// How opaque a steam envelope looks, 0 to 1. Both renderers use this, so they
// cannot drift apart.
//
// This was linear and saturated at 3 bar of water vapour, which is about 134 C
// -- and at 134 C some 95% of an Earth ocean is still liquid. So the planet went
// featureless white at the very start of a runaway and stayed that way, hiding
// the whole interesting part: the sea actually boiling away. An Earth ocean is
// 270 bar of steam once it is all airborne, so that is where the atmosphere
// really does become an opaque envelope, and the approach to it is spread over
// two and a half decades of pressure rather than crammed into the first one.
export function steamOpacity(pH2O) {
  const over = Math.max(0, pH2O - 0.05);          // Earth's 11 mbar reads as zero
  return clamp(Math.log10(1 + over / 0.5) / Math.log10(1 + 150 / 0.5), 0, 1);
}

export function psatH2O(T) {
  if (T >= T_CRIT_H2O) return P_CRIT_H2O * (1 + (T - T_CRIT_H2O) * 0.01); // no condensation
  if (T < 273.15) {
    if (T < 100) return 1e-12;
    return 611.657 * Math.exp(22.587 * (T - 273.15) / (T + 0.71));
  }
  // The half-integer powers written as a single square root and some multiplies.
  // This is the hottest function in the model by a wide margin -- 28% of a stiff
  // run's whole CPU time, because every band asks for it several times a step --
  // and Math.pow with a fractional exponent is the slowest way to get any of
  // them. th^1.5 = th*sqrt(th), th^3.5 = th^3*sqrt(th), th^7.5 = th^7*sqrt(th),
  // one sqrt serving all three.
  //
  // Measured: 11.4x faster, and the two forms agree to 7e-15 relative across the
  // whole 273-647 K range, which is a few tens of ulp and below anything this
  // fit means. Not a different curve; the same curve, evaluated properly.
  const th = 1 - T / T_CRIT_H2O;
  const r = Math.sqrt(th), th2 = th * th, th3 = th2 * th;
  const s = IAPWS[0] * th + IAPWS[1] * th * r + IAPWS[2] * th3 +
            IAPWS[3] * th3 * r + IAPWS[4] * th2 * th2 + IAPWS[5] * th3 * th3 * th * r;
  return P_CRIT_H2O * Math.exp(s * T_CRIT_H2O / T);
}

// --- CO2 saturation vapour pressure (Pa) ------------------------------------
// Two branches, meeting at the triple point (216.58 K, 5.185 bar).
//
// Below it, over dry ice: 148 K at 6 mbar (Mars) and 194.7 K at one bar, the
// two anchors worth having.
//
// Above it, over liquid, up to the critical point (304.13 K, 73.77 bar). This
// branch was missing -- the function returned 10 kbar for anything warmer than
// the triple point, which says a twenty-bar CO2 atmosphere cannot condense at
// any temperature. It can: at 240 K it condenses down to 12.8 bar. A two-point
// Clausius-Clapeyron fit through the triple and critical points reproduces the
// measured curve to better than 1% across the whole range (12.8 vs 12.83 bar at
// 240 K, 24.2 vs 24.19 at 260, 41.9 vs 41.60 at 280, 67.4 vs 67.10 at 300).
//
// Above the critical temperature there is no liquid to condense into, so
// nothing comes out of the air however hard it is squeezed.
const CO2_TRIPLE_T = 216.58, CO2_TRIPLE_P = 5.185e5;
const CO2_CRIT_T = 304.13, CO2_CRIT_P = 73.77e5;
const CO2_LIQ_B = Math.log(CO2_CRIT_P / CO2_TRIPLE_P) / (1 / CO2_TRIPLE_T - 1 / CO2_CRIT_T);
const CO2_LIQ_A = Math.log(CO2_TRIPLE_P) + CO2_LIQ_B / CO2_TRIPLE_T;

export function psatCO2(T) {
  if (T >= CO2_CRIT_T) return 1e9;              // supercritical: never condenses
  if (T >= CO2_TRIPLE_T) return Math.exp(CO2_LIQ_A - CO2_LIQ_B / T);
  return 1.2264e12 * Math.exp(-3167.8 / T);
}

// The temperature at which CO2 starts coming out of the air at this pressure.
export function frostPointCO2(pPa) {
  if (pPa <= 0) return 0;
  if (pPa >= CO2_CRIT_P) return CO2_CRIT_T;     // no colder threshold to find
  if (pPa >= CO2_TRIPLE_P) return CO2_LIQ_B / (CO2_LIQ_A - Math.log(pPa));
  return 3167.8 / Math.log(1.2264e12 / pPa);
}

// ---------------------------------------------------------------------------
// The Sun getting brighter, which is the one forcing no player controls.
//
// A main-sequence star burns hydrogen to helium, its core mean molecular weight
// rises, and it has to run hotter and denser to hold itself up. The luminosity
// climbs roughly linearly in fractional age, and Gough (1981) fits it to about a
// per cent over the Sun's whole main sequence:
//
//     L(t)/L_now = 1 / (1 + 0.4 (1 - t/t_now))
//
// with t_now = 4.57 Gyr. That is the relation the "Earth +N Gyr" preset was
// already built on and it is now the one the brightening mode drives, so the
// preset and the mode cannot disagree about where the Sun is.
//
// It works out to about a tenth per gigayear near today, which is where the
// brightening mode's flat 10% comes from -- see BRIGHTEN_PER_GYR in main.js.
// This function's job is the two presets that were fitted to it by hand: the
// Archean's 0.77 at 3.3 Ga and Earth +2.2 Gyr's 1.2385.
//
// **It has a pole and the domain is not optional.** The denominator vanishes at
// t/t_now = 3.5, or 16.0 Gyr, and past that the "luminosity" is negative: 12 Gyr
// gives 2.86, 16 gives -2285, 17.2 gives -9.48. The Sun leaves the main sequence
// long before any of that, so the relation simply does not apply there -- but a
// caller integrating forwards will walk into it, and one did. Clamped to
// 0.5-11 Gyr, which is the span this is fitted over.
export const SUN_AGE_NOW = 4.57e9;               // years
export const SUN_AGE_MIN = 0.5e9, SUN_AGE_MAX = 11e9;
export function mainSequenceLuminosity(ageYears) {
  const t = clamp(ageYears, SUN_AGE_MIN, SUN_AGE_MAX) / SUN_AGE_NOW;
  return 1 / (1 + 0.4 * (1 - t));
}
