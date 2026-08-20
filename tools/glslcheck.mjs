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

// --- per-pixel noise budget --------------------------------------------------
// The runtime shader once evaluated 269 gradient-noise fields per pixel, every
// frame, which is why a tablet managed one frame a second. Those fields are
// time-invariant and now come from baked cube maps. Guard the budget.
{
  const src = decomment(read('planet.frag'));
  const OCT = { warpedFbm: (o) => 3 * 4 + o, fbm: (o) => o, ridged: (o) => o, gnoise: () => 1 };
  let total = 0;
  const detail = [];
  for (const m of src.matchAll(/\b(warpedFbm|fbm|ridged)\s*\([^;]*?,\s*(\d+)\s*\)/g)) {
    total += OCT[m[1]](Number(m[2]));
    detail.push(`${m[1]}(${m[2]})`);
  }
  for (const m of src.matchAll(/\bgnoise\s*\(/g)) { total += 1; detail.push('gnoise'); }
  const BUDGET = 12;
  if (total > BUDGET) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  planet.frag evaluates ${total} noise fields per pixel (budget ${BUDGET}): ${detail.join(', ')}`);
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  per-pixel noise budget: ${total}/${BUDGET}  (${detail.join(', ') || 'none'})`);
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
