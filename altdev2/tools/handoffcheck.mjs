// The handoff between the low-gravity waterworld closure and the standard
// band model, walked in small steps across every edge of the overlap weight.
//
// The weight itself is smooth (waterworld.js), and the energy fluxes blend by
// it -- but three things used to switch on the weight merely being non-zero:
// the escape path (a whole-molecule closure at weight 1, the XUV route from
// 0.998 down, eight orders of magnitude apart), the runaway margin (Infinity
// on one side of the edge, a number on the other) and the state name. This
// walks mass, star temperature and basin depth through the ramps and fails on
// any jump between adjacent points that the physics did not earn.
//
// What it does NOT assert is that the two closures agree. They do not: on a
// gas-free steam world at 0.98 S⊕ the low-gravity closure settles warm and the
// standard one freezes, and the blended energy balance loses its warm
// equilibrium near a weight of 0.9 -- so somewhere on every ramp the world
// falls from one branch to the other in a single step. That is the closure
// disagreement, reported by calibrate.mjs as a known gap and measured here.
// What this file FAILS on is a jump the temperature did not cause: escape,
// pressure or the runaway margin moving between two neighbours whose
// temperatures agree, which can only be a gate.
//
// Run: node tools/handoffcheck.mjs
import { Simulation } from '../src/sim/clock.js';
import { PRESETS } from '../src/game/presets.js';
import { classify } from '../src/physics/classify.js';
import { waterworldWeight } from '../src/physics/waterworld.js';

globalThis.performance ??= { now: () => Date.now() };
let failed = 0;
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${detail ? '  —  ' + detail : ''}`);
  if (!cond) failed++;
};

const base = PRESETS.smallWaterworld.params;
const settle = (p) => {
  const s = new Simulation(p);
  s.runYears(1e6);
  const d = s.world.diag;
  return {
    w: waterworldWeight(p, d.totalWater, 0),
    T: d.Tmean, p: d.pTotMean ?? 0,
    esc: s.world.escape?.water ?? 0,
    margin: d.runawayMargin,
    id: classify(s.world).id,
  };
};

// Adjacent points whose temperatures agree may differ by this much.
const ESC_STEP = 2e-7;      // EO/yr, absolute: the rates are near zero on one side
const P_RATIO = 1.6;
const walk = (label, points, make) => {
  let prev = null, worstT = 0, worstEsc = 0, worstP = 1, switches = 0, infJump = false;
  const rows = [];
  for (const x of points) {
    const r = settle(make(x));
    rows.push(`${typeof x === 'number' ? x.toFixed(3) : x}:${r.T.toFixed(0)}K/${r.id}`);
    if (prev) {
      const dT = Math.abs(r.T - prev.T);
      worstT = Math.max(worstT, dT);
      // Escape and pressure follow the temperature; a move without one is a gate.
      if (dT < 2) {
        worstEsc = Math.max(worstEsc, Math.abs(r.esc - prev.esc));
        const pr = Math.max(r.p, 1e-6) / Math.max(prev.p, 1e-6);
        worstP = Math.max(worstP, pr, 1 / pr);
      }
      if (r.id !== prev.id) switches++;
      // The margin may reach infinity only where the weight reaches one.
      if (Number.isFinite(r.margin) !== Number.isFinite(prev.margin)
          && !(r.w >= 1 || prev.w >= 1)) infJump = true;
    }
    prev = r;
  }
  console.log(`      ${label}: worst temperature step ${worstT.toFixed(1)} K (the closure disagreement; see calibrate.mjs)`);
  ok(worstEsc <= ESC_STEP, `${label}: water escape does not move without the temperature`, `worst ${worstEsc.toExponential(2)} EO/yr between neighbours within 2 K`);
  ok(worstP <= P_RATIO, `${label}: surface pressure does not move without the temperature`, `worst ratio ${worstP.toFixed(2)} between neighbours within 2 K`);
  ok(!infJump, `${label}: the runaway margin reaches infinity only with the weight`);
  ok(switches <= 2, `${label}: the state name switches at most twice across the ramp`, `${switches} switches · ${rows.join(' ')}`);
};

// Mass, at fixed water share, through the 0.12-0.30 ramp.
{
  const points = []; for (let m = 0.10; m <= 0.33; m += 0.0075) points.push(+m.toFixed(4));
  walk('mass', points, (m) => ({ ...base, mass: m, water: base.water * (m / 0.08) }));
}
// Star temperature through both edges of the 4800-5200 / 6200-6600 window.
{
  const points = []; for (let t = 4700; t <= 6700; t += 40) points.push(t);
  walk('star', points, (t) => ({ ...base, starTemp: t }));
}
// Basin depth: water inventory through the MAX_BASIN_DEPTH..2x ramp.
{
  const points = []; for (let f = 0.02; f <= 0.5; f += 0.012) points.push(+f.toFixed(3));
  walk('depth', points, (f) => ({ ...base, water: base.water * f }));
}

console.log(failed ? `\x1b[31m— ${failed} handoff checks failed —\x1b[0m` : '\x1b[32m— all handoff checks passed —\x1b[0m');
process.exit(failed ? 1 : 0);
