// Prove a change did not move a world that it had no business moving.
//
// Almost everything this branch adds is additive from zero: a hydrogen
// reservoir that starts empty, an envelope thickness that is not there, a water
// term in the radius that a rocky planet does not have. Adding an exact 0.0 to
// a double is exact, so every existing preset should come out of such a change
// not merely close but IDENTICAL -- and "close" is the failure mode worth
// fearing here, because a fourteenth-decimal drift in one preset is invisible
// in a chart, survives every anchor in calibrate.mjs, and means the new term is
// reaching code it was supposed to be switched off in.
//
// So: run every preset a fixed number of fixed-length steps and print the whole
// state vector. Then diff the file against the one from before the change. Not
// "all anchors still in range" -- byte-for-byte identical, or the phase stops
// until the difference is understood.
//
// Stepped the way the app steps -- adaptively, under maxStep() -- rather than at
// some fixed dt of the probe's own. A fixed dt would be easier to reason about
// and would test code nothing runs: every preset here starts with a stable step
// under a year, so a probe marching at 200 kyr would be measuring the
// integrator's behaviour far outside the regime it is used in, and a change
// that broke the real thing could pass. The cost is that a change to the
// step-size chooser reshapes every row rather than showing up alone. That cost
// is worth paying and is made legible instead: the step COUNT is printed per
// preset, so a controller change announces itself on one line, and the span is
// closed exactly so that every run reports the state at the same instant rather
// than wherever the last step happened to land.
//
// The state vector is captureWorld()'s, which is not a coincidence: that is
// what a save slot holds, so a new field that this probe cannot see is a field
// a save cannot see either, and the diff being empty for the wrong reason is
// the same bug as a save quietly restoring a different world.
//
//   node tools/identity.mjs > before.txt
//   ...make the change...
//   node tools/identity.mjs > after.txt && diff before.txt after.txt
import { Simulation } from '../src/sim/clock.js';
import { PRESETS } from '../src/game/presets.js';
import { captureWorld } from '../src/game/snapshot.js';
import { maxStep } from '../src/physics/climate.js';
import { derive } from '../src/physics/planet.js';

// Ten million years by default: long enough that the slow reservoirs -- the
// carbonate-silicate cycle, ice sheets, the deep carbon -- have moved off their
// initial values, and short enough that the whole set of presets runs in the
// time anyone will actually wait between two edits. Push it to 1e8 or 1e9 for a
// deeper look before a push; the file is comparable to itself at any one span,
// not across spans.
const SPAN = Number(process.env.IDENTITY_SPAN || 1e7);   // years of simulated time
const DT_CAP = 5e6;                                     // the app's own ceiling

// JavaScript's default number formatting is the shortest string that reads back
// as the same double, so two numbers print differently if and only if they ARE
// different. That is exactly the test, and it is stricter than seventeen
// significant figures rather than looser: no rounding step exists in which a
// difference could hide.
const num = (x) => {
  if (typeof x !== 'number') return String(x);
  if (Number.isNaN(x)) return 'NaN';
  return Object.is(x, -0) ? '-0' : String(x);
};

// Walk the captured state in a fixed order regardless of insertion order, so a
// field added in a different place does not reorder the whole file and drown
// the real difference.
const emit = (prefix, v, out) => {
  if (v === null || v === undefined) { out.push(`${prefix} = ${v}`); return; }
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
    out.push(`${prefix} = ${num(v)}`);
    return;
  }
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    for (let i = 0; i < v.length; i++) emit(`${prefix}[${i}]`, v[i], out);
    return;
  }
  for (const k of Object.keys(v).sort()) emit(`${prefix}.${k}`, v[k], out);
};

const names = Object.keys(PRESETS).sort();
console.log(`# identity probe: ${names.length} presets, ${SPAN} yr each`);

for (const name of names) {
  const p = { ...PRESETS[name].params };
  const sim = new Simulation(p);
  const w = sim.world;
  const out = [];

  out.push(`${name} maxStep0 = ${num(maxStep(w))}`);
  const d = derive(p);
  for (const k of Object.keys(d).sort()) out.push(`${name} derive.${k} = ${num(d[k])}`);

  // The span is closed exactly rather than overshot, so w.time is SPAN in every
  // run and the states being compared are states at the same moment.
  let steps = 0;
  while (w.time < SPAN) {
    sim.stepOnce(Math.min(maxStep(w), DT_CAP, SPAN - w.time));
    if (++steps > 5e6) { out.push(`${name} ABORTED: step limit`); break; }
  }
  out.push(`${name} steps = ${steps}`);
  emit(`${name} state`, captureWorld(w), out);

  // Diagnostics are rebuilt from the state rather than stored in it, so they
  // are not part of the save -- but they are what the readout shows and what
  // the classifier reads, and a change that moved only those would pass a
  // state-only diff while visibly changing the game.
  const dg = w.diag;
  for (const k of Object.keys(dg).sort()) emit(`${name} diag.${k}`, dg[k], out);

  console.log(out.join('\n'));
}
