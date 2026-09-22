// The whole of a world, and putting it back.
//
// One definition, used by three things that must not disagree: the save slots,
// the export file, and going back along a world's own history. Saving only the
// sliders would give you a planet that looked right and had forgotten
// everything it had been through, which for a model whose whole subject is
// history is the wrong thing to keep -- so this is the clock, the band
// temperatures, where the water is, how much of the ice sheet has grown, what
// is left of the fossil reserve and of the carbon below.
//
// It lives in its own module rather than inside main.js because the property
// worth testing is that it is COMPLETE, and that test needs to build a world,
// capture it, put it back, and run both forward to see whether they agree. A
// field added to the world and forgotten here would not throw; it would quietly
// make every save and every rewind slightly wrong.
import { update } from '../physics/climate.js';

// The state the step-size chooser carries between steps, and the smoothed rates
// it reads as bounds. None of this is climate -- it is the integrator's own
// memory -- and all of it used to be dropped, on the reasoning that `update()`
// rebuilds what it needs. It does not: these come back `undefined` and are
// rebuilt from nothing on the first step after a restore, so the world resumes
// on a different step sequence from the one it was on. `dtPrev` above all: it
// was called "a hint ... re-derived within one step", and `maxStep` low-passes
// the step against it, so without it the first step after a load was 1.8x the
// one the same world was taking and Earth at 0.94 S⊕ was 0.05 K off its own
// trajectory 700 kyr later. The capped round-trip test could not see it; the
// free-step one can.
const RUNTIME = ['dtPrev', 'escape', 'o2Flux', 'o2Rate', 'ch4Source', 'ch4Tau', 'emitting'];

function captureRuntime(w) {
  const out = {};
  for (const k of RUNTIME) {
    const v = w[k];
    if (v === undefined) continue;
    out[k] = v !== null && typeof v === 'object' ? { ...v } : v;
  }
  return out;
}

// Everything about a world that is not derived from the rest of it.
//
// Deliberately absent: `history`, which is the run rather than the world and is
// megabytes of it; and `diag`, which update() rebuilds from this.
export function captureWorld(w) {
  return {
    params: { ...w.params },
    time: w.time,
    T: Array.from(w.T),
    water: { ...w.water },
    waterInitial: w.waterInitial,
    iceSheet: w.iceSheet,
    co2Frozen: w.co2Frozen,
    fossil: w.fossil,
    carbonDeep: w.carbonDeep,
    bio: w.bio,
    co2: w.co2, n2: w.n2, o2: w.o2, ch4: w.ch4,
    runtime: captureRuntime(w),
  };
}

// Put one back. The reset is what rebuilds the arrays and the derived planet;
// everything after it overwrites the fresh world with the saved one.
//
// `params` is passed separately because the caller owns it: main.js keeps a
// live object the sliders read from and write to, and handing that same object
// to reset is how a change made afterwards reaches the simulation at all.
export function applyWorld(sim, s, params = s.params) {
  sim.reset(params);
  const w = sim.world;
  w.time = s.time ?? 0;
  if (Array.isArray(s.T)) for (let i = 0; i < w.T.length && i < s.T.length; i++) w.T[i] = s.T[i];
  if (s.water) Object.assign(w.water, s.water);
  w.waterInitial = s.waterInitial ?? w.waterInitial;
  w.iceSheet = s.iceSheet ?? null;
  w.co2Frozen = s.co2Frozen ?? 0;
  w.fossil = s.fossil ?? null;
  w.carbonDeep = s.carbonDeep ?? null;
  w.bio = s.bio ?? null;
  if (s.co2 != null) w.co2 = s.co2;
  if (s.n2 != null) w.n2 = s.n2;
  if (s.o2 != null) w.o2 = s.o2;
  if (s.ch4 != null) w.ch4 = s.ch4;
  // Before update(), so a zero-length step sees the bounds and the smoothed
  // rates the world had when it was captured. A save from before this field
  // existed has no `runtime` and restores exactly as it used to.
  if (s.runtime) {
    for (const k of RUNTIME) {
      const v = s.runtime[k];
      if (v === undefined) continue;
      w[k] = v !== null && typeof v === 'object' ? { ...v } : v;
    }
  }
  update(w, 0);
  w.history = [];
  sim.sample();
  return w;
}
