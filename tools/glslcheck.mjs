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

console.log(failed ? `\n${failed} shader problem(s)` : '\nshaders parse cleanly');
process.exit(failed ? 1 : 0);
