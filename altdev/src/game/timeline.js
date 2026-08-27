// Going back to look at what the world was, and letting it take a different
// path from there.
//
// The history charts have always drawn where a planet has been. This is what
// makes that history *somewhere you can stand*: keep whole world states as it
// runs, and a click on the temperature chart puts the simulation back into one
// of them. Change a slider from there and the world takes a different route.
//
// Kept free of the DOM for the same reason controls.js and saves.js are. Which
// state a click lands on, and what happens to the future once you have gone
// back and changed something, are decisions worth testing on their own.

// How many world states to keep. Each is about 1.1 kB, so this is a couple of
// hundred kilobytes -- nothing against the megabytes of surface texture already
// resident, and worth far more.
export const RESTORE_CAP = 160;

// Thinning, when the buffer fills.
//
// Half the points go, and the survivors are the ones that leave the rest most
// evenly spread in LOG time -- because log time is the axis the history chart
// draws, and evenly spread on the chart is exactly what a scrubber needs. Even
// spacing in years would put every point of a two-billion-year run inside its
// last few million.
//
// Two simpler versions were tried and measured, and both fail the same way:
// they thin an array whose spacing is already uneven, and preserve that
// unevenness. Keeping every second point lets the old end double its gap every
// round. Re-spacing evenly by array INDEX looks right -- the simulation samples
// geometrically, so index is nearly linear in log time -- but that only holds
// for points that survived intact, and after a few rounds of thinning it does
// not hold at all. Both ended with a worst gap of a thousand points against a
// best of one: two thirds of the chart with nothing to land on, so dragging
// there snapped back to one ancient moment.
//
// Selecting against log time directly cannot drift, because it re-derives the
// spacing from the times themselves every round rather than trusting the
// array's shape.
const logT = (p) => Math.log10(Math.max(p.time, 0) + 1);

export function pushRestore(points, snap, cap = RESTORE_CAP) {
  points.push(snap);
  if (points.length <= cap) return points;

  const target = Math.max(2, Math.floor(cap / 2));
  const lo = logT(points[0]), hi = logT(points[points.length - 1]);
  const kept = [points[0]];
  if (hi > lo) {
    // Walk once: for each evenly spaced position, take the nearest point not
    // already taken. Points are in time order, so a single forward scan does it.
    let j = 0;
    for (let i = 1; i < target - 1; i++) {
      const want = lo + (hi - lo) * (i / (target - 1));
      while (j + 1 < points.length - 1 && logT(points[j + 1]) <= want) j++;
      // j is the last point at or before `want`; j+1 the first after it.
      const a = points[j], b = points[Math.min(j + 1, points.length - 2)];
      const pick = Math.abs(logT(a) - want) <= Math.abs(logT(b) - want) ? a : b;
      if (pick !== kept[kept.length - 1]) kept.push(pick);
    }
  }
  kept.push(points[points.length - 1]);   // the newest moment is never dropped
  points.length = 0;
  for (const p of kept) points.push(p);
  return points;
}

// The state to put the world into for a click at time t: the latest one at or
// before it, because a world can only be restored to a moment it was actually
// in. Clicking before the first point gives the first point, which is the
// earliest the world can go back to.
export function findRestore(points, t) {
  if (!points.length) return null;
  let best = points[0];
  for (const p of points) {
    if (p.time <= t && p.time >= best.time) best = p;
  }
  // Every point is later than the click: the earliest is as far back as it goes.
  if (best.time > t) {
    for (const p of points) if (p.time < best.time) best = p;
  }
  return best;
}

// What is left of a run once you have gone back and changed something.
//
// The future is dropped. That is a deliberate simplification and it is what
// was asked for: a world has one history, not a tree of them. If you want to
// keep the path you are abandoning, save it to a slot first -- and slot 1 has
// been keeping itself since the autosave went in, so in practice the version
// you walked away from is usually still there.
export function truncateAfter(arr, t, key = 'time') {
  const out = arr.filter((p) => p[key] <= t);
  arr.length = 0;
  for (const p of out) arr.push(p);
  return arr;
}
