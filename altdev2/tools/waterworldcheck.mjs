import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/clock.js';
import { PRESETS } from '../src/game/presets.js';
import { captureWorld, applyWorld } from '../src/game/snapshot.js';
import { parseSaveFile } from '../src/game/saves.js';
import { derive, waterForShareOfMass } from '../src/physics/planet.js';
import { maxStep, update, tendency, radiativeDamping } from '../src/physics/climate.js';
import { escapeRates, stepVolatiles } from '../src/physics/volatiles.js';
import { classify } from '../src/physics/classify.js';
import { YEAR, psatH2O } from '../src/physics/constants.js';
import { steamEscape, waterworldFlux, waterLifetime, waterworldActive } from '../src/physics/waterworld.js';

let passed = 0;
const check = (name, fn) => { fn(); console.log('PASS', name); passed++; };
const near = (a,b,r=1e-9) => assert.ok(Math.abs(a-b) <= r*Math.max(1,Math.abs(b)), `${a} != ${b}`);
const build = key => new Simulation({...PRESETS[key].params});

check('paper equations 1, 8-11, with explicit SI units', () => {
  const p = PRESETS.smallWaterworld.params, d = derive(p), T = 300;
  near(d.R / 6371000, 1.258 * p.mass**0.302);
  const cs = Math.sqrt(461.5*T), rc = d.g*d.R*d.R/(2*cs*cs);
  const expected = psatH2O(T)/(cs*cs)*cs*(rc/d.R)**2*Math.exp(-0.5+d.g*d.R*d.R/(cs*cs)*(1/rc-1/d.R));
  const esc = steamEscape(T,d.g,d.R);
  assert.ok(Math.abs(esc.flux/expected-1)<1e-12);
  near(esc.sonicRadius,rc);
  near(esc.cooling,(d.g*d.R+2.5e6)*esc.flux);
  near(waterLifetime(p.water*d.eoColumn,esc.flux),p.water*d.eoColumn/esc.flux/YEAR);
});
check('Figure 2 approximation expands LW more than SW', () => {
  const d = derive({...PRESETS.smallWaterworld.params,mass:0.12});
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
  assert.equal(waterworldActive({...w.params,lowGravityWaterworld:false},1,0),false);
  assert.equal(waterworldActive(w.params,1,1),false);
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
    for(let i=0;i<700;i++)s.stepOnce(Math.min(maxStep(s.world),1e5));
    const w=s.world; assert.ok(w.time>1e7); assert.ok(w.diag.smallWaterworld);
    assert.ok(Math.abs(w.diag.imbalance)<1e-5); assert.equal(w.o2,0);
    near(w.diag.totalWater+w.water.lost,initial,1e-10);
    temps.push(w.diag.Tmean);
    if(key==='evaporatingWaterworld') {assert.ok(w.water.lost>1);assert.equal(classify(w).id,'evaporatingWaterworld');}
    if(key==='smallWaterworld')assert.equal(classify(w).id,'smallWaterworld');
    console.log(' ',key,`${w.diag.Tmean.toFixed(3)} K`,`${w.time.toExponential(3)} yr`,`${w.water.lost.toExponential(3)} EO lost`);
  }
  assert.ok(temps[0]>273.15 && temps[1]>273.15 && temps[2]<273.15);
});
check('save/import/resume preserves mode, water and subsequent evolution', () => {
  const a=build('evaporatingWaterworld');a.runYears(10);
  const saved=parseSaveFile(JSON.stringify(captureWorld(a.world)))[0];
  assert.equal(saved.params.lowGravityWaterworld,true);
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
console.log(`${passed} waterworld checks passed`);
