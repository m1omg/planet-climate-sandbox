// Fixed simulated-time comparison; never loosen physics limits to win a benchmark.
import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/clock.js';
import {PRESETS} from '../src/game/presets.js';
import {maxStep,update} from '../src/physics/climate.js';
function run(cap){
  const s=new Simulation({...PRESETS.earth.params,water:2986.1,insolation:1.202,
    co2Bar:.00028,ch4Bar:8e-7,emissions:0,fossilUsed:0,outgassing:.25,startT:286.85,
    brightening:0,realisticGeology:false,xuvDecay:false});
  const w=s.world;w.fastPhysics=true;w.T.fill(1288.15);w.coldT=507.15;w.hotLayer=.12;update(w,0);
  let steps=0;const start=performance.now();
  while(w.time<1e8 && steps<200000){s.stepOnce(Math.min(maxStep(w),cap,1e8-w.time));steps++;}
  assert.equal(w.time,1e8);
  const result={steps,ms:performance.now()-start,T:w.diag.Tmean,hot:w.hotLayer,
    coldT:w.coldT,co2:w.co2,water:w.diag.totalWater,lost:w.water.lost};
  console.log(cap,result);return result;
}
const adaptive=run(Infinity),fine=run(5000),finer=run(1000);
assert.ok(adaptive.steps<1000,'no recurrent seven-year carbon throttle');
assert.ok(Math.abs(adaptive.T-finer.T)<2.5,'adaptive temperature error');
assert.ok(Math.abs(adaptive.hot-finer.hot)<.005,'conversion fraction error');
assert.ok(Math.abs(adaptive.co2/finer.co2-1)<.03,'carbon accumulation error');
assert.ok(Math.abs(fine.T-finer.T)<.01,'fine-step convergence');
for(const r of [adaptive,fine,finer])assert.ok(Math.abs(r.water+r.lost-2986.1)<1e-7,'water conserved');
console.log('PASS buried-ocean timestep convergence and reservoir conservation');
