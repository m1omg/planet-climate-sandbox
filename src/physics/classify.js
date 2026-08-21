import { NBANDS, X, lockFactor } from './climate.js';
import { iceFraction } from './radiation.js';
import { clamp } from './constants.js';

// Every state the game can recognise, with the real science behind it.
export const STATES = {
  magma:      { name: 'Magma Ocean',          color: '#ff5a2b', blurb: 'The surface is molten rock. Above roughly 1400 K silicates melt and the planet radiates in the near-infrared; any atmosphere is a hot rock-vapour and steam envelope.' },
  dryRunaway: { name: 'Dry Runaway Greenhouse', color: '#e0553a', blurb: 'Venus. The ocean is gone — evaporated, photolysed, and the hydrogen dragged off to space — leaving a thick dry CO2 atmosphere and a surface hot enough to glow faintly. Irreversible on any human timescale.' },
  wetRunaway: { name: 'Wet Runaway Greenhouse', color: '#ff8340', blurb: 'Absorbed sunlight exceeds the Simpson–Nakajima limit (~282 W/m2), so no equilibrium exists at any temperature. The ocean is boiling into a massive steam atmosphere; latent heat makes this transient take ~10^5 years, and losing the water takes 10^8–10^9 more.' },
  moist:      { name: 'Moist Greenhouse',     color: '#ffb03a', blurb: 'Still liquid, but the cold trap has failed: stratospheric water exceeds a mixing ratio of 10^-3, so hydrogen escapes steadily. Habitable in the short run, drying out over hundreds of millions of years (Kasting 1988).' },
  hothouse:   { name: 'Ice-Free Hothouse',    color: '#f2c14e', blurb: 'No permanent ice anywhere, tropics near the limit of complex life. Earth looked like this in the Cretaceous and the PETM.' },
  temperate:  { name: 'Temperate & Habitable', color: '#4ec98a', blurb: 'Liquid water across much of the surface with stable polar ice. The carbonate–silicate thermostat holds this state against slow changes in starlight over ~1 Myr.' },
  dune:       { name: 'Dune / Desert World',  color: '#d9a441', blurb: 'A land planet with little surface water. Unsaturated air lets the tropics radiate above the classical runaway limit, and a dry stratosphere throttles water loss — so desert worlds stay habitable much closer to their star than ocean worlds (Abe et al. 2011).' },
  waterworld: { name: 'Waterworld',           color: '#2f8fd6', blurb: 'A global ocean with no exposed land. Silicate weathering is shut off, so there is no carbonate–silicate thermostat and the climate drifts wherever the forcing takes it.' },
  eyeball:    { name: 'Eyeball World',        color: '#5fb8e8', blurb: 'Tidally locked, with a sunlit ocean under the star and permanent ice everywhere else. The thick substellar cloud deck reflects so much light that these worlds stay habitable out to nearly twice Earth’s insolation (Yang et al. 2014).' },
  lobster:    { name: 'Lobster State',        color: '#7fd0e8', blurb: 'An eyeball whose open water has been stretched along the equator by ocean heat transport, leaving warm claws reaching around toward the night side.' },
  twilight:   { name: 'Twilight World',          color: '#b98ad6', blurb: 'The eye is scorching, the night side is glacial, and between them a temperate ring of liquid water follows the terminator all the way round the planet. It works only because there is too little water to move the heat: a wetter world would carry enough latent heat away from the substellar point to even the temperatures out, and would then cross the runaway limit as a whole planet instead of leaving a habitable band behind (Lobo et al. 2023).' },
  trapped:    { name: 'Nightside-Trapped Desert', color: '#9aa7c9', blurb: 'On a locked world the night side is a permanent cold trap. Every drop of water has migrated there as glacier ice, leaving a bone-dry sunlit desert that cannot recover it.' },
  waterbelt:  { name: 'Waterbelt / Slushball', color: '#8fd8d0', blurb: 'Ice reaches deep into the tropics but a narrow band of open equatorial ocean survives. A genuine stable state, and a far softer landing than a hard snowball.' },
  snowball:   { name: 'Hard Snowball',        color: '#cfe8f5', blurb: 'Runaway ice–albedo feedback has frozen the planet pole to pole. Weathering stops, so volcanic CO2 accumulates unopposed for 5–50 Myr until 0.1–0.3 bar finally breaks the ice.' },
  marslike:   { name: 'Mars-Like Collapse',   color: '#c1785a', blurb: 'The air itself has frozen onto the ground. Below the CO2 frost point the atmosphere condenses onto the winter pole faster than volcanoes can resupply it, and the pressure falls until what is left is in equilibrium with the caps. It is escapable: enough outgassing thickens the air, warms the poles above the frost point and puts the atmosphere back where it belongs.' },
  titan:      { name: 'Titan-Like',           color: '#c9a86a', blurb: 'A frigid world under a thick nitrogen–methane haze, far too cold for liquid water but warm enough for other liquids to run on the surface.' },
  frozen:     { name: 'Frozen Desert',        color: '#a8b8c8', blurb: 'Cold, dry and still. Not enough water for a true snowball and not enough greenhouse to thaw.' },
  thincold:   { name: 'Thin Cold Desert',     color: '#b08a6e', blurb: 'A thin, frigid, desiccated atmosphere over bare ground — Mars today. The air has not collapsed: it is simply all there is. Turn up the volcanoes and it will thicken, warm, and eventually hold liquid water again.' },
  baked:      { name: 'Baked Desert',         color: '#e08a3a', blurb: 'A hot, waterless world of bare rock. Whatever water it had is long gone, so nothing moderates the surface and the day side simply bakes.' },
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

  let id;
  // A real collapse means a good part of the air is lying on the ground as
  // dry ice -- not merely that the atmosphere is thin and cold.
  const collapsed = w.co2Frozen > 0.25 * (w.co2 + w.co2Frozen + 1e-12) && w.co2Frozen > 1e-3;
  if (T > 1400) id = 'magma';
  else if (pTot < 0.0015 && water < 0.05) id = 'airless';
  else if (collapsed && pTot < 0.2 && T < 265) id = 'marslike';
  else if (T > 470 && water < 0.06 * Math.max(initialWater, 0.05)) id = 'dryRunaway';
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
  else if (water < 0.12 && T > 250 && T < 340) id = 'dune';
  else if (T < 250) id = 'frozen';
  else if (p.landFraction < 0.04 && T > 258 && T < 335) id = 'waterworld';
  else if (ice < 0.02 && T > 296) id = 'hothouse';
  else id = 'temperate';

  const s = STATES[id];
  const habitable = (id === 'temperate' || id === 'waterworld' || id === 'dune' ||
                     id === 'eyeball' || id === 'lobster' || id === 'hothouse' ||
                     id === 'waterbelt') && water > 0.005;

  return { id, name: s.name, color: s.color, blurb: s.blurb, habitable, Tsub, Tanti };
}

// One-line "why" text shown live under the state name.
export function reasonText(w, st) {
  const dg = w.diag, esc = w.escape ?? {};
  const bits = [];
  bits.push(`mean surface ${(dg.Tmean - 273.15).toFixed(1)} °C`);
  if (dg.iceMean > 0.01) bits.push(`${(dg.iceMean * 100).toFixed(0)}% ice`);
  if (Math.abs(dg.imbalance) > 0.5) bits.push(`${dg.imbalance > 0 ? '+' : ''}${dg.imbalance.toFixed(1)} W/m² imbalance`);
  if (esc.fStrat > 1e-4 && dg.totalWater > 0) {
    const perGyr = (w.escape.water * 1e9) / dg.d.eoColumn;
    if (perGyr > 1e-3) bits.push(`losing ${perGyr.toFixed(2)} oceans/Gyr`);
  }
  if (w.co2Frozen > 1e-3) bits.push(`${((w.co2Frozen * dg.g) / 1e5).toFixed(3)} bar CO₂ frozen out`);
  return bits.join(' · ');
}
