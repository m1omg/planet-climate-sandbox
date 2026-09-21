// Fast regression checks for the review fixes, independently of the long physics suite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failures = 0;
for (const build of ['', 'dev/', 'altdev/', 'altdev2/']) {
  const base = new URL(`../${build}`, import.meta.url);
  const { Simulation } = await import(new URL('src/sim/clock.js', base));
  const { EARTH, PRESETS } = await import(new URL('src/game/presets.js', base));
  const { captureWorld, applyWorld } = await import(new URL('src/game/snapshot.js', base));
  const { parseSaveFile } = await import(new URL('src/game/saves.js', base));
  const { maxStep } = await import(new URL('src/physics/climate.js', base));
  const source = readFileSync(new URL('src/main.js', base), 'utf8');
  const fn = name => source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
  const check = (name, test) => {
    try { test(); console.log('PASS', build || 'main', name); }
    catch (error) { failures++; console.error('FAIL', build || 'main', name, error.message); }
  };
  let sanitize = p => p;
  try { ({ sanitizeParams: sanitize } = await import(new URL('src/game/validation.js', base))); } catch {}
  check('share/reload preserves every preset setting', () => {
    for (const preset of Object.values(PRESETS)) {
      const params = { ...preset.params }, location = { hash: '', pathname: '/', search: '' };
      const history = { replaceState(a, b, url) { location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } };
      const parsed = new Function('EARTH', 'URL_BASE', 'params', 'sim', 'location', 'history', 'sanitizeParams',
        `${fn('writeHash')}\n${fn('paramsFromHash')}\nwriteHash(); return paramsFromHash();`)(
        EARTH, PRESETS.earth.params, params, { world: { params } }, location, history, sanitize);
      const back = { ...PRESETS.earth.params, ...parsed };
      for (const key of Object.keys(params)) {
        if (typeof params[key] === 'number') assert.ok(Math.abs(back[key] - params[key]) <= 1e-5 * Math.max(1e-12, Math.abs(params[key])), key);
        else assert.equal(back[key], params[key], key);
      }
    }
  });
  check('bad URL mass cannot poison the model', () => {
    for (const hash of ['#mass=nope', '#mass=0', '#mass=-1', '#mass=false', '#mass=1e999']) {
      const patch = new Function('EARTH', 'location', 'sanitizeParams', `${fn('paramsFromHash')}\nreturn paramsFromHash();`)(EARTH, { hash }, sanitize);
      const sim = new Simulation({ ...PRESETS.earth.params, ...patch });
      sim.stepOnce(0.01); assert.ok(Number.isFinite(sim.world.diag.Tmean), hash);
    }
  });
  check('malformed save and runtime fields cannot poison the model', () => {
    for (const patch of [{ params: { ...EARTH, mass: 0 } }, { T: ['bad'], time: 'bad' },
      { runtime: { insolationTarget: 'bad', insolationRate: 1 } }]) {
      const raw = { ...captureWorld(new Simulation({ ...EARTH }).world), ...patch };
      const saved = parseSaveFile(JSON.stringify(raw))[0];
      const sim = new Simulation({ ...EARTH }); applyWorld(sim, saved, { ...EARTH, ...saved.params });
      for (let i = 0; i < 3; i++) sim.stepOnce(Math.min(maxStep(sim.world), 0.1));
      assert.ok(Number.isFinite(sim.world.diag.Tmean));
    }
  });
  check('restored history begins at the restored state', () => {
    const a = new Simulation({ ...EARTH }); a.runYears(10);
    const b = new Simulation({ ...EARTH }); applyWorld(b, captureWorld(a.world));
    assert.equal(b.world.history.length, 1); assert.equal(b.world.history[0].t, 10);
    assert.equal(b.world.history[0].T, b.world.diag.Tmean);
  });
  check('valid JSON import preserves runtime objects and exact continuation', () => {
    const a=new Simulation({...EARTH}),b=new Simulation({...EARTH});a.stepOnce(.1);
    const shot=captureWorld(a.world);
    applyWorld(b,parseSaveFile(JSON.stringify(shot))[0]);
    assert.deepEqual(captureWorld(b.world),shot);
    for(let i=0;i<10;i++){a.stepOnce(.1);b.stepOnce(.1);}
    assert.deepEqual(captureWorld(b.world),captureWorld(a.world));
    const bad=parseSaveFile(JSON.stringify({params:{},coldT:Infinity}))[0];
    assert.equal(bad.coldT,undefined);
  });
  check('history records water rather than other gases', () => {
    const s = new Simulation({ ...EARTH }); s.sample(); const d = s.world.diag;
    assert.ok(Math.abs(s.world.history[0].pH2O - d.pH2O.reduce((a,b) => a+b,0) / d.pH2O.length) < 1e-12);
    assert.ok(Math.abs(s.world.history[0].alb - d.alb.reduce((a,b) => a+b,0) / d.alb.length) < 1e-12);
  });
  check('load clears scenario and save names are escaped', () => {
    assert.match(fn('restore'), /closeScenario\(\)/);
    assert.match(fn('syncSlots'), /escHtml\(s.name/);
  });
  if (build.startsWith('altdev')) {
    check('reset sampling clears epochs before capturing the new world', () => {
      const hook=source.match(/sim.onSample = \(w\) => \{[\s\S]*?\n\};/)[0];
      const run=new Function('w',`let suspendCapture=false,epochs=[{id:'old'}],marks=[{t:.2}],
        restorePoints=[{}],epochCandidate={id:'old'},histZoom=2,histPan=.5;
        const renderEpochs=()=>{},renderMarks=()=>{},snapshot=()=>({epochs,marks}),RESTORE_CAP=1;
        const pushRestore=(r,s)=>r.push(s),sim={};${hook};sim.onSample(w);return {epochs,marks,restorePoints};`);
      const clean=run({history:[{}]});assert.deepEqual(clean.epochs,[]);assert.deepEqual(clean.marks,[]);
      assert.deepEqual(clean.restorePoints,[{epochs:[],marks:[]}]);
      assert.equal(run({history:[{},{}]}).epochs.length,1);
    });
    check('save preserves a sunlight transition', () => {
      const a = new Simulation({ ...EARTH, smoothInsolation: true }); a.runYears(10); a.setParams({ insolation: 1.5 });
      const b = new Simulation({ ...EARTH }); applyWorld(b, JSON.parse(JSON.stringify(captureWorld(a.world))));
      a.stepOnce(1); b.stepOnce(1); assert.equal(a.world.params.insolation, b.world.params.insolation);
    });
    check('preview does not truncate milestones or epochs', () => {
      assert.doesNotMatch(fn('applyWorldState'), /marks\.filter|truncateEpochs/);
      const scrub = fn('scrubTo'); assert.ok(scrub.indexOf('truncateEpochs') > scrub.indexOf('if (!commit)'));
    });
    check('sharing a transition toward the default keeps current sunlight', () => {
      const params = { ...PRESETS.earth.params, smoothInsolation: true, insolation: 1 };
      const location = { pathname: '/', search: '', hash: '' };
      const history = { replaceState(a,b,url) { location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; } };
      const out = new Function('EARTH','URL_BASE','params','sim','location','history','sanitizeParams',
        `${fn('writeHash')}\n${fn('paramsFromHash')}\nwriteHash(); return paramsFromHash();`)(EARTH, PRESETS.earth.params,
        params, { world: { params: { ...params, insolation: 1.4 } } }, location, history, sanitize);
      assert.equal(out.insolation, 1.4);
    });
  }
}
process.exitCode = failures ? 1 : 0;
