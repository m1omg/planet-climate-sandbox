// Arnscheidt, Wordsworth & Ding (2019), arXiv:1906.10561v2.
// Equations 1, 2 and 8-11; reduced radiation, NOT the paper's LBL calculation.
import { R_EARTH, M_EARTH, G_GRAV, YEAR, SIGMA, psatH2O, clamp } from './constants.js';

export const WATER_GAS_CONSTANT = 461.5;
export const WATER_LATENT_HEAT = 2.5e6;
export function waterworldRadius(mass) { return 1.258 * R_EARTH * mass ** 0.302; }

// Opt in: the paper assumes water-rich planets and essentially pure steam.
// Background-rich / H2-envelope planets must retain their existing model.
export function waterworldActive(p, waterEO, backgroundBar = 0) {
  return p.lowGravityWaterworld === true && p.mass >= 0.01 && p.mass <= 0.2
    && waterEO > 1e-12 && backgroundBar < 0.001;
}

// Surface mass flux in kg/m2/s. The exponential branch is eq. 9. Outside its
// rc >> rs approximation solve the isothermal Parker equation itself, so the
// loss rate cannot spuriously turn down when the sonic point reaches the ground.
export function steamEscape(T, g, radius, pressure = psatH2O(T)) {
  const c2 = WATER_GAS_CONSTANT * T, c = Math.sqrt(c2);
  const lambda = g * radius / c2, rho = Math.max(0, pressure) / c2;
  let mach;
  if (lambda >= 20) mach = (lambda / 2) ** 2 * Math.exp(1.5 - lambda);
  else {
    const rhs = 4 * Math.log(2 / lambda) + 2 * lambda - 3;
    let lo = lambda >= 2 ? -Math.max(20, rhs) : 0;
    let hi = lambda >= 2 ? 0 : Math.max(2, Math.log(rhs + 2));
    for (let i = 0; i < 64; i++) {
      const u = (lo + hi) / 2, f = Math.exp(2*u) - 2*u;
      if ((f > rhs) === (lambda >= 2)) lo = u; else hi = u;
    }
    mach = Math.exp((lo + hi) / 2);
  }
  const flux = rho * c * mach;
  return { flux, lambda, sonicRadius: lambda * radius / 2,
    cooling: (g * radius + WATER_LATENT_HEAT) * flux };
}

// Approximate readings of Figure 2 RIGHT, at 0.12 Earth masses, Sun spectrum.
// No claim of access to the unpublished spectral/opacity grid. Interpolate
// squared radiative radii, then transfer their gravitational potential heights
// to the current planet using spherical hydrostatic balance (eq. 3).
const GRID = [200,250,300,350,400,500,600];
const LW = [1,1.006,1.06,1.13,1.195,1.31,1.415];
const SW = [1,1.001,1.009,1.032,1.068,1.145,1.218];
function interpolate(T, values) {
  T = clamp(T, GRID[0], GRID.at(-1));
  let i = 1; while (i < GRID.length-1 && T > GRID[i]) i++;
  return values[i-1] + (values[i]-values[i-1]) * (T-GRID[i-1])/(GRID[i]-GRID[i-1]);
}
const REFERENCE_R = waterworldRadius(0.12);
const REFERENCE_POTENTIAL = G_GRAV * M_EARTH * 0.12 / REFERENCE_R;
export function waterworldFlux(T, g, radius, availablePressure = Infinity) {
  const saturation = psatH2O(T);
  const pressure = Math.min(saturation, Math.max(0, availablePressure));
  const wet = clamp(pressure / Math.max(saturation, 1e-30), 0, 1);
  const scale = values => {
    const potential = REFERENCE_POTENTIAL * (1 - 1 / Math.sqrt(interpolate(T, values)));
    return (1 - clamp(wet * potential / (g * radius), 0, 0.8)) ** -2;
  };
  const longwave = scale(LW), shortwave = scale(SW);
  // Smooth blackbody-to-steam OLR ceiling. 247 W/m2 reproduces the approximate
  // plane-parallel ceiling of Fig. 3 at g=2.3 m/s2. Gravity scaling is a reduced
  // grey-opacity approximation, not a line-by-line result.
  const blackbody = SIGMA * T ** 4;
  const limit = 247 * (g / 2.3) ** 0.1;
  const planeOLR = blackbody / (1 + (blackbody / limit) ** 8) ** (1/8);
  const emitted = longwave * (wet * planeOLR + (1-wet) * blackbody);
  const escape = steamEscape(T, g, radius, pressure);
  // Ice-albedo hysteresis; liquid value matches the paper's A=0.2 experiment.
  const ice = clamp((273.15 - T) / 15, 0, 1);
  const albedo = 0.2 + 0.4 * ice * ice * (3 - 2*ice);
  return { ...escape, longwave, shortwave, emitted, albedo, pressure,
    inDomain: T >= 200 && T <= 600 && escape.lambda >= 20 };
}

export function waterLifetime(waterColumn, massFlux) {
  return massFlux > 0 ? Math.max(0, waterColumn) / massFlux / YEAR : Infinity;
}
