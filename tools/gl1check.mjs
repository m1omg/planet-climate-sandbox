// Runs the real renderer against a real WebGL1 context.
//
// Compiling the shaders proves the language conversion is right; it proves
// nothing about the surrounding calls — the two-pass bake, cube-map framebuffer
// attachments, the missing vertex-array object, the unsized texture format.
// stack-gl gives an actual WebGL1 driver, so all of that can be exercised here
// rather than discovered by whoever is unlucky enough to need the fallback.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let createGL = null;
try { createGL = (await import('gl')).default; } catch { }
if (!createGL) { console.log('headless GL not installed (npm i --no-save gl); skipping'); process.exit(0); }

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// shaders.js fetches its GLSL; serve those from disk.
globalThis.fetch = async (url) => {
  const p = url instanceof URL ? url : new URL(url);
  const body = readFileSync(join(root, 'src/render/glsl', p.pathname.split('/').pop()), 'utf8');
  return { ok: true, status: 200, text: async () => body };
};
globalThis.window = { devicePixelRatio: 1 };
globalThis.location = { href: 'file://' + root + '/' };

const W = Number(process.env.GL1_W || 128), H = Number(process.env.GL1_H || 96);
const glctx = createGL(W, H);
if (!glctx) { console.log('no GL context; skipping'); process.exit(0); }

const canvas = {
  clientWidth: W, clientHeight: H, width: W, height: H,
  addEventListener() {},
  getContext: (kind) => ((kind === 'webgl' || kind === 'experimental-webgl') ? glctx : null),
};

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? '  —  ' + detail : ''}`);
  if (!ok) failed++;
};
const errName = (e) => ({ 1280: 'INVALID_ENUM', 1281: 'INVALID_VALUE', 1282: 'INVALID_OPERATION',
  1285: 'OUT_OF_MEMORY', 1286: 'INVALID_FRAMEBUFFER_OPERATION' }[e] || String(e));
const drainErrors = () => { const seen = []; let e; while ((e = glctx.getError()) !== 0) seen.push(errName(e)); return seen; };

const { PlanetView } = await import(pathToFileURL(join(root, 'src/render/planet.js')).href);
const { createWorld, update } = await import(pathToFileURL(join(root, 'src/physics/climate.js')).href);
const { EARTH } = await import(pathToFileURL(join(root, 'src/game/presets.js')).href);

const view = new PlanetView(canvas, 'webgl1');
check('a WebGL1 context is taken', !view.failed && view.gl1 === true, view.api || 'none');

const ok = await view.init();
check('programs build and link', ok && !view.failed, drainErrors().join(', ') || 'no GL errors');

if (ok) {
  view.bakeSurface(12.3);
  const bakeErrs = drainErrors();
  check('the two-pass bake runs clean', bakeErrs.length === 0, bakeErrs.join(', ') || 'no GL errors');
  check('all three cube maps exist', !!(view.terrainCube && view.detailCube && view.cloudCube));

  const world = createWorld({ ...EARTH });
  update(world, 0);
  view.render(world, { time: 0, seed: 12.3 }, 1 / 60);
  const drawErrs = drainErrors();
  check('a frame draws clean', drawErrs.length === 0, drawErrs.join(', ') || 'no GL errors');

  // and it must actually put something on the screen
  const px = new Uint8Array(W * H * 4);
  glctx.readPixels(0, 0, W, H, glctx.RGBA, glctx.UNSIGNED_BYTE, px);
  let lit = 0, distinct = new Set();
  for (let i = 0; i < W * H; i++) {
    const L = (px[i*4] + px[i*4+1] + px[i*4+2]) / 3;
    if (L > 60) lit++;
    distinct.add((px[i*4] >> 4) << 8 | (px[i*4+1] >> 4) << 4 | (px[i*4+2] >> 4));
  }
  const frac = lit / (W * H);
  check('a planet appears in the framebuffer', frac > 0.10 && frac < 0.60,
    `${(frac * 100).toFixed(0)}% of pixels lit`);
  check('the surface is varied, not a flat fill', distinct.size > 25, `${distinct.size} distinct colours`);

  // Save what the GPU actually drew. Without a browser on this machine, this is
  // the only way to look at real GPU output rather than a CPU approximation.
  if (process.argv.includes('--png')) {
    const { writeFileSync } = await import('node:fs');
    const rgb = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const src = ((H - 1 - y) * W + x) * 4, dst = (y * W + x) * 3;   // readPixels is bottom-up
        rgb[dst] = px[src]; rgb[dst+1] = px[src+1]; rgb[dst+2] = px[src+2];
      }
    }
    writeFileSync('/tmp/gl1.ppm', Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), rgb]));
    console.log('wrote /tmp/gl1.ppm');
  }
}

console.log(failed ? `\n${failed} problem(s) in the WebGL1 path` : '\nthe WebGL1 path runs end to end');
process.exit(failed ? 1 : 0);
