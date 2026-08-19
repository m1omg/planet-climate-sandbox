#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uSpin;        // planet rotation phase
uniform vec3  uSunDir;
uniform vec3  uStarColor;
uniform float uSeed;
uniform float uLandFrac;
uniform float uOceanFrac;
uniform float uWaterCap;    // 0 = bone dry, 1 = plenty of water for snow/sea
uniform float uCloud;       // mean cloud cover 0..1
uniform float uSteam;       // 0..1 thick steam envelope
uniform float uPTot;        // bar
uniform float uCO2;         // 0..1 how CO2-dominated the air is
uniform float uMagma;       // 0..1 molten surface
uniform float uLocked;      // 0 = free rotator, 1 = tidally locked
uniform float uYaw;         // camera orbit, radians
uniform float uPitch;
uniform float uNightGlow;   // thermal emission on the dark side
uniform float uBandT[18];
uniform float uBandIce[18];

// Texture path. uUseTex fades between the fully procedural look (0) and the
// generated albedo maps (1), so the two versions share all the same lighting,
// climate response and atmosphere -- only the surface albedo differs.
uniform float uUseTex;
uniform sampler2D uTexRock;
uniform sampler2D uTexDesert;
uniform sampler2D uTexVeg;
uniform sampler2D uTexIce;
uniform sampler2D uTexOcean;
uniform sampler2D uTexLava;

const float PI = 3.14159265;

