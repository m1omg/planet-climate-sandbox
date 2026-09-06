import { STATES } from '../physics/classify.js';
import { key, adopt } from './storage.js';
import { t, tx } from './i18n.js';

// Namespaced, and it was not.
//
// This module was written before the builds were told apart and kept its own
// key, so it was missed when everything in main.js was namespaced: the stable
// build at / and this one shared one discovery log. The twenty state ids are
// the same in both and the physics are not, so a climate reached under this
// build's model read as discovered under the other's, and the completionist
// count was the union of two different games.
//
// The bare key is adopted once, so nobody who has been playing this build opens
// it to an empty log -- see storage.js for why that is a copy and not a move.
const KEY = key('discovered.v1');
const BARE = 'planetclimate.discovered.v1';

export function loadDiscovered() {
  try { return new Set(JSON.parse(adopt('discovered.v1', BARE) || '[]')); }
  catch { return new Set(); }
}

export function saveDiscovered(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* private mode */ }
}

export function buildLogUI(container, discovered, onSelect) {
  container.innerHTML = '';
  for (const [id, s] of Object.entries(STATES)) {
    const el = document.createElement('button');
    el.className = 'state-card' + (discovered.has(id) ? ' found' : '');
    el.dataset.id = id;
    el.innerHTML = `<span class="dot" style="background:${s.color}"></span>
      <span class="nm">${discovered.has(id) ? (tx('states', id, 'name') || s.name) : '???'}</span>`;
    el.title = discovered.has(id) ? (tx('states', id, 'blurb') || s.blurb) : t('Not yet discovered');
    el.addEventListener('click', () => onSelect(id));
    container.appendChild(el);
  }
}

export function markFound(container, id) {
  const el = container.querySelector(`[data-id="${id}"]`);
  if (el && !el.classList.contains('found')) {
    el.classList.add('found', 'just-found');
    el.querySelector('.nm').textContent = tx('states', id, 'name') || STATES[id].name;
    el.title = tx('states', id, 'blurb') || STATES[id].blurb;
    setTimeout(() => el.classList.remove('just-found'), 2200);
    return true;
  }
  return false;
}
