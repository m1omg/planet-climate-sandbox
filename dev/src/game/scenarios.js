import { EARTH } from './presets.js';
import { classify } from '../physics/classify.js';

// A scenario sets up a world and a goal. `check` is evaluated continuously on
// the live simulation; `fail` ends the run early. Time limits are in simulated
// years, so the accelerated clock is part of the puzzle.
export const SCENARIOS = [
  {
    id: 'thaw',
    name: 'Break the Snowball',
    icon: '❄️',
    brief: 'The planet is frozen pole to pole and the ice is reflecting almost everything back to space. Weathering has stopped, so volcanic CO₂ has nowhere to go but up. Get liquid water back.',
    hint: 'Volcanoes are your only lever inside a snowball. Turn outgassing up and run the clock — real snowballs needed 0.1–0.3 bar of CO₂ and tens of millions of years.',
    params: { ...EARTH, co2Bar: 1e-5, startT: 225, outgassing: 1 },
    limit: 2e8,
    check: (w) => w.diag.iceMean < 0.45 && w.diag.Tmean > 273,
    fail: (w) => w.diag.Tmean > 340,
  },
  {
    id: 'hold',
    name: 'Hold Back the Runaway',
    icon: '🔥',
    brief: 'The star has brightened by two fifths and the oceans sit a whisker below the Simpson–Nakajima limit — pass it and no equilibrium exists at any temperature. Keep this world habitable for 100 million years while the carbon cycle does its worst.',
    hint: 'You cannot dim the star, and the volcanoes are working against you. Strip the CO₂ and keep it stripped, brighten the ground, and remember that a drier planet radiates better than a wet one.',
    // 1.40, not the 1.30 this shipped at, and the difference is that 1.30 has no
    // runaway in it. This model's Earth-like runaway sits at 1.42 S(+) -- too far
    // out, and reported as its own gap in calibrate.mjs -- so at 1.30 the world
    // simply sat at 41 C for the full hundred megayears. Worse, it sat there
    // classified as a moist greenhouse, which `habitable` does not include, so
    // `check` could never pass and `fail` could never fire: the scenario was
    // unwinnable and unloseable at once, which is precisely how it looked.
    //
    // At 1.40 the threat is real -- do nothing and it is over in 760 years -- and
    // every route the hint describes works: stripping the CO2 wins, brightening
    // the ground wins, drying the planet wins.
    params: { ...EARTH, insolation: 1.40, co2Bar: 1.2e-3, outgassing: 2.5, startT: 300 },
    limit: 1e8,
    // A moist greenhouse that still has its ocean counts. It is what the brief
    // asks for -- the world held -- and the state's own entry says habitable in
    // the short run; a hundred megayears is the short run. Losing the ocean is
    // still a loss, and `fail` below is what says so.
    check: (w) => w.time > 1e8 && w.water.ocean > 0.05
      && (classify(w).habitable || classify(w).id === 'moist'),
    fail: (w) => w.diag.Tmean > 400 || w.water.lost > 0.25,
  },
  {
    id: 'terraform',
    name: 'Terraform the Cold Desert',
    icon: '🔴',
    brief: 'A small, cold, thin-aired world with a trace of buried ice. Give it liquid water at the surface.',
    hint: 'Low gravity means every kilogram of gas buys less pressure. You will need a lot of CO₂ — and enough water in the inventory for an ocean to exist at all.',
    params: { ...EARTH, mass: 0.4, insolation: 0.62, water: 0.05, landFraction: 0.9, n2Bar: 0.02, co2Bar: 0.004, outgassing: 0.05, startT: 210 },
    limit: 5e8,
    check: (w) => w.diag.Tmean > 278 && w.water.ocean > 0.01,
    fail: null,
  },
  {
    id: 'eyeball',
    name: 'The Eye of the Red Dwarf',
    icon: '👁️',
    brief: 'A tidally locked world facing an active M dwarf forever. One hemisphere burns, the other is a cold trap that steals water and never gives it back. Keep an open ocean under the star for a billion years.',
    hint: 'Thick air moves heat to the night side and stops the water migrating there for good. Watch the XUV — an active red dwarf strips water fast.',
    params: { ...EARTH, mass: 1.2, insolation: 1.05, tidallyLocked: true, rotationHours: 300, starTemp: 3200, xuvFraction: 6e-4, landFraction: 0.2, n2Bar: 1.5, startT: 265 },
    limit: 1e9,
    check: (w) => { const c = classify(w); return w.time > 1e9 && (c.id === 'eyeball' || c.id === 'lobster' || c.habitable); },
    fail: (w) => w.water.lost > 0.6 || w.diag.iceMean > 0.985,
  },
  {
    id: 'dune',
    name: 'Build a Dune World',
    icon: '🏜️',
    brief: 'Put a habitable planet where an ocean world would boil. Desert planets survive far closer to their star: unsaturated air radiates above the classical runaway limit and a dry stratosphere throttles water loss.',
    hint: 'Counter-intuitive but real (Abe et al. 2011): give it *less* water. Draining it is not enough on its own, though — with deep Earth-like basins the little that remains spreads into wide shallow seas and the air stays wet. Raise the basin geometry too, so what water is left has nowhere to spread.',
    params: { ...EARTH, insolation: 1.5, water: 1.0, landFraction: 0.3, startT: 300 },
    limit: 3e8,
    check: (w) => w.time > 3e7 && classify(w).habitable && w.diag.Tmean < 342,
    fail: null,
  },
  {
    id: 'oxidation',
    name: 'The Great Oxidation',
    icon: '🫧',
    brief: 'An Archean world, anoxic, kept warm above freezing by a millibar of methane. Your cyanobacteria have just worked out oxygenic photosynthesis and are spreading on their own — and oxygen and methane cannot coexist. Keep this planet from freezing solid while it oxygenates.',
    hint: 'The biosphere is not yours to hold back: it doubles every few million years whatever you do, and it crosses the volcanic reductant flux at about 0.4× Earth. From there oxygen cuts methane’s life from ten thousand years to ten, and a millibar of methane is worth some fifteen watts per square metre. Replace that greenhouse with CO₂ *before* the crossover, or you will watch the ice-albedo feedback take the whole planet — and the methane coming back afterwards will not melt it.',
    params: { ...EARTH, o2Bar: 0, biosphere: 0.2, insolation: 0.77, landFraction: 0.1,
              co2Bar: 0.08, ch4Bar: 1e-3, startT: 288 },
    // Life takes off by itself, which is the whole point of the scenario and was
    // missing from it: the biosphere sat at 0.2x for ever, below the 0.385x where
    // oxygen starts outrunning the volcanoes, so the Great Oxidation simply never
    // happened unless you reached over and started it. A player who did nothing
    // was rewarded with a stable world, which is the opposite of the lesson.
    //
    // A function of simulated time, not of frames, so it runs the same at one
    // year a second and at three hundred megayears. Thirty-million-year
    // e-folding from 0.2x towards Earth's present productivity: it passes the
    // threshold around 8 Myr in, which is enough warning to act on and not enough
    // to ignore. It stops at 1.0x -- this is life spreading into a world that had
    // none, not life becoming something a planet has never supported.
    evolve: (w) => 0.2 + 0.8 * (1 - Math.exp(-w.time / 3e7)),
    limit: 3e8,
    check: (w) => w.diag.pO2 > 0.01 && w.diag.Tmean > 273 && w.diag.iceMean < 0.5,
    fail: (w) => w.diag.iceMean > 0.95,
  },
  {
    id: 'venus',
    name: 'Undo Venus',
    icon: '🌋',
    brief: 'A dry runaway greenhouse: 90 bar of CO₂, 460 °C, and the water long since photolysed and blown away. Cool it below boiling.',
    hint: 'The water is gone and is not coming back — but the inventory slider is yours. Bury the CO₂ and give the weathering thermostat something to work with.',
    params: { ...EARTH, mass: 0.815, insolation: 1.91, water: 0, landFraction: 1, n2Bar: 3.5, co2Bar: 88, rotationHours: 5832, landAlbedo: 0.15, startT: 735 },
    limit: 1e9,
    check: (w) => w.diag.Tmean < 373,
    fail: null,
  },
];
