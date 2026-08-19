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
    brief: 'The star has brightened by a third. The oceans are heading for the Simpson–Nakajima limit — once absorbed sunlight passes it, no equilibrium exists at any temperature. Keep this world habitable for 100 million years.',
    hint: 'You cannot dim the star. You can strip CO₂, brighten the surface, and lean on the fact that a drier planet radiates better than a wet one.',
    params: { ...EARTH, insolation: 1.34, co2Bar: 280e-6, startT: 300 },
    limit: 1e8,
    check: (w) => w.time > 1e8 && classify(w).habitable,
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
    hint: 'Counter-intuitive but real (Abe et al. 2011): give it *less* water, not more.',
    params: { ...EARTH, insolation: 1.5, water: 1.0, landFraction: 0.3, startT: 300 },
    limit: 3e8,
    check: (w) => w.time > 5e7 && classify(w).habitable && w.diag.Tmean < 342,
    fail: null,
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
