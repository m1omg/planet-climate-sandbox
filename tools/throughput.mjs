// Simulated years per wall-clock second, per preset -- which is the number the
// player actually feels, and the one us/step cannot tell you. A change that
// takes bigger steps costs more per step and still wins; a change that takes
// smaller ones is the crawl this exists to measure.
import { Simulation } from '../src/sim/clock.js';
import { PRESETS } from '../src/game/presets.js';
import { maxStep } from '../src/physics/climate.js';

const WORLDS = process.argv[2] ? process.argv[2].split(',')
  : ['earth', 'earlyVenus', 'eyeball', 'trappist1e', 'dune', 'titan', 'superEarth', 'earlyEarth'];
const BUDGET = 2500;   // ms per world
console.log('  world           yr/s        worst step (yr)   steps');
for (const k of WORLDS) {
  const s = new Simulation({ ...PRESETS[k].params });
  const w = s.world;
  const t0 = process.hrtime.bigint();
  let steps = 0, worst = Infinity;
  while (Number(process.hrtime.bigint() - t0) / 1e6 < BUDGET) {
    for (let i = 0; i < 200; i++) {
      const dt = Math.min(maxStep(w), 5e6);
      worst = Math.min(worst, dt);
      s.stepOnce(dt); steps++;
    }
  }
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(`  ${k.padEnd(14)} ${(w.time / secs).toExponential(2).padStart(9)}`
    + `   ${worst.toExponential(2).padStart(12)}   ${String(steps).padStart(7)}`);
}
