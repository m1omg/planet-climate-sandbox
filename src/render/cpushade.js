import { seaLevelForLand, thermalGlow, SOLAR_VEGETATION, stellarVegetation } from './terrain.js';
// A CPU implementation of the planet shading, for machines where WebGL2 is
// unavailable. This is not a toy stand-in: it is the same terrain, the same
// biome rules, the same ice and the same lighting as the GPU path, evaluated in
// JavaScript at a lower resolution.
//
// The trick that makes it affordable is the one that made the GPU path fast:
// every noise field is time-invariant, so it is baked once into an
// equirectangular table and sampled thereafter. A frame then costs a few
// arithmetic operations per pixel.
//
// Kept free of the DOM so the verification tools can import it too — there is
// one implementation of this shading, not two that can drift apart.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const fract = (x) => x - Math.floor(x);
export function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

// ---------------------------------------------------------------- noise
function hash3(x, y, z) {
  const a = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  const b = Math.sin(x * 269.5 + y * 183.3 + z * 246.1) * 43758.5453123;
  const c = Math.sin(x * 113.5 + y * 271.9 + z * 124.6) * 43758.5453123;
  return [-1 + 2 * fract(a), -1 + 2 * fract(b), -1 + 2 * fract(c)];
}
function gnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx*fx*fx*(fx*(fx*6-15)+10), uy = fy*fy*fy*(fy*(fy*6-15)+10), uz = fz*fz*fz*(fz*(fz*6-15)+10);
  const g = (dx, dy, dz) => {
    const h = hash3(ix + dx, iy + dy, iz + dz);
    return h[0]*(fx-dx) + h[1]*(fy-dy) + h[2]*(fz-dz);
  };
  const m = (a, b, t) => a + (b - a) * t;
  return m(m(m(g(0,0,0), g(1,0,0), ux), m(g(0,1,0), g(1,1,0), ux), uy),
           m(m(g(0,0,1), g(1,0,1), ux), m(g(0,1,1), g(1,1,1), ux), uy), uz) * 0.5 + 0.5;
}
// same rotation the GLSL fbm uses between octaves
const rot = (p) => [
  0.00*p[0] + 0.80*p[1] + 0.60*p[2],
  -0.80*p[0] + 0.36*p[1] - 0.48*p[2],
  -0.60*p[0] - 0.48*p[1] + 0.64*p[2],
];
function fbm(p, oct) {
  let a = 0.5, s = 0, n = 0, q = p;
  for (let i = 0; i < oct; i++) { s += a*gnoise(q[0],q[1],q[2]); n += a; q = rot(q).map((v) => v*2.02); a *= 0.5; }
  return s / n;
}
function ridged(p, oct) {
  let a = 0.5, s = 0, n = 0, prev = 1, q = p;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(gnoise(q[0],q[1],q[2]) * 2 - 1); r *= r;
    s += a*r*prev; prev = r; n += a; q = rot(q).map((v) => v*2.11); a *= 0.5;
  }
  return s / n;
}
function warpedFbm(p, oct) {
  const q = [fbm(p, 4), fbm([p[0]+5.2, p[1]+1.3, p[2]+2.7], 4), fbm([p[0]+1.7, p[1]+9.2, p[2]+3.1], 4)];
  return fbm([p[0] + 2.4*(q[0]-0.5), p[1] + 2.4*(q[1]-0.5), p[2] + 2.4*(q[2]-0.5)], oct);
}

export const HEIGHT_QUANTUM = 1 / 65535;

// The time-invariant surface fields, exactly as the bake shader computes them.
export function fieldsAt(sp, seed) {
  const q = [sp[0]*2.2 + seed*13.7, sp[1]*2.2 + seed*7.1, sp[2]*2.2 + seed*3.3];
  const cont = warpedFbm(q, 6);
  const detail = fbm([q[0]*5, q[1]*5, q[2]*5], 5);
  const fine = fbm([q[0]*17, q[1]*17, q[2]*17], 3);
  return {
    cont, detail, fine,
    mount: ridged([q[0]*3.4, q[1]*3.4, q[2]*3.4], 5),
    floe: fbm([q[0]*9, q[1]*9, q[2]*9], 4),
    h: cont + 0.10*(detail - 0.5) + 0.03*(fine - 0.5),
  };
}

