// Parses every planet shader with a real GLSL ES 3.0 grammar, assembling them
// exactly as the runtime does (noise spliced in from the shared file), and
// enforces a per-pixel noise budget so the cost that once made this unusable on
// mobile cannot silently creep back.
import { parse } from '/home/mroz/.nvm/versions/node/v20.20.2/lib/node_modules/@shaderfrog/glsl-parser/parser/parser.js';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (f) => readFileSync(join(root, 'src/render/glsl', f), 'utf8');
const noise = read('noise.glsl');
const splice = (src) => src.replace('//__NOISE__', noise);

function readGrayPng(path) {
  const png = readFileSync(path);
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const bitDepth = png[24], colourType = png[25], idat = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o), type = png.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const chans = colourType === 0 ? 1 : colourType === 2 ? 3 : colourType === 4 ? 2 : 4;
  const stride = width * chans * (bitDepth / 8), pixels = new Uint8Array(width * height);
  const prior = new Uint8Array(stride), line = new Uint8Array(stride);
  for (let y = 0, p = 0; y < height; y++) {
    const ft = raw[p++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p + i], a = i >= chans ? line[i - chans] : 0, b = prior[i];
      const c = i >= chans ? prior[i - chans] : 0;
      let v;
      if (ft === 0) v = x; else if (ft === 1) v = x + a; else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp-a), pb = Math.abs(pp-b), pc = Math.abs(pp-c);
             v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      line[i] = v & 255;
    }
    p += stride;
    for (let x = 0; x < width; x++) pixels[y * width + x] = line[x * chans];
    prior.set(line);
  }
  return { width, height, pixels };
}

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

// Comments are stripped before source-shape checks: prose is full of words
// followed by a bracket and must not masquerade as executable GLSL.
const decomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

