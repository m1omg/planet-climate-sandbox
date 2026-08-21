// Parses every planet shader with a real GLSL ES 3.0 grammar, assembling them
// exactly as the runtime does (noise spliced in from the shared file), and
// enforces a per-pixel noise budget so the cost that once made this unusable on
// mobile cannot silently creep back.
import { parse } from '/home/mroz/.nvm/versions/node/v20.20.2/lib/node_modules/@shaderfrog/glsl-parser/parser/parser.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (f) => readFileSync(join(root, 'src/render/glsl', f), 'utf8');
const noise = read('noise.glsl');
const splice = (src) => src.replace('//__NOISE__', noise);

let failed = 0;
const check = (name, src) => {
  try {
    parse(src.replace(/^#version[^\n]*\n/, ''), { quiet: true });
    console.log(`\x1b[32mPASS\x1b[0m  ${name}`);
  } catch (e) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  ${name}\n        ${String(e.message).split('\n').slice(0, 4).join('\n        ')}`);
  }
};

check('planet.vert', read('planet.vert'));
check('planet.frag', splice(read('planet.frag')));
check('bake.vert', read('bake.vert'));
check('bake.frag', splice(read('bake.frag')));
check('cloudbake.frag', splice(read('cloudbake.frag')));

// --- every function the runtime shader calls must actually be defined --------
// Comments are stripped first: prose is full of words followed by a bracket.
const decomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
{
  const src = decomment(splice(read('planet.frag')));
  const defined = new Set([...src.matchAll(/^\s*(?:[a-z0-9]+\s+)?(?:vec[234]|float|int|mat[234]|void|bool)\s+(\w+)\s*\(/gm)].map((m) => m[1]));
  const builtin = new Set(['vec2','vec3','vec4','mat2','mat3','mat4','float','int','bool','mix','clamp',
    'smoothstep','sin','cos','tan','atan','acos','asin','pow','exp','log','sqrt','abs','floor','fract',
    'min','max','dot','cross','normalize','length','texture','reflect','refract','sign','mod','step',
    'distance','main','if','for','while','return','textureLod']);
  const called = new Set([...src.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)].map((m) => m[1]));
  const missing = [...called].filter((c) => !defined.has(c) && !builtin.has(c) && !c.startsWith('gl_'));
  if (missing.length) { failed++; console.log(`\x1b[31mFAIL\x1b[0m  undefined in planet.frag: ${missing.join(', ')}`); }
  else console.log('\x1b[32mPASS\x1b[0m  every function planet.frag calls is defined');
}

// --- noise cost budgets ------------------------------------------------------
// The runtime shader once evaluated 269 gradient-noise fields per pixel, every
// frame, which is why a tablet managed one frame a second. Those fields are
// time-invariant and now come from baked cube maps.
//
// The bake then became the expensive thing, and its cost was invisible in two
// ways at once. fbm and ridged ran a fixed eight octaves and multiplied the
// unwanted ones by zero, so a call written fbm(p, 3) cost eight; and the four
// gradient samples in bake.frag each re-evaluated the whole height field, which
// no call-site count would show. Together that made one 512² draw call 1.6
// billion sin() calls, which Android's GPU watchdog treats as a hung driver and
// resets -- the freeze and the black screen on a perfectly capable tablet.
//
// So resolve the real cost through the call graph rather than counting call
// sites, and budget it.
{
  const KEYWORDS = new Set(['return', 'if', 'else', 'for', 'while', 'do', 'discard',
    'const', 'in', 'out', 'inout', 'uniform', 'varying', 'attribute', 'precision',
    'layout', 'struct', 'break', 'continue', 'case', 'switch', 'else']);

  const matchBrace = (src, from) => {          // from points at the opening '{'
    let depth = 0, i = from;
    do { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
    while (depth > 0 && i < src.length);
    return src.slice(from + 1, i - 1);
  };

  const extractDefs = (src, into = new Map()) => {
    for (const m of src.matchAll(/(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
      if (KEYWORDS.has(m[1]) || KEYWORDS.has(m[2])) continue;
      into.set(m[2], matchBrace(src, m.index + m[0].length - 1));
    }
    return into;
  };

  // Cost of a body in gradient-noise evaluations, with loop bodies multiplied by
  // their iteration count and every call resolved to the work it really does.
  const bodyCost = (body, resolve) => {
    let rest = body, cost = 0;
    for (;;) {
      const m = /for\s*\(\s*\w+\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*(\d+)\s*;[^)]*\)\s*\{/.exec(rest);
      if (!m) break;
      const inner = matchBrace(rest, m.index + m[0].length - 1);
      cost += Number(m[1]) * bodyCost(inner, resolve);
      rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length + inner.length + 1);
    }
    for (const c of rest.matchAll(/\b(\w+)\s*\(/g)) cost += resolve(c[1]);
    return cost;
  };

  const costerFor = (extraSrc = '') => {
    const defs = extractDefs(decomment(noise));
    if (extraSrc) extractDefs(decomment(extraSrc), defs);
    const cache = new Map([['gnoise', 1], ['vnoise', 1]]);
    const busy = new Set();
    const resolve = (name) => {
      if (cache.has(name)) return cache.get(name);
      if (busy.has(name) || !defs.has(name)) return 0;   // builtin, or recursion
      busy.add(name);
      const v = bodyCost(defs.get(name), resolve);
      busy.delete(name); cache.set(name, v);
      return v;
    };
    return { resolve, defs, cache };
  };

  // A function called fbm4 must run four octaves, not eight with four thrown
  // away. That regression cost 1.84x for nothing, and nothing was watching.
  {
    const { resolve, cache } = costerFor();
    for (const n of ['fbm3', 'fbm4', 'fbm5', 'fbm6', 'ridged4', 'ridged5', 'warpedFbm6']) resolve(n);
    const wrong = [];
    for (const [name, cost] of cache) {
      const m = /^(fbm|ridged|warpedFbm)(\d+)$/.exec(name);
      if (!m) continue;
      const n = Number(m[2]);
      const expect = m[1] === 'warpedFbm' ? 3 * (cache.get('fbm4') ?? 4) + n : n;
      if (cost !== expect) wrong.push(`${name} costs ${cost}, should be ${expect}`);
    }
    if (wrong.length) {
      failed++;
      console.log(`\x1b[31mFAIL\x1b[0m  noise functions do more work than their names say: ${wrong.join('; ')}`);
    } else {
      const shown = [...cache].filter(([k]) => /\d$/.test(k)).map(([k, v]) => `${k}=${v}`).join(' ');
      console.log(`\x1b[32mPASS\x1b[0m  noise octave counts honest  (${shown})`);
    }
  }

  const costOfShader = (file) => {
    const src = read(file);
    const { resolve, defs } = costerFor(src);
    return defs.has('main') ? bodyCost(defs.get('main'), resolve) : 0;
  };

  let bakeCost = 0;
  for (const [file, budget] of [['planet.frag', 12], ['bake.frag', 160], ['cloudbake.frag', 24]]) {
    const total = costOfShader(file);
    if (file === 'bake.frag') bakeCost = total;
    const what = file === 'planet.frag' ? 'per pixel, every frame' : 'per texel, once per bake';
    if (total > budget || total === 0) {
      failed++;
      console.log(`\x1b[31mFAIL\x1b[0m  ${file}: ${total} noise evaluations ${what} (budget ${budget})`);
    } else {
      console.log(`\x1b[32mPASS\x1b[0m  ${file}: ${total}/${budget} noise evaluations ${what}`);
    }
  }

  // And the number that actually killed Android: how much one draw call asks
  // for. TILE_TEXELS bounds the strip; the bake shader's cost sets the rest.
  const planetJs = readFileSync(join(root, 'src/render/planet.js'), 'utf8');
  const tile = Number(/TILE_TEXELS\s*=\s*(\d+)/.exec(planetJs)?.[1] ?? 0);
  const SIN_PER_NOISE = 24;      // 8 hash3 per gnoise, 3 sin apiece
  const CAP = 120e6;             // sin() calls in one submit
  const worst = tile * bakeCost * SIN_PER_NOISE;
  if (!tile || worst > CAP) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  worst bake submit is ${(worst / 1e6).toFixed(0)}M sin() calls (cap ${CAP / 1e6}M) — Android resets the GPU on submits this long`);
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  worst bake submit ${(worst / 1e6).toFixed(0)}M/${CAP / 1e6}M sin()  ` +
      `(${tile} texels a strip; a whole 512² face would be ${(512 * 512 * bakeCost * SIN_PER_NOISE / 1e9).toFixed(1)}G)`);
  }
}

// --- nothing may be drawn over a solid planet ---------------------------------
// The star lies at infinity, so a ray that hits the planet must not also show
// it. This was invisible from the default viewpoint, where the star sits behind
// the camera, and appeared only once the view could be dragged round -- at
// twenty times the brightness of the surface, which reads as a transparent
// planet.
{
  const src = decomment(read('planet.frag'));
  const at = src.search(/pow\(\s*sd\s*,\s*900/);
  if (at < 0) {
    failed++;
    console.log('\x1b[31mFAIL\x1b[0m  star term not found in planet.frag');
  } else {
    const before = src.slice(0, at);
    const guard = before.lastIndexOf('if(!hitPlanet)');
    const stillOpen = guard >= 0 && !before.slice(guard).includes('}');
    if (!stillOpen) {
      failed++;
      console.log('\x1b[31mFAIL\x1b[0m  the star is drawn without checking the planet is out of the way');
    } else {
      console.log('\x1b[32mPASS\x1b[0m  the star is occluded by the planet');
    }
  }
}

// --- constructs GLSL ES 1.00 does not guarantee ------------------------------
// The WebGL1 fallback runs on drivers that enforce the ES 1.00 limits strictly.
// Two of these shipped broken: uniform float arrays indexed by a computed index
// (Appendix A makes support OPTIONAL, so a driver may legally refuse it), and a
// uniform budget far past the guaranteed minimum. headless-gl accepts both,
// which is exactly why they reached real browsers unnoticed.
{
  const src = decomment(splice(read('planet.frag')));

  // uniform arrays must not be indexed by a computed index
  const arrays = [...src.matchAll(/uniform\s+\w+\s+(\w+)\s*\[\s*\d+\s*\]/g)].map((m) => m[1]);
  const dynamic = [];
  for (const name of arrays) {
    for (const use of src.matchAll(new RegExp(`\\b${name}\\s*\\[([^\\]]+)\\]`, 'g'))) {
      const idx = use[1].trim();
      if (!/^\d+$/.test(idx)) dynamic.push(`${name}[${idx}]`);
    }
  }
  if (dynamic.length) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  uniform array indexed by a computed index (optional in ES 1.00): ${dynamic.join(', ')}`);
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  no uniform array is indexed by a computed index`);
  }

  // fragment uniform vectors, against the ES 1.00 guaranteed minimum of 16
  let vectors = 0;
  for (const m of src.matchAll(/uniform\s+(\w+)\s+(\w+)(?:\[(\d+)\])?\s*;/g)) {
    if (m[1].startsWith('sampler')) continue;
    vectors += Number(m[3] || 1);
  }
  const VEC_BUDGET = 32;
  if (vectors > VEC_BUDGET) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  ${vectors} fragment uniform vectors, budget ${VEC_BUDGET} (ES 1.00 guarantees only 16)`);
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  fragment uniform vectors: ${vectors}/${VEC_BUDGET}`);
  }

  // texture units, against the ES 1.00 guaranteed minimum of 8
  const samplers = [...src.matchAll(/uniform\s+sampler\w*\s+(\w+)\s*;/g)].map((m) => m[1]);
  const core = samplers.filter((n) => !/^uTex(Rock|Desert|Veg|Ice|Ocean|Lava)$/.test(n));
  if (core.length > 8) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  ${core.length} texture units needed even without the albedo maps (ES 1.00 guarantees 8)`);
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  texture units without albedo maps: ${core.length}/8  (${samplers.length} with them)`);
  }

  // integer overloads that do not exist in ES 1.00
  const intFns = [...src.matchAll(/\b(min|max|abs|clamp|mod|sign)\s*\(\s*([a-zA-Z_]\w*)\s*[+\-]?[^,)]*,\s*(\d+)\s*\)/g)]
    .filter((m) => /^i[A-Z0-9_]|^\w*[iI]dx|^i\d/.test(m[2]));
  if (intFns.length) {
    console.log(`\x1b[33mWARN\x1b[0m  possible integer overload, absent in ES 1.00: ${intFns.map((m) => m[0]).join(', ')}`);
  }
}

console.log(failed ? `\n${failed} shader problem(s)` : '\nshaders parse cleanly');
process.exit(failed ? 1 : 0);
