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

// ---------------------------------------------------------------------------
// How the star brightens.
//
// A main-sequence star fuses four hydrogen nuclei into one helium nucleus, so
// the mean molecular weight of its core climbs and the core must contract and
// heat to hold itself up. Luminosity rises the whole time. Gough (1981) fits
// the Sun's track as
//
//     L(t)/L_now = 1 / (1 + 0.4 (1 - t/t_now))
//
// with t_now = 4.567 Gyr, which is 71% at zero age, 77% in the Archean, and
// keeps steepening: 6.7%/Gyr then against 8.8%/Gyr now. This used to be a flat
// 10%/Gyr compounded, and it was the wrong shape in both directions -- too fast
// early, too slow late -- by enough to matter. Every solar preset here carries
// a `startAge` picked off Gough's curve to match its own insolation, so running
// them forward on a different curve left them missing the present day: the
// Archean's 0.77 S(+) reached 1.067 rather than 1.000, and Noachian Mars's 0.32
// reached 0.467 against the 0.431 Mars actually gets. On the real curve both
// land exactly where the planet they represent is now.
// ---------------------------------------------------------------------------

const GOUGH_A = 0.4;                     // Gough's coefficient
const SOLAR_MS_LIFE = 10.0;              // Gyr the Sun gets on the main sequence
const SOLAR_TEMP = 5772;                 // K
const SOLAR_FRAC = EARTH_AGE / SOLAR_MS_LIFE;   // how much of it is already spent

// Main-sequence lifetime from effective temperature.
//
// t_ms ~ M/L ~ M^-2.5, and mass follows temperature as M ~ T^2.51 across the
// dwarf sequence (fitted to Pecaut & Mamajek's M5V-through-A0V table), so the
// lifetime goes as T^-6.28 -- a ferociously steep dependence, which is the
// whole point. A 6500 K F star burns out in 4.8 Gyr and brightens visibly
// inside a game; TRAPPIST-1 at 2566 K has 1500 Gyr and is, for every purpose
// here, a constant star. That is why the M-dwarf presets carry no brightening:
// not an omission, an answer.
export function mainSequenceLife(tempK) {
  const T = Math.max(tempK || SOLAR_TEMP, 1000);
  return SOLAR_MS_LIFE * Math.pow(T / SOLAR_TEMP, -6.28);
}

// The end of the main sequence, in units of the fraction of one that is spent.
const MS_END = 1;

// Gough's shape, in units of the fraction of a main sequence that is spent.
function goughShape(frac) {
  return 1 / (1 + GOUGH_A * (1 - frac / SOLAR_FRAC));
}

// The fractional brightening rate a star of this temperature has at this age,
// per Gyr, straight off its own curve. This is what `brightening` should be set
// to for a world that is meant to be real, and it is where the spectral-type
// dependence lives: the same checkbox gives the Sun 8.8%/Gyr, an F5 at the same
// age 21%/Gyr, and TRAPPIST-1 six ten-thousandths of a percent.
export function naturalBrightening(tempK, ageGyr) {
  const tau = mainSequenceLife(tempK);
  const f = Math.max(ageGyr, 0) / tau;
  const u = 1 + GOUGH_A * (1 - f / SOLAR_FRAC);
  if (!(u > 0)) return 0;                 // past the end of the main sequence
  return (GOUGH_A / SOLAR_FRAC) / (tau * u);
}

// The Sun's own present-day rate, which is what the "brightening star" checkbox
// means by default.
export const SOLAR_BRIGHTENING = naturalBrightening(SOLAR_TEMP, EARTH_AGE);

