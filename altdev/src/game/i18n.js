// Language: one dictionary, a switch, and a guess for people who never touch it.
//
// The rule this follows is that the model speaks English and the page speaks to
// the player. Nothing under src/physics/ knows a language exists: `classify()`
// still returns `id: 'snowball'` and the English name beside it, the self-test
// still asserts against those, and translation happens where the text is put on
// screen. A dictionary that reached into the physics would make every check in
// selftest.js language-dependent, which is a bad trade for a model whose whole
// output is text about planets.
//
// Two kinds of lookup, because there are two kinds of string:
//
//   t('Settle')                      — UI text, keyed by the English itself
//   tx('states', 'snowball', 'name') — content, keyed by the id it belongs to
//
// Keying UI text by its English source means no key files to keep in step and no
// `ui.timebar.settle` indirection to read past; a missing entry falls through to
// English, which is a usable page rather than a broken one. Content is keyed by
// id because a preset's name is a name, not a label, and because two states can
// legitimately share an English word and must not share a Slovak one.
import { SK } from './sk.js';
import { key } from './storage.js';

const KEY = key('lang.v1');

// Add a language by adding a dictionary here. Everything else follows.
const DICTS = { sk: SK };
export const LANGS = [
  { id: 'en', tag: 'EN', name: 'English' },
  { id: 'sk', tag: 'SK', name: 'Slovenčina' },
];

function known(l) { return l === 'en' || !!DICTS[l]; }

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

// A stored choice wins; otherwise take the first language the browser asks for
// that this page can actually speak. `navigator.languages` is in preference
// order, so somebody whose list reads sk, cs, en gets Slovak and somebody whose
// list reads cs, en gets English rather than the nearest Slavic language --
// guessing across languages is how you end up serving Czech to Slovaks.
export function detectLang() {
  const saved = stored();
  if (saved && known(saved)) return saved;
  // The smoke test loads every module against a stub DOM that has no navigator,
  // and a module that reads one at import time takes the whole graph down with
  // it. Nothing here may assume a browser: the page gets a language, a headless
  // run gets English.
  if (typeof navigator === 'undefined') return 'en';
  const list = navigator.languages && navigator.languages.length
    ? navigator.languages : [navigator.language || 'en'];
  for (const tag of list) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (known(base)) return base;
  }
  return 'en';
}

let lang = detectLang();
export function currentLang() { return lang; }

const listeners = new Set();
export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setLang(l) {
  if (!known(l) || l === lang) return lang;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = l;
  applyStatic();
  for (const fn of listeners) fn(l);
  return lang;
}

// --- the two lookups -------------------------------------------------------

export function t(s) {
  if (lang === 'en' || typeof s !== 'string') return s;
  const d = DICTS[lang];
  return (d && d.ui[s]) || s;
}

// Interpolation, so a translated sentence can put its numbers where its own
// grammar wants them rather than where English left them.
export function tp(s, ...args) {
  return String(t(s)).replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : args[i]));
}

export function tx(kind, id, field) {
  if (lang === 'en') return null;
  const d = DICTS[lang];
  const entry = d && d[kind] && d[kind][id];
  const v = entry && (field ? entry[field] : entry);
  return typeof v === 'string' ? v : null;
}

// --- the static page -------------------------------------------------------
//
// Everything written into index.html by hand, translated in place. The English
// is cached the first time a node is seen, so switching back is a restore and
// not a second translation -- and so a language with no entry for a string
// leaves the English rather than whatever the previous language put there.
const ORIG_TEXT = new WeakMap();
const ORIG_ATTR = new WeakMap();
const ATTRS = ['title', 'placeholder', 'aria-label', 'data-empty'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'CANVAS']);

export function applyStatic(root) {
  if (typeof document === 'undefined') return;
  const scope = root || document.body;
  if (!scope || !document.createTreeWalker) return;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && SKIP.has(n.parentElement.tagName)
      ? NodeFilter.FILTER_REJECT
      : (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!ORIG_TEXT.has(n)) ORIG_TEXT.set(n, n.nodeValue);
    const src = ORIG_TEXT.get(n);
    // Markup wraps text at whatever column the file wanted; the dictionary is
    // keyed on the sentence, so match on the collapsed form and put the
    // surrounding whitespace back afterwards.
    const lead = src.match(/^\s*/)[0], tail = src.match(/\s*$/)[0];
    const body = src.trim().replace(/\s+/g, ' ');
    const out = t(body);
    n.nodeValue = out === body ? src : lead + out + tail;
  }
  const els = [scope, ...scope.querySelectorAll('*')];
  for (const el of els) {
    if (!el.getAttribute) continue;
    let cache = ORIG_ATTR.get(el);
    for (const a of ATTRS) {
      const has = el.hasAttribute(a);
      if (!has && !(cache && cache.has(a))) continue;
      if (!cache) { cache = new Map(); ORIG_ATTR.set(el, cache); }
      if (!cache.has(a)) cache.set(a, el.getAttribute(a));
      const src = cache.get(a);
      if (src) el.setAttribute(a, t(src.replace(/\s+/g, ' ')));
    }
  }
}

// The switch itself. Two languages, so it is a toggle; more than two and this
// becomes a menu, which is why it reads the list rather than hard-coding a pair.
export function nextLang() {
  const i = LANGS.findIndex((l) => l.id === lang);
  return LANGS[(i + 1) % LANGS.length].id;
}
