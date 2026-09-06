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
  // The primordial envelope: hydrogen and helium caught from the disc while the
  // star was still forming, rather than outgassed from the rock afterwards.
  // Earth has none -- whatever it captured was lost long ago, and that is true
  // of every terrestrial world here, so this is zero in all of them and the
  // radiative term it feeds is switched off by being multiplied by nothing.
  //
  // It is in this list rather than only in the Hycean presets because this list
  // is also the allowlist for the URL hash: a parameter missing from it is
  // silently dropped from a shared link, so a Hycean world sent to someone else
  // would arrive as a bare rock. (`tidalHeat` is missing from it and is dropped
  // exactly that way -- a real bug, older than this branch, left alone here
  // because fixing it is not this change.)
  h2Bar: 0,
  heliumFrac: 0.1,   // solar, by number -- the split only matters once h2Bar does
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
  // How the world ages, both off by default: most of what this model gets used
  // for is "what would this world do", not "what did it do".
  brightening: 0,          // fractional increase in starlight per Gyr
  realisticGeology: false, // let the interior run down its radiogenic curve
  startAge: 4.567,         // Gyr the planet has already lived through at t=0
  smoothInsolation: false, // walk to a new starlight value instead of jumping
  // Earth's field, relative to Earth's. What it buys is a magnetopause ten
  // radii out and a hundredth of the solar wind reaching the air; without one
  // the wind sputters the atmosphere away ion by ion, which is what happened to
  // Mars. Under realistic decay it goes out when the core stops convecting.
  magneticField: 1,
  // A resurfacing event, off unless placed: the age it happens at, how much it
  // multiplies volcanic outgassing by, and how long it lasts.
  resurfacingAge: 0, resurfacingBoost: 1, resurfacingSpan: 50,
  // Optional history constraints used by specific real-world presets. They are
  // inert everywhere else: secondary N2 released during a resurfacing event,
  // a hot-start inventory placed in steam rather than an ocean, a measured
  // escape-rate correction, and oxidation by a hot dry crust.
  resurfacingN2Bar: 0, startWithSteam: false, escapeScale: 1,
  xuvDecay: false,
  hotRockOxidation: 0,
};

// The modes that turn a preset from a snapshot into a history, switched on for
// every world in this file that actually exists. A real planet has a star that
// brightens and an interior that runs down, and the presets that claim to be
// real ought to say so without the player having to know which two boxes to
// tick. The invented worlds below keep them off: "what would this do" is a
// different question from "what did this do", and it is the one they are for.
//
// `brightening: 1` is the star's own Gough (1981) track rather than a flat rate,
// and every solar preset here carries a `startAge` consistent with its own
// insolation on that curve -- the Archean's 0.77 S(+) is the Sun at 1.15 Gyr,
// Noachian Mars's 0.32 is Mars at 0.6, Way's Early Venus is 2.9 Gya. Running
// them on the real curve is what makes those two facts agree: the Archean now
// reaches exactly 1.000 S(+) at the present day and Noachian Mars exactly the
// 0.431 Mars gets, where the old flat 10%/Gyr overshot both by 7-14%.
// Venus has no dynamo and it is not unprotected.
//
// An unmagnetised planet with a thick ionosphere induces a magnetosphere of its
// own: the solar wind's field piles up against the conducting upper atmosphere
// and is held off above the neutral gas. It is why Venus, with no dipole at all,
// still has three and a half bar of nitrogen after four and a half billion years
// while Mars, also with none, has six millibars of anything. `magneticField` is
// the only control this model has over how much wind reaches the air, so this is
// that shielding expressed through it -- 0.02 lets 12% of the wind through,
// about eightfold protection, which is the modest figure an induced
// magnetosphere earns rather than the hundredfold a dipole like Earth's does.
//
// It is not a fudge, and it is not the fix I wanted either. The physical version
// -- shielding as a function of atmospheric column, in windExposure() -- was
// written, tested and cannot ship, because it protects Mars too. Noachian Mars
// starts at 4 bar in this model and its entire fate rides on non-thermal escape,
// so ANY column-based shielding saves it:
//
//     shielding    Venus boils at   Mars CO2 today
//     none              never          9.4 mbar   <- Mars right, Venus dead
//     2x pTot           never       1519.3 mbar
//     4x pTot          3.83 Gyr     1514.0 mbar   <- Venus right, Mars 75x out
//
// There is no window. The real defect is upstream of both: this model's
// non-thermal escape is some thousands of times the rate MAVEN and Venus Express
// actually measure, because it has been asked to strip Mars's four bar single
// handed when the literature attributes only about half a bar to escape and the
// rest to carbonate. Until Mars's carbon has somewhere else to go, the rate
// cannot come down, and while it is that high only a per-world number can tell
// the two planets apart. Recorded here so the next person does not re-run the
// scan.
//
// What it buys, measured: Early Venus stays temperate 15-23 C from 1.67 Gyr,
// tips at an age of 3.82 Gyr -- Venus's global repaving is dated to 3.852 -- and
// settles at 91.5 bar against the 92 the planet actually has.
export const INDUCED_MAGNETOSPHERE = 0.02;

