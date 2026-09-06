// Does the baked cube map reproduce the terrain the shader used to compute live?
//
// This machine has no WebGL2 context, so the bake cannot be run on a GPU here.
// Instead the same field is evaluated two ways in the CPU port: directly, and
// through a simulated bake -- sampled onto cube-map faces at the real
// resolution, quantised to 8 and 16 bits exactly as the texture format does,
// then bilinearly sampled back. If those agree, the optimisation is a pure win
// rather than a visible change.
import { fieldsAt, HEIGHT_QUANTUM } from './rendercheck.mjs';

const SIZE = Number(process.argv[2] || 512);
const SEED = 12.3;

// --- simulated bake: one cube face, quantised the way the texture is ---------
const faceDir = (face, u, v) => {
  const s = u * 2 - 1, t = v * 2 - 1;
  const d = [[1,-t,-s],[-1,-t,s],[s,1,t],[s,-1,-t],[s,-t,1],[-s,-t,-1]][face];
  const L = Math.hypot(...d);
  return [d[0]/L, d[1]/L, d[2]/L];
};
const faces = [];
for (let f = 0; f < 6; f++) {
  const buf = new Float64Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = faceDir(f, (x + 0.5) / SIZE, (y + 0.5) / SIZE);
      // quantise to 16 bits, as the R,G packing does
      buf[y * SIZE + x] = Math.round(fieldsAt(d, SEED).h * 65535) / 65535;
    }
  }
  faces.push(buf);
}

// --- sample the cube back, bilinearly, as the GPU would ----------------------
function sampleCube(dir) {
  const [x, y, z] = dir;
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f, sc, tc, ma;
  if (ax >= ay && ax >= az) { ma = ax; if (x > 0) { f=0; sc=-z; tc=-y; } else { f=1; sc=z; tc=-y; } }
  else if (ay >= az)        { ma = ay; if (y > 0) { f=2; sc=x; tc=z; }  else { f=3; sc=x; tc=-z; } }
  else                      { ma = az; if (z > 0) { f=4; sc=x; tc=-y; } else { f=5; sc=-x; tc=-y; } }
  const u = (sc / ma + 1) / 2 * SIZE - 0.5;
  const v = (tc / ma + 1) / 2 * SIZE - 0.5;
  const x0 = Math.max(0, Math.min(SIZE-1, Math.floor(u))), x1 = Math.min(SIZE-1, x0+1);
  const y0 = Math.max(0, Math.min(SIZE-1, Math.floor(v))), y1 = Math.min(SIZE-1, y0+1);
  const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, v - y0));
  const b = faces[f];
  return (b[y0*SIZE+x0]*(1-fx) + b[y0*SIZE+x1]*fx)*(1-fy)
       + (b[y1*SIZE+x0]*(1-fx) + b[y1*SIZE+x1]*fx)*fy;
}

// --- compare over a large sample of directions -------------------------------
let worst = 0, sum = 0, n = 0, coastMismatch = 0, coastTotal = 0;
let seed = 987654321;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 60000; i++) {
  const zz = rnd()*2-1, th = rnd()*Math.PI*2, r = Math.sqrt(1-zz*zz);
  const d = [r*Math.cos(th), zz, r*Math.sin(th)];
  const direct = fieldsAt(d, SEED).h;
  const baked = sampleCube(d);
  const err = Math.abs(direct - baked);
  worst = Math.max(worst, err); sum += err; n++;
  // the shoreline is the sensitive place: does land/sea ever disagree?
  const thr = 0.625 - 0.25*0.30;
  if (Math.abs(direct - thr) < 0.05) {
    coastTotal++;
    if ((direct > thr) !== (baked > thr)) coastMismatch++;
  }
}
const mean = sum/n;
console.log(`cube face ${SIZE}x${SIZE}, ${n} sample directions`);
console.log(`  height error   mean ${mean.toExponential(2)}   worst ${worst.toExponential(2)}`);
console.log(`  16-bit quantum ${HEIGHT_QUANTUM.toExponential(2)}`);
console.log(`  coastline: ${coastMismatch}/${coastTotal} land-sea disagreements near the shore`);
const ok = worst < 0.02 && coastMismatch / Math.max(coastTotal,1) < 0.02;
console.log(ok ? '\nPASS  the bake reproduces the terrain' : '\nFAIL  the bake changes the terrain');
process.exit(ok ? 0 : 1);
