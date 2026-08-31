import { clamp } from './constants.js';

// ---------------------------------------------------------------------------
// How much of a planet is under water.
//
// The same water inventory floods very different areas depending on the shape
// of the solid surface: a world of flat abyssal plains drowns broadly under a
// shallow sea, while one of deep narrow basins holds the same volume out of
// sight. That shape is the planet's *hypsometry*.
//
// Take the elevation quantile -- the height below which a fraction f of the
// surface lies -- as a power law, z(f) = H·(f^a − k). The water that fits below
// sea level when a fraction φ is flooded is then
//
//     W = ∫₀^φ (z(φ) − z(f)) df = H · a/(a+1) · φ^(a+1)
//
// which inverts in closed form. Normalising the broad-basin branch so that a
// planet holding one Earth ocean is flooded to (1 − L) removes H and a in
// favour of one exponent and the basin-geometry control:
//
//     flooded(W) = (1 − L) · (W / W_ref)^n,        n = 1/(a+1)
//
// n is not free: on Earth, halving the ocean drops the flooded area only about
// 15%, because the abyssal plains are nearly flat and a retreating sea uncovers
// very little of them. That fixes n near 1/4.
// ---------------------------------------------------------------------------

export const HYPSOMETRIC_EXPONENT = 0.25;

// The exponent above is calibrated in the middle of the range, where the abyssal
// plains are flat and a retreating sea uncovers very little. Taken to the limit
// it is badly wrong: a pure power law says a *millionth* of an Earth ocean still
// floods 1.6% of the planet, which works out at twenty centimetres deep. That is
// not a sea, it is a damp patch -- and since the renderer draws whatever
// fraction this returns as open water, a world the model itself called bone dry
// came out with blue seas along its terminator.
//
// The missing physics is that the deepest basin has a finite area, so as the
// water goes the flooded fraction has to fall in proportion to the volume rather
// than to its fourth root. Requiring a sea to be at least this deep on average
// imposes exactly that, and it binds only below a couple of thousandths of an
// ocean -- Earth, a waterworld and a dune world are all untouched.
export const MIN_SEA_DEPTH = 50;     // metres, area-averaged
// The other end needs a bound too. Without one, basin geometry of 1 makes the
// broad branch exactly zero and hides any amount of liquid in a zero-area,
// infinite-depth "ocean". Twenty kilometres is a deliberately generous full
// peak-to-trough relief for a rocky world. It does not touch Earth, Venus, Mars,
// Dune World, or any shipped starting state; it only rejects geometries whose
// implied average basin depth is larger than the terrain itself.
export const MAX_BASIN_DEPTH = 20000; // metres, area-averaged upper bound
const RHO_WATER = 1000;              // kg/m^3

// Fraction of the surface under water (or under sea ice, which floats and so
// still fills its basin). `basinWater` and `refWater` are column masses in
// kg/m², so a bigger planet spreading the same water thinner is handled by the
// caller passing that planet's own reference column.
export function floodedFraction(basinWater, landFraction, refWater) {
  const seaShare = clamp(1 - landFraction, 0, 1);
  if (basinWater <= 0 || refWater <= 0) return 0;
  const broad = seaShare * Math.pow(basinWater / refWater, HYPSOMETRIC_EXPONENT);
  const deepEnough = basinWater / (RHO_WATER * MIN_SEA_DEPTH);
  const notTooDeep = basinWater / (RHO_WATER * MAX_BASIN_DEPTH);
  return clamp(Math.max(Math.min(broad, deepEnough), notTooDeep), 0, 1);
}

// The inverse: how much water it would take to flood a given fraction. Used by
// the UI to say what a world would look like with a different inventory.
export function waterForFlooded(flooded, landFraction, refWater) {
  const seaShare = clamp(1 - landFraction, 0, 1);
  if (flooded <= 0 || refWater <= 0) return 0;
  const f = clamp(flooded, 0, 1);
  // The old two-branch envelope reaches f only once both the broad power law
  // and the minimum-depth limit do. The new maximum-depth floor reaches f on
  // its own, so the inverse is the earlier of those two water inventories.
  const broad = seaShare > 0
    ? refWater * Math.pow(f / seaShare, 1 / HYPSOMETRIC_EXPONENT)
    : Infinity;
  const broadAndDeep = Math.max(broad, f * RHO_WATER * MIN_SEA_DEPTH);
  const finiteBasin = f * RHO_WATER * MAX_BASIN_DEPTH;
  return Math.min(broadAndDeep, finiteBasin);
}
