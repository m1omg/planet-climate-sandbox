// Things that change because the world is old, not because you moved a slider.
//
// Two of them, and they are the two that decide whether a planet's story makes
// sense over billions of years rather than millions: the star gets brighter,
// and the interior runs down. Both are off by default, because most of what
// this model is used for is "what would this world do", not "what did it do" --
// but with them on, a preset stops being a snapshot and becomes a history.

import { clamp } from './constants.js';

const smoothstepLocal = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-12), 0, 1);
  return t * t * (3 - 2 * t);
};

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

// How the same star's XUV output falls as it spins down.
//
// A young star is magnetically ferocious and it calms down as it loses angular
// momentum to its own wind. Ribas et al. (2005) fit the decline for solar
// analogues at F_XUV ~ t^-1.23, which makes the Sun at half a billion years
// something like fifteen times as harsh in the extreme ultraviolet as it is
// now, and a hundred times at a hundred million.
//
// This matters far more than the bolometric brightening for anything to do with
// escape: the wind and the XUV track each other, and both are what strip an
// unprotected atmosphere. Mars lost its air while the Sun was still young.
export function xuvAtAge(ageGyr) {
  const t = Math.max(ageGyr, 0.05);       // floor: before this the star is still assembling
  return Math.pow(t / EARTH_AGE, -1.23);
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
    // The same star calming down. Decoupled from the bolometric curve because
    // they go opposite ways: the star gets brighter and its XUV gets weaker,
    // and it is the second that decides whether an atmosphere survives.
    if (base.xuvFraction > 0) {
      const start = p.startAge ?? EARTH_AGE;
      const now = xuvAtAge(start);
      if (now > 0) out.xuvFraction = base.xuvFraction * xuvAtAge(start + gyr) / now;
    }
  }

  // Interior heat down the radiogenic curve from whatever age the world starts
  // at. Volcanic outgassing is not listed here and does not need to be: the
  // model already scales it by meltBoost = sqrt(F / F_earth), so a mantle that
  // cools to a quarter of its heat erupts at half the rate on its own. That
  // coupling is the physical one -- melt production is what carries dissolved
  // CO2 up -- and duplicating it here would apply it twice.
  const startAge = (p.startAge ?? EARTH_AGE) + gyr;
  if (p.realisticGeology) {
    const start = p.startAge ?? EARTH_AGE;
    const now = radiogenic(start);
    if (now > 0) {
      out.internalHeat = (base.internalHeat ?? 0)
        * clamp(radiogenic(startAge) / now, 0, 1);
    }
    // ...and the dynamo goes out when the core stops convecting. Smoothed over
    // the last tenth of its life rather than switched off, because a field that
    // vanished between one step and the next would put a discontinuity into the
    // escape rate and the step controller would have to resolve it.
    if (base.magneticField > 0) {
      const life = dynamoLifetime(p.mass ?? 1);
      out.magneticField = base.magneticField
        * clamp(1 - smoothstepLocal(0.9 * life, life, startAge), 0, 1);
    }
  }

  // The resurfacing pulse is deliberately independent of realisticGeology: it
  // is an event you place, not a curve the world follows.
  const boost = resurfacingBoost(p, startAge);
  if (boost !== 1) out.outgassing = (base.outgassing ?? 0) * boost;
  return out;
}


// ---------------------------------------------------------------------------
// The dynamo, and what happens to an atmosphere without one.
//
// A planet keeps a magnetic field for as long as its core is convecting, and a
// core convects for as long as it is losing heat fast enough. Small cores cool
// fast: Mars's dynamo shut down about half a billion years after it formed --
// the crustal remanence recorded in the southern highlands stops there -- while
// Earth's is still running at four and a half.
//
// The scaling is steeper than the straight cooling-time argument (a core loses
// heat through its surface and holds it in its volume, so t ~ R ~ M^1/3)
// because core freezing and the composition of the light alloy matter as much
// as the geometry. Pinned to the two bodies with an answer: Mars at 0.107 M(+)
// gets 0.50 Gyr, which is where its crustal remanence stops, and Earth at
// 1 M(+) gets 8, so it has its field now and keeps it for a while yet.
//
// Venus is the case that says this is a rule of thumb and not a law. At 0.815
// M(+) it gets 6.2 Gyr, so by this it should still have a dynamo, and it has
// none. The reason is thought to have nothing to do with size: without plate
// tectonics its mantle cannot pull heat out of the core fast enough to drive
// convection at all. So the Venus presets set the field to zero by hand, the
// way it is actually observed, rather than letting the law invent one.
export function dynamoLifetime(massEarths) {
  return 8.0 * Math.pow(Math.max(massEarths, 1e-6), 1.24);
}

