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
    && typeof wd.params === 'object');
  return worlds.length ? worlds : null;
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
    const want = Number(raw.slot);
    const i = (Number.isInteger(want) && want >= 1 && want <= slots) ? want : free();
    if (!i || taken.has(i)) { skipped++; continue; }
    const { slot, ...world } = raw;
    writes.push({ slot: i, world });
    taken.add(i);
  }
  return { writes, skipped };
}
