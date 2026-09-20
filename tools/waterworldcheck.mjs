import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/clock.js';
import { PRESETS } from '../src/game/presets.js';
import { captureWorld, applyWorld } from '../src/game/snapshot.js';
import { parseSaveFile } from '../src/game/saves.js';
import { derive, waterForShareOfMass } from '../src/physics/planet.js';
import { maxStep, update, tendency, radiativeDamping } from '../src/physics/climate.js';
import { escapeRates, stepVolatiles } from '../src/physics/volatiles.js';
import { classify, reasonText } from '../src/physics/classify.js';
import { YEAR, G_GRAV, M_EARTH, psatH2O } from '../src/physics/constants.js';
import { steamEscape, waterworldFlux, waterLifetime, waterworldActive, waterworldRadius, WATER_SUBLIMATION_HEAT } from '../src/physics/waterworld.js';

let passed = 0;
const check = (name, fn) => { fn(); console.log('PASS', name); passed++; };
const near = (a,b,r=1e-9) => assert.ok(Math.abs(a-b) <= r*Math.max(1,Math.abs(b)), `${a} != ${b}`);
const build = key => new Simulation({...PRESETS[key].params});

check('paper equations 1, 8-11, with explicit SI units', () => {
  const p = PRESETS.smallWaterworld.params, d = derive(p), T = 300;
  near(waterworldRadius(p.mass) / 6371000, 1.258 * p.mass**0.302);
  const cs = Math.sqrt(461.5*T), rc = d.g*d.R*d.R/(2*cs*cs);
  const expected = psatH2O(T)/(cs*cs)*cs*(rc/d.R)**2*Math.exp(-0.5+d.g*d.R*d.R/(cs*cs)*(1/rc-1/d.R));
  const esc = steamEscape(T,d.g,d.R);
  assert.ok(Math.abs(esc.parkerFlux/expected-1)<1e-12);
  assert.ok(esc.flux>0 && esc.flux<=esc.parkerFlux);
  near(esc.sonicRadius,rc);
  near(esc.cooling,(d.g*d.R+2.5e6)*esc.flux);
  near(waterLifetime(p.water*d.eoColumn,esc.flux),p.water*d.eoColumn/esc.flux/YEAR);
});
check('Figure 2 approximation expands LW more than SW', () => {
  const R=waterworldRadius(.12),d={R,g:G_GRAV*M_EARTH*.12/R**2};
  const f = waterworldFlux(400,d.g,d.R);
  near(f.longwave,1.195); near(f.shortwave,1.068);
  assert.ok(f.longwave>f.shortwave && f.shortwave>1);
});
check('expanded equilibrium irradiation rises beyond the plane-parallel plateau', () => {
  const d = derive(PRESETS.smallWaterworld.params);
  const required = T => {const f=waterworldFlux(T,d.g,d.R);return 4*(f.emitted+f.cooling)/((1-f.albedo)*f.shortwave);};
  assert.ok(required(400)>required(300)); assert.ok(required(500)>required(400));
});
check('thermal escape responds to binding energy and temperature, not XUV', () => {
  const d = derive(PRESETS.smallWaterworld.params);
  assert.ok(steamEscape(400,d.g,d.R).flux>steamEscape(300,d.g,d.R).flux);
  assert.ok(steamEscape(300,d.g/2,d.R).flux>steamEscape(300,d.g,d.R).flux);
  const w=build('evaporatingWaterworld').world, rate=escapeRates(w).water;
  w.params.xuvFraction=0; update(w,0); near(escapeRates(w).water,rate);
  assert.equal(waterworldActive({...w.params,lowGravityWaterworld:false},1,0),true);
  assert.equal(waterworldActive(w.params,1,1),true);
});
check('mass loss conserves water and produces no residual oxygen', () => {
  const w=build('evaporatingWaterworld').world, initial=w.diag.totalWater;
  const rate=escapeRates(w).water, dt=100;
  stepVolatiles(w,dt); update(w,0);
  near(w.water.lost,rate*dt/w.diag.d.eoColumn,1e-10);
  near(w.diag.totalWater+w.water.lost,initial,1e-12);
  assert.equal(w.o2,0);
});
check('energy residual and implicit damping include expansion and escape cooling', () => {
  const w=build('evaporatingWaterworld').world,d=w.diag;
  near(d.imbalance,d.absorbed+d.Fint-d.emitted-d.smallWaterworld.cooling,1e-12);
  near(tendency(w).dT[0]*d.C[0],d.imbalance,1e-10);
  const k=radiativeDamping(w)[0], T=w.T[0];
  const residual=t=>{w.T.fill(t);update(w,0);return w.diag.imbalance;};
  near(k,-(residual(T+.5)-residual(T-.5)),1e-9);
});
check('warm, short-lived and cold-start branches settle without inventing oxygen', () => {
  const temps=[];
  for(const key of ['smallWaterworld','evaporatingWaterworld','icySmallWaterworld']) {
    const s=build(key),initial=s.world.diag.totalWater;
    if(key==='evaporatingWaterworld')assert.equal(classify(s.world).id,'evaporatingWaterworld');
    for(let i=0;i<700;i++)s.stepOnce(Math.min(maxStep(s.world),1e5));
    const w=s.world; assert.ok(w.time>1e7); assert.ok(w.diag.smallWaterworld);
    assert.ok(Math.abs(w.diag.imbalance)<1e-5); assert.equal(w.o2,0);
    near(w.diag.totalWater+w.water.lost,initial,1e-10);
    temps.push(w.diag.Tmean);
    if(key==='evaporatingWaterworld') {
      assert.ok(w.water.lost>1);
      assert.equal(classify(w).id,w.diag.hasWater?'evaporatingWaterworld':'airless');
      if(!w.diag.hasWater)assert.ok(w.diag.totalWater<1e-5 && !classify(w).habitable);
    }
    if(key==='smallWaterworld')assert.equal(classify(w).id,'smallWaterworld');
    console.log(' ',key,`${w.diag.Tmean.toFixed(3)} K`,`${w.time.toExponential(3)} yr`,`${w.water.lost.toExponential(3)} EO lost`);
  }
  // The short-lived branch may already be dry by the end; its initial ocean
  // classification is checked above, not imposed after its inventory is gone.
  assert.ok(temps[0]>273.15 && temps[2]<273.15);
});
check('save/import/resume preserves mode, water and subsequent evolution', () => {
  const a=build('evaporatingWaterworld');a.runYears(10);
  const saved=parseSaveFile(JSON.stringify(captureWorld(a.world)))[0];
  assert.equal(saved.params.lowGravityWaterworld,undefined);
  const b=build('smallWaterworld');applyWorld(b,saved);
  for(let i=0;i<30;i++){a.stepOnce(10);b.stepOnce(10);}
  near(a.world.diag.Tmean,b.world.diag.Tmean,1e-12);
  near(a.world.water.lost,b.world.water.lost,1e-12);
});
check('very weak binding, finite inventory and dry limit stay finite', () => {
  for(const T of [100,200,273.15,400,600,1000,4000]) {
    const f=waterworldFlux(T,0.1,1e6,100);
    for(const k of ['flux','cooling','emitted','longwave','shortwave'])assert.ok(Number.isFinite(f[k])&&f[k]>=0,k);
    assert.ok(f.pressure<=100);
  }
  const f=waterworldFlux(300,2,3e6,0);assert.equal(f.flux,0);assert.equal(f.longwave,1);
});
check('new presets use the paper 40 percent water inventory', () => {
  for(const key of ['smallWaterworld','evaporatingWaterworld','icySmallWaterworld']) {
    const p=PRESETS[key].params;near(p.water,waterForShareOfMass(p.mass,.4));
  }
});
check('reported 19.3 C trace-vapour world is not an ocean or habitable', () => {
  const w=build('smallWaterworld').world;
  Object.assign(w.params,{mass:.045,insolation:1.288}); w.T.fill(292.45);
  w.waterInitial=18.1903;
  w.water={ocean:0,seaIce:0,landIce:0,vapour:1e-8,lost:18.1903-1e-8};
  update(w,0); const st=classify(w);
  assert.equal(w.diag.hasWater,false); assert.equal(w.diag.flooded,0);
  assert.ok(!['smallWaterworld','evaporatingWaterworld','waterworld'].includes(st.id));
  assert.equal(st.habitable,false);
  assert.doesNotMatch(reasonText(w,st),/long-lived water reservoir|thermal steam escape/);
});
check('icy preset has a calculated subglacial ocean, not a forced snowball label', () => {
  const w=build('icySmallWaterworld').world;
  assert.ok(w.diag.Fint>0);
  assert.ok(w.diag.subglacial?.ocean && w.diag.subglacial.liquidDepth>0);
  assert.equal(classify(w).id,'subglacial');
  assert.doesNotMatch(reasonText(w,classify(w)),/thermal steam escape/);
});
check('frozen vapour uses sublimation energy and a collisionless exobase', () => {
  const d=derive(PRESETS.icySmallWaterworld.params),T=220;
  const f=steamEscape(T,d.g,d.R);
  assert.equal(f.regime,'jeans');
  assert.ok(f.exobaseRadius>=d.R && f.exobaseRadius<f.sonicRadius);
  assert.ok(f.flux<1e-20 && f.flux<f.parkerFlux);
  assert.ok(Math.abs(f.cooling/f.flux-(d.g*d.R+WATER_SUBLIMATION_HEAT))<1e-6);
  const thin=steamEscape(150,d.g,d.R,1e-15);
  assert.equal(thin.regime,'jeans'); near(thin.exobaseRadius,d.R);
});
check('dry radiative limit is continuous and has no phantom water lifetime', () => {
  const d=derive(PRESETS.smallWaterworld.params);
  for(const T of [220,292.45,400]) {
    const dry=waterworldFlux(T,d.g,d.R,0),trace=waterworldFlux(T,d.g,d.R,1e-12);
    near(trace.emitted,dry.emitted,1e-9);near(trace.albedo,dry.albedo,1e-9);
    assert.equal(dry.flux,0);assert.equal(dry.cooling,0);
    assert.equal(dry.longwave,1);assert.equal(dry.shortwave,1);
  }
  assert.equal(waterLifetime(0,0),0);
  const w=build('smallWaterworld').world;
  w.water={ocean:0,seaIce:0,landIce:0,vapour:0,lost:w.waterInitial};
  update(w,0);
  assert.equal(classify(w).id,'airless');assert.equal(classify(w).habitable,false);
  assert.match(reasonText(w,classify(w)),/exhausted/);
});
check('subglacial ocean requires heat and enough actual water', () => {
  const w=build('icySmallWaterworld').world;
  w.params.internalHeat=0; update(w,0);
  assert.ok(!w.diag.subglacial?.ocean);assert.equal(classify(w).id,'snowball');
  w.params.internalHeat=.02;w.water={ocean:0,seaIce:1e-4,landIce:0,vapour:0,lost:0};
  update(w,0);assert.ok(!w.diag.subglacial?.ocean);
});
check('hot 0.049 Earth-mass ocean reaches a stable expanded-radiation balance', () => {
  const s=build('hotSmallWaterworld');
  assert.equal(s.world.params.mass,.049);
  assert.equal(classify(s.world).id,'smallWaterworld');
  for(let i=0;i<800;i++)s.stepOnce(Math.min(maxStep(s.world),1e5));
  const w=s.world,d=w.diag,f=waterworldFlux(d.Tmean,d.g,d.d.R);
  assert.ok(d.Tmean>373.15&&d.Tmean<420);
  assert.ok(d.smallWaterworld.hasSurfaceOcean && d.flooded>.99);
  assert.equal(classify(w).id,'smallWaterworld');assert.equal(classify(w).habitable,false);
  assert.ok(Math.abs(d.imbalance)<1e-5);
  assert.ok(d.smallWaterworld.cooling<1); // radiation, not mass-loss cooling, stabilises it
  const unexpanded=d.absorbed/f.shortwave-f.emitted/f.longwave-f.cooling;
  assert.ok(unexpanded>30); // flatten the radiating geometry and this equilibrium disappears
  assert.ok(radiativeDamping(w)[0]>0);
  console.log('  hot branch',d.Tmean.toFixed(3)+' K','unexpanded excess',unexpanded.toFixed(2)+' W/m2');
});
check('all three moon presets preserve measured radii and real sub-ice liquid', () => {
  for(const [key,radius] of [['europa',1560800],['ganymede',2631200],['callisto',2410300]]) {
    const s=build(key),initial=s.world.diag.totalWater;
    near(s.world.diag.d.R,radius);
    assert.equal(s.world.params.tidallyLocked,false); // locked to Jupiter, NOT the Sun
    assert.ok(s.world.params.insolation<.04);
    for(let i=0;i<400;i++)s.stepOnce(Math.min(maxStep(s.world),1e5));
    const w=s.world,d=w.diag;
    assert.ok(d.Tmean<150 && d.Tmean>60);
    assert.ok(d.subglacial.ocean && d.subglacial.liquidDepth>0 && d.subglacial.shellDepth>0);
    assert.equal(classify(w).id,'subglacial');
    assert.doesNotMatch(reasonText(w,classify(w)),/thermal steam escape/);
    near(d.totalWater+w.water.lost,initial,1e-10);
    const saved=parseSaveFile(JSON.stringify(captureWorld(w)))[0],b=build('earth');
    applyWorld(b,saved);near(b.world.diag.d.R,radius);assert.equal(classify(b.world).id,'subglacial');
    console.log(' ',key,d.Tmean.toFixed(2)+' K','ice',(d.subglacial.shellDepth/1000).toFixed(1)+' km');
  }
});
check('reported 0.045 Earth-mass long run ends dry, not falsely habitable', () => {
  const s=build('smallWaterworld');
  const p={...s.world.params,mass:.045,water:18.1903,insolation:1.288};
  s.reset(p);
  let n=0;
  while(s.world.time<5.75e9 && n++<30000)
    s.stepOnce(Math.min(maxStep(s.world),1e6,5.75e9-s.world.time));
  const w=s.world;
  assert.equal(w.time,5.75e9);
  assert.ok(w.diag.totalWater<1e-5 && w.diag.flooded===0);
  assert.equal(classify(w).id,'airless'); assert.equal(classify(w).habitable,false);
  assert.doesNotMatch(reasonText(w,classify(w)),/long-lived|steam escape/);
  near(w.diag.totalWater+w.water.lost,18.1903,1e-10);
});
console.log(`${passed} waterworld checks passed`);
