// Regression probes for imported saves and automatic-model boundaries.
import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/clock.js';
import {PRESETS} from '../src/game/presets.js';
import {waterForShareOfMass,waterMassFraction,waterShareOfMass,MAX_WATER_FRACTION} from '../src/physics/planet.js';
import {EO_COLUMN} from '../src/physics/constants.js';
import {MAX_BASIN_DEPTH} from '../src/physics/hypsometry.js';
import {captureWorld,applyWorld} from '../src/game/snapshot.js';
import {parseSaveFile} from '../src/game/saves.js';
import {escapeRates} from '../src/physics/volatiles.js';
import {update,radiativeDamping,maxStep} from '../src/physics/climate.js';
import {meltingTemperature,meltingTemperatureIh,freezingDepression} from '../src/physics/ocean.js';
let passed=0,failed=0;
function check(name,fn){try{fn();passed++;console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,e.message);}}
check('invalid JSON numbers are dropped, not carried as null scalars',()=>{
  const w=parseSaveFile(JSON.stringify({params:{mass:'bad',insolation:1.2},
    T:[288,'hot',290],water:{ocean:1,vapour:null},time:'soon',coldT:Infinity}))[0];
  assert.equal(w.params.mass,undefined);assert.equal(w.params.insolation,1.2);
  assert.equal(w.T,undefined);assert.equal(w.water.vapour,undefined);
  assert.equal(w.time,undefined);assert.equal(w.coldT,undefined);
});
check('valid water, atmosphere, temperature and solver state resume identically',()=>{
  for(const id of ['earth','hycean','icySmallWaterworld','hotSmallWaterworld']){
    const a=new Simulation({...PRESETS[id].params}),b=new Simulation({...PRESETS.earth.params});
    a.stepOnce(.1);
    const shot=captureWorld(a.world),parsed=parseSaveFile(JSON.stringify(shot))[0];
    applyWorld(b,parsed);
    assert.deepEqual(captureWorld(b.world),shot,id+' restored');
    for(let i=0;i<10;i++){a.stepOnce(.1);b.stepOnce(.1);}
    assert.deepEqual(captureWorld(b.world),captureWorld(a.world),id+' continued');
  }
});
const base={...PRESETS.smallWaterworld.params,mass:.04,water:waterForShareOfMass(.04,.4),startT:300};
const cases=[...['.12','.2','.3'].map(Number).map(x=>['mass',x]),
  ...[4800,5200,6200,6600].map(x=>['starTemp',x]),
  ...[1,2].map(x=>['water',x*MAX_BASIN_DEPTH*1000*.04**.54/EO_COLUMN])];
for(const [key,edge] of cases)check(key+' boundary has no finite flux or reservoir-rate jump',()=>{
  const worlds=[-1,1].map(sign=>new Simulation({...base,[key]:edge*(1+sign*1e-7)}).world);
  const ds=worlds.map(w=>w.diag),rates=worlds.map(escapeRates);
  const values=d=>[d.emitted,d.absorbed,d.imbalance,d.RH,...d.S,...d.alb,...d.pH2O];
  const a=values(ds[0]),b=values(ds[1]);
  const jump=Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
  console.log('  boundary',key,edge,'max diagnostic jump',jump);
  assert.ok(jump<.01,key+': '+jump);
  for(const k of ['water','background','nonThermal','envelope'])
    assert.ok(Math.abs(rates[0][k]-rates[1][k])<1e-5*Math.max(1,Math.abs(rates[0][k])),k);
});
check('overlap damping differentiates the actual flux without changing state',()=>{
  for(const mass of [.15,.2,.29]){
    const w=new Simulation({...base,mass}).world;
    const before=captureWorld(w),k=Array.from(radiativeDamping(w));
    assert.deepEqual(captureWorld(w),before);
    const i=7,T=w.T[i];
    const net=t=>{w.T[i]=t;update(w,0);const d=w.diag;
      return d.olr[i]+d.escapeCooling[i]-d.S[i]*d.swTrans*(1-d.alb[i])*d.swScale[i];};
    assert.ok(Math.abs(k[i]-(net(T+.5)-net(T-.5)))<1e-8);
  }
});
check('nearby masses cross the old boundary without a spurious climate jump',()=>{
  for(const edge of [.12,.2,.3]){
    const runs=[-1,1].map(sign=>{
      const mass=edge+sign*1e-6;
      const s=new Simulation({...base,mass,water:waterForShareOfMass(mass,.4)});
      const initial=s.world.diag.totalWater;let n=0;
      while(s.world.time<1000 && n++<2000)
        s.stepOnce(Math.min(maxStep(s.world),1000-s.world.time));
      assert.equal(s.world.time,1000);
      assert.ok(Math.abs(s.world.diag.totalWater+s.world.water.lost-initial)<1e-8);
      return s.world.diag.Tmean;
    });
    assert.ok(Math.abs(runs[0]-runs[1])<.02,`${edge}: ${runs}`);
  }
});
check('fresh and salty subglacial shells use absolute melting-point depression',()=>{
  for(const salinity of [0,35]){
    const w=new Simulation({...PRESETS.europa.params,salinity}).world,sh=w.diag.subglacial;
    assert.ok(sh.ocean);
    assert.ok(Math.abs(sh.baseT-(meltingTemperatureIh(sh.basePressure)-freezingDepression(salinity)))<.02);
  }
});
check('cold subglacial liquid stops at the high-pressure melting curve',()=>{
  const w=new Simulation({...PRESETS.callisto.params}).world,sh=w.diag.subglacial;
  const under=sh.under;
  assert.ok(under.iceDepth>0 && under.liquidDepth>0);
  assert.ok(Math.abs(under.baseTemperature-meltingTemperature(under.pMelt))<.05,
    `floor ${under.baseTemperature} K vs melt ${meltingTemperature(under.pMelt)} K`);
});
check('insufficient heat cannot invent liquid below a cold high-pressure shell',()=>{
  const w=new Simulation({...PRESETS.callisto.params,internalHeat:.003}).world;
  w.T.fill(97);update(w,0);
  assert.equal(w.diag.subglacial.liquidDepth,0);
  assert.equal(w.diag.subglacial.ocean,false);
});
check('water-rich presets have bounded mantles and hydrostatically consistent floors',()=>{
  for(const id of ['smallWaterworld','evaporatingWaterworld','icySmallWaterworld',
    'hotSmallWaterworld','europa','ganymede','callisto']){
    const w=new Simulation({...PRESETS[id].params}).world,d=w.diag;
    assert.ok(waterMassFraction(w.params.mass,w.params.water)>0,id);
    assert.ok(waterShareOfMass(w.params.mass,w.params.water)<=MAX_WATER_FRACTION,id);
    const sh=d.subglacial,ob=sh?.under??d.oceanBase;
    const col=sh?.under?sh.oceanKg:(w.water.ocean+w.water.seaIce)*d.d.eoColumn/Math.max(d.flooded,1e-3);
    const top=sh?.under?sh.basePressure:d.pTotMean*1e5;
    assert.ok(Math.abs(ob.basePressure-(top+col*d.g))<1e-6*Math.max(1,ob.basePressure),id+' pressure');
    assert.ok(ob.liquidDepth>=0 && ob.iceDepth>=0,id);
    if(ob.iceDepth>0)assert.ok(ob.basePressure>=ob.pMelt,id+' ice floor');
  }
});
console.log(`${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
