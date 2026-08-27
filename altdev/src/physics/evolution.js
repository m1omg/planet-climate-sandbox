// Things that change because the world is old, not because you moved a slider.
//
// Two of them, and they are the two that decide whether a planet's story makes
// sense over billions of years rather than millions: the star gets brighter,
// and the interior runs down. Both are off by default, because most of what
// this model is used for is "what would this world do", not "what did it do" --
// but with them on, a preset stops being a snapshot and becomes a history.

import { clamp } from './constants.js';

// Present-day contributions to Earth's radiogenic heat production, and the
// half-lives that got them there (Arevalo, McDonough & Luhr 2009; half-lives
// from the standard decay data). The four together are essentially all of it.
//
// The fractions are of the radiogenic budget *now*, so they sum to one by
// construction and radiogenic(EARTH_AGE) is exactly 1.
const ISOTOPES = [
  { f: 0.372, half: 4.468 },   // U-238
  { f: 0.017, half: 0.704 },   // U-235  -- almost nothing now, a fifth of it once
  { f: 0.430, half: 14.05 },   // Th-232 -- barely decayed, so it dominates late
  { f: 0.181, half: 1.248 },   // K-40   -- the big early contributor
];

export const EARTH_AGE = 4.567;          // Gyr since the solar system formed

// Radiogenic heat production at `age` Gyr after formation, relative to now.
//
// Comes out at 5.1 at age zero, which is the number the textbooks give: a
// young Earth made about five times the radiogenic heat it makes today, nearly
// half of it from potassium-40 that has since almost entirely gone.
//
// This is used to scale the WHOLE interior flux, which is a simplification with
// a name: about half of Earth's 47 TW is radiogenic and the rest is secular
// cooling plus what is left of accretion (the Urey ratio, ~0.4-0.5). Secular
// cooling has its own, gentler decline, so scaling everything by the radiogenic
// curve overstates how fast the total falls. It is the right shape and roughly
// the right size, and the alternative is a mantle thermal history model that
// this is not the place for.
export function radiogenic(ageGyr) {
  const age = Math.max(ageGyr, 0);
  let total = 0;
  for (const iso of ISOTOPES) {
    const lambda = Math.LN2 / iso.half;
    total += iso.f * Math.exp(lambda * (EARTH_AGE - age));
  }
  return total;
}

// How much brighter the star is after `gyr` billion years, as a multiplier.
//
// Compounding, so 10%/Gyr over four and a half billion years is a factor 1.56.
// The Sun's real track (Gough 1981) is L(t)/L_now = 1/(1 + 0.4(1 - t/t_now)),
// which is a factor 1.4 across the same span -- about 7.4%/Gyr compounded, and
// close to 10%/Gyr over the last billion years where the curve is steepest.
// So the default here is the right number for the recent past and a little
// generous for the deep past, which is the direction that makes the faint young
// Sun problem harder rather than easier.
export function brightnessAfter(ratePerGyr, gyr) {
  if (!(ratePerGyr > 0) || !(gyr > 0)) return 1;
  return Math.pow(1 + ratePerGyr, gyr);
}

// The state a world's controls should be in, `years` after it started.
//
// Returns only what has changed, so the caller can leave everything else alone
// and so that a world with both modes off costs nothing. `base` is where the
// sliders were when the clock started -- NOT where they are now, because these
// are absolute functions of age rather than rates to integrate, and integrating
// them would make the answer depend on the step sequence.
export function evolvedParams(p, base, years) {
  const out = {};
  if (!base) return out;
  const gyr = Math.max(years, 0) / 1e9;

  if (p.brightening > 0 && base.insolation > 0) {
    out.insolation = base.insolation * brightnessAfter(p.brightening, gyr);
  }

  // Interior heat down the radiogenic curve from whatever age the world starts
  // at. Volcanic outgassing is not listed here and does not need to be: the
  // model already scales it by meltBoost = sqrt(F / F_earth), so a mantle that
  // cools to a quarter of its heat erupts at half the rate on its own. That
  // coupling is the physical one -- melt production is what carries dissolved
  // CO2 up -- and duplicating it here would apply it twice.
  if (p.realisticGeology) {
    const startAge = p.startAge ?? EARTH_AGE;
    const now = radiogenic(startAge);
    if (now > 0) {
      out.internalHeat = (base.internalHeat ?? 0)
        * clamp(radiogenic(startAge + gyr) / now, 0, 1);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Moving a control without kicking the planet.
//
// The reason this exists is the sharpest result in the model: a world walked up
// to 1.36 S(+) in small steps settles at 63 C with its ocean intact, and the
// same world dropped there in one jump overshoots into a 576 C steam greenhouse
// it cannot leave. Both are self-consistent; which one you get is decided by
// how fast the star changed, not by where it ended up.
//
// A slider is a jump. So with this on, typing a number or clicking the track
// sets a TARGET and the star walks to it -- which is the only way to reach the
// hot branch deliberately rather than by accident.
//
// Rate-limited rather than given a fixed duration, because the thing that must
// not be outrun is fractional: a tenth of a percent per hundred thousand years
// is gentle whether the star is at 0.3 S(+) or 30. That works out at about
// 36 Myr for the 36% change the hysteresis test uses, against the 32 Myr that
// test needed to stay on the branch.
export const SMOOTH_RATE = 1e-8;      // fraction of the current value per year

// One step of the walk. Returns the new value; equal to `target` once there.
export function approach(current, target, years, rate = SMOOTH_RATE) {
  if (!(current > 0) || !(target > 0) || !(years > 0)) return target;
  const span = Math.abs(Math.log(target / current));
  const step = rate * years;
  if (step >= span) return target;
  return current * Math.exp(Math.sign(Math.log(target / current)) * step);
}
