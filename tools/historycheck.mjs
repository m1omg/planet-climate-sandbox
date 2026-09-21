import assert from 'node:assert/strict';
globalThis.window={devicePixelRatio:1};
globalThis.document={documentElement:{}};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>''});
for(const root of ['../','../dev/','../altdev/','../altdev2/']) {
 const {Simulation}=await import(root+'src/sim/clock.js');
 const {PRESETS}=await import(root+'src/game/presets.js');
 const {update}=await import(root+'src/physics/climate.js');
 const {drawHistory}=await import(root+'src/render/charts.js');
 const s=new Simulation(PRESETS.earth.params),w=s.world;
 w.time=2.1e9;s.sample();s._nextSample=2.142e9;
 w.T.fill(330);update(w,0);s.stepOnce(.01);
 assert.equal(w.history.at(-1).t,w.time);assert.ok(w.history.at(-1).T>320);
 w.time+=1;w.T.fill(450);update(w,0);
 const labels=[],ctx=new Proxy({fillText:text=>labels.push(text)},
   {get:(o,k)=>k in o?o[k]:()=>{},set:()=>true});
 const before=JSON.stringify(w.history);
 drawHistory({clientWidth:320,clientHeight:240,getContext:()=>ctx},w);
 assert.ok(labels.some(x=>/°C$/.test(x)&&parseFloat(x)>177),labels.join(';'));
 assert.equal(JSON.stringify(w.history),before);
 console.log('PASS old-world sampling and live chart endpoint',root);
}
