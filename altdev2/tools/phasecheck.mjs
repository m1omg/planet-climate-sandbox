// Water-phase regressions reported from play, each written failing first.
//
//  1. Heating a deep waterworld melts its high-pressure ice, and the melt is
//     paid for. The floor used to retreat for free -- 1250 km of ice VII in
//     four megayears on energy that covers half of it -- because the pool's
//     budget charged sensible heat only.
//  2. A supercritical layer cannot outlive the heat that made it. A world
//     heated past the critical point and then dimmed to 0.001 S⊕ kept a
//     "supercritical · -228 °C" band for hundreds of megayears, because the
//     retreat was rationed by the 0.2 W/m² the frozen planet radiates.
//  4. The carbon seal reads the ice under the water, whichever column the
//     water is in. It read the sea's column, and once a lid closed the sea was
//     gone: the seal opened, thirty bar of CO2 came up through 230 km of ice
//     VII, and the Cold-Start Runaway was 350 K hotter or cooler at ten
//     megayears depending on which of two wrong columns it happened to read.
//  3. An ice edge is stepped through, not over. Near the outer edge the
//     quasi-static shortcut multiplied the step 4000x at the moment the world
//     reached its warm branch, and the explicit albedo landed it back on the
//     cold one: a 0.3 Myr sawtooth that vanished when the step was capped.
//
// Run: node tools/phasecheck.mjs
import { Simulation } from '../src/sim/clock.js';
import { PRESETS, EARTH } from '../src/game/presets.js';
import { classify } from '../src/physics/classify.js';
import { columnLayers } from '../src/physics/ocean.js';
import { T_CRIT_H2O } from '../src/physics/constants.js';
import { sealFactor } from '../src/physics/volatiles.js';
import { scaleHeight } from '../src/render/atmosphere.js';

globalThis.performance ??= { now: () => Date.now() };
let failed = 0;
const ok = (cond, label, detail = '') => {
  console.log(`${cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${detail ? '  —  ' + detail : ''}`);
  if (!cond) failed++;
};
const column = (w) => w.diag.coldPool ?? w.diag.oceanBase;

// ---- 1. melting is melting -------------------------------------------------
{
  const p = { ...EARTH, mass: 1, landFraction: 0.3, water: 2990, internalHeat: 0.091,
    co2Bar: 0.084, n2Bar: 1, o2Bar: 0, biosphere: 0, emissions: 0, fossilUsed: 0,
    insolation: 1.0, startT: 290 };
  const s = new Simulation(p);
  s.runYears(1e7);
  s.setParams({ insolation: 1.5 });
  // What melts off the floor is fluid continuous with the pool -- liquid
  // while the adiabat is under 647 K there, supercritical past it, which on a
  // pool whose top is at 500 K is most of the depth. So the test is not the
  // label: it is that the fluid grows by what the ice lost, and that the ice
  // could not have gone faster than the energy reaching the pool pays for.
  let prevIce = column(s.world)?.iceDepth ?? 0, prevFluid = column(s.world)?.liquidDepth ?? 0;
  let shrank = 0, overspent = 0, rows = [];
  const { RHO_ICE_HP } = await import('../src/physics/ocean.js');
  const { L_FUSION_HP } = await import('../src/physics/volatiles.js');
  for (let i = 0; i < 12; i++) {
    s.runYears(1e6);
    const c = column(s.world), d = s.world.diag;
    const ice = c?.iceDepth ?? 0, fluid = c?.liquidDepth ?? 0, sup = c?.superDepth ?? 0;
    rows.push(`${(s.world.time / 1e6).toFixed(0)}Myr coldT=${(s.world.coldT ?? 0).toFixed(0)} ice=${(ice / 1e3).toFixed(0)} fluid=${(fluid / 1e3).toFixed(0)} (sc ${(sup / 1e3).toFixed(0)})`);
    if (ice < prevIce - 1000 && fluid < prevFluid - 1000) shrank++;
    // Energy: the ice that went this megayear, as latent heat per square metre
    // of planet, against the mixed-down flux over the same megayear.
    const melted = Math.max(prevIce - ice, 0) * RHO_ICE_HP * (d.flooded ?? 1) * L_FUSION_HP;
    const paid = Math.max(d.mixedFlux ?? 0, 0) * 3.156e7 * 1e6;
    if (melted > 1.5 * paid + 1e9) overspent++;
    prevIce = ice; prevFluid = fluid;
  }
  ok(shrank === 0, 'heating melts high-pressure ice into fluid that stays in the column',
    `${shrank} megayears in which both ice and fluid shrank · ${rows.slice(-3).join(' · ')}`);
  ok(overspent === 0, 'the floor retreats no faster than the energy reaching the pool pays for',
    `${overspent} megayears over budget`);
}

