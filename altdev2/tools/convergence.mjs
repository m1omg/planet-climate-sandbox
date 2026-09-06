// Does the answer depend on the step size?
//
// A model that integrates well gives the same climate whichever step sequence
// it took to get there. One that is riding a basin boundary does not: shorten
// the cap and the planet lands somewhere else entirely. That is not an accuracy
// problem to be tuned away with a smaller number -- it means the trajectory is
// passing so close to a separatrix that rounding decides the outcome, and the
// answer the model gives today is a property of the step sequence rather than
// of the physics.
//
// Run:  node tools/convergence.mjs [years]
import { Simulation } from '../src/sim/clock.js';
import { maxStep } from '../src/physics/climate.js';
import { EARTH, PRESETS } from '../src/game/presets.js';

const YEARS = Number(process.argv[2] ?? 3e7);
const CAPS = [5e6, 1e6, 2e5, 5e4, 1e4, 2e3];

// Deliberately NOT sim.runYears: that clamps the last step to land exactly on
// the target, which perturbs the sequence in its own right.
function runTo(params, years, cap) {
  const s = new Simulation(params);
  const w = s.world;
  let guard = 0;
  while (w.time < years && guard++ < 3e6) {
    s.stepOnce(Math.min(maxStep(w), cap, years - w.time));
  }
  return { w, steps: guard };
}

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };

export function sweep(label, params, years = YEARS, caps = CAPS) {
  const rows = caps.map((cap) => {
    const { w, steps } = runTo(params, years, cap);
    return { cap, steps, T: w.diag.Tmean, ice: w.diag.iceMean,
             co2: w.diag.pCO2, ch4: w.diag.pCH4 };
  });
  const Ts = rows.map((r) => r.T);
  const spread = Math.max(...Ts) - Math.min(...Ts);
  // Convergence is a statement about the REFINED end, not about every cap ever
  // tried. A deliberately coarse cap is allowed to be wrong -- that is what
  // makes it coarse. What must not happen is the answer still moving once the
  // steps are small, because then there is no answer, only a step sequence.
  //
  // So the criterion is the standard grid-refinement one: take the finest three
  // caps and ask whether they agree. Judging on the full spread instead called
  // worlds unconverged that were landing on the same tenth of a degree three
  // times over, purely because a five-million-year cap wobbled a kelvin -- and
  // that hid the real failures, which are hundreds of kelvin wide.
  const fine = Ts.slice(-3);
  const conv = Math.max(...fine) - Math.min(...fine);
  const ok = conv < 0.5;
  const tag = ok ? `${C.g} ok ${C.x}` : `${C.r}SPLIT${C.x}`;
  console.log(`${tag} ${label.padEnd(30)} converged ${conv.toFixed(2).padStart(7)} K` +
    `   ${C.d}(full spread ${spread.toFixed(2)} K)${C.x}`);
  for (const r of rows) {
    console.log(`      ${C.d}cap ${r.cap.toExponential(0).padStart(7)}  ` +
      `${(r.T - 273.15).toFixed(1).padStart(7)} C  ice ${(r.ice * 100).toFixed(0).padStart(3)}%  ` +
      `CO2 ${r.co2.toExponential(2)}  CH4 ${r.ch4.toExponential(2)}  ${String(r.steps).padStart(7)} steps${C.x}`);
  }
  return { ok, spread, conv, rows };
}

// A world that is KNOWN not to converge, reported and not counted.
//
// The same idea as calibrate.mjs's GAP rows and for the same reason: a failure
// that is understood, written down and watched is worth more than one that has
// been quietly removed from the sweep. These exist so that nobody can fix them
// by accident and not notice, and so that anyone making the solver faster finds
// out immediately whether they have made them better or worse.
export function known(label, params, why, years = YEARS, caps = CAPS) {
  const r = sweep(label, params, years, caps);
  console.log(`      ${C.y}KNOWN${C.x} ${C.d}${why}${C.x}`);
  return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`\nStep-size convergence over ${YEARS.toExponential(0)} yr\n`);
  let bad = 0;
  for (const og of [1, 2, 2.6, 2.8, 3.5, 5, 8]) {
    if (!sweep(`volcanism ${og}x`, { ...EARTH, outgassing: og }).ok) bad++;
  }

  // ---- tidally locked worlds ---------------------------------------------
  //
  // These were not in the sweep, and they should have been from the start. The
  // volcanism ladder is an Earth with the volcanoes turned up; nothing here was
  // watching the class of world the model is slowest on, which is exactly the
  // class where the step size is doing the most work.
  //
  // What they show is that the crawl is load-bearing. A settled locked world
  // takes one-year steps because `eqDistance` divides by radiative damping and
  // ignores that a band is held by its neighbours -- fix that, and the clock
  // speeds up by two orders of magnitude and these worlds move onto a 474 C
  // branch that the finest steps say is wrong. The slowness is what has been
  // keeping them on the right branch, and it is not a fix, it is a symptom
  // shared with whatever is really wrong underneath.
  //
  // See src/selftest.js, "A settled tidally locked world does not crawl", for
  // the diagnosis and for what a fix has to survive.
  console.log('');
  known('locked eyeball, no carbon', {
    ...PRESETS.eyeball.params, biosphere: 1, outgassing: 0, co2Bar: 1e-7,
  }, 'was 508 K apart -- cold and wet at three caps, 474 C and dry at two others. ' +
     'It converges as of the optimisation pass, and that is luck rather than a ' +
     'fix: nothing about its physics changed, a rounding difference in psatH2O ' +
     'moved it off the separatrix, and it can move back. Watched, not solved.');
  known('locked eyeball', { ...PRESETS.eyeball.params },
    'the same world with its carbon cycle running.');
  known('TRAPPIST-1e', { ...PRESETS.trappist1e.params },
    'the slowest world in the game: 4e6 yr/s against Earth\'s 8e8.');

  console.log(bad ? `\n${C.r}${bad} world(s) do not converge${C.x}` +
                    ` ${C.d}(known failures above are reported, not counted)${C.x}\n`
                  : `\n${C.g}every world converges${C.x}` +
                    ` ${C.d}(known failures above are reported, not counted)${C.x}\n`);
}
