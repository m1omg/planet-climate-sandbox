// Exercise the actual software renderer and chart draw code with in-memory
// canvas buffers. This is a rendering regression, not a browser-layout test.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Simulation} from '../src/sim/clock.js';
import {PRESETS} from '../src/game/presets.js';
import {update} from '../src/physics/climate.js';
import {SoftwareView} from '../src/render/software.js';
function canvas(){
 const c={width:0,height:0,clientWidth:320,clientHeight:240,labels:[]};
 const ctx=new Proxy({canvas:c,createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
  fillText:(text)=>c.labels.push(text),measureText:()=>({width:20})},
  {get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 c.getContext=()=>ctx;return c;
}
globalThis.window={devicePixelRatio:1};
globalThis.document={createElement:canvas,documentElement:{}};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>''});
const s=new Simulation(PRESETS.earlyVenus.params),w=s.world;
w.time=2.1e9;s.sample();
// A lid over the pool: the surface past the critical point everywhere, so the
// hot target is 1 and `lidded` holds; the pool itself is cold and shallow.
w.T.fill(700);w.coldT=400;w.hotLayer=.0047044;
// The pool is made of water that has NOT gone into the sky. With the whole
// inventory in `vapour` there is nothing to draw a pool from, whatever the
// unconverted share remembers -- the same water cannot be in both places --
// so the dry case draws no ocean, and the pool case keeps most of its water
// condensed.
w.water={ocean:0,seaIce:0,landIce:0,vapour:.1074311,lost:.0005689};update(w,0);
const view=new SoftwareView(canvas());await view.init();view.setQuality('low');view.showClouds=false;
view.render(w,{seed:12.3,time:0},1);
assert.equal(view.lastOceanFrac,0);
w.water={ocean:.08,seaIce:0,landIce:0,vapour:.0274311,lost:.0005689};update(w,0);
view.render(w,{seed:12.3,time:0},1);
assert.ok(view.lastOceanFrac>.4 && view.lastOceanFrac<.7, `ocean frac ${view.lastOceanFrac}`);
assert.equal(view.lastCloud,0);assert.equal(view.lastSteam,0);
const wet=view.image.data.slice();
const ppm=Buffer.alloc(view.buffer.width*view.buffer.height*3);
for(let i=0;i<ppm.length/3;i++)for(let k=0;k<3;k++)ppm[i*3+k]=wet[i*4+k];
writeFileSync('/tmp/venus-valid-pool.ppm',Buffer.concat([
 Buffer.from(`P6\n${view.buffer.width} ${view.buffer.height}\n255\n`),ppm]));
w.coldT=646.096;update(w,0);view.render(w,{seed:12.3,time:0},1);
assert.equal(view.lastOceanFrac,0);
let changed=0;
for(let i=0;i<wet.length;i+=4)if(wet[i+3]>0 && Math.abs(wet[i]-view.image.data[i])
 +Math.abs(wet[i+1]-view.image.data[i+1])+Math.abs(wet[i+2]-view.image.data[i+2])>10)changed++;
assert.ok(changed>500,`only ${changed} changed pixels`);
const {drawHistory}=await import('../src/render/charts.js');
const chart=canvas();w.time+=100;drawHistory(chart,w);
assert.ok(chart.labels.some(x=>/°C$/.test(x) && parseFloat(x)>376),chart.labels.join(';'));
assert.ok(chart.labels.includes('surface temperature'));
w.coldT=400;update(w,0);const buriedChart=canvas();drawHistory(buriedChart,w);
assert.ok(buriedChart.labels.includes('surface / buried ocean top'));
assert.ok(buriedChart.labels.includes('dashed: atmosphere base'));
const gl=readFileSync(new URL('../src/render/planet.js',import.meta.url),'utf8');
assert.match(gl,/this\.showClouds === false \? buriedOceanCover\(dg\) : 0/);
assert.match(gl,/uniform1f\(this\.u\.uOceanFrac, flooded\)/);
console.log(`PASS shallow pool renders with clouds off (${changed} changed pixels); chart includes live temperature and both labels`);
