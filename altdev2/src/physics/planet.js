import { M_EARTH, R_EARTH, G_GRAV, EO_COLUMN, clamp } from './constants.js';
import { MAX_BASIN_DEPTH } from './hypsometry.js';

// Rocky mass-radius relation (Seager/Zeng-like): R ~ M^0.27 for silicate worlds.
export function radiusFromMass(massEarths) {
  return R_EARTH * Math.pow(massEarths, 0.27);
}

// ---------------------------------------------------------------------------
// Water that is not sitting on the surface but is part of the planet.
//
// A rocky world's ocean is a film. Earth's is two and a half kilometres deep
// averaged over the globe, on a body six thousand kilometres across, and it
// changes the radius by nothing worth writing down. A sub-Neptune's is
// hundreds of kilometres deep and made mostly of high-pressure ice, and it is
// not a film on the planet -- it IS a layer of the planet, and the planet is
// visibly bigger for it. K2-18 b is 8.63 Earth masses and 2.61 Earth radii;
// the rocky relation above gives 1.79, which is not a small error, it is a
// different object.
//
// Where the line falls is not a matter of taste. `hypsometry.js` already says
// how much water a solid surface can hold before there is no basin left to hold
// it: MAX_BASIN_DEPTH, a deliberately generous full peak-to-trough relief for a
// rocky world. Water beyond that has nowhere on the surface to be, so it is
// interior water. On Earth that threshold is 7.3 oceans and every world this
// model shipped with carries at most six, which is why this term is exactly
// zero on all of them rather than merely small.
//
// One Earth ocean, in kilograms. EO_COLUMN is that mass spread over Earth's
// area, so this is the number it was derived from.
const EO_MASS = EO_COLUMN * 4 * Math.PI * R_EARTH * R_EARTH;

// The fraction of the planet's mass that is water in its interior.
export function waterMassFraction(massEarths, waterEO) {
  if (!(waterEO > 0) || !(massEarths > 0)) return 0;
  const Rr = radiusFromMass(massEarths);
  // What the basins hold, in Earth oceans, on this planet's own surface area.
  const held = MAX_BASIN_DEPTH * 1000 * 4 * Math.PI * Rr * Rr / EO_MASS;
  const interior = waterEO - held;
  if (!(interior > 0)) return 0;
  return clamp(interior * EO_MASS / (massEarths * M_EARTH), 0, 1);
}

// Zeng et al. 2019: R = f(x)·M^(1/3.7) with f = 1 + 0.55x − 0.14x², x the ice
// mass fraction. Two things about that are worth noticing.
//
// First, 1/3.7 = 0.2703, which is the exponent this file has always used. The
// rocky relation here IS Zeng's dry branch, so the water term is a clean
// multiplicative factor on top of it rather than a replacement for it.
//
// Second, f(0) = 1 exactly. Not approximately: the polynomial's constant term
// is one, so a dry world is multiplied by 1.0 and comes out of this function
// bit-for-bit what it went in as. That is what lets a mass-radius relation be
// added to a model of twenty-six terrestrial worlds without moving any of them.
//
// f(0.5) = 1.240, which is the 1.24 the paper quotes for a 1:1 silicate-to-ice
// planet -- the formula reproducing its own published special case, which is
// the cheapest check available that it was transcribed correctly.
export function waterRadiusFactor(x) {
  return 1 + 0.55 * x - 0.14 * x * x;
}

// The radius of the condensed planet: rock plus whatever water is structural.
// This is the radius gravity is computed at and the one a column of gas is
// spread over -- NOT the radius a transit measures, which includes an envelope
// that weighs almost nothing. See `transitRadius`.
export function condensedRadius(params) {
  const x = waterMassFraction(params.mass, params.water ?? 0);
  return radiusFromMass(params.mass) * waterRadiusFactor(x);
}

