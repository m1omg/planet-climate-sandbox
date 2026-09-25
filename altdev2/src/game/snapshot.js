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
// rebuilt from nothing on the first step after a restore, so `maxStep` loses
// the bounds it had and the world resumes on a different step sequence from
// the one it was on.
//
// `dtPrev` above all. It was called "a hint ... re-derived within one step",
// and that is wrong twice over: `maxStep` guards its log-smoothing with
// `if (prev > 0)`, so at zero the smoothing is not re-derived, it is skipped
// entirely -- measured at 2.2x the step the same world was actually taking.
//
// Kept as its own object so that what is physics and what is bookkeeping stay
// visibly apart, and so a save written before this existed simply restores
// without it, exactly as it did before.
const RUNTIME = ['dtPrev', 'trustOver', 'ringing', 'lastMove',
  // Both halves of a starlight walk in progress. The target alone restores
  // the destination without the speed, so `approach` is handed an undefined
  // rate and the walk finishes in one step -- a save taken mid-drag came back
  // already arrived.
  'insolationTarget', 'insolationRate',
  'escape', 'weathering', 'o2Rate', 'o2Flux',
  'ch4Source', 'ch4Tau', 'iceDeep', 'iceRate', 'iceMark', 'liquidRate', 'vapourRate',
  'liquidMark', 'vapourMark', 'lifeRoom', 'landIceTarget', 'trapActive', 'emitting',
  // The pool's ice floor at the end of the last step, which is what the melt
  // over this step is charged against; and the band ice, which is what the
  // ice-edge step bound compares to. Both are last-step memories: restored
  // without them the first step after a load is unbounded and uncharged.
  'poolIce', 'iceMeanPrev', 'iceMeanLast',
  // The Undo Venus scenario's hold-below-boiling timer, so a save mid-hold
  // resumes the hold rather than restarting it.
  'coolSince'];

// Fields that really are derived afresh every step, listed so that the
// completeness check in selftest.js can tell "deliberately absent" from
// "forgotten". Anything on a world that is in neither list fails that check.
export const DERIVED = ['params', 'T', 'water', 'diag', 'history', '_buf', '_solve',
  'fastPhysics'];

function captureRuntime(w) {
  const out = {};
  for (const k of RUNTIME) {
    const v = w[k];
    // `null` is carried, `undefined` is not. On several of these the two are
    // different states -- `iceMark` is null until the first window closes --
    // and dropping the null restored it as undefined, which is a third state
    // the model never writes.
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
    // How deep the hot layer has got. A save that dropped this would restore a
    // cold-start world as a hot-start one -- same star, same water, different
    // planet -- which is exactly the distinction it exists to carry.
    hotLayer: w.hotLayer,
    coldT: w.coldT,
    landIceMass: w.landIceMass,
    life: w.life ? { ...w.life } : null,
    co2Frozen: w.co2Frozen,
    // The other gases condense too, and a save that dropped these would
    // resume a frozen-out world with its air gone for good.
    n2Frozen: w.n2Frozen, o2Frozen: w.o2Frozen, ch4Frozen: w.ch4Frozen,
    fossil: w.fossil,
    // The two industrial reservoirs. The aerosol clears in a decade and the
    // gases do not, and a save that dropped them would resume every world in
    // the middle of its own termination shock.
    otherGHG: w.otherGHG, aerosol: w.aerosol, industrial: w.industrial,
    carbonDeep: w.carbonDeep,
    bio: w.bio,
    co2: w.co2, n2: w.n2, o2: w.o2, ch4: w.ch4,
    // The envelope. A save that dropped it would restore a Hycean world as a
    // bare rock at the same temperature and then watch it freeze.
    h2: w.h2, he: w.he,
    // Where the evolving controls started. Without this a saved world resumes
    // with its star re-based to whatever brightness it had reached, and the
    // history scrubber would brighten it a second time on the way back.
    evolve0: w.evolve0 ? { ...w.evolve0 } : null,
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
  w.hotLayer = s.hotLayer ?? null;
  w.coldT = s.coldT ?? null;
  w.landIceMass = s.landIceMass ?? null;
  w.life = s.life ? { ...s.life } : { pro: 0, euk: 0 };
  w.co2Frozen = s.co2Frozen ?? 0;
  w.n2Frozen = s.n2Frozen ?? 0; w.o2Frozen = s.o2Frozen ?? 0; w.ch4Frozen = s.ch4Frozen ?? 0;
  w.fossil = s.fossil ?? null;
  w.otherGHG = s.otherGHG ?? w.otherGHG;
  w.aerosol = s.aerosol ?? w.aerosol;
  w.industrial = s.industrial ?? w.industrial;
  w.carbonDeep = s.carbonDeep ?? null;
  w.bio = s.bio ?? null;
  if (s.evolve0) w.evolve0 = { ...s.evolve0 };
  if (s.co2 != null) w.co2 = s.co2;
  if (s.n2 != null) w.n2 = s.n2;
  if (s.o2 != null) w.o2 = s.o2;
  if (s.ch4 != null) w.ch4 = s.ch4;
  if (s.h2 != null) w.h2 = s.h2;
  if (s.he != null) w.he = s.he;
  // Before update(), so that a zero-length step sees the same bounds and the
  // same smoothed rates the world had when it was captured. A save from before
  // this field existed has no `runtime` and restores exactly as it used to.
  if (s.runtime) {
    for (const k of RUNTIME) {
      const v = s.runtime[k];
      if (v === undefined) continue;
      w[k] = v !== null && typeof v === 'object' ? { ...v } : v;
    }
  }
  update(w, 0);
  // The history starts here, at the world that was restored, not at the fresh
  // one `sim.reset` made on the way in. reset() empties the history and takes a
  // sample before any of the saved state has been applied, so a world loaded at
  // ten megayears carried a first chart point from year zero of a planet that
  // never existed -- right temperature for the params, wrong world, and the
  // chart drew a line to it.
  w.history.length = 0;
  sim.sample();
  return w;
}