export const SOLAR_HISTORY = { brightening: 1, realisticGeology: true, xuvDecay: true };

// The three worlds around M dwarfs get no brightening at all, and that is the
// accurate choice rather than an omission. An M dwarf is essentially a constant
// star: the same curve gives TRAPPIST-1 a 1500 Gyr main sequence and 0.04%/Gyr,
// so leaving it on would be an honest nothing rather than a lie -- it is off
// because the XUV decline rides on that switch, and these presets carry
// measured XUV rather than a track.
//
// `realisticGeology` is now on here too, and what makes that correct is
// `tidalHeat`. Their interior heat is tidal, not radiogenic -- 2.68 W/m^2 on
// TRAPPIST-1b and 80 on GJ 1132 b come from an eccentricity held by resonance,
// which does not decay on a potassium-40 half-life -- so the decay is applied
// to the radiogenic part only and these worlds keep the flux they are measured
// to have. Before that split the whole switch had to be off, which also cost
// them the dynamo's decline for no reason.
// A red dwarf's luminosity really is flat over any run this model can show --
// TRAPPIST-1 has a 1500 Gyr main sequence -- so `brightening` stays off. Its
// ULTRAVIOLET is the opposite: these stars sit saturated for a billion years and
// more, and the spin-down out of that is most of what decides whether their
// planets keep an atmosphere. It is the one process on these worlds that
// everything else is scenery to, so it ships armed.
export const DWARF_HISTORY = { brightening: 0, realisticGeology: true, xuvDecay: true };
// Everything about these two worlds that its age does not change. Shared, so a
// planet and its own younger self cannot disagree about its mass, its orbit or
// its star -- the whole value of the pair is that the only differences between
// them are the ones six and a half billion years put there.
const T1B = { ...EARTH, ...DWARF_HISTORY,
  mass: 1.374, insolation: 4.153, starTemp: 2566, tidallyLocked: true,
  rotationHours: 36.3, obliquity: 0, landFraction: 1, o2Bar: 0, ch4Bar: 0, biosphere: 0,
  internalHeat: 2.68, tidalHeat: 2.68, outgassing: 1.5, xuvFraction: 7e-4,
  startAge: 7.6, landAlbedo: 0.12 };
const T1E = { ...EARTH, ...DWARF_HISTORY,
  mass: 0.692, insolation: 0.646, starTemp: 2566, tidallyLocked: true,
  rotationHours: 146.4, obliquity: 0, landFraction: 0.3, o2Bar: 0, ch4Bar: 0, biosphere: 0,
  internalHeat: 0.18, tidalHeat: 0.18, outgassing: 1.0, xuvFraction: 7e-4, startAge: 7.6 };

// What is left of a planet when almost nothing about Earth applies. A
// sub-Neptune has no continent to weather, no nitrogen, no oxygen, no biosphere
// and no fossil carbon, and the carbonate-silicate thermostat has no exposed
// silicate to work on -- so all of that is off rather than inherited and
// quietly doing something. What remains is water, hydrogen, a star and gravity.
//
// heliumFrac is solar, 10% of the envelope by pressure. Helium is about ten
// times weaker per collision than hydrogen, so it is a correction and not a
// mechanism; leaving it out would make these envelopes purer than any envelope
// that ever formed.
//
// brightening is off so that a world set up to show hysteresis is not also
// being driven by its star while you watch. Turn it on deliberately.
const HYCEAN = { ...EARTH, heliumFrac: 0.1, landFraction: 0,
  co2Bar: 0, ch4Bar: 0, o2Bar: 0, n2Bar: 0, biosphere: 0, life: false,
  emissions: 0, fossilUsed: 0, brightening: 0, realisticGeology: false };

