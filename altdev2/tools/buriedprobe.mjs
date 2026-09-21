// Reproduce the reported 70%-water URL without a wall-clock-dependent step path.
import {writeFileSync,readFileSync} from 'node:fs';
import {Simulation} from '../src/sim/clock.js';
import {PRESETS} from '../src/game/presets.js';
import {maxStep,update} from '../src/physics/climate.js';
import {captureWorld,applyWorld} from '../src/game/snapshot.js';
const s=new Simulation({...PRESETS.earth.params,water:2986.1,insolation:1.202,
  co2Bar:.00028,ch4Bar:8e-7,emissions:0,fossilUsed:0,outgassing:.25,startT:286.85,
  brightening:0,realisticGeology:false,xuvDecay:false});
if(process.env.CHECKPOINT) applyWorld(s,JSON.parse(readFileSync(process.env.CHECKPOINT,'utf8')));
const w=s.world;w.fastPhysics=process.env.NORMAL!=='1';w._gradeStats={};
if(process.env.HOT){w.T.fill(1288.15);w.coldT=507.15;w.hotLayer=.12;update(w,0);}
const end=Number(process.env.END??190e6),cap=Number(process.env.CAP??Infinity);
let n=0,mark=performance.now(),t0=w.time;
while(w.time<end && n<2e6){
  const dt=Math.min(maxStep(w),end-w.time,cap);s.stepOnce(dt);n++;
  if(n%10000===0 || w.time===end){
    const now=performance.now(),d=w.diag;
    console.log(JSON.stringify({n,time:w.time,dt,T:d.Tmean,coldT:w.coldT,hot:w.hotLayer,
      co2:w.co2,water:d.totalWater,ring:w.ringing,trust:w.trustOver,
      rate:(w.time-t0)*1000/(now-mark),grade:w._gradeStats.last}));
    writeFileSync('/tmp/buried-checkpoint.json',JSON.stringify(captureWorld(w)));
    mark=now;t0=w.time;
  }
}
