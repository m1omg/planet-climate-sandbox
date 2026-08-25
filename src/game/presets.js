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
  // Hydrogen. Zero on modern Earth and on anything with an oxidised mantle, but
  // the difference between a frozen early Mars and a wet one (Ramirez et al.
  // 2014), and the whole atmosphere of a Hycean world.
  h2Bar: 0,
  // How reduced the mantle is, as a multiplier on hydrogen outgassing. 1 is
  // Earth today; Ramirez et al. put early Mars near 20, three log units below
  // the iron-wustite buffer.
  mantleRedox: 1,
  emissions: 0,     // see the `earth` preset; only that world has us on it
  fossilUsed: 0,    // share of the fossil reserve already burnt
  fossilInfinite: false,  // ignore the reserve and burn for ever
  outgassing: 1.0,
  // Earth's measured interior heat: 47 +/- 2 TW over the globe, 0.092 W/m^2
  // (Davies & Davies 2010). A twenty-six-hundredth of the sunlight it absorbs,
  // which is why leaving it out was defensible -- and worth about a tenth of a
  // kelvin, which is why putting it in moved the calibration slightly.
  internalHeat: 0.092,
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
  // Earth's physics without Earth's biography: no industry, no real coastlines,
  // and a fresh set of continents every time you load it. For trying something
  // out without the answer being about this planet in particular. Emissions are
  // still there if you want them -- the control does not go away, it just starts
  // at nothing.
  earthlike: { name: 'Earth-like', icon: '🌐', params: { ...PREINDUSTRIAL, co2Bar: 280e-6, emissions: 0, fossilUsed: 0 } },
  venus:   { name: 'Venus', icon: '🌋', params: { ...EARTH, o2Bar: 0, biosphere: 0, internalHeat: 0.031, mass: 0.815, insolation: 1.91, water: 0.0, landFraction: 1, n2Bar: 3.5, co2Bar: 88, rotationHours: 5832, outgassing: 1.2, landAlbedo: 0.15, startT: 700 } },
  // Venus before it lost. Way et al. 2016 (GRL 43, 8376) ran Venus in a 3-D GCM
  // with a shallow ocean and found it temperate -- a global mean near 11 C --
  // and argued it could have stayed that way for two billion years or more.
  //
  // Their setup, as closely as this model can carry it: a 310 m global ocean
  // (0.115 Earth oceans), a 1 bar mostly-nitrogen atmosphere with a few hundred
  // ppm of CO2 rather than the 88 bar it ended up with, Venus's real topography
  // and mass, and the same slow retrograde spin it has now -- which is the point
  // of the paper. A day that lasts 243 Earth days gives the substellar cloud
  // deck all the time it needs to build, and that deck is what keeps the world
  // cool at an insolation that ought to cook it (the Yang, Cowan & Abbot 2014
  // mechanism, working on a planet that is not tidally locked at all).
  //
  // The insolation is 2.9 Ga, not today: the Sun was fainter, so Venus took
  // about 1.4 times what Earth gets now instead of the 1.91 it takes today.
  youngVenus: { name: 'Young Venus', icon: '🌅', params: { ...EARTH, o2Bar: 0, biosphere: 0,
    mass: 0.815, insolation: 1.40, water: 0.115, landFraction: 0.6, n2Bar: 1.0,
    co2Bar: 400e-6, ch4Bar: 0, rotationHours: 5832, obliquity: 2.6, outgassing: 1.5,
    internalHeat: 0.10, landAlbedo: 0.20, startT: 285 } },
  mars:    { name: 'Mars', icon: '🔴', params: { ...EARTH, o2Bar: 0, biosphere: 0, internalHeat: 0.02, mass: 0.107, insolation: 0.43, water: 0.02, landFraction: 0.95, n2Bar: 0.0002, co2Bar: 0.006, rotationHours: 24.6, outgassing: 0.02, landAlbedo: 0.25, startT: 215 } },
  // Mars in the Noachian, ~3.8 Ga, when the valley networks and the lake beds
  // were cut. The Sun was about 75% as bright, so Mars took 0.32 of what Earth
  // gets now -- less than a third -- and how it was ever warm enough for running
  // water is genuinely unsettled.
  //
  // What the literature says: CO2 alone does not do it. Forget et al. 2013 reach
  // a maximum near 225 K under a few bar, because past a couple of bar CO2's own
  // Rayleigh scattering starts to win. This model agrees and is harsher still --
  // with the hydrogen turned off it cannot get this world past 198 K at any CO2
  // pressure whatever.
  //
  // But "cold and icy" is one reading of the evidence, not the settled one.
  // Ramirez et al. 2014 warm it with 1.3-4 bar of CO2 plus 5-20 per cent H2,
  // outgassed from a mantle three log units below the iron-wustite buffer.
  // Hydrogen has no dipole and therefore no bands of its own, but its
  // collision-induced absorption with CO2 runs straight through the 8-12 um
  // window, which is exactly the part of the spectrum a CO2-H2O atmosphere
  // leaves open. That is why a few per cent of it outperforms doubling the CO2.
  //
  // So this preset is the wet reading: 1.53 bar of CO2 under 0.27 of H2, 15 per
  // cent, for 1.8 bar total -- inside the 1.9 bar upper limit Kite et al. 2014
  // derive from secondary crater sizes. Turn the H2 slider to zero and watch it
  // freeze, which is the experiment the argument is actually about.
  //
  // The honest part, and it is the actual open question. Hydrogen is a steady
  // state rather than an inventory: it escapes as fast as it is made, in about a
  // megayear here, so what matters is the flux and not what the planet started
  // with. Set `mantleRedox` to Ramirez's own value of 20 and this model sustains
  // 1.20 per cent H2 -- against the 1.3 per cent he computes, which is a decent
  // independent check on both halves -- and at 1.2 per cent the planet is frozen
  // at -69 C. His climate model wants 5-20 per cent. That gap is his too; he
  // notes his outgassing estimate falls a factor of four short and that the rate
  // is uncertain by at least a factor of five.
  //
  // So the preset ships at 300, which sustains 17 per cent and a temperate
  // planet, and is frankly the optimistic end. Wind it back to 20 and watch what
  // his own numbers actually give you.
  youngMars: { name: 'Young Mars', icon: '🏞', params: { ...EARTH, o2Bar: 0, biosphere: 0,
    mass: 0.107, insolation: 0.32, water: 0.06, landFraction: 0.75, n2Bar: 0.05,
    co2Bar: 1.53, h2Bar: 0.27, mantleRedox: 300, ch4Bar: 0, rotationHours: 24.6,
    obliquity: 25, outgassing: 3.0, internalHeat: 0.06, landAlbedo: 0.25, startT: 260 } },
  // 0.10 bar of CO2, and it has been raised for the same reason twice now.
  //
  // It was 0.02, which only worked because methane's opacity was some five
  // times too strong. Fitting that to the measured forcings took it to 0.08.
  // Then methane's *shortwave* absorption went in -- the near-infrared bands
  // that cap its greenhouse at about 8.5 W/m^2 and turn it into a coolant past
  // a few hundred pascals (Byrne & Goldblatt 2015; Eager-Nash et al. 2023) --
  // and the eight hundred ppm here stopped being worth forty kelvin. At 0.08
  // bar this world froze to -2 C.
  //
  // 0.10 puts it back at 2.9 C, which is within a kelvin and a half of where it
  // sat before any of this, and inside the 0.01-0.1 bar the comment above
  // already cited. It is *not* the warmest defensible choice: 0.16 bar reaches
  // 12 C, which is where the literature actually puts the Archean, and that is
  // the number this would carry if temperature were the only constraint.
  //
  // What rules it out is the Great Oxidation. This world has to be able to lose
  // its methane and freeze -- the Huronian happened, and the scenario built on
  // it is a shipped feature. The snowball bifurcation sits between 0.10 and
  // 0.12 bar: at 0.10 oxygenating the air takes it to -45 C and 100% ice, and
  // at 0.12 it stops at -7 C and 39%. So 0.10 is the last value that keeps both
  // an Archean above freezing and a Huronian that can happen.
  //
  // That the model needs a marginal Archean to reproduce a glaciation a GCM
  // gets comfortably -- Wolf & Toon 2013 reach 289 K on 0.02 bar at 0.8 S(+) --
  // is the semi-grey scheme's gap, not methane's. It is the same one optical
  // depth having to serve 230 K and 288 K at once, reported against the
  // snowball rows in calibrate.mjs.
  earlyEarth: { name: 'Archean', icon: '🌊', params: { ...EARTH, o2Bar: 0, biosphere: 0.2, insolation: 0.77, landFraction: 0.1, co2Bar: 0.10, ch4Bar: 1e-3, startT: 290 } },
  snowball:{ name: 'Snowball', icon: '❄️', params: { ...EARTH, co2Bar: 1e-5, startT: 230 } },
  dune:    { name: 'Dune World', icon: '🏜️', params: { ...EARTH, water: 0.03, landFraction: 0.98, insolation: 1.25, landAlbedo: 0.30, startT: 300 } },
  eyeball: { name: 'Locked Eyeball', icon: '👁️', params: { ...EARTH, mass: 1.3, insolation: 0.9, tidallyLocked: true, rotationHours: 264, landFraction: 0.25, xuvFraction: 5e-4, startT: 270 } },
  waterworld: { name: 'Waterworld', icon: '💧', params: { ...EARTH, mass: 1.6, water: 6, landFraction: 0.0, insolation: 1.0, startT: 290 } },
  titan:   { name: 'Titan-like', icon: '🟤', params: { ...EARTH, o2Bar: 0, biosphere: 0, mass: 0.15, insolation: 0.011, water: 0.5, landFraction: 0.6, n2Bar: 1.5, ch4Bar: 0.05, co2Bar: 1e-6, outgassing: 0.1, startT: 95 } },

  // A hot ocean world: rain, weather and open sea at seventy-odd degrees under a
  // heavy CO2 atmosphere. Liquid water is not the hard part -- pressure lifts the
  // boiling point far above 100 C long before the critical point at 647 K and
  // 221 bar -- and the published models get there: von Paris et al. 2010 put
  // Gliese 581d at 357 K under 20 bar of CO2, Wordsworth et al. 2011 melted an
  // initially frozen ocean on the same planet with a 3-D GCM at 20 bar and up.
  //
  // This one sits at 0.28 of Earth's sunlight, which is Gliese 581d's, and gets
  // everything from the greenhouse. It carries about half the CO2 von Paris
  // needed for the same temperature, because this model has no maximum
  // greenhouse -- CO2's Rayleigh scattering never overtakes its greenhouse the
  // way Kasting 1993 has it -- so its dense-CO2 worlds run hot for the pressure.
  // That gap is reported on every calibrate run and written up in the README.
  //
  // What makes it keep its ocean is the other half of the physics and it is not
  // a fudge: what escapes past a cold trap is a *ratio*, and ten bars of CO2 is
  // a very large denominator. Wordsworth & Pierrehumbert 2013 make the same
  // point -- dense CO2 cools the upper atmosphere and tightens the trap, so a
  // huge CO2 inventory does not by itself mean fast water loss.
  //
  // Getting one to *stay* hot is the interesting part, and it is not the
  // radiation. Pin the CO2 and 10 bar at this insolation sits at 66 C quite
  // happily. Let the carbonate-silicate thermostat run and it pulls the same
  // world down to 2 C in half a gigayear, because weathering rises with
  // temperature and that is exactly what a thermostat does. Which is the honest
  // answer to whether a world like this lasts: the limit is the carbon cycle,
  // not the greenhouse, and it is the first thing on the list of uncertainties
  // anyone raises about these worlds.
  //
  // So it needs the thermostat outrun rather than switched off. Two things do
  // it here, and both are things real planets have. There are no continents, so
  // there is no continental weathering and only the slower seafloor sink is
  // left -- worth twenty kelvin on its own. And the interior is Io-like at 1.5
  // W/m^2, which is worth 4x on melt production by itself (meltBoost), with a
  // specific activity of 7.4 on top of that for thirty times Earth's outgassing
  // all told. That holds it at 72 C under 11 bar for a gigayear, with an ocean
  // over every square metre and enough of a cold trap to keep it for ninety-nine.
  hotOcean: { name: 'Hot Ocean World', icon: '♨️', params: { ...EARTH, o2Bar: 0, biosphere: 0,
    insolation: 0.28, co2Bar: 15, n2Bar: 1.0, water: 3, landFraction: 0,
    ch4Bar: 0, outgassing: 7.4, internalHeat: 1.5, startT: 340 } },

  // ---- three planets that actually exist ----------------------------------
  //
  // Masses, radii, periods and insolations from Agol et al. 2021 for the
  // TRAPPIST-1 system and Bonfils et al. 2018 for GJ 1132. Interior heat from
  // Barr, Dobos & Kiss 2018 Table 3 (TRAPPIST-1) and Swain et al. 2021 (GJ
  // 1132 b) -- these are the worlds the internal-heat slider was built for, so
  // they are on their published tidal fluxes rather than on Earth's 0.092.
  //
  // All three are tidally locked, which is what `rotationHours` equal to the
  // orbital period plus `tidallyLocked` means here.

  // 4.15 S(+) and 2.68 W/m^2 of tidal heat -- twice Io's. Barr et al. put its
  // mantle above the rock solidus, so it is partially molten inside. JWST
  // secondary-eclipse photometry (Greene et al. 2023) found a dayside
  // brightness temperature of about 503 K, which is what a bare rock with no
  // atmosphere redistributing heat looks like: no atmosphere detected. So it
  // starts with essentially none, and the volcanism has to build one.
  trappist1b: { name: 'TRAPPIST-1b', icon: '🔥', params: { ...EARTH,
    mass: 1.374, insolation: 4.153, starTemp: 2566, tidallyLocked: true,
    rotationHours: 36.3, obliquity: 0, water: 0, landFraction: 1,
    n2Bar: 1e-4, o2Bar: 0, co2Bar: 1e-5, ch4Bar: 0, biosphere: 0,
    internalHeat: 2.68, outgassing: 1.5, xuvFraction: 7e-4,
    landAlbedo: 0.12, startT: 500 } },

  // 0.646 S(+), and the one in the system that sits squarely in the habitable
  // zone. 0.18 W/m^2 of tidal heat, about twice Earth's. Barr et al. give it a
  // runaway threshold of 258 W/m^2 against a global flux of 157, so it is not
  // close to running away -- its problem is the other end, and at 0.646 S(+)
  // it needs a real CO2 greenhouse to hold liquid water. This is a *plausible*
  // configuration, not a measured one: nothing is known about its atmosphere.
  // A bar of CO2 lands it at 19 C with a quarter of the globe iced and most of
  // the ocean liquid -- an eyeball with a wide habitable ring, which is what
  // the GCM literature gets for it too (Turbet et al. 2018 model exactly this
  // 1 bar CO2 case). Those GCMs manage it on far less CO2, because a locked
  // world grows a thick cloud deck over the substellar point that this model
  // only approximates; a bar is at the thick end of plausible, not the middle.
  trappist1e: { name: 'TRAPPIST-1e', icon: '🌍', params: { ...EARTH,
    mass: 0.692, insolation: 0.646, starTemp: 2566, tidallyLocked: true,
    rotationHours: 146.4, obliquity: 0, water: 1.0, landFraction: 0.3,
    n2Bar: 1.0, o2Bar: 0, co2Bar: 1.0, ch4Bar: 0, biosphere: 0,
    internalHeat: 0.18, outgassing: 1.0, xuvFraction: 7e-4, startT: 280 } },

  // 19 S(+), and the one Swain et al. 2021 model at 80 W/m^2 of tidal heat --
  // a thousand times Earth's, from an eccentricity of only 0.01 held by
  // resonance. That puts a magma ocean a few tens of metres down and predicts
  // Io-like volcanism, which is why it is here: it is the observed case for a
  // world whose interior, not its star, decides what its atmosphere is. The
  // star is not the problem either way at 19 S(+).
  //
  // `outgassing` is 1.0 because the melt boost from 80 W/m^2 is already 29x --
  // that IS the Io-like volcanism Swain et al. predict, and asking for three
  // times Earth's specific activity on top of it would have counted the same
  // heat twice and landed on ninety. It matches the GJ 1132 b button under the
  // internal-heat slider, which is where that arithmetic is written out.
  gj1132b: { name: 'GJ 1132 b', icon: '🌋', params: { ...EARTH,
    mass: 1.66, insolation: 18.8, starTemp: 3270, tidallyLocked: true,
    rotationHours: 39.1, obliquity: 0, water: 0, landFraction: 1,
    n2Bar: 0.01, o2Bar: 0, co2Bar: 0.1, ch4Bar: 0, biosphere: 0,
    internalHeat: 80, outgassing: 1, xuvFraction: 2e-4,
    landAlbedo: 0.12, startT: 600 } },
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
