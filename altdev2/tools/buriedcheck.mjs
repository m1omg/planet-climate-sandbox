import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/clock.js';
import {PRESETS} from '../src/game/presets.js';
import {update,maxStep} from '../src/physics/climate.js';
import {stepVolatiles} from '../src/physics/volatiles.js';
import {columnLayers} from '../src/physics/ocean.js';
import {buriedOceanCover,scaleHeight} from '../src/render/atmosphere.js';
import {surfaceTemperature} from '../src/physics/surface.js';
let failures=0;
function check(name,fn){try{fn();console.log('PASS',name);}catch(e){failures++;console.error('FAIL',name,e.message);}}
function buried(){
  const s=new Simulation({...PRESETS.earth.params,water:2986.1,insolation:1.202,emissions:0,
    brightening:0,realisticGeology:false,xuvDecay:false});
  s.world.T.fill(1288.15);s.world.coldT=507.15;s.world.hotLayer=.12;update(s.world,0);return s;
}
check('a global buried ocean cannot expose continents when 12% of its column heats',()=>{
  const d=buried().world.diag;assert.ok(d.coldPool.liquidDepth>1e6);
  assert.equal(buriedOceanCover(d),1);
  assert.equal(buriedOceanCover({...d,totalWater:0}),0);
  assert.equal(buriedOceanCover({...d,hotLayer:1,coldPool:null}),0);
});
check('history distinguishes the top of buried liquid from the hot lid',()=>{
  const s=buried();s.sample();const h=s.world.history.at(-1);
  assert.equal(h.surfaceT,507.15);assert.equal(h.surfaceKind,'buried ocean');
  assert.ok(h.T>1200); // preserve the atmosphere diagnostic, do not relabel it
  const e=new Simulation(PRESETS.earth.params);e.sample();
  assert.equal(e.world.history.at(-1).surfaceT,e.world.diag.Tmean);
  assert.equal(surfaceTemperature({...s.world.diag,coldPool:null}).surfaceT,null);
  for(const id of ['dry','europa','ganymede']){
    if(!PRESETS[id])continue;
    const w=new Simulation(PRESETS[id].params).world;
    assert.equal(surfaceTemperature(w.diag).surfaceT,w.diag.Tmean);
  }
});
check('pressure ranges stay ordered across all presets and partial conversion',()=>{
  for(const p of Object.values(PRESETS))for(const hot of [null,.02,.2]){
    const s=new Simulation(p.params),w=s.world;
    if(hot!=null){w.hotLayer=hot;update(w,0);}
    const H=scaleHeight(w.diag),ls=columnLayers(w,w.diag,H*5,H);
    ls.forEach((l,i)=>{
      assert.ok(l.P.every(Number.isFinite),p.name+' '+l.kind);
      assert.ok(l.P.at(-1)>=l.P[0],p.name+' '+l.kind);
      if(i)assert.ok(Math.abs(l.P[0]-ls[i-1].P.at(-1))<1e-6*Math.max(1,l.P[0]),p.name+' '+l.kind);
    });
  }
});
check('buried continents cannot weather through a global water mantle or throttle the clock',()=>{
  const s=buried(),w=s.world;
  w.co2=.00143;w.ch4=0;update(w,0);stepVolatiles(w,0);
  assert.equal(w.weathering.W,0,'fictitious continental weathering');
  assert.ok(maxStep(w)>1000,'seven-year timestep from a nonexistent sink');
});
check('Structure exposes continuous downward pressure ranges and the rock top only',()=>{
  for(const s of [buried(),...['earth','europa','ganymede','callisto','hycean'].map(id=>new Simulation(PRESETS[id].params))]){
    const d=s.world.diag,H=scaleHeight(d),ls=columnLayers(s.world,d,H*5,H);
    for(let i=0;i<ls.length;i++){
      const l=ls[i];assert.ok(l.P?.length,l.kind+' lacks pressure');
      assert.ok(l.P.every(Number.isFinite));assert.ok(l.P[0]>=0);
      if(i)assert.ok(Math.abs(l.P[0]-ls[i-1].P.at(-1))<1e-5*Math.max(1,l.P[0]),l.kind+' discontinuity');
      if(l.kind!=='rock')assert.ok(l.P[1]>=l.P[0]);else assert.equal(l.P.length,1);
    }
    const st=d.lidded?d.coldPool:d.subglacial?.under??d.oceanBase;
    assert.ok(Math.abs(ls.at(-1).P[0]-st.basePressure)<.001*Math.max(1,st.basePressure),'floor hydrostatic pressure');
  }
});
process.exitCode=failures?1:0;
