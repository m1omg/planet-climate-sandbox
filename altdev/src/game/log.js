import { STATES } from '../physics/classify.js';

const KEY = 'planetclimate.discovered.v1';

export function loadDiscovered() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); }
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
      <span class="nm">${discovered.has(id) ? s.name : '???'}</span>`;
    el.title = discovered.has(id) ? s.blurb : 'Not yet discovered';
    el.addEventListener('click', () => onSelect(id));
    container.appendChild(el);
  }
}

export function markFound(container, id) {
  const el = container.querySelector(`[data-id="${id}"]`);
  if (el && !el.classList.contains('found')) {
    el.classList.add('found', 'just-found');
    el.querySelector('.nm').textContent = STATES[id].name;
    el.title = STATES[id].blurb;
    setTimeout(() => el.classList.remove('just-found'), 2200);
    return true;
  }
  return false;
}
