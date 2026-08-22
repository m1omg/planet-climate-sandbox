// Earth as it is now: 427 ppm CO2 (NOAA global mean, 2025) and a global mean
// surface temperature of 15.15 C. Pre-industrial is the same world at 280 ppm
// and 1.45 K cooler -- the warming the WMO reports for 2023 against the
// 1850-1900 baseline.
//
// Starting modern Earth below its own equilibrium is deliberate and physical:
// the ocean has not finished responding to the CO2 already in the air, so a
// modern Earth left to run warms a few tenths of a degree further with nothing
// added. That is the committed warming.
export const EARTH = {
  mass: 1.0,
  landFraction: 0.30,
  water: 1.0,            // Earth oceans
  insolation: 1.0,       // relative to 1361 W/m^2
  starTemp: 5772,
  xuvFraction: 3.4e-6,   // XUV / bolometric, present-day Sun
  rotationHours: 24,
  tidallyLocked: false,
  obliquity: 23.5,
  // Nitrogen and argon, kept apart from oxygen now that oxygen is a reservoir
  // with a biology behind it. 0.78 + 0.21 is the same 0.99 bar the background
  // used to be on its own, so nothing radiative moves.
  n2Bar: 0.78,
  o2Bar: 0.21,
  biosphere: 1.0,   // oxygenic photosynthesis, relative to Earth's
  co2Bar: 427e-6,
  ch4Bar: 1.9e-6,
  emissions: 0,     // see the `earth` preset; only that world has us on it
  fossilUsed: 0,    // share of the fossil reserve already burnt
  fossilInfinite: false,  // ignore the reserve and burn for ever
  outgassing: 1.0,
  landAlbedo: 0.25,
  startT: 288.3,
};

export const PREINDUSTRIAL = { ...EARTH, co2Bar: 280e-6, ch4Bar: 0.8e-6, startT: 286.85 };

export const PRESETS = {
  // The only world with anyone on it. Kept off the EARTH constant itself so
  // that the dozen presets which spread it do not quietly inherit an industrial
  // civilisation along with the nitrogen.
  // Modern Earth starts with a tenth of its fossil carbon already gone. That is
  // the ~1800 Gt of CO2 we have put into the air since 1750, which is 3.53 of
  // the 36 kg/m^2 in the ground -- and it is the same carbon that has taken this
  // preset from Pre-Industrial Earth's 280 ppm to 427. Pre-Industrial Earth has
  // the lot, because nobody had touched it yet.
  earth:   { name: 'Earth', icon: '🌍', params: { ...EARTH, emissions: 1, fossilUsed: 0.098 } },
  preindustrial: { name: 'Pre-Industrial Earth', icon: '🏞️', params: { ...PREINDUSTRIAL } },
  venus:   { name: 'Venus', icon: '🌋', params: { ...EARTH, o2Bar: 0, biosphere: 0, mass: 0.815, insolation: 1.91, water: 0.0, landFraction: 1, n2Bar: 3.5, co2Bar: 88, rotationHours: 5832, outgassing: 1.2, landAlbedo: 0.15, startT: 700 } },
  mars:    { name: 'Mars', icon: '🔴', params: { ...EARTH, o2Bar: 0, biosphere: 0, mass: 0.107, insolation: 0.43, water: 0.02, landFraction: 0.95, n2Bar: 0.0002, co2Bar: 0.006, rotationHours: 24.6, outgassing: 0.02, landAlbedo: 0.25, startT: 215 } },
  // 0.08 bar of CO2, not 0.02. The old value only worked because methane's
  // opacity was some five times too strong; with it fitted to the measured
  // forcings the faint young Sun needs the CO2 the literature actually asks
  // for, which is 0.01-0.1 bar alongside a few hundred ppm of methane.
  earlyEarth: { name: 'Archean', icon: '🌊', params: { ...EARTH, o2Bar: 0, biosphere: 0.2, insolation: 0.77, landFraction: 0.1, co2Bar: 0.08, ch4Bar: 1e-3, startT: 290 } },
  snowball:{ name: 'Snowball', icon: '❄️', params: { ...EARTH, co2Bar: 1e-5, startT: 230 } },
  dune:    { name: 'Dune World', icon: '🏜️', params: { ...EARTH, water: 0.03, landFraction: 0.98, insolation: 1.25, landAlbedo: 0.30, startT: 300 } },
  eyeball: { name: 'Locked Eyeball', icon: '👁️', params: { ...EARTH, mass: 1.3, insolation: 0.9, tidallyLocked: true, rotationHours: 264, landFraction: 0.25, xuvFraction: 5e-4, startT: 270 } },
  waterworld: { name: 'Waterworld', icon: '💧', params: { ...EARTH, mass: 1.6, water: 6, landFraction: 0.0, insolation: 1.0, startT: 290 } },
  titan:   { name: 'Titan-like', icon: '🟤', params: { ...EARTH, o2Bar: 0, biosphere: 0, mass: 0.15, insolation: 0.011, water: 0.5, landFraction: 0.6, n2Bar: 1.5, ch4Bar: 0.05, co2Bar: 1e-6, outgassing: 0.1, startT: 95 } },
  // 0.9 S-earth and Earth-like specific volcanism, both of which are
  // corrections rather than taste.
  //
  // `outgassing` is per-Earth *specific* activity: the model already multiplies
  // it by outgassingScale(mass), which is 2.4 at three and a half Earth masses.
  // Setting the slider to 2 as well asked for 4.8 times Earth's absolute rate
  // and counted the mass twice. At 1.0 the world still outgasses 2.4x Earth,
  // which is the honest way to say "a bigger planet is more active for longer".
  //
  // It matters because 2.4x is on the habitable side of a cliff and 4.8x is not.
  // The reductant flux from volcanism is what oxygen has to outrun, and past
  // about 1.08 here the biosphere loses: the world stays anoxic, an anoxic
  // biosphere makes methane faster than sunlight can photolyse it, and with no
  // ceiling to settle against it runs away. Moving the planet outwards does not
  // help -- the photon budget falls with the starlight, so the saturation gets
  // worse, and the world goes from runaway at 0.70 S to hard snowball at 0.68
  // with nothing in between. Distance only becomes a temperature dial once the
  // oxygen threshold is on the right side of it, which is why both numbers
  // moved.
  //
  // What it settles at: 14.4 C, ice-free, stable for 5 Gyr, and 0.043 bar of
  // oxygen -- a thinner oxygen atmosphere than Earth's because its volcanism
  // eats most of what its biosphere makes.
  superEarth: { name: 'Super-Earth', icon: '🪐', params: { ...EARTH, mass: 3.5, water: 2, n2Bar: 3, co2Bar: 1e-3, insolation: 0.9, outgassing: 1.0, startT: 290 } },
  futureEarth: { name: 'Earth +1 Gyr', icon: '☀️', params: { ...EARTH, insolation: 1.09, startT: 292 } },
};
