import { NBANDS, X, lockFactor } from './climate.js';
import { iceFraction } from './radiation.js';
import { clamp, T_CRIT_H2O as T_CRIT } from './constants.js';

// Every state the game can recognise, with the real science behind it.
export const STATES = {
  magma:      { name: 'Magma Ocean',          color: '#ff5a2b', blurb: 'The surface is molten rock. Above roughly 1400 K silicates melt and the planet radiates in the near-infrared; any atmosphere is a hot rock-vapour and steam envelope.' },
  dryRunaway: { name: 'Dry Runaway Greenhouse', color: '#e0553a', blurb: 'Venus. The ocean is gone — evaporated, photolysed, and the hydrogen dragged off to space — leaving a thick dry CO2 atmosphere and a surface hot enough to glow faintly. Irreversible on any human timescale.' },
  wetRunaway: { name: 'Wet Runaway Greenhouse', color: '#ff8340', blurb: 'Absorbed sunlight plus the planet\u2019s own internal heat exceeds the Simpson\u2013Nakajima limit (~282 W/m2), so no equilibrium exists at any temperature. Tidal heating alone can do it, on a world the star would have left habitable (Barnes et al. 2013). The ocean is boiling into a massive steam atmosphere; latent heat makes this transient take ~10^5 years, and losing the water takes 10^8–10^9 more.' },
  moist:      { name: 'Moist Greenhouse',     color: '#ffb03a', blurb: 'Still liquid, but the cold trap has failed: stratospheric water exceeds a mixing ratio of 10^-3, so hydrogen escapes steadily. Habitable in the short run, drying out over hundreds of millions of years (Kasting 1988).' },
  hothouse:   { name: 'Ice-Free Hothouse',    color: '#f2c14e', blurb: 'No permanent ice anywhere, tropics near the limit of complex life. Earth looked like this in the Cretaceous and the PETM.' },
  temperate:  { name: 'Temperate & Habitable', color: '#4ec98a', blurb: 'Liquid water across much of the surface with stable polar ice. The carbonate–silicate thermostat holds this state against slow changes in starlight over ~1 Myr.' },
  dune:       { name: 'Dune / Desert World',  color: '#d9a441', blurb: 'A land planet with little surface water. Unsaturated air lets the tropics radiate above the classical runaway limit, and a dry stratosphere throttles water loss — so desert worlds stay habitable much closer to their star than ocean worlds (Abe et al. 2011).' },
  waterworld: { name: 'Waterworld',           color: '#2f8fd6', blurb: 'A global ocean with no exposed land. Continental weathering is shut off, but seawater still circulates through fresh basalt at the ridges and lays carbon down there, so the thermostat survives — weaker, slower, and settling at a warmer, more carbon-rich equilibrium than a world with continents would.' },
  eyeball:    { name: 'Eyeball World',        color: '#5fb8e8', blurb: 'Tidally locked, with a sunlit ocean under the star and permanent ice everywhere else. The thick substellar cloud deck reflects so much light that these worlds stay habitable out to nearly twice Earth’s insolation (Yang et al. 2014).' },
  lobster:    { name: 'Lobster State',        color: '#7fd0e8', blurb: 'An eyeball whose open water has been stretched along the equator by ocean heat transport, leaving warm claws reaching around toward the night side.' },
  twilight:   { name: 'Twilight World',          color: '#b98ad6', blurb: 'The eye is scorching, the night side is glacial, and between them a temperate ring of liquid water follows the terminator all the way round the planet. It works only because there is too little water to move the heat: a wetter world would carry enough latent heat away from the substellar point to even the temperatures out, and would then cross the runaway limit as a whole planet instead of leaving a habitable band behind (Lobo et al. 2023).' },
  trapped:    { name: 'Nightside-Trapped Desert', color: '#9aa7c9', blurb: 'On a locked world the night side is a permanent cold trap. Every drop of water has migrated there as glacier ice, leaving a bone-dry sunlit desert that cannot recover it.' },
  waterbelt:  { name: 'Waterbelt / Slushball', color: '#8fd8d0', blurb: 'Ice reaches deep into the tropics but a narrow band of open equatorial ocean survives. A genuine stable state, and a far softer landing than a hard snowball.' },
  snowball:   { name: 'Hard Snowball',        color: '#cfe8f5', blurb: 'Runaway ice–albedo feedback has frozen the planet pole to pole. Weathering stops, so volcanic CO2 accumulates unopposed for 5–50 Myr until 0.1–0.3 bar finally breaks the ice.' },
  marslike:   { name: 'Mars-Like Collapse',   color: '#c1785a', blurb: 'The air itself has frozen onto the ground. Below the CO2 frost point the atmosphere condenses onto the winter pole faster than volcanoes can resupply it, and the pressure falls until what is left is in equilibrium with the caps. It is escapable: enough outgassing thickens the air, warms the poles above the frost point and puts the atmosphere back where it belongs.' },
  nightfrost: { name: 'Partial Nightside Freeze-Out', color: '#8c6fa8', blurb: 'The atmosphere is snowing out onto the dark side. A tidally locked world has a hemisphere that never sees its star, and if that face falls below the CO2 frost point the air condenses there permanently — no season ever brings it back, which is exactly what separates this from a Mars. The pressure falls until what is left balances against the night-side deposit, and the day side is still warm, wet and habitable while it happens: this is a planet with a working ocean under its sun and its atmosphere quietly draining away behind it. That sea is part of the state rather than a likely accompaniment to it — when the last of it goes the freeze-out is complete, and the world is a Nightside Freeze-Out. What stops it is heat transport. Thick enough air carries enough warmth to the night side to hold it above the frost point, so the collapse is self-limiting on a massive atmosphere and a trap for a thin one (Joshi et al. 1997; Wordsworth 2015; Turbet et al. 2018 for the TRAPPIST-1 planets).' },
  nightfrozen:{ name: 'Nightside Freeze-Out', color: '#6f6a8f', blurb: 'The collapse has finished. Most of the atmosphere is lying on the hemisphere that never sees the star as dry ice, and what water the planet has is frozen beside it — so there is no liquid water anywhere, and the day side is a bare desert under whatever thin remnant of air is left. It is the end state of a Partial Nightside Freeze-Out rather than a different mechanism, and the difference between the two is the sea: while there is one, the world is habitable and quietly losing its air behind it; once it is gone, there is nothing left to lose. Distinct from a Nightside-Trapped Desert, where the air is intact and only the water has migrated.' },
  titan:      { name: 'Titan-Like',         color: '#c9a86a', blurb: 'A frigid world under a thick nitrogen–methane haze, far too cold for liquid water but warm enough for other liquids to run on the surface.' },
  frozen:     { name: 'Frozen Desert',        color: '#a8b8c8', blurb: 'Cold, dry and still. Not enough water for a true snowball and not enough greenhouse to thaw.' },
  thincold:   { name: 'Thin Cold Desert',     color: '#b08a6e', blurb: 'A thin, frigid, desiccated atmosphere over bare ground — Mars today. The air has not collapsed: it is simply all there is. Turn up the volcanoes and it will thicken, warm, and eventually hold liquid water again.' },
  baked:      { name: 'Baked Desert',         color: '#e08a3a', blurb: 'A hot, waterless world of bare rock. Whatever water it had is long gone, so nothing moderates the surface and the day side simply bakes.' },
  hycean:     { name: 'Hycean World',          color: '#3fbfa8', blurb: 'A water-rich sub-Neptune under a hydrogen envelope, with a liquid ocean at the bottom of it \u2014 tens of kilometres deep, standing on high-pressure ice rather than rock. The envelope keeps the surface warm far outside a rocky planet\u2019s habitable zone: the worlds here sit at about a tenth of Earth\u2019s sunlight and are still temperate (Madhusudhan et al. 2021). What the literature also claims, and this model does not produce, is the hot end of the band \u2014 a stable ocean at 400 to 550 K. Here the hottest Hycean that survives two million years is 299 K and anything warmer runs away instead, because the stabiliser that holds the hot branch up is vertical structure a semi-grey scheme has nowhere to put. So this is the temperate Hycean, said plainly \u2014 and the reading of any real planet as Hycean at all is contested.' },
  coldHycean: { name: 'Cold Hycean World',     color: '#4a7fb5', blurb: 'A Hycean world with effectively no starlight, holding a liquid ocean on its own internal heat under a deep hydrogen envelope. It needs the envelope to be thick: at these temperatures the greenhouse is doing all the work, and the ocean is liquid because of the pressure over it rather than because of anything the star does. The free-floating and far-orbit version of the state.' },
  supercriticalEnvelope: { name: 'Supercritical Envelope', color: '#a05fc0', blurb: 'Past the critical point there is no surface. The liquid and the vapour are one fluid, the atmospheric adiabat runs seamlessly into the supercritical water adiabat and down into the interior, and there is no boundary anywhere to call an ocean (Pierrehumbert & Furth 2023). Which planet you get depends on the path: a world that was always hot equilibrates like this, while one that cooled first and was heated later spends a long time as a hot layer sitting on cold water before it becomes this.' },
  airless:    { name: 'Airless Rock',         color: '#8a8a8a', blurb: 'Beyond the cosmic shoreline: stellar XUV has stripped the atmosphere faster than the planet’s gravity could hold it. No climate to speak of.' },
};

