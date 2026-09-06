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
    // How deep the hot layer has got. A save that dropped this would restore a
    // cold-start world as a hot-start one -- same star, same water, different
    // planet -- which is exactly the distinction it exists to carry.
    hotLayer: w.hotLayer,
    landIceMass: w.landIceMass,
    life: w.life ? { ...w.life } : null,
    co2Frozen: w.co2Frozen,
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
  w.landIceMass = s.landIceMass ?? null;
  w.life = s.life ? { ...s.life } : { pro: 0, euk: 0 };
  w.co2Frozen = s.co2Frozen ?? 0;
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
  update(w, 0);
  return w;
}