// How much of the solar wind actually reaches the top of the atmosphere.
//
// The magnetopause stands off where magnetic pressure balances the wind's ram
// pressure, which puts it at R_mp ~ B^(1/3), and the share of the atmosphere
// left exposed goes as the square of the ratio of radii. The constant is not a
// free parameter: Earth's magnetopause sits at about ten Earth radii on the
// sunward side, so a hundredth of the cross-section a bare Earth would present.
//
// A hundredth rather than the tenth this first used, and the difference is the
// whole calibration. At a tenth, an Earth with a full field lost 38% of its
// nitrogen in half a billion years -- Earth's nitrogen is not doing that.
//
// An induced magnetosphere is NOT modelled, and the omission is deliberate and
// known. An unmagnetised planet with a thick ionosphere holds the wind off on
// its own -- it is why Venus, which has no dipole at all, still has three and a
// half bar of nitrogen after four and a half billion years while Mars, which
// also has none, has six millibars of anything. Their measured ion escape rates
// are within a factor of a few of each other (Venus Express, MAVEN: both near
// 10^24-10^25 particles a second); what differs is what that leak is measured
// against.
//
// It was implemented, as a shielding term linear in surface pressure, and it
// does what it should for Venus: Early Venus stopped losing fourteen fifteenths
// of its nitrogen in 1.5 Gyr and kept the lot. It also saved Mars. This model's
// Noachian Mars starts at four bar, so any pressure-based shielding protects it
// far better than it protects a one-bar Venus, and Mars finished its history
// with 1520 mbar of CO2 against the six it actually has -- with as little as
// nine-fold shielding at four bar being enough to do it. No function of
// pressure can give a four-bar Mars less protection than a one-bar Venus; only
// gravity can, and gravity is already carrying a fourth power here.
//
// What that really says is that this channel is being asked to do work that was
// not all its own. MAVEN's present rate integrated over four billion years is
// about half a bar (Jakosky et al. 2018), not four; the rest of Mars's carbon
// went into carbonate while the planet was still wet, and into early
// hydrodynamic escape and impact erosion. Until there is a carbonate sink to
// take that share, NONTHERMAL_K has to be large enough to strip four bar on its
// own, and at that size no honest shielding term can be added on top.
//
// So Early Venus loses nitrogen it should keep. That is the price, it is
// recorded here, and it is smaller than the price of a Mars that never dried.
export function windExposure(field) {
  const B = Math.max(field ?? 0, 0);
  return 1 / (1 + 99 * Math.pow(B, 2 / 3));
}

// Non-thermal escape of the heavy background gas, in kg/m^2/yr.
//
// This is the channel that emptied Mars and it is nothing like the hydrodynamic
// blow-off already in escapeRates(). There is no bulk outflow and no critical
// XUV to exceed: the solar wind picks ions off the exposed top of the
// atmosphere one at a time and carries them away, and it does this at any flux,
// for ever. MAVEN measures it happening at Mars right now.
//
// Scaled by 1/v_esc^2 because what has to be paid for each ion is its
// gravitational binding energy, and by the stellar wind, for which XUV is the
// usual proxy -- both track magnetic activity and both fall off together as a
// star spins down.
//
// The constant is set by the one integrated measurement there is: Jakosky et
// al. (2018) put Mars's total loss at of order 0.5 bar of CO2 over four billion
// years. That fixes everything else, and what it gives elsewhere is a check
// rather than a choice -- Venus, unmagnetised and barely smaller than Earth,
// comes out losing a couple of bar across its whole history, which is why it
// still has ninety-two of them.
// Earth's XUV flux at the top of its atmosphere, W/m^2: 1361 * 3.4e-6 / 4.
// Taking the flux rather than the star's XUV fraction means orbital distance is
// already in it -- Mars is stripped by a wind that has spread out over 2.3 times
// the distance, and that is the wind it actually meets.
const XUV_EARTH = 1361 * 3.4e-6 / 4;
const NONTHERMAL_K = 1.6e-6;         // kg/m^2/yr, Earth gravity, Earth XUV, no field

