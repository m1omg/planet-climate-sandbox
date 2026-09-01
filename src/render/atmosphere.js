import { clamp } from '../physics/constants.js';

// How the atmosphere should look, in the two modes.
//
// The stylised mode draws a shell tens of percent of the planet's radius. That
// is a diagram, not a photograph -- Earth's atmosphere is about 0.7% of its
// radius, a hairline. It is kept because it is a *useful* diagram: the whole
// point of the app is watching an atmosphere change, and an honest one would be
// invisible at every pressure the model can produce.
//
// The realistic mode draws the real thing: five scale heights, which is where
// the pressure has fallen by about 150x and the air stops being visible. It
// also stops pretending you can see the ground through a hundred bar of gas.
const R_GAS = 8314;            // J/(kmol K)
const R_EARTH = 6.371e6;       // m

// Mean molar mass of the air, from what is actually in it.
export function molarMass(dg) {
  const m = { n2: 28.0, co2: 44.0, ch4: 16.0, o2: 32.0, h2o: 18.0 };
  const pH2O = dg.pH2O.reduce((a, b) => a + b, 0) / dg.pH2O.length;
  const parts = [[dg.pN2, m.n2], [dg.pCO2, m.co2], [dg.pCH4, m.ch4], [dg.pO2, m.o2], [pH2O, m.h2o]];
  let p = 0, sum = 0;
  for (const [pp, mm] of parts) { if (pp > 0) { p += pp; sum += pp * mm; } }
  return p > 0 ? sum / p : 28.0;
}

// Scale height in metres: the height over which the pressure falls by e.
export function scaleHeight(dg) {
  return R_GAS * clamp(dg.Tmean, 30, 4000) / (molarMass(dg) * Math.max(dg.g, 0.5));
}

// How much of the sky the deck should actually *hide*.
//
// Cover is not opacity, and the renderer was treating it as though it were.
// Earth's sky is about two-thirds covered and you can still see the Pacific
// through it, because most of that cover is thin and broken: shallow cumulus
// over warm ocean, cirrus you can read a coastline through. Drawing 0.67 as
// 0.67 of solid white gave every temperate world a permanent overcast.
//
// What makes a deck genuinely opaque is water in the air, and that is a steep
// function of temperature. Measured from the model: temperate Earth carries
// about 0.011 bar of vapour, 300 K carries 0.027, a humid 315 K carries 0.055,
// and by 339 K it is 0.17 -- towelling-thick, the tropical-storm look, and by
// then the surface really should be hard to see. Beyond that the runaway takes
// over and `steam` covers the planet outright.
//
// So: about seven-tenths weight at temperate humidity, full weight by 0.15 bar.
// The number was picked by looking, because the shader's threshold makes this
// far from linear -- Earth's 0.67 drawn straight is a near-total white-out with
// the continents lost under it, 0.48 is scattered weather with the ocean
// showing through, and 0.33 is a bald planet with almost no cloud at all. The
// physics is untouched: `dg.cloud` still sets the albedo the energy balance
// uses, and this only changes what is drawn.
export function cloudLook(coverMean, pH2Obar) {
  const humid = clamp((pH2Obar - 0.015) / (0.15 - 0.015), 0, 1);
  const thickness = humid * humid * (3 - 2 * humid);      // smoothstep
  return clamp(coverMean, 0, 1) * (0.72 + 0.28 * thickness);
}

// What volcanism looks like from orbit, from the melt production the physics
// already tracks. One place, because two renderers reading the same number and
// mapping it differently would be a difference nobody could account for.
//
// Vents saturate: past a few times Earth's activity the ground is already
// covered in them and more heat makes them brighter rather than more numerous,
// so the curve is a log that reaches 1 around 30x -- GJ 1132 b, the most
// volcanic body this model carries.
//
// Ash needs an atmosphere to hang in, and is slower to arrive. Below about
// twice Earth's activity there is effectively none: the stratosphere clears a
// Pinatubo in three or four years, and it takes continuous eruption to hold a
// permanent veil up. It also cannot exist without air to hold it -- Io has no
// ash haze because it has no atmosphere, and neither should this.
export function volcanoLook(world) {
  const dg = world.diag;
  const v = Math.max(dg.volcanism ?? 0, 0);
  const vents = clamp(Math.log10(1 + v) / Math.log10(31), 0, 1);
  const air = clamp((dg.pTotMean - 0.01) / 0.2, 0, 1);
  const ash = clamp((Math.log10(1 + v) - Math.log10(2)) / (Math.log10(21) - Math.log10(2)), 0, 1);
  // Capped well below opaque. A permanently volcanic world is hazy, not
  // buried: at half opacity the surface stopped being readable at all, which
  // defeats the point of being able to look at it.
  return { vents, ash: ash * air * 0.32 };
}

export function atmosphereLook(world, steam, realistic) {
  const dg = world.diag;
  const pTot = dg.pTotMean;
  // hazeTau is the *absorbing* optical depth, which is what the energy balance
  // cares about. What the eye sees is the total extinction, and for tholins
  // that is several times larger because most of it is scattering -- which is
  // why Titan's surface is invisible in visible light while its anti-greenhouse
  // is only worth a tenth of the sunlight.
  const haze = clamp(1 - Math.exp(-6.0 * (dg.hazeTau || 0)), 0, 1);

  if (!realistic) {
    return {
      thickness: clamp(0.030 + 0.10 * Math.log(1 + pTot) + 0.16 * steam, 0, 0.42),
      veil: 0,                       // the stylised mode always shows the ground
      haze: haze * 0.6,
    };
  }

  // Five scale heights, as a fraction of this planet's radius.
  const R = dg.d.R || R_EARTH;
  const thickness = clamp(5 * scaleHeight(dg) / R, 0.0015, 0.30);

  // How much the air itself hides the surface. Rayleigh scattering goes as the
  // column, so it is negligible at one bar and total by ninety: Venus shows
  // cloud tops and nothing else. Haze and a deep steam envelope do the same.
  const rayleigh = 1 - Math.exp(-pTot / 26);
  const veil = clamp(Math.max(rayleigh, haze, steam * 0.95), 0, 1);
  return { thickness, veil, haze };
}
