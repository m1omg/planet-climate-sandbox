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
// which inverts in closed form. Normalising so that a planet holding one Earth
// ocean is flooded to exactly (1 − L) removes H and a in favour of one
// exponent and the basin-geometry control:
//
//     flooded(W) = (1 − L) · (W / W_ref)^n,        n = 1/(a+1)
//
// n is not free: on Earth, halving the ocean drops the flooded area only about
// 15%, because the abyssal plains are nearly flat and a retreating sea uncovers
// very little of them. That fixes n near 1/4.
// ---------------------------------------------------------------------------

export const HYPSOMETRIC_EXPONENT = 0.25;

// Fraction of the surface under water (or under sea ice, which floats and so
// still fills its basin). `basinWater` and `refWater` are column masses in
// kg/m², so a bigger planet spreading the same water thinner is handled by the
// caller passing that planet's own reference column.
export function floodedFraction(basinWater, landFraction, refWater) {
  const seaShare = clamp(1 - landFraction, 0, 1);
  if (seaShare <= 0 || basinWater <= 0 || refWater <= 0) return 0;
  return clamp(seaShare * Math.pow(basinWater / refWater, HYPSOMETRIC_EXPONENT), 0, 1);
}

// The inverse: how much water it would take to flood a given fraction. Used by
// the UI to say what a world would look like with a different inventory.
export function waterForFlooded(flooded, landFraction, refWater) {
  const seaShare = clamp(1 - landFraction, 0, 1);
  if (seaShare <= 0 || flooded <= 0) return 0;
  return refWater * Math.pow(clamp(flooded, 0, 1) / seaShare, 1 / HYPSOMETRIC_EXPONENT);
}
