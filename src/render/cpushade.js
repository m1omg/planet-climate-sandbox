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
  return { W, H, data };
}

function sampleTerrain(map, sp, out) {
  const u = (Math.atan2(sp[2], sp[0]) / (Math.PI*2) + 0.5) * map.W - 0.5;
  const v = (Math.acos(clamp(sp[1], -1, 1)) / Math.PI) * map.H - 0.5;
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

// Renders into an RGBA byte buffer. `s` carries everything the GPU path takes
// as uniforms.
export function renderPlanet(rgba, W, H, s) {
  const cy = Math.cos(s.pitch), sy2 = Math.sin(s.pitch);
  const cyw = Math.cos(s.yaw), syw = Math.sin(s.yaw);
  // view = rotY(yaw) * rotX(pitch), matching the GLSL
  const view = (v) => {
    const y = cy*v[1] - sy2*v[2], z = sy2*v[1] + cy*v[2];
    return [cyw*v[0] + syw*z, y, -syw*v[0] + cyw*z];
  };
  const ro = view([0, 0, 3]);
  const sun = s.sun, sc = s.starColor;
  const cs = Math.cos(-s.spin), ss = Math.sin(-s.spin);
  const minWH = Math.min(W, H);
  const atmo = clamp(0.030 + 0.10*Math.log(1 + s.pTot) + 0.16*s.steam, 0, 0.42)
             * smoothstep(0, 0.02, s.pTot);
  const tint = [mix(0.35, 1.0, s.co2), mix(0.60, 0.72, s.co2), mix(1.0, 0.34, s.co2)];

  let p = 0;
  for (let py = 0; py < H; py++) {
    const uy = (0.5*H - (py + 0.5)) / minWH;
    for (let px = 0; px < W; px++) {
      const ux = ((px + 0.5) - 0.5*W) / minWH;
      let rd = [ux*2.05, uy*2.05, -1.6];
      const rl = Math.hypot(rd[0], rd[1], rd[2]);
      rd = view([rd[0]/rl, rd[1]/rl, rd[2]/rl]);

      const b = ro[0]*rd[0] + ro[1]*rd[1] + ro[2]*rd[2];
      const disc = b*b - (ro[0]*ro[0] + ro[1]*ro[1] + ro[2]*ro[2] - 1);
      let r = 0.008, g = 0.012, bl = 0.024;   // deep space

      if (disc > 0) {
        const t = -b - Math.sqrt(disc);
        const n = [ro[0] + rd[0]*t, ro[1] + rd[1]*t, ro[2] + rd[2]*t];
        // planet-fixed direction: undo the spin about Y
        const sp = [cs*n[0] + ss*n[2], n[1], -ss*n[0] + cs*n[2]];
        const bandX = mix(n[1], n[0]*sun[0] + n[1]*sun[1] + n[2]*sun[2], s.locked);
        const bi = clamp((bandX + 1) * 0.5, 0, 0.9999) * s.bandT.length;
        const i0 = Math.min(Math.floor(bi), s.bandT.length - 1);
        const T = s.bandT[i0], ice = s.bandIce[i0];

        const f = sampleTerrain(s.terrain, sp, TMP);
        const detail = f[1];
        const thr = 0.625 - 0.25*clamp(1 - s.oceanFrac, 0, 1);
        const h = f[0] - thr;
        let land = smoothstep(-0.010, 0.026, h);
        land = mix(1, land, smoothstep(0, 0.04, s.oceanFrac));
        const mount = f[2] * smoothstep(0, 0.16, h);
        const elev = Math.max(h, 0) + 0.30*mount;

        const warmth = smoothstep(266, 284, T) * (1 - smoothstep(303, 322, T));
        const life = warmth * smoothstep(0.10, 0.55, s.waterCap) * (1 - smoothstep(0.10, 0.30, elev));

        // ground: desert -> steppe -> forest, then rock with altitude
        const veg = smoothstep(0.12, 0.50, life);
        const rockT = smoothstep(0.12, 0.34, elev);
        let gr = mix(mix(0.70, 0.42, veg), 0.34, rockT);
        let gg = mix(mix(0.53, 0.45, veg), 0.30, rockT);
        let gb = mix(mix(0.31, 0.22, veg), 0.25, rockT);
        gr *= 0.85 + 0.3*detail; gg *= 0.85 + 0.3*detail; gb *= 0.85 + 0.3*detail;

        const depth = smoothstep(0, -0.26, h);
        let sr = mix(0.13, 0.02, depth), sg = mix(0.42, 0.10, depth), sb = mix(0.56, 0.22, depth);
        const dry = smoothstep(0.02, 0.25, s.waterCap);
        sr = mix(0.55, sr, dry); sg = mix(0.44, sg, dry); sb = mix(0.32, sb, dry);

        let cr = mix(sr, gr, land), cg = mix(sg, gg, land), cb = mix(sb, gb, land);
        let shin = (1 - land) * 0.9;

        // ice: sea ice on water, sheets on land where snow can reach
        const snowline = smoothstep(-0.06, 0.22, elev);
        const seaIce = clamp(ice*1.05 - 0.16*f[3], 0, 1) * mix(0.25, 1, s.waterCap) * (1 - land);
        const sheet = clamp(ice*(0.70 + 0.60*snowline) - 0.18*f[3], 0, 1) * s.glaciated * land;
        const iceM = clamp(Math.max(smoothstep(0.06, 0.52, seaIce), smoothstep(0.06, 0.52, sheet)), 0, 1);
        cr = mix(cr, 0.88, iceM); cg = mix(cg, 0.92, iceM); cb = mix(cb, 0.96, iceM);
        shin = mix(shin, 0.18, iceM);

        // molten
        const melt = smoothstep(1150, 1500, T);
        if (melt > 0.001) {
          cr = mix(cr, 0.75, melt); cg = mix(cg, 0.22, melt); cb = mix(cb, 0.05, melt);
        }

        const ndl = n[0]*sun[0] + n[1]*sun[1] + n[2]*sun[2];
        const lam = smoothstep(-0.12, 0.22, ndl);
        const shade = 0.06 + 0.94*lam;
        r = cr*shade*sc[0]; g = cg*shade*sc[1]; bl = cb*shade*sc[2];

        // thermal glow on a hot night side
        if (s.nightGlow > 0) {
          const gl = s.nightGlow * (1 - lam);
          r += 1.0*gl*0.35; g += 0.30*gl*0.35; bl += 0.08*gl*0.35;
        }

        // cloud veil: a cheap latitude-banded modulation, enough to read as weather
        if (s.cloud > 0.02) {
          const cband = 0.5 + 0.5*Math.sin(n[1]*13 + detail*6 + s.time*0.08);
          const cm = clamp((s.cloud*1.1 - 0.45) + 0.55*cband, 0, 1) * s.cloud;
          const cl = 0.10 + 0.90*lam;
          r = mix(r, 0.95*cl*sc[0], cm*0.8); g = mix(g, 0.96*cl*sc[1], cm*0.8); bl = mix(bl, 0.98*cl*sc[2], cm*0.8);
        }

        // limb: atmospheric rim against the surface
        const ndv = -(n[0]*rd[0] + n[1]*rd[1] + n[2]*rd[2]);
        const fres = Math.pow(1 - Math.max(ndv, 0), 3) * lam * (0.30 + atmo) * 0.75;
        r += tint[0]*fres; g += tint[1]*fres; bl += tint[2]*fres;
      } else {
        // atmospheric halo just outside the disc, then the odd star
        const Ra = 1 + atmo;
        const dA = b*b - (ro[0]*ro[0] + ro[1]*ro[1] + ro[2]*ro[2] - Ra*Ra);
        if (dA > 0 && atmo > 0.001) {
          const path = 2*Math.sqrt(dA);
          const dens = Math.pow(clamp(path / (2*atmo + 0.001), 0, 1), 1.7) * 0.5;
          r += tint[0]*dens; g += tint[1]*dens; bl += tint[2]*dens;
        }
        const sd = Math.max(rd[0]*sun[0] + rd[1]*sun[1] + rd[2]*sun[2], 0);
        const star = Math.pow(sd, 900) * 3;
        if (star > 0.002) { r += sc[0]*star; g += sc[1]*star; bl += sc[2]*star; }
      }

      // same tonemap and gamma as the GPU path, so the two look alike
      rgba[p++] = 255 * Math.pow(r / (r + 0.85), 1/2.2);
      rgba[p++] = 255 * Math.pow(g / (g + 0.85), 1/2.2);
      rgba[p++] = 255 * Math.pow(bl / (bl + 0.85), 1/2.2);
      rgba[p++] = 255;
    }
  }
}
