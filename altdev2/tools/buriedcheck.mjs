import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/clock.js';
import {PRESETS} from '../src/game/presets.js';
import {update,maxStep} from '../src/physics/climate.js';
import {stepVolatiles} from '../src/physics/volatiles.js';
import {columnLayers} from '../src/physics/ocean.js';
import {buriedOceanCover,scaleHeight} from '../src/render/atmosphere.js';
import {surfaceTemperature} from '../src/physics/surface.js';
import {classify} from '../src/physics/classify.js';
const classifyId = (w) => classify(w).id;
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

// ---- the label has to match the column ------------------------------------
// Three faults reported from play on one world (10 M+, 2986 EO, 20 bar N2, no
// hydrogen), all of the same shape: a name or a picture asserting something the
// column solve flatly contradicts.
const REPORTED = {...PRESETS.earth.params, mass:10, water:2986.1, insolation:1.91,
  xuvFraction:0.00000306144, n2Bar:20, o2Bar:0.210064, co2Bar:0.00373358,
  ch4Bar:0.00000222286, internalHeat:0.088502, brightening:0};
const at = (yrs) => { const s = new Simulation({...REPORTED}); s.runYears(yrs); return s.world; };
const drawnLiquid = (w) => {
  const dg = w.diag;
  return columnLayers(w, dg, 5*scaleHeight(dg), scaleHeight(dg))
    .filter((l) => l.kind === 'ocean').reduce((a, l) => a + l.metres, 0);
};
const drawnBelowLid = (w) => {
  const dg = w.diag;
  const L = columnLayers(w, dg, 5*scaleHeight(dg), scaleHeight(dg));
  const i = L.findIndex((l) => l.kind === 'interface' || l.kind === 'ocean'
    || /^boundary|^ice/.test(l.kind));
  return i < 0 ? 0 : L.slice(i).filter((l) => l.kind !== 'rock')
    .reduce((a, l) => a + l.metres, 0);
};

// steamRunaway's own blurb says "the sea has already gone into the sky", and
// the branch was `T > 420 && hasWater` -- temperature and nothing else. At
// 100 kyr this world is 431 K with 0.0008% of its water airborne, 2986 oceans in
// the reservoir and 47.9 km of liquid ocean in the cross-section, and it was
// called a Steam Runaway Greenhouse. The comment above that branch already
// states the intent ("all of its water really is in the sky"); it was never
// tested for.
check('a runaway is not named for a sea in the sky while the sea is still liquid', () => {
  const w = at(1e5);
  const id = classifyId(w);
  assert.ok(drawnLiquid(w) > 1e4, `expected a drawn ocean, got ${drawnLiquid(w)} m`);
  // Not "some vapour exists" -- essentially none of the water is in the sky.
  assert.ok(w.water.vapour < 1e-4 * w.diag.totalWater,
    `${w.water.vapour.toFixed(3)} EO airborne of ${w.diag.totalWater.toFixed(0)}`);
  assert.notEqual(id, 'steamRunaway');
});

// ...and Buried Ocean's blurb says "what is left is liquid". By 2.2 Myr the
// pool holds no liquid: liquidDepth 0, and 1313 km of ice VII at 138 C under
// the lid -- solid from pressure, not from cold. The
// name survived on `w.water.ocean > 0.02 * water` -- a reservoir total, 2860
// oceans of it -- which is the same reading-the-reservoir-not-the-column fault
// the entry gate had.
check('a buried ocean is not named for liquid once its pool is all ice VII', () => {
  const w = at(2.4e6);
  assert.equal(drawnLiquid(w), 0, 'expected no liquid drawn');
  assert.ok((w.diag.coldPool?.iceDepth ?? 0) > 1e6, 'expected a deep ice floor');
  assert.notEqual(classifyId(w), 'buriedOcean');
});

// ...and the picture must not drop it. columnLayers' lid branch was gated on
// `cp.liquidDepth > 0`, so a pool with no liquid left rendered as NOTHING and the
// cross-section put supercritical fluid straight onto rock -- 1313 km of ice
// VII missing from a 1300 km column.
check('an all-ice pool under a lid is still drawn, rather than vanishing', () => {
  const w = at(2.4e6);
  const ice = w.diag.coldPool?.iceDepth ?? 0;
  assert.ok(ice > 1e6, `expected ice, got ${ice}`);
  assert.ok(drawnBelowLid(w) > 0.5 * ice,
    `${(ice/1000).toFixed(0)} km of ice VII under the lid, ${(drawnBelowLid(w)/1000).toFixed(0)} km drawn`);
});
