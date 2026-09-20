import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/clock.js';
import { PRESETS } from '../src/game/presets.js';
import { update } from '../src/physics/climate.js';
import { waterworldActive } from '../src/physics/waterworld.js';
import * as ocean from '../src/physics/ocean.js';
import { scaleHeight } from '../src/render/atmosphere.js';
let passed = 0;
function check(name, fn) { fn(); console.log('PASS', name); passed++; }
check('physical conditions select the model, never a legacy checkbox', () => {
  const p = { ...PRESETS.hotSmallWaterworld.params };
  delete p.lowGravityWaterworld;
  for (const flag of [undefined, false, true]) {
    const s = new Simulation({ ...p, lowGravityWaterworld: flag });
    assert.ok(s.world.diag.smallWaterworld);
  }
  assert.equal(waterworldActive(p, p.water, 1), true);
  assert.equal(waterworldActive({ ...p, mass: 1 }, p.water, 0), false);
  assert.equal(waterworldActive({ ...p, water: 0 }, 0, 0), false);
  assert.equal(waterworldActive({ ...p, starTemp: 3000 }, p.water, 0), false);
  assert.equal(waterworldActive(p, 0, 0), true); // depleted reservoir approaches dry limit continuously
  const s=new Simulation(p),w=s.world,R=w.diag.d.R;
  w.n2=1e5/w.diag.g;update(w,0);
  assert.ok(w.diag.smallWaterworld && w.diag.smallWaterworld.backgroundBar>0);assert.equal(w.diag.d.R,R);
  w.n2=0;update(w,0);assert.ok(w.diag.smallWaterworld);assert.equal(w.diag.d.R,R);
});
check('frozen, warm and buried summaries use exactly the displayed layers', () => {
  for (const id of ['callisto','ganymede','icySmallWaterworld','earth','hotSmallWaterworld','coldStart']) {
    if (!PRESETS[id]) continue;
    const w = new Simulation(PRESETS[id].params).world;
    if (id === 'callisto') { w.T.fill(170); update(w, 0); }
    const H = scaleHeight(w.diag), layers = ocean.columnLayers(w, w.diag, H*5, H);
    const summary = ocean.columnSummary(layers);
    assert.equal(summary.liquidDepth, layers.filter(l=>l.kind==='ocean').reduce((s,l)=>s+l.metres,0));
    assert.equal(summary.iceDepth, layers.filter(l=>['iceVI','iceVII','iceHP'].includes(l.kind)).reduce((s,l)=>s+l.metres,0));
    if (w.diag.subglacial?.ocean) {
      assert.equal(summary.liquidDepth,w.diag.subglacial.under.liquidDepth);
      assert.equal(summary.iceDepth,w.diag.subglacial.under.iceDepth);
      assert.equal(summary.shellDepth,w.diag.subglacial.shellDepth);
    }
  }
});
check('vacuum and collisionless ice do not acquire a thick steam layer', () => {
  const w = new Simulation(PRESETS.callisto.params).world;
  for (const T of [100,170]) {
    w.T.fill(T); update(w,0);
    const H = scaleHeight(w.diag), layers = ocean.columnLayers(w,w.diag,H*5,H);
    assert.ok(!layers.some(l=>l.kind==='steam'));
    if (T===100) assert.ok(!layers.some(l=>['air','vapour','envelope'].includes(l.kind)));
  }
  const d={...w.diag,pTotMean:0,pH2O:new Float64Array(18)};
  assert.ok(!ocean.columnLayers(w,d,1e6,1e5).some(l=>['air','vapour','steam','envelope'].includes(l.kind)));
});
check('the UI has no model switch and shares its layer summary', () => {
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const controls=readFileSync(new URL('../src/game/controls.js',import.meta.url),'utf8');
  assert.ok(!main.includes('chk-small-waterworld') && !controls.includes('chk-small-waterworld'));
  assert.ok(main.includes('columnSummary(layers)'));
  assert.ok(!main.includes('fmtDepth(ob.liquidDepth)'));
});
console.log(`${passed} structure/model checks passed`);
