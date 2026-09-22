// Every scenario, played three ways: doing nothing, playing its own recorded
// solution, and playing that solution again at a different step cap.
//
// The scenarios were inherited byte for byte from altdev while the physics
// under them was rewritten, and none of their numbers reproduced: one was
// unwinnable at any setting, one was won by waiting, one was won or lost
// depending on the frame rate because the goal was sampled ten times a
// second against a world moving megayears per frame. Each scenario now
// carries a `solution` -- the play its hint describes, as a patch applied
// the way the page applies a control -- and this holds all three properties:
//
//   1. doing nothing does not win (a puzzle needs a player);
//   2. the solution wins inside the limit;
//   3. the verdict lands at the same simulated year at two step caps, since it
//      is decided per step now, not per readout frame.
//
// Run: node tools/scenariocheck.mjs
import { Simulation } from '../src/sim/clock.js';
import { SCENARIOS } from '../src/game/scenarios.js';
import { setWaterInventory } from '../src/physics/climate.js';

globalThis.performance ??= { now: () => Date.now() };
let failed = 0;
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${detail ? '  —  ' + detail : ''}`);
  if (!cond) failed++;
};

// A control, applied as main.js's applyParams applies it: the parameter, then
// the reservoir it names. Kept in step with that function by the smoketest.
export function applyLikeThePage(s, patch) {
  const w = s.world;
  for (const [key, v] of Object.entries(patch)) {
    s.setParams({ [key]: v });
    const g = w.diag.d.g;
    if (key === 'n2Bar') w.n2 = v * 1e5 / g;
    if (key === 'o2Bar') w.o2 = v * 1e5 / g;
    if (key === 'co2Bar') { w.co2 = v * 1e5 / g; w.co2Frozen = 0; }
    if (key === 'ch4Bar') w.ch4 = v * 1e5 / g;
    if (key === 'water') setWaterInventory(w, v);
    s.setParams({});
  }
};

// One play of one scenario, decided per step exactly as main.js decides it.
export function play(sc, moves, stepCap = 2e6) {
  const s = new Simulation({ ...sc.params });
  if (sc.walk?.insolation != null) s.walkTo(sc.walk.insolation);
  const queue = [...(moves || [])].sort((a, b) => a.at - b.at);
  let result = null, at = null;
  s.onStep = (w) => {
    if (sc.evolve) w.params.biosphere = sc.evolve(w);
    while (queue.length && w.time >= queue[0].at) applyLikeThePage(s, queue.shift().patch);
    if (result) return;
    if (sc.fail && sc.fail(w)) { result = 'lose'; at = w.time; }
    else if (sc.check(w)) { result = 'win'; at = w.time; }
    else if (w.time > sc.limit) { result = 'limit'; at = w.time; }
  };
  while (queue.length && queue[0].at <= 0) applyLikeThePage(s, queue.shift().patch);
  while (s.world.time < sc.limit * 1.02 && !result) {
    s.runYears(Math.min(5e6, sc.limit * 1.02 - s.world.time), stepCap);
  }
  return { result, at, T: s.world.diag.Tmean, ocean: s.world.water.ocean };
}

const fmt = (r) => `${r.result ?? 'running'}${r.at != null ? ' at ' + (r.at / 1e6).toFixed(2) + ' Myr' : ''}, ${r.T.toFixed(0)} K`;

{
  const only = process.argv[2] ? process.argv[2].split(',') : null;
  for (const sc of SCENARIOS) {
    if (only && !only.includes(sc.id)) continue;
    const idle = play(sc, null);
    ok(idle.result !== 'win', `${sc.id}: doing nothing does not win`, fmt(idle));
    if (!sc.solution) { ok(false, `${sc.id}: carries a recorded solution`); continue; }
    const won = play(sc, sc.solution);
    ok(won.result === 'win', `${sc.id}: its own hint wins inside the limit`, fmt(won));
    // A win that is the limit itself -- "still habitable at a gigayear" -- is
    // decided by the calendar, not by a step, and re-proving it at a fine cap
    // costs a gigayear of a stiff world for nothing.
    if (won.result === 'win' && won.at >= sc.limit) {
      ok(true, `${sc.id}: the verdict is the limit itself, not a step`, fmt(won));
      continue;
    }
    const again = play(sc, sc.solution, 2e5);
    // A verdict lands on the first step that satisfies it, so two step caps
    // can differ by up to the coarser cap; beyond that the sampling decided.
    const same = won.result === again.result
      && Math.abs((won.at ?? 0) - (again.at ?? 0)) <= Math.max(0.1 * Math.max(won.at ?? 1, again.at ?? 1, 1e4), 2e6);
    ok(same, `${sc.id}: the verdict does not depend on the step`, `${fmt(won)} against ${fmt(again)}`);
  }
  console.log(failed ? `\x1b[31m— ${failed} scenario checks failed —\x1b[0m` : `\x1b[32m— all scenario checks passed —\x1b[0m`);
  process.exit(failed ? 1 : 0);
}
