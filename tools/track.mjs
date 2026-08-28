// Trace a preset from its own start age to the present day, reporting the state
// every 250 Myr: how hot, how thick, how wet, and when each of those changed.
//
// This is the tool the real-planet presets are tuned against, because their
// endpoints are observations and their start states are not. Early Venus has to
// arrive at 737 K under 92 bar with no water in it; Noachian Mars has to arrive
// at 6 mbar. Both of those are a run, not a setting, and neither shows up in a
// check that only looks at where the world begins.
//
//   node tools/track.mjs earlyVenus
//   node tools/track.mjs earlyMars outgassing=0.12
//   node tools/track.mjs archean
import { Simulation } from '../src/sim/clock.js';
import { PRESETS } from '../src/game/presets.js';
import { maxStep } from '../src/physics/climate.js';

const which = process.argv[2] || 'earlyVenus';
const overrides = {};
for (const a of process.argv.slice(3)) {
  const [k, v] = a.split('=');
  overrides[k] = isNaN(Number(v)) ? v : Number(v);
}
const p = { ...PRESETS[which].params, ...overrides };
const sim = new Simulation(p);
const w = sim.world;
const start = p.startAge ?? 4.567;
const span = (4.567 - start) * 1e9;

console.log(`${which}  startAge ${start} Gyr  insol ${p.insolation}  span ${(span/1e9).toFixed(2)} Gyr`);
console.log('  age(Gyr)   T(C)    pTot(bar) pCO2   pH2O    water(EO)  ocean   fStrat');
let next = 0;
const row = () => {
  const d = w.diag;
  const water = w.water.ocean + w.water.seaIce + w.water.landIce + w.water.vapour;
  const pH2O = d.pH2O.reduce((a,b)=>a+b,0)/d.pH2O.length;
  console.log(`  ${(start + w.time/1e9).toFixed(3)}  ${(d.Tmean-273.15).toFixed(1).padStart(7)}`
    + `  ${d.pTotMean.toFixed(2).padStart(8)} ${d.pCO2.toFixed(2).padStart(6)}`
    + ` ${pH2O.toFixed(3).padStart(7)}  ${water.toFixed(4).padStart(8)}`
    + `  ${d.oceanFrac.toFixed(3)}  ${(w.escape?.fStrat ?? 0).toExponential(2)}`);
};
row();
while (w.time < span) {
  sim.stepOnce(Math.min(maxStep(w), 5e6));
  if (w.time >= next) { row(); next += 2.5e8; }
}
row();