// --- real-world maps must preserve geography and climate --------------------
// A normal equirectangular map stores longitude in x. With the camera looking
// down +Z, atan(x,z) makes east move to screen-right; swapping the arguments
// mirrors every continent. The source photographs themselves are correctly
// oriented, so this belongs at the lookup rather than in every asset.
{
  const src = decomment(read('planet.frag'));
  const eastRight = /atan\s*\(\s*d\.x\s*,\s*d\.z\s*\)/.test(src);
  if (!eastRight) {
    failed++;
    console.log('\x1b[31mFAIL\x1b[0m  body-map longitude is mirrored (east must move to screen-right)');
  } else {
    console.log('\x1b[32mPASS\x1b[0m  body-map longitude keeps east on screen-right');
  }

  // A photograph's blue ocean is only the ocean at the map's reference sea
  // level. When the simulated sea retreats, its DEM must expose modelled seabed
  // instead of treating those blue pixels as land colour.
  const masksSourceSea = /uBodySeaLevel/.test(src)
    && /sourceLand/.test(src)
    && /bodyGround\s*\([^)]*sourceLand/.test(src);
  if (!masksSourceSea) {
    failed++;
    console.log('\x1b[31mFAIL\x1b[0m  a dry mapped Earth still paints the photograph\'s blue oceans on exposed ground');
  } else {
    console.log('\x1b[32mPASS\x1b[0m  mapped source oceans reveal modelled seabed when the sea retreats');
  }

  const narrowMappedCoasts = /BODY_COAST_LOW\s*=\s*-0\.002/.test(src)
    && /BODY_COAST_HIGH\s*=\s*0\.003/.test(src)
    && /smoothstep\s*\(\s*BODY_COAST_LOW\s*,\s*BODY_COAST_HIGH/.test(src);
  if (!narrowMappedCoasts) {
    failed++;
    console.log('\x1b[31mFAIL\x1b[0m  mapped DEM coastlines still flood low continental plains');
  } else {
    console.log('\x1b[32mPASS\x1b[0m  mapped DEM coastlines use their measured narrow shoreline ramp');
  }

  const dynamicMappedCoasts = (src.match(
    /land\s*=\s*mix\s*\(\s*land\s*,\s*bodyCoast\s*\(\s*h\s*\)/g) || []).length === 2;
  if (!dynamicMappedCoasts) {
    failed++;
    console.log('\x1b[31mFAIL\x1b[0m  mapped coastlines are frozen to the photographed sea level');
  } else {
    console.log('\x1b[32mPASS\x1b[0m  mapped coastlines still move when the model floods or drains them');
  }

  const exactGlobalOcean = /float\s+floodLand\s*\(/.test(src)
    && (src.match(/land\s*=\s*floodLand\s*\(\s*land\s*\)/g) || []).length === 2;
  if (!exactGlobalOcean) {
    failed++;
    console.log('\x1b[31mFAIL\x1b[0m  a 100% ocean can leave quantile-clamped mountaintops exposed');
  } else {
    console.log('\x1b[32mPASS\x1b[0m  a 100% ocean draws no residual mapped or procedural land');
  }

  const { BODY_COAST_LOW, BODY_COAST_HIGH, seaLevelForLand } =
    await import('../src/render/terrain.js');
  const { width, height, pixels } = readGrayPng(join(root, '../assets/bodies/earth_height.png'));
  const level = seaLevelForLand(0.30);
  const ramp = (a, b, x) => { const q = Math.max(0, Math.min(1, (x-a)/(b-a))); return q*q*(3-2*q); };
  let area = 0, narrow = 0, broad = 0;
  for (let y = 0; y < height; y++) {
    const weight = Math.sin((y + 0.5) / height * Math.PI);
    for (let x = 0; x < width; x++) {
      const h = 0.30 + 0.40 * pixels[y * width + x] / 255 - level;
      area += weight;
      narrow += weight * ramp(BODY_COAST_LOW, BODY_COAST_HIGH, h);
      broad += weight * ramp(-0.010, 0.026, h);
    }
  }
  narrow /= area; broad /= area;
  if (Math.abs(narrow - 0.30) >= 0.01 || broad >= narrow - 0.025) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  Earth DEM shoreline area ${100*narrow}% narrow, ${100*broad}% broad`);
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  Earth DEM keeps ${(100*narrow).toFixed(1)}% effective land (broad ramp flooded it to ${(100*broad).toFixed(1)}%)`);
  }

  // Vegetation is a stellar-spectrum colour, not a permanently green texture.
  // Pin both procedural/generated terrain and green pixels in real photographs:
  // otherwise Earth responds while the default texture path (or vice versa)
  // quietly stays green.
  const stellarVeg = /uniform\s+vec3\s+uVegColor\s*;/.test(src)
    && /stellarVegetation\s*\(/.test(src)
    && /bodyGround[\s\S]*stellarVegetation\s*\(/.test(src);
  if (!stellarVeg) {
    failed++;
    console.log('\x1b[31mFAIL\x1b[0m  vegetation is not recoloured from the host star in every surface path');
  } else {
    console.log('\x1b[32mPASS\x1b[0m  procedural, textured and photographed vegetation share the stellar palette');
  }
}

// --- every function the runtime shader calls must actually be defined --------
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

// ---------------------------------------------------------------------------
// The two renderers have to agree about what a hot surface looks like.
//
// The GLSL cannot import the JS, so the thermal-glow curve is written twice --
// once in terrain.js for the software renderer and the self-test, once in
// planet.frag for WebGL. Nothing but this check keeps them the same number, and
// a machine on the software fallback must not see a different planet from one
// with WebGL.
//
// It also pins the thing that was actually wrong: the glow used to be a
// magnitude computed from the planet's MEAN temperature and applied flat across
// the night side. A mean is not a temperature any ground has -- GJ 1132 b has a
// 1270 K day side, a 692 K night side and a 920 K mean -- so it lit up ground
// that emits nothing, with a wash that carried no surface detail.
{
  const { GLOW_A, GLOW_B } = await import('../src/render/terrain.js');
  const frag = readFileSync(new URL('../src/render/glsl/planet.frag', import.meta.url), 'utf8');
  const want = `exp(${GLOW_A} - ${GLOW_B}.0/max(T, 1.0))`;
  if (!frag.includes(want)) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  planet.frag does not carry terrain.js's glow curve: expected ${want}`);
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  both renderers use the same thermal-glow curve, exp(${GLOW_A} - ${GLOW_B}/T)`);
  }
  // uNightGlow is a gate now; the brightness must come from the local band T.
  const local = /uNightGlow \* min\(exp\(/.test(frag);
  if (!local) {
    failed++;
    console.log('\x1b[31mFAIL\x1b[0m  the night glow is not driven by the local band temperature');
  } else {
    console.log('\x1b[32mPASS\x1b[0m  night glow reads the local band temperature, not the planet mean');
  }
}

console.log(failed ? `\n${failed} shader problem(s)` : '\nshaders parse cleanly');
process.exit(failed ? 1 : 0);
