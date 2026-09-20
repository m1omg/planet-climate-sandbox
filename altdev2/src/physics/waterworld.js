// Arnscheidt, Wordsworth & Ding (2019), arXiv:1906.10561v2.
// Equations 1, 2 and 8-11; reduced radiation, NOT the paper's LBL calculation.
import { R_EARTH, M_EARTH, G_GRAV, EO_COLUMN, YEAR, SIGMA, psatH2O, clamp, smoothstep } from './constants.js';
import { MAX_BASIN_DEPTH } from './hypsometry.js';
import { olr, rayleighOf } from './radiation.js';

export const WATER_GAS_CONSTANT = 461.5;
export const WATER_LATENT_HEAT = 2.5e6;
export const WATER_SUBLIMATION_HEAT = 2.834e6;
export function waterworldRadius(mass) { return 1.258 * R_EARTH * mass ** 0.302; }

// Automatic applicability, not a user-selectable physics switch. Structural
// water exceeds even the maximum rocky basin capacity. Use the configured
// inventory here, not the shrinking reservoir: its eventual dry radiative
// limit must be continuous. Runtime gases change the opacity, scale height and
// escape calculation; they must not disable spherical geometry.
// These are the reduced model's applicability bounds, not universal physical
// discontinuities or a claim of a quantitative mixed-atmosphere solution.
export function waterworldActive(p, waterEO, backgroundBar = 0) {
  const structuralWater = (p.water ?? 0) * EO_COLUMN / p.mass**0.54 > MAX_BASIN_DEPTH * 1000;
  return p.mass > 0 && p.mass <= 0.2 && structuralWater
    && (p.starTemp ?? 5772) >= 5200 && (p.starTemp ?? 5772) <= 6200
    && waterEO >= 0 && backgroundBar >= 0;
}

