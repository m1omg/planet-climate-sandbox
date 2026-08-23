// Where sea level sits on the baked height field.
//
// This used to be a straight line in the shader, `thr = 0.625 - 0.25*land`, and
// it was badly wrong away from the middle: asking for 30% land drew 14.8%, and
// asking for 70% drew 81%. The basin-geometry control was therefore lying about
// the one thing it controls, in the same way the old hypsometry lied about how
// far a vanishing sea spread.
//
// The baked height is very nearly Gaussian -- measured over eight seeds it is
// N(0.4972, 0.05313), with the quantiles varying by only about 0.01 between
// seeds, so one curve serves every world. The sea level that leaves exactly
// `land` of the globe above water is then the matching quantile, and since the
// land fraction is a uniform across the whole frame there is no reason to make
// the shader work it out: it is one number per frame.
//
// Keeping the field itself untouched matters. `h = height - seaLevel` also
// drives the coastline ramp, the mountain belts and the relief shading, all of
// which are calibrated against its real spread; equalising the field would have
// rescaled all of them.
export const TERRAIN_MEAN = 0.4972, TERRAIN_SD = 0.05313;

// Inverse normal CDF (Acklam's rational approximation, ~1e-9 absolute).
export function probit(p) {
  if (!(p > 0)) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
            ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q /
         (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

// Sea level for a given land share, on the baked height's own scale.
export function seaLevelForLand(landFraction) {
  const land = Math.min(Math.max(landFraction, 0), 1);
  // Clamped just short of the ends: at exactly 0 or 1 the quantile runs off to
  // infinity, and a world is "all sea" or "all land" long before that anyway.
  const p = Math.min(Math.max(1 - land, 0.0015), 0.9985);
  return TERRAIN_MEAN + TERRAIN_SD * probit(p);
}

// ---------------------------------------------------------------------------
// How brightly a surface at temperature T glows in visible light, normalised
// so that 1500 K is 1.0.
//
// This exists because the night side used to be painted with a glow taken from
// the planet's *global mean* temperature, which is not a thing any patch of
// ground has. GJ 1132 b runs a 1270 K day side against a 692 K night side and
// a 920 K mean, so its night side -- which emits essentially nothing -- was
// being washed with an orange gradient four times brighter than the terrain
// underneath it. That wash carried no surface detail, because it varied only
// with the smooth day-to-night temperature ramp, and it read as a blur.
//
// The curve is steep and it has to be. The *visible* share of a blackbody is a
// Wien tail, and integrating Planck over 400-700 nm gives:
//
//     692 K   5.7e-10        (GJ 1132 b's night side)
//     798 K   1.9e-8         the Draper point: solids first glow dull red
//    1000 K   1.9e-6
//    1300 K   1.0e-4
//    1500 K   5.6e-4
//
// Ten orders of magnitude across the range the old linear ramp treated as
// gently rising. exp(A - B/T) is the Wien tail's own shape and fits that
// integral to within about ten percent from 900 K to 1500 K.
//
// Venus is the check that costs nothing: its surface is 737 K and does not
// glow visibly, which is why photographs of it are lit by daylight through the
// clouds rather than by the ground. Under the old formula it did.
export const GLOW_A = 11.68, GLOW_B = 17520;   // shared with planet.frag
export function thermalGlow(T) {
  if (!(T > 1)) return 0;
  return Math.min(Math.exp(GLOW_A - GLOW_B / T), 1.4);
}