// ------------------------------------------------- baked equirectangular table
// Four fields per texel: height, detail, mountain, floe. Small, because the
// software path renders small.
export function bakeTerrain(seed, W = 160, H = 80) {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const theta = ((y + 0.5) / H) * Math.PI;
    const sy = Math.cos(theta), sr = Math.sin(theta);
    for (let x = 0; x < W; x++) {
      const phi = ((x + 0.5) / W) * Math.PI * 2;
      const f = fieldsAt([sr*Math.cos(phi), sy, sr*Math.sin(phi)], seed);
      const i = (y * W + x) * 4;
      data[i] = f.h; data[i+1] = f.detail; data[i+2] = f.mount; data[i+3] = f.floe;
    }
  }
  // Slope, differenced from the baked height itself rather than by evaluating
  // the noise four more times. The GPU gets this from the bake shader; without
  // it the CPU path had no relief shading at all, which is most of why it looked
  // flat and washed out.
  // Divided by true arc length, not by texel count. An equirectangular row near
  // the pole spans a tiny arc, so a raw texel difference there exaggerates the
  // gradient enormously and the relief shading tears the ice caps apart. The
  // 0.024 restores the scale the shader's finite difference had, so its 5.5
  // coefficient keeps meaning the same thing.
  const slope = new Float32Array(W * H * 2);
  const dTheta = 2 * (Math.PI / H);
  for (let y = 0; y < H; y++) {
    const theta = ((y + 0.5) / H) * Math.PI;
    const dPhi = Math.max(2 * (2 * Math.PI / W) * Math.sin(theta), 1e-3);
    for (let x = 0; x < W; x++) {
      const xr = (x + 1) % W, xl = (x - 1 + W) % W;
      const yu = Math.min(y + 1, H - 1), yd = Math.max(y - 1, 0);
      const i = (y * W + x) * 2;
      slope[i]     = (data[(y * W + xr) * 4] - data[(y * W + xl) * 4]) / dPhi * 0.024;
      slope[i + 1] = (data[(yu * W + x) * 4] - data[(yd * W + x) * 4]) / dTheta * 0.024;
    }
  }
  return { W, H, data, slope };
}

// The cloud field, baked separately because it is the one thing that has to
// move. Two scales, advected in opposite directions at render time so the deck
// shears against itself rather than sliding past as one rigid sheet -- the same
// trick the GPU path uses, and far better than modulating a sine.
export function bakeClouds(seed, W = 128, H = 64) {
  const data = new Float32Array(W * H * 2);
  for (let y = 0; y < H; y++) {
    const theta = ((y + 0.5) / H) * Math.PI;
    const sy = Math.cos(theta), sr = Math.sin(theta);
    for (let x = 0; x < W; x++) {
      const phi = ((x + 0.5) / W) * Math.PI * 2;
      const q = [sr*Math.cos(phi) + seed*3.1, sy + seed*1.7, sr*Math.sin(phi) + seed*2.3];
      const i = (y * W + x) * 2;
      data[i]     = fbm([q[0]*2.4, q[1]*2.4, q[2]*2.4], 4);
      data[i + 1] = fbm([q[0]*6.5, q[1]*6.5, q[2]*6.5], 3);
    }
  }
  return { W, H, data };
}

