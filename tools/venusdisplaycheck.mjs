import assert from 'node:assert/strict';
import {Simulation} from '../src/sim/clock.js';
import {PRESETS} from '../src/game/presets.js';
import {update} from '../src/physics/climate.js';
import {coldPoolStructure,columnLayers} from '../src/physics/ocean.js';
import {buriedOceanCover,scaleHeight} from '../src/render/atmosphere.js';
import {surfaceTemperature,temperatureHistory} from '../src/physics/surface.js';
import {classify,reasonText} from '../src/physics/classify.js';
let failed=0;
const check=(name,fn)=>{try{fn();console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,e.message);}};
function venus(){
 const s=new Simulation(PRESETS.earlyVenus.params),w=s.world;
 w.T.fill(649.069);w.coldT=646.096;w.hotLayer=.0047044;
 w.water={ocean:0,seaIce:0,landIce:0,vapour:.1074311,lost:.0005689};
 update(w,0);return s;
}
check('the screenshot cannot invent 327 metres of 373 C liquid at 31 bar',()=>{
 const w=venus().world,d=w.diag,H=scaleHeight(d);
 assert.ok(d.pTotMean<60);
 assert.equal(d.coldPool.liquidDepth,0);
 assert.equal(columnLayers(w,d,5*H,H).some(l=>l.kind==='ocean'),false);
 assert.notEqual(classify(w).id,'buriedOcean');
 assert.ok(!reasonText(w,classify(w)).includes('supercritical'));
 assert.equal(surfaceTemperature(d).surfaceT,d.Tmean);
});
check('a physically cool shallow buried pool retains its basin coverage',()=>{
 const w=venus().world;
 w.coldT=400;update(w,0);const d=w.diag;
 assert.ok(coldPoolStructure(d).liquidDepth>0);
 assert.ok(buriedOceanCover(d)>.4,`cover=${buriedOceanCover(d)}`);
 assert.ok(buriedOceanCover(d)<.7);
 assert.equal(classify(w).id,'buriedOcean');
 assert.ok(!reasonText(w,classify(w)).includes('supercritical'),'hot low-pressure steam is not supercritical');
});
check('history captures rapid warming at two billion years before the calendar sample',()=>{
 const s=new Simulation(PRESETS.earlyVenus.params),w=s.world;
 w.time=2.1e9;s.sample();s._nextSample=2.142e9;
 w.T.fill(649);w.coldT=646.096;w.hotLayer=.005;
 w.water={ocean:0,seaIce:0,landIce:0,vapour:.10743,lost:.00057};
 update(w,0);s.stepOnce(.01);
 assert.equal(w.history.at(-1).t,w.time);
 assert.ok(w.history.at(-1).T>640);
});
check('paused edits appear at the live chart endpoint without overwriting recorded history',()=>{
 const s=venus(),w=s.world;
 w.time=2.1e9;s.sample();const old=JSON.stringify(w.history);
 w.time+=100;w.T.fill(700);update(w,0);
 const points=temperatureHistory(w);
 assert.equal(points.at(-1).t,w.time);assert.ok(Math.abs(points.at(-1).T-700)<1e-9);
 assert.ok(Math.abs(points.at(-1).surfaceT-700)<1e-9);assert.equal(JSON.stringify(w.history),old);
 w.time=w.history.at(-1).t;
 assert.equal(temperatureHistory(w).length,1);
 assert.ok(Math.abs(temperatureHistory(w)[0].T-700)<1e-9);
});
process.exitCode=failed?1:0;