// ---------- gradient noise ----------
// Value noise is cheap but visibly blobby. Gradient (Perlin-style) noise gives
// terrain with real ridges and valleys instead of soft lumps.
float hash(vec3 p){ p = fract(p*0.3183099 + vec3(0.71,0.113,0.419)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
vec3 hash3(vec3 p){
  p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6)));
  return -1.0 + 2.0*fract(sin(p)*43758.5453123);
}
float gnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0);   // quintic fade: smooth second derivative
  return mix(mix(mix(dot(hash3(i+vec3(0,0,0)),f-vec3(0,0,0)),
                     dot(hash3(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
                 mix(dot(hash3(i+vec3(0,1,0)),f-vec3(0,1,0)),
                     dot(hash3(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
             mix(mix(dot(hash3(i+vec3(0,0,1)),f-vec3(0,0,1)),
                     dot(hash3(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
                 mix(dot(hash3(i+vec3(0,1,1)),f-vec3(0,1,1)),
                     dot(hash3(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z)*0.5+0.5;
}
float vnoise(vec3 x){ return gnoise(x); }

const mat3 ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i=0;i<8;i++){ if(i>=oct) break; s += a*gnoise(p); n += a; p = ROT*p*2.02; a *= 0.5; }
  return s/n;
}
// Ridged multifractal: mountain chains rather than blobs.
float ridged(vec3 p, int oct){
  float a=0.5, s=0.0, n=0.0, prev=1.0;
  for(int i=0;i<8;i++){
    if(i>=oct) break;
    float r = 1.0-abs(gnoise(p)*2.0-1.0); r *= r;
    s += a*r*prev; prev = r; n += a; p = ROT*p*2.11; a *= 0.5;
  }
  return s/n;
}
// Continents: fbm whose input is displaced by more fbm, giving coastlines with
// bays, peninsulas and inland seas instead of round islands.
float warpedFbm(vec3 p, int oct){
  vec3 q = vec3(fbm(p, 4), fbm(p + vec3(5.2,1.3,2.7), 4), fbm(p + vec3(1.7,9.2,3.1), 4));
  return fbm(p + 2.4*(q - 0.5), oct);
}

// ---------- band lookup ----------
float bandVal(float x, int which){
  float f = clamp((x+1.0)*0.5, 0.0, 0.99999) * 18.0 - 0.5;
  int i0 = int(floor(max(f,0.0)));
  int i1 = min(i0+1, 17);
  float t = clamp(f - float(i0), 0.0, 1.0);
  float a, b;
  if(which==0){ a = uBandT[i0];  b = uBandT[i1]; }
  else        { a = uBandIce[i0]; b = uBandIce[i1]; }
  return mix(a,b,t);
}

mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }

// ---------- surface colour ----------
// Returns albedo; height comes back so main() can shade slopes, and shininess
// drives the specular glint off water and ice.
vec3 surfaceColor(vec3 sp, float T, float ice, out float shininess, out float height){
  vec3 q = sp*2.2 + vec3(uSeed*13.7, uSeed*7.1, uSeed*3.3);

  float cont   = warpedFbm(q, 6);
  float detail = fbm(q*5.0, 5);
  float fine   = fbm(q*17.0, 3);

  float landTarget = clamp(1.0 - uOceanFrac, 0.0, 1.0);
  float thr = 0.625 - 0.25*landTarget;
  float h = cont + 0.10*(detail-0.5) + 0.03*(fine-0.5) - thr;
  height = h;
  float land = smoothstep(-0.010, 0.026, h);
  // A world with no ocean has no sea basins: low ground is just low ground.
  land = mix(1.0, land, smoothstep(0.0, 0.04, uOceanFrac));

  // Mountain belts sit in the continental interiors, as they do on Earth.
  float mount = ridged(q*3.4, 5) * smoothstep(0.0, 0.16, h);
  float elev  = max(h, 0.0) + 0.30*mount;

  vec3 rock   = mix(vec3(0.30,0.25,0.21), vec3(0.46,0.39,0.31), detail);
  vec3 rockHi = mix(vec3(0.42,0.38,0.34), vec3(0.58,0.53,0.47), fine);
  vec3 sand   = mix(vec3(0.68,0.50,0.28), vec3(0.86,0.71,0.45), detail);
  vec3 sandHi = mix(vec3(0.78,0.62,0.38), vec3(0.90,0.79,0.56), fine);
  vec3 forest = mix(vec3(0.11,0.26,0.11), vec3(0.24,0.40,0.16), detail);
  vec3 steppe = mix(vec3(0.42,0.44,0.22), vec3(0.56,0.54,0.30), detail);

  // Vegetation needs warmth AND water, thins with altitude, and gives way to
  // steppe before it gives way to desert.
  float warmth = smoothstep(266.0,284.0,T) * (1.0 - smoothstep(303.0,322.0,T));
  float wet    = smoothstep(0.10,0.55,uWaterCap);
  float life   = warmth * wet * (1.0 - smoothstep(0.10,0.30,elev));

  vec3 arid   = mix(sand, sandHi, smoothstep(0.05,0.22,elev));
  vec3 living = mix(steppe, forest, smoothstep(0.25,0.75,life));
  vec3 ground = mix(arid, living, smoothstep(0.12,0.50,life));
  ground = mix(ground, mix(rock, rockHi, mount), smoothstep(0.12,0.34,elev));
  ground = mix(ground, rock*0.85, smoothstep(0.06,-0.02,h)*0.5);

  float depth = smoothstep(0.0,-0.26,h);
  vec3 sea = mix(mix(vec3(0.16,0.48,0.60), vec3(0.06,0.26,0.47), smoothstep(0.0,0.35,depth)),
                 vec3(0.010,0.055,0.17), smoothstep(0.35,1.0,depth));
  // A drying sea goes briny and pale before it disappears altogether.
  sea = mix(mix(sand, rock, 0.35), sea, smoothstep(0.02,0.25,uWaterCap));

  vec3 col = mix(sea, ground, land);
  shininess = (1.0-land)*0.9;

  // Sea ice is floe-broken; land ice is a brighter snowfield that takes the
  // high ground first.
  float floe = fbm(q*9.0, 4);
  float snowline = smoothstep(-0.06, 0.22, elev);
  float iceAmt = clamp(ice*(0.75 + 0.55*snowline) - 0.16*floe, 0.0, 1.0) * mix(0.25, 1.0, uWaterCap);
  vec3 iceCol = mix(mix(vec3(0.72,0.82,0.90), vec3(0.90,0.95,0.99), floe),
                    mix(vec3(0.86,0.90,0.94), vec3(0.99,1.00,1.00), fine), land);
  float iceMask = smoothstep(0.06,0.52,iceAmt);
  col = mix(col, iceCol, iceMask);
  shininess = mix(shininess, 0.5, iceMask);

  float melt = smoothstep(1150.0,1500.0,T);
  if(melt > 0.001){
    float crack = ridged(q*6.0, 4);
    float glow  = smoothstep(0.45,0.95,crack);
    vec3 crust  = mix(vec3(0.05,0.04,0.04), vec3(0.14,0.11,0.10), detail);
    vec3 magma  = mix(vec3(0.85,0.16,0.02), vec3(1.0,0.85,0.35), pow(glow,2.0));
    col = mix(col, mix(crust, magma, glow), melt);
    shininess = mix(shininess, 0.0, melt);
  }
  return col;
}

// Equirectangular lookup for a point on the unit sphere.
vec2 sphereUV(vec3 p){
  return vec2(atan(p.z, p.x)/(2.0*PI) + 0.5, acos(clamp(p.y,-1.0,1.0))/PI);
}

// The same climate logic as surfaceColor(), but the palettes come from the
// generated albedo maps instead of noise. Blending is driven by exactly the
// same masks, so a planet looks like the same planet either way.
vec3 surfaceTextured(vec3 sp, float T, float ice, out float shininess, out float height){
  float shinP, hP;
  vec3 proc = surfaceColor(sp, T, ice, shinP, hP);   // reuse its masks
  height = hP; shininess = shinP;

  vec2 uv = sphereUV(sp);
  vec2 uvD = uv * vec2(2.0, 1.0);      // detail scale, tiles horizontally

  vec3 tRock  = texture(uTexRock,   uvD).rgb;
  vec3 tSand  = texture(uTexDesert, uvD).rgb;
  vec3 tVeg   = texture(uTexVeg,    uvD).rgb;
  vec3 tIce   = texture(uTexIce,    uvD).rgb;
  vec3 tSea   = texture(uTexOcean,  uvD).rgb;
  vec3 tLava  = texture(uTexLava,   uvD).rgb;

  vec3 q = sp*2.2 + vec3(uSeed*13.7, uSeed*7.1, uSeed*3.3);
  float cont   = warpedFbm(q, 6);
  float detail = fbm(q*5.0, 5);
  float fine   = fbm(q*17.0, 3);
  float landTarget = clamp(1.0 - uOceanFrac, 0.0, 1.0);
  float h = cont + 0.10*(detail-0.5) + 0.03*(fine-0.5) - (0.625 - 0.25*landTarget);
  float land = smoothstep(-0.010, 0.026, h);
  land = mix(1.0, land, smoothstep(0.0, 0.04, uOceanFrac));
  float mount = ridged(q*3.4, 5) * smoothstep(0.0, 0.16, h);
  float elev  = max(h, 0.0) + 0.30*mount;

  float warmth = smoothstep(266.0,284.0,T) * (1.0 - smoothstep(303.0,322.0,T));
  float wet    = smoothstep(0.10,0.55,uWaterCap);
  float life   = warmth * wet * (1.0 - smoothstep(0.10,0.30,elev));

  vec3 ground = mix(tSand, tVeg, smoothstep(0.12,0.50,life));
  ground = mix(ground, tRock, smoothstep(0.12,0.34,elev));

  float depth = smoothstep(0.0,-0.26,h);
  vec3 sea = tSea * mix(1.15, 0.35, smoothstep(0.0,1.0,depth));
  sea = mix(mix(tSand, tRock, 0.35), sea, smoothstep(0.02,0.25,uWaterCap));

  vec3 col = mix(sea, ground, land);

  float floe = fbm(q*9.0, 4);
  float snowline = smoothstep(-0.06, 0.22, elev);
  float iceAmt = clamp(ice*(0.75 + 0.55*snowline) - 0.16*floe, 0.0, 1.0) * mix(0.25, 1.0, uWaterCap);
  col = mix(col, tIce, smoothstep(0.06,0.52,iceAmt));

  float melt = smoothstep(1150.0,1500.0,T);
  col = mix(col, tLava, melt);

  // Keep a little of the procedural tint so climate colour cues survive.
  return mix(col, proc, 0.22);
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y);
  // Dragging orbits the camera rather than turning the planet, so the star, the
  // terminator and the ice caps all stay where they belong while you look from
  // a new angle.
  mat3 view = rotY(uYaw) * rotX(uPitch);
  vec3 ro = view * vec3(0.0, 0.0, 3.0);
  vec3 rd = view * normalize(vec3(uv*2.05, -1.6));

  vec3 col = vec3(0.0);

  // ---- starfield ----
  vec3 sdir = normalize(rd + vec3(0.0,0.0,0.0));
  float sf = hash(floor(sdir*260.0));
  float stars = pow(smoothstep(0.9975, 1.0, sf), 1.0);
  float tw = 0.7 + 0.3*sin(uTime*1.7 + sf*80.0);
  col += vec3(0.85,0.9,1.0)*stars*tw*1.4;
  col += vec3(0.02,0.03,0.06) * (0.6 + 0.4*fbm(sdir*2.0,3));

  // ---- sphere intersection ----
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float disc = b*b - c;

  // Thickness follows the actual surface pressure, and goes to nothing when
  // there is no air left: an airless rock must not wear a halo.
  float airAmount = smoothstep(0.0, 0.02, uPTot);
  float atmoThick = airAmount * clamp(0.030 + 0.10*log(1.0 + uPTot) + 0.16*uSteam, 0.0, 0.42);
  float Ra = 1.0 + atmoThick;
  float bA = dot(ro, rd), cA = dot(ro,ro) - Ra*Ra;
  float dA = bA*bA - cA;

  vec3 airTint = mix(vec3(0.35,0.60,1.0), vec3(1.0,0.72,0.34), uCO2);
  airTint = mix(airTint, vec3(1.0,0.96,0.92), uSteam);

  if(disc > 0.0){
    float t = -b - sqrt(disc);
    vec3 pos = ro + rd*t;
    vec3 n = normalize(pos);

    // planet-fixed coordinates
    vec3 sp = rotY(-uSpin) * n;
    // for a locked world the band axis runs from the substellar point
    float bandX = mix(n.y, dot(n, uSunDir), uLocked);
    float T = bandVal(bandX, 0);
    float ice = bandVal(bandX, 1);

    float shin, height;
    vec3 base = surfaceColor(sp, T, ice, shin, height);
    if(uUseTex > 0.001){
      float shinT, hT;
      vec3 tex = surfaceTextured(sp, T, ice, shinT, hT);
      base = mix(base, tex, uUseTex);
    }

    // Relief shading. Sampling the height field either side of this point gives
    // a surface normal, so slopes catch and lose the light and mountains read as
    // mountains rather than as a colour change.
    vec3 tang = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0,1,0) : vec3(1,0,0)));
    vec3 bitan = cross(n, tang);
    const float eps = 0.012;
    float hx0, hx1, hy0, hy1, sd;
    vec3 dummy;
    dummy = surfaceColor(normalize(sp - tang*eps), T, ice, sd, hx0);
    dummy = surfaceColor(normalize(sp + tang*eps), T, ice, sd, hx1);
    dummy = surfaceColor(normalize(sp - bitan*eps), T, ice, sd, hy0);
    dummy = surfaceColor(normalize(sp + bitan*eps), T, ice, sd, hy1);
    float relief = clamp(1.0 + 5.5*((hx1-hx0)*0.6 + (hy1-hy0)*0.8), 0.55, 1.5);
    relief = mix(1.0, relief, smoothstep(-0.02, 0.06, height));   // land only
    base *= relief;

    float ndl = dot(n, uSunDir);
    float lam = smoothstep(-0.12, 0.22, ndl);

    // specular glint off water and ice
    vec3 h = normalize(uSunDir - rd);
    float spec = pow(max(dot(n,h),0.0), 42.0) * shin * lam;

    vec3 lit = base * (0.06 + 0.94*lam) * uStarColor;
    lit += uStarColor * spec * 0.55;

    // thermal emission from a hot or molten surface: visible on the night side
    float glow = uNightGlow * (1.0 - lam);
    lit += vec3(1.0,0.30,0.08) * glow * (0.35 + 0.65*smoothstep(1100.0,1500.0,T));

    // ---- clouds ----
    // Two layers drifting at different speeds, warped by their own noise, so
    // the deck churns and shears the way weather does instead of sliding past
    // as one rigid sheet. Banding follows latitude on a fast rotator; on a
    // tidally locked world the deck piles over the substellar point instead.
    vec3 cq = rotY(-uSpin*1.12) * n;
    float flow = uTime*0.010;
    vec3 warp = vec3(fbm(cq*1.7 + vec3(flow*0.5,0.0,0.0), 3),
                     fbm(cq*1.7 + vec3(3.1,flow*0.4,1.7), 3),
                     fbm(cq*1.7 + vec3(0.7,2.3,flow*0.6), 3)) - 0.5;
    float lo = fbm(cq*2.4 + warp*1.5 + vec3(flow, flow*0.25, -flow*0.5), 5);
    float hi = fbm(cq*6.5 + warp*2.2 + vec3(-flow*1.9, flow*0.6, flow*0.9), 4);
    float cl = lo*0.68 + hi*0.32;

    float bands = 0.5 + 0.5*sin(n.y*13.0 + fbm(cq*3.0,3)*6.0);
    cl = mix(cl, cl*0.62 + 0.38*bands, 0.42*(1.0-uLocked));

    float sub = smoothstep(0.0, 0.9, dot(n, uSunDir));
    float cover = clamp(uCloud + uLocked*sub*0.35, 0.0, 1.0);
    float cmask = smoothstep(1.0-cover, 1.0-cover+0.26, cl);
    cmask = max(cmask, uSteam);

    // Thicker cloud is brighter and casts a little shadow at its edges, which
    // is what stops the deck looking like flat white paint.
    float thick = smoothstep(1.0-cover, 1.0-cover+0.45, cl);
    vec3 cloudCol = mix(vec3(0.86,0.88,0.92), vec3(1.0,0.99,0.97), thick);
    cloudCol = mix(cloudCol, vec3(0.98,0.86,0.72), uCO2*0.5);
    lit *= 1.0 - 0.22*cmask*(1.0-thick);                  // shadowed edges
    lit = mix(lit, cloudCol * uStarColor * (0.10 + 0.90*lam), cmask*0.82);

    // limb darkening + atmospheric rim seen against the surface
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    lit += airTint * fres * lam * (0.30 + 1.0*atmoThick) * 0.75 * airAmount;

    col = lit;
  } else if(dA > 0.0){
    // ---- atmospheric halo outside the disc ----
    float t0 = -bA - sqrt(dA), t1 = -bA + sqrt(dA);
    float path = max(t1 - t0, 0.0);
    vec3 mid = ro + rd*(t0 + path*0.5);
    float lam = smoothstep(-0.35, 0.5, dot(normalize(mid), uSunDir));
    float dens = pow(clamp(path / (2.0*atmoThick + 0.001), 0.0, 1.0), 1.7);
    col += airTint * dens * lam * (0.55 + 1.3*uSteam) * 0.9 * airAmount;
  }

  // ---- the star itself ----
  vec3 sunDirScreen = normalize(uSunDir);
  float sd = max(dot(normalize(rd), sunDirScreen), 0.0);
  col += uStarColor * pow(sd, 900.0) * 3.0;
  col += uStarColor * pow(sd, 24.0) * 0.05;

  // tonemap
  col = col / (col + vec3(0.85));
  col = pow(col, vec3(1.0/2.2));
  fragColor = vec4(col, 1.0);
}