// Sample one cloud channel, with the lookup rotated about the pole by `drift`.
function sampleCloud(map, uv, ch, drift) {
  const u = (((uv[0] + drift) % 1 + 1) % 1) * map.W - 0.5;
  const v = uv[1] * map.H - 0.5;
  const x0 = Math.floor(u), y0 = clamp(Math.floor(v), 0, map.H - 1);
  const x1 = ((x0 + 1) % map.W + map.W) % map.W, y1 = clamp(y0 + 1, 0, map.H - 1);
  const xa = ((x0 % map.W) + map.W) % map.W;
  const fx = u - Math.floor(u), fy = clamp(v - Math.floor(v), 0, 1);
  const d = map.data, s = map.W * 2;
  const A = d[y0*s + xa*2 + ch], B = d[y0*s + x1*2 + ch];
  const C = d[y1*s + xa*2 + ch], D = d[y1*s + x1*2 + ch];
  return mix(mix(A, B, fx), mix(C, D, fx), fy);
}

// All four maps are sampled at the same point on the sphere, so the spherical
// coordinates are computed ONCE per pixel and handed to each. Recomputing them
// inside every sampler meant eight atan2/acos calls per pixel -- easily the
// most expensive thing in the frame.
export function sphereUV(sp, out) {
  out[0] = Math.atan2(sp[2], sp[0]) / (Math.PI*2) + 0.5;   // longitude, 0..1
  out[1] = Math.acos(clamp(sp[1], -1, 1)) / Math.PI;        // colatitude, 0..1
  return out;
}

// Bilinear sample of the two slope channels, alongside the four field channels.
function sampleSlope(map, uv, out) {
  const u = uv[0] * map.W - 0.5;
  const v = uv[1] * map.H - 0.5;
  const x0 = Math.floor(u), y0 = clamp(Math.floor(v), 0, map.H - 1);
  const x1 = ((x0 + 1) % map.W + map.W) % map.W, y1 = clamp(y0 + 1, 0, map.H - 1);
  const xa = ((x0 % map.W) + map.W) % map.W;
  const fx = u - Math.floor(u), fy = clamp(v - Math.floor(v), 0, 1);
  const d = map.slope;
  const iA = (y0*map.W + xa)*2, iB = (y0*map.W + x1)*2, iC = (y1*map.W + xa)*2, iD = (y1*map.W + x1)*2;
  for (let k = 0; k < 2; k++) {
    out[k] = mix(mix(d[iA+k], d[iB+k], fx), mix(d[iC+k], d[iD+k], fx), fy);
  }
  return out;
}

function sampleTerrain(map, uv, out) {
  const u = uv[0] * map.W - 0.5;
  const v = uv[1] * map.H - 0.5;
  const x0 = Math.floor(u), y0 = clamp(Math.floor(v), 0, map.H - 1);
  const x1 = ((x0 + 1) % map.W + map.W) % map.W, y1 = clamp(y0 + 1, 0, map.H - 1);
  const xa = ((x0 % map.W) + map.W) % map.W;
  const fx = u - Math.floor(u), fy = clamp(v - Math.floor(v), 0, 1);
  const d = map.data;
  const iA = (y0*map.W + xa)*4, iB = (y0*map.W + x1)*4, iC = (y1*map.W + xa)*4, iD = (y1*map.W + x1)*4;
  for (let k = 0; k < 4; k++) {
    out[k] = mix(mix(d[iA+k], d[iB+k], fx), mix(d[iC+k], d[iD+k], fx), fy);
  }
  return out;
}

// ------------------------------------------------------------------ the frame
const TMP = new Float32Array(4);
const TMP2 = new Float32Array(2);
const UV = new Float32Array(2);

// Tone mapping through a lookup table. Three Math.pow calls per pixel came to
// 38 ms of a 61 ms frame -- more than the shading itself -- and a table is
// indistinguishable at eight bits of output.
const TONE_N = 2048, TONE_MAX = 6;
const TONE = new Uint8Array(TONE_N + 1);
for (let i = 0; i <= TONE_N; i++) {
  const v = (i / TONE_N) * TONE_MAX;
  TONE[i] = Math.max(0, Math.min(255, 255 * Math.pow(v / (v + 0.85), 1 / 2.2)));
}
const tone = (v) => TONE[v <= 0 ? 0 : v >= TONE_MAX ? TONE_N : (v * (TONE_N / TONE_MAX)) | 0];

