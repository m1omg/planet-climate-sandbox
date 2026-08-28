// Where this build's browser storage lives.
//
// localStorage is scoped to the ORIGIN, not to the path, so every copy of this
// site served from m1omg.github.io -- the stable one at /, /dev/ and this one --
// reads and writes the same keys unless they are told apart. They were not, and
// the consequence was not academic: slot 1 is the autosave slot and it fires
// every thirty seconds, so a minute spent in one build silently overwrote a
// world saved from another. Worse, a slot holds full simulation state rather
// than slider values and there is no version tag on it, so the world loaded
// fine in the other build and then simulated differently. Silent wrong answers.
//
// The namespace lives here rather than in main.js because main.js is not the
// only module that stores anything. The discovery log had its own key, was
// written before this namespacing existed, and was therefore missed -- so the
// list of climates you have found was one shared set between the stable build
// and this one. Not corrupting, because no simulation state crosses over, but a
// genuine cross-build write: the twenty states are the same ids in both, and
// this build's physics are not the same physics, so a climate reached under one
// model showed up as discovered under the other.
//
// One export, used by everything that touches localStorage, so the next module
// to want a key cannot repeat that.
//
// Worlds still travel between builds the way they should: the URL hash and the
// export file both carry parameters rather than physics state, so they mean the
// same thing wherever they are opened.
export const NS = 'planetclimate.altdev';

export function key(name) {
  return `${NS}.${name}`;
}

// Read a key that predates the namespacing, once, and only if the namespaced
// one is empty.
//
// Namespacing a key that already had data in it silently throws that data away:
// anyone who had been playing this build would have opened it to an empty
// discovery log with no way to know why. So the old value is adopted the first
// time the new one is asked for and missing.
//
// A copy, never a move. The bare key is the stable build's own key and it is
// still using it -- deleting or rewriting it here would be doing to that build
// exactly what this whole file exists to prevent.
export function adopt(name, bare) {
  const k = key(name);
  try {
    if (localStorage.getItem(k) !== null) return localStorage.getItem(k);
    const old = localStorage.getItem(bare);
    if (old === null) return null;
    localStorage.setItem(k, old);
    return old;
  } catch { return null; }   // private mode, or storage disabled
}
