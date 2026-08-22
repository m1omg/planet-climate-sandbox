import { EARTH } from '../../src/game/presets.js';
import { Simulation } from '../../src/sim/clock.js';
const settle=(p,y)=>{const s=new Simulation(p);s.runYears(y);return s.world;};
for (const m of [1,3.5,5]) {
  const w=settle({...EARTH, mass:m, insolation:4, outgassing:20, water:3}, 5e9);
  console.log('  mass',m,'->',w.diag.Tmean.toFixed(0)+'K ('+(w.diag.Tmean-273.15).toFixed(0)+'C)',
    ' pCO2',w.diag.pCO2.toFixed(0)+' bar');
}
