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

// Everything about a world that is not derived from the rest of it.
//
// Deliberately absent: `history`, which is the run rather than the world and is
// megabytes of it; `diag`, which update() rebuilds from this; and `dtPrev`,
// which is a hint to the step-size chooser and is re-derived within one step.
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
    co2: w.co2, n2: w.n2, o2: w.o2, ch4: w.ch4, h2: w.h2,
    // Two rates rather than reservoirs, and they are here for the same reason
    // the reservoirs are. `ch4Escape` is the hydrogen last step's methane
    // photolysis sent to space, which the oxygen budget spends on the next one;
    // `h2Rate` is what the step-size chooser bounds hydrogen on. Both are read
    // before they are rewritten, so a world restored without them takes a
    // different first step from the one it took the first time -- and the
    // scrubber is then quietly a different simulation, which is precisely what
    // the round-trip test exists to catch.
    ch4Escape: w.ch4Escape, h2Rate: w.h2Rate,
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
  // Hydrogen was missing from here for as long as it has existed, and reset()
  // refills it from the *parameter* rather than leaving it alone -- so a world
  // that had escaped 44% of its hydrogen got every gram of it back the moment it
  // was saved and reloaded. The round-trip test could not see it because its own
  // state vector did not list h2 either; it does now.
  if (s.h2 != null) w.h2 = s.h2;
  update(w, 0);
  // After update(), because a zero-length step rewrites both of these to zero.
  if (s.ch4Escape != null) w.ch4Escape = s.ch4Escape;
  if (s.h2Rate != null) w.h2Rate = s.h2Rate;
  return w;
}
