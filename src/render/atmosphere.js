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
