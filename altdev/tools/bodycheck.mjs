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

// Mars's DEM has to be Mars, in the right place, the right way up.
//
// A height map that is rolled, flipped or simply someone else's planet passes
// every other check in this repo: it loads, it has relief, the coastline lands
// at the requested fraction because the histogram match guarantees that much.
// What it cannot fake is WHERE the low ground is. Mars's crustal dichotomy puts
// almost all of it in the northern hemisphere, so giving Noachian Mars an ocean
// has to flood Vastitas Borealis -- the Oceanus Borealis the shoreline
// hypothesis argues for -- and leave the southern highlands dry. That falls out
// of the real hypsometry and out of nothing else.
{
  const { readFileSync } = await import('node:fs');
  const png = readFileSync(new URL('../../assets/bodies/mars_height.png', import.meta.url));
  // Minimal grayscale-PNG read: IHDR for the size, then inflate and un-filter.
  const { inflateSync } = await import('node:zlib');
  const W2 = png.readUInt32BE(16), H2 = png.readUInt32BE(20);
  const bitDepth = png[24], colourType = png[25];
  let idat = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o), type = png.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += len + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const chans = colourType === 0 ? 1 : colourType === 2 ? 3 : colourType === 4 ? 2 : 4;
  const stride = W2 * chans * (bitDepth / 8);
  const img = new Uint8Array(W2 * H2);
  const prior = new Uint8Array(stride), line = new Uint8Array(stride);
  for (let y = 0, p2 = 0; y < H2; y++) {
    const ft = raw[p2++];
    for (let i = 0; i < stride; i++) {
      const x = raw[p2 + i];
      const a = i >= chans ? line[i - chans] : 0, b = prior[i];
      const c = i >= chans ? prior[i - chans] : 0;
      let v;
      if (ft === 0) v = x; else if (ft === 1) v = x + a; else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
             v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      line[i] = v & 255;
    }
    p2 += stride;
    for (let x = 0; x < W2; x++) img[y * W2 + x] = line[x * chans];
    prior.set(line);
  }
  // Flood the lowest 30% by area, which is Noachian Mars's own land fraction.
  const area = new Float64Array(H2);
  for (let y = 0; y < H2; y++) area[y] = Math.sin((y + 0.5) / H2 * Math.PI);
  const idx = Array.from(img.keys()).sort((a, b) => img[a] - img[b]);
  let total = 0;
  for (const i of idx) total += area[(i / W2) | 0];
  let acc = 0, thr = 255;
  for (const i of idx) { acc += area[(i / W2) | 0]; if (acc >= 0.30 * total) { thr = img[i]; break; } }
  let north = 0, south = 0;
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    if (img[y * W2 + x] <= thr) (y < H2 / 2 ? (north += area[y]) : (south += area[y]));
  }
  const share = north / (north + south);
  check('Mars\u2019s ocean lands in the northern lowlands, as the real planet\u2019s shape demands',
    share > 0.80 && W2 === 2048 && H2 === 1024,
    `${(share * 100).toFixed(0)}% of a 30% ocean is north of the equator ` +
    `(${W2}x${H2}) — the crustal dichotomy, not a coincidence`);
}

console.log(failed ? `\n${failed} problem(s) with the body maps` : '\nreal surface maps reach both surface styles');
process.exit(failed ? 1 : 0);