// The planet's radius on screen, as a fraction of min(W, H). The camera sits at
// distance 3 with the sphere at radius 1 and the projection scale fixed in the
// ray setup, so this is a constant: a ray hits when |ux,uy| < 0.27596. Knowing
// it means the shading loop can skip the 86% of the frame that is empty sky.
export const DISC_RADIUS = 0.275962;

// The sky: stars, the background wash, the star itself and the atmospheric halo.
// None of it depends on the planet's rotation or its climate, only on where the
// camera points, so it is drawn at FULL canvas resolution and cached — which is
// also what stops the stars being magnified into blobs by the upscale.
export function renderSky(rgba, W, H, s) {
  const cy = Math.cos(s.pitch), sy2 = Math.sin(s.pitch);
  const cyw = Math.cos(s.yaw), syw = Math.sin(s.yaw);
  const view = (v) => {
    const y = cy*v[1] - sy2*v[2], z = sy2*v[1] + cy*v[2];
    return [cyw*v[0] + syw*z, y, -syw*v[0] + cyw*z];
  };
  const ro = view([0, 0, 3 * (s.zoom ?? 1)]);
  const sun = s.sun, sc = s.starColor;
  const minWH = Math.min(W, H);
  // Thickness is worked out by the caller now, because the stylised and
  // realistic modes need different physics -- see render/atmosphere.js.
  const atmo = (s.atmoThick ?? 0.03) * smoothstep(0, 0.02, s.pTot);
  const tint = [mix(0.35, 1.0, s.co2), mix(0.60, 0.72, s.co2), mix(1.0, 0.34, s.co2)];
  const roDot = ro[0]*ro[0] + ro[1]*ro[1] + ro[2]*ro[2];
  const cSphere = roDot - 1;
  const Ra = 1 + atmo, cAtmo = roDot - Ra*Ra;
  const time = s.time || 0;

  let p = 0;
  for (let py = 0; py < H; py++) {
    const uy = (0.5*H - (py + 0.5)) / minWH;
    for (let px = 0; px < W; px++) {
      const ux = ((px + 0.5) - 0.5*W) / minWH;
      const dx = ux*2.05, dy = uy*2.05, dz = -1.6;
      const rl = 1 / Math.sqrt(dx*dx + dy*dy + dz*dz);
      const ay = cy*(dy*rl) - sy2*(dz*rl), az = sy2*(dy*rl) + cy*(dz*rl);
      const rdx = cyw*(dx*rl) + syw*az, rdy = ay, rdz = -syw*(dx*rl) + cyw*az;
      const b = ro[0]*rdx + ro[1]*rdy + ro[2]*rdz;

      let r = 0.008, g = 0.012, bl = 0.024;
      if (b*b - cSphere <= 0) {
        const dA = b*b - cAtmo;
        if (dA > 0 && atmo > 0.001) {
          const path = 2*Math.sqrt(dA);
          const mx = ro[0] + rdx*b, my = ro[1] + rdy*b, mz = ro[2] + rdz*b;
          const ml = 1 / Math.sqrt(mx*mx + my*my + mz*mz);
          const lam = smoothstep(-0.35, 0.5, (mx*sun[0] + my*sun[1] + mz*sun[2]) * ml);
          const dens = Math.pow(clamp(path / (2*atmo + 0.001), 0, 1), 1.7) * lam * (0.55 + 1.3*s.steam) * 0.9;
          r += tint[0]*dens; g += tint[1]*dens; bl += tint[2]*dens;
        }
        // a sparse starfield from a cheap integer hash of the direction
        const hx = (rdx*260) | 0, hy = (rdy*260) | 0, hz = (rdz*260) | 0;
        let n = (hx*374761393 + hy*668265263 + hz*1274126177) | 0;
        n = (n ^ (n >>> 13)) * 1274126177 | 0;
        const v = ((n ^ (n >>> 16)) >>> 0) / 4294967296;
        if (v > 0.9975) {
          const tw = 0.55 + 0.45*Math.sin(time*1.7 + v*400);
          const b2 = (v - 0.9975) / 0.0025 * tw * 1.15;
          r += 0.85*b2; g += 0.90*b2; bl += b2;
        }
        const sd = rdx*sun[0] + rdy*sun[1] + rdz*sun[2];
        if (sd > 0.4) {
          const glow = Math.pow(sd, 24) * 0.05 + (sd > 0.99 ? Math.pow(sd, 900) * 3 : 0);
          r += sc[0]*glow; g += sc[1]*glow; bl += sc[2]*glow;
        }
      }
      rgba[p++] = tone(r); rgba[p++] = tone(g); rgba[p++] = tone(bl); rgba[p++] = 255;
    }
  }
}