// ---- 2. a supercritical layer needs supercritical conditions --------------
{
  const p = { ...EARTH, mass: 1, landFraction: 0.3, water: 2990, internalHeat: 0.091,
    co2Bar: 0.084, n2Bar: 1, o2Bar: 0, biosphere: 0, emissions: 0, fossilUsed: 0,
    insolation: 2.5, startT: 300 };
  const s = new Simulation(p);
  s.runYears(2e7);
  const hotBefore = s.world.hotLayer ?? 0;
  s.setParams({ insolation: 0.001 });
  // One coarse step across the cooling transit is how the reported state was
  // reached: the surface went from 668 K to 44 K while the layer stayed put.
  s.runYears(1e7, 2e6);
  const w = s.world;
  if (w.diag.Tmean < 200 && (w.hotLayer ?? 0) < 0.3) {
    // The step bounds now walk the transit, so the stuck state is planted the
    // way that step used to leave it, and must still drain.
    w.hotLayer = 0.31; s.setParams({});
  }
  const H0 = scaleHeight(w.diag);
  const planted = columnLayers(w, w.diag, H0 * 5, H0).find((l) => l.kind === 'supercritical');
  ok(!planted, 'a converted share is not drawn as supercritical below the critical point',
    planted ? `${(planted.metres / 1e3).toFixed(1)} km labelled supercritical at ${w.diag.Tmean.toFixed(0)} K` : 'none drawn');
  s.runYears(1e6);
  const dg = w.diag;
  const H = scaleHeight(dg);
  const layers = columnLayers(w, dg, H * 5, H);
  const sc = layers.find((l) => l.kind === 'supercritical');
  ok(hotBefore > 0.05, 'the hot start actually converted some of the column', `hotLayer ${hotBefore.toFixed(3)} at 2.5 S⊕`);
  ok(dg.Tmean < 200, 'the dimmed world froze', `${dg.Tmean.toFixed(0)} K`);
  ok((w.hotLayer ?? 0) < 0.01, 'the hot layer recondensed once the surface fell below the critical point',
    `hotLayer ${(w.hotLayer ?? 0).toFixed(3)} 1 Myr after the transit`);
  ok(!sc, 'no "supercritical" band is drawn on a frozen world',
    sc ? `${(sc.metres / 1e3).toFixed(1)} km labelled supercritical at ${dg.Tmean.toFixed(0)} K` : 'none drawn');
  ok(layers.some((l) => /ice/i.test(l.kind) && l.kind !== 'iceHP' && !/VI|VII/.test(l.kind)) || dg.subglacial?.under?.iceDepth > 0 || dg.subglacial?.shell > 0,
    'the ice shell is drawn again', layers.map((l) => l.kind).join(' → '));
}

// ---- 3. the ice edge is not stepped over ------------------------------------
{
  const hash = { landFraction: 0.7, water: 0.06, insolation: 0.473326, xuvFraction: 0.00000271926,
    rotationHours: 24.6, obliquity: 25, n2Bar: 0.231719, o2Bar: 0, biosphere: 0, co2Bar: 1.38286,
    ch4Bar: 1, emissions: 0, fossilUsed: 0, internalHeat: 0.0208207, landAlbedo: 0.22, startT: 280,
    startAge: 0.6, magneticField: 0 };
  const flips = (stepCap) => {
    const s = new Simulation({ ...PRESETS.earth.params, ...hash });
    let n = 0, side = null, steps = 0;
    while (s.world.time < 6e7) {
      s.runYears(Math.min(2e5, 6e7 - s.world.time), stepCap); steps++;
      const cold = s.world.diag.iceMean > 0.5;
      if (side !== null && cold !== side) n++;
      side = cold;
    }
    return { n, T: s.world.diag.Tmean, steps };
  };
  const free = flips(2e6), fine = flips(1e3);
  // A limit cycle's phase may differ between step sizes; what may not differ
  // is the count by an order of magnitude, which is what chatter looks like.
  ok(free.n <= 2 * fine.n + 2 && free.n < 15, 'the free step sees the same order of ice-edge crossings as a 1 kyr step',
    `free ${free.n} crossings (T ${free.T.toFixed(1)} K) · capped ${fine.n} (T ${fine.T.toFixed(1)} K) over 60 Myr`);
}

// ---- 4. the seal reads the ice that is there ------------------------------
{
  const s = new Simulation({ ...PRESETS.coldStart.params });
  s.runYears(2e6);
  const open = { seal: sealFactor(s.world), ice: column(s.world)?.iceDepth ?? 0 };
  s.runYears(1e6);
  const w = s.world, dg = w.diag;
  const lid = { seal: sealFactor(w), ice: column(w)?.iceDepth ?? 0 };
  ok(dg.lidded && lid.ice > 1e5, 'the cold start has a closed lid over a deep ice floor at 3 Myr',
    `lidded ${dg.lidded}, ${(lid.ice / 1e3).toFixed(0)} km of ice under the pool`);
  ok(Math.abs(lid.seal - open.seal) < 0.1 * open.seal, 'the carbon seal does not change because the sea surface went over to the lid',
    `seal ${open.seal.toFixed(3)} over ${(open.ice / 1e3).toFixed(0)} km before the lid, ${lid.seal.toFixed(3)} over ${(lid.ice / 1e3).toFixed(0)} km under it`);
}

console.log(failed ? `\x1b[31m— ${failed} phase checks failed —\x1b[0m` : '\x1b[32m— all phase checks passed —\x1b[0m');
process.exit(failed ? 1 : 0);
