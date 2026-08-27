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
import { EARTH } from '../src/game/presets.js';

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

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`\nStep-size convergence over ${YEARS.toExponential(0)} yr\n`);
  let bad = 0;
  for (const og of [1, 2, 2.6, 2.8, 3.5, 5, 8]) {
    if (!sweep(`volcanism ${og}x`, { ...EARTH, outgassing: og }).ok) bad++;
  }
  console.log(bad ? `\n${C.r}${bad} world(s) do not converge${C.x}\n`
                  : `\n${C.g}every world converges${C.x}\n`);
}
