import { EARTH } from './presets.js';
import { classify } from '../physics/classify.js';

// A scenario sets up a world and a goal. `check` and `fail` are evaluated once
// per STEP of the live simulation (main.js scenarioStep), so a verdict lands
// at the same simulated year whatever the frame rate; `fail` ends the run
// early. Time limits are in simulated years, so the accelerated clock is part
// of the puzzle.
//
// A scenario may carry a `walk`: a starlight destination the star sets off
// for the moment the scenario starts, on the twenty-megayear smoothing walk,
// so a threat arrives over time rather than being built in.
//
// Every scenario carries a `solution`: the play its own hint describes, as
// the controls the page would apply and the simulated year to apply them.
// tools/scenariocheck.mjs plays each scenario three ways -- doing nothing,
// the solution, and the solution at another step cap -- and every number in
// a brief or a hint below was read off those runs on this build's physics.
// The file was inherited from altdev byte for byte while the physics under
// it was rewritten, and none of its numbers reproduced: one scenario was
// unwinnable at any setting, one was won by waiting, one was won or lost
// depending on the frame rate.
//
// Every scenario runs with `realisticGeology` on. These are all hundred-Myr to
// Gyr puzzles, and over that span a planet's interior is not a constant: the
// radiogenic heat falls, and because outgassing goes as sqrt(F/F_earth) the
// volcanoes fall with it. Holding the interior still for a billion years to
// make a puzzle easier to reason about would be the one place this model lies
// about time, which is the subject of the whole thing.
export const SCENARIOS = [
  {
    id: 'thaw',
    name: 'Break the Snowball',
    icon: '❄️',
    brief: 'The planet is frozen pole to pole, the ice is reflecting almost everything back to space, and the volcanoes have stopped. Nothing is adding carbon to the air and nothing will, unless you do it. Get liquid water back.',
    hint: 'Volcanoes are your only lever inside a snowball: weathering needs liquid water, so with the ice down to the equator there is no sink and every gram you erupt stays. Turn outgassing up and run the clock.',
    // The volcanoes start DEAD, and that is the whole scenario.
    //
    // They used to start at Earth's rate, which made this a puzzle you won by
    // waiting 200 kyr and touching nothing -- the same failure the Great
    // Oxidation scenario below has a paragraph about. A player who did nothing
    // was congratulated.
    //
    // It is worth being straight about why it was so easy, because the honest
    // version is still easier than the real thing. This model deglaciates a
    // snowball at about 10 mbar of CO2 where the literature needs 0.1-0.3 bar,
    // and in a fifth of a megayear where the Marinoan took 4-15 -- both reported
    // every run as GAP rows by tools/calibrate.mjs, and both traceable to the
    // semi-grey scheme having no atmospheric window, so piling on CO2 always
    // works and works too well. Starting the volcanoes dead makes this an act
    // rather than a wait; it does not make the threshold right.
    params: { ...EARTH, realisticGeology: true, co2Bar: 1e-5, startT: 205, outgassing: 0 },
    limit: 2e8,
    check: (w) => w.diag.iceMean < 0.45 && w.diag.Tmean > 273,
    fail: (w) => w.diag.Tmean > 340,
    // Measured: twenty times Earth's volcanism breaks the ice in 16 kyr.
    solution: [{ at: 0, patch: { outgassing: 20 } }],
  },
  {
    id: 'hold',
    name: 'Hold Back the Runaway',
    icon: '🔥',
    brief: 'A world sitting six watts per square metre under the Simpson–Nakajima limit — habitable, and with nothing to spare. Its star is heavier than the Sun and burning through its hydrogen three times as fast, so that margin is closing on its own and will not stop. Keep this planet habitable for a billion years.',
    hint: 'You cannot dim the star and you cannot stop it brightening, and the CO₂ is no lever here: the thermostat has already drawn it down as far as it goes, and stripping it entirely loses at 654 Myr against 763 doing nothing. What survives an F star is a desert. Drain the ocean to a few percent of one and raise the basin geometry so what is left has nowhere to spread — a dune world holds to 1.70 S⊕ where an ocean world boils at 1.30. Remember that the limit is on absorbed sunlight against what the atmosphere can radiate — brighten the ground, and a drier planet radiates better than a wet one.',
    // It now starts where the brief says it starts, which it did not before.
    //
    // The old setup was 1.30 S(+) and a fixed star, and the brief called that
    // "a whisker below the Simpson-Nakajima limit". The runaway margin at t=0
    // read -30.5 W/m^2: thirty watts PAST it, already committed, gone in under
    // ten million years. It was also winnable -- stripping the CO2 lands it at
    // 39 C -- so nothing was broken except the sentence, and a scenario whose
    // premise is a lie about where the planet is standing is not much of a
    // scenario.
    //
    // 1.15 S(+) settles at +6.0 W/m^2. That is the whisker.
    //
    // The star is what makes it a puzzle rather than a snapshot, and it took
    // some finding: on a FIXED star, doing nothing simply wins. The
    // carbonate-silicate thermostat is very good at this -- weathering draws the
    // CO2 down as fast as the temperature climbs -- and every insolation from
    // 1.12 to 1.22 sat out the full run at 37-39 C, habitable and untouched.
    // That is not a flaw in the model; it is why Earth survived the Sun getting
    // 40% brighter, and it is the same gradual-versus-abrupt hysteresis that
    // "The Hot Ocean" is built on.
    //
    // So the star has to outrun the thermostat, and the number is measured
    // rather than picked. Stripping the CO2 entirely holds a world to 1.30 S(+)
    // and no further; draining it to a dune holds to 1.70. 0.26/Gyr carries
    // 1.15 to 1.449 over the billion years, which is past the first and inside
    // the second -- so the thermostat alone loses at 862 Myr, keeping the CO2
    // stripped wins at 14 C, and there is somewhere left to go if that stops
    // working.
    //
    // The star is not given that rate any more; it is a star that HAS it. An F
    // at 6500 K burns through its main sequence in 4.8 Gyr rather than the
    // Sun's 10, and at 2.75 Gyr old it is brightening at 25%/Gyr off its own
    // Gough curve -- carrying 1.15 to 1.446 across the billion years, which is
    // the number this scenario was built around, now derived from the star
    // instead of asserted over it.
    params: { ...EARTH, realisticGeology: true, insolation: 1.15, co2Bar: 1.2e-3, outgassing: 2.5,
              starTemp: 6500, startAge: 2.75, brightening: 1, xuvDecay: true, startT: 300 },
    limit: 1e9,
    check: (w) => w.time > 1e9 && classify(w).habitable,
    fail: (w) => w.diag.Tmean > 400 || w.water.lost > 0.25,
    // Measured on this build: doing nothing runs away at 763 Myr; stripping
    // the CO₂ and the volcanoes runs away at 654 Myr; draining the ocean to
    // 0.05 EO over 90% land at the start sits out the gigayear at 38 °C as a
    // dune world.
    solution: [{ at: 0, patch: { water: 0.05, landFraction: 0.9 } }],
  },
  {
    id: 'terraform',
    name: 'Terraform the Cold Desert',
    icon: '🔴',
    brief: 'A small, cold, thin-aired world with a trace of buried ice. Give it liquid water at the surface.',
    hint: 'Low gravity means every kilogram of gas buys less pressure. You will need a lot of CO₂ — and enough water in the inventory for an ocean to exist at all.',
    params: { ...EARTH, realisticGeology: true, mass: 0.4, insolation: 0.62, water: 0.05, landFraction: 0.9, n2Bar: 0.02, co2Bar: 0.004, outgassing: 0.05, startT: 210 },
    limit: 5e8,
    // Held for a megayear, not merely touched: with three bars of CO₂ added
    // the mean passes 5 °C within decades, and a goal met in the first frame
    // is not a terraforming.
    check: (w) => w.time > 1e6 && w.diag.Tmean > 278 && w.water.ocean > 0.01,
    fail: null,
    // Measured: 3 bar of CO₂ and twenty times the volcanism to keep it there
    // settle a 0.05-ocean dune world at 39 °C; a single bar loses.
    solution: [{ at: 0, patch: { co2Bar: 3, outgassing: 20 } }],
  },
  {
    id: 'eyeball',
    name: 'The Eye of the Red Dwarf',
    icon: '👁️',
    brief: 'A tidally locked world with a full ocean under its red dwarf, and the star is brightening: half again over the next twenty million years, enough to boil the substellar sea. Keep an open ocean under the star for a billion years.',
    hint: 'Neither thick air nor bright land saves this one — measured, they change the date of the runaway by a megayear. What does is less water (Lobo et al. 2023): an ocean too small to carry heat around the planet leaves a sea under the star and a dry night side, and that eye stays open. Cut the inventory to a fifth of an ocean.',
    // Measured: doing nothing runs away at 18 Myr as the star arrives; five
    // bars of nitrogen or a land albedo of 0.5 move a runaway by a megayear;
    // a fifth of an ocean is a lobster world at 44 °C for as long as you run it.
    // The old premise -- an active dwarf stripping the water unless thick air
    // held it -- did not reproduce at any XUV from 6e-4 to 1e-2: the cold
    // trap of a locked world holds, and the old setup won by waiting.
    // It opens stable at 1.05 S⊕ and the star walks to 1.5 over twenty
    // megayears (`walk`), because a world BUILT at 1.25 with a full ocean is a
    // runaway inside sixteen centuries -- over before the first frame at play
    // speed, and a puzzle nobody can act on -- while a world WALKED to 1.25,
    // or to 1.45, stays on its cold branch and wins by waiting: walked, the
    // full ocean first runs away at 1.5 (18 Myr in), and a fifth of an ocean
    // walked to 1.5 is a lobster world at 44 °C for as long as you run it.
    params: { ...EARTH, realisticGeology: true, mass: 1.2, insolation: 1.05, tidallyLocked: true, rotationHours: 300, starTemp: 3200, xuvFraction: 6e-4, xuvDecay: true, landFraction: 0.2, n2Bar: 1.5, startT: 265, smoothInsolation: true },
    walk: { insolation: 1.5 },
    limit: 1e9,
    check: (w) => { const c = classify(w); return w.time > 1e9 && (c.id === 'eyeball' || c.id === 'lobster' || c.habitable); },
    fail: (w) => w.water.lost > 0.6 || w.diag.iceMean > 0.985 || w.diag.Tmean > 450,
    solution: [{ at: 0, patch: { water: 0.2 } }],
  },
  {
    id: 'dune',
    name: 'Build a Dune World',
    icon: '🏜️',
    brief: 'Put a habitable planet where an ocean world would boil. The star is walking up to 1.4 S⊕ over twenty million years, past the ocean world\u2019s limit. Desert planets survive far closer to their star: unsaturated air radiates above the classical runaway limit and a dry stratosphere throttles water loss.',
    hint: 'Counter-intuitive but real (Abe et al. 2011): give it *less* water. Draining it is not enough on its own, though — with deep Earth-like basins the little that remains spreads into wide shallow seas and the air stays wet. Raise the basin geometry too, so what water is left has nowhere to spread.',
    // 1.4 S⊕, measured: with its ocean this world is a steam runaway inside
    // a century and supercritical by 35 kyr, and no amount of draining saved
    // it at the old 1.5 -- every setting from 0.003 to 0.1 EO ran away too.
    // At 1.4 the wet world still runs away and the drained one settles at
    // 30 °C, which is the contrast the scenario is about.
    // ...and it walks there. Built at 1.4 the ocean world is a steam runaway
    // inside six centuries, before a player has seen the panel; it opens at
    // 1.2, habitable, with the star walking to 1.4 over twenty megayears.
    params: { ...EARTH, realisticGeology: true, insolation: 1.2, water: 1.0, landFraction: 0.3, startT: 295, smoothInsolation: true },
    walk: { insolation: 1.4 },
    limit: 3e8,
    check: (w) => w.time > 3e7 && classify(w).habitable && w.diag.Tmean < 342,
    // A sea in the sky is the end of this one; there is no waiting it out.
    fail: (w) => w.diag.Tmean > 450,
    solution: [{ at: 0, patch: { water: 0.05, landFraction: 0.95 } }],
  },
  {
    id: 'oxidation',
    name: 'The Great Oxidation',
    icon: '🫧',
    brief: 'An Archean world, anoxic, kept warm above freezing by a millibar of methane. Your cyanobacteria have just worked out oxygenic photosynthesis and are spreading on their own — and oxygen and methane cannot coexist. Keep this planet from freezing solid while it oxygenates.',
    hint: 'The biosphere is not yours to hold back: it doubles every few million years whatever you do, and it crosses the volcanic reductant flux at about 0.4× Earth. From there oxygen cuts methane’s life from ten thousand years to ten, and a millibar of methane is worth some fifteen watts per square metre. Replace that greenhouse with CO₂ *before* the crossover, or you will watch the ice-albedo feedback take the whole planet — and the methane coming back afterwards will not melt it.',
    params: { ...EARTH, realisticGeology: true, o2Bar: 0, biosphere: 0.2, insolation: 0.77, landFraction: 0.1,
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
    // Measured: doing nothing snowballs at 20 Myr as the methane goes;
    // 0.35 bar of CO₂ laid in at the start carries the world through and
    // the oxygen arrives at 13 Myr.
    solution: [{ at: 0, patch: { co2Bar: 0.35 } }],
  },
  {
    id: 'venus',
    name: 'Undo Venus',
    icon: '🌋',
    brief: 'A dry runaway greenhouse: 90 bar of CO₂, 460 °C, and the water long since photolysed and blown away. Cool it below boiling.',
    hint: 'The water is gone and is not coming back, and at this distance from the star adding any brings a steam runaway instead. Bury the CO₂ — drop the slider — and the surface falls below boiling within the year; then stop the volcanoes, because at Earth\u2019s outgassing the air is back past 100 °C in twenty million years. Hold it below the boil for ten million.',
    params: { ...EARTH, realisticGeology: true, mass: 0.815, insolation: 1.91, water: 0, landFraction: 0.8, n2Bar: 3.5, co2Bar: 88, rotationHours: 5832, landAlbedo: 0.15, startT: 735 },
    limit: 1e8,
    // Below boiling for ten million years running, not merely once: the
    // instantaneous test was won in the first frame after the CO₂ slider
    // moved, and the world then reheated to 118 °C by 30 Myr on its own
    // volcanoes. `coolSince` lives on the world so a save carries it.
    check: (w) => {
      // Dated from the start of the step it was first seen in, so the hold
      // does not begin a step late at a coarse cap.
      if (w.diag.Tmean < 373) { w.coolSince ??= w.time - (w.dtPrev ?? 0); return w.time - w.coolSince > 1e7; }
      w.coolSince = null; return false;
    },
    fail: null,
    // Measured: CO₂ to 10 mbar with the volcanoes stopped holds 61 °C.
    solution: [{ at: 0, patch: { co2Bar: 0.01, outgassing: 0 } }],
  },
  {
    id: 'hotbranch',
    name: 'The Hot Ocean',
    icon: '♨️',
    brief: 'A world with a full ocean under a star you control. There is a stable climate on the far side of 50 °C — a sea that stays a sea at bath temperature — but the only way in is slowly, and the doorway is narrow. Get this planet past 50 °C with its ocean intact, still liquid and still there sixty million years later.',
    hint: 'Smooth starlight changes are already on, so one drag walks the star up over twenty million years instead of jumping — let the clock run first, because a change made at t = 0 still jumps. 1.28 S⊕ is not enough and stops at 46 °C. 1.30 is the door: 55 °C and a sea. 1.36 goes through it to 98 °C, a moist greenhouse losing its water. 1.40 does not stop at all, and any target reached in one jump takes the ocean into the sky, the albedo with it, and there is no way back.',
    // Three things here, and none is decoration.
    //
    // The volcanoes run. They used to be dead, on the argument that a fixed CO2
    // inventory made the starlight the only variable -- but weathering does not
    // stop just because nothing is erupting, so the world stripped its own CO2
    // and was 90% ice in EIGHT HUNDRED THOUSAND YEARS. Not a scenario, a trap:
    // the fastest possible player lost. With the carbon cycle running it sits at
    // 14 C indefinitely and waits to be played with.
    //
    // The cost of that is honesty about the target. With the thermostat working
    // this model's hot branch tops out near 52 C rather than the 62 C a world
    // with no volcanism reaches, so the goal is 50 C and the brief says 50 C.
    // The literature is comfortably above both -- Wolf & Toon (2015) run to
    // 362.8 K and Popp et al. (2016) sit above 330 K.
    //
    // `smoothInsolation` is on because the scenario is *about* the difference
    // between walking and jumping, and until that control existed the only way
    // to walk was sixteen manual drags. It can still be unticked, which is the
    // fastest way to see the point.
    //
    // The sixty-million-year floor in `check` is what makes "hold it" mean
    // something. A walk to 1.40 passes through 50 C in quasi-equilibrium on its
    // way to a runaway and satisfied every instantaneous test -- temperature,
    // ocean, even a closed energy balance, because a slow enough walk tracks
    // equilibrium the whole way up. Only time tells the branch from the road to
    // the cliff.
    params: { ...EARTH, realisticGeology: true, insolation: 1.00, outgassing: 1, emissions: 0, fossilUsed: 0,
              biosphere: 0, smoothInsolation: true, startT: 288 },
    limit: 1e8,
    check: (w) => w.time > 6e7 && w.diag.Tmean > 323 && w.diag.Tmean < 373 && w.water.ocean > 0.8,
    fail: (w) => w.water.ocean < 0.5 && w.diag.Tmean > 400,
    // Measured through the clock's own walk: 1.28 → 46 °C (short), 1.30 →
    // 55 °C (wins at 60 Myr), 1.36 → 98 °C moist, 1.40 → runaway at 19.5 Myr.
    solution: [{ at: 1e6, patch: { insolation: 1.30 } }],
  },
];