// What a transit would measure: the condensed planet plus the height at which
// its envelope stops being transparent.
//
// Deliberately not the same number as `condensedRadius`, and kept out of it.
// An H2 envelope is enormous in extent and negligible in mass -- tens of bar
// over a super-Earth is a rounding error on the planet's mass -- so folding it
// into the radius that sets surface gravity would be wrong twice over: it would
// weaken gravity that the gas does not actually weaken, and it would do it to
// every world with any atmosphere at all, Earth included. So the structural
// radius stays structural, this is reported alongside it, and the observational
// anchors compare against this one.
//
// How far up depends on the pressure ratio, not on a fixed count of scale
// heights. `render/atmosphere.js` draws five of them, which is a sensible place
// to stop a picture; it is not where a transit stops. A transit measures the
// altitude at which the slant path becomes opaque, conventionally taken near
// ten millibars for a hydrogen envelope, and how far that sits above the
// surface depends entirely on how deep the surface is: ln(p_surf/p_ref) scale
// heights. Ten bar of envelope puts it seven scale heights up, a thousand bar
// puts it eleven and a half. Using a fixed five would make a hundred-bar
// envelope and a ten-bar one look the same size, which is the opposite of what
// distinguishes these planets.
export const P_TRANSIT_BAR = 0.01;
export function transitRadius(params, R, g, T) {
  const pEnv = Math.max(params.h2Bar ?? 0, 0);
  if (!(pEnv > P_TRANSIT_BAR)) return R;
  const fHe = clamp(params.heliumFrac ?? 0, 0, 1);
  const mu = 2.016 * (1 - fHe) + 4.003 * fHe;      // kg/kmol
  const H = 8314 * clamp(T, 30, 4000) / (mu * Math.max(g, 0.01));
  return R + H * Math.log(pEnv / P_TRANSIT_BAR);
}

export function surfaceGravity(massEarths) {
  const R = radiusFromMass(massEarths);
  return G_GRAV * massEarths * M_EARTH / (R * R);
}

export function escapeVelocity(massEarths) {
  const R = radiusFromMass(massEarths);
  return Math.sqrt(2 * G_GRAV * massEarths * M_EARTH / R);
}

// Bigger planets keep their internal heat longer and outgas more per unit area.
export function outgassingScale(massEarths) {
  return clamp(Math.pow(massEarths, 0.7), 0.05, 6);
}

// How volcanically active this world is, relative to Earth at 1x.
//
// Melt production per unit area, NOT the CO2 that rides up with it. A mantle
// whose carbon is exhausted still erupts; it erupts volatile-poor lava. Tying
// the picture to the CO2 delivery would switch the volcanoes off on a world
// whose interior is still molten, which is neither what the model believes nor
// what Io looks like.
//
// And deliberately WITHOUT outgassingScale, which the carbon source does use.
// That factor is about how much volatile a bigger planet delivers per square
// metre; it is not about how much lava is on the ground. Including it read Io
// as a quarter of Earth's volcanism -- m^0.7 on 0.015 masses is 0.056, enough
// to bury a 4.7x heat flux -- which is exactly backwards for the most
// volcanically active body known. What the eye sees is melt vigour, and that is
// the heat coming out per unit area and the mantle's own activity, both of
// which are already here.
export const EARTH_INTERNAL_FLUX = 0.092;   // W/m^2
export function volcanicActivity(p) {
  const heat = Math.max(p.internalHeat ?? EARTH_INTERNAL_FLUX, 0);
  const melt = clamp(Math.sqrt(heat / EARTH_INTERNAL_FLUX), 0, 100);
  return Math.max(p.outgassing ?? 0, 0) * melt;
}

// Derived geometry / bookkeeping for a parameter set.
//
// g and vesc are computed here from the condensed radius rather than through
// surfaceGravity()/escapeVelocity(), which take a bare mass and so can only
// ever answer for a dry world. Those two keep their signatures and their rocky
// meaning, because the callers that use them -- the carbon budget in
// volatiles.js, the selftest's pressure conversion -- are asking about the
// rock. With no interior water the expressions are identical term for term.
export function derive(params) {
  const R = condensedRadius(params);
  const g = G_GRAV * params.mass * M_EARTH / (R * R);
  return {
    g, R,
    area: 4 * Math.PI * R * R,
    vesc: Math.sqrt(2 * G_GRAV * params.mass * M_EARTH / R),
    // A column in kg/m^2 becomes this many bar of pressure
    colToBar: g / 1e5,
    barToCol: 1e5 / g,
    eoColumn: EO_COLUMN * (R_EARTH * R_EARTH) / (R * R), // 1 EO of water spread thinner on a bigger world
  };
}