export function classify(w) {
  const dg = w.diag, p = w.params;
  const lam = lockFactor(p);
  const T = dg.Tmean, ice = dg.iceMean;
  const water = dg.totalWater;
  const initialWater = w.waterInitial ?? p.water;
  const esc = w.escape ?? { fStrat: 0, water: 0 };
  const lossPerGyr = (esc.water ?? 0) * 1e9 / dg.d.eoColumn;
  const pTot = dg.pTotMean;

  // substellar / equatorial band temperatures (top of the x grid)
  let Tsub = 0, Tanti = 0;
  for (let i = 0; i < 4; i++) { Tanti += w.T[i] / 4; Tsub += w.T[NBANDS - 1 - i] / 4; }
  // Warm enough under the star for liquid water -- which is a question about
  // temperature, and says nothing about whether there is any water there.
  const warmSub = 1 - iceFraction(Tsub);
  // Where the planet's water actually is. On a locked world the night side is a
  // permanent cold trap, so water migrates there as glacier ice and never comes
  // back: the inventory is intact, but none of it is liquid and none of it is
  // in a basin. That is a completely different world from an eyeball, which has
  // a real sunlit sea, and the two were indistinguishable while the test was on
  // temperature alone -- a bone-dry 285 K desert scores warmSub = 1.
  const liquidShare = water > 1e-9 ? w.water.ocean / water : 0;
  // Bands neither boiling nor frozen. On a locked world the band coordinate runs
  // from the antistellar point to the substellar one, so a temperate band with
  // extremes on both sides of it is a ring following the terminator.
  let temperateBands = 0;
  for (let i = 0; i < NBANDS; i++) if (w.T[i] > 275 && w.T[i] < 320) temperateBands++;

  // The envelope's share of the air. Every Hycean state is gated on this, which
  // is what makes the whole group unreachable by anything that predates it: no
  // world in this model had a hydrogen reservoir at all until recently, so this
  // is exactly zero on all of them and every branch below is skipped by
  // construction rather than by a threshold that happens to miss. A check pins
  // that preset by preset, so a future envelope on an old world cannot silently
  // reclassify it.
  // Measured against the DRY air, which is the same correction Phase 4's
  // inhibition gate needed and for the same reason. Against the total column it
  // was a gate that could never open on the states it was written for: a
  // supercritical waterworld carries tens of thousands of bar of steam, so
  // twenty bar of hydrogen under it is 0.07% of the air and the envelope reads
  // as absent on exactly the world whose envelope is the point. Whether this
  // planet has a hydrogen envelope is not a question about how much water
  // happens to be airborne today.
  const pH2Omean = dg.pH2O.reduce((a, b) => a + b, 0) / dg.pH2O.length;
  const dryAir = Math.max(pTot - pH2Omean, 1e-12);
  const envShare = ((dg.pH2 ?? 0) + (dg.pHe ?? 0)) / dryAir;
  // How much of the surface is past the critical point, from the same function
  // the vapour ceiling is built on rather than a second threshold of its own.
  const superShare = dg.hotTarget ?? 0;

  // Which Hycean state, or none. Returns null when the world has an envelope
  // but nothing under it worth naming, and the chain then carries on to the
  // ordinary states -- a dry hydrogen world is still a dry hydrogen world.
  const hyceanState = () => {
    if (envShare <= 0.5 || water <= 0.005) return null;
    // No surface at all comes first, because every state under it is a claim
    // about where an ocean is, and there isn't one.
    if (superShare > 0.5) return 'supercriticalEnvelope';
    if (liquidShare <= 0.1) return null;
    // Then the two about WHERE the ocean is rather than whether it exists. A
    // locked world whose day side has no surface and whose night side holds
    // liquid is not a world with an ocean everywhere, and it is not a nightside
    // freeze-out either: nothing is frozen and no air is collapsing. What holds
    // it up is the envelope carrying heat round to the dark side.
    // There is no dark Hycean here, and that is a result rather than an
    // omission. Madhusudhan et al. (2021) name one: a locked world whose mean
    // is too hot to live in and whose night side is not. It was built, and then
    // it could not be reached. A Hycean has a thick atmosphere by definition,
    // diffusionCoefficient scales transport with pTot^0.9, and a planet under
    // tens of bar is very nearly isothermal -- measured at 1318 K under the
    // star against 1270 K behind it, on a world locked as hard as this model
    // allows, and 1404 against 1388 with a thinner envelope. A day-night split
    // that puts one face past habitability and the other in liquid water needs
    // a contrast of hundreds of kelvin, that needs thin air, and thin air is
    // not a Hycean. Shipping a branch that cannot fire would have been worse
    // than not having one: it would read as a state the model supports.
    // A world running on its own interior. Tested on the star being negligible
    // rather than on temperature, because the temperature is the *result*: an
    // envelope this thick over any internal heat at all lands somewhere warm,
    // and it is the absent star that makes the state worth a name.
    if ((p.insolation ?? 0) < 0.01) return 'coldHycean';
    return T > 273.16 ? 'hycean' : null;
  };
  const hyceanId = hyceanState();

  let id;
  // A real collapse means a good part of the air is lying on the ground as
  // dry ice -- not merely that the atmosphere is thin and cold.
  const collapsed = w.co2Frozen > 0.25 * (w.co2 + w.co2Frozen + 1e-12) && w.co2Frozen > 1e-3;
  if (T > 1400) id = 'magma';
  else if (pTot < 0.0015 && water < 0.05) id = 'airless';
  // Two very different worlds share the one condition, and they were sharing a
  // name as well. On a rotating planet the air freezes onto the WINTER pole and
  // comes back in spring -- Mars, where the caps breathe once a year and the
  // collapse is a pressure equilibrium against them. On a tidally locked one it
  // freezes onto a hemisphere that never sees the star at all, and nothing ever
  // brings it back. The second is not a Mars: its day side can be at 58 C with a
  // liquid sea and a biosphere on it while the air drains away behind it, which
  // is a thing worth having its own name for rather than being told it looks
  // like a small cold planet with seasons.
  //
  // The mean temperature is left in the test for both, and on the locked branch
  // it is admittedly the wrong quantity -- the mean of a 58 C day and a -145 C
  // night is a number nowhere on the planet. It stays because it is what makes
  // this a *collapse* rather than an ordinary eyeball with a cold trap: the
  // whole world has to be cold on balance, not just the far side.
  //
  // And the locked branch is itself two states, which is the same mistake one
  // level down. A collapse that is under way still has a sea on the day side --
  // that is the whole reason it is worth a name of its own, and the blurb says
  // so. A collapse that has finished has none: the air is dry ice on the dark
  // hemisphere, the water is glacier ice beside it, and the day side is bare.
  // Telling someone their planet has a working ocean while it does not is not a
  // shade of meaning, and the condition here is exactly the promise the text
  // makes -- there has to be liquid water, and it has to be enough of it to be
  // a sea rather than a damp patch the hypsometry rounds to nothing.
  else if (collapsed && pTot < 0.2 && T < 265) {
    id = lam > 0.5
      ? (liquidShare > 0.02 && dg.flooded > 0.01 ? 'nightfrost' : 'nightfrozen')
      : 'marslike';
  }
  else if (T > 470 && water < 0.06 * Math.max(initialWater, 0.05)) id = 'dryRunaway';
  // The Hycean group. It goes here, after dryRunaway and before wetRunaway,
  // because `T > 420` would otherwise swallow every one of them: a 400 K ocean
  // under thirty bar of hydrogen is the state this whole branch exists to
  // represent, and the classifier called it a boiling Earth.
  //
  // Decided above rather than inline so this stays one flat chain of else-ifs.
  // A nested block here would read as though the group could fall through to
  // the states below it, and it cannot -- hyceanState returns null and the
  // chain carries on, or it returns a name and the chain stops.
  else if (hyceanId) id = hyceanId;
  else if (T > 420) id = 'wetRunaway';
  else if (lossPerGyr > 0.015 && T > 305 && water > 0.01) id = 'moist';
  else if (T < 130 && dg.pN2 > 0.3) id = 'titan';
  else if (water < 0.015) id = T > 290 ? 'baked' : 'frozen';
  // Terminator habitability. The eye is past boiling and the night side is
  // glacial, yet a ring in between holds liquid water -- which is possible only
  // on a land planet, because water vapour is what carries heat away from the
  // substellar point. Give such a world an ocean and the transport evens the
  // temperatures out until the whole planet crosses the runaway limit together,
  // leaving no habitable band at all (Lobo et al. 2023). The model gets this
  // for free: diffusionCoefficient already scales transport with the vapour
  // column, which is the same mechanism.
  //
  // The land-planet requirement is imposed here rather than emerging from the
  // transport, and that is worth being straight about. In this model a locked
  // aquaplanet at the same insolation still comes out with a 163 K day-night
  // contrast against the land planet's 201 K -- a real difference, in the right
  // direction, but nowhere near enough to close the habitable band. The reason
  // is that 0.04 EO is already plenty to saturate the air over a boiling eye,
  // so humidityScale never binds and the two atmospheres end up within a factor
  // of 1.6 of each other in vapour. Reproducing the rest needs moisture
  // transport and ocean circulation that a one-dimensional diffusive model does
  // not have, and forcing it by steepening the latent term would wreck the
  // Earth, Venus and Mars anchors. So the criterion carries the published
  // result instead of pretending to derive it.
  else if (lam > 0.5 && Tsub > 340 && Tanti < 265 && temperateBands >= 2
           && liquidShare > 0.02 && water > 0.015 && dg.flooded < 0.25) id = 'twilight';
  // An eyeball needs a sunlit *sea*, not merely a sunlit spot warm enough to
  // have one. Without the liquid test this branch swallowed every dry locked
  // world with a warm day side, which is precisely the nightside-trapped state
  // below -- it left that reachable only in a 10 K window of substellar
  // temperature, and then only on a planet frozen pole to pole, which is not
  // what it describes at all. One world in nine hundred found it.
  else if (lam > 0.5 && warmSub > 0.25 && ice > 0.25 && liquidShare > 0.05) {
    // eyeball family: how far the open water reaches around the globe
    let openBands = 0;
    for (let i = 0; i < NBANDS; i++) if (iceFraction(w.T[i]) < 0.5) openBands++;
    id = openBands / NBANDS > 0.55 ? 'lobster' : 'eyeball';
  }
  // The water is all still here; it is simply all on the far side, as ice, and
  // the sunlit face is a desert that cannot get it back.
  // The flooded test is not a duplicate of the liquid one: with a large
  // inventory, a few percent left liquid is still a real sea. A label that says
  // bone dry while the globe shows open blue water is simply wrong, so the
  // state has to require the sea to be gone from the picture too.
  else if (lam > 0.5 && liquidShare < 0.05 && water > 0.02
           && dg.flooded < 0.04 && Tsub > 255) id = 'trapped';
  else if (pTot < 0.05 && T < 265 && water < 0.35) id = 'thincold';
  else if (ice > 0.93) id = water < 0.1 ? 'frozen' : 'snowball';
  else if (ice > 0.55) id = 'waterbelt';
  // A land planet has little water on its surface. Basin geometry can keep a
  // small inventory confined, but it cannot hide an arbitrarily deep ocean:
  // finite relief eventually overtops. Reading `flooded` rather than the raw
  // inventory keeps this branch honest while that happens.
  //
  // The temperature bounds are what keep this honest on a boiling world. There
  // `flooded` is zero because the ocean is in the sky rather than because there
  // is nowhere for it to be, and the runaway branches above have already
  // claimed it.
  else if ((water < 0.12 || dg.flooded < 0.01) && T > 250 && T < 340) id = 'dune';
  else if (T < 250) id = 'frozen';
  // Classification follows the surface the renderer and diagnostics show, not
  // the reference high-ground control. Enough water can drown nominally
  // continental terrain, and that world is a waterworld once less than four
  // percent of its actual surface remains exposed.
  else if (dg.landFrac < 0.04 && T > 258 && T < 335) id = 'waterworld';
  else if (ice < 0.02 && T > 296) id = 'hothouse';
  else id = 'temperate';

  const s = STATES[id];
  // Two states were missing from this list while their own blurbs asserted the
  // opposite, which is a disagreement inside the model rather than a matter of
  // taste. A Partial Nightside Freeze-Out is defined by still having a sea --
  // the branch above will not choose it unless liquidShare > 0.02 and something
  // is flooded, and the moment the last of it goes the world becomes a
  // Nightside Freeze-Out instead. Its text says "the day side is still warm,
  // wet and habitable while it happens: a planet with a working ocean under its
  // sun and its atmosphere quietly draining away behind it", and then the
  // readout said uninhabitable. A Twilight World is the same case: its branch
  // requires a liquid ring around the terminator and its text calls that ring
  // habitable.
  //
  // Neither is Earth-like and neither needs to be. What this flag answers is
  // whether there is liquid water somewhere a thing could live in, and on both
  // of these there is -- by construction, or the state would not have been
  // reached.
  //
  // The three Hycean states with an ocean join them, and the ceiling is
  // deliberately NOT repeated here. Madhusudhan's Hycean habitability runs to
  // about 400 K; biosphere.js caps prokaryotes at 122 C, which is 395 K and the
  // real measured record (Methanopyrus kandleri strain 116, Takai et al. 2008).
  // Those two numbers were arrived at from completely independent directions
  // and land within five kelvin of each other, so the 350-550 K band splits
  // itself without anyone having to draw the line twice: the cool half is an
  // ocean a prokaryote could live in and the hot half is a sterile one that
  // happens to be liquid. Duplicating the ceiling here would create a second
  // copy to drift, and a check pins that the two modules still agree.
  //
  // supercriticalEnvelope is not on the list, and that is not an oversight: it
  // is the one state in the group with no liquid water anywhere.
  const habitable = (id === 'temperate' || id === 'waterworld' || id === 'dune' ||
                     id === 'eyeball' || id === 'lobster' || id === 'hothouse' ||
                     id === 'waterbelt' || id === 'nightfrost' || id === 'twilight' ||
                     id === 'hycean' || id === 'coldHycean')
                    && water > 0.005;

  return { id, name: s.name, color: s.color, blurb: s.blurb, habitable, Tsub, Tanti };
}