// TRAPPIST-1 is not 4.567 Gyr old. Burgasser & Mamajek (2017) put the system at
// 7.6 +/- 2.2 Gyr, and the default start age was simply the solar system's --
// which for a star still observed X-ray active matters, because where it sits
// on its own spin-down curve is the whole question. Both TRAPPIST planets are
// 100% tidally heated, so moving their age does not touch their interiors.

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
  earth:   { name: 'Earth', icon: '🌍', params: { ...EARTH, ...SOLAR_HISTORY, emissions: 1, fossilUsed: 0.098 } },
  // The Moon is locked to Earth, not to the Sun. `tidallyLocked` therefore stays
  // off: in this model that switch means one face permanently sees the star.
  // Its 655.7-hour sidereal rotation still gives it the real lunar day. With no
  // atmosphere, ocean, biosphere or active carbon volcanism, the preset is the
  // present airless Moon rather than an invented terraforming starting point.
  moon: { name: 'Moon', icon: '🌕', params: { ...EARTH, ...SOLAR_HISTORY,
    mass: 0.0123, landFraction: 1, water: 0, insolation: 1,
    rotationHours: 655.72, tidallyLocked: false, obliquity: 6.68,
    n2Bar: 0, o2Bar: 0, co2Bar: 0, ch4Bar: 0, biosphere: 0,
    emissions: 0, fossilUsed: 0, outgassing: 0, internalHeat: 0.011,
    landAlbedo: 0.12, startT: 220, startAge: 4.51, magneticField: 0 } },
  // Needham & Kring (2017): mare volcanism around 3.5 Ga briefly supported a
  // roughly 1 kPa atmosphere, dominated by CO and sulfur with water third.
  // This model has no CO/S reservoirs, so radiatively weak N2 is the explicit
  // proxy for that background gas. 1.5e-7 Earth oceans is inside their total
  // vented-water range (0.36-1.86e-7 EO). Their escape calculation gives a
  // roughly 70 Myr lifetime; escapeScale corrects the generic N2/CO2 law for
  // this composition rather than pretending the proxy is chemically nitrogen.
  earlyMoon: { name: 'Ancient Moon', icon: '🌒', params: { ...EARTH, ...SOLAR_HISTORY,
    mass: 0.0123, landFraction: 1, water: 1.5e-7, insolation: 0.765376,
    rotationHours: 655.72, tidallyLocked: false, obliquity: 6.68,
    n2Bar: 0.01, o2Bar: 0, co2Bar: 0, ch4Bar: 0, biosphere: 0,
    emissions: 0, fossilUsed: 0, outgassing: 0, internalHeat: 0.03,
    landAlbedo: 0.12, startT: 250, startAge: 1.067, magneticField: 0,
    xuvFraction: 3.4e-6 * 5.98004, escapeScale: 0.01 } },
  preindustrial: { name: 'Pre-Industrial Earth', icon: '🏞️', params: { ...PREINDUSTRIAL, ...SOLAR_HISTORY } },
  // Earth's physics without Earth's biography: no industry, no real coastlines,
  // and a fresh set of continents every time you load it. For trying something
  // out without the answer being about this planet in particular. Emissions are
  // still there if you want them -- the control does not go away, it just starts
  // at nothing.
  earthlike: { name: 'Earth-like', icon: '🌐', params: { ...PREINDUSTRIAL, co2Bar: 280e-6, emissions: 0, fossilUsed: 0 } },
  // Basin geometry is 0.8 rather than 1, and it is not what makes this world dry
  // -- `water: 0` does that, and the coverage is derived from the water there
  // actually is. What 1 did was make Venus *permanently* dry: `floodedFraction`
  // multiplies by (1 - landFraction), so a world with no basins has no sea at
  // any inventory, and cooling this planet and pouring an ocean onto it left a
  // bare ball reading "Temperate & Habitable". 0.8 is the real hypsometry:
  // about a fifth of Venus is lowland plain -- Atalanta, Lavinia, Guinevere --
  // and that is where an ocean would go.
  venus:   { name: 'Venus', icon: '🌋', params: { ...EARTH, ...SOLAR_HISTORY, magneticField: INDUCED_MAGNETOSPHERE, o2Bar: 0, biosphere: 0, internalHeat: 0.031, mass: 0.815, insolation: 1.91, water: 0.0, landFraction: 0.8, n2Bar: 3.5, co2Bar: 88, rotationHours: 5832, outgassing: 1.2, landAlbedo: 0.15, startT: 700 } },
  mars:    { name: 'Mars', icon: '🔴', params: { ...EARTH, ...SOLAR_HISTORY, magneticField: 0, o2Bar: 0, biosphere: 0, internalHeat: 0.02, mass: 0.107, insolation: 0.43, water: 0.02, landFraction: 0.95, n2Bar: 0.0002, co2Bar: 0.006, rotationHours: 24.6, outgassing: 0.2, landAlbedo: 0.25, startT: 215 } },
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
  // The day was thirteen hours long. The Moon was closer and the tides that
  // have been slowing the spin ever since had had a billion years rather than
  // four and a half to work -- tidal-rhythmite and cyclostratigraphic estimates
  // put the Archean day between twelve and sixteen hours (Williams 2000;
  // Mitchell & Kirscher 2023). It is not a large climatic lever at this end of
  // the range: the cloud deck that makes slow rotation matter needs hundreds of
  // hours, not tens. It is here because it is true.
  earlyEarth: { name: 'Archean', icon: '🌊', params: { ...EARTH, ...SOLAR_HISTORY, startAge: 1.15, o2Bar: 0, biosphere: 0.2, insolation: 0.77, landFraction: 0.1, co2Bar: 0.10, ch4Bar: 1e-3, rotationHours: 13, startT: 290 } },
  // Venus with an ocean on it, as Way et al. (2016) modelled it in ROCKE-3D:
  // a 1 bar nitrogen atmosphere with Earth's CO2 and methane, the 310 m ocean
  // that Magellan's topography holds if you fill the lowlands, and the 2.9 Gya
  // Sun -- which at Venus's orbit is still 40% more sunlight than Earth gets
  // today. Their answer was 11 C, and the reason is the rotation: 243 days is
  // slow enough that convection parks over the substellar point and grows a
  // dayside cloud deck that reflects most of it straight back. Spin the same
  // planet up to a 16-day day and it is 45 K hotter.
  //
  // Whether Venus ever actually did this is a live argument and this preset
  // takes no side in it. Constantinou, Shorttle & Rimmer (2024) infer from what
  // its volcanoes have to be resupplying that the interior is dry -- at most 6%
  // water in the magma -- which points to a Venus that never condensed an ocean
  // at all. That is a question about how much water the planet started with,
  // which is the `water` control here: wind it to zero and this becomes the
  // Venus next door. The rotation physics is the same either way.
  //
  // The 310 m is kept as the water inventory rather than as a coastline, but the
  // land fraction is then set to make the *coverage* come out right too, and
  // that turned out to matter more than it looks. Venus's lowlands are broad and
  // flat and hold that depth over about 60% of the planet; this model floods
  // Earth-shaped basins, which at a land fraction of 0.40 gave 34% coverage and
  // an equilibrium of 5.6 C. At 0.10 it floods 52% and settles at 10 C, which is
  // Way's answer. Coverage is what sets how much vapour a shallow ocean can put
  // in the air, and on a world this marginal that is six kelvin.
  //
  // What it does not fix: left alone at fixed sunlight this world still cools
  // over the following billion years and ices over, because the sea is small
  // enough that the ice-albedo feedback beats the carbonate thermostat -- CO2
  // climbs a hundredfold on the way down and the world gets colder anyway, since
  // what it is losing is water vapour, not carbon. Way et al. ran Sim A for
  // thousands of years, not billions, so this is not a disagreement with them so
  // much as a question they did not ask. With the solar brightening on, which is
  // now the default here, it comes back out of it.
  earlyVenus: { name: 'Early Venus', icon: '🌤️', params: { ...EARTH, ...SOLAR_HISTORY, mass: 0.815, magneticField: INDUCED_MAGNETOSPHERE,
    // 1.524 rather than Way's 1.40, and for the same reason the Archean and
    // Noachian Mars carry the numbers they do: a world that starts at an age of
    // 1.67 Gyr and runs to the present has to ARRIVE at the insolation its
    // planet actually gets. Venus gets 1.911 S(+); the Sun at 1.67 Gyr was at
    // 79.8% of today on Gough's track; 1.911 x 0.798 is 1.524. Way's figure
    // comes off a different solar model, and taking it literally left this
    // world 8% short of Venus at the end of its own run -- which showed up as a
    // planet forty degrees too cool under half the pressure.
    insolation: 1.524, rotationHours: 5832, obliquity: 2.6, o2Bar: 0, biosphere: 0,
    n2Bar: 1.0126, co2Bar: 400e-6, ch4Bar: 1e-6, water: 0.108, landFraction: 0.10,
    landAlbedo: 0.2, outgassing: 1, internalHeat: 0.031, startT: 288,
    // Way's Sim A is 2.9 Gya, so the planet is 4.567 - 2.9 Gyr old here.
    startAge: 1.67,
    // And the resurfacing is armed, because it happened. 2.182 Gyr after this
    // world starts is an age of 3.852 -- 715 Myr ago, which is what Venus's
    // crater population dates its global repaving to -- and 66x is what it
    // takes to put its ninety-two bar into the air out of this planet's own
    // mantle. The run ends at 737.7 K under 92.0 bar with no water left in it,
    // against the 737.2 K and 92 bar Venus has. Way's argument is that this, and not the Sun, is what ended
    // Venus: brightening alone leaves the model's Venus habitable for billions
    // of years too long, which is the same answer his GCM gives. Untick
    // "resurfacing event" to watch that counterfactual.
    resurfacingAge: 2.182, resurfacingBoost: 66, resurfacingSpan: 40,
    resurfacingN2Bar: 2.65, hotRockOxidation: 1,
    // Same again: 3.45x today's XUV at an age of 1.67 Gyr.
    xuvFraction: 3.4e-6 * 3.45 } },
  // The alternative hot-start Venus. Turbet et al. (2021) found that water
  // vapour heated on the dayside condenses preferentially into nightside
  // clouds whose net greenhouse prevents an initially steamy Venus from ever
  // reaching ocean condensation, even under the faint young Sun. Constantinou
  // et al. (2024) independently constrain the later volcanic gas to at most 6%
  // H2O, consistent with a mantle left dry after an approximately 100 Myr magma
  // ocean. We therefore begin immediately after that epoch with <0.1 EO as
  // steam, never seed a surface ocean, and let escape plus dry volcanism carry
  // the same planet to modern Venus. This is a scenario-level representation,
  // not a replacement for Turbet's 3-D cloud circulation.
  dryVenus: { name: 'Never-Wet Venus', icon: '☁️', params: { ...EARTH, ...SOLAR_HISTORY,
    mass: 0.815, magneticField: INDUCED_MAGNETOSPHERE,
    insolation: 1.37359, rotationHours: 5832, obliquity: 2.6,
    n2Bar: 1.0, o2Bar: 0, co2Bar: 0.01, ch4Bar: 0, water: 0.06,
    landFraction: 0.8, landAlbedo: 0.135, biosphere: 0,
    emissions: 0, fossilUsed: 0, outgassing: 0.371, internalHeat: 0.12,
    startT: 650, startAge: 0.1, startWithSteam: true,
    resurfacingAge: 3.752, resurfacingBoost: 70, resurfacingSpan: 40,
    resurfacingN2Bar: 3.32, hotRockOxidation: 1,
    xuvFraction: 3.4e-6 * 109.988 } },
  // Mars in the Noachian, when the valley networks were being cut. The Sun was
  // at 75% of today's, so this world gets less than a third of Earth's light,
  // and warming it is the oldest unsolved problem in the subject: CO2 alone
  // cannot do it at any pressure, because past a few bar the Rayleigh
  // scattering wins and it condenses besides (Kasting 1991).
  //
  // What is here is 4 bar of CO2 and 10 mbar of methane, and the methane is
  // standing in for the collision-induced absorption of CO2 with hydrogen that
  // Ramirez et al. (2014) need -- a few percent H2 from a reduced mantle, which
  // this model has no hydrogen to represent. So read this as "Mars with enough
  // greenhouse, however it got it" rather than as a claim about which gas did
  // it. Turn the CO2 down to a bar and watch it freeze, which is the honest
  // difficulty of the real problem.
  earlyMars: { name: 'Noachian Mars', icon: '🟠', params: { ...EARTH, ...SOLAR_HISTORY, mass: 0.107,
    insolation: 0.32, rotationHours: 24.6, obliquity: 25, o2Bar: 0, biosphere: 0,
    n2Bar: 0.3, co2Bar: 4, ch4Bar: 0.01, water: 0.06, landFraction: 0.70,
    // Outgassing is pinned by where this run ENDS rather than picked for where
    // it starts: 0.14 of Earth's carries four bar of Noachian CO2 down to 5.8
    // mbar at the present day, against the 6.0 mbar Mars has. 0.2 left it at
    // 11 and the planet finished twice as thick as the one out there.
    landAlbedo: 0.22, outgassing: 0.14, internalHeat: 0.06, startT: 280, magneticField: 0,
    // The Sun at 0.6 Gyr was about twelve times as harsh in the extreme
    // ultraviolet as it is now (Ribas et al. 2005). A preset that starts in the
    // deep past has to carry the star of that epoch, not this one's.
    xuvFraction: 3.4e-6 * 12.1,
    // The Noachian runs 4.1-3.7 Gya, so Mars is about half a billion years old.
    startAge: 0.6 } },
  snowball:{ name: 'Snowball', icon: '❄️', params: { ...EARTH, co2Bar: 1e-5, startT: 230 } },
  dune:    { name: 'Dune World', icon: '🏜️', params: { ...EARTH, water: 0.03, landFraction: 0.98, insolation: 1.25, landAlbedo: 0.30, startT: 300 } },
  eyeball: { name: 'Locked Eyeball', icon: '👁️', params: { ...EARTH, mass: 1.3, insolation: 0.9, tidallyLocked: true, rotationHours: 264, landFraction: 0.25, xuvFraction: 5e-4, startT: 270 } },
  waterworld: { name: 'Waterworld', icon: '💧', params: { ...EARTH, mass: 1.6, water: 6, landFraction: 0.0, insolation: 1.0, startT: 290 } },
  titan:   { name: 'Titan-like', icon: '🟤', params: { ...EARTH, realisticGeology: true, o2Bar: 0, biosphere: 0, mass: 0.15, insolation: 0.011, water: 0.5, landFraction: 0.6, n2Bar: 1.5, ch4Bar: 0.05, co2Bar: 1e-6, outgassing: 0.1, startT: 95 } },

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
  trappist1b: { name: 'TRAPPIST-1b', icon: '🔥', params: { ...T1B, water: 0,
    n2Bar: 1e-4, co2Bar: 1e-5, startT: 500 } },

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
  // Three Earth oceans, and almost no air above them.
  //
  // This preset used to carry a bar of CO2 over a bar of N2, and said of itself
  // that it was a plausible configuration rather than a measured one -- nothing
  // is known about this planet's atmosphere. What it did not say is that this
  // model does not let it keep that: press play and it collapsed to 0.08 bar
  // inside a hundred million years, every time. A preset whose first act is to
  // abandon its own configuration is not a snapshot of a world, it is a
  // starting gun.
  //
  // So it starts where it ends up. The night side of a locked world at 0.646
  // S(+) is a cold trap the CO2 cannot climb back out of, and the nitrogen goes
  // to space under 206x solar XUV held for the star's whole life -- a hundred
  // bar goes the same way as one, because the loss is a flux and does not care
  // how much there is to lose. What is left is a Partial Nightside Freeze-Out,
  // and that state is defined by still having a sea: 0.6 Earth oceans of liquid
  // water under a day side at 55 C, ninety percent of the surface flooded, and
  // four bar of dry ice lying on the hemisphere that never sees the star.
  //
  // Less Earth-like than the bar of CO2 it replaces, and more defensible: it is
  // stable for a billion years rather than a hundred million, and it is where
  // TRAPPIST-1e · 1 Gyr actually arrives.
  trappist1e: { name: 'TRAPPIST-1e', icon: '🌍', params: { ...T1E, water: 3.0,
    n2Bar: 0, co2Bar: 0.05, startT: 280 } },

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
  // TRAPPIST-1 at 1 Gyr, which is the age its planets had just settled onto the
  // main sequence and the age the interesting part of their story starts at.
  //
  // The star does not change over the run and that is the point: an M8 is
  // saturated to about 9 Gyr, so these worlds spend their ENTIRE lives under an
  // ultraviolet flux two hundred times the Sun's, with no let-up to wait for.
  // That is what the presets are for -- the loss is not a phase they come out
  // of, it is the whole biography.
  //
  // Run either of them forward 6.6 Gyr and it arrives at its own present-day
  // preset. 1b arrives exactly: five Earth oceans and twenty bar of CO2 are
  // stripped to nothing and it ends airless, which is what JWST finds and what
  // Bolmont et al. (2017) predicted from the XUV history. Eight oceans is a
  // different world -- it never loses the last of them and stays in a wet
  // runaway -- so the inventory here is on the side of that fork that matches
  // the planet we can see.
  earlyTrappist1b: { name: 'TRAPPIST-1b · 1 Gyr', icon: '🌫️', params: { ...T1B,
    startAge: 1.0, water: 5, n2Bar: 2, co2Bar: 20, startT: 700 } },

  // 1e arrives too, and what it arrives at is a planet with a sea and hardly
  // any air above it.
  //
  // Three oceans, a bar of nitrogen and two of CO2 at 1 Gyr. The nitrogen goes
  // to space -- 206x solar XUV held for the star's whole life, and the loss is
  // a flux, so a hundred bar would go the same way as one -- and once the air
  // is thin enough to stop carrying heat across, the CO2 snows out onto the
  // hemisphere that never sees the star and cannot climb back. Four bar of dry
  // ice lies there at the end.
  //
  // What does NOT go is the ocean. The day side sits at 55 C under 0.07 bar,
  // ninety percent of the surface is flooded, and six tenths of an Earth ocean
  // is liquid. That is the whole difference between a Partial Nightside
  // Freeze-Out and a complete one, and it is why the present-day preset was
  // rewritten to match rather than the young one tuned to reach the old one:
  // this is a world with liquid water on it, which is the thing worth being
  // right about.
  earlyTrappist1e: { name: 'TRAPPIST-1e · 1 Gyr', icon: '🌊', params: { ...T1E,
    startAge: 1.0, water: 3, n2Bar: 1.0, co2Bar: 2.0, startT: 285 } },

  gj1132b: { name: 'GJ 1132 b', icon: '🌋', params: { ...EARTH, ...DWARF_HISTORY,
    mass: 1.66, insolation: 18.8, starTemp: 3270, tidallyLocked: true,
    rotationHours: 39.1, obliquity: 0, water: 0, landFraction: 1,
    n2Bar: 0.01, o2Bar: 0, co2Bar: 0.1, ch4Bar: 0, biosphere: 0,
    internalHeat: 80, tidalHeat: 80, outgassing: 1, xuvFraction: 2e-4,
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
  // Earth's own interior, a billion years further down its curve -- so this one
  // needs `startAge` as well as the switch, or it would run the decay from today
  // rather than from where this world already is. Brightening stays off: the
  // 1.09 is the Gough value at 5.567 Gyr and is the point of the preset.
  futureEarth: { name: 'Earth +1 Gyr', icon: '☀️', params: { ...EARTH, realisticGeology: true,
    startAge: 5.567, insolation: 1.09, startT: 292 } },

  // ---- two hot oceans and one that does not stay one ----------------------
  //
  // A pair, and the pair is the point: these two worlds sit at the SAME
  // temperature and have nothing else in common. One is hot because of what is
  // in its air, the other because of how much light falls on it, and the
  // carbonate-silicate thermostat is what makes them opposites rather than
  // variations. A world heated from outside weathers faster the hotter it gets,
  // so it strips its own greenhouse away and bakes anyway; a world heated from
  // inside has to keep erupting the greenhouse back or it cools.
  //
  //   heated by      starlight   volcanism   equilibrium CO2   surface
  //   its air        1.000 S(+)   4.5x        0.091 bar        49.5 C
  //   its star       1.256 S(+)     0x        ~0 ppm           49.0 C
  //
  // Half a degree apart and effectively all the carbon on the first. Both
  // measured at 100 Myr with the imbalance at -0.01 and -0.15 W/m2, so both are
  // settled rather than passing through.
  //
  // Neither has a biosphere, and that is a modelling choice rather than a claim
  // that nothing could live at 37 C: photosynthesis would put methane and oxygen
  // into both of these atmospheres and the comparison is about carbon dioxide.
  hotCarbon: { name: 'Hot Ocean · CO₂', icon: '♨️', params: { ...EARTH, realisticGeology: true,
    // With no continents, seafloor weathering is the only carbon thermostat.
    // Four and a half times Earth's volcanism holds this global ocean near
    // 50 C without exhausting the finite mantle reservoir over the test run.
    insolation: 1.0, outgassing: 4.5, co2Bar: 0.091, biosphere: 0,
    water: 1, landFraction: 0, emissions: 0, fossilUsed: 0, startT: 322.6 } },

  // The same temperature from the other direction, and the giveaway is the air:
  // essentially no CO2 at all.
  // Weathering runs away with the carbon on a world this warm, and the planet
  // stays hot regardless, because the starlight was never the thermostat's to
  // control. Being on the hot branch is what makes it stable rather than a stop
  // on the way to a runaway -- see "The Hot Ocean" scenario, which is about
  // walking a world onto this branch rather than being handed one.
  hotStar: { name: 'Hot Ocean · Starlight', icon: '🔆', params: { ...EARTH, realisticGeology: true,
    insolation: 1.256, outgassing: 0, co2Bar: 1e-7, biosphere: 0,
    water: 1, landFraction: 0, emissions: 0, fossilUsed: 0, startT: 322.1 } },

  // And the same world with the star turned up until there is no equilibrium
  // left. The edge is at ONE PART IN THIRTEEN HUNDRED: at 1.338 S(+) this planet
  // holds a 47.2 C ocean for a hundred million years; at 1.339 it loses the
  // whole ocean in 13,400 years and ends at 603 C under a steam atmosphere.
  //
  // It is worth watching rather than reading, because for its first millennium
  // it looks like the two above -- a warm sea, no ice, nothing obviously wrong.
  // Absorbed sunlight is simply past what the atmosphere can radiate at any
  // temperature (the Simpson-Nakajima limit, 282 W/m2, which this model
  // reproduces rather than imposes), so every kelvin evaporates more ocean,
  // which absorbs more, and the only stopping point is an empty sea bed. Latent
  // heat is why it takes thousands of years instead of happening at once: the
  // 6.6e12 J/m2 needed to boil an ocean divided by the net flux.
  //
  // Turn the ease switch on and slow the clock, or it is over between two frames
  // at anything above 10 kyr/s.
  brink: { name: 'Over the Edge', icon: '🌡️', params: { ...EARTH, realisticGeology: true,
    insolation: 1.339, outgassing: 1, co2Bar: 1.2e-6, biosphere: 0,
    emissions: 0, fossilUsed: 0, startT: 313.5 } },

  // ---- worlds made of water ------------------------------------------------
  //
  // Sub-Neptunes: a rock core under thousands of Earth oceans under tens of bar
  // of hydrogen the planet kept from the disc it formed in. Nothing above this
  // line can be one, because nothing above this line has a hydrogen envelope.
  //
  // A shared base rather than EARTH, because almost nothing about Earth applies.
  // There is no continent to weather, no nitrogen, no oxygen, no biosphere and
  // no fossil carbon; the carbonate-silicate thermostat has no silicate surface
  // to work on. What is left is water, hydrogen, a star and gravity.
  //
  // heliumFrac is solar: 10% of the envelope by pressure. It is a correction and
  // not a mechanism -- helium is about ten times weaker per collision than
  // hydrogen -- but leaving it out would make these envelopes purer than any
  // envelope that ever formed.

  // The state the model actually holds, and the whole Hycean argument in one
  // preset: twenty bar of hydrogen at a TENTH of Earth's sunlight settles at
  // 61 C, with five hundred oceans of liquid water 262 km deep standing on
  // ice VII. A rocky planet out here would be a snowball. This one is habitable
  // and its sea is warm enough to swim in, if you could breathe hydrogen.
  //
  // Five hundred oceans rather than sixty because sixty bottoms out on ROCK at
  // 41 km, and an ocean standing on rock is a deep ocean rather than a Hycean
  // one -- the high-pressure ice floor is part of what the word means, and a
  // preset whose readout contradicts its own state text is worse than no preset.
  //
  // The warm Hycean of the literature -- Madhusudhan's 350-550 K band -- is NOT
  // reached, and the absence is honest rather than an oversight: this model runs
  // away before it gets there. 335 K is as far as it goes. See the Hycean World
  // state text and the GAP row in tools/calibrate.mjs.
  hycean: { name: 'Hycean World', icon: '🌊', params: { ...HYCEAN,
    mass: 10, water: 500, h2Bar: 20, insolation: 0.10, startT: 300 } },

  // The same idea with the star removed altogether. Sixty bar of hydrogen over a
  // warm interior holds a 68 C ocean, 376 km deep on ice VII, at five
  // ten-thousandths of Earth's sunlight -- which is to say, in the dark. The
  // free-floating case, and the reason the state is tested on the star being
  // negligible rather than on the temperature: the temperature is the result,
  // and it is the absent star that makes it worth a name. "Cold" is about the
  // sky, not the sea.
  coldHycean: { name: 'Cold Hycean World', icon: '🌑', params: { ...HYCEAN,
    mass: 5, water: 500, h2Bar: 60, insolation: 0.0005, internalHeat: 2, startT: 290 } },

  // ---- the same planet twice, and only history between them ----------------
  //
  // These two are identical in every parameter except the temperature they are
  // built at, and they settle into different worlds and stay there. That is
  // Pierrehumbert & Furth 2023's cold start against their hot start, and it is
  // an equilibrium rather than a transient: both close their energy budgets to
  // a hundredth of a watt and neither is going anywhere.
  //
  // What carries the memory is w.hotLayer -- how much of the water has joined
  // the atmospheric column -- which is seeded on the first step from the world's
  // own starting temperature. A world built at 900 K has been supercritical
  // since before the clock started and has no cold interior to eat through. A
  // world built at 290 K has to earn every metre of it, against a stable
  // buoyancy gradient, and at this distance from the star it never gets the
  // chance.

  // Built hot: no surface anywhere, the atmospheric adiabat running seamlessly
  // into the interior, 1073 C and settled.
  superRunaway: { name: 'Super-Runaway Waterworld', icon: '🟣', params: { ...HYCEAN,
    mass: 10, water: 60, h2Bar: 20, insolation: 0.03, startT: 900 } },

  // Built cold: the same star, the same sixty oceans, the same twenty bar of
  // hydrogen -- and a snowball at -62 C. Turn `Stellar brightening` on and it
  // will eventually be driven across; the point of watching is how long the hot
  // layer takes to eat down through water that is not helping it.
  coldStart: { name: 'Cold-Start Waterworld', icon: '❄️', params: { ...HYCEAN,
    mass: 10, water: 60, h2Bar: 20, insolation: 0.03, startT: 290 } },
};