// Surface mass flux in kg/m2/s. The exponential branch is eq. 9. Outside its
// rc >> rs approximation solve the isothermal Parker equation itself, so the
// loss rate cannot spuriously turn down when the sonic point reaches the ground.
export function steamEscape(T, g, radius, pressure = psatH2O(T), molarMass = 18) {
  const c2 = WATER_GAS_CONSTANT * (18/molarMass) * T, c = Math.sqrt(c2);
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
  // Collisions must persist toward the sonic point, not just at the ground.
  // Locate Kn=1 in an isothermal hydrostatic column if it becomes collisionless
  // below that point. Jeans escape is evaluated there, not at the ocean.
  // A smooth transition over sonic Kn=1..100 is a reduced kinetic closure,
  // not a DSMC calculation or a heated-thermosphere model.
  const knudsen = pressure > 0 ? 2.9915e-26 * (molarMass/18) * g / (Math.SQRT2 * 2.7e-19 * pressure) : Infinity;
  const sonicRatio = Math.max(1, lambda/2);
  const logKnAt = x => Math.log(knudsen) + lambda*(1-1/x) - 2*Math.log(x);
  const logSonicKn = logKnAt(sonicRatio);
  let exobaseRatio = 1;
  if (knudsen < 1 && logSonicKn > 0) {
    let lo=1, hi=sonicRatio;
    for(let i=0;i<60;i++) {const mid=(lo+hi)/2; if(logKnAt(mid)>0) hi=mid; else lo=mid;}
    exobaseRatio=(lo+hi)/2;
  }
  const kineticShare = knudsen >= 1 ? 1 : smoothstep(0, 2, logSonicKn/Math.LN10);
  // rho_exo * exp(-lambda_exo) = rho_surface * exp(-lambda_surface).
  const jeans = rho * c / Math.sqrt(2*Math.PI) * (1+lambda/exobaseRatio)
    * Math.exp(-lambda) * exobaseRatio**2;
  const parkerFlux = rho * c * mach;
  const flux = (1-kineticShare) * parkerFlux + kineticShare * jeans;
  const latent = T < 273.15 ? WATER_SUBLIMATION_HEAT : WATER_LATENT_HEAT;
  return { flux, parkerFlux, lambda, sonicRadius: lambda * radius / 2, knudsen, kineticShare,
    exobaseRadius: radius * exobaseRatio,
    regime: kineticShare >= 1 ? 'jeans' : kineticShare > 0 ? 'transition' : 'wind',
    cooling: (g * radius + latent) * flux };
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
export function waterworldFlux(T, g, radius, availablePressure = Infinity, gases = {}) {
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
  // With no inventory there cannot be an ice-albedo feedback. Fade to dry
  // ground continuously rather than changing climate model at a tiny cutoff.
  const iceCover = clamp(availablePressure / (g * 10), 0, 1); // 1 cm water equivalent
  const albedo = 0.2 + 0.4 * ice * ice * (3 - 2*ice) * iceCover;
  const pure = { ...escape, longwave, shortwave, emitted, albedo, pressure,
    meanMolarMass: 18, backgroundBar: 0, backgroundFlux: 0,
    inDomain: T >= 200 && T <= 600 && escape.lambda >= 20 && escape.regime === 'wind' };
  return mixedFlux(pure,T,g,radius,gases);
}

// Reduced mixed-atmosphere extension, NOT an Arnscheidt et al. result. Retain
// the existing gas opacities/pressure broadening and scale hydrostatic heights
// with the mixture's molecular weight. At zero background return the exact
// pure-water calculation, rather than switch at an arbitrary pressure cutoff.
function mixedFlux(pure,T,g,radius,gases) {
  const {pCO2=0,pN2=0,pO2=0,pCH4=0,pH2=0,pHe=0}=gases;
  const backgroundBar=pCO2+pN2+pO2+pCH4+pH2+pHe;
  if (!(backgroundBar>0)) return pure;
  const pw=pure.pressure/1e5, total=pw+backgroundBar;
  const backgroundMu=(44*pCO2+28*pN2+32*pO2+16*pCH4+2.016*pH2+4.003*pHe)/backgroundBar;
  const mu=(18*pw+backgroundMu*backgroundBar)/total;
  const blackbody=SIGMA*T**4;
  // Convert the standard solver's mixed-minus-water-only resistance into an
  // added optical depth. This includes CO2 absorption, pressure broadening and
  // H2 inhibition without counting the pure-water opacity twice.
  const pureOLR=olr(T,0,pw,0,pw,0,g,0);
  const mixedOLR=olr(T,pCO2,pw,pCH4,total,pH2,g,pHe);
  const extraTau=Math.max(0,(blackbody/mixedOLR-blackbody/pureOLR)/0.75);
  const specificRT=8314*T/mu;
  const potential=g*radius;
  const expanded=(area,extraHeightPotential)=>{
    const waterHeightPotential=potential*(1-1/Math.sqrt(area))*18/mu;
    return (1-clamp((waterHeightPotential+extraHeightPotential)/potential,0,.8))**-2;
  };
  // Grey photospheric pressure ratio ~ 1+tau, integrated in spherical gravity.
  // This is a reduced grey closure, not a spectral/vertical radiative solver.
  const rayleigh=rayleighOf(backgroundBar);
  const longwave=expanded(pure.longwave,specificRT*Math.log1p(.75*extraTau));
  const shortwave=expanded(pure.shortwave,-specificRT*Math.log1p(-rayleigh));
  const planePure=pure.emitted/pure.longwave;
  const emitted=longwave*blackbody/(blackbody/planePure+.75*extraTau);

  // For a bound/collisionless background, cap water supply by a hard-sphere
  // binary diffusion conductance in series with water's escape conductance.
  // But a collisional mixture can itself flow: never let trace CO2 act as an
  // immovable lid over a blowing-off ocean. Evaluate that wind with the mean
  // molecular weight, carry BOTH water and background gas, and blend at the
  // same sonic-point collision criterion used by the pure-water calculation.
  const kb=1.380649e-23, amu=1.66053906660e-27, mw=18*amu, mb=backgroundMu*amu;
  const reduced=mw*mb/(mw+mb);
  const nD=3/(16*2.7e-19)*Math.sqrt(2*Math.PI*kb*T/reduced);
  const supply=nD*g*Math.max(mb-mw,0)/(kb*T)*(pw/backgroundBar)*mw;
  const diffusive=supply>0 ? pure.flux/(1+pure.flux/supply) : 0;
  const mixture=steamEscape(T,g,radius,total*1e5,mu);
  const waterMassShare=18*pw/(mu*total);
  const wind=(1-mixture.kineticShare)*mixture.parkerFlux;
  const flux=wind*waterMassShare+mixture.kineticShare*diffusive;
  const backgroundFlux=wind*(1-waterMassShare);
  const latent=T<273.15?WATER_SUBLIMATION_HEAT:WATER_LATENT_HEAT;
  return {...pure,longwave,shortwave,emitted,
    albedo:rayleigh+(1-rayleigh)*pure.albedo,
    flux,backgroundFlux,cooling:(potential+latent)*flux+potential*backgroundFlux,
    meanMolarMass:mu,backgroundBar,regime:mixture.regime,
    diffusionSupply:supply,inDomain:false};
}

export function waterLifetime(waterColumn, massFlux) {
  if (!(waterColumn > 0)) return 0;
  return massFlux > 0 ? Math.max(0, waterColumn) / massFlux / YEAR : Infinity;
}
