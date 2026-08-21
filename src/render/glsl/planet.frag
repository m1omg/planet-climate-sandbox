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
uniform float uSeaLevel;    // threshold on the baked height that puts the coast in the right place
uniform float uWaterCap;    // 0 = bone dry, 1 = plenty of water for snow/sea
uniform float uGlaciated;   // share of frozen land carrying an ice sheet

// The baked surface fields. Everything that does not change with the climate
// lives here now, computed once per world instead of hundreds of times per
// pixel per frame.
uniform samplerCube uTerrain;   // R,G = height (16-bit), B = detail, A = fine
uniform samplerCube uDetailMap; // R = mount, G = floe, B,A = slope pair
uniform samplerCube uCloudMap;  // R = broad deck, G = churn, B = warp, A = banding
uniform float uRelief;          // 0 disables relief shading (low quality)
uniform float uCloudDetail;     // 1 = full churn, 0 = single sample
uniform float uCloud;       // mean cloud cover 0..1
uniform float uSteam;       // 0..1 thick steam envelope
uniform float uAtmoThick;   // shell thickness as a fraction of the planet radius
uniform float uVeil;        // 0..1 how completely the air hides the ground
uniform float uHaze;        // 0..1 organic haze, orange and opaque
uniform float uPTot;        // bar
uniform float uCO2;         // 0..1 how CO2-dominated the air is
uniform float uMagma;       // 0..1 molten surface
uniform float uLocked;      // 0 = free rotator, 1 = tidally locked
uniform float uZoom;        // camera distance, 1 = default framing
uniform float uTilt;        // obliquity, radians: the spin axis leans this far
uniform float uYaw;         // camera orbit, radians
uniform float uPitch;
uniform float uNightGlow;   // thermal emission on the dark side
// Per-band temperature and ice, as a texture rather than two uniform arrays.
// Uniform arrays cost a vector each -- 36 of them, against a WebGL1 guaranteed
// maximum of 16 -- and indexing them with a computed index is only OPTIONAL in
// GLSL ES 1.00, so drivers may legally refuse it. A texture has neither problem:
// the coordinate is a float, and it costs one sampler.
//   R,G = temperature packed to 16 bits over 0..4000 K
//   B   = ice fraction
uniform sampler2D uBands;

// Texture path. uUseTex fades between the fully procedural look (0) and the
// generated albedo maps (1), so the two versions share all the same lighting,
// climate response and atmosphere -- only the surface albedo differs.
uniform float uUseTex;
#ifndef NO_ALBEDO
uniform sampler2D uTexRock;
uniform sampler2D uTexDesert;
uniform sampler2D uTexVeg;
uniform sampler2D uTexIce;
uniform sampler2D uTexOcean;
uniform sampler2D uTexLava;
#endif

const float PI = 3.14159265;

//__NOISE__

// ---------- band lookup ----------
// Sampled with NEAREST, so each fetch lands squarely on one texel and the
// interpolation between neighbours stays explicit -- filtering the two halves of
// a packed 16-bit value independently would produce nonsense at every boundary.
float bandTexel(float i, int which){
  vec4 c = texture(uBands, vec2((i + 0.5) / 18.0, 0.5));
  if(which == 0) return (c.r * 65280.0 + c.g * 255.0) / 65535.0 * 4000.0;
  return c.b;
}

float bandVal(float x, int which){
  float f = clamp((x+1.0)*0.5, 0.0, 0.99999) * 18.0 - 0.5;
  float i0 = floor(max(f, 0.0));
  float i1 = min(i0 + 1.0, 17.0);
  float t = clamp(f - i0, 0.0, 1.0);
  return mix(bandTexel(i0, which), bandTexel(i1, which), t);
}

mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
// Bring a direction into the planet's own frame, whose spin axis leans by the
// obliquity. Leaning about X keeps the tilt broadside to the default view, so
// it is visible rather than hidden edge-on.
mat3 tiltFrame(float a){ float c=cos(a),s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }

// ---------- surface colour ----------
// Returns albedo; height comes back so main() can shade slopes, and shininess
// drives the specular glint off water and ice.
// Unpack the 16-bit height the bake wrote across two channels.
float unpack16(vec2 c){ return (c.x*255.0*256.0 + c.y*255.0) / 65535.0; }

vec3 surfaceColor(vec3 sp, float T, float ice, out float shininess, out float height){
  vec4 terr = texture(uTerrain, sp);
  vec4 det  = texture(uDetailMap, sp);
  float detail = terr.b;
  float fine   = terr.a;

  // Sea level comes from the CPU: it is one number for the whole frame, and
  // the straight line this used to be drew 14.8% land when 30% was asked for.
  float thr = uSeaLevel;
  // Sea level is a threshold on the baked height, so the coastline follows the
  // water inventory without ever needing a rebake.
  float h = unpack16(terr.rg) - thr;
  height = h;
  float land = smoothstep(-0.010, 0.026, h);
  // A world with no ocean has no sea basins: low ground is just low ground.
  land = mix(1.0, land, smoothstep(0.0, 0.04, uOceanFrac));

  // Mountain belts sit in the continental interiors, as they do on Earth.
  float mount = det.r * smoothstep(0.0, 0.16, h);
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
  // Sea ice and land ice are drawn separately, because a planet can have one
  // without the other. A frozen ocean still covers its basin, while the
  // continents beside it may be bare frosted rock if no snow reaches them --
  // which is what a hard snowball actually looks like.
  float floe = det.g;
  float snowline = smoothstep(-0.06, 0.22, elev);

  float seaIceAmt = clamp(ice*1.05 - 0.16*floe, 0.0, 1.0) * mix(0.25, 1.0, uWaterCap);
  vec3 seaIceCol = mix(vec3(0.72,0.82,0.90), vec3(0.90,0.95,0.99), floe);
  float seaIceMask = smoothstep(0.06,0.52,seaIceAmt) * (1.0 - land);

  // Ice sheets take the high ground first, and only where snow can reach.
  float sheetAmt = clamp(ice*(0.70 + 0.60*snowline) - 0.18*floe, 0.0, 1.0) * uGlaciated;
  vec3 sheetCol = mix(vec3(0.86,0.90,0.94), vec3(0.99,1.00,1.00), fine);
  float sheetMask = smoothstep(0.06,0.52,sheetAmt) * land;

  // Frozen ground with no ice sheet still frosts over: paler than summer rock,
  // nothing like an ice cap.
  float frostMask = clamp(ice, 0.0, 1.0) * land * (1.0 - smoothstep(0.06,0.52,sheetAmt));
  col = mix(col, mix(col, vec3(0.66,0.66,0.68), 0.55), frostMask);

  col = mix(col, seaIceCol, seaIceMask);
  col = mix(col, sheetCol, sheetMask);
  float iceMask = max(seaIceMask, sheetMask);
  shininess = mix(shininess, 0.18, iceMask);

  float melt = smoothstep(1150.0,1500.0,T);
  if(melt > 0.001){
    // The lava crust is the one field still evaluated live: it only ever runs
    // on a molten planet, and only inside this branch.
    float crack = ridged4(sp*13.2 + vec3(uSeed*13.7, uSeed*7.1, uSeed*3.3));
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
#ifndef NO_ALBEDO
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

  vec4 terr = texture(uTerrain, sp);
  vec4 det  = texture(uDetailMap, sp);
  float detail = terr.b, fine = terr.a;
  float h = unpack16(terr.rg) - uSeaLevel;
  float land = smoothstep(-0.010, 0.026, h);
  land = mix(1.0, land, smoothstep(0.0, 0.04, uOceanFrac));
  float mount = det.r * smoothstep(0.0, 0.16, h);
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

  float floe = det.g;
  float snowline = smoothstep(-0.06, 0.22, elev);
  float seaIceAmt = clamp(ice*1.05 - 0.16*floe, 0.0, 1.0) * mix(0.25, 1.0, uWaterCap);
  float sheetAmt  = clamp(ice*(0.70 + 0.60*snowline) - 0.18*floe, 0.0, 1.0) * uGlaciated;
  float frostMask = clamp(ice,0.0,1.0) * land * (1.0 - smoothstep(0.06,0.52,sheetAmt));
  col = mix(col, mix(col, vec3(0.66,0.66,0.68), 0.55), frostMask);
  col = mix(col, tIce, smoothstep(0.06,0.52,seaIceAmt) * (1.0 - land));
  col = mix(col, tIce, smoothstep(0.06,0.52,sheetAmt) * land);

  float melt = smoothstep(1150.0,1500.0,T);
  col = mix(col, tLava, melt);

  // Keep a little of the procedural tint so climate colour cues survive.
  return mix(col, proc, 0.22);
}
#endif

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y);
  // Dragging orbits the camera rather than turning the planet, so the star, the
  // terminator and the ice caps all stay where they belong while you look from
  // a new angle.
  mat3 view = rotY(uYaw) * rotX(uPitch);
  // Zoom by moving the camera rather than narrowing the lens, so the planet
  // keeps its perspective and the atmosphere's limb still reads correctly.
  vec3 ro = view * vec3(0.0, 0.0, 3.0 * uZoom);
  vec3 rd = view * normalize(vec3(uv*2.05, -1.6));

  vec3 col = vec3(0.0);

  // ---- starfield ----
  vec3 sdir = normalize(rd + vec3(0.0,0.0,0.0));
  float sf = hash(floor(sdir*260.0));
  float stars = pow(smoothstep(0.9975, 1.0, sf), 1.0);
  float tw = 0.7 + 0.3*sin(uTime*1.7 + sf*80.0);
  col += vec3(0.85,0.9,1.0)*stars*tw*1.4;
  col += vec3(0.02,0.03,0.06) * (0.6 + 0.4*gnoise(sdir*2.0));

  // ---- sphere intersection ----
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float disc = b*b - c;

  // Thickness comes from the CPU now, because the two modes need different
  // physics: the stylised one grows with the logarithm of surface pressure so a
  // thick atmosphere reads at a glance, while the realistic one is a real scale
  // height and is consequently a thin bright rim -- Earth's air is 0.7% of its
  // radius, not the 30% a diagram would draw. An airless rock wears no halo
  // either way.
  float airAmount = smoothstep(0.0, 0.02, uPTot);
  float atmoThick = airAmount * uAtmoThick;
  float Ra = 1.0 + atmoThick;
  float bA = dot(ro, rd), cA = dot(ro,ro) - Ra*Ra;
  float dA = bA*bA - cA;

  vec3 airTint = mix(vec3(0.35,0.60,1.0), vec3(1.0,0.72,0.34), uCO2);
  airTint = mix(airTint, vec3(1.0,0.96,0.92), uSteam);
  // Tholin haze is orange and it is the top of the atmosphere, so it colours
  // both the rim and whatever it hides.
  airTint = mix(airTint, vec3(0.93,0.62,0.26), uHaze);

  bool hitPlanet = disc > 0.0;

  if(hitPlanet){
    float t = -b - sqrt(disc);
    vec3 pos = ro + rd*t;
    vec3 n = normalize(pos);

    // Planet-fixed coordinates. The spin axis leans by the obliquity, so the
    // whole planet -- its bands, its ice caps and its surface -- tilts together,
    // and the terminator then cuts across the latitudes at an angle instead of
    // running straight down the poles. Without this the axial tilt controlled
    // the seasons in the physics and was invisible on the globe.
    vec3 nT = tiltFrame(uTilt) * n;
    vec3 sp = rotY(-uSpin) * nT;
    // for a locked world the band axis runs from the substellar point
    float bandX = mix(nT.y, dot(n, uSunDir), uLocked);
    float T = bandVal(bandX, 0);
    float ice = bandVal(bandX, 1);

    float shin, height;
    vec3 base = surfaceColor(sp, T, ice, shin, height);
#ifndef NO_ALBEDO
    if(uUseTex > 0.001){
      float shinT, hT;
      vec3 tex = surfaceTextured(sp, T, ice, shinT, hT);
      base = mix(base, tex, uUseTex);
    }
#endif

    // Relief shading, from the slope the bake already measured. This used to
    // cost four more full surface evaluations per pixel -- 140 of the 269 noise
    // calls -- for a number that never changes once the world is generated.
    vec2 slope = (texture(uDetailMap, sp).ba - 0.5) / 8.0;
    float relief = clamp(1.0 + 5.5*(slope.x*0.6 + slope.y*0.8), 0.55, 1.5);
    relief = mix(1.0, relief, smoothstep(-0.02, 0.06, height) * uRelief);
    base *= relief;

    float ndl = dot(n, uSunDir);
    float lam = smoothstep(-0.12, 0.22, ndl);

    // Sun-glitter off water and ice. Real sea glint is a narrow lobe that
    // brightens towards grazing angles, so it needs a high exponent and a
    // Fresnel weight; a broad, strong lobe reads as the star shining straight
    // through the planet.
    vec3 h = normalize(uSunDir - rd);
    float grazing = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
    float spec = pow(max(dot(n,h),0.0), 260.0) * shin * lam * (0.10 + 0.90*grazing);

    vec3 lit = base * (0.06 + 0.94*lam) * uStarColor;
    lit += uStarColor * spec * 0.30;

    // thermal emission from a hot or molten surface: visible on the night side
    float glow = uNightGlow * (1.0 - lam);
    lit += vec3(1.0,0.30,0.08) * glow * (0.35 + 0.65*smoothstep(1100.0,1500.0,T));

    // ---- clouds ----
    // Two layers drifting at different speeds, warped by their own noise, so
    // the deck churns and shears the way weather does instead of sliding past
    // as one rigid sheet. Banding follows latitude on a fast rotator; on a
    // tidally locked world the deck piles over the substellar point instead.
    // The deck is baked; the motion comes from turning the direction it is
    // sampled along. Two layers rotated at different rates still shear against
    // each other, and a third sample warps them so the churn is not rigid.
    vec3 cq = rotY(-uSpin*1.12) * tiltFrame(uTilt) * n;
    float flow = uTime*0.010;
    float w = texture(uCloudMap, rotY(flow*0.35) * cq).b - 0.5;
    vec3 cqA = normalize(rotY(flow) * cq + vec3(w*0.22, w*0.10, -w*0.16));
    float lo = texture(uCloudMap, cqA).r;
    float hi = uCloudDetail > 0.5
             ? texture(uCloudMap, normalize(rotY(-flow*1.9) * cq + vec3(-w*0.3, w*0.2, w*0.24))).g
             : lo;
    float cl = lo*0.68 + hi*0.32;

    float bands = 0.5 + 0.5*sin(n.y*13.0 + texture(uCloudMap, cq).a*6.0);
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

    // What the eye would actually see. A deep atmosphere is not a window: 92
    // bar of CO2 scatters so hard that Venus shows only cloud tops, and Titan's
    // haze hides its surface completely. uVeil is that opacity, and it is only
    // applied in the realistic mode -- the stylised one keeps showing the
    // ground, which is the whole point of looking at a climate model.
    vec3 veilCol = mix(airTint, vec3(0.86,0.88,0.92), 1.0 - uHaze) * uStarColor;
    lit = mix(lit, veilCol * (0.12 + 0.88*lam), uVeil);

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
  // Only where the planet does not stand in the way. This used to be added
  // unconditionally, which was invisible from the default viewpoint -- the star
  // sits behind the camera there -- but the moment you drag the view round far
  // enough to put the star behind the planet, it shone straight through a solid
  // world at twenty times the brightness of the surface.
  if(!hitPlanet){
    vec3 sunDirScreen = normalize(uSunDir);
    float sd = max(dot(normalize(rd), sunDirScreen), 0.0);
    col += uStarColor * pow(sd, 900.0) * 3.0;
    col += uStarColor * pow(sd, 24.0) * 0.05;
  }

  // tonemap
  col = col / (col + vec3(0.85));
  col = pow(col, vec3(1.0/2.2));
  fragColor = vec4(col, 1.0);
}
