// Compiles the planet shaders on a real (headless) GL driver. The GLSL grammar
// check in glslcheck.mjs catches syntax; this catches everything a parser
// cannot -- undeclared identifiers, type mismatches, wrong argument counts,
// exceeding uniform limits -- which is what actually blanks the planet.
//
// stack-gl exposes an ES-capable driver via ANGLE, which accepts GLSL ES 3.00
// source unchanged once the context advertises the ESSL3 extension.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Optional dependency: `npm i --no-save gl`. Absent, the check reports skipped.
let createGL = null;
try { createGL = (await import('gl')).default; } catch { }

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
if (!createGL) {
  console.log("headless GL not installed (npm i --no-save gl); skipping");
  process.exit(0);
}
const gl = createGL(64, 64);
if (!gl) { console.log('no GL context available; skipping'); process.exit(0); }

// Ask the driver for ES 3.00 support; without it the source cannot be compiled
// here and the check reports that honestly rather than pretending to pass.
const essl3 = gl.getExtension('WEBGL_compat_shader_essl3') ||
              gl.getExtension('ANGLE_shader_essl3') || null;
const asIs = (src) => src;

let failed = 0;
const compile = (type, src, label) => {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    failed++;
    const log = (gl.getShaderInfoLog(sh) || '').trim().split('\n').slice(0, 8).join('\n        ');
    console.log(`\x1b[31mFAIL\x1b[0m  ${label}\n        ${log}`);
    return null;
  }
  console.log(`\x1b[32mPASS\x1b[0m  ${label} compiles`);
  return sh;
};

const vsrc = readFileSync(join(root, 'src/render/glsl/planet.vert'), 'utf8');
const fsrc = readFileSync(join(root, 'src/render/glsl/planet.frag'), 'utf8');
if (!essl3) {
  console.log('this GL driver cannot compile GLSL ES 3.00; skipping (glslcheck.mjs still applies)');
  process.exit(0);
}
const vs = compile(gl.VERTEX_SHADER, asIs(vsrc), 'planet.vert');
const fs = compile(gl.FRAGMENT_SHADER, asIs(fsrc), 'planet.frag');

if (vs && fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    failed++;
    console.log(`\x1b[31mFAIL\x1b[0m  link\n        ${(gl.getProgramInfoLog(p) || '').trim()}`);
  } else {
    console.log('\x1b[32mPASS\x1b[0m  program links');
    // every uniform the renderer sets must actually exist after linking
    const want = ['uRes','uTime','uSpin','uSunDir','uStarColor','uSeed','uLandFrac','uOceanFrac',
      'uWaterCap','uCloud','uSteam','uPTot','uCO2','uMagma','uLocked','uNightGlow','uYaw','uPitch',
      'uUseTex','uTexRock','uTexDesert','uTexVeg','uTexIce','uTexOcean','uTexLava'];
    const missing = want.filter((n) => gl.getUniformLocation(p, n) === null);
    // Unused uniforms are optimised away by the driver; only flag ones the
    // shader genuinely never mentions.
    const src = fsrc;
    const real = missing.filter((n) => !new RegExp(`\\b${n}\\b`).test(src));
    if (real.length) { failed++; console.log(`\x1b[31mFAIL\x1b[0m  uniforms absent from source: ${real.join(', ')}`); }
    else console.log(`\x1b[32mPASS\x1b[0m  all ${want.length} uniforms accounted for${missing.length ? ` (${missing.length} optimised out)` : ''}`);
  }
}
console.log(failed ? `\n${failed} shader problem(s)` : '\nshaders compile and link');
process.exit(failed ? 1 : 0);
