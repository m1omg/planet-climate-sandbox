import { EARTH, PRESETS } from '../../src/game/presets.js';
import { Simulation } from '../../src/sim/clock.js';
const settle=(p,y)=>{const s=new Simulation(p);s.runYears(y);return s.world;};
console.log('does the biosphere actually die now?');
for (const [n,p] of [['Earth',{...EARTH}],
                     ['86 C moist gh',{...EARTH,co2Bar:0.393}],
                     ['794 C runaway',{...EARTH,co2Bar:178,water:2}],
                     ['biosphere 0',{...EARTH,biosphere:0}],
                     ['biosphere 3',{...EARTH,biosphere:3}]]) {
  const w=settle(p,2e5);
  console.log('  ',n.padEnd(15),'T',(w.diag.Tmean-273.15).toFixed(0).padStart(4)+'C',
    ' asked',(p.biosphere ?? 1).toFixed(2),' alive',w.diag.bio.toFixed(3),
    ' pO2',w.diag.pO2.toExponential(1));
}
console.log('\nand does it come back if the world cools?');
{ const s=new Simulation({...EARTH,co2Bar:0.393}); s.runYears(5e4);
  const hot=s.world.diag.bio;
  s.world.co2 = 280e-6*1e5/s.world.diag.g; s.runYears(3e5);
  console.log('   cooked',hot.toFixed(3),'-> after CO2 removed and 300 kyr:',
    s.world.diag.bio.toFixed(3),' at',(s.world.diag.Tmean-273.15).toFixed(0)+'C'); }
console.log('\nEarth-like preset:', JSON.stringify({emissions:PRESETS.earthlike.params.emissions,
  co2:(PRESETS.earthlike.params.co2Bar*1e6)+'ppm', bodyMap:'(none - procedural)'}));