// One-line "why" text shown live under the state name.
// The translator is injected rather than imported: this is a physics module and
// it must keep loading with no DOM and no language machinery behind it. The
// default formats the English exactly as it always did, so a caller that does
// not care -- the tests, anything headless -- sees no change at all.
function enFormat(s, ...args) {
  return s.replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : args[i]));
}

export function reasonText(w, st, tr = enFormat) {
  const dg = w.diag, esc = w.escape ?? {};
  const bits = [];
  bits.push(tr('mean surface {0} °C', (dg.Tmean - 273.15).toFixed(1)));
  // On a locked world the mean is a number no part of the planet has: it sits
  // between a face that never sets and one that never sees the star. The stats
  // panel already splits them; the banner is the line people actually read, and
  // "mean surface -13.6 °C" on a world with a +41 °C eye says the wrong thing
  // on its own. The two sides come from classify() rather than from Tmax and
  // Tmin, so this and the state label cannot disagree about which is which.
  if (dg.lam > 0.5 && st && st.Tsub != null) {
    bits.push(tr('day {0} °C, night {1} °C',
      (st.Tsub - 273.15).toFixed(0), (st.Tanti - 273.15).toFixed(0)));
  } else if (dg.Tmax != null && dg.Tmin != null && dg.Tmax - dg.Tmin > 2) {
    // The same argument one step down: on a rotating world the mean is a number
    // the equator and the poles are both a long way from, and forty kelvin of
    // spread is the difference between an ice cap and no ice cap. Tmax and Tmin
    // are the equator and the poles here -- the insolation profile is monotonic
    // in latitude on anything that is not tidally locked.
    bits.push(tr('equator {0} °C, poles {1} °C',
      (dg.Tmax - 273.15).toFixed(0), (dg.Tmin - 273.15).toFixed(0)));
  }
  // Same distinction as the readout's "Ice cover": what is UNDER ice, not what
  // is below freezing. Modern Mars is 100% of the second and 1.9% of the first,
  // and the subtitle claiming "100% ice" for a planet whose caps are a percent
  // of its surface was the same overstatement the renderer was making.
  if (dg.iceArea > 0.01) bits.push(tr('{0}% ice', (dg.iceArea * 100).toFixed(0)));
  if (Math.abs(dg.imbalance) > 0.5) {
    bits.push(tr('{0} W/m² imbalance',
      `${dg.imbalance > 0 ? '+' : ''}${dg.imbalance.toFixed(1)}`));
  }
  if (esc.fStrat > 1e-4 && dg.totalWater > 0) {
    const perGyr = (w.escape.water * 1e9) / dg.d.eoColumn;
    if (perGyr > 1e-3) bits.push(tr('losing {0} oceans/Gyr', perGyr.toFixed(2)));
  }
  if (w.co2Frozen > 1e-3) {
    // Where it froze matters, and on a locked world the answer is not "here".
    // TRAPPIST-1b runs a 237 °C day side against a −186 °C night side: the CO2
    // is frozen on ground that never sees the star, while the sunlit half is
    // hot enough to melt lead. "Frozen out" on its own reads as a frozen
    // planet, which is the opposite of what half of this one is.
    const bar = (w.co2Frozen * dg.g) / 1e5;
    const amount = bar >= 100 ? bar.toFixed(0) : bar >= 1 ? bar.toFixed(1) : bar.toFixed(3);
    bits.push(dg.lam > 0.5
      ? tr('{0} bar CO₂ frozen onto the night side', amount)
      : tr('{0} bar CO₂ frozen out', amount));
  }
  return bits.join(' · ');
}
