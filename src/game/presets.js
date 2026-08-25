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
  youngMars: { name: 'Young Mars', icon: '🟠', params: { ...EARTH, o2Bar: 0, biosphere: 0,
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
  //
  // The composition here is the state the coupled model actually rests in, and
  // it is written down for the same reason the Hot Ocean World's is. This used
  // to boot at 0.10 bar and 290 K, which is 27.5 W/m^2 above its own warm
  // branch -- and that branch sat at +1.2 C with the ice-albedo tipping point
  // only six kelvin under it, so the cooling transient overshot straight past it
  // and the world was a hard snowball inside fifteen hundred years. A frozen
  // planet does not weather, so volcanic CO2 then piled up with nothing to take
  // it out, 0.1 bar to 10 over two hundred megayears, and this model's runaway
  // limit falls with total pressure (259 W/m^2 at 0.1 bar, 158 at 10, 113 at 20)
  // where the world absorbs 185. Past about five bar the runaway was no longer
  // escapable and it finished at 1099 C with its ocean in the air.
  //
  // Booting at 0.336 bar puts the warm branch at +10 C with twenty kelvin of
  // margin instead of six, and the carbon cycle holds it: 0.336 bar is where
  // weathering and volcanism balance on this world, so nothing is straining to
  // move. Three gigayears at every step size tested, -1.5 to 10.3 C, temperate
  // throughout.
  //
  // The CO2 is high against the literature -- paleosol work generally wants
  // 0.01-0.1 bar for the late Archean -- and that is this model being about
  // fifteen kelvin cold for a faint young Sun rather than a claim about the
  // real Archean. It is the same semi-grey gap the snowball rows report: one
  // optical depth serving 230 K and 288 K at once. The methane it settles on,
  // ~300 ppm, is squarely in the published range, and the world it makes is
  // anoxic, wet and cool with about a quarter of itself under ice.
  earlyEarth: { name: 'Archean', icon: '🌊', params: { ...EARTH, o2Bar: 0, biosphere: 0.2,
    insolation: 0.77, landFraction: 0.1, co2Bar: 0.3359, ch4Bar: 3.686e-4, h2Bar: 4.467e-4,
    startT: 283.23 } },
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
  // Wordsworth & Pierrehumbert 2013's point applies here -- what escapes past a
  // cold trap is a *ratio*, so a large non-condensible inventory holds the
  // stratosphere dry and a huge CO2 budget does not by itself mean fast water
  // loss. It is only half the story though, and the note below the parameters
  // says which half.
  //
  // Getting one to *stay* hot is the interesting part, and it is no longer the
  // thermostat alone. Pinning the CO2 used to be enough -- 10 bar at this
  // insolation sat at 66 C quite happily -- and since the four-band radiation
  // and the reflecting cloud deck went in, it is not: with no hydrogen, 0.28
  // S(+) has exactly one stable solution and it is a snowball, -106 C at 10
  // bar, -98 C at 15, -83 C at 20, the warm crossing near 145 C unstable in
  // every case. More CO2 warms the cold branch and never reaches the warm one.
  // That is Kasting's outer edge finally showing up, and it is why the preset
  // below carries hydrogen. Let the carbonate-silicate thermostat run and it pulls the same
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
  // all told. That holds it at 73 C under 10 bar for a gigayear, with an ocean
  // over every square metre and enough of a cold trap to keep it for ninety-nine.
  // It settles at 73 C, and the classifier now calls it a Hot Ocean World rather
  // than a Moist Greenhouse -- the stratospheric mixing ratio comes out at
  // 8.4e-4, just under Kasting's 1e-3, where booting out of balance used to
  // land it at 1.04e-3 and just over. It sits on that criterion either way, so
  // the label can still cross while you watch it, and a 73 C ocean is marginal
  // for keeping its water however it got to 73 C.
  //
  // The composition below is that gigayear state, and it is written down here
  // rather than discovered at runtime because the two are not the same world.
  // The preset used to boot at 15 bar and 340 K, which is ninety W/m^2 short of
  // balance -- fifteen bar cannot hold 340 K once the hydrogen is counted -- so
  // the world fell to a snowball inside two centuries, condensed its atmosphere
  // onto the ground, and came back through a 668 C runaway some tens of
  // megayears later before arriving at the same 73 C. Every check that read the
  // arrival passed the whole time; what it looks like is a world that flashes
  // through a runaway and a snowball the moment you run the clock fast enough
  // to see thirty megayears go by. The trajectory is now pinned by a self-test
  // as well as the endpoint.
  //
  // The hydrogen is a third of the story and was not here before. At thirty
  // times Earth's outgassing and 0.28 S(+) the XUV is too weak to strip it, so
  // it stands at 0.117 bar in steady state, and its collision-induced
  // absorption -- which goes as pH2 x pTot, and so is ten times stronger under
  // ten bar than under one -- is worth about 110 W/m^2 here. That is what holds
  // the world up: at this insolation there is no CO2-only branch to stand on,
  // which is the outer edge of the habitable zone behaving as it should. It
  // does mean this world is a hydrogen greenhouse wearing a CO2 label, and the
  // CIA coefficient is fitted to Ramirez et al. 2014's early Mars at one to
  // three bar and extrapolated here without saturating. See the README.
  //
  // Which corrects something written here earlier. The contrast with the Sunbaked
  // Ocean below is *not* that dense CO2 retains water and starlight does not --
  // that was an artefact of comparing worlds at different temperatures. The cold
  // trap works on the ratio pH2O/pTot, vapour pressure is exponential in
  // temperature and the denominator is merely linear, so temperature wins:
  // Sunbaked at 59 C keeps its water comfortably under four bars, this one at
  // 74 C does not under ten. Adding nitrogen here makes it *warmer* faster than it
  // dilutes, which is why 2 bar tested worse than 1.
  //
  // It is also bistable, which is the outer habitable zone being what it is: drop
  // the outgassing from 7.4 to 5 and the same world is a hard snowball at -103 C.
  // There is no lukewarm version of it at this distance.
  hotOcean: { name: 'Hot Ocean World', icon: '♨️', params: { ...EARTH, o2Bar: 0, biosphere: 0,
    insolation: 0.28, co2Bar: 8.742, h2Bar: 0.1165, n2Bar: 1.0, water: 3, landFraction: 0,
    ch4Bar: 0, outgassing: 7.4, internalHeat: 1.5, startT: 346.44 } },

  // The other way to a hot ocean, and the contrast is the point.
  //
  // The world above is hot because of what is in its air. This one is hot because
  // of where it sits: 1.2 times Earth's sunlight, ordinary CO2, and no greenhouse
  // worth the name. What keeps it liquid rather than boiling is that it has no
  // continents -- so no continental weathering, and the carbon thermostat is left
  // with only the slow seafloor sink -- and four bars of nitrogen over it.
  //
  // The nitrogen does two things at once, and both are in the literature. It
  // warms, by pressure-broadening everything else's absorption lines: 2 bar gives
  // 52.8 C here and 4 bar gives 58.5. And it keeps the water, because what gets
  // past a cold trap is the *ratio* pH2O/pTot, so raising the denominator holds
  // the stratosphere dry -- 2.4e-4 here, below Kasting's 1e-3, where the same
  // world under 1 bar is already a moist greenhouse. Vladilo et al. (2013) find
  // the same direction, the inner edge moving from 0.87 to 0.77 au as pressure
  // goes from a third of a bar to three.
  //
  // It is a narrow ledge. At 1.25 S(+) with the same four bars this world is at
  // 222 C with its ocean in the air, so the margin is about four per cent in
  // insolation -- which is roughly what Zhang & Yang (2020) mean when they call
  // the inner edge a non-monotonic function of background pressure.
  sunbakedOcean: { name: 'Sunbaked Ocean', icon: '🌞', params: { ...EARTH, o2Bar: 0, biosphere: 0,
    insolation: 1.20, co2Bar: 280e-6, n2Bar: 4.0, water: 3, landFraction: 0,
    ch4Bar: 0, outgassing: 1.0, internalHeat: 0.092, startT: 330 } },

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
