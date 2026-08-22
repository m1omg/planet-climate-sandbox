// Does a real world's surface map actually reach the screen?
//
// It nearly did not. The map was wired into surfaceColor(), the procedural
// path, and not into surfaceTextured() -- which is the *default* surface style,
// so Earth and Venus appeared only if you switched away from it. Both paths now
// go through the same two helpers, and this renders real frames through a real
// driver to check that neither has quietly lost the map again.
//
// It also checks the coastline does not jump between the two styles, since they
// derive the height separately and a body map that only moved one of them would
// slide the shoreline as you toggled.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let createGL = null;
try { createGL = (await import('gl')).default; } catch { }
if (!createGL) { console.log('headless GL not installed (npm i --no-save gl); skipping'); process.exit(0); }

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
globalThis.fetch = async (url) => {
  const p = url instanceof URL ? url : new URL(url);
  return { ok: true, status: 200,
    text: async () => readFileSync(join(root, 'src/render/glsl', p.pathname.split('/').pop()), 'utf8') };
};
globalThis.window = { devicePixelRatio: 1 };
globalThis.location = { href: 'file://' + root + '/' };

const W = 160, H = 120;
const glctx = createGL(W, H);
if (!glctx) { console.log('no GL context; skipping'); process.exit(0); }
// The real thing needs twelve texture units for the body maps; say so.
const realGet = glctx.getParameter.bind(glctx);
glctx.getParameter = (p) => (p === glctx.MAX_TEXTURE_IMAGE_UNITS ? 16 : realGet(p));

const canvas = { clientWidth: W, clientHeight: H, width: W, height: H, addEventListener() {},
  getContext: (k) => ((k === 'webgl' || k === 'experimental-webgl') ? glctx : null) };

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? '  —  ' + detail : ''}`);
  if (!ok) failed++;
};

const { PlanetView } = await import(pathToFileURL(join(root, 'src/render/planet.js')).href);
const { createWorld, update } = await import(pathToFileURL(join(root, 'src/physics/climate.js')).href);
const { EARTH } = await import(pathToFileURL(join(root, 'src/game/presets.js')).href);

const view = new PlanetView(canvas, 'webgl1');
check('the body-map path is compiled in', view.bodyCapable === true,
  `${view.maxTexUnits} texture units`);
await view.init();
view.bakeSurface(12.3);

// A body map that could not be mistaken for anything the shader would draw by
// itself: flat magenta, with a height field that puts land everywhere.
const gl = glctx;
const solid = (rgba) => {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
};
view.bodyColourTex = solid([255, 0, 255, 255]);
// Just above sea level, not high ground. The map is deliberately desaturated
// where the climate cannot support its colours, and that test keys off
// elevation -- so a flat *high* body would wash the map out everywhere and hide
// the very thing being measured.
view.bodyHeightTex = solid([166, 166, 166, 255]);
view.bodyHasHeight = 1;
view.body = 'test';

const world = createWorld({ ...EARTH });
update(world, 0);

const frame = (useTex, mix) => {
  view.bodyTarget = mix; view.bodyMix = mix;
  view.texturesLoaded = !!useTex; view.wantTextures = !!useTex; view.useTextures = useTex;
  view.render(world, { time: 0, seed: 12.3 }, 0);
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
};

// How much of the planet the map actually changes. Comparing the frame with the
// map against the frame without it is the honest measure: an absolute colour
// test cannot work, because the shader deliberately mutes the map where the
// climate would not support its colours, and clouds and lighting sit on top.
const shifted = (a, b) => {
  let n = 0, moved = 0;
  for (let i = 0; i < W * H; i++) {
    const lum = (a[i*4] + a[i*4+1] + a[i*4+2]) / 3;
    if (lum < 25) continue;                        // empty sky
    n++;
    const d = Math.max(Math.abs(a[i*4] - b[i*4]),
                       Math.abs(a[i*4+1] - b[i*4+1]),
                       Math.abs(a[i*4+2] - b[i*4+2]));
    if (d > 10) moved++;
  }
  return moved / Math.max(n, 1);
};

const proc = shifted(frame(0, 0), frame(0, 1));
const tex  = shifted(frame(1, 0), frame(1, 1));
check('the real map reaches the procedural surface', proc > 0.10,
  `${(proc * 100).toFixed(0)}% of the planet changes when it is switched on`);
check('the real map reaches the generated-texture surface', tex > 0.10,
  `${(tex * 100).toFixed(0)}% of the planet changes when it is switched on`);
// The regression this file exists for: the map was wired into one path only, so
// the default surface style showed no real world at all.
check('…and reaches both of them about equally',
  proc > 0 && tex > 0 && Math.max(proc, tex) / Math.min(proc, tex) < 2.5,
  `${(proc * 100).toFixed(0)}% procedural against ${(tex * 100).toFixed(0)}% textured`);

// Venus, Mars and Titan have no life anywhere, and the map's colour is their
// rock. Keying the whole photograph off how habitable the place is muted them
// to grey -- which is the second half of what "real Earth and Venus only show
// in procedural view" turned out to be.
{
  const dead = createWorld({ ...EARTH, water: 0, co2Bar: 90, n2Bar: 3.5, startT: 700 });
  update(dead, 0);
  const shotDead = (mix) => {
    view.bodyTarget = mix; view.bodyMix = mix;
    view.texturesLoaded = false; view.wantTextures = false; view.useTextures = 0;
    view.render(dead, { time: 0, seed: 12.3 }, 0);
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const moved = shifted(shotDead(0), shotDead(1));
  check('a world with no life still shows its real surface', moved > 0.08,
    `${(moved * 100).toFixed(0)}% of a Venus-like planet changes when the map is switched on`);
}

console.log(failed ? `\n${failed} problem(s) with the body maps` : '\nreal surface maps reach both surface styles');
process.exit(failed ? 1 : 0);
