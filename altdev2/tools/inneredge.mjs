// Where the inner edge of the habitable zone is, and whether it is in the same
// place coming and going.
//
// Two questions, and they are not the same one:
//
//  1. THRESHOLD. How much sunlight can a world take before it loses its ocean?
//     Kasting 1993 and Leconte 2013 put a fast-rotating Earth at 1.05-1.1 S(+).
//     Yang, Boue, Fabrycky & Abbot (2014) showed a SLOW rotator survives to
//     nearly 2 S(+), because a planet whose solar day is long enough parks its
//     convection over the substellar point and grows a thick reflective deck
//     there. Way et al. (2016) got the same result for a paleo-Venus with a
//     243-day rotation: 11 C at 1.40 S(+), and 56 C -- 45 K hotter -- from
//     nothing but spinning the same planet up to a 16-day day.
//
//  2. HYSTERESIS. A runaway greenhouse is a one-way door: the ocean leaves, the
//     albedo drops, and putting the sunlight back does not put the ocean back.
//     So the flux at which a world tips going UP need not be the flux at which
//     it recovers coming DOWN, and a world walked up gently need not end where
//     the same world thrown there in one jump ends. If those two disagree, the
//     model has a genuine bistable band -- which is physics -- and if the
//     GRADUAL path depends on how gradual, it has an integration problem, which
//     is not.
//
// Run:  node tools/inneredge.mjs
import { Simulation } from '../src/sim/clock.js';
import { EARTH } from '../src/game/presets.js';

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };

// A world has lost its ocean when essentially none of it is still liquid.
export function isRunaway(w) {
  const total = w.water.ocean + w.water.seaIce + w.water.landIce + w.water.vapour;
  return total > 0 && w.water.ocean / total < 0.02 && w.diag.Tmean > 330;
}

export function settleAt(params, S, years = 3e6) {
  const s = new Simulation({ ...params, insolation: S });
  s.runYears(years, 2e5);
  return s.world;
}

// Lowest flux at which the world is gone, to `tol`, by bisection.
export function threshold(params, lo = 0.8, hi = 3.0, tol = 0.02, years = 3e6) {
  if (isRunaway(settleAt(params, lo, years))) return lo;
  if (!isRunaway(settleAt(params, hi, years))) return hi;
  while (hi - lo > tol) {
    const mid = (lo + hi) / 2;
    if (isRunaway(settleAt(params, mid, years))) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// Walk the insolation from `from` to `to` in `steps`, letting the world settle
// for `dwell` years at each. Returns the final world.
export function ramp(params, from, to, steps, dwell) {
  const s = new Simulation({ ...params, insolation: from });
  s.runYears(3e6, 2e5);
  for (let i = 1; i <= steps; i++) {
    s.world.params.insolation = from + (to - from) * (i / steps);
    s.runYears(dwell, 2e5);
  }
  return s.world;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Way et al.'s paleo-Venus: 1 bar N2, 400 ppm CO2, 310 m ocean, 40% land.
  const venusish = { ...EARTH, mass: 0.815, n2Bar: 1.0126, o2Bar: 0, co2Bar: 400e-6,
    ch4Bar: 1e-6, water: 0.108, landFraction: 0.40, landAlbedo: 0.2, biosphere: 0,
    outgassing: 0, obliquity: 2.6, emissions: 0, fossilUsed: 0, startT: 288 };

  console.log('\n1. THRESHOLD vs ROTATION  (paleo-Venus composition)\n');
  console.log(`   ${'rotation'.padEnd(14)} ${'inner edge'.padStart(11)}   literature`);
  const ROT = [
    [24, '1 day', 'Earth-like: 1.05-1.10 (Leconte 2013)'],
    [240, '10 days', ''],
    [384, '16 days', 'Way Sim D: habitable but 45 K hotter'],
    [2784, '116 days', "Venus's solar day"],
    [5832, '243 days', 'Way Sim A/B: 11 C at 1.40, 15 C at 1.70'],
  ];
  for (const [hrs, label, note] of ROT) {
    const S = threshold({ ...venusish, rotationHours: hrs });
    console.log(`   ${label.padEnd(14)} ${S.toFixed(2).padStart(11)}   ${C.d}${note}${C.x}`);
  }

  console.log('\n2. WAY et al. 2016 SIMULATIONS\n');
  for (const [name, hrs, S, gcm] of [
    ['Sim A  243 d, 2.9 Gya', 5832, 1.40, 11],
    ['Sim B  243 d, 0.715 Gya', 5832, 1.70, 15],
    ['Sim D   16 d, 2.9 Gya', 384, 1.40, 56],
  ]) {
    const w = settleAt({ ...venusish, rotationHours: hrs }, S);
    const T = w.diag.Tmean - 273.15;
    const ok = Math.abs(T - gcm) < 25;
    console.log(`   ${ok ? C.g + ' ok ' : C.r + 'MISS'}${C.x} ${name.padEnd(24)} ` +
      `model ${T.toFixed(1).padStart(7)} C   ROCKE-3D ${String(gcm).padStart(3)} C   ` +
      `${C.d}ocean ${w.water.ocean.toFixed(3)} EO${C.x}`);
  }

  console.log('\n3. HYSTERESIS  gradual vs abrupt  (Earth, 1 day)\n');
  const earthish = { ...EARTH, outgassing: 0, emissions: 0, fossilUsed: 0, biosphere: 0 };
  const edge = threshold(earthish, 0.8, 2.5);
  console.log(`   threshold going up: ${edge.toFixed(2)} S(+)\n`);
  const target = edge + 0.10;
  const abrupt = settleAt(earthish, target, 1e7);
  console.log(`   ${'abrupt jump 1.00 -> ' + target.toFixed(2)}`.padEnd(40) +
    `${(abrupt.diag.Tmean - 273.15).toFixed(1).padStart(7)} C  ocean ${abrupt.water.ocean.toFixed(3)}  ${isRunaway(abrupt) ? C.r + 'RUNAWAY' : C.g + 'holds'}${C.x}`);
  for (const steps of [4, 16, 64]) {
    const w = ramp(earthish, 1.00, target, steps, 2e6);
    console.log(`   ${('gradual, ' + steps + ' steps of 2 Myr')}`.padEnd(40) +
      `${(w.diag.Tmean - 273.15).toFixed(1).padStart(7)} C  ocean ${w.water.ocean.toFixed(3)}  ${isRunaway(w) ? C.r + 'RUNAWAY' : C.g + 'holds'}${C.x}`);
  }
  console.log('\n   coming back down from a runaway:');
  for (const back of [1.0, 0.6]) {
    const w = ramp(earthish, target, back, 16, 2e6);
    console.log(`   ${('ramp ' + target.toFixed(2) + ' -> ' + back.toFixed(2))}`.padEnd(40) +
      `${(w.diag.Tmean - 273.15).toFixed(1).padStart(7)} C  ocean ${w.water.ocean.toFixed(3)}  ` +
      `${C.d}lost ${w.water.lost.toFixed(3)} EO${C.x}`);
  }
  console.log('');
}
