// Compiles the shaders on a real (headless) GL driver.
//
// The grammar check in glslcheck.mjs catches syntax; this catches what a parser
// cannot -- undeclared identifiers, type mismatches, wrong argument counts,
// exceeding uniform or varying limits. stack-gl provides a WebGL1 context,
// which is exactly the fallback path, so the ES 1.00 downconversion gets a
// genuine compile rather than an inspection.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let createGL = null;
try { createGL = (await import('gl')).default; } catch { }
if (!createGL) {
  console.log('headless GL not installed (npm i --no-save gl); skipping');
  process.exit(0);
}

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const { toES100, bakeES100 } = await import(pathToFileURL(join(root, 'src/render/shaders.js')).href);
const read = (f) => readFileSync(join(root, 'src/render/glsl', f), 'utf8');
const noise = read('noise.glsl');
const splice = (s) => s.replace('//__NOISE__', noise);

const gl = createGL(64, 64);
if (!gl) { console.log('no GL context; skipping'); process.exit(0); }

let failed = 0;
const compile = (type, src, label) => {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    failed++;
    const log = (gl.getShaderInfoLog(sh) || '').trim().split('\n').slice(0, 6).join('\n        ');
    console.log(`\x1b[31mFAIL\x1b[0m  ${label}\n        ${log}`);
    return null;
  }
  console.log(`\x1b[32mPASS\x1b[0m  ${label}`);
  return sh;
};

const link = (vs, fs, label) => {
  if (!vs || !fs) return;
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  ${label} link\n        ${(gl.getProgramInfoLog(p) || '').trim()}`);
  } else {
    console.log(`\x1b[32mPASS\x1b[0m  ${label} links`);
  }
};

console.log('GLSL ES 1.00 (the WebGL1 fallback), on a real driver:');
const vs = compile(gl.VERTEX_SHADER, toES100(read('planet.vert'), 'vert'), 'planet.vert');
const fs = compile(gl.FRAGMENT_SHADER, toES100(splice(read('planet.frag')), 'frag'), 'planet.frag');
link(vs, fs, 'planet');

// The reduced build, used where there are too few texture units for the albedo
// maps. An untested variant is how the WebGL1 path came to be broken in the
// first place, so it gets compiled too.
const fsNo = compile(gl.FRAGMENT_SHADER,
  '#define NO_ALBEDO 1\n' + toES100(splice(read('planet.frag')), 'frag'), 'planet.frag (NO_ALBEDO)');
link(vs, fsNo, 'planet (NO_ALBEDO)');
const bvs = compile(gl.VERTEX_SHADER, toES100(read('bake.vert'), 'vert'), 'bake.vert');
const bfs = compile(gl.FRAGMENT_SHADER, bakeES100(splice(read('bake.frag'))), 'bake.frag');
link(bvs, bfs, 'bake');
const cfs = compile(gl.FRAGMENT_SHADER, toES100(splice(read('cloudbake.frag')), 'frag'), 'cloudbake.frag');
link(bvs, cfs, 'cloudbake');

console.log(failed ? `\n${failed} shader problem(s)` : '\nthe WebGL1 path compiles and links');
process.exit(failed ? 1 : 0);
