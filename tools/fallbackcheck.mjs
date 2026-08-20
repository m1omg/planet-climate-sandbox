// Does the software fallback actually produce a planet?
//
// The GPU path cannot be exercised here, but the fallback is plain JavaScript,
// so it can be: bake the terrain, render a frame, and check the result looks
// like a lit sphere against space rather than a blank or uniform field.
import { bakeTerrain, renderPlanet } from '../src/render/cpushade.js';
import { writeFileSync } from 'node:fs';

const W = 240, H = 180;
const terrain = bakeTerrain(12.3, 160, 80);
const bandT = new Float32Array(18), bandIce = new Float32Array(18);
for (let i = 0; i < 18; i++) {
  const x = -1 + (2 * i + 1) / 18;
  bandT[i] = 288 - 45 * x * x;                      // warm equator, cold poles
  bandIce[i] = Math.max(0, Math.min(1, 1 - (bandT[i] - 253) / 25));
}
const buf = new Uint8ClampedArray(W * H * 4);
const t0 = Date.now();
renderPlanet(buf, W, H, {
  yaw: 0, pitch: 0, spin: 0, sun: [0.62, 0.28, 0.73], starColor: [1, 0.74, 0.66],
  terrain, bandT, bandIce, oceanFrac: 0.70, waterCap: 1, glaciated: 1, locked: 0,
  cloud: 0.5, steam: 0, pTot: 1.0, co2: 0.0003, nightGlow: 0, time: 0,
});
const ms = Date.now() - t0;

let planetPx = 0, spacePx = 0, distinct = new Set(), maxL = 0;
for (let i = 0; i < W * H; i++) {
  const r = buf[i*4], g = buf[i*4+1], b = buf[i*4+2];
  const L = (r + g + b) / 3;
  maxL = Math.max(maxL, L);
  // space is not pure black: it tonemaps to about L=30, the same as on the GPU
  if (L > 60) planetPx++; else spacePx++;
  distinct.add((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4));
}
const frac = planetPx / (W * H);

let fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}  —  ${detail}`);
  if (!ok) fail++;
};
check('a frame renders', maxL > 0, `${ms} ms for ${W}x${H}`);
check('a disc occupies a sensible part of the frame', frac > 0.12 && frac < 0.55,
  `${(frac * 100).toFixed(0)}% of pixels are planet`);
check('the surface is varied, not a flat fill', distinct.size > 60, `${distinct.size} distinct colours`);
check('fast enough to be usable', ms < 200, `${ms} ms`);

// The two renderers are swapped for one another at runtime, so the fallback has
// to answer to everything the GPU path does.
{
  const { SoftwareView } = await import('../src/render/software.js');
  const { PlanetView } = await import('../src/render/planet.js');
  const needed = ['init', 'loadTextures', 'render', 'setQuality', 'refreshAfterResume', 'forgetGpuState'];
  const missing = needed.filter((m) => typeof SoftwareView.prototype[m] !== 'function');
  check('the software renderer answers to the same interface', missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : needed.join(', '));
  const fields = ['yaw', 'pitch', 'spin', 'spinVel', 'spinPaused', 'quality', 'wantTextures', 'texturesLoaded', 'failed', 'ready'];
  const inst = Object.create(SoftwareView.prototype);
  SoftwareView.call; // constructor needs a DOM canvas, so check the class body instead
  const src = (await import('node:fs')).readFileSync(new URL('../src/render/software.js', import.meta.url), 'utf8');
  const absent = fields.filter((f) => !new RegExp(`this\\.${f}\\s*=`).test(src));
  check('…and carries the same state the app reads', absent.length === 0,
    absent.length ? `never sets ${absent.join(', ')}` : `${fields.length} fields`);
}

// leave something to look at
const ppm = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { ppm[i*3] = buf[i*4]; ppm[i*3+1] = buf[i*4+1]; ppm[i*3+2] = buf[i*4+2]; }
writeFileSync('/tmp/software.ppm', Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), ppm]));
console.log(fail ? '\nthe software fallback is broken' : '\nsoftware fallback works; wrote /tmp/software.ppm');
process.exit(fail ? 1 : 0);
