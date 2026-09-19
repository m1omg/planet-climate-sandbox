// Save files: what goes in one, and where the worlds in one land.
//
// Kept free of the DOM and of localStorage for the same reason controls.js is,
// which is that the rules are worth testing on their own. Reading a file,
// deciding which slot each world belongs in, and refusing the things that are
// not save files at all are all decisions, and none of them needs a browser to
// make. main.js keeps the parts that genuinely do: the file picker, the Blob,
// and the storage.

export const SAVE_FILE_KIND = 'planet-climate-sandbox/saves';
export const SLOTS = 5;

// The document that gets downloaded. Versioned, and named in a way that says
// what wrote it -- a bare array of unlabelled objects in someone's downloads
// folder a year from now is a puzzle rather than a save.
export function buildSaveFile(worlds, at = 0) {
  return { kind: SAVE_FILE_KIND, v: 1, at, worlds };
}

// Liberal in what it accepts, because people will hand-edit these and because a
// save file is not worth being precious about: the document this writes, a bare
// array of worlds, or a single world on its own.
//
// Strict about one thing only -- a world has to carry `params`, because that is
// what makes it a world rather than some other JSON that happened to be lying
// around. Without that check, importing an arbitrary file would fill the slots
// with objects that throw on restore.
export function parseSaveFile(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return null; }
  const list = Array.isArray(doc) ? doc
    : (doc && Array.isArray(doc.worlds)) ? doc.worlds
    : (doc && doc.params) ? [doc]
    : null;
  if (!list) return null;
  const worlds = list.filter((wd) => wd && typeof wd === 'object' && wd.params
    && typeof wd.params === 'object').map(scrubWorld);
  return worlds.length ? worlds : null;
}

// Values that are not values, taken out.
//
// Being liberal about the SHAPE of a save file is right -- people hand-edit
// these. Being liberal about its arithmetic is not. A mass of `null`, of
// `"heavy"`, or of anything else JSON will happily carry becomes NaN the moment
// it reaches the physics, and NaN does not stay where it is put: a NaN mass
// gives a NaN radius, a NaN gravity and a NaN temperature, and the readout then
// shows a planet with no numbers on it and nothing to say which field did it.
//
// `EARTH` is the schema, because it already is one -- every control the model
// has, with a value of the right type. A param is kept only if it matches the
// type of the reference, so a string where a number belongs goes, and so does
// Infinity, and so does the NaN that `JSON.parse` never produces but a
// hand-edit of `1e999` does.
//
// Dropped rather than clamped, and dropped rather than refused. Dropping leaves
// the preset's value, which is exactly what happens when a save omits the key
// -- a shape this file already handles -- so a save with one bad field loads as
// a world missing that one field instead of failing whole or arriving broken.
//
// The damage is not only in `params`: `T` is an array of band temperatures and
// `water` a set of reservoirs, and a NaN in either is the same poison arriving
// by a different door. Those have no schema to check against, so the rule there
// is the weaker one that is still worth having -- a number has to be finite.
import { EARTH } from './presets.js';

function scrubParams(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    const ref = EARTH[k];
    if (ref === undefined) { out[k] = v; continue; }   // not ours to judge
    if (typeof ref === 'number') { if (Number.isFinite(v)) out[k] = v; continue; }
    if (typeof ref === 'boolean') { if (typeof v === 'boolean') out[k] = v; continue; }
    if (typeof v === typeof ref) out[k] = v;
  }
  return out;
}

// The fields of a captured world that hold numbers and nothing else. Named
// rather than guessed, because "drop anything that is not a finite number"
// would also eat the world's name, and "drop only NaN and Infinity" lets
// `[288, "hot", 290]` through to become a NaN band the moment it is copied in.
//
// A field added to captureWorld and forgotten here is the failure worth
// fearing, so selftest.js checks this list against what captureWorld actually
// produces rather than trusting it to be kept up to date by hand.
export const NUMERIC_FIELDS = ['time', 'waterInitial', 'iceSheet', 'hotLayer', 'coldT',
  'landIceMass', 'co2Frozen', 'otherGHG', 'aerosol', 'carbonDeep', 'bio',
  'fossil', 'industrial', 'co2', 'n2', 'o2', 'ch4', 'h2', 'he'];
// ...and the ones that are a bag of numbers rather than one. `T` is the band
// temperatures, and a hole in it is worse than no array at all: applyWorld
// copies index by index, so a single bad band would leave the rest of the world
// at the fresh planet's temperatures and look like a climate.
const NUMERIC_BAGS = ['water', 'life', 'evolve0'];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function scrubBag(v) {
  if (!v || typeof v !== 'object') return undefined;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (finite(x)) out[k] = x;
  return out;
}

function scrubWorld(wd) {
  const out = {};
  for (const [k, v] of Object.entries(wd)) {
    if (k === 'params') continue;
    if (NUMERIC_FIELDS.includes(k)) { if (finite(v)) out[k] = v; continue; }
    if (NUMERIC_BAGS.includes(k)) {
      const bag = scrubBag(v);
      if (bag) out[k] = bag;
      continue;
    }
    if (k === 'T') {
      if (Array.isArray(v) && v.length && v.every(finite)) out[k] = v;
      continue;
    }
    out[k] = v;
  }
  out.params = scrubParams(wd.params);
  return out;
}
// Which world goes where.
//
// A merge, not a replacement, and that is the whole point of the rule: a file
// with three planets in slots 1-3 leaves slots 4 and 5 exactly as they were, so
// importing somebody else's set cannot quietly take yours with it. A world that
// names a slot gets that slot; one that does not gets the first free slot; and
// when there is no free slot left it is reported rather than dropped in silence
// or written over something.
//
// `isEmpty(i)` answers for the slots as they are now. Slots claimed earlier in
// this same import count as taken, so two unnumbered worlds cannot land on top
// of each other.
export function planImport(worlds, isEmpty, slots = SLOTS) {
  const writes = [], taken = new Set();
  let skipped = 0;
  const free = () => {
    for (let i = 1; i <= slots; i++) if (!taken.has(i) && isEmpty(i)) return i;
    return 0;
  };
  for (const raw of worlds) {
    if (!raw || typeof raw !== 'object' || !raw.params) { skipped++; continue; }
    // 'auto' is the autosave's own tile rather than a number, and a file that
    // names it puts the world back where it came from. Everything else is a
    // numbered slot, or the first free one when the file says nothing usable.
    const want = raw.slot === 'auto' ? 'auto' : Number(raw.slot);
    const i = want === 'auto' ? 'auto'
      : (Number.isInteger(want) && want >= 1 && want <= slots) ? want : free();
    if (!i || taken.has(i)) { skipped++; continue; }
    const { slot, ...world } = raw;
    writes.push({ slot: i, world });
    taken.add(i);
  }
  return { writes, skipped };
}
