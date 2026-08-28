// How fast is a step, and does making it faster change the answer?
//
// A fixed, deterministic workload: seven worlds chosen to exercise different
// parts of the model -- a temperate Earth, a resurfacing Venus, two tidally
// locked worlds, a desert, a Titan and a super-Earth -- each stepped a fixed
// number of times regardless of how much simulated time that covers. Wall-clock
// per step is the number to watch.
//
// The checksum is the point of the tool as much as the timing is. Pure
// optimisation must leave it bit-identical; anything that reassociates floating
// point (writing th^1.5 as th*sqrt(th), say) moves it in the last few digits,
// and that is the signal to go and run the full battery rather than trust the
// stopwatch. A change that moves it in the first few digits is not an
// optimisation, whatever it did to the clock.
//
// Run:  node tools/bench.mjs
import { Simulation } from '../src/sim/clock.js';
import { PRESETS } from '../src/game/presets.js';
import { maxStep } from '../src/physics/climate.js';
const WORLDS = ['earth', 'earlyVenus', 'eyeball', 'trappist1e', 'dune', 'titan', 'superEarth'];
const STEPS = 40000;
let checksum = 0;
const t0 = process.hrtime.bigint();
for (const k of WORLDS) {
  const s = new Simulation({ ...PRESETS[k].params });
  const w = s.world;
  for (let i = 0; i < STEPS; i++) s.stepOnce(Math.min(maxStep(w), 5e6));
  checksum += w.diag.Tmean + w.time * 1e-9 + w.diag.pCO2 * 1e3;
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`${(ms).toFixed(0)} ms for ${WORLDS.length * STEPS} steps` +
  `  (${(ms * 1e3 / (WORLDS.length * STEPS)).toFixed(1)} us/step)`);
console.log('checksum', checksum.toFixed(12));