// How much brighter the star is after `gyr` billion years, as a multiplier.
//
// `brightening` is now a multiplier on the star's OWN track rather than a rate
// in fraction-per-Gyr, and 1 means "this star, brightening the way it does".
// That is the change that makes the setting spectral-type-aware without the
// player having to know any of the above: the same ticked box gives the Sun
// 8.8%/Gyr, an F5 at 6500 K around 18%, and TRAPPIST-1 four ten-thousandths.
// A rate could not do that, because one number cannot be right for two stars --
// or, as it turns out, for one star at two different ages.
//
// Values other than 1 run the star's life fast or slow. A 3 is a star ageing
// three times over, which is what a scenario that needs a brightening it can
// watch inside a billion years is really asking for.
export function brightnessAfter(p, gyr) {
  const speed = p && p.brightening;
  if (!(speed > 0) || !(gyr > 0)) return 1;
  const tau = mainSequenceLife(p.starTemp);
  // Both ends clamped to the main sequence, and that clamp is the whole of the
  // fix for a bug that turned a slider into a catastrophe.
  //
  // Gough's fit has a pole: 1 + 0.4(1 - x) is zero at x = 3.5, which in these
  // units is 1.6 main-sequence lifetimes. Past it the curve inverts, so a star
  // ran BACKWARDS -- an F at 6500 K was 1.496x after a billion years and 1.392x
  // after twelve -- and past the pole again it came out negative, where a guard
  // written as 2.5 / Math.max(g0, 1e-6) turned a negative g0 into 1e-6 and
  // handed back a brightening of two and a half MILLION. Dragging the star
  // temperature to 7265 K did exactly that: an A star has a 2.4 Gyr main
  // sequence, the default startAge of 4.567 is already past the end of it, and
  // the world arrived at 1009838 S(+) and a magma ocean at 3727 C.
  //
  // A star that has burned its hydrogen leaves the main sequence, and this
  // model has no giant branch. So the track stops where the main sequence does.
  // goughShape(1) is 1.91, which is about where a G star's luminosity really
  // ends up, and holding it there is the honest answer for a model that cannot
  // follow what happens next.
  const f0 = clamp(Math.max(p.startAge ?? EARTH_AGE, 0) / tau, 0, MS_END);
  const f1 = clamp(f0 + speed * gyr / tau, 0, MS_END);
  return goughShape(f1) / goughShape(f0);
}

// Whether this star has already left the main sequence at this age, so the
// interface can say so rather than quietly doing nothing.
export function pastMainSequence(p) {
  if (!p) return false;
  return (p.startAge ?? EARTH_AGE) > mainSequenceLife(p.starTemp);
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
    out.insolation = base.insolation * brightnessAfter(p, gyr);
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
      // Only the radiogenic part runs down. Tidal heat does not: it comes from
      // an eccentricity held by a resonance with the neighbouring planets, and
      // it is set by the orbit rather than by how much potassium-40 is left --
      // TRAPPIST-1b's 2.68 W/m2 and GJ 1132 b's 80 are the same today as they
      // were three billion years ago, while Earth's 0.092 is a third of what it
      // was. Decaying a kneaded world on a half-life curve would cool a planet
      // that is not cooling, which is why these three used to have the whole
      // switch turned off; `tidalHeat` lets the switch be on and still be right.
      // Anything the player adds on top of the published tidal flux is treated
      // as radiogenic and decays.
      const total = base.internalHeat ?? 0;
      const tidal = clamp(p.tidalHeat ?? 0, 0, total);
      out.internalHeat = tidal
        + (total - tidal) * clamp(radiogenic(startAge) / now, 0, 1);
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
  // is an event you place, not a curve the world follows -- and it is placed in
  // elapsed time, `gyr`, rather than in the world's age. See resurfacingBoost.
  const boost = resurfacingBoost(p, gyr);
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
// Timed from the START OF THE RUN, not from the planet's formation, and that is
// a correction rather than a preference. It used to be an age, which reads well
// -- "Venus resurfaced at an age of 3.85 Gyr" is how the literature says it --
// and is unusable as a control, because most worlds begin at an age of 4.567.
// Setting it to 3.85 on one of those schedules an event eight hundred million
// years before the clock starts, so it never happens and the control silently
// does nothing. There is no way to tell from the interface that this is what
// has occurred. Elapsed time cannot be in the past.
//
// The two only differ by `startAge`, so a preset that wants a real date still
// gets one: Early Venus begins at 1.67 Gyr and asks for 2.182 elapsed, which is
// the same 3.852 Gyr of age it always meant.
//
// Returned as a multiplier on volcanic outgassing, shaped as a smooth pulse so
// that nothing in the solver meets a step change.
export function resurfacingBoost(p, elapsedGyr) {
  const at = p.resurfacingAge;
  if (!(at > 0) || !(p.resurfacingBoost > 1)) return 1;
  const span = Math.max(p.resurfacingSpan ?? 50, 1) / 1000;   // Myr -> Gyr
  const x = (elapsedGyr - at) / span;
  if (x < -3 || x > 3) return 1;
  return 1 + (p.resurfacingBoost - 1) * Math.exp(-x * x);
}

// Cumulative share of material delivered by the resurfacing event. Unlike the
// Gaussian outgassing multiplier, this is an exact 0-to-1 ledger, so adding a
// fixed atmospheric inventory is independent of the solver's step sequence.
export function resurfacingProgress(p, elapsedGyr) {
  const at = p.resurfacingAge;
  if (!(at > 0) || !(p.resurfacingBoost > 1)) return 0;
  const span = Math.max(p.resurfacingSpan ?? 50, 1) / 1000;
  return smoothstepLocal(at - 3 * span, at + 3 * span, elapsedGyr);
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
