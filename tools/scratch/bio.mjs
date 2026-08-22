import { EARTH } from '../../src/game/presets.js';
import { Simulation } from '../../src/sim/clock.js';
import { photosynthesis } from '../../src/physics/volatiles.js';
for (const [n,p] of [['86 C moist gh',{...EARTH,co2Bar:0.393,insolation:1.0}],
                     ['794 C runaway',{...EARTH,co2Bar:178,water:2}]]) {
  const s=new Simulation(p); s.runYears(2e4);
  console.log('  ',n.padEnd(15),'T',(s.world.diag.Tmean-273.15).toFixed(0)+'C',
    ' photosynthesis',(photosynthesis(s.world)*100).toFixed(1)+'%',
    ' pO2',s.world.diag.pO2.toFixed(3));
}
