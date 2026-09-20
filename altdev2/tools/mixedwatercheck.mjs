import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/clock.js';
import {PRESETS} from '../src/game/presets.js';
import {waterForShareOfMass} from '../src/physics/planet.js';
import {update,radiativeDamping,maxStep} from '../src/physics/climate.js';
import {escapeRates,stepVolatiles} from '../src/physics/volatiles.js';
import {waterworldFlux} from '../src/physics/waterworld.js';
import {classify,reasonText} from '../src/physics/classify.js';
import {YEAR} from '../src/physics/constants.js';
import {captureWorld,applyWorld} from '../src/game/snapshot.js';
import {parseSaveFile} from '../src/game/saves.js';
let passed=0;
const check=(name,fn)=>{fn();console.log('PASS',name);passed++;};
const make=(co2Bar=0,mass=.005)=>new Simulation({...PRESETS.smallWaterworld.params,
  mass,water:waterForShareOfMass(mass,.4),co2Bar,startT:300});
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol*Math.max(1,Math.abs(b)),`${a} != ${b}`);
check('0.005 Earth-mass oceans retain low-gravity treatment with CO2',()=>{
  for(const mass of [.005,.00999,.01001,.02])for(const co2 of [0,1e-6,.00099,.00101,.1,1,10]){
    const w=make(co2,mass).world,d=w.diag;
    assert.ok(d.smallWaterworld,`${mass} Earth masses, ${co2} bar CO2`);
    assert.ok(d.smallWaterworld.longwave>1 && d.smallWaterworld.shortwave>1);
    assert.ok(Number.isFinite(d.imbalance));
    if(co2>0)assert.equal(d.smallWaterworld.inDomain,false);
  }
});
check('CO2 affects opacity and molecular weight without the former 1 mbar cliff',()=>{
  const a=make(.000999).world.diag,b=make(.001001).world.diag,c=make(.1).world.diag;
  assert.ok(Math.abs(a.emitted-b.emitted)<1);
  assert.ok(Math.abs(a.absorbed-b.absorbed)<1);
  assert.ok(Math.abs(c.emitted-a.emitted)>1);
  const pure=make().world.diag;
  assert.ok(c.smallWaterworld.meanMolarMass>pure.smallWaterworld.meanMolarMass);
  assert.notEqual(c.smallWaterworld.longwave,pure.smallWaterworld.longwave);
});
check('mixed flux, damping and diagnostics use the same composition',()=>{
  const w=make(.1).world,d=w.diag,T=d.Tmean;
  const f=waterworldFlux(T,d.g,d.d.R,d.smallWaterworld.availablePressure,d.smallWaterworld.gases);
  near(d.emitted,f.emitted);near(d.smallWaterworld.cooling,f.cooling);
  const k=radiativeDamping(w)[0];
  const net=t=>{w.T.fill(t);update(w,0);return w.diag.imbalance;};
  near(k,-(net(T+.5)-net(T-.5)));
});
check('mixed escape retains gas loss and conserves water without false oxygen from bulk loss',()=>{
  const w=make(.1).world,initial=w.diag.totalWater,esc=escapeRates(w),dg=w.diag;
  assert.ok(esc.background>0 && esc.bulkWater>0 && esc.water>=esc.bulkWater);
  const pure=waterworldFlux(dg.Tmean,dg.g,dg.d.R,dg.smallWaterworld.availablePressure);
  assert.ok(dg.smallWaterworld.bulkEscape<pure.flux);
  near(dg.smallWaterworld.lifetime,initial*dg.d.eoColumn/esc.water);
  near(esc.bulkWater,dg.smallWaterworld.bulkEscape*YEAR);
  const dt=Math.min(.01,initial*dg.d.eoColumn/esc.water/10);
  stepVolatiles(w,dt);update(w,0);
  near(w.diag.totalWater+w.water.lost,initial);
  assert.ok(w.o2 <= w.water.lost*dg.d.eoColumn*16/18+1e-8);
});
check('trace gas cannot pin a bulk wind, and entrained background is actually removed',()=>{
  const pure=make().world,trace=make(1e-10).world;
  near(trace.diag.smallWaterworld.bulkEscape,pure.diag.smallWaterworld.bulkEscape,1e-6);
  near(trace.diag.smallWaterworld.lifetime,pure.diag.smallWaterworld.lifetime,1e-6);
  const w=make().world;
  w.params.xuvFraction=0;w.n2=.001*1e5/w.diag.g;update(w,0);
  const esc=escapeRates(w),before=w.n2,dt=maxStep(w);
  assert.ok(esc.bulkGas>0 && dt<=.05*before/esc.bulkGas*(1+1e-12));
  stepVolatiles(w,dt);
  near(w.n2,before-esc.bulkGas*dt);
  assert.ok(w.n2>=0 && w.n2<before);
});
check('dry CO2 worlds are not called airless or pure-steam oceans',()=>{
  const w=make(1).world;
  w.water={ocean:0,seaIce:0,landIce:0,vapour:0,lost:w.waterInitial};update(w,0);
  assert.notEqual(classify(w).id,'airless');
  assert.doesNotMatch(reasonText(w,classify(w)),/thermal steam escape|long-lived/);
  assert.equal(escapeRates(w).bulkWater,0);
});
check('small mixed worlds advance with finite state and conserved water',()=>{
  for(const co2 of [.001,.1,1]){
    const s=make(co2),initial=s.world.diag.totalWater;
    for(let i=0;i<100;i++)s.stepOnce(Math.min(maxStep(s.world),100));
    assert.ok(s.world.time>0);assert.ok([...s.world.T].every(Number.isFinite));
    near(s.world.diag.totalWater+s.world.water.lost,initial);
  }
});
check('mixed gas and escape state survive save/import and continuation',()=>{
  const a=make(.1);a.stepOnce(.001);
  const saved=parseSaveFile(JSON.stringify(captureWorld(a.world)))[0],b=make();
  applyWorld(b,saved);
  for(let i=0;i<20;i++){a.stepOnce(.001);b.stepOnce(.001);}
  near(a.world.diag.Tmean,b.world.diag.Tmean,1e-12);
  near(a.world.water.lost,b.world.water.lost,1e-12);
  near(a.world.co2,b.world.co2,1e-12);
  near(escapeRates(a.world).bulkGas,escapeRates(b.world).bulkGas,1e-12);
});
check('rapid-loss transient agrees with four-times finer time stepping',()=>{
  for(const co2 of [.001,.1]){
    const runs=[];
    for(const factor of [1,.25]){
      const s=make(co2);let n=0;
      while(s.world.time<1 && n++<10000)
        s.stepOnce(Math.min(maxStep(s.world)*factor,1-s.world.time));
      assert.equal(s.world.time,1);runs.push(s.world);
    }
    assert.ok(Math.abs(runs[0].diag.Tmean-runs[1].diag.Tmean)<.6);
    assert.ok(Math.abs(runs[0].diag.totalWater/runs[1].diag.totalWater-1)<.001);
    assert.ok(Math.abs(runs[0].diag.pCO2-runs[1].diag.pCO2)<.001);
  }
});
console.log(`${passed} mixed-waterworld checks passed`);