// Below about ten millibars the atmosphere stops being an obstacle. There is no
// ionosphere left to stand the wind off, the exobase has come down to meet the
// ground, and there is simply less in reach -- so the loss becomes supply
// limited rather than wind limited.
//
// Without this the rate is an absolute flux that does not care how much is
// left, which strips the last trace as eagerly as the first bar and leaves Mars
// with no air at all. Mars does not have no air; it has six millibars, held
// where volcanic resupply balances what the wind can still reach.
const THIN_P = 0.010;                // bar

export function nonThermalEscape(p, d, xuvFlux, pTot = Infinity) {
  const vescRel = d.vesc / 11186;
  if (!(vescRel > 0)) return 0;
  const thin = pTot >= Infinity ? 1 : pTot / (pTot + THIN_P);
  const xuvRel = Math.max(xuvFlux, 0) / XUV_EARTH;
  // Fourth power of the escape velocity, which is the same dependence the
  // hydrodynamic gate above uses and for the same reason: the wind has to pay
  // the binding energy twice over. Once to knock a particle out of the bound
  // atmosphere into the hot corona, and again for that particle to leave rather
  // than fall back. A square alone separates Mars from Earth by a factor of
  // five, and the two planets differ by nearer three hundred.
  const g4 = vescRel * vescRel * vescRel * vescRel;
  return NONTHERMAL_K * xuvRel * windExposure(p.magneticField ?? 0) * thin / g4;
}

// A resurfacing event: everything the mantle has, all at once.
//
// Venus repaved something like eighty percent of itself in a geologically short
// window around 700 Myr ago -- the crater population is too sparse and too
// evenly spread to be anything else. Whatever drove it, the carbon that came
// with it had to go somewhere, and there was no ocean left to weather it back
// down.
//
// Returned as a multiplier on volcanic outgassing, shaped as a smooth pulse so
// that nothing in the solver meets a step change.
export function resurfacingBoost(p, ageGyr) {
  const at = p.resurfacingAge;
  if (!(at > 0) || !(p.resurfacingBoost > 1)) return 1;
  const span = Math.max(p.resurfacingSpan ?? 50, 1) / 1000;   // Myr -> Gyr
  const x = (ageGyr - at) / span;
  if (x < -3 || x > 3) return 1;
  return 1 + (p.resurfacingBoost - 1) * Math.exp(-x * x);
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

// ...but a rate alone makes a long move take proportionally longer, and the
// starlight control now spans a factor of a thousand. Walking from Earth's
// sunlight to GJ 1132 b's nineteen at 1e-8 a year is 300 Myr, which reads as a
// control that does nothing. So the rate is set from the size of the move: any
// change crosses in this long, and only the small ones -- where SMOOTH_RATE is
// already the faster of the two -- take less.
//
// Twenty million years is chosen against what the smoothing is for. The point
// is to keep the planet on its branch rather than throwing it across a
// bifurcation, and the slowest thing that has to keep up is the carbonate
// weathering feedback at about a million years. Twenty e-folds of margin.
export const SMOOTH_SPAN_YEARS = 2e7;

export function walkRate(from, to, years = SMOOTH_SPAN_YEARS) {
  if (!(from > 0) || !(to > 0) || !(years > 0)) return SMOOTH_RATE;
  return Math.max(SMOOTH_RATE, Math.abs(Math.log(to / from)) / years);
}

// One step of the walk. Returns the new value; equal to `target` once there.
export function approach(current, target, years, rate = SMOOTH_RATE) {
  if (!(current > 0) || !(target > 0) || !(years > 0)) return target;
  const span = Math.abs(Math.log(target / current));
  const step = rate * years;
  if (step >= span) return target;
  return current * Math.exp(Math.sign(Math.log(target / current)) * step);
}
