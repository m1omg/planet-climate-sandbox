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
export const OUTGAS_EARTH = 5e-5;

// Carbon held in ocean + reactive crust relative to the atmosphere. Makes the
// carbonate-silicate thermostat relax on ~1 Myr rather than ~5 kyr.
export const CARBON_RESERVOIR_FACTOR = 50;

// XUV flux as a fraction of bolometric, present-day Sun.
export const XUV_FRACTION_SUN = 3.4e-6;

export const T_FREEZE = 273.15;

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
export const P_CRIT_H2O = 22.064e6;

export function psatH2O(T) {
  if (T >= T_CRIT_H2O) return P_CRIT_H2O * (1 + (T - T_CRIT_H2O) * 0.01); // no condensation
  if (T < 273.15) {
    if (T < 100) return 1e-12;
    return 611.657 * Math.exp(22.587 * (T - 273.15) / (T + 0.71));
  }
  const th = 1 - T / T_CRIT_H2O;
  const s = IAPWS[0] * th + IAPWS[1] * Math.pow(th, 1.5) + IAPWS[2] * th ** 3 +
            IAPWS[3] * Math.pow(th, 3.5) + IAPWS[4] * th ** 4 + IAPWS[5] * Math.pow(th, 7.5);
  return P_CRIT_H2O * Math.exp(s * T_CRIT_H2O / T);
}

// --- CO2 vapour pressure over dry ice (Pa) ----------------------------------
// Below the 216.6 K triple point. Gives a 148 K frost point at 6 mbar: Mars.
export function psatCO2(T) {
  if (T >= 216.58) return 1e9; // liquid/gas, never condenses out in a game sense
  return 1.2264e12 * Math.exp(-3167.8 / T);
}
export function frostPointCO2(pPa) {
  if (pPa <= 0) return 0;
  const t = 3167.8 / Math.log(1.2264e12 / pPa);
  return Math.min(t, 216.58);
}
