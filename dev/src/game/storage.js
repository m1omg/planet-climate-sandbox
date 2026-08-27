// Where this build keeps its browser data.
//
// localStorage is keyed by ORIGIN, not by path, so the stable site at /, the
// dev build at /dev/ and the alternative line at /altdev/ were all reading and
// writing the same keys. That is not academic: slot 1 is the autosave and it
// fires every thirty seconds, so a minute spent in one build wrote over a world
// saved from another. A slot carries full simulation state and no build tag, so
// the world then loaded without complaint in the other build and simulated
// differently -- a silent wrong answer, which is the worst kind.
//
// The scope is taken from the path rather than written into the source as a
// constant, because this source is both the dev build and, once it merges, the
// site root. A constant saying "dev" would travel with it and move everybody's
// saved worlds out from under them on the day it shipped. A copy served from a
// directory below the site root is a separate build and takes that directory's
// name; the root keeps the bare keys it has always used.
//
// Worlds still travel between builds the way they should. The URL hash and the
// export file both carry parameters rather than physics state, so they mean the
// same thing wherever they are opened -- which is why neither is namespaced.
import { SLOTS } from './saves.js';

const PREFIX = 'planetclimate';

// A namespace ends up inside a storage key and inside a href in the dev banner,
// so it is reduced to letters, digits and hyphens rather than trusted.
const clean = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);

// Which build this is, from what the page can see about itself.
//
// `__assetBase` is the honest signal. A copy below the site root borrows the
// 23 MB of surface maps at the root rather than shipping a second set, and says
// so by pointing that at `../assets/`. It is set by the thing that made the
// copy, for a reason that has nothing to do with storage, so it cannot drift
// out of agreement with where the files actually are. The directory the page
// was served from then supplies the name.
//
// Pure, and separate from the globals it reads, because the interesting cases
// are three paths that no Node test can be served from.
export function scopeFor({ assetBase, pathname, forced } = {}) {
  if (typeof forced === 'string' && forced) return clean(forced);
  if (typeof assetBase !== 'string' || !assetBase.startsWith('../')) return '';
  const dir = String(pathname || '/').replace(/[^/]*$/, '');
  return clean(dir.split('/').filter(Boolean).pop() || '');
}

export const storageScope = scopeFor({
  assetBase: globalThis.__assetBase,
  pathname: globalThis.location && globalThis.location.pathname,
  forced: globalThis.__storageScope,
});

export const key = (name) =>
  storageScope ? `${PREFIX}.${storageScope}.${name}` : `${PREFIX}.${name}`;

// Everything that was in the shared namespace before it was split. Listed
// rather than discovered, because localStorage cannot be enumerated by prefix
// without walking every key on the origin, and this origin is not only us.
const SHARED = ['discovered.v1', 'quality.v1', 'atmosphere.v1', 'resetPaused.v1'];
for (let i = 1; i <= SLOTS; i++) SHARED.push(`slot${i}.v1`);

// The slots were shared until now, so a build that namespaces them for the
// first time would open with five empty ones and look exactly like data loss.
// Take what was in the shared keys, once, and only into a namespace with
// nothing in it yet. A copy and never a move: the stable site keeps every world
// it had, and from here on the two sets go their own ways.
//
// Marked as done before the copying rather than after, so a full quota leaves
// this having tried once instead of retrying on every load forever.
function adoptShared(store) {
  if (!storageScope || !store) return 0;
  let copied = 0;
  try {
    if (store.getItem(key('adopted.v1'))) return 0;
    store.setItem(key('adopted.v1'), String(Date.now()));
    for (const name of SHARED) {
      const was = store.getItem(`${PREFIX}.${name}`);
      if (was == null || store.getItem(key(name)) != null) continue;
      store.setItem(key(name), was);
      copied++;
    }
  } catch { /* full, or blocked: the empty namespace is still correct */ }
  return copied;
}

// At import, because log.js reads the discovery set while main.js is still
// evaluating its own top level. Anything that has to happen before the first
// read cannot be a call somebody remembers to make.
export const adopted = adoptShared(globalThis.localStorage);
