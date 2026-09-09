import { clamp, steamOpacity } from '../physics/constants.js';

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
  const m = { n2: 28.0, co2: 44.0, ch4: 16.0, o2: 32.0, h2o: 18.0, h2: 2.016, he: 4.003 };
  const pH2O = dg.pH2O.reduce((a, b) => a + b, 0) / dg.pH2O.length;
  // Hydrogen is the entry that changes the picture rather than nudging it. At
  // 2 kg/kmol against nitrogen's 28 the scale height is fourteen times Earth's
  // at the same temperature and gravity, which is why a hydrogen envelope is a
  // visibly puffy planet and not a thin blue line.
  const parts = [[dg.pN2, m.n2], [dg.pCO2, m.co2], [dg.pCH4, m.ch4], [dg.pO2, m.o2],
                 [dg.pH2 ?? 0, m.h2], [dg.pHe ?? 0, m.he], [pH2O, m.h2o]];
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

// How completely the ground is buried under fluid rather than facing space.
//
// Past the critical point there is no sea surface and no sky-and-ground: the
// water is one continuous medium from the rock to the top of the atmosphere,
// which is the model's own position everywhere else and is what the readout
// prints as "no surface". A renderer that ignores it paints the rock: a Buried
// Ocean came out as a lava planet with cracks glowing through, on a world whose
// own cross-section has two hundred kilometres of liquid water and a thousand
// of supercritical steam between that rock and the sky.
//
// Two factors, and both are needed. `hotTarget` is the share of the surface
// past the critical point -- the model's one definition of "no sea surface",
// shared with the vapour ceiling and the classifier. `steam` is how opaque the
// water above is, which is what stops a dry magma world from claiming to be
// hidden: it is every bit as hot and has nothing over it, so it is drawn molten
// as it always was.
export function surfaceHidden(dg, steam) {
  const wet = steam ?? steamOpacity(dg.pH2O.reduce((a, b) => a + b, 0) / dg.pH2O.length);
  return clamp((dg.hotTarget ?? 0) * wet, 0, 1);
}

// The sea that is under the lid, as a surface cover the renderer can draw.
//
// With the clouds off, taking the steam away used to reveal bare rock on a world
// carrying five hundred oceans, because `flooded` is the share of the SURFACE
// under sea and a buried ocean has no surface: it reads zero while the reservoir
// holds 489 EO. Switching the shroud off should show you the water it is hiding,
// not the ground the water is standing on.
//
// The pool is global -- it is one column, not a basin -- so the cover is the
// share of the planet that has gone over, times the share of the column the hot
// layer has NOT converted. Once conversion finishes there is no liquid left and
// this falls to zero on its own, which is the moment the world really is a dry
// hot rock and should be drawn as one.
export function buriedOceanCover(dg) {
  if (!((dg.totalWater ?? 0) > 0.005)) return 0;
  const left = 1 - clamp(dg.hotLayer ?? 1, 0, 1);
  return clamp((dg.hotTarget ?? 0) * left, 0, 1);
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
      // The ceiling was 0.42 of the radius, and everything thick pinned against
      // it: Venus, both runaways, both buried oceans. Drawn, that is a small
      // disc inside a balloon nearly three times its width -- reported from
      // play, and it flatters nothing. The curve below the cap is untouched, so
      // Earth is exactly as it was at 0.100; only the worlds that were already
      // saturated come down, and they come down together, which keeps the one
      // thing this diagram is for -- comparing them by eye.
      thickness: clamp(0.030 + 0.10 * Math.log(1 + pTot) + 0.16 * steam, 0, 0.26),
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