// Renders the planet into an RGBA byte buffer, leaving everything outside the
// disc fully transparent so the cached sky shows through. `s` carries everything
// the GPU path takes as uniforms.
export function renderPlanet(rgba, W, H, s) {
  const cy = Math.cos(s.pitch), sy2 = Math.sin(s.pitch);
  const cyw = Math.cos(s.yaw), syw = Math.sin(s.yaw);
  // view = rotY(yaw) * rotX(pitch), matching the GLSL
  const view = (v) => {
    const y = cy*v[1] - sy2*v[2], z = sy2*v[1] + cy*v[2];
    return [cyw*v[0] + syw*z, y, -syw*v[0] + cyw*z];
  };
  const ro = view([0, 0, 3 * (s.zoom ?? 1)]);
  const sun = s.sun, sc = s.starColor;
  const cs = Math.cos(-s.spin), ss = Math.sin(-s.spin);
  // The spin axis leans by the obliquity, about X, matching tiltFrame() in the
  // shader: the bands, the caps and the surface all tilt together, so the
  // terminator cuts across the latitudes instead of running down the poles.
  const ct = Math.cos(s.tilt || 0), st = Math.sin(s.tilt || 0);
  const minWH = Math.min(W, H);
  // Thickness is worked out by the caller now, because the stylised and
  // realistic modes need different physics -- see render/atmosphere.js.
  const atmo = (s.atmoThick ?? 0.03) * smoothstep(0, 0.02, s.pTot);
  const tint = [mix(0.35, 1.0, s.co2), mix(0.60, 0.72, s.co2), mix(1.0, 0.34, s.co2)];
  const relief = s.relief !== undefined ? s.relief : 1;
  const roDot = ro[0]*ro[0] + ro[1]*ro[1] + ro[2]*ro[2];
  const cSphere = roDot - 1;
  const Ra = 1 + atmo, cAtmo = roDot - Ra*Ra;
  const time = s.time || 0;
  const vegRgb = stellarVegetation([0.42, 0.45, 0.22], s.vegColor || SOLAR_VEGETATION);

  // Only the disc is shaded; the rest of the buffer stays transparent and the
  // cached sky layer shows through. The disc covers about an eighth of the
  // frame, so this is most of the cost gone.
  rgba.fill(0);
  const R = DISC_RADIUS * minWH + 2;
  const x0 = Math.max(0, Math.floor(W/2 - R)), x1 = Math.min(W, Math.ceil(W/2 + R));
  const y0 = Math.max(0, Math.floor(H/2 - R)), y1 = Math.min(H, Math.ceil(H/2 + R));

  // Coverage at the limb, in screen space. Without it the disc has a hard,
  // aliased edge and steps abruptly into the halo drawn on the sky layer.
  const Rpx = DISC_RADIUS * minWH;
  for (let py = y0; py < y1; py++) {
    const uy = (0.5*H - (py + 0.5)) / minWH;
    const ddy = py + 0.5 - H/2;
    let p = (py * W + x0) * 4;
    for (let px = x0; px < x1; px++) {
      const ux = ((px + 0.5) - 0.5*W) / minWH;
      // ray direction, built and rotated inline: this is the innermost loop
      const dx = ux*2.05, dy = uy*2.05, dz = -1.6;
      const rl = 1 / Math.sqrt(dx*dx + dy*dy + dz*dz);
      const ay = cy*(dy*rl) - sy2*(dz*rl), az = sy2*(dy*rl) + cy*(dz*rl);
      const rdx = cyw*(dx*rl) + syw*az, rdy = ay, rdz = -syw*(dx*rl) + cyw*az;

      const b = ro[0]*rdx + ro[1]*rdy + ro[2]*rdz;
      const disc = b*b - cSphere;
      let r = 0.008, g = 0.012, bl = 0.024;   // deep space

      if (disc > 0) {
        const t = -b - Math.sqrt(disc);
        const nx = ro[0] + rdx*t, ny = ro[1] + rdy*t, nz = ro[2] + rdz*t;
        // into the tilted frame, then undo the spin about its axis
        const ty = ct*ny + st*nz, tz = -st*ny + ct*nz;
        const spx = cs*nx + ss*tz, spz = -ss*nx + cs*tz;
        const sp = [spx, ty, spz];
        const ndl = nx*sun[0] + ny*sun[1] + nz*sun[2];
        const bandX = mix(ty, ndl, s.locked);
        const bi = clamp((bandX + 1) * 0.5, 0, 0.9999) * s.bandT.length;
        const i0 = Math.min(Math.floor(bi), s.bandT.length - 1);
        const i1 = Math.min(i0 + 1, s.bandT.length - 1);
        const bt = bi - i0;
        const T = mix(s.bandT[i0], s.bandT[i1], bt);
        const ice = mix(s.bandIce[i0], s.bandIce[i1], bt);

        sphereUV(sp, UV);
        const f = sampleTerrain(s.terrain, UV, TMP);
        const detail = f[1];
        const thr = s.seaLevel ?? seaLevelForLand(clamp(1 - s.oceanFrac, 0, 1));
        const h = f[0] - thr;
        let land = smoothstep(-0.010, 0.026, h);
        land = mix(1, land, smoothstep(0, 0.04, s.oceanFrac));
        const mount = f[2] * smoothstep(0, 0.16, h);
        const elev = Math.max(h, 0) + 0.30*mount;

        const warmth = smoothstep(266, 284, T) * (1 - smoothstep(303, 322, T));
        const life = warmth * smoothstep(0.10, 0.55, s.waterCap) * (1 - smoothstep(0.10, 0.30, elev));

        // ground: desert -> steppe -> forest, then rock with altitude, matching
        // the same palette the shader mixes
        const veg = smoothstep(0.12, 0.50, life);
        const rockT = smoothstep(0.12, 0.34, elev);
        const shade = 0.85 + 0.3*detail;
        let gr = mix(mix(0.70, vegRgb[0], veg), 0.34, rockT) * shade;
        let gg = mix(mix(0.53, vegRgb[1], veg), 0.30, rockT) * shade;
        let gb = mix(mix(0.31, vegRgb[2], veg), 0.25, rockT) * shade;

        // ocean, graded by depth the way the shader does
        const depth = smoothstep(0, -0.26, h);
        const shallow = smoothstep(0, 0.35, depth), abyss = smoothstep(0.35, 1, depth);
        let sr = mix(mix(0.16, 0.06, shallow), 0.010, abyss);
        let sg = mix(mix(0.48, 0.26, shallow), 0.055, abyss);
        let sb = mix(mix(0.60, 0.47, shallow), 0.170, abyss);
        const dry = smoothstep(0.02, 0.25, s.waterCap);
        sr = mix(0.55, sr, dry); sg = mix(0.44, sg, dry); sb = mix(0.32, sb, dry);

        let cr = mix(sr, gr, land), cg = mix(sg, gg, land), cb = mix(sb, gb, land);
        let shin = (1 - land) * 0.9;

        // relief shading from the baked slope: this is what gives the surface
        // any sense of terrain rather than a flat wash
        if (relief > 0 && h > -0.02) {
          const sl = sampleSlope(s.terrain, UV, TMP2);
          const rf = clamp(1 + 5.5*(sl[0]*0.6 + sl[1]*0.8), 0.55, 1.5);
          const w = smoothstep(-0.02, 0.06, h) * relief;
          const k = mix(1, rf, w);
          cr *= k; cg *= k; cb *= k;
        }

        // sea ice on water, sheets on land where snow can reach, frost between
        const snowline = smoothstep(-0.06, 0.22, elev);
        const seaIce = clamp(ice*1.05 - 0.16*f[3], 0, 1) * mix(0.25, 1, s.waterCap) * (1 - land);
        const sheet = clamp(ice*(0.70 + 0.60*snowline) - 0.18*f[3], 0, 1) * s.glaciated * land;
        const seaIceM = smoothstep(0.06, 0.52, seaIce);
        const sheetM = smoothstep(0.06, 0.52, sheet);
        // The 0.55 has waterCap on it for the same reason planet.frag does:
        // frost needs water to deposit, radiation.js:338 has always said so,
        // and this port had the term missing in exactly the same way.
        const frostM = clamp(ice, 0, 1) * land * (1 - sheetM) * 0.55 * s.waterCap;
        cr = mix(cr, 0.66, frostM); cg = mix(cg, 0.66, frostM); cb = mix(cb, 0.68, frostM);
        cr = mix(cr, mix(0.72, 0.90, f[3]), seaIceM);
        cg = mix(cg, mix(0.82, 0.95, f[3]), seaIceM);
        cb = mix(cb, mix(0.90, 0.99, f[3]), seaIceM);
        cr = mix(cr, 0.88, sheetM); cg = mix(cg, 0.92, sheetM); cb = mix(cb, 0.96, sheetM);
        shin = mix(shin, 0.18, Math.max(seaIceM, sheetM));

        const melt = smoothstep(1150, 1500, T);
        if (melt > 0.001) {
          cr = mix(cr, 0.75, melt); cg = mix(cg, 0.22, melt); cb = mix(cb, 0.05, melt);
        }

        const lam = smoothstep(-0.12, 0.22, ndl);
        const lit = 0.06 + 0.94*lam;
        r = cr*lit*sc[0]; g = cg*lit*sc[1]; bl = cb*lit*sc[2];

        // sun-glitter off water and ice: a narrow lobe, brightening at grazing
        // angles, exactly as the shader computes it
        if (shin > 0.02 && lam > 0.01) {
          const hx = sun[0] - rdx, hy = sun[1] - rdy, hz = sun[2] - rdz;
          const hl = 1 / Math.sqrt(hx*hx + hy*hy + hz*hz);
          const nh = Math.max(nx*hx*hl + ny*hy*hl + nz*hz*hl, 0);
          if (nh > 0.9) {
            const ndv = -(nx*rdx + ny*rdy + nz*rdz);
            const graze = Math.pow(1 - Math.max(ndv, 0), 2.5);
            const spec = Math.pow(nh, 260) * shin * lam * (0.10 + 0.90*graze) * 0.30;
            r += sc[0]*spec; g += sc[1]*spec; bl += sc[2]*spec;
          }
        }

        // Thermal emission, from the LOCAL band temperature. This path used to
        // ignore temperature altogether -- it applied the whole of nightGlow,
        // which was itself taken from the planet's mean -- so it was the worse
        // of the two renderers on exactly the case that shows it up.
        // thermalGlow() is shared with the GL shader.
        if (s.nightGlow > 0) {
          const gl = s.nightGlow * thermalGlow(T) * (1 - lam);
          r += gl; g += 0.30*gl; bl += 0.08*gl;
        }

        // Volcanic vents, on the unlit side. Same field, same threshold walk
        // and the same colours as the GL path -- see planet.frag -- so a world
        // does not look more or less volcanic depending on the machine. f[3] is
        // the terrain's fine channel, which is what the shader reads as
        // texture(uTerrain, sp).a.
        if (s.volcano > 0.001 && h > -0.01) {
          const lo = mix(0.92, 0.55, s.volcano);
          const vent = smoothstep(lo, lo + 0.05, f[3]) * smoothstep(-0.01, 0.03, h);
          if (vent > 0.004) {
            const dim = 1 - vent * 0.5 * lam * s.volcano * 0.45;
            r *= dim; g *= dim; bl *= dim;
            const pulse = 0.75 + 0.25*Math.sin(time * 0.7 + f[3] * 40);
            const vg = vent * pulse * (1 - lam) * s.volcano * 1.6;
            r += vg; g += 0.42*vg; bl += 0.10*vg;
          }
        }

        // cloud deck: the baked detail field advected with time, so it churns
        // rather than sitting still
        if ((s.cloud > 0.02 || s.steam > 0.01) && s.clouds) {
          // two layers, drifting at different rates, so the deck churns
          // Sampled from a slightly differently-spun direction, so the deck
          // shears against the surface instead of co-rotating with it.
          const shear = 0.12 * s.spin / (Math.PI * 2);
          const lo = sampleCloud(s.clouds, UV, 0, time * 0.0016 + shear);
          const hi = sampleCloud(s.clouds, UV, 1, -time * 0.0031 + shear);
          const band = 0.5 + 0.5*Math.sin(ny*13 + lo*6);
          let cl = lo*0.68 + hi*0.32;
          cl = mix(cl, cl*0.62 + 0.38*band, 0.42*(1 - s.locked));
          const cover = clamp(s.cloud + s.locked*Math.max(ndl, 0)*0.35, 0, 1);
          // A runaway greenhouse is wrapped in an opaque steam envelope; without
          // this the shader's `max(cmask, uSteam)` was missing and bare ground
          // showed through a boiling planet.
          const cm = Math.max(smoothstep(1 - cover, 1 - cover + 0.30, cl), s.steam) * 0.82;
          if (cm > 0.004) {
            const thick = smoothstep(1 - cover, 1 - cover + 0.5, cl);
            const cc = mix(0.86, 1.0, thick);
            const tr = mix(cc, 0.98, s.co2 * 0.5), tg = mix(cc, 0.86, s.co2 * 0.5), tb = mix(cc, 0.72, s.co2 * 0.5);
            const dim = 1 - 0.22*cm*(1 - thick);
            r *= dim; g *= dim; bl *= dim;
            const cl2 = 0.10 + 0.90*lam;
            r = mix(r, tr*cl2*sc[0], cm); g = mix(g, tg*cl2*sc[1], cm); bl = mix(bl, tb*cl2*sc[2], cm);
          }
        }

        // What the eye would really see through a deep atmosphere: Venus shows
        // cloud tops, Titan shows haze, and neither shows the ground.
        // Ash and sulphate by day, the other half of the same story.
        const ashAmt = s.ash || 0;
        if (ashAmt > 0.001) {
          const a = ashAmt * (0.25 + 0.55*lam), al = 0.18 + 0.82*lam;
          r += (0.78*al*sc[0] - r) * a;
          g += (0.74*al*sc[1] - g) * a;
          bl += (0.62*al*sc[2] - bl) * a;
        }

        const veil = s.veil || 0;
        if (veil > 0.001) {
          const vl = 0.12 + 0.88*lam;
          r += (tint[0]*vl - r) * veil;
          g += (tint[1]*vl - g) * veil;
          bl += (tint[2]*vl - bl) * veil;
        }

        // atmospheric limb against the surface
        const ndv = -(nx*rdx + ny*rdy + nz*rdz);
        const fres = Math.max(1 - Math.max(ndv, 0), 0);
        const rim = fres*fres*fres * lam * (0.30 + atmo) * 0.75;
        r += tint[0]*rim; g += tint[1]*rim; bl += tint[2]*rim;
      } else {
        p += 4;
        continue;
      }

      const ddx = px + 0.5 - W/2;
      const cov = clamp(Rpx - Math.sqrt(ddx*ddx + ddy*ddy) + 0.5, 0, 1);
      rgba[p++] = tone(r);
      rgba[p++] = tone(g);
      rgba[p++] = tone(bl);
      rgba[p++] = 255 * cov;
    }
  }
}
